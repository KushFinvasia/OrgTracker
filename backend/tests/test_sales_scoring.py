"""Individual Tier (Sales pilot) scoring: the test vectors from CLAUDE.md section 21."""

import copy
from datetime import date

import pytest

from app.services.sales_scoring import (
    DEFAULT_SALES_CONFIG,
    AchievementRow,
    Module,
    band_for,
    module_credit,
    score_achievement,
    score_on_time,
    score_rating,
    scorecard,
    team_twcs,
    tier_for,
    twcs,
)

CFG = DEFAULT_SALES_CONFIG
SEP = (date(2026, 9, 1), date(2026, 9, 30), date(2026, 10, 5))


def _person(training_score=70.0, csat=4, training_status="scored", delays=1):
    ach = score_achievement([AchievementRow("Calls", 4180, 4000), AchievementRow("Interaction", 1881, 1900), AchievementRow("Accounts", 410, 380)], CFG)
    metrics = {"achievement": ach, "csat": score_rating(csat, CFG), "on_time": score_on_time(3, 0, CFG), "quality": score_rating(4, CFG)}
    training = {"status": training_status, "score": training_score if training_status == "scored" else None, "band": band_for(training_score, CFG)["band"] if training_status == "scored" else None}
    return scorecard("Core Revenue", metrics, delays, training, CFG)


def test_weights_total_100_with_training_10():
    for category, w in CFG["weights"].items():
        assert sum(w.values()) == 100, category
        assert w["training"] == 10


def test_achievement_average_of_capped_rows():
    r = score_achievement([AchievementRow("a", 4180, 4000), AchievementRow("b", 1881, 1900), AchievementRow("c", 410, 380)], CFG)
    assert [round(x["pct"], 2) for x in r["rows"]] == [95.69, 101.01, 92.68]
    assert round(r["raw"], 2) == 96.46
    assert round(r["score"], 2) == 84.69


def test_achievement_kulwinder():
    r = score_achievement([AchievementRow("Calls", 4400, 4000)], CFG)
    assert round(r["raw"], 2) == 90.91 and round(r["score"], 2) == 76.36


def test_achievement_unavailable_without_actuals_or_targets():
    r = score_achievement([AchievementRow("Calls", 4400, None), AchievementRow("Conversion", None, None)], CFG)
    assert r["available"] is False and r["score"] is None
    assert len(r["skipped"]) == 2


def test_achievement_row_capped_at_150():
    r = score_achievement([AchievementRow("Accounts", 100, 400)], CFG)
    assert r["raw"] == 150 and r["score"] == 100


def test_base_and_one_delay_is_silver():
    s = _person()
    contributions = {row["metric"]: round(row["contribution"], 2) for row in s["rows"]}
    assert contributions == {"achievement": 25.41, "csat": 12.0, "on_time": 25.0, "quality": 16.0, "training": 7.0}
    assert round(s["base"], 2) == 85.41
    assert round(s["final"], 2) == 83.41 and s["tier"] == "Silver"


def test_twcs_below_50_adds_training_penalty():
    s = _person(training_score=40.0)
    assert round(s["base"], 2) == 82.41
    assert s["penalty_total"] == 4
    assert round(s["final"], 2) == 78.41 and s["tier"] == "Bronze"


def test_missing_csat_reduces_coverage_not_score():
    ach = score_achievement([AchievementRow("a", 4180, 4000), AchievementRow("b", 1881, 1900), AchievementRow("c", 410, 380)], CFG)
    metrics = {"achievement": ach, "csat": score_rating(None, CFG), "on_time": score_on_time(3, 0, CFG), "quality": score_rating(4, CFG)}
    s = scorecard("Core Revenue", metrics, 0, {"status": "scored", "score": 70.0, "band": "Developing"}, CFG)
    assert s["coverage"] == 85 and round(s["base"], 2) == 86.36


def test_no_training_due_drops_training_weight():
    s = _person(training_status="na", delays=0)
    assert s["coverage"] == 90 and round(s["base"], 2) == 87.12
    assert s["penalty_total"] == 0


def test_insufficient_coverage_has_no_final():
    metrics = {"csat": score_rating(4, CFG), "quality": score_rating(4, CFG)}
    s = scorecard("Core Revenue", metrics, 0, {"status": "na", "score": None}, CFG)
    assert s["coverage"] == 35 and s["status"] == "insufficient"
    assert s["final"] is None and s["tier"] is None


