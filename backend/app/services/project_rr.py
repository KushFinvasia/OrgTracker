"""Project R&R from records: charters, RACI, task-based timelines and delays, programme runs, inputs and scorecards.

Scoring itself is the pure engine in services/project_scoring.py. This module builds its inputs from the database, applies the
viewer's scope (units and ₹ for Admin and R&R Panel members only; individual scores within private performance scope) and
lists what each function holder has to act on.
"""

from __future__ import annotations

from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    Account,
    BaselineChange,
    Department,
    Employee,
    Incident,
    Project,
    ProjectCharter,
    ProjectDelay,
    ProjectDispute,
    ProjectRaci,
    ProjectRrInput,
    ProjectSla,
    RrPolicy,
    Submission,
    Task,
    WorkflowTemplate,
    WorkRequest,
)
from app.models.project_rr import INPUT_KINDS, RR_FUNCTIONS
from app.services import project_scoring as ps
from app.services.common import account_person, add_business_days, business_days_between, holidays, person, person_by_id, today

POOL_RATES = {"Standard": 0.02, "Complex": 0.025, "Strategic": 0.03}  # proposed (open decision P3)
OPEN_DECISIONS = [
    ("P1", "Flat −2, or −4 for slips over 10 working days", "Flat −2"),
    ("P2", "Timelines 25 / Quality 25, or 20 / 30", "25 / 25"),
    ("P3", "Pool rates and annual cap", "2 / 2.5 / 3%, cap not set"),
    ("P4", "Who sets non-revenue value targets", "Sponsor; campaigns use conversions"),
    ("P5", "Severity → critical error", "Major = critical"),
    ("P6", "Rework % source", "Quality assessor enters it, with a suggestion from reviews"),
    ("P7", "Disciplinary and probation source", "None, so Unknown blocks cash"),
    ("P8", "Pilot projects", "3–5 live projects for one quarter"),
    ("P9", "Collaboration: §13 example (+3) vs §3.2 rule (+4)", "§3.2 rule, HR to confirm"),
    ("P10", "Recurring template work", "Quarterly programme"),
    ("P11", "Escalation miss on stages of 3 bd or less", "Flag before half the stage SLA"),
    ("P12", "Factor from planned effort share", "≥40% 1.0 · 20–40% 0.75 · <20% 0.5"),
    ("P13", "Outside approver misses stage SLA", "Client-caused (excused)"),
    ("P14", "Stage-level A at project level", "Workstream lead (R)"),
]
SLABS = [
    ("Revenue / value (30)", "≥100% 30 · 90–99 24 · 80–89 18 · 70–79 10 · <70 0"),
    ("Timelines (25)", "≥90% 25 · 80–89 20 · 70–79 14 · 60–69 8 · <60 0"),
    ("TAT / SLA (20)", "≥95% 20 · 90–94 16 · 80–89 11 · 70–79 6 · <70 0"),
    ("Rework (10)", "≤5% 10 · 6–10 7 · 11–15 4 · >15 0"),
    ("Errors after go-live (8)", "0 crit ≤2 minor 8 · 0 crit 3–5 minor 5 · 1 crit 2 · ≥2 crit 0"),
    ("Satisfaction (7)", "≥4.5 7 · 4.0–4.4 5 · 3.5–3.9 3 · <3.5 0"),
]
CAPS = [
    ("Delay penalty", "−2 · escalation miss on top of another reason −2 more"),
    ("Caps", "−4 / task · −20 / project · −10 / person"),
    ("Recovery credit", "+1 (max +6)"),
    ("Bonus", "≤ +10, only if Quality ≥ 15"),
    ("Bands", "Platinum 90 · Gold 80 · Silver 70 · Bronze 60"),
    ("Payout %", "100 / 80 / 60 / 0 / 0"),
    ("Units", "A 3 · R 2×factor · C 0.5 (C pool ≤ 20%)"),
    ("Pool rates", "2% · 2.5% · 3%"),
]


# --- viewer ---------------------------------------------------------------------------------------------------------


def functions_of(account: Account) -> set[str]:
    return set(account.functions or [])


def has_fn(ctx, fn: str) -> bool:
    return fn in functions_of(ctx.account)


def sees_money(ctx) -> bool:
    return ctx.scope.is_admin or has_fn(ctx, "R&R Panel member")


def charter_for(db: Session, project_id: int) -> ProjectCharter | None:
    return db.scalar(select(ProjectCharter).where(ProjectCharter.project_id == project_id))


