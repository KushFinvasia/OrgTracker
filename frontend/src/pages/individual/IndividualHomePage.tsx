import { AlertTriangle, CheckCircle2, ClipboardList, GraduationCap, SlidersHorizontal } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";

import type { Person } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { Badge, Card, Empty, ErrorState, Loading, PageHeader, PersonChip, Stat } from "@/components/ui";
import { fmtDate, fmtPct } from "@/lib/format";
import { useApiQuery } from "@/lib/hooks";
import { type MonthInfo, NotInPilot, usePilot } from "./shared";

interface HomeData {
  actions: { type: string; title: string; detail: string; link: string; tone: "red" | "amber" | "green" }[];
  months: (MonthInfo & { approved: number; people: number })[];
  checkins: { month_id: number; label: string; ended: boolean; total: number; done: number; approved: number; people: { employee: Person; state: string; evaluator: Person | null; mine: boolean }[] }[];
  below_target: { employee: Person; pct: number; month: string }[];
  actuals_to_enter: number;
  no_outcome: number;
  role: string;
}

const ICONS: Record<string, JSX.Element> = {
  Returned: <AlertTriangle size={20} />,
  Evaluate: <ClipboardList size={20} />,
  Approve: <CheckCircle2 size={20} />,
  Delay: <AlertTriangle size={20} />,
  Training: <GraduationCap size={20} />,
  Rule: <SlidersHorizontal size={20} />,
};

export function IndividualHomePage() {
  const { account } = useAuth();
  const navigate = useNavigate();
  const ctx = usePilot();
  const home = useApiQuery<HomeData>(ctx.data && ctx.data.people > 0 ? "/individual/home" : null);
  if (ctx.isLoading) return <Loading rows={3} />;
  const c = ctx.data;
  const h = home.data;
  const role = account?.role;
  // The check-in to work on: the earliest open month that has ended, else the current one.
  const ci = h?.checkins.find((c) => c.ended) ?? h?.checkins[0];

  return (
    <>
      <PageHeader
        title={`Good to see you, ${account?.employee.name.split(" ")[0]}.`}
        sub={c ? `Individual Tier / ${c.department} pilot / ${c.category} / ${c.people} people in your scope${c.evaluates ? ` / you evaluate ${c.evaluates}` : ""}` : undefined}
      />
      {c && c.people === 0 && <NotInPilot />}
      <ErrorState error={home.error} />
      {home.isLoading && <Loading rows={2} />}
      {h && (
        <div className="stack">
          <div className="grid grid-4">
            <Stat label="Waiting for you" value={h.actions.length} hint={role === "manager" ? "Check-ins, returns and fixes" : "Approvals, verifications and validations"} />
            <Stat label={`Check-ins done${ci ? ` / ${ci.label}` : ""}`} value={ci ? `${ci.done} of ${ci.total}` : "—"} hint={ci ? `${ci.approved} approved by the ${role === "manager" ? "HOD" : "approver"}` : "No open month"} />
            <Stat label="Actuals to enter" value={h.actuals_to_enter} hint="KPI rows with a target but no achieved value" />
            <Stat label="No outcome recorded" value={h.no_outcome} hint="Past the target date; excluded from On-time until recorded" />
          </div>
          <div className="grid grid-main">
            <Card title="Action inbox" sub="Decisions happen on the linked record; this list only points to them.">
              {h.actions.length === 0 && <Empty title="Nothing waiting">You are up to date for the open months.</Empty>}
              {h.actions.slice(0, 25).map((a, i) => (
                <div key={i} className="inbox-item">
                  <div className={`inbox-icon ${a.tone === "green" ? "" : a.tone}`}>{ICONS[a.type] ?? <ClipboardList size={20} />}</div>
                  <div className="grow">
                    <h4>{a.title}</h4>
                    <div className="small muted">{a.detail}</div>
                  </div>
                  <button className="btn btn-sm" onClick={() => navigate(a.link)}>Open</button>
                </div>
              ))}
              {h.actions.length > 25 && <p className="small muted">{h.actions.length - 25} more in Performance.</p>}
            </Card>
            <div className="stack">
              {ci && (
                <Card
                  title={`Monthly check-ins / ${ci.label}`}
                  sub={role === "manager" ? "Your people's ratings, training and delay reasons for the month, submitted to the HOD." : "Every check-in in your scope. Approve submitted ones; the month locks once all are approved."}
                >
                  {ci.people.length === 0 && <p className="muted">No one in scope.</p>}
                  {ci.people.slice(0, 14).map((p) => (
                    <div key={p.employee.id} className="row between" style={{ padding: "7px 0", borderBottom: "1px solid var(--border)" }}>
                      <PersonChip person={p.employee} meta={p.mine ? `${p.employee.code} / you check in` : `${p.employee.code} / ${p.evaluator?.name ?? "—"}`} />
                      <Link to={`/individual/team/${p.employee.id}?month=${ci.month_id}`}><Badge status={p.state} /></Link>
                    </div>
                  ))}
                  {ci.people.length > 14 && <Link className="small" to={`/individual/team?month=${ci.month_id}`}>All {ci.people.length} in Team</Link>}
                </Card>
              )}
              <Card title="Months" sub="Scores are final only once the HOD locks the month.">
                {h.months.map((m) => (
                  <div key={m.id} className="inbox-item">
                    <div className="grow">
                      <h4>{m.label} <Badge status={m.state} /></h4>
                      <div className="small muted">
                        {m.approved} of {m.people} check-ins approved / training cut-off {fmtDate(m.training_cutoff)} / rule {m.rule.label}
                      </div>
                    </div>
                    <Link className="btn btn-sm" to={`/individual/team?month=${m.id}`}>Open</Link>
                  </div>
                ))}
                {h.months.length === 0 && <p className="muted">No open months.</p>}
              </Card>
              <Card title="Below target" sub="Average achieved ÷ target across the person's KPI rows">
                {h.below_target.length === 0 && <p className="muted">No one in your scope is below 80% with recorded actuals.</p>}
                {h.below_target.map((b) => (
                  <div key={`${b.employee.id}-${b.month}`} className="row between" style={{ padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                    <PersonChip person={b.employee} meta={`${b.employee.code} / ${b.month}`} />
                    <Badge tone="red">{fmtPct(b.pct, 1)}</Badge>
                  </div>
                ))}
              </Card>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
