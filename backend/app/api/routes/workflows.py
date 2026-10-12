from datetime import date

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select

from app.api.deps import Ctx, get_ctx
from app.core.errors import NotFound, RuleViolation
from app.models import Holiday, TemplateStage, WorkflowTemplate
from app.services.audit import record
from app.services.common import add_business_days, holidays
from app.services.templates import stage_conflicts, template_dict

router = APIRouter(tags=["workflows"])


class StagePatch(BaseModel):
    responsible_id: int | None = None
    accountable_id: int | None = None
    reviewer_id: int | None = None
    consulted: str | None = None
    informed: str | None = None
    sla_target_days: float | None = None
    sla_max_days: float | None = None
    reason: str


class HolidayIn(BaseModel):
    day: date
    name: str


@router.get("/templates")
def templates(ctx: Ctx = Depends(get_ctx)):
    return [template_dict(ctx.db, t) for t in ctx.db.scalars(select(WorkflowTemplate).order_by(WorkflowTemplate.name))]


@router.get("/templates/{template_id}")
def get_template(template_id: int, ctx: Ctx = Depends(get_ctx)):
    t = ctx.db.get(WorkflowTemplate, template_id)
    if t is None:
        raise NotFound("Template")
    return template_dict(ctx.db, t)


@router.patch("/templates/stages/{stage_id}")
def update_stage(stage_id: int, body: StagePatch, ctx: Ctx = Depends(get_ctx)):
    ctx.scope.require_role("admin")
    st = ctx.db.get(TemplateStage, stage_id)
    if st is None:
        raise NotFound("Stage")
    changes = body.model_dump(exclude_unset=True, exclude={"reason"})
    people = {k: changes.get(k, getattr(st, k)) for k in ("responsible_id", "accountable_id", "reviewer_id")}
    if people["reviewer_id"] and people["reviewer_id"] == people["responsible_id"]:
        raise RuleViolation("A reviewer cannot be the Responsible assignee.", "reviewer_id")
    if people["accountable_id"] and people["accountable_id"] == people["responsible_id"]:
        raise RuleViolation("One RACI letter per person per step: R and A must differ.", "accountable_id")
    old = {k: getattr(st, k) for k in changes}
    for k, v in changes.items():
        setattr(st, k, v)
    record(ctx.db, ctx.account.id, "update_template_stage", "template", st.template_id, st.name, old, changes, body.reason)
    ctx.db.commit()
    return template_dict(ctx.db, ctx.db.get(WorkflowTemplate, st.template_id))


@router.post("/templates/{template_id}/activate")
def activate(template_id: int, ctx: Ctx = Depends(get_ctx)):
    ctx.scope.require_role("admin")
    t = ctx.db.get(WorkflowTemplate, template_id)
    if t is None:
        raise NotFound("Template")
    conflicts = [f"Step {s.step}: {c}" for s in t.stages for c in stage_conflicts(s)]
    if conflicts:
        raise RuleViolation("Activation blocked. " + " ".join(conflicts[:5]), "stages", "activation_blocked")
    t.state = "Active"
    record(ctx.db, ctx.account.id, "activate_template", "template", t.id, t.name)
    ctx.db.commit()
    return template_dict(ctx.db, t)


@router.get("/calendar")
def calendar(ctx: Ctx = Depends(get_ctx)):
    return {
        "name": "Finvasia / India / IST",
        "working_week": "Monday-Friday",
        "work_window": "09:00-18:00 IST",
        "holidays": [{"id": h.id, "day": h.day, "name": h.name} for h in ctx.db.scalars(select(Holiday).order_by(Holiday.day))],
    }


@router.post("/calendar/holidays")
def add_holiday(body: HolidayIn, ctx: Ctx = Depends(get_ctx)):
    ctx.scope.require_role("admin")
    h = Holiday(day=body.day, name=body.name)
    ctx.db.add(h)
    record(ctx.db, ctx.account.id, "add_holiday", "calendar", None, body.name, None, body.model_dump())
    ctx.db.commit()
    return {"id": h.id, "day": h.day, "name": h.name}


@router.get("/calendar/preview")
def preview(start: date, days: float, ctx: Ctx = Depends(get_ctx)):
    return {"start": start, "business_days": days, "due": add_business_days(start, days, holidays(ctx.db))}