def raci_rows(db: Session, project_id: int) -> list[ProjectRaci]:
    order = {"A": 0, "R": 1, "C": 2, "I": 3}
    return sorted(db.scalars(select(ProjectRaci).where(ProjectRaci.project_id == project_id)), key=lambda r: (order.get(r.letter, 9), r.id))


def in_raci(db: Session, project_id: int, employee_id: int) -> bool:
    return bool(db.scalar(select(ProjectRaci.id).where(ProjectRaci.project_id == project_id, ProjectRaci.employee_id == employee_id)))


def bdays(db_hols: set[date]):
    return lambda a, b: business_days_between(a, b, db_hols)


# --- tasks → timelines and late tasks ------------------------------------------------------------------------------


def _submitted_on(db: Session, t: Task) -> date | None:
    if t.status != "In Review":
        return None
    return db.scalar(select(Submission.submission_date).where(Submission.task_id == t.id).order_by(Submission.version.desc()))


def task_timelines(db: Session, project_id: int, ref: date | None = None) -> dict:
    """Tasks with a baseline due date that are due by now: on time, late, and the late ones as task rows."""
    ref = ref or today()
    rows = []
    for t in db.scalars(select(Task).where(Task.project_id == project_id).order_by(Task.code)):
        b = ps.baseline_timing(t.status, t.due_date_original, t.accepted_submission_date, _submitted_on(db, t), ref)
        if b in ("On time", "Late"):
            rows.append((t, b))
    return {"due": len(rows), "on_time": sum(b == "On time" for _, b in rows), "late": [t for t, b in rows if b == "Late"]}


def late_task_dict(db: Session, t: Task, ref: date) -> dict:
    owner = next((a for a in t.assignments if a.role == "Owner"), None)
    return {
        "id": t.id,
        "code": t.code,
        "title": t.title,
        "status": t.status,
        "owner": person(owner.employee) if owner else None,
        "baseline_due": t.due_date_original,
        "accepted_on": t.accepted_submission_date,
        "days_past": (ref - t.due_date_original).days if t.due_date_original and t.status != "Completed" else None,
    }


# --- programme runs -------------------------------------------------------------------------------------------------


def template_stages(db: Session, template_id: int | None) -> list:
    tpl = db.get(WorkflowTemplate, template_id) if template_id else None
    return list(tpl.stages) if tpl else []


def runs_for(db: Session, project: Project, ref: date | None = None) -> list[dict]:
    """Each accepted campaign request is one run of the programme: its stage tasks, delivery and maximum SLA date."""
    ref = ref or today()
    hols = holidays(db)
    tpl = db.get(WorkflowTemplate, project.template_id) if project.template_id else None
    stages = {s.step: s for s in (tpl.stages if tpl else [])}
    by_run: dict[int, list[Task]] = {}
    for t in db.scalars(select(Task).where(Task.project_id == project.id, Task.run_request_id.is_not(None)).order_by(Task.template_step)):
        by_run.setdefault(t.run_request_id, []).append(t)
    out = []
    for n, (rid, tasks) in enumerate(sorted(by_run.items()), 1):
        r = db.get(WorkRequest, rid)
        dept = db.get(Department, r.requesting_department_id) if r and r.requesting_department_id else None
        started = min((t.start_date for t in tasks if t.start_date), default=None)
        stage_rows = []
        for t in tasks:
            st = stages.get(t.template_step)
            sla = st.sla_max_days if st else None
            late = False
            if sla and t.start_date:
                end = t.accepted_submission_date if t.status == "Completed" else ref
                late = business_days_between(t.start_date, end, hols) > sla and (t.status == "Completed" or (t.due_date_original and t.due_date_original < ref))
            stage_rows.append({"step": t.template_step, "task_id": t.id, "code": t.code, "name": t.title, "status": t.status, "done": t.status == "Completed", "late": late, "start": t.start_date, "due": t.due_date_original, "accepted_on": t.accepted_submission_date})
        done_all = bool(stage_rows) and all(s["done"] for s in stage_rows)
        delivered = max((s["accepted_on"] for s in stage_rows if s["accepted_on"]), default=None) if done_all else None
        max_due = add_business_days(started, tpl.sla_max_days, hols) if started and tpl and tpl.sla_max_days else None
        out.append({
            "id": f"R{n}",
            "request_id": rid,
            "title": r.title if r else f"Run {n}",
            "requesting_department": dept.name if dept else None,
            "validator_rule": f"Head of {dept.name}" if dept else "Head of the requesting department",
            "stages": stage_rows,
            "started": started,
            "delivered": delivered,
            "max_due": max_due,
        })
    return out


