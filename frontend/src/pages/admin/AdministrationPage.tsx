import { useState } from "react";

import type { Person, Project } from "@/api/types";
import { Badge, Button, Callout, Card, DecisionButton, Drawer, Empty, Field, FormError, Loading, PageHeader, PersonChip, PersonPicker, Stat, Tabs, toast } from "@/components/ui";
import { fmtDate, fmtDateTime, todayISO } from "@/lib/format";
import { useApiMutation, useApiQuery, useQueryParam } from "@/lib/hooks";

type Tab = "access" | "grants" | "imports" | "audit";

interface AccountRow {
  id: number;
  email: string;
  role: string;
  active: boolean;
  employee: Person;
  scope_preview: { work: string; performance: string; decisions: string };
}

export function AdministrationPage() {
  const [tabParam, setTabParam] = useQueryParam("tab");
  const tab = (tabParam as Tab) || "access";
  return (
    <>
      <PageHeader title="Keep the organisation ready for good data." sub="Named accounts, trusted identities and a visible audit trail" />
      <Tabs
        value={tab}
        onChange={(t) => setTabParam(t)}
        tabs={[
          { id: "access", label: "People & access" },
          { id: "grants", label: "Temporary access" },
          { id: "imports", label: "Imports" },
          { id: "audit", label: "Audit history" },
        ]}
      />
      {tab === "access" && <Accounts />}
      {tab === "grants" && <Grants />}
      {tab === "imports" && <Imports />}
      {tab === "audit" && <Audit />}
    </>
  );
}

