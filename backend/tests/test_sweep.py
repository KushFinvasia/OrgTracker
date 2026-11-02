"""Regressions from the all-roles sweep (2 Nov 2026): scope, independence, redaction, final records and error handling."""

from datetime import date

from app.core.database import SessionLocal
from app.models import Account, Employee, Incident, KpiMonth, Project, ProjectCharter, ProjectRaci, Task, TrainingModule
from app.services.individual import redact_card


def _project_id(code: str) -> int:
    with SessionLocal() as db:
        return db.query(Project).filter_by(code=code).one().id


def _emp(name: str) -> int:
    with SessionLocal() as db:
        return db.query(Employee).filter(Employee.full_name.like(f"{name}%")).first().id


def _account_emp(email: str) -> int:
    with SessionLocal() as db:
        return db.query(Account).filter_by(email=email).one().employee_id


def _vacant() -> int:
    with SessionLocal() as db:
        return db.query(Employee).filter(Employee.record_type != "employee").first().id


def _project(client, auth, title="Sweep project", **kw) -> dict:
    body = {"title": title, "priority": "Low", "owner_id": _emp("Pradeep Thakur"), "department_id": _dept("Product"), "start_date": "2026-10-01", **kw}
    r = client.post("/api/projects", json=body, headers=auth("manager"))
    assert r.status_code == 200, r.text
    return r.json()


def _dept(name: str) -> int:
    from app.models import Department

    with SessionLocal() as db:
        return db.query(Department).filter_by(name=name).one().id


def _task(client, auth, project_id: int, **kw) -> dict:
    body = {"project_id": project_id, "title": "Sweep task", "description": "d", "complexity": 2, "reviewer_id": _emp("Kapil Abrol"),
            "assignments": [{"employee_id": _emp("Sachin Barnwal"), "role": "Owner", "share": 100}], **kw}
    r = client.post("/api/tasks", json=body, headers=auth("manager"))
    assert r.status_code == 200, r.text
    return r.json()


def _set(model, id_, **values) -> None:
    with SessionLocal() as db:
        row = db.get(model, id_)
        for k, v in values.items():
            setattr(row, k, v)
        db.commit()


# --- Individual Tier -----------------------------------------------------------------------------


def test_month_decisions_belong_to_the_sales_head_not_any_hod(client, auth):
    with SessionLocal() as db:
        month = db.query(KpiMonth).filter_by(state="Open").first().id
        closed = db.query(KpiMonth).filter_by(state="Locked").first().id
    h = auth("hod")
    assert client.get(f"/api/individual/months/{month}/lock-check", headers=h).status_code == 403
    assert client.post(f"/api/individual/months/{month}/lock", json={"note": "not mine", "exclude_reason": "not mine"}, headers=h).status_code == 403
    assert client.post(f"/api/individual/months/{closed}/publish", json={"note": "not mine"}, headers=h).status_code == 403
    assert client.post("/api/individual/months", json={"month": "2029-01-01"}, headers=h).status_code == 403
    assert client.get(f"/api/individual/keka-export.csv?month_id={closed}", headers=h).status_code == 403
    assert client.get(f"/api/individual/months/{month}/lock-check", headers=auth("sales_hod")).status_code == 200


def test_a_corrected_card_keeps_the_method_from_non_admins():
    old = {"final": 80, "tier": "Silver", "status": "scored", "base": 82, "coverage": 90, "twcs": 70}
    card = {"scorecard": {"rows": [], "final": 81, "tier": "Silver", "status": "scored"}, "corrected_from": old, "correction_history": [{"at": "x", "reason": "r", "old": old, "new": old}]}
    out = redact_card(card)
    assert "base" not in out["corrected_from"] and "coverage" not in out["correction_history"][0]["old"] and out["corrected_from"]["final"] == 80