def stage_task_counts(runs: list[dict]) -> dict:
    done = sum(1 for r in runs for s in r["stages"] if s["done"])
    late = sum(1 for r in runs for s in r["stages"] if s["done"] and s["late"])
    return {"done": done, "on_time": done - late}


def programme_raci(db: Session, project: Project, charter: ProjectCharter) -> dict:
    """Template stages -> one project letter per person (services/project_scoring.resolve_programme_raci)."""
    stages = template_stages(db, project.template_id)
    role_map = {st.responsible_role: st.responsible_id for st in stages if st.responsible_role and st.responsible_id}
    names = {e.full_name: e.id for e in (db.get(Employee, i) for i in set(role_map.values())) if e}
    note = (charter.champion_note or "").strip()
    champion = f"E{charter.champion_id}" if charter.champion_id else f"@{note}" if note else None

    def key(emp_id, label):
        """Template labels -> one identity: the champion's role, a named Responsible person, or a group label."""
        if emp_id:
            return f"E{emp_id}"
        label = (label or "").replace(" (proposed)", "").strip()
        if not label:
            return None
        if note and label in (note, note.split(":")[0].strip()):
            return champion
        if label.startswith("Head of requesting department"):
            return "@Head of requesting department"
        if label.startswith("Requesting department ("):
            return "@Requester's manager (per run)"
        if label in role_map:
            return f"E{role_map[label]}"
        named = names.get(label.split(":", 1)[-1].strip())
        return f"E{named}" if named else f"@{label}"

    shaped = []
    for st in stages:
        split = lambda s: [x.strip() for x in (s or "").replace("/", ";").split(";") if x.strip() and x.strip() != "-"]  # noqa: E731
        shaped.append({
            "step": st.step,
            "effort": (st.effort_min_hours or 0, st.effort_max_hours or 0),
            "R": [k for k in [key(st.responsible_id, st.responsible_role)] if k],
            "A": key(st.accountable_id, st.accountable_label),
            "C": [k for k in (key(None, c) for c in split(st.consulted)) if k],
            "I": [k for k in (key(None, i) for i in split(st.informed)) if k],
        })
    res = ps.resolve_programme_raci(shaped, champion)
    factors = {r.employee_id: r for r in raci_rows(db, project.id)}
    rows = []
    for x in res["rows"]:
        emp_id = int(x["id"][1:]) if x["id"].startswith("E") else None
        stored = factors.get(emp_id) if emp_id else None
        rows.append({
            "key": x["id"],
            "person": person_by_id(db, emp_id) if emp_id else None,
            "label": None if emp_id else x["id"][1:],
            "letters": {L: x[L] for L in ("A", "R", "C", "I")},
            "letter": x["letter"],
            "dropped": x["dropped"],
            "share": x["share"],
            "suggested": x["suggested"],
            "factor_confirmed": bool(stored and stored.factor_confirmed),
            "raci_id": stored.id if stored else None,
            "payable": bool(emp_id) and x["letter"] in ("A", "R", "C"),
            "notes": x["notes"],
        })
    return {"rows": rows, "total_effort": res["total_effort"]}


def stage_rows(db: Session, project: Project, charter: ProjectCharter) -> list[dict]:
    out = []
    for st in template_stages(db, project.template_id):
        rule = bool(st.reviewer_label and st.reviewer_label.lower().startswith(("manager of requesting", "head of requesting")))
        named = (charter.stage_reviewers or {}).get(str(st.step))
        conflict = not rule and not named and (not st.reviewer_id or st.reviewer_id == st.responsible_id)
        out.append({
            "step": st.step,
            "name": st.name,
            "sla_target": st.sla_target_days,
            "sla_max": st.sla_max_days,
            "effort": [st.effort_min_hours, st.effort_max_hours],
            "responsible": person_by_id(db, st.responsible_id),
            "reviewer_rule": st.reviewer_label if rule else None,
            "reviewer": person_by_id(db, named) if named else (None if conflict or rule else person_by_id(db, st.reviewer_id)),
            "reviewer_conflict": conflict,
            "conflict_reason": ("Reviewer is the Responsible person" if st.reviewer_id and st.reviewer_id == st.responsible_id else "No independent reviewer named") if conflict else None,
            "flags": st.source_flags,
        })
    return out


