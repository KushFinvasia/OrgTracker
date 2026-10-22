"""Individual Tier (Sales pilot) through the API: scope, evaluator/approver independence, TWCS, delays, lock, rules.

Tests run in file order against one seeded database; the month lock and rule approval come last.
"""

import copy

import pytest


@pytest.fixture(scope="module")
def sep(client, auth):
    ctx = client.get("/api/individual/context", headers=auth("sales_hod")).json()
    return next(m for m in ctx["months"] if m["label"] == "Sep 2026")


def _row(client, h, month, name):
    rows = client.get(f"/api/individual/months/{month['id']}/people", headers=h).json()["rows"]
    return next(r for r in rows if r["employee"]["name"] == name)


def test_pilot_logins_are_hod_and_managers_only(client, auth):
    h = auth("sales_hod")
    me = client.get("/api/auth/me", headers=h).json()
    assert me["role"] == "hod" and me["in_pilot"] is True
    for who in ("sales_amit", "sales_rajesh", "sales_anju"):
        assert client.get("/api/auth/me", headers=auth(who)).json()["role"] == "manager"
    # Team Leads in Sales have no login.
    assert client.post("/api/auth/login", json={"email": "sakshi.sharma@shoonya.com"}).status_code == 401


def test_import_counts_and_no_targets(client, auth):
    rules = client.get("/api/individual/rules", headers=auth("platform_admin")).json()
    summary = rules["imports"][0]["summary"]
    assert summary["kpi_rows"] == 108 and summary["duty_rows"] == 38 and summary["unmatched"] == []
    assert summary["no_targets"] == ["Dipanshu Gupta", "Keshav Khullar", "Kunal Sethi", "Pratham Arora", "Shweta Jadhav", "Sunaina Joshi"]


@pytest.mark.parametrize("who,count", [("sales_hod", 36), ("platform_admin", 36), ("sales_amit", 13), ("sales_rajesh", 12), ("sales_anju", 2), ("manager", 0), ("team_lead", 0)])
def test_scope_matches_reporting_tree(client, auth, sep, who, count):
    rows = client.get(f"/api/individual/months/{sep['id']}/people", headers=auth(who)).json()["rows"]
    assert len(rows) == count


def test_evaluators(client, auth, sep):
    rows = client.get(f"/api/individual/months/{sep['id']}/people", headers=auth("sales_hod")).json()["rows"]
    by = {r["employee"]["name"]: r for r in rows}
    assert by["Tanu Thakur"]["evaluator"]["name"] == "Rajesh Kumar"
    assert by["Gouri"]["evaluator"]["name"] == "Amit Kumar"
    assert by["Amit Kumar"]["evaluator"]["name"] == "Gurjot Singh" and by["Amit Kumar"]["approver_roles"] == ["admin"]
    assert by["Tanu Thakur"]["approver_roles"] == ["hod", "admin"]


def test_manager_cannot_open_other_tree(client, auth, sep):
    tanu = _row(client, auth("sales_rajesh"), sep, "Tanu Thakur")
    assert client.get(f"/api/individual/evaluations/{tanu['employee']['id']}/{sep['id']}", headers=auth("sales_amit")).status_code == 403
    assert client.get(f"/api/individual/months/{sep['id']}/items?employee_id={tanu['employee']['id']}", headers=auth("sales_amit")).status_code == 403


def test_team_row_uses_reportee_sum(client, auth, sep):
    # Rajesh never sees his own row; the HOD does.
    items = client.get(f"/api/individual/months/{sep['id']}/items?kind=kpi", headers=auth("sales_hod")).json()
    team = next(i for i in items if i["employee"]["name"] == "Rajesh Kumar" and i["kpi_type"]["code"] == "call_volume")
    assert team["is_team"] and team["team_sum"]["target_sum"] == 49808 and team["target_value"] == 49808


