"""Builds a person's period evaluation from records, then scores it with the pure engine.

Locked periods return the stored snapshot; they are never recalculated.
"""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    Assignment,
    Blocker,
    CheckIn,
    Employee,
    Incident,
    MetricInput,
    Override,
    Period,
    ReviewDecision,
    RuleVersion,
    Snapshot,
    Task,
    TrainingAssignment,
)
from app.models.task import BLOCKER_CATEGORIES
from app.services import scoring
from app.services.common import person, today


def category_for(emp: Employee) -> tuple[str, bool]:
    dept = emp.department
    if not dept:
        return "Support", True
    return dept.category, dept.category_proposed


def latest_input(db: Session, emp_id: int, period_id: int, metric: str, validated_only: bool = True) -> MetricInput | None:
    q = select(MetricInput).where(MetricInput.employee_id == emp_id, MetricInput.period_id == period_id, MetricInput.metric == metric)
    if validated_only:
        q = q.where(MetricInput.state == "Validated")
    return db.scalar(q.order_by(MetricInput.created_at.desc()))


def latest_checkin(db: Session, emp_id: int, period_id: int) -> CheckIn | None:
    return db.scalar(
        select(CheckIn)
        .where(CheckIn.employee_id == emp_id, CheckIn.period_id == period_id, CheckIn.state == "Finalized")
        .order_by(CheckIn.month.desc(), CheckIn.updated_at.desc())
    )


def on_time_inputs(db: Session, emp_id: int, start: date, end: date) -> dict:
    rows = db.execute(
        select(Task).join(Assignment).where(
            Assignment.employee_id == emp_id,
            Task.status == "Completed",
            Task.due_date.is_not(None),
            Task.accepted_submission_date.is_not(None),
            Task.accepted_submission_date >= start,
            Task.accepted_submission_date <= end,
        )
    ).scalars()
    eligible = on_time = excluded = 0
    tasks = []
    for t in rows:
        late = t.accepted_submission_date > t.due_date
        protected = late and db.scalar(
            select(Blocker.id).where(
                Blocker.task_id == t.id,
                Blocker.state == "Validated",
                Blocker.category.in_([c for c, ok in BLOCKER_CATEGORIES.items() if ok]),
            )
        )
        if protected:
            excluded += 1
            tasks.append({"code": t.code, "title": t.title, "treatment": "Excluded: validated excludable blocker"})
            continue
        eligible += 1
        on_time += 0 if late else 1
        tasks.append({"code": t.code, "title": t.title, "treatment": "Late" if late else "On time"})
    return {"eligible": eligible, "on_time": on_time, "excluded": excluded, "tasks": tasks}


def quality_inputs(db: Session, emp_id: int, start: date, end: date) -> dict:
    task_ids = set(db.scalars(select(Assignment.task_id).where(Assignment.employee_id == emp_id)))
    if not task_ids:
        return {"reviewed": 0, "rework_tasks": 0, "rework_pct": None}
    decisions = db.scalars(
        select(ReviewDecision).where(
            ReviewDecision.task_id.in_(task_ids),
            ReviewDecision.source == "app",  # legacy migrated acceptances carry no review evidence
            ReviewDecision.decided_at >= datetime.combine(start, datetime.min.time()),
            ReviewDecision.decided_at <= datetime.combine(end, datetime.max.time()),
        )
    ).all()
    reviewed = {d.task_id for d in decisions}
    rework = {d.task_id for d in decisions if d.decision == "rework" and not d.requirement_changed}
    pct = (len(rework) / len(reviewed) * 100) if reviewed else None
    return {"reviewed": len(reviewed), "rework_tasks": len(rework), "rework_pct": pct}


def attributable_incidents(db: Session, emp_id: int, start: date, end: date) -> list[Incident]:
    return list(
        db.scalars(
            select(Incident).where(
                Incident.attributed_employee_id == emp_id,
                Incident.attribution_state == "validated",
                Incident.severity_validated.is_not(None),
                Incident.incident_date >= start,
                Incident.incident_date <= end,
            )
        )
    )


def training_items(db: Session, emp_id: int) -> list[tuple[TrainingAssignment, scoring.TrainingItem]]:
    out = []
    for a in db.scalars(select(TrainingAssignment).where(TrainingAssignment.employee_id == emp_id).order_by(TrainingAssignment.due_date)):
        out.append(
            (
                a,
                scoring.TrainingItem(
                    due_date=a.due_date,
                    status=a.status,
                    verified_on=a.verified_at.date() if a.verified_at else None,
                    code=a.code,
                    title=a.course.title if a.course else "",
                ),
            )
        )
    return out


def training_summary(db: Session, emp_id: int, period: Period) -> dict:
    items = training_items(db, emp_id)
    confirmed = latest_input(db, emp_id, period.id, "training_none") is not None
    summary = scoring.training_completion(
        [i for _, i in items], period.start_date, period.end_date, period.evidence_cutoff.date(), today(), confirmed
    )
    return summary