# --- charter readiness ------------------------------------------------------------------------------------------------


def lock_checklist(db: Session, project: Project, charter: ProjectCharter) -> list[dict]:
    raci = raci_rows(db, project.id)
    if charter.mode == "programme":
        items = [{"key": "champion", "label": "Champion (A) is a named employee in the org chart", "ok": bool(charter.champion_id), "why": charter.champion_note or "Name the champion"}]
        for st in stage_rows(db, project, charter):
            if st["reviewer_conflict"] or (charter.stage_reviewers or {}).get(str(st["step"])):
                items.append({"key": f"reviewer:{st['step']}", "label": f"Stage {st['step']} · {st['name']}: independent reviewer", "ok": not st["reviewer_conflict"], "why": st["conflict_reason"] or "", "step": st["step"]})
        for row in programme_raci(db, project, charter)["rows"]:
            if row["letter"] == "R" and row["payable"]:
                items.append({"key": f"factor:{row['raci_id']}", "label": f"Contribution factor for {row['person']['name']}", "ok": row["factor_confirmed"], "why": f"Suggested {row['suggested']:g} from {row['share'] * 100:.1f}% of planned effort", "raci_id": row["raci_id"], "suggested": row["suggested"]})
        items.append({"key": "target", "label": "Value target locked", "ok": bool(charter.value_target), "why": "Set the quarter's target"})
        items.append({"key": "baseline_metrics", "label": "Baseline metrics are established (RSK-011/012 assumption)", "ok": bool((charter.lock_checks or {}).get("baseline_metrics")), "why": "Open rate, click rate and conversion baseline recorded"})
        return items
    tasks = list(db.scalars(select(Task).where(Task.project_id == project.id, Task.status != "Cancelled")))
    return [
        {"key": "priority", "label": "Priority chosen", "ok": bool(project.priority), "why": "Choose High, Medium or Low in Update project"},
        {"key": "target", "label": "Value target and sponsor", "ok": bool((charter.value_target or charter.value_target_text) and charter.sponsor), "why": "Set the value target and name the sponsor"},
        {"key": "baselines", "label": "Baseline due date on every task", "ok": bool(tasks) and all(t.due_date_original for t in tasks), "why": f"{sum(1 for t in tasks if not t.due_date_original)} task(s) without a due date" if tasks else "Add the project's tasks"},
        {"key": "raci", "label": "Named RACI with one A", "ok": sum(r.letter == "A" for r in raci) == 1 and any(r.letter == "R" for r in raci), "why": "Exactly one Accountable and at least one Responsible"},
        {"key": "slas", "label": "SLA list", "ok": bool(db.scalar(select(ProjectSla.id).where(ProjectSla.project_id == project.id))), "why": "Add at least one SLA"},
    ]


# --- inputs -----------------------------------------------------------------------------------------------------------


def input_dict(db: Session, i: ProjectRrInput) -> dict:
    label, fn = INPUT_KINDS.get(i.kind, (i.kind, "PMO validator"))
    p = db.get(Project, i.project_id)
    return {
        "id": i.id,
        "project": {"id": p.id, "code": p.code, "title": p.title},
        "kind": i.kind,
        "kind_label": label,
        "function": fn,
        "value": i.value,
        "display": i.display,
        "state": i.state,
        "author": account_person(db, i.author_account_id),
        "author_account_id": i.author_account_id,
        "validator": account_person(db, i.validator_account_id),
        "reason": i.reason,
        "illustrative": i.illustrative,
        "created_at": i.created_at,
    }


def validated_inputs(db: Session, project_id: int) -> dict[str, ProjectRrInput]:
    latest: dict[str, ProjectRrInput] = {}
    for i in db.scalars(select(ProjectRrInput).where(ProjectRrInput.project_id == project_id, ProjectRrInput.state == "Validated").order_by(ProjectRrInput.id)):
        latest[i.kind] = i
    return latest


# --- scorecard --------------------------------------------------------------------------------------------------------


