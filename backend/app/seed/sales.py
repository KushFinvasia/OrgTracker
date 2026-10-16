"""Individual Tier (Sales pilot) setup: KPI catalogue, scoring rule v1, months, named logins and the Sales tracker import.

Source: `Project Tracker Sales (Shoonya).xlsx` (Sep 2026). The tasks are the KPIs: each row of `Project & Task Tracker`
is one person's monthly target and achieved value; `Extra Tasks` rows are duties with deadlines but no numbers.
Every row is kept; problems are flagged on the row, never silently fixed. The `Rewards & Recognition` points sheet is retired.

Everything here is idempotent and runs at startup, so an existing database picks up the pilot without a reset.
"""

from __future__ import annotations

import re
from datetime import date, datetime
from pathlib import Path

import openpyxl
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import Account, Department, DepartmentHead, Employee, ImportBatch, KpiItem, KpiMonth, KpiType, ScoringRule
from app.services.sales_scoring import DEFAULT_SALES_CONFIG

PILOT_DEPARTMENT = "Sales"
SOURCE_LABEL = "Sales tracker Sep 2026"

KPI_TYPES = [
    # code, name, unit, description
    ("call_volume", "Call volume", "count", "Calls made in the month (per-day target x working days)."),
    ("client_interaction", "Client interaction", "count", "Connected calls in the month."),
    ("account_opening", "Account openings", "count", "Accounts opened in the month."),
    ("funded_clients", "Funded clients", "count", "Clients who added funds in the month."),
    ("funds_added", "Funds added", "rupees", "Funds added in rupees. Tracker text such as '2 cr' or '10 lacs' is converted."),
    ("account_reactivation", "Account reactivation", "count", "Dormant accounts reactivated in the month."),
    ("zero_funded_clients", "Zero-funded clients", "count", "Zero-funded clients converted or worked in the month."),
    ("conversion", "Conversion %", "percent", "Lead-to-account or lead-to-registration conversion."),
    ("other", "Other KPI", "none", "A tracker KPI row with no numeric measure."),
]

# D7: matches proposed in the plan; each is flagged on the row until confirmed.
NAME_ALIASES = {
    "gurjot sodhi": "Gurjot Singh",
    "shivani sharma": "Shivani",
    "shivani. d": "Shivani Dhiman",
    "shivani d": "Shivani Dhiman",
    "upasana": "Upasna",
    "pramodh": "Parmodh Singh",
}


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", str(s)).strip().lower()


def _email(e: Employee) -> str:
    """D1 default: firstname.lastname@shoonya.com."""
    parts = re.sub(r"[^a-z ]", "", e.full_name.lower()).split()
    return ".".join(parts[:2] if len(parts) > 1 else parts) + "@shoonya.com"


def month_start(d: date) -> date:
    return d.replace(day=1)


def month_end(m: date) -> date:
    nxt = date(m.year + (m.month == 12), m.month % 12 + 1, 1)
    return date.fromordinal(nxt.toordinal() - 1)


def training_cutoff(m: date, cfg: dict) -> date:
    nxt = date(m.year + (m.month == 12), m.month % 12 + 1, 1)
    return nxt.replace(day=int(cfg["twcs"]["cutoff_day"]))


# --- catalogue, rule, months, accounts ---------------------------------------------------------


def pilot_department(db: Session) -> Department | None:
    return db.scalar(select(Department).where(Department.name == PILOT_DEPARTMENT))


def ensure_kpi_types(db: Session) -> dict[str, KpiType]:
    existing = {t.code: t for t in db.scalars(select(KpiType))}
    for i, (code, name, unit, desc) in enumerate(KPI_TYPES):
        if code not in existing:
            t = KpiType(code=code, name=name, unit=unit, description=desc, sort=i)
            db.add(t)
            existing[code] = t
    db.flush()
    return existing


def ensure_rule(db: Session) -> ScoringRule:
    rule = db.scalar(select(ScoringRule).where(ScoringRule.state == "Approved").order_by(ScoringRule.effective_month.desc(), ScoringRule.id.desc()))
    if rule is None:
        rule = ScoringRule(
            label="Sales v1",
            config=DEFAULT_SALES_CONFIG,
            state="Approved",
            effective_month=date(2026, 9, 1),
            summary="R&R parameters of 15 Oct 2026 with Training 10% in every category, scored by TWCS. -2 per delay and -2 when TWCS < 50.",
            decision_note="Direction approved by the user on 15 Oct 2026. Tiers (90/80/70) and the D1-D12 defaults remain proposed.",
            decided_at=datetime(2026, 10, 15, 12, 0),
        )
        db.add(rule)
        db.flush()
    return rule


