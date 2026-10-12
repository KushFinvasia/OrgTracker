from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import or_, select

from app.api.deps import Ctx, get_ctx
from app.models import (
    Blocker,
    CheckIn,
    Course,
    DeadlineChange,
    Employee,
    MetricInput,
    Nomination,
    Notification,
    Period,
    Project,
    ProjectClosure,
    RewardCycle,
    RuleVersion,
    Task,
    TrainingAssignment,
    TrainingException,
    WorkRequest,
)
from app.services.common import person, today
from app.services.delivery import project_metrics

router = APIRouter(tags=["home"])


def _visible_projects(ctx: Ctx):
    q = select(Project).where(Project.archived.is_(False))
    ids = ctx.scope.visible_project_ids
    if ids is not None:
        q = q.where(Project.id.in_(ids))
    return list(ctx.db.scalars(q))


def current_period(ctx: Ctx) -> Period | None:
    t = today()
    return ctx.db.scalar(select(Period).where(Period.start_date <= t, Period.end_date >= t).order_by(Period.id.desc())) or ctx.db.scalar(
        select(Period).order_by(Period.end_date.desc())
    )


def action_items(ctx: Ctx) -> list[dict]:
    db, me = ctx.db, ctx.me
    items: list[dict] = []

    for t in db.scalars(select(Task).where(Task.reviewer_id == me, Task.status == "In Review")):
        items.append({"type": "Work review", "title": f"{t.title} is ready for review", "context": t.code, "since": t.updated_at, "action": "Review work", "link": f"/tasks?task={t.id}&panel=review"})
    for b in db.scalars(select(Blocker).where(Blocker.validator_id == me, Blocker.state == "Pending")):
        t = db.get(Task, b.task_id)
        items.append({"type": "Validation", "title": f"Blocker: {b.category}", "context": t.title if t else "", "since": b.created_at, "action": "Validate blocker", "link": f"/tasks?task={b.task_id}&panel=dependencies"})
    for c in db.scalars(select(DeadlineChange).where(DeadlineChange.validator_id == me, DeadlineChange.state == "Pending")):
        t = db.get(Task, c.task_id)
        items.append({"type": "Validation", "title": f"Date change to {c.requested_date:%d %b %Y}", "context": t.title if t else "", "since": c.created_at, "action": "Validate date", "link": f"/tasks?task={c.task_id}&panel=dependencies"})
    for a in db.scalars(select(TrainingAssignment).where(TrainingAssignment.verifier_id == me, TrainingAssignment.status == "Submitted")):
        items.append({"type": "Training review", "title": f"Verify {a.course.title}", "context": f"{a.employee.full_name} / {a.code}", "since": a.submitted_at, "action": "Verify completion", "link": f"/people/{a.employee_id}?tab=training&assignment={a.id}"})
    for x in db.scalars(select(TrainingException).where(TrainingException.approver_id == me, TrainingException.state == "Pending")):
        a = db.get(TrainingAssignment, x.assignment_id)
        items.append({"type": "Training exception", "title": f"{x.exception_type} request", "context": f"{a.employee.full_name} / {a.code}", "since": x.created_at, "action": "Review exception", "link": f"/people/{a.employee_id}?tab=training&assignment={a.id}"})
    for m in db.scalars(select(MetricInput).where(MetricInput.validator_id == me, MetricInput.state == "Submitted")):
        e = db.get(Employee, m.employee_id)
        items.append({"type": "Validation", "title": f"Validate {m.metric} input", "context": e.full_name if e else "", "since": m.created_at, "action": "Validate input", "link": "/admin/workflows?tab=inputs"})
    for n in db.scalars(select(Nomination).where(Nomination.reviewer_account_id == ctx.account.id, Nomination.state == "Submitted")):
        e = db.get(Employee, n.employee_id)
        items.append({"type": "R&R review", "title": f"{n.award_type} nomination", "context": e.full_name if e else "", "since": n.created_at, "action": "Open nomination", "link": f"/rewards/nominations/{n.id}"})
    if ctx.account.role in ("admin", "hod"):
        for r in db.scalars(select(RuleVersion).where(RuleVersion.state == "Pending approval", RuleVersion.author_account_id != ctx.account.id)):
            items.append({"type": "Policy approval", "title": f"{r.kind.upper()} rule {r.label}", "context": r.summary or "", "since": r.created_at, "action": "Review policy", "link": f"/admin/rules?tab=approval&rule={r.id}"})
    for cl in db.scalars(select(ProjectClosure).where(ProjectClosure.state == "Submitted", ProjectClosure.submitted_by != ctx.account.id)):
        p = db.get(Project, cl.project_id)
        if p and (p.department_id in ctx.scope.headed_departments or (p.priority != "High" and p.reviewer_id == me)):
            items.append({"type": "Closure", "title": f"Close {p.title}", "context": f"{p.code} / {p.priority} priority", "since": None, "action": "Review closure", "link": f"/projects/{p.id}?tab=closure"})
    for r in db.scalars(select(WorkRequest).where(or_(WorkRequest.validator_id == me), WorkRequest.state == "Submitted")):
        items.append({"type": "Request", "title": f"Validate request: {r.title}", "context": "Cross-team request", "since": r.created_at, "action": "Validate request", "link": f"/projects?tab=requests&request={r.id}"})

    perf = ctx.scope.perf_people
    period = current_period(ctx)
    if ctx.account.role == "manager" and period and period.state != "Locked" and perf:
        month = today().replace(day=1)
        done = set(db.scalars(select(CheckIn.employee_id).where(CheckIn.period_id == period.id, CheckIn.month >= month, CheckIn.state == "Finalized")))
        for e in db.scalars(select(Employee).where(Employee.id.in_(perf), Employee.record_type == "employee", Employee.manager_id == me)):
            if e.id not in done:
                items.append({"type": "Check-in", "title": f"{month:%B} check-in", "context": f"{e.full_name} / {e.department.name if e.department else ''}", "since": None, "action": "Complete check-in", "link": f"/performance/{e.id}/{period.id}?tab=checkin"})
    for c in db.scalars(select(RewardCycle).where(RewardCycle.state == "Nominations")):
        if ctx.account.role in ("manager", "hod"):
            items.append({"type": "Recognition", "title": "Recognition nominations are open", "context": f"{c.title} / closes {c.nomination_end:%d %b %Y}" if c.nomination_end else c.title, "since": None, "action": "Open cycle", "link": "/rewards"})
    return items


