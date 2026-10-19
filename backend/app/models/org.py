from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.core.clock import now_ist


class Department(Base):
    __tablename__ = "departments"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True)
    # Core Revenue | Revenue-Enabling | Support | Customer Service (Customer Service is a proposed category)
    category: Mapped[str] = mapped_column(String(40))
    category_proposed: Mapped[bool] = mapped_column(default=False)
    aliases: Mapped[str | None] = mapped_column(String(255))
    notes: Mapped[str | None] = mapped_column(Text)


class DepartmentHead(Base):
    """One person can head several departments (e.g. Pawan Kumar heads Demat, Operations & BO and Compliance)."""

    __tablename__ = "department_heads"

    id: Mapped[int] = mapped_column(primary_key=True)
    department_id: Mapped[int] = mapped_column(ForeignKey("departments.id"))
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id"))


class Employee(Base):
    """Employee master. Vacant/unnamed boxes are separate Position records (record_type='position')."""

    __tablename__ = "employees"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(20), unique=True)  # EMP-/POS- placeholder until HRMS codes arrive
    hrms_code: Mapped[str | None] = mapped_column(String(40))
    record_type: Mapped[str] = mapped_column(String(10), default="employee")  # employee | position
    full_name: Mapped[str] = mapped_column(String(120))
    designation: Mapped[str | None] = mapped_column(String(120))
    department_id: Mapped[int | None] = mapped_column(ForeignKey("departments.id"))
    manager_id: Mapped[int | None] = mapped_column(ForeignKey("employees.id"))  # current effective HR line
    level: Mapped[int | None] = mapped_column(Integer)
    proposed_role: Mapped[str | None] = mapped_column(String(40))
    flags: Mapped[str | None] = mapped_column(Text)
    role_start_date: Mapped[date | None] = mapped_column(Date)  # used by the 60-days-in-role gate; None = unknown
    disciplinary_flag: Mapped[str | None] = mapped_column(String(20))  # None = not attested | "clear" | "active"

    department: Mapped[Department | None] = relationship(foreign_keys=[department_id])
    manager: Mapped["Employee | None"] = relationship(remote_side=[id], foreign_keys=[manager_id])


class ReportingLine(Base):
    """Effective-dated reporting history. Transfers append rows; identity never changes."""

    __tablename__ = "reporting_lines"

    id: Mapped[int] = mapped_column(primary_key=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id"))
    manager_id: Mapped[int | None] = mapped_column(ForeignKey("employees.id"))
    department_id: Mapped[int | None] = mapped_column(ForeignKey("departments.id"))
    effective_from: Mapped[date] = mapped_column(Date)
    effective_to: Mapped[date | None] = mapped_column(Date)
    reason: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_ist)
