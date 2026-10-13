import hmac

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import Ctx, get_ctx
from app.core.config import settings
from app.core.database import get_db
from app.core.security import create_token
from app.models import Account, Department, DepartmentHead
from app.schemas.common import LoginIn, PreferencesIn
from app.services.audit import record
from app.services.common import person

router = APIRouter(prefix="/auth", tags=["auth"])

ROLE_LABELS = {"admin": "Admin", "hod": "HOD", "manager": "Manager", "team_lead": "Team Lead"}


def account_payload(db: Session, acc: Account, scope=None) -> dict:
    headed = [
        d.name
        for d in db.scalars(select(Department).join(DepartmentHead, DepartmentHead.department_id == Department.id).where(DepartmentHead.employee_id == acc.employee_id))
    ]
    out = {
        "id": acc.id,
        "email": acc.email,
        "role": acc.role,
        "role_label": ROLE_LABELS.get(acc.role, acc.role),
        "employee": person(acc.employee),
        "preferences": acc.preferences or {},
        "headed_departments": headed if acc.role == "hod" else [],
    }
    if scope is not None:
        out["reporting_count"] = len(scope.reporting_tree)
        out["can_see_performance"] = acc.role != "team_lead"
    return out


def _code_ok(code: str | None) -> bool:
    if not settings.demo_access_code:
        return True
    return bool(code) and hmac.compare_digest(code, settings.demo_access_code)


@router.get("/config")
def auth_config():
    """Tells the sign-in page which fields to show. Reveals no account data."""
    return {"dev_login": settings.dev_login_enabled, "access_code_required": bool(settings.demo_access_code)}


@router.get("/dev-accounts")
def dev_accounts(db: Session = Depends(get_db), x_access_code: str | None = Header(default=None)):
    """Lists provisioned named accounts for the dev sign-in screen. Hidden without the demo access code when one is set."""
    if not settings.dev_login_enabled:
        raise HTTPException(404)
    if not _code_ok(x_access_code):
        raise HTTPException(401, detail={"message": "Enter the demo access code.", "code": "access_code"})
    return [account_payload(db, a) for a in db.scalars(select(Account).where(Account.active.is_(True)).order_by(Account.role))]


@router.post("/login")
def login(body: LoginIn, db: Session = Depends(get_db)):
    if not settings.dev_login_enabled:
        raise HTTPException(501, detail={"message": "Company SSO is not configured yet.", "code": "sso_missing"})
    if not _code_ok(body.access_code):
        raise HTTPException(401, detail={"message": "The demo access code is incorrect.", "code": "access_code", "field": "access_code"})
    acc = db.scalar(select(Account).where(Account.email == body.email.strip().lower(), Account.active.is_(True)))
    if acc is None:
        raise HTTPException(401, detail={"message": "No named account is provisioned for this email. Contact your administrator.", "code": "no_account"})
    record(db, acc.id, "sign_in", "account", acc.id, acc.email)
    db.commit()
    return {"token": create_token(acc.id), "account": account_payload(db, acc)}


@router.get("/me")
def me(ctx: Ctx = Depends(get_ctx)):
    return account_payload(ctx.db, ctx.account, ctx.scope)


@router.put("/preferences")
def save_preferences(body: PreferencesIn, ctx: Ctx = Depends(get_ctx)):
    old = ctx.account.preferences
    ctx.account.preferences = body.model_dump()
    record(ctx.db, ctx.account.id, "update_preferences", "account", ctx.account.id, ctx.account.email, old, ctx.account.preferences)
    ctx.db.commit()
    return ctx.account.preferences
