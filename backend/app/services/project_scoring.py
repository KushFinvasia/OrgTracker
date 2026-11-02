"""Project R&R scoring engine (HR Strategy framework draft v1.0, policy PR-1, proposed). Pure: no database access.

A project is scored out of 100 (+10 bonus, delays capped at -20), then the reward pool is split across people by RACI units.
Delivery timelines and delays come from tasks: one late task (against its baseline due date) is one delay. Every value that
is missing stays missing: the result is "Insufficient data", never a zero.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import date

POLICY_CODE = "PR-1"

# Delay reasons (user list, 23 Oct 2026). Controllable reasons cost -2; excused reasons need written evidence.
# A custom reason counts as controllable until the PMO validator re-categorises it.
DELAY_REASONS = [
    {"code": "C1", "label": "Planning / estimation", "help": "The plan or effort estimate was too optimistic", "controllable": True},
    {"code": "C2", "label": "Rework / resource unavailable", "help": "Work came back for rework, or a person or resource wasn't available", "controllable": True},
    {"code": "C3", "label": "Delay in compliances", "help": "A compliance check, approval or filing ran late", "controllable": True},
    {"code": "C4", "label": "Escalation miss", "help": "The slip wasn't flagged in time for anyone to act", "controllable": True},
    {"code": "E1", "label": "Client-caused", "help": "The requesting department or client was late with a brief, input or sign-off", "controllable": False},
    {"code": "E2", "label": "External dependency", "help": "Vendor, another department, regulator or outage outside the team's control", "controllable": False},
    {"code": "E3", "label": "Approved scope or baseline change", "help": "Only if the change request was approved before the due date", "controllable": False},
    {"code": "X", "label": "Custom", "help": "Describe the reason. It counts as controllable until the PMO validator decides otherwise", "controllable": True},
]
REASON_CODES = {r["code"] for r in DELAY_REASONS}
BANDS = ("Platinum", "Gold", "Silver", "Bronze", "Review")
PARAMETER_MAX = {"revenue": 30, "timelines": 25, "sla": 20, "rework": 10, "errors": 8, "satisfaction": 7}


def controllable(code: str | None) -> bool:
    return next((r["controllable"] for r in DELAY_REASONS if r["code"] == code), True)


def reason_label(code: str | None, custom: str | None = None) -> str:
    if code == "X":
        return f"Custom: {custom}" if custom else "Custom"
    return next((r["label"] for r in DELAY_REASONS if r["code"] == code), code or "")


# --- slabs -----------------------------------------------------------------------------------------------------------


def revenue_points(pct: float) -> int:
    return 30 if pct >= 100 else 24 if pct >= 90 else 18 if pct >= 80 else 10 if pct >= 70 else 0


def timelines_points(pct: float) -> int:
    return 25 if pct >= 90 else 20 if pct >= 80 else 14 if pct >= 70 else 8 if pct >= 60 else 0


def sla_points(pct: float) -> int:
    return 20 if pct >= 95 else 16 if pct >= 90 else 11 if pct >= 80 else 6 if pct >= 70 else 0


def rework_points(pct: float) -> int:
    return 10 if pct <= 5 else 7 if pct <= 10 else 4 if pct <= 15 else 0


def error_points(critical: int, minor: int) -> int:
    if critical >= 2:
        return 0
    if critical == 1:
        return 2
    return 8 if minor <= 2 else 5 if minor <= 5 else 2


def satisfaction_points(avg: float) -> int:
    return 7 if avg >= 4.5 else 5 if avg >= 4.0 else 3 if avg >= 3.5 else 0


def collaboration_points(avg: float | None, raters: int, items: int, doc_reading: bool = False) -> int:
    """Framework §3.2: +3 for outside feedback of 4 or more from at least 3 raters, plus up to +2 for help or a playbook.
    The doc's §13 example reads it as +3 in total (open decision P9); `doc_reading` applies that reading."""
    feedback = 3 if raters >= 3 and avg is not None and avg >= 4 else 0
    return min(5, feedback + (0 if doc_reading else min(2, items)))


def band(score: float) -> str:
    return "Platinum" if score >= 90 else "Gold" if score >= 80 else "Silver" if score >= 70 else "Bronze" if score >= 60 else "Review"


def payout_pct(b: str) -> float:
    return {"Platinum": 1.0, "Gold": 0.8, "Silver": 0.6}.get(b, 0.0)


# --- delays ----------------------------------------------------------------------------------------------------------


def delay_points(code: str, escalation_miss: bool) -> int:
    """Points one delay costs: -2 when controllable, -2 more for an escalation miss on top of another reason, max -4."""
    if not controllable(code):
        return 0
    return min(4, 2 + (2 if escalation_miss and code != "C4" else 0))


def delay_penalty(delays: list[dict]) -> int:
    return min(20, sum(delay_points(d["code"], d.get("escalation_miss", False)) for d in delays))


