import { FileText, Upload } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { api, ApiError } from "@/api/client";
import type { Person, TaskDetail } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { Badge, Button, Callout, DecisionButton, Drawer, Field, FormError, Kv, Loading, PersonChip, PersonPicker, Progress, Tabs, fieldError, toast } from "@/components/ui";
import { fmtDate, fmtDateTime, todayISO } from "@/lib/format";
import { useApiMutation, useApiQuery } from "@/lib/hooks";
import { statusLabel } from "@/lib/status";

type Panel = "details" | "assignments" | "evidence" | "review" | "dependencies" | "discussion" | "history";
const MANUAL = ["Not Started", "In Progress", "Blocked", "On Hold", "Cancelled"];
const BLOCKERS = ["Internal dependency", "External or vendor", "Approval pending", "Management reprioritisation", "Requirement change", "Resource", "Technical issue", "Own-team rework"];
const NOT_EXCLUDABLE = ["Technical issue", "Own-team rework"];

export function TaskDrawer({ taskId, onClose, initialPanel }: { taskId: number | null; onClose: () => void; initialPanel?: string | null }) {
  const [panel, setPanel] = useState<Panel>((initialPanel as Panel) || "details");
  useEffect(() => setPanel((initialPanel as Panel) || "details"), [taskId, initialPanel]);
  const { data: t, isLoading, error } = useApiQuery<TaskDetail>(taskId ? `/tasks/${taskId}` : null);

  return (
    <Drawer
      open={!!taskId}
      onClose={onClose}
      wide
      eyebrow={t ? `Task / ${t.category ?? t.project?.code ?? ""}` : "Task"}
      title={t?.title ?? "Loading"}
    >
      {isLoading && <Loading />}
      {error && <div className="form-error">{error.message}</div>}
      {t && (
        <>
          <div className="row mb">
            <Badge status={t.status} />
            <Badge status={t.timing}>{t.timing}</Badge>
            <span className="muted">{t.progress}% reported progress</span>
            {t.source !== "app" && <Badge tone="grey">{t.source === "import" ? "Imported legacy record" : "Illustrative demo"}</Badge>}
          </div>
          {t.data_flags && <Callout tone="warn" title="Source data to confirm">{t.data_flags}</Callout>}
          <Tabs
            value={panel}
            onChange={setPanel}
            tabs={[
              { id: "details", label: "Details" },
              { id: "assignments", label: "Assignments" },
              { id: "evidence", label: "Evidence & submit" },
              { id: "review", label: "Review", hidden: !(t.is_reviewer && t.status === "In Review") },
              { id: "dependencies", label: `Dependencies${t.pending_blockers ? ` (${t.pending_blockers})` : ""}` },
              { id: "discussion", label: "Discussion" },
              { id: "history", label: "Version history" },
            ]}
          />
          {panel === "details" && <DetailsPanel t={t} />}
          {panel === "assignments" && <AssignmentsPanel t={t} />}
          {panel === "evidence" && <EvidencePanel t={t} />}
          {panel === "review" && <ReviewPanel t={t} onDone={() => setPanel("history")} />}
          {panel === "dependencies" && <DependenciesPanel t={t} />}
          {panel === "discussion" && <DiscussionPanel t={t} />}
          {panel === "history" && <HistoryPanel t={t} />}
        </>
      )}
    </Drawer>
  );
}

