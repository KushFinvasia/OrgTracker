from datetime import datetime

from fastapi import APIRouter, Depends
from sqlalchemy import func, or_, select

from app.api.deps import Ctx, get_ctx
from app.core.errors import Conflict, Forbidden, NotFound, RuleViolation
from app.models import (
    Assignment,
    AuditEvent,
    DepartmentHead,
    Employee,
    Incident,
    Milestone,
    Project,
    ProjectClosure,
    Risk,
    Task,
    WorkflowTemplate,
    WorkRequest,
)
from app.models.project import CLOSURE_STAGES, INCIDENT_STATES, PRIORITIES, PROJECT_STATUSES, RISK_CRITICALITY, RISK_STATES, SEVERITIES
from app.schemas.common import DecisionIn
from app.schemas.projects import (
    AttributionIn,
    ClosureStageIn,
    IncidentCloseIn,
    IncidentIn,
    MilestoneIn,
    PreventiveTaskIn,
    ProjectIn,
    ProjectPatch,
    RcaPatch,
    ReopenIn,
    RequestIn,
    RiskIn,
)
from app.services.audit import notify, record
from app.services.common import account_for_employee, person_by_id, today
from app.services.delivery import milestone_dict, project_brief, risk_dict, task_brief
from app.services.templates import activation_blockers, instantiate

router = APIRouter(prefix="/projects", tags=["projects"])
requests_router = APIRouter(prefix="/requests", tags=["requests"])


def _get_project(ctx: Ctx, project_id: int) -> Project:
    p = ctx.db.get(Project, project_id)
    if p is None:
        raise NotFound("Project")
    ctx.scope.require_project(p.id)
    return p


def _require_manage(ctx: Ctx, p: Project) -> None:
    if not ctx.scope.can_manage_project(p):
        raise Forbidden("You can view this project but cannot change project-level records.")


def _next_code(ctx: Ctx, model, prefix: str, width: int = 3) -> str:
    n = ctx.db.scalar(select(func.count()).select_from(model)) or 0
    while True:
        n += 1
        code = f"{prefix}{n:0{width}d}"
        if not ctx.db.scalar(select(model.id).where(model.code == code)):
            return code


def _require_priority(value: str | None) -> str:
    if value not in PRIORITIES:
        raise RuleViolation("Required: choose a priority (High, Medium or Low) to continue.", "priority")
    return value


# --- portfolio ----------------------------------------------------------------------------------


@router.get("")
def list_projects(tab: str = "all", department_id: int | None = None, priority: str | None = None, status: str | None = None, q: str | None = None, ctx: Ctx = Depends(get_ctx)):
    query = select(Project)
    ids = ctx.scope.visible_project_ids
    if ids is not None:
        query = query.where(Project.id.in_(ids))
    query = query.where(Project.archived.is_(tab == "archived"))
    if tab == "team":
        people = ctx.scope.reporting_tree | {ctx.me}
        sub = select(Task.project_id).join(Assignment).where(Assignment.employee_id.in_(people))
        query = query.where(or_(Project.owner_id.in_(people), Project.id.in_(sub)))
    if department_id:
        query = query.where(Project.department_id == department_id)
    if priority == "missing":
        query = query.where(Project.priority.is_(None))
    elif priority:
        query = query.where(Project.priority == priority)
    if status == "active":
        query = query.where(Project.status.not_in(["Completed", "Cancelled"]))
    elif status:
        query = query.where(Project.status == status)
    if q:
        query = query.where(or_(Project.title.ilike(f"%{q}%"), Project.code.ilike(f"%{q}%")))
    rows = [project_brief(ctx.db, p) for p in ctx.db.scalars(query.order_by(Project.code))]
    return rows


