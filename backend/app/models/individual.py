"""Individual Tier (Sales pilot): monthly KPIs, duty tasks, TWCS training modules, evaluations and scorecards.

Kept apart from the Project Tier's quarterly Period / RuleVersion / Snapshot tables so the two scoring schemes never mix.
"""

from datetime import date, datetime

from sqlalchemy import JSON, Date, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.org import Employee
from app.core.clock import month_last_day, now_ist

MONTH_STATES = ("Open", "Locked")
EVALUATION_STATES = ("Draft", "Submitted", "Approved", "Returned")
MODULE_STATUSES = ("Assigned", "Completed", "Exemption requested", "Exempt")
OUTCOMES = ("Completed", "Not completed")


class ScoringRule(Base):
    """Versioned Individual Tier scoring method (weights, curves, penalties, TWCS, coverage, tiers).

    A version is authored by one account and approved by a different one. Locked months keep the version they used.
    """

    __tablename__ = "scoring_rules"

    id: Mapped[int] = mapped_column(primary_key=True)
    label: Mapped[str] = mapped_column(String(40))
    config: Mapped[dict] = mapped_column(JSON)
    state: Mapped[str] = mapped_column(String(20), default="Draft")  # Draft | Pending approval | Approved | Returned | Superseded
    summary: Mapped[str | None] = mapped_column(Text)
    effective_month: Mapped[date | None] = mapped_column(Date)  # first day of the first month it applies to
    author_account_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"))
    approver_account_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"))
    decision_note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_ist)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime)


class KpiMonth(Base):
    __tablename__ = "kpi_months"

    id: Mapped[int] = mapped_column(primary_key=True)
    month: Mapped[date] = mapped_column(Date, unique=True)  # first day of the month
    department_id: Mapped[int] = mapped_column(ForeignKey("departments.id"))
    rule_id: Mapped[int] = mapped_column(ForeignKey("scoring_rules.id"))
    training_cutoff: Mapped[date] = mapped_column(Date)
    state: Mapped[str] = mapped_column(String(12), default="Open")
    locked_by: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"))
    locked_at: Mapped[datetime | None] = mapped_column(DateTime)
    lock_note: Mapped[str | None] = mapped_column(Text)
    published_by: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"))
    published_at: Mapped[datetime | None] = mapped_column(DateTime)
    # Set once the month's KPI targets and duty tasks have been carried over from each person's previous month.
    carried_over_at: Mapped[datetime | None] = mapped_column(DateTime)
    illustrative: Mapped[bool] = mapped_column(default=False)  # demo data month
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_ist)


class KpiType(Base):
    __tablename__ = "kpi_types"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(40), unique=True)
    name: Mapped[str] = mapped_column(String(80))
    unit: Mapped[str] = mapped_column(String(12))  # count | rupees | percent | none
    description: Mapped[str | None] = mapped_column(Text)
    sort: Mapped[int] = mapped_column(Integer, default=0)


