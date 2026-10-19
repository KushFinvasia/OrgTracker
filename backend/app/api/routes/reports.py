"""Manager reports. Every report uses the same protected scope as search and exports; exports re-check it."""

import csv
import io
from datetime import datetime

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy import select

from app.api.deps import Ctx, get_ctx
from app.core.errors import Forbidden, NotFound
from app.models import Blocker, Employee, Incident, Nomination, Period, Project, RewardCycle, Snapshot, Task, TemplateStage, TrainingAssignment
from app.services import scoring
from app.services.common import person, task_timing
from app.services.delivery import accepted_output, assignment_rows_for, project_brief, reported_progress
from app.services.evaluation import evaluate, result_status, training_summary
from app.services.templates import stage_conflicts
from app.core.clock import now_ist

router = APIRouter(prefix="/reports", tags=["reports"])


def _period(ctx: Ctx, period_id: int | None) -> Period:
    p = ctx.db.get(Period, period_id) if period_id else ctx.db.scalar(select(Period).where(Period.state != "Open").order_by(Period.end_date.desc())) or ctx.db.scalar(select(Period).order_by(Period.end_date.desc()))
    if p is None:
        raise NotFound("Period")
    return p


def _people(ctx: Ctx) -> list[Employee]:
    perf = ctx.scope.perf_people
    if perf is None:
        return list(ctx.db.scalars(select(Employee).where(Employee.manager_id == ctx.me)))
    return list(ctx.db.scalars(select(Employee).where(Employee.id.in_(perf), Employee.record_type == "employee").order_by(Employee.full_name)))


def _work_people(ctx: Ctx) -> list[Employee]:
    people = ctx.scope.work_people
    if people is None:
        return list(ctx.db.scalars(select(Employee).where(Employee.manager_id == ctx.me)))
    return list(ctx.db.scalars(select(Employee).where(Employee.id.in_(people - {ctx.me}), Employee.record_type == "employee").order_by(Employee.full_name)))


def _require_perf_reports(ctx: Ctx):
    if ctx.account.role == "team_lead":
        raise Forbidden("Team Leads do not receive private KPI, training-score or R&R data.")


@router.get("/delivery")
def delivery(ctx: Ctx = Depends(get_ctx)):
    q = select(Project).where(Project.archived.is_(False))
    ids = ctx.scope.visible_project_ids
    if ids is not None:
        q = q.where(Project.id.in_(ids))
    projects = [project_brief(ctx.db, p) for p in ctx.db.scalars(q)]
    active = [p for p in projects if p["status"] not in ("Completed", "Cancelled")]
    pids = [p["id"] for p in projects]
    waiting = {"Dependency": 0, "Review": 0, "Approval": 0, "Own-team work": 0}
    if pids:
        for t in ctx.db.scalars(select(Task).where(Task.project_id.in_(pids), Task.status.not_in(["Completed", "Cancelled"]))):
            if t.status == "In Review":
                waiting["Review"] += 1
            elif t.status == "Blocked":
                b = ctx.db.scalar(select(Blocker).where(Blocker.task_id == t.id).order_by(Blocker.created_at.desc()))
                cat = (b.category if b else "") or ""
                waiting["Approval" if "Approval" in cat else "Dependency" if ("dependency" in cat.lower() or "vendor" in cat.lower()) else "Own-team work"] += 1
    incidents = ctx.db.scalars(select(Incident).where(Incident.project_id.in_(pids))).all() if pids else []
    total_c = sum((p["metrics"]["tasks_total"] or 0) for p in active)
    return {
        "summary": {
            "projects": len(active),
            "high_priority": sum(p["priority"] == "High" for p in active),
            "missing_priority": sum(p["priority"] is None for p in active),
            "overdue_active_work": sum(p["metrics"]["overdue"] for p in active),
            "open_high_risks": sum(p["metrics"]["open_high_risks"] for p in active),
            "review_waiting": waiting["Review"],
            "accepted_tasks": sum(p["metrics"]["tasks_accepted"] for p in active),
            "tasks_in_scope": total_c,
        },
        "health": {h: sum(p["metrics"]["health"] == h for p in active) for h in ("On Track", "At Risk", "Off Track")},
        "waiting": [{"cause": k, "count": v} for k, v in waiting.items()],
        "incidents": {"open": sum(i.state != "Closed" for i in incidents), "repeat": sum(i.repeat_of_id is not None for i in incidents), "total": len(incidents)},
        "projects": sorted(active, key=lambda p: (p["metrics"]["health"] != "Off Track", p["metrics"]["health"] != "At Risk", p["code"])),
        "note": "Approval waiting, employee lateness and department incidents are reported separately.",
    }