def delay_dict(db: Session, d: ProjectDelay) -> dict:
    return {
        "id": d.id,
        "code": d.code,
        "task_id": d.task_id,
        "task_code": db.get(Task, d.task_id).code if d.task_id else None,
        "task_label": d.task_label,
        "run_request_id": d.run_request_id,
        "stage": d.stage,
        "reason_code": d.reason_code,
        "reason_label": ps.reason_label(d.reason_code, d.custom_reason),
        "custom_reason": d.custom_reason,
        "controllable": ps.controllable(d.reason_code),
        "points": ps.delay_points(d.reason_code, d.escalation_miss),
        "explanation": d.explanation,
        "evidence": d.evidence,
        "due_date": d.due_date,
        "flagged_on": d.flagged_on,
        "escalation_miss": d.escalation_miss,
        "tagged": [person_by_id(db, e) for e in (d.tagged or [])],
        "state": d.state,
        "logged_by": account_person(db, d.logged_by),
        "logged_by_account_id": d.logged_by,
        "validated_by": account_person(db, d.validated_by),
        "illustrative": d.illustrative,
        "history": d.history or [],
    }


def compliance_ok(db: Session, project_id: int) -> bool:
    return not db.scalar(select(Incident.id).where(Incident.project_id == project_id, Incident.severity_validated == "Major", Incident.attribution_state == "validated"))


def engine_inputs(db: Session, project: Project, charter: ProjectCharter) -> dict:
    v = validated_inputs(db, project.id)
    delays = list(db.scalars(select(ProjectDelay).where(ProjectDelay.project_id == project.id)))
    if charter.mode == "programme":
        sc = stage_task_counts(runs_for(db, project))
        timelines = {"due": sc["done"], "on_time": sc["on_time"]}
        unlogged = []
    else:
        tl = task_timelines(db, project.id)
        excused = {d.task_id for d in delays if not ps.controllable(d.reason_code) and d.state in ("Validated", "Closed")}
        timelines = {"due": tl["due"], "on_time": tl["on_time"] + sum(1 for t in tl["late"] if t.id in excused)}
        logged = {d.task_id for d in delays}
        unlogged = [t for t in tl["late"] if t.id not in logged]
    val = v.get("value_actual")
    value = {"target": charter.value_target, "actual": val.value.get("actual") if val else None, "confirmed": bool(val),
             "source": f"{val.display} · confirmed {val.decided_at:%d %b %Y}" if val and val.decided_at else "Not confirmed"}
    raci = []
    for r in raci_rows(db, project.id):
        raci.append({"key": r.employee_id or f"label:{r.id}", "raci_id": r.id, "employee_id": r.employee_id, "label": r.label, "letter": r.letter, "factor": r.factor, "adjustment": r.adjustment, "note": r.note, "response_days": r.response_days})
    sla = v.get("sla")
    out = {
        "value": value,
        "pool_rate": charter.pool_rate if charter.pool_rate is not None else POOL_RATES.get(charter.project_type, 0.02),
        "timelines": timelines,
        "sla": sla.value if sla else None,
        "rework_pct": v["rework"].value.get("pct") if v.get("rework") else None,
        "errors": v["errors"].value if v.get("errors") else None,
        "satisfaction": v["satisfaction"].value if v.get("satisfaction") else None,
        "innovation": (v["innovation"].value.get("points") if v.get("innovation") else 0) or 0,
        "collab": v["collaboration"].value if v.get("collaboration") else None,
        "recovery": 0,
        "compliance_ok": compliance_ok(db, project.id),
        "compliance_source": "Incident register · no validated attributable Major",
        "charter_locked": charter.state == "Locked",
        "locked_source": f"Sponsor and PMO · {charter.locked_on:%d %b %Y}" if charter.locked_on else "Not locked",
        "delays": [{"code": d.reason_code, "escalation_miss": d.escalation_miss, "tagged": d.tagged or []} for d in delays],
        "raci": raci,
        "doc_reading": charter.doc_reading,
    }
    return {"inputs": out, "unlogged": unlogged, "validated": v}


def effective_stage(project: Project, charter: ProjectCharter, result: dict | None) -> str:
    if charter.frozen or charter.stage in ("HR calibrated", "Panel approved", "Published"):
        return charter.stage
    if charter.state != "Locked":
        return "Charter draft"
    if charter.mode == "closure" and project.status != "Completed":
        return "In delivery"
    if result and result.get("state") == "Scored":
        return "Inputs validated"
    if result and result.get("missing") == [ps.MISSING_LABELS["value"]]:
        return "Awaiting Finance"
    return "Collecting inputs"