@router.post("")
def create_project(body: ProjectIn, ctx: Ctx = Depends(get_ctx)):
    ctx.scope.require_role("admin", "hod", "manager")
    priority = _require_priority(body.priority)
    if not body.owner_id:
        raise RuleViolation("Choose a project owner.", "owner_id")
    if not body.department_id:
        raise RuleViolation("Choose the canonical department.", "department_id")
    if not body.start_date:
        raise RuleViolation("Choose a start date.", "start_date")
    if body.target_date and body.target_date < body.start_date:
        raise RuleViolation("Target date cannot be before the start date.", "target_date")
    owner = ctx.db.get(Employee, body.owner_id)
    if owner is None or owner.record_type != "employee":
        raise RuleViolation("The owner must be a named employee, not a vacant position.", "owner_id")
    p = Project(
        code=_next_code(ctx, Project, "PRJ-"),
        title=body.title.strip(),
        objective=body.objective,
        owner_id=body.owner_id,
        department_id=body.department_id,
        priority=priority,
        start_date=body.start_date,
        target_date=body.target_date,
        status="Planning",
        template_id=body.template_id,
        reviewer_id=body.reviewer_id,
        source="app",
    )
    ctx.db.add(p)
    ctx.db.flush()
    created_tasks = []
    if body.template_id:
        tpl = ctx.db.get(WorkflowTemplate, body.template_id)
        if tpl is None:
            raise RuleViolation("Template not found.", "template_id")
        created_tasks = instantiate(ctx.db, p, tpl, body.start_date, ctx.account.id, p.code)
    record(ctx.db, ctx.account.id, "create_project", "project", p.id, p.title, None, {"priority": priority, "owner_id": p.owner_id, "template_id": p.template_id})
    ctx.db.commit()
    return {**project_brief(ctx.db, p), "created_tasks": len(created_tasks), "activation_blockers": activation_blockers(ctx.db, p)}


@router.get("/{project_id}")
def get_project(project_id: int, ctx: Ctx = Depends(get_ctx)):
    p = _get_project(ctx, project_id)
    out = project_brief(ctx.db, p)
    people = {}
    for t in ctx.db.scalars(select(Task).where(Task.project_id == p.id)):
        for a in t.assignments:
            people.setdefault(a.employee_id, {"employee": person_by_id(ctx.db, a.employee_id), "roles": set()})["roles"].add(a.role)
    out["people"] = [{"employee": v["employee"], "roles": sorted(v["roles"])} for v in people.values()]
    out["milestones"] = [milestone_dict(ctx.db, m) for m in ctx.db.scalars(select(Milestone).where(Milestone.project_id == p.id).order_by(Milestone.target_date))]
    out["can_manage"] = ctx.scope.can_manage_project(p)
    out["activation_blockers"] = activation_blockers(ctx.db, p) if p.status in ("Planning", "Not Started") else []
    out["template"] = ctx.db.get(WorkflowTemplate, p.template_id).name if p.template_id else None
    return out


@router.patch("/{project_id}")
def update_project(project_id: int, body: ProjectPatch, ctx: Ctx = Depends(get_ctx)):
    p = _get_project(ctx, project_id)
    _require_manage(ctx, p)
    if body.version != p.version:
        raise Conflict("Someone else updated this project. Compare the latest version before retrying.", project_brief(ctx.db, p))
    changes = body.model_dump(exclude_unset=True, exclude={"version"})
    old = {k: getattr(p, k) for k in changes}
    if "priority" in changes:
        _require_priority(changes["priority"])
    if "status" in changes:
        status = changes["status"]
        if status not in PROJECT_STATUSES:
            raise RuleViolation("Unknown status.", "status")
        if status == "Completed":
            raise RuleViolation("Projects are completed through the closure review, not a status change.", "status")
        if status == "In Progress" and p.status in ("Planning", "Not Started"):
            if not p.priority and not changes.get("priority"):
                raise RuleViolation("Choose a priority before activating this project.", "priority")
            blockers = activation_blockers(ctx.db, p)
            if blockers:
                raise RuleViolation("Activation blocked: " + " ".join(blockers[:4]), "status", "activation_blocked")
    for k, v in changes.items():
        setattr(p, k, v)
    p.version += 1
    record(ctx.db, ctx.account.id, "update_project", "project", p.id, p.title, old, changes)
    ctx.db.commit()
    return project_brief(ctx.db, p)


@router.get("/{project_id}/tasks")
def project_tasks(project_id: int, ctx: Ctx = Depends(get_ctx)):
    _get_project(ctx, project_id)
    return [task_brief(ctx.db, t) for t in ctx.db.scalars(select(Task).where(Task.project_id == project_id).order_by(Task.due_date.is_(None), Task.due_date, Task.id))]


