import { AlertTriangle, Check, Clock, FileText, ShieldCheck, Sliders, Undo2, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import type { Person } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { Avatar, Badge, Button, Callout, Card, Drawer, Empty, ErrorState, Figures, Loading, Minibar, PageHeader, PersonChip, SectionTitle, Segmented, Stat, Tier } from "@/components/ui";
import { BarList, LineChart } from "@/components/ui/charts";
import { fmtNum, fmtPct, fmtScore } from "@/lib/format";
import { useApiQuery, useQueryParam } from "@/lib/hooks";
import { railState } from "./IndividualPerformancePage";
import { EvalBadge, FinalScore, KpiAvgCell, type MonthInfo, MonthRail, NotInPilot, type PersonRow, type PilotContext, TierBadge, useMonth, usePilot } from "./shared";

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
        title={`Welcome back, ${account?.employee.name.split(" ")[0]}`}
        sub={`${todayLong()}. ${ctx.data ? (role === "manager" ? `Your reporting tree has ${ctx.data.people} people.` : role === "hod" ? `${ctx.data.department}: ${ctx.data.people} people.` : "Platform administration and the Sales pilot.") : ""}`}
        actions={
          role === "admin" && (
            <>
              <Link className="btn" to="/admin"><ShieldCheck size={14} aria-hidden="true" /> Administration</Link>
              <Link className="btn" to="/individual/kpi-scoring"><Sliders size={14} aria-hidden="true" /> KPI Scoring</Link>
            </>
          )
        }
      />
      {ctx.data && ctx.data.people === 0 && <NotInPilot />}
      {ctx.data?.demo_loaded && (
        <div style={{ marginBottom: 20 }}>
          <Callout tone="warn" title="Demo data is loaded.">
            Jul and Aug 2026 are demo months, and blank September and October values were filled with demo numbers so every screen has something to show. Real tracker values were not changed.{" "}
            {account?.role === "admin" ? "Remove it in KPI Scoring, Demo data, before real use." : "An Admin removes it before real use."}
          </Callout>
        </div>
      )}
      {ctx.data && ctx.data.people > 0 && <MonthOverview ctx={ctx.data} role={role ?? "manager"} />}

      <SectionTitle
        title="Quarter to date"
        meta={d ? `${d.scope_label}, ${d.label}, built from the monthly check-ins` : undefined}
        tools={
          d && (
            <>
              <select className="input" style={{ width: 96, height: 34 }} aria-label="Year" value={d.year} onChange={(e) => pick(Number(e.target.value), d.quarter)}>
                {years.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
              <Segmented label="Quarter" value={String(d.quarter)} onChange={(q) => pick(d.year, Number(q))} options={[1, 2, 3, 4].map((q) => ({ id: String(q), label: `Q${q}` }))} />
            </>
          )
        }
      />
      <ErrorState error={dash.error} />
      {dash.isLoading && <Loading rows={3} />}
      {d && s && (
        <div className="stack">
          {d.months.length === 0 && (
            <div className="panel">
              <Empty title={`No months opened in ${d.label}`}>
                Quarter results come from the monthly check-ins.{d.quarters.length > 0 && <> Months exist in {d.quarters.map((q) => q.label).join(", ")}.</>}
              </Empty>
            </div>
          )}

          <Figures
            items={[
              { label: "Quarter score", value: s.final_avg === null ? <span className="soft">Not scored yet</span> : fmtScore(s.final_avg), hint: s.final_avg === null ? `No one scored yet (${s.people} people)` : `Average of ${s.final_n} of ${s.people} people with a score` },
              { label: "KPI average", value: s.kpi_avg === null ? <span className="soft">No data</span> : fmtNum(s.kpi_avg, 1), unit: s.kpi_avg === null ? undefined : "%", hint: `Achieved ÷ target, ${s.kpi_n} of ${s.people} people with KPIs` },
              { label: "Training (TWCS)", value: s.twcs_avg === null ? <span className="soft">None</span> : fmtScore(s.twcs_avg), hint: s.twcs_n ? `${s.twcs_n} of ${s.people} people with training recorded` : "No training recorded yet" },
              { label: "Check-ins approved", value: s.checkins_approved, unit: `of ${s.checkins_total}`, hint: d.awaiting_my_approval ? `${d.awaiting_my_approval} waiting for your approval` : `${s.checkins_submitted} submitted, waiting for approval` },
            ]}
          />

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


function todayLong(): string {
  return new Date().toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "long", year: "numeric", timeZone: "Asia/Kolkata" }).replace(",", "");
}

interface PeopleData {
  month: MonthInfo;
  rows: PersonRow[];
  method_visible: boolean;
}

function Item({ tone, icon: Icon, title, sub, count, to, label }: { tone: string; icon: LucideIcon; title: string; sub: string; count?: number; to?: string; label?: string }) {
  return (
    <li>
      <span className={`a-ico ${tone}`}>
        <Icon size={16} aria-hidden="true" />
      </span>
      <div className="a-body">
        <b>{title}</b>
        <span>{sub}</span>
      </div>
      {count !== undefined && <span className="a-count num">{count}</span>}
      {to && (
        <Link className="btn sm" to={to}>
          {label ?? "Open"}
        </Link>
      )}
    </li>
  );
}

const first = (name: string) => name.split(" ")[0];

/** The selected month at a glance: the close rail and what needs the viewer's action, by role. */
function MonthOverview({ ctx, role }: { ctx: PilotContext; role: string }) {
  const navigate = useNavigate();
  const [monthId] = useMonth(ctx);
  const q = useApiQuery<PeopleData>(monthId ? `/individual/months/${monthId}/people` : null);
  if (q.isLoading) return <Loading rows={2} />;
  if (!q.data) return <ErrorState error={q.error} />;
  const { month, rows } = q.data;
  const open = month.state === "Open";
  const at = (id: number) => `/individual/team/${id}?month=${month.id}`;
  const closeAction =
    open && (role === "hod" || role === "admin") ? (
      <Button size="sm" variant="primary" onClick={() => navigate("/individual/performance?close=1")}>
        Close month
      </Button>
    ) : undefined;
  const rail = <MonthRail month={month} states={rows.map(railState)} action={closeAction} />;

  if (role === "manager") {
    const returned = rows.filter((r) => r.evaluation_state === "Returned");
    const needActuals = rows.filter((r) => r.can_edit && r.kpis_total > r.kpis_marked);
    const missingRows = needActuals.reduce((a, r) => a + (r.kpis_total - r.kpis_marked), 0);
    const toFinish = rows.filter((r) => r.can_edit && ["Draft", "Not started"].includes(r.evaluation_state));
    const noOutcome = rows.filter((r) => r.on_time.no_outcome > 0);
    const waiting = rows.filter((r) => r.evaluation_state === "Submitted");
    const below = rows.filter((r) => r.achievement_pct !== null && r.achievement_pct < 90).sort((a, b) => a.achievement_pct! - b.achievement_pct!);
    const items = [
      returned.length > 0 && <Item key="r" tone="bad" icon={Undo2} title="Returned for correction" sub={returned.map((r) => r.employee.name).join(", ")} count={returned.length} to={at(returned[0].employee.id)} label="Correct" />,
      needActuals.length > 0 && (
        <Item
          key="a"
          tone="warn"
          icon={AlertTriangle}
          title="Actuals need updating"
          sub={`${missingRows} KPI row${missingRows === 1 ? "" : "s"} without an achieved value: ${needActuals.map((r) => first(r.employee.name)).join(", ")}`}
          count={needActuals.length}
          to={at(needActuals[0].employee.id)}
          label="Enter actuals"
        />
      ),
      toFinish.length > 0 && <Item key="d" tone="info" icon={FileText} title="Check-ins to complete and submit" sub={`${toFinish.length} draft or not started for ${month.label}`} count={toFinish.length} to="/individual/team?filter=to_mark" label="View" />,
      noOutcome.length > 0 && (
        <Item
          key="n"
          tone="warn"
          icon={Clock}
          title="Past target date with no outcome"
          sub={`Excluded from On-time until an outcome is recorded: ${noOutcome.map((r) => first(r.employee.name)).join(", ")}`}
          count={noOutcome.reduce((a, r) => a + r.on_time.no_outcome, 0)}
          to={at(noOutcome[0].employee.id)}
          label="Record"
        />
      ),
      waiting.length > 0 && <Item key="w" tone="" icon={Clock} title="Waiting for HOD approval" sub="Submitted and read-only until approved or returned" count={waiting.length} />,
    ].filter(Boolean);
    return (
      <>
        {rail}
        <div className="split" style={{ marginTop: 20 }}>
          <section className="panel">
            <div className="panel-h">
              <h2>Needs your attention</h2>
              <span className="meta">{month.label}</span>
            </div>
            {items.length ? (
              <ul className="alist">{items}</ul>
            ) : (
              <Empty title="Nothing needs your attention" icon={Check}>
                Every check-in in your tree is submitted or approved for this month.
              </Empty>
            )}
          </section>
          <section className="panel">
            <div className="panel-h">
              <h2>Below target</h2>
              <span className="meta">KPI average under 90%</span>
            </div>
            {below.length ? (
              <ul className="alist">
                {below.slice(0, 6).map((r) => (
                  <li key={r.employee.id}>
                    <Avatar person={r.employee} size="sm" />
                    <div className="a-body">
                      <b>
                        <Link to={at(r.employee.id)}>{r.employee.name}</Link>
                      </b>
                      <span>
                        {r.kpis_marked} of {r.kpis_total} KPIs marked
                      </span>
                    </div>
                    <span className="pct-cell num">
                      {fmtNum(r.achievement_pct, 1)}%
                      <Minibar pct={r.achievement_pct} />
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty title="No one below target" icon={Check}>
                Everyone with actuals is at or above 90% of target.
              </Empty>
            )}
          </section>
        </div>
        <SectionTitle title={`Your team in ${month.label}`} tools={<Link className="btn sm" to="/individual/team">Open Team</Link>} />
        <CompactTeam rows={rows} monthId={month.id} locked={!open} />
      </>
    );
  }

  const queue = rows.filter((r) => r.can_approve);
  const unverified = rows.filter((r) => r.readiness.some((x) => /verif/i.test(x))).length;
  const insufficient = rows.filter((r) => r.final === null && ["Submitted", "Approved"].includes(r.evaluation_state));
  if (role === "hod")
    return (
      <>
        {rail}
        <div className="split" style={{ marginTop: 20 }}>
          <section className="panel">
            <div className="panel-h">
              <h2>Approvals waiting</h2>
              <span className="meta">
                {queue.length} check-in{queue.length === 1 ? "" : "s"}
              </span>
              {queue.length > 0 && (
                <div className="tools">
                  <Button size="sm" variant="primary" onClick={() => navigate(at(queue[0].employee.id))}>
                    Start reviewing
                  </Button>
                </div>
              )}
            </div>
            {queue.length ? (
              <div className="tbl-wrap">
                <table className="tbl stackable">
                  <thead>
                    <tr>
                      <th>Person</th>
                      <th>Evaluator</th>
                      <th className="n">KPI average</th>
                      <th className="n">Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {queue.map((r) => (
                      <tr key={r.employee.id} className="clickable" onClick={() => navigate(at(r.employee.id))}>
                        <td className="person" data-l="Person"><PersonChip person={r.employee} /></td>
                        <td data-l="Evaluator" className="nowrap">{r.evaluator?.name ?? "—"}</td>
                        <td className="n" data-l="KPI average"><KpiAvgCell row={r} /></td>
                        <td className="n" data-l="Score"><FinalScore row={r} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty title="No approvals waiting" icon={Check}>
                Submitted check-ins will appear here.
              </Empty>
            )}
          </section>
          <div className="stack">
            <section className="panel">
              <div className="panel-h"><h2>Training verification</h2></div>
              <div className="panel-b">
                <p>
                  <span className="num strong" style={{ fontSize: 22 }}>{unverified}</span> <span className="muted">people with completions recorded and not yet verified.</span>
                </p>
                <p className="small muted" style={{ marginTop: 6 }}>Approving a check-in verifies that month's completions. Anything unverified at close earns no credit.</p>
              </div>
            </section>
            <section className="panel">
              <div className="panel-h">
                <h2>Insufficient data</h2>
                <span className="meta">{insufficient.length} people</span>
              </div>
              <div className="panel-b small">
                {insufficient.length
                  ? insufficient.slice(0, 8).map((r, i) => (
                      <span key={r.employee.id}>
                        {i > 0 && ", "}
                        <Link to={at(r.employee.id)}>{r.employee.name}</Link>
                      </span>
                    ))
                  : "Everyone submitted has enough data to score."}
                <p className="muted" style={{ marginTop: 6 }}>Missing inputs are never scored as zero; these people stay unscored until the data exists.</p>
              </div>
            </section>
          </div>
        </div>
      </>
    );

  const mine = queue.filter((r) => r.approver_roles.length === 1 && r.approver_roles[0] === "admin");
  const others = rows.filter((r) => r.evaluation_state === "Submitted" && !mine.includes(r)).length;
  const noTargets = rows.filter((r) => !r.kpi_rows);
  return (
    <>
      {rail}
      <div className="split" style={{ marginTop: 20 }}>
        <section className="panel">
          <div className="panel-h">
            <h2>Check-ins written by the HOD</h2>
            <span className="meta">An Admin approves these so no one approves their own work</span>
          </div>
          {mine.length ? (
            <ul className="alist">
              {mine.map((r) => (
                <li key={r.employee.id}>
                  <Avatar person={r.employee} size="sm" />
                  <div className="a-body">
                    <b>{r.employee.name}</b>
                    <span>
                      {r.employee.designation}. Checked in by {r.evaluator?.name ?? "the HOD"}
                    </span>
                  </div>
                  <Link className="btn sm primary" to={at(r.employee.id)}>Review</Link>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="Nothing to approve" icon={Check}>
              HOD-written check-ins appear here when submitted.
            </Empty>
          )}
          {others > 0 && (
            <div className="panel-f small muted">
              {others} Manager check-in{others === 1 ? " is" : "s are"} waiting for the HOD. Admins can approve them too.
            </div>
          )}
        </section>
        <div className="stack">
          <section className="panel">
            <div className="panel-h"><h2>Scoring rule</h2></div>
            <div className="panel-b">
              <div className="row">
                <b>{month.rule.label}</b>
                <Badge status={month.rule.state} />
              </div>
              <p className="small muted" style={{ marginTop: 4 }}>Used by {month.label}. Closed months keep their rule.</p>
              <Link className="btn sm" style={{ marginTop: 10 }} to="/individual/kpi-scoring">Open KPI Scoring</Link>
            </div>
          </section>
          <section className="panel">
            <div className="panel-h">
              <h2>Data gaps</h2>
              <span className="meta">{month.label}</span>
            </div>
            <ul className="alist">
              <Item tone="" icon={AlertTriangle} title="People with no targets" sub={noTargets.map((r) => first(r.employee.name)).join(", ") || "None"} count={noTargets.length} />
              <Item tone="warn" icon={Clock} title="Insufficient data" sub="Submitted or approved without enough data to score" count={insufficient.length} />
            </ul>
          </section>
        </div>
      </div>
    </>
  );
}

function CompactTeam({ rows, monthId, locked }: { rows: PersonRow[]; monthId: number; locked: boolean }) {
  const navigate = useNavigate();
  return (
    <div className="panel">
      <div className="tbl-wrap">
        <table className="tbl stackable">
          <thead>
            <tr>
              <th>Person</th>
              <th className="n">KPI average</th>
              <th className="n">Training</th>
              <th className="n">{locked ? "Final" : "Score (live)"}</th>
              <th>Tier</th>
              <th>Check-in</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.employee.id} className="clickable" onClick={() => navigate(`/individual/team/${r.employee.id}?month=${monthId}`)}>
                <td className="person" data-l="Person"><PersonChip person={r.employee} /></td>
                <td className="n" data-l="KPI average"><KpiAvgCell row={r} /></td>
                <td className="n num" data-l="Training">{r.twcs_status === "na" ? "N/A" : r.twcs === null ? <span className="unavail">Unavailable</span> : fmtScore(r.twcs)}</td>
                <td className="n" data-l="Score"><FinalScore row={r} /></td>
                <td data-l="Tier">{r.final !== null && r.status !== "not_evaluated" ? <Tier tier={r.tier} /> : null}</td>
                <td data-l="Check-in"><EvalBadge state={railState(r)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
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