def test_quarter_dashboard_is_role_based(client, auth, sep):
    q3 = "/api/individual/dashboard?year=2026&quarter=3"
    mgr = client.get(q3, headers=auth("sales_amit")).json()
    assert mgr["label"] == "Q3 2026 (Jul–Sep)" and [m["label"] for m in mgr["months"]] == ["Sep 2026"]
    assert mgr["summary"]["people"] == 13 and len(mgr["people"]) == 13
    assert "managers" not in mgr and "departments" not in mgr  # Managers get no team comparison
    # Incomplete is not zero: nobody is scored yet, so the quarter score is None with a count of 0, not 0.
    assert mgr["summary"]["final_avg"] is None and mgr["summary"]["final_n"] == 0
    assert all(p["quarter"]["final_avg"] is None for p in mgr["people"])
    assert any("Check-in not submitted: Sep 2026" in a for p in mgr["people"] for a in p["attention"])

    hod = client.get(q3, headers=auth("sales_hod")).json()
    teams = {g["manager"]["name"]: g["people"] for g in hod["managers"]}
    assert teams == {"Amit Kumar": 13, "Rajesh Kumar": 12, "Anju Kumari": 2, "Durga Paswan": 1, "Keshav Khullar": 1, "Gurjot Singh": 7}
    assert next(g for g in hod["managers"] if g["manager"]["name"] == "Gurjot Singh")["is_me"] is True
    assert "departments" not in hod

    admin = client.get(q3, headers=auth("platform_admin")).json()
    assert admin["departments"][0]["department"] == "Sales" and admin["departments"][0]["people"] == 36
    assert [t["label"] for t in admin["quarterly_trend"]] == ["Q1", "Q2", "Q3", "Q4"]
    assert admin["quarterly_trend"][0]["months"] == 0 and admin["quarterly_trend"][0]["final_avg"] is None

    # Outside the pilot scope: nothing.
    assert client.get(q3, headers=auth("manager")).json()["people"] == []
    assert client.get("/api/individual/dashboard?year=2026&quarter=5", headers=auth("sales_amit")).status_code == 422


def test_kulwinder_achievement(client, auth, sep):
    r = _row(client, auth("sales_rajesh"), sep, "Kulwinder Kaur")
    # KPI achieved values default to 0: 4000/4400 = 90.91%, and the two unmarked KPIs count as 0% -> (90.91 + 0 + 0) / 3.
    assert round(r["achievement_pct"], 2) == 30.30
    assert (r["kpis_marked"], r["kpis_total"]) == (3, 3)


def test_hod_cannot_edit_a_managers_person(client, auth, sep):
    items = client.get(f"/api/individual/months/{sep['id']}/items?kind=kpi", headers=auth("sales_hod")).json()
    row = next(i for i in items if i["employee"]["name"] == "Tanu Thakur")
    assert row["can_edit"] is False
    r = client.patch(f"/api/individual/items/{row['id']}", json={"version": row["version"], "achieved_value": 1}, headers=auth("sales_hod"))
    assert r.status_code == 403