def evaluate(db: Session, emp: Employee, period: Period) -> dict:
    if period.state == "Locked":
        snap = db.scalar(select(Snapshot).where(Snapshot.period_id == period.id, Snapshot.employee_id == emp.id))
        if snap:
            return {**snap.data, "locked": True, "snapshot_id": snap.id}

    kpi_rule = db.get(RuleVersion, period.kpi_rule_id)
    cfg = kpi_rule.config
    training_rule = db.get(RuleVersion, period.training_rule_id) if period.training_rule_id else None
    reward_rule = db.scalar(select(RuleVersion).where(RuleVersion.kind == "reward").order_by(RuleVersion.id.desc()))
    reward_cfg = reward_rule.config if reward_rule else scoring.DEFAULT_REWARD_POLICY

    category, category_proposed = category_for(emp)
    weights = cfg["weights"].get(category, cfg["weights"]["Support"])
    start, end = period.start_date, period.end_date

    ot = on_time_inputs(db, emp.id, start, end)
    q = quality_inputs(db, emp.id, start, end)
    checkin = latest_checkin(db, emp.id, period.id)
    ach = latest_input(db, emp.id, period.id, "achievement")
    comp = latest_input(db, emp.id, period.id, "compliance")
    csat = latest_input(db, emp.id, period.id, "csat")
    incidents = attributable_incidents(db, emp.id, start, end)

    results = {
        "on_time": scoring.score_on_time(ot["eligible"], ot["on_time"], cfg),
        "achievement": scoring.score_achievement(ach.values.get("target") if ach else None, ach.values.get("actual") if ach else None, cfg),
        "compliance": scoring.score_compliance(bool(comp and comp.values.get("attested")), [i.severity_validated for i in incidents], cfg),
        "csat": scoring.score_csat(csat.values.get("average") if csat else None, int(csat.values.get("responses", 0)) if csat else 0, cfg),
        "quality": scoring.score_quality(q["rework_pct"], q["reviewed"], checkin.quality_rating if checkin else None, cfg),
        "collaboration": scoring.score_rating("collaboration", checkin.collaboration_rating if checkin else None, checkin.collaboration_evidence if checkin else None),
        "innovation": scoring.score_rating("innovation", checkin.innovation_rating if checkin else None, checkin.innovation_evidence if checkin else None),
        "productivity": scoring.unavailable("productivity", "Unweighted tie-breaker; benchmark cohort not configured."),
    }
    results["on_time"].detail["tasks"] = ot["tasks"]

    overrides = list(db.scalars(select(Override).where(Override.period_id == period.id, Override.employee_id == emp.id).order_by(Override.created_at)))
    original_base = scoring.base_kpi(results, weights, cfg["minimums"]["coverage"])
    applied = []
    for o in overrides:
        r = results.get(o.metric)
        if r is not None:
            applied.append({"metric": o.metric, "original": o.original_score, "new": o.new_score, "reason": o.reason, "at": o.created_at.isoformat()})
            results[o.metric] = scoring.MetricResult(o.metric, True, o.new_score, r.raw, f"{r.raw_display} (HOD override)", "HOD override", r.detail)
    base = scoring.base_kpi(results, weights, cfg["minimums"]["coverage"])

    training = training_summary(db, emp.id, period)
    policy = training_rule.config if training_rule else None
    final = scoring.final_rr(base, training, policy)
    original_final = scoring.final_rr(original_base, training, policy) if applied else None
    tier = scoring.tier_for(final["value"], reward_cfg)

    days_in_role = (end - emp.role_start_date).days if emp.role_start_date else None
    major = any(i.severity_validated == "Major" for i in incidents)
    gates = scoring.reward_gates(base["coverage"], major, days_in_role, emp.disciplinary_flag, reward_cfg)

    readiness = []
    for row in base["rows"]:
        if not row["available"]:
            readiness.append(f"{row['label']}: {row['reason']}")
    if training["status"] == "readiness_exception":
        readiness.append("Training: no eligible assignments recorded and no confirmed 'none due'. Missing records are not assumed 0%.")
    if checkin is None:
        readiness.append("No finalized monthly check-in in this period.")

    return {
        "employee": person(emp),
        "period": {"id": period.id, "name": period.name, "state": period.state, "start": start.isoformat(), "end": end.isoformat()},
        "category": category,
        "category_proposed": category_proposed,
        "kpi_rule": {"id": kpi_rule.id, "label": kpi_rule.label, "state": kpi_rule.state},
        "training_rule": {"id": training_rule.id, "label": training_rule.label, "state": training_rule.state, "config": policy} if training_rule else None,
        "base": base,
        "original_base": original_base if applied else None,
        "overrides": applied,
        "training": training,
        "final": final,
        "original_final": original_final,
        "tier": tier,
        "gates": gates,
        "readiness": readiness,
        "checkin": {"month": checkin.month.isoformat(), "state": checkin.state} if checkin else None,
        "quality_inputs": q,
        "locked": False,
        "illustrative_inputs": bool((ach and ach.illustrative) or (checkin and checkin.illustrative)),
    }


def result_status(ev: dict) -> str:
    if not ev["base"]["sufficient"]:
        return "Insufficient data"
    if ev["final"]["status"] == "readiness_exception":
        return "Readiness exception"
    return "Ready for review"
