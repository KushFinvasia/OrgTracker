"""Pure scoring engine (no database access).

Every metric is scored 0-100 by linear interpolation between configured anchors, clamped at the endpoints.
Unavailable metrics are never replaced with zero: they reduce coverage instead.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import date

METRICS = ("on_time", "achievement", "compliance", "csat", "quality", "collaboration", "innovation", "productivity")
METRIC_LABELS = {
    "on_time": "On-time",
    "achievement": "Achievement",
    "compliance": "Compliance",
    "csat": "CSAT",
    "quality": "Quality",
    "collaboration": "Collaboration",
    "innovation": "Innovation",
    "productivity": "Productivity",
}
CATEGORIES = ("Core Revenue", "Revenue-Enabling", "Support", "Customer Service")

DEFAULT_KPI_CONFIG: dict = {
    "weights": {
        "Core Revenue": {"on_time": 20, "achievement": 30, "compliance": 0, "csat": 25, "quality": 15, "collaboration": 10, "innovation": 0, "productivity": 0},
        "Revenue-Enabling": {"on_time": 30, "achievement": 25, "compliance": 20, "csat": 0, "quality": 15, "collaboration": 10, "innovation": 0, "productivity": 0},
        "Support": {"on_time": 20, "achievement": 0, "compliance": 10, "csat": 0, "quality": 25, "collaboration": 25, "innovation": 20, "productivity": 0},
        "Customer Service": {"on_time": 20, "achievement": 15, "compliance": 10, "csat": 30, "quality": 25, "collaboration": 0, "innovation": 0, "productivity": 0},
    },
    "proposed_categories": ["Customer Service"],
    "anchors": {
        "on_time": [[45, 0], [75, 60], [85, 80], [95, 100]],
        "achievement": [[0, 0], [60, 40], [80, 60], [100, 90], [150, 100]],
        "csat": [[1, 0], [3, 60], [4, 80], [4.5, 100]],
        "rework": [[0, 100], [2, 80], [5, 60], [15, 0]],
        "productivity": [[0.2, 0], [0.8, 60], [1.0, 80], [1.2, 100]],
    },
    "minimums": {
        "coverage": 70,
        "on_time_assignments": 3,
        "csat_responses": 30,
        "quality_reviewed_tasks": 3,
        "productivity_team_size": 3,
        "productivity_available_days": 10,
    },
    "achievement_cap": 150,
    "compliance_deductions": {"Minor": 20, "Medium": 40, "Major": 100},
    "quality_split": {"rework": 0.6, "rating": 0.4},
}

DEFAULT_TRAINING_POLICY: dict = {
    "base_weight": 0.90,
    "training_weight": 0.10,
    "equal_course_weight": True,
    "eligibility": "Due date in force within period",
    "completion_requirement": "Verified criteria met by cutoff",
    "no_due_treatment": "N/A / base KPI unchanged",
}

DEFAULT_REWARD_POLICY: dict = {
    "tiers": [["Gold", 90], ["Silver", 80], ["Bronze", 70]],
    "min_coverage": 70,
    "min_days_in_role": 60,
    "gold_cap_pct": 10,
    "tie_breakers": ["productivity", "on_time"],
    "citation_min_words": 50,
}


def interpolate(anchors: list[list[float]], x: float) -> float:
    """Linear interpolation between sorted anchors; clamp outside the range."""
    pts = sorted(anchors, key=lambda p: p[0])
    if x <= pts[0][0]:
        return float(pts[0][1])
    if x >= pts[-1][0]:
        return float(pts[-1][1])
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        if x0 <= x <= x1:
            return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return float(pts[-1][1])  # unreachable


@dataclass
class MetricResult:
    metric: str
    available: bool
    score: float | None = None
    raw: float | None = None
    raw_display: str = ""
    reason: str = ""  # why unavailable / how computed
    detail: dict = field(default_factory=dict)

    @property
    def label(self) -> str:
        return METRIC_LABELS[self.metric]

    def to_dict(self) -> dict:
        d = asdict(self)
        d["label"] = self.label
        return d


def unavailable(metric: str, reason: str, **detail) -> MetricResult:
    return MetricResult(metric=metric, available=False, reason=reason, detail=detail)


# --- individual metrics -------------------------------------------------------------------------


def score_on_time(eligible: int, on_time: int, cfg: dict) -> MetricResult:
    minimum = cfg["minimums"]["on_time_assignments"]
    if eligible < minimum:
        return unavailable("on_time", f"{eligible} eligible accepted assignments; minimum is {minimum}.", eligible=eligible, on_time=on_time)
    rate = on_time / eligible * 100
    return MetricResult("on_time", True, interpolate(cfg["anchors"]["on_time"], rate), rate, f"{rate:.0f}% eligible rate ({on_time}/{eligible})", "", {"eligible": eligible, "on_time": on_time})


def score_achievement(target: float | None, actual: float | None, cfg: dict) -> MetricResult:
    if not target:
        return unavailable("achievement", "No approved target for the period. Unavailable, not zero.")
    if actual is None:
        return unavailable("achievement", "No validated actual for the period.")
    pct = min(actual / target * 100, cfg["achievement_cap"])
    return MetricResult("achievement", True, interpolate(cfg["anchors"]["achievement"], pct), pct, f"{pct:.0f}% of target", "", {"target": target, "actual": actual})


def score_compliance(attested: bool, validated_incident_severities: list[str], cfg: dict) -> MetricResult:
    """Only incidents with validated severity AND validated individual attribution are passed in."""
    if not attested:
        return unavailable("compliance", "No validated period attestation. An empty incident register does not prove 100.")
    deductions = cfg["compliance_deductions"]
    score = max(0.0, 100.0 - sum(deductions.get(s, 0) for s in validated_incident_severities))
    label = "Validated attestation" if not validated_incident_severities else f"{len(validated_incident_severities)} validated attributable incident(s)"
    return MetricResult("compliance", True, score, None, label, "", {"incidents": validated_incident_severities})


def score_csat(average: float | None, responses: int, cfg: dict) -> MetricResult:
    minimum = cfg["minimums"]["csat_responses"]
    if average is None:
        return unavailable("csat", "No validated CSAT batch for the period.")
    if responses < minimum:
        return unavailable("csat", f"{responses} responses; minimum is {minimum}.", responses=responses, average=average)
    return MetricResult("csat", True, interpolate(cfg["anchors"]["csat"], average), average, f"{average:.2f} avg / {responses} responses", "", {"responses": responses})


def score_quality(rework_pct: float | None, reviewed_tasks: int, manager_rating: int | None, cfg: dict) -> MetricResult:
    minimum = cfg["minimums"]["quality_reviewed_tasks"]
    missing = []
    if rework_pct is None or reviewed_tasks < minimum:
        missing.append(f"rework evidence needs {minimum} reviewed tasks ({reviewed_tasks} available)")
    if manager_rating is None:
        missing.append("manager quality rating missing")
    if missing:
        return unavailable("quality", "Readiness issue: " + "; ".join(missing) + ".", reviewed_tasks=reviewed_tasks)
    split = cfg["quality_split"]
    rework_score = interpolate(cfg["anchors"]["rework"], rework_pct)
    score = split["rework"] * rework_score + split["rating"] * manager_rating * 20
    return MetricResult(
        "quality", True, score, rework_pct, f"{rework_pct:.0f}% rework + rating {manager_rating}", "",
        {"rework_score": rework_score, "rating": manager_rating, "reviewed_tasks": reviewed_tasks},
    )


def score_rating(metric: str, rating: int | None, evidence: str | None) -> MetricResult:
    if rating is None:
        return unavailable(metric, "No finalized check-in rating for the period.")
    needs_evidence = metric == "innovation" or rating in (1, 2, 5)
    if needs_evidence and not (evidence or "").strip():
        return unavailable(metric, f"Rating {rating} requires supporting evidence under the rubric.")
    return MetricResult(metric, True, rating * 20.0, rating, f"Rating {rating} of 5")


def score_productivity(ratio: float | None, team_size: int, available_days: float | None, cfg: dict) -> MetricResult:
    mins = cfg["minimums"]
    if ratio is None or team_size < mins["productivity_team_size"] or (available_days or 0) < mins["productivity_available_days"]:
        return unavailable("productivity", f"Needs a team of {mins['productivity_team_size']}+ and {mins['productivity_available_days']}+ available days.")
    return MetricResult("productivity", True, interpolate(cfg["anchors"]["productivity"], ratio), ratio, f"{ratio:.2f}x team benchmark")


# --- aggregation --------------------------------------------------------------------------------


def base_kpi(results: dict[str, MetricResult], weights: dict[str, float], min_coverage: float = 70) -> dict:
    """Base KPI = sum(score x available weight) / sum(available weight). Coverage = available weight."""
    rows = []
    avail_weight = 0.0
    weighted = 0.0
    for metric in METRICS:
        w = float(weights.get(metric, 0))
        if w <= 0:
            continue
        r = results.get(metric) or unavailable(metric, "Not computed.")
        contribution = None
        if r.available and r.score is not None:
            avail_weight += w
            contribution = r.score * w / 100
            weighted += r.score * w
        rows.append({**r.to_dict(), "weight": w, "contribution": contribution})
    coverage = avail_weight  # weights are percentages summing to 100
    value = weighted / avail_weight if avail_weight else None
    sufficient = coverage >= min_coverage and value is not None
    return {"value": value if sufficient else None, "preview": value, "coverage": coverage, "sufficient": sufficient, "rows": rows}


@dataclass
class TrainingItem:
    due_date: date
    status: str
    verified_on: date | None = None
    code: str = ""
    title: str = ""


def training_completion(items: list[TrainingItem], start: date, end: date, cutoff: date, today: date, confirmed_none_due: bool = False) -> dict:
    """Verified eligible completions / eligible due assignments x 100. Courses count equally (proposed baseline)."""
    excluded_states = {"Exempt", "Cancelled"}
    allotted = len(items)
    future = [i for i in items if i.due_date > end]
    in_window = [i for i in items if start <= i.due_date <= end]
    excluded = [i for i in in_window if i.status in excluded_states]
    eligible = [i for i in in_window if i.status not in excluded_states]
    verified = [i for i in eligible if i.status == "Verified complete" and i.verified_on and i.verified_on <= cutoff]
    pending = [i for i in eligible if i.status == "Submitted"]
    in_progress = [i for i in eligible if i.status in ("Assigned", "In progress", "Returned")]
    overdue = [i for i in eligible if i not in verified and i.due_date < today]
    n, d = len(verified), len(eligible)
    if d == 0:
        status = "na" if confirmed_none_due else "readiness_exception"
        score = None
    else:
        status = "scored"
        score = n / d * 100
    return {
        "allotted": allotted,
        "future_due": len(future),
        "excluded": len(excluded),
        "eligible": d,
        "verified": n,
        "pending_verification": len(pending),
        "in_progress": len(in_progress),
        "uncompleted": d - n,
        "overdue": len(overdue),
        "score": score,
        "status": status,
        "ledger": {
            "verified": [i.code for i in verified],
            "pending": [i.code for i in pending],
            "in_progress": [i.code for i in in_progress],
            "future": [i.code for i in future],
            "excluded": [i.code for i in excluded],
        },
    }


def aggregate_training(rows: list[dict]) -> dict:
    """Team rate by totals, never by averaging percentages."""
    n = sum(r["verified"] for r in rows)
    d = sum(r["eligible"] for r in rows)
    return {"verified": n, "eligible": d, "allotted": sum(r["allotted"] for r in rows), "score": (n / d * 100) if d else None}


def final_rr(base: dict, training: dict | None, policy: dict | None) -> dict:
    """Final R&R = base x 0.90 + training x 0.10 under the (proposed) policy."""
    if not base["sufficient"]:
        return {"status": "insufficient", "value": None, "explanation": "Base KPI coverage below threshold. Training cannot rescue it."}
    b = base["value"]
    if policy is None:
        return {"status": "scored", "value": b, "explanation": "No training policy applied; final equals base KPI."}
    if training is None or training["status"] == "readiness_exception":
        return {"status": "readiness_exception", "value": None, "explanation": "Training records are missing or unknown. Not assumed 0%, 100% or N/A."}
    if training["status"] == "na":
        return {"status": "scored", "value": b, "explanation": "Confirmed no applicable training due: N/A, base KPI retained."}
    bw, tw = policy["base_weight"], policy["training_weight"]
    value = b * bw + training["score"] * tw
    return {
        "status": "scored",
        "value": value,
        "base_part": b * bw,
        "training_part": training["score"] * tw,
        "explanation": f"{b:.2f} x {bw:.0%} + {training['score']:.2f} x {tw:.0%}",
    }


def tier_for(value: float | None, reward_policy: dict) -> str | None:
    """Apply tiers to the unrounded stored value."""
    if value is None:
        return None
    for name, threshold in reward_policy["tiers"]:
        if value >= threshold:
            return name
    return None


def reward_gates(coverage: float, major_incident: bool, days_in_role: int | None, disciplinary: str | None, reward_policy: dict) -> list[dict]:
    """Each gate reports pass / fail / unknown with its source. A high score never bypasses a gate."""

    def g(name, ok, source):
        return {"gate": name, "result": "pass" if ok is True else "fail" if ok is False else "unknown", "source": source}

    return [
        g(f"KPI coverage >= {reward_policy['min_coverage']}%", coverage >= reward_policy["min_coverage"], "Locked metric availability"),
        g("No validated Major incident", not major_incident, "Severity and attribution records"),
        g(f">= {reward_policy['min_days_in_role']} days in role", None if days_in_role is None else days_in_role >= reward_policy["min_days_in_role"], "Effective-dated HR reporting"),
        g("No active disciplinary action", None if disciplinary is None else disciplinary == "clear", "Restricted authorised attestation"),
    ]