def compute(db: Session, project: Project, charter: ProjectCharter) -> dict:
    """The unredacted scorecard: frozen when published, otherwise scored live from validated inputs."""
    if charter.frozen:
        return {**charter.frozen, "frozen": True, "stage": charter.stage}
    built = engine_inputs(db, project, charter)
    inp = built["inputs"]
    if built["unlogged"]:
        result = {"state": "Insufficient data", "missing": [f"Delay entry for {len(built['unlogged'])} late task(s)"], "score": None, "band": None, "penalty": ps.delay_penalty(inp["delays"])}
    else:
        result = ps.score(inp)
    if charter.state != "Locked":
        result = {**result, "state": "Not eligible", "score": None, "band": None, "missing": ["A locked baseline (charter)"]}
    elif charter.mode == "closure" and project.status != "Completed" and result.get("state") == "Scored":
        result = {**result, "state": "Provisional"}  # scored at closure; shown so the team can see where it stands
    people_meta = {x["key"]: x for x in inp["raci"]}
    for p in result.get("people", []):
        meta = people_meta.get(p["key"], {})
        p["person"] = person_by_id(db, meta.get("employee_id")) if meta.get("employee_id") else None
        p["label"] = meta.get("label")
        p["note"] = meta.get("note")
    return {**result, "inputs": inp, "frozen": False, "stage": effective_stage(project, charter, result)}


def redact(ctx, card: dict) -> dict:
    """Units and ₹ for Admin and R&R Panel members only; individual scores within private performance scope."""
    money = sees_money(ctx)
    out = {k: v for k, v in card.items() if k not in ("inputs",)}
    out["money_visible"] = money
    if not money:
        for k in ("pool", "paid", "to_fund", "unit_value", "total_units"):
            out.pop(k, None)
        out["inputs"] = {k: v for k, v in (card.get("inputs") or {}).items() if k not in ("value", "pool_rate", "raci")}
        out["inputs"]["value"] = {k: v for k, v in (card.get("inputs", {}).get("value") or {}).items() if k in ("confirmed",)}
        if out.get("gates"):  # the Finance gate cites the confirmed amount
            out["gates"] = [{**g, "source": "Confirmed by Finance" if g["ok"] else "Not confirmed"} if g["key"] == "finance" else g for g in out["gates"]]
    else:
        out["inputs"] = card.get("inputs")
    people = []
    for p in card.get("people", []):
        emp_id = p.get("person", {}).get("id") if p.get("person") else None
        visible = p["letter"] == "I" or (emp_id is not None and ctx.scope.can_see_perf(emp_id))
        row = {"key": p["key"], "person": p.get("person"), "label": p.get("label"), "letter": p["letter"], "note": p.get("note"), "visible": visible}
        if visible:
            row.update({k: p.get(k) for k in ("adjustment", "tagged", "individual", "band")})
            if money:
                row.update({k: p.get(k) for k in ("units", "payout_pct", "share", "payout")})
        else:
            row["hidden_reason"] = "Team Leads don't see individual scores" if ctx.account.role == "team_lead" else "Not in your reporting tree"
        people.append(row)
    out["people"] = people
    return out


# --- views --------------------------------------------------------------------------------------------------------------


def charter_dict(db: Session, project: Project, charter: ProjectCharter) -> dict:
    return {
        "id": charter.id,
        "mode": charter.mode,
        "project_type": charter.project_type,
        "sponsor": charter.sponsor,
        "champion": person_by_id(db, charter.champion_id),
        "champion_note": charter.champion_note,
        "value_kind": charter.value_kind,
        "value_target": charter.value_target,
        "value_target_text": charter.value_target_text,
        "pool_rate": charter.pool_rate if charter.pool_rate is not None else POOL_RATES.get(charter.project_type, 0.02),
        "state": charter.state,
        "submitted": charter.state in ("Submitted", "Locked"),
        "sponsor_ok": bool(charter.sponsor_ok_by),
        "pmo_ok": bool(charter.pmo_ok_by),
        "locked_on": charter.locked_on,
        "lock_checks": charter.lock_checks or {},
        "doc_reading": charter.doc_reading,
        "illustrative": charter.illustrative,
        "history": charter.history or [],
    }


def raci_dict(db: Session, r: ProjectRaci) -> dict:
    return {"id": r.id, "person": person_by_id(db, r.employee_id), "label": r.label, "letter": r.letter, "factor": r.factor, "factor_confirmed": r.factor_confirmed, "response_days": r.response_days, "adjustment": r.adjustment, "note": r.note}