def test_full_month_for_tanu(client, auth, sep):
    rajesh, hod = auth("sales_rajesh"), auth("sales_hod")
    tanu_id = _row(client, rajesh, sep, "Tanu Thakur")["employee"]["id"]
    items = client.get(f"/api/individual/months/{sep['id']}/items?employee_id={tanu_id}", headers=rajesh).json()
    actuals = {"call_volume": 4000, "client_interaction": 1900, "account_opening": 380}
    for it in items:
        if it["kind"] == "kpi":
            r = client.patch(f"/api/individual/items/{it['id']}", json={"version": it["version"], "achieved_value": actuals[it["kpi_type"]["code"]]}, headers=rajesh)
            assert r.status_code == 200, r.text
    # KPIs are judged by achieved against target: no completion date or delay on a KPI row.
    it = next(i for i in items if i["kind"] == "kpi")
    r = client.patch(f"/api/individual/items/{it['id']}", json={"version": it["version"] + 1, "outcome": "Completed", "completed_date": "2026-09-20"}, headers=rajesh)
    assert r.status_code == 422 and r.json()["detail"]["field"] == "outcome"
    # Stale version -> conflict, never a silent overwrite.
    assert client.patch(f"/api/individual/items/{it['id']}", json={"version": 1, "remarks": "x"}, headers=rajesh).status_code == 409
    results = {i["kpi_type"]["code"]: i["result"] for i in client.get(f"/api/individual/months/{sep['id']}/items?employee_id={tanu_id}", headers=rajesh).json() if i["kind"] == "kpi"}
    assert results == {"call_volume": "Under achieved", "client_interaction": "Over achieved", "account_opening": "Under achieved"}

    # On-time comes from duty tasks: three done on time (the section 21 "On-time 3/3").
    for n in range(3):
        d = client.post(f"/api/individual/months/{sep['id']}/items", json={"employee_id": tanu_id, "kind": "duty", "title": f"Daily report {n + 1}"}, headers=rajesh).json()
        if n == 0:  # a future completion date is rejected; the draft is unchanged
            r = client.patch(f"/api/individual/items/{d['id']}", json={"version": 1, "outcome": "Completed", "completed_date": "2099-01-01"}, headers=rajesh)
            assert r.status_code == 422 and r.json()["detail"]["field"] == "completed_date"
        r = client.patch(f"/api/individual/items/{d['id']}", json={"version": 1, "outcome": "Completed", "completed_date": "2026-09-20"}, headers=rajesh)
        assert r.status_code == 200, r.text

    # TWCS worked example: 3 on time, 1 ten days late, 1 not done = 70.
    mods = [("Product basics", "Technical", "2026-09-20"), ("KYC rules", "Compliance", "2026-09-18"), ("Objection handling", "Behavioural", "2026-09-20"),
            ("CRM workflow", "Functional", "2026-09-30"), ("Team leadership", "Leadership", None)]
    for title, track, done in mods:
        body = {"employee_id": tanu_id, "title": title, "track": track, "assigned_date": "2026-09-01", "due_date": "2026-09-20", "completed_date": done}
        assert client.post("/api/individual/training", json=body, headers=rajesh).status_code == 200
    # A duty task with a delay; HOD validates the reason, so it leaves On-time and the penalty.
    dt = client.post(f"/api/individual/months/{sep['id']}/items", json={"employee_id": tanu_id, "kind": "duty", "title": "Weekly lead audit"}, headers=rajesh).json()
    r = client.patch(f"/api/individual/items/{dt['id']}", json={"version": 1, "outcome": "Not completed", "delay_reason": "CRM outage for four days"}, headers=rajesh)
    assert r.status_code == 200
    assert client.post(f"/api/individual/items/{dt['id']}/validate-delay", json={"decision": "validate"}, headers=rajesh).status_code == 403

    ev = client.put(f"/api/individual/evaluations/{tanu_id}/{sep['id']}", json={"csat_rating": 4, "quality_rating": 4}, headers=rajesh).json()
    # The Manager sees the final score but not the method (weights, contributions, coverage, penalties).
    assert ev["method_hidden"] and "weights" not in ev and "penalties" not in ev
    assert set(ev["scorecard"]) == {"rows", "final", "tier", "status", "explanation"} and "weight" not in ev["scorecard"]["rows"][0]
    ev = client.get(f"/api/individual/evaluations/{tanu_id}/{sep['id']}", headers=auth("platform_admin")).json()
    card = ev["scorecard"]
    assert ev["on_time"]["delayed"] == 1 and card["penalty_total"] == 2
    assert ev["training"]["score"] == 70 and ev["training"]["provisional"] == 4
    # D4: an unvalidated delay lowers On-time (3 of 4 -> 60) and also costs 2 points.
    assert round(card["base"], 2) == 75.41 and round(card["final"], 2) == 73.41 and card["tier"] == "Bronze"

    assert client.post(f"/api/individual/items/{dt['id']}/validate-delay", json={"decision": "validate"}, headers=hod).status_code == 200
    ev = client.get(f"/api/individual/evaluations/{tanu_id}/{sep['id']}", headers=auth("platform_admin")).json()
    # D5: a validated delay leaves both On-time and the penalty: the section 21 base of 85.41.
    assert ev["on_time"]["delay_validated"] == 1 and round(ev["scorecard"]["base"], 2) == 85.41 and round(ev["scorecard"]["final"], 2) == 85.41

    # Submit -> read-only for the evaluator; the HOD approves; the approval verifies the training completions.
    assert client.post(f"/api/individual/evaluations/{tanu_id}/{sep['id']}/submit", headers=rajesh).status_code == 200
    assert client.put(f"/api/individual/evaluations/{tanu_id}/{sep['id']}", json={"csat_rating": 5, "quality_rating": 5}, headers=rajesh).status_code == 403
    assert client.post(f"/api/individual/evaluations/{tanu_id}/{sep['id']}/decide", json={"decision": "approve"}, headers=rajesh).status_code == 403
    assert client.post(f"/api/individual/evaluations/{tanu_id}/{sep['id']}/decide", json={"decision": "approve"}, headers=auth("sales_amit")).status_code == 403
    r = client.post(f"/api/individual/evaluations/{tanu_id}/{sep['id']}/decide", json={"decision": "approve"}, headers=hod)
    assert r.status_code == 200, r.text
    assert r.json()["evaluation"]["state"] == "Approved" and r.json()["training"]["provisional"] == 0


