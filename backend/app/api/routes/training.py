import shutil
import uuid
from datetime import date, datetime

from fastapi import APIRouter, Depends, File, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from app.api.deps import Ctx, get_ctx
from app.core.config import settings
from app.core.errors import Forbidden, NotFound, RuleViolation
from app.models import Course, Employee, EvidenceFile, TrainingAssignment, TrainingAttempt, TrainingException
from app.schemas.common import DecisionIn
from app.services.audit import notify, record
from app.services.common import account_for_employee, account_person, person, person_by_id, today
from app.core.clock import now_ist

router = APIRouter(prefix="/training", tags=["training"])


class CourseIn(BaseModel):
    code: str
    title: str
    course_type: str = "Mandatory"
    applicability: str | None = None
    completion_criteria: str
    pass_mark: float | None = None
    duration_hours: float | None = None
    evidence_requirements: str | None = None
    recurrence: str | None = None


class AssignIn(BaseModel):
    employee_ids: list[int] = Field(min_length=1)
    course_id: int
    assigned_date: date
    due_date: date
    training_type: str = "Mandatory"
    verifier_id: int
    period_id: int | None = None
    completion_criteria: str | None = None
    pass_mark: float | None = None
    preview: bool = False


class TrainingUpdateIn(BaseModel):
    status: str | None = None  # Assigned | In progress
    progress: int | None = Field(default=None, ge=0, le=100)
    completion_date: date | None = None
    assessment_result: float | None = None
    attendance_ok: bool | None = None
    evidence_note: str | None = None


class AttemptIn(BaseModel):
    result: float | None = None
    attempt_date: date
    note: str | None = None


class ExceptionIn(BaseModel):
    exception_type: str  # Exemption | Cancellation | Due-date change
    reason: str = Field(min_length=3)
    evidence: str = Field(min_length=3)
    proposed_due_date: date | None = None
    approver_id: int
    effective_date: date


def course_dict(c: Course) -> dict:
    return {
        "id": c.id, "code": c.code, "version": c.version, "title": c.title, "course_type": c.course_type,
        "applicability": c.applicability, "completion_criteria": c.completion_criteria, "pass_mark": c.pass_mark,
        "duration_hours": c.duration_hours, "evidence_requirements": c.evidence_requirements, "recurrence": c.recurrence,
        "state": c.state, "illustrative": c.illustrative,
    }


def assignment_dict(ctx: Ctx, a: TrainingAssignment) -> dict:
    ref = today()
    upcoming = a.status not in ("Verified complete", "Exempt", "Cancelled") and a.due_date > ref
    return {
        "id": a.id,
        "code": a.code,
        "course": {"id": a.course.id, "code": a.course.code, "title": a.course.title, "version": a.course_version},
        "employee": person(a.employee),
        "assigned_date": a.assigned_date,
        "due_date": a.due_date,
        "due_date_original": a.due_date_original,
        "training_type": a.training_type,
        "completion_criteria": a.completion_criteria,
        "pass_mark": a.pass_mark,
        "duration_hours": a.duration_hours,
        "verifier": person_by_id(ctx.db, a.verifier_id),
        "status": a.status,
        "display_status": "Upcoming" if upcoming and a.status == "Assigned" else a.status,
        "overdue": a.status not in ("Verified complete", "Exempt", "Cancelled") and a.due_date < ref,
        "progress": a.progress,
        "completion_date": a.completion_date,
        "assessment_result": a.assessment_result,
        "attendance_ok": a.attendance_ok,
        "evidence_note": a.evidence_note,
        "recorded_by": account_person(ctx.db, a.recorded_by),
        "verified_by": account_person(ctx.db, a.verified_by),
        "verified_at": a.verified_at,
        "verification_note": a.verification_note,
        "attempts": [
            {"attempt_no": t.attempt_no, "result": t.result, "date": t.attempt_date, "note": t.note}
            for t in ctx.db.scalars(select(TrainingAttempt).where(TrainingAttempt.assignment_id == a.id).order_by(TrainingAttempt.attempt_no))
        ],
        "exceptions": [
            {"id": x.id, "type": x.exception_type, "reason": x.reason, "state": x.state, "approver": person_by_id(ctx.db, x.approver_id), "proposed_due_date": x.proposed_due_date, "decision_note": x.decision_note, "requested_by": account_person(ctx.db, x.requested_by)}
            for x in ctx.db.scalars(select(TrainingException).where(TrainingException.assignment_id == a.id).order_by(TrainingException.created_at.desc()))
        ],
        "evidence": [
            {"id": f.id, "filename": f.filename, "uploaded_at": f.uploaded_at}
            for f in ctx.db.scalars(select(EvidenceFile).where(EvidenceFile.training_assignment_id == a.id))
        ],
        "can_verify": a.verifier_id == ctx.me and a.status == "Submitted" and a.recorded_by != ctx.account.id,
        "illustrative": a.illustrative,
    }


