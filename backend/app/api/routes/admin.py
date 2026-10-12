from datetime import date, datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import or_, select

from app.api.deps import Ctx, get_ctx
from app.core.errors import NotFound, RuleViolation
from app.models import AccessGrant, Account, AuditEvent, Employee, ImportBatch, Project, ReportingLine
from app.models.access import ROLES
from app.services.audit import record
from app.services.common import account_person, person, person_by_id

router = APIRouter(prefix="/admin", tags=["admin"])


def _admin(ctx: Ctx):
    ctx.scope.require_role("admin")


class AccountIn(BaseModel):
    employee_id: int
    email: str
    role: str
    reason: str = Field(min_length=3)


class AccountPatch(BaseModel):
    role: str | None = None
    active: bool | None = None
    reason: str = Field(min_length=3)


class GrantIn(BaseModel):
    account_id: int
    project_id: int
    permission: str  # read | edit
    reason: str = Field(min_length=3)
    starts_on: date
    expires_on: date


class TransferIn(BaseModel):
    employee_id: int
    new_manager_id: int
    new_department_id: int | None = None
    effective_from: date
    reason: str = Field(min_length=3)


SCOPE_PREVIEW = {
    "admin": {"work": "Authorised organisation administration", "performance": "Authorised administration scope", "decisions": "Accounts, imports, policies; second approval"},
    "hod": {"work": "Headed departments and permitted work", "performance": "Own headed departments", "decisions": "High closure, resource blockers, justified override"},
    "manager": {"work": "Reporting tree + permitted work projects", "performance": "Own reporting tree only", "decisions": "Configured reviews and validation"},
    "team_lead": {"work": "Own-team work, status and comments; allowed training updates", "performance": "Unavailable", "decisions": "No private score or check-in decisions"},
}


def account_dict(ctx: Ctx, a: Account) -> dict:
    return {"id": a.id, "email": a.email, "role": a.role, "active": a.active, "employee": person(a.employee), "scope_preview": SCOPE_PREVIEW.get(a.role), "created_at": a.created_at}


@router.get("/accounts")
def accounts(ctx: Ctx = Depends(get_ctx)):
    _admin(ctx)
    return {"accounts": [account_dict(ctx, a) for a in ctx.db.scalars(select(Account).order_by(Account.role, Account.email))], "scope_preview": SCOPE_PREVIEW}


@router.post("/accounts")
def create_account(body: AccountIn, ctx: Ctx = Depends(get_ctx)):
    _admin(ctx)
    if body.role not in ROLES:
        raise RuleViolation("Choose Admin, HOD, Manager or Team Lead.", "role")
    e = ctx.db.get(Employee, body.employee_id)
    if e is None or e.record_type != "employee":
        raise RuleViolation("Accounts link to one named employee. Vacant positions cannot have accounts.", "employee_id")
    if ctx.db.scalar(select(Account.id).where(or_(Account.employee_id == e.id, Account.email == body.email.lower()))):
        raise RuleViolation("This employee or email already has an account. No shared or duplicate accounts.", "email")
    a = Account(employee_id=e.id, email=body.email.strip().lower(), role=body.role, preferences={})
    ctx.db.add(a)
    ctx.db.flush()
    record(ctx.db, ctx.account.id, "provision_account", "account", a.id, a.email, None, {"role": a.role, "employee": e.code}, body.reason)
    ctx.db.commit()
    return account_dict(ctx, a)


@router.patch("/accounts/{account_id}")
def update_account(account_id: int, body: AccountPatch, ctx: Ctx = Depends(get_ctx)):
    _admin(ctx)
    a = ctx.db.get(Account, account_id)
    if a is None:
        raise NotFound("Account")
    if body.role and body.role not in ROLES:
        raise RuleViolation("Unknown role.", "role")
    old = {"role": a.role, "active": a.active}
    if body.role:
        a.role = body.role
    if body.active is not None:
        a.active = body.active
    record(ctx.db, ctx.account.id, "update_account", "account", a.id, a.email, old, {"role": a.role, "active": a.active}, body.reason)
    ctx.db.commit()
    return account_dict(ctx, a)


@router.get("/grants")
def grants(ctx: Ctx = Depends(get_ctx)):
    _admin(ctx)
    out = []
    for g in ctx.db.scalars(select(AccessGrant).order_by(AccessGrant.expires_on.desc())):
        p = ctx.db.get(Project, g.project_id)
        active = g.revoked_at is None and g.starts_on <= date.today() <= g.expires_on
        out.append({"id": g.id, "recipient": account_person(ctx.db, g.account_id), "project": {"id": p.id, "code": p.code, "title": p.title}, "permission": g.permission, "reason": g.reason, "starts_on": g.starts_on, "expires_on": g.expires_on, "granted_by": account_person(ctx.db, g.granted_by), "revoked_at": g.revoked_at, "active": active})
    return out