@router.get("/{project_id}/activity")
def project_activity(project_id: int, ctx: Ctx = Depends(get_ctx)):
    p = _get_project(ctx, project_id)
    task_ids = [str(i) for i in ctx.db.scalars(select(Task.id).where(Task.project_id == p.id))]
    q = select(AuditEvent).where(or_((AuditEvent.entity == "project") & (AuditEvent.entity_id == str(p.id)), (AuditEvent.entity == "task") & (AuditEvent.entity_id.in_(task_ids))))
    from app.services.common import account_person

    return [
        {"id": e.id, "at": e.at, "action": e.action, "label": e.label, "actor": account_person(ctx.db, e.actor_account_id), "old": e.old, "new": e.new, "reason": e.reason}
        for e in ctx.db.scalars(q.order_by(AuditEvent.at.desc()).limit(100))
    ]


# --- milestones ---------------------------------------------------------------------------------


@router.post("/{project_id}/milestones")
def add_milestone(project_id: int, body: MilestoneIn, ctx: Ctx = Depends(get_ctx)):
    p = _get_project(ctx, project_id)
    _require_manage(ctx, p)
    m = Milestone(project_id=p.id, **body.model_dump(exclude={"task_ids"}))
    ctx.db.add(m)
    ctx.db.flush()
    for t in ctx.db.scalars(select(Task).where(Task.id.in_(body.task_ids), Task.project_id == p.id)):
        t.milestone_id = m.id
    record(ctx.db, ctx.account.id, "add_milestone", "project", p.id, m.title, None, body.model_dump())
    ctx.db.commit()
    return milestone_dict(ctx.db, m)


@router.patch("/{project_id}/milestones/{milestone_id}")
def update_milestone(project_id: int, milestone_id: int, body: MilestoneIn, ctx: Ctx = Depends(get_ctx)):
    p = _get_project(ctx, project_id)
    _require_manage(ctx, p)
    m = ctx.db.get(Milestone, milestone_id)
    if m is None or m.project_id != p.id:
        raise NotFound("Milestone")
    old = milestone_dict(ctx.db, m)
    for k, v in body.model_dump(exclude={"task_ids"}).items():
        setattr(m, k, v)
    # Completing a milestone never accepts its tasks.
    record(ctx.db, ctx.account.id, "update_milestone", "project", p.id, m.title, old, body.model_dump())
    ctx.db.commit()
    return milestone_dict(ctx.db, m)


# --- risks --------------------------------------------------------------------------------------


@router.get("/{project_id}/risks")
def list_risks(project_id: int, ctx: Ctx = Depends(get_ctx)):
    _get_project(ctx, project_id)
    return [risk_dict(ctx.db, r) for r in ctx.db.scalars(select(Risk).where(Risk.project_id == project_id).order_by(Risk.state, Risk.code))]


def _validate_risk(body: RiskIn):
    if body.criticality not in RISK_CRITICALITY:
        raise RuleViolation("Choose Low, Medium, High or Critical.", "criticality")
    if body.state not in RISK_STATES:
        raise RuleViolation("Choose Open, Mitigating or Closed.", "state")


@router.post("/{project_id}/risks")
def add_risk(project_id: int, body: RiskIn, ctx: Ctx = Depends(get_ctx)):
    p = _get_project(ctx, project_id)
    _require_manage(ctx, p)
    _validate_risk(body)
    n = (ctx.db.scalar(select(func.count()).select_from(Risk).where(Risk.project_id == p.id)) or 0) + 1
    r = Risk(project_id=p.id, code=f"{p.code}-R{n:02d}", **body.model_dump())
    ctx.db.add(r)
    record(ctx.db, ctx.account.id, "add_risk", "project", p.id, body.risk, None, body.model_dump())
    ctx.db.commit()
    return risk_dict(ctx.db, r)


