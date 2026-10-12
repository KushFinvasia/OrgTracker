import shutil
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, File, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import func, or_, select

from app.api.deps import Ctx, get_ctx
from app.core.config import settings
from app.core.errors import Conflict, Forbidden, NotFound, RuleViolation
from app.models import (
    Assignment,
    Blocker,
    Comment,
    DeadlineChange,
    DepartmentHead,
    Employee,
    EvidenceFile,
    Milestone,
    Project,
    ReviewDecision,
    Submission,
    Task,
    TaskDependency,
    TaskEvent,
)
from app.models.task import BLOCKER_CATEGORIES, MANUAL_TASK_STATUSES
from app.schemas.common import DecisionIn, WeeklyUpdateIn
from app.schemas.tasks import AssignmentsPut, BlockerIn, CommentIn, DeadlineChangeIn, ReviewIn, SubmitIn, TaskIn, TaskPatch
from app.services.audit import notify, record
from app.services.common import account_for_employee, account_person, person_by_id, today
from app.services.delivery import task_brief, task_detail, validate_assignments

router = APIRouter(prefix="/tasks", tags=["tasks"])
validations_router = APIRouter(tags=["validations"])


def _get_task(ctx: Ctx, task_id: int) -> Task:
    t = ctx.db.get(Task, task_id)
    if t is None:
        raise NotFound("Task")
    ctx.scope.require_project(t.project_id)
    return t


def _require_update(ctx: Ctx, t: Task) -> None:
    if not ctx.scope.can_update_task(t):
        raise Forbidden("You can view this task but it is outside the team you update.")


def _event(ctx: Ctx, t: Task, kind: str, summary: str, data: dict | None = None) -> None:
    ctx.db.add(TaskEvent(task_id=t.id, actor_account_id=ctx.account.id, kind=kind, summary=summary, data=data or {}))


def _next_task_code(ctx: Ctx, p: Project) -> str:
    n = ctx.db.scalar(select(func.count()).select_from(Task).where(Task.project_id == p.id)) or 0
    while True:
        n += 1
        code = f"{p.code}-T{n:02d}"
        if not ctx.db.scalar(select(Task.id).where(Task.code == code)):
            return code


@router.get("")
def list_tasks(view: str = "team", status: str | None = None, project_id: int | None = None, person_id: int | None = None, ctx: Ctx = Depends(get_ctx)):
    q = select(Task)
    ids = ctx.scope.visible_project_ids
    if ids is not None:
        q = q.where(Task.project_id.in_(ids))
    if view == "review":
        q = q.where(Task.reviewer_id == ctx.me, Task.status == "In Review")
    elif view == "team":
        people = ctx.scope.work_people
        if people is not None:
            q = q.where(Task.id.in_(select(Assignment.task_id).where(Assignment.employee_id.in_(people))))
        q = q.where(Task.status.not_in(["Completed", "Cancelled"]))
    if person_id:
        q = q.where(Task.id.in_(select(Assignment.task_id).where(Assignment.employee_id == person_id)))
    if status:
        q = q.where(Task.status == status)
    if project_id:
        q = q.where(Task.project_id == project_id)
    return [task_brief(ctx.db, t) for t in ctx.db.scalars(q.order_by(Task.due_date.is_(None), Task.due_date, Task.id).limit(300))]


