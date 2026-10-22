"""Individual Tier (Sales pilot) services: population and scope, evaluators and approvers, monthly scorecards, snapshots.

Scope: the pilot covers the Sales department's employees except its head. A viewer sees the intersection of that
population with their private-performance scope (`Scope.perf_people`): Managers their reporting tree, the HOD the
department, Admin everyone. Only the evaluator (or Admin) edits a person's month; a different account approves.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.clock import now_ist
from app.core.errors import Forbidden, RuleViolation
from app.models import Account, CorrectionRequest, Department, Employee, KpiItem, KpiMonth, KpiType, MonthlyEvaluation, ScorecardSnapshot, ScoringRule, TrainingModule
from app.seed.sales import PILOT_DEPARTMENT, month_end, pilot_heads
from app.services import sales_scoring as ss
from app.services.common import person, today
from app.services.scope import Scope

EDITABLE_EVAL_STATES = ("Draft", "Returned")


# --- population, evaluators, scope ---------------------------------------------------------------


@dataclass
class Pilot:
    db: Session
    dept: Department
    people: list[Employee]  # evaluated population (department minus its head)
    heads: list[Employee]
    accounts_by_emp: dict[int, Account]

    @property
    def ids(self) -> set[int]:
        return {e.id for e in self.people}

    def by_id(self) -> dict[int, Employee]:
        return {e.id: e for e in self.people + self.heads}

    def evaluator(self, emp: Employee) -> Account | None:
        """First manager up the chain with an active Manager or HOD login (Team Leads have none in the pilot)."""
        seen, cur = set(), emp.manager
        while cur is not None and cur.id not in seen:
            seen.add(cur.id)
            acc = self.accounts_by_emp.get(cur.id)
            if acc and acc.role in ("manager", "hod"):
                return acc
            cur = cur.manager
        return None

    def approver_roles(self, emp: Employee) -> tuple[str, ...]:
        """D2: Managers' evaluations go to the HOD (or Admin); the HOD's own evaluations go to Admin."""
        ev = self.evaluator(emp)
        return ("admin",) if ev is None or ev.role == "hod" else ("hod", "admin")

    def descendants(self, root_id: int) -> set[int]:
        children: dict[int, list[int]] = {}
        for e in self.people + self.heads:
            if e.manager_id:
                children.setdefault(e.manager_id, []).append(e.id)
        out, stack = set(), list(children.get(root_id, []))
        while stack:
            x = stack.pop()
            if x not in out:
                out.add(x)
                stack.extend(children.get(x, []))
        return out


def load_pilot(db: Session) -> Pilot | None:
    dept = db.scalar(select(Department).where(Department.name == PILOT_DEPARTMENT))
    if dept is None:
        return None
    heads = pilot_heads(db, dept)
    head_ids = {h.id for h in heads}
    people = [
        e
        for e in db.scalars(select(Employee).where(Employee.department_id == dept.id, Employee.record_type == "employee").order_by(Employee.code))
        if e.id not in head_ids
    ]
    accounts = {a.employee_id: a for a in db.scalars(select(Account).where(Account.active.is_(True)))}
    return Pilot(db, dept, people, heads, accounts)


def visible_ids(pilot: Pilot, scope: Scope) -> set[int]:
    perf = scope.perf_people
    return pilot.ids if perf is None else pilot.ids & perf


def require_person(pilot: Pilot, scope: Scope, emp_id: int) -> Employee:
    if emp_id not in pilot.ids:
        raise Forbidden("This person is not part of the Individual Tier pilot.")
    if emp_id not in visible_ids(pilot, scope):
        raise Forbidden("Your access does not include this person's KPIs or scores.")
    return pilot.by_id()[emp_id]


def get_evaluation(db: Session, month: KpiMonth, emp_id: int) -> MonthlyEvaluation | None:
    return db.scalar(select(MonthlyEvaluation).where(MonthlyEvaluation.month_id == month.id, MonthlyEvaluation.employee_id == emp_id))


def can_edit(pilot: Pilot, account: Account, emp: Employee, month: KpiMonth, ev: MonthlyEvaluation | None) -> tuple[bool, str]:
    if month.state == "Locked" and open_correction(pilot.db, month, emp.id) is None:
        return False, "The month is closed. Changes need an approved correction."
    if ev is not None and ev.state not in EDITABLE_EVAL_STATES:
        return False, f"The evaluation is {ev.state}. It can change again only if it is returned."
    if account.employee_id == emp.id:
        return False, "You cannot enter your own KPIs or evaluation."
    if account.role == "admin":
        return True, ""
    evaluator = pilot.evaluator(emp)
    if evaluator is not None and evaluator.id == account.id:
        return True, ""
    return False, f"Only {evaluator.employee.full_name if evaluator else 'the evaluator'} (the evaluator) or an Admin can edit this month's records."


def require_edit(pilot: Pilot, account: Account, emp: Employee, month: KpiMonth) -> MonthlyEvaluation | None:
    ev = get_evaluation(pilot.db, month, emp.id)
    ok, why = can_edit(pilot, account, emp, month, ev)
    if not ok:
        raise Forbidden(why)
    return ev


def open_correction(db: Session, month: KpiMonth, emp_id: int) -> "CorrectionRequest | None":
    """An approved correction that has reopened this person's closed month."""
    if month.state != "Locked":
        return None
    return db.scalar(select(CorrectionRequest).where(CorrectionRequest.month_id == month.id, CorrectionRequest.employee_id == emp_id, CorrectionRequest.state == "Open"))


