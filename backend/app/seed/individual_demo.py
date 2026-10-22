"""Individual Tier demo data: realistic, clearly labelled and removable.

What it creates (fixed random seed, so every run gives the same data):
- Jul and Aug 2026: demo months with the same KPI targets as September, fully marked, approved and **closed**; July recognition published.
- Sep 2026 (the imported tracker month): demo achieved values and done dates on rows that are still blank, ratings, training,
  and a realistic spread of check-in states (most approved, some submitted, one returned, a few in draft).
- The current month: in progress, values paced to the days elapsed, a few draft check-ins.

Every value written here is marked `illustrative=True` (rows, modules, evaluations, months). Real tracker values
(non-zero achieved values, rows a person has edited) and existing check-ins are never overwritten.
`clear_individual_demo` removes all of it again. Audit events stay (they are append-only) and are labelled "Demo data".
"""

from __future__ import annotations

import random
from datetime import date, timedelta

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.clock import now_ist, today_ist
from app.models import Account, KpiItem, KpiMonth, MonthlyEvaluation, MonthlyNomination, ScorecardSnapshot, TrainingCatalogItem, TrainingModule
from app.seed.sales import ensure_rule, month_end, pilot_department, training_cutoff
from app.services import individual as ind
from app.services.audit import record

SEED = 2026
DEMO_NOTE = "Demo data"

# Performance profiles keep each person believable from month to month.
PROFILES = {
    #             achievement % mean, on-time chance, rating range, TWCS lateness weights (on time, 1-7, 8-14, 15+, not done)
    "strong": {"ach": 112, "on_time": 0.95, "ratings": (4, 5), "late": (0.85, 0.10, 0.03, 0.01, 0.01)},
    "steady": {"ach": 96, "on_time": 0.86, "ratings": (3, 4), "late": (0.65, 0.20, 0.08, 0.04, 0.03)},
    "improving": {"ach": 78, "on_time": 0.74, "ratings": (3, 4), "late": (0.45, 0.25, 0.12, 0.08, 0.10), "trend": 9},
    "struggling": {"ach": 64, "on_time": 0.58, "ratings": (2, 3), "late": (0.30, 0.20, 0.15, 0.10, 0.25)},
}
PROFILE_WEIGHTS = (("strong", 25), ("steady", 40), ("improving", 20), ("struggling", 15))

MODULES = [
    ("SEBI KYC and AML refresher", "Compliance"),
    ("Investor grievance handling", "Compliance"),
    ("Shoonya app: order types and margins", "Functional"),
    ("F&O basics for client calls", "Functional"),
    ("Account opening journey and e-sign", "Functional"),
    ("CRM lead workflow", "Technical"),
    ("Back-office tools: fund transfer checks", "Technical"),
    ("Objection handling on calls", "Behavioural"),
    ("Consultative selling", "Behavioural"),
    ("Coaching your team", "Leadership"),
]
DELAY_REASONS = [
    "Lead list arrived late from marketing",
    "CRM was down for two days",
    "Client documents pending verification",
    "Covered for a colleague on leave",
    "Back-office approval took longer than expected",
    "Festival week: low client availability",
]
RETURN_REASONS = ["Quality rating looks high for the delays recorded; please recheck.", "Two KPIs have no done date; complete them before submitting."]


def _rng(*parts) -> random.Random:
    return random.Random("|".join(str(p) for p in (SEED, *parts)))


def _profile(code: str) -> str:
    r = _rng("profile", code)
    names, weights = zip(*PROFILE_WEIGHTS)
    return r.choices(names, weights=weights)[0]


def _round_value(v: float, unit: str | None) -> float:
    if unit == "rupees":
        return float(round(v / 10_000) * 10_000)
    return float(max(0, round(v)))


def _accounts(db: Session, pilot: ind.Pilot) -> dict[str, Account]:
    """The pilot's own approvers: the Sales HOD's account and a real (non-demo) Admin. Never another department's HOD."""
    hod = next((pilot.accounts_by_emp[h.id] for h in pilot.heads if h.id in pilot.accounts_by_emp and pilot.accounts_by_emp[h.id].role == "hod"), None)
    admin = db.scalar(select(Account).where(Account.role == "admin", Account.active.is_(True), Account.email.not_like("%.example")).order_by(Account.id)) or db.scalar(
        select(Account).where(Account.role == "admin", Account.active.is_(True)).order_by(Account.id))
    return {"hod": hod, "platform_admin": admin}


