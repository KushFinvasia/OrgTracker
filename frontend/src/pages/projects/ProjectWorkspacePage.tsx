import { Plus } from "lucide-react";
import { useState } from "react";
import { useParams } from "react-router-dom";

import type { RrBundle, RrResponse } from "@/api/rr";
import type { Person, ProjectDetail, TaskBrief } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { Badge, Button, Callout, Drawer, Empty, ErrorState, Field, Figures, FormError, Loading, PageHeader, Panel, PersonPicker, Segmented, Tabs, Tier, fieldError, toast } from "@/components/ui";
import { CreateTaskDrawer } from "@/components/tasks/CreateTaskDrawer";
import { TaskDrawer } from "@/components/tasks/TaskDrawer";
import { TaskBoard, TaskTimeline, TaskTrackingTable } from "@/components/tasks/TaskTracking";
import { fmtDate, fmtDateTime, fmtPct } from "@/lib/format";
import { useCrumbLabel } from "@/lib/crumb";
import { useApiMutation, useApiQuery, useQueryParam } from "@/lib/hooks";
import { statusLabel } from "@/lib/status";
import { ClosureTab } from "./ClosureTab";
import { IncidentsTab } from "./IncidentsTab";
import { PersonTasksDrawer } from "./PersonTasksDrawer";
import { RisksTab } from "./ProjectRecords";
import { CharterPersonButton, CharterTab, DelaysTab, EnrolPanel, RunsTab, RunsTable, RunsTimeline, ScorecardTab, personTaskLabel } from "./rr/ProjectRr";

type Tab = "overview" | "tasks" | "timeline" | "risks" | "runs" | "charter" | "delays" | "scorecard" | "incidents" | "closure" | "audit";

