"""Project Tier from the prototype: tracker statuses, task dates, and Project R&R through the API (scope, independence, freeze)."""

from app.core.database import SessionLocal, engine
from app.models import Project, Task


def _pid(code: str) -> int:
    with SessionLocal() as db:
        return db.query(Project).filter(Project.code == code).one().id


def _task(code: str) -> Task:
    with SessionLocal() as db:
        t = db.query(Task).filter(Task.code == code).one()
        db.expunge(t)
        return t


# --- delivery ---------------------------------------------------------------------------------------------------------


def test_tracker_statuses_and_completed_only_through_accept(client, auth):
    h = auth("manager")
    t = _task("PRJ-D01-T06")
    r = client.patch(f"/api/tasks/{t.id}", json={"version": t.version, "status": "Testing QA"}, headers=h)
    assert r.status_code == 200 and r.json()["status"] == "Testing QA", r.text
    r = client.patch(f"/api/tasks/{t.id}", json={"version": r.json()["version"], "status": "Completed"}, headers=h)
    assert r.status_code == 422 and r.json()["detail"]["field"] == "status"


def test_go_live_and_start_dates_validated_and_team_lead_cannot_edit_them(client, auth):
    t = _task("PRJ-D01-T06")
    r = client.patch(f"/api/tasks/{t.id}", json={"version": t.version, "go_live_date": "2026-10-01"}, headers=auth("manager"))
    assert r.status_code == 422 and r.json()["detail"]["field"] == "go_live_date"
    r = client.patch(f"/api/tasks/{t.id}", json={"version": t.version, "go_live_date": "2026-10-20"}, headers=auth("manager"))
    assert r.status_code == 200 and r.json()["go_live_date"] == "2026-10-20" and r.json()["due_date"] == "2026-10-16"
    tl = auth("team_lead")
    cs = client.get("/api/tasks?view=team", headers=tl).json()
    if cs:
        r = client.patch(f"/api/tasks/{cs[0]['id']}", json={"version": cs[0]["version"], "start_date": "2026-10-01"}, headers=tl)
        assert r.status_code == 403


def test_task_brief_has_working_days_and_delay(client, auth):
    rows = client.get(f"/api/projects/{_pid('PRJ-D11')}/tasks", headers=auth("admin")).json()
    api = next(t for t in rows if t["title"] == "API integration")
    assert api["working_days"] is not None and api["delay_days"] == 7  # accepted 21 Aug against 14 Aug
    assert all("go_live_date" in t for t in rows)


def test_blocker_sets_block_and_old_blocked_rows_are_renamed(client, auth):
    h = auth("manager")
    me = client.get("/api/auth/me", headers=h).json()["employee"]["id"]
    done = _task("PRJ-D01-T02")
    validator = client.get("/api/people/lookup?q=EMP-0219", headers=h).json()[0]["id"]
    body = {"category": "Internal dependency", "description": "Waiting on copy", "blocked_since": "2026-10-20", "evidence": "Email", "validator_id": validator}
    assert client.post(f"/api/tasks/{done.id}/blockers", json=body, headers=h).status_code == 422  # accepted work
    t = _task("PRJ-D01-T06")
    r = client.post(f"/api/tasks/{t.id}/blockers", json=body, headers=h)
    assert r.status_code == 200 and r.json()["status"] == "Block", r.text
    assert me != validator
    from sqlalchemy import text

    from app.core.schema_patch import rename_blocked_tasks

    with engine.begin() as conn:
        conn.execute(text("UPDATE tasks SET status = 'Blocked' WHERE code = 'PRJ-D01-T03'"))
    assert rename_blocked_tasks(engine) == 1 and _task("PRJ-D01-T03").status == "Block"


def test_closure_has_no_milestone_stage(client, auth):
    c = client.get(f"/api/projects/{_pid('PRJ-D01')}/closure", headers=auth("manager")).json()
    assert [s["stage"] for s in c["stages"]] == ["tasks", "deliverables", "objectives", "issues", "lessons", "remarks"]


# --- Project R&R -------------------------------------------------------------------------------------------------------