class KpiItem(Base):
    """One monthly row for one person: a numeric KPI target (kind='kpi') or a duty task without numbers (kind='duty').

    Both feed On-time and delays through their outcome. Only KPI rows with a numeric target and actual feed Achievement.
    """

    __tablename__ = "kpi_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    month_id: Mapped[int] = mapped_column(ForeignKey("kpi_months.id"))
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id"))
    kind: Mapped[str] = mapped_column(String(8))  # kpi | duty
    kpi_type_id: Mapped[int | None] = mapped_column(ForeignKey("kpi_types.id"))
    is_team: Mapped[bool] = mapped_column(default=False)
    title: Mapped[str] = mapped_column(Text)
    priority: Mapped[str | None] = mapped_column(String(10))
    start_date: Mapped[date | None] = mapped_column(Date)
    # Blank = due on the last day of the row's month (the normal case). Set only when a Manager picks an earlier date.
    target_date: Mapped[date | None] = mapped_column(Date)
    target_value: Mapped[float | None] = mapped_column(Float)
    target_text: Mapped[str | None] = mapped_column(String(200))
    per_day: Mapped[float | None] = mapped_column(Float)
    achieved_value: Mapped[float | None] = mapped_column(Float)
    outcome: Mapped[str | None] = mapped_column(String(16))  # None (not recorded) | Completed | Not completed
    completed_date: Mapped[date | None] = mapped_column(Date)
    delay_reason: Mapped[str | None] = mapped_column(Text)
    delay_reason_by: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"))
    delay_validated: Mapped[bool] = mapped_column(default=False)
    delay_validated_by: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"))
    remarks: Mapped[str | None] = mapped_column(Text)
    source: Mapped[str] = mapped_column(String(80), default="Entered in Finvasia Elevate")
    source_row: Mapped[int | None] = mapped_column(Integer)
    source_name: Mapped[str | None] = mapped_column(String(80))  # name as written in the tracker
    source_status: Mapped[str | None] = mapped_column(String(30))
    flags: Mapped[list] = mapped_column(JSON, default=list)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"))
    updated_by: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"))
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now_ist, onupdate=now_ist)
    version: Mapped[int] = mapped_column(Integer, default=1)
    removed_at: Mapped[datetime | None] = mapped_column(DateTime)  # removed from this month (kept for history)
    removed_by: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"))
    removed_reason: Mapped[str | None] = mapped_column(Text)
    illustrative: Mapped[bool] = mapped_column(default=False)  # demo values were written on this row

    kpi_type: Mapped[KpiType | None] = relationship()
    employee: Mapped[Employee] = relationship()
    month: Mapped[KpiMonth] = relationship()

    @property
    def due_date(self) -> date | None:
        """The due date in force: a Manager-set date, else the last day of the row's month."""
        if self.target_date:
            return self.target_date
        return month_last_day(self.month.month) if self.month else None


class TrainingModule(Base):
    """One training module for TWCS. Counts in the month its due date falls in. Retakes are attempts on the same module."""

    __tablename__ = "training_modules"

    id: Mapped[int] = mapped_column(primary_key=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id"))
    title: Mapped[str] = mapped_column(String(200))
    track: Mapped[str] = mapped_column(String(20))  # Technical | Functional | Behavioural | Leadership | Compliance
    assigned_date: Mapped[date] = mapped_column(Date)
    due_date: Mapped[date] = mapped_column(Date)
    completed_date: Mapped[date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(24), default="Assigned")
    attempts: Mapped[int] = mapped_column(Integer, default=1)
    note: Mapped[str | None] = mapped_column(Text)
    exemption_reason: Mapped[str | None] = mapped_column(Text)
    exemption_requested_by: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"))
    exemption_decided_by: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"))
    recorded_by: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"))  # who entered the completion
    verified_by: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"))
    verified_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"))
    illustrative: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_ist)

    employee: Mapped[Employee] = relationship()


class TrainingCatalogItem(Base):
    """Reusable training modules (title and track) for assigning to a team in one step."""

    __tablename__ = "training_catalog"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(200), unique=True)
    track: Mapped[str] = mapped_column(String(20))
    active: Mapped[bool] = mapped_column(default=True)
    illustrative: Mapped[bool] = mapped_column(default=False)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_ist)


