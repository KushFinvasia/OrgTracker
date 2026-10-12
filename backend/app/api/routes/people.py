from fastapi import APIRouter, Depends
from sqlalchemy import or_, select

from app.api.deps import Ctx, get_ctx
from app.core.errors import Forbidden, NotFound
from app.models import Account, CheckIn, Department, DepartmentHead, Employee, MetricInput, Nomination, Period, ReportingLine, Snapshot, TrainingAssignment
from app.services.common import person, person_by_id, task_timing, today
from app.services.delivery import accepted_output, assignment_rows_for, reported_progress
from app.services.evaluation import evaluate, training_summary

router = APIRouter(tags=["people"])


def _period(ctx: Ctx, period_id: int | None) -> Period | None:
    if period_id:
        return ctx.db.get(Period, period_id)
    t = today()
    # Prefer the most recent period under review; fall back to the current one.
    return ctx.db.scalar(select(Period).where(Period.state.in_(["Under Review", "Calculating"])).order_by(Period.end_date.desc())) or ctx.db.scalar(
        select(Period).where(Period.start_date <= t, Period.end_date >= t)
    )


@router.get("/departments")
def departments(ctx: Ctx = Depends(get_ctx)):
    out = []
    for d in ctx.db.scalars(select(Department).order_by(Department.name)):
        heads = [person_by_id(ctx.db, h) for h in ctx.db.scalars(select(DepartmentHead.employee_id).where(DepartmentHead.department_id == d.id))]
        out.append({"id": d.id, "name": d.name, "category": d.category, "category_proposed": d.category_proposed, "aliases": d.aliases, "heads": heads, "notes": d.notes})
    return out


@router.get("/people/lookup")
def lookup(q: str = "", limit: int = 20, ctx: Ctx = Depends(get_ctx)):
    """Identity-only picker (ID, name, designation, department). No work or performance data.
    Organisation-wide so independent reviewers/validators from other teams can be chosen."""
    query = select(Employee).where(Employee.record_type == "employee")
    if q.strip():
        term = f"%{q.strip()}%"
        query = query.where(or_(Employee.full_name.ilike(term), Employee.code.ilike(term), Employee.designation.ilike(term)))
    return [person(e) for e in ctx.db.scalars(query.order_by(Employee.full_name).limit(min(limit, 50)))]


@router.get("/team")
def team(ctx: Ctx = Depends(get_ctx)):
    """Roster for the account's reporting tree (or headed departments)."""
    people = ctx.scope.work_people
    q = select(Employee)
    if people is not None:
        q = q.where(Employee.id.in_(people - {ctx.me}))
    else:
        q = q.where(Employee.manager_id == ctx.me)
    period = _period(ctx, None)
    month = today().replace(day=1)
    out = []
    for e in ctx.db.scalars(q.order_by(Employee.full_name)):
        rows = assignment_rows_for(ctx.db, e.id)
        active = [t for t, _, _ in rows if t.status not in ("Completed", "Cancelled")]
        item = {
            **person(e),
            "manager": person_by_id(ctx.db, e.manager_id),
            "account_role": ctx.db.scalar(select(Account.role).where(Account.employee_id == e.id)),
            "active_assignments": len(active),
            "overdue": sum(1 for t in active if task_timing(t.status, t.due_date, None) == "Overdue"),
            "blocked": sum(1 for t in active if t.status == "Blocked"),
            "proposed_role": e.proposed_role,
            "flags": e.flags,
        }
        if ctx.scope.can_see_perf(e.id) and period:
            ci = ctx.db.scalar(select(CheckIn).where(CheckIn.employee_id == e.id, CheckIn.period_id == period.id).order_by(CheckIn.month.desc()))
            item["checkin"] = None if ci is None else ("Completed" if ci.state == "Finalized" and ci.month >= month else "Needs evidence" if ci.state == "Draft" else "Due")
        out.append(item)
    return out


@router.get("/people/{employee_id}")
def person_workspace(employee_id: int, period_id: int | None = None, ctx: Ctx = Depends(get_ctx)):
    e = ctx.db.get(Employee, employee_id)
    if e is None:
        raise NotFound("Person")
    if not ctx.scope.can_see_person(e.id):
        raise Forbidden("This person is outside your reporting and work scope.")
    rows = assignment_rows_for(ctx.db, e.id)
    pairs = [(t, s) for t, s, _ in rows]
    period = _period(ctx, period_id)
    out = {
        **person(e),
        "hrms_code": e.hrms_code,
        "manager": person_by_id(ctx.db, e.manager_id),
        "flags": e.flags,
        "proposed_role": e.proposed_role,
        "reports": [person(r) for r in ctx.db.scalars(select(Employee).where(Employee.manager_id == e.id))],
        "work": {
            "assigned": len(rows),
            "active": sum(1 for t, _, _ in rows if t.status not in ("Completed", "Cancelled")),
            "accepted": sum(1 for t, _, _ in rows if t.status == "Completed"),
            "accepted_output": round(accepted_output(pairs), 2),
            "reported_progress": reported_progress(pairs),
            "overdue": sum(1 for t, _, _ in rows if task_timing(t.status, t.due_date, t.accepted_submission_date) == "Overdue"),
            "blocked": sum(1 for t, _, _ in rows if t.status == "Blocked"),
            "projects": len({t.project_id for t, _, _ in rows}),
        },
        "reporting_history": [
            {"manager": person_by_id(ctx.db, r.manager_id), "from": r.effective_from, "to": r.effective_to, "reason": r.reason}
            for r in ctx.db.scalars(select(ReportingLine).where(ReportingLine.employee_id == e.id).order_by(ReportingLine.effective_from.desc()))
        ],
        "can_see_performance": ctx.scope.can_see_perf(e.id),
        "period": {"id": period.id, "name": period.name, "state": period.state} if period else None,
    }
    if ctx.scope.can_see_perf(e.id) and period:
        ev = evaluate(ctx.db, e, period)
        out["performance"] = {
            "base_kpi": ev["base"]["value"],
            "coverage": ev["base"]["coverage"],
            "final": ev["final"],
            "tier": ev["tier"],
            "training": {k: ev["training"][k] for k in ("allotted", "eligible", "verified", "score", "status")},
            "period": ev["period"],
            "training_rule": ev["training_rule"],
        }
        out["recognition"] = [
            {"id": n.id, "award_type": n.award_type, "state": n.state, "cycle_id": n.cycle_id}
            for n in ctx.db.scalars(select(Nomination).where(Nomination.employee_id == e.id))
        ]
        out["snapshots"] = [
            {"id": s.id, "period_id": s.period_id, "final": s.final_score, "base": s.base_kpi, "status": s.status}
            for s in ctx.db.scalars(select(Snapshot).where(Snapshot.employee_id == e.id))
        ]
    return out


