import { useEffect, useState } from "react";

import type { Person } from "@/api/types";
import { Badge, Button, Callout, Card, DecisionButton, ErrorState, Field, fieldError, FormError, Loading, PageHeader, PersonChip, Tabs, toast } from "@/components/ui";
import { fmtDate, fmtDateTime, fmtScore } from "@/lib/format";
import { useApiMutation, useApiQuery } from "@/lib/hooks";
import { type KpiType, MonthPicker, usePilot } from "./shared";

type Pair = [number, number];

interface RuleConfig {
  weights: Record<string, Record<string, number>>;
  anchors: { achievement: Pair[]; on_time: Pair[] };
  achievement_cap: number;
  rating_multiplier: number;
  min_on_time_outcomes: number;
  coverage_min: number;
  working_days: number;
  penalties: { per_delay_enabled: boolean; per_delay: number; exclude_validated_delays: boolean; training_enabled: boolean; training_threshold: number; training_penalty: number };
  twcs: { credits: Pair[]; credit_beyond: number; credit_not_done: number; cutoff_day: number; early_bonus: boolean; bands: [number, string, number][]; track_weights: Record<string, number> };
  tiers: [string, number][];
  tiers_proposed: boolean;
  source?: string;
}

interface Rule {
  id: number;
  label: string;
  state: string;
  summary: string | null;
  config: RuleConfig;
  effective_month: string | null;
  author: Person | null;
  approver: Person | null;
  decision_note: string | null;
  created_at: string;
  decided_at: string | null;
  months: { label: string; state: string }[];
  can_edit: boolean;
  can_decide: boolean;
}

interface RulesData {
  active_id: number | null;
  rules: Rule[];
  metrics: { metric: string; label: string }[];
  kpi_types: KpiType[];
  imports: { source: string; at: string; summary: Record<string, unknown> }[];
  can_author: boolean;
}

interface Preview {
  current_rule: string;
  rule: string;
  tier_changes: number;
  note: string;
  rows: { employee: Person; current: { final: number | null; tier: string | null; status: string }; proposed: { final: number | null; tier: string | null; status: string }; delta: number | null }[];
}

type Tab = "method" | "catalogue" | "versions";

