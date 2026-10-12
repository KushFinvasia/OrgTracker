from datetime import date, datetime

from sqlalchemy import JSON, Date, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base

PERIOD_STATES = ("Open", "Calculating", "Under Review", "Locked")


class RuleVersion(Base):
    """Versioned scoring configuration. Score-affecting versions need a named author and a different approver."""

    __tablename__ = "rule_versions"

    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(20))  # kpi | training | reward
    label: Mapped[str] = mapped_column(String(40))
    config: Mapped[dict] = mapped_column(JSON)
    state: Mapped[str] = mapped_column(String(20), default="Draft")  # Draft | Pending approval | Approved | Returned
    summary: Mapped[str | None] = mapped_column(Text)
    author_account_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"))
    approver_account_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"))
    decision_note: Mapped[str | None] = mapped_column(Text)
    effective_from: Mapped[date | None] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime)


class Period(Base):
    __tablename__ = "periods"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(60))
    period_type: Mapped[str] = mapped_column(String(20))  # Monthly | Quarterly | Half-yearly | Annual
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date] = mapped_column(Date)
    department_id: Mapped[int | None] = mapped_column(ForeignKey("departments.id"))  # None = organisation
    kpi_rule_id: Mapped[int] = mapped_column(ForeignKey("rule_versions.id"))
    training_rule_id: Mapped[int | None] = mapped_column(ForeignKey("rule_versions.id"))
    evidence_cutoff: Mapped[datetime] = mapped_column(DateTime)
    state: Mapped[str] = mapped_column(String(20), default="Open")
    review_owner_id: Mapped[int | None] = mapped_column(ForeignKey("employees.id"))
    locked_by: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"))
    locked_at: Mapped[datetime | None] = mapped_column(DateTime)
    lock_reason: Mapped[str | None] = mapped_column(Text)


class MetricInput(Base):
    """Manual or batch source input (targets/actuals, CSAT, compliance attestation, capacity, innovation evidence)."""

    __tablename__ = "metric_inputs"

    id: Mapped[int] = mapped_column(primary_key=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id"))
    period_id: Mapped[int] = mapped_column(ForeignKey("periods.id"))
    metric: Mapped[str] = mapped_column(String(30))  # achievement | csat | compliance | capacity | innovation
    values: Mapped[dict] = mapped_column(JSON)
    evidence: Mapped[str | None] = mapped_column(Text)
    author_account_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"))
    validator_id: Mapped[int | None] = mapped_column(ForeignKey("employees.id"))
    state: Mapped[str] = mapped_column(String(12), default="Draft")  # Draft | Submitted | Validated | Returned
    decision_note: Mapped[str | None] = mapped_column(Text)
    illustrative: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    validated_at: Mapped[datetime | None] = mapped_column(DateTime)


class CheckIn(Base):
    __tablename__ = "check_ins"

    id: Mapped[int] = mapped_column(primary_key=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id"))
    period_id: Mapped[int] = mapped_column(ForeignKey("periods.id"))
    month: Mapped[date] = mapped_column(Date)  # first day of month
    quality_rating: Mapped[int | None] = mapped_column(Integer)
    collaboration_rating: Mapped[int | None] = mapped_column(Integer)
    innovation_rating: Mapped[int | None] = mapped_column(Integer)
    collaboration_evidence: Mapped[str | None] = mapped_column(Text)
    innovation_evidence: Mapped[str | None] = mapped_column(Text)
    development_note: Mapped[str | None] = mapped_column(Text)
    manager_account_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"))
    state: Mapped[str] = mapped_column(String(12), default="Draft")  # Draft | Finalized
    illustrative: Mapped[bool] = mapped_column(default=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, onupdate=datetime.now)


class Snapshot(Base):
    """Locked, reproducible evaluation. Never recalculated after lock."""

    __tablename__ = "snapshots"

    id: Mapped[int] = mapped_column(primary_key=True)
    period_id: Mapped[int] = mapped_column(ForeignKey("periods.id"))
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id"))
    data: Mapped[dict] = mapped_column(JSON)
    base_kpi: Mapped[float | None] = mapped_column(Float)
    coverage: Mapped[float] = mapped_column(Float)
    training_score: Mapped[float | None] = mapped_column(Float)
    final_score: Mapped[float | None] = mapped_column(Float)
    status: Mapped[str] = mapped_column(String(30))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)


class Override(Base):
    __tablename__ = "overrides"

    id: Mapped[int] = mapped_column(primary_key=True)
    period_id: Mapped[int] = mapped_column(ForeignKey("periods.id"))
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id"))
    metric: Mapped[str] = mapped_column(String(30))
    original_score: Mapped[float | None] = mapped_column(Float)
    new_score: Mapped[float] = mapped_column(Float)
    reason_category: Mapped[str] = mapped_column(String(60))
    reason: Mapped[str] = mapped_column(Text)
    evidence: Mapped[str] = mapped_column(Text)
    hod_account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)


class RewardCycle(Base):
    __tablename__ = "reward_cycles"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(120))
    period_id: Mapped[int] = mapped_column(ForeignKey("periods.id"))
    nomination_start: Mapped[date | None] = mapped_column(Date)
    nomination_end: Mapped[date | None] = mapped_column(Date)
    review_deadline: Mapped[date | None] = mapped_column(Date)
    gold_cap_enabled: Mapped[bool] = mapped_column(default=False)
    audience: Mapped[str] = mapped_column(String(120), default="Approved internal audience")
    owner_account_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"))
    state: Mapped[str] = mapped_column(String(20), default="Draft")  # Draft|Nominations|Review|Approved|Published
    published_at: Mapped[datetime | None] = mapped_column(DateTime)
    published_by: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)


AWARD_TYPES = ("Top Performer", "Collaboration award", "Innovation award", "Customer impact award")


class Nomination(Base):
    __tablename__ = "nominations"

    id: Mapped[int] = mapped_column(primary_key=True)
    cycle_id: Mapped[int] = mapped_column(ForeignKey("reward_cycles.id"))
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id"))
    snapshot_id: Mapped[int | None] = mapped_column(ForeignKey("snapshots.id"))
    award_type: Mapped[str] = mapped_column(String(60))
    citation: Mapped[str] = mapped_column(Text, default="")
    evidence: Mapped[str | None] = mapped_column(Text)
    nominator_account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"))
    reviewer_account_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"))
    state: Mapped[str] = mapped_column(String(12), default="Draft")  # Draft | Submitted | Approved | Returned
    decision_reason: Mapped[str | None] = mapped_column(Text)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
