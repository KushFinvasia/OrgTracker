import { Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import type { Milestone, Person, Project, TaskDetail } from "@/api/types";
import { Button, Drawer, Field, FormError, PersonPicker, fieldError, toast } from "@/components/ui";
import { useApiMutation, useApiQuery, useDraft } from "@/lib/hooks";

interface Row {
  person: Person | null;
  role: "Owner" | "Contributor";
  share: number;
}

interface Draft {
  title: string;
  description: string;
  project_id: number | null;
  milestone_id: number | null;
  complexity: number;
  start_date: string;
  due_date: string;
  reviewer: Person | null;
  rows: Row[];
  checklist: string;
  required_evidence: string;
}

const EMPTY: Draft = {
  title: "",
  description: "",
  project_id: null,
  milestone_id: null,
  complexity: 3,
  start_date: "",
  due_date: "",
  reviewer: null,
  rows: [{ person: null, role: "Owner", share: 100 }],
  checklist: "",
  required_evidence: "",
};

const COMPLEXITY = ["", "1 / Trivial", "2 / Low", "3 / Medium", "4 / High", "5 / Very high"];

/** Add task: contextual drawer with project/milestone prefilled. Exactly one Owner, shares 100%, independent reviewer. */
export function CreateTaskDrawer({ open, onClose, projectId, milestones }: { open: boolean; onClose: () => void; projectId?: number; milestones?: Milestone[] }) {
  const draft = useDraft<Draft>(`task.${projectId ?? "any"}`, { ...EMPTY, project_id: projectId ?? null });
  const d = draft.value;
  const set = (patch: Partial<Draft>) => draft.setValue({ ...d, ...patch });
  const projects = useApiQuery<Project[]>(projectId ? null : "/projects?status=active");
  const project = useApiQuery<{ milestones: Milestone[] }>(d.project_id && !milestones ? `/projects/${d.project_id}` : null);
  const ms = milestones ?? project.data?.milestones ?? [];
  const create = useApiMutation<Record<string, unknown>, TaskDetail>("post", "/tasks");
  const [local, setLocal] = useState<string | null>(null);

  const total = d.rows.reduce((s, r) => s + (Number(r.share) || 0), 0);
  const owners = d.rows.filter((r) => r.role === "Owner").length;
  const assigneeIds = d.rows.map((r) => r.person?.id).filter(Boolean) as number[];
  const reviewerConflict = !!d.reviewer && assigneeIds.includes(d.reviewer.id);
  const checks = useMemo(
    () => [
      { ok: owners === 1, text: "Exactly 1 Owner" },
      { ok: Math.round(total * 100) === 10000, text: `Shares total ${total}% (must be 100%)` },
      { ok: !!d.reviewer && !reviewerConflict, text: "Reviewer is not an assignee" },
    ],
    [owners, total, d.reviewer, reviewerConflict],
  );

  const submit = () => {
    setLocal(null);
    if (d.rows.some((r) => !r.person)) return setLocal("Choose a person for every assignment row.");
    create.mutate(
      {
        project_id: d.project_id,
        milestone_id: d.milestone_id,
        title: d.title,
        description: d.description,
        complexity: d.complexity,
        start_date: d.start_date || null,
        due_date: d.due_date || null,
        reviewer_id: d.reviewer?.id ?? null,
        assignments: d.rows.map((r) => ({ employee_id: r.person!.id, role: r.role, share: Number(r.share) })),
        checklist: d.checklist.split("\n").map((s) => s.trim()).filter(Boolean),
        required_evidence: d.required_evidence || null,
      },
      {
        onSuccess: (t) => {
          toast(`${t.code} created (Not started)`);
          draft.clear();
          draft.setValue({ ...EMPTY, project_id: projectId ?? null });
          onClose();
        },
      },
    );
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      dirty={draft.dirty}
      wide
      eyebrow="Tasks > Add task"
      title="Create a task in context"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={create.isPending}>Create task</Button>
        </>
      }
    >
      <FormError error={create.error} />
      {local && <div className="form-error">{local}</div>}
      <div className="drawer-split">
        <div className="form-grid">
          <Field label="Task title" required className="full" error={fieldError(create.error, "title")}>
            <input className="input" value={d.title} onChange={(e) => set({ title: e.target.value })} placeholder="Review onboarding screens" />
          </Field>
          <Field label="Project" required error={fieldError(create.error, "project_id")}>
            {projectId ? (
              <input className="input" readOnly value="Preselected from the project workspace" />
            ) : (
              <select className="input" value={d.project_id ?? ""} onChange={(e) => set({ project_id: Number(e.target.value) || null, milestone_id: null })}>
                <option value="">Choose a project</option>
                {(projects.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>{p.title} / {p.code}</option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Milestone">
            <select className="input" value={d.milestone_id ?? ""} onChange={(e) => set({ milestone_id: Number(e.target.value) || null })}>
              <option value="">No milestone</option>
              {ms.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
            </select>
          </Field>
          <Field label="Description" required className="full" error={fieldError(create.error, "description")}>
            <textarea className="input" value={d.description} onChange={(e) => set({ description: e.target.value })} />
          </Field>
          <Field label="Start date">
            <input type="date" className="input" value={d.start_date} onChange={(e) => set({ start_date: e.target.value })} />
          </Field>
          <Field label="Due date" error={fieldError(create.error, "due_date")} help={!d.due_date ? "No deadline: not eligible for On-time" : undefined}>
            <input type="date" className="input" value={d.due_date} onChange={(e) => set({ due_date: e.target.value })} />
          </Field>
          <Field label="Complexity / 1-5" required>
            <select className="input" value={d.complexity} onChange={(e) => set({ complexity: Number(e.target.value) })}>
              {[1, 2, 3, 4, 5].map((c) => <option key={c} value={c}>{COMPLEXITY[c]}</option>)}
            </select>
          </Field>
          <Field label="Reviewer" required error={fieldError(create.error, "reviewer_id") ?? (reviewerConflict ? "The reviewer is an assignee. Choose another person." : null)} help="Reviewer cannot be the Owner or any Contributor.">
            <PersonPicker value={d.reviewer} onChange={(p) => set({ reviewer: p })} exclude={assigneeIds} />
          </Field>
          <Field label="Acceptance checklist (one per line)" className="full">
            <textarea className="input" value={d.checklist} onChange={(e) => set({ checklist: e.target.value })} placeholder={"Matches the agreed brief\nResponsive states included"} />
          </Field>
          <Field label="Required evidence" className="full">
            <input className="input" value={d.required_evidence} onChange={(e) => set({ required_evidence: e.target.value })} placeholder="Design file + checklist" />
          </Field>
        </div>
        <div className="aside-panel">
          <h4>Assignments / Total {total}%</h4>
          {d.rows.map((r, i) => (
            <div key={i} className="stack" style={{ gap: 8, borderBottom: "1px solid var(--border)", paddingBottom: 12 }}>
              <PersonPicker value={r.person} onChange={(p) => set({ rows: d.rows.map((x, j) => (j === i ? { ...x, person: p } : x)) })} exclude={assigneeIds.filter((id) => id !== r.person?.id)} />
              <div className="row" style={{ flexWrap: "nowrap" }}>
                <select className="input" value={r.role} onChange={(e) => set({ rows: d.rows.map((x, j) => (j === i ? { ...x, role: e.target.value as Row["role"] } : x)) })}>
                  <option>Owner</option>
                  <option>Contributor</option>
                </select>
                <input aria-label="Contribution share %" type="number" min={1} max={100} className="input" style={{ width: 100 }} value={r.share} onChange={(e) => set({ rows: d.rows.map((x, j) => (j === i ? { ...x, share: Number(e.target.value) } : x)) })} />
                <span>%</span>
                {d.rows.length > 1 && (
                  <button className="icon-btn" aria-label="Remove assignment" onClick={() => set({ rows: d.rows.filter((_, j) => j !== i) })}>
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            </div>
          ))}
          <Button size="sm" onClick={() => set({ rows: [...d.rows, { person: null, role: "Contributor", share: 0 }] })}>
            <Plus size={14} /> Add contributor
          </Button>
          {checks.map((c) => (
            <span key={c.text} className={`badge ${c.ok ? "tone-green" : "tone-red"}`}>{c.ok ? "✓" : "!"} {c.text}</span>
          ))}
          <p>Initial state: Not started. In review and Completed require workflow actions.</p>
          <p>Accepted weighted output = complexity x contribution fraction.</p>
        </div>
      </div>
    </Drawer>
  );
}
