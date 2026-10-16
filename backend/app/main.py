import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, select

import app.models  # noqa: F401  (registers all tables)
from app.api.router import api_router
from app.core.config import settings
from app.core.database import Base, SessionLocal, engine
from app.models import Employee

log = logging.getLogger("orgtrack")


def auto_seed_if_empty() -> None:
    """Load the corrected workbook and demo layer into an empty database (ephemeral SQLite hosting)."""
    with SessionLocal() as db:
        if db.scalar(select(func.count()).select_from(Employee)):
            return
        if not settings.seed_workbook.exists():
            log.error("Auto-seed skipped: workbook not found at %s", settings.seed_workbook)
            return
        from app.seed.demo import seed_demo
        from app.seed.workbook import import_workbook

        counts = import_workbook(db)
        seed_demo(db)
        db.commit()
        # The Individual Tier pilot (Sales tracker, logins) is added by ensure_platform_accounts_on_start.
        log.warning("Auto-seeded empty database from %s: %s", settings.seed_workbook.name, counts)


def ensure_platform_accounts_on_start() -> None:
    from app.seed.platform import ensure_platform_accounts
    from app.seed.sales import ensure_individual_tier

    with SessionLocal() as db:
        if not db.scalar(select(func.count()).select_from(Employee)):
            return  # nothing seeded yet; accounts are added together with the seed
        created = ensure_platform_accounts(db)
        pilot = ensure_individual_tier(db)
        db.commit()
        if created:
            log.warning("Provisioned platform accounts: %s", ", ".join(created))
        if pilot.get("import"):
            log.warning("Imported the Sales tracker for the Individual Tier: %s", {k: v for k, v in pilot["import"].items() if k != "unmatched"})
        if pilot.get("accounts"):
            log.warning("Provisioned Sales pilot accounts: %s", ", ".join(pilot["accounts"]))


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(engine)
    from app.core.schema_patch import add_missing_columns

    added = add_missing_columns(engine)
    if added:
        log.warning("Added columns: %s", ", ".join(added))
    if settings.auto_seed:
        auto_seed_if_empty()
    ensure_platform_accounts_on_start()
    yield


def create_app() -> FastAPI:
    application = FastAPI(title=settings.app_name, version="0.1.0", lifespan=lifespan)
    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_origin_regex=settings.cors_origin_regex,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    application.include_router(api_router)

    @application.get("/api/health")
    def health():
        return {"status": "ok"}

    return application


app = create_app()