function DetailsPanel({ t }: { t: TaskDetail }) {
  const { account } = useAuth();
  const [form, setForm] = useState({ status: t.status, progress: t.progress, next_action: t.next_action ?? "" });
  useEffect(() => setForm({ status: t.status, progress: t.progress, next_action: t.next_action ?? "" }), [t]);
  const save = useApiMutation<Record<string, unknown>>("patch", `/tasks/${t.id}`);
  const locked = ["In Review", "Completed"].includes(t.status);
  return (
    <div className="drawer-split">
      <div className="stack">
        <FormError error={save.error} />
        {t.can_update ? (
          <div className="form-grid">
            <Field label="Status" required help={locked ? `${statusLabel(t.status)} is set by the review workflow.` : undefined} error={fieldError(save.error, "status")}>
              <select className="input" disabled={locked} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                {(locked ? [t.status] : t.status === "Rework" ? ["Rework", ...MANUAL] : MANUAL).map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
              </select>
            </Field>
            <Field label="Reported progress %" help="A planning update. 100% never means accepted.">
              <input type="number" min={0} max={100} className="input" disabled={t.status === "Completed"} value={form.progress} onChange={(e) => setForm({ ...form, progress: Number(e.target.value) })} />
            </Field>
            <Field label="Next action" className="full">
              <input className="input" value={form.next_action} onChange={(e) => setForm({ ...form, next_action: e.target.value })} />
            </Field>
            <div className="full row">
              <Button
                variant="primary"
                disabled={save.isPending}
                onClick={() => {
                  const body: Record<string, unknown> = { version: t.version, progress: form.progress, next_action: form.next_action };
                  if (form.status !== t.status) body.status = form.status;
                  save.mutate(body, { onSuccess: () => toast("Task updated") });
                }}
              >
                Save updates
              </Button>
            </div>
          </div>
        ) : (
          <Callout title="Read-only">You can view this task but it is outside the team you update.</Callout>
        )}
        <Kv
          items={[
            ["Project", t.project ? `${t.project.title} / ${t.project.code}` : "—"],
            ["Description", t.description ?? "—"],
            ["Complexity", `${t.complexity} / 5`],
            ["Start", fmtDate(t.start_date)],
            ["Due date in force", <span key="due">{fmtDate(t.due_date)} {t.due_date_original && t.due_date_original !== t.due_date && <span className="green small">Original {fmtDate(t.due_date_original, false)} / validated change</span>}</span>],
            ["Accepted submission", fmtDate(t.accepted_submission_date)],
            ["Required evidence", t.required_evidence ?? "—"],
          ]}
        />
        {account?.role === "team_lead" && <p className="small muted">Team Leads update work; private KPI and check-in values stay hidden.</p>}
      </div>
      <div className="aside-panel">
        <h4>Owner and contribution</h4>
        {t.assignments.map((a) => <PersonChip key={a.employee.id} person={a.employee} meta={`${a.employee.code} / ${a.role} / ${a.share}%`} />)}
        <h4>Reviewer</h4>
        {t.reviewer ? <PersonChip person={t.reviewer} meta="Independent reviewer assigned" /> : <span className="badge tone-red">No independent reviewer</span>}
        <h4>Acceptance checklist</h4>
        {t.checklist.length ? <ul style={{ margin: 0, paddingLeft: 18 }}>{t.checklist.map((c) => <li key={c}>{c}</li>)}</ul> : <p>No checklist.</p>}
        <Progress value={t.progress} />
        <p>Reported progress, accepted completion and verified training completion are separate values.</p>
      </div>
    </div>
  );
}

function AssignmentsPanel({ t }: { t: TaskDetail }) {
  const [rows, setRows] = useState(t.assignments.map((a) => ({ person: a.employee as Person | null, role: a.role, share: a.share })));
  const [reviewer, setReviewer] = useState<Person | null>(t.reviewer);
  const [reason, setReason] = useState("");
  const save = useApiMutation<Record<string, unknown>>("put", `/tasks/${t.id}/assignments`);
  const total = rows.reduce((s, r) => s + Number(r.share || 0), 0);
  const ids = rows.map((r) => r.person?.id).filter(Boolean) as number[];
  return (
    <div className="drawer-split">
      <div className="stack">
        <FormError error={save.error} />
        {rows.map((r, i) => (
          <div key={i} className="form-grid" style={{ alignItems: "end" }}>
            <Field label={r.role === "Owner" ? "Owner" : "Contributor"} required>
              <PersonPicker value={r.person} onChange={(p) => setRows(rows.map((x, j) => (j === i ? { ...x, person: p } : x)))} />
            </Field>
            <div className="row" style={{ flexWrap: "nowrap" }}>
              <select className="input" value={r.role} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, role: e.target.value as "Owner" } : x)))}>
                <option>Owner</option>
                <option>Contributor</option>
              </select>
              <input type="number" className="input" style={{ width: 90 }} value={r.share} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, share: Number(e.target.value) } : x)))} />%
              <button className="link-btn" onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</button>
            </div>
          </div>
        ))}
        <Button size="sm" onClick={() => setRows([...rows, { person: null, role: "Contributor", share: 0 }])}>Add contributor</Button>
        <Field label="Independent reviewer" required error={reviewer && ids.includes(reviewer.id) ? "The reviewer is an assignee. Choose another person." : fieldError(save.error, "reviewer_id")}>
          <PersonPicker value={reviewer} onChange={setReviewer} exclude={ids} />
        </Field>
        <Field label="Change reason" required>
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Split design and integration work" />
        </Field>
        <Button
          variant="primary"
          disabled={save.isPending || !t.can_update}
          onClick={() =>
            save.mutate(
              { version: t.version, reviewer_id: reviewer?.id, reason, assignments: rows.filter((r) => r.person).map((r) => ({ employee_id: r.person!.id, role: r.role, share: Number(r.share) })) },
              { onSuccess: () => toast("Assignments saved") },
            )
          }
        >
          Save assignments
        </Button>
      </div>
      <div className="aside-panel">
        <h4>Validation</h4>
        <span className={`badge ${total === 100 ? "tone-green" : "tone-red"}`}>Current shares: {total}%</span>
        <p>Exactly one Owner; positive shares total 100%; no duplicate employee; reviewer is not any assignee.</p>
        <h4>Unique identity</h4>
        <p>Choose by employee ID, designation and department. Same names may identify different people.</p>
      </div>
    </div>
  );
}