@router.post("")
def create_task(body: TaskIn, ctx: Ctx = Depends(get_ctx)):
    p = ctx.db.get(Project, body.project_id)
    if p is None:
        raise RuleViolation("Choose a project.", "project_id")
    ctx.scope.require_project(p.id)
    if ctx.account.role == "team_lead" or not ctx.scope.can_manage_project(p):
        raise Forbidden("You cannot add tasks to this project.")
    rows = [a.model_dump() for a in body.assignments]
    validate_assignments(rows, body.reviewer_id)
    for r in rows:
        e = ctx.db.get(Employee, r["employee_id"])
        if e is None or e.record_type != "employee":
            raise RuleViolation("Assignees must be named employees, not vacant positions.", "assignments")
    if body.start_date and body.due_date and body.due_date < body.start_date:
        raise RuleViolation("Due date cannot be before the start date.", "due_date")
    if body.milestone_id and not ctx.db.scalar(select(Milestone.id).where(Milestone.id == body.milestone_id, Milestone.project_id == p.id)):
        raise RuleViolation("Milestone belongs to another project.", "milestone_id")
    t = Task(
        code=_next_task_code(ctx, p),
        project_id=p.id,
        milestone_id=body.milestone_id,
        title=body.title.strip(),
        description=body.description,
        category=body.category,
        complexity=body.complexity,
        start_date=body.start_date,
        due_date_original=body.due_date,
        due_date=body.due_date,
        status="Not Started",  # legitimate initial state only
        reviewer_id=body.reviewer_id,
        checklist=body.checklist,
        required_evidence=body.required_evidence,
        created_by=ctx.account.id,
    )
    ctx.db.add(t)
    ctx.db.flush()
    for r in rows:
        ctx.db.add(Assignment(task_id=t.id, employee_id=r["employee_id"], role=r["role"], share=r["share"] / 100))
    for dep in body.depends_on:
        ctx.db.add(TaskDependency(task_id=t.id, depends_on_id=dep))
    _event(ctx, t, "created", "Task created (Not started)")
    record(ctx.db, ctx.account.id, "create_task", "task", t.id, t.title, None, body.model_dump())
    ctx.db.commit()
    ctx.db.refresh(t)
    return task_detail(ctx.db, t)


@router.post("/weekly-update")
def weekly_update(body: WeeklyUpdateIn, ctx: Ctx = Depends(get_ctx)):
    """Per-row outcomes: successful rows save even when another row conflicts or fails."""
    results = []
    for row in body.rows:
        t = ctx.db.get(Task, row.id)
        try:
            if t is None or not ctx.scope.can_see_project(t.project_id):
                raise NotFound("Task")
            _require_update(ctx, t)
            if row.version != t.version:
                results.append({"id": row.id, "result": "conflict", "message": "Someone else updated this task.", "current": task_brief(ctx.db, t)})
                continue
            changes = {}
            if row.status is not None and row.status != t.status:
                if row.status not in MANUAL_TASK_STATUSES:
                    raise RuleViolation("In review and Completed need the review workflow.", "status")
                if t.status in ("In Review", "Completed"):
                    raise RuleViolation(f"Task is {t.status}; use the review workflow.", "status")
                changes["status"] = (t.status, row.status)
                t.status = row.status
            if row.progress is not None and row.progress != t.progress:
                changes["progress"] = (t.progress, row.progress)
                t.progress = row.progress
            if row.next_action is not None and row.next_action != t.next_action:
                changes["next_action"] = (t.next_action, row.next_action)
                t.next_action = row.next_action
            if changes:
                t.version += 1
                _event(ctx, t, "weekly_update", ", ".join(f"{k}: {a} > {b}" for k, (a, b) in changes.items()))
                record(ctx.db, ctx.account.id, "weekly_update", "task", t.id, t.title, {k: a for k, (a, _) in changes.items()}, {k: b for k, (_, b) in changes.items()})
            ctx.db.commit()
            results.append({"id": row.id, "result": "saved", "task": task_brief(ctx.db, t)})
        except (RuleViolation, Forbidden, NotFound) as exc:
            ctx.db.rollback()
            results.append({"id": row.id, "result": "error", "message": exc.detail["message"]})
    return {"results": results, "saved": sum(r["result"] == "saved" for r in results)}


