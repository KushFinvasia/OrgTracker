from typing import Any

from sqlalchemy.orm import Session

from app.models import AuditEvent, Notification


def _clean(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: _clean(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_clean(v) for v in value]
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return value


def record(
    db: Session,
    actor_account_id: int | None,
    action: str,
    entity: str,
    entity_id: Any = None,
    label: str | None = None,
    old: dict | None = None,
    new: dict | None = None,
    reason: str | None = None,
) -> None:
    db.add(
        AuditEvent(
            actor_account_id=actor_account_id,
            action=action,
            entity=entity,
            entity_id=None if entity_id is None else str(entity_id),
            label=label,
            old=_clean(old),
            new=_clean(new),
            reason=reason,
        )
    )


def notify(db: Session, account_id: int | None, title: str, body: str | None = None, link: str | None = None) -> None:
    if account_id:
        db.add(Notification(account_id=account_id, title=title, body=body, link=link))
