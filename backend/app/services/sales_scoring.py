"""Pure scoring engine for the Individual Tier (Sales pilot, R&R parameters of 15 Oct 2026). No database access.

Differences from `scoring.py` (the Project Tier demo, KPI rule v2):
- Training is a 10% metric inside every category's weights, scored by TWCS. There is no 90/10 blend.
- Ratings (CSAT, Quality, Compliance, Collaboration, Innovation) are the Manager's 1-5 rating x 20.
- Final = max(0, base - per-delay penalty x delayed cases - training penalty when TWCS is below the threshold).
Unavailable metrics are never zero: they drop out of the coverage instead.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from app.services.scoring import interpolate

SALES_METRICS = ("achievement", "csat", "on_time", "quality", "compliance", "collaboration", "innovation", "training")
SALES_METRIC_LABELS = {
    "achievement": "Achievement",
    "csat": "CSAT",
    "on_time": "On-time",
    "quality": "Quality",
    "compliance": "Compliance",
    "collaboration": "Collaboration & automation",
    "innovation": "Innovation",
    "training": "Training (TWCS)",
}
RATED_METRICS = ("csat", "quality", "compliance", "collaboration", "innovation")
MODULE_TRACKS = ("Technical", "Functional", "Behavioural", "Leadership", "Compliance")

DEFAULT_SALES_CONFIG: dict = {
    "source": "R&R parameters of 15 Oct 2026; Training 10% in every category, scored by TWCS",
    "weights": {
        "Core Revenue": {"achievement": 30, "csat": 15, "on_time": 25, "quality": 20, "training": 10},
        "Revenue-Enabling": {"achievement": 20, "on_time": 25, "quality": 20, "compliance": 15, "collaboration": 10, "training": 10},
        "Support": {"on_time": 25, "quality": 20, "compliance": 10, "collaboration": 15, "innovation": 20, "training": 10},
    },
    "anchors": {
        "achievement": [[0, 0], [60, 40], [80, 60], [100, 90], [150, 100]],
        "on_time": [[45, 0], [75, 60], [85, 80], [95, 100]],
    },
    "achievement_cap": 150,
    "rating_multiplier": 20,
    "min_on_time_outcomes": 3,
    "coverage_min": 70,
    "working_days": 22,
    "penalties": {
        "per_delay_enabled": True,
        "per_delay": 2,
        "exclude_validated_delays": True,
        "training_enabled": True,
        "training_threshold": 50,
        "training_penalty": 2,
    },
    "twcs": {
        # [max days late, credit]: on or before the due date (<= 0) earns 100.
        "credits": [[0, 100], [7, 75], [14, 50]],
        "credit_beyond": 25,
        "credit_not_done": 0,
        "cutoff_day": 5,  # completions count up to this day of the next month (proposed, D10)
        "early_bonus": False,  # D11: days late are stored, negative values give no bonus
        # [minimum TWCS, band, KEKA rating], highest first
        "bands": [[90, "Recognised", 5], [75, "Standard", 4], [50, "Developing", 3], [0, "Support", 0]],
        "track_weights": {t: 1 for t in MODULE_TRACKS},
    },
    "tiers": [["Gold", 90], ["Silver", 80], ["Bronze", 70]],
    "tiers_proposed": True,
}


def _r(value: float | None, digits: int = 4) -> float | None:
    return None if value is None else round(value, digits)


# --- metrics ------------------------------------------------------------------------------------


@dataclass
class AchievementRow:
    label: str
    target: float | None
    achieved: float | None


def score_achievement(rows: list[AchievementRow], cfg: dict) -> dict:
    """Per row achieved / target x 100, capped; the person's % is the average of rows that have a target and an actual."""
    cap = cfg["achievement_cap"]
    used, skipped = [], []
    for r in rows:
        if not r.target or r.target <= 0:
            skipped.append({"label": r.label, "reason": "No numeric target"})
        elif r.achieved is None:
            skipped.append({"label": r.label, "reason": "No achieved value yet"})
        else:
            raw = r.achieved / r.target * 100
            used.append({"label": r.label, "target": r.target, "achieved": r.achieved, "pct": raw, "pct_capped": min(raw, cap)})
    if not used:
        return {"available": False, "score": None, "reason": "No KPI row has both a target and an achieved value. Unavailable, not zero.", "rows": used, "skipped": skipped}
    avg = sum(u["pct_capped"] for u in used) / len(used)
    score = interpolate(cfg["anchors"]["achievement"], avg)
    return {"available": True, "score": score, "raw": avg, "display": f"{avg:.2f}% average of {len(used)} row(s)", "rows": used, "skipped": skipped}