@router.get("/people")
def people_report(ctx: Ctx = Depends(get_ctx)):
    period = _period(ctx, None)
    rows = []
    for e in _work_people(ctx):
        r = assignment_rows_for(ctx.db, e.id)
        pairs = [(t, s) for t, s, _ in r]
        row = {
            "employee": person(e),
            "assigned": len(r),
            "active": sum(t.status not in ("Completed", "Cancelled") for t, _, _ in r),
            "accepted": sum(t.status == "Completed" for t, _, _ in r),
            "blocked": sum(t.status == "Blocked" for t, _, _ in r),
            "in_review": sum(t.status == "In Review" for t, _, _ in r),
            "overdue": sum(task_timing(t.status, t.due_date, t.accepted_submission_date) == "Overdue" for t, _, _ in r),
            "weighted_output": round(accepted_output(pairs), 2),
            "reported_progress": reported_progress(pairs),
            "projects": len({t.project_id for t, _, _ in r}),
        }
        if ctx.scope.can_see_perf(e.id):
            ts = training_summary(ctx.db, e.id, period)
            row["training"] = {k: ts[k] for k in ("verified", "eligible", "score")}
        rows.append(row)
    return {"period": {"id": period.id, "name": period.name}, "rows": rows, "note": "Task counts are descriptive; accepted weighted output = complexity x contribution."}


@router.get("/performance")
def performance_report(period_id: int | None = None, ctx: Ctx = Depends(get_ctx)):
    _require_perf_reports(ctx)
    p = _period(ctx, period_id)
    rows = []
    for e in _people(ctx):
        ev = evaluate(ctx.db, e, p)
        rows.append({"employee": person(e), "category": ev["category"], "base_kpi": ev["base"]["value"], "coverage": ev["base"]["coverage"], "training": ev["training"]["score"], "training_status": ev["training"]["status"], "final": ev["final"]["value"], "final_status": ev["final"]["status"], "status": result_status(ev), "checkin": bool(ev["checkin"]), "missing": ev["readiness"]})
    return {"period": {"id": p.id, "name": p.name, "state": p.state}, "rows": rows}


@router.get("/training")
def training_report(period_id: int | None = None, ctx: Ctx = Depends(get_ctx)):
    _require_perf_reports(ctx)
    p = _period(ctx, period_id)
    rows = []
    for e in _people(ctx):
        ts = training_summary(ctx.db, e.id, p)
        rows.append({"employee": person(e), **{k: ts[k] for k in ("allotted", "future_due", "eligible", "verified", "pending_verification", "in_progress", "uncompleted", "overdue", "excluded", "score", "status")}})
    team = scoring.aggregate_training(rows)
    return {"period": {"id": p.id, "name": p.name, "cutoff": p.evidence_cutoff}, "rows": rows, "team": team, "note": "Team completion = total verified / total eligible, not the average of individual percentages."}


@router.get("/recognition")
def recognition_report(ctx: Ctx = Depends(get_ctx)):
    _require_perf_reports(ctx)
    cycle = ctx.db.scalar(select(RewardCycle).order_by(RewardCycle.created_at.desc()))
    rows = []
    for e in _people(ctx):
        snap = ctx.db.scalar(select(Snapshot).where(Snapshot.period_id == cycle.period_id, Snapshot.employee_id == e.id)) if cycle else None
        noms = list(ctx.db.scalars(select(Nomination).where(Nomination.employee_id == e.id, Nomination.cycle_id == cycle.id))) if cycle else []
        gates = snap.data.get("gates", []) if snap else []
        rows.append({"employee": person(e), "final": snap.final_score if snap else None, "status": snap.status if snap else "Awaiting lock", "gates": gates, "gates_pass": bool(gates) and all(g["result"] == "pass" for g in gates), "nominations": [{"id": n.id, "award_type": n.award_type, "state": n.state} for n in noms]})
    return {"cycle": {"id": cycle.id, "title": cycle.title, "state": cycle.state} if cycle else None, "rows": rows}