def test_exemptions_are_not_decided_in_a_closed_month(client, auth):
    with SessionLocal() as db:
        month = db.query(KpiMonth).filter_by(state="Locked").first()
        emp = db.query(Employee).filter_by(code="EMP-0291").one()
        m = TrainingModule(employee_id=emp.id, title="Closed month module", track="Compliance", assigned_date=month.month, due_date=month.month, status="Exemption requested", exemption_requested_by=db.query(Account).filter_by(email="rajesh.kumar@shoonya.com").one().id)
        db.add(m)
        db.commit()
        mid = m.id
    r = client.post(f"/api/individual/training/{mid}/exemption-decision", json={"decision": "approve"}, headers=auth("sales_hod"))
    assert r.status_code == 422


def test_a_malformed_scoring_rule_is_refused(client, auth):
    cfg = client.get("/api/individual/rules", headers=auth("admin")).json()["rules"][-1]["config"]
    for bad in ({**cfg, "twcs": {}}, {**cfg, "penalties": None}, {**cfg, "tiers": "x"}, {**cfg, "weights": {"Core Revenue": {"quality": "abc"}}}):
        r = client.post("/api/individual/rules", json={"label": "Bad", "effective_month": "2029-01-01", "config": bad}, headers=auth("admin"))
        assert r.status_code == 422, r.text


# --- tasks ---------------------------------------------------------------------------------------


def test_a_stale_save_is_a_conflict_with_the_current_record(client, auth):
    t = _task(client, auth, _project(client, auth)["id"], due_date="2026-12-01")
    h = auth("manager")
    assert client.patch(f"/api/tasks/{t['id']}", json={"version": t["version"], "progress": 10}, headers=h).status_code == 200
    r = client.patch(f"/api/tasks/{t['id']}", json={"version": t["version"], "progress": 20}, headers=h)
    assert r.status_code == 409 and r.json()["detail"]["current"]["due_date"] == "2026-12-01"


def test_a_named_validator_from_another_team_can_reach_and_decide(client, auth):
    t = _task(client, auth, _project(client, auth)["id"], due_date="2026-12-01")
    outsider = auth("hod_ops")
    assert client.get(f"/api/tasks/{t['id']}", headers=outsider).status_code == 403
    r = client.post(f"/api/tasks/{t['id']}/deadline-changes", json={"requested_date": "2026-12-10", "reason_category": "Requirement change", "comment": "Moved", "validator_id": _account_emp("pawan.kumar@finvasia.example")}, headers=auth("manager"))
    assert r.status_code == 200
    assert client.get(f"/api/tasks/{t['id']}", headers=outsider).status_code == 200
    change = next(v for v in client.get("/api/validations", headers=outsider).json() if v["task"]["id"] == t["id"])
    assert client.post(f"/api/deadline-changes/{change['id']}/decide", json={"decision": "validate", "reason": "OK"}, headers=outsider).status_code == 200


def test_migrated_in_review_work_can_be_sent_but_not_accepted_empty(client, auth):
    t = _task(client, auth, _project(client, auth)["id"])
    _set(Task, t["id"], status="In Review")
    assert client.post(f"/api/tasks/{t['id']}/review", json={"decision": "accept"}, headers=auth("hod")).status_code == 422
    r = client.post(f"/api/tasks/{t['id']}/submit", json={"submission_date": "2026-10-20", "checklist_confirmed": True}, headers=auth("manager"))
    assert r.status_code == 200, r.text
    assert client.post(f"/api/tasks/{t['id']}/review", json={"decision": "accept"}, headers=auth("hod")).status_code == 200
    v = client.get(f"/api/tasks/{t['id']}", headers=auth("manager")).json()["version"]
    h = auth("manager")
    assert client.patch(f"/api/tasks/{t['id']}", json={"version": v, "progress": 5}, headers=h).status_code == 422
    assert client.patch(f"/api/tasks/{t['id']}", json={"version": v, "complexity": 5}, headers=h).status_code == 422
    row = client.post("/api/tasks/weekly-update", json={"rows": [{"id": t["id"], "version": v, "progress": 5}]}, headers=h).json()["results"][0]
    assert row["result"] == "error"