@router.get("/{task_id}")
def get_task(task_id: int, ctx: Ctx = Depends(get_ctx)):
    t = _get_task(ctx, task_id)
    d = task_detail(ctx.db, t)
    d["can_update"] = ctx.scope.can_update_task(t)
    d["is_reviewer"] = t.reviewer_id == ctx.me
    d["evidence"] = [
        {"id": f.id, "filename": f.filename, "size": f.size, "uploaded_at": f.uploaded_at, "uploaded_by": account_person(ctx.db, f.uploaded_by)}
        for f in ctx.db.scalars(select(EvidenceFile).where(EvidenceFile.task_id == t.id).order_by(EvidenceFile.uploaded_at.desc()))
    ]
    return d


@router.patch("/{task_id}")
def update_task(task_id: int, body: TaskPatch, ctx: Ctx = Depends(get_ctx)):
    t = _get_task(ctx, task_id)
    _require_update(ctx, t)
    if body.version != t.version:
        raise Conflict("Someone else updated this task. Compare the latest version before retrying.", task_brief(ctx.db, t))
    changes = body.model_dump(exclude_unset=True, exclude={"version"})
    if ctx.account.role == "team_lead":
        allowed = {"status", "progress", "next_action"}
        if set(changes) - allowed:
            raise Forbidden("Team Leads update status, progress and next action only.")
    if "status" in changes:
        if changes["status"] not in MANUAL_TASK_STATUSES:
            raise RuleViolation("In review, Rework and Completed are set by the review workflow.", "status")
        if t.status in ("In Review", "Completed"):
            raise RuleViolation(f"Task is {t.status}; use the review workflow.", "status")
    if "reviewer_id" in changes and changes["reviewer_id"] in {a.employee_id for a in t.assignments}:
        raise RuleViolation("The reviewer is an assignee. Choose another person.", "reviewer_id")
    old = {k: getattr(t, k) for k in changes}
    for k, v in changes.items():
        setattr(t, k, v)
    t.version += 1
    _event(ctx, t, "update", ", ".join(f"{k} changed" for k in changes), {"old": {k: str(v) for k, v in old.items()}})
    record(ctx.db, ctx.account.id, "update_task", "task", t.id, t.title, old, changes)
    ctx.db.commit()
    return task_detail(ctx.db, t)


@router.put("/{task_id}/assignments")
def put_assignments(task_id: int, body: AssignmentsPut, ctx: Ctx = Depends(get_ctx)):
    t = _get_task(ctx, task_id)
    p = ctx.db.get(Project, t.project_id)
    if ctx.account.role == "team_lead" or not ctx.scope.can_manage_project(p):
        raise Forbidden("You cannot change assignments on this task.")
    if body.version != t.version:
        raise Conflict("Someone else updated this task.", task_brief(ctx.db, t))
    if t.status == "Completed":
        raise RuleViolation("Accepted work keeps its assignments.", "assignments")
    rows = [a.model_dump() for a in body.assignments]
    validate_assignments(rows, body.reviewer_id)
    old = [{"employee_id": a.employee_id, "role": a.role, "share": a.share * 100} for a in t.assignments]
    t.assignments.clear()
    ctx.db.flush()
    for r in rows:
        t.assignments.append(Assignment(employee_id=r["employee_id"], role=r["role"], share=r["share"] / 100))
    t.reviewer_id = body.reviewer_id
    t.version += 1
    _event(ctx, t, "assignments", f"Assignments changed: {body.reason}")
    record(ctx.db, ctx.account.id, "update_assignments", "task", t.id, t.title, {"assignments": old}, {"assignments": rows, "reviewer_id": body.reviewer_id}, body.reason)
    ctx.db.commit()
    return task_detail(ctx.db, t)


# --- evidence -----------------------------------------------------------------------------------


