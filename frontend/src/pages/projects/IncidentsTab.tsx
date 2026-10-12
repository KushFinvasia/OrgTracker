import { useState } from "react";

import type { Department, Person, ProjectDetail, TaskBrief } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { Badge, Button, Callout, Card, Drawer, Empty, Field, FormError, Kv, PersonPicker, Stat, Tabs, fieldError, toast } from "@/components/ui";
import { fmtDate, todayISO } from "@/lib/format";
import { useApiMutation, useApiQuery } from "@/lib/hooks";

interface Incident {
  id: number;
  code: string;
  title: string;
  product_system: string | null;
  incident_date: string | null;
  received_date: string | null;
  reporter: Person | null;
  severity_proposed: string | null;
  severity_validated: string | null;
  clients_impacted: number | null;
  orders_impacted: number | null;
  stakeholder: Person | null;
  root_cause: string | null;
  root_cause_category: string | null;
  gap: string | null;
  correction_action: string | null;
  correction_date: string | null;
  expected_closure: string | null;
  actual_closure: string | null;
  state: string;
  verifier: Person | null;
  verification_note: string | null;
  attribution_state: string;
  attributed_employee: Person | null;
  attribution_validator: Person | null;
  attribution_reason: string | null;
  preventive_tasks: TaskBrief[];
  history: { at: string; event: string; note?: string; actor: string }[];
  illustrative: boolean;
}

