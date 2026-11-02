import { useState } from "react";

import type { Person, ProjectDetail, TaskBrief } from "@/api/types";
import { Badge, Button, Card, Drawer, Empty, Field, FormError, PersonPicker, fieldError, toast } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { useApiMutation, useApiQuery } from "@/lib/hooks";

interface Risk {
  id: number;
  code: string;
  stage: string | null;
  risk: string;
  criticality: string;
  dependencies: string | null;
  assumptions: string | null;
  mitigation: string | null;
  owner: Person | null;
  state: string;
  next_review: string | null;
  linked_task_id: number | null;
}

export function RisksTab({ project, tasks }: { project: ProjectDetail; tasks: TaskBrief[] }) {
  const { data } = useApiQuery<Risk[]>(`/projects/${project.id}/risks`);
  const [editing, setEditing] = useState<Risk | "new" | null>(null);
  const [filter, setFilter] = useState("open");
  const rows = (data ?? []).filter((r) => (filter === "open" ? r.state !== "Closed" : true));
  return (
    <>
      <div className="row between mb">
        <div className="seg">
          <button className={filter === "open" ? "active" : ""} onClick={() => setFilter("open")}>Open and mitigating</button>
          <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>All</button>
        </div>
        {project.can_manage && <Button variant="primary" onClick={() => setEditing("new")}>Record risk</Button>}
      </div>
      <Card>
        {rows.length === 0 ? (
          <Empty title="No risks match">Template risks are added automatically when a project starts from a template.</Empty>
        ) : (
          <table className="table">
            <thead><tr><th>Risk</th><th>Stage</th><th>Criticality</th><th>Owner</th><th>Mitigation</th><th>Next review</th><th>State</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><b>{r.risk}</b><div className="sub">{r.code}</div></td>
                  <td>{r.stage}</td>
                  <td><Badge status={r.criticality} /></td>
                  <td>{r.owner?.name ?? "—"}</td>
                  <td>{r.mitigation}</td>
                  <td>{fmtDate(r.next_review)}</td>
                  <td><Badge status={r.state} /></td>
                  <td>{project.can_manage && <button className="link-btn" onClick={() => setEditing(r)}>Edit</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <p className="small muted mt">Open High and Critical risks appear in project health and manager delivery reports. History preserves prior values.</p>
      {editing && <RiskDrawer project={project} tasks={tasks} risk={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function RiskDrawer({ project, tasks, risk, onClose }: { project: ProjectDetail; tasks: TaskBrief[]; risk: Risk | null; onClose: () => void }) {
  const [form, setForm] = useState({
    risk: risk?.risk ?? "",
    stage: risk?.stage ?? "",
    criticality: risk?.criticality ?? "Medium",
    next_review: risk?.next_review ?? "",
    state: risk?.state ?? "Open",
    dependencies: risk?.dependencies ?? "",
    assumptions: risk?.assumptions ?? "",
    mitigation: risk?.mitigation ?? "",
    linked_task_id: risk?.linked_task_id ?? null,
  });
  const [owner, setOwner] = useState<Person | null>(risk?.owner ?? project.owner);
  const save = useApiMutation<Record<string, unknown>>(risk ? "patch" : "post", risk ? `/projects/${project.id}/risks/${risk.id}` : `/projects/${project.id}/risks`);
  return (
    <Drawer
      open
      onClose={onClose}
      eyebrow={`${project.code} / Risks`}
      title={risk ? "Update risk" : "Record and mitigate a project risk"}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => save.mutate({ ...form, owner_id: owner?.id, next_review: form.next_review || null }, { onSuccess: () => { toast("Risk saved"); onClose(); } })}>Save risk</Button>
        </>
      }
    >
      <FormError error={save.error} />
      <div className="form-grid">
        <Field label="Risk" required className="full"><input className="input" value={form.risk} onChange={(e) => setForm({ ...form, risk: e.target.value })} /></Field>
        <Field label="Stage" required><input className="input" value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value })} /></Field>
        <Field label="Criticality" required error={fieldError(save.error, "criticality")}>
          <select className="input" value={form.criticality} onChange={(e) => setForm({ ...form, criticality: e.target.value })}>{["Low", "Medium", "High", "Critical"].map((c) => <option key={c}>{c}</option>)}</select>
        </Field>
        <Field label="Owner" required><PersonPicker value={owner} onChange={setOwner} /></Field>
        <Field label="Next review date" required><input type="date" className="input" value={form.next_review} onChange={(e) => setForm({ ...form, next_review: e.target.value })} /></Field>
        <Field label="Status" required>
          <select className="input" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })}>{["Open", "Mitigating", "Closed"].map((c) => <option key={c}>{c}</option>)}</select>
        </Field>
        <Field label="Linked action task">
          <select className="input" value={form.linked_task_id ?? ""} onChange={(e) => setForm({ ...form, linked_task_id: Number(e.target.value) || null })}>
            <option value="">None</option>
            {tasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
          </select>
        </Field>
        <Field label="Dependency" className="full"><input className="input" value={form.dependencies} onChange={(e) => setForm({ ...form, dependencies: e.target.value })} /></Field>
        <Field label="Assumption" className="full"><input className="input" value={form.assumptions} onChange={(e) => setForm({ ...form, assumptions: e.target.value })} /></Field>
        <Field label="Mitigation" required className="full"><textarea className="input" value={form.mitigation} onChange={(e) => setForm({ ...form, mitigation: e.target.value })} /></Field>
      </div>
    </Drawer>
  );
}