def test_return_needs_reason_and_reopens(client, auth, sep):
    amit, hod = auth("sales_amit"), auth("sales_hod")
    gouri = _row(client, amit, sep, "Gouri")["employee"]["id"]
    client.put(f"/api/individual/evaluations/{gouri}/{sep['id']}", json={"csat_rating": 3, "quality_rating": 3, "training_none_due": True}, headers=amit)
    assert client.post(f"/api/individual/evaluations/{gouri}/{sep['id']}/submit", headers=amit).status_code == 200
    assert client.post(f"/api/individual/evaluations/{gouri}/{sep['id']}/decide", json={"decision": "return"}, headers=hod).status_code == 422
    r = client.post(f"/api/individual/evaluations/{gouri}/{sep['id']}/decide", json={"decision": "return", "reason": "Add the funds achieved"}, headers=hod)
    assert r.json()["evaluation"]["state"] == "Returned"
    assert client.put(f"/api/individual/evaluations/{gouri}/{sep['id']}", json={"csat_rating": 3, "quality_rating": 4, "training_none_due": True}, headers=amit).status_code == 200


def test_hod_written_evaluation_goes_to_admin(client, auth, sep):
    hod = auth("sales_hod")
    amit_id = _row(client, hod, sep, "Amit Kumar")["employee"]["id"]
    client.put(f"/api/individual/evaluations/{amit_id}/{sep['id']}", json={"csat_rating": 4, "quality_rating": 4, "training_none_due": True}, headers=hod)
    assert client.post(f"/api/individual/evaluations/{amit_id}/{sep['id']}/submit", headers=hod).status_code == 200
    assert client.post(f"/api/individual/evaluations/{amit_id}/{sep['id']}/decide", json={"decision": "approve"}, headers=hod).status_code == 403
    assert client.post(f"/api/individual/evaluations/{amit_id}/{sep['id']}/decide", json={"decision": "approve"}, headers=auth("platform_admin")).status_code == 200