class MonthlyEvaluation(Base):
    """The evaluator's ratings for one person and month: Draft -> Submitted -> Approved | Returned."""

    __tablename__ = "monthly_evaluations"
    __table_args__ = (UniqueConstraint("month_id", "employee_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    month_id: Mapped[int] = mapped_column(ForeignKey("kpi_months.id"))
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id"))
    csat_rating: Mapped[int | None] = mapped_column(Integer)
    quality_rating: Mapped[int | None] = mapped_column(Integer)
    compliance_rating: Mapped[int | None] = mapped_column(Integer)
    collaboration_rating: Mapped[int | None] = mapped_column(Integer)
    innovation_rating: Mapped[int | None] = mapped_column(Integer)
    # Rating-sheet values the Manager may enter (R&R parameter columns). Blank = use the value derived from records.
    on_time_count: Mapped[int | None] = mapped_column(Integer)
    delayed_count: Mapped[int | None] = mapped_column(Integer)
    achievement_pct: Mapped[float | None] = mapped_column(Float)
    twcs_score: Mapped[float | None] = mapped_column(Float)
    training_none_due: Mapped[bool] = mapped_column(default=False)
    comments: Mapped[str | None] = mapped_column(Text)
    state: Mapped[str] = mapped_column(String(12), default="Draft")
    updated_by: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"))
    submitted_by: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"))
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime)
    decided_by: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime)
    decision_note: Mapped[str | None] = mapped_column(Text)
    excluded_reason: Mapped[str | None] = mapped_column(Text)  # set when a month is locked without this person's approval
    illustrative: Mapped[bool] = mapped_column(default=False)
    version: Mapped[int] = mapped_column(Integer, default=1)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now_ist, onupdate=now_ist)


class ScorecardSnapshot(Base):
    """Frozen on lock. Never recalculated; later changes need a recorded correction."""

    __tablename__ = "scorecard_snapshots"
    __table_args__ = (UniqueConstraint("month_id", "employee_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    month_id: Mapped[int] = mapped_column(ForeignKey("kpi_months.id"))
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id"))
    rule_id: Mapped[int] = mapped_column(ForeignKey("scoring_rules.id"))
    data: Mapped[dict] = mapped_column(JSON)
    base: Mapped[float | None] = mapped_column(Float)
    coverage: Mapped[float] = mapped_column(Float)
    twcs: Mapped[float | None] = mapped_column(Float)
    final: Mapped[float | None] = mapped_column(Float)
    tier: Mapped[str | None] = mapped_column(String(10))
    status: Mapped[str] = mapped_column(String(20))  # scored | insufficient | not_evaluated
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_ist)


class CorrectionRequest(Base):
    """Fixing one person's result in a closed month: the HOD requests, an Admin approves, the Manager re-marks,
    the approver approves again, and the stored result is replaced with the old one kept beside it."""

    __tablename__ = "correction_requests"

    id: Mapped[int] = mapped_column(primary_key=True)
    month_id: Mapped[int] = mapped_column(ForeignKey("kpi_months.id"))
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id"))
    reason: Mapped[str] = mapped_column(Text)
    state: Mapped[str] = mapped_column(String(12), default="Requested")  # Requested | Open | Rejected | Completed
    requested_by: Mapped[int] = mapped_column(ForeignKey("accounts.id"))
    decided_by: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime)
    decision_note: Mapped[str | None] = mapped_column(Text)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime)
    old_result: Mapped[dict | None] = mapped_column(JSON)
    new_result: Mapped[dict | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_ist)


NOMINATION_AWARDS = ("Top performer", "Collaboration award", "Innovation award", "Customer impact award")


class MonthlyNomination(Base):
    """A recognition nomination for one person in a closed month: nominated with a citation, decided by someone else."""

    __tablename__ = "monthly_nominations"

    id: Mapped[int] = mapped_column(primary_key=True)
    month_id: Mapped[int] = mapped_column(ForeignKey("kpi_months.id"))
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id"))
    award: Mapped[str] = mapped_column(String(40))
    citation: Mapped[str] = mapped_column(Text)
    evidence: Mapped[str | None] = mapped_column(Text)
    nominated_by: Mapped[int] = mapped_column(ForeignKey("accounts.id"))
    state: Mapped[str] = mapped_column(String(12), default="Submitted")  # Submitted | Approved | Rejected
    decided_by: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime)
    decision_note: Mapped[str | None] = mapped_column(Text)
    illustrative: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_ist)