def has_demo(db: Session) -> bool:
    return db.scalar(select(KpiMonth.id).where(KpiMonth.illustrative.is_(True))) is not None or db.scalar(
        select(MonthlyEvaluation.id).where(MonthlyEvaluation.illustrative.is_(True))
    ) is not None


def _copy_month(db: Session, src: KpiMonth, m: date, rule, dept) -> KpiMonth:
    """A demo month with the same KPIs and targets as `src` (used to build Jul and Aug from September)."""
    km = db.scalar(select(KpiMonth).where(KpiMonth.month == m))
    if km is None:
        km = KpiMonth(month=m, department_id=dept.id, rule_id=rule.id, training_cutoff=training_cutoff(m, rule.config), state="Open",
                      carried_over_at=now_ist(), illustrative=True)
        db.add(km)
        db.flush()
    for r in db.scalars(select(KpiItem).where(KpiItem.month_id == src.id, KpiItem.removed_at.is_(None)).order_by(KpiItem.id)):
        db.add(KpiItem(
            month_id=km.id, employee_id=r.employee_id, kind=r.kind, kpi_type_id=r.kpi_type_id, is_team=r.is_team, title=r.title, priority=r.priority,
            start_date=m, target_value=r.target_value, target_text=r.target_text if r.target_value is None else None, per_day=r.per_day,
            achieved_value=0.0 if r.kind == "kpi" and not r.is_team else None, source=DEMO_NOTE, flags=[], illustrative=True,
        ))
    db.flush()
    return km


