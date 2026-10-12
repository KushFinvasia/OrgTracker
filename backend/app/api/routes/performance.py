from datetime import date, datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.api.deps import Ctx, get_ctx
from app.core.errors import Forbidden, NotFound, RuleViolation
from app.models import CheckIn, Department, DepartmentHead, Employee, MetricInput, Override, Period, RuleVersion, Snapshot
from app.models.performance import PERIOD_STATES
from app.schemas.common import DecisionIn
from app.services.audit import notify, record
from app.services.common import account_for_employee, account_person, person, person_by_id
from app.services.evaluation import category_for, evaluate, result_status

router = APIRouter(tags=["performance"])


class PeriodIn(BaseModel):
    name: str
    period_type: str
    start_date: date
    end_date: date
    department_id: int | None = None
    kpi_rule_id: int
    training_rule_id: int | None = None
    evidence_cutoff: datetime
    review_owner_id: int | None = None


class StateIn(BaseModel):
    state: str


class CheckInIn(BaseModel):
    employee_id: int
    period_id: int
    month: date
    quality_rating: int | None = Field(default=None, ge=1, le=5)
    collaboration_rating: int | None = Field(default=None, ge=1, le=5)
    innovation_rating: int | None = Field(default=None, ge=1, le=5)
    collaboration_evidence: str | None = None
    innovation_evidence: str | None = None
    development_note: str | None = None
    finalize: bool = False


class MetricInputIn(BaseModel):
    employee_id: int
    period_id: int
    metric: str  # achievement | csat | compliance | capacity | innovation | training_none
    values: dict
    evidence: str = Field(min_length=3)
    validator_id: int


class LockIn(BaseModel):
    reason: str = Field(min_length=3)
    confirm: bool


class OverrideIn(BaseModel):
    employee_id: int
    period_id: int
    metric: str
    new_score: float = Field(ge=0, le=100)
    reason_category: str
    reason: str = Field(min_length=3)
    evidence: str = Field(min_length=3)


def period_dict(ctx: Ctx, p: Period) -> dict:
    kpi = ctx.db.get(RuleVersion, p.kpi_rule_id)
    tr = ctx.db.get(RuleVersion, p.training_rule_id) if p.training_rule_id else None
    dept = ctx.db.get(Department, p.department_id) if p.department_id else None
    return {
        "id": p.id,
        "name": p.name,
        "period_type": p.period_type,
        "start_date": p.start_date,
        "end_date": p.end_date,
        "department": dept.name if dept else "Organisation",
        "department_id": p.department_id,
        "kpi_rule": {"id": kpi.id, "label": kpi.label, "state": kpi.state},
        "training_rule": {"id": tr.id, "label": tr.label, "state": tr.state} if tr else None,
        "evidence_cutoff": p.evidence_cutoff,
        "state": p.state,
        "review_owner": person_by_id(ctx.db, p.review_owner_id),
        "locked_by": account_person(ctx.db, p.locked_by),
        "locked_at": p.locked_at,
        "lock_reason": p.lock_reason,
    }


def _period(ctx: Ctx, period_id: int) -> Period:
    p = ctx.db.get(Period, period_id)
    if p is None:
        raise NotFound("Period")
    return p


def _scope_people(ctx: Ctx, p: Period) -> list[Employee]:
    perf = ctx.scope.perf_people
    q = select(Employee).where(Employee.record_type == "employee")
    if p.department_id:
        q = q.where(Employee.department_id == p.department_id)
    if perf is not None:
        q = q.where(Employee.id.in_(perf))
    elif ctx.scope.is_admin and not p.department_id:
        q = q.where(Employee.manager_id.is_not(None))
    return list(ctx.db.scalars(q.order_by(Employee.full_name)))


@router.get("/periods")
def periods(ctx: Ctx = Depends(get_ctx)):
    return [period_dict(ctx, p) for p in ctx.db.scalars(select(Period).order_by(Period.start_date.desc()))]