def test_counts_and_achievement_come_from_kpis_only_training_can_be_typed(client, auth, sep):
    """Tasks on-time/delayed and Achievement % are worked out from the KPIs; the Manager may type only the training score."""
    amit = auth("sales_amit")
    gouri = _row(client, amit, sep, "Gouri")["employee"]["id"]
    body = {"on_time_count": 4, "delayed_count": 1, "achievement_pct": 96.46, "twcs_score": 70}
    assert client.put(f"/api/individual/evaluations/{gouri}/{sep['id']}", json=body, headers=amit).status_code == 200
    ev = client.get(f"/api/individual/evaluations/{gouri}/{sep['id']}", headers=auth("platform_admin")).json()
    rows = {r["metric"]: r for r in ev["scorecard"]["rows"]}
    assert rows["training"]["score"] == 70
    assert rows["achievement"]["raw"] == 0 and rows["on_time"]["available"] is False  # KPIs default to 0 achieved; no outcomes recorded
    assert ev["inputs"]["entered"] == {"twcs_score": 70}
    # Ratings saved earlier in the month (CSAT 3, Quality 4) are kept: a save changes only the fields it sends.
    assert ev["evaluation"]["csat_rating"] == 3 and ev["evaluation"]["quality_rating"] == 4
    assert client.put(f"/api/individual/evaluations/{gouri}/{sep['id']}", json={"twcs_score": 101}, headers=amit).status_code == 422
    # Only the ratings weighted for Sales (Core Revenue) are asked for.
    mgr = client.get(f"/api/individual/evaluations/{gouri}/{sep['id']}", headers=amit).json()
    assert {m["metric"] for m in mgr["rated_metrics"] if m["required"]} == {"csat", "quality"}