def _fill_month(db: Session, pilot: ind.Pilot, km: KpiMonth, accts: dict, *, progress: float, states: dict[int, str]) -> None:
    """Write demo marks into one month. `progress` is the share of the month elapsed (1.0 for a finished month)."""
    start, end = km.month, month_end(km.month)
    today = today_ist()
    hod = accts.get("hod")
    month_index = (km.month.year * 12 + km.month.month) - (2026 * 12 + 7)  # 0 = Jul 2026
    items = list(db.scalars(select(KpiItem).where(KpiItem.month_id == km.id, KpiItem.removed_at.is_(None))))
    by_emp: dict[int, list[KpiItem]] = {}
    for it in items:
        by_emp.setdefault(it.employee_id, []).append(it)

    for emp in pilot.people:
        prof = PROFILES[_profile(emp.code)]
        r = _rng("month", emp.code, km.month)
        ach_mean = prof["ach"] + prof.get("trend", 0) * month_index
        evaluator = pilot.evaluator(emp)

        # KPI values and outcomes (only rows nobody has touched; real tracker values stay).
        for it in by_emp.get(emp.id, []):
            untouched = it.updated_by is None and not it.outcome and not it.completed_date
            if not untouched:
                continue
            wrote = False
            if it.kind == "kpi" and not it.is_team and it.target_value and not it.achieved_value:
                pct = max(30.0, min(165.0, r.gauss(ach_mean, 13)))
                it.achieved_value = _round_value(it.target_value * pct / 100 * progress, it.kpi_type.unit if it.kpi_type else None)
                wrote = True
            due = it.due_date or end
            # Only duty tasks get an outcome: KPI rows are judged by achieved ÷ target, not timing.
            if it.kind == "duty" and (progress >= 1.0 or r.random() < progress * 0.6):
                if r.random() < prof["on_time"]:
                    done = min(due, today, start + timedelta(days=int((end - start).days * r.uniform(0.6, 1.0))))
                    if done >= start:
                        it.outcome, it.completed_date = "Completed", done
                        wrote = True
                elif progress >= 1.0:
                    if r.random() < 0.7:
                        late = due + timedelta(days=r.randint(1, 6))
                        if late <= today:
                            it.outcome, it.completed_date = "Completed", late
                    else:
                        it.outcome = "Not completed"
                    if it.outcome and r.random() < 0.75:
                        it.delay_reason = r.choice(DELAY_REASONS)
                        it.delay_reason_by = evaluator.id if evaluator else None
                        if states.get(emp.id) == "Approved" and r.random() < 0.4 and hod:
                            it.delay_validated, it.delay_validated_by = True, hod.id
                    wrote = True
            if wrote:
                it.illustrative = True

        # Training modules for the month.
        n_mod = r.randint(3, 5)
        for title, track in r.sample(MODULES[:-1] if (emp.proposed_role or "") not in ("Manager", "Team Lead") else MODULES, n_mod):
            due = start + timedelta(days=r.randint(4, (end - start).days - 2))
            bucket = r.choices(range(5), weights=prof["late"])[0]
            offset = [r.randint(-6, 0), r.randint(1, 7), r.randint(8, 14), r.randint(15, 25), None][bucket]
            done = due + timedelta(days=offset) if offset is not None else None
            if done is not None and (done > today or done > km.training_cutoff):
                done = None
            if done is not None and progress < 1.0 and due > today:
                done = None
            approved = states.get(emp.id) == "Approved"
            approver = (accts.get("platform_admin") if evaluator and evaluator.role == "hod" else hod)
            db.add(TrainingModule(
                employee_id=emp.id, title=title, track=track, assigned_date=start, due_date=due, completed_date=done,
                status="Completed" if done else "Assigned", recorded_by=evaluator.id if (done and evaluator) else None,
                verified_by=approver.id if (done and approved and approver) else None, verified_at=now_ist() if (done and approved) else None,
                created_by=evaluator.id if evaluator else None, illustrative=True, note=DEMO_NOTE,
            ))

        # The check-in.
        state = states.get(emp.id)
        if state is None or db.scalar(select(MonthlyEvaluation.id).where(MonthlyEvaluation.month_id == km.id, MonthlyEvaluation.employee_id == emp.id)):
            continue
        lo, hi = prof["ratings"]
        lift = 1 if prof.get("trend") and month_index >= 2 else 0
        ev = MonthlyEvaluation(
            month_id=km.id, employee_id=emp.id, illustrative=True, version=1,
            quality_rating=min(5, r.randint(lo, hi) + lift), csat_rating=min(5, r.randint(lo, hi) + lift),
            comments=None, state="Draft", updated_by=evaluator.id if evaluator else None,
        )
        if state == "Draft" and progress < 1.0 and r.random() < 0.5:
            ev.csat_rating = None  # half-finished
        db.add(ev)
        db.flush()
        if state in ("Submitted", "Approved", "Returned") and evaluator:
            ev.state, ev.submitted_by, ev.submitted_at = "Submitted", evaluator.id, now_ist()
            record(db, evaluator.id, "submit_evaluation", "monthly_evaluation", ev.id, f"{emp.full_name} {ind.month_label(km.month)}", reason=DEMO_NOTE)
        if state in ("Approved", "Returned"):
            approver = accts.get("platform_admin") if evaluator and evaluator.role == "hod" else hod
            ev.state = state
            ev.decided_by, ev.decided_at = (approver.id if approver else None), now_ist()
            ev.decision_note = r.choice(RETURN_REASONS) if state == "Returned" else None
            record(db, approver.id if approver else None, f"{'approve' if state == 'Approved' else 'return'}_evaluation", "monthly_evaluation", ev.id,
                   f"{emp.full_name} {ind.month_label(km.month)}", reason=DEMO_NOTE)
    db.flush()


CITATIONS = {
    "Top performer": ("{name} finished the month as one of the strongest performers in Sales, beating the call and account targets while keeping "
                      "every check-in and duty task on time. Clients they spoke to converted at a better rate than the team average, and "
                      "they shared their call scripts with two newer colleagues who improved within the same month. Consistent, reliable work."),
    "Collaboration award": ("{name} covered a colleague's client list for a full week during leave without letting their own numbers drop, kept "
                            "the shared tracker up to date every evening and walked two new joiners through the account opening journey and "
                            "e-sign steps. The team finished the month on time largely because of this support, and the Manager noticed it."),
    "Customer impact award": ("{name} resolved a long-pending funds transfer complaint for a high-value client by coordinating with back office "
                              "and following up daily until the money was credited. The client later added fresh funds and referred two "
                              "family members who opened accounts. Patient, careful and clear communication that protected the relationship."),
}