export function ProjectWorkspacePage() {
  const { id } = useParams();
  const { isRole } = useAuth();
  const [tabParam, setTabParam] = useQueryParam("tab");
  const tab = ((tabParam === "activity" ? "audit" : tabParam) as Tab) || "overview";
  const [taskId, setTaskId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [person, setPerson] = useState<Person | null>(null);
  const project = useApiQuery<ProjectDetail>(`/projects/${id}`);
  const tasks = useApiQuery<TaskBrief[]>(`/projects/${id}/tasks`);
  const rrq = useApiQuery<RrResponse>(`/projects/${id}/rr`);
  useCrumbLabel(project.data?.title);
  if (project.isLoading) return <Loading rows={3} />;
  if (project.error || !project.data) return <ErrorState error={project.error} />;
  const p = project.data;
  const rr: RrBundle | null = rrq.data && rrq.data.enrolled ? rrq.data : null;
  const programme = rr?.charter.mode === "programme";
  const canAdd = p.can_manage && !isRole("team_lead") && !programme;
  const m = p.metrics;
  const ts = tasks.data ?? [];
  const tabs: { id: Tab; label: string; hidden?: boolean }[] = [
    { id: "overview", label: "Overview" },
    { id: "tasks", label: "Tasks" },
    { id: "timeline", label: "Timeline" },
    { id: "risks", label: `Risks${m.open_risks ? ` (${m.open_risks})` : ""}` },
    { id: "runs", label: "Runs", hidden: !programme },
    { id: "charter", label: "Charter", hidden: !rr },
    { id: "delays", label: `Delays${rr?.delays.length ? ` (${rr.delays.length})` : ""}`, hidden: !rr },
    { id: "scorecard", label: "Scorecard", hidden: !rr },
    { id: "incidents", label: "Incidents & RCA" },
    { id: "closure", label: "Closure" },
    { id: "audit", label: "Audit logs" },
  ];

  return (
    <>
      <PageHeader
        title={p.title}
        sub={
          <span className="row">
            {p.code} · {p.department} · {p.priority ? `${p.priority} priority` : <Badge tone="red">Priority missing</Badge>} · {statusLabel(p.status)} · owner {p.owner?.name ?? "unresolved"}
            {p.template && ` · from the ${p.template} template`}
            {p.source === "demo" && <Badge tone="grey">Illustrative demo</Badge>}
            {p.source === "import" && <Badge tone="grey">Imported</Badge>}
          </span>
        }
        actions={
          <>
            {p.can_manage && <Button onClick={() => setEditing(true)}>Edit project</Button>}
            {canAdd && <Button variant="primary" onClick={() => setAdding(true)}><Plus size={15} /> Add task</Button>}
          </>
        }
      />
      {!p.priority && <Callout tone="warn" title="Priority missing.">Imported from the legacy tracker. Choose High, Medium or Low in Edit project; saving anything else is blocked until then.</Callout>}
      {p.activation_blockers.length > 0 && (
        <Callout tone="warn" title={`Activation blocked (${p.activation_blockers.length})`}>
          {p.activation_blockers.slice(0, 4).join(" ")} Resolve named owners and independent reviewers before moving to In progress.
        </Callout>
      )}
      <Tabs value={tab} onChange={(t) => setTabParam(t)} tabs={tabs} />

      {tab === "overview" && <Overview p={p} tasks={ts} rr={rr} canEnrol={!!rrq.data && !rrq.data.enrolled && rrq.data.can_enrol} onOpenTask={setTaskId} onPerson={setPerson} onTab={setTabParam} />}
      {tab === "tasks" && (programme && rr ? (
        <Panel title="Run stages" meta="Each run's stages are tasks with finish-to-start dependencies">
          <RunsTable runs={rr.runs} onOpenTask={setTaskId} stageCols={rr.stages.map((s) => ({ step: s.step, name: s.name }))} />
        </Panel>
      ) : (
        <TasksTab tasks={ts} loading={tasks.isLoading} onOpen={setTaskId} onAdd={canAdd ? () => setAdding(true) : undefined} />
      ))}
      {tab === "timeline" && (programme && rr ? <RunsTimeline rr={rr} /> : <TimelineTab tasks={ts} onOpen={setTaskId} />)}
      {tab === "risks" && <RisksTab project={p} tasks={ts} />}
      {tab === "runs" && rr && <RunsTab rr={rr} onOpenTask={setTaskId} />}
      {tab === "charter" && rr && <CharterTab project={p} rr={rr} tasks={ts} onPerson={setPerson} />}
      {tab === "delays" && rr && <DelaysTab project={p} rr={rr} tasks={ts} onOpenTask={setTaskId} />}
      {tab === "scorecard" && rr && <ScorecardTab project={p} rr={rr} />}
      {tab === "incidents" && <IncidentsTab project={p} />}
      {tab === "closure" && <ClosureTab project={p} />}
      {tab === "audit" && <AuditTab projectId={p.id} />}

      <CreateTaskDrawer open={adding} onClose={() => setAdding(false)} projectId={p.id} />
      <TaskDrawer taskId={taskId} onClose={() => setTaskId(null)} />
      {person && !taskId && <PersonTasksDrawer project={p} tasks={ts} rr={rr} person={person} onClose={() => setPerson(null)} onOpenTask={setTaskId} />}
      {editing && <EditProjectDrawer project={p} onClose={() => setEditing(false)} />}
    </>
  );
}

function Overview({ p, tasks, rr, canEnrol, onOpenTask, onPerson, onTab }: { p: ProjectDetail; tasks: TaskBrief[]; rr: RrBundle | null; canEnrol: boolean; onOpenTask: (id: number) => void; onPerson: (p: Person) => void; onTab: (t: string) => void }) {
  const m = p.metrics;
  const people = p.people.map((x) => x.employee).filter((e) => e.id !== p.owner?.id);
  const next = tasks.filter((t) => !["Completed", "Cancelled"].includes(t.status) && t.due_date).slice(0, 5);
  return (
    <>
      <Figures
        items={[
          { label: "Completed tasks", value: m.tasks_total ? m.tasks_accepted : "—", unit: m.tasks_total ? `of ${m.tasks_total}` : undefined, hint: `${fmtPct(m.accepted_delivery)} by complexity` },
          { label: "Target date", value: fmtDate(p.target_date), hint: `Timing: ${p.status === "Completed" ? "Closed" : m.timing}` },
          { label: "Open risks", value: m.open_risks, hint: `${m.open_high_risks} High / Critical` },
          { label: "Health", value: m.health ? statusLabel(m.health) : statusLabel(p.status), hint: "From approved rules; can't be set by hand" },
          { label: "Reported progress", value: m.reported_progress === null ? "—" : `${m.reported_progress}%`, hint: "Planning only, never acceptance" },
        ]}
      />
      <div className="grid grid-main mt">
        <div className="stack">
          <Panel title="Delivery objective" pad>
            <p>{p.objective ?? <span className="muted">No objective recorded.</span>}</p>
          </Panel>
          <Panel title="Due next" tools={<Button size="sm" onClick={() => onTab("timeline")}>Open timeline</Button>}>
            {next.length ? (
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead><tr><th>Task</th><th>Owner</th><th>Due in force</th><th>Timing</th></tr></thead>
                  <tbody>
                    {next.map((t) => (
                      <tr key={t.id} className="clickable-row" onClick={() => onOpenTask(t.id)}>
                        <td><b>{t.title}</b><span className="sub">{t.code}</span></td>
                        <td>{t.owner?.name ?? "—"}</td>
                        <td>{fmtDate(t.due_date)}</td>
                        <td><Badge status={t.timing}>{t.timing}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty title="Nothing due">Open work with a due date appears here.</Empty>
            )}
          </Panel>
        </div>
        <div className="stack">
          <Panel title="People and responsibility" meta="Select a person to view their assigned work in this project" pad>
            <dl className="rr-kv">
              <dt>Owner</dt>
              <dd>{p.owner ? <CharterPersonButton person={p.owner} label={personTaskLabel(p.owner, tasks, rr)} onOpen={onPerson}><b>{p.owner.name}</b></CharterPersonButton> : "—"}</dd>
              <dt>Project reviewer</dt>
              <dd>{p.reviewer ? <CharterPersonButton person={p.reviewer} label={personTaskLabel(p.reviewer, tasks, rr)} onOpen={onPerson}><b>{p.reviewer.name}</b></CharterPersonButton> : "—"}</dd>
              <dt>Department</dt>
              <dd>{p.department}</dd>
            </dl>
            <div className="stack mt" style={{ gap: 12 }}>
              {people.map((e) => <CharterPersonButton key={e.id} person={e} label={personTaskLabel(e, tasks, rr)} onOpen={onPerson} />)}
            </div>
          </Panel>
          {rr ? (
            <Panel title="Project R&R" pad tools={<Button size="sm" onClick={() => onTab(rr.scorecard.score !== null || rr.scorecard.frozen ? "scorecard" : "charter")}>Open</Button>}>
              <dl className="rr-kv">
                <dt>Charter</dt><dd><Badge status={rr.charter.state}>{rr.charter.state}</Badge></dd>
                <dt>Scoring</dt><dd>{rr.charter.mode === "programme" ? "Quarterly programme" : "At closure"}</dd>
                <dt>Stage</dt><dd><Badge status={rr.stage} /></dd>
                <dt>Project band</dt><dd>{rr.scorecard.band && rr.scorecard.state !== "Provisional" ? <Tier tier={rr.scorecard.band} /> : <span className="muted">Not scored yet</span>}</dd>
              </dl>
            </Panel>
          ) : (
            <EnrolPanel project={p} canEnrol={canEnrol} />
          )}
        </div>
      </div>
    </>
  );
}

function TasksTab({ tasks, loading, onOpen, onAdd }: { tasks: TaskBrief[]; loading: boolean; onOpen: (id: number) => void; onAdd?: () => void }) {
  // Table is the primary view; Board is the second option (?view=board).
  const [viewParam, setView] = useQueryParam("view");
  const view = viewParam === "board" ? "board" : "table";
  if (loading) return <Loading rows={2} />;
  return (
    <>
      <div className="row mb">
        <Segmented label="Task view" value={view} onChange={(v) => setView(v === "table" ? null : v)} options={[{ id: "table", label: "Table" }, { id: "board", label: "Board" }]} />
        <span className="note">{view === "board" ? "Dropping a card into In review can't skip evidence submission or review." : "Select a task to open its details and updates."}</span>
      </div>
      {!tasks.length ? (
        <Panel title="Tasks" pad>
          <Empty title="No tasks yet" action={onAdd && <Button variant="primary" onClick={onAdd}>Add task</Button>}>{onAdd ? "Use Add task to create the first task." : "Tasks appear here once they are added."}</Empty>
        </Panel>
      ) : view === "table" ? (
        <Panel title="Tasks">
          <TaskTrackingTable tasks={tasks} onOpen={onOpen} empty="No tasks yet" />
        </Panel>
      ) : (
        <TaskBoard tasks={tasks} onOpen={onOpen} onAdd={onAdd} />
      )}
    </>
  );
}

function TimelineTab({ tasks, onOpen }: { tasks: TaskBrief[]; onOpen: (id: number) => void }) {
  const [done, setDone] = useQueryParam("done");
  return <TaskTimeline tasks={tasks} onOpen={onOpen} hideDone={done === "hide"} onToggleDone={(v) => setDone(v ? "hide" : null)} />;
}

function AuditTab({ projectId }: { projectId: number }) {
  const { data, isLoading } = useApiQuery<{ id: number; at: string; action: string; label: string | null; actor: Person | null; reason: string | null }[]>(`/projects/${projectId}/activity`);
  if (isLoading) return <Loading />;
  return (
    <Panel title="Audit logs" meta="Append-only: every decision on this project and its tasks, with actor, time and reason. Nobody can edit or delete an entry.">
      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>Event</th><th>Record</th><th>Actor</th><th>Reason</th><th>Time</th></tr></thead>
          <tbody>
            {(data ?? []).length === 0 && <tr><td colSpan={5}><Empty title="No audit events yet" /></td></tr>}
            {(data ?? []).map((e) => (
              <tr key={e.id}>
                <td>{e.action.replace(/_/g, " ")}</td>
                <td>{e.label}</td>
                <td>{e.actor?.name ?? "System"}</td>
                <td className="wrap">{e.reason ?? "—"}</td>
                <td>{fmtDateTime(e.at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
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
            Save project
          </Button>
        </>
      }
    >
      <FormError error={save.error} />
      <div className="form-grid">
        <Field label="Priority" required error={fieldError(save.error, "priority")}>
          <select className="input" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
            <option value="">Choose a priority…</option><option>High</option><option>Medium</option><option>Low</option>
          </select>
        </Field>
        <Field label="Business status" required error={fieldError(save.error, "status")} help="Completed is reached through the closure review. Delayed is derived from dates, never set.">
          <select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            {(project.status === "Completed" ? ["Completed"] : ["Planning", "Not Started", "In Progress", "Blocked", "In Review", "On Hold", "Cancelled"]).map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
          </select>
        </Field>
        <Field label="Target date"><input type="date" className="input" value={form.target_date} onChange={(e) => setForm({ ...form, target_date: e.target.value })} /></Field>
        <Field label="Project reviewer"><PersonPicker value={reviewer} onChange={setReviewer} /></Field>
        <Field label="Objective" className="full"><textarea className="input" value={form.objective} onChange={(e) => setForm({ ...form, objective: e.target.value })} /></Field>
      </div>
      <p className="small muted mt">Health is derived from approved rules and can't be set by hand to hide risk.</p>
    </Drawer>
  );
}