def score_on_time(on_time: int, delayed: int, cfg: dict) -> dict:
    total = on_time + delayed
    minimum = cfg["min_on_time_outcomes"]
    if total < minimum:
        return {"available": False, "score": None, "reason": f"{total} recorded outcome(s); minimum is {minimum}.", "on_time": on_time, "delayed": delayed}
    rate = on_time / total * 100
    return {"available": True, "score": interpolate(cfg["anchors"]["on_time"], rate), "raw": rate, "display": f"{rate:.0f}% ({on_time}/{total})", "on_time": on_time, "delayed": delayed}


def score_rating(rating: int | None, cfg: dict) -> dict:
    if rating is None:
        return {"available": False, "score": None, "reason": "No rating entered for the month."}
    if not 1 <= rating <= 5:
        raise ValueError("Ratings are 1-5.")
    return {"available": True, "score": rating * cfg["rating_multiplier"], "raw": rating, "display": f"Rating {rating} of 5"}


# --- training: Timeliness-Weighted Completion Score ----------------------------------------------


@dataclass
class Module:
    id: int | None
    title: str
    track: str
    due_date: date
    completed_date: date | None = None
    status: str = "Assigned"  # Assigned | Completed | Exemption requested | Exempt
    verified: bool = False
    assigned_date: date | None = None
    attempts: int = 1


def module_credit(m: Module, cutoff: date, cfg: dict) -> dict:
    """Credit for one module. Days late are stored even when negative; no early bonus (D11)."""
    t = cfg["twcs"]
    if m.completed_date is None:
        return {"days_late": None, "credit": float(t["credit_not_done"]), "note": "Not completed"}
    days_late = (m.completed_date - m.due_date).days
    if m.completed_date > cutoff:
        return {"days_late": days_late, "credit": float(t["credit_not_done"]), "note": "Completed after the cut-off"}
    credit = float(t["credit_beyond"])
    for max_days, value in t["credits"]:
        if days_late <= max_days:
            credit = float(value)
            break
    return {"days_late": days_late, "credit": credit, "note": "On time" if days_late <= 0 else f"{days_late} day(s) late"}


def band_for(score: float | None, cfg: dict) -> dict | None:
    if score is None:
        return None
    for minimum, name, keka in cfg["twcs"]["bands"]:
        if score >= minimum:
            return {"band": name, "keka": keka}
    return None


def twcs(modules: list[Module], start: date, end: date, cutoff: date, cfg: dict, *, confirmed_none_due: bool = False, require_verified: bool = False) -> dict:
    """Average credit over modules due in the month. Future-due modules wait; approved exemptions are excluded.

    A completion counts only once verified by someone other than the recorder. With require_verified=False (open month)
    unverified completions earn provisional credit and the result says so; at lock they earn nothing.
    """
    track_w = cfg["twcs"].get("track_weights") or {}
    due = [m for m in modules if start <= m.due_date <= end]
    future = [m for m in modules if m.due_date > end]
    exempt = [m for m in due if m.status == "Exempt"]
    counted = [m for m in due if m.status != "Exempt"]
    rows, weighted, weights, provisional = [], 0.0, 0.0, 0
    for m in counted:
        c = module_credit(m, cutoff, cfg)
        unverified = m.completed_date is not None and not m.verified
        credit = c["credit"]
        note = c["note"]
        if unverified:
            if require_verified:
                credit, note = 0.0, "Completion not verified"
            else:
                provisional += 1
                note += " (awaiting verification)"
        w = float(track_w.get(m.track, 1))
        weighted += credit * w
        weights += w
        rows.append({"id": m.id, "title": m.title, "track": m.track, "due_date": m.due_date, "completed_date": m.completed_date, "days_late": c["days_late"], "credit": credit, "note": note, "verified": m.verified, "attempts": m.attempts, "status": m.status})
    base = {"due": len(due), "counted": len(counted), "future": len(future), "exempt": len(exempt), "modules": rows, "provisional": provisional}
    if not counted:
        if confirmed_none_due:
            return {**base, "status": "na", "score": None, "band": None, "keka": None, "reason": "Confirmed: no training due this month. Training drops out of the coverage."}
        return {**base, "status": "missing", "score": None, "band": None, "keka": None, "reason": "No training modules recorded as due this month and nothing confirmed. Unavailable, not zero."}
    score = weighted / weights
    b = band_for(score, cfg)
    return {**base, "status": "scored", "score": score, "band": b["band"], "keka": b["keka"], "reason": ""}


