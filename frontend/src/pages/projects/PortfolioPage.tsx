import { LayoutGrid } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import type { Recognition } from "@/api/rr";
import type { Department, Person, Project } from "@/api/types";
import { GxHead, GxLegend, GxRow, daysBetween, gxRange } from "@/components/tasks/Gantt";
import { useAuth } from "@/auth/AuthContext";
import { Avatar, Badge, Button, Callout, Card, DecisionButton, Drawer, Empty, ErrorState, Field, FormError, Loading, PageHeader, PersonPicker, Progress, Tabs, Tier, fieldError, toast } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { useApiMutation, useApiQuery, useDraft, useQueryParam } from "@/lib/hooks";
import { statusLabel } from "@/lib/status";

type Tab = "all" | "team" | "requests" | "archived";

interface Template {
  id: number;
  name: string;
  sla_target_days: number | null;
  sla_max_days: number | null;
  effort_min_hours: number | null;
  effort_max_hours: number | null;
  blocking_conflicts: number;
  stages: { step: number; name: string; conflicts: string[] }[];
}

interface WorkRequest {
  id: number;
  title: string;
  template: string | null;
  requesting_department: string | null;
  receiving_department: string | null;
  objective: string | null;
  required_date: string | null;
  priority: string;
  brief: string | null;
  requester: Person | null;
  validator: Person | null;
  state: string;
  project_id: number | null;
  project_code: string | null;
  run: string | null;
  can_accept: boolean;
  can_validate: boolean;
  history: { at: string; event: string; actor: string; note?: string }[];
}