def ensure_month(db: Session, m: date, rule: ScoringRule, dept: Department) -> KpiMonth:
    km = db.scalar(select(KpiMonth).where(KpiMonth.month == m))
    if km is None:
        km = KpiMonth(month=m, department_id=dept.id, rule_id=rule.id, training_cutoff=training_cutoff(m, rule.config), state="Open")
        db.add(km)
        db.flush()
    return km


def pilot_heads(db: Session, dept: Department) -> list[Employee]:
    return list(db.scalars(select(Employee).join(DepartmentHead, DepartmentHead.employee_id == Employee.id).where(DepartmentHead.department_id == dept.id)))


def ensure_sales_accounts(db: Session) -> list[str]:
    """The pilot's named logins: the Sales HOD and the Sales employees the org chart proposes as Managers (D1 emails).

    Team Leads and executives get no login. The Admin account comes from `platform.py`.
    """
    dept = pilot_department(db)
    if dept is None:
        return []
    wanted = [(e, "hod") for e in pilot_heads(db, dept)]
    wanted += [
        (e, "manager")
        for e in db.scalars(
            select(Employee).where(Employee.department_id == dept.id, Employee.record_type == "employee", Employee.proposed_role == "Manager").order_by(Employee.code)
        )
    ]
    created = []
    for emp, role in wanted:
        if db.scalar(select(Account.id).where(Account.employee_id == emp.id)):
            continue
        email = _email(emp)
        if db.scalar(select(Account.id).where(Account.email == email)):
            continue  # an unrelated account already uses this address; leave it for the administrator
        db.add(Account(employee_id=emp.id, email=email, role=role, preferences={"tier": "individual"}))
        created.append(email)
    db.flush()
    return created


# --- tracker parsing ---------------------------------------------------------------------------


def classify(title: str) -> str:
    t = _norm(title)
    if "zero-funded" in t or "zero funded" in t:
        return "zero_funded_clients"
    if "conversion" in t:
        return "conversion"
    if "call volume" in t:
        return "call_volume"
    if "interaction" in t or "intraction" in t:
        return "client_interaction"
    if "reactivation" in t:
        return "account_reactivation"
    if "funded clients" in t:
        return "funded_clients"
    if "fundes added" in t or "funds added" in t or "fund added" in t:
        return "funds_added"
    if "account opening" in t or "accounts target" in t:
        return "account_opening"
    return "other"


_AMOUNT = re.compile(r"^\s*([\d.,]+)\s*(cr|crore|crores|lac|lacs|lakh|lakhs|l)?\s*$", re.I)
_MULT = {"cr": 1e7, "crore": 1e7, "crores": 1e7, "lac": 1e5, "lacs": 1e5, "lakh": 1e5, "lakhs": 1e5, "l": 1e5}


def parse_amount(value) -> tuple[float | None, str | None]:
    """Number, or text like '2 cr' / '10 lacs' converted to rupees. Returns (value, original text when converted or unparseable)."""
    if value is None or value == "":
        return None, None
    if isinstance(value, (int, float)):
        return float(value), None
    text = str(value).strip()
    m = _AMOUNT.match(text)
    if not m:
        return None, text
    num = float(m.group(1).replace(",", ""))
    unit = (m.group(2) or "").lower()
    return num * _MULT.get(unit, 1), text if unit else None


_PER_DAY = re.compile(r"(\d+(?:\.\d+)?)\s*calls?\s*per\s*day", re.I)


def _date(v) -> date | None:
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    return None


def _sheet_rows(ws) -> list[tuple[int, dict]]:
    """Rows after the header row (the row whose second cell is 'Task / Deliverable'), keyed by normalised header."""
    header, out = None, []
    for idx, row in enumerate(ws.iter_rows(min_row=1, values_only=True), start=1):
        if header is None:
            if len(row) > 1 and row[1] and _norm(row[1]).startswith("task / deliverable"):
                header = [_norm(h).split("\n")[0] if h else f"col{j + 1}" for j, h in enumerate(row)]
            continue
        if any(v not in (None, "") for v in row):
            out.append((idx, dict(zip(header, row))))
    return out


def _col(row: dict, prefix: str):
    for k, v in row.items():
        if k.startswith(prefix):
            return v
    return None