@router.get("/data-quality")
def data_quality(ctx: Ctx = Depends(get_ctx)):
    issues = []
    q = select(Project)
    ids = ctx.scope.visible_project_ids
    if ids is not None:
        q = q.where(Project.id.in_(ids))
    for p in ctx.db.scalars(q):
        if not p.priority:
            issues.append({"issue": "Missing project priority", "record": f"{p.code} / {p.title}", "impact": "Activation and edits blocked", "action": "Choose priority", "link": f"/projects/{p.id}"})
    tq = select(Task)
    if ids is not None:
        tq = tq.where(Task.project_id.in_(ids))
    for t in ctx.db.scalars(tq):
        if t.status not in ("Completed", "Cancelled") and not t.due_date:
            issues.append({"issue": "Missing due date", "record": f"{t.code} / {t.title}", "impact": "Not eligible for On-time", "action": "Set due date", "link": f"/tasks?task={t.id}"})
        if t.reviewer_id and t.reviewer_id in {a.employee_id for a in t.assignments}:
            issues.append({"issue": "Reviewer conflicts with assignee", "record": t.code, "impact": "Review blocked", "action": "Assign reviewer", "link": f"/tasks?task={t.id}"})
        if t.assignments and round(sum(a.share for a in t.assignments) * 100) != 100:
            issues.append({"issue": "Invalid contribution shares", "record": t.code, "impact": "Output attribution unreliable", "action": "Fix shares", "link": f"/tasks?task={t.id}"})
    for st in ctx.db.scalars(select(TemplateStage)):
        for c in stage_conflicts(st):
            issues.append({"issue": "Template responsibility conflict", "record": f"Stage {st.step} / {st.name}", "impact": "Activation blocked", "action": "Resolve RACI", "link": "/admin/workflows?tab=raci"})
    perf = ctx.scope.perf_people
    if ctx.account.role != "team_lead":
        tq2 = select(TrainingAssignment).where(TrainingAssignment.status == "Submitted")
        if perf is not None:
            tq2 = tq2.where(TrainingAssignment.employee_id.in_(perf))
        for a in ctx.db.scalars(tq2):
            issues.append({"issue": "Training evidence unverified", "record": f"{a.employee.full_name} / {a.code}", "impact": "Not complete for scoring", "action": "Verify evidence", "link": f"/people/{a.employee_id}?tab=training&assignment={a.id}"})
        emps = ctx.db.scalars(select(Employee).where(Employee.flags.is_not(None), Employee.flags.ilike("%Name shared%")))
        for e in emps:
            if perf is None or e.id in perf:
                issues.append({"issue": "Unresolved identity collision", "record": f"{e.code} / {e.full_name}", "impact": "Confirm HRMS ID before go-live", "action": "Match identity", "link": f"/people/{e.id}"})
    for i in ctx.db.scalars(select(Incident).where(Incident.attribution_state == "pending")):
        if i.project_id is None or ids is None or i.project_id in ids:
            issues.append({"issue": "Unattributed incident", "record": f"{i.code} / {i.title}", "impact": "Department report only", "action": "Validate attribution", "link": f"/projects/{i.project_id}?tab=incidents"})
    return {"issues": issues, "counts": {k: sum(1 for i in issues if i["issue"] == k) for k in sorted({i["issue"] for i in issues})}}


@router.get("/{name}/export.csv")
def export_csv(name: str, period_id: int | None = None, ctx: Ctx = Depends(get_ctx)):
    """Same scope and filters as the on-screen report, with as-of, period, cutoff and rule versions."""
    handlers = {"delivery": delivery, "people": people_report, "performance": performance_report, "training": training_report, "data-quality": data_quality}
    if name not in handlers:
        raise NotFound("Report")
    data = handlers[name](period_id, ctx) if name in ("performance", "training") else handlers[name](ctx)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["# Finvasia Elevate report", name])
    w.writerow(["# As of", now_ist().strftime("%d %b %Y %H:%M IST")])
    w.writerow(["# Scope", f"{ctx.employee.full_name} ({ctx.account.role}) permitted scope"])
    if "period" in data and data["period"]:
        w.writerow(["# Period", data["period"].get("name"), "cutoff", data["period"].get("cutoff", "")])
    if name == "training":
        w.writerow(["employee_id", "name", "allotted", "future_due", "eligible", "verified", "uncompleted", "completion_pct", "status"])
        for r in data["rows"]:
            w.writerow([r["employee"]["code"], r["employee"]["name"], r["allotted"], r["future_due"], r["eligible"], r["verified"], r["uncompleted"], "Unavailable" if r["score"] is None else f"{r['score']:.2f}", r["status"]])
        w.writerow(["TEAM", "", data["team"]["allotted"], "", data["team"]["eligible"], data["team"]["verified"], "", "Unavailable" if data["team"]["score"] is None else f"{data['team']['score']:.2f}", "totals"])
    elif name == "performance":
        w.writerow(["employee_id", "name", "category", "base_kpi", "coverage", "training_pct", "final_rr", "status"])
        for r in data["rows"]:
            f = lambda v: "Unavailable" if v is None else f"{v:.2f}"  # noqa: E731
            w.writerow([r["employee"]["code"], r["employee"]["name"], r["category"], f(r["base_kpi"]), f(r["coverage"]), f(r["training"]), f(r["final"]), r["status"]])
    elif name == "people":
        w.writerow(["employee_id", "name", "assigned", "active", "accepted", "blocked", "overdue", "weighted_output"])
        for r in data["rows"]:
            w.writerow([r["employee"]["code"], r["employee"]["name"], r["assigned"], r["active"], r["accepted"], r["blocked"], r["overdue"], r["weighted_output"]])
    elif name == "delivery":
        w.writerow(["project_id", "title", "priority", "status", "health", "accepted_tasks", "tasks", "overdue"])
        for p in data["projects"]:
            w.writerow([p["code"], p["title"], p["priority"] or "Missing", p["status"], p["metrics"]["health"], p["metrics"]["tasks_accepted"], p["metrics"]["tasks_total"], p["metrics"]["overdue"]])
    else:
        w.writerow(["issue", "record", "impact", "action"])
        for i in data["issues"]:
            w.writerow([i["issue"], i["record"], i["impact"], i["action"]])
    buf.seek(0)
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="finvasia-elevate-{name}.csv"'})
