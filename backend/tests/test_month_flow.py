"""Phase A: KPIs follow the month. Due dates come from the month, months open and carry targets over, rows can be removed,
warnings can be checked. Runs after test_individual_api (Sep 2026 is locked by then; Oct 2026 is open)."""

import pytest


@pytest.fixture(scope="module")
def months(client, auth):
    ctx = client.get("/api/individual/context", headers=auth("sales_hod")).json()
    return {m["label"]: m for m in ctx["months"]}


def _person(client, h, month, code):
    rows = client.get(f"/api/individual/months/{month['id']}/people", headers=h).json()["rows"]
    return next(r for r in rows if r["employee"]["code"] == code)


def _items(client, h, month, emp_id):
    return client.get(f"/api/individual/months/{month['id']}/items?employee_id={emp_id}", headers=h).json()


def test_due_date_is_the_month_end(client, auth, months):
    rajesh = auth("sales_rajesh")
    rahul = _person(client, rajesh, months["Sep 2026"], "EMP-0291")["employee"]["id"]
    assert {i["target_date"] for i in _items(client, rajesh, months["Sep 2026"], rahul)} == {"2026-09-30"}
    oct_items = _items(client, rajesh, months["Oct 2026"], rahul)
    assert oct_items and {i["target_date"] for i in oct_items} == {"2026-10-31"}
    assert not any(i["due_set_by_manager"] for i in oct_items)


def test_october_was_carried_over_from_september(client, auth, months):
    hod = auth("sales_hod")
    sep = {r["employee"]["code"]: r for r in client.get(f"/api/individual/months/{months['Sep 2026']['id']}/people", headers=hod).json()["rows"]}
    oct_ = {r["employee"]["code"]: r for r in client.get(f"/api/individual/months/{months['Oct 2026']['id']}/people", headers=hod).json()["rows"]}
    for code, r in sep.items():
        assert oct_[code]["kpi_rows"] == r["kpi_rows"], code
        # Duty tasks added to September by earlier tests (after October was carried) are not expected in October.
        assert oct_[code]["duty_rows"] <= r["duty_rows"], code
    assert sum(r["kpi_rows"] for r in oct_.values()) == 108
    items = client.get(f"/api/individual/months/{months['Oct 2026']['id']}/items?kind=kpi", headers=hod).json()
    individual = [i for i in items if not i["is_team"]]
    assert all(i["achieved_value"] == 0 and i["outcome"] is None and i["flags"] == [] for i in individual)
    assert all(i["source"] == "Carried over from Sep 2026" for i in items)
    assert all(i["achieved_value"] is None for i in items if i["is_team"])  # team rows use the reportees' sum


def test_carry_over_runs_once(client, auth, months):
    before = months["Oct 2026"]
    client.get("/api/individual/context", headers=auth("sales_hod"))  # opens due months again: must not duplicate
    after = next(m for m in client.get("/api/individual/context", headers=auth("sales_hod")).json()["months"] if m["label"] == "Oct 2026")
    hod = auth("sales_hod")
    rows = lambda m: len(client.get(f"/api/individual/months/{m['id']}/items", headers=hod).json())  # noqa: E731
    assert rows(before) == rows(after)


def test_manager_can_set_an_earlier_due_date_inside_the_month(client, auth, months):
    rajesh = auth("sales_rajesh")
    rahul = _person(client, rajesh, months["Oct 2026"], "EMP-0291")["employee"]["id"]
    it = next(i for i in _items(client, rajesh, months["Oct 2026"], rahul) if i["kind"] == "duty")
    bad = client.patch(f"/api/individual/items/{it['id']}", json={"version": it["version"], "target_date": "2026-11-02"}, headers=rajesh)
    assert bad.status_code == 422 and bad.json()["detail"]["field"] == "target_date"
    ok = client.patch(f"/api/individual/items/{it['id']}", json={"version": it["version"], "target_date": "2026-10-10"}, headers=rajesh).json()
    done = client.patch(f"/api/individual/items/{it['id']}", json={"version": ok["version"], "outcome": "Completed", "completed_date": "2026-10-12"}, headers=rajesh)
    assert done.status_code == 200
    row = next(i for i in _items(client, rajesh, months["Oct 2026"], rahul) if i["id"] == it["id"])
    assert row["target_date"] == "2026-10-10" and row["due_set_by_manager"] and row["timing"] == "Delayed"