class NameResolver:
    def __init__(self, people: list[Employee]):
        self.people = people
        self.by_full = {}
        for e in people:
            self.by_full.setdefault(_norm(e.full_name), []).append(e)

    def resolve(self, raw: str) -> tuple[Employee | None, dict | None]:
        n = _norm(raw).rstrip()
        if len(self.by_full.get(n, [])) == 1:
            return self.by_full[n][0], None
        if n in NAME_ALIASES:
            target = self.by_full.get(_norm(NAME_ALIASES[n]), [])
            if len(target) == 1:
                return target[0], {"level": "warn", "text": f"Name match to confirm (D7): tracker '{raw}' = {target[0].full_name} ({target[0].code})."}
        first = [e for e in self.people if _norm(e.full_name).split()[0] == n.split()[0]] if " " not in n else []
        if len(first) == 1:
            return first[0], None
        prefix = [e for e in self.people if _norm(e.full_name).split()[0].startswith(n.split()[0])] if n else []
        if len(prefix) == 1:
            return prefix[0], {"level": "warn", "text": f"Name match to confirm: tracker '{raw}' = {prefix[0].full_name} ({prefix[0].code})."}
        return None, None


def import_sales_tracker(db: Session, path: Path | None = None, actor_account_id: int | None = None) -> dict:
    """Import the Sep 2026 Sales tracker into an empty pilot. Returns a summary (also stored as an ImportBatch)."""
    path = path or settings.sales_tracker
    dept = pilot_department(db)
    if dept is None or not path.exists():
        return {"skipped": "Sales department or tracker file not found."}
    rule = ensure_rule(db)
    types = ensure_kpi_types(db)
    cfg = rule.config
    people = list(db.scalars(select(Employee).where(Employee.department_id == dept.id, Employee.record_type == "employee")))
    resolver = NameResolver(people)
    managers = {e.id for e in people if e.proposed_role == "Manager"}
    wb = openpyxl.load_workbook(path, data_only=True)
    summary = {"kpi_rows": 0, "duty_rows": 0, "unmatched": [], "flagged_rows": 0, "months": set(), "people_with_rows": set()}
    created: list[KpiItem] = []

    for sheet, kind in (("Project & Task Tracker", "kpi"), ("Extra Tasks", "duty")):
        if sheet not in wb.sheetnames:
            continue
        for row_no, r in _sheet_rows(wb[sheet]):
            title = str(_col(r, "task / deliverable") or "").strip()
            raw_name = str(_col(r, "team member") or "").strip()
            if not title and not raw_name:
                continue
            emp, name_flag = resolver.resolve(raw_name)
            if emp is None:
                summary["unmatched"].append({"sheet": sheet, "row": row_no, "name": raw_name, "task": title})
                continue
            flags = [name_flag] if name_flag else []
            target_date = _date(_col(r, "target date"))
            start = _date(_col(r, "start date"))
            m = month_start(target_date or start or date(2026, 9, 1))
            km = ensure_month(db, m, rule, dept)
            summary["months"].add(m.isoformat())

            status = str(_col(r, "status") or "").strip() or None
            completed = _date(_col(r, "completed date"))
            outcome = None
            if status and _norm(status) == "completed":
                if completed:
                    outcome = "Completed"
                else:
                    flags.append({"level": "warn", "text": "Marked Completed without a completed date. Record the date to count it in On-time."})
            elif status and _norm(status) in ("delayed", "not completed"):
                outcome = "Not completed"
            elif status:
                flags.append({"level": "info", "text": f"Tracker status '{status}' has no outcome yet; excluded from On-time until recorded."})
            on_time_src = _col(r, "on time?")
            if on_time_src and outcome == "Completed" and target_date and completed:
                said = _norm(on_time_src) == "yes"
                if said != (completed <= target_date):
                    flags.append({"level": "warn", "text": f"Tracker says On time = {on_time_src}, but the dates say otherwise."})

            item = KpiItem(
                month_id=km.id,
                employee_id=emp.id,
                kind=kind,
                title=title,
                priority=(str(_col(r, "priority") or "").strip() or None),
                start_date=start,
                target_date=target_date,
                outcome=outcome,
                completed_date=completed if outcome == "Completed" else None,
                delay_reason=(str(_col(r, "delay reason") or "").strip() or None) if not _norm(str(_col(r, "delay reason") or "")).startswith("validated") else None,
                remarks=(str(_col(r, "remarks") or "").strip() or None),
                source=SOURCE_LABEL,
                source_row=row_no,
                source_name=raw_name,
                source_status=status,
                created_by=actor_account_id,
            )
            validated = r.get("delay reason validated?") if "delay reason validated?" in r else None
            if validated and _norm(str(validated)) == "yes":
                item.delay_validated = True
                flags.append({"level": "info", "text": "Delay marked validated in the tracker (validator unknown)."})

            target_raw = _col(r, "monthly individual target")
            achieved_raw = _col(r, "monthly achieved")
            if kind == "kpi":
                code = classify(title)
                item.kpi_type_id = types[code].id
                item.is_team = bool(re.search(r"\bteam\b", title, re.I)) or emp.id in managers
                tv, ttext = parse_amount(target_raw)
                item.target_value, item.target_text = tv, ttext
                if tv is None and ttext:
                    flags.append({"level": "warn", "text": f"Non-numeric target '{ttext}'. Excluded from Achievement until a numeric target is set."})
                elif tv is not None and ttext:
                    flags.append({"level": "info", "text": f"Target '{ttext}' converted to {tv:,.0f}."})
                elif tv is None and code != "other":
                    flags.append({"level": "warn", "text": "No target set for this KPI row."})
                if code == "other":
                    flags.append({"level": "info", "text": "No numeric measure. Counts for On-time and delays only."})
                av, atext = parse_amount(achieved_raw)
                item.achieved_value = av
                if av is None and atext:
                    flags.append({"level": "warn", "text": f"Non-numeric achieved value '{atext}'."})
                pd = _PER_DAY.search(title)
                if pd:
                    item.per_day = float(pd.group(1))
                    if not item.is_team and code in ("call_volume", "client_interaction") and tv is not None:
                        expected = item.per_day * cfg["working_days"]
                        if abs(expected - tv) > 0.5:
                            flags.append({"level": "warn", "text": f"{item.per_day:g} per day x {cfg['working_days']} = {expected:,.0f}, but the monthly target is {tv:,.0f}."})
                summary["kpi_rows"] += 1
            else:
                item.target_text = (str(target_raw).strip() or None) if target_raw not in (None, "") else None
                summary["duty_rows"] += 1
            extra = [v for k, v in r.items() if k.startswith("col") and v not in (None, "")]
            if extra:
                flags.append({"level": "info", "text": f"Unlabelled value(s) in the tracker row: {', '.join(str(v) for v in extra)}."})
            item.flags = flags
            db.add(item)
            created.append(item)
            summary["people_with_rows"].add(emp.id)
    db.flush()

    # The same KPI type twice for one person in one month needs a decision.
    seen: dict[tuple, list[KpiItem]] = {}
    for it in created:
        if it.kind == "kpi" and it.kpi_type_id != types["other"].id:
            seen.setdefault((it.month_id, it.employee_id, it.kpi_type_id, it.is_team), []).append(it)
    for dupes in seen.values():
        if len(dupes) > 1:
            for it in dupes:
                it.flags = [*it.flags, {"level": "warn", "text": f"{len(dupes)} rows of this KPI type for this person this month. Confirm which applies; both count in Achievement."}]
    summary["flagged_rows"] = sum(1 for it in created if any(f["level"] == "warn" for f in it.flags))
    evaluated = [e for e in people if e.id not in {h.id for h in pilot_heads(db, dept)}]
    summary["no_targets"] = sorted(e.full_name for e in evaluated if e.id not in summary["people_with_rows"])
    summary["months"] = sorted(summary["months"])
    summary["people_with_rows"] = len(summary["people_with_rows"])
    db.add(ImportBatch(source=path.name, state="committed", summary=summary, created_by=actor_account_id))
    db.flush()
    return summary


def ensure_individual_tier(db: Session, today: date | None = None) -> dict:
    """Catalogue, rule, months (imported months plus the current one), logins and a one-time tracker import."""
    dept = pilot_department(db)
    if dept is None:
        return {}
    ensure_kpi_types(db)
    rule = ensure_rule(db)
    out: dict = {}
    if not db.scalar(select(func.count()).select_from(KpiItem)) and settings.sales_tracker.exists():
        out["import"] = import_sales_tracker(db)
    ensure_month(db, month_start(today or date.today()), rule, dept)
    out["accounts"] = ensure_sales_accounts(db)
    db.flush()
    return out
