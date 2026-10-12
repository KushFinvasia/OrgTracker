import { useMemo, useState } from "react";

import { api, ApiError } from "@/api/client";
import type { Person, TaskBrief } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { Badge, Button, Callout, Card, Empty, ErrorState, Loading, PageHeader, Tabs, toast } from "@/components/ui";
import { CreateTaskDrawer } from "@/components/tasks/CreateTaskDrawer";
import { TaskDrawer } from "@/components/tasks/TaskDrawer";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { useApiQuery, useQueryParam } from "@/lib/hooks";
import { statusLabel } from "@/lib/status";
import { useQueryClient } from "@tanstack/react-query";

type Tab = "team" | "weekly" | "review" | "dependencies";
const MANUAL = ["Not Started", "In Progress", "Blocked", "On Hold", "Cancelled"];

export function TasksPage() {
  const { isRole } = useAuth();
  const [tabParam, setTabParam] = useQueryParam("tab");
  const [taskParam, setTaskParam] = useQueryParam("task");
  const [panel] = useQueryParam("panel");
  const tab = (tabParam as Tab) || "team";
  const [adding, setAdding] = useState(false);
  const review = useApiQuery<TaskBrief[]>("/tasks?view=review");

  return (
    <>
      <PageHeader
        title="A calmer way to update team work"
        sub="Assigned work across your permitted projects"
        actions={!isRole("team_lead") && <Button variant="primary" onClick={() => setAdding(true)}>Add task</Button>}
      />
      <Tabs
        value={tab}
        onChange={(t) => setTabParam(t)}
        tabs={[
          { id: "team", label: "My team tasks" },
          { id: "weekly", label: "Weekly update" },
          { id: "review", label: `Review queue (${review.data?.length ?? 0})` },
          { id: "dependencies", label: "Dependencies" },
        ]}
      />
      {tab === "team" && <TeamTasks onOpen={(id) => setTaskParam(String(id))} />}
      {tab === "weekly" && <WeeklyGrid onOpen={(id) => setTaskParam(String(id))} />}
      {tab === "review" && <ReviewQueue tasks={review.data ?? []} loading={review.isLoading} onOpen={(id) => setTaskParam(String(id))} />}
      {tab === "dependencies" && <Validations onOpen={(id) => setTaskParam(String(id))} />}
      <TaskDrawer taskId={taskParam ? Number(taskParam) : null} initialPanel={panel} onClose={() => setTaskParam(null)} />
      <CreateTaskDrawer open={adding} onClose={() => setAdding(false)} />
    </>
  );
}

