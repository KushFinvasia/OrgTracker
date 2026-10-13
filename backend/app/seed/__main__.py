"""Reset a database and load the corrected workbook + illustrative demo layer.

Usage (from backend/):
    python -m app.seed                      # local SQLite dev database
    python -m app.seed --yes-wipe-database  # required for any non-SQLite database (e.g. Render Postgres)

WARNING: this DROPS every Orgtrack table in the target database before loading.
The workbook (PT_RR_Corrected_Data.xlsx) is not in git; keep it in the project root or set ORGTRACK_SEED_WORKBOOK.
"""

import sys

import app.models  # noqa: F401
from app.core.config import settings
from app.core.database import Base, SessionLocal, engine
from app.seed.demo import seed_demo
from app.seed.workbook import import_workbook


def main() -> None:
    if not settings.seed_workbook.exists():
        raise SystemExit(f"Workbook not found: {settings.seed_workbook}")
    is_sqlite = settings.database_url.startswith("sqlite")
    if not is_sqlite and "--yes-wipe-database" not in sys.argv:
        host = engine.url.host or "?"
        raise SystemExit(
            f"Refusing to wipe non-SQLite database on host '{host}'.\n"
            "Re-run with --yes-wipe-database if you really want to drop and reload every Orgtrack table."
        )
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        counts = import_workbook(db)
        demo = seed_demo(db)
        db.commit()
    print(f"Target: {engine.url.render_as_string(hide_password=True)}")
    print("Imported:", counts)
    print("Demo accounts (dev sign-in):")
    for email, role in demo["accounts"]:
        print(f"  {role:<10} {email}")


if __name__ == "__main__":
    main()
