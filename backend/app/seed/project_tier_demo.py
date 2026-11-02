"""Rich illustrative Project Tier data for walkthroughs (PRJ-D20 to PRJ-D32).

Thirteen projects across Product, Client Support, Digital Marketing, Operations & BO, Compliance and IT, in every project
status, with tasks in the tracker statuses, real submissions and review decisions, blockers, date changes, risks, incidents
with RCA, closures, cross-department requests and Project R&R charters at every scorecard stage (bands Platinum to Review).

People and departments are looked up by code and name; dates are working days relative to today (holidays respected), so
the data never goes stale. Records are created the way the app creates them, with their audit events, task events and
histories, and every record is marked illustrative (projects and tasks: source="demo"). It never changes imported or real
records, PRJ-D01, PRJ-D11, PRJ-D12 or Individual Tier data. One exception, reported in the seed's audit event: when no account
other than the input authors holds the Finance confirmer function, Balneet Birah (Admin) gets it, because scorecards past "Awaiting Finance" need a
confirmed value. Clearing the layer removes it again.

    python -m app.seed.project_tier_demo add | clear
"""

from __future__ import annotations

import sys
from datetime import date, datetime, time, timedelta

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.clock import now_ist, today_ist
from app.core.config import settings
from app.models import (
    Account,
    Assignment,
    AuditEvent,
    BaselineChange,
    Blocker,
    Comment,
    DeadlineChange,
    Department,
    Employee,
    EvidenceFile,
    Incident,
    Project,
    ProjectCharter,
    ProjectClosure,
    ProjectDelay,
    ProjectDispute,
    ProjectRaci,
    ProjectRrInput,
    ProjectSla,
    ReviewDecision,
    Risk,
    Submission,
    Task,
    TaskDependency,
    TaskEvent,
    WorkflowTemplate,
    WorkRequest,
)
from app.models.project_rr import INPUT_KINDS
from app.services import project_rr as rr
from app.services.audit import record
from app.services.common import holidays
from app.services.delivery import validate_assignments

CODES = tuple(f"PRJ-D{n}" for n in range(20, 33))
SEED_ACTION, CLEAR_ACTION = "seed_project_tier_demo", "clear_project_tier_demo"
MARK = "(illustrative)"  # requests have no illustrative column; their brief ends with this
FINANCE = "Finance confirmer"

# Real people, by employee code (sources: Employee_Master). Accounts are found through the same codes.
PEOPLE = {
    "balneet": "EMP-0085", "deepjyot": "EMP-0324", "kapil": "EMP-0219", "pawan": "EMP-0109", "pradeep": "EMP-0081", "sahil": "EMP-0221",
    "aaina": "EMP-0224", "gurjot": "EMP-0265", "amit_sales": "EMP-0266",
    # Product
    "sachin": "EMP-0082", "maninder": "EMP-0083", "harsh": "EMP-0084", "deepinder": "EMP-0020", "sumit": "EMP-0024", "amit_qa": "EMP-0015",
    "jatin": "EMP-0046", "rupinder": "EMP-0053", "chhatarshal": "EMP-0072", "parvinder_c": "EMP-0070", "kapil_k": "EMP-0060",
    # Client Support
    "angel": "EMP-0220", "jaspal": "EMP-0230", "adity": "EMP-0237", "neeru": "EMP-0239", "akriti": "EMP-0233", "vishakha": "EMP-0246",
    "arun": "EMP-0225", "kiritika": "EMP-0226", "shalini_d": "EMP-0227", "shagun": "EMP-0229",
    # Operations & BO
    "vivek": "EMP-0174", "kanav": "EMP-0175", "jaidev": "EMP-0181", "sanjay": "EMP-0169", "vinay": "EMP-0170", "akashdeep": "EMP-0187", "parvinder_k": "EMP-0195",
    # Compliance
    "akanksha": "EMP-0197", "kunal": "EMP-0201", "hardeep": "EMP-0198", "kartik": "EMP-0199", "ali": "EMP-0202",
    # IT
    "rajesh_p": "EMP-0157", "gurpreet": "EMP-0161", "sourav": "EMP-0162", "sunil": "EMP-0165", "abhinav": "EMP-0159", "neeraj": "EMP-0163", "himanshu": "EMP-0164",
    # Digital Marketing
    "ramneek": "EMP-0117", "naveen": "EMP-0118", "deesha": "EMP-0126", "smeet": "EMP-0132", "sonal": "EMP-0147",
}
LOGINS = ("balneet", "deepjyot", "kapil", "pawan", "pradeep", "sahil")
DEPARTMENTS = ("Product", "Client Support", "Digital Marketing", "Operations & BO", "Compliance", "IT", "Sales")


def has_project_tier_demo(db: Session) -> bool:
    return db.scalar(select(Project.id).where(Project.code.in_(CODES))) is not None


def project_tier_demo_was_cleared(db: Session) -> bool:
    last = db.scalar(select(AuditEvent).where(AuditEvent.action.in_((SEED_ACTION, CLEAR_ACTION))).order_by(AuditEvent.id.desc()))
    return last is not None and last.action == CLEAR_ACTION