function Accounts() {
  const { data, isLoading } = useApiQuery<{ accounts: AccountRow[]; scope_preview: Record<string, AccountRow["scope_preview"]> }>("/admin/accounts");
  const [adding, setAdding] = useState(false);
  const update = useApiMutation<{ id: number; active?: boolean; role?: string; reason: string }>("patch", (b) => `/admin/accounts/${b.id}`);
  if (isLoading || !data) return <Loading />;
  return (
    <div className="grid grid-main">
      <Card title="Named account directory" sub="Active accounts are managers and administrators, never shared teams" actions={<Button variant="primary" onClick={() => setAdding(true)}>Add named account</Button>}>
        <FormError error={update.error} />
        <table className="table">
          <thead><tr><th>Person</th><th>Role</th><th>Scope</th><th>State</th><th /></tr></thead>
          <tbody>
            {data.accounts.map((a) => (
              <tr key={a.id}>
                <td><PersonChip person={a.employee} meta={`${a.employee.code} / ${a.email}`} /></td>
                <td><Badge tone="blue">{a.role.replace("_", " ")}</Badge></td>
                <td className="small">{a.scope_preview.work}<div className="sub">Private: {a.scope_preview.performance}</div></td>
                <td><Badge tone={a.active ? "green" : "grey"}>{a.active ? "Active" : "Disabled"}</Badge></td>
                <td>
                  <DecisionButton size="sm" label={a.active ? "Disable" : "Enable"} decision={a.active ? "disable" : "enable"} onDecide={(_, reason) => update.mutate({ id: a.id, active: !a.active, reason }, { onSuccess: () => toast("Account updated") })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="small muted">No employee logins / No shared team credentials.</p>
      </Card>
      <div className="stack">
        {Object.entries(data.scope_preview).map(([role, s]) => (
          <Card key={role} title={role.replace("_", " ").replace(/^\w/, (c) => c.toUpperCase())}>
            <p className="small"><b>Work:</b> {s.work}</p>
            <p className="small"><b>KPI / check-ins / training score:</b> {s.performance}</p>
            <p className="small"><b>Key decisions:</b> {s.decisions}</p>
          </Card>
        ))}
      </div>
      {adding && <AccountDrawer onClose={() => setAdding(false)} />}
    </div>
  );
}

function AccountDrawer({ onClose }: { onClose: () => void }) {
  const [employee, setEmployee] = useState<Person | null>(null);
  const [form, setForm] = useState({ email: "", role: "manager", reason: "" });
  const save = useApiMutation<Record<string, unknown>>("post", "/admin/accounts");
  return (
    <Drawer open onClose={onClose} eyebrow="Administration > People & access" title="Provision a named account" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => save.mutate({ ...form, employee_id: employee?.id }, { onSuccess: () => { toast("Named account saved"); onClose(); } })}>Save named account</Button></>}>
      <FormError error={save.error} />
      <div className="form-grid">
        <Field label="Employee identity" required className="full" help="Reconcile placeholder EMP IDs with HRMS codes before live use. Do not match by name alone."><PersonPicker value={employee} onChange={setEmployee} /></Field>
        <Field label="Company account" required><input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
        <Field label="Role" required>
          <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}><option value="admin">Admin</option><option value="hod">HOD</option><option value="manager">Manager</option><option value="team_lead">Team Lead</option></select>
        </Field>
        <Field label="Reason" required className="full"><input className="input" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></Field>
      </div>
      <Callout title="Role differences">Managers access reporting-tree performance. Team Leads access work updates, not KPI/check-in/training-score results. One account links to one employee record.</Callout>
    </Drawer>
  );
}

function Grants() {
  const { data, isLoading } = useApiQuery<{ id: number; recipient: Person | null; project: { code: string; title: string }; permission: string; reason: string; starts_on: string; expires_on: string; revoked_at: string | null; active: boolean }[]>("/admin/grants");
  const accounts = useApiQuery<{ accounts: AccountRow[] }>("/admin/accounts");
  const projects = useApiQuery<Project[]>("/projects?status=active");
  const [form, setForm] = useState({ account_id: "", project_id: "", permission: "read", reason: "", starts_on: todayISO(), expires_on: "" });
  const create = useApiMutation<Record<string, unknown>>("post", "/admin/grants");
  const revoke = useApiMutation<{ id: number }>("post", (b) => `/admin/grants/${b.id}/revoke`);
  if (isLoading) return <Loading />;
  return (
    <div className="grid grid-main">
      <Card title="Grant temporary work access" sub="Time-bound record scope">
        <FormError error={create.error} />
        <div className="form-grid">
          <Field label="Named recipient" required>
            <select className="input" value={form.account_id} onChange={(e) => setForm({ ...form, account_id: e.target.value })}><option value="">Choose</option>{(accounts.data?.accounts ?? []).map((a) => <option key={a.id} value={a.id}>{a.employee.name} / {a.role}</option>)}</select>
          </Field>
          <Field label="Project" required>
            <select className="input" value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })}><option value="">Choose</option>{(projects.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.code} / {p.title}</option>)}</select>
          </Field>
          <Field label="Permission" required><select className="input" value={form.permission} onChange={(e) => setForm({ ...form, permission: e.target.value })}><option value="read">Read work context only</option><option value="edit">Edit work</option></select></Field>
          <Field label="Start" required><input type="date" className="input" value={form.starts_on} onChange={(e) => setForm({ ...form, starts_on: e.target.value })} /></Field>
          <Field label="Expiry" required><input type="date" className="input" value={form.expires_on} onChange={(e) => setForm({ ...form, expires_on: e.target.value })} /></Field>
          <Field label="Reason" required><input className="input" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Independent deliverable review" /></Field>
        </div>
        <Button className="mt" variant="primary" onClick={() => create.mutate({ ...form, account_id: Number(form.account_id), project_id: Number(form.project_id) }, { onSuccess: () => toast("Work grant saved") })}>Save work grant</Button>
        <h4 className="mt mb">Grants</h4>
        <table className="table">
          <thead><tr><th>Recipient</th><th>Project</th><th>Permission</th><th>Window</th><th>State</th><th /></tr></thead>
          <tbody>
            {(data ?? []).length === 0 && <tr><td colSpan={6} className="muted">No grants.</td></tr>}
            {(data ?? []).map((g) => (
              <tr key={g.id}>
                <td>{g.recipient?.name}</td><td>{g.project.code}</td><td>{g.permission}</td><td>{fmtDate(g.starts_on, false)} - {fmtDate(g.expires_on)}</td>
                <td><Badge tone={g.active ? "green" : "grey"}>{g.revoked_at ? "Revoked" : g.active ? "Active" : "Expired / future"}</Badge></td>
                <td>{g.active && <button className="link-btn" onClick={() => revoke.mutate({ id: g.id })}>Revoke</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <div className="stack">
        <Callout title="Least necessary scope">Select project and allowed action; grants expire automatically.</Callout>
        <Callout tone="warn" title="No scope escalation">Work access does not expose private KPI, check-in or training-score records.</Callout>
        <Callout title="Audit trail">Grantor, recipient, reason, start, expiry and revocation are recorded.</Callout>
      </div>
    </div>
  );
}

function Imports() {
  const batches = useApiQuery<{ id: number; source: string; state: string; created_at: string; created_by: Person | null }[]>("/admin/imports");
  const run = useApiMutation<Record<string, never>, { counts: Record<string, number>; issues: { severity: string; source: string; issue: string; correction: string }[]; notes: string; state: string }>("post", "/admin/imports/dry-run");
  const r = run.data;
  return (
    <div className="stack">
      <Card title="Validate the import before anything is committed" sub="Upload > Map > Validate > Confirm > Result / corrected workbook" actions={<Button variant="primary" disabled={run.isPending} onClick={() => run.mutate({})}>Run dry-run</Button>}>
        <FormError error={run.error} />
        {r ? (
          <>
            <div className="grid grid-4 mb">
              <Stat label="Projects" value={r.counts.projects} hint="Canonical project records" />
              <Stat label="Assignments" value={r.counts.assignments} hint="Person-project links" />
              <Stat label="Missing priority" value={r.counts.missing_priority} hint="Resolve before creation" />
              <Stat label="Source issues" value={r.counts.source_issues} hint="Workbook issue register" />
            </div>
            <Callout title={r.state}>{r.notes} Only {r.counts.on_time_eligible} of {r.counts.assignments} source assignments qualify for On-time.</Callout>
            <table className="table mt">
              <thead><tr><th>Severity</th><th>Source / row</th><th>Issue</th><th>Required correction</th></tr></thead>
              <tbody>{r.issues.slice(0, 80).map((i, k) => <tr key={k}><td><Badge tone={i.severity === "Critical" ? "red" : i.severity === "High" ? "amber" : "grey"}>{i.severity}</Badge></td><td>{i.source}</td><td>{i.issue}</td><td>{i.correction}</td></tr>)}</tbody>
            </table>
          </>
        ) : (
          <p className="muted">Run a dry-run against PT_RR_Corrected_Data.xlsx. Nothing is imported. Legacy Completed records without evidence or date import as In review.</p>
        )}
      </Card>
      <Card title="Import batches">
        {(batches.data ?? []).length === 0 ? <Empty title="No batches recorded" /> : (
          <table className="table"><thead><tr><th>Source</th><th>State</th><th>By</th><th>When</th></tr></thead>
            <tbody>{batches.data!.map((b) => <tr key={b.id}><td>{b.source}</td><td>{b.state}</td><td>{b.created_by?.name}</td><td>{fmtDateTime(b.created_at)}</td></tr>)}</tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function Audit() {
  const [q, setQ] = useState("");
  const { data, isLoading } = useApiQuery<{ id: number; at: string; actor: Person | null; action: string; entity: string; entity_id: string | null; label: string | null; old: unknown; new: unknown; reason: string | null }[]>(`/admin/audit?q=${encodeURIComponent(q)}`);
  return (
    <Card title="A history that cannot be rewritten" sub="Read-only append-only events. Even administrators cannot edit or delete audit events.">
      <input className="input mb" placeholder="Filter by action or record" value={q} onChange={(e) => setQ(e.target.value)} />
      {isLoading ? <Loading /> : (
        <table className="table">
          <thead><tr><th>Event / actor</th><th>Record</th><th>Old &gt; new</th><th>Reason / time</th></tr></thead>
          <tbody>
            {(data ?? []).map((e) => (
              <tr key={e.id}>
                <td><b>{e.action.replace(/_/g, " ")}</b><div className="sub">{e.actor?.name ?? "System"}</div></td>
                <td>{e.entity} {e.entity_id}<div className="sub">{e.label}</div></td>
                <td className="small" style={{ maxWidth: 320, wordBreak: "break-word" }}>{e.old ? JSON.stringify(e.old).slice(0, 80) : "—"} &gt; {e.new ? JSON.stringify(e.new).slice(0, 80) : "—"}</td>
                <td>{e.reason ?? "—"}<div className="sub">{fmtDateTime(e.at)}</div></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
