import type { RrBundle } from "@/api/rr";
import type { Person, ProjectDetail, TaskBrief } from "@/api/types";
import { Badge, Button, Drawer, Figures, Panel } from "@/components/ui";
import { TaskTrackingTable } from "@/components/tasks/TaskTracking";
import { TASK_DATE_NOTE, isBlocked } from "@/lib/tasks";

/**
 * A person's work in one project, opened from the project's People section or their Charter RACI row.
 * The Accountable (A) person or the Champion also sees every Responsible (R) person's tasks, grouped by person.
 * Display only: the tasks come from the viewer's scoped project task list; no R&R calculation or scope rule changes.
 */
export function PersonTasksDrawer({ project, tasks, rr, person, onClose, onOpenTask }: { project: ProjectDetail; tasks: TaskBrief[]; rr: RrBundle | null; person: Person; onClose: () => void; onOpenTask: (id: number) => void }) {
  const has = (t: TaskBrief, id: number) => t.assignments.some((a) => a.employee.id === id);
  const own = tasks.filter((t) => has(t, person.id));
  const isA = !!rr && rr.raci.some((r) => r.letter === "A" && r.person?.id === person.id);
  const isChampion = !!rr && rr.charter.champion?.id === person.id;
  const responsible: Person[] = !rr
    ? []
    : rr.charter.mode === "programme"
      ? (rr.programme_raci?.rows ?? []).filter((r) => r.letter === "R" && r.person).map((r) => r.person!)
      : rr.raci.filter((r) => r.letter === "R" && r.person).map((r) => r.person!);
  const team = isA || isChampion ? responsible.filter((p) => p.id !== person.id) : [];
  const stages = rr?.charter.mode === "programme" ? rr.stages.filter((s) => s.responsible?.id === person.id) : [];

  if (team.length) {
    const role = [isA ? "Accountable (A)" : "", isChampion ? "Champion" : ""].filter(Boolean).join(" · ");
    const groups = team.map((p) => [p, tasks.filter((t) => has(t, p.id))] as const);
    const all = [...new Map([...own, ...groups.flatMap(([, list]) => list)].map((t) => [t.id, t])).values()];
    const live = all.filter((t) => t.status !== "Cancelled");
    const active = live.filter((t) => t.status !== "Completed");
    const denom = live.reduce((n, t) => n + t.complexity, 0);
    const progress = denom ? Math.round(live.reduce((n, t) => n + (t.status === "Completed" ? 100 : t.progress) * t.complexity, 0) / denom) : null;
    const teamTasks = new Set(groups.flatMap(([, list]) => list.map((t) => t.id)));
    return (
      <Drawer open onClose={onClose} width={1240} wide eyebrow={`${project.code} · ${project.title}`} title={`${person.name} — own and Responsible people's work`} sub={`${person.code} · ${person.designation ?? ""} · ${person.department ?? ""} · ${role}`} footer={<Button onClick={onClose}>Back to project</Button>}>
        <Figures
          items={[
            { label: "Own tasks", value: own.length, hint: "Assigned to them" },
            { label: "Responsible people's tasks", value: teamTasks.size, hint: `${team.length} Responsible ${team.length === 1 ? "person" : "people"}` },
            { label: "Active", value: active.length, hint: `${live.length - active.length} completed tasks` },
            { label: "Reported progress", value: progress === null ? "—" : `${progress}%`, hint: "All tasks shown, weighted by complexity" },
            { label: "Overdue / blocked", value: `${active.filter((t) => t.timing === "Overdue").length} / ${active.filter((t) => isBlocked(t.status)).length}`, hint: "Across the tasks shown" },
          ]}
        />
        <div className="mt">
          <Panel title="Own tasks" meta={role}>
            <TaskTrackingTable tasks={own} onOpen={onOpenTask} employeeId={person.id} note={false} />
          </Panel>
        </div>
        {groups.map(([p, list]) => (
          <div className="mt" key={p.id} data-responsible={p.code}>
            <Panel title={`Responsible · ${p.name}`} meta={`${list.length} task${list.length === 1 ? "" : "s"} · ${p.designation ?? ""}`}>
              <TaskTrackingTable tasks={list} onOpen={onOpenTask} employeeId={p.id} note={false} />
            </Panel>
          </div>
        ))}
        <p className="note mt">{TASK_DATE_NOTE} A task shared by two Responsible people appears under each, with that person's role and share. This view is for following the work; it doesn't change R&amp;R scores or who can see what.</p>
      </Drawer>
    );
  }

  const live = own.filter((t) => t.status !== "Cancelled");
  const active = live.filter((t) => t.status !== "Completed");
  const share = (t: TaskBrief) => (t.assignments.find((a) => a.employee.id === person.id)?.share ?? 0) / 100;
  const denom = live.reduce((n, t) => n + t.complexity * share(t), 0);
  const progress = denom ? Math.round(live.reduce((n, t) => n + t.progress * t.complexity * share(t), 0) / denom) : null;
  return (
    <Drawer open onClose={onClose} width={1240} wide eyebrow={`${project.code} · ${project.title}`} title={`${person.name} — assigned work`} sub={`${person.code} · ${person.designation ?? ""} · ${person.department ?? ""}`} footer={<Button onClick={onClose}>Back to project</Button>}>
      <Figures
        items={[
          { label: "Assigned tasks", value: own.length, hint: "This project" },
          { label: "Active", value: active.length, hint: `${live.length - active.length} completed tasks` },
          { label: "Reported progress", value: progress === null ? "—" : `${progress}%`, hint: "Weighted by complexity and share" },
          { label: "Overdue / blocked", value: `${active.filter((t) => t.timing === "Overdue").length} / ${active.filter((t) => isBlocked(t.status)).length}`, hint: "This person's assigned work" },
        ]}
      />
      <div className="mt">
        <Panel title="Assigned tasks">
          <TaskTrackingTable tasks={own} onOpen={onOpenTask} employeeId={person.id} />
        </Panel>
      </div>
      {stages.length > 0 && rr && (
        <div className="mt">
          <Panel title="Template stage responsibilities" meta="From the campaign template and run tracker">
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>Run</th><th>Responsible stage</th><th>Status</th></tr></thead>
                <tbody>
                  {rr.runs.flatMap((run) =>
                    stages.map((st) => {
                      const s = run.stages.find((x) => x.step === st.step);
                      return (
                        <tr key={`${run.id}-${st.step}`}>
                          <td>{run.id} · {run.title}</td>
                          <td>{st.step} · {st.name}</td>
                          <td>{s ? <Badge status={s.status} /> : "—"}{s?.late && <> <Badge status="Late" /></>}</td>
                        </tr>
                      );
                    }),
                  )}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      )}
      <p className="note mt">Select a task to open its details and updates. Reported progress and reviewer acceptance are separate.</p>
    </Drawer>
  );
}
