"""Reset the dev database and load the corrected workbook + illustrative demo layer.

Usage:  python -m app.seed            (from backend/)
"""

import app.models  # noqa: F401
from app.core.config import settings
from app.core.database import Base, SessionLocal, engine
from app.seed.demo import seed_demo
from app.seed.workbook import import_workbook


def main() -> None:
    if not settings.seed_workbook.exists():
        raise SystemExit(f"Workbook not found: {settings.seed_workbook}")
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        counts = import_workbook(db)
        demo = seed_demo(db)
        db.commit()
    print("Imported:", counts)
    print("Demo accounts (dev sign-in):")
    for email, role in demo["accounts"]:
        print(f"  {role:<10} {email}")


if __name__ == "__main__":
    main()
