"""Project R&R routes: charter, RACI, SLAs, delays, inputs, scorecard, recognition and the PR-1 policy.

Independence: the champion never validates delays, confirms value or locks alone; validators hold the matching function and
aren't the author; Panel members in the project RACI can't approve or publish its scorecard; no one sets their own adjustment.
"""

from datetime import date

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.api.deps import Ctx, get_ctx
from app.core.clock import now_ist
from app.core.errors import Forbidden, NotFound, RuleViolation
from app.models import (
    BaselineChange,
    Employee,
    Project,
    ProjectCharter,
    ProjectDelay,
    ProjectDispute,
    ProjectRaci,
    ProjectRrInput,
    ProjectSla,
    Task,
)
from app.models.project_rr import CHARTER_MODES, INPUT_KINDS, PROJECT_TYPES, RR_FUNCTIONS
from app.services import project_rr as rr
from app.services import project_scoring as ps
from app.services.audit import record
from app.services.common import account_person, holidays, person_by_id, require_named, today

router = APIRouter(tags=["project-rr"])


# --- helpers ------------------------------------------------------------------------------------------------------------


def _project(ctx: Ctx, project_id: int) -> Project:
    p = ctx.db.get(Project, project_id)
    if p is None:
        raise NotFound("Project")
    ctx.scope.require_project(p.id)
    return p


def _charter(ctx: Ctx, p: Project) -> ProjectCharter:
    c = rr.charter_for(ctx.db, p.id)
    if c is None:
        raise NotFound("Project R&R charter")
    return c


def _log(c: ProjectCharter, ctx: Ctx, event: str, note: str | None = None) -> None:
    c.history = [*(c.history or []), {"at": now_ist().isoformat(timespec="minutes"), "event": event, "actor": ctx.employee.full_name, "note": note}]


def _can_edit_charter(ctx: Ctx, p: Project, c: ProjectCharter) -> bool:
    return ctx.scope.is_admin or ctx.me == c.champion_id or ctx.scope.can_manage_project(p)


def _require_draft(c: ProjectCharter) -> None:
    if c.state == "Locked":
        raise RuleViolation("The baseline is locked. Changes go through a baseline change request.", "state")
    if c.state == "Submitted":
        raise RuleViolation("The charter is waiting for sponsor and PMO approval. It can change again if it is returned.", "state")


def _require_scoring_open(c: ProjectCharter) -> None:
    """The Panel approves one set of inputs: after that, or once published, delays and inputs no longer change."""
    if c.frozen:
        raise RuleViolation("The scorecard is published and frozen. Raise a dispute instead.", "state")
    if c.stage == "Panel approved":
        raise RuleViolation("The Panel has approved this scorecard, so its delays and inputs no longer change.", "state")


def _parse_day(text: str | None, field: str):
    try:
        return date.fromisoformat(text) if text else None
    except ValueError as exc:
        raise RuleViolation("Enter a valid date.", field) from exc


def _redact_bundle(ctx: Ctx, card: dict) -> None:
    """₹ inputs stay with Admin, Panel and Finance; contribution adjustments follow private performance scope."""
    money = rr.sees_money(ctx)
    if not money:
        card["charter"]["pool_rate"] = None
    if not money and not rr.has_fn(ctx, "Finance confirmer"):
        for i in card["inputs"]:
            if i["kind"] == "value_actual":
                i["display"], i["value"] = "Hidden for your role", {}
    for r in card["raci"]:
        if not (r["person"] and ctx.scope.can_see_perf(r["person"]["id"])):
            r["adjustment"] = None


def _require_fn(ctx: Ctx, fn: str) -> None:
    if not rr.has_fn(ctx, fn):
        raise Forbidden(f"This needs the {fn} function on your account.")


def _bundle(ctx: Ctx, p: Project, c: ProjectCharter) -> dict:
    db = ctx.db
    ref = today()
    card = rr.compute(db, p, c)
    delays = list(db.scalars(select(ProjectDelay).where(ProjectDelay.project_id == p.id).order_by(ProjectDelay.id)))
    logged = {d.task_id for d in delays}
    late = [] if c.mode == "programme" else [rr.late_task_dict(db, t, ref) for t in rr.task_timelines(db, p.id, ref)["late"] if t.id not in logged]
    runs = rr.runs_for(db, p, ref) if c.mode == "programme" else []
    can_edit = _can_edit_charter(ctx, p, c)
    out = {
        "charter": rr.charter_dict(db, p, c),
        "stage": card["stage"],
        "raci": [rr.raci_dict(db, r) for r in rr.raci_rows(db, p.id)],
        "programme_raci": rr.programme_raci(db, p, c) if c.mode == "programme" else None,
        "stages": rr.stage_rows(db, p, c) if c.mode == "programme" else [],
        "slas": [{"id": s.id, "name": s.name, "kind": s.kind, "tat": s.tat} for s in db.scalars(select(ProjectSla).where(ProjectSla.project_id == p.id).order_by(ProjectSla.id))],
        "lock_checklist": rr.lock_checklist(db, p, c) if c.state != "Locked" else [],
        "delays": [rr.delay_dict(db, d) for d in delays],
        "late_tasks": late,
        "runs": runs,
        "stage_counts": rr.stage_task_counts(runs) if runs else None,
        "baseline_changes": [{"id": b.id, "task_label": b.task_label, "requested_date": b.requested_date, "reason": b.reason, "state": b.state, "requested_by": account_person(db, b.requested_by)} for b in db.scalars(select(BaselineChange).where(BaselineChange.project_id == p.id).order_by(BaselineChange.id))],
        "disputes": [{"id": x.id, "subject": x.subject, "grounds": x.grounds, "state": x.state, "raised_by": account_person(db, x.raised_by), "created_at": x.created_at} for x in db.scalars(select(ProjectDispute).where(ProjectDispute.project_id == p.id))],
        "inputs": [rr.input_dict(db, i) for i in db.scalars(select(ProjectRrInput).where(ProjectRrInput.project_id == p.id).order_by(ProjectRrInput.id))],
        "scorecard": rr.redact(ctx, card),
        "reasons": ps.DELAY_REASONS,
        "permissions": {
            "edit_charter": can_edit and c.state == "Draft",
            "log_delay": ctx.scope.is_admin or ctx.scope.can_manage_project(p),
            "request_baseline_change": can_edit and c.state == "Locked",
            "sponsor": ctx.me != c.champion_id and (ctx.scope.is_admin or p.department_id in ctx.scope.headed_departments),
            "pmo": rr.has_fn(ctx, "PMO validator") and ctx.me != c.champion_id,
            "hr": rr.has_fn(ctx, "HR calibrator") and not rr.in_raci(db, p.id, ctx.me),
            "panel": rr.has_fn(ctx, "R&R Panel member") and not rr.in_raci(db, p.id, ctx.me),
            "money": rr.sees_money(ctx),
            "functions": sorted(rr.functions_of(ctx.account)),
        },
    }
    _redact_bundle(ctx, out)
    return out


