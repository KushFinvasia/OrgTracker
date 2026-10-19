import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { api } from "@/api/client";
import { useAuth } from "@/auth/AuthContext";
import { Badge, Button, Callout, Drawer, Empty, ErrorState, Loading, PageHeader, Stat, toast } from "@/components/ui";
import { fmtDate, fmtDateTime, fmtScore } from "@/lib/format";
import { useApiQuery } from "@/lib/hooks";
import { MonthClose } from "./marking";
import { FinalScore, METHOD_NOTE, type MonthInfo, MonthPicker, NotInPilot, paramValue, type PersonRow, SHEET_COLUMNS, TierBadge, useMonth, usePilot } from "./shared";

interface PeopleData {
  month: MonthInfo;
  rows: PersonRow[];
  method_visible: boolean;
  required_ratings: string[];
}

/** Performance: read-only results for every employee in every aspect. All marking happens in Team. */
export function IndividualPerformancePage() {
  const { isRole } = useAuth();
  const navigate = useNavigate();
  const ctx = usePilot();
  const [monthId, setMonth] = useMonth(ctx.data);
  const [closing, setClosing] = useState(false);
  const [q, setQ] = useState("");
  const people = useApiQuery<PeopleData>(monthId ? `/individual/months/${monthId}/people` : null);

  if (ctx.isLoading) return <Loading rows={2} />;
  if (ctx.data && ctx.data.people === 0) return (<><PageHeader title="Performance" /><NotInPilot /></>);
  const month = people.data?.month;
  const all = people.data?.rows ?? [];
  const rows = all.filter((r) => !q.trim() || `${r.employee.name} ${r.employee.code}`.toLowerCase().includes(q.trim().toLowerCase()));
  const count = (s: string) => all.filter((r) => r.evaluation_state === s).length;
  // Only the ratings that count for this department are shown.
  const columns = SHEET_COLUMNS.filter((c) => c.kind !== "rating" || (people.data?.required_ratings ?? []).includes(c.key.replace("_rating", "")));

  return (
    <>
      <PageHeader
        title="Performance"
        sub={month ? `Final rating for every employee in every aspect / ${month.label} / ${ctx.data?.department}. Marking happens in Team.` : undefined}
        actions={
          <>
            {month && <Badge status={month.state} />}
            {ctx.data && <MonthPicker months={ctx.data.months} value={monthId} onChange={setMonth} />}
            {month && (
              <Button onClick={() => void api.download(`/individual/reports/export.csv?month_id=${month.id}`, `finvasia-elevate-sales-${month.month.slice(0, 7)}.csv`).catch((e) => toast(e.message, true))}>
                Export
              </Button>
            )}
            {month && isRole("hod", "admin") && <Button variant="primary" onClick={() => setClosing(true)}>{month.state === "Locked" ? "Month locked" : "Close month"}</Button>}
          </>
        }
      />
      <ErrorState error={people.error} />
      {people.isLoading && <Loading rows={2} />}
      {month && (
        <div className="stack">
          {month.state === "Locked" && <Callout title={`${month.label} is locked`}>Locked {fmtDateTime(month.locked_at)} by {month.locked_by?.name ?? "—"}. These results are final.</Callout>}
          <div className="grid grid-4">
            <Stat label="Approved" value={`${count("Approved")} of ${all.length}`} hint="Final once the month is closed" />
            <Stat label="Waiting for approval" value={count("Submitted")} hint="Submitted by the Manager" />
            <Stat label="Not submitted yet" value={all.length - count("Approved") - count("Submitted")} hint="Still being marked in Team" />
            <Stat label="Scored" value={`${all.filter((r) => r.final !== null).length} of ${all.length}`} hint="Missing data is never scored as zero" />
          </div>
          <section className="card">
            <div className="card-head">
              <div>
                <h2>Results</h2>
                <div className="muted">
                  {people.data?.method_visible ? "Click a person for the full calculation." : METHOD_NOTE} Tasks and Achievement % come from the KPIs; ratings are marked by the Manager.
                </div>
              </div>
              <input className="input" style={{ width: 240 }} placeholder="Search name or employee ID" aria-label="Search" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div className="table-wrap">
              <table className="table sheet">
                <thead>
                  <tr>
                    <th>Employee</th>
                    {columns.map((c) => <th key={c.key} title={c.help}>{c.label}</th>)}
                    <th>Final score</th>
                    <th>Tier</th>
                    <th>Check-in</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.employee.id} className="clickable" onClick={() => navigate(`/individual/performance/${r.employee.id}/${month.id}`)}>
                      <td>
                        <b>{r.employee.name}</b>
                        <div className="sub">{r.employee.code}</div>
                      </td>
                      {columns.map((c) => {
                        const { value, fromRecords } = paramValue(r, c.key);
                        return (
                          <td key={c.key} className="num" style={fromRecords ? { color: "var(--muted)" } : undefined}>
                            {value === null ? "—" : c.kind === "pct" || c.kind === "twcs" ? fmtScore(value) : value}
                            {c.kind === "twcs" && r.band && value !== null && <div className="sub">{r.band}</div>}
                            {c.key === "achievement_pct" && r.kpis_total > 0 && <div className="sub">{r.kpis_marked} of {r.kpis_total} KPIs</div>}
                          </td>
                        );
                      })}
                      <td style={{ whiteSpace: "nowrap" }}><FinalScore row={r} /></td>
                      <td><TierBadge tier={r.tier} /></td>
                      <td><Badge status={r.evaluation_state} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rows.length === 0 && <Empty title="No one matches" />}
          </section>
          <p className="small muted">Training cut-off for {month.label}: {fmtDate(month.training_cutoff)}. Scores stay provisional until the HOD closes the month.</p>
        </div>
      )}
      {closing && month && ctx.data && (
        <Drawer open wide onClose={() => setClosing(false)} eyebrow="Performance" title={`Close ${month.label}`}>
          <MonthClose month={month} months={ctx.data.months} onOpened={(id) => { setClosing(false); setMonth(id); }} />
        </Drawer>
      )}
    </>
  );
}