@router.get("/people/{employee_id}/work")
def person_work(employee_id: int, ctx: Ctx = Depends(get_ctx)):
    if not ctx.scope.can_see_person(employee_id):
        raise Forbidden()
    visible = ctx.scope.visible_project_ids
    out = []
    for t, share, a in assignment_rows_for(ctx.db, employee_id):
        if visible is not None and t.project_id not in visible:
            continue
        out.append(
            {
                "task_id": t.id,
                "code": t.code,
                "title": t.title,
                "project_id": t.project_id,
                "role": a.role,
                "share": round(share * 100, 2),
                "status": t.status,
                "due_date": t.due_date,
                "progress": t.progress,
                "complexity": t.complexity,
                "timing": task_timing(t.status, t.due_date, t.accepted_submission_date),
                "weighted_output": round(t.complexity * share, 2) if t.status == "Completed" else None,
            }
        )
    return out


@router.get("/hierarchy")
def hierarchy(root_id: int | None = None, ctx: Ctx = Depends(get_ctx)):
    """Reporting branch under the account (or a permitted root). Vacant positions shown separately."""
    root = root_id or ctx.me
    if not ctx.scope.can_see_person(root):
        raise Forbidden()
    emps = {e.id: e for e in ctx.db.scalars(select(Employee))}
    children: dict[int, list[int]] = {}
    for e in emps.values():
        if e.manager_id:
            children.setdefault(e.manager_id, []).append(e.id)

    def node(eid: int, depth: int) -> dict:
        e = emps[eid]
        kids = sorted(children.get(eid, []), key=lambda i: emps[i].full_name) if depth < 4 else []
        return {**person(e), "children": [node(k, depth + 1) for k in kids], "child_count": len(children.get(eid, []))}

    r = emps.get(root)
    return {"root": node(root, 0), "manager": person(emps.get(r.manager_id)) if r and r.manager_id else None}


@router.get("/team/capacity")
def capacity(period_id: int | None = None, ctx: Ctx = Depends(get_ctx)):
    period = _period(ctx, period_id)
    people = ctx.scope.reporting_tree if not ctx.scope.is_admin else set(ctx.db.scalars(select(Employee.id).where(Employee.manager_id == ctx.me)))
    out = []
    for e in ctx.db.scalars(select(Employee).where(Employee.id.in_(people)).order_by(Employee.full_name)):
        rows = assignment_rows_for(ctx.db, e.id)
        active = [(t, s) for t, s, _ in rows if t.status not in ("Completed", "Cancelled")]
        cap = None
        if period:
            cap = ctx.db.scalar(select(MetricInput).where(MetricInput.employee_id == e.id, MetricInput.period_id == period.id, MetricInput.metric == "capacity").order_by(MetricInput.created_at.desc()))
        training_hours = sum(a.duration_hours or 0 for a in ctx.db.scalars(select(TrainingAssignment).where(TrainingAssignment.employee_id == e.id, TrainingAssignment.status.in_(["Assigned", "In progress"]))))
        load = sum(t.complexity * s for t, s in active)
        out.append(
            {
                **person(e),
                "available_days": cap.values.get("available_days") if cap else None,
                "available_days_state": cap.state if cap else "Missing",
                "active_tasks": len(active),
                "weighted_load": round(load, 2),
                "training_hours": training_hours,
                "signal": "Review load" if load >= 8 else "On track",
            }
        )
    return {"period": {"id": period.id, "name": period.name} if period else None, "rows": out, "note": "Training time appears in capacity but is not rewarded as output. Productivity needs 3+ people and 10+ available days."}


@router.get("/people/{employee_id}/training")
def person_training(employee_id: int, period_id: int | None = None, ctx: Ctx = Depends(get_ctx)):
    if not ctx.scope.can_see_person(employee_id):
        raise Forbidden()
    period = _period(ctx, period_id)
    rows = []
    for a in ctx.db.scalars(select(TrainingAssignment).where(TrainingAssignment.employee_id == employee_id).order_by(TrainingAssignment.due_date)):
        from app.api.routes.training import assignment_dict

        rows.append(assignment_dict(ctx, a))
    out = {"assignments": rows, "period": {"id": period.id, "name": period.name, "start": period.start_date, "end": period.end_date} if period else None}
    if ctx.scope.can_see_perf(employee_id) and period:
        out["summary"] = training_summary(ctx.db, employee_id, period)
    else:
        out["summary"] = None  # Team Leads update records without seeing completion scores
    return out