def _get(ctx: Ctx, assignment_id: int) -> TrainingAssignment:
    a = ctx.db.get(TrainingAssignment, assignment_id)
    if a is None:
        raise NotFound("Training assignment")
    if not ctx.scope.can_see_person(a.employee_id):
        raise Forbidden()
    return a


def _require_record_rights(ctx: Ctx, a: TrainingAssignment) -> None:
    """Managers (reporting scope) and permitted Team Leads record progress/evidence on the employee's behalf."""
    if ctx.scope.is_admin:
        return
    if a.employee_id not in (ctx.scope.work_people or set()) or a.employee_id == ctx.me:
        raise Forbidden("You can record training only for your own team.")


@router.get("/courses")
def courses(ctx: Ctx = Depends(get_ctx)):
    return [course_dict(c) for c in ctx.db.scalars(select(Course).order_by(Course.code, Course.version.desc()))]


@router.post("/courses")
def create_course(body: CourseIn, ctx: Ctx = Depends(get_ctx)):
    ctx.scope.require_role("admin")
    latest = ctx.db.scalar(select(func.max(Course.version)).where(Course.code == body.code)) or 0
    c = Course(**body.model_dump(), version=latest + 1, state="Draft")
    ctx.db.add(c)
    ctx.db.flush()
    record(ctx.db, ctx.account.id, "create_course_version", "course", c.id, f"{c.code} v{c.version}", None, body.model_dump())
    ctx.db.commit()
    return course_dict(c)


@router.post("/courses/{course_id}/approve")
def approve_course(course_id: int, ctx: Ctx = Depends(get_ctx)):
    ctx.scope.require_role("admin")
    c = ctx.db.get(Course, course_id)
    if c is None:
        raise NotFound("Course")
    c.state = "Approved"
    record(ctx.db, ctx.account.id, "approve_course_version", "course", c.id, f"{c.code} v{c.version}")
    ctx.db.commit()
    return course_dict(c)


@router.post("/assignments")
def assign(body: AssignIn, ctx: Ctx = Depends(get_ctx)):
    """Bulk allocation with per-person preview/outcome. Existing open assignments for the same course are flagged, not duplicated."""
    ctx.scope.require_role("admin", "hod", "manager")
    c = ctx.db.get(Course, body.course_id)
    if c is None or c.state != "Approved":
        raise RuleViolation("Choose an approved catalog course version.", "course_id")
    if body.due_date < body.assigned_date:
        raise RuleViolation("Due date cannot be before the assigned date.", "due_date")
    outcomes = []
    for emp_id in body.employee_ids:
        e = ctx.db.get(Employee, emp_id)
        if e is None or not ctx.scope.can_see_perf(emp_id):
            outcomes.append({"employee_id": emp_id, "result": "error", "message": "Outside your reporting scope."})
            continue
        if body.verifier_id == emp_id:
            outcomes.append({"employee": person(e), "result": "error", "message": "The employee cannot verify their own training."})
            continue
        existing = ctx.db.scalar(
            select(TrainingAssignment).where(
                TrainingAssignment.employee_id == emp_id,
                TrainingAssignment.course_id.in_(select(Course.id).where(Course.code == c.code)),
                TrainingAssignment.status.not_in(["Verified complete", "Exempt", "Cancelled"]),
            )
        )
        if existing:
            outcomes.append({"employee": person(e), "result": "skipped", "message": f"Already assigned ({existing.code}). Retakes are attempts on that assignment."})
            continue
        if body.preview:
            outcomes.append({"employee": person(e), "result": "ready", "message": f"Due {body.due_date:%d %b %Y}"})
            continue
        n = (ctx.db.scalar(select(func.count()).select_from(TrainingAssignment)) or 0) + 1
        a = TrainingAssignment(
            code=f"TA-{n:04d}",
            course_id=c.id,
            course_version=c.version,
            employee_id=emp_id,
            assigned_date=body.assigned_date,
            due_date_original=body.due_date,
            due_date=body.due_date,
            training_type=body.training_type,
            completion_criteria=body.completion_criteria or c.completion_criteria,
            pass_mark=body.pass_mark if body.pass_mark is not None else c.pass_mark,
            duration_hours=c.duration_hours,
            verifier_id=body.verifier_id,
            period_id=body.period_id,
            status="Assigned",
        )
        ctx.db.add(a)
        ctx.db.flush()
        record(ctx.db, ctx.account.id, "assign_training", "training", a.id, f"{c.code} > {e.full_name}", None, {"due": body.due_date, "verifier": body.verifier_id})
        outcomes.append({"employee": person(e), "result": "assigned", "code": a.code})
    if not body.preview:
        ctx.db.commit()
    return {"outcomes": outcomes}


