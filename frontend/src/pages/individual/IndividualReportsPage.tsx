import { useNavigate } from "react-router-dom";

import { api } from "@/api/client";
import type { Person } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { Badge, Button, Card, Empty, ErrorState, Loading, PageHeader, PersonChip, Stat, Tabs, toast } from "@/components/ui";
import { BarList, LineChart } from "@/components/ui/charts";
import { fmtPct, fmtScore } from "@/lib/format";
import { useApiQuery, useQueryParam } from "@/lib/hooks";
import { FinalScore, fmtValue, type MonthInfo, MonthPicker, NotInPilot, type OnTime, OnTimeCell, type PersonRow, TierBadge, TwcsCell, useMonth, usePilot } from "./shared";

interface ReportData {
  month: MonthInfo;
  people: PersonRow[];
  by_type: { type: string; unit: string; rows: number; target: number; achieved: number; with_actual: number }[];
  on_time: OnTime;
  team_twcs: number | null;
  gaps: { employee: Person; row: string | null; source_row: number | null; issue: string }[];
  trend: { month: string; state: string; achievement_avg: number | null; achievement_n: number; final_avg: number | null; final_n: number; twcs_avg: number | null }[];
}

type Tab = "targets" | "people" | "ontime" | "trend" | "gaps";

export function IndividualReportsPage() {
  const { isRole } = useAuth();
  const navigate = useNavigate();
  const ctx = usePilot();
  const [monthId, setMonth] = useMonth(ctx.data);
  const [tabParam, setTab] = useQueryParam("tab");
  const tab = (tabParam as Tab) || "targets";
  const r = useApiQuery<ReportData>(monthId ? `/individual/reports?month_id=${monthId}` : null);

  if (ctx.isLoading) return <Loading rows={2} />;
  if (ctx.data && ctx.data.people === 0) return (<><PageHeader title="Reports" /><NotInPilot /></>);
  const d = r.data;
  const download = (path: string, name: string) => void api.download(path, name).catch((e) => toast(e.message, true));

  return (
    <>
      <PageHeader
        title="Reports"
        sub="A manager tool for your scope, not an organisation-wide leaderboard. Unavailable values stay unavailable in every export."
        actions={
          <>
            {ctx.data && <MonthPicker months={ctx.data.months} value={monthId} onChange={setMonth} />}
            {d && <Button onClick={() => download(`/individual/reports/export.csv?month_id=${d.month.id}`, `finvasia-elevate-sales-${d.month.month.slice(0, 7)}.csv`)}>Export CSV</Button>}
            {d && isRole("hod", "admin") && <Button onClick={() => download(`/individual/keka-export.csv?month_id=${d.month.id}`, `keka-training-${d.month.month.slice(0, 7)}.csv`)}>KEKA training export</Button>}
          </>
        }
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "targets", label: "Target vs achieved" },
          { id: "people", label: "People" },
          { id: "ontime", label: "On-time & delays" },
          { id: "trend", label: "Monthly trend" },
          { id: "gaps", label: `Data gaps${d ? ` (${d.gaps.length})` : ""}` },
        ]}
      />
      <ErrorState error={r.error} />
      {r.isLoading && <Loading rows={2} />}
      {d && tab === "targets" && (
        <div className="stack">
          <div className="grid grid-4">
            <Stat label="People" value={d.people.length} hint={`${d.people.filter((p) => p.kpi_rows === 0).length} with no targets set`} />
            <Stat label="Average achievement" value={avg(d.people.map((p) => p.achievement_pct)) === null ? "—" : fmtPct(avg(d.people.map((p) => p.achievement_pct)), 1)} hint={`${d.people.filter((p) => p.achievement_pct !== null).length} people with actuals`} />
            <Stat label="Team TWCS" value={d.team_twcs === null ? "—" : fmtScore(d.team_twcs)} hint="Average credit across all modules" />
            <Stat label="Delayed cases" value={d.on_time.delayed} hint={`${d.on_time.delay_validated} validated; ${d.on_time.no_outcome} with no outcome`} />
          </div>
          <Card title="By KPI type (individual rows)" sub="Totals only over rows that have both a target and an achieved value. Team rows are excluded so nothing is counted twice.">
            <table className="table">
              <thead><tr><th>KPI type</th><th>Rows</th><th>With actual</th><th>Target</th><th>Achieved</th><th>Achieved %</th></tr></thead>
              <tbody>
                {d.by_type.map((t) => (
                  <tr key={t.type}>
                    <td className="strong">{t.type}</td>
                    <td className="num">{t.rows}</td>
                    <td className="num">{t.with_actual}</td>
                    <td className="num">{t.with_actual ? fmtValue(t.target, t.unit) : "—"}</td>
                    <td className="num">{t.with_actual ? fmtValue(t.achieved, t.unit) : "—"}</td>
                    <td className="num">{t.with_actual && t.target ? fmtPct((t.achieved / t.target) * 100, 1) : <span className="muted">No actuals</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Card title="Achievement by person" sub="Average of achieved ÷ target across the person's rows with an actual">
            {d.people.some((p) => p.achievement_pct !== null) ? (
              <BarList label="Achievement by person" unit="%" items={d.people.filter((p) => p.achievement_pct !== null).map((p) => ({ label: p.employee.name, value: Math.round(p.achievement_pct! * 10) / 10 }))} />
            ) : (
              <Empty title="No actuals yet">Enter achieved values in Performance → Targets & actuals.</Empty>
            )}
          </Card>
        </div>
      )}
      {d && tab === "people" && (
        <Card title={`${d.month.label} by person`}>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Person</th><th>KPI rows</th><th>Achievement</th><th>On-time</th><th>Training</th>{isRole("admin") && <th>Coverage</th>}<th>Final</th><th>Tier</th><th>Check-in</th></tr></thead>
              <tbody>
                {d.people.map((p) => (
                  <tr key={p.employee.id} className="clickable" onClick={() => navigate(`/individual/performance/${p.employee.id}/${d.month.id}`)}>
                    <td><PersonChip person={p.employee} meta={p.employee.code} /></td>
                    <td className="num">{p.kpi_rows || <span className="muted">None</span>}</td>
                    <td className="num">{p.achievement_pct === null ? "—" : fmtPct(p.achievement_pct, 1)}</td>
                    <td><OnTimeCell ot={p.on_time} /></td>
                    <td><TwcsCell row={p} /></td>
                    {isRole("admin") && <td className="num">{fmtPct(p.coverage)}</td>}
                    <td><FinalScore row={p} /></td>
                    <td><TierBadge tier={p.tier} /></td>
                    <td><Badge status={p.evaluation_state} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {d && tab === "ontime" && (
        <div className="stack">
          <div className="grid grid-4">
            <Stat label="On time" value={d.on_time.on_time} />
            <Stat label="Delayed" value={d.on_time.delayed} hint="Completed late or not completed" />
            <Stat label="Delay validated" value={d.on_time.delay_validated} hint="Validated by the HOD; not counted against the person" />
            <Stat label="No outcome" value={d.on_time.no_outcome} hint="Past the target date, not recorded" />
          </div>
          <Card title="By person">
            <table className="table">
              <thead><tr><th>Person</th><th>KPI rows</th><th>Duty tasks</th><th>On-time</th>{isRole("admin") && <th>Penalty</th>}</tr></thead>
              <tbody>
                {d.people.map((p) => (
                  <tr key={p.employee.id}>
                    <td><PersonChip person={p.employee} meta={p.employee.code} /></td>
                    <td className="num">{p.kpi_rows}</td>
                    <td className="num">{p.duty_rows}</td>
                    <td><OnTimeCell ot={p.on_time} /></td>
                    {isRole("admin") && <td className="num">{p.penalty_total ? `−${p.penalty_total}` : "—"}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}
      {d && tab === "trend" && (
        <div className="grid grid-2">
          <Card title="Average achievement %" sub="People with actuals each month">
            {d.trend.some((t) => t.achievement_avg !== null) ? (
              <LineChart label="Average achievement by month" unit="%" points={d.trend.filter((t) => t.achievement_avg !== null).map((t) => ({ label: t.month, value: Math.round(t.achievement_avg! * 10) / 10 }))} />
            ) : <Empty title="No actuals yet" />}
          </Card>
          <Card title="Average final score" sub="Scored people only; insufficient data is excluded, never zero">
            {d.trend.some((t) => t.final_avg !== null) ? (
              <LineChart label="Average final score by month" max={100} points={d.trend.filter((t) => t.final_avg !== null).map((t) => ({ label: t.month, value: Math.round(t.final_avg! * 100) / 100 }))} />
            ) : <Empty title="No final scores yet" />}
          </Card>
          <Card title="Months" className="full">
            <table className="table">
              <thead><tr><th>Month</th><th>State</th><th>Avg achievement</th><th>Avg final</th><th>Avg TWCS</th></tr></thead>
              <tbody>
                {d.trend.map((t) => (
                  <tr key={t.month}>
                    <td>{t.month}</td>
                    <td><Badge status={t.state} /></td>
                    <td className="num">{t.achievement_avg === null ? "—" : `${fmtPct(t.achievement_avg, 1)} (${t.achievement_n})`}</td>
                    <td className="num">{t.final_avg === null ? "—" : `${fmtScore(t.final_avg)} (${t.final_n})`}</td>
                    <td className="num">{t.twcs_avg === null ? "—" : fmtScore(t.twcs_avg)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}
      {d && tab === "gaps" && (
        <Card title="Data gaps and import checks" sub="From the Sales tracker import and later edits. Nothing here was silently fixed.">
          {d.gaps.length === 0 && <Empty title="No gaps" />}
          {d.gaps.length > 0 && (
            <table className="table">
              <thead><tr><th>Person</th><th>Row</th><th>Issue</th></tr></thead>
              <tbody>
                {d.gaps.map((g, i) => (
                  <tr key={i}>
                    <td><PersonChip person={g.employee} meta={g.employee.code} /></td>
                    <td className="small">{g.row ?? "—"}{g.source_row && <div className="sub">Tracker row {g.source_row}</div>}</td>
                    <td>{g.issue}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
    </>
  );
}

function avg(values: (number | null)[]): number | null {
  const v = values.filter((x): x is number => x !== null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}