class _Seed:
    def __init__(self, db: Session, emp: dict[str, Employee], acc: dict[str, Account], dept: dict[str, Department]):
        self.db, self.e, self.a, self.d = db, emp, acc, dept
        self.today, self.now, self.hols = today_ist(), now_ist(), holidays(db)
        self.tasks: dict[str, Task] = {}
        order = [acc[k].id for k in ("balneet", "deepjyot", "kapil")]
        self.fn_holders = sorted(db.scalars(select(Account).where(Account.active.is_(True), Account.functions.is_not(None))),
                                 key=lambda x: (order.index(x.id) if x.id in order else 9, x.id))

    # --- dates ---------------------------------------------------------------------------------------------------------

    def wd(self, n: int, base: date | None = None) -> date:
        """n working days from base (today by default); negative goes back. Weekends and calendar holidays are skipped."""
        d, step, left = base or self.today, 1 if n >= 0 else -1, abs(n)
        while left:
            d += timedelta(days=step)
            if d.weekday() < 5 and d not in self.hols:
                left -= 1
        return d

    def at(self, d: date, hour: int = 10, minute: int = 0) -> datetime:
        return min(datetime.combine(d, time(hour, minute)), self.now)

    def holder(self, fn: str, *exclude: Account | None, not_in: set[int] = frozenset()) -> Account:
        """An account holding the function, never one excluded (author, logger, submitter, sponsor) or a RACI member."""
        skip = {x.id for x in exclude if x is not None}
        pick = next((x for x in self.fn_holders if fn in (x.functions or []) and x.id not in skip and x.employee_id not in not_in), None)
        assert pick is not None, f"no independent {fn}"
        return pick

    def acc_of(self, emp: Employee | None) -> Account | None:
        return next((a for a in self.a.values() if emp is not None and a.employee_id == emp.id), None) or (
            self.db.scalar(select(Account).where(Account.employee_id == emp.id, Account.active.is_(True))) if emp is not None else None)

    def audit(self, when: date, actor: Account | None, action: str, entity: str, eid, label: str, old=None, new=None, reason=None, hour: int = 10) -> None:
        record(self.db, actor.id if actor else None, action, entity, eid, label, old, new, reason, at=self.at(when, hour))

    def event(self, t: Task, when: date, actor: Account | None, kind: str, summary: str, hour: int = 10) -> None:
        self.db.add(TaskEvent(task_id=t.id, actor_account_id=actor.id if actor else None, kind=kind, summary=summary, data={}, at=self.at(when, hour)))

    # --- projects and tasks -------------------------------------------------------------------------------------------

    def project(self, code: str, title: str, objective: str, dept: str, owner: str, reviewer: str | None, priority: str, start: date, target: date,
                status: str, creator: Account, template: WorkflowTemplate | None = None) -> Project:
        p = Project(code=code, title=title, objective=f"{objective} {MARK}", owner_id=self.e[owner].id, department_id=self.d[dept].id, priority=priority,
                    start_date=start, target_date=target, status="Planning", reviewer_id=self.e[reviewer].id if reviewer else None,
                    template_id=template.id if template else None, source="demo")
        self.db.add(p)
        self.db.flush()
        self.audit(start, creator, "create_project", "project", p.id, title, None, {"priority": priority, "owner": self.e[owner].code}, hour=9)
        if status != "Planning":
            p.status, p.version = status, 2
            self.audit(min(self.wd(1, start), self.today), creator, "update_project", "project", p.id, title, {"status": "Planning"}, {"status": status})
        return p

    def evidence(self, t: Task, version: int, by: Account | None) -> int | None:
        """A small evidence file in the upload folder, so the reviewer can open what was submitted."""
        try:
            settings.upload_dir.mkdir(parents=True, exist_ok=True)
            path = settings.upload_dir / f"demo-{t.code}-v{version}.txt"
            path.write_text(f"Illustrative evidence for {t.code} {t.title}, submission v{version}.\n{t.required_evidence or ''}\n")
            f = EvidenceFile(task_id=t.id, filename=f"{t.code}-v{version}-evidence.txt", stored_path=str(path), size=path.stat().st_size, uploaded_by=by.id if by else None)
        except OSError:
            return None
        self.db.add(f)
        self.db.flush()
        return f.id

    def task(self, p: Project, key: str, title: str, owner: str, reviewer: str, start: date, due: date, *, contrib: tuple = (), status: str = "Not Started",
             progress: int = 0, next_action: str | None = None, go_live: date | None = None, flow: tuple | None = None, by: Account | None = None,
             checklist: tuple = ("Matches the agreed brief", "Edge cases covered"), evidence: str = "Screenshots and the review checklist", complexity: int = 3,
             category: str | None = None) -> Task:
        n = sum(1 for t in self.tasks.values() if t.project_id == p.id) + 1
        rows = [{"employee_id": self.e[owner].id, "role": "Owner", "share": 100 - sum(s for _, s in contrib)}]
        rows += [{"employee_id": self.e[c].id, "role": "Contributor", "share": s} for c, s in contrib]
        validate_assignments(rows, self.e[reviewer].id)  # one Owner, shares 100%, an independent reviewer
        t = Task(code=f"{p.code}-T{n:02d}", project_id=p.id, title=title, description=f"{title} for {p.title}. {MARK}", category=category, complexity=complexity,
                 start_date=start, due_date_original=due, due_date=due, go_live_date=go_live, status="Not Started", progress=0, next_action=next_action,
                 reviewer_id=self.e[reviewer].id, checklist=list(checklist), required_evidence=evidence, source="demo", created_by=by.id if by else None)
        self.db.add(t)
        self.db.flush()
        for r in rows:
            self.db.add(Assignment(task_id=t.id, employee_id=r["employee_id"], role=r["role"], share=r["share"] / 100))
        self.db.flush()
        self.tasks[key] = t
        self.event(t, start, by, "created", "Task created (Not started)", hour=9)
        self.audit(start, by, "create_task", "task", t.id, title, None, {"owner": self.e[owner].code, "reviewer": self.e[reviewer].code, "due": due}, hour=9)
        rev = self.acc_of(self.e[reviewer])
        if flow:
            self._flow(t, flow, by, rev)
        if t.status not in ("Completed", "In Review", "Rework") and status != "Not Started":
            t.status, t.progress = status, progress
            self.event(t, min(self.wd(2, start), self.today), by, "update", f"status: Not Started > {status}, progress: 0 > {progress}")
            self.audit(min(self.wd(2, start), self.today), by, "update_task", "task", t.id, title, {"status": "Not Started"}, {"status": status, "progress": progress})
        elif t.status in ("In Review", "Rework"):
            t.progress = max(progress, 100 if t.status == "In Review" else progress)
        return t

    def _flow(self, t: Task, flow: tuple, by: Account | None, rev: Account | None) -> None:
        """Submissions and the reviewer's decisions: accept, rework then accept, waiting in review, or back in rework."""
        kind, *days = flow
        decisions = {"accept": ["accept"], "review": [], "rework": ["rework"], "rework_accept": ["rework", "accept"], "rework_review": ["rework"]}[kind]
        for v, sub_day in enumerate(days, 1):
            assert sub_day <= self.today, f"{t.code}: no future submission dates"
            fid = self.evidence(t, v, by)
            s = Submission(task_id=t.id, version=v, submission_date=sub_day, note=f"v{v}: evidence attached, checklist confirmed {MARK}", evidence_ids=[fid] if fid else [],
                           checklist_confirmed=True, submitted_by=by.id if by else None, source="app", created_at=self.at(sub_day, 16))
            self.db.add(s)
            self.db.flush()
            t.status, t.progress = "In Review", 100
            self.event(t, sub_day, by, "submitted", f"Submission v{v} sent for review", hour=16)
            self.audit(sub_day, by, "send_for_review", "task", t.id, t.title, None, {"status": "In Review", "submission": v}, hour=16)
            if v > len(decisions):
                continue
            decision = decisions[v - 1]
            decided = min(self.wd(1, sub_day), self.today)
            when = self.at(decided, 12)
            if decision == "accept":
                self.db.add(ReviewDecision(task_id=t.id, submission_id=s.id, reviewer_id=t.reviewer_id, decision="accept", decided_at=when))
                t.status, t.progress, t.accepted_submission_date, t.accepted_at = "Completed", 100, sub_day, when
                self.event(t, decided, rev, "accept", f"Accepted submission v{v} (completion date {sub_day:%d %b %Y})", hour=12)
                self.audit(decided, rev, "review_accept", "task", t.id, t.title, {"status": "In Review"}, {"status": "Completed"}, hour=12)
            else:
                feedback = "Two states are missing from the evidence; add them and resubmit."
                self.db.add(ReviewDecision(task_id=t.id, submission_id=s.id, reviewer_id=t.reviewer_id, decision="rework", reason_category="Acceptance criteria not met",
                                           failed_criteria=t.checklist[-1:], feedback=feedback, decided_at=when))
                t.status, t.progress = "Rework", 70
                self.event(t, decided, rev, "rework", f"Returned v{v} to rework: Acceptance criteria not met", hour=12)
                self.audit(decided, rev, "review_rework", "task", t.id, t.title, {"status": "In Review"}, {"status": "Rework"}, feedback, hour=12)

    def blocker(self, t: Task, category: str, requester: str, validator: str, since: date, description: str, evidence: str, state: str = "Pending",
                reason: str | None = None) -> None:
        req, val = self.e[requester], self.e[validator]
        assert req.id != val.id, "nobody validates their own blocker"
        by = self.acc_of(req) or self.acc_of(self.e["deepjyot"])
        self.db.add(Blocker(task_id=t.id, category=category, description=f"{description} {MARK}", requester_id=req.id, blocked_since=since, evidence=evidence,
                            validator_id=val.id, state=state, decision_reason=reason, decided_at=self.at(self.wd(1, since), 15) if state != "Pending" else None,
                            created_at=self.at(since, 11)))
        self.event(t, since, by, "blocker", f"Blocker reported: {category} (pending validation)", hour=11)
        self.audit(since, by, "report_blocker", "task", t.id, t.title, None, {"category": category, "validator": val.code}, hour=11)
        if state != "Pending":
            decided = min(self.wd(1, since), self.today)
            self.event(t, decided, self.acc_of(val), "blocker_decision", f"Blocker {state.lower()}: {category}", hour=15)
            self.audit(decided, self.acc_of(val), f"blocker_{'validate' if state == 'Validated' else 'reject'}", "task", t.id, t.title, None, {"state": state}, reason, hour=15)

    def date_change(self, t: Task, requested: date, category: str, requester: str, validator: str, asked: date, comment: str, state: str = "Pending",
                    reason: str | None = None) -> None:
        req, val = self.e[requester], self.e[validator]
        assert req.id != val.id
        by = self.acc_of(req) or self.acc_of(self.e["deepjyot"])
        original = t.due_date
        self.db.add(DeadlineChange(task_id=t.id, original_date=original, requested_date=requested, reason_category=category, comment=f"{comment} {MARK}",
                                   evidence="Email thread", requester_id=req.id, validator_id=val.id, state=state, decision_reason=reason,
                                   decided_at=self.at(self.wd(1, asked), 15) if state != "Pending" else None, created_at=self.at(asked, 11)))
        self.event(t, asked, by, "deadline_request", f"Date change requested: {requested:%d %b %Y} (original remains in force)", hour=11)
        self.audit(asked, by, "request_deadline_change", "task", t.id, t.title, None, {"requested_date": requested, "reason_category": category}, hour=11)
        if state == "Validated":
            t.due_date = requested  # the baseline stays in due_date_original
            decided = min(self.wd(1, asked), self.today)
            self.event(t, decided, self.acc_of(val), "deadline_validated", f"Due date in force {original:%d %b} > {requested:%d %b}", hour=15)
            self.audit(decided, self.acc_of(val), "deadline_validated", "task", t.id, t.title, {"due_date": original}, {"due_date": requested}, reason, hour=15)
        elif state == "Rejected":
            decided = min(self.wd(1, asked), self.today)
            self.event(t, decided, self.acc_of(val), "deadline_rejected", "Date change rejected; original date remains in force", hour=15)
            self.audit(decided, self.acc_of(val), "deadline_rejected", "task", t.id, t.title, None, None, reason, hour=15)

    def risk(self, p: Project, n: int, text: str, stage: str, criticality: str, owner: str, state: str, mitigation: str, review: date, by: Account) -> None:
        self.db.add(Risk(code=f"{p.code}-R{n:02d}", project_id=p.id, stage=stage, risk=text, criticality=criticality, owner_id=self.e[owner].id, state=state,
                         mitigation=mitigation, next_review=review, dependencies=None, assumptions=None))
        self.audit(p.start_date, by, "add_risk", "project", p.id, text, None, {"criticality": criticality, "state": state})

    def closure(self, p: Project, state: str, submitter: Account | None, decider: Account | None, on: date, reason: str | None = None, done: tuple = ()) -> None:
        notes = {s: {"done": True, "note": f"Recorded {MARK}"} for s in (done or ("tasks", "deliverables", "objectives", "issues", "lessons", "remarks"))}
        hist = []
        if state in ("Submitted", "Approved", "Returned"):
            assert submitter is not None and (decider is None or decider.id != submitter.id)
            hist.append({"at": self.at(on, 11).isoformat(timespec="minutes"), "event": "Submitted", "actor": submitter.employee.full_name})
            self.audit(on, submitter, "submit_closure", "project", p.id, p.title, hour=11)
        if state in ("Approved", "Returned"):
            decided = min(self.wd(1, on), self.today)
            hist.append({"at": self.at(decided, 15).isoformat(timespec="minutes"), "event": state, "actor": decider.employee.full_name, "note": reason})
            if state == "Approved":
                self.audit(decided, decider, "approve_closure", "project", p.id, p.title, {"status": "In Review"}, {"status": "Completed"}, reason, hour=15)
            else:
                self.audit(decided, decider, "return_closure", "project", p.id, p.title, None, None, reason, hour=15)
        self.db.add(ProjectClosure(project_id=p.id, state=state, stage_notes=notes, submitted_by=submitter.id if submitter else None,
                                   decided_by=decider.id if decider and state in ("Approved", "Returned") else None, decision_reason=reason,
                                   decided_at=self.at(min(self.wd(1, on), self.today), 15) if state in ("Approved", "Returned") else None, history=hist))

    # --- Project R&R --------------------------------------------------------------------------------------------------

    def charter(self, p: Project, *, champion: str, ptype: str, sponsor: str, value_kind: str, target: float | None, target_text: str | None,
                raci: list, slas: list, state: str, submitter: Account | None, sponsor_acc: Account | None, pmo_acc: Account | None, enrolled: date) -> ProjectCharter:
        admin = self.a["deepjyot"]
        c = ProjectCharter(project_id=p.id, mode="closure", project_type=ptype, sponsor=sponsor, champion_id=self.e[champion].id, value_kind=value_kind,
                           value_target=target, value_target_text=target_text, pool_rate=rr.POOL_RATES[ptype], state="Draft", stage="Charter draft", illustrative=True, history=[])
        self.db.add(c)
        self.db.flush()

        def log(day: date, event: str, actor: Account | None, note: str | None = None, hour: int = 10):
            c.history = [*c.history, {"at": self.at(day, hour).isoformat(timespec="minutes"), "event": event, "actor": actor.employee.full_name if actor else "Admin", "note": note}]

        log(enrolled, "Added to the Project R&R pilot", admin, "closure")
        self.audit(enrolled, admin, "rr_enrol", "project", p.id, p.title, None, {"mode": "closure", "project_type": ptype})
        seen = set()
        for row in raci:
            who, letter, *rest = row
            if letter == "I":
                self.db.add(ProjectRaci(project_id=p.id, label=who, letter="I", note="Recognition only"))
                continue
            emp = self.e[who]
            assert emp.id not in seen, f"{p.code}: one letter per person"
            seen.add(emp.id)
            factor = rest[0] if letter == "R" else None
            days = rest[0] if letter == "C" else None
            note = {"A": "Champion", "R": f"Factor {factor:g}" if factor else None, "C": f"Agreed response: {days} days" if days else None}[letter]
            self.db.add(ProjectRaci(project_id=p.id, employee_id=emp.id, letter=letter, factor=factor, factor_confirmed=letter == "R" and state == "Locked",
                                    response_days=days, note=note))
        assert sum(1 for r in raci if r[1] == "A") == 1 and raci[0][0] == champion
        for name, kind, tat in slas:
            self.db.add(ProjectSla(project_id=p.id, name=name, kind=kind, tat=tat))
        if state in ("Submitted", "Locked"):
            submitted = self.wd(2, enrolled)
            c.state, c.submitted_by = "Submitted", submitter.id
            log(submitted, "Submitted for lock", submitter)
            self.audit(submitted, submitter, "rr_charter_submit", "project", p.id, p.title, None, {"state": "Submitted"})
            for action, acc in (("sponsor", sponsor_acc), ("pmo", pmo_acc)):
                if acc is None:
                    continue
                assert acc.id != submitter.id and acc.employee_id != self.e[champion].id  # the champion and submitter never lock
                setattr(c, "sponsor_ok_by" if action == "sponsor" else "pmo_ok_by", acc.id)
                log(self.wd(1, submitted), "Sponsor approved" if action == "sponsor" else "PMO approved", acc)
                self.audit(self.wd(1, submitted), acc, f"rr_charter_{action}", "project", p.id, p.title, None, {"state": "Submitted"})
            if c.sponsor_ok_by and c.pmo_ok_by:
                assert c.sponsor_ok_by != c.pmo_ok_by, "sponsor and PMO are two people"
                c.state, c.locked_on, c.stage = "Locked", self.wd(1, submitted), "In delivery"
                log(c.locked_on, "Baseline locked", None, "Sponsor and PMO approved", hour=11)
        return c

    def delay(self, p: Project, n: int, t: Task, code: str, explanation: str, evidence: str | None, state: str, logger: Account, validator: Account | None,
              tagged: tuple = (), escalation_miss: bool = False, custom: str | None = None, challenger: Account | None = None) -> None:
        assert rr.ps.controllable(code) or evidence, "excused delays need evidence"
        logged = min(self.wd(1, t.due_date_original), self.today)
        hist = [{"at": self.at(logged).isoformat(timespec="minutes"), "event": "Logged", "actor": logger.employee.full_name, "note": None}]
        self.audit(logged, logger, "rr_log_delay", "task", t.id, t.title, None, {"reason_code": code})
        if state in ("Validated", "Challenged", "Closed"):
            assert validator and validator.id != logger.id
            decided = min(self.wd(2, logged), self.today)
            hist.append({"at": self.at(decided, 14).isoformat(timespec="minutes"), "event": "validate", "actor": validator.employee.full_name, "note": None})
            self.audit(decided, validator, "rr_delay_validate", "project", p.id, f"D{n}", {"state": "Logged"}, {"state": "Validated", "reason_code": code}, hour=14)
        if state == "Challenged":
            day = min(self.wd(3, logged), self.today)
            hist.append({"at": self.at(day, 16).isoformat(timespec="minutes"), "event": "challenge", "actor": challenger.employee.full_name, "note": "The vendor slot moved; this was outside the team's control"})
            self.audit(day, challenger, "rr_delay_challenge", "project", p.id, f"D{n}", {"state": "Validated"}, {"state": "Challenged"}, "The vendor slot moved", hour=16)
        owner = next(a.employee_id for a in t.assignments if a.role == "Owner")
        self.db.add(ProjectDelay(project_id=p.id, code=f"D{n}", task_id=t.id, task_label=t.title, reason_code=code, custom_reason=custom, explanation=f"{explanation} {MARK}",
                                 evidence=evidence, due_date=t.due_date_original, flagged_on=t.due_date_original if not escalation_miss else self.wd(1, t.due_date_original),
                                 escalation_miss=escalation_miss, tagged=[self.e[x].id for x in tagged] or ([owner] if rr.ps.controllable(code) else []),
                                 state="Validated" if state == "Closed" else state, logged_by=logger.id, validated_by=validator.id if validator and state != "Logged" else None,
                                 history=hist, illustrative=True))

    def rr_input(self, p: Project, kind: str, value: dict, display: str, author: Account, state: str, validator: Account | None, on: date, reason: str | None = None) -> None:
        if state != "Submitted":
            assert validator and validator.id != author.id and INPUT_KINDS[kind][1] in (validator.functions or []), f"{p.code} {kind}: independent function holder"
        self.db.add(ProjectRrInput(project_id=p.id, kind=kind, value=value, display=display, state=state, author_account_id=author.id,
                                   validator_account_id=validator.id if state != "Submitted" else None, reason=reason, illustrative=True,
                                   created_at=self.at(on, 10), decided_at=self.at(self.wd(2, on), 15) if state != "Submitted" else None))
        self.audit(on, author, "rr_submit_input", "project", p.id, INPUT_KINDS[kind][0], None, {"kind": kind, "value": value})
        if state != "Submitted":
            self.audit(self.wd(2, on), validator, f"rr_input_{'validate' if state == 'Validated' else 'return'}", "project", p.id, INPUT_KINDS[kind][0], None,
                       {"state": state}, reason, hour=15)