# --- read ---------------------------------------------------------------------------------------------------------------


@router.get("/projects/{project_id}/rr")
def get_rr(project_id: int, ctx: Ctx = Depends(get_ctx)):
    p = _project(ctx, project_id)
    c = rr.charter_for(ctx.db, p.id)
    if c is None:
        return {"enrolled": False, "can_enrol": ctx.scope.is_admin}
    return {"enrolled": True, **_bundle(ctx, p, c)}


@router.get("/recognition")
def recognition(ctx: Ctx = Depends(get_ctx)):
    ids = ctx.scope.visible_project_ids
    rows = []
    for c in ctx.db.scalars(select(ProjectCharter).order_by(ProjectCharter.id)):
        if ids is not None and c.project_id not in ids:
            continue
        rows.append(rr.recognition_row(ctx, ctx.db.get(Project, c.project_id), c))
    scored = [r for r in rows if r["score"] is not None]
    bands = {b: sum(1 for r in scored if r["band"] == b) for b in ps.BANDS}
    pol = rr.policy(ctx.db)
    ctx.db.commit()
    return {
        "rows": rows,
        "bands": bands,
        "scored": len(scored),
        "average": sum(r["score"] for r in scored) / len(scored) if scored else None,
        "programmes": sum(1 for r in rows if r["mode"] == "programme"),
        "pool_total": sum(r["pool"] or 0 for r in rows) if rr.sees_money(ctx) else None,
        "money_visible": rr.sees_money(ctx),
        "queue": rr.queue(ctx),
        "functions": sorted(rr.functions_of(ctx.account)),
        "policy_state": pol.state,
    }


@router.get("/rr/queue")
def rr_queue(ctx: Ctx = Depends(get_ctx)):
    return rr.queue(ctx)


# --- enrolment and charter --------------------------------------------------------------------------------------------


class EnrolIn(BaseModel):
    mode: str = "closure"
    project_type: str = "Standard"
    sponsor: str | None = None


@router.post("/projects/{project_id}/rr/enrol")
def enrol(project_id: int, body: EnrolIn, ctx: Ctx = Depends(get_ctx)):
    """Admin adds a project to the pilot. A charter draft opens: value target, baseline, RACI and SLAs."""
    ctx.scope.require_role("admin")
    p = _project(ctx, project_id)
    if rr.charter_for(ctx.db, p.id):
        raise RuleViolation("This project is already in the Project R&R scheme.", "project")
    if body.mode not in CHARTER_MODES or body.project_type not in PROJECT_TYPES:
        raise RuleViolation("Choose closure or programme scoring and a project type.", "mode")
    if body.mode == "programme" and not p.template_id:
        raise RuleViolation("Programme scoring is for recurring template work; this project has no workflow template.", "mode")
    c = ProjectCharter(project_id=p.id, mode=body.mode, project_type=body.project_type, sponsor=body.sponsor, champion_id=p.owner_id, state="Draft", stage="Charter draft", history=[])
    ctx.db.add(c)
    if body.mode == "closure":
        if p.owner_id:
            ctx.db.add(ProjectRaci(project_id=p.id, employee_id=p.owner_id, letter="A", note="Champion"))
        seen = {p.owner_id}
        for t in ctx.db.scalars(select(Task).where(Task.project_id == p.id)):
            for a in t.assignments:
                if a.employee_id not in seen:
                    seen.add(a.employee_id)
                    ctx.db.add(ProjectRaci(project_id=p.id, employee_id=a.employee_id, letter="R", factor=1.0, note="From task assignments · confirm the factor"))
    _log(c, ctx, "Added to the Project R&R pilot", body.mode)
    record(ctx.db, ctx.account.id, "rr_enrol", "project", p.id, p.title, None, body.model_dump())
    ctx.db.commit()
    return {"enrolled": True, **_bundle(ctx, p, c)}


class CharterPatch(BaseModel):
    project_type: str | None = None
    sponsor: str | None = None
    champion_id: int | None = None
    value_kind: str | None = None
    value_target: float | None = Field(default=None, gt=0)
    value_target_text: str | None = None
    doc_reading: bool | None = None


