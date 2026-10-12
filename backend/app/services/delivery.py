"""Projects and tasks: validation rules, derived health/progress and serialisation."""

from __future__ import annotations

from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import RuleViolation
from app.models import (
    Assignment,
    Blocker,
    DeadlineChange,
    Milestone,
    Project,
    ReviewDecision,
    Risk,
    Submission,
    Task,
    TaskDependency,
)
from app.services.common import person, person_by_id, task_timing, today

# Health rules are a proposal pending approval (see CLAUDE.md open decisions).
HEALTH_RULES_NOTE = "Derived from overdue work, blockers and open High/Critical risks (proposed rule)."


def validate_assignments(rows: list[dict], reviewer_id: int | None) -> None:
    """Exactly one Owner, positive shares totalling 100%, no duplicates, independent reviewer."""
    if not rows:
        raise RuleViolation("Add an Owner for this task.", "assignments")
    owners = [r for r in rows if r["role"] == "Owner"]
    if len(owners) != 1:
        raise RuleViolation("A task needs exactly one Owner.", "assignments")
    ids = [r["employee_id"] for r in rows]
    if len(set(ids)) != len(ids):
        raise RuleViolation("Each person can have only one assignment on a task.", "assignments")
    if any(r["share"] <= 0 for r in rows):
        raise RuleViolation("Every contribution share must be above 0%.", "assignments")
    total = sum(r["share"] for r in rows)
    if round(total, 6) != 100:
        raise RuleViolation(f"Shares total {total:g}%. Adjust the total to exactly 100%.", "assignments")
    if reviewer_id is None:
        raise RuleViolation("Choose an independent reviewer.", "reviewer_id")
    if reviewer_id in ids:
        raise RuleViolation("The reviewer is an assignee. Choose another person.", "reviewer_id")


def task_brief(db: Session, t: Task, ref: date | None = None) -> dict:
    owner = next((a for a in t.assignments if a.role == "Owner"), None)
    project = db.get(Project, t.project_id)
    submitted_on = None
    if t.status == "In Review":
        submitted_on = db.scalar(select(Submission.submission_date).where(Submission.task_id == t.id).order_by(Submission.version.desc()))
    pending_blockers = db.scalar(select(func.count()).select_from(Blocker).where(Blocker.task_id == t.id, Blocker.state == "Pending")) or 0
    return {
        "id": t.id,
        "code": t.code,
        "title": t.title,
        "category": t.category,
        "project": {"id": project.id, "code": project.code, "title": project.title} if project else None,
        "milestone_id": t.milestone_id,
        "status": t.status,
        "progress": t.progress,
        "complexity": t.complexity,
        "due_date": t.due_date,
        "due_date_original": t.due_date_original,
        "start_date": t.start_date,
        "timing": task_timing(t.status, t.due_date, t.accepted_submission_date, ref, submitted_on),
        "owner": person(owner.employee) if owner else None,
        "assignments": [{"employee": person(a.employee), "role": a.role, "share": round(a.share * 100, 2)} for a in t.assignments],
        "reviewer": person(t.reviewer),
        "next_action": t.next_action,
        "pending_blockers": pending_blockers,
        "accepted_submission_date": t.accepted_submission_date,
        "incident_id": t.incident_id,
        "source": t.source,
        "data_flags": t.data_flags,
        "version": t.version,
    }


def task_detail(db: Session, t: Task) -> dict:
    d = task_brief(db, t)
    d["description"] = t.description
    d["checklist"] = t.checklist or []
    d["required_evidence"] = t.required_evidence
    d["dependencies"] = [
        {"id": dep.id, "code": dep.code, "title": dep.title, "status": dep.status}
        for dep in db.scalars(select(Task).join(TaskDependency, TaskDependency.depends_on_id == Task.id).where(TaskDependency.task_id == t.id))
    ]
    d["submissions"] = [
        {
            "id": s.id,
            "version": s.version,
            "submission_date": s.submission_date,
            "note": s.note,
            "evidence_ids": s.evidence_ids,
            "source": s.source,
            "created_at": s.created_at,
        }
        for s in db.scalars(select(Submission).where(Submission.task_id == t.id).order_by(Submission.version.desc()))
    ]
    d["reviews"] = [
        {
            "id": r.id,
            "submission_id": r.submission_id,
            "decision": r.decision,
            "reviewer": person_by_id(db, r.reviewer_id),
            "reason_category": r.reason_category,
            "failed_criteria": r.failed_criteria,
            "feedback": r.feedback,
            "requirement_changed": r.requirement_changed,
            "decided_at": r.decided_at,
            "source": r.source,
        }
        for r in db.scalars(select(ReviewDecision).where(ReviewDecision.task_id == t.id).order_by(ReviewDecision.decided_at.desc()))
    ]
    d["blockers"] = [
        {
            "id": b.id,
            "category": b.category,
            "description": b.description,
            "requester": person_by_id(db, b.requester_id),
            "validator": person_by_id(db, b.validator_id),
            "blocked_since": b.blocked_since,
            "state": b.state,
            "decision_reason": b.decision_reason,
            "evidence": b.evidence,
            "source": b.source,
        }
        for b in db.scalars(select(Blocker).where(Blocker.task_id == t.id).order_by(Blocker.created_at.desc()))
    ]
    d["deadline_changes"] = [
        {
            "id": c.id,
            "original_date": c.original_date,
            "requested_date": c.requested_date,
            "reason_category": c.reason_category,
            "comment": c.comment,
            "requester": person_by_id(db, c.requester_id),
            "validator": person_by_id(db, c.validator_id),
            "state": c.state,
            "decision_reason": c.decision_reason,
        }
        for c in db.scalars(select(DeadlineChange).where(DeadlineChange.task_id == t.id).order_by(DeadlineChange.created_at.desc()))
    ]
    return d


