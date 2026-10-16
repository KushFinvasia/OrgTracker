import { Link, useParams } from "react-router-dom";

import type { Person } from "@/api/types";
import { Badge, Callout, Card, ErrorState, Kv, Loading, PageHeader, PersonChip } from "@/components/ui";
import { fmtDate, fmtDateTime, fmtPct, fmtScore } from "@/lib/format";
import { useApiQuery } from "@/lib/hooks";
import { type CountKey, fmtValue, type KpiItem, METHOD_NOTE, type MonthInfo, ROLE_NAMES, SHEET_COLUMNS } from "./shared";

interface MetricRow {
  metric: string;
  label: string;
  weight?: number; // Admin only
  available: boolean;
  score?: number | null; // Admin only
  raw?: number | null;
  display: string;
  reason: string;
  contribution?: number | null; // Admin only
}

interface Evaluation {
  id: number;
  state: string;
  csat_rating: number | null;
  quality_rating: number | null;
  compliance_rating: number | null;
  collaboration_rating: number | null;
  innovation_rating: number | null;
  on_time_count: number | null;
  delayed_count: number | null;
  achievement_pct: number | null;
  twcs_score: number | null;
  training_none_due: boolean;
  comments: string | null;
  submitted_at: string | null;
  decided_at: string | null;
  decision_note: string | null;
  excluded_reason: string | null;
  version: number;
}

interface Scorecard {
  employee: Person;
  month: MonthInfo;
  rule: { id: number; label: string; state: string };
  category: string;
  scorecard: {
    rows: MetricRow[];
    // The rest of the method is Admin only.
    coverage?: number;
    base?: number | null;
    base_preview?: number | null;
    penalties?: { kind: string; label: string; points: number }[];
    penalty_total?: number;
    final: number | null;
    status: string;
    tier: string | null;
    explanation: string;
  };
  achievement: { rows: { label: string; target: number; achieved: number; pct: number; pct_capped: number }[]; skipped: { label: string; reason: string }[]; raw: number | null; score?: number | null };
  on_time: { on_time: number; delayed: number; delay_validated: number; no_outcome: number };
  training: {
    status: string;
    score: number | null;
    band: string | null;
    keka: number | null;
    due: number;
    counted: number;
    future: number;
    exempt: number;
    provisional: number;
    reason: string;
    modules: { id: number; title: string; track: string; due_date: string; completed_date: string | null; days_late: number | null; credit: number; note: string; verified: boolean }[];
  };
  evaluation: Evaluation | null;
  evaluation_state: string;
  evaluator: Person | null;
  rated_metrics: { metric: string; label: string; required: boolean; weight?: number }[];
  inputs?: { entered: Partial<Record<CountKey, number | null>>; derived: Partial<Record<CountKey, number | null>> };
  method_visible: boolean;
  item_details: KpiItem[];
  approver_roles: string[];
  submitted_by: Person | null;
  decided_by: Person | null;
  can_edit: boolean;
  edit_reason: string;
  can_submit: boolean;
  can_approve: boolean;
  approve_reason: string;
  readiness: string[];
  tiers?: [string, number][];
  tiers_proposed?: boolean;
  penalties?: { per_delay: number; training_threshold: number; training_penalty: number };
  locked: boolean;
  excluded_reason?: string | null;
}

type RatingKey = "csat_rating" | "quality_rating" | "compliance_rating" | "collaboration_rating" | "innovation_rating";