def test_people_on_a_task_are_named_employees(client, auth):
    pid = _project(client, auth)["id"]
    h = auth("manager")
    base = {"project_id": pid, "title": "Bad task", "description": "d", "complexity": 2, "reviewer_id": _emp("Kapil Abrol"), "assignments": [{"employee_id": _emp("Sachin Barnwal"), "role": "Owner", "share": 100}]}
    assert client.post("/api/tasks", json={**base, "reviewer_id": _vacant()}, headers=h).status_code == 422
    assert client.post("/api/tasks", json={**base, "reviewer_id": 999999}, headers=h).status_code == 422
    assert client.post("/api/tasks", json={**base, "depends_on": [999999]}, headers=h).status_code == 422
    assert client.post("/api/tasks", json={**base, "assignments": [{"employee_id": _emp("Sachin Barnwal"), "role": "Boss", "share": 50}, {"employee_id": _emp("Harsh"), "role": "Owner", "share": 50}]}, headers=h).status_code == 422
    t = _task(client, auth, pid, start_date="2026-11-02", due_date="2026-11-20")
    assert client.put(f"/api/tasks/{t['id']}/assignments", json={"version": t["version"], "reviewer_id": _emp("Kapil Abrol"), "reason": "Swap", "assignments": [{"employee_id": _vacant(), "role": "Owner", "share": 100}]}, headers=h).status_code == 422
    assert client.patch(f"/api/tasks/{t['id']}", json={"version": t["version"], "title": None}, headers=h).status_code == 422
    r = client.post(f"/api/tasks/{t['id']}/deadline-changes", json={"requested_date": "2026-10-01", "reason_category": "Requirement change", "comment": "Too early", "validator_id": _emp("Kapil Abrol")}, headers=h)
    assert r.status_code == 422


# --- projects, closure, incidents ----------------------------------------------------------------


def test_project_edits_keep_the_rules_create_has(client, auth):
    p = _project(client, auth, target_date="2026-12-01")
    h = auth("manager")
    assert client.patch(f"/api/projects/{p['id']}", json={"version": p["version"], "target_date": "2020-01-01"}, headers=h).status_code == 422
    assert client.patch(f"/api/projects/{p['id']}", json={"version": p["version"], "title": None}, headers=h).status_code == 422
    assert client.patch(f"/api/projects/{p['id']}", json={"version": p["version"], "owner_id": _vacant()}, headers=h).status_code == 422
    legacy = client.get(f"/api/projects/{_project_id('PRJ-042')}", headers=auth("hod")).json()
    assert legacy["priority"] is None
    assert client.patch(f"/api/projects/{legacy['id']}", json={"version": legacy["version"], "objective": "Edited"}, headers=auth("hod")).status_code == 422


def test_a_closed_project_stays_closed(client, auth):
    p = _project(client, auth, reviewer_id=_emp("Kapil Abrol"))
    h = auth("manager")
    for s in client.get(f"/api/projects/{p['id']}/closure", headers=h).json()["stages"]:
        assert client.put(f"/api/projects/{p['id']}/closure/stage", json={"stage": s["stage"], "done": True}, headers=h).status_code == 200
    assert client.post(f"/api/projects/{p['id']}/closure/submit", headers=h).status_code == 200
    assert client.post(f"/api/projects/{p['id']}/closure/submit", headers=h).status_code == 422
    assert client.put(f"/api/projects/{p['id']}/closure/stage", json={"stage": "lessons", "done": False}, headers=h).status_code == 422
    assert client.post(f"/api/projects/{p['id']}/closure/decide", json={"decision": "approve", "reason": "OK"}, headers=auth("hod")).status_code == 200
    v = client.get(f"/api/projects/{p['id']}", headers=h).json()["version"]
    assert client.patch(f"/api/projects/{p['id']}", json={"version": v, "status": "In Progress"}, headers=h).status_code == 422
    assert client.post(f"/api/projects/{p['id']}/closure/submit", headers=h).status_code == 422