@router.post("/periods")
def create_period(body: PeriodIn, ctx: Ctx = Depends(get_ctx)):
    ctx.scope.require_role("admin", "hod", "manager")
    if body.period_type not in ("Monthly", "Quarterly", "Half-yearly", "Annual"):
        raise RuleViolation("Choose a period type.", "period_type")
    if body.end_date <= body.start_date:
        raise RuleViolation("End date must be after the start date.", "end_date")
    p = Period(**body.model_dump(), state="Open")
    ctx.db.add(p)
    ctx.db.flush()
    record(ctx.db, ctx.account.id, "create_period", "period", p.id, p.name, None, body.model_dump())
    ctx.db.commit()
    return period_dict(ctx, p)


@router.post("/periods/{period_id}/state")
def change_state(period_id: int, body: StateIn, ctx: Ctx = Depends(get_ctx)):
    p = _period(ctx, period_id)
    ctx.scope.require_role("admin", "hod", "manager")
    if body.state not in PERIOD_STATES or body.state == "Locked":
        raise RuleViolation("Use Confirm period lock to lock a period.", "state")
    if p.state == "Locked":
        raise RuleViolation("Locked periods are read-only. Use the correction process.", "state")
    old = p.state
    p.state = body.state
    record(ctx.db, ctx.account.id, "period_state", "period", p.id, p.name, {"state": old}, {"state": body.state})
    ctx.db.commit()
    return period_dict(ctx, p)


@router.get("/periods/{period_id}/team")
def team_results(period_id: int, ctx: Ctx = Depends(get_ctx)):
    p = _period(ctx, period_id)
    if ctx.account.role == "team_lead":
        raise Forbidden("Team Leads do not receive private KPI, check-in or training-score data.")
    rows = []
    for e in _scope_people(ctx, p):
        ev = evaluate(ctx.db, e, p)
        rows.append(
            {
                "employee": person(e),
                "category": ev["category"],
                "base_kpi": ev["base"]["value"],
                "base_preview": ev["base"]["preview"],
                "coverage": ev["base"]["coverage"],
                "training": {k: ev["training"][k] for k in ("allotted", "eligible", "verified", "pending_verification", "score", "status")},
                "final": ev["final"],
                "tier": ev["tier"],
                "checkin": ev["checkin"],
                "status": result_status(ev),
                "readiness": ev["readiness"],
                "locked": ev.get("locked", False),
            }
        )
    ready = sum(r["status"] == "Ready for review" for r in rows)
    return {
        "period": period_dict(ctx, p),
        "rows": rows,
        "summary": {
            "people": len(rows),
            "ready": ready,
            "insufficient": sum(r["status"] == "Insufficient data" for r in rows),
            "readiness_exceptions": sum(r["status"] == "Readiness exception" for r in rows),
            "checkins_finalized": sum(1 for r in rows if r["checkin"]),
            "training_pending": sum(r["training"]["pending_verification"] for r in rows),
        },
    }


@router.get("/evaluations/{employee_id}/{period_id}")
def evaluation(employee_id: int, period_id: int, ctx: Ctx = Depends(get_ctx)):
    ctx.scope.require_perf(employee_id)
    e = ctx.db.get(Employee, employee_id)
    if e is None:
        raise NotFound("Person")
    p = _period(ctx, period_id)
    ev = evaluate(ctx.db, e, p)
    ev["can_override"] = ctx.account.role == "hod" and e.department_id in ctx.scope.headed_departments and p.state != "Locked"
    ev["checkins"] = [checkin_dict(ctx, c) for c in ctx.db.scalars(select(CheckIn).where(CheckIn.employee_id == e.id, CheckIn.period_id == p.id).order_by(CheckIn.month.desc()))]
    ev["inputs"] = [input_dict(ctx, m) for m in ctx.db.scalars(select(MetricInput).where(MetricInput.employee_id == e.id, MetricInput.period_id == p.id).order_by(MetricInput.created_at.desc()))]
    return ev


# --- check-ins ----------------------------------------------------------------------------------


def checkin_dict(ctx: Ctx, c: CheckIn) -> dict:
    return {
        "id": c.id, "employee_id": c.employee_id, "period_id": c.period_id, "month": c.month,
        "quality_rating": c.quality_rating, "collaboration_rating": c.collaboration_rating, "innovation_rating": c.innovation_rating,
        "collaboration_evidence": c.collaboration_evidence, "innovation_evidence": c.innovation_evidence,
        "development_note": c.development_note, "state": c.state, "manager": account_person(ctx.db, c.manager_account_id),
        "updated_at": c.updated_at, "illustrative": c.illustrative,
    }


