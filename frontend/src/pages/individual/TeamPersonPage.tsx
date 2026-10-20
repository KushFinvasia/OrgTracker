import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, BookOpen, Check, Clock, Flag as FlagIcon, Info, Lock, Pencil, Plus, Send, ShieldCheck, Trash2, Undo2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";

import { api, ApiError } from "@/api/client";
import type { Person } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { Avatar, Badge, Button, Callout, DecisionButton, Drawer, Empty, ErrorState, Field, fieldError, Figures, FormError, Loading, Minibar, Modal, SectionTitle, Tier, toast, Unavailable } from "@/components/ui";
import { useCrumbLabel } from "@/lib/crumb";
import { fmtDate, fmtDateTime, fmtNum, fmtScore, todayISO } from "@/lib/format";
import { useApiMutation, useApiQuery } from "@/lib/hooks";
import { AddItemDrawer, FlagsCell, ModuleDrawer, numOrNull, type TrainingData, type TrainingModuleRow } from "./marking";
import { type CountKey, EvalBadge, fmtValue, type KpiItem, type KpiType, type MonthInfo, NotInPilot, SHEET_COLUMNS, useMonth, usePilot } from "./shared";

interface PersonMonth {
  employee: Person;
  month: { id: number; label: string; state: string; month: string; training_cutoff: string };
  evaluation: (Record<string, number | null | string | boolean> & { version: number; state: string; decision_note: string | null; decided_at: string | null; submitted_at?: string | null }) | null;
  evaluation_state: string;
  evaluator: Person | null;
  approver_roles: string[];
  inputs?: { entered: Partial<Record<CountKey, number | null>>; derived: Partial<Record<CountKey, number | null>> };
  rated_metrics: { metric: string; label: string; required: boolean }[];
  item_details: KpiItem[];
  training: { status: string; score: number | null; band: string | null; keka: number | null };
  scorecard: { final: number | null; tier: string | null; status: string };
  readiness: string[];
  can_edit: boolean;
  edit_reason: string;
  can_submit: boolean;
  can_approve: boolean;
  approve_reason: string;
  decided_by: Person | null;
  locked: boolean;
}

type ItemDraft = Partial<Pick<KpiItem, "target_value" | "achieved_value" | "outcome" | "completed_date" | "delay_reason">>;
type Marks = Record<string, number | string | boolean | null>;
type Live = Map<number, { pct: number | null; timing: string; target: number | null; achieved: number | null }>;

const RATING_DESC: Record<string, string> = {
  quality_rating: "Your rating of the accuracy and completeness of this person's work this month.",
  csat_rating: "Your rating of the client experience this person delivered this month.",
  compliance_rating: "Your rating of regulatory and control adherence this month.",
  collaboration_rating: "Your rating of teamwork, support and automation this month.",
  innovation_rating: "Your rating of process improvements and ideas this month.",
};

