"""Project R&R (HR Strategy framework draft v1.0, policy PR-1, proposed): charter, project RACI, SLAs, delays, inputs and scorecards.

Delivery timelines and delays come from tasks, never from milestones. Scorecards are scored from validated inputs; a published
scorecard is frozen and never recalculates.
"""

from datetime import date, datetime

from sqlalchemy import JSON, Date, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.clock import now_ist
from app.core.database import Base

# Duties Admin tags on existing named accounts. They are never new logins.
RR_FUNCTIONS = ("PMO validator", "Finance confirmer", "Quality assessor", "HR calibrator", "R&R Panel member")
PROJECT_TYPES = ("Standard", "Complex", "Strategic")
CHARTER_MODES = ("closure", "programme")
# Where a project is in the scheme. "Published" scorecards are frozen.
RR_STAGES = ("Charter draft", "In delivery", "Collecting inputs", "Awaiting Finance", "Inputs validated", "HR calibrated", "Panel approved", "Published")
# Scorecard inputs, the function that validates each, and how the engine reads the value.
INPUT_KINDS = {
    "value_actual": ("Value actual", "Finance confirmer"),
    "sla": ("TAT / SLA counts", "PMO validator"),
    "rework": ("Rework % of effort", "Quality assessor"),
    "errors": ("Errors after go-live (30 days)", "Quality assessor"),
    "satisfaction": ("Stakeholder satisfaction", "Quality assessor"),
    "collaboration": ("Outside collaboration feedback", "HR calibrator"),
    "innovation": ("Innovation award", "R&R Panel member"),
}


class ProjectCharter(Base):
    """One per project in the scheme. Locked by the sponsor and the PMO together; the champion can't lock alone."""

    __tablename__ = "project_charters"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), unique=True)
    mode: Mapped[str] = mapped_column(String(12), default="closure")  # closure | programme (quarterly, template work)
    project_type: Mapped[str] = mapped_column(String(12), default="Standard")
    sponsor: Mapped[str | None] = mapped_column(String(120))
    champion_id: Mapped[int | None] = mapped_column(ForeignKey("employees.id"))  # the one A
    champion_note: Mapped[str | None] = mapped_column(String(250))  # e.g. a named champion who isn't in the org chart yet
    value_kind: Mapped[str | None] = mapped_column(String(120))
    value_target: Mapped[float | None] = mapped_column(Float)  # numeric targets score; text-only targets wait for a number
    value_target_text: Mapped[str | None] = mapped_column(String(120))
    pool_rate: Mapped[float | None] = mapped_column(Float)  # 2 / 2.5 / 3% by project type (proposed)
    state: Mapped[str] = mapped_column(String(12), default="Draft")  # Draft | Submitted | Locked
    submitted_by: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"))
    sponsor_ok_by: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"))
    pmo_ok_by: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"))
    locked_on: Mapped[date | None] = mapped_column(Date)
    stage: Mapped[str] = mapped_column(String(24), default="Charter draft")
    lock_checks: Mapped[dict] = mapped_column(JSON, default=dict)  # programme lock checklist, e.g. {"baseline_metrics": true}
    stage_reviewers: Mapped[dict] = mapped_column(JSON, default=dict)  # programme: {step: employee id} independent reviewers
    doc_reading: Mapped[bool] = mapped_column(default=False)  # open decision P9
    frozen: Mapped[dict | None] = mapped_column(JSON)  # published scorecard, never recalculated
    history: Mapped[list] = mapped_column(JSON, default=list)
    illustrative: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_ist)


class ProjectRaci(Base):
    """One letter per person per project (A > R > C > I). R carries a contribution factor; C an agreed response time."""

    __tablename__ = "project_raci"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"))
    employee_id: Mapped[int | None] = mapped_column(ForeignKey("employees.id"))
    label: Mapped[str | None] = mapped_column(String(120))  # a role without a named person (I only), e.g. "Head of Sales"
    letter: Mapped[str] = mapped_column(String(1))
    factor: Mapped[float | None] = mapped_column(Float)  # R: 0.5 / 0.75 / 1.0 / 1.25
    factor_confirmed: Mapped[bool] = mapped_column(default=False)
    response_days: Mapped[int | None] = mapped_column(Integer)  # C
    adjustment: Mapped[int] = mapped_column(Integer, default=0)  # contribution adjustment -10..+10 (HR calibrates)
    note: Mapped[str | None] = mapped_column(String(250))


