from datetime import date, datetime

from sqlalchemy import Date, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.org import Employee

TRAINING_STATUSES = ("Assigned", "In progress", "Submitted", "Verified complete", "Returned", "Exempt", "Cancelled")


class Course(Base):
    """Versioned catalog entry. Assignments keep the version they were created with."""

    __tablename__ = "courses"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(20))
    version: Mapped[int] = mapped_column(Integer, default=1)
    title: Mapped[str] = mapped_column(String(200))
    course_type: Mapped[str] = mapped_column(String(20), default="Mandatory")  # Mandatory | Optional
    applicability: Mapped[str | None] = mapped_column(String(200))
    completion_criteria: Mapped[str] = mapped_column(String(200), default="Attendance + assessment")
    pass_mark: Mapped[float | None] = mapped_column(Float)
    duration_hours: Mapped[float | None] = mapped_column(Float)
    evidence_requirements: Mapped[str | None] = mapped_column(String(250))
    recurrence: Mapped[str | None] = mapped_column(String(80))
    state: Mapped[str] = mapped_column(String(20), default="Approved")  # Draft | Approved | Archived
    illustrative: Mapped[bool] = mapped_column(default=False)


class TrainingAssignment(Base):
    __tablename__ = "training_assignments"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(30), unique=True)
    course_id: Mapped[int] = mapped_column(ForeignKey("courses.id"))
    course_version: Mapped[int] = mapped_column(Integer)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id"))
    assigned_date: Mapped[date] = mapped_column(Date)
    due_date_original: Mapped[date] = mapped_column(Date)
    due_date: Mapped[date] = mapped_column(Date)  # due date in force
    training_type: Mapped[str] = mapped_column(String(40))
    completion_criteria: Mapped[str] = mapped_column(String(200))
    pass_mark: Mapped[float | None] = mapped_column(Float)
    duration_hours: Mapped[float | None] = mapped_column(Float)
    verifier_id: Mapped[int | None] = mapped_column(ForeignKey("employees.id"))
    period_id: Mapped[int | None] = mapped_column(ForeignKey("periods.id"))
    status: Mapped[str] = mapped_column(String(20), default="Assigned")
    progress: Mapped[int] = mapped_column(Integer, default=0)
    completion_date: Mapped[date | None] = mapped_column(Date)
    assessment_result: Mapped[float | None] = mapped_column(Float)
    attendance_ok: Mapped[bool | None] = mapped_column()
    evidence_note: Mapped[str | None] = mapped_column(Text)
    recorded_by: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"))
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime)
    verified_by: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"))
    verified_at: Mapped[datetime | None] = mapped_column(DateTime)
    verification_note: Mapped[str | None] = mapped_column(Text)
    illustrative: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)

    course: Mapped[Course] = relationship()
    employee: Mapped[Employee] = relationship(foreign_keys=[employee_id])


class TrainingAttempt(Base):
    """Retakes are attempts on the same assignment; they never add denominator entries."""

    __tablename__ = "training_attempts"

    id: Mapped[int] = mapped_column(primary_key=True)
    assignment_id: Mapped[int] = mapped_column(ForeignKey("training_assignments.id"))
    attempt_no: Mapped[int] = mapped_column(Integer)
    result: Mapped[float | None] = mapped_column(Float)
    attempt_date: Mapped[date | None] = mapped_column(Date)
    note: Mapped[str | None] = mapped_column(Text)
    recorded_by: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"))


class TrainingException(Base):
    __tablename__ = "training_exceptions"

    id: Mapped[int] = mapped_column(primary_key=True)
    assignment_id: Mapped[int] = mapped_column(ForeignKey("training_assignments.id"))
    exception_type: Mapped[str] = mapped_column(String(20))  # Exemption | Cancellation | Due-date change
    reason: Mapped[str] = mapped_column(Text)
    evidence: Mapped[str | None] = mapped_column(Text)
    proposed_due_date: Mapped[date | None] = mapped_column(Date)
    requested_by: Mapped[int] = mapped_column(ForeignKey("accounts.id"))
    approver_id: Mapped[int | None] = mapped_column(ForeignKey("employees.id"))
    state: Mapped[str] = mapped_column(String(12), default="Pending")  # Pending | Approved | Rejected
    decision_note: Mapped[str | None] = mapped_column(Text)
    effective_date: Mapped[date | None] = mapped_column(Date)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