@router.get("/home")
def home(ctx: Ctx = Depends(get_ctx)):
    db = ctx.db
    projects = _visible_projects(ctx)
    active = [p for p in projects if p.status not in ("Completed", "Cancelled")]
    ref = today()
    due_month = [p for p in active if p.target_date and p.target_date.year == ref.year and p.target_date.month == ref.month]
    total_c = acc_c = 0
    for p in active:
        for t in db.scalars(select(Task).where(Task.project_id == p.id, Task.status != "Cancelled")):
            total_c += t.complexity
            acc_c += t.complexity if t.status == "Completed" else 0
    reviews = list(db.scalars(select(Task).where(Task.reviewer_id == ctx.me, Task.status == "In Review")))
    oldest = min((t.updated_at for t in reviews), default=None)

    # Accepted tasks per week across visible projects (last 6 weeks)
    week0 = ref - timedelta(days=ref.weekday()) - timedelta(weeks=5)
    pids = [p.id for p in projects]
    weeks = []
    for i in range(6):
        ws = week0 + timedelta(weeks=i)
        we = ws + timedelta(days=6)
        n = 0
        if pids:
            n = len(list(db.scalars(select(Task.id).where(Task.project_id.in_(pids), Task.status == "Completed", Task.accepted_submission_date >= ws, Task.accepted_submission_date <= we))))
        weeks.append({"label": f"W{i + 1}", "week_start": ws, "accepted": n})

    checkins = None
    period = current_period(ctx)
    if ctx.account.role == "manager" and period:
        direct = list(db.scalars(select(Employee.id).where(Employee.manager_id == ctx.me, Employee.record_type == "employee")))
        month = ref.replace(day=1)
        done = len(set(db.scalars(select(CheckIn.employee_id).where(CheckIn.employee_id.in_(direct), CheckIn.month >= month, CheckIn.state == "Finalized"))))
        checkins = {"done": done, "total": len(direct)}

    items = action_items(ctx)
    return {
        "today": ref,
        "role": ctx.account.role,
        "employee": person(ctx.employee),
        "period": {"id": period.id, "name": period.name, "state": period.state} if period else None,
        "stats": {
            "active_projects": len(active),
            "due_this_month": len(due_month),
            "accepted_delivery": (acc_c / total_c * 100) if total_c else None,
            "reviews_waiting": len(reviews),
            "oldest_review": oldest,
            "checkins": checkins,
            "team_size": len(ctx.scope.reporting_tree),
        },
        "actions": items,
        "rhythm": weeks,
        "pinned": [{"id": p.id, "title": p.title, "code": p.code} for p in sorted(active, key=lambda p: (p.priority != "High", p.target_date or date.max))[:3]],
    }


