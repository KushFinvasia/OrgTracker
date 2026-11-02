"""Illustrative Project R&R layer (mirrors the Project Tier prototype in docs/mockups). Every charter, delay and input it
creates is marked illustrative and its projects are source="demo". Names come from the sources; scores, amounts and dates are
illustrative.

- PRJ-D01 Shoonya Website Enhancements: in the pilot, baseline locked, in delivery (late tasks feed the delay log).
- PRJ-D11 Instant account-opening journey upgrade: the HR framework's worked example (doc §13), Panel approved:
  88.00 Gold under the §3.2 collaboration rule, ₹2,40,000 indicative payouts.
- PRJ-D12 Email campaigns · Oct–Dec 2026: recurring template work scored as a quarterly programme; charter draft with the
  RACI.xlsx conflicts still open; three accepted requests are its runs.
"""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import (
    Account,
    Assignment,
    Department,
    Employee,
    Project,
    ProjectCharter,
    ProjectClosure,
    ProjectDelay,
    ProjectRaci,
    ProjectRrInput,
    ProjectSla,
    ReviewDecision,
    RrPolicy,
    Submission,
    Task,
    WorkflowTemplate,
    WorkRequest,
)
from app.services.audit import record
from app.services.templates import instantiate

DEMO_CODES = ("PRJ-D11", "PRJ-D12")


def _emp(db: Session, code: str) -> Employee | None:
    return db.scalar(select(Employee).where(Employee.code == code))


def _dept(db: Session, name: str) -> Department | None:
    return db.scalar(select(Department).where(Department.name == name))


def _account(db: Session, email: str) -> Account | None:
    return db.scalar(select(Account).where(Account.email == email))


def has_project_rr_demo(db: Session) -> bool:
    return bool(db.scalar(select(func.count()).select_from(ProjectCharter)))


def _accept(db: Session, t: Task, submitted: date, by: Account | None) -> None:
    s = Submission(task_id=t.id, version=1, submission_date=submitted, note="Evidence attached (illustrative)", submitted_by=by.id if by else None, checklist_confirmed=True, source="app")
    db.add(s)
    db.flush()
    db.add(ReviewDecision(task_id=t.id, submission_id=s.id, reviewer_id=t.reviewer_id, decision="accept", decided_at=datetime.combine(submitted, datetime.min.time()).replace(hour=17)))
    t.status, t.progress, t.accepted_submission_date, t.accepted_at = "Completed", 100, submitted, datetime.combine(submitted, datetime.min.time()).replace(hour=17)


