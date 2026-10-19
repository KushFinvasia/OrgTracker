"""Phase B: bulk approval, assigning training to a team, and the per-person history. Uses Oct 2026 (open)."""

import pytest


@pytest.fixture(scope="module")
def oct_(client, auth):
    return next(m for m in client.get("/api/individual/context", headers=auth("sales_hod")).json()["months"] if m["label"] == "Oct 2026")


def _ids(client, h, month, codes):
    rows = client.get(f"/api/individual/months/{month['id']}/people", headers=h).json()["rows"]
    return [next(r["employee"]["id"] for r in rows if r["employee"]["code"] == c) for c in codes]


def test_bulk_approve_and_return_follow_the_single_rules(client, auth, oct_):
    amit, hod, admin = auth("sales_amit"), auth("sales_hod"), auth("platform_admin")
    gouri, satwinder, ashwani = _ids(client, amit, oct_, ["EMP-0268", "EMP-0269", "EMP-0270"])
    for emp in (gouri, satwinder, ashwani):
        assert client.put(f"/api/individual/evaluations/{emp}/{oct_['id']}", json={"quality_rating": 4, "csat_rating": 4}, headers=amit).status_code == 200
        assert client.post(f"/api/individual/evaluations/{emp}/{oct_['id']}/submit", headers=amit).status_code == 200
    amit_kumar = _ids(client, hod, oct_, ["EMP-0266"])[0]  # not submitted, and the HOD marks him (Admin approves)

    # A return needs a reason.
    r = client.post(f"/api/individual/months/{oct_['id']}/decide-many", json={"employee_ids": [gouri], "decision": "return"}, headers=hod).json()
    assert r["done"] == 0 and "reason" in r["results"][0]["message"].lower()
    # A Manager cannot approve; nothing changes.
    r = client.post(f"/api/individual/months/{oct_['id']}/decide-many", json={"employee_ids": [gouri, satwinder], "decision": "approve"}, headers=amit).json()
    assert r["done"] == 0 and r["failed"] == 2

    r = client.post(f"/api/individual/months/{oct_['id']}/decide-many", json={"employee_ids": [gouri, satwinder, amit_kumar], "decision": "approve"}, headers=hod).json()
    assert r["done"] == 2 and r["failed"] == 1
    assert "submitted" in next(x for x in r["results"] if x["employee_id"] == amit_kumar)["message"]
    r = client.post(f"/api/individual/months/{oct_['id']}/decide-many", json={"employee_ids": [ashwani], "decision": "return", "reason": "Add the CSAT evidence"}, headers=admin).json()
    assert r["done"] == 1

    rows = {x["employee"]["id"]: x["evaluation_state"] for x in client.get(f"/api/individual/months/{oct_['id']}/people", headers=hod).json()["rows"]}
    assert (rows[gouri], rows[satwinder], rows[ashwani]) == ("Approved", "Approved", "Returned")


def test_assign_training_to_a_team(client, auth, oct_):
    rajesh = auth("sales_rajesh")
    babita, nadeem = _ids(client, rajesh, oct_, ["EMP-0289", "EMP-0292"])
    gouri = _ids(client, auth("sales_amit"), oct_, ["EMP-0268"])[0]  # Amit's person: outside Rajesh's scope
    body = {"title": "Margin rules refresher", "track": "Compliance", "assigned_date": "2026-10-01", "due_date": "2026-10-25", "employee_ids": [babita, nadeem, gouri]}
    r = client.post("/api/individual/training/assign", json=body, headers=rajesh).json()
    assert r["done"] == 2 and r["failed"] == 1
    # The title joins the catalogue for next time; assigning the same module and due date again is refused per person.
    assert any(c["title"] == "Margin rules refresher" for c in client.get("/api/individual/training-catalog", headers=rajesh).json())
    again = client.post("/api/individual/training/assign", json={**body, "employee_ids": [babita]}, headers=rajesh).json()
    assert again["done"] == 0 and "Already assigned" in again["results"][0]["message"]
    bad = client.post("/api/individual/training/assign", json={**body, "due_date": "2026-09-01"}, headers=rajesh)
    assert bad.status_code == 422


def test_history_shows_who_changed_what(client, auth, oct_):
    rajesh, amit = auth("sales_rajesh"), auth("sales_amit")
    babita = _ids(client, rajesh, oct_, ["EMP-0289"])[0]
    item = client.get(f"/api/individual/months/{oct_['id']}/items?employee_id={babita}", headers=rajesh).json()[0]
    client.patch(f"/api/individual/items/{item['id']}", json={"version": item["version"], "remarks": "Checked with the dialler report"}, headers=rajesh)
    hist = client.get(f"/api/individual/history/{babita}/{oct_['id']}", headers=rajesh).json()
    texts = [h["text"] for h in hist]
    assert "Changed" in texts and "Assigned training" in texts
    assert all(h["actor"]["name"] == "Rajesh Kumar" for h in hist)
    assert client.get(f"/api/individual/history/{babita}/{oct_['id']}", headers=amit).status_code == 403
