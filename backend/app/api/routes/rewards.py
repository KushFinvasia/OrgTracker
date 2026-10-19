from datetime import date, datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select

from app.api.deps import Ctx, get_ctx
from app.core.errors import Forbidden, NotFound, RuleViolation
from app.models import Account, Employee, Nomination, Period, RewardCycle, RuleVersion, Snapshot
from app.models.performance import AWARD_TYPES
from app.schemas.common import DecisionIn
from app.services import scoring
from app.services.audit import notify, record
from app.services.common import account_person, person, person_by_id
from app.core.clock import now_ist

router = APIRouter(tags=["rewards"])


class CycleIn(BaseModel):
    title: str
    period_id: int
    nomination_start: date
    nomination_end: date
    review_deadline: date
    gold_cap_enabled: bool = False
    audience: str = "Approved internal audience"


class NominationIn(BaseModel):
    cycle_id: int
    employee_id: int
    award_type: str
    citation: str = ""
    evidence: str | None = None


class SubmitNominationIn(BaseModel):
    reviewer_account_id: int


class PublishIn(BaseModel):
    audience: str
    confirm: bool


def reward_policy(ctx: Ctx) -> dict:
    r = ctx.db.scalar(select(RuleVersion).where(RuleVersion.kind == "reward").order_by(RuleVersion.id.desc()))
    return {"config": r.config if r else scoring.DEFAULT_REWARD_POLICY, "label": r.label if r else "default", "state": r.state if r else "Draft"}


def cycle_dict(ctx: Ctx, c: RewardCycle) -> dict:
    p = ctx.db.get(Period, c.period_id)
    noms = list(ctx.db.scalars(select(Nomination).where(Nomination.cycle_id == c.id)))
    return {
        "id": c.id, "title": c.title, "period": {"id": p.id, "name": p.name, "state": p.state},
        "nomination_start": c.nomination_start, "nomination_end": c.nomination_end, "review_deadline": c.review_deadline,
        "gold_cap_enabled": c.gold_cap_enabled, "audience": c.audience, "state": c.state,
        "owner": account_person(ctx.db, c.owner_account_id), "published_at": c.published_at, "published_by": account_person(ctx.db, c.published_by),
        "counts": {s: sum(n.state == s for n in noms) for s in ("Draft", "Submitted", "Approved", "Returned")},
    }


def word_count(text: str) -> int:
    return len([w for w in (text or "").split() if w.strip()])


def nomination_dict(ctx: Ctx, n: Nomination, private: bool = True) -> dict:
    snap = ctx.db.get(Snapshot, n.snapshot_id) if n.snapshot_id else None
    out = {
        "id": n.id, "cycle_id": n.cycle_id, "employee": person_by_id(ctx.db, n.employee_id), "award_type": n.award_type,
        "citation": n.citation, "citation_words": word_count(n.citation), "evidence": n.evidence, "state": n.state,
        "nominator": account_person(ctx.db, n.nominator_account_id), "reviewer": account_person(ctx.db, n.reviewer_account_id),
        "decision_reason": n.decision_reason, "decided_at": n.decided_at, "created_at": n.created_at,
    }
    if private and snap:
        policy = reward_policy(ctx)["config"]
        out["snapshot"] = {"final": snap.final_score, "base": snap.base_kpi, "coverage": snap.coverage, "status": snap.status, "tier": scoring.tier_for(snap.final_score, policy), "gates": snap.data.get("gates", [])}
    out["can_decide"] = n.state == "Submitted" and n.reviewer_account_id == ctx.account.id and n.nominator_account_id != ctx.account.id
    return out


@router.get("/reward-cycles")
def cycles(ctx: Ctx = Depends(get_ctx)):
    return {"cycles": [cycle_dict(ctx, c) for c in ctx.db.scalars(select(RewardCycle).order_by(RewardCycle.created_at.desc()))], "policy": reward_policy(ctx), "award_types": AWARD_TYPES}


@router.post("/reward-cycles")
def create_cycle(body: CycleIn, ctx: Ctx = Depends(get_ctx)):
    ctx.scope.require_role("admin", "hod")
    if not ctx.db.get(Period, body.period_id):
        raise RuleViolation("Choose a performance period.", "period_id")
    c = RewardCycle(**body.model_dump(), owner_account_id=ctx.account.id, state="Draft")
    ctx.db.add(c)
    ctx.db.flush()
    record(ctx.db, ctx.account.id, "create_reward_cycle", "reward_cycle", c.id, c.title, None, body.model_dump())
    ctx.db.commit()
    return cycle_dict(ctx, c)


