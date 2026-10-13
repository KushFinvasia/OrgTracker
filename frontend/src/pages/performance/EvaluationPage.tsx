import { useState } from "react";
import { useParams } from "react-router-dom";

import type { CheckIn, Evaluation } from "@/api/types";
import { Badge, Button, Callout, Card, Drawer, ErrorState, Field, FormError, Kv, Loading, PageHeader, Stat, Tabs, fieldError, toast } from "@/components/ui";
import { fmtDate, fmtNum, fmtPct, fmtScore, todayISO } from "@/lib/format";
import { useApiMutation, useApiQuery, useQueryParam } from "@/lib/hooks";

type Tab = "kpi" | "training" | "final" | "checkin" | "history";

export function EvaluationPage() {
  const { person, period } = useParams();
  const [tabParam, setTabParam] = useQueryParam("tab");
  const tab = (tabParam as Tab) || "final";
  const [overriding, setOverriding] = useState(false);
  const { data: ev, isLoading, error } = useApiQuery<Evaluation>(`/evaluations/${person}/${period}`);
  if (isLoading) return <Loading rows={3} />;
  if (error || !ev) return <ErrorState error={error} />;
  const proposed = ev.training_rule && ev.training_rule.state !== "Approved";

  return (
    <>
      <PageHeader
        title="Understand the final score, from work to training"
        sub={`${ev.employee.name} / ${ev.employee.code} / ${ev.employee.department ?? "No department"} / ${ev.period.name} / ${ev.category}${ev.category_proposed ? " (proposed category)" : ""}${ev.locked ? " / Locked snapshot" : ""}`}
        actions={ev.can_override && <Button onClick={() => setOverriding(true)}>Record HOD override</Button>}
      />
      {ev.illustrative_inputs && <Callout tone="warn" title="Illustrative inputs">Some targets, ratings or training records in this evaluation are illustrative demo data, not source personnel findings.</Callout>}
      <Tabs
        value={tab}
        onChange={(t) => setTabParam(t)}
        tabs={[
          { id: "kpi", label: "KPI result" },
          { id: "training", label: "Training contribution" },
          { id: "final", label: "Final R&R" },
          { id: "checkin", label: "Check-in", hidden: ev.locked },
          { id: "history", label: "Evidence history" },
        ]}
      />
      {tab === "kpi" && <KpiTable ev={ev} />}
      {tab === "final" && (
        <div className="grid" style={{ gridTemplateColumns: "minmax(280px, 0.8fr) minmax(0, 2fr)" }}>
          <div className="score-card">
            <div className="label">FINAL R&amp;R SCORE</div>
            <div className="big">{ev.final.value !== null ? fmtScore(ev.final.value) : "—"}</div>
            <div style={{ color: "#c7d1cb" }}>/ 100</div>
            {ev.tier && <span className="pill mt" style={{ marginTop: 16 }}>{ev.tier} threshold met (draft tiers)</span>}
            {ev.final.value === null && <span className="pill" style={{ marginTop: 16 }}>{ev.final.status === "insufficient" ? "Insufficient data" : "Readiness exception"}</span>}
            <hr />
            <h3>Base KPI: {ev.base.value !== null ? fmtScore(ev.base.value, 2) : "Insufficient"}</h3>
            <h3 style={{ marginTop: 10 }}>Training: {ev.training.status === "scored" ? fmtPct(ev.training.score, 2) : ev.training.status === "na" ? "N/A" : "Unknown"}</h3>
            <hr />
            <p style={{ color: "#c7d1cb" }}>{fmtPct(ev.base.coverage)} KPI coverage. {ev.training.eligible} eligible training records. Award gates are checked separately.</p>
            {proposed && <span className="pill">Policy {ev.training_rule!.label} / proposed, not activated</span>}
          </div>
          <div className="stack">
            <KpiTable ev={ev} compact />
            <div className="callout">
              <b>Combined calculation</b>
              {ev.final.base_part !== undefined && ev.final.training_part !== undefined ? (
                <>
                  <div className="row" style={{ gap: 40, fontSize: 22, fontWeight: 800, color: "var(--ink)", margin: "10px 0" }}>
                    <span>{fmtScore(ev.base.value, 2)} x {fmtPct((ev.training_rule?.config.base_weight ?? 0.9) * 100)} = {fmtScore(ev.final.base_part)}</span>
                    <span>{fmtScore(ev.training.score, 2)} x {fmtPct((ev.training_rule?.config.training_weight ?? 0.1) * 100)} = {fmtScore(ev.final.training_part)}</span>
                  </div>
                  <div style={{ fontSize: 28, fontWeight: 800 }}>{fmtScore(ev.final.base_part)} + {fmtScore(ev.final.training_part)} = {fmtScore(ev.final.value)}</div>
                </>
              ) : (
                <p>{ev.final.explanation}</p>
              )}
              <p className="small">Training: {ev.training.verified} verified completions / {ev.training.eligible} due assignments x 100. Counted once, outside the existing KPI category weights.</p>
            </div>
            {ev.original_final && (
              <Callout tone="warn" title="HOD override applied">Original final {fmtScore(ev.original_final.value)} retained; corrected {fmtScore(ev.final.value)}. {ev.overrides.map((o) => `${o.metric}: ${o.original} > ${o.new} (${o.reason})`).join("; ")}</Callout>
            )}
            <Card title="Reward gates">
              <table className="table">
                <thead><tr><th>Gate</th><th>Result</th><th>Source</th></tr></thead>
                <tbody>{ev.gates.map((g) => <tr key={g.gate}><td>{g.gate}</td><td><Badge status={g.result}>{g.result === "unknown" ? "Unknown / source pending" : g.result}</Badge></td><td>{g.source}</td></tr>)}</tbody>
              </table>
              <p className="small muted">A high score never bypasses eligibility. Unknown gates are not treated as passed.</p>
            </Card>
          </div>
        </div>
      )}
      {tab === "training" && <TrainingLedger ev={ev} />}
      {tab === "checkin" && <CheckInForm ev={ev} />}
      {tab === "history" && (
        <div className="grid grid-2">
          <Card title="Source inputs" sub="Manual or batch inputs with authorship and validation">
            {(ev.inputs ?? []).length === 0 && <p className="muted">No source inputs recorded.</p>}
            {(ev.inputs ?? []).map((m) => (
              <div key={m.id} className="row between" style={{ borderBottom: "1px solid var(--border)", padding: "10px 0" }}>
                <span><b>{m.metric}</b> <span className="muted small">{JSON.stringify(m.values)}</span><div className="small muted">by {m.author?.name} / validator {m.validator?.name}{m.illustrative ? " / illustrative" : ""}</div></span>
                <Badge status={m.state} />
              </div>
            ))}
          </Card>
          <Card title="Check-ins">
            {(ev.checkins ?? []).map((c) => <p key={c.id}>{fmtDate(c.month).slice(3)}: quality {c.quality_rating ?? "—"}, collaboration {c.collaboration_rating ?? "—"}, innovation {c.innovation_rating ?? "—"} <Badge status={c.state} /></p>)}
            <h4 className="mt">Readiness</h4>
            {ev.readiness.length === 0 ? <p className="muted">No open readiness issues.</p> : ev.readiness.map((r) => <p key={r} className="small">• {r}</p>)}
          </Card>
        </div>
      )}
      {overriding && <OverrideDrawer ev={ev} onClose={() => setOverriding(false)} />}
    </>
  );
}