def _delivered(s: _Seed, p: Project, plan: list, start: date, by: Account) -> list[Task]:
    """A finished project's tasks in sequence: each accepted on time, or `late` working days after its baseline."""
    out, cur = [], start
    for i, (title, owner, contrib, reviewer, dur, late, rework) in enumerate(plan):
        due = s.wd(dur, cur)
        accepted = s.wd(late, due) if late else s.wd(-1, due)
        flow = ("rework_accept", s.wd(-3, accepted), accepted) if rework else ("accept", accepted)
        out.append(s.task(p, f"{p.code}:{i}", title, owner, reviewer, cur, due, contrib=contrib, flow=flow, by=by,
                          go_live=accepted if i == len(plan) - 1 else None, next_action=None))
        cur = s.wd(1, due)
    p.start_date, p.target_date = start, out[-1].due_date_original
    return out


def _scored(s: _Seed, spec: dict) -> dict:
    """A completed project in the pilot: locked charter, delays for its late tasks, inputs, closure, and a scorecard stage."""
    a = s.a
    p = s.project(spec["code"], spec["title"], spec["objective"], spec["dept"], spec["owner"], spec["reviewer"], spec["priority"], spec["start"], spec["start"], "In Progress", spec["by"])
    tasks = _delivered(s, p, spec["plan"], spec["start"], spec["by"])
    finished = max(t.accepted_submission_date for t in tasks)
    s.closure(p, "Approved", spec["closure_by"], spec["closure_decider"], min(s.wd(2, finished), s.today), "All tasks accepted; lessons recorded")
    p.status, p.version = "Completed", p.version + 1
    c = s.charter(p, champion=spec["owner"], ptype=spec["type"], sponsor=spec["sponsor"], value_kind=spec["value_kind"], target=spec["target"], target_text=None,
                  raci=spec["raci"], slas=spec["slas"], state="Locked", submitter=spec["charter_by"], sponsor_acc=spec["sponsor_acc"],
                  pmo_acc=s.holder("PMO validator", spec["charter_by"], spec["sponsor_acc"], s.acc_of(s.e[spec["owner"]])),
                  enrolled=s.wd(-2, spec["start"]))
    champ = s.acc_of(s.e[spec["owner"]])
    raci_ids = {s.e[x[0]].id for x in spec["raci"] if x[1] != "I"}
    for n, (i, code, explanation, evidence, state, extra) in enumerate(spec.get("delays", []), 1):
        s.delay(p, n, tasks[i], code, explanation, evidence, state, spec["by"], s.holder("PMO validator", spec["by"], champ), **extra)
    on = min(s.wd(3, finished), s.wd(-6))
    for kind, value, display, state, *rest in spec["inputs"]:
        author = s.holder("R&R Panel member", not_in=raci_ids) if kind == "innovation" else spec["by"]
        s.rr_input(p, kind, value, display, author, state, s.holder(INPUT_KINDS[kind][1], author, champ), on, *rest)
    stage = spec.get("stage")
    s.db.flush()
    if stage in ("HR calibrated", "Panel approved", "Published"):
        hr, panel = s.holder("HR calibrator", not_in=raci_ids), s.holder("R&R Panel member", not_in=raci_ids)
        verbs = {"HR calibrated": "calibrate", "Panel approved": "approve", "Published": "publish"}
        for who, adj in spec.get("adjustments", {}).items():
            r = s.db.scalar(select(ProjectRaci).where(ProjectRaci.project_id == p.id, ProjectRaci.employee_id == s.e[who].id))
            r.adjustment = adj
            s.audit(s.wd(-4), hr, "rr_calibrate_adjustment", "project", p.id, p.title, {"adjustment": 0}, {"employee": s.e[who].code, "adjustment": adj}, "Calibrated against peers")
        for step, actor, day in (("HR calibrated", hr, s.wd(-4)), ("Panel approved", panel, s.wd(-3)), ("Published", panel, s.wd(-2))):
            c.history = [*c.history, {"at": s.at(day, 15).isoformat(timespec="minutes"), "event": step, "actor": actor.employee.full_name, "note": None}]
            s.audit(day, actor, f"rr_scorecard_{verbs[step]}", "project", p.id, p.title,
                    None, {"stage": step}, hour=15)
            if step == "Published":
                s.db.flush()
                c.stage = "Panel approved"
                rr.freeze(s.db, p, c, rr.compute(s.db, p, c), on=day)
                break
            c.stage = step
            if step == stage:
                break
    return {"project": p, "charter": c, "tasks": tasks}


