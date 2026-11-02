"""The rich Project Tier demo layer (PRJ-D20 to PRJ-D32): idempotent, removable, obeys CLAUDE.md §4 and §22, and never touches other data.
Runs near the end: it clears and reloads the layer."""

from sqlalchemy import func, select

from app.core.clock import today_ist
from app.core.database import SessionLocal
from app.models import (
    Account,
    Blocker,
    DeadlineChange,
    Incident,
    Project,
    ProjectCharter,
    ProjectClosure,
    ProjectDelay,
    ProjectRaci,
    ProjectRrInput,
    ReviewDecision,
    RrPolicy,
    Submission,
    Task,
    WorkRequest,
)
from app.models.project import PROJECT_STATUSES
from app.models.project_rr import INPUT_KINDS
from app.models.task import TASK_STATUSES
from app.seed.project_tier_demo import CODES, clear_project_tier_demo, project_tier_demo_was_cleared, seed_project_tier_demo
from app.services.project_scoring import REASON_CODES


def _demo_ids(db) -> list[int]:
    return list(db.scalars(select(Project.id).where(Project.code.in_(CODES))))


def _fingerprint(db) -> list:
    """Everything outside the layer that it could plausibly touch."""
    demo = set(_demo_ids(db))
    projects = [(p.id, p.code, p.status, p.priority, p.version, p.target_date) for p in db.scalars(select(Project).order_by(Project.id)) if p.id not in demo]
    tasks = [(t.id, t.code, t.status, t.progress, t.due_date, t.version) for t in db.scalars(select(Task).order_by(Task.id)) if t.project_id not in demo]
    charters = [(c.id, c.state, c.stage, bool(c.frozen)) for c in db.scalars(select(ProjectCharter).order_by(ProjectCharter.id)) if c.project_id not in demo]
    return [projects, tasks, charters]


def test_seed_is_idempotent():
    with SessionLocal() as db:
        before = {m.__name__: db.scalar(select(func.count()).select_from(m)) for m in (Project, Task, Submission, ProjectCharter, Incident, WorkRequest, ProjectDelay)}
        assert seed_project_tier_demo(db) == {"skipped": "already present"}
        db.commit()
        after = {m.__name__: db.scalar(select(func.count()).select_from(m)) for m in (Project, Task, Submission, ProjectCharter, Incident, WorkRequest, ProjectDelay)}
    assert before == after and len(CODES) == 13


def test_coverage_of_statuses_and_states():
    with SessionLocal() as db:
        demo = _demo_ids(db)
        projects = list(db.scalars(select(Project).where(Project.id.in_(demo))))
        assert {p.status for p in projects} >= set(PROJECT_STATUSES) - {"Not Started"}
        assert {p.priority for p in projects} == {"High", "Medium", "Low"} and all(p.source == "demo" for p in projects)
        assert {t.status for t in db.scalars(select(Task).where(Task.project_id.in_(demo)))} == set(TASK_STATUSES)
        assert {b.state for b in db.scalars(select(Blocker).join(Task, Task.id == Blocker.task_id).where(Task.project_id.in_(demo)))} == {"Pending", "Validated", "Rejected"}
        assert {c.state for c in db.scalars(select(DeadlineChange).join(Task, Task.id == DeadlineChange.task_id).where(Task.project_id.in_(demo)))} == {"Pending", "Validated", "Rejected"}
        assert {i.state for i in db.scalars(select(Incident).where(Incident.project_id.in_(demo)))} >= {"Open", "Under analysis", "Closed", "Reopened", "Preventive action in progress"}
        assert {c.state for c in db.scalars(select(ProjectClosure).where(ProjectClosure.project_id.in_(demo)))} == {"Draft", "Submitted", "Returned", "Approved"}
        assert {c.state for c in db.scalars(select(ProjectCharter).where(ProjectCharter.project_id.in_(demo)))} == {"Draft", "Submitted", "Locked"}
        assert {d.reason_code for d in db.scalars(select(ProjectDelay).where(ProjectDelay.project_id.in_(demo)))} == REASON_CODES
        assert {r.state for r in db.scalars(select(WorkRequest).where(WorkRequest.brief.like("%(illustrative)")))} == {"Submitted", "Validated", "Accepted", "Returned", "Rejected"}
        waiting = {INPUT_KINDS[i.kind][1] for i in db.scalars(select(ProjectRrInput).where(ProjectRrInput.project_id.in_(demo), ProjectRrInput.state == "Submitted"))}
        assert waiting == {"PMO validator", "Quality assessor", "HR calibrator", "R&R Panel member", "Finance confirmer"}  # one input waits for each function
        assert all(x.illustrative for m in (ProjectCharter, ProjectDelay, ProjectRrInput) for x in db.scalars(select(m).where(m.project_id.in_(demo))))