def seed_project_rr_demo(db: Session) -> dict:
    if has_project_rr_demo(db):
        return {"skipped": "already present"}
    pradeep, sachin, maninder, harsh = (_emp(db, c) for c in ("EMP-0081", "EMP-0082", "EMP-0083", "EMP-0084"))
    kapil, sahil, miteeksha, naveen, gurjot = (_emp(db, c) for c in ("EMP-0219", "EMP-0221", "EMP-0153", "EMP-0118", "EMP-0265"))
    if not all((pradeep, sachin, maninder, harsh, kapil, sahil)):
        return {"skipped": "demo people missing"}
    admin = db.scalar(select(Account).join(Employee).where(Employee.code == "EMP-0085"))
    platform = _account(db, "deepjyot.tiwari@shoonya.com")
    kapil_acc = db.scalar(select(Account).where(Account.employee_id == kapil.id))
    sahil_acc = db.scalar(select(Account).where(Account.employee_id == sahil.id))
    pradeep_acc = db.scalar(select(Account).where(Account.employee_id == pradeep.id))
    author = platform or admin

    # --- functions (Project R&R duties on existing named accounts) --------------------------------
    for acc, fns in ((admin, ["PMO validator", "HR calibrator", "R&R Panel member"]), (platform, ["PMO validator", "HR calibrator", "R&R Panel member"]), (kapil_acc, ["Quality assessor", "R&R Panel member"])):
        if acc is not None and acc.functions is None:
            acc.functions = fns
    if not db.scalar(select(RrPolicy.id).where(RrPolicy.code == "PR-1")):
        db.add(RrPolicy(code="PR-1", state="Proposed", authored_by=author.id if author else None, authored_on=date(2026, 10, 22)))

    product = _dept(db, "Product")
    out = {}

    # --- PRJ-D01: website project, baseline locked, in delivery -------------------------------------
    web = db.scalar(select(Project).where(Project.code == "PRJ-D01"))
    if web is not None:
        db.add(ProjectCharter(project_id=web.id, mode="closure", project_type="Standard", sponsor="Head of Product", champion_id=pradeep.id, value_kind="Account-opening starts from the website", value_target_text="1,200 a month",
                              pool_rate=0.02, state="Locked", locked_on=date(2026, 10, 1), stage="In delivery", illustrative=True,
                              history=[{"at": "2026-10-01T09:00", "event": "Baseline locked", "actor": "Sponsor and PMO", "note": "Illustrative"}]))
        for emp, letter, factor, days, note in ((pradeep, "A", None, None, "Champion"), (sachin, "R", 1.0, None, "Full scope · factor 1.0"), (maninder, "R", 0.75, None, "Moderate scope · factor 0.75"),
                                                (harsh, "R", 0.75, None, "Moderate scope · factor 0.75"), (kapil, "C", None, 2, "Agreed response: 2 days")):
            db.add(ProjectRaci(project_id=web.id, employee_id=emp.id, letter=letter, factor=factor, factor_confirmed=letter == "R", response_days=days, note=note))
        db.add_all([ProjectSla(project_id=web.id, name="Review comments returned", kind="Internal TAT", tat="2 bd"), ProjectSla(project_id=web.id, name="Website defects fixed (P1)", kind="Client", tat="1 bd")])
        if sahil_acc:
            db.add(ProjectRrInput(project_id=web.id, kind="satisfaction", value={"avg": 4.1, "n": 22}, display="4.1 of 5 (22 responses)", author_account_id=sahil_acc.id, illustrative=True))
        out["PRJ-D01"] = "locked, in delivery"

    # --- PRJ-D11: the HR framework's worked example ---------------------------------------------------
    worked = Project(code="PRJ-D11", title="Instant account-opening journey upgrade", objective="Cut account-opening time and lift completed openings (the HR framework's worked example, illustrative).",
                     owner_id=pradeep.id, reviewer_id=kapil.id, department_id=product.id if product else None, priority="High", start_date=date(2026, 7, 1), target_date=date(2026, 10, 15), status="Completed", source="demo")
    db.add(worked)
    db.flush()
    plan = [  # title, owner, start, baseline due, accepted (late ones carry the doc's three delays)
        ("Journey discovery", sachin, date(2026, 7, 1), date(2026, 7, 14), date(2026, 7, 13)),
        ("eKYC screen flow", sachin, date(2026, 7, 15), date(2026, 7, 31), date(2026, 7, 31)),
        ("API integration", sachin, date(2026, 8, 3), date(2026, 8, 14), date(2026, 8, 21)),
        ("Bank verification step", maninder, date(2026, 8, 3), date(2026, 8, 21), date(2026, 8, 20)),
        ("Document upload retry states", harsh, date(2026, 8, 17), date(2026, 8, 28), date(2026, 8, 28)),
        ("UAT test cases", maninder, date(2026, 8, 24), date(2026, 9, 4), date(2026, 9, 9)),
        ("UAT round", maninder, date(2026, 9, 7), date(2026, 9, 18), date(2026, 9, 18)),
        ("Compliance review pack", harsh, date(2026, 9, 14), date(2026, 9, 21), date(2026, 9, 24)),
        ("Go-live runbook", sachin, date(2026, 9, 21), date(2026, 10, 1), date(2026, 9, 30)),
        ("Go-live and hypercare", sachin, date(2026, 10, 5), date(2026, 10, 15), date(2026, 10, 15)),
    ]
    tasks = {}
    for i, (title, owner, start, due, accepted) in enumerate(plan, 1):
        t = Task(code=f"PRJ-D11-T{i:02d}", project_id=worked.id, title=title, description=title, complexity=3, start_date=start, due_date_original=due, due_date=due, go_live_date=date(2026, 10, 15) if i == 10 else None,
                 status="Not Started", reviewer_id=kapil.id, checklist=["Matches the agreed brief"], source="demo", created_by=pradeep_acc.id if pradeep_acc else None)
        db.add(t)
        db.flush()
        db.add(Assignment(task_id=t.id, employee_id=owner.id, role="Owner", share=1.0))
        _accept(db, t, accepted, pradeep_acc)
        tasks[title] = t
    db.add(ProjectClosure(project_id=worked.id, state="Approved", stage_notes={s: {"done": True, "note": "Illustrative"} for s in ("tasks", "deliverables", "objectives", "issues", "lessons", "remarks")}, history=[{"at": "2026-10-16T11:00", "event": "Approved", "actor": "Kapil Abrol"}]))
    db.add(ProjectCharter(project_id=worked.id, mode="closure", project_type="Complex", sponsor="Head of Product", champion_id=pradeep.id, value_kind="Revenue (₹)", value_target=12_000_000, pool_rate=0.02,
                          state="Locked", locked_on=date(2026, 7, 2), stage="Panel approved", illustrative=True,
                          history=[{"at": "2026-07-02T10:00", "event": "Baseline locked", "actor": "Sponsor and PMO"}, {"at": "2026-10-20T12:00", "event": "HR calibrated", "actor": "HR"}, {"at": "2026-10-21T16:00", "event": "Panel approved", "actor": "R&R Panel"}]))
    for emp, letter, factor, adj, days, note in ((pradeep, "A", None, 3, None, "Champion · adjustment set by the sponsor"), (sachin, "R", 1.0, 4, None, "Full scope · factor 1.0"), (maninder, "R", 1.0, 0, None, "Full scope · factor 1.0"),
                                                 (harsh, "R", 0.5, 2, None, "Joined late · factor 0.5"), (kapil, "C", None, 2, 2, "Agreed response: 2 days"), (sahil, "C", None, 5, 3, "Agreed response: 3 days")):
        db.add(ProjectRaci(project_id=worked.id, employee_id=emp.id, letter=letter, factor=factor, factor_confirmed=letter == "R", adjustment=adj, response_days=days, note=note))
    db.add(ProjectRaci(project_id=worked.id, label="Head of Sales", letter="I", note="Recognition only"))
    db.add_all([ProjectSla(project_id=worked.id, name="Account-opening requests closed within TAT", kind="Client", tat="1 bd"), ProjectSla(project_id=worked.id, name="Review comments returned", kind="Internal TAT", tat="2 bd")])
    for code, title, reason, cat, tagged, evidence in (
        ("D1", "API integration", "Vendor sandbox ready 5 days late; flagged on time with email evidence", "E2", [], "Vendor email, 14 Aug 2026"),
        ("D2", "UAT test cases", "QA engineer unavailable for a week; test cases submitted late", "C2", [maninder.id], "Jira UAT-112 history"),
        ("D3", "Compliance review pack", "Compliance review pack sent 3 days late", "C3", [pradeep.id], "Compliance desk ticket"),
    ):
        t = tasks[title]
        db.add(ProjectDelay(project_id=worked.id, code=code, task_id=t.id, task_label=title, reason_code=cat, explanation=reason, evidence=evidence, due_date=t.due_date_original, flagged_on=t.due_date_original, tagged=tagged, state="Closed", illustrative=True,
                            logged_by=pradeep_acc.id if pradeep_acc else None, validated_by=admin.id if admin else None, history=[{"at": "2026-10-02T10:00", "event": "Closed", "actor": "PMO validator"}]))
    inputs = [
        ("value_actual", {"actual": 13_500_000}, "₹1,35,00,000"),
        ("sla", {"within": 46, "total": 50}, "46 of 50 within SLA"),
        ("rework", {"pct": 8}, "8% of effort"),
        ("errors", {"critical": 0, "minor": 2}, "0 critical, 2 minor"),
        ("satisfaction", {"avg": 4.3, "n": 14}, "4.3 of 5 (14 responses)"),
        ("collaboration", {"avg": 4.4, "raters": 5, "items": 1}, "4.4 of 5 from 5 raters · 1 help/playbook item(s)"),
        ("innovation", {"points": 2}, "+2 of 5"),
    ]
    for kind, value, display in inputs:
        db.add(ProjectRrInput(project_id=worked.id, kind=kind, value=value, display=display, state="Validated", author_account_id=sahil_acc.id if sahil_acc else None, validator_account_id=admin.id if admin else None,
                              illustrative=True, decided_at=datetime(2026, 10, 17, 12, 0)))
    out["PRJ-D11"] = "worked example, Panel approved"

    # --- PRJ-D12: email campaigns as a quarterly programme ------------------------------------------
    tpl = db.scalar(select(WorkflowTemplate).where(WorkflowTemplate.name == "Email campaign"))
    dm = _dept(db, "Digital Marketing")
    if tpl and dm and miteeksha and naveen:
        prog = Project(code="PRJ-D12", title="Email campaigns · Oct–Dec 2026", objective="Run cross-department email campaigns through the Email campaign workflow, scored as one quarterly programme (illustrative).",
                       owner_id=miteeksha.id, department_id=dm.id, priority="Medium", start_date=date(2026, 10, 1), target_date=date(2026, 12, 31), status="In Progress", template_id=tpl.id, source="demo")
        db.add(prog)
        db.flush()
        db.add(ProjectCharter(project_id=prog.id, mode="programme", project_type="Standard", sponsor="Head of Digital Marketing", champion_id=None, champion_note="Marketing POC: Mukesh Thakur", value_kind="Conversions (stage 6 tracking)",
                              pool_rate=0.02, state="Draft", stage="Charter draft", illustrative=True, history=[{"at": "2026-10-01T09:00", "event": "Charter draft from the Email campaign template", "actor": "Admin"}]))
        for emp in (naveen, miteeksha):
            db.add(ProjectRaci(project_id=prog.id, employee_id=emp.id, letter="R", factor=1.0, factor_confirmed=False, note="Suggested from planned effort share"))
        rms, cs, sales = _dept(db, "RMS & Dealer"), _dept(db, "Client Support"), _dept(db, "Sales")
        amit = _emp(db, "EMP-0266")
        runs = [
            ("Diwali trading offer", sales, amit or sahil, gurjot or kapil, date(2026, 10, 1), "delivered"),
            ("MTF awareness mailer", rms, sahil, kapil, date(2026, 10, 5), "stage3late"),
            ("Client Support feedback survey", cs, sahil, kapil, date(2026, 10, 19), "early"),
        ]
        for n, (title, dept, requester, validator, start, shape) in enumerate(runs, 1):
            req = WorkRequest(title=title, template_id=tpl.id, requesting_department_id=dept.id if dept else None, receiving_department_id=dm.id, audience="Illustrative audience", objective=title, required_date=start, priority="Medium",
                              brief="Illustrative brief", requester_id=requester.id, validator_id=validator.id, state="Accepted", project_id=prog.id, history=[{"at": f"{start.isoformat()}T10:00", "event": f"Accepted as run R{n} of PRJ-D12", "actor": "Receiving POC"}])
            db.add(req)
            db.flush()
            stage_tasks = instantiate(db, prog, tpl, start, None, f"PRJ-D12-R{n}", run_request_id=req.id, copy_risks=n == 1)
            for t in stage_tasks:
                t.source = "demo"
                t.data_flags = None
                if not t.assignments:
                    db.add(Assignment(task_id=t.id, employee_id=requester.id, role="Owner", share=1.0))
                t.reviewer_id = {1: validator.id, 2: naveen.id, 3: validator.id}.get(t.template_step, miteeksha.id)
            db.flush()
            for t in stage_tasks:
                done = shape == "delivered" or (shape == "stage3late" and t.template_step <= 5) or (shape == "early" and t.template_step <= 2)
                if done:
                    accepted = t.due_date_original
                    if shape == "stage3late" and t.template_step == 3:
                        from app.services.common import add_business_days, holidays

                        accepted = add_business_days(t.start_date, 3, holidays(db))  # 3 bd against a 2 bd stage maximum
                    _accept(db, t, min(accepted, date(2026, 10, 22)), None)
                elif (shape == "stage3late" and t.template_step == 6) or (shape == "early" and t.template_step == 3):
                    t.status, t.progress = "In Progress", 40
            if shape == "stage3late":
                t3 = next(t for t in stage_tasks if t.template_step == 3)
                db.add(ProjectDelay(project_id=prog.id, code="D1", task_id=t3.id, task_label=f"R{n} · {title}", run_request_id=req.id, stage=3, reason_code="E1", explanation="Department sign-off took 3 bd against a 2 bd stage SLA",
                                    evidence="Approval email thread", due_date=t3.due_date_original, flagged_on=t3.due_date_original, state="Logged", illustrative=True, logged_by=pradeep_acc.id if pradeep_acc else None,
                                    history=[{"at": "2026-10-12T10:00", "event": "Logged", "actor": "Champion"}]))
        db.add(WorkRequest(title="Client Support renewal reminder", template_id=tpl.id, requesting_department_id=cs.id if cs else None, receiving_department_id=dm.id, audience="Clients renewing in December", objective="Lift on-time renewals",
                           required_date=date(2026, 11, 12), priority="Medium", brief="Approved copy attached; WhatsApp variant needs TRAI template approval (illustrative)", requester_id=sahil.id, validator_id=kapil.id, state="Submitted",
                           history=[{"at": "2026-10-21T10:00", "event": "Submitted", "actor": "Sahil Sharma"}]))
        out["PRJ-D12"] = "programme draft with 3 runs"
    record(db, admin.id if admin else None, "seed_project_rr_demo", "system", None, "Illustrative Project R&R layer", None, out)
    db.flush()
    return out