def test_rca_records_need_manage_rights_and_closed_findings_stay(client, auth):
    with SessionLocal() as db:
        inc = db.query(Incident).first()
        iid, pid = inc.id, inc.project_id
        aaina = db.query(Employee).filter(Employee.full_name.like("Aaina Ghill%")).first().id
        db.add(ProjectRaci(project_id=pid, employee_id=aaina, letter="I"))  # gives the Team Lead sight of the project
        db.commit()
    tl = auth("team_lead")
    assert client.get(f"/api/incidents/{iid}", headers=tl).status_code == 200
    assert client.patch(f"/api/incidents/{iid}", json={"root_cause": "TL"}, headers=tl).status_code == 403
    assert client.post(f"/api/incidents/{iid}/close", json={"actual_closure": "2026-10-01", "verification_note": "x"}, headers=tl).status_code == 403
    _set(Incident, iid, state="Closed")
    h = auth("hod")
    assert client.patch(f"/api/incidents/{iid}", json={"state": "Open"}, headers=h).status_code == 422
    assert client.patch(f"/api/incidents/{iid}", json={"root_cause": "Rewritten"}, headers=h).status_code == 422
    assert client.post(f"/api/incidents/{iid}/close", json={"actual_closure": "2026-10-01", "verification_note": "again"}, headers=h).status_code == 422
    _set(Incident, iid, state="Under analysis")


# --- Project R&R ---------------------------------------------------------------------------------


def test_one_person_cannot_lock_a_charter_alone(client, auth):
    d12 = _project_id("PRJ-D12")
    with SessionLocal() as db:
        c = db.query(ProjectCharter).filter_by(project_id=d12).one()
        cid, submitter = c.id, db.query(Account).filter_by(email="deepjyot.tiwari@shoonya.com").one().id
    _set(ProjectCharter, cid, state="Submitted", submitted_by=submitter, sponsor_ok_by=None, pmo_ok_by=None)
    a = auth("admin")
    assert client.post(f"/api/projects/{d12}/rr/charter/pmo", json={}, headers=a).status_code == 200
    assert client.post(f"/api/projects/{d12}/rr/charter/sponsor", json={}, headers=a).status_code == 422
    assert client.post(f"/api/projects/{d12}/rr/charter/sponsor", json={}, headers=auth("platform_admin")).status_code == 422  # the submitter
    assert client.put(f"/api/projects/{d12}/rr/slas", json=[{"name": "Changed late", "kind": "Client", "tat": "1d"}], headers=a).status_code == 422
    _set(ProjectCharter, cid, state="Draft", submitted_by=None, sponsor_ok_by=None, pmo_ok_by=None)


def test_rr_bundle_redacts_money_and_adjustments(client, auth):
    d11 = _project_id("PRJ-D11")
    r = client.get(f"/api/projects/{d11}/rr", headers=auth("manager"))
    b = r.json()
    assert b["charter"]["pool_rate"] is None
    assert all(i["value"] == {} for i in b["inputs"] if i["kind"] == "value_actual")
    assert "₹1" not in r.text.replace("Revenue (₹)", "")
    money = client.get(f"/api/projects/{d11}/rr", headers=auth("admin")).json()
    assert money["charter"]["pool_rate"] is not None


