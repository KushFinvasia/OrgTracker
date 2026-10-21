"""Named platform accounts that must exist in every environment.

These people are not in the 23-Aug-26 org chart, so they get their own Employee record (flagged for HRMS
confirmation) and one named account each. Runs at startup and after seeding; it is idempotent.

A renamed platform account keeps its identity: the same Account and Employee record (and so the same code, history
and permissions) take the new name and email. The earlier email is listed so existing databases are renamed in place
instead of gaining a second account; the change is written to the audit log once.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Account, Employee
from app.services.audit import record

PLATFORM_ACCOUNTS = [
    # (full name, email, role, designation, earlier emails of this same account)
    # Renamed from Kushagra Kataria (kushagra.kataria@shoonya.com) on 21 Oct 2026, user direction. "deepjoyt.tiwari" was an
    # interim misspelling of the same account (corrected the same day); databases holding it are renamed in place too.
    ("Deepjyot Tiwari", "deepjyot.tiwari@shoonya.com", "admin", "Finvasia Elevate platform administrator", ["kushagra.kataria@shoonya.com", "deepjoyt.tiwari@shoonya.com"]),
]


def _next_code(db: Session) -> str:
    codes = [c for c in db.scalars(select(Employee.code).where(Employee.code.like("EMP-%")))]
    nums = [int(c[4:]) for c in codes if c[4:].isdigit()]
    return f"EMP-{(max(nums) if nums else 0) + 1:04d}"


def _rename(db: Session, acc: Account, name: str, email: str) -> None:
    old = {"name": acc.employee.full_name, "email": acc.email}
    acc.email = email
    acc.employee.full_name = name
    db.flush()
    record(db, None, "rename_platform_account", "account", acc.id, name, old=old, new={"name": name, "email": email},
           reason="Platform account renamed (seed/platform.py)")


def ensure_platform_accounts(db: Session) -> list[str]:
    created = []
    for name, email, role, designation, previous in PLATFORM_ACCOUNTS:
        acc = db.scalar(select(Account).where(Account.email == email))
        if acc is None and previous:
            acc = db.scalar(select(Account).where(Account.email.in_(previous)))
            if acc is not None:
                _rename(db, acc, name, email)
        if acc is not None:
            if acc.employee.full_name != name:
                _rename(db, acc, name, email)
            continue
        emp = db.scalar(select(Employee).where(Employee.full_name == name, Employee.flags.like("%platform account%")))
        if emp is None:
            emp = Employee(
                code=_next_code(db),
                record_type="employee",
                full_name=name,
                designation=designation,
                flags="Not in org chart 23-Aug-26; platform account. Confirm HRMS record and department.",
            )
            db.add(emp)
            db.flush()
        db.add(Account(employee_id=emp.id, email=email, role=role, preferences={}))
        created.append(email)
    db.flush()
    return created
