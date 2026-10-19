import { Flag } from "lucide-react";
import { useState } from "react";
import { useParams } from "react-router-dom";

import type { Person, ProjectDetail, TaskBrief } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { Avatar, Badge, Button, Callout, Card, Drawer, Empty, ErrorState, Field, FormError, Loading, PageHeader, PersonChip, PersonPicker, Stat, Tabs, fieldError, toast } from "@/components/ui";
import { CreateTaskDrawer } from "@/components/tasks/CreateTaskDrawer";
import { TaskDrawer } from "@/components/tasks/TaskDrawer";
import { fmtDate, fmtDateTime, fmtPct } from "@/lib/format";
import { useApiMutation, useApiQuery, useQueryParam } from "@/lib/hooks";
import { statusLabel } from "@/lib/status";
import { ClosureTab } from "./ClosureTab";
import { IncidentsTab } from "./IncidentsTab";
import { MilestonesTab, RisksTab } from "./ProjectRecords";
import { useCrumbLabel } from "@/lib/crumb";

type Tab = "overview" | "tasks" | "timeline" | "milestones" | "risks" | "incidents" | "closure" | "activity";
const COLUMNS = [
  { id: "Not Started", label: "Not started" },
  { id: "In Progress", label: "In progress" },
  { id: "In Review", label: "In review" },
  { id: "Completed", label: "Completed" },
];