export function PortfolioPage() {
  const { isRole } = useAuth();
  const navigate = useNavigate();
  const [tabParam, setTabParam] = useQueryParam("tab");
  const tab = (tabParam as Tab) || "all";
  const [view, setView] = useState<"cards" | "list" | "timeline">("cards");
  const [dept, setDept] = useState("");
  const [priority, setPriority] = useState("");
  const [status, setStatus] = useState("active");
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const params = new URLSearchParams({ tab: tab === "requests" ? "all" : tab, ...(dept && { department_id: dept }), ...(priority && { priority }), ...(status && tab !== "archived" && { status }), ...(q && { q }) });
  const projects = useApiQuery<Project[]>(`/projects?${params}`);
  const departments = useApiQuery<Department[]>("/departments");
  const requests = useApiQuery<WorkRequest[]>("/requests");
  const recognition = useApiQuery<Recognition>("/recognition");
  const bands = new Map((recognition.data?.rows ?? []).map((r) => [r.project.id, r]));
  const band = (id: number) => {
    const r = bands.get(id);
    return r ? <Tier tier={r.band} empty="Not scored" /> : <span className="muted small">Not in the scheme</span>;
  };
  const canCreate = isRole("admin", "hod", "manager");

  return (
    <>
      <PageHeader title="Your project portfolio" sub="A clear picture of delivery, priorities and dependencies" actions={canCreate && <Button variant="primary" onClick={() => setCreating(true)}>New project</Button>} />
      <Tabs
        value={tab}
        onChange={(t) => setTabParam(t)}
        tabs={[
          { id: "all", label: "All projects" },
          { id: "team", label: "My team" },
          { id: "requests", label: `Requests (${(requests.data ?? []).filter((r) => r.state !== "Accepted").length})` },
          { id: "archived", label: "Archived" },
        ]}
      />
      {tab === "requests" ? (
        <RequestsTab requests={requests.data ?? []} departments={departments.data ?? []} />
      ) : (
        <>
          <div className="row between mb">
            <div className="row">
              <select className="input" style={{ width: 190 }} value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Department">
                <option value="">All departments</option>
                {(departments.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              <select className="input" style={{ width: 160 }} value={priority} onChange={(e) => setPriority(e.target.value)} aria-label="Priority">
                <option value="">All priorities</option>
                <option>High</option>
                <option>Medium</option>
                <option>Low</option>
                <option value="missing">Missing priority</option>
              </select>
              {tab !== "archived" && (
                <select className="input" style={{ width: 160 }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
                  <option value="active">Active projects</option>
                  <option value="">All statuses</option>
                  {["Planning", "Not Started", "In Progress", "Blocked", "In Review", "Completed", "On Hold", "Cancelled"].map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
                </select>
              )}
              <input className="input" style={{ width: 220 }} placeholder="Search projects" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div className="seg">
              {(["cards", "list", "timeline"] as const).map((v) => (
                <button key={v} className={view === v ? "active" : ""} onClick={() => setView(v)}>{v[0].toUpperCase() + v.slice(1)}</button>
              ))}
            </div>
          </div>
          {projects.isLoading && <Loading rows={2} />}
          <ErrorState error={projects.error} />
          {projects.data && projects.data.length === 0 && (
            <Card>{tab === "archived" && !dept && !priority && !q ? <Empty title="No archived projects">Archived projects keep their records and appear here.</Empty> : <Empty title="No filter matches">Clear or change your filters.</Empty>}</Card>
          )}
          {!!projects.data?.length && view === "cards" && (
            <div className="grid grid-3">
              {projects.data.map((p) => (
                <button key={p.id} className="card" style={{ textAlign: "left", cursor: "pointer" }} onClick={() => navigate(`/projects/${p.id}`)}>
                  <div className="row between">
                    <span className={`inbox-icon ${p.priority === "High" ? "red" : ""}`} style={{ width: 40, height: 40 }}><LayoutGrid size={18} /></span>
                    {p.priority ? <Badge status={p.priority} /> : <Badge tone="red">Priority missing</Badge>}
                  </div>
                  <h3 style={{ fontSize: 17, margin: "16px 0 10px" }}>{p.title}</h3>
                  <div className="muted small mb">{p.code} / {p.department}{p.source === "demo" ? " / Illustrative" : ""}</div>
                  <Progress value={p.metrics.accepted_delivery === null ? 0 : Math.round(p.metrics.accepted_delivery)} />
                  <div className="small muted">Completed tasks {p.metrics.tasks_accepted} of {p.metrics.tasks_total}</div>
                  <div className="row between mt">
                    <span className="row" style={{ gap: 6 }}>
                      {p.metrics.health ? <Badge status={p.metrics.health}>{statusLabel(p.metrics.health)}</Badge> : <Badge status={p.status} />}
                      {bands.has(p.id) && <Tier tier={bands.get(p.id)!.band} empty="Not scored" />}
                    </span>
                    <span className="row small muted"><Avatar person={p.owner} /> {fmtDate(p.target_date)}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
          {!!projects.data?.length && view === "list" && (
            <Card>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Project</th><th>Priority</th><th>Status</th><th>Health</th><th>Owner</th><th>Target</th><th className="num">Completed tasks</th><th>Project band</th></tr></thead>
                  <tbody>
                    {projects.data.map((p) => (
                      <tr key={p.id} className="clickable" onClick={() => navigate(`/projects/${p.id}`)}>
                        <td><b>{p.title}</b><div className="sub">{p.code} / {p.department}</div></td>
                        <td>{p.priority ? <Badge status={p.priority} /> : <Badge tone="red">Missing</Badge>}</td>
                        <td><Badge status={p.status} /></td>
                        <td>{p.metrics.health ? <Badge status={p.metrics.health}>{statusLabel(p.metrics.health)}</Badge> : "—"}</td>
                        <td>{p.owner?.name ?? <span className="muted">Unresolved</span>}</td>
                        <td>{fmtDate(p.target_date)}</td>
                        <td className="num">{p.metrics.tasks_total ? `${p.metrics.tasks_accepted} of ${p.metrics.tasks_total}` : "—"}</td>
                        <td>{band(p.id)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
          {!!projects.data?.length && view === "timeline" && <PortfolioTimeline projects={projects.data} />}
          {(requests.data ?? []).some((r) => r.state === "Validated" && r.can_accept) && (
            <Card className="mt" title="Requests to coordinate" actions={<button className="link-btn" onClick={() => setTabParam("requests")}>Open request</button>}>
              <span className="muted">{(requests.data ?? []).filter((r) => r.can_accept).length} validated request(s) waiting for receiving team planning</span>
            </Card>
          )}
        </>
      )}
      {creating && <CreateProjectDrawer departments={departments.data ?? []} onClose={() => setCreating(false)} />}
    </>
  );
}

function PortfolioTimeline({ projects }: { projects: Project[] }) {
  const navigate = useNavigate();
  const dated = projects.filter((p) => p.start_date && p.target_date).sort((a, b) => a.start_date!.localeCompare(b.start_date!));
  const undated = projects.filter((p) => !p.start_date || !p.target_date);
  if (!dated.length) return <Card><Empty title="No dated projects">Projects without start and target dates can't be placed on the timeline.</Empty></Card>;
  const r = gxRange([...dated.map((p) => p.start_date), ...dated.map((p) => p.target_date)]);
  return (
    <>
      <div className="gx-tools"><GxLegend keys={[["s-done", "Completed"], ["s-progress", "On track (fill = completed tasks)"], ["s-review", "At risk"], ["s-blocked", "Off track"], ["s-todo", "Planning"], ["gx-over", "Past target date"]]} /></div>
      <section className="panel">
        <div className="gx-scroll">
          <div className="gx">
            <GxHead r={r} label={`Project · ${fmtDate(r.from, false)} to ${fmtDate(r.to, false)}`} />
            {dated.map((p) => {
              const m = p.metrics;
              const done = p.status === "Completed";
              const cls = done ? "s-done" : m.health === "Off Track" ? "s-blocked" : m.health === "At Risk" ? "s-review" : ["Planning", "Not Started"].includes(p.status) ? "s-todo" : "s-progress";
              const over = !done && p.target_date! < r.today;
              return (
                <GxRow
                  key={p.id}
                  r={r}
                  label={<button type="button" className="gx-name" onClick={() => navigate(`/projects/${p.id}`)}><span className="mono">{p.code}</span>{p.title}</button>}
                  meta={<>{p.priority ? <Badge status={p.priority} /> : <Badge tone="red">No priority</Badge>}{m.health ? <Badge status={m.health}>{statusLabel(m.health)}</Badge> : <Badge status={p.status} />}<span>{p.department}</span></>}
                  bar={{
                    start: p.start_date!,
                    end: p.target_date!,
                    cls,
                    fill: done || m.accepted_delivery === null ? null : Math.round(m.accepted_delivery),
                    over,
                    title: `${p.code} · ${p.title}\n${fmtDate(p.start_date)} → ${fmtDate(p.target_date)}`,
                    onClick: () => navigate(`/projects/${p.id}?tab=timeline`),
                    text: done ? <>Closed · target {fmtDate(p.target_date, false)}</> : <>Target {fmtDate(p.target_date, false)}{m.tasks_total ? ` · ${Math.round(m.accepted_delivery ?? 0)}% completed tasks` : ""}{over && <> · <b className="bad-txt">{daysBetween(p.target_date!, r.today)} days past target</b></>}</>,
                  }}
                />
              );
            })}
          </div>
        </div>
        {undated.length > 0 && <div className="gx-off">Not on the timeline (no start or target date): {undated.map((p) => p.code).join(", ")}</div>}
      </section>
    </>
  );
}

interface ProjectDraft {
  title: string;
  priority: string;
  owner: Person | null;
  reviewer: Person | null;
  department_id: string;
  start_date: string;
  target_date: string;
  template_id: string;
  objective: string;
}

function CreateProjectDrawer({ departments, onClose }: { departments: Department[]; onClose: () => void }) {
  const { account } = useAuth();
  const navigate = useNavigate();
  const empty: ProjectDraft = { title: "", priority: "", owner: account?.employee ?? null, reviewer: null, department_id: "", start_date: "", target_date: "", template_id: "", objective: "" };
  const draft = useDraft<ProjectDraft>("project", empty);
  const d = draft.value;
  const set = (patch: Partial<ProjectDraft>) => draft.setValue({ ...d, ...patch });
  const templates = useApiQuery<Template[]>("/templates");
  const create = useApiMutation<Record<string, unknown>, Project & { activation_blockers: string[]; created_tasks: number }>("post", "/projects");
  const tpl = (templates.data ?? []).find((t) => String(t.id) === d.template_id);

  return (
    <Drawer
      open
      onClose={onClose}
      dirty={draft.dirty}
      wide
      eyebrow="Projects > New project"
      title="Create a project"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={create.isPending}
            onClick={() =>
              create.mutate(
                { title: d.title, priority: d.priority || null, owner_id: d.owner?.id, reviewer_id: d.reviewer?.id, department_id: Number(d.department_id) || null, start_date: d.start_date || null, target_date: d.target_date || null, template_id: Number(d.template_id) || null, objective: d.objective },
                {
                  onSuccess: (p) => {
                    draft.clear();
                    toast(`${p.code} created${p.created_tasks ? ` with ${p.created_tasks} staged tasks` : ""}`);
                    navigate(`/projects/${p.id}`);
                  },
                },
              )
            }
          >
            Create project
          </Button>
        </>
      }
    >
      <FormError error={create.error} />
      <div className="drawer-split">
        <div className="form-grid">
          <Field label="Project name" required className="full" error={fieldError(create.error, "title")}>
            <input className="input" value={d.title} onChange={(e) => set({ title: e.target.value })} placeholder="Website launch follow-up" />
          </Field>
          <Field label="Priority" required error={fieldError(create.error, "priority")} help="No preselected priority">
            <select className="input" value={d.priority} onChange={(e) => set({ priority: e.target.value })}>
              <option value="">Choose High / Medium / Low</option>
              <option>High</option>
              <option>Medium</option>
              <option>Low</option>
            </select>
          </Field>
          <Field label="Department" required error={fieldError(create.error, "department_id")}>
            <select className="input" value={d.department_id} onChange={(e) => set({ department_id: e.target.value })}>
              <option value="">Choose canonical department</option>
              {departments.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </Field>
          <Field label="Project owner" required error={fieldError(create.error, "owner_id")}>
            <PersonPicker value={d.owner} onChange={(p) => set({ owner: p })} />
          </Field>
          <Field label="Project reviewer">
            <PersonPicker value={d.reviewer} onChange={(p) => set({ reviewer: p })} placeholder="Choose a named reviewer" />
          </Field>
          <Field label="Start date" required error={fieldError(create.error, "start_date")}>
            <input type="date" className="input" value={d.start_date} onChange={(e) => set({ start_date: e.target.value })} />
          </Field>
          <Field label="Target date" error={fieldError(create.error, "target_date")}>
            <input type="date" className="input" value={d.target_date} onChange={(e) => set({ target_date: e.target.value })} />
          </Field>
          <Field label="Start from" className="full">
            <select className="input" value={d.template_id} onChange={(e) => set({ template_id: e.target.value })}>
              <option value="">Blank project</option>
              {(templates.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name} template</option>)}
            </select>
          </Field>
          <Field label="Objective" required className="full">
            <textarea className="input" value={d.objective} onChange={(e) => set({ objective: e.target.value })} />
          </Field>
        </div>
        <div className="aside-panel">
          <h4>Priority has no default</h4>
          <p>Choose High, Medium or Low. Missing priority blocks creation.</p>
          <h4>Ownership and scope</h4>
          <p>Project membership grants work context. Performance visibility continues to follow HR reporting.</p>
          {tpl && (
            <>
              <h4>Template preview: {tpl.name}</h4>
              <p>{tpl.stages.length} stages{tpl.sla_target_days ? ` / target ${tpl.sla_target_days} / max ${tpl.sla_max_days} business days` : ""}{tpl.effort_min_hours ? ` / ${tpl.effort_min_hours}-${tpl.effort_max_hours} h` : ""}</p>
              {tpl.blocking_conflicts > 0 && <Callout tone="warn" title="Named roles still need resolution">{tpl.blocking_conflicts} stage(s) have RACI or reviewer conflicts. The project stays in Planning until they are resolved.</Callout>}
            </>
          )}
          <h4>Create outcome</h4>
          <p>A draft project opens in its Overview tab. Add task is visible in the project header.</p>
        </div>
      </div>
    </Drawer>
  );
}

function RequestsTab({ requests, departments }: { requests: WorkRequest[]; departments: Department[] }) {
  const navigate = useNavigate();
  const { account } = useAuth();
  const [open, setOpen] = useState(false);
  const decide = useApiMutation<{ id: number; decision: string; reason?: string }>("post", (b) => `/requests/${b.id}/decide`);
  return (
    <>
      <div className="row between mb">
        <span className="note">Requester's manager validates, then the receiving POC accepts it into the calendar. Accepted email campaigns become runs of the quarterly programme.</span>
        <Button variant="primary" onClick={() => setOpen(true)}>Request work from another department</Button>
      </div>
      <FormError error={decide.error} />
      {requests.length === 0 ? (
        <Card><Empty title="No requests to coordinate" /></Card>
      ) : (
        <Card>
          <table className="table">
            <thead><tr><th>Request</th><th>From / to</th><th>Required</th><th>Validator</th><th>State</th><th>Next action</th></tr></thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id}>
                  <td><b>{r.title}</b><div className="sub">{r.template ?? "No template"} / {r.objective}</div></td>
                  <td>{r.requesting_department} &gt; {r.receiving_department}</td>
                  <td>{fmtDate(r.required_date)}</td>
                  <td>{r.validator?.name}</td>
                  <td><Badge status={r.state} /></td>
                  <td>
                    <div className="row">
                      {r.can_validate && (
                        <>
                          <Button size="sm" variant="green" onClick={() => decide.mutate({ id: r.id, decision: "validate" })}>Validate</Button>
                          <DecisionButton size="sm" label="Return" decision="return" onDecide={(dec, reason) => decide.mutate({ id: r.id, decision: dec, reason })} />
                        </>
                      )}
                      {r.can_accept && (
                        <>
                          <Button size="sm" variant="primary" onClick={() => decide.mutate({ id: r.id, decision: "accept" }, { onSuccess: (x) => { const res = x as WorkRequest; toast(res.run ? `Accepted into the calendar as run ${res.run} of ${res.project_code}` : "Accepted into calendar; project created in Planning"); } })}>Accept into calendar</Button>
                          <DecisionButton size="sm" label="Return request" decision="return" onDecide={(dec, reason) => decide.mutate({ id: r.id, decision: dec, reason })} />
                        </>
                      )}
                      {r.project_id && <button className="link-btn" onClick={() => navigate(`/projects/${r.project_id}${r.run ? "?tab=runs" : ""}`)}>{r.run ? `Run ${r.run} of ${r.project_code}` : "Open project"}</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {open && <RequestDrawer departments={departments} defaultDept={departments.find((d) => d.name === account?.employee.department)?.id} onClose={() => setOpen(false)} />}
    </>
  );
}

function RequestDrawer({ departments, defaultDept, onClose }: { departments: Department[]; defaultDept?: number; onClose: () => void }) {
  const templates = useApiQuery<Template[]>("/templates");
  const draft = useDraft("request", { title: "", template_id: "", requesting_department_id: String(defaultDept ?? ""), receiving_department_id: "", audience: "", objective: "", required_date: "", priority: "", brief: "" });
  const [validator, setValidator] = useState<Person | null>(null);
  const d = draft.value;
  const set = (patch: Partial<typeof d>) => draft.setValue({ ...d, ...patch });
  const create = useApiMutation<Record<string, unknown>>("post", "/requests");
  return (
    <Drawer
      open
      onClose={onClose}
      dirty={draft.dirty}
      wide
      eyebrow="Projects > Requests / Brief drawer"
      title="Request work from another department"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() =>
              create.mutate(
                { ...d, template_id: Number(d.template_id) || null, requesting_department_id: Number(d.requesting_department_id), receiving_department_id: Number(d.receiving_department_id), priority: d.priority || null, validator_id: validator?.id },
                { onSuccess: () => { draft.clear(); toast("Request sent for validation"); onClose(); } },
              )
            }
          >
            Send work request
          </Button>
        </>
      }
    >
      <FormError error={create.error} />
      <div className="drawer-split">
        <div className="form-grid">
          <Field label="Workflow template" required>
            <select className="input" value={d.template_id} onChange={(e) => set({ template_id: e.target.value })}>
              <option value="">Choose template</option>
              {(templates.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
          <Field label="Request title" required><input className="input" value={d.title} onChange={(e) => set({ title: e.target.value })} /></Field>
          <Field label="Requesting department" required>
            <select className="input" value={d.requesting_department_id} onChange={(e) => set({ requesting_department_id: e.target.value })}>
              <option value="">Choose</option>
              {departments.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </Field>
          <Field label="Receiving team" required>
            <select className="input" value={d.receiving_department_id} onChange={(e) => set({ receiving_department_id: e.target.value })}>
              <option value="">Choose</option>
              {departments.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </Field>
          <Field label="Audience" required><input className="input" value={d.audience} onChange={(e) => set({ audience: e.target.value })} /></Field>
          <Field label="Required date" required><input type="date" className="input" value={d.required_date} onChange={(e) => set({ required_date: e.target.value })} /></Field>
          <Field label="Priority" required error={fieldError(create.error, "priority")}>
            <select className="input" value={d.priority} onChange={(e) => set({ priority: e.target.value })}>
              <option value="">Choose priority</option><option>High</option><option>Medium</option><option>Low</option>
            </select>
          </Field>
          <Field label="Request validator" required help="Requester's manager" error={fieldError(create.error, "validator_id")}>
            <PersonPicker value={validator} onChange={setValidator} />
          </Field>
          <Field label="Objective" required className="full"><input className="input" value={d.objective} onChange={(e) => set({ objective: e.target.value })} /></Field>
          <Field label="Brief / assets" required className="full"><textarea className="input" value={d.brief} onChange={(e) => set({ brief: e.target.value })} placeholder="Approved copy and design references" /></Field>
        </div>
        <div className="aside-panel">
          <h4>What happens next</h4>
          <p>Manager validates the request; receiving POC accepts it into the calendar.</p>
          <h4>Template-based project</h4>
          <p>The accepted request creates a project with staged tasks and dependencies.</p>
          <h4>Named responsibilities</h4>
          <p>Resolve R, A, C, I and independent reviewer names before scheduling. Team labels alone cannot satisfy Accountable or reviewer fields.</p>
        </div>
      </div>
    </Drawer>
  );
}