def test_final_never_below_zero():
    metrics = {"achievement": {"available": True, "score": 0}, "csat": score_rating(1, CFG), "on_time": score_on_time(0, 5, CFG), "quality": score_rating(1, CFG)}
    s = scorecard("Core Revenue", metrics, 10, {"status": "scored", "score": 0.0, "band": "Support"}, CFG)
    assert s["final"] == 0


def test_penalties_can_be_switched_off():
    cfg = copy.deepcopy(CFG)
    cfg["penalties"]["per_delay_enabled"] = False
    cfg["penalties"]["training_enabled"] = False
    s = scorecard("Core Revenue", {"achievement": {"available": True, "score": 90}, "on_time": score_on_time(3, 0, cfg), "csat": score_rating(4, cfg), "quality": score_rating(4, cfg)}, 3, {"status": "scored", "score": 10.0, "band": "Support"}, cfg)
    assert s["penalty_total"] == 0


def test_on_time_minimum_outcomes():
    assert score_on_time(1, 1, CFG)["available"] is False
    r = score_on_time(3, 0, CFG)
    assert r["raw"] == 100 and r["score"] == 100


@pytest.mark.parametrize(
    "completed,credit,days",
    [
        (date(2026, 9, 10), 100, -5),
        (date(2026, 9, 15), 100, 0),
        (date(2026, 9, 16), 75, 1),
        (date(2026, 9, 22), 75, 7),
        (date(2026, 9, 25), 50, 10),
        (date(2026, 9, 29), 50, 14),
        (date(2026, 9, 30), 25, 15),
        (None, 0, None),
    ],
)
def test_module_credit_bands(completed, credit, days):
    m = Module(1, "Course", "Technical", date(2026, 9, 15), completed, "Completed" if completed else "Assigned", True)
    c = module_credit(m, date(2026, 10, 5), CFG)
    assert c["credit"] == credit and c["days_late"] == days


def test_completion_after_cutoff_earns_nothing():
    m = Module(1, "Course", "Technical", date(2026, 9, 28), date(2026, 10, 7), "Completed", True)
    assert module_credit(m, date(2026, 10, 5), CFG)["credit"] == 0


def test_twcs_worked_example_is_70():
    due = date(2026, 9, 20)
    mods = [
        Module(1, "A", "Technical", due, due, "Completed", True),
        Module(2, "B", "Functional", due, date(2026, 9, 18), "Completed", True),
        Module(3, "C", "Behavioural", due, due, "Completed", True),
        Module(4, "D", "Compliance", due, date(2026, 9, 30), "Completed", True),
        Module(5, "E", "Leadership", due, None),
        Module(6, "Future", "Technical", date(2026, 10, 20)),
        Module(7, "Exempt", "Technical", due, None, "Exempt"),
    ]
    r = twcs(mods, *SEP, CFG)
    assert r["score"] == 70 and r["band"] == "Developing" and r["keka"] == 3
    assert r["counted"] == 5 and r["future"] == 1 and r["exempt"] == 1


def test_twcs_unverified_is_provisional_then_zero_at_lock():
    mods = [Module(1, "A", "Technical", date(2026, 9, 20), date(2026, 9, 20), "Completed", False)]
    open_month = twcs(mods, *SEP, CFG)
    assert open_month["score"] == 100 and open_month["provisional"] == 1
    locked = twcs(mods, *SEP, CFG, require_verified=True)
    assert locked["score"] == 0 and locked["band"] == "Support"


def test_twcs_na_versus_missing():
    assert twcs([], *SEP, CFG, confirmed_none_due=True)["status"] == "na"
    assert twcs([], *SEP, CFG)["status"] == "missing"


@pytest.mark.parametrize("score,band,keka", [(95, "Recognised", 5), (90, "Recognised", 5), (89.99, "Standard", 4), (75, "Standard", 4), (50, "Developing", 3), (49.99, "Support", 0)])
def test_twcs_bands_and_keka(score, band, keka):
    assert band_for(score, CFG) == {"band": band, "keka": keka}


def test_team_twcs_averages_all_modules():
    assert team_twcs([{"credit": 100}, {"credit": 50}, {"credit": 0}, {"credit": 100}]) == 62.5
    assert team_twcs([]) is None


def test_tiers_on_unrounded_value():
    assert tier_for(89.999, CFG) == "Silver"
    assert tier_for(90, CFG) == "Gold"
    assert tier_for(69.99, CFG) is None