def result_summary(card: dict, snapshot: ScorecardSnapshot | None = None) -> dict:
    sc = card["scorecard"]
    if snapshot is not None:
        return {"final": snapshot.final, "tier": snapshot.tier, "status": snapshot.status, "base": snapshot.base, "coverage": snapshot.coverage, "twcs": snapshot.twcs}
    return {"final": sc["final"], "tier": sc["tier"], "status": sc["status"], "base": sc["base"], "coverage": sc["coverage"], "twcs": card["training"]["score"]}


def refreeze_person(pilot: Pilot, month: KpiMonth, emp: Employee, corr: "CorrectionRequest") -> None:
    """Replace one person's frozen result after an approved correction. The old result is kept on the correction and in the snapshot."""
    data = load_month(pilot, month)
    snap = data.snapshots.get(emp.id)
    card = compute(pilot, data, emp, at_lock=True)
    old = result_summary(card, snap) if snap else None
    new = result_summary(card)
    card = {**card, "evaluation_state": "Approved", "corrected_from": old, "correction_reason": corr.reason}
    history = list((snap.data or {}).get("correction_history", [])) if snap else []
    history.append({"at": now_ist().isoformat(timespec="minutes"), "reason": corr.reason, "old": old, "new": new})
    card["correction_history"] = history
    if snap is None:
        snap = ScorecardSnapshot(month_id=month.id, employee_id=emp.id, rule_id=data.rule.id, data={}, coverage=0, status="scored")
        pilot.db.add(snap)
    snap.data = _jsonable(card)
    snap.base, snap.coverage, snap.twcs = new["base"], new["coverage"], new["twcs"]
    snap.final, snap.tier, snap.status = new["final"], new["tier"], new["status"]
    corr.old_result, corr.new_result = _jsonable(old), _jsonable(new)
    corr.state, corr.completed_at = "Completed", now_ist()


def require_month(db: Session, month_id: int) -> KpiMonth:
    m = db.get(KpiMonth, month_id)
    if m is None:
        raise RuleViolation("Month not found.", "month_id")
    return m


def month_label(m: date) -> str:
    return m.strftime("%b %Y")


# --- derived values ------------------------------------------------------------------------------


def open_warnings(it: KpiItem) -> int:
    """Warnings still to check (a Manager or Admin can mark a warning as checked)."""
    return sum(1 for f in it.flags or [] if f.get("level") == "warn" and not f.get("resolved"))


def kpi_result(pct: float | None) -> str | None:
    """Under achieved | Achieved | Over achieved, from achieved ÷ target (user direction, 20 Oct 2026). None without a %."""
    if pct is None:
        return None
    return "Under achieved" if pct < 100 else "Over achieved" if pct > 100 else "Achieved"