@router.get("/assignments/{assignment_id}")
def get_assignment(assignment_id: int, ctx: Ctx = Depends(get_ctx)):
    return assignment_dict(ctx, _get(ctx, assignment_id))


@router.patch("/assignments/{assignment_id}")
def update_assignment(assignment_id: int, body: TrainingUpdateIn, ctx: Ctx = Depends(get_ctx)):
    a = _get(ctx, assignment_id)
    _require_record_rights(ctx, a)
    if a.status in ("Verified complete", "Exempt", "Cancelled", "Submitted"):
        raise RuleViolation(f"This record is {a.status}; it cannot be edited directly.", "status")
    changes = body.model_dump(exclude_unset=True)
    if changes.get("status") not in (None, "Assigned", "In progress"):
        raise RuleViolation("Use Send for verification to submit completion.", "status")
    if changes.get("completion_date") and changes["completion_date"] > today():
        raise RuleViolation("Completion date cannot be in the future.", "completion_date")
    old = {k: getattr(a, k) for k in changes}
    for k, v in changes.items():
        setattr(a, k, v)
    if a.status == "Returned":
        a.status = "In progress"
    a.recorded_by = ctx.account.id
    record(ctx.db, ctx.account.id, "update_training", "training", a.id, a.code, old, changes)
    ctx.db.commit()
    return assignment_dict(ctx, a)


@router.post("/assignments/{assignment_id}/evidence")
def upload_training_evidence(assignment_id: int, file: UploadFile = File(...), ctx: Ctx = Depends(get_ctx)):
    a = _get(ctx, assignment_id)
    _require_record_rights(ctx, a)
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    dest = settings.upload_dir / f"{uuid.uuid4().hex}_{(file.filename or 'evidence').replace('/', '_')}"
    with dest.open("wb") as out:
        shutil.copyfileobj(file.file, out)
    ev = EvidenceFile(training_assignment_id=a.id, filename=file.filename or dest.name, stored_path=str(dest), size=dest.stat().st_size, uploaded_by=ctx.account.id)
    ctx.db.add(ev)
    ctx.db.commit()
    return {"id": ev.id, "filename": ev.filename}


@router.post("/assignments/{assignment_id}/attempts")
def add_attempt(assignment_id: int, body: AttemptIn, ctx: Ctx = Depends(get_ctx)):
    a = _get(ctx, assignment_id)
    _require_record_rights(ctx, a)
    n = (ctx.db.scalar(select(func.max(TrainingAttempt.attempt_no)).where(TrainingAttempt.assignment_id == a.id)) or 0) + 1
    ctx.db.add(TrainingAttempt(assignment_id=a.id, attempt_no=n, result=body.result, attempt_date=body.attempt_date, note=body.note, recorded_by=ctx.account.id))
    if body.result is not None:
        a.assessment_result = body.result
    record(ctx.db, ctx.account.id, "training_attempt", "training", a.id, f"{a.code} attempt {n}", None, body.model_dump())
    ctx.db.commit()
    return assignment_dict(ctx, a)


@router.post("/assignments/{assignment_id}/submit")
def submit_for_verification(assignment_id: int, ctx: Ctx = Depends(get_ctx)):
    a = _get(ctx, assignment_id)
    _require_record_rights(ctx, a)
    if a.status not in ("Assigned", "In progress", "Returned"):
        raise RuleViolation(f"This record is {a.status}.", "status")
    if not a.completion_date:
        raise RuleViolation("Enter the completion date.", "completion_date")
    if a.completion_date > today():
        raise RuleViolation("Completion date cannot be in the future.", "completion_date")
    criteria = (a.completion_criteria or "").lower()
    if "attendance" in criteria and not a.attendance_ok:
        raise RuleViolation("Required attendance is not recorded.", "attendance_ok")
    if "assessment" in criteria and a.pass_mark is not None and (a.assessment_result is None or a.assessment_result < a.pass_mark):
        raise RuleViolation(f"Assessment result must meet the pass requirement of {a.pass_mark:g}%.", "assessment_result")
    has_files = ctx.db.scalar(select(EvidenceFile.id).where(EvidenceFile.training_assignment_id == a.id))
    if not has_files and not (a.evidence_note or "").strip():
        raise RuleViolation("Attach the required evidence before sending for verification.", "evidence")
    if a.verifier_id == ctx.me:
        raise RuleViolation("You are the named verifier; another person must record and submit this completion.", "verifier_id")
    a.status = "Submitted"
    a.progress = 100
    a.submitted_at = now_ist()
    a.recorded_by = ctx.account.id
    record(ctx.db, ctx.account.id, "submit_training", "training", a.id, a.code, None, {"status": "Submitted"})
    acc = account_for_employee(ctx.db, a.verifier_id)
    notify(ctx.db, acc.id if acc else None, f"Verify training: {a.course.title}", a.employee.full_name, f"/people/{a.employee_id}?tab=training&assignment={a.id}")
    ctx.db.commit()
    return assignment_dict(ctx, a)