def recognition_row(ctx, project: Project, charter: ProjectCharter) -> dict:
    db = ctx.db
    card = compute(db, project, charter)
    delays = list(db.scalars(select(ProjectDelay).where(ProjectDelay.project_id == project.id)))
    ctrl = sum(1 for d in delays if ps.controllable(d.reason_code))
    if charter.frozen:
        tasks_label, delays_label = card.get("tasks_label") or "—", card.get("delays_label") or f"{ctrl} · {len(delays) - ctrl} excused"
    elif charter.mode == "programme":
        sc = stage_task_counts(runs_for(db, project))
        tasks_label, delays_label = f"{sc['on_time']} of {sc['done']}", f"{ctrl} · {len(delays) - ctrl} excused"
    else:
        tl = task_timelines(db, project.id)
        unlogged = len([t for t in tl["late"] if t.id not in {d.task_id for d in delays}])
        tasks_label = f"{card['inputs']['timelines']['on_time'] if card.get('inputs') else tl['on_time']} of {tl['due']}"
        delays_label = f"{ctrl} · {len(delays) - ctrl} excused" + (f" · {unlogged} to log" if unlogged else "")
    gates = card.get("gates") or []
    # Provisional scores (closure projects still in delivery) aren't shown as scored; frozen ones always are.
    scored = card.get("score") is not None and (card.get("state") == "Scored" or bool(charter.frozen))
    return {
        "project": {"id": project.id, "code": project.code, "title": project.title, "department": project.department.name if project.department else None, "status": project.status},
        "mode": charter.mode,
        "project_type": charter.project_type,
        "champion": person_by_id(db, charter.champion_id),
        "champion_note": charter.champion_note,
        "tasks_on_time": tasks_label,
        "delays": delays_label,
        "gates": f"{sum(g['ok'] for g in gates)}/{len(gates)}" if gates else ("No locked baseline" if charter.state != "Locked" else card.get("gates_label") or ("Scored at closure" if charter.mode == "closure" and project.status != "Completed" else "Inputs pending")),
        "score": card.get("score") if scored else None,
        "band": card.get("band") if scored else None,
        "stage": card["stage"],
        "pool": card.get("pool") if sees_money(ctx) and scored else None,
        "illustrative": charter.illustrative,
    }