@router.post("/{task_id}/evidence")
def upload_evidence(task_id: int, file: UploadFile = File(...), ctx: Ctx = Depends(get_ctx)):
    t = _get_task(ctx, task_id)
    _require_update(ctx, t)
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    name = f"{uuid.uuid4().hex}_{(file.filename or 'evidence').replace('/', '_')}"
    dest = settings.upload_dir / name
    with dest.open("wb") as out:
        shutil.copyfileobj(file.file, out)
    size = dest.stat().st_size
    if size > settings.upload_max_bytes:
        dest.unlink(missing_ok=True)
        raise RuleViolation("File is larger than the configured upload limit.", "file")
    ev = EvidenceFile(task_id=t.id, filename=file.filename or name, stored_path=str(dest), size=size, uploaded_by=ctx.account.id)
    ctx.db.add(ev)
    ctx.db.flush()
    _event(ctx, t, "evidence", f"Evidence uploaded: {ev.filename}")
    ctx.db.commit()
    return {"id": ev.id, "filename": ev.filename, "size": ev.size, "uploaded_at": ev.uploaded_at}


@validations_router.get("/evidence/{evidence_id}")
def download_evidence(evidence_id: int, ctx: Ctx = Depends(get_ctx)):
    ev = ctx.db.get(EvidenceFile, evidence_id)
    if ev is None:
        raise NotFound("Evidence")
    if ev.task_id:
        _get_task(ctx, ev.task_id)
    elif ev.training_assignment_id:
        from app.models import TrainingAssignment

        a = ctx.db.get(TrainingAssignment, ev.training_assignment_id)
        if not ctx.scope.can_see_person(a.employee_id):
            raise Forbidden()
    if not ev.stored_path:
        raise NotFound("Stored file")
    return FileResponse(ev.stored_path, filename=ev.filename)


# --- review workflow ----------------------------------------------------------------------------


@router.post("/{task_id}/submit")
def send_for_review(task_id: int, body: SubmitIn, ctx: Ctx = Depends(get_ctx)):
    t = _get_task(ctx, task_id)
    _require_update(ctx, t)
    if t.status not in ("Not Started", "In Progress", "Rework", "Blocked"):
        raise RuleViolation(f"A task that is {t.status} cannot be sent for review.", "status")
    if body.submission_date > today():
        raise RuleViolation("Submission date cannot be in the future.", "submission_date")
    if not t.reviewer_id:
        raise RuleViolation("Assign an independent reviewer first.", "reviewer_id")
    if t.reviewer_id in {a.employee_id for a in t.assignments}:
        raise RuleViolation("The reviewer is an assignee. Choose another reviewer.", "reviewer_id")
    if t.required_evidence and not body.evidence_ids:
        raise RuleViolation("Attach the required evidence before sending for review.", "evidence_ids")
    valid_ids = set(ctx.db.scalars(select(EvidenceFile.id).where(EvidenceFile.task_id == t.id, EvidenceFile.id.in_(body.evidence_ids))))
    if set(body.evidence_ids) - valid_ids:
        raise RuleViolation("Some evidence files did not finish uploading or belong to another task.", "evidence_ids")
    if t.checklist and not body.checklist_confirmed:
        raise RuleViolation("Confirm the acceptance checklist.", "checklist_confirmed")
    version = (ctx.db.scalar(select(func.max(Submission.version)).where(Submission.task_id == t.id)) or 0) + 1
    s = Submission(task_id=t.id, version=version, submission_date=body.submission_date, note=body.note, evidence_ids=body.evidence_ids, checklist_confirmed=body.checklist_confirmed, submitted_by=ctx.account.id)
    ctx.db.add(s)
    old = t.status
    t.status = "In Review"
    t.version += 1
    _event(ctx, t, "submitted", f"Submission v{version} sent for review")
    record(ctx.db, ctx.account.id, "send_for_review", "task", t.id, t.title, {"status": old}, {"status": "In Review", "submission": version})
    acc = account_for_employee(ctx.db, t.reviewer_id)
    notify(ctx.db, acc.id if acc else None, f"Review: {t.title}", f"Submission v{version}", f"/tasks?task={t.id}&panel=review")
    ctx.db.commit()
    return task_detail(ctx.db, t)