export function ProjectWorkspacePage() {
  const { id } = useParams();
  const { isRole } = useAuth();
  const [tabParam, setTabParam] = useQueryParam("tab");
  const tab = (tabParam as Tab) || "overview";
  const [taskId, setTaskId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const project = useApiQuery<ProjectDetail>(`/projects/${id}`);
  const tasks = useApiQuery<TaskBrief[]>(`/projects/${id}/tasks`);
  useCrumbLabel(project.data?.title);
  if (project.isLoading) return <Loading rows={3} />;
  if (project.error || !project.data) return <ErrorState error={project.error} />;
  const p = project.data;
  const canAdd = p.can_manage && !isRole("team_lead");
  const m = p.metrics;

  return (
    <>
      <PageHeader
        title={p.title}
        sub={
          <span className="row">
            {p.code} / {p.department} / Owner: {p.owner?.name ?? "Unresolved"} / {p.priority ? `${p.priority} priority` : <Badge tone="red">Priority missing</Badge>}
            {p.source === "demo" && <Badge tone="grey">Illustrative demo</Badge>}
            {p.source === "import" && <Badge tone="grey">Imported</Badge>}
          </span>
        }
        actions={
          <>
            {p.can_manage && <Button onClick={() => setEditing(true)}>Update project</Button>}
            {canAdd && <Button variant="primary" onClick={() => setAdding(true)}>Add task</Button>}
          </>
        }
      />
      {p.activation_blockers.length > 0 && (
        <Callout tone="warn" title={`Activation blocked (${p.activation_blockers.length})`}>
          {p.activation_blockers.slice(0, 4).join(" ")} Resolve named owners and independent reviewers before moving to In progress.
        </Callout>
      )}
      <Tabs
        value={tab}
        onChange={(t) => setTabParam(t)}
        tabs={[
          { id: "overview", label: "Overview" },
          { id: "tasks", label: "Tasks" },
          { id: "timeline", label: "Timeline" },
          { id: "milestones", label: "Milestones" },
          { id: "risks", label: `Risks${m.open_risks ? ` (${m.open_risks})` : ""}` },
          { id: "incidents", label: "Incidents & RCA" },
          { id: "closure", label: "Closure" },
          { id: "activity", label: "Activity" },
        ]}
      />
      {tab === "overview" && (
        <div className="stack">
          <div className="grid grid-4">
            <Stat label="Accepted work" value={`${m.tasks_accepted} of ${m.tasks_total}`} hint={`Accepted delivery ${fmtPct(m.accepted_delivery)}`} />
            <Stat label="Due date" value={fmtDate(p.target_date, false)} hint={`Timing: ${m.timing}`} />
            <Stat label="Open risks" value={m.open_risks} hint={`${m.open_high_risks} High / Critical`} />
            <Stat label="Health" value={m.health ? m.health.replace("Track", "track").replace("Risk", "risk") : statusLabel(p.status)} hint={m.health_note} />
          </div>
          <div className="grid grid-main">
            <Card title="Delivery objective">
              <p>{p.objective ?? <span className="muted">No objective recorded.</span>}</p>
              <h4 className="mt mb">Next delivery steps</h4>
              <table className="table">
                <thead><tr><th>Milestone / work</th><th>Owner</th><th>Due</th><th>State</th><th /></tr></thead>
                <tbody>
                  {(tasks.data ?? []).filter((t) => t.status !== "Completed").slice(0, 6).map((t) => (
                    <tr key={t.id}>
                      <td><b>{t.title}</b><div className="sub">{t.code}</div></td>
                      <td>{t.owner?.name ?? "—"}</td>
                      <td>{fmtDate(t.due_date, false)}</td>
                      <td><Badge status={t.status} /></td>
                      <td><button className="link-btn" onClick={() => setTaskId(t.id)}>Open task</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
            <Card title="People and responsibility">
              <div className="stack" style={{ gap: 14 }}>
                {p.owner && <PersonChip person={p.owner} meta={`${p.owner.code} / Project owner`} />}
                {p.people.map((x) => <PersonChip key={x.employee.id} person={x.employee} meta={`${x.employee.code} / ${x.roles.join(", ")}`} />)}
              </div>
              <p className="small muted mt">Project health is distinct from individual employee performance.</p>
            </Card>
          </div>
        </div>
      )}
      {tab === "tasks" && <BoardTab tasks={tasks.data ?? []} loading={tasks.isLoading} onOpen={setTaskId} onAdd={canAdd ? () => setAdding(true) : undefined} project={p} />}
      {tab === "timeline" && <TimelineTab tasks={tasks.data ?? []} project={p} onOpen={setTaskId} />}
      {tab === "milestones" && <MilestonesTab project={p} tasks={tasks.data ?? []} />}
      {tab === "risks" && <RisksTab project={p} tasks={tasks.data ?? []} />}
      {tab === "incidents" && <IncidentsTab project={p} />}
      {tab === "closure" && <ClosureTab project={p} />}
      {tab === "activity" && <ActivityTab projectId={p.id} />}
      <CreateTaskDrawer open={adding} onClose={() => setAdding(false)} projectId={p.id} milestones={p.milestones} />
      <TaskDrawer taskId={taskId} onClose={() => setTaskId(null)} />
      {editing && <EditProjectDrawer project={p} onClose={() => setEditing(false)} />}
    </>
  );
}

function BoardTab({ tasks, loading, onOpen, onAdd, project }: { tasks: TaskBrief[]; loading: boolean; onOpen: (id: number) => void; onAdd?: () => void; project: ProjectDetail }) {
  const [view, setView] = useState<"board" | "table">("board");
  if (loading) return <Loading rows={2} />;
  const other = tasks.filter((t) => !COLUMNS.some((c) => c.id === t.status));
  return (
    <>
      <div className="row between mb">
        <div className="row">
          {project.priority && <Badge status={project.priority}>{project.priority} priority</Badge>}
          <Badge status={project.status} />
          {project.metrics.health && project.metrics.health !== "On Track" && <Badge status={project.metrics.health} />}
          <span className="muted">Target {fmtDate(project.target_date)}</span>
        </div>
        <div className="row">
          <div className="seg">
            <button className={view === "board" ? "active" : ""} onClick={() => setView("board")}>Board</button>
            <button className={view === "table" ? "active" : ""} onClick={() => setView("table")}>Table</button>
          </div>
          {onAdd && <Button variant="primary" onClick={onAdd}>Add task</Button>}
        </div>
      </div>
      {view === "board" ? (
        <>
          <div className="board">
            {COLUMNS.map((c) => {
              const items = tasks.filter((t) => t.status === c.id);
              return (
                <div className="column" key={c.id}>
                  <div className="column-head"><span>{c.label}</span><span className="muted">{items.length}</span></div>
                  {items.map((t) => <TaskCard key={t.id} t={t} onOpen={onOpen} />)}
                  {onAdd && c.id === "Not Started" && <button className="add-task" onClick={onAdd}>+ Add task</button>}
                  {c.id !== "Not Started" && <p className="small muted">{c.id === "Completed" ? "Only a reviewer's Accept moves work here." : c.id === "In Review" ? "Reached by Send for review with evidence." : ""}</p>}
                </div>
              );
            })}
          </div>
          {other.length > 0 && (
            <Card className="mt" title="Blocked, rework and on hold">
              <div className="grid grid-4">{other.map((t) => <TaskCard key={t.id} t={t} onOpen={onOpen} />)}</div>
            </Card>
          )}
          {project.milestones.length > 0 && (
            <Card className="mt" title="Milestone path">
              <div className="milestone-path">
                {project.milestones.map((m) => (
                  <div className="ms" key={m.id}>
                    <i className={m.state === "Completed" || m.state === "In progress" ? "done" : ""} />
                    <div className="muted small">{fmtDate(m.target_date, false)}</div>
                    <b>{m.title}</b>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      ) : (
        <Card>
          <table className="table">
            <thead><tr><th>Task</th><th>Owner</th><th>Status</th><th>Progress</th><th>Due in force</th><th>Timing</th><th>Reviewer</th></tr></thead>
            <tbody>
              {tasks.length === 0 && <tr><td colSpan={7}><Empty title="No tasks yet">Use Add task to create the first task.</Empty></td></tr>}
              {tasks.map((t) => (
                <tr key={t.id} className="clickable" onClick={() => onOpen(t.id)}>
                  <td><b>{t.title}</b><div className="sub">{t.code}{t.data_flags ? " / source data to confirm" : ""}</div></td>
                  <td>{t.owner?.name ?? <span className="muted">No owner</span>}</td>
                  <td><Badge status={t.status} /></td>
                  <td className="num">{t.progress}%</td>
                  <td>{fmtDate(t.due_date)}</td>
                  <td><Badge status={t.timing}>{t.timing}</Badge></td>
                  <td>{t.reviewer?.name ?? <span className="muted">None</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}

function TaskCard({ t, onOpen }: { t: TaskBrief; onOpen: (id: number) => void }) {
  return (
    <button className="task-card" onClick={() => onOpen(t.id)}>
      <div className="row between">
        <Badge tone="grey">{t.category ?? statusLabel(t.status)}</Badge>
        {(t.pending_blockers > 0 || t.status === "Blocked") && <Flag size={16} color="var(--red-fg)" aria-label="Blocked" />}
      </div>
      <h4>{t.title}</h4>
      <div className="row between small muted">
        <span className="row"><Avatar person={t.owner} /> {t.owner?.name.split(" ")[0] ?? "No owner"}</span>
        <span>{fmtDate(t.due_date, false)}</span>
      </div>
    </button>
  );
}

function TimelineTab({ tasks, project, onOpen }: { tasks: TaskBrief[]; project: ProjectDetail; onOpen: (id: number) => void }) {
  const dated = tasks.filter((t) => t.start_date || t.due_date);
  if (!dated.length) return <Card><Empty title="No dated tasks">Add start and due dates to place work on the timeline.</Empty></Card>;
  const times = dated.flatMap((t) => [t.start_date, t.due_date].filter(Boolean).map((d) => new Date(d!).getTime()));
  project.milestones.forEach((m) => m.target_date && times.push(new Date(m.target_date).getTime()));
  const min = Math.min(...times);
  const max = Math.max(...times);
  const span = Math.max(max - min, 86400000);
  const pos = (d: string) => ((new Date(d).getTime() - min) / span) * 100;
  return (
    <Card title="Plan handoffs across the timeline" sub={`${fmtDate(new Date(min))} to ${fmtDate(new Date(max))} / business days / finish-to-start dependencies`}>
      <div className="gantt">
        {dated.map((t) => {
          const s = pos(t.start_date ?? t.due_date!);
          const e = pos(t.due_date ?? t.start_date!);
          return (
            <div className="gantt-row" key={t.id}>
              <button className="link-btn" style={{ color: "var(--ink)" }} onClick={() => onOpen(t.id)}>
                {t.title}
                <div className="small muted">{t.owner?.name ?? "No owner"} / {statusLabel(t.status)}</div>
              </button>
              <div style={{ position: "relative", height: 46 }}>
                <div className={`gantt-bar ${t.status === "Completed" ? "" : t.status === "Blocked" ? "amber" : "grey"}`} style={{ left: `${s}%`, width: `${Math.max(e - s, 1.2)}%` }} title={`${fmtDate(t.start_date)} - ${fmtDate(t.due_date)}`} />
              </div>
            </div>
          );
        })}
        {project.milestones.map((m) =>
          m.target_date ? (
            <div className="gantt-row" key={`m${m.id}`}>
              <b>◆ {m.title}</b>
              <div style={{ position: "relative", height: 46 }}>
                <div style={{ position: "absolute", left: `${pos(m.target_date)}%`, top: 14, width: 14, height: 14, background: "var(--gold)", transform: "rotate(45deg)" }} title={fmtDate(m.target_date)} />
              </div>
            </div>
          ) : null,
        )}
      </div>
      <p className="small muted mt">Changing a scored task deadline opens a reason and validation drawer (task &gt; Dependencies).</p>
    </Card>
  );
}

function ActivityTab({ projectId }: { projectId: number }) {
  const { data, isLoading } = useApiQuery<{ id: number; at: string; action: string; label: string | null; actor: Person | null; reason: string | null }[]>(`/projects/${projectId}/activity`);
  if (isLoading) return <Loading />;
  return (
    <Card title="Activity" sub="Append-only audit events for this project and its tasks">
      <table className="table">
        <thead><tr><th>Event</th><th>Record</th><th>Actor</th><th>Reason</th><th>Time</th></tr></thead>
        <tbody>
          {(data ?? []).length === 0 && <tr><td colSpan={5} className="muted">No recorded activity yet.</td></tr>}
          {(data ?? []).map((e) => (
            <tr key={e.id}><td>{e.action.replace(/_/g, " ")}</td><td>{e.label}</td><td>{e.actor?.name ?? "System"}</td><td>{e.reason ?? "—"}</td><td>{fmtDateTime(e.at)}</td></tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function EditProjectDrawer({ project, onClose }: { project: ProjectDetail; onClose: () => void }) {
  const [form, setForm] = useState({ priority: project.priority ?? "", status: project.status, target_date: project.target_date ?? "", objective: project.objective ?? "" });
  const [reviewer, setReviewer] = useState<Person | null>(project.reviewer);
  const save = useApiMutation<Record<string, unknown>>("patch", `/projects/${project.id}`);
  return (
    <Drawer
      open
      onClose={onClose}
      eyebrow={project.code}
      title="Update project"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => {
              const body: Record<string, unknown> = { version: project.version, objective: form.objective, target_date: form.target_date || null, reviewer_id: reviewer?.id ?? null };
              if (form.priority) body.priority = form.priority;
              if (form.status !== project.status) body.status = form.status;
              save.mutate(body, { onSuccess: () => { toast("Project updated"); onClose(); } });
            }}
          >
            Save updates
          </Button>
        </>
      }
    >
      <FormError error={save.error} />
      <div className="form-grid">
        <Field label="Priority" required error={fieldError(save.error, "priority")}>
          <select className="input" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
            <option value="">Choose High / Medium / Low</option><option>High</option><option>Medium</option><option>Low</option>
          </select>
        </Field>
        <Field label="Business status" required error={fieldError(save.error, "status")} help="Completed is reached through the closure review. Delayed is derived from dates, never a status.">
          <select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            {["Planning", "Not Started", "In Progress", "Blocked", "In Review", "On Hold", "Cancelled", ...(project.status === "Completed" ? ["Completed"] : [])].map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
          </select>
        </Field>
        <Field label="Target date"><input type="date" className="input" value={form.target_date} onChange={(e) => setForm({ ...form, target_date: e.target.value })} /></Field>
        <Field label="Project reviewer"><PersonPicker value={reviewer} onChange={setReviewer} /></Field>
        <Field label="Objective" className="full"><textarea className="input" value={form.objective} onChange={(e) => setForm({ ...form, objective: e.target.value })} /></Field>
      </div>
      <p className="small muted mt">Health is derived from approved rules and cannot be set manually to hide risk.</p>
    </Drawer>
  );
}