def test_worked_example_scores_88_gold_and_money_is_admin_or_panel_only(client, auth):
    d11 = _pid("PRJ-D11")
    s = client.get(f"/api/projects/{d11}/rr", headers=auth("admin")).json()["scorecard"]
    assert s["score"] == 88 and s["band"] == "Gold" and round(s["paid"]) == 240_000 and s["money_visible"]
    assert s["stage"] == "Panel approved"
    m = client.get(f"/api/projects/{d11}/rr", headers=auth("manager")).json()["scorecard"]
    assert m["score"] == 88 and "paid" not in m and "pool" not in m and not m["money_visible"]
    rows = {p["person"]["code"] if p["person"] else p["label"]: p for p in m["people"]}
    assert rows["EMP-0082"]["visible"] and rows["EMP-0082"]["individual"] == 92 and "payout" not in rows["EMP-0082"]
    assert not rows["EMP-0081"]["visible"] and "individual" not in rows["EMP-0081"]  # the manager's own row is private
    assert not rows["EMP-0219"]["visible"]
    assert client.get(f"/api/projects/{d11}/rr", headers=auth("team_lead")).status_code == 403


def test_recognition_lists_scheme_projects_with_money_redacted(client, auth):
    a = client.get("/api/recognition", headers=auth("admin")).json()
    codes = {r["project"]["code"]: r for r in a["rows"]}
    assert {"PRJ-D01", "PRJ-D11", "PRJ-D12"} <= set(codes)
    assert codes["PRJ-D11"]["score"] == 88 and codes["PRJ-D11"]["pool"] == 270_000 and a["pool_total"] >= 270_000
    assert codes["PRJ-D12"]["score"] is None and codes["PRJ-D12"]["gates"] == "No locked baseline"
    m = client.get("/api/recognition", headers=auth("manager")).json()
    assert m["pool_total"] is None and all(r["pool"] is None for r in m["rows"])


def test_one_late_task_one_delay_excused_needs_evidence_and_independent_validation(client, auth):
    d01 = _pid("PRJ-D01")
    h = auth("manager")
    bundle = client.get(f"/api/projects/{d01}/rr", headers=h).json()
    late = bundle["late_tasks"]
    assert late, "the demo website project has tasks past their baseline due date"
    tid = late[0]["id"]
    r = client.post(f"/api/projects/{d01}/rr/delays", json={"task_id": tid, "reason_code": "E2", "explanation": "Vendor late"}, headers=h)
    assert r.status_code == 422 and r.json()["detail"]["field"] == "evidence"
    r = client.post(f"/api/projects/{d01}/rr/delays", json={"task_id": tid, "reason_code": "X", "explanation": "Design system migration"}, headers=h)
    assert r.status_code == 422 and r.json()["detail"]["field"] == "custom_reason"
    r = client.post(f"/api/projects/{d01}/rr/delays", json={"task_id": tid, "reason_code": "C1", "explanation": "Estimate too optimistic", "flagged_on": "2026-09-01"}, headers=h)
    assert r.status_code == 200, r.text
    d = next(x for x in r.json()["delays"] if x["task_id"] == tid)
    assert d["reason_label"] == "Planning / estimation" and d["points"] == 2 and tid not in [t["id"] for t in r.json()["late_tasks"]]
    r = client.post(f"/api/projects/{d01}/rr/delays", json={"task_id": tid, "reason_code": "C2", "explanation": "Again"}, headers=h)
    assert r.status_code == 422 and r.json()["detail"]["field"] == "task_id"
    assert client.post(f"/api/rr/delays/{d['id']}/decide", json={"decision": "validate"}, headers=h).status_code == 403  # no PMO function
    r = client.post(f"/api/rr/delays/{d['id']}/decide", json={"decision": "validate"}, headers=auth("admin"))
    assert r.status_code == 200 and next(x for x in r.json()["delays"] if x["id"] == d["id"])["state"] == "Validated"


def test_inputs_need_the_function_and_an_independent_validator(client, auth):
    d01 = _pid("PRJ-D01")
    r = client.post(f"/api/projects/{d01}/rr/inputs", json={"kind": "rework", "value": {"pct": 9}}, headers=auth("manager"))
    assert r.status_code == 200, r.text
    iid = r.json()["id"]
    assert client.post(f"/api/rr/inputs/{iid}/decide", json={"decision": "validate"}, headers=auth("manager")).status_code == 403  # no function
    r = client.post(f"/api/rr/inputs/{iid}/decide", json={"decision": "validate"}, headers=auth("hod"))  # Kapil: Quality assessor
    assert r.status_code == 200 and r.json()["state"] == "Validated"
    r = client.post(f"/api/projects/{d01}/rr/inputs", json={"kind": "innovation", "value": {"points": 3}}, headers=auth("manager"))
    assert r.status_code == 403


