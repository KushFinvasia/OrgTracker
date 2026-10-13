import { useNavigate } from "react-router-dom";

import { api } from "@/api/client";
import type { Person, Project } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { Badge, Button, Callout, Card, Empty, ErrorState, Loading, PageHeader, PersonChip, Stat, Tabs, toast } from "@/components/ui";
import { BarList } from "@/components/ui/charts";
import { fmtDateTime, fmtNum, fmtPct, fmtScore } from "@/lib/format";
import { useApiQuery, useQueryParam } from "@/lib/hooks";

type Tab = "delivery" | "people" | "performance" | "training" | "recognition" | "data-quality";

export function ReportsPage() {
  const { isRole, account } = useAuth();
  const [tabParam, setTabParam] = useQueryParam("tab");
  const tab = (tabParam as Tab) || "delivery";
  const privateOk = !isRole("team_lead");
  const exportable = ["delivery", "people", "performance", "training", "data-quality"].includes(tab);

  return (
    <>
      <PageHeader
        title="See the signal. Follow it to the source."
        sub={`${account?.headed_departments.join(", ") || account?.employee.department || "Organisation"} / As of ${fmtDateTime(new Date().toISOString())} / Your permitted scope`}
        actions={
          exportable && (
            <Button variant="primary" onClick={() => api.download(`/reports/${tab}/export.csv`, `orgtrack-${tab}.csv`).then(() => toast("Export downloaded with scope, as-of and rule versions")).catch(() => toast("Export failed", true))}>
              Export report
            </Button>
          )
        }
      />
      <Tabs
        value={tab}
        onChange={(t) => setTabParam(t)}
        tabs={[
          { id: "delivery", label: "Delivery" },
          { id: "people", label: "People" },
          { id: "performance", label: "Performance", hidden: !privateOk },
          { id: "training", label: "Training", hidden: !privateOk },
          { id: "recognition", label: "Recognition", hidden: !privateOk },
          { id: "data-quality", label: "Data quality" },
        ]}
      />
      {tab === "delivery" && <Delivery />}
      {tab === "people" && <People />}
      {tab === "performance" && <Performance />}
      {tab === "training" && <Training />}
      {tab === "recognition" && <Recognition />}
      {tab === "data-quality" && <DataQuality />}
    </>
  );
}

