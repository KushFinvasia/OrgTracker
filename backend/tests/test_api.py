"""Business invariants through the API: scope, mandatory priority, assignments, review, training, locks."""

from datetime import date, timedelta


def _emp(client, h, code):
    rows = client.get(f"/api/people/lookup?q={code}", headers=h).json()
    return next(r for r in rows if r["code"] == code)


def test_unauthenticated_and_unknown_accounts_rejected(client):
    assert client.get("/api/home").status_code == 401
    assert client.post("/api/auth/login", json={"email": "team@finvasia.example"}).status_code == 401


def test_every_role_loads_home(client, auth):
    for who in ("admin", "hod", "manager", "team_lead"):
        r = client.get("/api/home", headers=auth(who))
        assert r.status_code == 200, (who, r.text)


def test_manager_sees_review_and_validation_actions(client, auth):
    actions = client.get("/api/actions", headers=auth("manager")).json()
    types = {a["type"] for a in actions}
    assert {"Work review", "Validation", "Check-in"} <= types


def test_project_priority_mandatory_no_default(client, auth):
    h = auth("manager")
    me = client.get("/api/auth/me", headers=h).json()
    depts = client.get("/api/departments", headers=h).json()
    product = next(d for d in depts if d["name"] == "Product")
    body = {"title": "Website launch follow-up", "owner_id": me["employee"]["id"], "department_id": product["id"], "start_date": "2026-10-12"}
    r = client.post("/api/projects", json=body, headers=h)
    assert r.status_code == 422 and r.json()["detail"]["field"] == "priority"
    r = client.post("/api/projects", json={**body, "priority": "Medium"}, headers=h)
    assert r.status_code == 200
    assert r.json()["status"] == "Planning"


def test_team_lead_cannot_see_private_performance(client, auth):
    h = auth("team_lead")
    periods = client.get("/api/periods", headers=h).json()
    assert client.get(f"/api/periods/{periods[0]['id']}/team", headers=h).status_code == 403
    assert client.get("/api/reports/training", headers=h).status_code == 403


def test_project_membership_does_not_grant_performance(client, auth):
    # Kapil (HOD Client Support) cannot open Sachin's (Product) evaluation.
    h = auth("hod")
    sachin = _emp(client, h, "EMP-0082")
    periods = client.get("/api/periods", headers=h).json()
    q3 = next(p for p in periods if p["name"] == "Jul-Sep 2026")
    assert client.get(f"/api/evaluations/{sachin['id']}/{q3['id']}", headers=h).status_code == 403


def test_manager_scope_excludes_other_departments_projects(client, auth):
    h = auth("manager")
    codes = {p["code"] for p in client.get("/api/projects", headers=h).json()}
    assert "PRJ-D01" in codes
    assert not any(c in codes for c in ("PRJ-042", "PRJ-044"))  # Client Support projects


def test_task_creation_rules(client, auth):
    h = auth("manager")
    projects = client.get("/api/projects", headers=h).json()
    p = next(x for x in projects if x["code"] == "PRJ-D01")
    sachin, maninder, pradeep = (_emp(client, h, c) for c in ("EMP-0082", "EMP-0083", "EMP-0081"))
    base = {"project_id": p["id"], "title": "Review handoff notes", "description": "Check notes", "complexity": 3, "due_date": "2026-10-20", "reviewer_id": pradeep["id"], "checklist": ["Notes complete"]}
    bad_total = {**base, "assignments": [{"employee_id": sachin["id"], "role": "Owner", "share": 80}, {"employee_id": maninder["id"], "role": "Contributor", "share": 40}]}
    r = client.post("/api/tasks", json=bad_total, headers=h)
    assert r.status_code == 422 and "120" in r.json()["detail"]["message"]
    two_owners = {**base, "assignments": [{"employee_id": sachin["id"], "role": "Owner", "share": 50}, {"employee_id": maninder["id"], "role": "Owner", "share": 50}]}
    assert client.post("/api/tasks", json=two_owners, headers=h).status_code == 422
    self_review = {**base, "reviewer_id": sachin["id"], "assignments": [{"employee_id": sachin["id"], "role": "Owner", "share": 100}]}
    r = client.post("/api/tasks", json=self_review, headers=h)
    assert r.status_code == 422 and r.json()["detail"]["field"] == "reviewer_id"
    ok = {**base, "assignments": [{"employee_id": sachin["id"], "role": "Owner", "share": 60}, {"employee_id": maninder["id"], "role": "Contributor", "share": 40}]}
    r = client.post("/api/tasks", json=ok, headers=h)
    assert r.status_code == 200 and r.json()["status"] == "Not Started"


