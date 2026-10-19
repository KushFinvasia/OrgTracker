import { Link, useNavigate, useParams } from "react-router-dom";

import type { Person } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { Avatar, Badge, Callout, Card, Empty, ErrorState, Kv, Loading, PageHeader, PersonChip, Stat, Tabs } from "@/components/ui";
import { useCrumbLabel } from "@/lib/crumb";
import { fmtDate, fmtNum, fmtPct } from "@/lib/format";
import { useApiQuery, useQueryParam } from "@/lib/hooks";

type Tab = "overview" | "work" | "history";

interface PersonData extends Person {
  hrms_code: string | null;
  manager: Person | null;
  flags: string | null;
  proposed_role: string | null;
  reports: Person[];
  work: { assigned: number; active: number; accepted: number; accepted_output: number; reported_progress: number | null; overdue: number; blocked: number; projects: number };
  reporting_history: { manager: Person | null; from: string; to: string | null; reason: string | null }[];
}

interface WorkRow {
  task_id: number;
  code: string;
  title: string;
  role: string;
  share: number;
  status: string;
  due_date: string | null;
  progress: number;
  complexity: number;
  timing: string;
  weighted_output: number | null;
}

/** Project Tier person page: the person's delivery work. KPIs, check-ins, training and recognition live in the Individual Tier. */
export function PersonWorkspacePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { account } = useAuth();
  const [tabParam, setTabParam] = useQueryParam("tab");
  const tab = (["overview", "work", "history"].includes(tabParam ?? "") ? tabParam : "overview") as Tab;
  const person = useApiQuery<PersonData>(`/people/${id}`);
  const work = useApiQuery<WorkRow[]>(tab === "work" || tab === "overview" ? `/people/${id}/work` : null);
  useCrumbLabel(person.data?.name);
  if (person.isLoading) return <Loading rows={3} />;
  if (person.error || !person.data) return <ErrorState error={person.error} />;
  const p = person.data;

  return (
    <>
      <PageHeader
        title={<span className="row"><Avatar person={p} size="lg" /> {p.name}</span>}
        sub={`${p.code} / ${p.designation} / ${p.department}${p.manager ? ` / Reporting to ${p.manager.name}` : ""}`}
      />
      <Tabs
        value={tab}
        onChange={(t) => setTabParam(t)}
        tabs={[
          { id: "overview", label: "Overview" },
          { id: "work", label: "Assigned work" },
          { id: "history", label: "History" },
        ]}
      />
      {tab === "overview" && (
        <div className="stack">
          <div className="grid grid-4">
            <Stat label="Assigned work" value={p.work.assigned} hint={`Across ${p.work.projects} permitted project(s)`} />
            <Stat label="Accepted output" value={fmtNum(p.work.accepted_output, 2)} hint="Complexity x contribution" />
            <Stat label="Reported progress" value={fmtPct(p.work.reported_progress)} hint="Active task update (planning only)" />
            <Stat label="Overdue / blocked" value={`${p.work.overdue} / ${p.work.blocked}`} hint="Active tasks" />
          </div>
          <Card title="Current contributions">
            <WorkTable rows={(work.data ?? []).filter((w) => w.status !== "Completed").slice(0, 8)} onOpen={(tid) => navigate(`/tasks?task=${tid}`)} />
          </Card>
          {account?.in_pilot && (
            <Callout title="KPIs, check-ins and training">
              These live in the Individual Tier. <Link to={`/individual/team/${p.id}`}>Open {p.name} in Individual Tier → Team</Link> (if they are in your Sales pilot scope).
            </Callout>
          )}
        </div>
      )}
      {tab === "work" && (
        <Card title="Assigned and accepted work">
          {work.isLoading ? <Loading /> : <WorkTable rows={work.data ?? []} onOpen={(tid) => navigate(`/tasks?task=${tid}`)} />}
        </Card>
      )}
      {tab === "history" && (
        <div className="grid grid-2">
          <Card title="Identity">
            <Kv items={[["Record ID", p.code], ["HRMS code", p.hrms_code ?? "To confirm before go-live"], ["Proposed role", p.proposed_role ?? "—"], ["Flags", p.flags ?? "None"]]} />
            {p.reports.length > 0 && (<><h4 className="mt mb">Direct reports</h4>{p.reports.map((r) => <PersonChip key={r.id} person={r} />)}</>)}
          </Card>
          <Card title="Reporting history" sub="Effective-dated; identity never changes">
            {p.reporting_history.map((h, i) => <p key={i}>{h.manager?.name ?? "—"} from {fmtDate(h.from)}{h.to ? ` to ${fmtDate(h.to)}` : ""} <span className="muted">/ {h.reason}</span></p>)}
          </Card>
        </div>
      )}
    </>
  );
}

function WorkTable({ rows, onOpen }: { rows: WorkRow[]; onOpen: (id: number) => void }) {
  if (!rows.length) return <Empty title="No assigned work in your permitted projects" />;
  return (
    <table className="table">
      <thead><tr><th>Task</th><th>Role / share</th><th>State</th><th>Due in force</th><th>Progress</th><th>Weighted output</th></tr></thead>
      <tbody>
        {rows.map((w) => (
          <tr key={w.task_id} className="clickable" onClick={() => onOpen(w.task_id)}>
            <td><b>{w.title}</b><div className="sub">{w.code}</div></td>
            <td>{w.role} / {w.share}%</td>
            <td><Badge status={w.status} /></td>
            <td>{fmtDate(w.due_date, false)}</td>
            <td className="num">{w.progress}%</td>
            <td className="num">{w.weighted_output ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