@router.post("/{task_id}/review")
def review(task_id: int, body: ReviewIn, ctx: Ctx = Depends(get_ctx)):
    t = _get_task(ctx, task_id)
    if t.reviewer_id != ctx.me:
        raise Forbidden("Only the named independent reviewer can decide.")
    if ctx.me in {a.employee_id for a in t.assignments}:
        raise RuleViolation("You are an assignee on this task and cannot review it.", "reviewer_id")
    if t.status != "In Review":
        raise RuleViolation("This task is not waiting for review.", "status")
    sub = ctx.db.scalar(select(Submission).where(Submission.task_id == t.id).order_by(Submission.version.desc()))
    if body.decision == "rework":
        if not body.feedback or not body.reason_category or not body.failed_criteria:
            raise RuleViolation("Rework needs a reason category, the failed criteria and actionable feedback.", "feedback")
    elif body.decision != "accept":
        raise RuleViolation("Choose Accept or Send to rework.", "decision")
    ctx.db.add(ReviewDecision(task_id=t.id, submission_id=sub.id, reviewer_id=ctx.me, **body.model_dump()))
    if body.decision == "accept":
        t.status = "Completed"
        t.progress = 100
        t.accepted_submission_date = sub.submission_date  # reviewer waiting time never makes the assignee late
        t.accepted_at = datetime.now()
        summary = f"Accepted submission v{sub.version} (completion date {sub.submission_date:%d %b %Y})"
    else:
        t.status = "Rework"  # due date is not moved automatically
        summary = f"Returned v{sub.version} to rework: {body.reason_category}"
    t.version += 1
    _event(ctx, t, body.decision, summary)
    record(ctx.db, ctx.account.id, f"review_{body.decision}", "task", t.id, t.title, {"status": "In Review"}, {"status": t.status}, body.feedback)
    owner = next((a for a in t.assignments if a.role == "Owner"), None)
    if owner:
        acc = account_for_employee(ctx.db, owner.employee.manager_id)
        notify(ctx.db, acc.id if acc else None, f"{t.title}: {'accepted' if body.decision == 'accept' else 'sent to rework'}", link=f"/tasks?task={t.id}")
    ctx.db.commit()
    return task_detail(ctx.db, t)


# --- blockers & deadline changes ----------------------------------------------------------------


@router.post("/{task_id}/blockers")
def report_blocker(task_id: int, body: BlockerIn, ctx: Ctx = Depends(get_ctx)):
    t = _get_task(ctx, task_id)
    _require_update(ctx, t)
    if body.category not in BLOCKER_CATEGORIES:
        raise RuleViolation("Choose a blocker category.", "category")
    if body.validator_id == ctx.me:
        raise RuleViolation("You cannot validate your own blocker. Choose an independent validator.", "validator_id")
    if body.blocked_since > today():
        raise RuleViolation("Blocked-since cannot be in the future.", "blocked_since")
    b = Blocker(task_id=t.id, requester_id=ctx.me, **body.model_dump())
    ctx.db.add(b)
    if t.status in ("Not Started", "In Progress"):
        t.status = "Blocked"
        t.version += 1
    _event(ctx, t, "blocker", f"Blocker reported: {body.category} (pending validation)")
    record(ctx.db, ctx.account.id, "report_blocker", "task", t.id, t.title, None, body.model_dump())
    acc = account_for_employee(ctx.db, body.validator_id)
    notify(ctx.db, acc.id if acc else None, f"Validate blocker: {t.title}", link=f"/tasks?task={t.id}&panel=dependencies")
    ctx.db.commit()
    return task_detail(ctx.db, t)


