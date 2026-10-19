import { useState } from "react";
import { Link } from "react-router-dom";

import type { Person } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { Badge, Card, Drawer, Empty, ErrorState, Loading, PageHeader, PersonChip, Stat } from "@/components/ui";
import { BarList, LineChart } from "@/components/ui/charts";
import { fmtPct, fmtScore } from "@/lib/format";
import { useApiQuery, useQueryParam } from "@/lib/hooks";
import { NotInPilot, TierBadge, usePilot } from "./shared";

interface GroupStats {
  people: number;
  final_avg: number | null;
  final_n: number;
  kpi_avg: number | null;
  kpi_n: number;
  twcs_avg: number | null;
  twcs_n: number;
  checkins_total: number;
  checkins_approved: number;
  checkins_submitted: number;
  attention: number;
}

interface MonthCell {
  month_id: number;
  label: string;
  state: string;
  final: number | null;
  status: string;
  tier: string | null;
  kpi_avg: number | null;
  kpis_total: number;
  twcs: number | null;
  band: string | null;
  on_time: number;
  delayed: number;
  evaluation_state: string;
}

interface PersonProgress {
  employee: Person;
  manager: Person | null;
  evaluator: Person | null;
  months: MonthCell[];
  quarter: { final_avg: number | null; scored_months: number; kpi_avg: number | null; twcs_avg: number | null; delayed: number; months: number };
  attention: string[];
}

interface Dashboard {
  role: string;
  year: number;
  quarter: number;
  label: string;
  quarters: { year: number; quarter: number; label: string }[];
  months: { id: number; label: string; state: string }[];
  summary: GroupStats;
  monthly: { month_id: number; label: string; state: string; people: number; final_avg: number | null; final_n: number; kpi_avg: number | null; twcs_avg: number | null; twcs_n: number; approved: number; submitted: number }[];
  people: PersonProgress[];
  awaiting_my_approval: number;
  scope_label: string;
  managers?: ({ manager: Person; is_me: boolean } & GroupStats)[];
  departments?: ({ department: string; category: string; in_pilot: boolean } & GroupStats)[];
  other_departments?: number;
  quarterly_trend?: { quarter: number; label: string; months: number; final_avg: number | null; final_n: number; kpi_avg: number | null; twcs_avg: number | null }[];
}

/** A score, or why there is none. Incomplete data is never shown as 0. */
function Score({ value, empty = "Not scored yet" }: { value: number | null | undefined; empty?: string }) {
  return value === null || value === undefined ? <span className="muted small">{empty}</span> : <span className="num strong">{fmtScore(value)}</span>;
}

function Pct({ value }: { value: number | null | undefined }) {
  return value === null || value === undefined ? <span className="muted small">No data</span> : <span className="num">{fmtPct(value, 1)}</span>;
}