def escalation_check(sla_days: float | None, stage_start: date | None, due: date, flagged: date | None, business_days: Callable[[date, date], int]) -> dict:
    """Was the slip flagged in time? Normally 2 business days before the due date; on short stages (SLA of 3 bd or less)
    before half the stage SLA has elapsed (open decision P11). `business_days(a, b)` counts business days after a up to b."""
    if flagged is None:
        return {"miss": True, "why": "Not flagged yet"}
    if sla_days and sla_days <= 3 and stage_start:
        used, half = business_days(stage_start, flagged), sla_days / 2
        return {"miss": used > half, "why": f"Short stage ({sla_days:g} bd SLA): flagged after {used} bd, limit {half:g} bd"}
    before = business_days(flagged, due) if flagged <= due else -business_days(due, flagged)
    return {"miss": before < 2, "why": f"Flagged {before} business day(s) before the due date, needs 2"}


def baseline_timing(status: str, baseline_due: date | None, accepted_on: date | None, submitted_on: date | None, today: date) -> str | None:
    """Timing against the locked baseline (the task's original due date). An approved date change is an E3 excuse, never a new
    baseline. Completed work is judged by its accepted submission date; In Review on time waits for the decision."""
    if not baseline_due or status in ("Cancelled", "On Hold"):
        return None
    if status == "Completed":
        return "On time" if accepted_on and accepted_on <= baseline_due else "Late"
    if status == "In Review":
        return "Late" if submitted_on and submitted_on > baseline_due else "Pending"
    return "Late" if baseline_due < today else "Not due"


# --- units and score ------------------------------------------------------------------------------------------------


def units(raci: list[dict]) -> list[dict]:
    """A = 3, R = 2 x contribution factor, C = 0.5 each (all C together capped at 20% of the total, i.e. 0.25 x (A + R)), I = 0."""
    a = sum(3 for x in raci if x["letter"] == "A")
    r = sum(2 * (x.get("factor") or 0) for x in raci if x["letter"] == "R")
    cs = sum(0.5 for x in raci if x["letter"] == "C")
    cap = 0.25 * (a + r)
    scale = cap / cs if cs > cap and cs > 0 else 1
    out = []
    for x in raci:
        u = 3 if x["letter"] == "A" else 2 * (x.get("factor") or 0) if x["letter"] == "R" else 0.5 * scale if x["letter"] == "C" else 0
        out.append({**x, "units": u})
    return out


MISSING_LABELS = {
    "value": "Value actual confirmed by Finance",
    "timelines": "Delivery timelines (tasks with baseline dates)",
    "sla": "TAT / SLA counts",
    "rework": "Rework % of effort",
    "errors": "Errors after go-live",
    "satisfaction": "Stakeholder satisfaction",
}


def score(inp: dict) -> dict:
    """Score one project. `inp` keys: value {target, actual, confirmed}, pool_rate, timelines {due, on_time}, sla {within, total},
    rework_pct, errors {critical, minor}, satisfaction {avg, n}, innovation, collab {avg, raters, items}, recovery, compliance_ok,
    charter_locked, delays [{code, escalation_miss, tagged}], raci [{key, letter, factor, adjustment}], doc_reading."""
    value = inp.get("value") or {}
    missing = []
    if not (value.get("target") and value.get("actual") is not None):
        missing.append("value")
    tl = inp.get("timelines") or {}
    if not tl.get("due"):
        missing.append("timelines")
    sla = inp.get("sla")
    if not (sla and sla.get("total")):
        missing.append("sla")
    for k in ("rework", "errors", "satisfaction"):
        src = inp.get("rework_pct") if k == "rework" else inp.get(k)
        if src is None:
            missing.append(k)
    delays = inp.get("delays") or []
    penalty = delay_penalty(delays)
    if missing:
        return {"state": "Insufficient data", "missing": [MISSING_LABELS[m] for m in missing], "penalty": penalty, "score": None, "band": None}

    value_pct = value["actual"] / value["target"] * 100
    pts = {
        "revenue": revenue_points(value_pct),
        "timelines": timelines_points(tl["on_time"] / tl["due"] * 100),
        "sla": sla_points(sla["within"] / sla["total"] * 100),
        "rework": rework_points(inp["rework_pct"]),
        "errors": error_points(inp["errors"]["critical"], inp["errors"]["minor"]),
        "satisfaction": satisfaction_points(inp["satisfaction"]["avg"]),
    }
    quality = pts["rework"] + pts["errors"] + pts["satisfaction"]
    base = pts["revenue"] + pts["timelines"] + pts["sla"] + quality
    collab = inp.get("collab") or {}
    collab_pts = collaboration_points(collab.get("avg"), collab.get("raters", 0), collab.get("items", 0), inp.get("doc_reading", False))
    bonus = min(10, (inp.get("innovation") or 0) + collab_pts) if quality >= 15 else 0
    recovery = min(6, inp.get("recovery") or 0)
    total = max(0, min(110, base + bonus - penalty + recovery))
    b = band(total)
    gates = [
        {"key": "baseline", "label": "Baseline locked at kickoff", "ok": bool(inp.get("charter_locked")), "source": inp.get("locked_source", "")},
        {"key": "quality", "label": "Quality 15 or more", "ok": quality >= 15, "source": f"{quality} of 25"},
        {"key": "finance", "label": "Value confirmed by Finance", "ok": bool(value.get("confirmed")), "source": value.get("source", "")},
        {"key": "compliance", "label": "No attributable compliance breach", "ok": bool(inp.get("compliance_ok")), "source": inp.get("compliance_source", "")},
    ]
    gates_ok = all(g["ok"] for g in gates)
    pool = value["actual"] * (inp.get("pool_rate") or 0)
    with_units = units(inp.get("raci") or [])
    total_units = sum(x["units"] for x in with_units)
    people = []
    for x in with_units:
        if x["letter"] == "I":
            people.append({**x, "tagged": 0, "individual": None, "band": None, "payout_pct": None, "share": 0, "payout": 0})
            continue
        tagged = min(10, sum(2 for d in delays if controllable(d["code"]) and x.get("key") in (d.get("tagged") or [])))
        indiv = max(0, min(110, total + (x.get("adjustment") or 0) - tagged))
        pb = band(indiv)
        share = x["units"] / total_units * pool if total_units else 0
        paid = share * payout_pct(pb) if gates_ok and total >= 70 else 0
        people.append({**x, "tagged": tagged, "individual": indiv, "band": pb, "payout_pct": payout_pct(pb), "share": share, "payout": paid})
    paid = sum(p["payout"] for p in people)
    return {
        "state": "Scored",
        "missing": [],
        "value_pct": value_pct,
        "timelines_pct": tl["on_time"] / tl["due"] * 100,
        "sla_pct": sla["within"] / sla["total"] * 100,
        "points": pts,
        "quality": quality,
        "base": base,
        "collaboration": collab_pts,
        "bonus": bonus,
        "penalty": penalty,
        "recovery": recovery,
        "score": total,
        "band": b,
        "gates": gates,
        "gates_ok": gates_ok,
        "pool": pool,
        "total_units": total_units,
        "unit_value": pool / total_units if total_units else None,
        "people": people,
        "paid": paid,
        "to_fund": pool - paid,
    }


