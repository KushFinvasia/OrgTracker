import { Download, Lock, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { api } from "@/api/client";
import { useAuth } from "@/auth/AuthContext";
import { Button, Callout, Drawer, Empty, ErrorState, Loading, PageHeader, PersonChip, Tier, toast, Unavailable } from "@/components/ui";
import { fmtDate, fmtScore } from "@/lib/format";
import { useApiQuery } from "@/lib/hooks";
import { MonthClose } from "./marking";
import { EvalBadge, FinalScore, KpiAvgCell, METHOD_NOTE, type MonthInfo, NotInPilot, type PersonRow, SHEET_COLUMNS, useMonth, usePilot, MonthRail } from "./shared";

interface PeopleData {
  month: MonthInfo;
  rows: PersonRow[];
  method_visible: boolean;
  required_ratings: string[];
}

export const railState = (r: PersonRow) => (r.status === "not_evaluated" ? "Not evaluated" : r.evaluation_state);

/** Performance: read-only results for every employee in every aspect. All marking happens in Team. */
export function IndividualPerformancePage() {
  const { isRole } = useAuth();
  const navigate = useNavigate();
  const ctx = usePilot();
  const [monthId, setMonth] = useMonth(ctx.data);
  // Home's "Close month" opens this page with ?close=1.
  const [closing, setClosing] = useState(() => new URLSearchParams(window.location.search).get("close") === "1" && isRole("hod", "admin"));
  const [q, setQ] = useState("");
  const people = useApiQuery<PeopleData>(monthId ? `/individual/months/${monthId}/people` : null);
  // ?close=1 only opens the panel; drop it so a reload or Back does not open it again.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("close")) return;
    params.delete("close");
    const qs = params.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  }, []);

  if (ctx.isLoading) return <Loading rows={2} />;
  if (ctx.data && ctx.data.people === 0) return (<><PageHeader title="Performance" /><NotInPilot /></>);
  const month = people.data?.month;
  const all = people.data?.rows ?? [];
  const admin = !!people.data?.method_visible;
  const locked = month?.state === "Locked";
  const query = q.trim().toLowerCase();
  const rows = all.filter((r) => !query || `${r.employee.name} ${r.employee.code}`.toLowerCase().includes(query));
  const ratings = SHEET_COLUMNS.filter((c) => c.kind === "rating" && (people.data?.required_ratings ?? []).includes(c.key.replace("_rating", "")));
  const canClose = month && isRole("hod", "admin") && !locked;

  return (
    <>
      <PageHeader
        title="Performance"
        sub={month ? `Every parameter for everyone in your scope, ${month.label}. Read-only: marking happens on each person's page in Team.` : undefined}
        actions={
          month && (
            <>
              <Button onClick={() => void api.download(`/individual/reports/export.csv?month_id=${month.id}`, `finvasia-elevate-sales-${month.month.slice(0, 7)}.csv`).catch((e) => toast(e.message, true))}>
                <Download size={14} aria-hidden="true" /> Export CSV
              </Button>
              {canClose && (
                <Button variant="primary" onClick={() => setClosing(true)}>
                  <Lock size={14} aria-hidden="true" /> Close month
                </Button>
              )}
            </>
          )
        }
      />
      <ErrorState error={people.error} />
      {people.isLoading && <Loading rows={2} />}
      {month && (
        <>
          {locked && (
            <div style={{ marginBottom: 16 }}>
              <Callout tone="neutral" icon={Lock} title={`${month.label} is closed.`}>
                Closed by {month.locked_by?.name ?? "the HOD"} on {fmtDate(month.locked_at)}
                {month.lock_note ? `: “${month.lock_note}”` : ""}. These scores are frozen snapshots.
              </Callout>
            </div>
          )}
          <MonthRail month={month} states={all.map(railState)} />
          <div className="panel" style={{ marginTop: 20 }}>
            <div className="toolbar" style={{ borderBottom: "1px solid var(--line)" }}>
              <label className="search-in">
                <Search size={14} aria-hidden="true" />
                <input placeholder="Search by name or ID" aria-label="Search" value={q} onChange={(e) => setQ(e.target.value)} />
              </label>
              <span className="small muted">{admin ? "Open a person for the full calculation." : METHOD_NOTE}</span>
            </div>
            {rows.length === 0 ? (
              <Empty title="No one matches">Try another search.</Empty>
            ) : (
              <div className="tbl-wrap">
                <table className="tbl stackable">
                  <thead>
                    <tr>
                      <th>Person</th>
                      <th>Evaluator</th>
                      <th className="n">KPI average</th>
                      <th className="n">On-time</th>
                      <th className="n">Delayed</th>
                      {ratings.map((c) => (
                        <th key={c.key} className="n" title={c.help}>{c.label}</th>
                      ))}
                      <th className="n">Training</th>
                      {admin && <th className="n">Coverage</th>}
                      <th className="n">{locked ? "Final" : "Score (live)"}</th>
                      <th>Tier</th>
                      <th>Check-in</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.employee.id} className="clickable" onClick={() => navigate(`/individual/performance/${r.employee.id}/${month.id}`)}>
                        <td className="person" data-l="Person"><PersonChip person={r.employee} /></td>
                        <td data-l="Evaluator" className="nowrap">{r.evaluator?.name ?? "—"}</td>
                        <td className="n" data-l="KPI average"><KpiAvgCell row={r} /></td>
                        <td className="n num" data-l="On-time">{r.on_time.on_time}</td>
                        <td className="n num" data-l="Delayed" style={r.on_time.delayed ? { color: "var(--bad)" } : undefined}>{r.on_time.delayed}</td>
                        {ratings.map((c) => {
                          const v = (r.check_in as unknown as Record<string, number | null>)[c.key];
                          return (
                            <td key={c.key} className="n num" data-l={c.label}>{v ?? <Unavailable>None</Unavailable>}</td>
                          );
                        })}
                        <td className="n num" data-l="Training">
                          {r.twcs_status === "na" ? "N/A" : r.twcs === null ? <Unavailable>None</Unavailable> : fmtScore(r.twcs)}
                          {r.band && r.twcs !== null && <span className="sub">{r.band}</span>}
                        </td>
                        {admin && <td className="n num" data-l="Coverage">{r.coverage ?? "—"}%</td>}
                        <td className="n" data-l="Score"><FinalScore row={r} /></td>
                        <td data-l="Tier">{r.final !== null && r.status !== "not_evaluated" ? <Tier tier={r.tier} /> : null}</td>
                        <td data-l="Check-in"><EvalBadge state={railState(r)} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <p className="small muted" style={{ marginTop: 10 }}>
            Training cut-off for {month.label}: {fmtDate(month.training_cutoff)}. Scores stay provisional until the HOD closes the month.
          </p>
        </>
      )}
      {closing && month && ctx.data && (
        <Drawer open wide onClose={() => setClosing(false)} title={`Close ${month.label}`} sub="Review readiness, then close. Closing freezes every scorecard for this month.">
          <MonthClose month={month} months={ctx.data.months} onOpened={(id) => { setClosing(false); setMonth(id); }} onClosed={() => setClosing(false)} />
        </Drawer>
      )}
    </>
  );
}