@router.post("/assignments/{assignment_id}/verify")
def verify(assignment_id: int, body: DecisionIn, ctx: Ctx = Depends(get_ctx)):
    a = _get(ctx, assignment_id)
    if a.verifier_id != ctx.me:
        raise Forbidden("Only the named verifier can decide.")
    if a.recorded_by == ctx.account.id:
        raise RuleViolation("The verifier must differ from the person who recorded the completion.", "verifier")
    if a.employee_id == ctx.me:
        raise RuleViolation("You cannot verify your own training.", "verifier")
    if a.status != "Submitted":
        raise RuleViolation("This record is not waiting for verification.", "status")
    if body.decision == "verify":
        a.status = "Verified complete"
        a.verified_by = ctx.account.id
        a.verified_at = now_ist()
    elif body.decision == "return" and body.reason:
        a.status = "Returned"
    else:
        raise RuleViolation("Verify complete, or return the evidence with a reason.", "reason")
    a.verification_note = body.reason
    record(ctx.db, ctx.account.id, f"training_{body.decision}", "training", a.id, a.code, {"status": "Submitted"}, {"status": a.status}, body.reason)
    ctx.db.commit()
    return assignment_dict(ctx, a)


@router.post("/assignments/{assignment_id}/exceptions")
def request_exception(assignment_id: int, body: ExceptionIn, ctx: Ctx = Depends(get_ctx)):
    a = _get(ctx, assignment_id)
    _require_record_rights(ctx, a)
    if body.exception_type not in ("Exemption", "Cancellation", "Due-date change"):
        raise RuleViolation("Choose Exemption, Cancellation or Due-date change.", "exception_type")
    if body.exception_type == "Due-date change" and not body.proposed_due_date:
        raise RuleViolation("Enter the proposed due date.", "proposed_due_date")
    if body.approver_id in (ctx.me, a.employee_id):
        raise RuleViolation("Applicants cannot approve their own exception. Choose an independent approver.", "approver_id")
    x = TrainingException(assignment_id=a.id, requested_by=ctx.account.id, **body.model_dump())
    ctx.db.add(x)
    record(ctx.db, ctx.account.id, "request_training_exception", "training", a.id, a.code, None, body.model_dump())
    acc = account_for_employee(ctx.db, body.approver_id)
    notify(ctx.db, acc.id if acc else None, f"Training exception: {a.course.title}", a.employee.full_name, f"/people/{a.employee_id}?tab=training&assignment={a.id}")
    ctx.db.commit()
    return assignment_dict(ctx, a)


@router.post("/exceptions/{exception_id}/decide")
def decide_exception(exception_id: int, body: DecisionIn, ctx: Ctx = Depends(get_ctx)):
    x = ctx.db.get(TrainingException, exception_id)
    if x is None:
        raise NotFound("Exception")
    a = ctx.db.get(TrainingAssignment, x.assignment_id)
    if x.approver_id != ctx.me or x.requested_by == ctx.account.id:
        raise Forbidden("Only the independent named approver can decide.")
    if x.state != "Pending":
        raise RuleViolation("Already decided.", "state")
    if body.decision not in ("approve", "reject") or not body.reason:
        raise RuleViolation("Approve or reject with a reason.", "reason")
    x.state = "Approved" if body.decision == "approve" else "Rejected"
    x.decision_note = body.reason
    x.decided_at = now_ist()
    old = {"status": a.status, "due_date": a.due_date}
    if x.state == "Approved":
        if x.exception_type == "Exemption":
            a.status = "Exempt"
        elif x.exception_type == "Cancellation":
            a.status = "Cancelled"
        else:
            a.due_date = x.proposed_due_date  # original stays in due_date_original
    record(ctx.db, ctx.account.id, f"training_exception_{body.decision}", "training", a.id, a.code, old, {"status": a.status, "due_date": a.due_date}, body.reason)
    ctx.db.commit()
    return assignment_dict(ctx, a)


@router.get("/queue")
def verification_queue(ctx: Ctx = Depends(get_ctx)):
    return [assignment_dict(ctx, a) for a in ctx.db.scalars(select(TrainingAssignment).where(TrainingAssignment.verifier_id == ctx.me, TrainingAssignment.status == "Submitted"))]