/** Team → one person: every KPI for the month, the mark for each, the ratings and training. One page, one Save. */
export function TeamPersonPage() {
  const { person } = useParams();
  const ctx = usePilot();
  const [monthId] = useMonth(ctx.data);
  const qc = useQueryClient();
  const path = monthId ? `/individual/evaluations/${person}/${monthId}` : null;
  const q = useApiQuery<PersonMonth>(path);
  const training = useApiQuery<TrainingData>(monthId ? `/individual/months/${monthId}/training?employee_id=${person}` : null);
  const types = useApiQuery<KpiType[]>("/individual/kpi-types");
  const [items, setItems] = useState<Record<number, ItemDraft>>({});
  const [marks, setMarks] = useState<Marks>({});
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState<"kpi" | "duty" | null>(null);
  const [moduleOpen, setModuleOpen] = useState<TrainingModuleRow | "new" | null>(null);
  const [editing, setEditing] = useState<KpiItem | null>(null);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const { isRole } = useAuth();
  const d = q.data;
  useCrumbLabel(d?.employee.name);

  useEffect(() => {
    setItems({});
    setMarks({});
    setResults({});
  }, [person, monthId]);

  if (ctx.isLoading || q.isLoading) return <Loading rows={3} />;
  if (ctx.data && ctx.data.people === 0) return <NotInPilot />;
  if (!d) return <ErrorState error={q.error} />;

  const editable = d.can_edit && d.month.state === "Open";
  const ev = d.evaluation;
  const monthLocked = d.month.state === "Locked";
  const dirtyItems = Object.keys(items).map(Number).filter((id) => Object.keys(items[id]).length);
  const dirty = dirtyItems.length > 0 || Object.keys(marks).length > 0;
  const kpis = d.item_details.filter((i) => i.kind === "kpi");
  const duties = d.item_details.filter((i) => i.kind === "duty");
  const tp = training.data?.people[0];
  const approver = d.approver_roles.includes("hod") ? "the HOD" : "an Admin";

  // Live values while marking: % and timing update as you type, before saving.
  const live: Live = new Map();
  for (const it of d.item_details) {
    const dr = items[it.id] ?? {};
    const target = "target_value" in dr ? dr.target_value ?? null : it.effective_target;
    // An empty achieved box means the default of 0 (team rows stay blank and use the reportees' sum).
    const achieved = "achieved_value" in dr ? dr.achieved_value ?? (it.is_team ? null : 0) : it.effective_achieved;
    const outcome = "outcome" in dr ? dr.outcome ?? null : it.outcome;
    const completed = "completed_date" in dr ? dr.completed_date ?? null : it.completed_date;
    let timing = it.timing;
    if ("outcome" in dr || "completed_date" in dr) {
      if (outcome === "Completed") timing = completed ? (!it.target_date || completed <= it.target_date ? "On time" : "Delayed") : "Enter the date";
      else if (outcome === "Not completed") timing = "Delayed";
      else timing = it.target_date && it.target_date < todayISO() ? "No outcome" : "Open";
    }
    live.set(it.id, { pct: target && achieved !== null ? (achieved / target) * 100 : null, timing, target, achieved });
  }
  const timings = [...live.values()].map((v) => v.timing);
  const pcts = kpis.map((it) => live.get(it.id)!.pct).filter((p): p is number => p !== null);
  const kpisWithTarget = kpis.filter((it) => (live.get(it.id)!.target ?? 0) > 0).length;
  const auto = {
    on_time_count: timings.filter((t) => t === "On time").length,
    delayed_count: timings.filter((t) => t === "Delayed").length,
    no_outcome: timings.filter((t) => t === "No outcome").length,
    validated: timings.filter((t) => t === "Delay validated").length,
    achievement_pct: pcts.length ? pcts.reduce((a, p) => a + Math.min(p, 150), 0) / pcts.length : null,
  };
  const requiredRatings = d.rated_metrics.filter((m) => m.required).map((m) => `${m.metric}_rating`);
  const savedRating = (k: string) => (ev?.[k] as number | null | undefined) ?? null;
  const missingRatings = requiredRatings.filter((k) => savedRating(k) === null).map((k) => SHEET_COLUMNS.find((c) => c.key === k)?.label ?? k);
  const kpisMarked = kpis.filter((it) => (it.effective_target ?? 0) > 0 && (it.effective_achieved ?? 0) > 0).length;
  const withOutcome = d.item_details.filter((it) => it.outcome).length;
  const trainingOk = d.training.status === "scored" || d.training.status === "na";
  const checklist = [
    { label: "Required ratings", ok: missingRatings.length === 0, blocking: true, detail: missingRatings.length ? `${missingRatings.join(", ")} not given (save first)` : "Given" },
    { label: "KPIs marked", ok: kpisWithTarget === 0 || kpisMarked === kpisWithTarget, blocking: false, detail: kpisWithTarget ? `${kpisMarked} of ${kpisWithTarget} have an achieved value` : "No numeric KPIs this month" },
    { label: "Done dates", ok: d.item_details.length === 0 || withOutcome === d.item_details.length, blocking: false, detail: `${withOutcome} of ${d.item_details.length} KPIs and duty tasks have an outcome` },
    { label: "Training", ok: trainingOk, blocking: false, detail: d.training.status === "scored" ? `TWCS ${fmtScore(d.training.score)}` : d.training.status === "na" ? "Confirmed none due" : "No modules due this month recorded" },
  ];
  const openChecks = checklist.filter((c) => !c.ok);
  const submitNow = () => act(() => api.post(`${path}/submit`), "Submitted for approval.");

  const itemVal = <K extends keyof ItemDraft>(it: KpiItem, k: K): KpiItem[K] => (items[it.id] && k in items[it.id] ? (items[it.id][k] as KpiItem[K]) : it[k]);
  const setItem = (id: number, patch: ItemDraft) => setItems((s) => ({ ...s, [id]: { ...s[id], ...patch } }));
  const markVal = (key: string): number | string | boolean | null => {
    if (key in marks) return marks[key];
    if (key === "twcs_score") return d.inputs?.entered.twcs_score ?? null;
    return (ev?.[key] as number | string | boolean | null | undefined) ?? null;
  };
  const setMark = (key: string, v: number | string | boolean | null) => setMarks((m) => ({ ...m, [key]: v }));

  const refresh = () => qc.invalidateQueries();
  const saveAll = async () => {
    setBusy(true);
    const out: Record<string, string> = {};
    let failed = 0;
    for (const id of dirtyItems) {
      const it = d.item_details.find((x) => x.id === id)!;
      try {
        await api.patch(`/individual/items/${id}`, { version: it.version, ...items[id] });
        out[`item-${id}`] = "Saved";
      } catch (e) {
        out[`item-${id}`] = e instanceof ApiError ? e.message : "Save failed";
        failed++;
      }
    }
    if (Object.keys(marks).length) {
      try {
        await api.put(path!, { ...marks, version: ev?.version ?? null });
        out.marks = "Saved";
      } catch (e) {
        out.marks = e instanceof ApiError ? e.message : "Save failed";
        failed++;
      }
    }
    setResults(out);
    setItems((s) => Object.fromEntries(Object.entries(s).filter(([id]) => out[`item-${id}`] && out[`item-${id}`] !== "Saved")));
    if (out.marks === "Saved") setMarks({});
    setBusy(false);
    await refresh();
    toast(failed ? `${failed} change(s) could not be saved; your input is kept.` : "Saved. The score is recalculated.", failed > 0);
  };
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      await refresh();
      toast(ok);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Failed", true);
    } finally {
      setBusy(false);
    }
  };
  const itemActions = {
    onResolve: (id: number, index: number, note: string) => void act(() => api.post(`/individual/items/${id}/resolve-warning`, { index, note }), "Warning marked as checked."),
    onRemove: (id: number, reason: string) => void act(() => api.post(`/individual/items/${id}/remove`, { reason }), "Removed from this month. It will not carry over."),
    onValidate: (id: number, decision: string, reason: string) => void act(() => api.post(`/individual/items/${id}/validate-delay`, { decision, reason }), "Delay reason decided."),
  };

  const soft = (text: string) => <span className="soft">{text}</span>;
  const scoreFigure = d.scorecard.status === "not_evaluated" ? soft("Not evaluated") : d.scorecard.final === null ? soft(["Not started", "Draft", "Returned"].includes(d.evaluation_state) ? "In progress" : "Insufficient data") : fmtScore(d.scorecard.final);

  const state = d.evaluation_state;
  const saveState = editable ? (
    dirty ? (
      <span className="save-state dirty"><AlertTriangle size={14} aria-hidden="true" /> Unsaved changes</span>
    ) : (
      <><Check size={14} aria-hidden="true" /> All changes saved</>
    )
  ) : d.can_approve ? (
    <><Clock size={14} aria-hidden="true" /> Waiting for your decision</>
  ) : d.locked ? (
    <><Lock size={14} aria-hidden="true" /> Closed, read-only</>
  ) : state === "Submitted" ? (
    <><Clock size={14} aria-hidden="true" /> Submitted, waiting for {approver}</>
  ) : state === "Approved" ? (
    <><Check size={14} aria-hidden="true" /> Approved, read-only</>
  ) : (
    <><Lock size={14} aria-hidden="true" /> Read-only for you</>
  );

  return (
    <>
      <div className="person-head">
        <Avatar person={d.employee} size="lg" />
        <div className="grow">
          <div className="row">
            <h1>{d.employee.name}</h1>
            <EvalBadge state={state} />
          </div>
          <div className="meta">
            <span>{d.employee.code}</span>
            {d.employee.designation && <span>{d.employee.designation}</span>}
            <span>Evaluator {d.evaluator?.name ?? "none"}</span>
            <span>Approved by {d.approver_roles.map((r) => (r === "hod" ? "HOD" : "Admin")).join(" or ")}</span>
            <span>{d.month.label}</span>
          </div>
        </div>
      </div>

      <WorkflowStrip state={state} ev={ev} decidedBy={d.decided_by} approver={approver} month={d.month} />

      <div className="stack-sm" style={{ marginBottom: 16 }}>
        {d.locked && <Callout tone="neutral" icon={Lock} title={`${d.month.label} is closed.`}>These marks are final. The HOD can request a correction from the person's result page.</Callout>}
        {monthLocked && !d.locked && (
          <Callout tone="warn" title="Correction open.">
            {d.month.label} is closed, but a correction has reopened this person's month: {ev?.decision_note}. Fix the marks, save and submit; the approval replaces the stored result.
          </Callout>
        )}
        {ev?.state === "Returned" && (
          <Callout tone="bad" icon={Undo2} title={`Returned for correction by ${d.decided_by?.name ?? "the approver"}`}>
            on {fmtDateTime(ev.decided_at)}. {ev.decision_note}
          </Callout>
        )}
        {d.can_approve && (
          <Callout tone="info" title="Submitted for your approval.">
            Review the KPIs, ratings and training below, then approve or return it with a reason. Approving also verifies this month's recorded training completions.
          </Callout>
        )}
        {!editable && !d.locked && !d.can_approve && d.edit_reason && <Callout tone="neutral" icon={Lock}>{d.edit_reason}</Callout>}
      </div>

      <Figures
        style={{ marginBottom: 8 }}
        items={[
          { label: monthLocked ? "Final score" : "Score (live)", value: scoreFigure, hint: d.scorecard.final !== null ? <Tier tier={d.scorecard.tier} /> : "Missing inputs are not zero" },
          { label: "KPI average", value: auto.achievement_pct === null ? soft("Unavailable") : fmtNum(auto.achievement_pct, 1), unit: auto.achievement_pct === null ? undefined : "%", hint: kpisWithTarget ? `${kpisMarked} of ${kpisWithTarget} KPIs marked` : "No numeric targets" },
          {
            label: "On-time",
            value: auto.on_time_count,
            unit: "on time",
            hint: `${auto.delayed_count} delayed${auto.validated ? `, ${auto.validated} validated` : ""}${auto.no_outcome ? `, ${auto.no_outcome} no outcome` : ""}`,
          },
          {
            label: "Training (TWCS)",
            value: d.training.status === "scored" ? fmtScore(d.training.score) : d.training.status === "na" ? "N/A" : soft("Unavailable"),
            hint: d.training.status === "scored" ? `${d.training.band}, KEKA rating ${d.training.keka}` : d.training.status === "na" ? "Confirmed none due" : "No modules due recorded",
          },
          {
            label: "Missing inputs",
            value: d.readiness.length ? d.readiness.length : <span style={{ color: "var(--ok)" }}><Check size={20} aria-hidden="true" /></span>,
            unit: d.readiness.length ? "open" : undefined,
            hint: d.readiness.length ? (editable ? "See what is still missing below" : "Recorded when it was saved") : "All inputs recorded",
          },
        ]}
      />
      {editable && (d.readiness.length > 0 || openChecks.length > 0) && (
        <details className="small" style={{ margin: "0 0 4px" }}>
          <summary className="muted" style={{ cursor: "pointer", padding: "6px 0" }}>What is still missing</summary>
          <ul className="readiness">
            {[...d.readiness, ...openChecks.map((c) => `${c.label}: ${c.detail}`)].map((x) => (
              <li key={x}>
                <AlertTriangle size={14} aria-hidden="true" />
                {x}
              </li>
            ))}
          </ul>
        </details>
      )}

      <SectionTitle
        num={1}
        title="KPIs and duty tasks"
        meta="Tasks on-time, delayed and the KPI average are worked out from these rows, never typed."
        tools={
          editable && (
            <>
              <Button size="sm" onClick={() => setAdding("kpi")}><Plus size={14} aria-hidden="true" />Add KPI</Button>
              <Button size="sm" onClick={() => setAdding("duty")}><Plus size={14} aria-hidden="true" />Add duty task</Button>
            </>
          )
        }
      />
      {kpis.length === 0 ? (
        <div className="panel">
          <Empty title="No targets set for this month" icon={FlagIcon}>Nothing was imported or added for this person. Achievement stays unavailable, not zero.</Empty>
        </div>
      ) : (
        <ItemTable rows={kpis} editable={editable} withNumbers live={live} itemVal={itemVal} setItem={setItem} results={results} isAdmin={isRole("admin")} onEdit={setEditing} {...itemActions} />
      )}
      {duties.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <ItemTable rows={duties} editable={editable} live={live} itemVal={itemVal} setItem={setItem} results={results} isAdmin={isRole("admin")} onEdit={setEditing} {...itemActions} />
        </div>
      )}

      <SectionTitle num={2} title="Ratings" meta="Only the ratings weighted for this person's category are asked for." />
      <div className="panel">
        <div className="panel-b" style={{ paddingTop: 4, paddingBottom: 4 }}>
          {requiredRatings.map((key) => {
            const v = markVal(key) as number | null;
            const label = SHEET_COLUMNS.find((c) => c.key === key)?.label ?? key;
            return (
              <div className="rating-row" key={key}>
                <div>
                  <b style={{ fontWeight: 500 }}>{label}</b>
                  <span style={{ color: "var(--bad)" }} aria-hidden="true"> *</span>
                  <div className="desc">{RATING_DESC[key] ?? SHEET_COLUMNS.find((c) => c.key === key)?.help}</div>
                </div>
                <div className="scale" role="radiogroup" aria-label={`${label} rating, 1 to 5`}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button type="button" key={n} role="radio" aria-checked={v === n} aria-pressed={v === n} disabled={!editable} onClick={() => setMark(key, n)}>
                      {n}
                    </button>
                  ))}
                </div>
                <div className="small muted">{v ? `Rated ${v} of 5${key in marks ? " (not saved yet)" : ""}` : <Unavailable>Not rated yet</Unavailable>}</div>
              </div>
            );
          })}
          <div className="rating-row">
            <div>
              <label htmlFor="ev-comments" style={{ fontWeight: 500 }}>Comments</label>
              <div className="desc">Optional context for the approver.</div>
            </div>
            <textarea
              id="ev-comments"
              className="textarea"
              style={{ gridColumn: "2 / -1" }}
              disabled={!editable}
              placeholder={editable ? "For example, what drove the result this month" : ""}
              value={(markVal("comments") as string | null) ?? ""}
              onChange={(e) => setMark("comments", e.target.value || null)}
            />
          </div>
        </div>
        {results.marks && (
          <div className="panel-f small" style={{ color: results.marks === "Saved" ? "var(--ok)" : "var(--bad)" }}>
            {results.marks}
          </div>
        )}
      </div>

      <SectionTitle
        num={3}
        title="Training"
        meta="TWCS: the average timeliness credit across modules due this month."
        tools={editable && <Button size="sm" onClick={() => setModuleOpen("new")}><Plus size={14} aria-hidden="true" />Add module</Button>}
      />
      <div className="panel">
        <div className="panel-h" style={{ flexWrap: "wrap" }}>
          {!tp ? (
            <Unavailable>Loading training</Unavailable>
          ) : tp.status === "scored" ? (
            <>
              <b className="num" style={{ fontSize: 18 }}>TWCS {fmtScore(tp.twcs)}</b>
              <Badge tone="green" icon={false}>{tp.band}</Badge>
              <span className="small muted">
                KEKA rating {tp.keka}. {tp.counted} module{tp.counted === 1 ? "" : "s"} counted{tp.exempt ? `, ${tp.exempt} exempt` : ""}
                {tp.future ? `, ${tp.future} due later` : ""}
                {tp.provisional ? `, ${tp.provisional} awaiting verification` : ""}.
              </span>
            </>
          ) : tp.status === "na" ? (
            <>
              <b>Training N/A</b>
              <span className="small muted">Confirmed: no training due this month. Training drops out of the coverage.</span>
            </>
          ) : (
            <Unavailable>{tp.reason || "No training modules recorded as due this month and nothing confirmed. Unavailable, not zero."}</Unavailable>
          )}
        </div>
        {(tp?.modules.length ?? 0) > 0 ? (
          <div className="tbl-wrap">
            <table className="tbl stackable">
              <thead>
                <tr>
                  <th>Module</th>
                  <th>Track</th>
                  <th>Due</th>
                  <th>Completed on</th>
                  <th className="n">Days late</th>
                  <th className="n">Credit</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {tp!.modules.map((m) => (
                  <tr key={m.id}>
                    <td data-l="Module" style={{ minWidth: 220 }}>
                      <b style={{ fontWeight: 500 }}>{m.title}</b>
                      {m.exemption_reason && <span className="sub">Exemption reason: {m.exemption_reason}</span>}
                    </td>
                    <td data-l="Track">{m.track}</td>
                    <td data-l="Due" className="nowrap">{fmtDate(m.due_date)}</td>
                    <td data-l="Completed on" className="nowrap">{m.completed_date ? fmtDate(m.completed_date) : ""}</td>
                    <td data-l="Days late" className="n num">{m.days_late ?? ""}</td>
                    <td data-l="Credit" className="n num">{m.in_month && m.status !== "Exempt" && m.credit !== null ? `${m.credit}%` : ""}</td>
                    <td data-l="Status"><ModuleStatus m={m} /></td>
                    <td data-l="">
                      <div className="row nowrap" style={{ gap: 6, justifyContent: "flex-end" }}>
                        {editable && m.status !== "Exempt" && (
                          <Button size="sm" variant="ghost" onClick={() => setModuleOpen(m)}>
                            {m.completed_date ? "Edit" : "Record completion"}
                          </Button>
                        )}
                        {m.can_verify && (
                          <Button size="sm" onClick={() => void act(() => api.post(`/individual/training/${m.id}/verify`), "Completion verified.")}>
                            <ShieldCheck size={14} aria-hidden="true" /> Verify completion
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No training modules recorded" icon={BookOpen}>
            Add the modules due this month, or confirm nothing was due so Training drops out of the score.
          </Empty>
        )}
        <div className="panel-f" style={{ flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>
          <label className="check">
            <input type="checkbox" disabled={!editable} checked={!!markVal("training_none_due")} onChange={(e) => setMark("training_none_due", e.target.checked)} />
            <span>
              No training was due this month
              <br />
              <span className="small muted">Training becomes N/A and drops out of the coverage.</span>
            </span>
          </label>
          <div style={{ marginLeft: "auto", maxWidth: 280 }}>
            <Field label="Training score override (optional)" help="Replaces the TWCS worked out from the modules.">
              <input
                className="input"
                inputMode="decimal"
                disabled={!editable}
                placeholder={d.inputs?.derived.twcs_score != null ? `${d.inputs.derived.twcs_score.toFixed(2)} from modules` : "0 to 100"}
                value={(markVal("twcs_score") as number | null) ?? ""}
                onChange={(e) => setMark("twcs_score", numOrNull(e.target.value))}
              />
            </Field>
          </div>
        </div>
        <div className="panel-f small muted">
          Credit: 100% on or before the due date, 75% for 1 to 7 days late, 50% for 8 to 14, 25% for 15 or more, 0% if not done by the cut-off ({fmtDate(d.month.training_cutoff)}).
        </div>
      </div>

      <SectionTitle title="History" meta="Every change to this person's month, newest first. History cannot be edited." />
      <HistoryPanel employeeId={d.employee.id} monthId={d.month.id} />

      <div className="actionbar">
        <div className="state">{saveState}</div>
        <span className="grow" />
        <Link className="btn ghost" to={`/individual/performance/${d.employee.id}/${d.month.id}`}>View scorecard</Link>
        {editable && (
          <Button variant={dirty ? "primary" : "secondary"} disabled={!dirty || busy} busy={busy && dirty} onClick={() => void saveAll()}>
            Save changes
          </Button>
        )}
        {editable && d.can_submit && !dirty && (
          <Button variant="primary" disabled={busy || checklist.some((c) => c.blocking && !c.ok)} title={missingRatings.length ? `Give the required ratings first: ${missingRatings.join(", ")}` : undefined} onClick={() => (openChecks.length ? setConfirmSubmit(true) : void submitNow())}>
            <Send size={14} aria-hidden="true" /> Submit for approval
          </Button>
        )}
        {d.can_approve && (
          <>
            <DecisionButton label="Return for correction" decision="return" variant="danger" icon={<Undo2 size={14} aria-hidden="true" />} busy={busy} onDecide={(dd, r) => void act(() => api.post(`${path}/decide`, { decision: dd, reason: r }), "Returned for correction.")} />
            <DecisionButton label="Approve" decision="approve" variant="primary" icon={<Check size={14} aria-hidden="true" />} reasonRequired={false} busy={busy} onDecide={(dd, r) => void act(() => api.post(`${path}/decide`, { decision: dd, reason: r }), "Approved.")} />
          </>
        )}
      </div>

      <Modal open={confirmSubmit} title="Submit with items still open?" onClose={() => setConfirmSubmit(false)}>
        <ul className="readiness">
          {openChecks.map((c) => (
            <li key={c.label}>
              <AlertTriangle size={14} aria-hidden="true" />
              <span><b>{c.label}</b>: {c.detail}</span>
            </li>
          ))}
        </ul>
        <p className="small muted" style={{ marginTop: 8 }}>Open items are scored as they are now: missing values stay unavailable, KPIs not marked count as 0.</p>
        <div className="row" style={{ justifyContent: "flex-end", marginTop: 16 }}>
          <Button onClick={() => setConfirmSubmit(false)}>Keep marking</Button>
          <Button variant="primary" onClick={() => { setConfirmSubmit(false); void submitNow(); }}>Submit anyway</Button>
        </div>
      </Modal>

      {adding && training.data && <AddItemDrawer kind={adding} month={training.data.month} people={[d.employee]} types={types.data ?? []} defaultPerson={d.employee.id} onClose={() => setAdding(null)} />}
      {editing && training.data && <EditItemDrawer item={editing} month={training.data.month} types={types.data ?? []} onClose={() => setEditing(null)} />}
      {moduleOpen && training.data && (
        <ModuleDrawer month={training.data.month} tracks={training.data.tracks} people={[d.employee]} module={moduleOpen === "new" ? undefined : moduleOpen} defaultPerson={d.employee.id} onClose={() => setModuleOpen(null)} />
      )}
    </>
  );
}

/** Draft → Submitted → Approved or returned → Month closed. */
function WorkflowStrip({ state, ev, decidedBy, approver, month }: { state: string; ev: PersonMonth["evaluation"]; decidedBy: Person | null; approver: string; month: PersonMonth["month"] }) {
  const step = (cls: string, icon: ReactNode, label: string, sub?: ReactNode) => (
    <div className={`st ${cls}`}>
      <span className="dotc">{icon}</span>
      <span>
        {label}
        {sub && <small>{sub}</small>}
      </span>
    </div>
  );
  const started = !["Draft", "Not started"].includes(state);
  const decided = ["Approved", "Returned"].includes(state);
  const closed = month.state === "Locked";
  return (
    <div className="flow" aria-label="Check-in workflow">
      {started ? step("done", <Check size={14} />, "Draft") : step("now", null, "Draft", state === "Not started" ? "Not started" : "Being marked")}
      <span className={`ln ${started ? "done" : ""}`} />
      {state === "Submitted"
        ? step("now", <Clock size={14} />, "Submitted", `${ev?.submitted_at ? fmtDate(ev.submitted_at as string) : ""}, waiting for ${approver}`)
        : decided
          ? step("done", <Check size={14} />, "Submitted", ev?.submitted_at ? fmtDate(ev.submitted_at as string) : undefined)
          : step("", null, "Submitted")}
      <span className={`ln ${decided ? "done" : ""}`} />
      {state === "Approved"
        ? step("done", <Check size={14} />, "Approved", `${decidedBy?.name ?? ""}${ev?.decided_at ? `, ${fmtDate(ev.decided_at)}` : ""}`)
        : state === "Returned"
          ? step("ret", <Undo2 size={14} />, "Returned", `${decidedBy?.name ?? ""}${ev?.decided_at ? `, ${fmtDate(ev.decided_at)}` : ""}`)
          : step("", null, "Approved or returned", `By ${approver}`)}
      <span className={`ln ${closed ? "done" : ""}`} />
      {closed ? step("done", <Lock size={14} />, "Month closed") : step("", null, "Month closed", "By the HOD")}
    </div>
  );
}

function ModuleStatus({ m }: { m: TrainingModuleRow }) {
  if (m.status === "Exempt") return <Badge status="Exempt" />;
  if (m.status === "Exemption requested") return <Badge status="Exemption requested" />;
  if (!m.in_month) return <span className="badge outline">Due later</span>;
  if (!m.completed_date) return <Badge tone="red" icon={AlertTriangle}>Not completed</Badge>;
  if (m.verified) return <Badge tone="green" icon={Check}>Verified</Badge>;
  return <Badge tone="amber" icon={Clock}>Awaiting verification</Badge>;
}

function ItemTable({
  rows,
  editable,
  withNumbers,
  live,
  itemVal,
  setItem,
  results,
  onValidate,
  onResolve,
  onEdit,
  onRemove,
  isAdmin,
}: {
  rows: KpiItem[];
  editable: boolean;
  withNumbers?: boolean;
  live: Live;
  itemVal: <K extends keyof ItemDraft>(it: KpiItem, k: K) => KpiItem[K];
  setItem: (id: number, patch: ItemDraft) => void;
  results: Record<string, string>;
  onValidate: (id: number, decision: string, reason: string) => void;
  onResolve: (id: number, index: number, note: string) => void;
  onEdit: (it: KpiItem) => void;
  onRemove: (id: number, reason: string) => void;
  isAdmin: boolean;
}) {
  return (
    <div className="panel">
      <div className="tbl-wrap">
        <table className="tbl stackable">
          <thead>
            <tr>
              <th>{withNumbers ? "KPI" : "Duty task"}</th>
              {withNumbers ? (
                <>
                  <th className="n">Target</th>
                  <th className="n">Achieved</th>
                  <th className="n">% of target</th>
                </>
              ) : (
                <th>Target date</th>
              )}
              <th>Done?</th>
              <th>Completed on</th>
              <th>Timing and delay reason</th>
              {editable && <th><span className="sr-only">Row actions</span></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((it) => {
              const unit = it.kpi_type?.unit;
              const res = results[`item-${it.id}`];
              const l = live.get(it.id);
              const timing = l?.timing ?? it.timing;
              const late = ["Delayed", "Delay validated"].includes(timing);
              const reason = itemVal(it, "delay_reason");
              return (
                <tr key={`${it.id}-${it.version}`}>
                  <td data-l={withNumbers ? "KPI" : "Task"} style={{ minWidth: withNumbers ? 190 : 240, maxWidth: 340 }}>
                    <b style={{ fontWeight: 500 }}>{it.title}</b> {it.is_team && <Badge tone="blue" icon={false}>Team</Badge>}
                    <span className="sub">
                      {it.kpi_type ? it.kpi_type.name : it.source_name ?? "Duty task"}
                      {it.per_day ? `, ${fmtNum(it.per_day)} per day × 22` : ""}
                    </span>
                    <FlagsCell flags={it.flags} isAdmin={isAdmin} onResolve={editable || isAdmin ? (i, note) => onResolve(it.id, i, note) : undefined} />
                    {res && <span className={`save-state ${res === "Saved" ? "saved" : "failed"}`}>{res === "Saved" ? <Check size={12} aria-hidden="true" /> : <AlertTriangle size={12} aria-hidden="true" />} {res}</span>}
                  </td>
                  {withNumbers ? (
                    <>
                      <td className="n" data-l="Target">
                        {editable ? (
                          <input className="cell-in" inputMode="decimal" aria-label={`Target: ${it.title}`} defaultValue={it.target_value ?? ""} placeholder={it.is_team && it.team_sum?.target_sum != null ? fmtNum(it.team_sum.target_sum) : ""} onChange={(e) => setItem(it.id, { target_value: numOrNull(e.target.value) })} />
                        ) : it.effective_target === null ? (
                          <Unavailable>No numeric target</Unavailable>
                        ) : (
                          <span className="num">{fmtValue(it.effective_target, unit)}</span>
                        )}
                        {it.is_team && <span className="sub">{it.target_value !== null ? "Entered" : "Sum of reportees"}</span>}
                        {it.target_value === null && it.target_text && !it.is_team && <span className="sub">Tracker: {it.target_text}</span>}
                      </td>
                      <td className="n" data-l="Achieved">
                        {editable ? (
                          <input
                            className="cell-in"
                            inputMode="decimal"
                            aria-label={`Achieved: ${it.title}`}
                            defaultValue={it.achieved_value ?? ""}
                            placeholder={it.is_team && it.team_sum ? (it.team_sum.achieved_sum != null ? fmtNum(it.team_sum.achieved_sum) : `${it.team_sum.achieved_missing} missing`) : ""}
                            onChange={(e) => setItem(it.id, { achieved_value: numOrNull(e.target.value) })}
                          />
                        ) : it.effective_achieved === null ? (
                          <Unavailable>Not entered</Unavailable>
                        ) : (
                          <span className="num">{fmtValue(it.effective_achieved, unit)}</span>
                        )}
                        {it.is_team && it.value_source && <span className="sub">{it.value_source === "reportee sum" ? "Reportee sum" : it.team_sum?.achieved_missing ? `${it.team_sum.achieved_missing} reportee rows missing` : ""}</span>}
                      </td>
                      <td className="n" data-l="% of target">
                        {l?.pct != null && (
                          <span className="pct-cell num">
                            {fmtNum(l.pct, 2)}%
                            <Minibar pct={l.pct} />
                          </span>
                        )}
                        {l?.pct != null && l.pct > 150 && <span className="sub">150 counted</span>}
                      </td>
                    </>
                  ) : (
                    <td data-l="Target date" className="nowrap">
                      {fmtDate(it.target_date)}
                      {it.due_set_by_manager && <span className="sub">Set by the Manager</span>}
                    </td>
                  )}
                  <td data-l="Done?">
                    {editable ? (
                      <select
                        className="cell-in"
                        style={{ minWidth: 128 }}
                        aria-label={`Done: ${it.title}`}
                        value={itemVal(it, "outcome") ?? ""}
                        onChange={(e) => setItem(it.id, { outcome: (e.target.value || null) as KpiItem["outcome"], ...(e.target.value !== "Completed" ? { completed_date: null } : {}) })}
                      >
                        <option value="">Not recorded</option>
                        <option>Completed</option>
                        <option>Not completed</option>
                      </select>
                    ) : (
                      it.outcome ?? <span className="muted">Not recorded</span>
                    )}
                  </td>
                  <td data-l="Completed on">
                    {editable && itemVal(it, "outcome") === "Completed" ? (
                      <input className="cell-in" type="date" style={{ minWidth: 140, textAlign: "left" }} max={todayISO()} aria-label={`Completed on: ${it.title}`} value={itemVal(it, "completed_date") ?? ""} onChange={(e) => setItem(it.id, { completed_date: e.target.value || null })} />
                    ) : (
                      <span className="nowrap">{it.completed_date ? fmtDate(it.completed_date) : ""}</span>
                    )}
                    {withNumbers && <span className="sub">Due {fmtDate(it.target_date)}{it.due_set_by_manager ? " (set)" : ""}</span>}
                  </td>
                  <td data-l="Timing" style={{ minWidth: 210 }}>
                    <Badge status={timing} />
                    {(late || reason) && (
                      <div style={{ marginTop: 6 }}>
                        {editable ? (
                          <input className="cell-in text" placeholder="Why was it late?" aria-label={`Delay reason: ${it.title}`} defaultValue={it.delay_reason ?? ""} onChange={(e) => setItem(it.id, { delay_reason: e.target.value || null })} />
                        ) : (
                          <span>{it.delay_reason}</span>
                        )}
                        <div style={{ marginTop: 4 }}>
                          {it.delay_validated ? (
                            <Badge tone="blue" icon={ShieldCheck}>Validated</Badge>
                          ) : it.can_validate_delay ? (
                            <div className="row nowrap" style={{ gap: 6 }}>
                              <Button size="sm" onClick={() => onValidate(it.id, "validate", "")}><ShieldCheck size={14} aria-hidden="true" /> Validate delay</Button>
                              <DecisionButton size="sm" variant="ghost" label="Reject" decision="reject" onDecide={(dd, r) => onValidate(it.id, dd, r)} />
                            </div>
                          ) : late ? (
                            <span className="small muted">Counts as a delay until validated</span>
                          ) : null}
                        </div>
                      </div>
                    )}
                  </td>
                  {editable && (
                    <td data-l="" className="nowrap">
                      <Button size="sm" variant="ghost" aria-label={`Edit ${it.title}`} onClick={() => onEdit(it)}>
                        <Pencil size={14} aria-hidden="true" />
                      </Button>
                      <DecisionButton size="sm" variant="ghost" hideLabel icon={<Trash2 size={14} aria-hidden="true" />} label="Remove" decision="remove" title={`Remove "${it.title}" from this month`} onDecide={(_, r) => onRemove(it.id, r)} />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Edit a KPI or duty task for this month: name, KPI type, target and an optional earlier due date. */
function EditItemDrawer({ item, month, types, onClose }: { item: KpiItem; month: MonthInfo; types: KpiType[]; onClose: () => void }) {
  const [form, setForm] = useState({
    title: item.title,
    kpi_type_id: item.kpi_type?.id ?? 0,
    target_value: item.target_value === null ? "" : String(item.target_value),
    target_date: item.due_set_by_manager ? item.target_date ?? "" : "",
  });
  const save = useApiMutation<object>("patch", `/individual/items/${item.id}`);
  const err = save.error;
  const lastDay = item.target_date && !item.due_set_by_manager ? item.target_date : null;
  const submit = () => {
    const body: Record<string, unknown> = { version: item.version, title: form.title, target_date: form.target_date || null };
    if (item.kind === "kpi") {
      body.kpi_type_id = form.kpi_type_id || null;
      body.target_value = numOrNull(form.target_value);
    }
    save.mutate(body, { onSuccess: () => { toast("Saved."); onClose(); } });
  };
  return (
    <Drawer
      open
      onClose={onClose}
      eyebrow={month.label}
      title={item.kind === "kpi" ? "Edit KPI" : "Edit duty task"}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={save.isPending} onClick={submit}>Save</Button></>}
    >
      <FormError error={err} />
      <div className="form-grid">
        <Field label={item.kind === "kpi" ? "KPI" : "Duty task"} required className="full" error={fieldError(err, "title")}>
          <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </Field>
        {item.kind === "kpi" && (
          <>
            <Field label="KPI type" required error={fieldError(err, "kpi_type_id")}>
              <select className="input" value={form.kpi_type_id} onChange={(e) => setForm({ ...form, kpi_type_id: Number(e.target.value) })}>
                {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
            <Field label="Monthly target" error={fieldError(err, "target_value")}>
              <input className="input" inputMode="decimal" value={form.target_value} onChange={(e) => setForm({ ...form, target_value: e.target.value })} />
            </Field>
          </>
        )}
        <Field label="Due date" error={fieldError(err, "target_date")} help={`Leave blank to use the month's last day${lastDay ? ` (${fmtDate(lastDay)})` : ""}. Changes apply to ${month.label} only.`}>
          <input className="input" type="date" min={month.month} value={form.target_date} onChange={(e) => setForm({ ...form, target_date: e.target.value })} />
        </Field>
      </div>
      <p className="small muted mt">Next month this row carries over with the same name, type and target, due on that month's last day.</p>
    </Drawer>
  );
}

interface HistoryRow {
  id: number;
  at: string;
  actor: Person | null;
  action: string;
  text: string;
  label: string | null;
  reason: string | null;
  old: Record<string, unknown> | null;
  new: Record<string, unknown> | null;
}

const FIELD_NAMES: Record<string, string> = {
  achieved_value: "achieved", target_value: "target", outcome: "outcome", completed_date: "done on", delay_reason: "delay reason", target_date: "due date",
  title: "name", kpi_type_id: "KPI type", remarks: "remarks", quality_rating: "Quality", csat_rating: "CSAT", twcs_score: "training score", completed: "completed",
  comments: "comments", training_none_due: "no training due",
};

function changeText(h: HistoryRow): string {
  const keys = Object.keys(h.new ?? {}).filter((k) => FIELD_NAMES[k] && k !== "version");
  return keys.map((k) => `${FIELD_NAMES[k]}: ${h.old && k in h.old ? `${h.old[k] ?? "—"} → ` : ""}${(h.new ?? {})[k] ?? "—"}`).join(" · ");
}

const TONE_FOR_ACTION = (action: string) => (/approve|verify|validate/.test(action) ? "ok" : /return|reject|remove/.test(action) ? "bad" : "");

/** Who changed what for this person and month (from the append-only audit log). */
function HistoryPanel({ employeeId, monthId }: { employeeId: number; monthId: number }) {
  const q = useApiQuery<HistoryRow[]>(`/individual/history/${employeeId}/${monthId}`);
  const [all, setAll] = useState(false);
  const rows = q.data ?? [];
  return (
    <div className="panel">
      <div className="panel-b">
        {q.isLoading && <Loading />}
        {rows.length === 0 && !q.isLoading && (
          <p className="muted small">
            <Info size={14} aria-hidden="true" style={{ verticalAlign: -2 }} /> No changes recorded yet.
          </p>
        )}
        {rows.length > 0 && (
          <ul className="timeline">
            {(all ? rows : rows.slice(0, 8)).map((h) => (
              <li key={h.id} className={TONE_FOR_ACTION(h.action)}>
                <b style={{ fontWeight: 500 }}>{h.actor?.name ?? "System"}</b> {h.text.charAt(0).toLowerCase() + h.text.slice(1)} {h.label && <span className="muted">{h.label}</span>}
                {changeText(h) && <div className="small muted">{changeText(h)}</div>}
                {h.reason && <div className="small muted">Reason: {h.reason}</div>}
                <time>{fmtDateTime(h.at)}</time>
              </li>
            ))}
          </ul>
        )}
      </div>
      {rows.length > 8 && (
        <div className="panel-f">
          <button type="button" className="link-btn small" onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show all ${rows.length}`}</button>
        </div>
      )}
    </div>
  );
}