def item_timing(it: KpiItem, cfg: dict, ref: date | None = None) -> str:
    """On time | Delayed | Delay validated | No outcome (overdue) | Open | No deadline. 'Delayed' is derived, never stored.

    KPI rows are 'Not timed': they feed Achievement only, so On-time and the delay penalty come from duty tasks
    (user direction, 20 Oct 2026). Any outcome stored on a KPI row before then is kept but ignored."""
    if it.kind == "kpi":
        return "Not timed"
    ref = ref or today()
    due = it.due_date  # a Manager-set date, else the last day of the row's month
    if it.outcome == "Completed" and it.completed_date:
        if not due:
            return "No deadline"
        late = it.completed_date > due
    elif it.outcome == "Not completed":
        late = True
    else:
        if due and due < ref:
            return "No outcome"
        return "Open"
    if not late:
        return "On time"
    if it.delay_validated and cfg["penalties"].get("exclude_validated_delays", True):
        return "Delay validated"
    return "Delayed"


def team_sums(items: list[KpiItem], pilot: Pilot) -> dict[int, dict]:
    """For each team KPI row: the sum of the matching individual rows of everyone below that manager."""
    individual: dict[tuple[int, int], list[KpiItem]] = {}
    for it in items:
        if it.kind == "kpi" and not it.is_team and it.kpi_type_id:
            individual.setdefault((it.employee_id, it.kpi_type_id), []).append(it)
    out = {}
    for it in items:
        if it.kind != "kpi" or not it.is_team or not it.kpi_type_id:
            continue
        below = pilot.descendants(it.employee_id)
        rows = [r for e in below for r in individual.get((e, it.kpi_type_id), [])]
        targets = [r.target_value for r in rows if r.target_value is not None]
        achieved = [r.achieved_value for r in rows if r.achieved_value is not None]
        out[it.id] = {
            "rows": len(rows),
            "target_sum": sum(targets) if targets else None,
            "achieved_sum": sum(achieved) if rows and len(achieved) == len(rows) else None,
            "achieved_partial": sum(achieved) if achieved and len(achieved) < len(rows) else None,
            "achieved_missing": len(rows) - len(achieved),
        }
    return out


def effective_values(it: KpiItem, sums: dict[int, dict]) -> tuple[float | None, float | None, str]:
    """Team rows use their own value when entered, otherwise the reportee sum (achieved only when every reportee row has one)."""
    if not it.is_team or it.id not in sums:
        return it.target_value, it.achieved_value, "entered"
    s = sums[it.id]
    target = it.target_value if it.target_value is not None else s["target_sum"]
    achieved = it.achieved_value if it.achieved_value is not None else s["achieved_sum"]
    source = "entered" if it.achieved_value is not None else ("reportee sum" if s["achieved_sum"] is not None else "missing")
    return target, achieved, source


def to_module(m: TrainingModule) -> ss.Module:
    return ss.Module(
        id=m.id, title=m.title, track=m.track, due_date=m.due_date, completed_date=m.completed_date, status=m.status,
        verified=m.verified_by is not None, assigned_date=m.assigned_date, attempts=m.attempts,
    )


@dataclass
class MonthData:
    month: KpiMonth
    rule: ScoringRule
    items: dict[int, list[KpiItem]]
    modules: dict[int, list[TrainingModule]]
    evaluations: dict[int, MonthlyEvaluation]
    snapshots: dict[int, ScorecardSnapshot]
    sums: dict[int, dict]
    corrections: set[int]  # people whose closed month is open for an approved correction (scored live, not from the snapshot)


