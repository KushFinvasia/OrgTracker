"""Project R&R engine: the HR framework's worked example (doc §13) and the rules around it."""

from datetime import date, timedelta

from app.services import project_scoring as ps

RACI = [
    {"key": "A1", "letter": "A", "adjustment": 3},
    {"key": "R1", "letter": "R", "factor": 1.0, "adjustment": 4},
    {"key": "R2", "letter": "R", "factor": 1.0, "adjustment": 0},
    {"key": "R3", "letter": "R", "factor": 0.5, "adjustment": 2},
    {"key": "C1", "letter": "C", "adjustment": 2},
    {"key": "C2", "letter": "C", "adjustment": 5},
    {"key": "I1", "letter": "I"},
]
WORKED = {
    "value": {"target": 12_000_000, "actual": 13_500_000, "confirmed": True},
    "pool_rate": 0.02,
    "timelines": {"due": 10, "on_time": 8},
    "sla": {"within": 46, "total": 50},
    "rework_pct": 8,
    "errors": {"critical": 0, "minor": 2},
    "satisfaction": {"avg": 4.3, "n": 14},
    "innovation": 2,
    "collab": {"avg": 4.4, "raters": 5, "items": 1},
    "recovery": 0,
    "compliance_ok": True,
    "charter_locked": True,
    "delays": [
        {"code": "E2", "escalation_miss": False, "tagged": []},
        {"code": "C2", "escalation_miss": False, "tagged": ["R2"]},
        {"code": "C3", "escalation_miss": False, "tagged": ["A1"]},
    ],
    "raci": RACI,
}


def test_worked_example_section_3_2_scores_88_and_pays_2_40_000():
    s = ps.score(WORKED)
    assert s["points"] == {"revenue": 30, "timelines": 20, "sla": 16, "rework": 7, "errors": 8, "satisfaction": 5}
    assert (s["base"], s["collaboration"], s["bonus"], s["penalty"]) == (86, 4, 6, 4)
    assert s["score"] == 88 and s["band"] == "Gold"
    assert s["pool"] == 270_000 and s["total_units"] == 9 and s["unit_value"] == 30_000
    assert round(s["paid"]) == 240_000


def test_worked_example_doc_reading_scores_87_and_pays_2_31_000():
    s = ps.score({**WORKED, "doc_reading": True})
    assert s["score"] == 87
    by = {p["key"]: p for p in s["people"]}
    assert [by[k]["individual"] for k in ("A1", "R1", "R2", "R3", "C1", "C2")] == [88, 91, 85, 89, 89, 92]
    assert [round(by[k]["payout"]) for k in ("A1", "R1", "R2", "R3", "C1", "C2")] == [72_000, 60_000, 48_000, 24_000, 12_000, 15_000]
    assert round(s["paid"]) == 231_000 and round(s["to_fund"]) == 39_000
    assert by["I1"]["individual"] is None and by["I1"]["payout"] == 0


def test_missing_inputs_are_insufficient_data_never_zero():
    s = ps.score({**WORKED, "sla": None, "satisfaction": None})
    assert s["state"] == "Insufficient data" and s["score"] is None
    assert "TAT / SLA counts" in s["missing"] and "Stakeholder satisfaction" in s["missing"]


def test_bonus_counts_only_when_quality_is_15_or_more():
    s = ps.score({**WORKED, "rework_pct": 20, "errors": {"critical": 1, "minor": 0}, "satisfaction": {"avg": 3.0, "n": 10}})
    assert s["quality"] < 15 and s["bonus"] == 0
    assert not next(g for g in s["gates"] if g["key"] == "quality")["ok"]
    assert s["paid"] == 0  # a failed gate releases nothing