def _demo_nominations(db: Session, pilot: ind.Pilot, accts: dict) -> None:
    """Two approved nominations for July (published) and one waiting for a decision in August."""
    jul = db.scalar(select(KpiMonth).where(KpiMonth.month == date(2026, 7, 1)))
    aug = db.scalar(select(KpiMonth).where(KpiMonth.month == date(2026, 8, 1)))
    snaps = sorted((s for s in db.scalars(select(ScorecardSnapshot).where(ScorecardSnapshot.month_id == jul.id)) if s.final is not None), key=lambda s: -s.final)
    by_emp = pilot.by_id()
    picks = [(jul, snaps[0].employee_id, "Top performer", "Approved"), (jul, snaps[3].employee_id, "Collaboration award", "Approved")]
    aug_snaps = sorted((s for s in db.scalars(select(ScorecardSnapshot).where(ScorecardSnapshot.month_id == aug.id)) if s.final is not None), key=lambda s: -s.final)
    if aug_snaps:
        picks.append((aug, aug_snaps[1].employee_id, "Customer impact award", "Submitted"))
    for km, emp_id, award, state in picks:
        emp = by_emp[emp_id]
        nominator = pilot.evaluator(emp)
        if nominator is None:
            continue
        approver = accts["platform_admin"] if nominator.role == "hod" else accts["hod"]
        n = MonthlyNomination(month_id=km.id, employee_id=emp_id, award=award, citation=CITATIONS[award].format(name=emp.full_name.split()[0]),
                              evidence="Monthly tracker and check-in notes", nominated_by=nominator.id, state=state, illustrative=True)
        if state == "Approved":
            n.decided_by, n.decided_at = approver.id, now_ist()
        db.add(n)
    db.flush()


def _states_for(pilot: ind.Pilot, km: KpiMonth, kind: str) -> dict[int, str]:
    """Check-in state per person: all approved (closed months), a realistic mix (last month), drafts (current month)."""
    out = {}
    for i, emp in enumerate(sorted(pilot.people, key=lambda e: e.code)):
        if kind == "closed":
            out[emp.id] = "Approved"
        elif kind == "finishing":
            roll = _rng("state", emp.code, km.month).random()
            out[emp.id] = "Approved" if roll < 0.70 else "Submitted" if roll < 0.86 else "Draft" if roll < 0.975 else "Returned"
        else:
            out[emp.id] = "Draft" if _rng("state", emp.code, km.month).random() < 0.35 else None
    return out


