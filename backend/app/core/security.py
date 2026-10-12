from datetime import datetime, timedelta, timezone

import jwt

from app.core.config import settings


def create_token(account_id: int) -> str:
    now = datetime.now(timezone.utc)
    payload = {"sub": str(account_id), "iat": now, "exp": now + timedelta(minutes=settings.jwt_expiry_minutes)}
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> int | None:
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        return int(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        return None