class ProjectSla(Base):
    """Fixed at kickoff; can't be dropped later."""

    __tablename__ = "project_slas"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"))
    name: Mapped[str] = mapped_column(String(200))
    kind: Mapped[str] = mapped_column(String(20))  # Client | Internal TAT
    tat: Mapped[str] = mapped_column(String(40))


class ProjectDelay(Base):
    """One late task = one delay. Programme delays belong to a run's stage task."""

    __tablename__ = "project_delays"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"))
    code: Mapped[str] = mapped_column(String(10))
    task_id: Mapped[int | None] = mapped_column(ForeignKey("tasks.id"))
    task_label: Mapped[str] = mapped_column(String(250))
    run_request_id: Mapped[int | None] = mapped_column(ForeignKey("work_requests.id"))
    stage: Mapped[int | None] = mapped_column(Integer)
    reason_code: Mapped[str] = mapped_column(String(4))
    custom_reason: Mapped[str | None] = mapped_column(String(120))
    explanation: Mapped[str] = mapped_column(Text)
    evidence: Mapped[str | None] = mapped_column(Text)
    due_date: Mapped[date | None] = mapped_column(Date)  # the baseline due date, from the task
    flagged_on: Mapped[date | None] = mapped_column(Date)
    escalation_miss: Mapped[bool] = mapped_column(default=False)  # -2 more on top of another controllable reason
    tagged: Mapped[list] = mapped_column(JSON, default=list)  # employee ids charged with this delay
    state: Mapped[str] = mapped_column(String(12), default="Logged")  # Logged | Validated | Challenged | Closed
    logged_by: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"))
    validated_by: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"))
    history: Mapped[list] = mapped_column(JSON, default=list)
    illustrative: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_ist)


class BaselineChange(Base):
    """Approved before the due date, it becomes an E3 excuse. The original baseline is kept."""

    __tablename__ = "baseline_changes"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"))
    task_id: Mapped[int | None] = mapped_column(ForeignKey("tasks.id"))
    task_label: Mapped[str] = mapped_column(String(250))
    requested_date: Mapped[date] = mapped_column(Date)
    reason: Mapped[str] = mapped_column(Text)
    state: Mapped[str] = mapped_column(String(12), default="Requested")  # Requested | Approved | Rejected
    requested_by: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"))
    decided_by: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"))
    decision_reason: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_ist)


class ProjectDispute(Base):
    __tablename__ = "project_disputes"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"))
    subject: Mapped[str] = mapped_column(String(200))
    grounds: Mapped[str] = mapped_column(Text)
    state: Mapped[str] = mapped_column(String(12), default="Open")  # Open | Upheld | Dismissed
    raised_by: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_ist)


class ProjectRrInput(Base):
    """A scorecard input from outside the team: Submitted, then Validated or Returned by an account holding the input's function."""

    __tablename__ = "project_rr_inputs"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"))
    kind: Mapped[str] = mapped_column(String(20))
    value: Mapped[dict] = mapped_column(JSON, default=dict)
    display: Mapped[str] = mapped_column(String(200))
    state: Mapped[str] = mapped_column(String(12), default="Submitted")  # Submitted | Validated | Returned
    author_account_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"))
    validator_account_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"))
    reason: Mapped[str | None] = mapped_column(Text)
    illustrative: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_ist)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime)


class RrPolicy(Base):
    """The Project R&R policy version. It stays "Proposed, not activated" until a second, different Admin approves it."""

    __tablename__ = "rr_policies"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(10), unique=True)
    state: Mapped[str] = mapped_column(String(12), default="Proposed")  # Proposed | Approved
    authored_by: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"))
    authored_on: Mapped[date | None] = mapped_column(Date)
    approved_by: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"))
    approved_at: Mapped[datetime | None] = mapped_column(DateTime)
