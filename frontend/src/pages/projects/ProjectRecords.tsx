import { useState } from "react";

import type { Milestone, Person, ProjectDetail, TaskBrief } from "@/api/types";
import { Badge, Button, Card, Drawer, Empty, Field, FormError, PersonPicker, fieldError, toast } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { useApiMutation, useApiQuery } from "@/lib/hooks";

export function MilestonesTab({ project, tasks }: { project: ProjectDetail; tasks: TaskBrief[] }) {
  const [editing, setEditing] = useState<Milestone | "new" | null>(null);
  return (
    <>
      <div className="row between mb">
        <span className="muted">Milestones appear on the timeline and Overview. Completing a milestone never accepts its tasks.</span>
        {project.can_manage && <Button variant="primary" onClick={() => setEditing("new")}>Add milestone</Button>}
      </div>
      <Card>
        {project.milestones.length === 0 ? (
          <Empty title="No milestones">Milestones are optional acceptance-based checkpoints.</Empty>
        ) : (
          <table className="table">
            <thead><tr><th>Milestone</th><th>Owner</th><th>Target</th><th>Linked tasks</th><th>Acceptance criterion</th><th>State</th><th /></tr></thead>
            <tbody>
              {project.milestones.map((m) => (
                <tr key={m.id}>
                  <td><b>{m.title}</b><div className="sub">{m.dependency}</div></td>
                  <td>{m.owner?.name}</td>
                  <td>{fmtDate(m.target_date)}</td>
                  <td className="num">{m.accepted_tasks} / {m.linked_tasks} accepted</td>
                  <td>{m.acceptance_criterion}</td>
                  <td><Badge status={m.state} /></td>
                  <td>{project.can_manage && <button className="link-btn" onClick={() => setEditing(m)}>Edit</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {editing && <MilestoneDrawer project={project} tasks={tasks} milestone={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function MilestoneDrawer({ project, tasks, milestone, onClose }: { project: ProjectDetail; tasks: TaskBrief[]; milestone: Milestone | null; onClose: () => void }) {
  const [form, setForm] = useState({
    title: milestone?.title ?? "",
    target_date: milestone?.target_date ?? "",
    acceptance_criterion: milestone?.acceptance_criterion ?? "",
    evidence: milestone?.evidence ?? "",
    state: milestone?.state ?? "Planned",
    dependency: milestone?.dependency ?? "",
  });
  const [owner, setOwner] = useState<Person | null>(milestone?.owner ?? project.owner);
  const [taskIds, setTaskIds] = useState<number[]>(tasks.filter((t) => t.milestone_id === milestone?.id && milestone).map((t) => t.id));
  const save = useApiMutation<Record<string, unknown>>(milestone ? "patch" : "post", milestone ? `/projects/${project.id}/milestones/${milestone.id}` : `/projects/${project.id}/milestones`);
  return (
    <Drawer
      open
      onClose={onClose}
      eyebrow={`${project.code} / Milestones`}
      title={milestone ? "Update milestone" : "Add a delivery milestone"}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => save.mutate({ ...form, owner_id: owner?.id, task_ids: taskIds }, { onSuccess: () => { toast("Milestone saved"); onClose(); } })}>Save milestone</Button>
        </>
      }
    >
      <FormError error={save.error} />
      <div className="form-grid">
        <Field label="Milestone title" required className="full"><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
        <Field label="Owner" required><PersonPicker value={owner} onChange={setOwner} /></Field>
        <Field label="Target date" required><input type="date" className="input" value={form.target_date} onChange={(e) => setForm({ ...form, target_date: e.target.value })} /></Field>
        <Field label="Acceptance criterion" required className="full"><input className="input" value={form.acceptance_criterion} onChange={(e) => setForm({ ...form, acceptance_criterion: e.target.value })} placeholder="All linked outputs accepted" /></Field>
        <Field label="Evidence"><input className="input" value={form.evidence} onChange={(e) => setForm({ ...form, evidence: e.target.value })} /></Field>
        <Field label="State" required>
          <select className="input" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })}><option>Planned</option><option>In progress</option><option>Completed</option></select>
        </Field>
        <Field label="Dependency" className="full"><input className="input" value={form.dependency} onChange={(e) => setForm({ ...form, dependency: e.target.value })} placeholder="Previous milestone complete" /></Field>
        <Field label="Linked tasks" className="full">
          <div className="stack" style={{ gap: 6, maxHeight: 200, overflowY: "auto" }}>
            {tasks.map((t) => (
              <label key={t.id} className="check"><input type="checkbox" checked={taskIds.includes(t.id)} onChange={(e) => setTaskIds(e.target.checked ? [...taskIds, t.id] : taskIds.filter((x) => x !== t.id))} /> {t.title} <span className="muted">{t.code}</span></label>
            ))}
          </div>
        </Field>
      </div>
      <p className="small muted mt">No automatic task acceptance: completing a milestone does not mark linked tasks Completed.</p>
    </Drawer>
  );
}

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