def test_programme_charter_cannot_lock_with_open_raci_conflicts_and_requests_become_runs(client, auth):
    d12 = _pid("PRJ-D12")
    b = client.get(f"/api/projects/{d12}/rr", headers=auth("admin")).json()
    assert b["charter"]["mode"] == "programme" and len(b["runs"]) == 3
    gaps = [i for i in b["lock_checklist"] if not i["ok"]]
    assert any("Champion" in i["label"] for i in gaps) and any("reviewer" in i["label"] for i in gaps)
    nav = next(r for r in b["programme_raci"]["rows"] if r["person"] and r["person"]["code"] == "EMP-0118")
    assert nav["letter"] == "R" and round(nav["share"], 3) == 0.457 and "C" in nav["dropped"] and "I" in nav["dropped"]
    rows = {r["label"]: r for r in b["programme_raci"]["rows"] if r["label"]}
    assert rows["Head of requesting department"]["letter"] == "C"  # outside approver, not a workstream lead
    assert rows["Marketing POC: Mukesh Thakur"]["letter"] == "A" and "Marketing POC" not in rows and "Email execution: Naveen Kumar" not in rows
    r = client.post(f"/api/projects/{d12}/rr/charter/submit", json={}, headers=auth("admin"))
    assert r.status_code == 422 and r.json()["detail"]["field"] == "checklist"
    reqs = client.get("/api/requests", headers=auth("hod")).json()
    pending = next(x for x in reqs if x["title"] == "Client Support renewal reminder")
    assert client.post(f"/api/requests/{pending['id']}/decide", json={"decision": "validate", "reason": "OK"}, headers=auth("hod")).status_code == 200
    r = client.post(f"/api/requests/{pending['id']}/decide", json={"decision": "accept", "reason": "Scheduled"}, headers=auth("admin"))
    assert r.status_code == 200 and r.json()["project_id"] == d12
    b = client.get(f"/api/projects/{d12}/rr", headers=auth("admin")).json()
    assert len(b["runs"]) == 4 and len(b["runs"][-1]["stages"]) == 6


def test_publish_needs_a_panel_member_outside_the_raci_and_freezes(client, auth):
    d11 = _pid("PRJ-D11")
    assert client.post(f"/api/projects/{d11}/rr/scorecard/publish", json={}, headers=auth("hod")).status_code == 422  # Kapil is C here
    r = client.post(f"/api/projects/{d11}/rr/scorecard/publish", json={}, headers=auth("admin"))
    assert r.status_code == 200, r.text
    s = r.json()["scorecard"]
    assert s["frozen"] and s["stage"] == "Published" and s["score"] == 88
    raci = r.json()["raci"]
    sachin = next(x for x in raci if x["person"] and x["person"]["code"] == "EMP-0082")
    r = client.patch(f"/api/projects/{d11}/rr/raci/{sachin['id']}/adjustment", json={"adjustment": 9, "reason": "Late change"}, headers=auth("admin"))
    assert r.status_code == 422
    s = client.get(f"/api/projects/{d11}/rr", headers=auth("admin")).json()["scorecard"]
    assert s["score"] == 88 and round(s["paid"]) == 240_000


def test_functions_are_admin_only_and_audited(client, auth):
    accounts = client.get("/api/admin/accounts", headers=auth("admin")).json()["accounts"]
    sahil = next(a for a in accounts if a["employee"]["code"] == "EMP-0221")
    assert client.put(f"/api/admin/accounts/{sahil['id']}/functions", json={"functions": ["Finance confirmer"]}, headers=auth("manager")).status_code == 403
    assert client.put(f"/api/admin/accounts/{sahil['id']}/functions", json={"functions": ["Owner"]}, headers=auth("admin")).status_code == 422
    r = client.put(f"/api/admin/accounts/{sahil['id']}/functions", json={"functions": ["Finance confirmer"], "reason": "Finance cover"}, headers=auth("admin"))
    assert r.status_code == 200 and r.json()["functions"] == ["Finance confirmer"]
    audit = client.get("/api/admin/audit", headers=auth("admin")).json()
    rows = audit if isinstance(audit, list) else audit.get("events", audit.get("rows", []))
    assert any(e.get("action") == "change_functions" for e in rows)


def test_policy_needs_a_second_admin(client, auth):
    p = client.get("/api/rr/policy", headers=auth("platform_admin")).json()
    assert p["state"] == "Proposed" and not p["can_approve"] and len(p["reasons"]) == 8
    assert client.post("/api/rr/policy/approve", json={}, headers=auth("platform_admin")).status_code == 422
    r = client.post("/api/rr/policy/approve", json={"reason": "Second Admin"}, headers=auth("admin"))
    assert r.status_code == 200 and r.json()["state"] == "Approved"