@router.patch("/projects/{project_id}/rr/charter")
def update_charter(project_id: int, body: CharterPatch, ctx: Ctx = Depends(get_ctx)):
    p = _project(ctx, project_id)
    c = _charter(ctx, p)
    changes = body.model_dump(exclude_unset=True)
    if set(changes) == {"doc_reading"}:
        ctx.scope.require_role("admin")  # an open policy decision (P9), not a charter edit
    else:
        if not _can_edit_charter(ctx, p, c):
            raise Forbidden("Only the champion, the project's manager or Admin can edit the charter.")
        _require_draft(c)
    if "project_type" in changes and changes["project_type"] not in PROJECT_TYPES:
        raise RuleViolation("Choose Standard, Complex or Strategic.", "project_type")
    if changes.get("champion_id"):
        e = ctx.db.get(Employee, changes["champion_id"])
        if e is None or e.record_type != "employee":
            raise RuleViolation("The champion must be a named employee.", "champion_id")
        if c.mode == "closure" and any(r.employee_id == e.id and r.letter != "A" for r in rr.raci_rows(ctx.db, p.id)):
            raise RuleViolation(f"{e.full_name} already has a RACI letter. One letter per person: change it in the RACI.", "champion_id")
    old = {k: getattr(c, k) for k in changes}
    for k, v in changes.items():
        setattr(c, k, v)
    if "project_type" in changes:
        c.pool_rate = rr.POOL_RATES[c.project_type]
    if changes.get("champion_id") and c.mode == "closure":
        a = next((r for r in rr.raci_rows(ctx.db, p.id) if r.letter == "A"), None)
        if a:
            a.employee_id = changes["champion_id"]
        else:
            ctx.db.add(ProjectRaci(project_id=p.id, employee_id=changes["champion_id"], letter="A", note="Champion"))
    # champion_note stays: it is how the template's role label resolves to the named champion in the programme RACI.
    _log(c, ctx, "Charter updated", ", ".join(changes))
    record(ctx.db, ctx.account.id, "rr_update_charter", "project", p.id, p.title, old, changes)
    ctx.db.commit()
    return _bundle(ctx, p, c)


class RaciRowIn(BaseModel):
    employee_id: int | None = None
    label: str | None = None
    letter: str
    factor: float | None = None
    response_days: int | None = None
    note: str | None = None


class RaciPut(BaseModel):
    rows: list[RaciRowIn]
    reason: str = Field(min_length=3)


@router.put("/projects/{project_id}/rr/raci")
def put_raci(project_id: int, body: RaciPut, ctx: Ctx = Depends(get_ctx)):
    p = _project(ctx, project_id)
    c = _charter(ctx, p)
    if not _can_edit_charter(ctx, p, c):
        raise Forbidden("Only the champion, the project's manager or Admin can edit the RACI.")
    _require_draft(c)
    if sum(r.letter == "A" for r in body.rows) != 1:
        raise RuleViolation("A project has exactly one Accountable (A): the champion.", "raci")
    ids = [r.employee_id for r in body.rows if r.employee_id]
    if len(ids) != len(set(ids)):
        raise RuleViolation("One letter per person: each person appears once.", "raci")
    for r in body.rows:
        if r.letter not in ("A", "R", "C", "I"):
            raise RuleViolation("Letters are A, R, C or I.", "raci")
        if not r.employee_id and (r.letter != "I" or not r.label):
            raise RuleViolation("A, R and C must be named people; only Informed can be a role.", "raci")
        if r.letter == "R" and r.factor not in (0.5, 0.75, 1.0, 1.25):
            raise RuleViolation("Responsible people need a contribution factor of 0.5, 0.75, 1.0 or 1.25.", "raci")
        require_named(ctx.db, r.employee_id, "raci", "RACI person")
    old = [rr.raci_dict(ctx.db, r) for r in rr.raci_rows(ctx.db, p.id)]
    keep = {r.employee_id: r for r in rr.raci_rows(ctx.db, p.id) if r.employee_id}
    for r in rr.raci_rows(ctx.db, p.id):
        ctx.db.delete(r)
    ctx.db.flush()
    for r in body.rows:
        prev = keep.get(r.employee_id)
        ctx.db.add(ProjectRaci(project_id=p.id, employee_id=r.employee_id, label=r.label, letter=r.letter, factor=r.factor if r.letter == "R" else None, response_days=r.response_days if r.letter == "C" else None, note=r.note,
                               factor_confirmed=bool(prev and prev.factor == r.factor and prev.factor_confirmed), adjustment=prev.adjustment if prev else 0))
    a = next(r for r in body.rows if r.letter == "A")
    c.champion_id = a.employee_id
    _log(c, ctx, "RACI changed", body.reason)
    record(ctx.db, ctx.account.id, "rr_update_raci", "project", p.id, p.title, {"raci": old}, body.model_dump(), body.reason)
    ctx.db.commit()
    return _bundle(ctx, p, c)


class SlaIn(BaseModel):
    name: str = Field(min_length=3)
    kind: str
    tat: str = Field(min_length=1)


@router.put("/projects/{project_id}/rr/slas")
def put_slas(project_id: int, body: list[SlaIn], ctx: Ctx = Depends(get_ctx)):
    p = _project(ctx, project_id)
    c = _charter(ctx, p)
    if not _can_edit_charter(ctx, p, c):
        raise Forbidden("Only the champion, the project's manager or Admin can edit the SLA list.")
    _require_draft(c)
    for s in ctx.db.scalars(select(ProjectSla).where(ProjectSla.project_id == p.id)):
        ctx.db.delete(s)
    for s in body:
        if s.kind not in ("Client", "Internal TAT"):
            raise RuleViolation("SLA kind is Client or Internal TAT.", "kind")
        ctx.db.add(ProjectSla(project_id=p.id, **s.model_dump()))
    record(ctx.db, ctx.account.id, "rr_update_slas", "project", p.id, p.title, None, {"slas": [s.model_dump() for s in body]})
    ctx.db.commit()
    return _bundle(ctx, p, c)


class FlagIn(BaseModel):
    key: str
    value: bool


