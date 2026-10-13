import { useState } from "react";
import { useNavigate } from "react-router-dom";

import type { Department, Person } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { Badge, Button, Callout, Card, Empty, Field, FormError, Loading, PageHeader, PersonChip, PersonPicker, Stat, Tabs, toast } from "@/components/ui";
import { fmtNum, todayISO } from "@/lib/format";
import { useApiMutation, useApiQuery, useQueryParam } from "@/lib/hooks";

type Tab = "roster" | "directory" | "hierarchy" | "capacity" | "transfers";

interface RosterRow extends Person {
  manager: Person | null;
  account_role: string | null;
  active_assignments: number;
  overdue: number;
  blocked: number;
  proposed_role: string | null;
  flags: string | null;
  checkin?: string | null;
}

export function TeamPage() {
  const { account, isRole } = useAuth();
  const [tabParam, setTabParam] = useQueryParam("tab");
  const tab = (tabParam as Tab) || "roster";
  const roster = useApiQuery<RosterRow[]>("/team");
  return (
    <>
      <PageHeader title="People, without the spreadsheet sprawl." sub={`${account?.employee.department ?? "Organisation"} / ${isRole("hod") ? "Headed departments" : "Reporting team"} / One identity per person`} />
      <Tabs
        value={tab}
        onChange={(t) => setTabParam(t)}
        tabs={[
          { id: "roster", label: "Roster" },
          { id: "directory", label: "Directory" },
          { id: "hierarchy", label: "Hierarchy" },
          { id: "capacity", label: "Capacity" },
          { id: "transfers", label: "Transfers", hidden: !isRole("admin") },
        ]}
      />
      {tab === "roster" && <Roster rows={roster.data} loading={roster.isLoading} showCheckin={!isRole("team_lead")} />}
      {tab === "directory" && <Directory />}
      {tab === "hierarchy" && <Hierarchy />}
      {tab === "capacity" && <Capacity />}
      {tab === "transfers" && <Transfers />}
    </>
  );
}

function Roster({ rows, loading, showCheckin }: { rows?: RosterRow[]; loading: boolean; showCheckin: boolean }) {
  const navigate = useNavigate();
  if (loading) return <Loading />;
  if (!rows?.length) return <Card><Empty title="No people in your reporting scope" /></Card>;
  return (
    <Card>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Person</th><th>Role</th><th>Assigned work</th><th>Overdue / blocked</th>{showCheckin && <th>Check-in</th>}<th>Reporting to</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td><PersonChip person={r} meta={r.code} /></td>
                <td>{r.designation}{r.flags && <div className="sub">{r.flags}</div>}</td>
                <td>{r.active_assignments} active assignments</td>
                <td>{r.overdue} / {r.blocked}</td>
                {showCheckin && <td>{r.checkin ? <Badge status={r.checkin === "Completed" ? "Completed" : "Pending"}>{r.checkin}</Badge> : <span className="muted">—</span>}</td>}
                <td>{r.manager?.name ?? "—"}</td>
                <td><button className="link-btn" onClick={() => navigate(`/people/${r.id}`)}>Open profile</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!showCheckin && <p className="small muted">Team Lead view omits scores and check-ins.</p>}
    </Card>
  );
}