function TeamTasks({ onOpen }: { onOpen: (id: number) => void }) {
  const [owner, setOwner] = useState("");
  const [status, setStatus] = useState("");
  const { data, isLoading, error } = useApiQuery<TaskBrief[]>(`/tasks?view=team${status ? `&status=${encodeURIComponent(status)}` : ""}`);
  const owners = useMemo(() => Array.from(new Map((data ?? []).filter((t) => t.owner).map((t) => [t.owner!.id, t.owner!])).values()), [data]);
  const rows = (data ?? []).filter((t) => !owner || t.owner?.id === Number(owner));
  if (isLoading) return <Loading rows={2} />;
  if (error) return <ErrorState error={error} />;
  return (
    <Card>
      <div className="row mb">
        <select className="input" style={{ width: 220 }} value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Owner">
          <option value="">All owners</option>
          {owners.map((o) => <option key={o.id} value={o.id}>{o.name} / {o.code}</option>)}
        </select>
        <select className="input" style={{ width: 180 }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">Active work</option>
          {["Not Started", "In Progress", "Blocked", "In Review", "Rework", "On Hold"].map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
        </select>
      </div>
      {rows.length === 0 ? (
        <Empty title="No active work in your scope" />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Task / project</th><th>Owner</th><th>Status</th><th>Progress</th><th>Due in force</th><th>Timing</th><th>Reviewer</th></tr></thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} className="clickable" onClick={() => onOpen(t.id)}>
                  <td><b>{t.title}</b><div className="sub">{t.project?.title} / {t.code}</div></td>
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
        </div>
      )}
    </Card>
  );
}

interface RowEdit {
  status?: string;
  progress?: number;
  next_action?: string;
}
interface RowResult {
  id: number;
  result: "saved" | "conflict" | "error";
  message?: string;
}

/** Inline status, progress and note. One save; per-row outcomes; failed rows keep their draft. */
function WeeklyGrid({ onOpen }: { onOpen: (id: number) => void }) {
  const qc = useQueryClient();
  const { data, isLoading } = useApiQuery<TaskBrief[]>("/tasks?view=team");
  const [edits, setEdits] = useState<Record<number, RowEdit>>({});
  const [results, setResults] = useState<Record<number, RowResult>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = Object.keys(edits).length;
  if (isLoading) return <Loading rows={2} />;
  const rows = data ?? [];

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const body = { rows: Object.entries(edits).map(([id, e]) => ({ id: Number(id), version: rows.find((r) => r.id === Number(id))!.version, ...e })) };
      const res = await api.post<{ results: RowResult[]; saved: number }>("/tasks/weekly-update", body);
      const byId = Object.fromEntries(res.results.map((r) => [r.id, r]));
      setResults(byId);
      setEdits((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => byId[Number(id)]?.result !== "saved")));
      toast(`${res.saved} saved / ${res.results.length - res.saved} need attention`, res.saved < res.results.length);
      await qc.invalidateQueries();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Save failed. Your edits are kept.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="stack">
      <Card title="Weekly update" sub="Inline status, progress and a short note. One save." actions={<Button variant="primary" disabled={!changed || saving} onClick={save}>Save updates</Button>}>
        {error && <div className="form-error">{error}</div>}
        {changed > 0 && <Callout title={`${changed} change${changed > 1 ? "s are" : " is"} ready to save`}>Successful rows save even if another row conflicts.</Callout>}
        <div className="table-wrap mt">
          <table className="table">
            <thead><tr><th>Task / project</th><th>Status</th><th>Progress</th><th>This week</th><th>Result</th></tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={5}><Empty title="No active work to update" /></td></tr>}
              {rows.map((t) => {
                const e = edits[t.id] ?? {};
                const locked = t.status === "In Review" || t.status === "Rework";
                const r = results[t.id];
                const update = (patch: RowEdit) => setEdits({ ...edits, [t.id]: { ...e, ...patch } });
                return (
                  <tr key={t.id}>
                    <td>
                      <button className="link-btn" style={{ color: "var(--ink)" }} onClick={() => onOpen(t.id)}>{t.title}</button>
                      <div className="sub">{t.project?.title} / {t.owner?.name ?? "No owner"}</div>
                    </td>
                    <td>
                      {locked ? (
                        <Badge status={t.status} />
                      ) : (
                        <select className="input" style={{ minWidth: 140 }} value={e.status ?? t.status} onChange={(ev) => update({ status: ev.target.value })} aria-label={`Status for ${t.title}`}>
                          {MANUAL.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
                        </select>
                      )}
                    </td>
                    <td>
                      <input type="number" min={0} max={100} className="input" style={{ width: 84 }} disabled={locked} value={e.progress ?? t.progress} onChange={(ev) => update({ progress: Number(ev.target.value) })} aria-label={`Progress for ${t.title}`} />
                    </td>
                    <td style={{ minWidth: 260 }}><input className="input" value={e.next_action ?? t.next_action ?? ""} onChange={(ev) => update({ next_action: ev.target.value })} placeholder="Next action" aria-label={`Next action for ${t.title}`} /></td>
                    <td>
                      {r?.result === "saved" && <Badge tone="green">Saved</Badge>}
                      {r?.result === "conflict" && <Badge tone="red">Conflict: compare latest</Badge>}
                      {r?.result === "error" && <Badge tone="red">{r.message}</Badge>}
                      {!r && edits[t.id] && <Badge tone="amber">Unsaved</Badge>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      <div className="grid grid-3">
        <Callout title="Fair acceptance">A 100% update alone never completes work. Only the independent reviewer's Accept sets Completed, using the submission date.</Callout>
        <Callout title="Recovery">Conflicting rows stay unsaved. Open the task to compare the latest version, then retry.</Callout>
        <Callout tone="warn" title="Blocked or late?">Open the task &gt; Dependencies to report a blocker or request a new date. A requested date never silently improves performance.</Callout>
      </div>
    </div>
  );
}

function ReviewQueue({ tasks, loading, onOpen }: { tasks: TaskBrief[]; loading: boolean; onOpen: (id: number) => void }) {
  if (loading) return <Loading />;
  return (
    <Card title="Independent reviewer workspace" sub="Accept the output, or return clear feedback">
      {tasks.length === 0 ? (
        <Empty title="Nothing waiting for your review" />
      ) : (
        <table className="table">
          <thead><tr><th>Task</th><th>Owner</th><th>Due in force</th><th>Status</th><th /></tr></thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={t.id}>
                <td><b>{t.title}</b><div className="sub">{t.project?.title} / {t.code}</div></td>
                <td>{t.owner?.name}</td>
                <td>{fmtDate(t.due_date)}</td>
                <td><Badge status={t.status} /></td>
                <td><Button size="sm" variant="primary" onClick={() => onOpen(t.id)}>Review evidence</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

interface Validation {
  kind: "blocker" | "deadline";
  id: number;
  task: { id: number; title: string; code: string };
  category: string;
  requested: string | null;
  requester: Person | null;
  validator: Person | null;
  state: string;
  can_decide: boolean;
  created_at: string;
  source: string;
}

function Validations({ onOpen }: { onOpen: (id: number) => void }) {
  const { data, isLoading } = useApiQuery<Validation[]>("/validations");
  if (isLoading) return <Loading />;
  const rows = data ?? [];
  return (
    <Card title="Blockers and deadline changes" sub="Separate validation records. Requesters cannot validate their own requests.">
      {rows.length === 0 ? (
        <Empty title="No blockers or date changes in your scope" />
      ) : (
        <table className="table">
          <thead><tr><th>Request</th><th>Task</th><th>Requester</th><th>Validator</th><th>State</th><th /></tr></thead>
          <tbody>
            {rows.map((v) => (
              <tr key={`${v.kind}${v.id}`}>
                <td><b>{v.kind === "blocker" ? "Blocker" : "Date change"}: {v.category}</b><div className="sub">{v.requested}</div></td>
                <td>{v.task.title}<div className="sub">{v.task.code}</div></td>
                <td>{v.requester?.name ?? "—"}</td>
                <td>{v.validator?.name ?? (v.source === "import" ? "Source tracker" : "—")}</td>
                <td><Badge status={v.state} /></td>
                <td>{v.can_decide ? <Button size="sm" variant="primary" onClick={() => onOpen(v.task.id)}>Validate</Button> : <button className="link-btn" onClick={() => onOpen(v.task.id)}>Open task</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="small muted mt">Updated {fmtDateTime(new Date().toISOString())}</p>
    </Card>
  );
}