@router.patch("/{project_id}/risks/{risk_id}")
def update_risk(project_id: int, risk_id: int, body: RiskIn, ctx: Ctx = Depends(get_ctx)):
    p = _get_project(ctx, project_id)
    _require_manage(ctx, p)
    _validate_risk(body)
    r = ctx.db.get(Risk, risk_id)
    if r is None or r.project_id != p.id:
        raise NotFound("Risk")
    old = risk_dict(ctx.db, r)
    for k, v in body.model_dump().items():
        setattr(r, k, v)
    record(ctx.db, ctx.account.id, "update_risk", "project", p.id, r.risk, old, body.model_dump())
    ctx.db.commit()
    return risk_dict(ctx.db, r)


# --- incidents & RCA ----------------------------------------------------------------------------


def incident_dict(ctx: Ctx, i: Incident) -> dict:
    prevent = list(ctx.db.scalars(select(Task).where(Task.incident_id == i.id)))
    return {
        "id": i.id,
        "code": i.code,
        "project_id": i.project_id,
        "title": i.title,
        "product_system": i.product_system,
        "incident_date": i.incident_date,
        "received_date": i.received_date,
        "reporter": person_by_id(ctx.db, i.reporter_id),
        "severity_proposed": i.severity_proposed,
        "severity_validated": i.severity_validated,
        "clients_impacted": i.clients_impacted,
        "orders_impacted": i.orders_impacted,
        "responsible_department": i.responsible_department_id,
        "stakeholder": person_by_id(ctx.db, i.stakeholder_id),
        "root_cause": i.root_cause,
        "root_cause_category": i.root_cause_category,
        "gap": i.gap,
        "correction_action": i.correction_action,
        "correction_date": i.correction_date,
        "expected_closure": i.expected_closure,
        "actual_closure": i.actual_closure,
        "state": i.state,
        "verifier": person_by_id(ctx.db, i.verifier_id),
        "verification_note": i.verification_note,
        "repeat_of_id": i.repeat_of_id,
        "attribution_state": i.attribution_state,
        "attributed_employee": person_by_id(ctx.db, i.attributed_employee_id),
        "attribution_validator": person_by_id(ctx.db, i.attribution_validator_id),
        "attribution_reason": i.attribution_reason,
        "preventive_tasks": [task_brief(ctx.db, t) for t in prevent],
        "history": i.history or [],
        "illustrative": i.illustrative,
    }


def _get_incident(ctx: Ctx, incident_id: int) -> Incident:
    i = ctx.db.get(Incident, incident_id)
    if i is None:
        raise NotFound("Incident")
    if i.project_id:
        ctx.scope.require_project(i.project_id)
    return i


def _log(i: Incident, ctx: Ctx, event: str, note: str | None = None):
    i.history = [*(i.history or []), {"at": datetime.now().isoformat(timespec="minutes"), "event": event, "note": note, "actor": ctx.employee.full_name}]


@router.get("/{project_id}/incidents")
def list_incidents(project_id: int, ctx: Ctx = Depends(get_ctx)):
    _get_project(ctx, project_id)
    return [incident_dict(ctx, i) for i in ctx.db.scalars(select(Incident).where(Incident.project_id == project_id).order_by(Incident.id.desc()))]


@router.post("/{project_id}/incidents")
def record_incident(project_id: int, body: IncidentIn, ctx: Ctx = Depends(get_ctx)):
    p = _get_project(ctx, project_id)
    _require_manage(ctx, p)
    if body.severity_proposed not in SEVERITIES:
        raise RuleViolation("Choose Minor, Medium or Major.", "severity_proposed")
    if body.received_date < body.incident_date:
        raise RuleViolation("Received date cannot be before the incident date.", "received_date")
    n = (ctx.db.scalar(select(func.count()).select_from(Incident)) or 0) + 1
    i = Incident(code=f"INC-{n:03d}", project_id=p.id, **body.model_dump())
    _log(i, ctx, "Recorded", f"Proposed severity {body.severity_proposed}; attribution pending")
    ctx.db.add(i)
    record(ctx.db, ctx.account.id, "record_incident", "project", p.id, body.title, None, body.model_dump())
    ctx.db.commit()
    return incident_dict(ctx, i)


incidents_router = APIRouter(prefix="/incidents", tags=["incidents"])


@incidents_router.get("/{incident_id}")
def get_incident(incident_id: int, ctx: Ctx = Depends(get_ctx)):
    return incident_dict(ctx, _get_incident(ctx, incident_id))


