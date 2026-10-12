"""Illustrative demo layer on top of the imported workbook.

Everything here is flagged illustrative/demo. Named accounts are DEMO PROVISIONING: replace with confirmed
accounts before any real use. Courses, dates, ratings, targets and incidents mirror the PDF's illustrative
examples; they are not source personnel findings.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    Account,
    Assignment,
    Blocker,
    CheckIn,
    Course,
    DeadlineChange,
    Department,
    Employee,
    Holiday,
    Incident,
    MetricInput,
    Milestone,
    Period,
    Project,
    ReviewDecision,
    RewardCycle,
    Risk,
    RuleVersion,
    Submission,
    Task,
    TaskDependency,
    TaskEvent,
    TrainingAssignment,
)
from app.services import scoring
from app.services.audit import record


def _emp(db: Session, code: str) -> Employee:
    e = db.scalar(select(Employee).where(Employee.code == code))
    if e is None:
        raise RuntimeError(f"Seed expects {code} in Employee_Master")
    return e


def _email(e: Employee) -> str:
    parts = e.full_name.lower().replace("(", "").replace(")", "").split()
    return ".".join(parts[:2]) + "@finvasia.example"


def seed_demo(db: Session) -> dict:
    # --- accounts (demo provisioning) ----------------------------------------------------------
    roles = [
        ("EMP-0085", "admin"),  # Balneet Birah, VP-HR
        ("EMP-0219", "hod"),  # Kapil Abrol, AVP-CS (heads Client Support)
        ("EMP-0109", "hod"),  # Pawan Kumar, AVP-Operations (heads Demat, Operations & BO, Compliance)
        ("EMP-0081", "manager"),  # Pradeep Thakur, Lead UI/UX (manages Sachin, Maninder, Harsh)
        ("EMP-0221", "manager"),  # Sahil Sharma, AM-CS
    ]
    accounts: dict[str, Account] = {}
    for code, role in roles:
        e = _emp(db, code)
        a = Account(employee_id=e.id, email=_email(e), role=role, preferences={})
        db.add(a)
        accounts[code] = a
    # A Team Lead: first proposed Team Lead in Client Support with direct reports.
    cs = db.scalar(select(Department).where(Department.name == "Client Support"))
    tl = db.scalar(select(Employee).where(Employee.department_id == cs.id, Employee.proposed_role == "Team Lead", Employee.record_type == "employee").order_by(Employee.code))
    if tl:
        a = Account(employee_id=tl.id, email=_email(tl), role="team_lead", preferences={})
        db.add(a)
        accounts[tl.code] = a
    db.flush()
    admin, pawan, kapil, pradeep = accounts["EMP-0085"], accounts["EMP-0109"], accounts["EMP-0219"], accounts["EMP-0081"]

    # --- rules -----------------------------------------------------------------------------------
    kpi = RuleVersion(kind="kpi", label="v2", config=scoring.DEFAULT_KPI_CONFIG, state="Approved", summary="Approved category weights and anchors (corrected workbook).", author_account_id=admin.id, approver_account_id=pawan.id, effective_from=date(2026, 7, 1), decided_at=datetime(2026, 9, 29, 10, 0))
    training = RuleVersion(kind="training", label="v3", config=scoring.DEFAULT_TRAINING_POLICY, state="Pending approval", summary="Proposed: final R&R = base KPI x 90% + verified training x 10%. Not activated.", author_account_id=admin.id, effective_from=date(2026, 7, 1))
    reward = RuleVersion(kind="reward", label="r1", config=scoring.DEFAULT_REWARD_POLICY, state="Draft", summary="Draft tiers 90/80/70, gates and optional 10% Gold cap. Not approved.", author_account_id=admin.id)
    db.add_all([kpi, training, reward])
    db.flush()

    # --- calendar --------------------------------------------------------------------------------
    for d, n in [(date(2026, 1, 26), "Republic Day"), (date(2026, 8, 15), "Independence Day"), (date(2026, 10, 2), "Gandhi Jayanti")]:
        db.add(Holiday(day=d, name=f"{n} (national; confirm organisation calendar)"))

    # --- periods (organisation-wide) -------------------------------------------------------------
    q3 = Period(name="Jul-Sep 2026", period_type="Quarterly", start_date=date(2026, 7, 1), end_date=date(2026, 9, 30), kpi_rule_id=kpi.id, training_rule_id=training.id, evidence_cutoff=datetime(2026, 10, 5, 18, 0), state="Under Review", review_owner_id=pradeep.employee_id)
    q4 = Period(name="Oct-Dec 2026", period_type="Quarterly", start_date=date(2026, 10, 1), end_date=date(2026, 12, 31), kpi_rule_id=kpi.id, training_rule_id=training.id, evidence_cutoff=datetime(2027, 1, 5, 18, 0), state="Open", review_owner_id=pradeep.employee_id)
    db.add_all([q3, q4])
    db.flush()

    sachin, maninder, harsh = _emp(db, "EMP-0082"), _emp(db, "EMP-0083"), _emp(db, "EMP-0084")

    # --- training catalog + assignments (illustrative) --------------------------------------------
    catalog = [
        ("TRN-001", "Information security basics", "Mandatory", 2),
        ("TRN-002", "Code of conduct refresher", "Mandatory", 1),
        ("TRN-003", "Product onboarding essentials", "Mandatory", 3),
        ("TRN-004", "Customer communication", "Mandatory", 2),
        ("TRN-005", "Usability testing fundamentals", "Mandatory", 4),
        ("TRN-006", "Design QA checklist", "Mandatory", 2),
        ("TRN-007", "Writing for interfaces", "Mandatory", 3),
        ("TRN-008", "Accessibility for product teams", "Mandatory", 4),
        ("TRN-009", "Data handling essentials", "Mandatory", 2),
        ("TRN-010", "Prototyping workflow", "Mandatory", 3),
        ("TRN-011", "Advanced design systems", "Optional", 6),
        ("TRN-012", "Research synthesis", "Optional", 4),
    ]
    courses = {}
    for code, title, ctype, hours in catalog:
        c = Course(code=code, title=title, course_type=ctype, applicability="Product / UI-UX roles", completion_criteria="Attendance + assessment pass", pass_mark=80, duration_hours=hours, evidence_requirements="Certificate + result + attendance record", recurrence="Annual", state="Approved", illustrative=True)
        db.add(c)
        courses[code] = c
    db.flush()
    verifier = admin.employee_id  # HR/L&D verifies; differs from the recording manager
    seq = [0]

    def assign(emp: Employee, code: str, assigned: date, due: date, status: str, progress: int, completed: date | None = None, verified: datetime | None = None, result: float | None = None):
        seq[0] += 1
        c = courses[code]
        a = TrainingAssignment(
            code=f"TA-{seq[0]:04d}", course_id=c.id, course_version=1, employee_id=emp.id, assigned_date=assigned, due_date_original=due, due_date=due,
            training_type=c.course_type, completion_criteria=c.completion_criteria, pass_mark=c.pass_mark, duration_hours=c.duration_hours,
            verifier_id=verifier, period_id=q3.id if due <= q3.end_date else q4.id, status=status, progress=progress, completion_date=completed,
            assessment_result=result, attendance_ok=True if completed else None, evidence_note="Certificate + attendance record" if completed else None,
            recorded_by=pradeep.id if completed else None, submitted_at=datetime.combine(completed, datetime.min.time()) if completed else None,
            verified_by=admin.id if verified else None, verified_at=verified, illustrative=True,
        )
        db.add(a)
        return a

    for i, code in enumerate(["TRN-001", "TRN-002", "TRN-003", "TRN-004", "TRN-005", "TRN-006", "TRN-007", "TRN-010"]):
        due = date(2026, 7, 31) if i < 4 else date(2026, 9, 15)
        done = due - timedelta(days=5)
        assign(sachin, code, date(2026, 7, 1), due, "Verified complete", 100, done, datetime.combine(done + timedelta(days=2), datetime.min.time()), 88)
    assign(sachin, "TRN-008", date(2026, 8, 1), date(2026, 9, 30), "Submitted", 100, date(2026, 9, 28), None, 86)
    assign(sachin, "TRN-009", date(2026, 9, 1), date(2026, 9, 30), "In progress", 60)
    assign(sachin, "TRN-011", date(2026, 9, 1), date(2026, 10, 31), "Assigned", 20)
    assign(sachin, "TRN-012", date(2026, 9, 1), date(2026, 11, 30), "Assigned", 0)
    assign(maninder, "TRN-001", date(2026, 7, 1), date(2026, 7, 31), "Verified complete", 100, date(2026, 7, 25), datetime(2026, 7, 28), 90)
    assign(maninder, "TRN-008", date(2026, 8, 1), date(2026, 9, 30), "In progress", 40)
    assign(maninder, "TRN-011", date(2026, 9, 1), date(2026, 10, 31), "Assigned", 0)
    assign(harsh, "TRN-001", date(2026, 7, 1), date(2026, 7, 31), "Verified complete", 100, date(2026, 7, 20), datetime(2026, 7, 22), 84)
    assign(harsh, "TRN-003", date(2026, 7, 1), date(2026, 8, 31), "Verified complete", 100, date(2026, 8, 20), datetime(2026, 8, 24), 91)

    # --- source inputs + check-ins (illustrative) -------------------------------------------------
    db.add(MetricInput(employee_id=sachin.id, period_id=q3.id, metric="achievement", values={"target": 100, "actual": 100, "unit": "Approved delivery units"}, evidence="Approved quarterly plan (illustrative)", author_account_id=pradeep.id, validator_id=pawan.employee_id, state="Validated", validated_at=datetime(2026, 10, 3), illustrative=True))
    db.add(MetricInput(employee_id=sachin.id, period_id=q3.id, metric="compliance", values={"attested": True, "note": "No incidents; explicit period attestation"}, evidence="Period attestation (illustrative)", author_account_id=pradeep.id, validator_id=pawan.employee_id, state="Validated", validated_at=datetime(2026, 10, 3), illustrative=True))
    db.add(MetricInput(employee_id=sachin.id, period_id=q3.id, metric="capacity", values={"available_days": 20}, evidence="Working calendar + approved leave (illustrative)", author_account_id=pradeep.id, validator_id=pawan.employee_id, state="Validated", validated_at=datetime(2026, 10, 3), illustrative=True))
    db.add(MetricInput(employee_id=harsh.id, period_id=q3.id, metric="achievement", values={"target": 100, "actual": 85, "unit": "Approved delivery units"}, evidence="Quarterly plan actuals (illustrative)", author_account_id=pradeep.id, validator_id=pawan.employee_id, state="Submitted", illustrative=True))
    db.add(CheckIn(employee_id=sachin.id, period_id=q3.id, month=date(2026, 9, 1), quality_rating=4, collaboration_rating=4, collaboration_evidence="Shared review notes and helped peers", development_note="Complete pending assessment and verification", manager_account_id=pradeep.id, state="Finalized", illustrative=True))
    db.add(CheckIn(employee_id=maninder.id, period_id=q3.id, month=date(2026, 9, 1), quality_rating=4, development_note="Missing note", manager_account_id=pradeep.id, state="Draft", illustrative=True))

    # --- demo project: full review workflow -------------------------------------------------------
    product = db.scalar(select(Department).where(Department.name == "Product"))
    p = Project(code="PRJ-D01", title="Shoonya Website Enhancements", objective="Improve the website onboarding experience, validate all required states and hand off accepted design evidence to Product.", owner_id=pradeep.employee_id, department_id=product.id, priority="High", start_date=date(2026, 9, 1), target_date=date(2026, 10, 16), status="In Progress", source="demo")
    db.add(p)
    db.flush()
    m1 = Milestone(project_id=p.id, title="Design review", owner_id=pradeep.employee_id, target_date=date(2026, 10, 12), acceptance_criterion="Mobile states + independent review + final checklist", state="In progress", sort_order=1)
    m2 = Milestone(project_id=p.id, title="Handoff", owner_id=pradeep.employee_id, target_date=date(2026, 10, 14), acceptance_criterion="All linked outputs accepted", dependency="Design review complete", state="Planned", sort_order=2)
    m3 = Milestone(project_id=p.id, title="Release ready", owner_id=pradeep.employee_id, target_date=date(2026, 10, 19), acceptance_criterion="Implementation sign-off", dependency="Handoff complete", state="Planned", sort_order=3)
    db.add_all([m1, m2, m3])
    db.flush()

    def task(code, title, cat, owner, due, status, progress=0, contributors=(), reviewer=pradeep.employee_id, milestone=None, complexity=3, start=date(2026, 9, 1)):
        t = Task(code=code, project_id=p.id, milestone_id=milestone, title=title, description=title, category=cat, complexity=complexity, start_date=start, due_date_original=due, due_date=due, status=status, progress=progress, reviewer_id=reviewer, checklist=["Matches the agreed brief", "Responsive states included", "Evidence is complete"], required_evidence="Design file + checklist", source="demo", created_by=pradeep.id)
        db.add(t)
        db.flush()
        owner_share = 1 - sum(s for _, s in contributors)
        db.add(Assignment(task_id=t.id, employee_id=owner.id, role="Owner", share=owner_share))
        for emp, share in contributors:
            db.add(Assignment(task_id=t.id, employee_id=emp.id, role="Contributor", share=share))
        db.add(TaskEvent(task_id=t.id, actor_account_id=pradeep.id, kind="created", summary="Task created (Not started)", at=datetime.combine(start, datetime.min.time())))
        return t

    def accept(t: Task, submitted: date, decided: datetime):
        s = Submission(task_id=t.id, version=1, submission_date=submitted, note="Evidence attached", submitted_by=pradeep.id, checklist_confirmed=True)
        db.add(s)
        db.flush()
        db.add(ReviewDecision(task_id=t.id, submission_id=s.id, reviewer_id=t.reviewer_id, decision="accept", decided_at=decided))
        t.accepted_submission_date, t.accepted_at, t.status, t.progress = submitted, decided, "Completed", 100

    for i, (title, due) in enumerate([("Audit onboarding copy", date(2026, 9, 10)), ("Map onboarding error states", date(2026, 9, 18)), ("Prepare mobile layout variants", date(2026, 9, 25))], start=1):
        t = task(f"PRJ-D01-T0{i}", title, "Design", sachin, due, "Not Started", complexity=2, milestone=m1.id)
        accept(t, due - timedelta(days=1), datetime.combine(due + timedelta(days=1), datetime.min.time()).replace(hour=11))

    review = task("PRJ-D01-T04", "Review onboarding screens", "Design", sachin, date(2026, 10, 10), "In Review", 100, contributors=[(maninder, 0.4)], milestone=m1.id, start=date(2026, 9, 28))
    review.due_date = date(2026, 10, 12)
    s1 = Submission(task_id=review.id, version=1, submission_date=date(2026, 10, 5), note="First pass", submitted_by=pradeep.id, checklist_confirmed=True)
    s2 = Submission(task_id=review.id, version=2, submission_date=date(2026, 10, 7), note="Mobile states", submitted_by=pradeep.id, checklist_confirmed=True)
    s3 = Submission(task_id=review.id, version=3, submission_date=date(2026, 10, 8), note="Checklist and mobile states", submitted_by=pradeep.id, checklist_confirmed=True)
    db.add_all([s1, s2, s3])
    db.flush()
    db.add(ReviewDecision(task_id=review.id, submission_id=s2.id, reviewer_id=pradeep.employee_id, decision="rework", reason_category="Quality / missing required state", failed_criteria=["Responsive states included"], feedback="Add error, retry and empty-screen states", decided_at=datetime(2026, 10, 7, 17, 10)))
    db.add(DeadlineChange(task_id=review.id, original_date=date(2026, 10, 10), requested_date=date(2026, 10, 12), reason_category="Internal dependency", comment="Waiting for independently owned Product response", requester_id=sachin.id, validator_id=pradeep.employee_id, state="Validated", decision_reason="Linked dependency record", decided_at=datetime(2026, 10, 7, 14, 20)))
    db.add(TaskEvent(task_id=review.id, actor_account_id=pradeep.id, kind="submitted", summary="Submission v3 sent for review", at=datetime(2026, 10, 8, 15, 20)))

    approval = task("PRJ-D01-T05", "Connect approval flow", "Dependency", maninder, date(2026, 10, 14), "Blocked", 40, milestone=m2.id, start=date(2026, 10, 1))
    db.add(Blocker(task_id=approval.id, category="Internal dependency", description="Waiting on Product response about approval behaviour", requester_id=maninder.id, blocked_since=date(2026, 10, 8), evidence="Linked dependency record + message", validator_id=pradeep.employee_id, state="Pending"))
    handoff = task("PRJ-D01-T06", "Publish design handoff", "Delivery", sachin, date(2026, 10, 16), "Not Started", milestone=m2.id, start=date(2026, 10, 12))
    db.add(TaskDependency(task_id=handoff.id, depends_on_id=review.id))
    rewards = task("PRJ-D01-T07", "Check rewards journey", "Review", harsh, date(2026, 10, 9), "In Review", 100, start=date(2026, 10, 1))
    db.add(Submission(task_id=rewards.id, version=1, submission_date=date(2026, 10, 9), note="Journey review notes", submitted_by=pradeep.id, checklist_confirmed=True))

    db.add(Risk(code="PRJ-D01-R01", project_id=p.id, stage="Co-ordination with Product", risk="Product approval may arrive late", criticality="High", dependencies="Product acceptance of approval behaviour", assumptions="Response within 2 business days", mitigation="Agree review slot and escalation owner", owner_id=pradeep.employee_id, state="Mitigating", next_review=date(2026, 10, 12), linked_task_id=approval.id))
    db.add(Risk(code="PRJ-D01-R02", project_id=p.id, stage="Design", risk="Scope creep on mobile states", criticality="Medium", mitigation="Freeze state list at design review", owner_id=pradeep.employee_id, state="Open", next_review=date(2026, 10, 14)))

    # --- illustrative incident on a Client Support project -----------------------------------------
    mf = db.scalar(select(Project).where(Project.code == "PRJ-042"))
    db.add(Incident(code="INC-DEMO-01", project_id=mf.id if mf else None, title="Mandate validation issue", product_system="Mandate setup", incident_date=date(2026, 10, 8), received_date=date(2026, 10, 9), reporter_id=_emp(db, "EMP-0221").id, severity_proposed="Medium", clients_impacted=12, orders_impacted=4, responsible_department_id=cs.id, stakeholder_id=kapil.employee_id, root_cause_category="Process", gap="Missing pre-release validation", expected_closure=date(2026, 10, 14), state="Under analysis", attribution_state="pending", illustrative=True, history=[{"at": "2026-10-09T10:00", "event": "Recorded", "note": "Illustrative RCA; not a live personnel record", "actor": "Sahil Sharma"}]))

    # --- recognition cycle (blocked until the period is locked) ------------------------------------
    db.add(RewardCycle(title="Jul-Sep 2026 recognition", period_id=q3.id, nomination_start=date(2026, 10, 10), nomination_end=date(2026, 10, 15), review_deadline=date(2026, 10, 20), audience="Approved internal audience", owner_account_id=kapil.id, state="Draft"))

    record(db, admin.id, "seed_demo", "system", None, "Illustrative demo layer", None, {"accounts": len(accounts)})
    db.flush()
    return {"accounts": [(a.email, a.role) for a in accounts.values()]}
