from datetime import date, datetime

from sqlalchemy import JSON, Date, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.org import Department, Employee
from app.core.clock import now_ist

PROJECT_STATUSES = ("Planning", "Not Started", "In Progress", "Blocked", "In Review", "Completed", "On Hold", "Cancelled")
PRIORITIES = ("High", "Medium", "Low")
RISK_CRITICALITY = ("Low", "Medium", "High", "Critical")
RISK_STATES = ("Open", "Mitigating", "Closed")
INCIDENT_STATES = ("Open", "Under analysis", "Correction done", "Preventive action in progress", "Closed", "Reopened")
SEVERITIES = ("Minor", "Medium", "Major")
CLOSURE_STAGES = ("tasks", "milestones", "deliverables", "objectives", "issues", "lessons", "remarks", "approval")


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(20), unique=True)
    title: Mapped[str] = mapped_column(String(200))
    objective: Mapped[str | None] = mapped_column(Text)
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("employees.id"))
    department_id: Mapped[int | None] = mapped_column(ForeignKey("departments.id"))
    # Mandatory for anything created in the app. Legacy imports may lack it and are flagged until resolved.
    priority: Mapped[str | None] = mapped_column(String(10))
    start_date: Mapped[date | None] = mapped_column(Date)
    target_date: Mapped[date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(20), default="Planning")
    template_id: Mapped[int | None] = mapped_column(ForeignKey("workflow_templates.id"))
    reviewer_id: Mapped[int | None] = mapped_column(ForeignKey("employees.id"))
    source: Mapped[str] = mapped_column(String(20), default="app")  # app | import | demo
    archived: Mapped[bool] = mapped_column(default=False)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_ist)

    owner: Mapped[Employee | None] = relationship(foreign_keys=[owner_id])
    reviewer: Mapped[Employee | None] = relationship(foreign_keys=[reviewer_id])
    department: Mapped[Department | None] = relationship()


class ProjectMember(Base):
    __tablename__ = "project_members"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"))
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id"))
    role: Mapped[str] = mapped_column(String(40), default="Member")


class Milestone(Base):
    __tablename__ = "milestones"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"))
    title: Mapped[str] = mapped_column(String(200))
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("employees.id"))
    target_date: Mapped[date | None] = mapped_column(Date)
    acceptance_criterion: Mapped[str | None] = mapped_column(Text)
    evidence: Mapped[str | None] = mapped_column(Text)
    state: Mapped[str] = mapped_column(String(20), default="Planned")  # Planned | In progress | Completed
    dependency: Mapped[str | None] = mapped_column(String(200))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class Risk(Base):
    __tablename__ = "risks"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(20))
    project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.id"))
    template_id: Mapped[int | None] = mapped_column(ForeignKey("workflow_templates.id"))
    stage: Mapped[str | None] = mapped_column(String(120))
    risk: Mapped[str] = mapped_column(Text)
    criticality: Mapped[str] = mapped_column(String(10))
    dependencies: Mapped[str | None] = mapped_column(Text)
    assumptions: Mapped[str | None] = mapped_column(Text)
    mitigation: Mapped[str | None] = mapped_column(Text)
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("employees.id"))
    state: Mapped[str] = mapped_column(String(12), default="Open")
    next_review: Mapped[date | None] = mapped_column(Date)
    linked_task_id: Mapped[int | None] = mapped_column(ForeignKey("tasks.id"))


class Incident(Base):
    """Incident + RCA. A personal Compliance deduction needs validated severity AND validated individual attribution."""

    __tablename__ = "incidents"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(30), unique=True)
    project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.id"))
    title: Mapped[str] = mapped_column(String(200))
    product_system: Mapped[str | None] = mapped_column(String(120))
    incident_date: Mapped[date | None] = mapped_column(Date)
    received_date: Mapped[date | None] = mapped_column(Date)
    reporter_id: Mapped[int | None] = mapped_column(ForeignKey("employees.id"))
    severity_proposed: Mapped[str | None] = mapped_column(String(10))
    severity_validated: Mapped[str | None] = mapped_column(String(10))
    clients_impacted: Mapped[int | None] = mapped_column(Integer)
    orders_impacted: Mapped[int | None] = mapped_column(Integer)
    responsible_department_id: Mapped[int | None] = mapped_column(ForeignKey("departments.id"))
    stakeholder_id: Mapped[int | None] = mapped_column(ForeignKey("employees.id"))
    root_cause: Mapped[str | None] = mapped_column(Text)
    root_cause_category: Mapped[str | None] = mapped_column(String(60))
    gap: Mapped[str | None] = mapped_column(Text)
    correction_action: Mapped[str | None] = mapped_column(Text)
    correction_date: Mapped[date | None] = mapped_column(Date)
    expected_closure: Mapped[date | None] = mapped_column(Date)
    actual_closure: Mapped[date | None] = mapped_column(Date)
    state: Mapped[str] = mapped_column(String(40), default="Open")
    verifier_id: Mapped[int | None] = mapped_column(ForeignKey("employees.id"))
    verification_note: Mapped[str | None] = mapped_column(Text)
    repeat_of_id: Mapped[int | None] = mapped_column(ForeignKey("incidents.id"))
    attribution_state: Mapped[str] = mapped_column(String(20), default="pending")  # pending | not_established | validated
    attributed_employee_id: Mapped[int | None] = mapped_column(ForeignKey("employees.id"))
    attribution_validator_id: Mapped[int | None] = mapped_column(ForeignKey("employees.id"))
    attribution_reason: Mapped[str | None] = mapped_column(Text)
    history: Mapped[list] = mapped_column(JSON, default=list)
    illustrative: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_ist)


class ProjectClosure(Base):
    __tablename__ = "project_closures"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), unique=True)
    stage_notes: Mapped[dict] = mapped_column(JSON, default=dict)  # stage -> {"done": bool, "note": str}
    state: Mapped[str] = mapped_column(String(20), default="Draft")  # Draft | Submitted | Approved | Returned
    submitted_by: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"))
    decided_by: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"))
    decision_reason: Mapped[str | None] = mapped_column(Text)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime)
    history: Mapped[list] = mapped_column(JSON, default=list)


class WorkRequest(Base):
    """Cross-department request: requester's manager validates, receiving owner accepts into the calendar."""

    __tablename__ = "work_requests"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(200))
    template_id: Mapped[int | None] = mapped_column(ForeignKey("workflow_templates.id"))
    requesting_department_id: Mapped[int | None] = mapped_column(ForeignKey("departments.id"))
    receiving_department_id: Mapped[int | None] = mapped_column(ForeignKey("departments.id"))
    audience: Mapped[str | None] = mapped_column(String(200))
    objective: Mapped[str | None] = mapped_column(Text)
    required_date: Mapped[date | None] = mapped_column(Date)
    priority: Mapped[str] = mapped_column(String(10))
    brief: Mapped[str | None] = mapped_column(Text)
    requester_id: Mapped[int] = mapped_column(ForeignKey("employees.id"))
    validator_id: Mapped[int | None] = mapped_column(ForeignKey("employees.id"))
    state: Mapped[str] = mapped_column(String(20), default="Submitted")  # Submitted|Validated|Accepted|Returned|Rejected
    project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.id"))
    history: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_ist)
