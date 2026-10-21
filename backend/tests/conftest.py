import os
import tempfile

import pytest

_db_dir = tempfile.mkdtemp(prefix="orgtrack-test-")
# Set ORGTRACK_TEST_DATABASE_URL to run the suite against Postgres (the database is dropped and recreated).
os.environ["ORGTRACK_DATABASE_URL"] = os.environ.get("ORGTRACK_TEST_DATABASE_URL", f"sqlite:///{_db_dir}/test.db")
os.environ["ORGTRACK_UPLOAD_DIR"] = f"{_db_dir}/uploads"

from fastapi.testclient import TestClient  # noqa: E402

from app.core.database import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.seed.demo import seed_demo  # noqa: E402
from app.seed.platform import ensure_platform_accounts  # noqa: E402
from app.seed.sales import ensure_individual_tier  # noqa: E402
from app.seed.workbook import import_workbook  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def seeded():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        import_workbook(db)
        seed_demo(db)
        ensure_platform_accounts(db)
        ensure_individual_tier(db)
        db.commit()
    yield


@pytest.fixture(scope="session")
def client():
    return TestClient(app)


ACCOUNTS = {
    "admin": "balneet.birah@finvasia.example",
    "hod": "kapil.abrol@finvasia.example",
    "hod_ops": "pawan.kumar@finvasia.example",
    "manager": "pradeep.thakur@finvasia.example",
    "manager_cs": "sahil.sharma@finvasia.example",
    "team_lead": "aaina.ghill@finvasia.example",
    "platform_admin": "deepjyot.tiwari@shoonya.com",
    "sales_hod": "gurjot.singh@shoonya.com",
    "sales_amit": "amit.kumar@shoonya.com",
    "sales_rajesh": "rajesh.kumar@shoonya.com",
    "sales_anju": "anju.kumari@shoonya.com",
}


@pytest.fixture(scope="session")
def auth(client):
    cache = {}

    def headers(who: str) -> dict:
        if who not in cache:
            r = client.post("/api/auth/login", json={"email": ACCOUNTS[who]})
            assert r.status_code == 200, r.text
            cache[who] = {"Authorization": f"Bearer {r.json()['token']}"}
        return cache[who]

    return headers