@incidents_router.patch("/{incident_id}")
def update_rca(incident_id: int, body: RcaPatch, ctx: Ctx = Depends(get_ctx)):
    i = _get_incident(ctx, incident_id)
    changes = body.model_dump(exclude_unset=True)
    if "state" in changes:
        if changes["state"] not in INCIDENT_STATES or changes["state"] in ("Closed", "Reopened"):
            raise RuleViolation("Use Verify closure or Reopen for those states.", "state")
    old = {k: getattr(i, k) for k in changes}
    for k, v in changes.items():
        setattr(i, k, v)
    _log(i, ctx, "Analysis updated", ", ".join(changes))
    record(ctx.db, ctx.account.id, "update_rca", "incident", i.id, i.title, old, changes)
    ctx.db.commit()
    return incident_dict(ctx, i)


@incidents_router.post("/{incident_id}/attribution")
def validate_attribution(incident_id: int, body: AttributionIn, ctx: Ctx = Depends(get_ctx)):
    """Severity + individual attribution. Validator authority is configurable; self-validation is blocked."""
    i = _get_incident(ctx, incident_id)
    ctx.scope.require_role("admin", "hod")
    if body.severity_validated not in SEVERITIES:
        raise RuleViolation("Choose Minor, Medium or Major.", "severity_validated")
    if ctx.me in (i.reporter_id, i.stakeholder_id, body.attributed_employee_id):
        raise RuleViolation("You cannot validate an incident you reported, own, or are attributed in.", "attribution")
    if body.attribution == "validated" and not body.attributed_employee_id:
        raise RuleViolation("Name the person the evidence attributes this incident to.", "attributed_employee_id")
    old = {"severity_validated": i.severity_validated, "attribution_state": i.attribution_state}
    i.severity_validated = body.severity_validated
    i.attribution_state = body.attribution
    i.attributed_employee_id = body.attributed_employee_id if body.attribution == "validated" else None
    i.attribution_validator_id = ctx.me
    i.attribution_reason = body.reason
    _log(i, ctx, "Attribution recorded", f"{body.severity_validated}; {body.attribution}; {body.reason}")
    record(ctx.db, ctx.account.id, "validate_attribution", "incident", i.id, i.title, old, body.model_dump())
    ctx.db.commit()
    return incident_dict(ctx, i)


@incidents_router.post("/{incident_id}/preventive-tasks")
def add_preventive_task(incident_id: int, body: PreventiveTaskIn, ctx: Ctx = Depends(get_ctx)):
    i = _get_incident(ctx, incident_id)
    if body.reviewer_id == body.owner_id:
        raise RuleViolation("The reviewer is an assignee. Choose another person.", "reviewer_id")
    n = (ctx.db.scalar(select(func.count()).select_from(Task).where(Task.incident_id == i.id)) or 0) + 1
    t = Task(
        code=f"{i.code}-P{n:02d}",
        project_id=i.project_id,
        incident_id=i.id,
        title=body.title,
        category="Preventive action",
        complexity=body.complexity,
        start_date=today(),
        due_date_original=body.due_date,
        due_date=body.due_date,
        status="Not Started",
        reviewer_id=body.reviewer_id,
        checklist=["Preventive control implemented", "Evidence attached"],
        required_evidence="Evidence of the preventive control",
        created_by=ctx.account.id,
    )
    ctx.db.add(t)
    ctx.db.flush()
    ctx.db.add(Assignment(task_id=t.id, employee_id=body.owner_id, role="Owner", share=1.0))
    if i.state in ("Open", "Under analysis", "Correction done"):
        i.state = "Preventive action in progress"
    _log(i, ctx, "Preventive task created", t.title)
    record(ctx.db, ctx.account.id, "add_preventive_task", "incident", i.id, t.title)
    ctx.db.commit()
    return incident_dict(ctx, i)