def queue(ctx) -> list[dict]:
    """What each function holder, sponsor, champion and manager has to act on, within the viewer's project scope."""
    db, items = ctx.db, []
    ids = ctx.scope.visible_project_ids
    charters = [c for c in db.scalars(select(ProjectCharter)) if ids is None or c.project_id in ids]
    projects = {c.project_id: db.get(Project, c.project_id) for c in charters}
    pmo = has_fn(ctx, "PMO validator")
    for c in charters:
        p = projects[c.project_id]
        link = f"/projects/{p.id}?tab="
        if pmo:
            pending = [d for d in db.scalars(select(ProjectDelay).where(ProjectDelay.project_id == p.id, ProjectDelay.state.in_(("Logged", "Challenged")))) if d.logged_by != ctx.account.id]
            if pending:
                items.append({"count": len(pending), "title": "Delays to validate", "context": f"PMO validator · {p.code} {p.title}", "link": link + "delays", "tone": "warn", "tag": "PMO"})
            if c.state == "Submitted" and not c.pmo_ok_by and c.champion_id != ctx.me:
                items.append({"count": 1, "title": "Charter to lock", "context": f"PMO · {p.code} {p.title}", "link": link + "charter", "tone": "info", "tag": "PMO"})
        if c.state == "Submitted" and not c.sponsor_ok_by and c.champion_id != ctx.me and (ctx.scope.is_admin or p.department_id in ctx.scope.headed_departments):
            items.append({"count": 1, "title": "Charter to approve as sponsor", "context": f"{c.sponsor or 'Sponsor'} · {p.code} {p.title}", "link": link + "charter", "tone": "info", "tag": "Sponsor"})
        stage = c.stage if c.frozen else None
        if not c.frozen and c.state == "Locked":
            card = compute(db, p, c)
            stage = card["stage"]
            if c.mode == "closure" and ctx.scope.can_manage_project(p):
                logged = {d.task_id for d in db.scalars(select(ProjectDelay).where(ProjectDelay.project_id == p.id))}
                unlogged = [t for t in task_timelines(db, p.id)["late"] if t.id not in logged]
                if unlogged:
                    items.append({"count": len(unlogged), "title": "Late tasks to log as delays", "context": f"Champion · {p.code} {p.title} · within 2 working days", "link": link + "delays", "tone": "warn", "tag": "Open"})
        if stage == "Inputs validated" and has_fn(ctx, "HR calibrator") and not in_raci(db, p.id, ctx.me):
            items.append({"count": 1, "title": "Scorecard to calibrate", "context": f"HR calibrator · {p.code} {p.title}", "link": link + "scorecard", "tone": "info", "tag": "HR"})
        panel = has_fn(ctx, "R&R Panel member") and not in_raci(db, p.id, ctx.me)
        if stage == "HR calibrated" and panel:
            items.append({"count": 1, "title": "Scorecard to approve", "context": f"R&R Panel · {p.code} {p.title}", "link": link + "scorecard", "tone": "info", "tag": "Panel"})
        if stage == "Panel approved" and panel:
            items.append({"count": 1, "title": "Scorecard ready to publish", "context": f"R&R Panel · {p.code} {p.title}", "link": link + "scorecard", "tone": "info", "tag": "Panel"})
        if c.state != "Locked" and c.mode == "programme":
            unconfirmed = [r for r in raci_rows(db, p.id) if r.letter == "R" and not r.factor_confirmed and r.employee_id in (ctx.scope.reporting_tree | {ctx.me})]
            if unconfirmed:
                items.append({"count": len(unconfirmed), "title": "Contribution factors to confirm", "context": f"Your people on {p.code} (set at kickoff)", "link": link + "charter", "tone": "outline", "tag": "Open"})
        if c.state != "Locked" and c.mode == "closure" and ctx.account.role == "manager":
            unconfirmed = [r for r in raci_rows(db, p.id) if r.letter == "R" and not r.factor_confirmed and r.employee_id in ctx.scope.reporting_tree]
            if unconfirmed:
                items.append({"count": len(unconfirmed), "title": "Contribution factors to confirm", "context": f"Your people on {p.code} (set at kickoff)", "link": link + "charter", "tone": "outline", "tag": "Open"})
    pending_inputs = [i for i in db.scalars(select(ProjectRrInput).where(ProjectRrInput.state == "Submitted")) if (ids is None or i.project_id in ids) and i.author_account_id != ctx.account.id and has_fn(ctx, INPUT_KINDS.get(i.kind, ("", ""))[1])]
    if pending_inputs:
        fns = sorted({INPUT_KINDS[i.kind][1] for i in pending_inputs})
        items.append({"count": len(pending_inputs), "title": "Inputs to validate", "context": " · ".join(fns), "link": "/admin/workflows?tab=inputs", "tone": "outline", "tag": "Open"})
    if ctx.scope.is_admin and not any("Finance confirmer" in (a.functions or []) for a in db.scalars(select(Account).where(Account.active.is_(True)))):
        items.append({"count": 1, "title": "No Finance confirmer tagged", "context": "Value confirmations wait · Administration → People & access", "link": "/admin?tab=accounts", "tone": "bad", "tag": "Setup"})
    return items


def policy(db: Session) -> RrPolicy:
    pol = db.scalar(select(RrPolicy).where(RrPolicy.code == ps.POLICY_CODE))
    if pol is None:
        pol = RrPolicy(code=ps.POLICY_CODE, state="Proposed")
        db.add(pol)
        db.flush()
    return pol


def policy_dict(db: Session, pol: RrPolicy) -> dict:
    return {
        "code": pol.code,
        "state": pol.state,
        "authored_by": account_person(db, pol.authored_by),
        "authored_by_account_id": pol.authored_by,
        "authored_on": pol.authored_on,
        "approved_by": account_person(db, pol.approved_by),
        "approved_at": pol.approved_at,
        "slabs": [{"parameter": a, "slabs": b} for a, b in SLABS],
        "caps": [{"label": a, "value": b} for a, b in CAPS],
        "reasons": ps.DELAY_REASONS,
        "open_decisions": [{"code": a, "decision": b, "default": c} for a, b, c in OPEN_DECISIONS],
        "functions": list(RR_FUNCTIONS),
    }


def employee_ids_named(db: Session, ids: list[int]) -> list[int]:
    return [e for e in ids if db.get(Employee, e)]