def test_delay_rules_and_caps():
    assert ps.delay_points("C1", False) == 2
    assert ps.delay_points("C1", True) == 4  # escalation miss on top of another reason
    assert ps.delay_points("C4", True) == 2  # escalation miss as the reason itself is never doubled
    assert ps.delay_points("E2", True) == 0  # excused
    assert ps.delay_points("X", False) == 2  # custom counts as controllable
    assert ps.delay_penalty([{"code": "C1", "escalation_miss": True}] * 8) == 20


def test_escalation_check_short_stage_and_normal_rule():
    def bdays(a: date, b: date) -> int:
        n, d = 0, a
        while d < b:
            d += timedelta(days=1)
            n += d.weekday() < 5
        return n

    assert ps.escalation_check(2, date(2026, 10, 14), date(2026, 10, 16), date(2026, 10, 16), bdays)["miss"] is True
    assert ps.escalation_check(2, date(2026, 10, 14), date(2026, 10, 16), date(2026, 10, 15), bdays)["miss"] is False
    assert ps.escalation_check(None, None, date(2026, 10, 23), date(2026, 10, 20), bdays)["miss"] is False
    assert ps.escalation_check(None, None, date(2026, 10, 23), None, bdays)["miss"] is True


def test_c_units_are_capped_at_a_fifth_of_the_total():
    rows = ps.units([{"letter": "A"}, {"letter": "R", "factor": 0.5}] + [{"letter": "C"}] * 6)
    c = sum(r["units"] for r in rows if r["letter"] == "C")
    assert abs(c - 0.25 * (3 + 1)) < 1e-9


def test_baseline_timing_uses_the_original_due_date():
    t = date(2026, 10, 22)
    assert ps.baseline_timing("Completed", date(2026, 10, 14), date(2026, 10, 15), None, t) == "Late"
    assert ps.baseline_timing("Completed", date(2026, 10, 14), date(2026, 10, 14), None, t) == "On time"
    assert ps.baseline_timing("In Review", date(2026, 10, 20), None, date(2026, 10, 17), t) == "Pending"
    assert ps.baseline_timing("Rework", date(2026, 10, 21), None, None, t) == "Late"
    assert ps.baseline_timing("Testing QA", date(2026, 10, 24), None, None, t) == "Not due"
    assert ps.baseline_timing("On Hold", date(2026, 10, 1), None, None, t) is None


def test_programme_raci_one_letter_per_person_with_effort_share():
    stages = [
        {"step": 1, "effort": (2, 3), "R": ["@Requester's manager"], "A": "MUKESH", "C": [], "I": ["NAVEEN"]},
        {"step": 2, "effort": (4, 8), "R": ["MITEEKSHA"], "A": "MUKESH", "C": ["@Requesting department"], "I": ["NAVEEN"]},
        {"step": 3, "effort": (2, 3), "R": ["MITEEKSHA"], "A": "@Head of requesting department", "C": ["@Compliance team"], "I": ["MUKESH"]},
        {"step": 4, "effort": (4, 6), "R": ["NAVEEN"], "A": "MUKESH", "C": ["@Email execution team"], "I": ["@Content team", "MUKESH"]},
        {"step": 5, "effort": (3, 4), "R": ["NAVEEN"], "A": "MUKESH", "C": ["NAVEEN"], "I": ["@Requesting department", "@Marketing team"]},
        {"step": 6, "effort": (0.5, 1), "R": ["NAVEEN"], "A": "MUKESH", "C": ["@Data analyst"], "I": ["@Requesting department", "@Stakeholders"]},
    ]
    rows = {r["id"]: r for r in ps.resolve_programme_raci(stages, "MUKESH")["rows"]}
    nav, mit = rows["NAVEEN"], rows["MITEEKSHA"]
    assert rows["MUKESH"]["letter"] == "A"
    assert nav["letter"] == "R" and round(nav["share"], 3) == 0.457 and "C" in nav["dropped"] and nav["suggested"] == 1.0
    assert round(mit["share"], 3) == 0.420 and mit["suggested"] == 1.0
    assert rows["@Head of requesting department"]["letter"] == "C"