@router.post("/projects/{project_id}/rr/checks")
def set_check(project_id: int, body: FlagIn, ctx: Ctx = Depends(get_ctx)):
    p = _project(ctx, project_id)
    c = _charter(ctx, p)
    if not _can_edit_charter(ctx, p, c):
        raise Forbidden()
    _require_draft(c)
    if body.key not in ("baseline_metrics",):
        raise RuleViolation("Unknown check.", "key")
    c.lock_checks = {**(c.lock_checks or {}), body.key: body.value}
    _log(c, ctx, "Lock check", f"{body.key}: {body.value}")
    record(ctx.db, ctx.account.id, "rr_lock_check", "project", p.id, p.title, None, body.model_dump())
    ctx.db.commit()
    return _bundle(ctx, p, c)


class StageReviewerIn(BaseModel):
    step: int
    employee_id: int | None


@router.post("/projects/{project_id}/rr/stage-reviewer")
def stage_reviewer(project_id: int, body: StageReviewerIn, ctx: Ctx = Depends(get_ctx)):
    """Programme: name an independent reviewer for a stage. The stage's Responsible person can't review it."""
    p = _project(ctx, project_id)
    c = _charter(ctx, p)
    if not _can_edit_charter(ctx, p, c):
        raise Forbidden()
    _require_draft(c)
    st = next((s for s in rr.template_stages(ctx.db, p.template_id) if s.step == body.step), None)
    if st is None:
        raise RuleViolation("Unknown stage.", "step")
    if body.employee_id and body.employee_id == st.responsible_id:
        raise RuleViolation(f"{person_by_id(ctx.db, body.employee_id)['name']} is Responsible for this stage, so can't review it.", "employee_id")
    require_named(ctx.db, body.employee_id, "employee_id", "stage reviewer")
    reviewers = dict(c.stage_reviewers or {})
    if body.employee_id:
        reviewers[str(body.step)] = body.employee_id
    else:
        reviewers.pop(str(body.step), None)
    c.stage_reviewers = reviewers
    _log(c, ctx, f"Stage {body.step} reviewer", str(body.employee_id))
    record(ctx.db, ctx.account.id, "rr_stage_reviewer", "project", p.id, p.title, None, body.model_dump())
    ctx.db.commit()
    return _bundle(ctx, p, c)


class FactorIn(BaseModel):
    factor: float


@router.post("/projects/{project_id}/rr/raci/{raci_id}/confirm")
def confirm_factor(project_id: int, raci_id: int, body: FactorIn, ctx: Ctx = Depends(get_ctx)):
    """The person's manager (or the project's manager) confirms a contribution factor at kickoff."""
    p = _project(ctx, project_id)
    c = _charter(ctx, p)
    _require_draft(c)
    r = ctx.db.get(ProjectRaci, raci_id)
    if r is None or r.project_id != p.id or r.letter != "R":
        raise NotFound("Responsible person")
    if r.employee_id == ctx.me:
        raise RuleViolation("You can't confirm your own contribution factor.", "factor")
    if not (ctx.scope.is_admin or ctx.scope.can_manage_project(p) or r.employee_id in ctx.scope.reporting_tree):
        raise Forbidden("Only the person's manager or the project's manager can confirm the factor.")
    if body.factor not in (0.5, 0.75, 1.0, 1.25):
        raise RuleViolation("Factors are 0.5, 0.75, 1.0 or 1.25.", "factor")
    old = r.factor
    r.factor, r.factor_confirmed = body.factor, True
    _log(c, ctx, "Factor confirmed", f"{person_by_id(ctx.db, r.employee_id)['name']}: {body.factor:g}")
    record(ctx.db, ctx.account.id, "rr_confirm_factor", "project", p.id, p.title, {"factor": old}, {"employee_id": r.employee_id, "factor": body.factor})
    ctx.db.commit()
    return _bundle(ctx, p, c)


class CharterAction(BaseModel):
    reason: str | None = None


@router.post("/projects/{project_id}/rr/charter/{action}")
def charter_action(project_id: int, action: str, body: CharterAction, ctx: Ctx = Depends(get_ctx)):
    """submit (champion) → sponsor and pmo approve (both needed, never the champion) → Locked. return sends it back."""
    p = _project(ctx, project_id)
    c = _charter(ctx, p)
    if c.state == "Locked":
        _require_draft(c)
    if action == "submit":
        if not _can_edit_charter(ctx, p, c):
            raise Forbidden()
        _require_draft(c)
        gaps = [i["label"] for i in rr.lock_checklist(ctx.db, p, c) if not i["ok"]]
        if gaps:
            raise RuleViolation("Clear the checklist first: " + "; ".join(gaps), "checklist")
        c.state, c.submitted_by, c.sponsor_ok_by, c.pmo_ok_by = "Submitted", ctx.account.id, None, None
        _log(c, ctx, "Submitted for lock")
    elif action in ("sponsor", "pmo"):
        if c.state != "Submitted":
            raise RuleViolation("The charter hasn't been submitted.", "state")
        if ctx.me == c.champion_id:
            raise RuleViolation("The champion can't lock their own charter.", "action")
        if c.submitted_by == ctx.account.id:
            raise RuleViolation("You submitted this charter, so two other people approve it.", "action")
        if action == "sponsor":
            if not (ctx.scope.is_admin or p.department_id in ctx.scope.headed_departments):
                raise Forbidden("The sponsor (the department's HOD or Admin) approves.")
            if c.pmo_ok_by == ctx.account.id:
                raise RuleViolation("Sponsor and PMO approvals come from two different people.", "action")
            c.sponsor_ok_by = ctx.account.id
        else:
            _require_fn(ctx, "PMO validator")
            if c.sponsor_ok_by == ctx.account.id:
                raise RuleViolation("Sponsor and PMO approvals come from two different people.", "action")
            c.pmo_ok_by = ctx.account.id
        _log(c, ctx, "Sponsor approved" if action == "sponsor" else "PMO approved")
        if c.sponsor_ok_by and c.pmo_ok_by:
            c.state, c.locked_on = "Locked", today()
            c.stage = "In delivery" if c.mode == "closure" else "Collecting inputs"
            for r in rr.raci_rows(ctx.db, p.id):
                if r.letter == "R" and c.mode == "closure":
                    r.factor_confirmed = True
            _log(c, ctx, "Baseline locked", "Sponsor and PMO approved")
    elif action == "return":
        if c.state != "Submitted" or not body.reason:
            raise RuleViolation("Return a submitted charter with a reason.", "reason")
        if not (rr.has_fn(ctx, "PMO validator") or ctx.scope.is_admin or p.department_id in ctx.scope.headed_departments):
            raise Forbidden()
        c.state, c.sponsor_ok_by, c.pmo_ok_by = "Draft", None, None
        _log(c, ctx, "Returned", body.reason)
    else:
        raise NotFound("Action")
    record(ctx.db, ctx.account.id, f"rr_charter_{action}", "project", p.id, p.title, None, {"state": c.state}, body.reason)
    ctx.db.commit()
    return _bundle(ctx, p, c)