@router.get("/actions")
def actions(ctx: Ctx = Depends(get_ctx)):
    return action_items(ctx)


@router.get("/notifications")
def notifications(ctx: Ctx = Depends(get_ctx)):
    rows = ctx.db.scalars(select(Notification).where(Notification.account_id == ctx.account.id).order_by(Notification.created_at.desc()).limit(30))
    return [{"id": n.id, "title": n.title, "body": n.body, "link": n.link, "read": n.read_at is not None, "created_at": n.created_at} for n in rows]


@router.post("/notifications/read-all")
def read_all(ctx: Ctx = Depends(get_ctx)):
    for n in ctx.db.scalars(select(Notification).where(Notification.account_id == ctx.account.id, Notification.read_at.is_(None))):
        n.read_at = datetime.now()
    ctx.db.commit()
    return {"ok": True}


@router.get("/search")
def search(q: str, ctx: Ctx = Depends(get_ctx)):
    """Scope-aware: results only include records the account may open. Private scores never appear."""
    db, term = ctx.db, f"%{q.strip()}%"
    if len(q.strip()) < 2:
        return {"projects": [], "tasks": [], "people": [], "training": []}
    pq = select(Project).where(or_(Project.title.ilike(term), Project.code.ilike(term)))
    ids = ctx.scope.visible_project_ids
    if ids is not None:
        pq = pq.where(Project.id.in_(ids))
    projects = [{"id": p.id, "code": p.code, "title": p.title, "department": p.department.name if p.department else None} for p in db.scalars(pq.limit(8))]
    tq = select(Task).where(or_(Task.title.ilike(term), Task.code.ilike(term)))
    if ids is not None:
        tq = tq.where(Task.project_id.in_(ids))
    tasks = [{"id": t.id, "code": t.code, "title": t.title, "status": t.status} for t in db.scalars(tq.limit(8))]
    eq = select(Employee).where(or_(Employee.full_name.ilike(term), Employee.code.ilike(term)))
    if ctx.scope.work_people is not None:
        eq = eq.where(Employee.id.in_(ctx.scope.work_people))
    people = [person(e) for e in db.scalars(eq.limit(8))]
    training = []
    if ctx.scope.work_people is None or ctx.scope.work_people:
        trq = select(TrainingAssignment).join(Course).where(or_(Course.title.ilike(term), TrainingAssignment.code.ilike(term)))
        if ctx.scope.work_people is not None:
            trq = trq.where(TrainingAssignment.employee_id.in_(ctx.scope.work_people))
        training = [{"id": a.id, "code": a.code, "title": a.course.title, "employee": a.employee.full_name, "employee_id": a.employee_id} for a in db.scalars(trq.limit(8))]
    return {"projects": projects, "tasks": tasks, "people": people, "training": training}