def load_month(pilot: Pilot, month: KpiMonth, rule: ScoringRule | None = None) -> MonthData:
    db = pilot.db
    start, end = month.month, month_end(month.month)
    all_items = list(db.scalars(select(KpiItem).where(KpiItem.month_id == month.id, KpiItem.removed_at.is_(None)).order_by(KpiItem.kind, KpiItem.id)))
    items: dict[int, list[KpiItem]] = {}
    for it in all_items:
        items.setdefault(it.employee_id, []).append(it)
    modules: dict[int, list[TrainingModule]] = {}
    # Modules due in the month count; later ones are listed as "future" until their month.
    for m in db.scalars(select(TrainingModule).where(TrainingModule.due_date >= start).order_by(TrainingModule.due_date, TrainingModule.id)):
        modules.setdefault(m.employee_id, []).append(m)
    evaluations = {e.employee_id: e for e in db.scalars(select(MonthlyEvaluation).where(MonthlyEvaluation.month_id == month.id))}
    snapshots = {s.employee_id: s for s in db.scalars(select(ScorecardSnapshot).where(ScorecardSnapshot.month_id == month.id))}
    corrections = set(db.scalars(select(CorrectionRequest.employee_id).where(CorrectionRequest.month_id == month.id, CorrectionRequest.state == "Open")))
    return MonthData(month, rule or db.get(ScoringRule, month.rule_id), items, modules, evaluations, snapshots, team_sums(all_items, pilot), corrections)


def compute(pilot: Pilot, data: MonthData, emp: Employee, *, at_lock: bool = False, cfg: dict | None = None) -> dict:
    """The person's scorecard for the month, with every input that produced it. Locked months return the snapshot."""
    if data.month.state == "Locked" and emp.id in data.snapshots and cfg is None and emp.id not in data.corrections:
        return {**data.snapshots[emp.id].data, "locked": True}
    cfg = cfg or data.rule.config
    month = data.month
    start, end = month.month, month_end(month.month)
    category = pilot.dept.category
    items = data.items.get(emp.id, [])
    ev = data.evaluations.get(emp.id)
    ref = max(today(), end) if at_lock else today()

    ach_rows, item_rows = [], []
    on_time = delayed = validated = no_outcome = 0
    for it in items:
        timing = item_timing(it, cfg, ref)
        if timing == "On time":
            on_time += 1
        elif timing == "Delayed":
            delayed += 1
        elif timing == "Delay validated":
            validated += 1
        elif timing == "No outcome":
            no_outcome += 1
        row = {"id": it.id, "kind": it.kind, "title": it.title, "timing": timing, "is_team": it.is_team}
        if it.kind == "kpi":
            target, achieved, source = effective_values(it, data.sums)
            pct = achieved / target * 100 if target and achieved is not None else None
            row.update({"target": target, "achieved": achieved, "value_source": source, "pct": pct, "result": kpi_result(pct), "kpi_type_id": it.kpi_type_id})
            ach_rows.append(ss.AchievementRow(it.title, target, achieved))
        item_rows.append(row)

    weights = cfg["weights"].get(category, {})
    metrics: dict[str, dict] = {}
    metrics["achievement"] = ss.score_achievement(ach_rows, cfg) if ach_rows else {"available": False, "score": None, "reason": "No targets set for this month.", "rows": [], "skipped": []}
    metrics["on_time"] = ss.score_on_time(on_time, delayed, cfg)
    for metric in ss.RATED_METRICS:
        metrics[metric] = ss.score_rating(getattr(ev, f"{metric}_rating") if ev else None, cfg)

    mods = [to_module(m) for m in data.modules.get(emp.id, [])]
    training = ss.twcs(mods, start, end, month.training_cutoff, cfg, confirmed_none_due=bool(ev and ev.training_none_due), require_verified=at_lock)
    derived = {"on_time_count": on_time, "delayed_count": delayed, "achievement_pct": metrics["achievement"].get("raw"), "twcs_score": training["score"]}

    # Tasks on-time, Tasks delayed and Achievement % always come from the KPI rows and duty tasks (user direction, 15 Oct 2026).
    # Only the training score may be typed by the Manager; it replaces the TWCS worked out from the modules.
    entered = {"twcs_score": ev.twcs_score if ev else None}
    penalty_delays = delayed
    if entered["twcs_score"] is not None:
        b = ss.band_for(float(entered["twcs_score"]), cfg)
        training = {**training, "status": "scored", "score": float(entered["twcs_score"]), "band": b["band"], "keka": b["keka"], "reason": "", "source": "Entered by the Manager", "provisional": 0}
    card = ss.scorecard(category, metrics, penalty_delays, training, cfg)

    readiness = []
    if not items:
        readiness.append("No targets set for this month.")
    missing_actuals = [r for r in item_rows if r["kind"] == "kpi" and r.get("target") and r.get("achieved") is None]
    if missing_actuals:
        readiness.append(f"{len(missing_actuals)} KPI row(s) have no achieved value.")
    if no_outcome:
        readiness.append(f"{no_outcome} row(s) are past their target date with no outcome recorded; excluded from On-time.")
    for metric in ss.RATED_METRICS:
        if weights.get(metric) and not metrics[metric]["available"]:
            readiness.append(f"{ss.SALES_METRIC_LABELS[metric]} rating not entered.")
    if weights.get("training") and training["status"] == "missing":
        readiness.append("No training modules due this month. Record them, or confirm nothing was due.")
    if training["provisional"]:
        readiness.append(f"{training['provisional']} training completion(s) await verification.")
    if ev and ev.training_none_due and training["counted"]:
        readiness.append("Marked 'no training due', but modules are due this month; the modules are used.")

    evaluator = pilot.evaluator(emp)
    return {
        "employee": person(emp),
        "month": {"id": month.id, "month": month.month, "label": month_label(month.month), "state": month.state},
        "rule": {"id": data.rule.id, "label": data.rule.label, "state": data.rule.state},
        "category": category,
        "scorecard": card,
        "achievement": {k: metrics["achievement"].get(k) for k in ("rows", "skipped", "raw", "score", "available", "reason")},
        "on_time": {"on_time": on_time, "delayed": delayed, "delay_validated": validated, "no_outcome": no_outcome},
        "training": training,
        "inputs": {"entered": entered, "derived": derived},
        "items": item_rows,
        "evaluation_state": ev.state if ev else "Not started",
        "evaluator": person(evaluator.employee) if evaluator else None,
        "readiness": readiness,
        "locked": False,
    }