@router.post("/grants")
def create_grant(body: GrantIn, ctx: Ctx = Depends(get_ctx)):
    _admin(ctx)
    if body.permission not in ("read", "edit"):
        raise RuleViolation("Choose read or edit.", "permission")
    if body.expires_on < body.starts_on:
        raise RuleViolation("Expiry must be after the start.", "expires_on")
    g = AccessGrant(**body.model_dump(), granted_by=ctx.account.id)
    ctx.db.add(g)
    ctx.db.flush()
    record(ctx.db, ctx.account.id, "grant_work_access", "access_grant", g.id, f"project {body.project_id}", None, body.model_dump(), body.reason)
    ctx.db.commit()
    return {"id": g.id, "note": "Work grants never include private performance or training scores."}


@router.post("/grants/{grant_id}/revoke")
def revoke_grant(grant_id: int, ctx: Ctx = Depends(get_ctx)):
    _admin(ctx)
    g = ctx.db.get(AccessGrant, grant_id)
    if g is None:
        raise NotFound("Grant")
    g.revoked_at = datetime.now()
    record(ctx.db, ctx.account.id, "revoke_work_access", "access_grant", g.id)
    ctx.db.commit()
    return {"ok": True}


@router.get("/audit")
def audit(q: str | None = None, entity: str | None = None, limit: int = 200, ctx: Ctx = Depends(get_ctx)):
    _admin(ctx)
    query = select(AuditEvent)
    if entity:
        query = query.where(AuditEvent.entity == entity)
    if q:
        query = query.where(or_(AuditEvent.label.ilike(f"%{q}%"), AuditEvent.action.ilike(f"%{q}%")))
    return [
        {"id": e.id, "at": e.at, "actor": account_person(ctx.db, e.actor_account_id), "action": e.action, "entity": e.entity, "entity_id": e.entity_id, "label": e.label, "old": e.old, "new": e.new, "reason": e.reason}
        for e in ctx.db.scalars(query.order_by(AuditEvent.at.desc(), AuditEvent.id.desc()).limit(min(limit, 500)))
    ]


@router.get("/imports")
def imports(ctx: Ctx = Depends(get_ctx)):
    _admin(ctx)
    return [{"id": b.id, "source": b.source, "state": b.state, "summary": b.summary, "created_at": b.created_at, "created_by": account_person(ctx.db, b.created_by)} for b in ctx.db.scalars(select(ImportBatch).order_by(ImportBatch.created_at.desc()))]


@router.post("/imports/dry-run")
def dry_run(ctx: Ctx = Depends(get_ctx)):
    """Validates the corrected workbook without committing anything."""
    _admin(ctx)
    from app.seed.workbook import dry_run_report

    report = dry_run_report()
    b = ImportBatch(source=report["source"], state="dry_run", summary=report, created_by=ctx.account.id)
    ctx.db.add(b)
    record(ctx.db, ctx.account.id, "import_dry_run", "import", None, report["source"], None, report["counts"])
    ctx.db.commit()
    return report


@router.post("/transfers")
def transfer(body: TransferIn, ctx: Ctx = Depends(get_ctx)):
    """Effective-dated reporting transfer. Identity, work assignments and locked history persist."""
    _admin(ctx)
    e = ctx.db.get(Employee, body.employee_id)
    m = ctx.db.get(Employee, body.new_manager_id)
    if e is None or m is None:
        raise NotFound("Person")
    if m.id == e.id:
        raise RuleViolation("A person cannot report to themselves.", "new_manager_id")
    current = ctx.db.scalar(select(ReportingLine).where(ReportingLine.employee_id == e.id, ReportingLine.effective_to.is_(None)))
    if current:
        current.effective_to = body.effective_from
    ctx.db.add(ReportingLine(employee_id=e.id, manager_id=m.id, department_id=body.new_department_id or e.department_id, effective_from=body.effective_from, reason=body.reason))
    old = {"manager": e.manager_id, "department": e.department_id}
    if body.effective_from <= date.today():
        e.manager_id = m.id
        if body.new_department_id:
            e.department_id = body.new_department_id
    record(ctx.db, ctx.account.id, "reporting_transfer", "employee", e.id, e.full_name, old, body.model_dump(), body.reason)
    ctx.db.commit()
    return {"employee": person(e), "manager": person_by_id(ctx.db, e.manager_id), "note": "Review training applicability; inapplicable courses need an approved exemption."}
