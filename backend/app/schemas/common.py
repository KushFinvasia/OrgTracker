from datetime import date

from pydantic import BaseModel, Field


class LoginIn(BaseModel):
    email: str | None = None
    # Development sign-in shortcut: sign in as the first active demo account with this role.
    demo_role: str | None = None
    access_code: str | None = None


class PreferencesIn(BaseModel):
    landing: str = "/home"
    digest: str = "Daily / 09:00 IST"
    density: str = "Comfortable"
    work_review_alerts: str = "In-app + email"
    training_reminders: str = "7 days and 1 day before due"
    keyboard_shortcuts: bool = True


class DecisionIn(BaseModel):
    decision: str  # approve | return | reject | validate | verify
    reason: str | None = None


class WeeklyRow(BaseModel):
    id: int
    version: int
    status: str | None = None
    progress: int | None = Field(default=None, ge=0, le=100)
    next_action: str | None = None


class WeeklyUpdateIn(BaseModel):
    rows: list[WeeklyRow]


class DateRange(BaseModel):
    start: date
    end: date
