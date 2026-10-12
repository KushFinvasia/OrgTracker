"""Shared helpers: serialisers for people, derived timing/health and business-day calendar."""

from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Account, Employee, Holiday

DUE_SOON_DAYS = 3


def today() -> date:
    return date.today()


def initials(name: str) -> str:
    parts = [p for p in name.replace("(", " ").split() if p[:1].isalpha()]
    return "".join(p[0] for p in parts[:2]).upper() or "?"


def person(e: Employee | None) -> dict | None:
    if e is None:
        return None
    return {
        "id": e.id,
        "code": e.code,
        "name": e.full_name,
        "designation": e.designation,
        "department": e.department.name if e.department else None,
        "initials": initials(e.full_name),
        "record_type": e.record_type,
    }


def person_by_id(db: Session, emp_id: int | None) -> dict | None:
    return person(db.get(Employee, emp_id)) if emp_id else None


def account_person(db: Session, account_id: int | None) -> dict | None:
    if not account_id:
        return None
    acc = db.get(Account, account_id)
    return person(acc.employee) if acc else None


def account_for_employee(db: Session, emp_id: int | None) -> Account | None:
    if not emp_id:
        return None
    return db.scalar(select(Account).where(Account.employee_id == emp_id, Account.active.is_(True)))


def task_timing(status: str, due: date | None, accepted_on: date | None, ref: date | None = None, submitted_on: date | None = None) -> str:
    """Derived lateness. 'Delayed' is never a stored status.
    Work waiting for review is judged by its submission date, so reviewer waiting time never makes it late."""
    ref = ref or today()
    if due is None:
        return "No deadline"
    if status == "Completed" and accepted_on:
        return "On time" if accepted_on <= due else "Late"
    if status == "In Review":
        if submitted_on:
            return "Submitted on time" if submitted_on <= due else "Submitted late"
        return "Awaiting review"
    if status in ("Cancelled", "On Hold"):
        return "Not scheduled"
    if due < ref:
        return "Overdue"
    if (due - ref).days <= DUE_SOON_DAYS:
        return "Due soon"
    return "On time"


def holidays(db: Session) -> set[date]:
    return set(db.scalars(select(Holiday.day)))


def add_business_days(start: date, days: float, hols: set[date]) -> date:
    remaining = int(round(days))
    d = start
    while remaining > 0:
        d += timedelta(days=1)
        if d.weekday() < 5 and d not in hols:
            remaining -= 1
    return d


def business_days_between(a: date, b: date, hols: set[date]) -> int:
    n, d = 0, a
    while d < b:
        d += timedelta(days=1)
        if d.weekday() < 5 and d not in hols:
            n += 1
    return n