function KpiTable({ ev, compact }: { ev: Evaluation; compact?: boolean }) {
  return (
    <Card title={compact ? "Base KPI / Existing weights unchanged" : `Base KPI / ${ev.category} weights / rule ${ev.kpi_rule.label}`}>
      <table className="table">
        <thead><tr><th>Metric</th><th>Raw input</th><th>Score</th><th>Weight</th><th>Contribution</th></tr></thead>
        <tbody>
          {ev.base.rows.map((r) => (
            <tr key={r.metric}>
              <td><b>{r.label}</b></td>
              <td>{r.available ? r.raw_display : <span className="muted">{r.reason}</span>}</td>
              <td className="num">{r.available ? fmtNum(r.score, 1) : <Badge tone="amber">Unavailable</Badge>}</td>
              <td className="num">{r.weight}%</td>
              <td className="num">{r.contribution !== null ? fmtNum(r.contribution, 2) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row between mt">
        <span>Coverage <b>{fmtPct(ev.base.coverage)}</b> {!ev.base.sufficient && <Badge tone="red">Insufficient data (below 70%)</Badge>}</span>
        <span>Base KPI <b className="num">{ev.base.value !== null ? fmtScore(ev.base.value) : "Unavailable"}</b></span>
      </div>
      {!compact && <p className="small muted">Base KPI = sum(score x available weight) / sum(available weight). Unavailable metrics are never replaced with zero.</p>}
    </Card>
  );
}

function TrainingLedger({ ev }: { ev: Evaluation }) {
  const t = ev.training;
  return (
    <div className="stack">
      <div className="grid grid-4">
        <Stat label="Allotted total" value={t.allotted} hint="Includes future assignments" />
        <Stat label="Future due" value={t.future_due} hint="Excluded this period" />
        <Stat label="Eligible due" value={t.eligible} hint="Known assignment records" />
        <Stat label="Verified complete" value={t.verified} hint={`Completion score ${t.status === "scored" ? fmtPct(t.score) : t.status}`} />
      </div>
      <div className="grid grid-main">
        <Card title="Eligibility ledger">
          <table className="table">
            <thead><tr><th>Assignment group</th><th>Count</th><th>Treatment</th></tr></thead>
            <tbody>
              <tr><td>Verified complete by cutoff</td><td className="num">{t.verified}</td><td>Numerator + denominator</td></tr>
              <tr><td>Due / still in progress</td><td className="num">{t.in_progress}</td><td>Denominator only</td></tr>
              <tr><td>Due / submitted, unverified</td><td className="num">{t.pending_verification}</td><td>Denominator only</td></tr>
              <tr><td>Approved exemption / cancellation</td><td className="num">{t.excluded}</td><td>Excluded with history</td></tr>
              <tr><td>Future-due assignments</td><td className="num">{t.future_due}</td><td>Excluded this period</td></tr>
            </tbody>
          </table>
        </Card>
        <div className="stack">
          <Callout title="Completion percentage">Verified eligible completions / eligible due assignments x 100. Courses count equally in this proposed baseline.</Callout>
          <Callout title="Retakes">Attempts share the original assignment. No duplicate denominator entry.</Callout>
          <Callout tone="warn" title="Zero vs missing">Known due training with none complete = 0%. Unknown or missing allocation data is a readiness exception, not 0%. Confirmed none due = N/A; base KPI retained.</Callout>
        </div>
      </div>
    </div>
  );
}

function CheckInForm({ ev }: { ev: Evaluation }) {
  const latest: CheckIn | undefined = (ev.checkins ?? [])[0];
  const weights = Object.fromEntries(ev.base.rows.map((r) => [r.metric, r.weight]));
  const [month, setMonth] = useState(todayISO().slice(0, 7));
  const draft = (ev.checkins ?? []).find((c) => c.month.slice(0, 7) === month && c.state === "Draft");
  const src = draft ?? (latest?.state === "Draft" ? latest : undefined);
  const [form, setForm] = useState({
    quality_rating: src?.quality_rating ?? null,
    collaboration_rating: src?.collaboration_rating ?? null,
    innovation_rating: src?.innovation_rating ?? null,
    collaboration_evidence: src?.collaboration_evidence ?? "",
    innovation_evidence: src?.innovation_evidence ?? "",
    development_note: src?.development_note ?? "",
  });
  const save = useApiMutation<Record<string, unknown>>("post", "/checkins");
  const submit = (finalize: boolean) =>
    save.mutate({ employee_id: ev.employee.id, period_id: ev.period.id, month: `${month}-01`, ...form, finalize }, { onSuccess: () => toast(finalize ? "Check-in finalized" : "Draft saved") });
  const rating = (k: "quality_rating" | "collaboration_rating" | "innovation_rating", label: string, required: boolean) => (
    <Field label={label} required={required} error={fieldError(save.error, k)}>
      <select className="input" value={form[k] ?? ""} onChange={(e) => setForm({ ...form, [k]: Number(e.target.value) || null })}>
        <option value="">Choose 1-5</option>
        {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}/5</option>)}
      </select>
    </Field>
  );
  return (
    <div className="grid grid-main">
      <Card title={`Complete the monthly check-in / ${ev.category}`} sub="Prefilled work evidence; only weighted role/category assessments are editable">
        <FormError error={save.error} />
        <div className="form-grid">
          <Field label="Month" required><input type="month" className="input" value={month} onChange={(e) => setMonth(e.target.value)} /></Field>
          <Field label="Quality evidence"><input className="input" readOnly value={`${ev.base.rows.find((r) => r.metric === "quality")?.detail.reviewed_tasks ?? 0} reviewed tasks in period`} /></Field>
          {weights.quality ? rating("quality_rating", "Quality rating", true) : null}
          {weights.collaboration ? rating("collaboration_rating", "Collaboration rating", true) : null}
          {weights.collaboration ? (
            <Field label="Collaboration evidence" required={[1, 2, 5].includes(form.collaboration_rating ?? 0)} className="full" error={fieldError(save.error, "collaboration_evidence")} help="Ratings 1, 2 and 5 require evidence.">
              <input className="input" value={form.collaboration_evidence} onChange={(e) => setForm({ ...form, collaboration_evidence: e.target.value })} />
            </Field>
          ) : null}
          {weights.innovation ? rating("innovation_rating", "Innovation rating", true) : null}
          {weights.innovation ? (
            <Field label="Innovation before / after evidence" required className="full" error={fieldError(save.error, "innovation_evidence")}>
              <input className="input" value={form.innovation_evidence} onChange={(e) => setForm({ ...form, innovation_evidence: e.target.value })} placeholder="Documented baseline and verified improvement" />
            </Field>
          ) : null}
          <Field label="Training verified (read-only)" className="full">
            <input className="input" readOnly value={`${ev.training.verified} of ${ev.training.eligible} eligible assignments / ${fmtPct(ev.training.score)}`} />
          </Field>
          <Field label="Development note" className="full"><textarea className="input" value={form.development_note} onChange={(e) => setForm({ ...form, development_note: e.target.value })} /></Field>
        </div>
        <div className="row between mt">
          <Button onClick={() => submit(false)}>Save draft</Button>
          <Button variant="primary" onClick={() => submit(true)}>Finalize check-in</Button>
        </div>
      </Card>
      <div className="stack">
        <Callout title="Category-aware form">Non-applicable metrics are absent from the live form. {ev.category === "Support" ? "Achievement and CSAT are unweighted for Support." : ""}</Callout>
        <Callout title="Training input">Training completion is read from verified assignment records, not typed as a score.</Callout>
        <Callout title="Access">Team Leads maintain work updates. Private check-in ratings and KPI records are unavailable to them.</Callout>
        <Kv items={[["Latest", latest ? `${fmtDate(latest.month).slice(3)} / ${latest.state}` : "None"]]} />
      </div>
    </div>
  );
}

function OverrideDrawer({ ev, onClose }: { ev: Evaluation; onClose: () => void }) {
  const metrics = ev.base.rows.filter((r) => r.weight > 0);
  const [form, setForm] = useState({ metric: metrics[0]?.metric ?? "", new_score: "", reason_category: "Evidence correction", reason: "", evidence: "" });
  const save = useApiMutation<Record<string, unknown>>("post", "/overrides");
  const row = metrics.find((m) => m.metric === form.metric);
  const preview = (() => {
    const ns = Number(form.new_score);
    if (!row || form.new_score === "" || ev.base.coverage === 0) return null;
    const rows = ev.base.rows.map((r) => (r.metric === form.metric ? { ...r, score: ns, available: true } : r));
    const avail = rows.filter((r) => r.available && r.score !== null);
    const w = avail.reduce((s, r) => s + r.weight, 0);
    const base = avail.reduce((s, r) => s + (r.score ?? 0) * r.weight, 0) / w;
    const final = ev.training.status === "scored" && ev.training_rule ? base * ev.training_rule.config.base_weight + (ev.training.score ?? 0) * ev.training_rule.config.training_weight : base;
    return { base, final };
  })();
  return (
    <Drawer
      open
      onClose={onClose}
      eyebrow="HOD-only / Reporting department / Original result preserved"
      title="Record a justified HOD override"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => save.mutate({ employee_id: ev.employee.id, period_id: ev.period.id, metric: form.metric, new_score: Number(form.new_score), reason_category: form.reason_category, reason: form.reason, evidence: form.evidence }, { onSuccess: () => { toast("Override recorded"); onClose(); } })}>Record override</Button>
        </>
      }
    >
      <FormError error={save.error} />
      <div className="form-grid">
        <Field label="Metric" required>
          <select className="input" value={form.metric} onChange={(e) => setForm({ ...form, metric: e.target.value })}>{metrics.map((m) => <option key={m.metric} value={m.metric}>{m.label} / original {m.score ?? "unavailable"}</option>)}</select>
        </Field>
        <Field label="Proposed override score" required><input type="number" min={0} max={100} className="input" value={form.new_score} onChange={(e) => setForm({ ...form, new_score: e.target.value })} /></Field>
        <Field label="Reason category" required><input className="input" value={form.reason_category} onChange={(e) => setForm({ ...form, reason_category: e.target.value })} /></Field>
        <Field label="Reason" required><input className="input" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Additional verified contribution evidence" /></Field>
        <Field label="Supporting evidence" required className="full"><input className="input" value={form.evidence} onChange={(e) => setForm({ ...form, evidence: e.target.value })} placeholder="Linked accepted work and review note" /></Field>
      </div>
      <div className="grid grid-2 mt">
        <Stat label="Original final R&R" value={fmtScore(ev.final.value)} hint="Retained" />
        <Stat label="New preview" value={preview ? fmtScore(preview.final) : "—"} hint={preview ? `Base KPI ${fmtScore(ev.base.value)} > ${fmtScore(preview.base)} / draft, before save` : "Enter a score"} />
      </div>
      <p className="small muted mt">Locked periods follow the configured correction process rather than overwriting historical results.</p>
    </Drawer>
  );
}
