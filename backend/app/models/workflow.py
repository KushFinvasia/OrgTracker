from datetime import date

from sqlalchemy import Date, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class WorkflowTemplate(Base):
    __tablename__ = "workflow_templates"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    description: Mapped[str | None] = mapped_column(Text)
    sla_target_days: Mapped[float | None] = mapped_column(Float)
    sla_max_days: Mapped[float | None] = mapped_column(Float)
    effort_min_hours: Mapped[float | None] = mapped_column(Float)
    effort_max_hours: Mapped[float | None] = mapped_column(Float)
    state: Mapped[str] = mapped_column(String(20), default="Draft")  # Draft | Active

    stages: Mapped[list["TemplateStage"]] = relationship(order_by="TemplateStage.step", cascade="all, delete-orphan")


class TemplateStage(Base):
    """One step. Responsible -> assignees, Accountable -> exactly one named person, validation owner -> independent reviewer."""

    __tablename__ = "template_stages"

    id: Mapped[int] = mapped_column(primary_key=True)
    template_id: Mapped[int] = mapped_column(ForeignKey("workflow_templates.id"))
    step: Mapped[int] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String(120))
    depends_on_step: Mapped[int | None] = mapped_column(Integer)
    responsible_role: Mapped[str | None] = mapped_column(String(200))
    responsible_id: Mapped[int | None] = mapped_column(ForeignKey("employees.id"))
    accountable_label: Mapped[str | None] = mapped_column(String(200))
    accountable_id: Mapped[int | None] = mapped_column(ForeignKey("employees.id"))
    consulted: Mapped[str | None] = mapped_column(String(250))
    informed: Mapped[str | None] = mapped_column(String(250))
    checklist: Mapped[str | None] = mapped_column(Text)
    reviewer_label: Mapped[str | None] = mapped_column(String(250))
    reviewer_id: Mapped[int | None] = mapped_column(ForeignKey("employees.id"))
    review_criteria: Mapped[str | None] = mapped_column(Text)
    required_evidence: Mapped[str | None] = mapped_column(Text)
    sla_target_days: Mapped[float | None] = mapped_column(Float)
    sla_max_days: Mapped[float | None] = mapped_column(Float)
    effort_min_hours: Mapped[float | None] = mapped_column(Float)
    effort_max_hours: Mapped[float | None] = mapped_column(Float)
    mitigation: Mapped[str | None] = mapped_column(Text)
    source_flags: Mapped[str | None] = mapped_column(Text)


class Holiday(Base):
    __tablename__ = "holidays"

    id: Mapped[int] = mapped_column(primary_key=True)
    day: Mapped[date] = mapped_column(Date, unique=True)
    name: Mapped[str] = mapped_column(String(120))