function Delivery() {
  const navigate = useNavigate();
  const { data, isLoading, error } = useApiQuery<{
    summary: Record<string, number>;
    health: Record<string, number>;
    waiting: { cause: string; count: number }[];
    incidents: { open: number; repeat: number; total: number };
    projects: Project[];
    note: string;
  }>("/reports/delivery");
  if (isLoading) return <Loading rows={2} />;
  if (error || !data) return <ErrorState error={error} />;
  const s = data.summary;
  return (
    <div className="stack">
      <div className="grid grid-4">
        <Stat label="Active projects" value={s.projects} hint={`${s.high_priority} High priority / ${s.missing_priority} missing priority`} />
        <Stat label="Review waiting" value={s.review_waiting} hint="Independent review queue" />
        <Stat label="Overdue active work" value={s.overdue_active_work} hint="Due dates in force" />
        <Stat label="Open high risks" value={s.open_high_risks} hint="Review the mitigation owners" />
      </div>
      <div className="grid grid-2">
        <Card title="Project health" sub="Derived from approved (proposed) health rules">
          <BarList label="Projects by health" items={Object.entries(data.health).map(([label, value]) => ({ label, value }))} />
        </Card>
        <Card title="Where work is waiting" sub="Approval wait is its own delivery stage">
          <BarList label="Open work by waiting cause" items={data.waiting.map((w) => ({ label: w.cause, value: w.count }))} />
        </Card>
      </div>
      <Card title="Project drill-down" sub={`Incidents: ${data.incidents.open} open / ${data.incidents.repeat} repeat (department reporting)`}>
        <table className="table">
          <thead><tr><th>Project</th><th>Priority</th><th>Accepted</th><th>Overdue</th><th>Health</th><th /></tr></thead>
          <tbody>
            {data.projects.slice(0, 40).map((p) => (
              <tr key={p.id}>
                <td><b>{p.title}</b><div className="sub">{p.code} / {p.department}</div></td>
                <td>{p.priority ? <Badge status={p.priority} /> : <Badge tone="red">Missing</Badge>}</td>
                <td className="num">{p.metrics.tasks_accepted} of {p.metrics.tasks_total}</td>
                <td className="num">{p.metrics.overdue}</td>
                <td>{p.metrics.health ? <Badge status={p.metrics.health} /> : "—"}</td>
                <td><button className="link-btn" onClick={() => navigate(`/projects/${p.id}`)}>Open project</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="small muted">{data.note}</p>
      </Card>
    </div>
  );
}

function People() {
  const navigate = useNavigate();
  const { data, isLoading, error } = useApiQuery<{
    period: { name: string };
    rows: { employee: Person; assigned: number; active: number; accepted: number; blocked: number; in_review: number; overdue: number; weighted_output: number; reported_progress: number | null; projects: number; training?: { verified: number; eligible: number; score: number | null } }[];
    note: string;
  }>("/reports/people");
  if (isLoading) return <Loading rows={2} />;
  if (error || !data) return <ErrorState error={error} />;
  const r = data.rows;
  return (
    <div className="stack">
      <div className="grid grid-4">
        <Stat label="Reporting people" value={r.length} hint="Permitted manager scope" />
        <Stat label="Assigned tasks" value={r.reduce((s, x) => s + x.assigned, 0)} hint="Counts for context" />
        <Stat label="Accepted output" value={fmtNum(r.reduce((s, x) => s + x.weighted_output, 0), 1)} hint="Complexity x contribution" />
        <Stat label="Actions waiting" value={r.reduce((s, x) => s + x.in_review + x.blocked, 0)} hint="Reviews + blocked" />
      </div>
      <Card title="Person-wise progress for your reporting team" sub="Work measures are distinct from KPI scores">
        {r.length === 0 ? <Empty title="No reporting people" /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Person</th><th>Assigned</th><th>Accepted</th><th>Blocked</th><th>Review</th><th>Overdue</th><th>Weighted output</th><th>Reported progress</th><th>Training</th></tr></thead>
              <tbody>
                {r.map((x) => (
                  <tr key={x.employee.id} className="clickable" onClick={() => navigate(`/people/${x.employee.id}`)}>
                    <td><PersonChip person={x.employee} meta={x.employee.code} /></td>
                    <td className="num">{x.assigned}</td><td className="num">{x.accepted}</td><td className="num">{x.blocked}</td><td className="num">{x.in_review}</td><td className="num">{x.overdue}</td>
                    <td className="num">{x.weighted_output}</td>
                    <td className="num">{fmtPct(x.reported_progress)}</td>
                    <td className="num">{x.training ? `${x.training.verified} / ${x.training.eligible} / ${fmtPct(x.training.score)}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="small muted">{data.note}</p>
      </Card>
    </div>
  );
}

function Performance() {
  const navigate = useNavigate();
  const { data, isLoading, error } = useApiQuery<{ period: { id: number; name: string; state: string }; rows: { employee: Person; category: string; base_kpi: number | null; coverage: number; training: number | null; training_status: string; final: number | null; final_status: string; status: string; checkin: boolean; missing: string[] }[] }>("/reports/performance");
  if (isLoading) return <Loading rows={2} />;
  if (error || !data) return <ErrorState error={error} />;
  const r = data.rows;
  return (
    <div className="stack">
      <div className="grid grid-4">
        <Stat label="Ready evaluations" value={`${r.filter((x) => x.status === "Ready for review").length}/${r.length}`} hint={data.period.name} />
        <Stat label="Missing KPI coverage" value={r.filter((x) => x.status === "Insufficient data").length} hint="Below 70% threshold" />
        <Stat label="Readiness exceptions" value={r.filter((x) => x.status === "Readiness exception").length} hint="Unknown training records" />
        <Stat label="Period state" value={<Badge status={data.period.state} />} hint="Lock after exceptions reviewed" />
      </div>
      <Card title="Team KPI and final R&R readiness">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Person</th><th>Category</th><th>Base KPI</th><th>KPI coverage</th><th>Training</th><th>Final R&amp;R</th><th>Readiness</th></tr></thead>
            <tbody>
              {r.map((x) => (
                <tr key={x.employee.id} className="clickable" onClick={() => navigate(`/performance/${x.employee.id}/${data.period.id}`)}>
                  <td><PersonChip person={x.employee} meta={x.employee.code} /></td>
                  <td>{x.category}</td>
                  <td className="num">{x.base_kpi !== null ? fmtScore(x.base_kpi, 1) : "Insufficient"}</td>
                  <td className="num">{fmtPct(x.coverage)}</td>
                  <td className="num">{x.training_status === "scored" ? fmtPct(x.training) : x.training_status === "na" ? "N/A" : "Awaiting"}</td>
                  <td className="num">{x.final !== null ? fmtScore(x.final) : x.final_status === "insufficient" ? "Insufficient" : "Pending"}</td>
                  <td><Badge status={x.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted">Training does not mask insufficient base KPI coverage.</p>
      </Card>
    </div>
  );
}

function Training() {
  const navigate = useNavigate();
  const { data, isLoading, error } = useApiQuery<{
    period: { name: string; cutoff: string };
    rows: { employee: Person; allotted: number; future_due: number; eligible: number; verified: number; pending_verification: number; uncompleted: number; overdue: number; score: number | null; status: string }[];
    team: { verified: number; eligible: number; allotted: number; score: number | null };
    note: string;
  }>("/reports/training");
  if (isLoading) return <Loading rows={2} />;
  if (error || !data) return <ErrorState error={error} />;
  return (
    <div className="stack">
      <div className="grid grid-4">
        <Stat label="Allotted" value={data.team.allotted} hint="All assignments in scope" />
        <Stat label="Due this period" value={data.team.eligible} hint="Denominator / excludes future due" />
        <Stat label="Verified complete" value={data.team.verified} hint="Numerator" />
        <Stat label="Team completion" value={fmtPct(data.team.score, 2)} hint={`${data.team.verified} / ${data.team.eligible} x 100; not the mean of %`} />
      </div>
      <Card title="Training allotted and completion by person" sub={`${data.period.name} / cutoff ${fmtDateTime(data.period.cutoff)}`}>
        <table className="table">
          <thead><tr><th>Person</th><th>Allotted</th><th>Due</th><th>Verified</th><th>Uncompleted</th><th>Overdue</th><th>Completion</th><th /></tr></thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.employee.id}>
                <td><PersonChip person={r.employee} meta={r.employee.code} /></td>
                <td className="num">{r.allotted}</td><td className="num">{r.eligible}</td><td className="num">{r.verified}</td><td className="num">{r.uncompleted}</td><td className="num">{r.overdue}</td>
                <td className="num">{r.status === "scored" ? fmtPct(r.score, 2) : r.status === "na" ? "N/A" : <Badge tone="amber">Readiness exception</Badge>}</td>
                <td><button className="link-btn" onClick={() => navigate(`/people/${r.employee.id}?tab=training`)}>{r.pending_verification ? "Review pending" : r.uncompleted ? "Open assignments" : "View evidence"}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <Callout title="Aggregation">{data.note}</Callout>
      </Card>
    </div>
  );
}

function Recognition() {
  const navigate = useNavigate();
  const { data, isLoading, error } = useApiQuery<{ cycle: { title: string; state: string } | null; rows: { employee: Person; final: number | null; status: string; gates: { gate: string; result: string }[]; gates_pass: boolean; nominations: { id: number; award_type: string; state: string }[] }[] }>("/reports/recognition");
  if (isLoading) return <Loading />;
  if (error || !data) return <ErrorState error={error} />;
  return (
    <Card title="Recognition readiness and decisions" sub={data.cycle ? `${data.cycle.title} / ${data.cycle.state}` : "No cycle"}>
      <table className="table">
        <thead><tr><th>Person</th><th>Final score</th><th>Gates</th><th>Nomination</th><th /></tr></thead>
        <tbody>
          {data.rows.map((r) => (
            <tr key={r.employee.id}>
              <td><PersonChip person={r.employee} meta={r.employee.code} /></td>
              <td className="num">{r.final !== null ? fmtScore(r.final) : r.status}</td>
              <td>{r.gates.length ? <Badge tone={r.gates_pass ? "green" : r.gates.some((g) => g.result === "fail") ? "red" : "amber"}>{r.gates_pass ? "Gates pass" : r.gates.some((g) => g.result === "fail") ? "Gate fails" : "Gate sources pending"}</Badge> : "Awaiting lock"}</td>
              <td>{r.nominations.length ? r.nominations.map((n) => <span key={n.id}>{n.award_type} <Badge status={n.state} /></span>) : <span className="muted">No nomination submitted</span>}</td>
              <td>{r.nominations[0] && <button className="link-btn" onClick={() => navigate(`/rewards/nominations/${r.nominations[0].id}`)}>Open nomination</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small muted">Shows only reporting-team private results and permitted nominations.</p>
    </Card>
  );
}

function DataQuality() {
  const navigate = useNavigate();
  const { data, isLoading, error } = useApiQuery<{ issues: { issue: string; record: string; impact: string; action: string; link: string }[]; counts: Record<string, number> }>("/reports/data-quality");
  if (isLoading) return <Loading />;
  if (error || !data) return <ErrorState error={error} />;
  return (
    <div className="stack">
      <div className="grid grid-4">
        {Object.entries(data.counts).slice(0, 8).map(([k, v]) => <Stat key={k} label={k} value={v} />)}
      </div>
      <Card title="Resolve the data issues behind the results" sub="Missing records stay unavailable rather than scoring a false zero">
        {data.issues.length === 0 ? <Empty title="No data quality issues in your scope" /> : (
          <table className="table">
            <thead><tr><th>Issue</th><th>Record / source</th><th>Impact</th><th>Action</th></tr></thead>
            <tbody>
              {data.issues.slice(0, 200).map((i, k) => (
                <tr key={k}>
                  <td><b>{i.issue}</b></td>
                  <td>{i.record}</td>
                  <td>{i.impact}</td>
                  <td><button className="link-btn" onClick={() => navigate(i.link)}>{i.action}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