# --- delays -------------------------------------------------------------------------------------------------------------


class DelayIn(BaseModel):
    task_id: int | None = None
    run_request_id: int | None = None
    stage: int | None = None
    reason_code: str
    custom_reason: str | None = None
    explanation: str = Field(min_length=3)
    evidence: str | None = None
    flagged_on: str | None = None


@router.post("/projects/{project_id}/rr/delays")
def log_delay(project_id: int, body: DelayIn, ctx: Ctx = Depends(get_ctx)):
    """One late task = one delay. The baseline due date comes from the task, never typed."""
    p = _project(ctx, project_id)
    c = _charter(ctx, p)
    if not (ctx.scope.is_admin or ctx.scope.can_manage_project(p)):
        raise Forbidden("The champion or the project's manager logs delays.")
    _require_scoring_open(c)
    if body.reason_code not in ps.REASON_CODES:
        raise RuleViolation("Choose the reason for the delay.", "reason_code")
    if body.reason_code == "X" and not (body.custom_reason or "").strip():
        raise RuleViolation("Name the custom reason.", "custom_reason")
    if not ps.controllable(body.reason_code) and not (body.evidence or "").strip():
        raise RuleViolation("Excused delays need written evidence.", "evidence")
    stage_sla, stage_start = None, None
    if c.mode == "programme":
        if not body.run_request_id or not body.stage:
            raise RuleViolation("Choose the run and the stage task.", "task_id")
        t = ctx.db.scalar(select(Task).where(Task.project_id == p.id, Task.run_request_id == body.run_request_id, Task.template_step == body.stage))
        if t is None:
            raise RuleViolation("That run has no task for this stage.", "stage")
        st = next((s for s in rr.template_stages(ctx.db, p.template_id) if s.step == body.stage), None)
        stage_sla, stage_start = (st.sla_target_days if st else None), t.start_date
        run = next((r for r in rr.runs_for(ctx.db, p) if r["request_id"] == body.run_request_id), None)
        label = f"{run['id']} · {run['title']}" if run else t.title
    else:
        t = ctx.db.get(Task, body.task_id) if body.task_id else None
        if t is None or t.project_id != p.id:
            raise RuleViolation("Choose the late task.", "task_id")
        label = t.title
    if not t.due_date_original:
        raise RuleViolation("This task has no baseline due date.", "task_id")
    if ctx.db.scalar(select(ProjectDelay.id).where(ProjectDelay.project_id == p.id, ProjectDelay.task_id == t.id)):
        raise RuleViolation("This task already has a delay. One late task is one delay.", "task_id")
    if c.mode == "closure" and t.id not in {x.id for x in rr.task_timelines(ctx.db, p.id)["late"]}:
        raise RuleViolation("This task is not late against its baseline, so it has no delay to log.", "task_id")
    flagged = _parse_day(body.flagged_on, "flagged_on")
    if flagged and flagged > today():
        raise RuleViolation("Future dates are rejected.", "flagged_on")
    check = ps.escalation_check(stage_sla, stage_start, t.due_date_original, flagged, rr.bdays(holidays(ctx.db)))
    n = len(list(ctx.db.scalars(select(ProjectDelay.id).where(ProjectDelay.project_id == p.id)))) + 1
    owner = next((a.employee_id for a in t.assignments if a.role == "Owner"), None)
    d = ProjectDelay(
        project_id=p.id, code=f"D{n}", task_id=t.id, task_label=label, run_request_id=body.run_request_id, stage=body.stage,
        reason_code=body.reason_code, custom_reason=(body.custom_reason or "").strip() or None, explanation=body.explanation, evidence=body.evidence,
        due_date=t.due_date_original, flagged_on=flagged, escalation_miss=ps.controllable(body.reason_code) and body.reason_code != "C4" and check["miss"],
        tagged=[owner] if owner and ps.controllable(body.reason_code) and c.mode == "closure" else [], state="Logged", logged_by=ctx.account.id,
        history=[{"at": now_ist().isoformat(timespec="minutes"), "event": "Logged", "actor": ctx.employee.full_name, "note": check["why"]}],
    )
    ctx.db.add(d)
    record(ctx.db, ctx.account.id, "rr_log_delay", "task", t.id, t.title, None, body.model_dump())
    ctx.db.commit()
    return _bundle(ctx, p, c)