export function IncidentsTab({ project }: { project: ProjectDetail }) {
  const { data } = useApiQuery<Incident[]>(`/projects/${project.id}/incidents`);
  const [recording, setRecording] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const rows = data ?? [];
  return (
    <>
      <div className="grid grid-4 mb">
        <Stat label="Open incidents" value={rows.filter((i) => i.state !== "Closed").length} hint="Department reporting" />
        <Stat label="Repeat incidents" value={0} hint="Link repeat-of records" />
        <Stat label="Validated attribution" value={rows.filter((i) => i.attribution_state === "validated").length} hint="No individual penalty assumed" />
        <Stat label="Accepted prevention" value={`${rows.flatMap((i) => i.preventive_tasks).filter((t) => t.status === "Completed").length}/${rows.flatMap((i) => i.preventive_tasks).length}`} hint="Independent acceptance" />
      </div>
      <Card title="Investigate causes and prevent repeats" actions={project.can_manage && <Button variant="primary" onClick={() => setRecording(true)}>Record incident</Button>}>
        {rows.length === 0 ? (
          <Empty title="No incidents recorded" />
        ) : (
          <table className="table">
            <thead><tr><th>Incident</th><th>Severity</th><th>Attribution</th><th>State</th><th>Expected closure</th><th /></tr></thead>
            <tbody>
              {rows.map((i) => (
                <tr key={i.id}>
                  <td><b>{i.code} / {i.title}</b><div className="sub">{i.product_system}{i.illustrative ? " / Illustrative example, not a personnel finding" : ""}</div></td>
                  <td>{i.severity_validated ? <Badge status={i.severity_validated === "Major" ? "High" : "Medium"}>{i.severity_validated} (validated)</Badge> : <Badge tone="amber">{i.severity_proposed} / pending validation</Badge>}</td>
                  <td>{i.attribution_state === "validated" ? `Validated: ${i.attributed_employee?.name}` : i.attribution_state === "not_established" ? "Not established" : "Pending"}</td>
                  <td><Badge status={i.state} /></td>
                  <td>{fmtDate(i.expected_closure)}</td>
                  <td><button className="link-btn" onClick={() => setOpenId(i.id)}>Open RCA</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <p className="small muted mt">Proposed severity and department responsibility do not imply individual attribution. Unattributed incidents affect department reports only.</p>
      {recording && <RecordIncidentDrawer project={project} onClose={() => setRecording(false)} />}
      {openId && <RcaDrawer incidentId={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}

function RecordIncidentDrawer({ project, onClose }: { project: ProjectDetail; onClose: () => void }) {
  const depts = useApiQuery<Department[]>("/departments");
  const [form, setForm] = useState({ title: "", product_system: "", incident_date: "", received_date: todayISO(), severity_proposed: "Medium", clients_impacted: "", orders_impacted: "", responsible_department_id: String(project.department_id ?? "") });
  const [reporter, setReporter] = useState<Person | null>(null);
  const [stakeholder, setStakeholder] = useState<Person | null>(null);
  const save = useApiMutation<Record<string, unknown>>("post", `/projects/${project.id}/incidents`);
  return (
    <Drawer
      open
      onClose={onClose}
      wide
      eyebrow="Project > Incidents > Record incident"
      title="Record an incident and initial impact"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() =>
              save.mutate(
                { ...form, clients_impacted: Number(form.clients_impacted) || null, orders_impacted: Number(form.orders_impacted) || null, responsible_department_id: Number(form.responsible_department_id), reporter_id: reporter?.id, stakeholder_id: stakeholder?.id },
                { onSuccess: () => { toast("Incident recorded"); onClose(); } },
              )
            }
          >
            Create incident
          </Button>
        </>
      }
    >
      <FormError error={save.error} />
      <div className="drawer-split">
        <div className="form-grid">
          <Field label="Incident title" required><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
          <Field label="Product / system" required><input className="input" value={form.product_system} onChange={(e) => setForm({ ...form, product_system: e.target.value })} /></Field>
          <Field label="Incident date" required><input type="date" className="input" value={form.incident_date} onChange={(e) => setForm({ ...form, incident_date: e.target.value })} /></Field>
          <Field label="Received date" required error={fieldError(save.error, "received_date")}><input type="date" className="input" value={form.received_date} onChange={(e) => setForm({ ...form, received_date: e.target.value })} /></Field>
          <Field label="Reported by" required><PersonPicker value={reporter} onChange={setReporter} placeholder="Named authorised reporter" /></Field>
          <Field label="Severity / proposed" required>
            <select className="input" value={form.severity_proposed} onChange={(e) => setForm({ ...form, severity_proposed: e.target.value })}><option>Minor</option><option>Medium</option><option>Major</option></select>
          </Field>
          <Field label="Clients impacted"><input type="number" className="input" value={form.clients_impacted} onChange={(e) => setForm({ ...form, clients_impacted: e.target.value })} /></Field>
          <Field label="Orders impacted"><input type="number" className="input" value={form.orders_impacted} onChange={(e) => setForm({ ...form, orders_impacted: e.target.value })} /></Field>
          <Field label="Responsible department" required>
            <select className="input" value={form.responsible_department_id} onChange={(e) => setForm({ ...form, responsible_department_id: e.target.value })}>
              <option value="">Choose</option>
              {(depts.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
          <Field label="Responsible stakeholder" required><PersonPicker value={stakeholder} onChange={setStakeholder} /></Field>
        </div>
        <div className="aside-panel">
          <h4>Incident lifecycle</h4>
          <p>Open &gt; Under analysis &gt; Correction done &gt; Preventive action in progress &gt; Closed; Reopened when needed.</p>
          <h4>Attribution pending</h4>
          <p>A proposed severity or responsible department alone does not deduct an individual KPI score.</p>
          <h4>Next action</h4>
          <p>Complete root-cause analysis and create linked corrective/preventive work.</p>
        </div>
      </div>
    </Drawer>
  );
}

function RcaDrawer({ incidentId, onClose }: { incidentId: number; onClose: () => void }) {
  const { account, isRole } = useAuth();
  const { data: i } = useApiQuery<Incident>(`/incidents/${incidentId}`);
  const [tab, setTab] = useState<"incident" | "root" | "actions" | "attribution" | "closure">("root");
  const [rca, setRca] = useState<Record<string, string>>({});
  const [att, setAtt] = useState({ severity_validated: "Medium", attribution: "not_established", reason: "", evidence: "" });
  const [attributed, setAttributed] = useState<Person | null>(null);
  const [prev, setPrev] = useState({ title: "", due_date: "" });
  const [prevOwner, setPrevOwner] = useState<Person | null>(null);
  const [prevReviewer, setPrevReviewer] = useState<Person | null>(null);
  const [close, setClose] = useState({ actual_closure: todayISO(), verification_note: "" });
  const [reopenReason, setReopenReason] = useState("");
  const patch = useApiMutation<Record<string, unknown>>("patch", `/incidents/${incidentId}`);
  const attribution = useApiMutation<Record<string, unknown>>("post", `/incidents/${incidentId}/attribution`);
  const preventive = useApiMutation<Record<string, unknown>>("post", `/incidents/${incidentId}/preventive-tasks`);
  const verify = useApiMutation<Record<string, unknown>>("post", `/incidents/${incidentId}/close`);
  const reopen = useApiMutation<Record<string, unknown>>("post", `/incidents/${incidentId}/reopen`);
  const err = patch.error ?? attribution.error ?? preventive.error ?? verify.error ?? reopen.error;
  if (!i) return null;
  const v = (k: keyof Incident) => rca[k as string] ?? (i[k] as string | null) ?? "";

  return (
    <Drawer open onClose={onClose} wide eyebrow={`${i.code}${i.illustrative ? " / Illustrative example, not a live personnel record" : ""}`} title="Incident analysis and preventive action">
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "incident", label: "Incident" },
          { id: "root", label: "Root cause" },
          { id: "actions", label: "Actions" },
          { id: "attribution", label: "Attribution" },
          { id: "closure", label: "Closure" },
        ]}
      />
      <FormError error={err} />
      <div className="drawer-split">
        <div className="stack">
          {tab === "incident" && (
            <Kv
              items={[
                ["Title", i.title],
                ["Product / system", i.product_system],
                ["Incident / received", `${fmtDate(i.incident_date)} / ${fmtDate(i.received_date)}`],
                ["Reporter", i.reporter?.name],
                ["Severity", `${i.severity_proposed} proposed${i.severity_validated ? ` / ${i.severity_validated} validated` : ""}`],
                ["Clients / orders", `${i.clients_impacted ?? "—"} clients / ${i.orders_impacted ?? "—"} orders`],
                ["Stakeholder", i.stakeholder ? `${i.stakeholder.name} / ${i.stakeholder.code}` : "—"],
                ["State", <Badge key="s" status={i.state} />],
              ]}
            />
          )}
          {tab === "root" && (
            <div className="form-grid">
              <Field label="Root cause" required className="full"><textarea className="input" value={v("root_cause")} onChange={(e) => setRca({ ...rca, root_cause: e.target.value })} /></Field>
              <Field label="Root-cause category" required>
                <select className="input" value={v("root_cause_category")} onChange={(e) => setRca({ ...rca, root_cause_category: e.target.value })}>
                  <option value="">Choose</option>{["Process", "People", "Technology", "Vendor", "Data", "Communication"].map((c) => <option key={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="Gap identified"><input className="input" value={v("gap")} onChange={(e) => setRca({ ...rca, gap: e.target.value })} /></Field>
              <Field label="Correction action" className="full"><input className="input" value={v("correction_action")} onChange={(e) => setRca({ ...rca, correction_action: e.target.value })} /></Field>
              <Field label="Correction completed"><input type="date" className="input" value={v("correction_date")} onChange={(e) => setRca({ ...rca, correction_date: e.target.value })} /></Field>
              <Field label="Expected closure"><input type="date" className="input" value={v("expected_closure")} onChange={(e) => setRca({ ...rca, expected_closure: e.target.value })} /></Field>
              <Field label="State">
                <select className="input" value={rca.state ?? i.state} onChange={(e) => setRca({ ...rca, state: e.target.value })}>
                  {["Open", "Under analysis", "Correction done", "Preventive action in progress"].map((s) => <option key={s}>{s}</option>)}
                  {["Closed", "Reopened"].includes(i.state) && <option>{i.state}</option>}
                </select>
              </Field>
              <div className="full"><Button variant="primary" onClick={() => patch.mutate(Object.fromEntries(Object.entries(rca).map(([k, val]) => [k, val || null])), { onSuccess: () => { setRca({}); toast("Analysis saved"); } })}>Save analysis</Button></div>
            </div>
          )}
          {tab === "actions" && (
            <>
              <table className="table">
                <thead><tr><th>Preventive task</th><th>Owner</th><th>Due</th><th>State</th></tr></thead>
                <tbody>
                  {i.preventive_tasks.length === 0 && <tr><td colSpan={4} className="muted">No preventive tasks yet.</td></tr>}
                  {i.preventive_tasks.map((t) => <tr key={t.id}><td>{t.title}<div className="sub">{t.code}</div></td><td>{t.owner?.name}</td><td>{fmtDate(t.due_date)}</td><td><Badge status={t.status} /></td></tr>)}
                </tbody>
              </table>
              <div className="form-grid">
                <Field label="Preventive task" required className="full"><input className="input" value={prev.title} onChange={(e) => setPrev({ ...prev, title: e.target.value })} placeholder="Add release acceptance checklist" /></Field>
                <Field label="Preventive owner" required><PersonPicker value={prevOwner} onChange={setPrevOwner} /></Field>
                <Field label="Preventive task due" required><input type="date" className="input" value={prev.due_date} onChange={(e) => setPrev({ ...prev, due_date: e.target.value })} /></Field>
                <Field label="Independent reviewer" required error={fieldError(preventive.error, "reviewer_id")}><PersonPicker value={prevReviewer} onChange={setPrevReviewer} exclude={prevOwner ? [prevOwner.id] : []} /></Field>
                <div className="full"><Button variant="primary" onClick={() => preventive.mutate({ ...prev, owner_id: prevOwner?.id, reviewer_id: prevReviewer?.id }, { onSuccess: () => { setPrev({ title: "", due_date: "" }); toast("Preventive task created"); } })}>Create preventive task</Button></div>
              </div>
            </>
          )}
          {tab === "attribution" && (
            <>
              {!isRole("admin", "hod") && <Callout tone="warn" title="Authorised validator only">Severity and individual attribution are validated by an authorised validator (configurable; proposed Compliance with HOD dispute rights). No self-validation.</Callout>}
              <Kv items={[["Current outcome", i.attribution_state === "validated" ? `Validated: ${i.attributed_employee?.name}` : i.attribution_state === "not_established" ? "Department incident reporting only. No personal Compliance deduction." : "Pending"], ["Validator", i.attribution_validator?.name ?? "—"], ["Reason", i.attribution_reason ?? "—"]]} />
              {isRole("admin", "hod") && (
                <div className="form-grid">
                  <Field label="Validated severity" required>
                    <select className="input" value={att.severity_validated} onChange={(e) => setAtt({ ...att, severity_validated: e.target.value })}><option>Minor</option><option>Medium</option><option>Major</option></select>
                  </Field>
                  <Field label="Individual attribution" required>
                    <select className="input" value={att.attribution} onChange={(e) => setAtt({ ...att, attribution: e.target.value })}><option value="not_established">Not established</option><option value="validated">Validated</option></select>
                  </Field>
                  {att.attribution === "validated" && <Field label="Attributed person" required className="full"><PersonPicker value={attributed} onChange={setAttributed} /></Field>}
                  <Field label="Evidence" required><input className="input" value={att.evidence} onChange={(e) => setAtt({ ...att, evidence: e.target.value })} placeholder="Review findings + incident timeline" /></Field>
                  <Field label="Validation reason" required><input className="input" value={att.reason} onChange={(e) => setAtt({ ...att, reason: e.target.value })} /></Field>
                  <div className="full"><Button variant="primary" onClick={() => attribution.mutate({ ...att, attributed_employee_id: attributed?.id ?? null }, { onSuccess: () => toast("Validation recorded") })}>Record validation</Button></div>
                </div>
              )}
            </>
          )}
          {tab === "closure" && (
            <>
              <Kv items={[["Preventive tasks", `${i.preventive_tasks.filter((t) => t.status === "Completed").length} / ${i.preventive_tasks.length} accepted`], ["Verifier", i.verifier?.name ?? "—"], ["Actual closure", fmtDate(i.actual_closure)], ["Verification", i.verification_note ?? "—"]]} />
              {i.state !== "Closed" ? (
                <div className="form-grid">
                  <Field label="Actual closure" required error={fieldError(verify.error, "actual_closure")}><input type="date" className="input" max={todayISO()} value={close.actual_closure} onChange={(e) => setClose({ ...close, actual_closure: e.target.value })} /></Field>
                  <Field label="Independent verifier"><input className="input" readOnly value={account?.employee.id === i.stakeholder?.id ? "You are the stakeholder; choose another verifier" : `${account?.employee.name} (you)`} /></Field>
                  <Field label="Closure evidence / verification note" required className="full"><textarea className="input" value={close.verification_note} onChange={(e) => setClose({ ...close, verification_note: e.target.value })} placeholder="Accepted preventive task + verification note" /></Field>
                  <div className="full"><Button variant="primary" onClick={() => verify.mutate(close, { onSuccess: () => toast("Incident closure verified") })}>Verify incident closure</Button></div>
                </div>
              ) : (
                <div className="form-grid">
                  <Field label="Reopen reason" required className="full"><input className="input" value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} /></Field>
                  <div className="full"><Button onClick={() => reopen.mutate({ reason: reopenReason }, { onSuccess: () => toast("Incident reopened") })}>Reopen</Button></div>
                </div>
              )}
            </>
          )}
        </div>
        <div className="aside-panel">
          <h4>Closure rule</h4>
          <p>Preventive tasks must be accepted. A verifier other than the responsible stakeholder confirms closure.</p>
          <h4>Individual KPI protection</h4>
          <p>Severity AND individual attribution must be validated before a Compliance deduction (Minor -20, Medium -40, Major -100; floor 0).</p>
          <h4>History</h4>
          {i.history.map((h, k) => <p key={k}><b>{h.event}</b> / {h.actor} / {h.at.replace("T", " ")}{h.note ? ` / ${h.note}` : ""}</p>)}
        </div>
      </div>
    </Drawer>
  );
}