# --- programme RACI -------------------------------------------------------------------------------------------------


def resolve_programme_raci(stages: list[dict], champion: str | None) -> dict:
    """Stage-level R/A/C/I -> one project letter per person (A > R > C > I). The champion is the one A; a stage-level A
    becomes workstream lead (R); C on one's own stage is dropped; planned-effort share suggests a contribution factor (P12).
    Each stage: {step, effort: (min, max), R: [ids], A: id, C: [ids], I: [ids]}. Ids are strings; "@..." marks a group label."""

    def mid(st):
        lo, hi = st.get("effort") or (0, 0)
        return ((lo or 0) + (hi or 0)) / 2

    total = sum(mid(st) for st in stages) or 1
    people: dict[str, dict] = {}

    def touch(i):
        return people.setdefault(i, {"id": i, "A": [], "R": [], "C": [], "I": [], "notes": []})

    for st in stages:
        for i in st.get("R") or []:
            touch(i)["R"].append(st["step"])
        if st.get("A"):
            touch(st["A"])["A"].append(st["step"])
        for i in st.get("C") or []:
            touch(i)["C"].append(st["step"])
        for i in st.get("I") or []:
            touch(i)["I"].append(st["step"])
    rows = []
    for x in people.values():
        dropped = []
        if x["id"] == champion:
            letter = "A"
        elif x["id"] == "@Head of requesting department":
            letter = "C"
            x["notes"].append("Outside approver, resolved per run. A missed stage SLA is a Client-caused delay (excused)")
        elif x["A"] or x["R"]:
            letter = "R"
            if x["A"]:
                x["notes"].append(f"A on stage {', '.join(map(str, x['A']))} → workstream lead")
        elif x["C"]:
            letter = "C"
        else:
            letter = "I"
        own = set(x["R"]) | set(x["A"])
        c_own = [s for s in x["C"] if s in own]
        if c_own:
            dropped.append("C")
            x["notes"].append(f"C on stage {', '.join(map(str, c_own))} dropped (own stage)")
        if letter != "I" and x["I"]:
            dropped.append("I")
            x["notes"].append("I dropped: holds a stronger letter")
        share = sum(mid(next(st for st in stages if st["step"] == s)) for s in x["R"]) / total
        if x["id"].startswith("@Requester"):
            x["notes"].append("The requesting side is the client, outside the delivery team. Their late brief is E1")
        suggested = (1.0 if share >= 0.4 else 0.75 if share >= 0.2 else 0.5) if letter == "R" else None
        rows.append({**x, "label": x["id"].startswith("@"), "letter": letter, "dropped": dropped, "share": share, "suggested": suggested})
    order = {"A": 0, "R": 1, "C": 2, "I": 3}
    rows.sort(key=lambda r: (order[r["letter"]], -r["share"]))
    return {"rows": rows, "total_effort": total}