def test_delays_are_for_late_tasks_while_scoring_is_open(client, auth):
    d01, d11 = _project_id("PRJ-D01"), _project_id("PRJ-D11")
    b = client.get(f"/api/projects/{d01}/rr", headers=auth("manager")).json()
    h = auth("manager")
    done = next(t for t in client.get(f"/api/projects/{d01}/tasks", headers=h).json() if t["status"] == "Completed" and t["delay_days"] == 0)
    assert client.post(f"/api/projects/{d01}/rr/delays", json={"task_id": done["id"], "reason_code": "C1", "explanation": "Not late"}, headers=h).status_code == 422
    if b["late_tasks"]:
        r = client.post(f"/api/projects/{d01}/rr/delays", json={"task_id": b["late_tasks"][0]["id"], "reason_code": "C1", "explanation": "Bad date", "flagged_on": "nonsense"}, headers=h)
        assert r.status_code == 422
    assert client.post(f"/api/projects/{d01}/rr/baseline-changes", json={"task_id": done["id"], "requested_date": "nonsense", "reason": "Bad date"}, headers=h).status_code == 422
    assert client.post(f"/api/projects/{d11}/rr/inputs", json={"kind": "rework", "value": {"pct": 90}}, headers=auth("admin")).status_code == 422  # published
    assert client.post(f"/api/projects/{d01}/rr/inputs", json={"kind": "sla", "value": {"within": 50, "total": 10}}, headers=h).status_code == 422
    assert client.post(f"/api/projects/{d01}/rr/inputs", json={"kind": "satisfaction", "value": {"avg": 9, "n": 3}}, headers=h).status_code == 422


def test_function_holders_reach_the_scheme_but_never_scores(client, auth):
    d11 = _project_id("PRJ-D11")
    amit = auth("sales_amit")
    assert client.get(f"/api/projects/{d11}", headers=amit).status_code == 403
    with SessionLocal() as db:
        acc = db.query(Account).filter_by(email="amit.kumar@shoonya.com").one()
        aid = acc.id
    _set(Account, aid, functions=["Finance confirmer"])
    b = client.get(f"/api/projects/{d11}/rr", headers=amit)
    assert b.status_code == 200 and all(not p.get("individual") for p in b.json()["scorecard"]["people"])
    _set(Account, aid, functions=[])


def test_calibrators_in_the_raci_cannot_adjust(client, auth):
    d01 = _project_id("PRJ-D01")
    with SessionLocal() as db:
        acc = db.query(Account).filter_by(email="kapil.abrol@finvasia.example").one()
        aid, fns = acc.id, list(acc.functions or [])
    _set(Account, aid, functions=[*fns, "HR calibrator"])
    raci = next(r for r in client.get(f"/api/projects/{d01}/rr", headers=auth("admin")).json()["raci"] if r["letter"] == "R")
    r = client.patch(f"/api/projects/{d01}/rr/raci/{raci['id']}/adjustment", json={"adjustment": 5, "reason": "Insider"}, headers=auth("hod"))
    _set(Account, aid, functions=fns)
    assert r.status_code == 422


# --- admin ---------------------------------------------------------------------------------------


def test_admin_writes_refuse_records_that_do_not_exist(client, auth):
    a = auth("admin")
    with SessionLocal() as db:
        acc = db.query(Account).first().id
        boss = db.query(Employee).filter(Employee.manager_id.is_not(None), Employee.id.in_(db.query(Employee.manager_id))).first()
        kid = db.query(Employee).filter_by(manager_id=boss.id).first().id
        bid = boss.id
    grant = {"account_id": acc, "project_id": 999999, "permission": "read", "reason": "Cover", "starts_on": "2026-11-01", "expires_on": "2026-12-01"}
    assert client.post("/api/admin/grants", json=grant, headers=a).status_code == 422
    assert client.post("/api/admin/transfers", json={"employee_id": bid, "new_manager_id": kid, "effective_from": "2026-11-01", "reason": "Loop"}, headers=a).status_code == 422
    assert client.post("/api/calendar/holidays", json={"day": str(date(2031, 1, 1)), "name": "First"}, headers=a).status_code == 200
    assert client.post("/api/calendar/holidays", json={"day": str(date(2031, 1, 1)), "name": "Again"}, headers=a).status_code == 422
    assert len(client.get("/api/people/lookup?limit=-1", headers=a).json()) <= 50


def test_scoring_weights_are_not_sent_to_team_leads_or_managers(client, auth):
    for who in ("team_lead", "manager"):
        assert client.get("/api/rules", headers=auth(who)).status_code == 403