def team_twcs(module_rows: list[dict]) -> float | None:
    """Team TWCS = average credit across all of the team's counted modules (not an average of personal scores)."""
    credits = [r["credit"] for r in module_rows]
    return sum(credits) / len(credits) if credits else None


# --- scorecard ----------------------------------------------------------------------------------


def tier_for(value: float | None, cfg: dict) -> str | None:
    """Tiers apply to the unrounded value."""
    if value is None:
        return None
    for name, threshold in cfg["tiers"]:
        if value >= threshold:
            return name
    return None


def scorecard(category: str, metrics: dict[str, dict], delayed_cases: int, training: dict | None, cfg: dict) -> dict:
    """Base = sum(score x weight) / sum(weights with data); coverage = weight with data.

    `metrics` maps metric -> {available, score, ...}; `training` is the twcs() result (its score feeds the training metric).
    """
    weights = cfg["weights"].get(category)
    if weights is None:
        raise ValueError(f"No weights configured for category {category!r}.")
    rows, avail, weighted = [], 0.0, 0.0
    for metric in SALES_METRICS:
        w = float(weights.get(metric, 0) or 0)
        if w <= 0:
            continue
        if metric == "training":
            t = training or {"status": "missing", "score": None, "reason": "Not computed."}
            m = {"available": t["status"] == "scored", "score": t.get("score"), "display": f"TWCS {t['score']:.2f} ({t['band']})" if t["status"] == "scored" else "", "reason": t.get("reason", ""), "status": t["status"]}
        else:
            m = metrics.get(metric) or {"available": False, "score": None, "reason": "Not computed."}
        contribution = None
        if m.get("available") and m.get("score") is not None:
            avail += w
            contribution = m["score"] * w / 100
            weighted += m["score"] * w
        rows.append({"metric": metric, "label": SALES_METRIC_LABELS[metric], "weight": w, "available": bool(m.get("available")), "score": _r(m.get("score")), "raw": _r(m.get("raw")), "display": m.get("display", ""), "reason": m.get("reason", ""), "contribution": _r(contribution)})
    coverage = avail  # category weights total 100
    base = weighted / avail if avail else None
    sufficient = base is not None and coverage >= cfg["coverage_min"]

    p = cfg["penalties"]
    penalties = []
    if p.get("per_delay_enabled") and delayed_cases:
        penalties.append({"kind": "delay", "label": f"{delayed_cases} delayed case(s) x {p['per_delay']}", "points": delayed_cases * p["per_delay"]})
    if p.get("training_enabled") and training and training["status"] == "scored" and training["score"] < p["training_threshold"]:
        penalties.append({"kind": "training", "label": f"TWCS below {p['training_threshold']} (Support band)", "points": p["training_penalty"]})
    total_penalty = sum(x["points"] for x in penalties)

    final = max(0.0, base - total_penalty) if sufficient else None
    status = "scored" if sufficient else "insufficient"
    return {
        "category": category,
        "rows": rows,
        "coverage": coverage,
        "base": base if sufficient else None,
        "base_preview": base,
        "penalties": penalties,
        "penalty_total": total_penalty,
        "final": final,
        "status": status,
        "tier": tier_for(final, cfg),
        "explanation": "" if sufficient else f"Coverage {coverage:.0f}% is below {cfg['coverage_min']}%: Insufficient data. Missing metrics are never scored as zero.",
    }