@incidents_router.post("/{incident_id}/close")
def verify_closure(incident_id: int, body: IncidentCloseIn, ctx: Ctx = Depends(get_ctx)):
    i = _get_incident(ctx, incident_id)
    if ctx.me == i.stakeholder_id:
        raise RuleViolation("The verifier cannot be the responsible stakeholder.", "verifier")
    prevent = list(ctx.db.scalars(select(Task).where(Task.incident_id == i.id)))
    if not prevent:
        raise RuleViolation("Add at least one preventive task before closing.", "preventive_tasks")
    open_tasks = [t.code for t in prevent if t.status != "Completed"]
    if open_tasks:
        raise RuleViolation(f"Preventive tasks must be accepted first: {', '.join(open_tasks)}.", "preventive_tasks")
    if body.actual_closure > today():
        raise RuleViolation("Actual closure cannot be in the future.", "actual_closure")
    i.state = "Closed"
    i.actual_closure = body.actual_closure
    i.verifier_id = ctx.me
    i.verification_note = body.verification_note
    i.repeat_of_id = body.repeat_of_id
    _log(i, ctx, "Closure verified", body.verification_note)
    record(ctx.db, ctx.account.id, "verify_incident_closure", "incident", i.id, i.title, None, body.model_dump())
    ctx.db.commit()
    return incident_dict(ctx, i)


@incidents_router.post("/{incident_id}/reopen")
def reopen(incident_id: int, body: ReopenIn, ctx: Ctx = Depends(get_ctx)):
    i = _get_incident(ctx, incident_id)
    if i.state != "Closed":
        raise RuleViolation("Only a closed incident can be reopened.", "state")
    i.state = "Reopened"
    _log(i, ctx, "Reopened", body.reason)  # original verification stays in history
    record(ctx.db, ctx.account.id, "reopen_incident", "incident", i.id, i.title, None, None, body.reason)
    ctx.db.commit()
    return incident_dict(ctx, i)


# --- closure ------------------------------------------------------------------------------------


def _closure(ctx: Ctx, p: Project) -> ProjectClosure:
    c = ctx.db.scalar(select(ProjectClosure).where(ProjectClosure.project_id == p.id))
    if c is None:
        c = ProjectClosure(project_id=p.id, stage_notes={}, history=[])
        ctx.db.add(c)
        ctx.db.flush()
    return c


def closure_readiness(ctx: Ctx, p: Project, c: ProjectClosure) -> dict:
    tasks = list(ctx.db.scalars(select(Task).where(Task.project_id == p.id, Task.status != "Cancelled")))
    milestones = list(ctx.db.scalars(select(Milestone).where(Milestone.project_id == p.id)))
    open_incidents = list(ctx.db.scalars(select(Incident).where(Incident.project_id == p.id, Incident.state != "Closed")))
    auto = {
        "tasks": (all(t.status == "Completed" for t in tasks), f"{sum(t.status == 'Completed' for t in tasks)} of {len(tasks)} tasks accepted"),
        "milestones": (all(m.state == "Completed" for m in milestones), f"{sum(m.state == 'Completed' for m in milestones)} of {len(milestones)} milestones complete"),
        "issues": (not open_incidents, f"{len(open_incidents)} open incident(s)"),
    }
    stages = []
    for s in CLOSURE_STAGES[:-1]:
        note = (c.stage_notes or {}).get(s, {})
        gap = None
        done = bool(note.get("done"))
        if s in auto:
            ok, text = auto[s]
            gap = None if ok else text
            done = done and ok
            note = {**note, "evidence": text}
        stages.append({"stage": s, "done": done, "note": note.get("note"), "evidence": note.get("evidence"), "gap": gap})
    hod_required = p.priority == "High"
    heads = set(ctx.db.scalars(select(DepartmentHead.employee_id).where(DepartmentHead.department_id == p.department_id)))
    return {
        "state": c.state,
        "stages": stages,
        "ready": all(s["done"] for s in stages),
        "hod_required": hod_required,
        "decision_owner": "HOD of the project department" if hod_required else "Project reviewer",
        "hod_available": bool(heads),
        "decision_reason": c.decision_reason,
        "history": c.history or [],
    }


@router.get("/{project_id}/closure")
def get_closure(project_id: int, ctx: Ctx = Depends(get_ctx)):
    p = _get_project(ctx, project_id)
    c = _closure(ctx, p)
    ctx.db.commit()
    return closure_readiness(ctx, p, c)