@router.post("/reward-cycles/{cycle_id}/advance")
def advance_cycle(cycle_id: int, ctx: Ctx = Depends(get_ctx)):
    ctx.scope.require_role("admin", "hod")
    c = ctx.db.get(RewardCycle, cycle_id)
    if c is None:
        raise NotFound("Cycle")
    p = ctx.db.get(Period, c.period_id)
    nxt = {"Draft": "Nominations", "Nominations": "Review", "Review": "Approved"}.get(c.state)
    if nxt is None:
        raise RuleViolation("Use Publish awards for the final step.", "state")
    if nxt == "Nominations" and p.state != "Locked":
        raise RuleViolation("The linked performance period must be Locked before nominations open.", "period", "period_not_locked")
    if nxt == "Approved":
        pending = ctx.db.scalars(select(Nomination).where(Nomination.cycle_id == c.id, Nomination.state == "Submitted")).all()
        if pending:
            raise RuleViolation(f"{len(pending)} nomination(s) still await an independent decision.", "state")
    old = c.state
    c.state = nxt
    record(ctx.db, ctx.account.id, "advance_cycle", "reward_cycle", c.id, c.title, {"state": old}, {"state": nxt})
    ctx.db.commit()
    return cycle_dict(ctx, c)


@router.post("/reward-cycles/{cycle_id}/publish")
def publish(cycle_id: int, body: PublishIn, ctx: Ctx = Depends(get_ctx)):
    ctx.scope.require_role("admin", "hod")
    c = ctx.db.get(RewardCycle, cycle_id)
    if c is None:
        raise NotFound("Cycle")
    if c.state != "Approved":
        raise RuleViolation("Approve the cycle before publishing. Approval and publication are separate.", "state")
    if not body.confirm:
        raise RuleViolation("Confirm the audience and approved results.", "confirm")
    c.state = "Published"
    c.audience = body.audience
    c.published_at = now_ist()
    c.published_by = ctx.account.id
    record(ctx.db, ctx.account.id, "publish_awards", "reward_cycle", c.id, c.title, None, {"audience": body.audience})
    ctx.db.commit()
    return cycle_dict(ctx, c)


@router.get("/reward-cycles/{cycle_id}/eligibility")
def eligibility(cycle_id: int, ctx: Ctx = Depends(get_ctx)):
    c = ctx.db.get(RewardCycle, cycle_id)
    if c is None:
        raise NotFound("Cycle")
    if ctx.account.role == "team_lead":
        raise Forbidden("Team Leads do not receive private score data.")
    policy = reward_policy(ctx)["config"]
    q = select(Snapshot).where(Snapshot.period_id == c.period_id)
    if ctx.scope.perf_people is not None:
        q = q.where(Snapshot.employee_id.in_(ctx.scope.perf_people))
    rows = []
    for s in ctx.db.scalars(q):
        gates = s.data.get("gates", [])
        all_pass = all(g["result"] == "pass" for g in gates)
        rows.append({"employee": person_by_id(ctx.db, s.employee_id), "snapshot_id": s.id, "final": s.final_score, "coverage": s.coverage, "status": s.status, "tier": scoring.tier_for(s.final_score, policy), "gates": gates, "eligible": all_pass and s.final_score is not None})
    rows.sort(key=lambda r: -(r["final"] or -1))
    return {"cycle": cycle_dict(ctx, c), "rows": rows, "policy": policy}


@router.get("/nominations")
def nominations(cycle_id: int | None = None, ctx: Ctx = Depends(get_ctx)):
    q = select(Nomination)
    if cycle_id:
        q = q.where(Nomination.cycle_id == cycle_id)
    out = []
    for n in ctx.db.scalars(q.order_by(Nomination.created_at.desc())):
        if ctx.scope.can_see_perf(n.employee_id) or n.reviewer_account_id == ctx.account.id or n.nominator_account_id == ctx.account.id:
            out.append(nomination_dict(ctx, n))
    return out


@router.post("/nominations")
def create_nomination(body: NominationIn, ctx: Ctx = Depends(get_ctx)):
    ctx.scope.require_perf(body.employee_id)
    c = ctx.db.get(RewardCycle, body.cycle_id)
    if c is None or c.state != "Nominations":
        raise RuleViolation("Nominations are not open for this cycle.", "cycle_id")
    if body.award_type not in AWARD_TYPES:
        raise RuleViolation("Choose an award from the approved catalog.", "award_type")
    snap = ctx.db.scalar(select(Snapshot).where(Snapshot.period_id == c.period_id, Snapshot.employee_id == body.employee_id))
    if snap is None:
        raise RuleViolation("No locked snapshot exists for this person.", "employee_id")
    n = Nomination(**body.model_dump(), snapshot_id=snap.id, nominator_account_id=ctx.account.id, state="Draft")
    ctx.db.add(n)
    ctx.db.flush()
    record(ctx.db, ctx.account.id, "draft_nomination", "nomination", n.id, body.award_type, None, body.model_dump())
    ctx.db.commit()
    return nomination_dict(ctx, n)