def accepted_output(tasks_and_shares: list[tuple[Task, float]]) -> float:
    """Accepted weighted output = sum(complexity x contribution fraction) over accepted tasks."""
    return sum(t.complexity * share for t, share in tasks_and_shares if t.status == "Completed")


def reported_progress(tasks_and_shares: list[tuple[Task, float]]) -> float | None:
    """Proposed: complexity x contribution weighted average of active task progress."""
    active = [(t, s) for t, s in tasks_and_shares if t.status in ("Not Started", "In Progress", "Blocked", "In Review", "Rework")]
    denom = sum(t.complexity * s for t, s in active)
    if not denom:
        return None
    return sum(t.progress * t.complexity * s for t, s in active) / denom


def project_metrics(db: Session, p: Project) -> dict:
    tasks = list(db.scalars(select(Task).where(Task.project_id == p.id)))
    in_scope = [t for t in tasks if t.status != "Cancelled"]
    accepted = [t for t in in_scope if t.status == "Completed"]
    denom = sum(t.complexity for t in in_scope)
    accepted_delivery = (sum(t.complexity for t in accepted) / denom * 100) if denom else None
    ref = today()
    overdue = [t for t in in_scope if task_timing(t.status, t.due_date, t.accepted_submission_date, ref) == "Overdue"]
    blocked = [t for t in in_scope if t.status == "Blocked"]
    risks = list(db.scalars(select(Risk).where(Risk.project_id == p.id, Risk.state != "Closed")))
    high_risks = [r for r in risks if r.criticality in ("High", "Critical")]
    critical = [r for r in risks if r.criticality == "Critical"]
    progress_vals = [t.progress for t in in_scope if t.status != "Completed"]
    reported = round(sum(t.progress * t.complexity for t in in_scope) / denom) if denom else None
    if p.status in ("Completed", "Cancelled"):
        health = None
    elif p.status == "Blocked" or len(overdue) >= 2 or critical:
        health = "Off Track"
    elif overdue or blocked or high_risks:
        health = "At Risk"
    else:
        health = "On Track"
    return {
        "tasks_total": len(in_scope),
        "tasks_accepted": len(accepted),
        "accepted_delivery": accepted_delivery,
        "reported_progress": reported,
        "overdue": len(overdue),
        "blocked": len(blocked),
        "open_risks": len(risks),
        "open_high_risks": len(high_risks),
        "health": health,
        "health_note": HEALTH_RULES_NOTE,
        "timing": task_timing(p.status, p.target_date, None, ref),
        "_active_progress_values": len(progress_vals),
    }


def project_brief(db: Session, p: Project) -> dict:
    m = project_metrics(db, p)
    m.pop("_active_progress_values", None)
    return {
        "id": p.id,
        "code": p.code,
        "title": p.title,
        "objective": p.objective,
        "owner": person(p.owner),
        "reviewer": person(p.reviewer),
        "department": p.department.name if p.department else None,
        "department_id": p.department_id,
        "priority": p.priority,
        "status": p.status,
        "start_date": p.start_date,
        "target_date": p.target_date,
        "source": p.source,
        "archived": p.archived,
        "template_id": p.template_id,
        "version": p.version,
        "metrics": m,
    }


def milestone_dict(db: Session, m: Milestone) -> dict:
    linked = list(db.scalars(select(Task).where(Task.milestone_id == m.id)))
    return {
        "id": m.id,
        "title": m.title,
        "owner": person_by_id(db, m.owner_id),
        "target_date": m.target_date,
        "acceptance_criterion": m.acceptance_criterion,
        "evidence": m.evidence,
        "state": m.state,
        "dependency": m.dependency,
        "linked_tasks": len(linked),
        "accepted_tasks": sum(1 for t in linked if t.status == "Completed"),
    }


def risk_dict(db: Session, r: Risk) -> dict:
    return {
        "id": r.id,
        "code": r.code,
        "stage": r.stage,
        "risk": r.risk,
        "criticality": r.criticality,
        "dependencies": r.dependencies,
        "assumptions": r.assumptions,
        "mitigation": r.mitigation,
        "owner": person_by_id(db, r.owner_id),
        "state": r.state,
        "next_review": r.next_review,
        "linked_task_id": r.linked_task_id,
    }


def assignment_rows_for(db: Session, employee_id: int) -> list[tuple[Task, float, Assignment]]:
    rows = db.execute(select(Task, Assignment).join(Assignment).where(Assignment.employee_id == employee_id)).all()
    return [(t, a.share, a) for t, a in rows]
