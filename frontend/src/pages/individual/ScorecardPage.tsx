import { AlertTriangle, Ban, Check, Clock, EyeOff, Lock, ShieldCheck, Undo2 } from "lucide-react";
import { Link, useParams } from "react-router-dom";

import type { Person } from "@/api/types";
import { Badge, Callout, DecisionButton, Empty, ErrorState, Loading, Minibar, PageHeader, Panel, Tier, toast, Unavailable } from "@/components/ui";
import { useCrumbLabel } from "@/lib/crumb";
import { fmtDate, fmtDateTime, fmtNum, fmtScore } from "@/lib/format";
import { useApiMutation, useApiQuery } from "@/lib/hooks";
import { type CountKey, EvalBadge, fmtValue, type KpiItem, type MonthInfo } from "./shared";

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
  corrections: Correction[];
  can_request_correction: boolean;
}

interface Correction {
  id: number;
  reason: string;
  state: string;
  requested_by: Person | null;
  decided_by: Person | null;
  decision_note: string | null;
  created_at: string;
  completed_at: string | null;
  old_result: { final: number | null; tier: string | null; status: string } | null;
  new_result: { final: number | null; tier: string | null; status: string } | null;
  can_decide: boolean;
}

const LEDGER_OPACITY: Record<string, number> = { achievement: 1, on_time: 0.82, quality: 0.66, csat: 0.52 };