@router.get("/nominations/{nomination_id}")
def get_nomination(nomination_id: int, ctx: Ctx = Depends(get_ctx)):
    n = ctx.db.get(Nomination, nomination_id)
    if n is None:
        raise NotFound("Nomination")
    if not (ctx.scope.can_see_perf(n.employee_id) or n.reviewer_account_id == ctx.account.id or n.nominator_account_id == ctx.account.id):
        raise Forbidden()
    out = nomination_dict(ctx, n)
    out["reviewers"] = [
        {"account_id": a.id, "employee": person(a.employee), "role": a.role}
        for a in ctx.db.scalars(select(Account).where(Account.role.in_(["hod", "manager", "admin"]), Account.id != n.nominator_account_id, Account.active.is_(True)))
    ]
    return out


@router.patch("/nominations/{nomination_id}")
def update_nomination(nomination_id: int, body: NominationIn, ctx: Ctx = Depends(get_ctx)):
    n = ctx.db.get(Nomination, nomination_id)
    if n is None or n.nominator_account_id != ctx.account.id:
        raise Forbidden()
    if n.state not in ("Draft", "Returned"):
        raise RuleViolation("Only draft or returned nominations can be edited.", "state")
    n.award_type, n.citation, n.evidence = body.award_type, body.citation, body.evidence
    ctx.db.commit()
    return nomination_dict(ctx, n)


@router.post("/nominations/{nomination_id}/submit")
def submit_nomination(nomination_id: int, body: SubmitNominationIn, ctx: Ctx = Depends(get_ctx)):
    n = ctx.db.get(Nomination, nomination_id)
    if n is None or n.nominator_account_id != ctx.account.id:
        raise Forbidden()
    if n.state not in ("Draft", "Returned"):
        raise RuleViolation("Already submitted.", "state")
    policy = reward_policy(ctx)["config"]
    if n.award_type != "Top Performer":
        if word_count(n.citation) < policy["citation_min_words"]:
            raise RuleViolation(f"Citation has {word_count(n.citation)} words; at least {policy['citation_min_words']} are required.", "citation")
        if not (n.evidence or "").strip():
            raise RuleViolation("Link accepted evidence for this award.", "evidence")
    if body.reviewer_account_id == ctx.account.id:
        raise RuleViolation("The nominator cannot approve their own nomination.", "reviewer_account_id")
    snap = ctx.db.get(Snapshot, n.snapshot_id)
    failed = [g["gate"] for g in snap.data.get("gates", []) if g["result"] == "fail"]
    if failed:
        raise RuleViolation(f"Eligibility gates fail: {', '.join(failed)}.", "gates")
    n.state = "Submitted"
    n.reviewer_account_id = body.reviewer_account_id
    record(ctx.db, ctx.account.id, "submit_nomination", "nomination", n.id, n.award_type)
    notify(ctx.db, body.reviewer_account_id, f"Review nomination: {n.award_type}", link=f"/rewards/nominations/{n.id}")
    ctx.db.commit()
    return nomination_dict(ctx, n)


@router.post("/nominations/{nomination_id}/decide")
def decide_nomination(nomination_id: int, body: DecisionIn, ctx: Ctx = Depends(get_ctx)):
    n = ctx.db.get(Nomination, nomination_id)
    if n is None:
        raise NotFound("Nomination")
    if n.nominator_account_id == ctx.account.id:
        raise RuleViolation("A nominator cannot approve their own nomination.", "decision")
    if n.reviewer_account_id != ctx.account.id:
        raise Forbidden("Only the named independent reviewer can decide.")
    if n.state != "Submitted":
        raise RuleViolation("Not awaiting a decision.", "state")
    if body.decision not in ("approve", "return") or (body.decision == "return" and not body.reason):
        raise RuleViolation("Approve, or return with a reason.", "reason")
    n.state = "Approved" if body.decision == "approve" else "Returned"
    n.decision_reason = body.reason
    n.decided_at = now_ist()
    record(ctx.db, ctx.account.id, f"nomination_{body.decision}", "nomination", n.id, n.award_type, {"state": "Submitted"}, {"state": n.state}, body.reason)
    ctx.db.commit()
    return nomination_dict(ctx, n)


@router.get("/awards")
def published_awards(ctx: Ctx = Depends(get_ctx)):
    """Celebration view: approved citation and permitted evidence only. No private scores or check-ins."""
    out = []
    for c in ctx.db.scalars(select(RewardCycle).where(RewardCycle.state == "Published")):
        for n in ctx.db.scalars(select(Nomination).where(Nomination.cycle_id == c.id, Nomination.state == "Approved")):
            e = ctx.db.get(Employee, n.employee_id)
            out.append({"id": n.id, "award_type": n.award_type, "citation": n.citation, "evidence": n.evidence, "employee": person(e), "cycle": c.title, "published_at": c.published_at, "audience": c.audience})
    return out
