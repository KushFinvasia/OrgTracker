"""Business time. Finvasia works in India time, so "today", month boundaries, lateness and cut-offs use Asia/Kolkata,
whatever the server clock is set to (Render runs in UTC). Timestamps are stored as naive IST datetimes."""

from datetime import date, datetime
from zoneinfo import ZoneInfo

from app.core.config import settings

_TZ = ZoneInfo(settings.timezone)


def now_ist() -> datetime:
    return datetime.now(_TZ).replace(tzinfo=None)


def today_ist() -> date:
    return datetime.now(_TZ).date()


def month_last_day(d: date) -> date:
    """Last day of the month that `d` falls in."""
    nxt = date(d.year + (d.month == 12), d.month % 12 + 1, 1)
    return date.fromordinal(nxt.toordinal() - 1)
