"""Rules studio: versioned weights, curves, mappings and the training policy.

Score-affecting changes need a named author and a different approver. Locked snapshots keep their versions.
"""

from datetime import date, datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select

from app.api.deps import Ctx, get_ctx
from app.core.errors import Forbidden, NotFound, RuleViolation
from app.models import Department, Employee, Period, RuleVersion
from app.schemas.common import DecisionIn
from app.services import scoring
from app.services.audit import record
from app.services.common import account_person, person
from app.services.evaluation import evaluate
from app.core.clock import now_ist

router = APIRouter(prefix="/rules", tags=["rules"])


class RuleIn(BaseModel):
    kind: str  # kpi | training | reward
    label: str
    config: dict
    summary: str
    effective_from: date | None = None


class MappingIn(BaseModel):
    department_id: int
    category: str
    reason: str


def rule_dict(ctx: Ctx, r: RuleVersion) -> dict:
    return {
        "id": r.id, "kind": r.kind, "label": r.label, "config": r.config, "state": r.state, "summary": r.summary,
        "author": account_person(ctx.db, r.author_account_id), "approver": account_person(ctx.db, r.approver_account_id),
        "decision_note": r.decision_note, "effective_from": r.effective_from, "created_at": r.created_at, "decided_at": r.decided_at,
        "can_decide": r.state == "Pending approval" and r.author_account_id != ctx.account.id and ctx.account.role in ("admin", "hod"),
    }


def validate_config(kind: str, cfg: dict) -> None:
    if kind == "kpi":
        for cat, weights in cfg.get("weights", {}).items():
            total = sum(weights.values())
            if round(total, 6) != 100:
                raise RuleViolation(f"{cat} weights total {total:g}%. Each category must total exactly 100%.", "weights")
        for name, anchors in cfg.get("anchors", {}).items():
            xs = [a[0] for a in anchors]
            if xs != sorted(xs) or len(set(xs)) != len(xs):
                raise RuleViolation(f"{name} anchors must be strictly increasing.", "anchors")
    elif kind == "training":
        bw, tw = cfg.get("base_weight"), cfg.get("training_weight")
        if bw is None or tw is None or round(bw + tw, 6) != 1:
            raise RuleViolation("Base KPI weight and training weight must total 100%.", "weights")
    elif kind == "reward":
        thresholds = [t[1] for t in cfg.get("tiers", [])]
        if thresholds != sorted(thresholds, reverse=True):
            raise RuleViolation("Tier thresholds must descend (Gold > Silver > Bronze).", "tiers")
    else:
        raise RuleViolation("Unknown rule kind.", "kind")


@router.get("")
def rules(ctx: Ctx = Depends(get_ctx)):
    return {
        "rules": [rule_dict(ctx, r) for r in ctx.db.scalars(select(RuleVersion).order_by(RuleVersion.kind, RuleVersion.id.desc()))],
        "metrics": scoring.METRIC_LABELS,
        "categories": scoring.CATEGORIES,
        "departments": [{"id": d.id, "name": d.name, "category": d.category, "category_proposed": d.category_proposed, "aliases": d.aliases, "notes": d.notes} for d in ctx.db.scalars(select(Department).order_by(Department.name))],
    }


@router.post("")
def create_rule(body: RuleIn, ctx: Ctx = Depends(get_ctx)):
    ctx.scope.require_role("admin")
    validate_config(body.kind, body.config)
    r = RuleVersion(**body.model_dump(), author_account_id=ctx.account.id, state="Draft")
    ctx.db.add(r)
    ctx.db.flush()
    record(ctx.db, ctx.account.id, "draft_rule", "rule", r.id, f"{r.kind} {r.label}", None, body.config)
    ctx.db.commit()
    return rule_dict(ctx, r)


@router.post("/{rule_id}/submit")
def submit_rule(rule_id: int, ctx: Ctx = Depends(get_ctx)):
    r = ctx.db.get(RuleVersion, rule_id)
    if r is None:
        raise NotFound("Rule")
    if r.author_account_id != ctx.account.id:
        raise Forbidden("Only the author submits a draft.")
    if r.state not in ("Draft", "Returned"):
        raise RuleViolation(f"Rule is {r.state}.", "state")
    r.state = "Pending approval"
    record(ctx.db, ctx.account.id, "submit_rule", "rule", r.id, f"{r.kind} {r.label}")
    ctx.db.commit()
    return rule_dict(ctx, r)