def seed_individual_demo(db: Session) -> dict:
    """Add the demo layer. Safe to call on a database with real marks: it only fills blanks and skips existing check-ins."""
    dept = pilot_department(db)
    pilot = ind.load_pilot(db)
    if dept is None or pilot is None or has_demo(db):
        return {"skipped": "already present or no Sales pilot"}
    rule = ensure_rule(db)
    accts = _accounts(db, pilot)
    months = list(db.scalars(select(KpiMonth).order_by(KpiMonth.month)))
    sep = next((m for m in months if m.month == date(2026, 9, 1)), None)
    if sep is None:
        return {"skipped": "Sep 2026 (the imported tracker month) is missing"}
    out = {"months": []}

    for title, track in MODULES:
        if not db.scalar(select(TrainingCatalogItem.id).where(TrainingCatalogItem.title == title)):
            db.add(TrainingCatalogItem(title=title, track=track, illustrative=True))

    # Jul and Aug: closed months built from September's targets.
    for m in (date(2026, 7, 1), date(2026, 8, 1)):
        km = _copy_month(db, sep, m, rule, dept)
        _fill_month(db, pilot, km, accts, progress=1.0, states=_states_for(pilot, km, "closed"))
        ind.snapshot_month(pilot, km, accts["hod"], None)
        km.state, km.locked_by, km.locked_at, km.lock_note = "Locked", accts["hod"].id, now_ist(), f"{DEMO_NOTE}: monthly close"
        record(db, accts["hod"].id, "lock_month", "kpi_month", km.id, ind.month_label(m), reason=DEMO_NOTE)
        out["months"].append(f"{ind.month_label(m)} (closed)")
    jul = db.scalar(select(KpiMonth).where(KpiMonth.month == date(2026, 7, 1)))
    _demo_nominations(db, pilot, accts)
    jul.published_by, jul.published_at = accts["hod"].id, now_ist()
    record(db, accts["hod"].id, "publish_recognition", "kpi_month", jul.id, "Jul 2026", reason=DEMO_NOTE)

    # Open months: last finished month nearly done, the current month in progress.
    today = today_ist()
    for km in (m for m in months if m.state == "Open" and m.month >= sep.month):
        end = month_end(km.month)
        if end < today:
            _fill_month(db, pilot, km, accts, progress=1.0, states=_states_for(pilot, km, "finishing"))
            out["months"].append(f"{ind.month_label(km.month)} (open, nearly finished)")
        elif km.month <= today:
            progress = (today - km.month).days / max(1, (end - km.month).days)
            _fill_month(db, pilot, km, accts, progress=max(0.1, progress), states=_states_for(pilot, km, "current"))
            out["months"].append(f"{ind.month_label(km.month)} (in progress)")
    record(db, accts.get("platform_admin").id if accts.get("platform_admin") else None, "seed_demo_data", "kpi_month", None, "Individual Tier demo data", new=out, reason=DEMO_NOTE)
    db.flush()
    return out


def clear_individual_demo(db: Session) -> dict:
    """Remove every demo value. Real tracker values, real check-ins and the audit log stay."""
    demo_months = [m.id for m in db.scalars(select(KpiMonth).where(KpiMonth.illustrative.is_(True)))]
    counts = {"months": len(demo_months)}
    counts["snapshots"] = db.execute(delete(ScorecardSnapshot).where(ScorecardSnapshot.month_id.in_(demo_months))).rowcount if demo_months else 0
    counts["checkins"] = db.execute(delete(MonthlyEvaluation).where(MonthlyEvaluation.illustrative.is_(True))).rowcount
    counts["modules"] = db.execute(delete(TrainingModule).where(TrainingModule.illustrative.is_(True))).rowcount
    counts["catalog"] = db.execute(delete(TrainingCatalogItem).where(TrainingCatalogItem.illustrative.is_(True))).rowcount
    counts["nominations"] = db.execute(delete(MonthlyNomination).where(MonthlyNomination.illustrative.is_(True))).rowcount
    if demo_months:
        db.execute(delete(KpiItem).where(KpiItem.month_id.in_(demo_months)))
        db.execute(delete(KpiMonth).where(KpiMonth.id.in_(demo_months)))
    reset = 0
    for it in db.scalars(select(KpiItem).where(KpiItem.illustrative.is_(True))):
        it.achieved_value = 0.0 if it.kind == "kpi" and not it.is_team else None
        it.outcome = it.completed_date = it.delay_reason = it.delay_reason_by = it.delay_validated_by = None
        it.delay_validated = False
        it.illustrative = False
        reset += 1
    counts["rows_reset"] = reset
    record(db, None, "clear_demo_data", "kpi_month", None, "Individual Tier demo data", new=counts, reason=DEMO_NOTE)
    db.flush()
    return counts


def demo_was_cleared(db: Session) -> bool:
    from app.models import AuditEvent

    return db.scalar(select(AuditEvent.id).where(AuditEvent.action == "clear_demo_data")) is not None


def main() -> None:
    """python -m app.seed.individual_demo add | clear"""
    import sys

    import app.models  # noqa: F401
    from app.core.database import SessionLocal

    action = sys.argv[1] if len(sys.argv) > 1 else "add"
    with SessionLocal() as db:
        out = clear_individual_demo(db) if action == "clear" else seed_individual_demo(db)
        db.commit()
    print(action, out)


if __name__ == "__main__":
    main()
