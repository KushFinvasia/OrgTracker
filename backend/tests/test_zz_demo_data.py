"""Phase S: the labelled demo data. Runs last (it adds months to the shared test database)."""


def _months(client, h):
    return {m["label"]: m for m in client.get("/api/individual/context", headers=h).json()["months"]}


def test_demo_data_is_admin_only_labelled_and_removable(client, auth):
    admin, hod = auth("platform_admin"), auth("sales_hod")
    assert client.post("/api/individual/demo/add", headers=hod).status_code == 403
    kul_before = client.get("/api/individual/months/{}/items?kind=kpi".format(_months(client, admin)["Sep 2026"]["id"]), headers=admin).json()
    kul_before = {i["id"]: i["achieved_value"] for i in kul_before}

    out = client.post("/api/individual/demo/add", headers=admin).json()
    assert "Jul 2026 (closed)" in out["months"] and "Aug 2026 (closed)" in out["months"]
    months = _months(client, admin)
    assert months["Jul 2026"]["illustrative"] and months["Jul 2026"]["state"] == "Locked" and months["Jul 2026"]["published_at"]
    assert client.get("/api/individual/context", headers=admin).json()["demo_loaded"] is True
    # Adding twice does nothing.
    assert "skipped" in client.post("/api/individual/demo/add", headers=admin).json()

    # Closed demo months have believable, scored results; the dashboard picks them up.
    q3 = client.get("/api/individual/dashboard?year=2026&quarter=3", headers=hod).json()
    assert q3["summary"]["final_avg"] is not None and q3["summary"]["final_n"] >= 25
    assert 50 <= q3["summary"]["final_avg"] <= 95
    rewards = client.get(f"/api/individual/rewards?month_id={months['Jul 2026']['id']}", headers=hod).json()
    assert sum(rewards["tiers"].values()) > 0

    # Demo approvals come only from the Sales HOD, or Admin for the people the HOD marks; never another department's HOD.
    from sqlalchemy import select

    from app.core.database import SessionLocal
    from app.models import Account, Employee, MonthlyEvaluation

    with SessionLocal() as db:
        approvers = set(db.scalars(select(Employee.full_name).join(Account, Account.employee_id == Employee.id)
                                   .join(MonthlyEvaluation, MonthlyEvaluation.decided_by == Account.id).where(MonthlyEvaluation.illustrative.is_(True))))
    assert approvers <= {"Gurjot Singh", "Deepjyot Tiwari"} and "Gurjot Singh" in approvers

    # The locked September (real tracker month in this test run) is never touched.
    sep_after = {i["id"]: i["achieved_value"] for i in client.get(f"/api/individual/months/{months['Sep 2026']['id']}/items?kind=kpi", headers=admin).json()}
    assert sep_after == kul_before

    cleared = client.post("/api/individual/demo/clear", headers=admin).json()
    assert cleared["months"] == 2
    months = _months(client, admin)
    assert "Jul 2026" not in months and "Aug 2026" not in months
    assert client.get("/api/individual/context", headers=admin).json()["demo_loaded"] is False
    oct_items = client.get(f"/api/individual/months/{months['Oct 2026']['id']}/items", headers=admin).json()
    assert not any(i["illustrative"] for i in oct_items)