class DelayDecision(BaseModel):
    decision: str  # validate | challenge | reclassify | close
    reason_code: str | None = None
    tagged: list[int] | None = None
    reason: str | None = None


@router.post("/rr/delays/{delay_id}/decide")
def decide_delay(delay_id: int, body: DelayDecision, ctx: Ctx = Depends(get_ctx)):
    d = ctx.db.get(ProjectDelay, delay_id)
    if d is None:
        raise NotFound("Delay")
    p = _project(ctx, d.project_id)
    c = _charter(ctx, p)
    _require_scoring_open(c)
    old = {"state": d.state, "reason_code": d.reason_code, "tagged": d.tagged}
    if body.decision in ("validate", "reclassify", "close"):
        if not (rr.has_fn(ctx, "PMO validator") or (body.decision == "reclassify" and ctx.scope.is_admin)):
            raise Forbidden("The PMO validator confirms the reason.")
        if d.logged_by == ctx.account.id:
            raise RuleViolation("You logged this delay; an independent PMO validator decides.", "decision")
        if ctx.me == c.champion_id:
            raise RuleViolation("The champion can't validate the project's delays.", "decision")
        if body.reason_code:
            if body.reason_code not in ps.REASON_CODES or body.reason_code == "X":
                raise RuleViolation("Choose one of the listed reasons.", "reason_code")
            d.reason_code = body.reason_code
            if not ps.controllable(d.reason_code):
                d.tagged = []
        if body.tagged is not None:
            d.tagged = [e for e in body.tagged if ctx.db.get(Employee, e)] if ps.controllable(d.reason_code) else []
        if body.decision == "validate":
            d.state = "Validated"
        elif body.decision == "close":
            d.state = "Closed"
        d.validated_by = ctx.account.id
    elif body.decision == "challenge":
        if d.state != "Validated":
            raise RuleViolation("Only a validated delay can be challenged.", "decision")
        if not (ctx.scope.is_admin or ctx.scope.can_manage_project(p) or rr.in_raci(ctx.db, p.id, ctx.me)):
            raise Forbidden()
        if not body.reason:
            raise RuleViolation("Give the grounds for the challenge.", "reason")
        d.state = "Challenged"
    else:
        raise RuleViolation("Validate, reclassify, close or challenge.", "decision")
    d.history = [*(d.history or []), {"at": now_ist().isoformat(timespec="minutes"), "event": body.decision, "actor": ctx.employee.full_name, "note": body.reason}]
    record(ctx.db, ctx.account.id, f"rr_delay_{body.decision}", "project", p.id, d.code, old, {"state": d.state, "reason_code": d.reason_code, "tagged": d.tagged}, body.reason)
    ctx.db.commit()
    return _bundle(ctx, p, c)


class BaselineIn(BaseModel):
    task_id: int
    requested_date: str
    reason: str = Field(min_length=3)


@router.post("/projects/{project_id}/rr/baseline-changes")
def request_baseline_change(project_id: int, body: BaselineIn, ctx: Ctx = Depends(get_ctx)):
    p = _project(ctx, project_id)
    c = _charter(ctx, p)
    if c.state != "Locked" or not _can_edit_charter(ctx, p, c):
        raise Forbidden("Baseline changes are requested on a locked charter by its champion or manager.")
    t = ctx.db.get(Task, body.task_id)
    if t is None or t.project_id != p.id:
        raise RuleViolation("Choose a task.", "task_id")
    requested = _parse_day(body.requested_date, "requested_date")
    if requested is None:
        raise RuleViolation("Enter the new date.", "requested_date")
    ctx.db.add(BaselineChange(project_id=p.id, task_id=t.id, task_label=t.title, requested_date=requested, reason=body.reason, requested_by=ctx.account.id))
    _log(c, ctx, "Baseline change requested", f"{t.code}: {body.reason}")
    record(ctx.db, ctx.account.id, "rr_request_baseline_change", "task", t.id, t.title, None, body.model_dump(), body.reason)
    ctx.db.commit()
    return _bundle(ctx, p, c)


class DisputeIn(BaseModel):
    subject: str = Field(min_length=3)
    grounds: str = Field(min_length=3)


@router.post("/projects/{project_id}/rr/disputes")
def raise_dispute(project_id: int, body: DisputeIn, ctx: Ctx = Depends(get_ctx)):
    p = _project(ctx, project_id)
    c = _charter(ctx, p)
    ctx.db.add(ProjectDispute(project_id=p.id, subject=body.subject, grounds=body.grounds, raised_by=ctx.account.id))
    record(ctx.db, ctx.account.id, "rr_raise_dispute", "project", p.id, p.title, None, body.model_dump(), body.grounds)
    ctx.db.commit()
    return _bundle(ctx, p, c)


# --- inputs -------------------------------------------------------------------------------------------------------------


class InputIn(BaseModel):
    kind: str
    value: dict


def _check_input(kind: str, v: dict) -> None:
    """Values the scorecard can't interpret are refused here, before anyone validates them."""
    if kind == "sla" and not 0 <= v["within"] <= v["total"]:
        raise RuleViolation("Items within SLA can't exceed the total.", "value")
    if kind == "rework" and not 0 <= v["pct"] <= 100:
        raise RuleViolation("Rework is a percentage from 0 to 100.", "value")
    if kind == "errors" and (v["critical"] < 0 or v["minor"] < 0):
        raise RuleViolation("Error counts can't be negative.", "value")
    if kind in ("satisfaction", "collaboration") and not 1 <= v["avg"] <= 5:
        raise RuleViolation("The average is on a 1 to 5 scale.", "value")
    if kind == "value_actual" and v["actual"] < 0:
        raise RuleViolation("The actual value can't be negative.", "value")