def test_tasks_obey_the_review_and_assignment_rules():
    today = today_ist()
    with SessionLocal() as db:
        demo = _demo_ids(db)
        for t in db.scalars(select(Task).where(Task.project_id.in_(demo))):
            owners = [a for a in t.assignments if a.role == "Owner"]
            assert len(owners) == 1 and round(sum(a.share for a in t.assignments), 6) == 1, t.code
            assert t.reviewer_id and t.reviewer_id not in {a.employee_id for a in t.assignments}, t.code
            subs = list(db.scalars(select(Submission).where(Submission.task_id == t.id).order_by(Submission.version)))
            decisions = list(db.scalars(select(ReviewDecision).where(ReviewDecision.task_id == t.id).order_by(ReviewDecision.id)))
            assert all(s.submission_date <= today for s in subs) and all(d.reviewer_id == t.reviewer_id for d in decisions), t.code
            if t.status == "Completed":
                assert decisions and decisions[-1].decision == "accept" and decisions[-1].submission_id == subs[-1].id, t.code
                assert t.accepted_submission_date == subs[-1].submission_date, t.code  # the accepted submission date is the completion date
            elif t.status == "In Review":
                assert subs and len(decisions) == len(subs) - 1, t.code
            elif t.status == "Rework":
                assert decisions and decisions[-1].decision == "rework", t.code
            else:
                assert not any(d.decision == "accept" for d in decisions), t.code
            assert t.due_date_original is not None
        for b in db.scalars(select(Blocker).join(Task, Task.id == Blocker.task_id).where(Task.project_id.in_(demo))):
            assert b.requester_id != b.validator_id
        for c in db.scalars(select(DeadlineChange).join(Task, Task.id == DeadlineChange.task_id).where(Task.project_id.in_(demo))):
            t = db.get(Task, c.task_id)
            assert c.requester_id != c.validator_id
            if c.state == "Validated":
                assert t.due_date == c.requested_date and t.due_date_original == c.original_date


def test_project_rr_independence():
    with SessionLocal() as db:
        demo = _demo_ids(db)
        for c in db.scalars(select(ProjectCharter).where(ProjectCharter.project_id.in_(demo))):
            rows = [r for r in db.scalars(select(ProjectRaci).where(ProjectRaci.project_id == c.project_id)) if r.employee_id]
            assert len({r.employee_id for r in rows}) == len(rows) and sum(r.letter == "A" for r in rows) == 1
            champion = db.scalar(select(Account.id).where(Account.employee_id == c.champion_id))
            if c.state == "Locked":
                assert c.sponsor_ok_by and c.pmo_ok_by and c.sponsor_ok_by != c.pmo_ok_by
                assert c.submitted_by not in (c.sponsor_ok_by, c.pmo_ok_by) and champion not in (c.sponsor_ok_by, c.pmo_ok_by)
        for i in db.scalars(select(ProjectRrInput).where(ProjectRrInput.project_id.in_(demo), ProjectRrInput.state != "Submitted")):
            v = db.get(Account, i.validator_account_id)
            assert v.id != i.author_account_id and INPUT_KINDS[i.kind][1] in v.functions
        for d in db.scalars(select(ProjectDelay).where(ProjectDelay.project_id.in_(demo), ProjectDelay.validated_by.is_not(None))):
            assert d.validated_by != d.logged_by and "PMO validator" in db.get(Account, d.validated_by).functions
        for c in db.scalars(select(ProjectClosure).where(ProjectClosure.project_id.in_(demo), ProjectClosure.decided_by.is_not(None))):
            assert c.decided_by != c.submitted_by


def test_screens_have_bands_and_audit_history(client, auth):
    admin = auth("admin")
    rec = client.get("/api/recognition", headers=admin).json()
    assert {b for b, n in rec["bands"].items() if n} == {"Platinum", "Gold", "Silver", "Bronze", "Review"}
    d11 = next(r for r in rec["rows"] if r["project"]["code"] == "PRJ-D11")
    assert d11["score"] == 88 and d11["band"] == "Gold"
    projects = {p["code"]: p for p in client.get("/api/projects?tab=all&status=", headers=admin).json()}
    assert {projects[c]["metrics"]["health"] for c in CODES} >= {"On Track", "At Risk", "Off Track"}
    for code in CODES:
        assert client.get(f"/api/projects/{projects[code]['id']}/activity", headers=admin).json(), code
    # money stays with Admin and the Panel; individual scores follow private scope
    mgr = client.get("/api/recognition", headers=auth("manager")).json()
    assert mgr["pool_total"] is None and all(r["pool"] is None for r in mgr["rows"])


def test_clear_and_reload_never_touch_other_records():
    with SessionLocal() as db:
        before, policy = _fingerprint(db), db.scalar(select(RrPolicy.state).where(RrPolicy.code == "PR-1"))
        counts = clear_project_tier_demo(db)
        db.commit()
        assert counts["projects"] == 13 and not _demo_ids(db) and project_tier_demo_was_cleared(db)
        assert _fingerprint(db) == before
        assert "Finance confirmer" not in (db.scalar(select(Account).where(Account.email == "balneet.birah@finvasia.example")).functions or [])
        out = seed_project_tier_demo(db)
        db.commit()
        assert "scored" in out and len(_demo_ids(db)) == 13 and not project_tier_demo_was_cleared(db)
        assert _fingerprint(db) == before
        assert db.scalar(select(RrPolicy.state).where(RrPolicy.code == "PR-1")) == policy  # the seed never changes PR-1