@router.post("/checkins")
def save_checkin(body: CheckInIn, ctx: Ctx = Depends(get_ctx)):
    ctx.scope.require_perf(body.employee_id)
    ctx.scope.require_role("manager", "hod", "admin")
    p = _period(ctx, body.period_id)
    if p.state == "Locked":
        raise RuleViolation("This period is locked.", "period_id")
    e = ctx.db.get(Employee, body.employee_id)
    category, _ = category_for(e)
    weights = ctx.db.get(RuleVersion, p.kpi_rule_id).config["weights"].get(category, {})
    data = body.model_dump(exclude={"finalize"})
    # Category-aware: unweighted ratings are not stored for this category.
    if not weights.get("innovation"):
        data["innovation_rating"] = None
        data["innovation_evidence"] = None
    if not weights.get("collaboration"):
        data["collaboration_rating"] = None
    if body.finalize:
        if weights.get("quality") and not data["quality_rating"]:
            raise RuleViolation("Quality rating is required for this category.", "quality_rating")
        if weights.get("collaboration"):
            if not data["collaboration_rating"]:
                raise RuleViolation("Collaboration rating is required.", "collaboration_rating")
            if data["collaboration_rating"] in (1, 2, 5) and not (data["collaboration_evidence"] or "").strip():
                raise RuleViolation("Collaboration ratings 1, 2 and 5 require evidence.", "collaboration_evidence")
        if weights.get("innovation") and data["innovation_rating"] and not (data["innovation_evidence"] or "").strip():
            raise RuleViolation("Innovation ratings require before/after evidence.", "innovation_evidence")
    month = body.month.replace(day=1)
    c = ctx.db.scalar(select(CheckIn).where(CheckIn.employee_id == body.employee_id, CheckIn.period_id == body.period_id, CheckIn.month == month))
    old = checkin_dict(ctx, c) if c else None
    if c is None:
        c = CheckIn(employee_id=body.employee_id, period_id=body.period_id, month=month)
        ctx.db.add(c)
    if c.state == "Finalized":
        raise RuleViolation("This check-in is finalized.", "state")
    for k, v in data.items():
        if k not in ("employee_id", "period_id", "month"):
            setattr(c, k, v)
    c.manager_account_id = ctx.account.id
    c.state = "Finalized" if body.finalize else "Draft"
    ctx.db.flush()
    record(ctx.db, ctx.account.id, "finalize_checkin" if body.finalize else "save_checkin", "checkin", c.id, f"{e.full_name} {month:%b %Y}", old, data)
    ctx.db.commit()
    return checkin_dict(ctx, c)


# --- source inputs ------------------------------------------------------------------------------


def input_dict(ctx: Ctx, m: MetricInput) -> dict:
    return {
        "id": m.id, "employee": person_by_id(ctx.db, m.employee_id), "period_id": m.period_id, "metric": m.metric,
        "values": m.values, "evidence": m.evidence, "author": account_person(ctx.db, m.author_account_id),
        "validator": person_by_id(ctx.db, m.validator_id), "state": m.state, "decision_note": m.decision_note,
        "created_at": m.created_at, "validated_at": m.validated_at, "illustrative": m.illustrative,
        "can_decide": m.validator_id == ctx.me and m.state == "Submitted" and m.author_account_id != ctx.account.id,
    }


@router.get("/metric-inputs")
def list_inputs(metric: str | None = None, period_id: int | None = None, ctx: Ctx = Depends(get_ctx)):
    q = select(MetricInput)
    perf = ctx.scope.perf_people
    if perf is not None:
        q = q.where((MetricInput.employee_id.in_(perf)) | (MetricInput.validator_id == ctx.me))
    if metric:
        q = q.where(MetricInput.metric == metric)
    if period_id:
        q = q.where(MetricInput.period_id == period_id)
    return [input_dict(ctx, m) for m in ctx.db.scalars(q.order_by(MetricInput.created_at.desc()).limit(200))]


