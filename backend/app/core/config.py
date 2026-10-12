from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]
PROJECT_DIR = BACKEND_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", env_prefix="ORGTRACK_", extra="ignore")

    app_name: str = "Orgtrack API"
    database_url: str = f"sqlite:///{BACKEND_DIR / 'orgtrack.db'}"
    jwt_secret: str = "dev-only-change-me"
    jwt_algorithm: str = "HS256"
    jwt_expiry_minutes: int = 60 * 10
    # Dev sign-in issues a token for a provisioned named account by email.
    # Production must replace it with company SSO; it never creates accounts.
    dev_login_enabled: bool = True
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]
    upload_dir: Path = BACKEND_DIR / "uploads"
    # Allowed evidence types/size are a pending policy decision; these are dev placeholders.
    upload_max_bytes: int = 10 * 1024 * 1024
    seed_workbook: Path = PROJECT_DIR / "PT_RR_Corrected_Data.xlsx"
    timezone: str = "Asia/Kolkata"


settings = Settings()
