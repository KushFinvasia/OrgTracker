from datetime import date, datetime

from sqlalchemy import JSON, Date, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.org import Employee
from app.core.clock import now_ist

TASK_STATUSES = ("Not Started", "In Progress", "Blocked", "In Review", "Rework", "Completed", "On Hold", "Cancelled")
# Statuses a user may set directly. In Review / Completed / Rework only come from workflow actions.
MANUAL_TASK_STATUSES = ("Not Started", "In Progress", "Blocked", "On Hold", "Cancelled")
BLOCKER_CATEGORIES = {
    "Internal dependency": True,
    "External or vendor": True,
    "Approval pending": True,
    "Management reprioritisation": True,
    "Requirement change": True,
    "Resource": True,  # needs HOD validation
    "Technical issue": False,
    "Own-team rework": False,
}
DEADLINE_REASONS = tuple(BLOCKER_CATEGORIES)


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(30), unique=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"))
    milestone_id: Mapped[int | None] = mapped_column(ForeignKey("milestones.id"))
    incident_id: Mapped[int | None] = mapped_column(ForeignKey("incidents.id"))  # preventive action tasks
    title: Mapped[str] = mapped_column(String(250))
    description: Mapped[str | None] = mapped_column(Text)
    category: Mapped[str | None] = mapped_column(String(40))
    complexity: Mapped[int] = mapped_column(Integer, default=3)
    start_date: Mapped[date | None] = mapped_column(Date)
    due_date_original: Mapped[date | None] = mapped_column(Date)
    due_date: Mapped[date | None] = mapped_column(Date)  # due date in force; changes only via validated DeadlineChange
    status: Mapped[str] = mapped_column(String(20), default="Not Started")
    progress: Mapped[int] = mapped_column(Integer, default=0)  # reported planning progress, never acceptance
    next_action: Mapped[str | None] = mapped_column(String(250))
    reviewer_id: Mapped[int | None] = mapped_column(ForeignKey("employees.id"))
    checklist: Mapped[list] = mapped_column(JSON, default=list)
    required_evidence: Mapped[str | None] = mapped_column(Text)
    accepted_submission_date: Mapped[date | None] = mapped_column(Date)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime)
    source: Mapped[str] = mapped_column(String(20), default="app")
    data_flags: Mapped[str | None] = mapped_column(Text)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_ist)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now_ist, onupdate=now_ist)

    assignments: Mapped[list["Assignment"]] = relationship(back_populates="task", cascade="all, delete-orphan")
    reviewer: Mapped[Employee | None] = relationship(foreign_keys=[reviewer_id])


class TaskDependency(Base):
    __tablename__ = "task_dependencies"

    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id"))
    depends_on_id: Mapped[int] = mapped_column(ForeignKey("tasks.id"))


class Assignment(Base):
    """One record per person per task. Exactly one Owner; shares total 1.0."""

    __tablename__ = "assignments"

    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id"))
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id"))
    role: Mapped[str] = mapped_column(String(12))  # Owner | Contributor
    share: Mapped[float] = mapped_column(Float)

    task: Mapped[Task] = relationship(back_populates="assignments")
    employee: Mapped[Employee] = relationship()


class EvidenceFile(Base):
    __tablename__ = "evidence_files"

    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int | None] = mapped_column(ForeignKey("tasks.id"))
    training_assignment_id: Mapped[int | None] = mapped_column(ForeignKey("training_assignments.id"))
    filename: Mapped[str] = mapped_column(String(255))
    stored_path: Mapped[str | None] = mapped_column(String(500))
    size: Mapped[int] = mapped_column(Integer, default=0)
    uploaded_by: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"))
    uploaded_at: Mapped[datetime] = mapped_column(DateTime, default=now_ist)


class Submission(Base):
    """Immutable submission version. Completion date for scoring = submission_date of the accepted version."""

    __tablename__ = "submissions"

    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id"))
    version: Mapped[int] = mapped_column(Integer)
    submission_date: Mapped[date] = mapped_column(Date)
    note: Mapped[str | None] = mapped_column(Text)
    evidence_ids: Mapped[list] = mapped_column(JSON, default=list)
    checklist_confirmed: Mapped[bool] = mapped_column(default=False)
    submitted_by: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"))
    source: Mapped[str] = mapped_column(String(20), default="app")  # app | import (legacy migration)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_ist)


class ReviewDecision(Base):
    __tablename__ = "review_decisions"

    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id"))
    submission_id: Mapped[int] = mapped_column(ForeignKey("submissions.id"))
    reviewer_id: Mapped[int | None] = mapped_column(ForeignKey("employees.id"))
    decision: Mapped[str] = mapped_column(String(10))  # accept | rework
    reason_category: Mapped[str | None] = mapped_column(String(80))
    failed_criteria: Mapped[list] = mapped_column(JSON, default=list)
    feedback: Mapped[str | None] = mapped_column(Text)
    requirement_changed: Mapped[bool] = mapped_column(default=False)
    source: Mapped[str] = mapped_column(String(20), default="app")
    decided_at: Mapped[datetime] = mapped_column(DateTime, default=now_ist)


class Blocker(Base):
    __tablename__ = "blockers"

    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id"))
    category: Mapped[str] = mapped_column(String(40))
    description: Mapped[str | None] = mapped_column(Text)
    blocking_task_id: Mapped[int | None] = mapped_column(ForeignKey("tasks.id"))
    requester_id: Mapped[int | None] = mapped_column(ForeignKey("employees.id"))
    blocked_since: Mapped[date | None] = mapped_column(Date)
    ended_on: Mapped[date | None] = mapped_column(Date)
    evidence: Mapped[str | None] = mapped_column(Text)
    validator_id: Mapped[int | None] = mapped_column(ForeignKey("employees.id"))
    state: Mapped[str] = mapped_column(String(12), default="Pending")  # Pending | Validated | Rejected
    decision_reason: Mapped[str | None] = mapped_column(Text)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime)
    source: Mapped[str] = mapped_column(String(20), default="app")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_ist)


class DeadlineChange(Base):
    __tablename__ = "deadline_changes"

    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id"))
    original_date: Mapped[date | None] = mapped_column(Date)
    requested_date: Mapped[date] = mapped_column(Date)
    reason_category: Mapped[str] = mapped_column(String(40))
    comment: Mapped[str] = mapped_column(Text)
    evidence: Mapped[str | None] = mapped_column(Text)
    requester_id: Mapped[int | None] = mapped_column(ForeignKey("employees.id"))
    validator_id: Mapped[int | None] = mapped_column(ForeignKey("employees.id"))
    state: Mapped[str] = mapped_column(String(12), default="Pending")
    decision_reason: Mapped[str | None] = mapped_column(Text)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_ist)


class Comment(Base):
    __tablename__ = "comments"

    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id"))
    author_account_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"))
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_ist)


class TaskEvent(Base):
    """Per-task history (status/progress/date changes) shown in Version history."""

    __tablename__ = "task_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id"))
    actor_account_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"))
    kind: Mapped[str] = mapped_column(String(40))
    summary: Mapped[str] = mapped_column(String(300))
    data: Mapped[dict] = mapped_column(JSON, default=dict)
    at: Mapped[datetime] = mapped_column(DateTime, default=now_ist)