def snapshot_month(pilot: Pilot, month: KpiMonth, actor: Account, excluded_reason: str | None) -> dict:
    """Freeze every person's scorecard. People without an approved evaluation are stored as not evaluated."""
    data = load_month(pilot, month)
    counts = {"scored": 0, "insufficient": 0, "not_evaluated": 0}
    for emp in pilot.people:
        ev = data.evaluations.get(emp.id)
        card = compute(pilot, data, emp, at_lock=True)
        if ev is None or ev.state != "Approved":
            status = "not_evaluated"
            if ev is None:
                ev = MonthlyEvaluation(month_id=month.id, employee_id=emp.id, state="Draft")
                pilot.db.add(ev)
            ev.excluded_reason = excluded_reason
            card = {**card, "excluded_reason": excluded_reason}
            final, tier = None, None
        else:
            status = card["scorecard"]["status"]
            final, tier = card["scorecard"]["final"], card["scorecard"]["tier"]
        counts[status] += 1
        card["evaluation_state"] = ev.state
        pilot.db.add(
            ScorecardSnapshot(
                month_id=month.id, employee_id=emp.id, rule_id=data.rule.id, data=_jsonable(card), base=card["scorecard"]["base"],
                coverage=card["scorecard"]["coverage"], twcs=card["training"]["score"], final=final, tier=tier, status=status,
            )
        )
    return counts


