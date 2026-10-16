"""Named platform accounts that must exist in every environment.

These people are not in the 23-Aug-26 org chart, so they get their own Employee record (flagged for HRMS
confirmation) and one named account each. Runs at startup and after seeding; it is idempotent.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Account, Employee

PLATFORM_ACCOUNTS = [
    # (full name, email, role, designation)
    ("Kushagra Kataria", "kushagra.kataria@shoonya.com", "admin", "Finvasia Elevate platform administrator"),
]


def _next_code(db: Session) -> str:
    codes = [c for c in db.scalars(select(Employee.code).where(Employee.code.like("EMP-%")))]
    nums = [int(c[4:]) for c in codes if c[4:].isdigit()]
    return f"EMP-{(max(nums) if nums else 0) + 1:04d}"


def ensure_platform_accounts(db: Session) -> list[str]:
    created = []
    for name, email, role, designation in PLATFORM_ACCOUNTS:
        if db.scalar(select(Account.id).where(Account.email == email)):
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