def test_review_accept_uses_submission_date(client, auth):
    h = auth("manager")
    tasks = client.get("/api/tasks?view=review", headers=h).json()
    t = next(x for x in tasks if x["code"] == "PRJ-D01-T04")
    r = client.post(f"/api/tasks/{t['id']}/review", json={"decision": "rework"}, headers=h)
    assert r.status_code == 422  # rework needs reason, criteria and feedback
    r = client.post(f"/api/tasks/{t['id']}/review", json={"decision": "accept"}, headers=h)
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "Completed"
    assert body["accepted_submission_date"] == "2026-10-08"  # v3 submission date, not today


def test_status_cannot_jump_to_completed(client, auth):
    h = auth("manager")
    tasks = client.get("/api/tasks?view=team", headers=h).json()
    t = next(x for x in tasks if x["code"] == "PRJ-D01-T06")
    r = client.patch(f"/api/tasks/{t['id']}", json={"version": t["version"], "status": "Completed"}, headers=h)
    assert r.status_code == 422
    r = client.post("/api/tasks/weekly-update", json={"rows": [{"id": t["id"], "version": t["version"], "progress": 30}, {"id": t["id"], "version": 999, "progress": 50}]}, headers=h)
    results = r.json()["results"]
    assert results[0]["result"] == "saved" and results[1]["result"] == "conflict"


def test_send_for_review_rejects_future_date(client, auth):
    h = auth("manager")
    tasks = client.get("/api/tasks?view=team", headers=h).json()
    t = next(x for x in tasks if x["code"] == "PRJ-D01-T06")
    future = (date.today() + timedelta(days=3)).isoformat()
    r = client.post(f"/api/tasks/{t['id']}/submit", json={"submission_date": future, "checklist_confirmed": True}, headers=h)
    assert r.status_code == 422 and r.json()["detail"]["field"] == "submission_date"


def test_blocker_self_validation_blocked(client, auth):
    h = auth("manager")
    me = client.get("/api/auth/me", headers=h).json()
    tasks = client.get("/api/tasks?view=team", headers=h).json()
    t = next(x for x in tasks if x["code"] == "PRJ-D01-T06")
    body = {"category": "Approval pending", "description": "x", "blocked_since": "2026-10-10", "evidence": "y", "validator_id": me["employee"]["id"]}
    r = client.post(f"/api/tasks/{t['id']}/blockers", json=body, headers=h)
    assert r.status_code == 422


def test_training_numbers_and_team_aggregate(client, auth):
    h = auth("manager")
    rep = client.get("/api/reports/training", headers=h).json()
    by = {r["employee"]["code"]: r for r in rep["rows"]}
    s = by["EMP-0082"]
    assert (s["allotted"], s["future_due"], s["eligible"], s["verified"], s["score"]) == (12, 2, 10, 8, 80)
    assert round(rep["team"]["score"], 2) == 78.57


def test_training_verifier_must_differ_and_verify_flow(client, auth):
    mgr, admin = auth("manager"), auth("admin")
    sachin = _emp(client, mgr, "EMP-0082")
    data = client.get(f"/api/people/{sachin['id']}/training", headers=mgr).json()
    trn8 = next(a for a in data["assignments"] if a["course"]["code"] == "TRN-008")
    assert client.post(f"/api/training/assignments/{trn8['id']}/verify", json={"decision": "verify"}, headers=mgr).status_code == 403
    r = client.post(f"/api/training/assignments/{trn8['id']}/verify", json={"decision": "verify", "reason": "Criteria met"}, headers=admin)
    assert r.status_code == 200 and r.json()["status"] == "Verified complete"