@router.post("/{task_id}/deadline-changes")
def request_deadline_change(task_id: int, body: DeadlineChangeIn, ctx: Ctx = Depends(get_ctx)):
    t = _get_task(ctx, task_id)
    _require_update(ctx, t)
    if body.reason_category not in BLOCKER_CATEGORIES:
        raise RuleViolation("Choose a reason category.", "reason_category")
    if body.validator_id == ctx.me:
        raise RuleViolation("You cannot validate your own date change.", "validator_id")
    if t.status == "Completed":
        raise RuleViolation("Accepted work keeps its dates.", "requested_date")
    c = DeadlineChange(task_id=t.id, original_date=t.due_date, requester_id=ctx.me, **body.model_dump())
    ctx.db.add(c)
    _event(ctx, t, "deadline_request", f"Date change requested: {body.requested_date:%d %b %Y} (original remains in force)")
    record(ctx.db, ctx.account.id, "request_deadline_change", "task", t.id, t.title, None, body.model_dump())
    acc = account_for_employee(ctx.db, body.validator_id)
    notify(ctx.db, acc.id if acc else None, f"Validate date change: {t.title}", link=f"/tasks?task={t.id}&panel=dependencies")
    ctx.db.commit()
    return task_detail(ctx.db, t)


def _resource_needs_hod(ctx: Ctx, t: Task) -> None:
    p = ctx.db.get(Project, t.project_id)
    heads = set(ctx.db.scalars(select(DepartmentHead.employee_id).where(DepartmentHead.department_id == p.department_id)))
    if ctx.me not in heads:
        raise Forbidden("Resource exceptions require HOD validation for the project department.")


@validations_router.post("/blockers/{blocker_id}/decide")
def decide_blocker(blocker_id: int, body: DecisionIn, ctx: Ctx = Depends(get_ctx)):
    b = ctx.db.get(Blocker, blocker_id)
    if b is None:
        raise NotFound("Blocker")
    t = _get_task(ctx, b.task_id)
    if b.validator_id != ctx.me:
        raise Forbidden("Only the named validator can decide.")
    if b.requester_id == ctx.me:
        raise RuleViolation("Requesters cannot validate their own blockers.", "decision")
    if b.state != "Pending":
        raise RuleViolation("Already decided.", "state")
    if b.category == "Resource" and body.decision == "validate":
        _resource_needs_hod(ctx, t)
    if body.decision not in ("validate", "reject") or not body.reason:
        raise RuleViolation("Validate or reject, with a reason.", "reason")
    b.state = "Validated" if body.decision == "validate" else "Rejected"
    b.decision_reason = body.reason
    b.decided_at = datetime.now()
    excludable = BLOCKER_CATEGORIES.get(b.category, False)
    _event(ctx, t, "blocker_decision", f"Blocker {b.state.lower()}: {b.category}{' (excludable)' if excludable and b.state == 'Validated' else ''}")
    record(ctx.db, ctx.account.id, f"blocker_{body.decision}", "task", t.id, t.title, None, {"blocker": b.id, "state": b.state}, body.reason)
    ctx.db.commit()
    return task_detail(ctx.db, t)


@validations_router.post("/deadline-changes/{change_id}/decide")
def decide_deadline(change_id: int, body: DecisionIn, ctx: Ctx = Depends(get_ctx)):
    c = ctx.db.get(DeadlineChange, change_id)
    if c is None:
        raise NotFound("Date change")
    t = _get_task(ctx, c.task_id)
    if c.validator_id != ctx.me or c.requester_id == ctx.me:
        raise Forbidden("Only the independent named validator can decide.")
    if c.state != "Pending":
        raise RuleViolation("Already decided.", "state")
    if c.reason_category == "Resource" and body.decision == "validate":
        _resource_needs_hod(ctx, t)
    if body.decision not in ("validate", "reject") or not body.reason:
        raise RuleViolation("Validate or reject, with a reason.", "reason")
    c.state = "Validated" if body.decision == "validate" else "Rejected"
    c.decision_reason = body.reason
    c.decided_at = datetime.now()
    if c.state == "Validated":
        old = t.due_date
        t.due_date = c.requested_date  # original baseline stays in due_date_original
        t.version += 1
        _event(ctx, t, "deadline_validated", f"Due date in force {old:%d %b} > {c.requested_date:%d %b}" if old else "Due date set")
        record(ctx.db, ctx.account.id, "deadline_validated", "task", t.id, t.title, {"due_date": old}, {"due_date": c.requested_date}, body.reason)
    else:
        _event(ctx, t, "deadline_rejected", "Date change rejected; original date remains in force")
        record(ctx.db, ctx.account.id, "deadline_rejected", "task", t.id, t.title, None, None, body.reason)
    ctx.db.commit()
    return task_detail(ctx.db, t)