def test_checkin_upload_accepts_the_original_rr_sheet(client, auth, sep):
    """An older single-sheet file (the original R&R Parameters columns) still uploads. The full workbook is in test_individual_excel."""
    import io

    import openpyxl

    rajesh = auth("sales_rajesh")
    # The original R&R sheet's long headers are accepted; blank cells leave values alone.
    wb = openpyxl.Workbook()
    out = wb.active
    out.append(["Employee Name", "Employee ID", "Tasks On-Time: Count of tasks completed by deadline", "Tasks Delayed", "Achievement %: Revenue (0-150)",
                "Quality: Manager assessment (1-5 scale)", "Collaboration", "Innovation", "Compliance", "CSAT: Customer satisfaction score (1-5)", "Training"])
    out.append(["Kulwinder Kaur", "EMP-0290", 5, 0, 90.91, 4, 4, 3, None, 4, 80])
    out.append(["Babita Thakur", "EMP-0289", None, None, 200, 6, None, None, None, None, None])
    out.append(["Gouri", "EMP-0268", None, None, None, 4, None, None, None, 4, None])  # Amit's person: outside Rajesh's scope
    buf = io.BytesIO()
    wb.save(buf)
    files = {"file": ("checkin.xlsx", buf.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
    dry = client.post(f"/api/individual/months/{sep['id']}/checkin-upload?dry_run=true", files=files, headers=rajesh).json()
    assert dry["ready"] == 1 and dry["with_errors"] == 2 and dry["applied"] == 0
    babita = next(x for x in dry["rows"] if x["code"] == "EMP-0289")
    assert any("1 to 5" in e for e in babita["errors"])
    assert {"Tasks On-Time", "Tasks Delayed", "Achievement %", "Collaboration", "Innovation", "Compliance"} <= set(dry["ignored_columns"])
    assert any("outside your scope" in e for e in next(x for x in dry["rows"] if x["code"] == "EMP-0268")["errors"])
    done = client.post(f"/api/individual/months/{sep['id']}/checkin-upload?dry_run=false", files=files, headers=rajesh).json()
    assert done["applied"] == 1
    kul = _row(client, auth("platform_admin"), sep, "Kulwinder Kaur")
    assert kul["check_in"]["quality_rating"] == 4 and kul["check_in"]["entered"]["twcs_score"] == 80
    assert kul["check_in"]["derived"]["on_time_count"] == 0  # from her duty tasks (none done), never the file's 5; KPI rows are not timed


def test_people_rows_hide_method_from_non_admins(client, auth, sep):
    row = _row(client, auth("sales_hod"), sep, "Gouri")
    assert "coverage" not in row and "base" not in row and "penalty_total" not in row
    assert "coverage" in _row(client, auth("platform_admin"), sep, "Gouri")


def test_export_is_scoped(client, auth, sep):
    text = client.get(f"/api/individual/reports/export.csv?month_id={sep['id']}", headers=auth("sales_amit")).text
    assert len(text.strip().splitlines()) == 2 + 13
    assert "Tanu Thakur" not in text
    assert client.get(f"/api/individual/keka-export.csv?month_id={sep['id']}", headers=auth("sales_amit")).status_code == 403


def test_rule_needs_independent_approver(client, auth, sep):
    admin, hod = auth("platform_admin"), auth("sales_hod")
    current = client.get("/api/individual/rules", headers=admin).json()
    cfg = copy.deepcopy(current["rules"][0]["config"])
    bad = copy.deepcopy(cfg)
    bad["weights"]["Core Revenue"]["csat"] = 20
    assert client.post("/api/individual/rules", json={"label": "Sales v2", "effective_month": "2026-10-01", "config": bad}, headers=admin).status_code == 422
    cfg["tiers"] = [["Gold", 88], ["Silver", 78], ["Bronze", 68]]
    r = client.post("/api/individual/rules", json={"label": "Sales v2", "effective_month": "2026-10-01", "config": cfg, "summary": "Lower tiers"}, headers=admin).json()
    preview = client.get(f"/api/individual/rules/{r['id']}/preview?month_id={sep['id']}", headers=admin).json()
    assert len(preview["rows"]) == 36
    assert client.post(f"/api/individual/rules/{r['id']}/submit", headers=admin).status_code == 200
    assert client.post(f"/api/individual/rules/{r['id']}/decide", json={"decision": "approve"}, headers=admin).status_code == 403
    # The scoring method is Admin-only: the HOD can neither read nor approve it; a second Admin approves.
    assert client.get("/api/individual/rules", headers=hod).status_code == 403
    assert client.post(f"/api/individual/rules/{r['id']}/decide", json={"decision": "approve"}, headers=hod).status_code == 403
    out = client.post(f"/api/individual/rules/{r['id']}/decide", json={"decision": "approve"}, headers=auth("admin")).json()
    assert "Oct 2026" in out["months_switched"] and "Sep 2026" not in out["months_switched"]


def test_lock_freezes_scores(client, auth, sep):
    hod = auth("sales_hod")
    check = client.get(f"/api/individual/months/{sep['id']}/lock-check", headers=hod).json()
    assert check["approved"] == 2 and len(check["not_approved"]) == 34
    assert client.post(f"/api/individual/months/{sep['id']}/lock", json={"note": "Sep close"}, headers=auth("sales_rajesh")).status_code == 403
    r = client.post(f"/api/individual/months/{sep['id']}/lock", json={"note": "Sep close"}, headers=hod)
    assert r.status_code == 422 and r.json()["detail"]["field"] == "exclude_reason"
    r = client.post(f"/api/individual/months/{sep['id']}/lock", json={"note": "Sep close", "exclude_reason": "Pilot month: evaluations not completed"}, headers=hod)
    assert r.status_code == 200 and r.json()["counts"]["not_evaluated"] == 34
    tanu = _row(client, hod, sep, "Tanu Thakur")
    assert tanu["locked"] and round(tanu["final"], 2) == 85.41 and tanu["tier"] == "Silver"
    items = client.get(f"/api/individual/months/{sep['id']}/items?employee_id={tanu['employee']['id']}", headers=auth("sales_rajesh")).json()
    assert client.patch(f"/api/individual/items/{items[0]['id']}", json={"version": items[0]["version"], "remarks": "late edit"}, headers=auth("sales_rajesh")).status_code == 422
    rewards = client.get(f"/api/individual/rewards?month_id={sep['id']}", headers=hod).json()
    assert rewards["tiers"]["Silver"] == 1
    assert client.post(f"/api/individual/months/{sep['id']}/publish", json={"note": "Sep recognition"}, headers=hod).status_code == 200