/** Admin only: each block is a metric's weight; the filled part is its score; striped blocks have no data. */
function Ledger({ s }: { s: Scorecard["scorecard"] }) {
  const sum = s.rows.reduce((a, r) => a + (r.available && r.contribution != null ? r.contribution : 0), 0);
  return (
    <>
      <div className="small muted" style={{ marginBottom: 6 }}>
        Each block is a metric's weight. The filled part is its score; striped blocks have no data and are left out of the denominator.
      </div>
      <div className="ledger-bar">
        {s.rows.map((m) => (
          <div key={m.metric} className={`lseg ${m.available ? "" : "off"}`} style={{ width: `${m.weight ?? 0}%` }} title={`${m.label}: weight ${m.weight}%${m.available ? `, score ${fmtScore(m.score)}` : ", excluded"}`}>
            {m.available && <div className="fill" style={{ width: `${m.score ?? 0}%`, background: m.metric === "training" ? "var(--chart-3)" : "var(--chart-1)", opacity: LEDGER_OPACITY[m.metric] ?? 0.9 }} />}
            <span>{m.label.split(" ")[0]}</span>
          </div>
        ))}
      </div>
      <div className="ledger-scale">
        <span>0</span>
        <span>Weight, 100% in total</span>
        <span>100</span>
      </div>
      <div className="tbl-wrap" style={{ marginTop: 14 }}>
        <table className="tbl">
          <thead>
            <tr><th>Metric</th><th>Input</th><th className="n">Score</th><th className="n">Weight</th><th className="n">Contribution</th></tr>
          </thead>
          <tbody>
            {s.rows.map((m) => (
              <tr key={m.metric}>
                <td>{m.label}</td>
                <td className="small">{m.available ? m.display : <Unavailable>{m.reason || "Unavailable"}</Unavailable>}</td>
                <td className="n num">{m.available ? fmtScore(m.score) : ""}</td>
                <td className="n num">{m.weight}%</td>
                <td className="n num">{m.available ? fmtScore(m.contribution) : "Excluded"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="calc">
        <div className="calc-row"><span>Sum of contributions</span><b>{fmtScore(sum)}</b></div>
        <div className="calc-row"><span>Coverage (weight with data)</span><b>{fmtNum(s.coverage ?? 0)}%</b></div>
        <div className="calc-row"><span>Base = sum ÷ coverage</span><b>{s.base_preview != null ? fmtScore(s.base_preview) : "None"}</b></div>
        {(s.penalties ?? []).map((p) => (
          <div key={p.label} className="calc-row minus"><span>Penalty: {p.label}</span><b>−{p.points}</b></div>
        ))}
        <div className="calc-row total">
          <span>Final {s.final === null ? "(coverage below minimum)" : ""}</span>
          <b>{s.final !== null ? fmtScore(s.final) : "Insufficient data"}</b>
        </div>
      </div>
    </>
  );
}

export function ScorecardPage() {
  const { person, month } = useParams();
  const q = useApiQuery<Scorecard>(`/individual/evaluations/${person}/${month}`);
  const d = q.data;
  useCrumbLabel(d?.employee.name);
  if (q.isLoading) return <Loading rows={3} />;
  if (!d) return <ErrorState error={q.error} />;

  const s = d.scorecard;
  const ev = d.evaluation;
  const notEval = s.status === "not_evaluated";
  const scored = s.final !== null && !notEval;
  const closed = d.month.state === "Locked";
  const kpis = d.item_details.filter((i) => i.kind === "kpi");
  const late = d.item_details.filter((i) => ["Delayed", "Delay validated"].includes(i.timing));
  const missingMetrics = s.rows.filter((r) => !r.available).map((r) => r.label);
  const inProgress = ["Not started", "Draft", "Returned"].includes(d.evaluation_state);

  return (
    <>
      <PageHeader
        title={d.employee.name}
        sub={`${d.employee.code}${d.employee.designation ? `, ${d.employee.designation}` : ""}. ${d.month.label} scorecard, rule ${d.rule.label}.`}
        actions={
          <>
            <Link className="btn" to={`/individual/team/${d.employee.id}?month=${d.month.id}`}>
              {d.can_edit ? "Mark in Team" : d.can_approve ? "Review in Team" : "Open check-in"}
            </Link>
            <Link className="btn" to="/individual/reports">Reports</Link>
          </>
        }
      />
      <div className="stack">
        {notEval ? (
          <Callout tone="warn" icon={Ban} title="Recorded as not evaluated at close.">{d.excluded_reason ?? ""}</Callout>
        ) : !scored && !inProgress ? (
          <Callout tone="warn" title="Not enough data to score.">
            {d.method_visible && s.coverage !== undefined ? `Coverage is ${fmtNum(s.coverage)}%, below the minimum. ` : ""}
            Missing metrics are never scored as zero{missingMetrics.length ? `: ${missingMetrics.join(", ")}` : ""}.
          </Callout>
        ) : null}
        {d.locked && !notEval && (
          <Callout tone="neutral" icon={Lock} title="Closed result.">
            This result was frozen when {d.month.label} was closed. It never recalculates; a correction is the only way to change it.
          </Callout>
        )}
        {ev?.state === "Returned" && (
          <Callout tone="bad" icon={Undo2} title={`Returned by ${d.decided_by?.name ?? "the approver"}`}>
            on {fmtDateTime(ev.decided_at)}. {ev.decision_note}
          </Callout>
        )}
        {d.readiness.length > 0 && !d.locked && (
          <Callout tone="warn" title="Before this result is complete:">
            <ul className="readiness" style={{ marginTop: 4 }}>
              {d.readiness.map((r) => (
                <li key={r}><AlertTriangle size={14} aria-hidden="true" />{r}</li>
              ))}
            </ul>
          </Callout>
        )}

        <section className="panel">
          <div className="panel-b">
            <div className="hero-score">
              <div>
                <div className="small muted">{closed ? "Final score, frozen" : "Score so far (not final until the month is closed)"}</div>
                <div className={`num-xl ${scored ? "" : "ins"}`} style={{ marginTop: 6 }}>
                  {notEval ? "Not evaluated" : scored ? fmtScore(s.final) : inProgress ? "In progress" : "Insufficient data"}
                </div>
                <div className="row" style={{ marginTop: 10 }}>
                  {scored && <Tier tier={s.tier} />}
                  <EvalBadge state={notEval ? "Not evaluated" : d.evaluation_state} />
                  {d.tiers_proposed && <span className="small muted">Tiers are proposed</span>}
                </div>
              </div>
              <div>
                {d.method_visible ? (
                  <Ledger s={s} />
                ) : (
                  <>
                    <ul className="metric-list" style={{ margin: 0 }}>
                      {s.rows.map((m) => (
                        <li key={m.metric}>
                          <span className={`st-ico ${m.available ? "ok" : "miss"}`}>{m.available && <Check aria-hidden="true" />}</span>
                          <span className="m-name">
                            {m.label}
                            <small>{m.available ? m.display : m.reason || "Not entered"}</small>
                          </span>
                        </li>
                      ))}
                    </ul>
                    <p className="small muted" style={{ marginTop: 10 }}>
                      <EyeOff size={14} aria-hidden="true" style={{ verticalAlign: -2 }} /> The scoring method (weights, curves, penalties and tiers) is visible to Admins only.
                    </p>
                  </>
                )}
                {s.explanation && <p className="small muted" style={{ marginTop: 8 }}>{s.explanation}</p>}
              </div>
            </div>
          </div>
        </section>

        <div className="cols-2">
          <Panel
            title="KPIs"
            meta={`${d.achievement.rows.length} of ${kpis.length} with an actual`}
            footer={
              <span className="small muted">
                Each KPI is capped at 150% before averaging.
                {d.achievement.skipped.length ? ` Not counted: ${d.achievement.skipped.map((x) => `${x.label} (${x.reason.toLowerCase()})`).join("; ")}.` : ""}
              </span>
            }
          >
            {kpis.length ? (
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr><th>KPI</th><th className="n">Target</th><th className="n">Achieved</th><th className="n">%</th></tr>
                  </thead>
                  <tbody>
                    {kpis.map((it) => (
                      <tr key={it.id}>
                        <td>{it.title}</td>
                        <td className="n num">{it.effective_target != null ? fmtValue(it.effective_target, it.kpi_type?.unit) : <Unavailable>None</Unavailable>}</td>
                        <td className="n num">{it.effective_achieved != null ? fmtValue(it.effective_achieved, it.kpi_type?.unit) : <Unavailable>Not entered</Unavailable>}</td>
                        <td className="n">
                          {it.pct != null && (
                            <span className="pct-cell num">
                              {fmtNum(it.pct, 2)}%
                              <Minibar pct={it.pct} />
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {d.achievement.raw !== null && (
                      <tr>
                        <td><b>Average</b></td>
                        <td />
                        <td />
                        <td className="n num">
                          <b>{fmtNum(d.achievement.raw, 2)}%</b>
                          {d.method_visible && d.achievement.score != null && <span className="sub">score {fmtScore(d.achievement.score)}</span>}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty title="No targets set">Achievement is unavailable for this month.</Empty>
            )}
          </Panel>
          <Panel
            title="Training"
            meta={d.training.status === "scored" ? `TWCS ${fmtScore(d.training.score)}, ${d.training.band}, KEKA ${d.training.keka}` : d.training.status === "na" ? "N/A" : "Unavailable"}
            footer={<span className="small muted">Credit: 100% on or before the due date, 75% for 1 to 7 days late, 50% for 8 to 14, 25% for 15 or more, 0% if not done by the cut-off.</span>}
          >
            {d.training.modules.length ? (
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr><th>Module</th><th>Due</th><th className="n">Days late</th><th className="n">Credit</th></tr>
                  </thead>
                  <tbody>
                    {d.training.modules.map((m) => (
                      <tr key={m.id}>
                        <td>
                          {m.title}
                          <span className="sub">
                            {m.track}. {m.note}
                            {m.completed_date && !m.verified ? " (awaiting verification)" : ""}
                          </span>
                        </td>
                        <td className="nowrap">{fmtDate(m.due_date)}</td>
                        <td className="n num">{m.days_late ?? ""}</td>
                        <td className="n num">{m.credit}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="panel-b muted">{d.training.reason || (d.training.status === "na" ? "Confirmed: no training due this month." : "No modules due this month are recorded.")}</div>
            )}
          </Panel>
        </div>

        <Panel title="On-time and delays" pad>
          <div className="row" style={{ gap: 24 }}>
            <span><b className="num">{d.on_time.on_time}</b> on time</span>
            <span><b className="num">{d.on_time.delayed}</b> delayed</span>
            <span><b className="num">{d.on_time.delay_validated}</b> delay validated</span>
            <span><b className="num">{d.on_time.no_outcome}</b> no outcome</span>
          </div>
          {late.map((it) => (
            <div key={it.id} style={{ marginTop: 10 }}>
              <Callout tone={it.timing === "Delayed" ? "warn" : "neutral"} icon={it.timing === "Delayed" ? Clock : ShieldCheck}>
                <b>{it.title}</b>: {it.delay_reason || "No reason recorded"} <Badge status={it.timing} />
              </Callout>
            </div>
          ))}
        </Panel>

        {(d.locked || d.corrections.length > 0) && <CorrectionPanel d={d} />}

        {ev?.submitted_at && (
          <Panel title="History" pad>
            <ul className="timeline">
              <li className="ok">
                Submitted by {d.submitted_by?.name ?? "the evaluator"}
                <time>{fmtDateTime(ev.submitted_at)}</time>
              </li>
              {ev.decided_at && (
                <li className={ev.state === "Returned" ? "bad" : "ok"}>
                  {ev.state} by {d.decided_by?.name ?? "the approver"}
                  {ev.decision_note ? `: ${ev.decision_note}` : ""}
                  <time>{fmtDateTime(ev.decided_at)}</time>
                </li>
              )}
              {closed && (
                <li className="ok">
                  Month closed by {d.month.locked_by?.name ?? "the HOD"}
                  <time>{fmtDateTime(d.month.locked_at)}</time>
                </li>
              )}
            </ul>
          </Panel>
        )}
      </div>
    </>
  );
}

/** Fixing a closed month for one person: HOD or Admin requests, another Admin approves, the Manager re-marks in Team. */
function CorrectionPanel({ d }: { d: Scorecard }) {
  const req = useApiMutation<{ month_id: number; employee_id: number; reason: string }>("post", "/individual/corrections");
  const decide = useApiMutation<{ id: number; decision: string; reason: string }>("post", (b) => `/individual/corrections/${b.id}/decide`);
  const onErr = { onError: (e: Error) => toast(e.message, true) };
  return (
    <Panel
      title="Correction"
      meta="Closed results never change silently. A correction reopens only this person's month; the old result is kept."
      tools={
        d.can_request_correction && (
          <DecisionButton
            size="sm"
            label="Request correction"
            decision="request"
            title={`Request a correction for ${d.employee.name}, ${d.month.label}`}
            onDecide={(_, reason) => req.mutate({ month_id: d.month.id, employee_id: d.employee.id, reason }, { ...onErr, onSuccess: () => toast("Correction requested. An Admin decides.") })}
          />
        )
      }
    >
      {d.corrections.length === 0 ? (
        <div className="panel-b muted small">No corrections for this month.</div>
      ) : (
        <ul className="alist">
          {d.corrections.map((c) => (
            <li key={c.id} style={{ alignItems: "flex-start" }}>
              <div className="a-body">
                <div className="row">
                  <Badge status={c.state === "Open" ? "In progress" : c.state} />
                  <span className="small muted">{fmtDateTime(c.created_at)}</span>
                </div>
                <b style={{ marginTop: 6 }}>{c.reason}</b>
                <span>
                  Requested by {c.requested_by?.name ?? "—"}
                  {c.decided_by && `, ${c.state === "Rejected" ? "rejected" : "approved"} by ${c.decided_by.name}`}
                  {c.decision_note && `: ${c.decision_note}`}
                </span>
                {c.state === "Open" && <span style={{ display: "block" }}>The Manager re-marks this month in Team and submits; approving it replaces the stored result.</span>}
                {c.state === "Completed" && c.old_result && c.new_result && (
                  <span style={{ display: "block" }}>
                    Result {c.old_result.final === null ? "—" : fmtScore(c.old_result.final)} {c.old_result.tier ? `(${c.old_result.tier})` : ""} →{" "}
                    {c.new_result.final === null ? "—" : fmtScore(c.new_result.final)} {c.new_result.tier ? `(${c.new_result.tier})` : ""}
                  </span>
                )}
              </div>
              {c.can_decide && (
                <div className="row nowrap">
                  <DecisionButton size="sm" label="Reject" decision="reject" onDecide={(dd, r) => decide.mutate({ id: c.id, decision: dd, reason: r }, { ...onErr, onSuccess: () => toast("Correction rejected.") })} />
                  <DecisionButton
                    size="sm"
                    variant="primary"
                    label="Approve correction"
                    decision="approve"
                    reasonRequired={false}
                    onDecide={(dd, r) => decide.mutate({ id: c.id, decision: dd, reason: r }, { ...onErr, onSuccess: () => toast("Correction approved. The Manager can re-mark this month.") })}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