@router.post("/metric-inputs")
def create_input(body: MetricInputIn, ctx: Ctx = Depends(get_ctx)):
    """Manual or batch entry; no live HRMS/LMS/CRM integration is assumed."""
    ctx.scope.require_perf(body.employee_id)
    if body.metric not in ("achievement", "csat", "compliance", "capacity", "innovation", "training_none"):
        raise RuleViolation("Unknown input type.", "metric")
    if body.validator_id in (ctx.me, body.employee_id):
        raise RuleViolation("Choose an independent validator.", "validator_id")
    p = _period(ctx, body.period_id)
    if p.state == "Locked":
        raise RuleViolation("This period is locked; use the correction process.", "period_id")
    v = body.values
    if body.metric == "achievement" and not v.get("target"):
        raise RuleViolation("An approved target is required.", "target")
    if body.metric == "csat" and (v.get("average") is None or not (1 <= float(v["average"]) <= 5)):
        raise RuleViolation("CSAT average must be between 1 and 5.", "average")
    if body.metric == "compliance" and not v.get("attested"):
        raise RuleViolation("Compliance needs an explicit period attestation.", "attested")
    m = MetricInput(**body.model_dump(), author_account_id=ctx.account.id, state="Submitted")
    ctx.db.add(m)
    ctx.db.flush()
    record(ctx.db, ctx.account.id, "submit_input", "metric_input", m.id, body.metric, None, body.model_dump())
    acc = account_for_employee(ctx.db, body.validator_id)
    notify(ctx.db, acc.id if acc else None, f"Validate {body.metric} input", link="/admin/workflows?tab=inputs")
    ctx.db.commit()
    return input_dict(ctx, m)


@router.post("/metric-inputs/{input_id}/decide")
def decide_input(input_id: int, body: DecisionIn, ctx: Ctx = Depends(get_ctx)):
    m = ctx.db.get(MetricInput, input_id)
    if m is None:
        raise NotFound("Input")
    if m.validator_id != ctx.me or m.author_account_id == ctx.account.id:
        raise Forbidden("Only the independent named validator can decide.")
    if m.state != "Submitted":
        raise RuleViolation("Already decided.", "state")
    if body.decision not in ("validate", "return") or (body.decision == "return" and not body.reason):
        raise RuleViolation("Validate, or return with a reason.", "reason")
    m.state = "Validated" if body.decision == "validate" else "Returned"
    m.decision_note = body.reason
    m.validated_at = datetime.now() if m.state == "Validated" else None
    record(ctx.db, ctx.account.id, f"input_{body.decision}", "metric_input", m.id, m.metric, None, {"state": m.state}, body.reason)
    ctx.db.commit()
    return input_dict(ctx, m)


# --- lock, snapshots, overrides -----------------------------------------------------------------


@router.get("/periods/{period_id}/lock-readiness")
def lock_readiness(period_id: int, ctx: Ctx = Depends(get_ctx)):
    p = _period(ctx, period_id)
    kpi = ctx.db.get(RuleVersion, p.kpi_rule_id)
    tr = ctx.db.get(RuleVersion, p.training_rule_id) if p.training_rule_id else None
    blockers = []
    if kpi.state != "Approved":
        blockers.append(f"KPI rule {kpi.label} is {kpi.state}; only approved rules can score a live lock.")
    if tr and tr.state != "Approved":
        blockers.append(f"Training policy {tr.label} is {tr.state}. Draft training policies cannot be used in a live lock.")
    people = list(ctx.db.scalars(select(Employee).where(Employee.record_type == "employee", Employee.department_id == p.department_id))) if p.department_id else []
    pending_inputs = ctx.db.scalars(select(MetricInput).where(MetricInput.period_id == p.id, MetricInput.state == "Submitted")).all()
    warnings = [f"{len(pending_inputs)} source input(s) still awaiting validation."] if pending_inputs else []
    return {"period": period_dict(ctx, p), "blockers": blockers, "warnings": warnings, "people_in_scope": len(people), "can_lock": not blockers and _can_lock(ctx, p)}


def _can_lock(ctx: Ctx, p: Period) -> bool:
    if ctx.scope.is_admin:
        return True
    return ctx.account.role == "hod" and p.department_id in ctx.scope.headed_departments