@router.put("/{project_id}/closure/stage")
def update_closure_stage(project_id: int, body: ClosureStageIn, ctx: Ctx = Depends(get_ctx)):
    p = _get_project(ctx, project_id)
    _require_manage(ctx, p)
    if body.stage not in CLOSURE_STAGES[:-1]:
        raise RuleViolation("Unknown closure stage.", "stage")
    c = _closure(ctx, p)
    if c.state == "Approved":
        raise RuleViolation("This project is already closed.", "state")
    c.stage_notes = {**(c.stage_notes or {}), body.stage: {"done": body.done, "note": body.note}}
    ctx.db.commit()
    return closure_readiness(ctx, p, c)


@router.post("/{project_id}/closure/submit")
def submit_closure(project_id: int, ctx: Ctx = Depends(get_ctx)):
    p = _get_project(ctx, project_id)
    _require_manage(ctx, p)
    c = _closure(ctx, p)
    readiness = closure_readiness(ctx, p, c)
    if not readiness["ready"]:
        gaps = [s["stage"] for s in readiness["stages"] if not s["done"]]
        raise RuleViolation(f"Closure readiness gaps: {', '.join(gaps)}.", "stages")
    c.state = "Submitted"
    c.submitted_by = ctx.account.id
    c.history = [*(c.history or []), {"at": datetime.now().isoformat(timespec="minutes"), "event": "Submitted", "actor": ctx.employee.full_name}]
    record(ctx.db, ctx.account.id, "submit_closure", "project", p.id, p.title)
    ctx.db.commit()
    return closure_readiness(ctx, p, c)


@router.post("/{project_id}/closure/decide")
def decide_closure(project_id: int, body: DecisionIn, ctx: Ctx = Depends(get_ctx)):
    p = _get_project(ctx, project_id)
    c = _closure(ctx, p)
    if c.state != "Submitted":
        raise RuleViolation("Closure has not been submitted.", "state")
    if c.submitted_by == ctx.account.id:
        raise RuleViolation("You submitted this closure; an independent person must decide.", "decision")
    if p.priority == "High":
        if p.department_id not in ctx.scope.headed_departments:
            raise Forbidden("High-priority closure needs the HOD of the project department.")
    elif not (ctx.me == p.reviewer_id or p.department_id in ctx.scope.headed_departments or ctx.scope.is_admin):
        raise Forbidden("Only the project reviewer or department HOD can decide this closure.")
    if body.decision not in ("approve", "return") or (body.decision == "return" and not body.reason):
        raise RuleViolation("Approve, or return with a reason.", "reason")
    c.state = "Approved" if body.decision == "approve" else "Returned"
    c.decided_by = ctx.account.id
    c.decided_at = datetime.now()
    c.decision_reason = body.reason
    c.history = [*(c.history or []), {"at": datetime.now().isoformat(timespec="minutes"), "event": c.state, "actor": ctx.employee.full_name, "note": body.reason}]
    if c.state == "Approved":
        old = p.status
        p.status = "Completed"
        p.version += 1
        record(ctx.db, ctx.account.id, "approve_closure", "project", p.id, p.title, {"status": old}, {"status": "Completed"}, body.reason)
    else:
        record(ctx.db, ctx.account.id, "return_closure", "project", p.id, p.title, None, None, body.reason)
    ctx.db.commit()
    return closure_readiness(ctx, p, c)


# --- cross-department requests ------------------------------------------------------------------


def request_dict(ctx: Ctx, r: WorkRequest) -> dict:
    from app.models import Department

    def dept(i):
        d = ctx.db.get(Department, i) if i else None
        return d.name if d else None

    return {
        "id": r.id,
        "title": r.title,
        "template_id": r.template_id,
        "template": ctx.db.get(WorkflowTemplate, r.template_id).name if r.template_id else None,
        "requesting_department": dept(r.requesting_department_id),
        "receiving_department": dept(r.receiving_department_id),
        "receiving_department_id": r.receiving_department_id,
        "audience": r.audience,
        "objective": r.objective,
        "required_date": r.required_date,
        "priority": r.priority,
        "brief": r.brief,
        "requester": person_by_id(ctx.db, r.requester_id),
        "validator": person_by_id(ctx.db, r.validator_id),
        "state": r.state,
        "project_id": r.project_id,
        "history": r.history or [],
    }