@validations_router.get("/validations")
def my_validations(ctx: Ctx = Depends(get_ctx)):
    out = []
    for b in ctx.db.scalars(select(Blocker).where(or_(Blocker.validator_id == ctx.me, Blocker.requester_id.in_(ctx.scope.work_people or {ctx.me}))).order_by(Blocker.created_at.desc()).limit(100)):
        t = ctx.db.get(Task, b.task_id)
        out.append({"kind": "blocker", "id": b.id, "task": {"id": t.id, "title": t.title, "code": t.code}, "category": b.category, "requested": b.description, "requester": person_by_id(ctx.db, b.requester_id), "validator": person_by_id(ctx.db, b.validator_id), "state": b.state, "can_decide": b.validator_id == ctx.me and b.state == "Pending", "created_at": b.created_at, "source": b.source})
    for c in ctx.db.scalars(select(DeadlineChange).where(or_(DeadlineChange.validator_id == ctx.me, DeadlineChange.requester_id.in_(ctx.scope.work_people or {ctx.me}))).order_by(DeadlineChange.created_at.desc()).limit(100)):
        t = ctx.db.get(Task, c.task_id)
        out.append({"kind": "deadline", "id": c.id, "task": {"id": t.id, "title": t.title, "code": t.code}, "category": c.reason_category, "requested": f"{c.original_date:%d %b} > {c.requested_date:%d %b %Y}" if c.original_date else f"> {c.requested_date:%d %b %Y}", "requester": person_by_id(ctx.db, c.requester_id), "validator": person_by_id(ctx.db, c.validator_id), "state": c.state, "can_decide": c.validator_id == ctx.me and c.state == "Pending", "created_at": c.created_at, "source": "app"})
    return out


# --- discussion & history -----------------------------------------------------------------------


@router.get("/{task_id}/comments")
def comments(task_id: int, ctx: Ctx = Depends(get_ctx)):
    t = _get_task(ctx, task_id)
    return [{"id": c.id, "body": c.body, "author": account_person(ctx.db, c.author_account_id), "created_at": c.created_at} for c in ctx.db.scalars(select(Comment).where(Comment.task_id == t.id).order_by(Comment.created_at))]


@router.post("/{task_id}/comments")
def add_comment(task_id: int, body: CommentIn, ctx: Ctx = Depends(get_ctx)):
    t = _get_task(ctx, task_id)
    c = Comment(task_id=t.id, author_account_id=ctx.account.id, body=body.body)
    ctx.db.add(c)
    ctx.db.commit()
    return {"id": c.id, "body": c.body, "author": account_person(ctx.db, c.author_account_id), "created_at": c.created_at}


@router.get("/{task_id}/history")
def history(task_id: int, ctx: Ctx = Depends(get_ctx)):
    t = _get_task(ctx, task_id)
    return [
        {"id": e.id, "kind": e.kind, "summary": e.summary, "actor": account_person(ctx.db, e.actor_account_id), "at": e.at, "data": e.data}
        for e in ctx.db.scalars(select(TaskEvent).where(TaskEvent.task_id == t.id).order_by(TaskEvent.at.desc(), TaskEvent.id.desc()))
    ]