@router.post("/periods/{period_id}/lock")
def lock_period(period_id: int, body: LockIn, ctx: Ctx = Depends(get_ctx)):
    p = _period(ctx, period_id)
    if not _can_lock(ctx, p):
        raise Forbidden("Lock authority is the HOD of the period scope or an Admin.")
    if p.state == "Locked":
        raise RuleViolation("Already locked.", "state")
    readiness = lock_readiness(period_id, ctx)
    if readiness["blockers"]:
        raise RuleViolation(" ".join(readiness["blockers"]), "policy", "lock_blocked")
    if not body.confirm:
        raise RuleViolation("Confirm that results and exceptions were reviewed.", "confirm")
    q = select(Employee).where(Employee.record_type == "employee")
    if p.department_id:
        q = q.where(Employee.department_id == p.department_id)
    count = 0
    for e in ctx.db.scalars(q):
        ev = evaluate(ctx.db, e, p)
        ctx.db.add(Snapshot(period_id=p.id, employee_id=e.id, data=_jsonable(ev), base_kpi=ev["base"]["value"], coverage=ev["base"]["coverage"], training_score=ev["training"]["score"], final_score=ev["final"]["value"], status=result_status(ev)))
        count += 1
    p.state = "Locked"
    p.locked_by = ctx.account.id
    p.locked_at = datetime.now()
    p.lock_reason = body.reason
    record(ctx.db, ctx.account.id, "lock_period", "period", p.id, p.name, None, {"snapshots": count}, body.reason)
    ctx.db.commit()
    return {"period": period_dict(ctx, p), "snapshots": count}


def _jsonable(v):
    if isinstance(v, dict):
        return {k: _jsonable(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_jsonable(x) for x in v]
    if isinstance(v, (date, datetime)):
        return v.isoformat()
    return v


@router.get("/periods/{period_id}/snapshots")
def snapshots(period_id: int, ctx: Ctx = Depends(get_ctx)):
    q = select(Snapshot).where(Snapshot.period_id == period_id)
    perf = ctx.scope.perf_people
    if perf is not None:
        q = q.where(Snapshot.employee_id.in_(perf))
    return [
        {"id": s.id, "employee": person_by_id(ctx.db, s.employee_id), "base_kpi": s.base_kpi, "coverage": s.coverage, "training_score": s.training_score, "final_score": s.final_score, "status": s.status, "created_at": s.created_at}
        for s in ctx.db.scalars(q)
    ]


@router.post("/overrides")
def record_override(body: OverrideIn, ctx: Ctx = Depends(get_ctx)):
    """HOD-only, within headed departments, with reason and evidence. The original stays visible."""
    if ctx.account.role != "hod":
        raise Forbidden("Only a HOD can record a performance override.")
    e = ctx.db.get(Employee, body.employee_id)
    if e is None or e.department_id not in ctx.scope.headed_departments:
        raise Forbidden("Overrides are limited to your headed departments.")
    p = _period(ctx, body.period_id)
    if p.state == "Locked":
        raise RuleViolation("Locked periods follow the correction process instead of overrides.", "period_id")
    ev = evaluate(ctx.db, e, p)
    row = next((r for r in ev["base"]["rows"] if r["metric"] == body.metric), None)
    if row is None:
        raise RuleViolation("That metric is not weighted for this category.", "metric")
    o = Override(**body.model_dump(), original_score=row["score"], hod_account_id=ctx.account.id)
    ctx.db.add(o)
    record(ctx.db, ctx.account.id, "hod_override", "evaluation", f"{e.id}:{p.id}", f"{e.full_name} {body.metric}", {"score": row["score"]}, {"score": body.new_score}, body.reason)
    owner = account_for_employee(ctx.db, e.manager_id)
    notify(ctx.db, owner.id if owner else None, f"HOD override recorded for {e.full_name}", body.metric)
    ctx.db.commit()
    return evaluate(ctx.db, e, p)


@router.get("/heads/{department_id}")
def heads(department_id: int, ctx: Ctx = Depends(get_ctx)):
    return [person_by_id(ctx.db, h) for h in ctx.db.scalars(select(DepartmentHead.employee_id).where(DepartmentHead.department_id == department_id))]