def _can_accept(ctx: Ctx, r: WorkRequest) -> bool:
    if ctx.scope.is_admin:
        return True
    emp = ctx.employee
    return ctx.account.role in ("manager", "hod") and (emp.department_id == r.receiving_department_id or r.receiving_department_id in ctx.scope.headed_departments)


@requests_router.get("")
def list_requests(ctx: Ctx = Depends(get_ctx)):
    rows = []
    for r in ctx.db.scalars(select(WorkRequest).order_by(WorkRequest.created_at.desc())):
        if ctx.scope.is_admin or r.requester_id == ctx.me or r.validator_id == ctx.me or _can_accept(ctx, r) or r.requester_id in (ctx.scope.work_people or set()):
            rows.append({**request_dict(ctx, r), "can_accept": _can_accept(ctx, r) and r.state == "Validated", "can_validate": r.validator_id == ctx.me and r.state == "Submitted"})
    return rows


@requests_router.post("")
def create_request(body: RequestIn, ctx: Ctx = Depends(get_ctx)):
    priority = _require_priority(body.priority)
    if body.validator_id == ctx.me:
        raise RuleViolation("Your manager validates the request; you cannot validate your own.", "validator_id")
    r = WorkRequest(**{**body.model_dump(), "priority": priority}, requester_id=ctx.me, state="Submitted", history=[{"at": datetime.now().isoformat(timespec="minutes"), "event": "Submitted", "actor": ctx.employee.full_name}])
    ctx.db.add(r)
    ctx.db.flush()
    notify(ctx.db, getattr(account_for_employee(ctx.db, body.validator_id), "id", None), f"Validate request: {r.title}", link=f"/projects?tab=requests&request={r.id}")
    record(ctx.db, ctx.account.id, "create_request", "request", r.id, r.title, None, body.model_dump())
    ctx.db.commit()
    return request_dict(ctx, r)


@requests_router.post("/{request_id}/decide")
def decide_request(request_id: int, body: DecisionIn, ctx: Ctx = Depends(get_ctx)):
    r = ctx.db.get(WorkRequest, request_id)
    if r is None:
        raise NotFound("Request")
    now = datetime.now().isoformat(timespec="minutes")
    if r.state == "Submitted":
        if r.validator_id != ctx.me:
            raise Forbidden("Only the named validator can validate this request.")
        if body.decision not in ("validate", "return"):
            raise RuleViolation("Validate, or return with a reason.", "decision")
        r.state = "Validated" if body.decision == "validate" else "Returned"
    elif r.state == "Validated":
        if not _can_accept(ctx, r):
            raise Forbidden("Only the receiving team's owner can accept this request.")
        if body.decision == "accept":
            tpl = ctx.db.get(WorkflowTemplate, r.template_id) if r.template_id else None
            p = Project(
                code=_next_code(ctx, Project, "PRJ-"),
                title=r.title,
                objective=r.objective,
                owner_id=ctx.me,
                department_id=r.receiving_department_id,
                priority=r.priority,
                start_date=today(),
                target_date=r.required_date,
                status="Planning",
                template_id=r.template_id,
                source="app",
            )
            ctx.db.add(p)
            ctx.db.flush()
            if tpl:
                instantiate(ctx.db, p, tpl, today(), ctx.account.id, p.code)
            r.project_id = p.id
            r.state = "Accepted"
        elif body.decision in ("return", "reject"):
            r.state = "Returned" if body.decision == "return" else "Rejected"
        else:
            raise RuleViolation("Accept into calendar, return or reject.", "decision")
    else:
        raise RuleViolation(f"Request is already {r.state}.", "state")
    if body.decision in ("return", "reject") and not body.reason:
        raise RuleViolation("Give a reason.", "reason")
    r.history = [*(r.history or []), {"at": now, "event": r.state, "actor": ctx.employee.full_name, "note": body.reason}]
    record(ctx.db, ctx.account.id, f"request_{body.decision}", "request", r.id, r.title, None, None, body.reason)
    ctx.db.commit()
    return request_dict(ctx, r)
