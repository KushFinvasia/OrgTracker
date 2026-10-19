from pathlib import Path

from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]
PROJECT_DIR = BACKEND_DIR.parent


def _default_workbook() -> Path:
    """Prefer the copy bundled for deployment (backend/seed_data), then the project-root source file."""
    bundled = BACKEND_DIR / "seed_data" / "PT_RR_Corrected_Data.xlsx"
    return bundled if bundled.exists() else PROJECT_DIR / "PT_RR_Corrected_Data.xlsx"


def _default_sales_tracker() -> Path:
    name = "Project Tracker Sales (Shoonya).xlsx"
    bundled = BACKEND_DIR / "seed_data" / name
    return bundled if bundled.exists() else PROJECT_DIR / name


def normalise_db_url(v: str) -> str:
    """Render and Heroku-style URLs use postgres:// or postgresql://; SQLAlchemy needs the psycopg 3 driver name."""
    if v.startswith("postgres://"):
        v = "postgresql://" + v[len("postgres://"):]
    if v.startswith("postgresql://"):
        v = "postgresql+psycopg://" + v[len("postgresql://"):]
    return v


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", env_prefix="ORGTRACK_", extra="ignore")

    app_name: str = "Finvasia Elevate API"
    environment: str = "development"  # development | production
    # Render injects DATABASE_URL when a Postgres instance is linked; ORGTRACK_DATABASE_URL also works.
    database_url: str = Field(
        default=f"sqlite:///{BACKEND_DIR / 'orgtrack.db'}",
        validation_alias=AliasChoices("ORGTRACK_DATABASE_URL", "DATABASE_URL"),
    )
    jwt_secret: str = "dev-only-change-me"
    jwt_algorithm: str = "HS256"
    jwt_expiry_minutes: int = 60 * 10
    # Dev sign-in issues a token for a provisioned named account by email.
    # Production must replace it with company SSO; it never creates accounts.
    dev_login_enabled: bool = True
    # When set, dev sign-in also requires this shared demo code, and the account list stays hidden until it is entered.
    # Use it for any internet-facing demo; leave empty only on a trusted local machine.
    demo_access_code: str = ""
    # Comma-separated exact origins, e.g. "https://orgtrack.vercel.app,http://localhost:5173".
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    # Optional regex for preview deployments, e.g. "https://orgtrack-.*\.vercel\.app".
    cors_origin_regex: str | None = None
    upload_dir: Path = BACKEND_DIR / "uploads"
    # Allowed evidence types/size are a pending policy decision; these are dev placeholders.
    upload_max_bytes: int = 10 * 1024 * 1024
    seed_workbook: Path = Field(default_factory=_default_workbook)
    # Individual Tier (Sales pilot) KPI source, imported once into an empty pilot.
    sales_tracker: Path = Field(default_factory=_default_sales_tracker)
    # Individual Tier demo data (Jul-Oct 2026, labelled and removable). Default: on outside production.
    individual_demo: bool | None = None
    # Load workbook + demo data at startup when the database has no employees.
    # Needed for SQLite on Render's free plan, whose disk is wiped on every deploy, restart and sleep.
    auto_seed: bool = False
    timezone: str = "Asia/Kolkata"

    @field_validator("database_url")
    @classmethod
    def _normalise_db_url(cls, v: str) -> str:
        return normalise_db_url(v)

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip().rstrip("/") for o in self.cors_origins.split(",") if o.strip()]

    @property
    def individual_demo_enabled(self) -> bool:
        return (not self.is_production) if self.individual_demo is None else self.individual_demo

    @property
    def is_production(self) -> bool:
        return self.environment.lower() == "production"


settings = Settings()

if settings.is_production and settings.jwt_secret == "dev-only-change-me":
    raise RuntimeError("Set ORGTRACK_JWT_SECRET in production.")