def _display(kind: str, v: dict) -> str:
    try:
        _check_input(kind, v)
        if kind == "value_actual":
            return f"₹{v['actual']:,.0f}".replace(",", ",")
        if kind == "sla":
            return f"{int(v['within'])} of {int(v['total'])} within SLA"
        if kind == "rework":
            return f"{v['pct']:g}% of effort"
        if kind == "errors":
            return f"{int(v['critical'])} critical, {int(v['minor'])} minor"
        if kind == "satisfaction":
            return f"{v['avg']:g} of 5 ({int(v['n'])} responses)"
        if kind == "collaboration":
            return f"{v['avg']:g} of 5 from {int(v['raters'])} raters · {int(v.get('items', 0))} help/playbook item(s)"
        if kind == "innovation":
            return f"+{int(v['points'])} of 5"
    except (KeyError, TypeError, ValueError) as exc:
        raise RuleViolation("Fill in every value for this input.", "value") from exc
    raise RuleViolation("Unknown input.", "kind")


@router.get("/rr/inputs")
def list_inputs(ctx: Ctx = Depends(get_ctx)):
    ids = ctx.scope.visible_project_ids
    out = []
    for i in ctx.db.scalars(select(ProjectRrInput).order_by(ProjectRrInput.id.desc())):
        if ids is not None and i.project_id not in ids:
            continue
        row = rr.input_dict(ctx.db, i)
        if i.kind == "value_actual" and not rr.sees_money(ctx) and not rr.has_fn(ctx, "Finance confirmer"):
            row["display"], row["value"] = "Hidden for your role", {}
        row["can_decide"] = i.state == "Submitted" and rr.has_fn(ctx, row["function"]) and i.author_account_id != ctx.account.id
        out.append(row)
    return out


@router.post("/projects/{project_id}/rr/inputs")
def submit_input(project_id: int, body: InputIn, ctx: Ctx = Depends(get_ctx)):
    p = _project(ctx, project_id)
    c = _charter(ctx, p)
    if body.kind not in INPUT_KINDS:
        raise RuleViolation("Unknown input.", "kind")
    if c.state != "Locked":
        raise RuleViolation("Inputs are collected once the baseline is locked.", "state")
    _require_scoring_open(c)
    if ctx.account.role == "team_lead" and not rr.has_fn(ctx, INPUT_KINDS[body.kind][1]):
        raise Forbidden("Team Leads update work, not scorecard inputs.")
    if body.kind == "innovation" and not rr.has_fn(ctx, "R&R Panel member"):
        raise Forbidden("The R&R Panel awards innovation.")
    if body.kind == "innovation" and not (0 <= body.value.get("points", -1) <= 5):
        raise RuleViolation("Innovation is 0 to 5 points.", "value")
    i = ProjectRrInput(project_id=p.id, kind=body.kind, value=body.value, display=_display(body.kind, body.value), author_account_id=ctx.account.id)
    ctx.db.add(i)
    record(ctx.db, ctx.account.id, "rr_submit_input", "project", p.id, INPUT_KINDS[body.kind][0], None, body.model_dump())
    ctx.db.commit()
    return rr.input_dict(ctx.db, i)


class InputDecision(BaseModel):
    decision: str  # validate | return
    reason: str | None = None


@router.post("/rr/inputs/{input_id}/decide")
def decide_input(input_id: int, body: InputDecision, ctx: Ctx = Depends(get_ctx)):
    i = ctx.db.get(ProjectRrInput, input_id)
    if i is None:
        raise NotFound("Input")
    p = _project(ctx, i.project_id)
    fn = INPUT_KINDS[i.kind][1]
    _require_fn(ctx, fn)
    if i.author_account_id == ctx.account.id:
        raise RuleViolation("You can't validate your own input.", "decision")
    c = rr.charter_for(ctx.db, p.id)
    if c and ctx.me == c.champion_id:
        raise RuleViolation("The champion can't validate the project's inputs.", "decision")
    if c:
        _require_scoring_open(c)
    if i.state != "Submitted":
        raise RuleViolation("Already decided.", "state")
    if body.decision not in ("validate", "return") or (body.decision == "return" and not body.reason):
        raise RuleViolation("Validate, or return with a reason.", "reason")
    i.state = "Validated" if body.decision == "validate" else "Returned"
    i.validator_account_id, i.reason, i.decided_at = ctx.account.id, body.reason, now_ist()
    record(ctx.db, ctx.account.id, f"rr_input_{body.decision}", "project", p.id, INPUT_KINDS[i.kind][0], None, {"state": i.state}, body.reason)
    ctx.db.commit()
    return rr.input_dict(ctx.db, i)


# --- scorecard ----------------------------------------------------------------------------------------------------------


class AdjustmentIn(BaseModel):
    adjustment: int = Field(ge=-10, le=10)
    reason: str = Field(min_length=3)


@router.patch("/projects/{project_id}/rr/raci/{raci_id}/adjustment")
def set_adjustment(project_id: int, raci_id: int, body: AdjustmentIn, ctx: Ctx = Depends(get_ctx)):
    p = _project(ctx, project_id)
    c = _charter(ctx, p)
    _require_fn(ctx, "HR calibrator")
    if c.frozen or c.stage == "Panel approved":
        raise RuleViolation("Adjustments are calibrated before Panel approval.", "state")
    r = ctx.db.get(ProjectRaci, raci_id)
    if r is None or r.project_id != p.id or r.letter == "I":
        raise NotFound("RACI row")
    if r.employee_id == ctx.me:
        raise RuleViolation("No one sets their own contribution adjustment.", "adjustment")
    if rr.in_raci(ctx.db, p.id, ctx.me):
        raise RuleViolation("You're in this project's RACI, so another HR calibrator decides.", "adjustment")
    old = r.adjustment
    r.adjustment = body.adjustment
    record(ctx.db, ctx.account.id, "rr_calibrate_adjustment", "project", p.id, p.title, {"employee_id": r.employee_id, "adjustment": old}, {"employee_id": r.employee_id, "adjustment": body.adjustment}, body.reason)
    ctx.db.commit()
    return _bundle(ctx, p, c)