def test_change_type_and_remove_a_row(client, auth, months):
    rajesh = auth("sales_rajesh")
    nadeem = _person(client, rajesh, months["Oct 2026"], "EMP-0292")["employee"]["id"]
    rows = _items(client, rajesh, months["Oct 2026"], nadeem)
    kpi = next(i for i in rows if i["kind"] == "kpi")
    types = {t["code"]: t["id"] for t in client.get("/api/individual/kpi-types", headers=rajesh).json()}
    assert client.patch(f"/api/individual/items/{kpi['id']}", json={"version": kpi["version"], "kpi_type_id": types["funded_clients"]}, headers=rajesh).status_code == 200
    assert client.post(f"/api/individual/items/{kpi['id']}/remove", json={"reason": "x"}, headers=rajesh).status_code == 422  # reason too short
    assert client.post(f"/api/individual/items/{kpi['id']}/remove", json={"reason": "Target discontinued"}, headers=auth("sales_amit")).status_code == 403
    assert client.post(f"/api/individual/items/{kpi['id']}/remove", json={"reason": "Target discontinued"}, headers=rajesh).status_code == 200
    left = _items(client, rajesh, months["Oct 2026"], nadeem)
    assert kpi["id"] not in {i["id"] for i in left} and len(left) == len(rows) - 1
    # Opening November carries the remaining rows only.
    nov = client.post("/api/individual/months", json={"month": "2026-11-01"}, headers=auth("sales_hod")).json()
    nov_rows = _items(client, rajesh, nov, nadeem)
    assert sorted(i["title"] for i in nov_rows) == sorted(i["title"] for i in left)
    assert {i["target_date"] for i in nov_rows} == {"2026-11-30"}


def test_warnings_in_a_locked_month_cannot_change(client, auth, months):
    hod, admin = auth("sales_hod"), auth("platform_admin")
    upasna = _person(client, hod, months["Sep 2026"], "EMP-0288")["employee"]["id"]
    sep_item = next(i for i in _items(client, hod, months["Sep 2026"], upasna) if i["open_warnings"])
    assert client.post(f"/api/individual/items/{sep_item['id']}/resolve-warning", json={"index": 0, "note": "Confirmed"}, headers=admin).status_code == 422


def test_resolving_warnings_in_an_open_month(client, auth, months):
    """Managers check ordinary warnings; only an Admin confirms a name match."""
    from app.core.database import SessionLocal
    from app.models import KpiItem

    rajesh, admin = auth("sales_rajesh"), auth("platform_admin")
    oct_ = months["Oct 2026"]
    upasna = _person(client, rajesh, oct_, "EMP-0288")["employee"]["id"]
    item = _items(client, rajesh, oct_, upasna)[0]
    with SessionLocal() as db:
        row = db.get(KpiItem, item["id"])
        row.flags = [{"level": "warn", "text": "Name match to confirm (D7): tracker 'Upasana' = Upasna (EMP-0288)."}, {"level": "warn", "text": "No target set for this KPI row."}]
        db.commit()
    assert client.post(f"/api/individual/items/{item['id']}/resolve-warning", json={"index": 0, "note": "Same person"}, headers=rajesh).status_code == 403
    assert client.post(f"/api/individual/items/{item['id']}/resolve-warning", json={"index": 1, "note": "Target agreed verbally"}, headers=rajesh).status_code == 200
    assert client.post(f"/api/individual/items/{item['id']}/resolve-warning", json={"index": 0, "note": "Same person, checked with HR"}, headers=admin).status_code == 200
    row = next(i for i in _items(client, rajesh, oct_, upasna) if i["id"] == item["id"])
    assert row["open_warnings"] == 0 and all(f["resolved"] for f in row["flags"])