def seed_project_tier_demo(db: Session) -> dict:
    if has_project_tier_demo(db):
        return {"skipped": "already present"}
    emp = {k: db.scalar(select(Employee).where(Employee.code == code, Employee.record_type == "employee")) for k, code in PEOPLE.items()}
    missing = sorted(PEOPLE[k] for k, v in emp.items() if v is None)
    dept = {n: db.scalar(select(Department).where(Department.name == n)) for n in DEPARTMENTS}
    acc = {k: db.scalar(select(Account).where(Account.employee_id == emp[k].id, Account.active.is_(True))) if emp[k] else None for k in LOGINS}
    if missing or not all(dept.values()) or not all(acc.values()):
        return {"skipped": "people, departments or accounts missing", "missing": missing + [n for n, d in dept.items() if not d] + [k for k, v in acc.items() if not v]}
    if db.scalar(select(Task.id).where(Task.code.like("PRJ-D2%-T%") | Task.code.like("PRJ-D3%-T%"))) or db.scalar(
            select(Incident.id).where(Incident.code.in_([f"INC-DEMO-0{n}" for n in range(2, 8)]))):
        return {"skipped": "codes already in use"}
    s = _Seed(db, emp, acc, dept)
    a, wd, today = acc, s.wd, s.today
    out: dict = {}

    # The PMO, Quality, HR and Panel duties come from the earlier demo layer; Finance is needed for scorecards past "Awaiting Finance".
    # Work out the functions first and change nothing unless every duty has enough independent holders.
    planned = {x.id: list(x.functions or []) for x in db.scalars(select(Account).where(Account.active.is_(True)))}
    for k, fns in (("balneet", ["PMO validator", "HR calibrator", "R&R Panel member"]), ("deepjyot", ["PMO validator", "HR calibrator", "R&R Panel member"]),
                   ("kapil", ["Quality assessor", "R&R Panel member"])):
        if not planned[a[k].id]:
            planned[a[k].id] = fns
    authors = {a[k].id for k in ("pradeep", "sahil", "deepjyot")}  # they submit the value inputs, so they can't confirm them
    if not any(FINANCE in f and i not in authors for i, f in planned.items()):
        planned[a["balneet"].id] = [*planned[a["balneet"].id], FINANCE]
        out["finance_confirmer_tagged"] = a["balneet"].email
    needed = {"PMO validator": 2, "Quality assessor": 1, "HR calibrator": 1, "R&R Panel member": 2, FINANCE: 1}
    short = [f for f, n in needed.items() if sum(f in fns for fns in planned.values()) < n]
    if short:
        return {"skipped": "Project R&R functions not held by enough accounts", "missing": short}
    for x in db.scalars(select(Account).where(Account.id.in_([i for i, f in planned.items() if f]))):
        if list(x.functions or []) != planned[x.id]:
            x.functions = planned[x.id]
    db.flush()
    first = [a["balneet"].id, a["deepjyot"].id, a["kapil"].id]
    s.fn_holders = sorted(db.scalars(select(Account).where(Account.active.is_(True), Account.functions.is_not(None))),
                          key=lambda x: (first.index(x.id) if x.id in first else 9, x.id))

    # --- scored projects: completed, in the pilot, one per scorecard stage and band ---------------------------------------
    cs_slas = [("First response to clients", "Client", "4 h"), ("Escalations closed", "Internal TAT", "2 bd")]
    prod_slas = [("Review comments returned", "Internal TAT", "2 bd"), ("P1 defects fixed", "Client", "1 bd")]
    ops_slas = [("Exceptions resolved", "Internal TAT", "1 bd"), ("Client queries on charges answered", "Client", "2 bd")]
    common = lambda **kw: kw  # noqa: E731
    specs = [
        common(code="PRJ-D20", title="Mutual fund SIP dashboard redesign", objective="Make SIP status, missed instalments and top-ups clear on web and app.",
               dept="Product", owner="pradeep", reviewer="kapil", priority="Medium", type="Standard", sponsor="Head of Product (Admin as sponsor)",
               value_kind="Revenue (₹)", target=8_000_000, start=wd(-118), by=a["pradeep"], charter_by=a["pradeep"], sponsor_acc=a["deepjyot"],
               closure_by=a["pradeep"], closure_decider=a["kapil"], slas=prod_slas, stage="Published", adjustments={"sachin": 3, "harsh": 1},
               plan=[("SIP journey research", "sumit", (("kapil_k", 30),), "pradeep", 8, 0, False), ("Dashboard design", "sachin", (("harsh", 25),), "kapil", 10, 0, True),
                     ("Missed-instalment alerts", "maninder", (), "kapil", 8, 2, False), ("Top-up flow", "sachin", (("maninder", 40),), "kapil", 10, 0, False),
                     ("QA and accessibility pass", "amit_qa", (), "pradeep", 6, 0, False), ("Release and monitoring", "chhatarshal", (("parvinder_c", 30),), "kapil", 6, 0, False)],
               raci=[("pradeep", "A"), ("sachin", "R", 1.0), ("maninder", "R", 1.0), ("harsh", "R", 0.5), ("sumit", "R", 0.75), ("kapil_k", "R", 0.5), ("amit_qa", "R", 0.5),
                     ("chhatarshal", "R", 0.75), ("parvinder_c", "R", 0.5), ("deepinder", "C", 2), ("Head of Sales", "I")],
               delays=[(2, "E2", "Push-notification vendor changed its API version mid-sprint", "Vendor release note and ticket", "Closed", {})],
               inputs=[("value_actual", {"actual": 8_400_000}, "₹84,00,000", "Validated"), ("sla", {"within": 49, "total": 50}, "49 of 50 within SLA", "Validated"),
                       ("rework", {"pct": 4}, "4% of effort", "Validated"), ("errors", {"critical": 0, "minor": 1}, "0 critical, 1 minor", "Validated"),
                       ("satisfaction", {"avg": 4.6, "n": 18}, "4.6 of 5 (18 responses)", "Validated"),
                       ("collaboration", {"avg": 4.5, "raters": 4, "items": 1}, "4.5 of 5 from 4 raters · 1 help/playbook item(s)", "Validated"),
                       ("innovation", {"points": 2}, "+2 of 5", "Validated")]),
        common(code="PRJ-D21", title="Ticket triage automation", objective="Route tickets by intent and client tier so VIP issues reach senior agents first.",
               dept="Client Support", owner="sahil", reviewer="kapil", priority="High", type="Complex", sponsor="Head of Client Support",
               value_kind="Tickets auto-triaged a month", target=4000, start=wd(-112), by=a["sahil"], charter_by=a["sahil"], sponsor_acc=a["kapil"],
               closure_by=a["sahil"], closure_decider=a["kapil"], slas=cs_slas, stage="Published", adjustments={"aaina": 2},
               plan=[("Intent taxonomy", "aaina", (("arun", 30),), "sahil", 8, 0, False), ("Routing rules", "jaspal", (), "sahil", 8, 0, False),
                     ("CRM rule configuration", "neeru", (("akriti", 40),), "kapil", 10, 3, False), ("VIP queue", "jaspal", (("vishakha", 25),), "sahil", 8, 2, True),
                     ("Agent playbook", "aaina", (("kiritika", 50),), "sahil", 6, 0, False), ("Rollout and tuning", "neeru", (), "kapil", 8, 0, False)],
               raci=[("sahil", "A"), ("aaina", "R", 1.0), ("jaspal", "R", 1.0), ("neeru", "R", 1.0), ("arun", "R", 0.5), ("akriti", "R", 0.5), ("vishakha", "R", 0.5),
                     ("kiritika", "R", 0.5), ("angel", "C", 2), ("Head of Sales", "I")],
               delays=[(2, "E1", "Sales sent the VIP client list a week after the agreed date", "Email from Sales, with dates", "Closed", {}),
                       (3, "C1", "Rule testing took longer than estimated", None, "Closed", {})],
               inputs=[("value_actual", {"actual": 3720}, "3,720 a month", "Validated"), ("sla", {"within": 48, "total": 50}, "48 of 50 within SLA", "Validated"),
                       ("rework", {"pct": 7}, "7% of effort", "Validated"), ("errors", {"critical": 0, "minor": 2}, "0 critical, 2 minor", "Validated"),
                       ("satisfaction", {"avg": 4.2, "n": 25}, "4.2 of 5 (25 responses)", "Validated"),
                       ("collaboration", {"avg": 4.1, "raters": 3, "items": 0}, "4.1 of 5 from 3 raters · 0 help/playbook item(s)", "Validated")]),
        common(code="PRJ-D22", title="Bank reconciliation automation", objective="Match bank credits to client ledgers automatically and flag only exceptions.",
               dept="Operations & BO", owner="vivek", reviewer="pawan", priority="Medium", type="Standard", sponsor="Head of Operations & BO",
               value_kind="Manual matches avoided a month", target=9000, start=wd(-100), by=a["deepjyot"], charter_by=a["deepjyot"], sponsor_acc=a["pawan"],
               closure_by=a["deepjyot"], closure_decider=a["pawan"], slas=ops_slas, stage="HR calibrated", adjustments={"kanav": 2},
               plan=[("Exception categories", "kanav", (("vinay", 30),), "vivek", 8, 0, False), ("Matching rules", "jaidev", (), "vivek", 10, 0, False),
                     ("Bank file parsers", "sanjay", (("akashdeep", 40),), "vivek", 10, 4, False), ("Exception queue", "kanav", (), "vivek", 8, 0, True),
                     ("Parallel run", "jaidev", (("vinay", 50),), "vivek", 8, 0, False)],
               raci=[("vivek", "A"), ("kanav", "R", 1.0), ("jaidev", "R", 1.0), ("sanjay", "R", 0.75), ("vinay", "R", 0.5), ("akashdeep", "R", 0.5), ("parvinder_k", "C", 2)],
               delays=[(2, "C3", "The bank's file format needed compliance sign-off, which ran late", None, "Validated", {})],
               inputs=[("value_actual", {"actual": 8200}, "8,200 a month", "Validated"), ("sla", {"within": 46, "total": 50}, "46 of 50 within SLA", "Validated"),
                       ("rework", {"pct": 9}, "9% of effort", "Validated"), ("errors", {"critical": 0, "minor": 3}, "0 critical, 3 minor", "Validated"),
                       ("satisfaction", {"avg": 4.0, "n": 12}, "4.0 of 5 (12 responses)", "Validated"),
                       ("collaboration", {"avg": 4.0, "raters": 3, "items": 1}, "4.0 of 5 from 3 raters · 1 help/playbook item(s)", "Validated")]),
        common(code="PRJ-D23", title="SEBI cybersecurity audit readiness", objective="Close the audit observations before the half-yearly SEBI cybersecurity audit.",
               dept="Compliance", owner="akanksha", reviewer="pawan", priority="Medium", type="Standard", sponsor="Head of Compliance",
               value_kind="Audit observations closed", target=40, start=wd(-95), by=a["deepjyot"], charter_by=a["deepjyot"], sponsor_acc=a["pawan"],
               closure_by=a["deepjyot"], closure_decider=a["pawan"], slas=[("Observation evidence filed", "Internal TAT", "3 bd")],
               plan=[("Observation register", "hardeep", (("kartik", 30),), "akanksha", 8, 0, False), ("Access review evidence", "kartik", (), "kunal", 10, 3, False),
                     ("Vendor risk assessments", "ali", (("hardeep", 40),), "kunal", 10, 2, False), ("Policy updates", "hardeep", (), "kunal", 8, 0, True),
                     ("Audit pack", "kartik", (("ali", 30),), "kunal", 6, 0, False)],
               raci=[("akanksha", "A"), ("hardeep", "R", 1.0), ("kartik", "R", 1.0), ("ali", "R", 0.75), ("kunal", "C", 2)],
               delays=[(1, "E3", "The regulator widened the access-review scope; the change was approved before the due date", "Approved change request CR-14", "Validated", {}),
                       (2, "C2", "One assessor was on leave for a week", None, "Validated", {})],
               inputs=[("value_actual", {"actual": 33}, "33", "Validated"), ("sla", {"within": 41, "total": 50}, "41 of 50 within SLA", "Validated"),
                       ("rework", {"pct": 12}, "12% of effort", "Validated"), ("errors", {"critical": 0, "minor": 4}, "0 critical, 4 minor", "Validated"),
                       ("satisfaction", {"avg": 4.1, "n": 9}, "4.1 of 5 (9 responses)", "Validated")]),
        common(code="PRJ-D24", title="Options chain performance fixes", objective="Stop stale prices and slow loads on the options chain at market open.",
               dept="Product", owner="deepinder", reviewer="kapil", priority="Medium", type="Standard", sponsor="Head of Product (Admin as sponsor)",
               value_kind="Revenue (₹)", target=6_000_000, start=wd(-105), by=a["pradeep"], charter_by=a["pradeep"], sponsor_acc=a["deepjyot"],
               closure_by=a["pradeep"], closure_decider=a["kapil"], slas=prod_slas, stage="Panel approved", adjustments={},
               plan=[("Profiling at market open", "chhatarshal", (), "pradeep", 6, 3, False), ("Websocket fan-out rewrite", "parvinder_c", (("chhatarshal", 40),), "pradeep", 12, 6, True),
                     ("Cache invalidation", "chhatarshal", (), "pradeep", 8, 0, False), ("Android chain screen", "rupinder", (), "pradeep", 8, 4, False),
                     ("iOS chain screen", "jatin", (), "pradeep", 8, 5, False), ("Load test sign-off", "amit_qa", (), "pradeep", 5, 0, False)],
               raci=[("deepinder", "A"), ("chhatarshal", "R", 1.25), ("parvinder_c", "R", 1.0), ("rupinder", "R", 0.75), ("jatin", "R", 0.75), ("amit_qa", "R", 0.5)],
               delays=[(0, "C1", "Profiling needed three market opens, not one", None, "Validated", {"escalation_miss": True}),
                       (1, "C2", "Rework after the first load test failed", None, "Validated", {}),
                       (3, "C4", "The slip was raised only after the due date", None, "Validated", {}),
                       (4, "X", "App Store review rejected the first build", None, "Validated", {"custom": "Store review rejection"})],
               inputs=[("value_actual", {"actual": 5_600_000}, "₹56,00,000", "Validated"), ("sla", {"within": 41, "total": 50}, "41 of 50 within SLA", "Validated"),
                       ("rework", {"pct": 9}, "9% of effort", "Validated"), ("errors", {"critical": 1, "minor": 3}, "1 critical, 3 minor", "Validated"),
                       ("satisfaction", {"avg": 3.7, "n": 30}, "3.7 of 5 (30 responses)", "Validated")]),
        common(code="PRJ-D25", title="Callback scheduling for high-value clients", objective="Let high-value clients book a callback slot instead of waiting in the queue.",
               dept="Client Support", owner="adity", reviewer="kapil", priority="Medium", type="Standard", sponsor="Head of Client Support",
               value_kind="Revenue (₹)", target=5_000_000, start=wd(-80), by=a["sahil"], charter_by=a["sahil"], sponsor_acc=a["kapil"],
               closure_by=a["sahil"], closure_decider=a["kapil"], slas=cs_slas,
               plan=[("Slot rules", "neeru", (), "sahil", 6, 0, False), ("Booking flow", "vishakha", (("akriti", 30),), "sahil", 10, 2, False),
                     ("Agent calendar", "jaspal", (), "sahil", 8, 0, False), ("Pilot with 200 clients", "neeru", (("vishakha", 40),), "sahil", 8, 0, False)],
               raci=[("adity", "A"), ("neeru", "R", 1.0), ("vishakha", "R", 1.0), ("jaspal", "R", 0.75), ("akriti", "R", 0.5)],
               delays=[(1, "E2", "The telephony vendor's slot API went live late", "Vendor status page and ticket", "Validated", {})],
               inputs=[("value_actual", {"actual": 5_200_000}, "₹52,00,000", "Submitted"), ("sla", {"within": 47, "total": 50}, "47 of 50 within SLA", "Validated"),
                       ("rework", {"pct": 6}, "6% of effort", "Validated"), ("errors", {"critical": 0, "minor": 2}, "0 critical, 2 minor", "Validated"),
                       ("satisfaction", {"avg": 4.4, "n": 40}, "4.4 of 5 (40 responses)", "Validated")]),
        common(code="PRJ-D26", title="DP charges billing revamp", objective="Bill depository charges once, correctly, with a clear breakdown for clients.",
               dept="Operations & BO", owner="kanav", reviewer="pawan", priority="Medium", type="Standard", sponsor="Head of Operations & BO",
               value_kind="Billing disputes avoided a month", target=300, start=wd(-70), by=a["deepjyot"], charter_by=a["deepjyot"], sponsor_acc=a["pawan"],
               closure_by=a["deepjyot"], closure_decider=a["pawan"], slas=ops_slas,
               plan=[("Charge rules review", "jaidev", (), "kanav", 6, 0, False), ("Billing engine change", "sanjay", (("vinay", 30),), "kanav", 10, 3, False),
                     ("Client statement layout", "akashdeep", (), "kanav", 8, 0, False), ("Parallel billing run", "jaidev", (("akashdeep", 40),), "kanav", 6, 0, False)],
               raci=[("kanav", "A"), ("jaidev", "R", 1.0), ("sanjay", "R", 1.0), ("akashdeep", "R", 0.75), ("vinay", "R", 0.5)],
               delays=[(1, "C1", "Billing change estimate missed the depository's file change", None, "Challenged", {"challenger": a["pawan"]})],
               inputs=[("value_actual", {"actual": 310}, "310", "Validated"), ("errors", {"critical": 0, "minor": 1}, "0 critical, 1 minor", "Validated"),
                       ("satisfaction", {"avg": 3.9, "n": 4}, "3.9 of 5 (4 responses)", "Returned", "Only 4 responses; survey the full pilot group"),
                       ("sla", {"within": 45, "total": 50}, "45 of 50 within SLA", "Submitted"), ("rework", {"pct": 5}, "5% of effort", "Submitted"),
                       ("collaboration", {"avg": 4.2, "raters": 3, "items": 0}, "4.2 of 5 from 3 raters · 0 help/playbook item(s)", "Submitted"),
                       ("innovation", {"points": 1}, "+1 of 5", "Submitted")]),
    ]
    scored = {}
    for spec in specs:
        r = _scored(s, spec)
        scored[spec["code"]] = r
    out["scored"] = {k: v["project"].title for k, v in scored.items()}

    # --- PRJ-D27: a large Product project in delivery, baseline locked ---------------------------------------------------
    pr = a["pradeep"]
    p27 = s.project("PRJ-D27", "Margin trading onboarding revamp", "Cut MTF activation time to one session with clear risk disclosures.", "Product", "pradeep",
                    "kapil", "High", wd(-36), wd(25), "In Progress", pr)
    T = lambda key, *args, **kw: s.task(p27, key, *args, by=pr, **kw)  # noqa: E731
    T("27a", "Requirements and flow mapping", "sumit", "pradeep", wd(-36), wd(-28), contrib=(("kapil_k", 30),), flow=("accept", wd(-29)))
    t27b = T("27b", "MTF onboarding screens", "sachin", "kapil", wd(-27), wd(-15), contrib=(("harsh", 25),), flow=("rework_accept", wd(-16), wd(-12)))
    t27c = T("27c", "Margin calculator API", "chhatarshal", "pradeep", wd(-20), wd(6), contrib=(("parvinder_c", 20),), status="In Development", progress=60,
             next_action="Integrate the risk-engine endpoint once it is live")
    t27d = T("27d", "eKYC vendor integration", "maninder", "kapil", wd(-18), wd(-3), status="Vendor", progress=40, next_action="Chase the vendor for sandbox keys")
    t27e = T("27e", "Android build", "rupinder", "amit_qa", wd(-12), wd(8), status="Unit testing", progress=70, next_action="Fix the two failing unit tests")
    t27f = T("27f", "iOS build", "jatin", "amit_qa", wd(-12), wd(5), status="Testing QA", progress=80, next_action="QA regression on iOS 17")
    T("27g", "Risk disclosure copy", "harsh", "pradeep", wd(-8), wd(2), flow=("review", wd(-1)), next_action="Waiting for Pradeep's review")
    T("27h", "Internal CUG rollout", "sachin", "kapil", wd(-4), wd(12), status="Internal CUG", progress=30, next_action="Collect CUG feedback by Friday")
    T("27i", "Go-live readiness checklist", "maninder", "kapil", wd(-6), wd(10), flow=("rework", wd(-2)), progress=70, next_action="Add rollback steps and resubmit")
    T("27j", "Help centre articles", "kapil_k", "pradeep", wd(2), wd(14), next_action="Draft after CUG feedback")
    T("27k", "Web release", "parvinder_c", "kapil", wd(-6), wd(9), status="Ready For Live", progress=90, go_live=wd(10), next_action="Release window booked")
    T("27l", "Feature flag configuration", "deepinder", "pradeep", wd(-5), wd(7), status="Product", progress=50, next_action="Product to confirm the rollout cohorts")
    T("27m", "Analytics events", "sumit", "pradeep", wd(-10), wd(4), status="Production", progress=95, next_action="Verify events in production dashboards")
    T("27n", "Home banner for MTF", "harsh", "pradeep", wd(-7), wd(1), status="Live Today", progress=100, go_live=today, next_action="Monitor click-through")
    T("27o", "Pricing page update", "sachin", "kapil", wd(-14), wd(3), status="Live", progress=100, go_live=wd(-2), next_action="Send for review with the release note")
    s.blocker(t27c, "Internal dependency", "chhatarshal", "pradeep", wd(-6), "Risk-engine endpoint not deployed yet", "Jira RISK-221", "Validated", "Confirmed with the platform team")
    t27c.status = "In Development"
    s.blocker(t27d, "External or vendor", "maninder", "kapil", wd(-4), "eKYC vendor has not issued sandbox keys", "Vendor email of last week")
    s.date_change(t27d, wd(8), "External or vendor", "maninder", "kapil", wd(-3), "Vendor keys expected next week")
    s.blocker(t27e, "Technical issue", "rupinder", "pradeep", wd(-5), "Gradle build cache corrupt on CI", "CI log", "Rejected", "A technical issue on our side is not an excusable blocker")
    s.date_change(t27f, wd(5), "Requirement change", "jatin", "pradeep", wd(-9), "Disclosure screen added after legal review", "Validated", "Scope change confirmed")
    s.risk(p27, 1, "Vendor keys arrive late and eKYC slips", "Integration", "High", "maninder", "Open", "Escalate through procurement; keep manual KYC fallback", wd(3), pr)
    s.risk(p27, 2, "Disclosure wording rejected by Compliance", "Content", "Medium", "harsh", "Mitigating", "Early review slot with Compliance", wd(5), pr)
    s.risk(p27, 3, "App store review delays the release", "Release", "Low", "jatin", "Closed", "Submitted a week early", wd(-2), pr)
    c27 = s.charter(p27, champion="pradeep", ptype="Complex", sponsor="Head of Product (Admin as sponsor)", value_kind="Revenue (₹)", target=50_000_000, target_text=None,
                    raci=[("pradeep", "A"), ("sachin", "R", 1.0), ("maninder", "R", 1.0), ("harsh", "R", 0.5), ("sumit", "R", 0.75), ("kapil_k", "R", 0.5), ("chhatarshal", "R", 1.0),
                          ("parvinder_c", "R", 0.75), ("rupinder", "R", 0.75), ("jatin", "R", 0.75), ("deepinder", "R", 0.5), ("amit_qa", "C", 2), ("Head of Sales", "I")],
                    slas=prod_slas, state="Locked", submitter=pr, sponsor_acc=a["deepjyot"], pmo_acc=s.holder("PMO validator", pr, a["deepjyot"]), enrolled=wd(-38))
    s.delay(p27, 1, t27b, "C2", "Designer pulled into the Diwali campaign for three days", None, "Logged", pr, None)
    s.closure(p27, "Draft", None, None, today, done=("lessons",))
    out["PRJ-D27"] = "in delivery, charter locked"

    # --- PRJ-D28: blocked Client Support project from an accepted Sales request ------------------------------------------
    sh = a["sahil"]
    p28 = s.project("PRJ-D28", "WhatsApp support channel", "Answer client queries on WhatsApp with the same SLAs as phone and email.", "Client Support", "sahil",
                    "kapil", "High", wd(-40), wd(-4), "Blocked", a["kapil"])
    T = lambda key, *args, **kw: s.task(p28, key, *args, by=sh, **kw)  # noqa: E731
    T("28a", "Channel use cases and FAQs", "aaina", "sahil", wd(-40), wd(-32), contrib=(("arun", 30),), flow=("accept", wd(-33)))
    t28b = T("28b", "Meta business verification", "jaspal", "kapil", wd(-31), wd(-6), status="Block", progress=50, next_action="Resubmit documents once Meta replies")
    T("28c", "Message templates", "kiritika", "aaina", wd(-20), wd(3), contrib=(("shagun", 40),), flow=("review", wd(-2)), next_action="Waiting for Aaina's review")
    t28d = T("28d", "CRM integration", "neeru", "sahil", wd(-18), wd(-2), status="Pending", progress=35, next_action="Needs a developer from IT")
    T("28e", "Agent training", "shalini_d", "aaina", wd(1), wd(9), next_action="Book the training room")
    T("28f", "Pilot with 50 clients", "akriti", "sahil", wd(-10), wd(-1), status="Delayed", progress=20, next_action="Starts once verification clears")
    T("28g", "IVR fallback to WhatsApp", "vishakha", "sahil", wd(-12), wd(6), status="Exotel Vendor", progress=45, next_action="Exotel to enable the fallback flow")
    T("28h", "Escalation matrix", "jaspal", "aaina", wd(-6), wd(4), status="In Progress", progress=55, next_action="Add the night-shift contacts")
    s.blocker(t28b, "External or vendor", "jaspal", "kapil", wd(-9), "Meta asked for a second business document", "Meta case 4471", "Validated", "Meta's own review queue")
    t28b.status = "Block"
    s.blocker(t28d, "Resource", "neeru", "kapil", wd(-3), "No developer free in IT for the CRM connector", "IT resourcing sheet")
    s.date_change(t28d, wd(10), "Technical issue", "neeru", "kapil", wd(-5), "Connector harder than estimated", "Rejected",
                  "A technical estimate is not an excusable reason; the original date stays")
    s.risk(p28, 1, "Meta verification is refused", "Verification", "Critical", "jaspal", "Open", "Keep the SMS fallback; escalate through the Meta partner", wd(2), sh)
    s.risk(p28, 2, "Agents not trained before the pilot", "Training", "Medium", "shalini_d", "Open", "Train in two short batches", wd(4), sh)
    s.charter(p28, champion="sahil", ptype="Standard", sponsor="Head of Client Support", value_kind="Queries answered on WhatsApp a month", target=6000, target_text=None,
              raci=[("sahil", "A"), ("aaina", "R", 1.0), ("jaspal", "R", 1.0), ("neeru", "R", 0.75), ("kiritika", "R", 0.5), ("akriti", "R", 0.5), ("vishakha", "R", 0.5),
                    ("shagun", "R", 0.5), ("arun", "R", 0.5), ("shalini_d", "R", 0.5), ("angel", "C", 2)],
              slas=cs_slas, state="Submitted", submitter=sh, sponsor_acc=a["kapil"], pmo_acc=None, enrolled=wd(-3))
    out["PRJ-D28"] = "blocked, charter waiting for the PMO"

    # --- PRJ-D29: Compliance drive waiting for closure approval, charter in draft ----------------------------------------
    dj = a["deepjyot"]
    p29 = s.project("PRJ-D29", "KYC re-verification drive", "Re-verify KYC for dormant accounts flagged in the last exchange inspection.", "Compliance", "kunal",
                    "pawan", "Medium", wd(-45), wd(2), "In Review", dj)
    plan29 = [("Dormant account list", "hardeep", (), "kunal", 6, 0, False), ("Client outreach", "ali", (("kartik", 40),), "kunal", 10, 0, False),
              ("Document checks", "kartik", (), "akanksha", 10, 0, True), ("Exchange report", "hardeep", (("ali", 30),), "kunal", 6, 0, False)]
    tasks29 = _delivered(s, p29, plan29, wd(-40), dj)
    p29.target_date = wd(2)
    s.closure(p29, "Submitted", dj, None, min(s.wd(1, max(t.accepted_submission_date for t in tasks29)), today))
    s.charter(p29, champion="kunal", ptype="Standard", sponsor="Head of Compliance", value_kind="Accounts re-verified", target=None, target_text="12,000 accounts",
              raci=[("kunal", "A"), ("hardeep", "R", 1.0), ("ali", "R", 0.75), ("kartik", "R", 0.75), ("akanksha", "C", 2)], slas=[], state="Draft",
              submitter=None, sponsor_acc=None, pmo_acc=None, enrolled=wd(-2))
    out["PRJ-D29"] = "in review, closure submitted, charter draft"

    # --- PRJ-D30 to D32: IT and Digital Marketing, on hold, cancelled and planning ---------------------------------------
    p30 = s.project("PRJ-D30", "Laptop fleet refresh and MDM rollout", "Replace five-year-old laptops and enrol every device in mobile device management.",
                    "IT", "gurpreet", "rajesh_p", "Low", wd(-30), wd(30), "On Hold", dj)
    T = lambda key, *args, **kw: s.task(p30, key, *args, by=dj, **kw)  # noqa: E731
    T("30a", "Device inventory", "neeraj", "gurpreet", wd(-30), wd(-22), flow=("accept", wd(-23)))
    t30b = T("30b", "Vendor quotes", "sunil", "gurpreet", wd(-21), wd(-10), status="On Hold", next_action="Paused until the budget is confirmed")
    T("30c", "MDM pilot", "abhinav", "sourav", wd(-9), wd(5), status="On Hold", progress=20, next_action="Resume after vendor selection")
    T("30d", "Rollout to all staff", "sourav", "gurpreet", wd(6), wd(28), status="On Hold", next_action="Paused")
    s.date_change(t30b, wd(15), "Management reprioritisation", "sunil", "gurpreet", wd(-12), "Budget moved to the next quarter", "Validated", "Approved by the IT head")
    s.risk(p30, 1, "Budget not released this quarter", "Procurement", "Medium", "gurpreet", "Open", "Phase the purchase over two quarters", wd(10), dj)

    p31 = s.project("PRJ-D31", "Brand website refresh", "Refresh the corporate website's look and content.", "Digital Marketing", "deesha", "ramneek", "Low",
                    wd(-50), wd(-5), "Cancelled", dj)
    T = lambda key, *args, **kw: s.task(p31, key, *args, by=dj, **kw)  # noqa: E731
    T("31a", "Content audit", "sonal", "deesha", wd(-50), wd(-42), flow=("accept", wd(-43)))
    T("31b", "Visual design", "smeet", "deesha", wd(-41), wd(-25), status="Cancelled", next_action="Cancelled: brand guidelines are being redone first")
    T("31c", "Website build", "naveen", "deesha", wd(-24), wd(-5), status="Cancelled")
    s.closure(p31, "Returned", dj, a["balneet"], wd(-3), "Record why it was cancelled and what carries over before closing", done=("tasks", "deliverables", "objectives", "issues"))
    s.risk(p31, 1, "Brand guidelines change again", "Design", "Low", "deesha", "Closed", "Project cancelled until the new guidelines are final", wd(-5), dj)

    p32 = s.project("PRJ-D32", "Office network upgrade", "Replace core switches and add a second internet link at the head office.", "IT", "sourav", "rajesh_p",
                    "Medium", wd(5), wd(45), "Planning", dj)
    T = lambda key, *args, **kw: s.task(p32, key, *args, by=dj, **kw)  # noqa: E731
    T("32a", "Site survey", "sunil", "gurpreet", wd(5), wd(10), next_action="Book the survey with the vendor")
    T("32b", "Switch procurement", "neeraj", "gurpreet", wd(11), wd(25), next_action="Raise the purchase request")
    T("32c", "Cutover plan", "himanshu", "gurpreet", wd(26), wd(40), contrib=(("sunil", 30),), next_action="Draft after the survey")
    s.risk(p32, 1, "Cutover disrupts trading hours", "Cutover", "High", "sourav", "Open", "Cut over on a Saturday with a rollback plan", wd(20), dj)
    out["others"] = ["PRJ-D30 on hold", "PRJ-D31 cancelled", "PRJ-D32 planning"]

    # --- risks on the finished projects ----------------------------------------------------------------------------------
    for code, n, text, crit, owner, by in (("PRJ-D20", 1, "Push vendor changes its API", "Medium", "maninder", pr), ("PRJ-D21", 1, "Misrouted VIP tickets", "High", "jaspal", sh),
                                           ("PRJ-D22", 1, "Bank changes its file format", "Medium", "sanjay", dj), ("PRJ-D24", 1, "Market-open load exceeds test load", "Critical", "chhatarshal", pr)):
        p = scored[code]["project"]
        s.risk(p, n, text, "Delivery", crit, owner, "Closed", "Handled during delivery", s.wd(5, p.start_date), by)

    # --- incidents and RCA -----------------------------------------------------------------------------------------------
    def incident(code, p, title, system, day, reporter, stakeholder, dept, proposed, state, by, **kw):
        hist = [{"at": s.at(day, 12).isoformat(timespec="minutes"), "event": "Recorded", "note": f"Proposed severity {proposed}; attribution pending", "actor": by.employee.full_name}]
        i = Incident(code=code, project_id=p.id, title=title, product_system=system, incident_date=day, received_date=day, reporter_id=s.e[reporter].id,
                     severity_proposed=proposed, responsible_department_id=s.d[dept].id, stakeholder_id=s.e[stakeholder].id, state=state, illustrative=True, history=hist, **kw)
        s.db.add(i)
        s.db.flush()
        s.audit(day, by, "record_incident", "project", p.id, title, None, {"severity_proposed": proposed}, hour=12)
        return i

    def log(i, day, actor, event, note, action, hour=14):
        i.history = [*i.history, {"at": s.at(day, hour).isoformat(timespec="minutes"), "event": event, "note": note, "actor": actor.employee.full_name}]
        s.audit(day, actor, action, "incident", i.id, i.title, None, {"state": i.state}, note, hour=hour)

    def preventive(i, n, title, owner, reviewer, due, flow=None, status="Not Started", progress=0, by=None):
        t = s.task(s.db.get(Project, i.project_id), f"{i.code}:{n}", title, owner, reviewer, min(due, s.wd(-8, due)), due, flow=flow, status=status,
                   progress=progress, by=by, checklist=("Preventive control implemented", "Evidence attached"), evidence="Evidence of the preventive control", category="Preventive action")
        t.code, t.incident_id = f"{i.code}-P{n:02d}", i.id
        return t

    i2 = incident("INC-DEMO-02", p27, "OTP failures during MTF activation", "Mobile app", wd(-2), "sachin", "maninder", "Product", "Medium", "Open", pr, clients_impacted=140)
    i3 = incident("INC-DEMO-03", p28, "WhatsApp replies sent twice", "Support channel", wd(-8), "aaina", "jaspal", "Client Support", "Minor", "Under analysis", sh,
                  clients_impacted=35, root_cause="Webhook retried on timeout without an idempotency key", root_cause_category="Integration", expected_closure=wd(7))
    log(i3, wd(-6), sh, "Analysis updated", "root_cause, root_cause_category, expected_closure", "update_rca")
    p21 = scored["PRJ-D21"]["project"]
    i4 = incident("INC-DEMO-04", p21, "VIP tickets routed to the general queue", "CRM", wd(-60), "aaina", "jaspal", "Client Support", "Medium", "Correction done", sh,
                  clients_impacted=22, root_cause="Tier field missing on clients migrated last year", root_cause_category="Data", gap="No check on the tier field at migration",
                  correction_action="Backfilled the tier field", correction_date=wd(-57), expected_closure=wd(-45))
    log(i4, wd(-58), sh, "Analysis updated", "root_cause, gap, correction_action", "update_rca")
    i4.severity_validated, i4.attribution_state, i4.attribution_validator_id, i4.attribution_reason = "Minor", "not_established", s.e["kapil"].id, "A data gap, not one person's error"
    log(i4, wd(-56), a["kapil"], "Attribution recorded", "Minor; not_established; a data gap, not one person's error", "validate_attribution")
    preventive(i4, 1, "Validate the tier field on every client import", "neeru", "sahil", wd(-48), flow=("accept", wd(-49)), by=sh)
    i4.state = "Preventive action in progress"
    log(i4, wd(-55), sh, "Preventive task created", "Validate the tier field on every client import", "add_preventive_task")
    i4.state, i4.actual_closure, i4.verifier_id, i4.verification_note = "Closed", wd(-46), s.e["kapil"].id, "Import check live; no misroutes in two weeks"
    log(i4, wd(-46), a["kapil"], "Closure verified", i4.verification_note, "verify_incident_closure")
    p22 = scored["PRJ-D22"]["project"]
    i5 = incident("INC-DEMO-05", p22, "Reconciliation mismatch on 12 accounts", "Back office", wd(-40), "vinay", "jaidev", "Operations & BO", "Medium", "Correction done", dj,
                  root_cause="Same-day reversals were matched twice", root_cause_category="Process", gap="Reversal entries not excluded", correction_action="Re-ran the match",
                  correction_date=wd(-38), expected_closure=wd(-30))
    preventive(i5, 1, "Exclude same-day reversals from matching", "jaidev", "vivek", wd(-32), flow=("accept", wd(-33)), by=dj)
    i5.state, i5.actual_closure, i5.verifier_id, i5.verification_note = "Closed", wd(-31), s.e["pawan"].id, "Two clean month-ends"
    log(i5, wd(-31), a["pawan"], "Closure verified", "Two clean month-ends", "verify_incident_closure")
    i5.state = "Reopened"
    log(i5, wd(-9), a["pawan"], "Reopened", "Three mismatches again after the bank changed its reversal code", "reopen_incident")
    preventive(i5, 2, "Map the bank's new reversal code", "sanjay", "vivek", wd(4), status="In Progress", progress=40, by=dj)
    p24 = scored["PRJ-D24"]["project"]
    i6 = incident("INC-DEMO-06", p24, "Stale options prices at market open", "Trading app", wd(-70), "amit_qa", "chhatarshal", "Product", "Major", "Correction done", pr,
                  clients_impacted=1800, orders_impacted=260, root_cause="Cache not invalidated on the first tick", root_cause_category="Code",
                  gap="No market-open load test", correction_action="Hotfix to invalidate on the first tick", correction_date=wd(-69), expected_closure=wd(10))
    i6.severity_validated, i6.attribution_state, i6.attributed_employee_id = "Major", "validated", s.e["chhatarshal"].id
    i6.attribution_validator_id, i6.attribution_reason = s.e["pawan"].id, "The cache change skipped the agreed review step"
    log(i6, wd(-66), a["pawan"], "Attribution recorded", "Major; validated; the cache change skipped the agreed review step", "validate_attribution")
    p26 = scored["PRJ-D26"]["project"]
    i7 = incident("INC-DEMO-07", p26, "DP charges billed twice for one cycle", "Billing", wd(-25), "akashdeep", "sanjay", "Operations & BO", "Medium", "Correction done", dj,
                  clients_impacted=410, root_cause="The billing job ran twice after a restart", root_cause_category="Process", gap="Job not idempotent",
                  correction_action="Refunded the duplicate charges", correction_date=wd(-23), expected_closure=wd(8))
    preventive(i7, 1, "Make the billing job idempotent", "sanjay", "kanav", wd(6), status="In Development", progress=60, by=dj)
    i7.state = "Preventive action in progress"
    log(i7, wd(-20), dj, "Preventive task created", "Make the billing job idempotent", "add_preventive_task")
    out["incidents"] = ["INC-DEMO-02 Open", "INC-DEMO-03 Under analysis", "INC-DEMO-04 Closed", "INC-DEMO-05 Reopened", "INC-DEMO-06 Correction done", "INC-DEMO-07 Preventive action in progress"]

    # --- cross-department requests -----------------------------------------------------------------------------------------
    email = db.scalar(select(WorkflowTemplate).where(WorkflowTemplate.name == "Email campaign"))

    def request(title, frm, to, requester, validator, state, day, history, project=None, template=None, priority="Medium"):
        r = WorkRequest(title=title, template_id=template.id if template else None, requesting_department_id=s.d[frm].id, receiving_department_id=s.d[to].id,
                        audience="Clients and staff named in the brief", objective=title, required_date=s.wd(20, day), priority=priority,
                        brief=f"Brief and assets attached {MARK}", requester_id=s.e[requester].id, validator_id=s.e[validator].id, state=state,
                        project_id=project.id if project else None, history=history, created_at=s.at(day, 10))
        db.add(r)
        db.flush()
        s.audit(day, s.acc_of(s.e[requester]) or dj, "create_request", "request", r.id, title, None, {"priority": priority})
        return r

    h = lambda *events: [{"at": s.at(d, hr).isoformat(timespec="minutes"), "event": e, "actor": actor, **({"note": note} if note else {})} for d, hr, e, actor, note in events]  # noqa: E731
    request("WhatsApp support channel for Sales leads", "Sales", "Client Support", "amit_sales", "gurjot", "Accepted", wd(-44),
            h((wd(-44), 10, "Submitted", "Amit Kumar", None), (wd(-43), 11, "Validated", "Gurjot Singh", None), (wd(-41), 15, "Accepted", "Kapil Abrol", "Scheduled for this quarter")),
            project=p28, priority="High")
    if email:
        request("SIP top-up reminder campaign", "Client Support", "Digital Marketing", "angel", "kapil", "Validated", wd(-3),
                h((wd(-3), 10, "Submitted", "Angel Sharma", None), (wd(-2), 12, "Validated", "Kapil Abrol", "Brief is complete")), template=email)
    request("Surveillance alert report automation", "Operations & BO", "IT", "vivek", "pawan", "Submitted", wd(-1), h((wd(-1), 10, "Submitted", "Vivek Sharma", None)))
    request("Onboarding explainer video", "Client Support", "Digital Marketing", "adity", "angel", "Returned", wd(-12),
            h((wd(-12), 10, "Submitted", "Adity Chiba", None), (wd(-11), 16, "Returned", "Angel Sharma", "Add the script and the target length")), priority="Low")
    request("Branch signage refresh", "Sales", "Digital Marketing", "amit_sales", "gurjot", "Rejected", wd(-20),
            h((wd(-20), 10, "Submitted", "Amit Kumar", None), (wd(-19), 11, "Validated", "Gurjot Singh", None),
              (wd(-17), 15, "Rejected", "Deepjyot Tiwari", "Physical signage is handled by Admin, not Digital Marketing")), priority="Low")
    out["requests"] = ["Accepted (PRJ-D28)", "Validated", "Submitted", "Returned", "Rejected"]

    record(db, a["deepjyot"].id, SEED_ACTION, "system", None, "Illustrative Project Tier layer", None, {k: v for k, v in out.items()})
    db.flush()
    return out


