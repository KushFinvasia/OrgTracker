"""Worked examples from the handoff prompt and PDF pages 52-55, 64, 96-99."""

from datetime import date

import pytest

from app.services.scoring import (
    DEFAULT_KPI_CONFIG as CFG,
    DEFAULT_REWARD_POLICY as REWARD,
    DEFAULT_TRAINING_POLICY as POLICY,
    MetricResult,
    TrainingItem,
    aggregate_training,
    base_kpi,
    final_rr,
    interpolate,
    reward_gates,
    score_achievement,
    score_compliance,
    score_csat,
    score_on_time,
    score_quality,
    score_rating,
    tier_for,
    training_completion,
)

RE_WEIGHTS = CFG["weights"]["Revenue-Enabling"]


def normalised(**scores):
    return {m: MetricResult(m, True, s) for m, s in scores.items()}


def test_category_weights_total_100():
    for cat, weights in CFG["weights"].items():
        assert sum(weights.values()) == 100, cat


def test_interpolation_anchors_and_clamping():
    on_time = CFG["anchors"]["on_time"]
    assert interpolate(on_time, 85) == 80
    assert interpolate(on_time, 90) == 90
    assert interpolate(on_time, 30) == 0
    assert interpolate(on_time, 100) == 100
    assert interpolate(CFG["anchors"]["achievement"], 100) == 90


def test_revenue_enabling_base_kpi_86_5():
    base = base_kpi(normalised(on_time=80, achievement=90, compliance=100, quality=80, collaboration=80), RE_WEIGHTS)
    assert base["coverage"] == 100
    assert base["value"] == pytest.approx(86.5)
    assert [r["contribution"] for r in base["rows"]] == pytest.approx([24, 22.5, 20, 12, 8])


def test_training_8_of_10_is_80_not_8_of_12():
    end = date(2026, 9, 30)
    items = [TrainingItem(date(2026, 9, 1), "Verified complete", date(2026, 9, 2)) for _ in range(8)]
    items += [TrainingItem(date(2026, 9, 30), "In progress"), TrainingItem(date(2026, 9, 30), "Submitted")]
    items += [TrainingItem(date(2026, 10, 31), "In progress"), TrainingItem(date(2026, 11, 30), "Assigned")]
    t = training_completion(items, date(2026, 7, 1), end, end, date(2026, 10, 12))
    assert (t["allotted"], t["future_due"], t["eligible"], t["verified"]) == (12, 2, 10, 8)
    assert t["score"] == 80


def test_final_rr_85_85():
    base = base_kpi(normalised(on_time=80, achievement=90, compliance=100, quality=80, collaboration=80), RE_WEIGHTS)
    final = final_rr(base, {"status": "scored", "score": 80}, POLICY)
    assert final["value"] == pytest.approx(85.85)
    assert tier_for(final["value"], REWARD) == "Silver"


def test_hod_override_collaboration_90_gives_86_75():
    base = base_kpi(normalised(on_time=80, achievement=90, compliance=100, quality=80, collaboration=90), RE_WEIGHTS)
    assert base["value"] == pytest.approx(87.5)
    assert final_rr(base, {"status": "scored", "score": 80}, POLICY)["value"] == pytest.approx(86.75)


def test_team_training_aggregates_by_totals():
    team = aggregate_training([{"verified": 8, "eligible": 10, "allotted": 12}, {"verified": 1, "eligible": 2, "allotted": 3}, {"verified": 2, "eligible": 2, "allotted": 2}])
    assert round(team["score"], 2) == 78.57


def test_csat_4_4_scores_96_and_needs_30_responses():
    assert score_csat(4.4, 45, CFG).score == pytest.approx(96)
    assert not score_csat(4.4, 12, CFG).available


def test_unavailable_is_not_zero_and_low_coverage_is_insufficient():
    results = {
        "on_time": score_on_time(1, 1, CFG),  # below minimum of 3
        "achievement": score_achievement(None, None, CFG),  # no target
        "compliance": score_compliance(False, [], CFG),  # no attestation
        "quality": MetricResult("quality", True, 80),
        "collaboration": MetricResult("collaboration", True, 80),
    }
    base = base_kpi(results, RE_WEIGHTS)
    assert base["coverage"] == 25
    assert base["sufficient"] is False and base["value"] is None
    assert final_rr(base, {"status": "scored", "score": 100}, POLICY)["status"] == "insufficient"


def test_training_zero_vs_missing_vs_na():
    start, end = date(2026, 7, 1), date(2026, 9, 30)
    zero = training_completion([TrainingItem(date(2026, 8, 1), "Assigned")], start, end, end, end)
    assert zero["status"] == "scored" and zero["score"] == 0
    missing = training_completion([], start, end, end, end)
    assert missing["status"] == "readiness_exception" and missing["score"] is None
    na = training_completion([], start, end, end, end, confirmed_none_due=True)
    assert na["status"] == "na"
    base = {"sufficient": True, "value": 86.5}
    assert final_rr(base, na, POLICY)["value"] == 86.5
    assert final_rr(base, missing, POLICY)["status"] == "readiness_exception"


def test_exempt_excluded_and_verification_after_cutoff_not_counted():
    start, end = date(2026, 7, 1), date(2026, 9, 30)
    items = [
        TrainingItem(date(2026, 8, 1), "Exempt"),
        TrainingItem(date(2026, 8, 1), "Verified complete", date(2026, 10, 20)),  # verified after cutoff
        TrainingItem(date(2026, 8, 1), "Verified complete", date(2026, 9, 1)),
    ]
    t = training_completion(items, start, end, date(2026, 10, 5), date(2026, 10, 12))
    assert (t["excluded"], t["eligible"], t["verified"]) == (1, 2, 1)


def test_compliance_deductions_with_floor():
    assert score_compliance(True, ["Minor"], CFG).score == 80
    assert score_compliance(True, ["Medium", "Major"], CFG).score == 0


def test_quality_split_and_rating_evidence_rules():
    q = score_quality(2, 3, 4, CFG)
    assert q.score == pytest.approx(0.6 * 80 + 0.4 * 80)
    assert not score_quality(2, 2, 4, CFG).available
    assert not score_rating("collaboration", 5, "").available
    assert score_rating("collaboration", 4, None).score == 80
    assert not score_rating("innovation", 3, None).available


def test_tiers_use_unrounded_value():
    assert tier_for(89.996, REWARD) == "Silver"  # displays as 90.00 but is not Gold
    assert tier_for(90.0, REWARD) == "Gold"
    assert tier_for(69.99, REWARD) is None


def test_gates_unknown_is_not_pass():
    gates = reward_gates(100, False, None, None, REWARD)
    assert [g["result"] for g in gates] == ["pass", "pass", "unknown", "unknown"]