def test_period_lock_blocked_by_draft_training_policy_then_allowed(client, auth):
    admin, hod = auth("admin"), auth("hod_ops")
    periods = client.get("/api/periods", headers=admin).json()
    q3 = next(p for p in periods if p["name"] == "Jul-Sep 2026")
    r = client.post(f"/api/periods/{q3['id']}/lock", json={"reason": "Reviewed", "confirm": True}, headers=admin)
    assert r.status_code == 422 and r.json()["detail"]["code"] == "lock_blocked"
    # Rewards cannot open nominations before the lock.
    cycles = client.get("/api/reward-cycles", headers=hod).json()["cycles"]
    assert client.post(f"/api/reward-cycles/{cycles[0]['id']}/advance", headers=auth("hod")).status_code == 422
    rules = client.get("/api/rules", headers=admin).json()["rules"]
    tr = next(x for x in rules if x["kind"] == "training")
    assert client.post(f"/api/rules/{tr['id']}/decide", json={"decision": "approve"}, headers=admin).status_code == 422  # author cannot approve
    assert client.post(f"/api/rules/{tr['id']}/decide", json={"decision": "approve", "reason": "Reviewed impact"}, headers=hod).status_code == 200
    r = client.post(f"/api/periods/{q3['id']}/lock", json={"reason": "Reviewed", "confirm": True}, headers=admin)
    assert r.status_code == 200 and r.json()["snapshots"] > 300


def test_nomination_independence(client, auth):
    mgr, hod = auth("manager"), auth("hod")
    cycles = client.get("/api/reward-cycles", headers=mgr).json()["cycles"]
    c = cycles[0]
    assert client.post(f"/api/reward-cycles/{c['id']}/advance", headers=hod).status_code == 200
    sachin = _emp(client, mgr, "EMP-0082")
    n = client.post("/api/nominations", json={"cycle_id": c["id"], "employee_id": sachin["id"], "award_type": "Collaboration award", "citation": "too short", "evidence": "Accepted onboarding review"}, headers=mgr).json()
    me = client.get("/api/auth/me", headers=mgr).json()
    hod_me = client.get("/api/auth/me", headers=hod).json()
    assert client.post(f"/api/nominations/{n['id']}/submit", json={"reviewer_account_id": hod_me["id"]}, headers=mgr).status_code == 422  # < 50 words
    citation = " ".join(["Reviewed the mobile screens and shared clear notes with the team."] * 6)
    client.patch(f"/api/nominations/{n['id']}", json={"cycle_id": c["id"], "employee_id": sachin["id"], "award_type": "Collaboration award", "citation": citation, "evidence": "Accepted onboarding review"}, headers=mgr)
    assert client.post(f"/api/nominations/{n['id']}/submit", json={"reviewer_account_id": me["id"]}, headers=mgr).status_code == 422  # self-review
    assert client.post(f"/api/nominations/{n['id']}/submit", json={"reviewer_account_id": hod_me["id"]}, headers=mgr).status_code == 200
    assert client.post(f"/api/nominations/{n['id']}/decide", json={"decision": "approve"}, headers=hod).status_code == 200


def test_audit_is_append_only(client, auth):
    from app.core.database import SessionLocal
    from app.models import AuditEvent

    with SessionLocal() as db:
        ev = db.query(AuditEvent).first()
        ev.reason = "tamper"
        try:
            db.commit()
            raised = False
        except PermissionError:
            raised = True
            db.rollback()
    assert raised


def test_csv_export_keeps_scope_header(client, auth):
    r = client.get("/api/reports/training/export.csv", headers=auth("manager"))
    assert r.status_code == 200
    assert "# Scope" in r.text and "TEAM" in r.text


def test_demo_access_code_gate(client, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "demo_access_code", "letmein")
    assert client.get("/api/auth/config").json()["access_code_required"] is True
    assert client.get("/api/auth/dev-accounts").status_code == 401
    assert client.get("/api/auth/dev-accounts", headers={"X-Access-Code": "letmein"}).status_code == 200
    email = "pradeep.thakur@finvasia.example"
    assert client.post("/api/auth/login", json={"email": email}).status_code == 401
    assert client.post("/api/auth/login", json={"email": email, "access_code": "wrong"}).status_code == 401
    assert client.post("/api/auth/login", json={"email": email, "access_code": "letmein"}).status_code == 200


def test_database_url_normalised_for_render():
    from app.core.config import normalise_db_url

    assert normalise_db_url("postgres://u:p@h:5432/d") == "postgresql+psycopg://u:p@h:5432/d"
    assert normalise_db_url("postgresql://u@h/d") == "postgresql+psycopg://u@h/d"
    assert normalise_db_url("sqlite:///x.db") == "sqlite:///x.db"