def clear_project_tier_demo(db: Session) -> dict:
    """Remove the layer's records. Imported and real data, the other demo layers and the audit log stay."""
    pids = list(db.scalars(select(Project.id).where(Project.code.in_(CODES), Project.source == "demo")))
    tids = list(db.scalars(select(Task.id).where(Task.project_id.in_(pids))))
    counts = {"projects": len(pids), "tasks": len(tids)}
    for f in db.scalars(select(EvidenceFile).where(EvidenceFile.task_id.in_(tids))):
        try:
            if f.stored_path and "demo-" in f.stored_path:
                from pathlib import Path

                Path(f.stored_path).unlink(missing_ok=True)
        except OSError:
            pass
    for model, col in ((TaskEvent, TaskEvent.task_id), (ReviewDecision, ReviewDecision.task_id), (Submission, Submission.task_id), (EvidenceFile, EvidenceFile.task_id),
                       (Blocker, Blocker.task_id), (DeadlineChange, DeadlineChange.task_id), (Comment, Comment.task_id), (Assignment, Assignment.task_id)):
        db.execute(delete(model).where(col.in_(tids)))
    db.execute(delete(TaskDependency).where(TaskDependency.task_id.in_(tids) | TaskDependency.depends_on_id.in_(tids)))
    for model in (ProjectDelay, ProjectRrInput, ProjectRaci, ProjectSla, BaselineChange, ProjectDispute, ProjectCharter, ProjectClosure, Risk):
        db.execute(delete(model).where(model.project_id.in_(pids)))
    db.execute(delete(Task).where(Task.id.in_(tids)))
    db.execute(delete(Incident).where(Incident.project_id.in_(pids), Incident.illustrative.is_(True)))
    counts["requests"] = db.execute(delete(WorkRequest).where(WorkRequest.brief.like(f"%{MARK}"), WorkRequest.title.in_((
        "WhatsApp support channel for Sales leads", "SIP top-up reminder campaign", "Surveillance alert report automation", "Onboarding explainer video",
        "Branch signage refresh")))).rowcount
    db.execute(delete(Project).where(Project.id.in_(pids)))
    seeded = db.scalar(select(AuditEvent).where(AuditEvent.action == SEED_ACTION).order_by(AuditEvent.id.desc()))
    tagged = (seeded.new or {}).get("finance_confirmer_tagged") if seeded else None
    if tagged:
        acc = db.scalar(select(Account).where(Account.email == tagged))
        if acc and FINANCE in (acc.functions or []):
            acc.functions = [f for f in acc.functions if f != FINANCE]
            counts["finance_confirmer_removed"] = tagged
    record(db, None, CLEAR_ACTION, "system", None, "Illustrative Project Tier layer", None, counts)
    db.flush()
    return counts


if __name__ == "__main__":
    from app.core.database import SessionLocal

    action = sys.argv[1] if len(sys.argv) > 1 else "add"
    with SessionLocal() as session:
        result = seed_project_tier_demo(session) if action == "add" else clear_project_tier_demo(session) if action == "clear" else {"error": "use add or clear"}
        session.commit()
    print(result)