@router.post("/projects/{project_id}/rr/scorecard/{action}")
def scorecard_action(project_id: int, action: str, body: CharterAction, ctx: Ctx = Depends(get_ctx)):
    """calibrate (HR calibrator) → approve (R&R Panel) → publish (R&R Panel; freezes). Panel members in the RACI can't act."""
    p = _project(ctx, project_id)
    c = _charter(ctx, p)
    card = rr.compute(ctx.db, p, c)
    stage = card["stage"]
    if action == "calibrate":
        _require_fn(ctx, "HR calibrator")
        if rr.in_raci(ctx.db, p.id, ctx.me):
            raise RuleViolation("You're in this project's RACI, so another HR calibrator decides.", "action")
        if stage != "Inputs validated":
            raise RuleViolation("Calibration needs a scored card with every input validated.", "state")
        c.stage = "HR calibrated"
    elif action in ("approve", "publish"):
        _require_fn(ctx, "R&R Panel member")
        if rr.in_raci(ctx.db, p.id, ctx.me):
            raise RuleViolation("You're in this project's RACI, so you can't approve or publish its scorecard.", "action")
        if action == "approve":
            if stage != "HR calibrated":
                raise RuleViolation("The Panel approves after HR calibration.", "state")
            c.stage = "Panel approved"
        else:
            if stage != "Panel approved":
                raise RuleViolation("Publish after Panel approval.", "state")
            rr.freeze(ctx.db, p, c, card)
    else:
        raise NotFound("Action")
    _log(c, ctx, c.stage, body.reason)
    record(ctx.db, ctx.account.id, f"rr_scorecard_{action}", "project", p.id, p.title, {"stage": stage}, {"stage": c.stage}, body.reason)
    ctx.db.commit()
    return _bundle(ctx, p, c)


# --- policy and functions ----------------------------------------------------------------------------------------------


@router.get("/rr/policy")
def get_policy(ctx: Ctx = Depends(get_ctx)):
    pol = rr.policy(ctx.db)
    ctx.db.commit()
    return {**rr.policy_dict(ctx.db, pol), "can_approve": ctx.scope.is_admin and pol.state == "Proposed" and pol.authored_by != ctx.account.id}


@router.post("/rr/policy/approve")
def approve_policy(body: CharterAction, ctx: Ctx = Depends(get_ctx)):
    ctx.scope.require_role("admin")
    pol = rr.policy(ctx.db)
    if pol.state != "Proposed":
        raise RuleViolation("This version is already approved.", "state")
    if pol.authored_by in (None, ctx.account.id):
        raise RuleViolation("A second Admin, not the author, approves a score-affecting policy.", "decision")
    pol.state, pol.approved_by, pol.approved_at = "Approved", ctx.account.id, now_ist()
    record(ctx.db, ctx.account.id, "rr_policy_approve", "policy", pol.code, pol.code, {"state": "Proposed"}, {"state": "Approved"}, body.reason)
    ctx.db.commit()
    return rr.policy_dict(ctx.db, pol)


class FunctionsIn(BaseModel):
    functions: list[str]
    reason: str | None = None


@router.put("/admin/accounts/{account_id}/functions")
def set_functions(account_id: int, body: FunctionsIn, ctx: Ctx = Depends(get_ctx)):
    """Admin tags Project R&R duties on an existing named account. Audited; never a new login."""
    from app.models import Account

    ctx.scope.require_role("admin")
    acc = ctx.db.get(Account, account_id)
    if acc is None:
        raise NotFound("Account")
    bad = [f for f in body.functions if f not in RR_FUNCTIONS]
    if bad:
        raise RuleViolation(f"Unknown function: {', '.join(bad)}.", "functions")
    old = list(acc.functions or [])
    acc.functions = [f for f in RR_FUNCTIONS if f in body.functions]
    record(ctx.db, ctx.account.id, "change_functions", "account", acc.id, acc.employee.full_name, {"functions": old}, {"functions": acc.functions}, body.reason)
    ctx.db.commit()
    return {"id": acc.id, "functions": acc.functions}


@router.get("/people/{employee_id}/project-rr")
def person_project_rr(employee_id: int, ctx: Ctx = Depends(get_ctx)):
    """A person's Project R&R rows: letter per project in scope; individual score and band only within private performance scope."""
    if not ctx.scope.can_see_person(employee_id):
        raise Forbidden()
    ids = ctx.scope.visible_project_ids
    perf = ctx.scope.can_see_perf(employee_id)
    out = []
    for r in ctx.db.scalars(select(ProjectRaci).where(ProjectRaci.employee_id == employee_id)):
        if ids is not None and r.project_id not in ids:
            continue
        p = ctx.db.get(Project, r.project_id)
        c = rr.charter_for(ctx.db, p.id)
        if c is None:
            continue
        card = rr.compute(ctx.db, p, c)
        mine = next((x for x in card.get("people", []) if x.get("person") and x["person"]["id"] == employee_id), None)
        scored = card.get("score") is not None and (card.get("state") == "Scored" or bool(c.frozen))
        out.append({
            "project": {"id": p.id, "code": p.code, "title": p.title},
            "letter": r.letter,
            "mode": c.mode,
            "stage": card["stage"],
            "visible": perf,
            "individual": mine.get("individual") if perf and mine and scored else None,
            "band": mine.get("band") if perf and mine and scored else None,
        })
    return {"rows": out, "can_see": perf}
