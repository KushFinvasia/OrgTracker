from datetime import date, datetime

from sqlalchemy import JSON, Date, DateTime, ForeignKey, String, Text, event
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.org import Employee
from app.core.clock import now_ist

ROLES = ("admin", "hod", "manager", "team_lead")


class Account(Base):
    """A named account. Every account belongs to exactly one employee; there are no shared or employee logins."""

    __tablename__ = "accounts"

    id: Mapped[int] = mapped_column(primary_key=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id"), unique=True)
    email: Mapped[str] = mapped_column(String(160), unique=True)
    role: Mapped[str] = mapped_column(String(20))
    active: Mapped[bool] = mapped_column(default=True)
    preferences: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_ist)

    employee: Mapped[Employee] = relationship()


class AccessGrant(Base):
    """Expiring work grant. Never grants private performance or training-score scope."""

    __tablename__ = "access_grants"

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"))
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"))
    permission: Mapped[str] = mapped_column(String(20))  # read | edit
    reason: Mapped[str] = mapped_column(Text)
    starts_on: Mapped[date] = mapped_column(Date)
    expires_on: Mapped[date] = mapped_column(Date)
    granted_by: Mapped[int] = mapped_column(ForeignKey("accounts.id"))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime)


class AuditEvent(Base):
    """Append-only. Updates and deletes are rejected at the ORM layer."""

    __tablename__ = "audit_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    at: Mapped[datetime] = mapped_column(DateTime, default=now_ist)
    actor_account_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"))
    action: Mapped[str] = mapped_column(String(80))
    entity: Mapped[str] = mapped_column(String(60))
    entity_id: Mapped[str | None] = mapped_column(String(40))
    label: Mapped[str | None] = mapped_column(String(200))
    old: Mapped[dict | None] = mapped_column(JSON)
    new: Mapped[dict | None] = mapped_column(JSON)
    reason: Mapped[str | None] = mapped_column(Text)


@event.listens_for(AuditEvent, "before_update")
def _audit_no_update(*_):
    raise PermissionError("Audit events are append-only.")


@event.listens_for(AuditEvent, "before_delete")
def _audit_no_delete(*_):
    raise PermissionError("Audit events are append-only.")


class ImportBatch(Base):
    __tablename__ = "import_batches"

    id: Mapped[int] = mapped_column(primary_key=True)
    source: Mapped[str] = mapped_column(String(200))
    state: Mapped[str] = mapped_column(String(20))  # dry_run | committed
    summary: Mapped[dict] = mapped_column(JSON, default=dict)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_ist)


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"))
    title: Mapped[str] = mapped_column(String(200))
    body: Mapped[str | None] = mapped_column(Text)
    link: Mapped[str | None] = mapped_column(String(200))
    read_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_ist)