@router.post("/{rule_id}/decide")
def decide_rule(rule_id: int, body: DecisionIn, ctx: Ctx = Depends(get_ctx)):
    r = ctx.db.get(RuleVersion, rule_id)
    if r is None:
        raise NotFound("Rule")
    ctx.scope.require_role("admin", "hod")
    if r.author_account_id == ctx.account.id:
        raise RuleViolation("A different named person must approve score-affecting changes.", "decision")
    if r.state != "Pending approval":
        raise RuleViolation("Not awaiting approval.", "state")
    if body.decision not in ("approve", "return") or (body.decision == "return" and not body.reason):
        raise RuleViolation("Approve and activate, or return with a reason.", "reason")
    r.state = "Approved" if body.decision == "approve" else "Returned"
    r.approver_account_id = ctx.account.id
    r.decision_note = body.reason
    r.decided_at = now_ist()
    record(ctx.db, ctx.account.id, f"rule_{body.decision}", "rule", r.id, f"{r.kind} {r.label}", {"state": "Pending approval"}, {"state": r.state}, body.reason)
    ctx.db.commit()
    return rule_dict(ctx, r)


@router.get("/{rule_id}/impact")
def impact(rule_id: int, period_id: int | None = None, ctx: Ctx = Depends(get_ctx)):
    """Current vs proposed final for people in the viewer's performance scope."""
    r = ctx.db.get(RuleVersion, rule_id)
    if r is None:
        raise NotFound("Rule")
    p = ctx.db.get(Period, period_id) if period_id else ctx.db.scalar(select(Period).where(Period.training_rule_id == r.id)) or ctx.db.scalar(select(Period).order_by(Period.end_date.desc()))
    perf = ctx.scope.perf_people
    q = select(Employee).where(Employee.record_type == "employee")
    if p and p.department_id:
        q = q.where(Employee.department_id == p.department_id)
    if perf is not None:
        q = q.where(Employee.id.in_(perf))
    rows = []
    for e in list(ctx.db.scalars(q.limit(60))):
        ev = evaluate(ctx.db, e, p)
        base = ev["base"]
        proposed = None
        if r.kind == "training":
            proposed = scoring.final_rr(base, ev["training"], r.config)["value"]
        elif r.kind == "kpi":
            from app.services.evaluation import category_for

            cat, _ = category_for(e)
            rows_by_metric = {row["metric"]: scoring.MetricResult(row["metric"], row["available"], row["score"]) for row in base["rows"]}
            nb = scoring.base_kpi(rows_by_metric, r.config["weights"].get(cat, {}), r.config["minimums"]["coverage"])
            proposed = nb["value"]
        rows.append({"employee": person(e), "base": base["value"], "training": ev["training"]["score"], "current_final": base["value"], "proposed_final": proposed, "change": (proposed - base["value"]) if proposed is not None and base["value"] is not None else None, "status": "Insufficient" if not base["sufficient"] else "Ready"})
    return {"rule": rule_dict(ctx, r), "period": {"id": p.id, "name": p.name} if p else None, "rows": rows, "note": "Existing locked snapshots are unchanged. Activation applies only to the approved effective period."}


@router.post("/mappings")
def update_mapping(body: MappingIn, ctx: Ctx = Depends(get_ctx)):
    ctx.scope.require_role("admin")
    d = ctx.db.get(Department, body.department_id)
    if d is None:
        raise NotFound("Department")
    if body.category not in scoring.CATEGORIES:
        raise RuleViolation("Unknown category.", "category")
    old = {"category": d.category}
    d.category = body.category
    d.category_proposed = body.category == "Customer Service"
    record(ctx.db, ctx.account.id, "update_category_mapping", "department", d.id, d.name, old, {"category": body.category}, body.reason)
    ctx.db.commit()
    return {"id": d.id, "name": d.name, "category": d.category}