def _jsonable(v):
    if isinstance(v, dict):
        return {k: _jsonable(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [_jsonable(x) for x in v]
    if isinstance(v, date):
        return v.isoformat()
    return v


# --- what non-Admins may see ----------------------------------------------------------------------

METHOD_NOTE = "The scoring method (weights, curves, penalties and tiers) is visible to Admins only."


def method_visible(account: Account) -> bool:
    """Weights, contributions, coverage, base score, penalties and tier rules are Admin-only (user direction, 15 Oct 2026)."""
    return account.role == "admin"


def redact_card(card: dict) -> dict:
    """Remove the scoring method from a scorecard: keep the inputs, the final score, the tier and the status."""
    sc = card["scorecard"]
    out = {**card}
    out["scorecard"] = {
        "rows": [{k: r.get(k) for k in ("metric", "label", "available", "display", "reason")} for r in sc["rows"]],
        "final": sc["final"],
        "tier": sc["tier"],
        "status": sc["status"],
        "explanation": "Not enough data yet to score this month." if sc["status"] == "insufficient" else "",
    }
    if "achievement" in out:
        out["achievement"] = {k: v for k, v in out["achievement"].items() if k != "score"}
    out["method_hidden"] = True
    return out


# --- serialisers ---------------------------------------------------------------------------------


def item_dict(it: KpiItem, cfg: dict, sums: dict[int, dict], types: dict[int, KpiType]) -> dict:
    target, achieved, source = effective_values(it, sums)
    t = types.get(it.kpi_type_id) if it.kpi_type_id else None
    return {
        "id": it.id,
        "kind": it.kind,
        "employee_id": it.employee_id,
        "title": it.title,
        "kpi_type": {"id": t.id, "code": t.code, "name": t.name, "unit": t.unit} if t else None,
        "is_team": it.is_team,
        "priority": it.priority,
        "start_date": it.start_date,
        "target_date": it.due_date,  # the due date in force
        "due_set_by_manager": it.target_date is not None,
        "target_value": it.target_value,
        "target_text": it.target_text,
        "per_day": it.per_day,
        "achieved_value": it.achieved_value,
        "effective_target": target,
        "effective_achieved": achieved,
        "value_source": source,
        "team_sum": sums.get(it.id),
        "pct": achieved / target * 100 if target and achieved is not None else None,
        "result": kpi_result(achieved / target * 100 if target and achieved is not None else None) if it.kind == "kpi" else None,
        "outcome": it.outcome,
        "completed_date": it.completed_date,
        "timing": item_timing(it, cfg),
        "delay_reason": it.delay_reason,
        "delay_validated": it.delay_validated,
        "remarks": it.remarks,
        "source": it.source,
        "source_row": it.source_row,
        "source_name": it.source_name,
        "source_status": it.source_status,
        "flags": it.flags or [],
        "open_warnings": open_warnings(it),
        "illustrative": it.illustrative,
        "version": it.version,
        "updated_at": it.updated_at,
    }


def module_dict(m: TrainingModule, cutoff: date, cfg: dict) -> dict:
    c = ss.module_credit(to_module(m), cutoff, cfg)
    return {
        "id": m.id,
        "employee_id": m.employee_id,
        "title": m.title,
        "track": m.track,
        "assigned_date": m.assigned_date,
        "due_date": m.due_date,
        "completed_date": m.completed_date,
        "status": m.status,
        "attempts": m.attempts,
        "note": m.note,
        "days_late": c["days_late"],
        "credit": None if m.status == "Exempt" else c["credit"],
        "credit_note": "Exempt (approved)" if m.status == "Exempt" else c["note"],
        "verified": m.verified_by is not None,
        "verified_at": m.verified_at,
        "recorded_by": m.recorded_by,
        "exemption_reason": m.exemption_reason,
        "exemption_requested_by": m.exemption_requested_by,
    }


def evaluation_dict(ev: MonthlyEvaluation | None) -> dict | None:
    if ev is None:
        return None
    return {
        "id": ev.id,
        "state": ev.state,
        "csat_rating": ev.csat_rating,
        "quality_rating": ev.quality_rating,
        "compliance_rating": ev.compliance_rating,
        "collaboration_rating": ev.collaboration_rating,
        "innovation_rating": ev.innovation_rating,
        "training_none_due": ev.training_none_due,
        "on_time_count": ev.on_time_count,
        "delayed_count": ev.delayed_count,
        "achievement_pct": ev.achievement_pct,
        "twcs_score": ev.twcs_score,
        "comments": ev.comments,
        "submitted_by": ev.submitted_by,
        "submitted_at": ev.submitted_at,
        "decided_by": ev.decided_by,
        "decided_at": ev.decided_at,
        "decision_note": ev.decision_note,
        "excluded_reason": ev.excluded_reason,
        "version": ev.version,
        "updated_at": ev.updated_at,
    }


def rule_dict(r: ScoringRule) -> dict:
    return {
        "id": r.id,
        "label": r.label,
        "state": r.state,
        "summary": r.summary,
        "config": r.config,
        "effective_month": r.effective_month,
        "author_account_id": r.author_account_id,
        "approver_account_id": r.approver_account_id,
        "decision_note": r.decision_note,
        "created_at": r.created_at,
        "decided_at": r.decided_at,
    }