function EvidencePanel({ t }: { t: TaskDetail }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<{ name: string; state: "uploading" | "failed" | "done"; file?: File; error?: string }[]>([]);
  const [selected, setSelected] = useState<number[]>(t.evidence.slice(0, 1).map((e) => e.id));
  const [submitDate, setSubmitDate] = useState(todayISO());
  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const submit = useApiMutation<Record<string, unknown>>("post", `/tasks/${t.id}/submit`);
  const qc = useQueryClient();

  const uploadFile = async (file: File) => {
    setUploads((u) => [...u.filter((x) => x.name !== file.name), { name: file.name, state: "uploading", file }]);
    try {
      const res = await api.upload<{ id: number }>(`/tasks/${t.id}/evidence`, file);
      setUploads((u) => u.map((x) => (x.name === file.name ? { ...x, state: "done" } : x)));
      setSelected((s) => [...s, res.id]);
      void qc.invalidateQueries({ queryKey: [`/tasks/${t.id}`] });
    } catch (e) {
      setUploads((u) => u.map((x) => (x.name === file.name ? { ...x, state: "failed", error: e instanceof ApiError ? e.message : "Upload failed" } : x)));
    }
  };
  const canSubmit = t.can_update && ["Not Started", "In Progress", "Rework", "Blocked"].includes(t.status);

  return (
    <div className="drawer-split">
      <div className="stack">
        <div className="card" style={{ borderStyle: "dashed", textAlign: "center", cursor: "pointer" }} onClick={() => inputRef.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); Array.from(e.dataTransfer.files).forEach(uploadFile); }}>
          <Upload size={22} />
          <p><b>Drop files here or choose files</b></p>
          <p className="small muted">Allowed formats and size limit come from the approved upload policy (pending).</p>
          <input ref={inputRef} type="file" multiple hidden onChange={(e) => Array.from(e.target.files ?? []).forEach(uploadFile)} />
        </div>
        {uploads.map((u) => (
          <div key={u.name} className="row between">
            <span><FileText size={14} /> {u.name}</span>
            {u.state === "uploading" && <Badge tone="amber">Uploading</Badge>}
            {u.state === "done" && <Badge tone="green">Uploaded</Badge>}
            {u.state === "failed" && (
              <span className="row">
                <Badge tone="red">{u.error}</Badge>
                <Button size="sm" onClick={() => u.file && uploadFile(u.file)}>Retry upload</Button>
              </span>
            )}
          </div>
        ))}
        <table className="table">
          <thead><tr><th>Include</th><th>File</th><th>Uploaded</th><th /></tr></thead>
          <tbody>
            {t.evidence.length === 0 && <tr><td colSpan={4} className="muted">No evidence uploaded yet.</td></tr>}
            {t.evidence.map((e) => (
              <tr key={e.id}>
                <td><input type="checkbox" checked={selected.includes(e.id)} onChange={(ev) => setSelected(ev.target.checked ? [...selected, e.id] : selected.filter((x) => x !== e.id))} /></td>
                <td>{e.filename}</td>
                <td>{fmtDateTime(e.uploaded_at)}</td>
                <td><button className="link-btn" onClick={() => api.download(`/evidence/${e.id}`, e.filename)}>Preview</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {canSubmit && (
          <div className="card">
            <h2>Send completed work for independent review</h2>
            <FormError error={submit.error} />
            <div className="form-grid mt">
              <Field label="Submission date" required error={fieldError(submit.error, "submission_date")} help="If accepted, this date is the completion date. Reviewer waiting time never makes the assignee late.">
                <input type="date" className="input" max={todayISO()} value={submitDate} onChange={(e) => setSubmitDate(e.target.value)} />
              </Field>
              <Field label="Independent reviewer">
                <input className="input" readOnly value={t.reviewer ? `${t.reviewer.name} / ${t.reviewer.code}` : "Not assigned"} />
              </Field>
              <Field label="Submission note" className="full">
                <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
              </Field>
              <label className="check full">
                <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> Acceptance checklist confirmed: {t.checklist.join(", ") || "no checklist"}
              </label>
            </div>
            <div className="row between mt">
              <span className="muted">Next state: In review / not yet Completed</span>
              <Button
                variant="primary"
                disabled={submit.isPending || uploads.some((u) => u.state === "uploading")}
                onClick={() => submit.mutate({ submission_date: submitDate, note, evidence_ids: selected, checklist_confirmed: confirmed }, { onSuccess: () => toast("Sent for review") })}
              >
                Send for review
              </Button>
            </div>
          </div>
        )}
      </div>
      <div className="aside-panel">
        <h4>Evidence safeguards</h4>
        <p>Retry only the failed upload. Successful attachments and the draft note are kept.</p>
        <h4>Submission readiness</h4>
        <p>Required checklist and evidence must be present before sending for review. Future submission dates and reviewer-assignee conflicts block sending.</p>
        <h4>Versions</h4>
        <p>A new submission creates an immutable version linked to its files. Earlier versions stay linked to their decisions.</p>
      </div>
    </div>
  );
}

function ReviewPanel({ t, onDone }: { t: TaskDetail; onDone: () => void }) {
  const latest = t.submissions[0];
  const [mode, setMode] = useState<"accept" | "rework" | null>(null);
  const [failed, setFailed] = useState<string[]>([]);
  const [reason, setReason] = useState("Quality / missing required state");
  const [feedback, setFeedback] = useState("");
  const [reqChanged, setReqChanged] = useState(false);
  const review = useApiMutation<Record<string, unknown>>("post", `/tasks/${t.id}/review`);
  return (
    <div className="drawer-split">
      <div className="stack">
        <Callout title={`Submission v${latest?.version} / submitted ${fmtDate(latest?.submission_date)}`}>{latest?.note}</Callout>
        <div>
          <h4 className="mb">Deliverable evidence</h4>
          {t.evidence.length === 0 ? <p className="muted">No uploaded files attached to this task.</p> : t.evidence.map((e) => <div key={e.id}><button className="link-btn" onClick={() => api.download(`/evidence/${e.id}`, e.filename)}>{e.filename}</button></div>)}
        </div>
        <div>
          <h4 className="mb">Acceptance checklist</h4>
          {t.checklist.map((c) => (
            <label key={c} className="check">
              <input type="checkbox" checked={!failed.includes(c)} onChange={(e) => setFailed(e.target.checked ? failed.filter((f) => f !== c) : [...failed, c])} /> {c}
            </label>
          ))}
        </div>
        <FormError error={review.error} />
        {mode === "rework" && (
          <div className="form-grid">
            <Field label="Reason category" required>
              <select className="input" value={reason} onChange={(e) => setReason(e.target.value)}>
                <option>Quality / missing required state</option>
                <option>Quality / defect</option>
                <option>Brief not met</option>
                <option>Requirement changed</option>
              </select>
            </Field>
            <Field label="Requirement changed?" required>
              <select className="input" value={reqChanged ? "yes" : "no"} onChange={(e) => setReqChanged(e.target.value === "yes")}>
                <option value="no">No / quality rework</option>
                <option value="yes">Yes / approved requirement change</option>
              </select>
            </Field>
            <Field label="Feedback" required className="full" error={fieldError(review.error, "feedback")}>
              <textarea className="input" value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="Add error, retry and empty-screen states" />
            </Field>
            <p className="full small muted">Returning work does not move the due date. Failed criteria: {failed.join(", ") || "select unchecked items above"}.</p>
          </div>
        )}
        <div className="row between">
          <Button variant="danger" onClick={() => (mode === "rework" ? review.mutate({ decision: "rework", reason_category: reason, failed_criteria: failed, feedback, requirement_changed: reqChanged }, { onSuccess: () => { toast("Returned to rework"); onDone(); } }) : setMode("rework"))}>
            Send to rework
          </Button>
          <Button variant="primary" disabled={review.isPending} onClick={() => review.mutate({ decision: "accept" }, { onSuccess: () => { toast("Work accepted"); onDone(); } })}>
            Accept work
          </Button>
        </div>
      </div>
      <div className="aside-panel">
        <h4>Reviewer identity</h4>
        <p>You are not the task Owner or a Contributor.</p>
        <h4>Completion date</h4>
        <p>Accept records {fmtDate(latest?.submission_date)}, the accepted submission date. Reviewer waiting time does not create lateness.</p>
        <h4>Rework decision</h4>
        <p>Return requires a reason, feedback and the checklist items to fix. Earlier versions remain visible.</p>
      </div>
    </div>
  );
}

function DependenciesPanel({ t }: { t: TaskDetail }) {
  const [kind, setKind] = useState<"blocker" | "deadline">("blocker");
  const [category, setCategory] = useState("Internal dependency");
  const [description, setDescription] = useState("");
  const [since, setSince] = useState(todayISO());
  const [evidence, setEvidence] = useState("");
  const [validator, setValidator] = useState<Person | null>(null);
  const [newDate, setNewDate] = useState("");
  const blocker = useApiMutation<Record<string, unknown>>("post", `/tasks/${t.id}/blockers`);
  const deadline = useApiMutation<Record<string, unknown>>("post", `/tasks/${t.id}/deadline-changes`);
  const decideB = useApiMutation<{ id: number; decision: string; reason: string }>("post", (b) => `/blockers/${b.id}/decide`);
  const decideD = useApiMutation<{ id: number; decision: string; reason: string }>("post", (b) => `/deadline-changes/${b.id}/decide`);
  const { account } = useAuth();
  const me = account?.employee.id;
  const err = blocker.error ?? deadline.error ?? decideB.error ?? decideD.error;

  const decide = (fn: typeof decideB, id: number) => (decision: string, reason: string) =>
    fn.mutate({ id, decision, reason }, { onSuccess: () => toast(`Decision recorded: ${decision}`) });

  return (
    <div className="drawer-split">
      <div className="stack">
        <FormError error={err} />
        <h4>Validation history</h4>
        <table className="table">
          <thead><tr><th>Request</th><th>Requester</th><th>Validator</th><th>State</th><th /></tr></thead>
          <tbody>
            {t.blockers.length + t.deadline_changes.length === 0 && <tr><td colSpan={5} className="muted">No blockers or date changes.</td></tr>}
            {t.blockers.map((b) => (
              <tr key={`b${b.id}`}>
                <td><b>Blocker: {b.category}</b><div className="sub">{b.description}</div>{NOT_EXCLUDABLE.includes(b.category) && <div className="sub">Not excludable</div>}</td>
                <td>{b.requester?.name ?? "—"}</td>
                <td>{b.validator?.name ?? (b.source === "import" ? "Source tracker" : "—")}</td>
                <td><Badge status={b.state} /></td>
                <td>{b.state === "Pending" && b.validator?.id === me && <span className="row"><DecisionButton size="sm" variant="green" label="Validate" decision="validate" onDecide={decide(decideB, b.id)} /><DecisionButton size="sm" variant="danger" label="Reject" decision="reject" onDecide={decide(decideB, b.id)} /></span>}</td>
              </tr>
            ))}
            {t.deadline_changes.map((c) => (
              <tr key={`d${c.id}`}>
                <td><b>Date: {fmtDate(c.original_date, false)} &gt; {fmtDate(c.requested_date)}</b><div className="sub">{c.reason_category} / {c.comment}</div></td>
                <td>{c.requester?.name ?? "—"}</td>
                <td>{c.validator?.name ?? "—"}</td>
                <td><Badge status={c.state} /></td>
                <td>{c.state === "Pending" && c.validator?.id === me && <span className="row"><DecisionButton size="sm" variant="green" label="Validate" decision="validate" onDecide={decide(decideD, c.id)} /><DecisionButton size="sm" variant="danger" label="Reject" decision="reject" onDecide={decide(decideD, c.id)} /></span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {t.can_update && t.status !== "Completed" && (
          <div className="card">
            <h2>Report a blocker or request a new date</h2>
            <div className="seg mt mb">
              <button className={kind === "blocker" ? "active" : ""} onClick={() => setKind("blocker")}>Blocker</button>
              <button className={kind === "deadline" ? "active" : ""} onClick={() => setKind("deadline")}>Deadline change</button>
            </div>
            <div className="form-grid">
              <Field label={kind === "blocker" ? "Blocker category" : "Reason category"} required help={NOT_EXCLUDABLE.includes(category) ? "Not excludable: still counts as a work delay." : category === "Resource" ? "Resource exceptions require HOD validation." : "Excludable after independent validation."}>
                <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
                  {BLOCKERS.map((b) => <option key={b}>{b}</option>)}
                </select>
              </Field>
              {kind === "blocker" ? (
                <Field label="Blocked since" required error={fieldError(blocker.error, "blocked_since")}>
                  <input type="date" className="input" max={todayISO()} value={since} onChange={(e) => setSince(e.target.value)} />
                </Field>
              ) : (
                <Field label="Requested revised date" required help={`Original ${fmtDate(t.due_date)} remains in force until validated.`}>
                  <input type="date" className="input" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
                </Field>
              )}
              <Field label={kind === "blocker" ? "Description" : "Comment"} required className="full">
                <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
              </Field>
              <Field label="Evidence" required>
                <input className="input" value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="Linked dependency record + message" />
              </Field>
              <Field label="Validator" required error={fieldError(blocker.error ?? deadline.error, "validator_id")} help="Independent authorised manager. You cannot validate your own request.">
                <PersonPicker value={validator} onChange={setValidator} exclude={me ? [me] : []} />
              </Field>
            </div>
            <div className="row mt" style={{ justifyContent: "flex-end" }}>
              <Button
                variant="primary"
                onClick={() =>
                  kind === "blocker"
                    ? blocker.mutate({ category, description, blocked_since: since, evidence, validator_id: validator?.id }, { onSuccess: () => toast("Blocker sent for validation") })
                    : deadline.mutate({ requested_date: newDate, reason_category: category, comment: description, evidence, validator_id: validator?.id }, { onSuccess: () => toast("Date change sent for validation") })
                }
              >
                Request validation
              </Button>
            </div>
          </div>
        )}
      </div>
      <div className="aside-panel">
        <h4>No self-validation</h4>
        <p>The requester cannot approve their own blocker or date change.</p>
        <h4>Excludable after validation</h4>
        <p>Dependency, vendor, approval, reprioritisation, requirement change; resource requires HOD approval.</p>
        <h4>Not excludable</h4>
        <p>Own-team rework and technical issues still appear as work delays.</p>
        <h4>Scoring protection</h4>
        <p>Only validated changes alter the due date in force or the eligible On-time calculation.</p>
        <h4>Dependencies</h4>
        {t.dependencies.length ? t.dependencies.map((d) => <p key={d.id}>{d.code} {d.title} / {statusLabel(d.status)}</p>) : <p>No finish-to-start dependencies.</p>}
      </div>
    </div>
  );
}

function DiscussionPanel({ t }: { t: TaskDetail }) {
  const comments = useApiQuery<{ id: number; body: string; author: Person | null; created_at: string }[]>(`/tasks/${t.id}/comments`);
  const add = useApiMutation<{ body: string }>("post", `/tasks/${t.id}/comments`);
  const [body, setBody] = useState("");
  return (
    <div className="stack">
      {(comments.data ?? []).length === 0 && <p className="muted">No comments yet.</p>}
      {(comments.data ?? []).map((c) => (
        <div key={c.id} className="row" style={{ alignItems: "flex-start", flexWrap: "nowrap" }}>
          <PersonChip person={c.author} meta={fmtDateTime(c.created_at)} />
          <p style={{ margin: "0 0 0 8px" }}>{c.body}</p>
        </div>
      ))}
      <Field label="Write a comment">
        <textarea className="input" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add a note or link evidence." />
      </Field>
      <div>
        <Button variant="primary" disabled={!body.trim()} onClick={() => add.mutate({ body }, { onSuccess: () => setBody("") })}>Add comment</Button>
      </div>
    </div>
  );
}

function HistoryPanel({ t }: { t: TaskDetail }) {
  const events = useApiQuery<{ id: number; kind: string; summary: string; actor: Person | null; at: string }[]>(`/tasks/${t.id}/history`);
  return (
    <div className="stack">
      <h4>Submissions and decisions</h4>
      <table className="table">
        <thead><tr><th>Version / event</th><th>Date</th><th>Decision</th><th>Feedback</th></tr></thead>
        <tbody>
          {t.submissions.map((s) => {
            const r = t.reviews.find((x) => x.submission_id === s.id);
            return (
              <tr key={s.id}>
                <td><b>Submission v{s.version}</b><div className="sub">{s.note}{s.source === "import" ? " (migration)" : ""}</div></td>
                <td>{fmtDate(s.submission_date)}</td>
                <td>{r ? <Badge status={r.decision === "accept" ? "Completed" : "Rework"}>{r.decision === "accept" ? "Accepted" : "Rework"}</Badge> : <Badge status="In Review" />}</td>
                <td>{r?.feedback ?? "—"}</td>
              </tr>
            );
          })}
          {t.submissions.length === 0 && <tr><td colSpan={4} className="muted">No submissions yet.</td></tr>}
        </tbody>
      </table>
      <h4>Activity</h4>
      <table className="table">
        <thead><tr><th>Event</th><th>Actor</th><th>Time</th></tr></thead>
        <tbody>
          {(events.data ?? []).map((e) => (
            <tr key={e.id}><td>{e.summary}</td><td>{e.actor?.name ?? "System"}</td><td>{fmtDateTime(e.at)}</td></tr>
          ))}
        </tbody>
      </table>
      <p className="small muted">Important history is append-only and cannot be erased.</p>
    </div>
  );
}
