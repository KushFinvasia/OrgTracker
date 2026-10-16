import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { api, ApiError } from "@/api/client";
import type { Person } from "@/api/types";
import { Badge, Button, Callout, Card, DecisionButton, ErrorState, Field, Loading, PageHeader, PersonChip, toast } from "@/components/ui";
import { fmtDate, fmtDateTime, fmtPct, fmtScore, todayISO } from "@/lib/format";
import { useApiQuery } from "@/lib/hooks";
import { AddItemDrawer, FlagsCell, ModuleDrawer, numOrNull, type TrainingData, type TrainingModuleRow } from "./marking";
import { type CountKey, fmtValue, type KpiItem, type KpiType, MonthPicker, NotInPilot, SHEET_COLUMNS, useMonth, usePilot } from "./shared";

interface PersonMonth {
  employee: Person;
  month: { id: number; label: string; state: string; month: string; training_cutoff: string };
  evaluation: (Record<string, number | null | string | boolean> & { version: number; state: string; decision_note: string | null; decided_at: string | null }) | null;
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
type Marks = Record<string, number | null>;

/** Team → one person: every KPI for the month, the mark for each, the R&R ratings and training. One page, one Save. */
export function TeamPersonPage() {
  const { person } = useParams();
  const ctx = usePilot();
  const [monthId, setMonth] = useMonth(ctx.data);
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
  const d = q.data;

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
  const dirtyItems = Object.keys(items).map(Number).filter((id) => Object.keys(items[id]).length);
  const dirty = dirtyItems.length > 0 || Object.keys(marks).length > 0;
  const kpis = d.item_details.filter((i) => i.kind === "kpi");
  const duties = d.item_details.filter((i) => i.kind === "duty");
  const tp = training.data?.people[0];

  // Live values while marking: % and timing update as you type, before saving.
  const live = new Map<number, { pct: number | null; timing: string; target: number | null; achieved: number | null }>();
  for (const it of d.item_details) {
    const dr = items[it.id] ?? {};
    const target = "target_value" in dr ? dr.target_value ?? null : it.effective_target;
    const achieved = "achieved_value" in dr ? dr.achieved_value ?? null : it.effective_achieved;
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
    achievement_pct: pcts.length ? pcts.reduce((a, p) => a + Math.min(p, 150), 0) / pcts.length : null,
  };
  const requiredRatings = new Set(d.rated_metrics.filter((m) => m.required).map((m) => `${m.metric}_rating`));
  const ratingFields = SHEET_COLUMNS.filter((c) => (c.kind === "rating" && requiredRatings.has(c.key)) || c.kind === "twcs");

  const itemVal = <K extends keyof ItemDraft>(it: KpiItem, k: K): KpiItem[K] => (items[it.id] && k in items[it.id] ? (items[it.id][k] as KpiItem[K]) : it[k]);
  const setItem = (id: number, patch: ItemDraft) => setItems((s) => ({ ...s, [id]: { ...s[id], ...patch } }));
  const markVal = (key: string): number | null => {
    if (key in marks) return marks[key];
    if (key.endsWith("_rating")) return (ev?.[key] as number | null) ?? null;
    return d.inputs?.entered[key as CountKey] ?? null;
  };

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

  return (
    <>
      <PageHeader
        title={<PersonChip person={d.employee} />}
        sub={`${d.month.label} / marked by ${d.evaluator?.name ?? "—"} / approved by ${d.approver_roles.map((r) => (r === "hod" ? "HOD" : "Admin")).join(" or ")}`}
        actions={
          <>
            <Badge status={d.evaluation_state} />
            {ctx.data && <MonthPicker months={ctx.data.months} value={monthId} onChange={setMonth} />}
            <Link className="btn" to={`/individual/team?month=${d.month.id}`}>Back to team</Link>
            <Link className="btn" to={`/individual/performance/${d.employee.id}/${d.month.id}`}>See result</Link>
          </>
        }
      />
      {d.locked && <Callout title={`${d.month.label} is locked`}>These marks are final.</Callout>}
      {ev?.state === "Returned" && <Callout tone="danger" title={`Returned by ${d.decided_by?.name ?? "the approver"} on ${fmtDateTime(ev.decided_at)}`}>{ev.decision_note}</Callout>}
      {!editable && !d.locked && d.edit_reason && <Callout>{d.edit_reason}</Callout>}

      <div className="stack" style={{ marginTop: 16 }}>
        {/* 1. KPIs and the mark for each */}
        <Card
          title={`1. KPIs (${kpis.length})`}
          sub="Enter the achieved value for each KPI and whether it was completed on time. Achievement = achieved ÷ target."
          actions={editable && <Button onClick={() => setAdding("kpi")}>Add KPI</Button>}
        >
          {kpis.length === 0 ? (
            <p className="muted">No targets set for {d.month.label}.</p>
          ) : (
            <ItemTable rows={kpis} editable={editable} withNumbers live={live} itemVal={itemVal} setItem={setItem} results={results} onValidate={(id, decision, reason) => void act(() => api.post(`/individual/items/${id}/validate-delay`, { decision, reason }), "Delay reason decided.")} />
          )}
        </Card>

        {duties.length > 0 || editable ? (
          <Card title={`Duty tasks (${duties.length})`} sub="Tasks with a deadline but no number. They count for on-time and delays." actions={editable && <Button onClick={() => setAdding("duty")}>Add duty task</Button>}>
            {duties.length === 0 ? <p className="muted">No duty tasks.</p> : (
              <ItemTable rows={duties} editable={editable} live={live} itemVal={itemVal} setItem={setItem} results={results} onValidate={(id, decision, reason) => void act(() => api.post(`/individual/items/${id}/validate-delay`, { decision, reason }), "Delay reason decided.")} />
            )}
          </Card>
        ) : null}

        {/* 2. Ratings: the R&R parameters */}
        <Card title="2. Ratings" sub="Worked out from the KPIs above, plus the ratings you give.">
          <div className="grid grid-3 mb">
            <div className="stat"><div className="label">Tasks on-time</div><div className="value">{auto.on_time_count}</div><div className="hint">From section 1</div></div>
            <div className="stat"><div className="label">Tasks delayed</div><div className="value">{auto.delayed_count}</div><div className="hint">From section 1</div></div>
            <div className="stat">
              <div className="label">KPI average %</div>
              <div className="value">{auto.achievement_pct === null ? "—" : fmtPct(auto.achievement_pct, 2)}</div>
              <div className="hint">{pcts.length} of {kpisWithTarget} KPIs marked; unmarked KPIs are left out, not counted as 0</div>
            </div>
          </div>
          {kpisWithTarget > 0 && (
            <table className="table mb">
              <thead><tr><th>KPI</th><th>Target</th><th>Achieved</th><th>Achieved %</th></tr></thead>
              <tbody>
                {kpis.filter((it) => (live.get(it.id)?.target ?? null) !== null).map((it) => {
                  const l = live.get(it.id)!;
                  return (
                    <tr key={it.id}>
                      <td>{it.title}</td>
                      <td className="num">{fmtValue(l.target, it.kpi_type?.unit)}</td>
                      <td className="num">{l.achieved === null ? <span className="muted">Not marked</span> : fmtValue(l.achieved, it.kpi_type?.unit)}</td>
                      <td className="num">{l.pct === null ? "—" : <>{fmtPct(l.pct, 2)}{l.pct > 150 && <span className="sub"> (150 counted)</span>}</>}</td>
                    </tr>
                  );
                })}
                <tr><td className="strong">Average of all KPIs</td><td /><td /><td className="num strong">{auto.achievement_pct === null ? "—" : fmtPct(auto.achievement_pct, 2)}</td></tr>
              </tbody>
            </table>
          )}
          <div className="form-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
            {ratingFields.map((c) => {
              const derived = c.kind === "twcs" ? d.inputs?.derived.twcs_score : null;
              const v = markVal(c.key);
              return (
                <Field key={c.key} label={c.label} required={c.kind === "rating"} help={c.kind === "twcs" ? "Leave blank to use the training modules below" : c.help}>
                  {c.kind === "rating" ? (
                    <select className="input" disabled={!editable} value={v ?? ""} onChange={(e) => setMarks({ ...marks, [c.key]: e.target.value ? Number(e.target.value) : null })}>
                      <option value="">Not rated</option>
                      {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  ) : (
                    <input
                      className="input"
                      inputMode="decimal"
                      disabled={!editable}
                      placeholder={derived === null || derived === undefined ? "Not recorded" : `${derived.toFixed(2)} (from modules)`}
                      value={v ?? ""}
                      onChange={(e) => setMarks({ ...marks, [c.key]: numOrNull(e.target.value) })}
                    />
                  )}
                </Field>
              );
            })}
          </div>
          {results.marks && <p className="small" style={{ color: results.marks === "Saved" ? "var(--green)" : "var(--red-fg)" }}>{results.marks}</p>}
        </Card>

        {/* 3. Training */}
        <Card
          title="3. Training"
          sub={tp ? (tp.status === "scored" ? `TWCS ${fmtScore(tp.twcs)} · ${tp.band} · KEKA ${tp.keka}` : tp.status === "na" ? "No training due this month" : "No modules due this month are recorded") : undefined}
          actions={editable && <Button onClick={() => setModuleOpen("new")}>Add module</Button>}
        >
          <p className="small muted">
            Credit per module: on time 100 · 1–7 days late 75 · 8–14 days late 50 · 15+ days late 25 · not done by {fmtDate(d.month.training_cutoff)} 0. TWCS is the average.
            You can also type the TWCS directly in Ratings.
          </p>
          {(tp?.modules.length ?? 0) > 0 && (
            <table className="table">
              <thead><tr><th>Module</th><th>Track</th><th>Due</th><th>Completed</th><th>Days late</th><th>Credit</th><th>Verified</th><th /></tr></thead>
              <tbody>
                {tp!.modules.map((m) => (
                  <tr key={m.id} style={m.in_month ? undefined : { opacity: 0.6 }}>
                    <td>{m.title}{!m.in_month && <div className="sub">Due in a later month</div>}</td>
                    <td className="small">{m.track}</td>
                    <td>{fmtDate(m.due_date)}</td>
                    <td>{m.completed_date ? fmtDate(m.completed_date) : <span className="muted">Not completed</span>}</td>
                    <td className="num">{m.days_late ?? "—"}</td>
                    <td className="num">{m.status === "Exempt" ? <Badge tone="grey">Exempt</Badge> : m.credit}</td>
                    <td>{m.completed_date ? (m.verified ? <Badge tone="green">Verified</Badge> : <Badge tone="amber">Awaiting</Badge>) : "—"}</td>
                    <td>
                      <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                        {editable && m.status !== "Exempt" && <Button size="sm" onClick={() => setModuleOpen(m)}>{m.completed_date ? "Edit" : "Record completion"}</Button>}
                        {m.can_verify && <Button size="sm" variant="green" onClick={() => void act(() => api.post(`/individual/training/${m.id}/verify`), "Completion verified.")}>Verify</Button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        {/* Save / submit / approve */}
        <Card>
          {d.readiness.length > 0 && !d.locked && (
            <Callout tone="warn" title="Still to do">
              <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{d.readiness.map((r) => <li key={r}>{r}</li>)}</ul>
            </Callout>
          )}
          <div className="row between mt">
            <div>
              <b>Result so far: </b>
              {d.scorecard.final === null ? <span className="muted">Not enough data yet</span> : <span className="num strong">{fmtScore(d.scorecard.final)}</span>}{" "}
              {d.scorecard.tier && <Badge status={d.scorecard.tier} />}
            </div>
            <div className="row">
              {editable && <Button variant={dirty ? "primary" : "secondary"} disabled={!dirty || busy} onClick={() => void saveAll()}>{busy ? "Saving..." : "Save"}</Button>}
              {editable && d.can_submit && !dirty && <Button variant="primary" disabled={busy} onClick={() => void act(() => api.post(`${path}/submit`), "Submitted to the approver.")}>Submit for approval</Button>}
              {d.can_approve && (
                <>
                  <DecisionButton label="Return with reason" decision="return" busy={busy} onDecide={(dd, r) => void act(() => api.post(`${path}/decide`, { decision: dd, reason: r }), "Returned to the Manager.")} />
                  <DecisionButton label="Approve" decision="approve" variant="green" reasonRequired={false} busy={busy} onDecide={(dd, r) => void act(() => api.post(`${path}/decide`, { decision: dd, reason: r }), "Approved.")} />
                </>
              )}
            </div>
          </div>
          {editable && !d.can_submit && !dirty && <p className="small muted mt">Save the marks first, then submit them to the approver.</p>}
        </Card>
      </div>

      {adding && training.data && <AddItemDrawer kind={adding} month={training.data.month} people={[d.employee]} types={types.data ?? []} defaultPerson={d.employee.id} onClose={() => setAdding(null)} />}
      {moduleOpen && training.data && (
        <ModuleDrawer month={training.data.month} tracks={training.data.tracks} people={[d.employee]} module={moduleOpen === "new" ? undefined : moduleOpen} defaultPerson={d.employee.id} onClose={() => setModuleOpen(null)} />
      )}
    </>
  );
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
}: {
  rows: KpiItem[];
  editable: boolean;
  withNumbers?: boolean;
  live: Map<number, { pct: number | null; timing: string; target: number | null; achieved: number | null }>;
  itemVal: <K extends keyof ItemDraft>(it: KpiItem, k: K) => KpiItem[K];
  setItem: (id: number, patch: ItemDraft) => void;
  results: Record<string, string>;
  onValidate: (id: number, decision: string, reason: string) => void;
}) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>{withNumbers ? "KPI" : "Task"}</th>
            {withNumbers && <><th>Target</th><th>Achieved</th><th>%</th></>}
            <th>Done?</th>
            <th>Completed on</th>
            <th>Timing</th>
            <th>Delay reason</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((it) => {
            const unit = it.kpi_type?.unit;
            const res = results[`item-${it.id}`];
            return (
              <tr key={`${it.id}-${it.version}`}>
                <td style={{ minWidth: 220, maxWidth: 320 }}>
                  {it.title} {it.is_team && <Badge tone="blue">Team</Badge>}
                  {it.kpi_type && <div className="sub">{it.kpi_type.name}</div>}
                  <FlagsCell flags={it.flags} />
                  {res && <div className="small" style={{ color: res === "Saved" ? "var(--green)" : "var(--red-fg)" }}>{res}</div>}
                </td>
                {withNumbers && (
                  <>
                    <td>
                      {editable ? (
                        <input className="input" style={{ width: 100 }} inputMode="decimal" aria-label={`Target: ${it.title}`} defaultValue={it.target_value ?? ""} onChange={(e) => setItem(it.id, { target_value: numOrNull(e.target.value) })} />
                      ) : <span className="num">{fmtValue(it.effective_target, unit)}</span>}
                      {it.target_value === null && it.target_text && <div className="sub">Tracker: {it.target_text}</div>}
                    </td>
                    <td>
                      {editable ? (
                        <input className="input" style={{ width: 100 }} inputMode="decimal" aria-label={`Achieved: ${it.title}`} defaultValue={it.achieved_value ?? ""} placeholder={it.is_team && it.team_sum?.achieved_sum != null ? String(it.team_sum.achieved_sum) : ""} onChange={(e) => setItem(it.id, { achieved_value: numOrNull(e.target.value) })} />
                      ) : <span className="num">{fmtValue(it.effective_achieved, unit)}</span>}
                    </td>
                    <td className="num strong">{live.get(it.id)?.pct == null ? "—" : fmtPct(live.get(it.id)!.pct, 1)}</td>
                  </>
                )}
                <td>
                  {editable ? (
                    <select className="input" style={{ width: 145 }} aria-label={`Done: ${it.title}`} value={itemVal(it, "outcome") ?? ""} onChange={(e) => setItem(it.id, { outcome: (e.target.value || null) as KpiItem["outcome"], ...(e.target.value !== "Completed" ? { completed_date: null } : {}) })}>
                      <option value="">Not recorded</option>
                      <option>Completed</option>
                      <option>Not completed</option>
                    </select>
                  ) : it.outcome ?? <span className="muted">Not recorded</span>}
                </td>
                <td>
                  {editable ? (
                    <input className="input" type="date" style={{ width: 140 }} max={todayISO()} aria-label={`Completed on: ${it.title}`} disabled={itemVal(it, "outcome") !== "Completed"} value={itemVal(it, "completed_date") ?? ""} onChange={(e) => setItem(it.id, { completed_date: e.target.value || null })} />
                  ) : fmtDate(it.completed_date)}
                  <div className="sub">Due {fmtDate(it.target_date)}</div>
                </td>
                <td><Badge status={live.get(it.id)?.timing ?? it.timing} /></td>
                <td>
                  {editable ? (
                    <input className="input" style={{ width: 150 }} aria-label={`Delay reason: ${it.title}`} defaultValue={it.delay_reason ?? ""} onChange={(e) => setItem(it.id, { delay_reason: e.target.value || null })} />
                  ) : it.delay_reason ?? <span className="muted">—</span>}
                  {it.delay_reason && <div className="sub">{it.delay_validated ? "Validated" : "Not validated"}</div>}
                  {it.can_validate_delay && (
                    <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: "nowrap" }}>
                      <Button size="sm" variant="green" onClick={() => onValidate(it.id, "validate", "")}>Validate</Button>
                      <DecisionButton size="sm" label="Reject" decision="reject" onDecide={(dd, r) => onValidate(it.id, dd, r)} />
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