/** Individual Tier Home: a role-based quarterly performance dashboard built from the monthly check-ins. */
export function IndividualHomePage() {
  const { account } = useAuth();
  const ctx = usePilot();
  const [yearParam, setYear] = useQueryParam("year");
  const [qParam, setQ] = useQueryParam("q");
  const [open, setOpen] = useState<PersonProgress | null>(null);
  const [filter, setFilter] = useState<"all" | "attention">("all");
  const qs = yearParam && qParam ? `?year=${yearParam}&quarter=${qParam}` : "";
  const dash = useApiQuery<Dashboard>(ctx.data && ctx.data.people > 0 ? `/individual/dashboard${qs}` : null);

  if (ctx.isLoading) return <Loading rows={3} />;
  const d = dash.data;
  const role = account?.role;
  const years = Array.from(new Set([...(d?.quarters ?? []).map((q) => q.year), d?.year ?? new Date().getFullYear()])).sort((a, b) => b - a);
  const pick = (y: number, q: number) => {
    setYear(String(y));
    setQ(String(q));
  };
  const s = d?.summary;
  const people = (d?.people ?? []).filter((p) => filter === "all" || p.attention.length > 0);
  const flagged = (d?.people ?? []).filter((p) => p.attention.length > 0);

  return (
    <>
      <PageHeader
        title={`Good to see you, ${account?.employee.name.split(" ")[0]}.`}
        sub={d ? `${d.scope_label} / ${d.label} / quarter to date from the monthly check-ins` : ctx.data ? `Individual Tier / ${ctx.data.department} pilot` : undefined}
        actions={
          d && (
            <div className="row" role="group" aria-label="Quarter">
              <select className="input" style={{ width: 110 }} aria-label="Year" value={d.year} onChange={(e) => pick(Number(e.target.value), d.quarter)}>
                {years.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
              <div className="seg">
                {[1, 2, 3, 4].map((q) => (
                  <button key={q} className={d.quarter === q ? "active" : ""} aria-pressed={d.quarter === q} onClick={() => pick(d.year, q)}>
                    Q{q}
                  </button>
                ))}
              </div>
            </div>
          )
        }
      />
      {ctx.data && ctx.data.people === 0 && <NotInPilot />}
      {ctx.data?.demo_loaded && (
        <div className="callout warn" style={{ marginBottom: 20 }}>
          <b>Demo data is loaded</b>
          Jul and Aug 2026 are demo months, and blank September and October values were filled with demo numbers so every screen has something to show.
          Real tracker values were not changed. {account?.role === "admin" ? "Remove it in KPI Scoring → Demo data before real use." : "An Admin removes it before real use."}
        </div>
      )}
      <ErrorState error={dash.error} />
      {dash.isLoading && <Loading rows={3} />}
      {d && s && (
        <div className="stack">
          {d.months.length === 0 && (
            <Card>
              <Empty title={`No months opened in ${d.label}`}>
                Quarter results come from the monthly check-ins.{d.quarters.length > 0 && <> Months exist in {d.quarters.map((q) => q.label).join(", ")}.</>}
              </Empty>
            </Card>
          )}

          {/* Quarterly summary */}
          <div className="grid grid-4">
            <Stat
              label="Quarter score"
              value={s.final_avg === null ? "—" : fmtScore(s.final_avg)}
              hint={s.final_avg === null ? `No one scored yet (${s.people} people)` : `Average of ${s.final_n} of ${s.people} people with a score`}
            />
            <Stat label="KPI average" value={s.kpi_avg === null ? "—" : fmtPct(s.kpi_avg, 1)} hint={`Achieved ÷ target, ${s.kpi_n} of ${s.people} people with KPIs`} />
            <Stat label="Training (TWCS)" value={s.twcs_avg === null ? "—" : fmtScore(s.twcs_avg)} hint={s.twcs_n ? `${s.twcs_n} of ${s.people} people with training recorded` : "No training recorded yet"} />
            <Stat
              label="Check-ins approved"
              value={`${s.checkins_approved} of ${s.checkins_total}`}
              hint={d.awaiting_my_approval ? `${d.awaiting_my_approval} waiting for your approval` : `${s.checkins_submitted} submitted, waiting for approval`}
            />
          </div>

          {/* Monthly performance trend */}
          {d.monthly.length > 0 && (
            <Card title="Monthly performance" sub="Each month's average across the people in scope. Open months are provisional until the HOD closes them.">
              <div className="grid grid-3">
                {d.monthly.map((m, i) => {
                  const prev = i > 0 ? d.monthly[i - 1].final_avg : null;
                  const delta = prev !== null && m.final_avg !== null ? m.final_avg - prev : null;
                  return (
                    <div key={m.month_id} className="stat">
                      <div className="row between">
                        <span className="label">{m.label}</span>
                        <Badge status={m.state} />
                      </div>
                      <div className="value">{m.final_avg === null ? "—" : fmtScore(m.final_avg)}</div>
                      <div className="small muted">
                        {m.final_avg === null ? "No one scored yet" : `Average score, ${m.final_n} of ${m.people} scored`}
                        {delta !== null && (
                          <span style={{ marginLeft: 6, fontWeight: 700, color: delta >= 0 ? "var(--green)" : "var(--red-fg)" }}>
                            {delta >= 0 ? "▲" : "▼"} {fmtScore(Math.abs(delta))}
                          </span>
                        )}
                      </div>
                      <div className="small mt">
                        KPI average <Pct value={m.kpi_avg} /> · Training {m.twcs_avg === null ? <span className="muted">none</span> : fmtScore(m.twcs_avg)} · {m.approved} of {m.people} approved
                      </div>
                    </div>
                  );
                })}
              </div>
              {d.monthly.filter((m) => m.final_avg !== null).length >= 2 && (
                <div className="mt" style={{ maxWidth: 720 }}>
                  <LineChart label="Average score by month" max={100} points={d.monthly.filter((m) => m.final_avg !== null).map((m) => ({ label: m.label, value: Math.round(m.final_avg! * 100) / 100 }))} />
                </div>
              )}
            </Card>
          )}

          {/* Admin: departments and quarterly trend */}
          {role === "admin" && d.departments && (
            <div className="stack">
              <Card title="Departments" sub={`Only departments in the Individual Tier pilot have monthly check-ins. ${d.other_departments ?? 0} other departments join when the pilot extends.`}>
                <GroupTable label="Department" rows={d.departments.map((g) => ({ key: g.department, name: g.department, sub: g.category, stats: g }))} />
              </Card>
              <Card title={`Quarterly trend ${d.year}`} sub="Average score per quarter. Quarters without a scored month are left out of the line, never drawn as 0.">
                {(d.quarterly_trend ?? []).filter((t) => t.final_avg !== null).length >= 2 && (
                  <div style={{ maxWidth: 720 }}><LineChart label="Average score by quarter" max={100} points={(d.quarterly_trend ?? []).filter((t) => t.final_avg !== null).map((t) => ({ label: t.label, value: Math.round(t.final_avg! * 100) / 100 }))} /></div>
                )}
                <table className="table">
                  <thead><tr><th>Quarter</th><th>Months</th><th>Average score</th><th>KPI average</th><th>Training</th></tr></thead>
                  <tbody>
                    {(d.quarterly_trend ?? []).map((t) => (
                      <tr key={t.quarter} style={t.quarter === d.quarter ? { background: "var(--mint)" } : undefined}>
                        <td><button className="link-btn" onClick={() => pick(d.year, t.quarter)}>{t.label}</button></td>
                        <td className="num">{t.months || <span className="muted">None</span>}</td>
                        <td>{t.months ? <Score value={t.final_avg} /> : <span className="muted">—</span>}{t.final_n > 0 && <span className="sub"> ({t.final_n} scored)</span>}</td>
                        <td>{t.months ? <Pct value={t.kpi_avg} /> : "—"}</td>
                        <td>{t.twcs_avg === null ? <span className="muted">—</span> : fmtScore(t.twcs_avg)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </div>
          )}

          {/* HOD and Admin: manager-wise team comparison */}
          {(role === "hod" || role === "admin") && d.managers && d.managers.length > 0 && (
            <Card title="Teams by Manager" sub="Each team is the people a Manager checks in. Averages cover only people with data; the counts show how many.">
              {d.managers.some((g) => g.final_avg !== null) ? (
                <div className="mb">
                  <BarList label="Average quarter score by team" items={d.managers.filter((g) => g.final_avg !== null).map((g) => ({ label: g.manager.name, value: Math.round(g.final_avg! * 10) / 10 }))} />
                </div>
              ) : (
                <p className="small muted">No team has a scored month in {d.label} yet, so there is no score comparison. KPI averages are compared below.</p>
              )}
              <GroupTable label="Team" rows={d.managers.map((g) => ({ key: String(g.manager.id), name: g.is_me ? `${g.manager.name} (you)` : g.manager.name, sub: g.manager.designation ?? "", stats: g }))} />
            </Card>
          )}

          {/* Areas needing attention (Manager and HOD) */}
            {role !== "admin" && (
              <Card title="Needs attention" sub={`${s.attention} of ${s.people} people: KPI average under 80%, training under 50, delays, unsubmitted check-ins or missing data.`}>
                {flagged.length === 0 && <p className="muted">Nothing needs attention in {d.label}.</p>}
                <div className="grid grid-3" style={{ gap: 12 }}>
                {flagged.slice(0, 12).map((p) => (
                  <button
                    key={p.employee.id}
                    className="link-btn"
                    style={{ display: "block", width: "100%", padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 10, color: "var(--ink)", fontWeight: 400 }}
                    onClick={() => setOpen(p)}
                  >
                    <b>{p.employee.name}</b> <span className="small muted">{p.employee.code}</span>
                    <ul className="small" style={{ margin: "4px 0 0", paddingLeft: 18, color: "var(--muted)" }}>
                      {p.attention.map((a) => <li key={a}>{a}</li>)}
                    </ul>
                  </button>
                ))}
                </div>
                {flagged.length > 12 && <button className="link-btn mt" onClick={() => setFilter("attention")}>Show all {flagged.length} in the table</button>}
              </Card>
            )}
            {/* Employee progress */}
            <Card
              title="Employee progress"
              sub="Monthly scores and the quarter to date. Click a person for the month-by-month detail."
              actions={
                <div className="seg" role="group" aria-label="Filter">
                  <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>All ({d.people.length})</button>
                  <button className={filter === "attention" ? "active" : ""} onClick={() => setFilter("attention")}>Needs attention ({s.attention})</button>
                </div>
              }
            >
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Employee</th>
                      {role !== "manager" && <th>Checked in by</th>}
                      {d.months.map((m) => <th key={m.id}>{m.label.slice(0, 3)}</th>)}
                      <th>Quarter</th>
                      <th>KPI avg</th>
                      <th>Training</th>
                    </tr>
                  </thead>
                  <tbody>
                    {people.map((p) => (
                      <tr key={p.employee.id} className="clickable" onClick={() => setOpen(p)}>
                        <td>
                          <b>{p.employee.name}</b>
                          <div className="sub">
                            {p.employee.code}
                            {p.attention.length > 0 && <span style={{ color: "var(--amber-fg)" }}> · needs attention</span>}
                          </div>
                        </td>
                        {role !== "manager" && <td className="small">{p.evaluator?.name ?? "—"}</td>}
                        {d.months.map((m) => {
                          const c = p.months.find((x) => x.month_id === m.id);
                          return <td key={m.id}>{c ? <Score value={c.final} empty={c.status === "not_evaluated" ? "Not evaluated" : "—"} /> : <span className="muted">—</span>}</td>;
                        })}
                        <td>
                          <Score value={p.quarter.final_avg} empty="—" />
                          {p.quarter.months > 0 && <div className="sub">{p.quarter.scored_months} of {p.quarter.months} month{p.quarter.months > 1 ? "s" : ""}</div>}
                        </td>
                        <td><Pct value={p.quarter.kpi_avg} /></td>
                        <td>{p.quarter.twcs_avg === null ? <span className="muted small">None</span> : fmtScore(p.quarter.twcs_avg)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {people.length === 0 && <Empty title="No one here" />}
            </Card>

        </div>
      )}
      {open && d && <PersonDrawer p={open} quarter={d.label} onClose={() => setOpen(null)} />}
    </>
  );
}

function GroupTable({ label, rows }: { label: string; rows: { key: string; name: string; sub: string; stats: GroupStats }[] }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr><th>{label}</th><th>People</th><th>Quarter score</th><th>KPI average</th><th>Training</th><th>Check-ins approved</th><th>Needs attention</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td><b>{r.name}</b><div className="sub">{r.sub}</div></td>
              <td className="num">{r.stats.people}</td>
              <td><Score value={r.stats.final_avg} />{r.stats.final_n > 0 && <div className="sub">{r.stats.final_n} of {r.stats.people} scored</div>}</td>
              <td><Pct value={r.stats.kpi_avg} /></td>
              <td>{r.stats.twcs_avg === null ? <span className="muted small">None</span> : fmtScore(r.stats.twcs_avg)}</td>
              <td className="num">{r.stats.checkins_approved} of {r.stats.checkins_total}</td>
              <td className="num">{r.stats.attention ? <Badge tone="amber">{r.stats.attention}</Badge> : <Badge tone="green">0</Badge>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PersonDrawer({ p, quarter, onClose }: { p: PersonProgress; quarter: string; onClose: () => void }) {
  return (
    <Drawer open wide onClose={onClose} eyebrow={quarter} title={<PersonChip person={p.employee} />}>
      <div className="stack">
        <div className="grid grid-4">
          <Stat label="Quarter score" value={p.quarter.final_avg === null ? "—" : fmtScore(p.quarter.final_avg)} hint={`${p.quarter.scored_months} of ${p.quarter.months} month${p.quarter.months === 1 ? "" : "s"} scored`} />
          <Stat label="KPI average" value={p.quarter.kpi_avg === null ? "—" : fmtPct(p.quarter.kpi_avg, 1)} hint="Achieved ÷ target" />
          <Stat label="Training (TWCS)" value={p.quarter.twcs_avg === null ? "—" : fmtScore(p.quarter.twcs_avg)} hint={p.quarter.twcs_avg === null ? "No training recorded" : "Average of the months"} />
          <Stat label="Delayed tasks" value={p.quarter.delayed} hint="Across the quarter" />
        </div>
        {p.attention.length > 0 && (
          <div className="callout warn">
            <b>Needs attention</b>
            <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{p.attention.map((a) => <li key={a}>{a}</li>)}</ul>
          </div>
        )}
        <Card title="Month by month">
          {p.months.length === 0 ? (
            <p className="muted">No months opened in this quarter.</p>
          ) : (
            <table className="table">
              <thead><tr><th>Month</th><th>Score</th><th>Tier</th><th>KPI average</th><th>Training</th><th>On time / delayed</th><th>Check-in</th><th /></tr></thead>
              <tbody>
                {p.months.map((m) => (
                  <tr key={m.month_id}>
                    <td>{m.label} <Badge status={m.state} /></td>
                    <td><Score value={m.final} empty={m.status === "not_evaluated" ? "Not evaluated" : "Not scored yet"} /></td>
                    <td><TierBadge tier={m.tier} /></td>
                    <td>{m.kpis_total ? <Pct value={m.kpi_avg} /> : <span className="muted small">No targets</span>}</td>
                    <td>{m.twcs === null ? <span className="muted small">None</span> : <>{fmtScore(m.twcs)} {m.band && <Badge status={m.band} />}</>}</td>
                    <td className="num">{m.on_time} / {m.delayed}</td>
                    <td><Badge status={m.evaluation_state} /></td>
                    <td className="small" style={{ whiteSpace: "nowrap" }}>
                      <Link to={`/individual/team/${p.employee.id}?month=${m.month_id}`}>Open in Team</Link>
                      {" · "}
                      <Link to={`/individual/performance/${p.employee.id}/${m.month_id}`}>Result</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </Drawer>
  );
}