function Directory() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const { data } = useApiQuery<Person[]>(`/people/lookup?q=${encodeURIComponent(q)}&limit=50`);
  return (
    <Card title="One person, one identity, a clear reporting line" sub="Employee and vacant-position records are separate. Find by ID and department; no name-only matching.">
      <input className="input mb" placeholder="Search by name, employee ID or designation" value={q} onChange={(e) => setQ(e.target.value)} />
      <table className="table">
        <thead><tr><th>Person / identity</th><th>Department</th><th>Designation</th><th /></tr></thead>
        <tbody>
          {(data ?? []).map((p) => (
            <tr key={p.id}>
              <td><PersonChip person={p} meta={p.code} /></td>
              <td>{p.department}</td>
              <td>{p.designation}</td>
              <td><button className="link-btn" onClick={() => navigate(`/people/${p.id}`)}>Open person</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small muted">Opening a person outside your reporting and work scope shows a permission message, not their record.</p>
    </Card>
  );
}

interface Node extends Person {
  children: Node[];
  child_count: number;
}

function Hierarchy() {
  const { data, isLoading } = useApiQuery<{ root: Node; manager: Person | null }>("/hierarchy");
  if (isLoading || !data) return <Loading />;
  const render = (n: Node, depth: number) => (
    <div key={n.id} style={{ marginLeft: depth * 28, borderLeft: depth ? "2px solid var(--border)" : 0, paddingLeft: depth ? 14 : 0, marginTop: 10 }}>
      <PersonChip person={n} meta={`${n.code} / ${n.designation}${n.record_type === "position" ? " / Vacant position" : ""}${n.child_count ? ` / ${n.child_count} direct` : ""}`} />
      {n.children.map((c) => render(c, depth + 1))}
    </div>
  );
  return (
    <div className="grid grid-main">
      <Card title="Reporting branch behind your scope" sub={data.manager ? `Reports to ${data.manager.name} / ${data.manager.code}` : undefined}>
        {render(data.root, 0)}
      </Card>
      <div className="stack">
        <Callout title="Canonical identity">One employee master record; HRMS IDs replace source placeholder IDs before go-live.</Callout>
        <Callout title="Effective reporting">Reporting links and dated transfers establish private KPI, check-in and training-score access.</Callout>
        <Callout title="Separate work membership">Joining a cross-team project adds work context without private performance access.</Callout>
        <Callout tone="warn" title="Vacant positions">Modelled separately; no account is provisioned for them. Source reporting roles require HR reconciliation.</Callout>
      </div>
    </div>
  );
}

interface CapacityRow extends Person {
  available_days: number | null;
  available_days_state: string;
  active_tasks: number;
  weighted_load: number;
  training_hours: number;
  signal: string;
}

function Capacity() {
  const { data, isLoading } = useApiQuery<{ period: { name: string } | null; rows: CapacityRow[]; note: string }>("/team/capacity");
  if (isLoading || !data) return <Loading />;
  const known = data.rows.filter((r) => r.available_days !== null);
  return (
    <>
      <div className="grid grid-4 mb">
        <Stat label="Team members" value={data.rows.length} hint="Current reporting scope" />
        <Stat label="Available days" value={known.length ? fmtNum(known.reduce((s, r) => s + (r.available_days ?? 0), 0)) : "Unavailable"} hint={`${known.length} of ${data.rows.length} validated`} />
        <Stat label="Weighted active load" value={fmtNum(data.rows.reduce((s, r) => s + r.weighted_load, 0), 1)} hint="Complexity x contribution" />
        <Stat label="Training scheduled" value={`${fmtNum(data.rows.reduce((s, r) => s + r.training_hours, 0))}h`} hint="Included in capacity planning" />
      </div>
      <Card title="Balance commitments across the team" sub={data.period?.name}>
        <table className="table">
          <thead><tr><th>Person</th><th>Available days</th><th>Active tasks</th><th>Weighted load</th><th>Training hours</th><th>Capacity signal</th></tr></thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.id}>
                <td><PersonChip person={r} meta={r.code} /></td>
                <td>{r.available_days ?? <Badge tone="amber">{r.available_days_state}</Badge>}</td>
                <td className="num">{r.active_tasks}</td>
                <td className="num">{r.weighted_load}</td>
                <td className="num">{r.training_hours}h</td>
                <td><Badge tone={r.signal === "On track" ? "green" : "amber"}>{r.signal}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="small muted">{data.note}</p>
      </Card>
    </>
  );
}

function Transfers() {
  const departments = useApiQuery<Department[]>("/departments");
  const [employee, setEmployee] = useState<Person | null>(null);
  const [manager, setManager] = useState<Person | null>(null);
  const [form, setForm] = useState({ new_department_id: "", effective_from: todayISO(), reason: "" });
  const save = useApiMutation<Record<string, unknown>>("post", "/admin/transfers");
  return (
    <div className="grid grid-main">
      <Card title="Move reporting lines without losing history">
        <FormError error={save.error} />
        <div className="form-grid">
          <Field label="Employee" required><PersonPicker value={employee} onChange={setEmployee} /></Field>
          <Field label="New manager" required><PersonPicker value={manager} onChange={setManager} placeholder="Choose named manager" /></Field>
          <Field label="New department">
            <select className="input" value={form.new_department_id} onChange={(e) => setForm({ ...form, new_department_id: e.target.value })}>
              <option value="">Keep current department</option>
              {(departments.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
          <Field label="Effective date" required><input type="date" className="input" value={form.effective_from} onChange={(e) => setForm({ ...form, effective_from: e.target.value })} /></Field>
          <Field label="Reason / approval evidence" required className="full"><input className="input" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="HR transfer confirmation" /></Field>
        </div>
        <Button
          className="mt"
          variant="primary"
          onClick={() => save.mutate({ employee_id: employee?.id, new_manager_id: manager?.id, new_department_id: Number(form.new_department_id) || null, effective_from: form.effective_from, reason: form.reason }, { onSuccess: () => toast("Dated transfer saved") })}
        >
          Save dated transfer
        </Button>
      </Card>
      <div className="stack">
        <Callout title="Separate links">HR reporting and project membership change independently. Existing project assignments are kept.</Callout>
        <Callout title="Historical results">Prior locked periods retain historical scope and policy.</Callout>
        <Callout tone="warn" title="Training relevance">An inapplicable course needs an approved exemption; a transfer does not silently remove due training.</Callout>
      </div>
    </div>
  );
}