export function KpiScoringPage() {
  const data = useApiQuery<RulesData>("/individual/rules");
  const ctx = usePilot();
  const [tab, setTab] = useState<Tab>("method");
  const [selected, setSelected] = useState<number | null>(null);
  const [draft, setDraft] = useState<{ id: number | null; label: string; summary: string; effective_month: string; config: RuleConfig } | null>(null);
  const [previewMonth, setPreviewMonth] = useState<number | null>(null);
  const create = useApiMutation<object, Rule>("post", "/individual/rules");
  const update = useApiMutation<object, Rule>("put", `/individual/rules/${draft?.id}`);
  const submit = useApiMutation<{ id: number }>("post", (b) => `/individual/rules/${b.id}/submit`);
  const decide = useApiMutation<{ id: number; decision: string; reason: string }>("post", (b) => `/individual/rules/${b.id}/decide`);

  const d = data.data;
  useEffect(() => {
    if (d && selected === null) setSelected(d.rules.find((r) => r.state === "Pending approval")?.id ?? d.active_id ?? d.rules[0]?.id ?? null);
  }, [d, selected]);
  useEffect(() => {
    if (!previewMonth && ctx.data?.focus_month_id) setPreviewMonth(ctx.data.focus_month_id);
  }, [ctx.data, previewMonth]);
  const rule = d?.rules.find((r) => r.id === selected);
  const previewRuleId = draft?.id ?? (rule && rule.state !== "Approved" ? rule.id : null);
  const preview = useApiQuery<Preview>(previewRuleId && previewMonth ? `/individual/rules/${previewRuleId}/preview?month_id=${previewMonth}` : null);

  if (data.isLoading) return <Loading rows={3} />;
  if (!d) return <ErrorState error={data.error} />;
  const cfg = draft?.config ?? rule?.config;
  const editing = !!draft;
  const saveErr = (draft?.id ? update.error : create.error) ?? null;

  const startNew = (from: Rule) => {
    const next = new Date();
    const em = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-01`;
    setDraft({ id: null, label: `${from.label.replace(/ v\d+$/, "")} v${d.rules.length + 1}`, summary: "", effective_month: em, config: structuredClone(from.config) });
    setTab("method");
  };
  const save = () => {
    if (!draft) return;
    const body = { label: draft.label, summary: draft.summary || null, effective_month: draft.effective_month, config: draft.config };
    const m = draft.id ? update : create;
    m.mutate(body, {
      onSuccess: (r) => {
        toast("Draft saved. Check the impact preview, then submit for approval.");
        setDraft({ ...draft, id: r.id });
        setSelected(r.id);
      },
    });
  };
  const setCfg = (fn: (c: RuleConfig) => void) => {
    if (!draft) return;
    const c = structuredClone(draft.config);
    fn(c);
    setDraft({ ...draft, config: c });
  };

  return (
    <>
      <PageHeader
        title="KPI Scoring"
        sub="The scoring method for the Individual Tier: weights, curves, penalties, training (TWCS), coverage and tiers. Versioned; a different person approves; locked months keep their rule."
        actions={
          <>
            {!editing && rule && d.can_author && <Button onClick={() => startNew(rule)}>New version from {rule.label}</Button>}
            {editing && <Button onClick={() => setDraft(null)}>Discard edits</Button>}
            {editing && <Button variant="primary" disabled={create.isPending || update.isPending} onClick={save}>Save draft</Button>}
          </>
        }
      />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "method", label: editing ? "Edit method" : "Scoring method" }, { id: "catalogue", label: "KPI catalogue & import" }, { id: "versions", label: `Versions (${d.rules.length})` }]} />
      {tab === "method" && cfg && (
        <div className="stack">
          {rule && !editing && (
            <Callout title={`${rule.label}: ${rule.state}`} tone={rule.state === "Approved" ? "mint" : "warn"}>
              {rule.summary} Effective from {rule.effective_month ? fmtDate(rule.effective_month) : "—"}.
              {rule.author ? ` Author ${rule.author.name}.` : ""} {rule.approver ? ` Approved by ${rule.approver.name} ${fmtDateTime(rule.decided_at)}.` : ""} {rule.decision_note}
              {rule.months.length > 0 && ` Used by: ${rule.months.map((m) => `${m.label} (${m.state})`).join(", ")}.`}
              {rule.can_decide && (
                <div className="row mt">
                  <DecisionButton label="Return with reason" decision="return" onDecide={(dd, r) => decide.mutate({ id: rule.id, decision: dd, reason: r }, { onSuccess: () => toast("Returned to the author."), onError: (e) => toast(e.message, true) })} />
                  <DecisionButton label="Approve and activate" variant="green" decision="approve" reasonRequired={false} onDecide={(dd, r) => decide.mutate({ id: rule.id, decision: dd, reason: r }, { onSuccess: () => toast("Approved. Open months from the effective month now use it."), onError: (e) => toast(e.message, true) })} />
                </div>
              )}
              {rule.can_edit && (
                <div className="row mt">
                  <Button onClick={() => setDraft({ id: rule.id, label: rule.label, summary: rule.summary ?? "", effective_month: rule.effective_month ?? "", config: structuredClone(rule.config) })}>Edit draft</Button>
                  <Button variant="primary" onClick={() => submit.mutate({ id: rule.id }, { onSuccess: () => toast("Submitted. Another Admin or the HOD approves it."), onError: (e) => toast(e.message, true) })}>Submit for approval</Button>
                </div>
              )}
            </Callout>
          )}
          {editing && draft && (
            <Card title={draft.id ? `Editing ${draft.label}` : "New version"} sub="Nothing changes until another person approves it. Approved versions never change.">
              <FormError error={saveErr} />
              <div className="form-grid">
                <Field label="Version label" required error={fieldError(saveErr, "label")}>
                  <input className="input" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
                </Field>
                <Field label="Effective from (month)" required help="Open months from this month switch on approval; locked months keep their rule.">
                  <input className="input" type="month" value={draft.effective_month.slice(0, 7)} onChange={(e) => setDraft({ ...draft, effective_month: `${e.target.value}-01` })} />
                </Field>
                <Field label="What changed and why" className="full">
                  <textarea className="input" value={draft.summary} onChange={(e) => setDraft({ ...draft, summary: e.target.value })} />
                </Field>
              </div>
            </Card>
          )}

          <Card title="Category weights" sub="Each category totals 100%. Training is 10% inside every category (scored by TWCS), so there is no separate training blend.">
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Category</th>{d.metrics.map((m) => <th key={m.metric}>{m.label}</th>)}<th>Total</th></tr></thead>
                <tbody>
                  {Object.entries(cfg.weights).map(([cat, w]) => {
                    const total = Object.values(w).reduce((a, b) => a + Number(b || 0), 0);
                    return (
                      <tr key={cat}>
                        <td className="strong">{cat}{cat === ctx.data?.category && <div className="sub">Sales pilot</div>}</td>
                        {d.metrics.map((m) => (
                          <td key={m.metric} className="num">
                            {editing ? (
                              <input className="input" style={{ width: 64 }} inputMode="numeric" aria-label={`${cat} ${m.label} weight`} value={w[m.metric] ?? 0} onChange={(e) => setCfg((c) => { c.weights[cat][m.metric] = Number(e.target.value) || 0; })} />
                            ) : w[m.metric] ? `${w[m.metric]}%` : "–"}
                          </td>
                        ))}
                        <td className="num strong" style={{ color: Math.abs(total - 100) > 0.001 ? "var(--red-fg)" : undefined }}>{total}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="grid grid-2">
            <Card title="Curves" sub="Linear between points, clamped at the ends">
              <CurveEditor label="Achievement % → score" pts={cfg.anchors.achievement} editing={editing} onChange={(p) => setCfg((c) => { c.anchors.achievement = p; })} />
              <CurveEditor label="On-time % → score" pts={cfg.anchors.on_time} editing={editing} onChange={(p) => setCfg((c) => { c.anchors.on_time = p; })} />
              <NumberRow label="Achievement cap per row (%)" value={cfg.achievement_cap} editing={editing} onChange={(v) => setCfg((c) => { c.achievement_cap = v; })} />
              <NumberRow label="Minimum outcomes for On-time" value={cfg.min_on_time_outcomes} editing={editing} onChange={(v) => setCfg((c) => { c.min_on_time_outcomes = v; })} />
              <NumberRow label="Rating multiplier (1–5 × n)" value={cfg.rating_multiplier} editing={editing} onChange={(v) => setCfg((c) => { c.rating_multiplier = v; })} />
              <NumberRow label="Working days per month" value={cfg.working_days} editing={editing} onChange={(v) => setCfg((c) => { c.working_days = v; })} />
            </Card>
            <Card title="Penalties, coverage and tiers" sub="Final = max(0, base − penalties)">
              <ToggleRow label={`−${cfg.penalties.per_delay} per delayed case (D4)`} value={cfg.penalties.per_delay_enabled} editing={editing} onChange={(v) => setCfg((c) => { c.penalties.per_delay_enabled = v; })} />
              <NumberRow label="Points per delay" value={cfg.penalties.per_delay} editing={editing} onChange={(v) => setCfg((c) => { c.penalties.per_delay = v; })} />
              <ToggleRow label="Validated delays are excluded (D5)" value={cfg.penalties.exclude_validated_delays} editing={editing} onChange={(v) => setCfg((c) => { c.penalties.exclude_validated_delays = v; })} />
              <ToggleRow label={`−${cfg.penalties.training_penalty} when TWCS < ${cfg.penalties.training_threshold} (D12)`} value={cfg.penalties.training_enabled} editing={editing} onChange={(v) => setCfg((c) => { c.penalties.training_enabled = v; })} />
              <NumberRow label="Training penalty threshold" value={cfg.penalties.training_threshold} editing={editing} onChange={(v) => setCfg((c) => { c.penalties.training_threshold = v; })} />
              <NumberRow label="Training penalty points" value={cfg.penalties.training_penalty} editing={editing} onChange={(v) => setCfg((c) => { c.penalties.training_penalty = v; })} />
              <NumberRow label="Minimum coverage (%)" value={cfg.coverage_min} editing={editing} onChange={(v) => setCfg((c) => { c.coverage_min = v; })} />
              {cfg.tiers.map(([name, t], i) => (
                <NumberRow key={name} label={`${name} tier from${cfg.tiers_proposed ? " (proposed)" : ""}`} value={t} editing={editing} onChange={(v) => setCfg((c) => { c.tiers[i][1] = v; })} />
              ))}
            </Card>
          </div>

          <Card title="Training: Timeliness-Weighted Completion Score" sub="Average credit over the modules due in the month. A completion counts once someone other than the recorder verifies it.">
            <div className="grid grid-2">
              <div>
                <h4 className="mb">Credit per module</h4>
                {cfg.twcs.credits.map(([days, credit], i) => (
                  <NumberRow key={i} label={days <= 0 ? "On or before the due date" : `Up to ${days} days late`} value={credit} editing={editing} onChange={(v) => setCfg((c) => { c.twcs.credits[i][1] = v; })} />
                ))}
                <NumberRow label={`More than ${cfg.twcs.credits[cfg.twcs.credits.length - 1][0]} days late`} value={cfg.twcs.credit_beyond} editing={editing} onChange={(v) => setCfg((c) => { c.twcs.credit_beyond = v; })} />
                <NumberRow label="Not completed by the cut-off" value={cfg.twcs.credit_not_done} editing={editing} onChange={(v) => setCfg((c) => { c.twcs.credit_not_done = v; })} />
                <NumberRow label="Cut-off: day of the next month (D10)" value={cfg.twcs.cutoff_day} editing={editing} onChange={(v) => setCfg((c) => { c.twcs.cutoff_day = v; })} />
              </div>
              <div>
                <h4 className="mb">Bands and KEKA rating</h4>
                <table className="table">
                  <thead><tr><th>Band</th><th>From TWCS</th><th>KEKA</th></tr></thead>
                  <tbody>
                    {cfg.twcs.bands.map(([min, name, keka], i) => (
                      <tr key={name}>
                        <td><Badge status={name} /></td>
                        <td className="num">{editing && i < cfg.twcs.bands.length - 1 ? <input className="input" style={{ width: 70 }} aria-label={`${name} minimum`} value={min} onChange={(e) => setCfg((c) => { c.twcs.bands[i][0] = Number(e.target.value) || 0; })} /> : min}</td>
                        <td className="num">{keka}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="small muted mt">Module tracks ({Object.keys(cfg.twcs.track_weights).join(", ")}) are weighted equally. Early completion gives no bonus (D11). KEKA receives the rating through the monthly export only.</p>
              </div>
            </div>
          </Card>

          {previewRuleId && (
            <Card
              title="Impact preview"
              sub={preview.data ? `${preview.data.current_rule} → ${preview.data.rule}: ${preview.data.tier_changes} tier or status change(s). ${preview.data.note}` : "Every person in scope under the month's current rule and under this version. Nothing is saved."}
              actions={ctx.data && <MonthPicker months={ctx.data.months} value={previewMonth} onChange={setPreviewMonth} />}
            >
              {editing && !draft?.id && <p className="muted">Save the draft to preview its impact.</p>}
              {editing && draft?.id && <p className="small muted">The preview reflects the last saved draft.</p>}
              <ErrorState error={preview.error} />
              {preview.data && (
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>Person</th><th>Current final</th><th>Current tier</th><th>Proposed final</th><th>Proposed tier</th><th>Change</th></tr></thead>
                    <tbody>
                      {preview.data.rows.map((r) => (
                        <tr key={r.employee.id}>
                          <td><PersonChip person={r.employee} meta={r.employee.code} /></td>
                          <td className="num">{r.current.final === null ? <span className="muted">Insufficient</span> : fmtScore(r.current.final)}</td>
                          <td>{r.current.tier ? <Badge status={r.current.tier} /> : "—"}</td>
                          <td className="num">{r.proposed.final === null ? <span className="muted">Insufficient</span> : fmtScore(r.proposed.final)}</td>
                          <td>{r.proposed.tier ? <Badge status={r.proposed.tier} /> : "—"}</td>
                          <td className="num">{r.delta === null ? "—" : `${r.delta > 0 ? "+" : ""}${fmtScore(r.delta)}`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}
        </div>
      )}
      {tab === "catalogue" && (
        <div className="grid grid-2">
          <Card title="KPI catalogue" sub="The Sales tracker's tasks are the KPIs. Each row is one person's monthly target.">
            <table className="table">
              <thead><tr><th>KPI type</th><th>Unit</th><th>Meaning</th></tr></thead>
              <tbody>
                {d.kpi_types.map((t) => (
                  <tr key={t.id}><td className="strong">{t.name}</td><td>{t.unit}</td><td className="small">{t.description}</td></tr>
                ))}
              </tbody>
            </table>
            <p className="small muted mt">Team versions of each type belong to Managers; blank team values use the sum of the reportees' rows.</p>
          </Card>
          <Card title="Imports">
            {d.imports.map((b, i) => (
              <div key={i} className="stack" style={{ gap: 6 }}>
                <b>{b.source}</b>
                <span className="small muted">{fmtDateTime(b.at)}</span>
                <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
                  <li>{String(b.summary.kpi_rows)} KPI rows and {String(b.summary.duty_rows)} duty tasks for {String(b.summary.people_with_rows)} people</li>
                  <li>{String(b.summary.flagged_rows)} rows flagged to check; {(b.summary.unmatched as unknown[] | undefined)?.length ?? 0} names unmatched</li>
                  <li>No targets set: {(b.summary.no_targets as string[] | undefined)?.join(", ") || "none"}</li>
                </ul>
              </div>
            ))}
            {d.imports.length === 0 && <p className="muted">No Sales tracker import yet.</p>}
          </Card>
        </div>
      )}
      {tab === "versions" && (
        <Card title="Versions">
          <table className="table">
            <thead><tr><th>Version</th><th>State</th><th>Effective</th><th>Author</th><th>Approver</th><th>Months</th><th /></tr></thead>
            <tbody>
              {d.rules.map((r) => (
                <tr key={r.id}>
                  <td className="strong">{r.label}{r.id === d.active_id && <div className="sub">Active for new months</div>}</td>
                  <td><Badge status={r.state} /></td>
                  <td>{r.effective_month ? fmtDate(r.effective_month) : "—"}</td>
                  <td>{r.author?.name ?? "Direction of 15 Oct 2026"}</td>
                  <td>{r.approver?.name ?? (r.state === "Approved" ? "User direction" : "—")}</td>
                  <td className="small">{r.months.map((m) => m.label).join(", ") || "—"}</td>
                  <td><button className="link-btn" onClick={() => { setSelected(r.id); setDraft(null); setTab("method"); }}>Open</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}

function NumberRow({ label, value, editing, onChange }: { label: string; value: number; editing: boolean; onChange: (v: number) => void }) {
  return (
    <div className="row between" style={{ padding: "7px 0", borderBottom: "1px solid var(--border)" }}>
      <span>{label}</span>
      {editing ? <input className="input" style={{ width: 90 }} inputMode="decimal" aria-label={label} value={value} onChange={(e) => onChange(Number(e.target.value) || 0)} /> : <b className="num">{value}</b>}
    </div>
  );
}

function ToggleRow({ label, value, editing, onChange }: { label: string; value: boolean; editing: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="row between" style={{ padding: "7px 0", borderBottom: "1px solid var(--border)" }}>
      <span>{label}</span>
      {editing ? <input type="checkbox" aria-label={label} checked={value} onChange={(e) => onChange(e.target.checked)} /> : <Badge tone={value ? "green" : "grey"}>{value ? "On" : "Off"}</Badge>}
    </div>
  );
}

function CurveEditor({ label, pts, editing, onChange }: { label: string; pts: Pair[]; editing: boolean; onChange: (p: Pair[]) => void }) {
  return (
    <div style={{ padding: "7px 0", borderBottom: "1px solid var(--border)" }}>
      <div className="mb small strong">{label}</div>
      <div className="row" style={{ gap: 8 }}>
        {pts.map(([x, y], i) => (
          <span key={i} className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
            {editing ? (
              <>
                <input className="input" style={{ width: 62 }} aria-label={`${label} point ${i + 1} raw`} value={x} onChange={(e) => onChange(pts.map((p, j) => (j === i ? [Number(e.target.value) || 0, p[1]] : p)))} />
                →
                <input className="input" style={{ width: 62 }} aria-label={`${label} point ${i + 1} score`} value={y} onChange={(e) => onChange(pts.map((p, j) => (j === i ? [p[0], Number(e.target.value) || 0] : p)))} />
              </>
            ) : (
              <Badge tone="grey">{x} → {y}</Badge>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}