export function ScorecardPage() {
  const { person, month } = useParams();
  const path = `/individual/evaluations/${person}/${month}`;
  const q = useApiQuery<Scorecard>(path);

  const d = q.data;
  if (q.isLoading) return <Loading rows={3} />;
  if (!d) return <ErrorState error={q.error} />;

  const s = d.scorecard;
  const ev = d.evaluation;
  const unit = (title: string) => d.item_details.find((i) => i.title === title)?.kpi_type?.unit;

  return (
    <>
      <PageHeader
        title={
          <span className="row" style={{ gap: 14 }}>
            <PersonChip person={d.employee} />
          </span>
        }
        sub={`${d.month.label} / ${d.category} / rule ${d.rule.label} / evaluator ${d.evaluator?.name ?? "—"} / approver ${d.approver_roles.map((r) => ROLE_NAMES[r]).join(" or ")}`}
        actions={
          <>
            <Badge status={d.month.state} />
            <Badge status={d.evaluation_state} />
            <Link className="btn" to={`/individual/performance?month=${d.month.id}`}>Back to results</Link>
          </>
        }
      />
      {d.locked && <Callout title="Locked snapshot">This scorecard was frozen when {d.month.label} was locked. It never recalculates.{d.excluded_reason ? ` Not evaluated: ${d.excluded_reason}` : ""}</Callout>}
      {ev?.state === "Returned" && <Callout tone="danger" title={`Returned by ${d.decided_by?.name ?? "the approver"} on ${fmtDateTime(ev.decided_at)}`}>{ev.decision_note}</Callout>}
      {d.readiness.length > 0 && !d.locked && (
        <Callout tone="warn" title="Before this result is complete">
          <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{d.readiness.map((r) => <li key={r}>{r}</li>)}</ul>
        </Callout>
      )}
      <div className="grid grid-main" style={{ marginTop: 20 }}>
        <div className="stack">
          {d.method_visible ? (
          <Card title="Scorecard" sub="Score × weight over metrics with data. Missing metrics drop out of the coverage; they are never scored as zero. Admin view.">
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Metric</th><th>Weight</th><th>Input</th><th>Score</th><th>Contribution</th></tr></thead>
                <tbody>
                  {s.rows.map((r) => (
                    <tr key={r.metric}>
                      <td className="strong">{r.label}</td>
                      <td className="num">{r.weight}%</td>
                      <td>{r.available ? r.display : <span className="muted">{r.reason || "Unavailable"}</span>}</td>
                      <td className="num">{r.available ? fmtScore(r.score) : <Badge tone="grey">Unavailable</Badge>}</td>
                      <td className="num">{r.contribution == null ? "—" : fmtScore(r.contribution)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="small muted mt">
              Coverage {fmtPct(s.coverage)}. Base = {(s.coverage ?? 0) > 0 && (s.coverage ?? 0) < 100 ? "(" : ""}{s.rows.filter((r) => r.available).map((r) => fmtScore(r.contribution)).join(" + ") || "—"}
              {(s.coverage ?? 0) > 0 && (s.coverage ?? 0) < 100 ? `) ÷ ${(s.coverage ?? 0) / 100}` : ""} = {fmtScore(s.base_preview)}.
            </p>
          </Card>
          ) : (
            <Card title="Parameters" sub={METHOD_NOTE}>
              <table className="table">
                <thead><tr><th>Parameter</th><th>This month</th></tr></thead>
                <tbody>
                  {s.rows.map((r) => (
                    <tr key={r.metric}>
                      <td className="strong">{r.label}</td>
                      <td>{r.available ? r.display : <span className="muted">{r.reason || "Not entered"}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}

          <Card title="Achievement" sub={d.method_visible ? "Per row achieved ÷ target × 100, capped at 150%; the average is scored on the curve 0→0, 60→40, 80→60, 100→90, 150→100." : "Per row achieved ÷ target × 100, capped at 150%; the person's % is the average."}>
            {d.achievement.rows.length === 0 && <p className="muted">No KPI row has both a target and an achieved value.</p>}
            {d.achievement.rows.length > 0 && (
              <table className="table">
                <thead><tr><th>KPI</th><th>Target</th><th>Achieved</th><th>%</th></tr></thead>
                <tbody>
                  {d.achievement.rows.map((r, i) => (
                    <tr key={i}>
                      <td>{r.label}</td>
                      <td className="num">{fmtValue(r.target, unit(r.label))}</td>
                      <td className="num">{fmtValue(r.achieved, unit(r.label))}</td>
                      <td className="num">{fmtPct(r.pct, 2)}{r.pct !== r.pct_capped && <div className="sub">capped at {r.pct_capped}%</div>}</td>
                    </tr>
                  ))}
                  <tr><td className="strong">Average</td><td /><td /><td className="num strong">{fmtPct(d.achievement.raw, 2)}{d.method_visible && <> → {fmtScore(d.achievement.score)}</>}</td></tr>
                </tbody>
              </table>
            )}
            {d.achievement.skipped.length > 0 && <p className="small muted mt">Not counted: {d.achievement.skipped.map((x) => `${x.label} (${x.reason.toLowerCase()})`).join("; ")}.</p>}
          </Card>

          <Card title="Training (TWCS)" sub={d.training.reason || `${d.training.counted} module(s) counted / ${d.training.future} due later / ${d.training.exempt} exempt`}>
            {d.training.modules.length > 0 ? (
              <table className="table">
                <thead><tr><th>Module</th><th>Due</th><th>Completed</th><th>Days late</th><th>Credit</th></tr></thead>
                <tbody>
                  {d.training.modules.map((m) => (
                    <tr key={m.id}>
                      <td>{m.title}<div className="sub">{m.track}</div></td>
                      <td>{fmtDate(m.due_date)}</td>
                      <td>{fmtDate(m.completed_date)}</td>
                      <td className="num">{m.days_late ?? "—"}</td>
                      <td className="num">{m.credit}<div className="sub">{m.note}</div></td>
                    </tr>
                  ))}
                  <tr><td className="strong">TWCS</td><td /><td /><td /><td className="num strong">{fmtScore(d.training.score)} {d.training.band && <Badge status={d.training.band} />} {d.training.keka !== null && <Badge tone="dark">KEKA {d.training.keka}</Badge>}</td></tr>
                </tbody>
              </table>
            ) : (
              <p className="muted">{d.training.status === "na" ? "Confirmed: no training due this month." : "No modules due this month are recorded."}</p>
            )}
          </Card>

          <Card title="Outcomes and delays" sub={`On time ${d.on_time.on_time} · delayed ${d.on_time.delayed}${d.penalties ? ` (−${d.penalties.per_delay} each)` : ""} · validated delays ${d.on_time.delay_validated} · no outcome ${d.on_time.no_outcome}`}>
            <table className="table">
              <thead><tr><th>Row</th><th>Target date</th><th>Completed</th><th>Timing</th><th>Delay reason</th></tr></thead>
              <tbody>
                {d.item_details.map((it) => (
                  <tr key={it.id}>
                    <td><Badge tone={it.kind === "kpi" ? "blue" : "grey"}>{it.kind === "kpi" ? "KPI" : "Duty"}</Badge> {it.title}</td>
                    <td>{fmtDate(it.target_date)}</td>
                    <td>{it.outcome === "Not completed" ? "Not completed" : fmtDate(it.completed_date)}</td>
                    <td><Badge status={it.timing} /></td>
                    <td>{it.delay_reason ?? "—"}{it.delay_reason && <div className="sub">{it.delay_validated ? "Validated" : "Not validated"}</div>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {d.item_details.length === 0 && <p className="muted">No targets set for this month.</p>}
          </Card>
        </div>

        <div className="stack">
          <div className="score-card">
            <div className="label">FINAL SCORE · {d.month.label.toUpperCase()}</div>
            <div className="big">{s.status === "insufficient" ? "—" : fmtScore(s.final)}</div>
            <div className="row" style={{ gap: 8 }}>
              {s.tier ? <Badge status={s.tier} /> : <span className="pill">{s.status === "insufficient" ? "Insufficient data" : "No tier"}</span>}
              {d.tiers_proposed && d.tiers && <span className="pill">Tiers proposed: {d.tiers.map(([n, t]) => `${n} ≥ ${t}`).join(", ")}</span>}
            </div>
            {d.method_visible && (
              <>
                <hr />
                <Kv
                  items={[
                    ["Base", <span className="num">{fmtScore(s.base_preview)}</span>],
                    ["Coverage", <span className="num">{fmtPct(s.coverage)}</span>],
                    ...(s.penalties ?? []).map((p) => [p.label, <span className="num">−{p.points}</span>] as [string, JSX.Element]),
                    ["Final", <span className="num">{s.status === "insufficient" ? "Insufficient data" : fmtScore(s.final)}</span>],
                  ]}
                />
              </>
            )}
            {s.explanation && <p className="small" style={{ color: "#c7d1cb" }}>{s.explanation}</p>}
          </div>

          <Card title="Marks" sub="All marking happens in Team.">
            <table className="table">
              <tbody>
                {SHEET_COLUMNS.filter((c) => c.kind !== "rating" || d.rated_metrics.some((m) => m.required && `${m.metric}_rating` === c.key)).map((c) => {
                  const entered = c.kind === "rating" ? (ev?.[c.key as RatingKey] ?? null) : (d.inputs?.entered[c.key as CountKey] ?? null);
                  const derived = c.kind === "rating" ? null : (d.inputs?.derived[c.key as CountKey] ?? null);
                  const v = entered ?? derived;
                  return (
                    <tr key={c.key}>
                      <td>{c.label}</td>
                      <td className="num" style={entered === null && derived !== null ? { color: "var(--muted)" } : undefined}>
                        {v === null ? "—" : c.kind === "pct" || c.kind === "twcs" ? fmtScore(v) : v}
                        {entered === null && derived !== null && <span className="small"> (from records)</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {(d.can_edit || d.can_approve) && (
              <Link className="btn btn-primary mt" to={`/individual/team/${d.employee.id}?month=${d.month.id}`}>{d.can_edit ? "Mark in Team" : "Approve in Team"}</Link>
            )}
          </Card>

          <Card title="History">
            <Kv
              items={[
                ["State", <Badge status={d.evaluation_state} />],
                ["Submitted", ev?.submitted_at ? `${fmtDateTime(ev.submitted_at)} by ${d.submitted_by?.name ?? "—"}` : "—"],
                ["Decision", ev?.decided_at ? `${ev.state} ${fmtDateTime(ev.decided_at)} by ${d.decided_by?.name ?? "—"}` : "—"],
                ["Note", ev?.decision_note ?? "—"],
              ]}
            />
            <p className="small muted mt">Every change is in the audit history.</p>
          </Card>
        </div>
      </div>
    </>
  );
}
