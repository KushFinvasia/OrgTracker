"""Workflow templates -> staged tasks with finish-to-start dependencies and named RACI checks."""

from __future__ import annotations

from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Assignment, Project, Risk, Task, TaskDependency, TemplateStage, WorkflowTemplate
from app.services.common import add_business_days, holidays, person_by_id


def stage_conflicts(st: TemplateStage) -> list[str]:
    issues = []
    if not st.accountable_id:
        issues.append("Accountable is not resolved to one named person.")
    if not st.responsible_id:
        issues.append("Responsible owner is not resolved to a named person.")
    if not st.reviewer_id:
        issues.append("Independent reviewer is not named.")
    if st.reviewer_id and st.reviewer_id in (st.responsible_id,):
        issues.append("Reviewer is also Responsible. An assignee cannot review the step.")
    if st.accountable_id and st.accountable_id == st.responsible_id:
        issues.append("One person holds both R and A. One RACI letter per person per step.")
    return issues


def template_dict(db: Session, t: WorkflowTemplate) -> dict:
    stages = []
    for st in t.stages:
        stages.append(
            {
                "id": st.id,
                "step": st.step,
                "name": st.name,
                "depends_on_step": st.depends_on_step,
                "responsible_role": st.responsible_role,
                "responsible": person_by_id(db, st.responsible_id),
                "accountable_label": st.accountable_label,
                "accountable": person_by_id(db, st.accountable_id),
                "consulted": st.consulted,
                "informed": st.informed,
                "checklist": st.checklist,
                "reviewer_label": st.reviewer_label,
                "reviewer": person_by_id(db, st.reviewer_id),
                "review_criteria": st.review_criteria,
                "required_evidence": st.required_evidence,
                "sla_target_days": st.sla_target_days,
                "sla_max_days": st.sla_max_days,
                "effort_min_hours": st.effort_min_hours,
                "effort_max_hours": st.effort_max_hours,
                "mitigation": st.mitigation,
                "source_flags": st.source_flags,
                "conflicts": stage_conflicts(st),
            }
        )
    risks = [
        {"code": r.code, "stage": r.stage, "risk": r.risk, "criticality": r.criticality}
        for r in db.scalars(select(Risk).where(Risk.template_id == t.id, Risk.project_id.is_(None)))
    ]
    return {
        "id": t.id,
        "name": t.name,
        "description": t.description,
        "sla_target_days": t.sla_target_days,
        "sla_max_days": t.sla_max_days,
        "effort_min_hours": t.effort_min_hours,
        "effort_max_hours": t.effort_max_hours,
        "state": t.state,
        "stages": stages,
        "risks": risks,
        "blocking_conflicts": sum(1 for s in stages if s["conflicts"]),
    }


def instantiate(db: Session, project: Project, template: WorkflowTemplate, start: date, account_id: int | None, code_prefix: str) -> list[Task]:
    """Create one task per stage. Unresolved people stay visible as flags; activation is blocked until fixed."""
    hols = holidays(db)
    tasks: dict[int, Task] = {}
    cursor = start
    for st in template.stages:
        # No SLA defined in the source -> no invented due date.
        due = add_business_days(cursor, st.sla_max_days, hols) if st.sla_max_days else None
        flags = "; ".join(stage_conflicts(st)) or None
        t = Task(
            code=f"{code_prefix}-T{st.step:02d}",
            project_id=project.id,
            title=st.name,
            description=st.checklist,
            category=template.name,
            complexity=3,
            start_date=cursor,
            due_date_original=due,
            due_date=due,
            status="Not Started",
            reviewer_id=st.reviewer_id if st.reviewer_id != st.responsible_id else None,
            checklist=[c.strip() for c in (st.review_criteria or st.checklist or "").split(";") if c.strip()],
            required_evidence=st.required_evidence,
            created_by=account_id,
            data_flags=flags,
        )
        db.add(t)
        db.flush()
        if st.responsible_id:
            db.add(Assignment(task_id=t.id, employee_id=st.responsible_id, role="Owner", share=1.0))
        if st.depends_on_step and st.depends_on_step in tasks:
            db.add(TaskDependency(task_id=t.id, depends_on_id=tasks[st.depends_on_step].id))
        tasks[st.step] = t
        cursor = due or cursor
    for r in db.scalars(select(Risk).where(Risk.template_id == template.id, Risk.project_id.is_(None))):
        db.add(
            Risk(
                code=r.code,
                project_id=project.id,
                template_id=template.id,
                stage=r.stage,
                risk=r.risk,
                criticality=r.criticality,
                dependencies=r.dependencies,
                assumptions=r.assumptions,
                mitigation=r.mitigation,
                owner_id=project.owner_id,
                state="Open",
            )
        )
    return list(tasks.values())


def activation_blockers(db: Session, project: Project) -> list[str]:
    issues = []
    for t in db.scalars(select(Task).where(Task.project_id == project.id, Task.status != "Cancelled")):
        owners = [a for a in t.assignments if a.role == "Owner"]
        if len(owners) != 1:
            issues.append(f"{t.code}: needs exactly one named Owner.")
        if not t.reviewer_id:
            issues.append(f"{t.code}: needs an independent reviewer.")
        elif t.reviewer_id in {a.employee_id for a in t.assignments}:
            issues.append(f"{t.code}: reviewer is an assignee.")
    return issues