def test_correction_after_close_keeps_old_and_new(client, auth, months):
    """HOD requests, a different Admin approves, the Manager re-marks only that person, the HOD approves, the result is re-frozen."""
    rajesh, hod, admin = auth("sales_rajesh"), auth("sales_hod"), auth("platform_admin")
    sep = months["Sep 2026"]
    tanu = _person(client, hod, sep, "EMP-0284")
    assert tanu["locked"] and round(tanu["final"], 2) == 85.41
    body = {"month_id": sep["id"], "employee_id": tanu["employee"]["id"], "reason": "Quality rating was entered as 4 instead of 5"}
    assert client.post("/api/individual/corrections", json=body, headers=rajesh).status_code == 403
    c = client.post("/api/individual/corrections", json=body, headers=hod).json()
    assert c["state"] == "Requested"
    assert client.post("/api/individual/corrections", json=body, headers=hod).status_code == 422  # one at a time
    assert client.post(f"/api/individual/corrections/{c['id']}/decide", json={"decision": "approve"}, headers=hod).status_code == 403
    assert client.post(f"/api/individual/corrections/{c['id']}/decide", json={"decision": "approve"}, headers=admin).json()["state"] == "Open"

    # Only Tanu's month reopens; everyone else in September stays frozen.
    babita = _person(client, rajesh, sep, "EMP-0289")["employee"]["id"]
    other = _items(client, rajesh, sep, babita)[0]
    assert client.patch(f"/api/individual/items/{other['id']}", json={"version": other["version"], "remarks": "x"}, headers=rajesh).status_code == 422
    t = tanu["employee"]["id"]
    assert client.put(f"/api/individual/evaluations/{t}/{sep['id']}", json={"quality_rating": 5}, headers=rajesh).status_code == 200
    assert client.post(f"/api/individual/evaluations/{t}/{sep['id']}/submit", headers=rajesh).status_code == 200
    assert client.post(f"/api/individual/evaluations/{t}/{sep['id']}/decide", json={"decision": "approve"}, headers=hod).status_code == 200

    done = client.get(f"/api/individual/corrections?month_id={sep['id']}&employee_id={t}", headers=admin).json()[0]
    assert done["state"] == "Completed"
    assert round(done["old_result"]["final"], 2) == 85.41 and round(done["new_result"]["final"], 2) == 89.41
    after = _person(client, hod, sep, "EMP-0284")
    assert after["locked"] and round(after["final"], 2) == 89.41
    # Frozen again: no more edits without a new correction.
    assert client.put(f"/api/individual/evaluations/{t}/{sep['id']}", json={"quality_rating": 3}, headers=rajesh).status_code == 422
    # The HOD sees the outcome but not the method details.
    assert "base" not in client.get(f"/api/individual/corrections?month_id={sep['id']}", headers=hod).json()[0]["new_result"]


CITATION = ("Tanu covered two colleagues' lead lists during the festival week, kept every client call logged the same day and still "
            "finished above her call target. She trained a new joiner on the account opening journey and the e-sign steps, and "
            "the joiner opened twelve accounts in the month. Clients mentioned her patience on follow-up calls more than once.")


def test_nominations_from_a_closed_month(client, auth, months):
    rajesh, hod, amit = auth("sales_rajesh"), auth("sales_hod"), auth("sales_amit")
    sep, oct_ = months["Sep 2026"], months["Oct 2026"]
    tanu = _person(client, rajesh, sep, "EMP-0284")["employee"]["id"]
    base = {"month_id": sep["id"], "employee_id": tanu, "award": "Collaboration award"}
    assert client.post("/api/individual/nominations", json={**base, "citation": "Great work this month."}, headers=rajesh).status_code == 422
    assert client.post("/api/individual/nominations", json={**base, "month_id": oct_["id"], "citation": CITATION}, headers=rajesh).status_code == 422  # month open
    n = client.post("/api/individual/nominations", json={**base, "citation": CITATION}, headers=rajesh).json()
    assert n["state"] == "Submitted"
    assert client.post("/api/individual/nominations", json={**base, "citation": CITATION}, headers=rajesh).status_code == 422  # duplicate
    assert client.post(f"/api/individual/nominations/{n['id']}/decide", json={"decision": "approve"}, headers=rajesh).status_code == 403
    assert client.post(f"/api/individual/nominations/{n['id']}/decide", json={"decision": "approve"}, headers=hod).json()["state"] == "Approved"
    # September recognition was published earlier, so approved nominations are visible across the pilot.
    assert any(x["id"] == n["id"] for x in client.get(f"/api/individual/nominations?month_id={sep['id']}", headers=amit).json()["rows"])
