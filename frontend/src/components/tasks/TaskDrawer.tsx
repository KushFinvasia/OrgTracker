import { useQueryClient } from "@tanstack/react-query";
import { Check, Flag, Plus, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { api, ApiError } from "@/api/client";
import type { Person, TaskDetail } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { Avatar, Badge, Button, Callout, DecisionButton, Drawer, Field, FormError, Loading, PersonPicker, fieldError, toast } from "@/components/ui";
import { fmtDate, todayISO } from "@/lib/format";
import { useApiMutation, useApiQuery } from "@/lib/hooks";
import { statusLabel } from "@/lib/status";
import { BLOCKER_CATEGORIES, TASK_DATE_NOTE, WORKFLOW_STATUSES } from "@/lib/tasks";
import { StatusOptions } from "./TaskTracking";

type Mode = null | "dates" | "assign" | "submit" | "rework" | "blocker" | "date";
const PANEL_MODES: Record<string, Mode> = { submit: "submit", blocker: "blocker", date: "date", assign: "assign", dates: "dates", rework: "rework" };

/**
 * Task drawer: one view, no tabs. Facts, dates, an update section, one primary action by state, blockers and date changes,
 * and an "Edit assignees" link for managers. History lives in the project's Audit logs.
 */
export function TaskDrawer({ taskId, onClose, initialPanel }: { taskId: number | null; onClose: () => void; initialPanel?: string | null }) {
  const [mode, setMode] = useState<Mode>(null);
  useEffect(() => setMode((initialPanel && PANEL_MODES[initialPanel]) || null), [taskId, initialPanel]);
  const { data: t, isLoading, error } = useApiQuery<TaskDetail>(taskId ? `/tasks/${taskId}` : null);
  const toggle = (m: Mode) => setMode((cur) => (cur === m ? null : m));
  const timingLate = t?.timing === "Overdue" && t.due_date ? Math.round((Date.parse(todayISO()) - Date.parse(t.due_date)) / 86400000) : 0;

  return (
    <Drawer
      open={!!taskId}
      onClose={onClose}
      wide
      eyebrow={t ? `${t.code} · ${t.project?.title ?? ""}` : "Task"}
      title={t?.title ?? (error ? "Task unavailable" : "Loading")}
      sub={
        t ? (
          <span className="row" style={{ gap: 6, marginTop: 6 }}>
            <Badge status={t.status} />
            <Badge status={t.timing}>{t.timing}</Badge>
            {timingLate > 0 && <b className="bad-txt small">{timingLate} day{timingLate > 1 ? "s" : ""} overdue</b>}
            <span className="muted">·</span>
            <Avatar person={t.owner} size="sm" />
            <span>
              Owner <b>{t.owner?.name ?? "—"}</b>
              {t.assignments.length > 1 && ` +${t.assignments.length - 1}`}
            </span>
            <span className="muted">·</span>
            <span>
              Reviewer <b>{t.reviewer?.name ?? "—"}</b>
            </span>
          </span>
        ) : undefined
      }
      footer={
        t ? (
          <>
            <span className="note" style={{ marginRight: "auto" }}>
              History is in the project's {t.project ? <Link to={`/projects/${t.project.id}?tab=audit`} onClick={onClose}>Audit logs</Link> : "Audit logs"}.
            </span>
            <Button onClick={onClose}>Close</Button>
          </>
        ) : undefined
      }
    >
      {isLoading && <Loading />}
      {error && <div className="form-error">{error.message}</div>}
      {t && <TaskBody t={t} mode={mode} toggle={toggle} setMode={setMode} />}
    </Drawer>
  );
}

function TaskBody({ t, mode, toggle, setMode }: { t: TaskDetail; mode: Mode; toggle: (m: Mode) => void; setMode: (m: Mode) => void }) {
  const { account } = useAuth();
  const me = account?.employee.id;
  const tl = account?.role === "team_lead";
  const can = t.can_update;
  const closed = t.status === "Completed" || t.status === "Cancelled";
  const locked = WORKFLOW_STATUSES.includes(t.status);
  const moved = t.due_date_original && t.due_date_original !== t.due_date ? t.due_date_original : null;
  const canEditAssignees = !tl && can && t.status !== "Completed";
  return (
    <>
      {!can && <p className="small muted" style={{ marginBottom: 12 }}>Read-only: this task is outside the team you update.</p>}
      {t.data_flags && <Callout tone="warn" title="Source data to confirm">{t.data_flags}</Callout>}
      <div className="tfacts">
        <span>Start date <b>{fmtDate(t.start_date)}</b></span>
        <span>End date <b>{fmtDate(t.due_date)}</b>{moved && <span className="muted"> (moved from {fmtDate(moved, false)})</span>}</span>
        <span>Go live date <b>{fmtDate(t.go_live_date)}</b></span>
        <span>Actual working days <b>{t.working_days ?? "—"}</b></span>
        <span>Delay (No. of days) <b className={t.delay_days ? "bad-txt" : ""}>{t.delay_days ?? "—"}</b></span>
        <span>Status <Badge status={t.status} /></span>
        <span>Complexity <b>{t.complexity}</b></span>
        <span>Reported progress <b>{t.progress}%</b></span>
        {t.description && <span className="tdesc">{t.description}</span>}
      </div>
      <p className="note">{TASK_DATE_NOTE}</p>

      {can && !tl && !closed && (
        <section className="tsec">{mode === "dates" ? <DatesForm t={t} onDone={() => setMode(null)} /> : <button type="button" className="link-btn" onClick={() => toggle("dates")}>Edit dates</button>}</section>
      )}

      {mode === "assign" && <AssigneesForm t={t} onDone={() => setMode(null)} />}

      {can && !closed && <UpdateSection t={t} locked={locked} />}

      <PrimaryAction t={t} mode={mode} toggle={toggle} setMode={setMode} me={me} />

      <section className="tsec" style={{ paddingTop: 12 }}>
        <Dependencies t={t} me={me} mode={mode} />
        {can && !closed && (
          <div className="tlinks">
            <button type="button" className={`link-btn ${mode === "blocker" ? "on" : ""}`} onClick={() => toggle("blocker")}>Report a blocker</button>
            <span className="muted">·</span>
            <button type="button" className={`link-btn ${mode === "date" ? "on" : ""}`} onClick={() => toggle("date")}>Request a new date</button>
            {canEditAssignees && (
              <>
                <span className="muted">·</span>
                <button type="button" className={`link-btn ${mode === "assign" ? "on" : ""}`} onClick={() => toggle("assign")}>Edit assignees</button>
              </>
            )}
          </div>
        )}
        {(mode === "blocker" || mode === "date") && <DependencyForm t={t} kind={mode} me={me} onDone={() => setMode(null)} />}
      </section>
    </>
  );
}

function DatesForm({ t, onDone }: { t: TaskDetail; onDone: () => void }) {
  const [start, setStart] = useState(t.start_date ?? "");
  const [goLive, setGoLive] = useState(t.go_live_date ?? "");
  const save = useApiMutation<Record<string, unknown>>("patch", `/tasks/${t.id}`);
  return (
    <>
      <FormError error={save.error} />
      <div className="form-grid">
        <Field label="Start date" error={fieldError(save.error, "start_date")}>
          <input type="date" className="input" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="Go live date" error={fieldError(save.error, "go_live_date")} help="Release date, when known. Doesn't mark the task as accepted.">
          <input type="date" className="input" value={goLive} onChange={(e) => setGoLive(e.target.value)} />
        </Field>
      </div>
      <p className="note mt">To change the end date, use Request a new date below.</p>
      <div className="tsec-actions">
        <Button size="sm" onClick={onDone}>Cancel</Button>
        <Button size="sm" variant="primary" disabled={save.isPending} onClick={() => save.mutate({ version: t.version, start_date: start || null, go_live_date: goLive || null }, { onSuccess: () => { toast("Task dates saved"); onDone(); } })}>Save dates</Button>
      </div>
    </>
  );
}

function UpdateSection({ t, locked }: { t: TaskDetail; locked: boolean }) {
  const [form, setForm] = useState({ status: t.status, progress: t.progress, next_action: t.next_action ?? "" });
  useEffect(() => setForm({ status: t.status, progress: t.progress, next_action: t.next_action ?? "" }), [t]);
  const save = useApiMutation<Record<string, unknown>>("patch", `/tasks/${t.id}`);
  const submitted = t.status === "In Review";
  return (
    <section className="tsec">
      <h3>Update</h3>
      {locked && (
        <p className="tlock">
          <Flag size={13} /> Status <b>{statusLabel(t.status)}</b> is set by the review workflow.
        </p>
      )}
      <FormError error={save.error} />
      <div className={`tgrid ${locked ? "locked" : ""} ${submitted ? "nostat" : ""}`}>
        {!locked && (
          <Field label="Status" error={fieldError(save.error, "status")}>
            <select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              <StatusOptions />
            </select>
          </Field>
        )}
        {!submitted && (
          <Field label="Progress %" help="Planning only; 100% never means accepted">
            <input type="number" min={0} max={100} className="input" value={form.progress} onChange={(e) => setForm({ ...form, progress: Number(e.target.value) })} />
          </Field>
        )}
        <Field label="Next action">
          <input className="input" value={form.next_action} placeholder="What happens next" onChange={(e) => setForm({ ...form, next_action: e.target.value })} />
        </Field>
        <div className="tsave">
          <Button
            size="sm"
            disabled={save.isPending}
            onClick={() => {
              const body: Record<string, unknown> = { version: t.version, next_action: form.next_action };
              if (!submitted && form.progress !== t.progress) body.progress = form.progress;
              if (!locked && form.status !== t.status) body.status = form.status;
              save.mutate(body, { onSuccess: () => toast("Task updated") });
            }}
          >
            Save update
          </Button>
        </div>
      </div>
    </section>
  );
}

function PrimaryAction({ t, mode, toggle, setMode, me }: { t: TaskDetail; mode: Mode; toggle: (m: Mode) => void; setMode: (m: Mode) => void; me?: number }) {
  const sub = t.submissions[0];
  const lastRework = t.reviews.find((r) => r.decision === "rework");
  if (t.status === "Completed")
    return (
      <section className="tsec">
        <Callout tone="ok" title={`Completed on ${fmtDate(t.accepted_submission_date)}`}>
          {t.accepted_submission_date && t.due_date && t.accepted_submission_date > t.due_date ? <span className="bad-txt">after the due date</span> : "on time"}. Reviewed by {t.reviewer?.name ?? "—"}; the accepted submission's date is the completion date.
        </Callout>
      </section>
    );
  if (t.status === "In Review" && sub) {
    if (t.is_reviewer && t.reviewer?.id === me) return <ReviewSection t={t} mode={mode} toggle={toggle} onDone={() => setMode(null)} />;
    return (
      <section className="tsec">
        <p className="small muted">Waiting for {t.reviewer?.name ?? "the reviewer"} to review v{sub?.version}, submitted {fmtDate(sub?.submission_date)}. Only the named reviewer can accept or send it to rework.</p>
      </section>
    );
  }
  // Migrated work sits in In Review with no submission (legacy Completed isn't accepted output) until the team sends it.
  if (t.status === "In Review" && !t.can_update)
    return <section className="tsec"><p className="small muted">This task was migrated without a submission, so there is nothing to review until the team sends it for review.</p></section>;
  if (!t.can_update || t.status === "Cancelled") return null;
  return (
    <section className="tsec">
      {t.status === "In Review" && <div style={{ marginBottom: 12 }}><Callout tone="warn" title="No submission yet:">this task was migrated as In review without one. Send it for review so its reviewer can decide.</Callout></div>}
      {lastRework && t.status === "Rework" && (
        <div style={{ marginBottom: 12 }}>
          <Callout tone="warn" title={`Returned for rework ${fmtDate(lastRework.decided_at, false)}:`}>{lastRework.feedback}</Callout>
        </div>
      )}
      {mode === "submit" ? (
        <SubmitForm t={t} onDone={() => setMode(null)} />
      ) : (
        <div className="tsec-actions start">
          <Button variant="primary" onClick={() => toggle("submit")}>Send for review</Button>
          <span className="note">Creates an immutable version for {t.reviewer?.name ?? "the independent reviewer"} to review.</span>
        </div>
      )}
    </section>
  );
}

function SubmitForm({ t, onDone }: { t: TaskDetail; onDone: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const [selected, setSelected] = useState<number[]>(t.evidence.slice(0, 1).map((e) => e.id));
  const [uploads, setUploads] = useState<{ name: string; state: "uploading" | "failed" | "done"; file?: File; error?: string }[]>([]);
  const [subDate, setSubDate] = useState(todayISO());
  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const submit = useApiMutation<Record<string, unknown>>("post", `/tasks/${t.id}/submit`);
  const upload = async (file: File) => {
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
  return (
    <>
      <h3>Send for review</h3>
      <div className="tsub">
        <FormError error={submit.error} />
        {t.required_evidence && <p className="small"><b>Required evidence:</b> {t.required_evidence}</p>}
        <Field label="Evidence files" required={!!t.required_evidence} error={fieldError(submit.error, "evidence_ids")}>
          <div>
            {t.evidence.length === 0 && <span className="note">No files yet.</span>}
            {t.evidence.map((e) => (
              <label key={e.id} className="check">
                <input type="checkbox" checked={selected.includes(e.id)} onChange={(ev) => setSelected(ev.target.checked ? [...selected, e.id] : selected.filter((x) => x !== e.id))} /> {e.filename} <span className="muted small">{fmtDate(e.uploaded_at, false)}</span>
              </label>
            ))}
            {uploads.filter((u) => u.state !== "done").map((u) => (
              <div key={u.name} className="row small">
                {u.name} {u.state === "uploading" ? <Badge tone="amber">Uploading</Badge> : (
                  <>
                    <Badge tone="red">{u.error}</Badge>
                    <Button size="sm" onClick={() => u.file && upload(u.file)}>Retry upload</Button>
                  </>
                )}
              </div>
            ))}
            <div className="mt">
              <Button size="sm" onClick={() => inputRef.current?.click()}><Upload size={14} /> Upload file</Button>
              <input ref={inputRef} type="file" multiple hidden onChange={(e) => Array.from(e.target.files ?? []).forEach(upload)} />
            </div>
          </div>
        </Field>
        {t.checklist.length > 0 && (
          <label className="check">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> I checked the acceptance checklist: {t.checklist.join("; ")}
          </label>
        )}
        {fieldError(submit.error, "checklist_confirmed") && <span className="error small">{fieldError(submit.error, "checklist_confirmed")}</span>}
        <div className="tgrid">
          <Field label="Submission date" required error={fieldError(submit.error, "submission_date")} help="No future dates. If accepted, this is the completion date.">
            <input type="date" className="input" max={todayISO()} value={subDate} onChange={(e) => setSubDate(e.target.value)} />
          </Field>
          <Field label="Note for the reviewer">
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
        <div className="tsec-actions">
          <Button size="sm" onClick={onDone}>Cancel</Button>
          <Button size="sm" variant="primary" disabled={submit.isPending || uploads.some((u) => u.state === "uploading")} onClick={() => submit.mutate({ submission_date: subDate, note, evidence_ids: selected, checklist_confirmed: confirmed || t.checklist.length === 0 }, { onSuccess: () => { toast("Sent for review as an immutable version"); onDone(); } })}>
            Send for review
          </Button>
        </div>
      </div>
    </>
  );
}

function ReviewSection({ t, mode, toggle, onDone }: { t: TaskDetail; mode: Mode; toggle: (m: Mode) => void; onDone: () => void }) {
  const sub = t.submissions[0];
  const [failed, setFailed] = useState<string[]>([]);
  const [feedback, setFeedback] = useState("");
  const [reqChanged, setReqChanged] = useState(false);
  const review = useApiMutation<Record<string, unknown>>("post", `/tasks/${t.id}/review`);
  const files = t.evidence.filter((e) => sub?.evidence_ids.includes(e.id));
  return (
    <section className="tsec">
      <h3>Review submission v{sub?.version}</h3>
      <p className="small">
        Submitted {fmtDate(sub?.submission_date)} · {files.length ? files.map((f) => (
          <button key={f.id} type="button" className="link-btn" onClick={() => api.download(`/evidence/${f.id}`, f.filename)}>{f.filename} </button>
        )) : "no files"}
      </p>
      {sub?.note && <p className="small muted">“{sub.note}”</p>}
      <FormError error={review.error} />
      {mode === "rework" ? (
        <div className="tsub">
          <Field label="Which criteria failed?" error={fieldError(review.error, "feedback") ? null : undefined}>
            <div>
              {t.checklist.length === 0 && <span className="note">No checklist on this task.</span>}
              {t.checklist.map((c) => (
                <label key={c} className="check">
                  <input type="checkbox" checked={failed.includes(c)} onChange={(e) => setFailed(e.target.checked ? [...failed, c] : failed.filter((x) => x !== c))} /> {c}
                </label>
              ))}
            </div>
          </Field>
          <Field label="Feedback for the assignee" required error={fieldError(review.error, "feedback")}>
            <textarea className="input" value={feedback} placeholder="What to change, and how you'll check it" onChange={(e) => setFeedback(e.target.value)} />
          </Field>
          <label className="check">
            <input type="checkbox" checked={reqChanged} onChange={(e) => setReqChanged(e.target.checked)} /> The requirement changed (excluded from Quality)
          </label>
          <div className="tsec-actions">
            <Button size="sm" onClick={() => toggle("rework")}>Cancel</Button>
            <Button
              size="sm"
              variant="danger"
              disabled={review.isPending}
              onClick={() =>
                review.mutate(
                  {
                    decision: "rework",
                    reason_category: reqChanged ? "Requirement changed" : failed.length ? "Acceptance criterion not met" : "Quality issue",
                    failed_criteria: failed.length ? failed : reqChanged ? ["Requirement changed"] : [],
                    feedback,
                    requirement_changed: reqChanged,
                  },
                  { onSuccess: () => { toast("Sent to rework. The due date doesn't move; earlier versions are kept."); onDone(); } },
                )
              }
            >
              Send to rework
            </Button>
          </div>
        </div>
      ) : (
        <div className="tsec-actions start">
          <Button variant="primary" disabled={review.isPending} onClick={() => review.mutate({ decision: "accept" }, { onSuccess: () => toast(`Work accepted. Completion date ${fmtDate(sub?.submission_date)}.`) })}>
            <Check size={15} /> Accept work
          </Button>
          <Button onClick={() => toggle("rework")}>Send to rework</Button>
          <span className="note">Accept dates completion {fmtDate(sub?.submission_date, false)}, the submission date.</span>
        </div>
      )}
    </section>
  );
}

function Dependencies({ t, me, mode }: { t: TaskDetail; me?: number; mode: Mode }) {
  const decideB = useApiMutation<{ id: number; decision: string; reason: string }>("post", (b) => `/blockers/${b.id}/decide`);
  const decideD = useApiMutation<{ id: number; decision: string; reason: string }>("post", (b) => `/deadline-changes/${b.id}/decide`);
  const rows = [
    ...t.blockers.filter((b) => b.state !== "Rejected").map((b) => ({ key: `b${b.id}`, kind: "Blocker", id: b.id, state: b.state, validator: b.validator, requester: b.requester, text: `${b.category}${BLOCKER_CATEGORIES[b.category] === false ? " (not excludable)" : ""} · since ${fmtDate(b.blocked_since, false)}`, fn: decideB })),
    ...t.deadline_changes.filter((c) => c.state !== "Rejected").map((c) => ({ key: `d${c.id}`, kind: "New date", id: c.id, state: c.state, validator: c.validator, requester: c.requester, text: `${fmtDate(c.original_date, false)} → ${fmtDate(c.requested_date, false)} · ${c.reason_category}`, fn: decideD })),
  ];
  if (!rows.length && !mode) return null;
  return (
    <>
      <FormError error={decideB.error ?? decideD.error} />
      {rows.map((r) => (
        <div key={r.key} className="tdep">
          <span>
            <Badge status={r.state} /> <b>{r.kind}</b> · {r.text} <span className="muted">· validator {r.validator?.name ?? "—"}</span>
          </span>
          {r.state === "Pending" && r.validator?.id === me && r.requester?.id !== me && (
            <span className="row">
              <DecisionButton size="sm" variant="green" label="Validate" decision="validate" onDecide={(decision, reason) => r.fn.mutate({ id: r.id, decision, reason }, { onSuccess: () => toast("Validated") })} />
              <DecisionButton size="sm" variant="danger" label="Reject" decision="reject" onDecide={(decision, reason) => r.fn.mutate({ id: r.id, decision, reason }, { onSuccess: () => toast("Rejected with a reason") })} />
            </span>
          )}
        </div>
      ))}
    </>
  );
}

function DependencyForm({ t, kind, me, onDone }: { t: TaskDetail; kind: "blocker" | "date"; me?: number; onDone: () => void }) {
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [since, setSince] = useState(todayISO());
  const [newDate, setNewDate] = useState("");
  const [evidence, setEvidence] = useState("");
  const [validator, setValidator] = useState<Person | null>(null);
  const blocker = useApiMutation<Record<string, unknown>>("post", `/tasks/${t.id}/blockers`);
  const deadline = useApiMutation<Record<string, unknown>>("post", `/tasks/${t.id}/deadline-changes`);
  const err = blocker.error ?? deadline.error;
  return (
    <div className="tsub">
      <FormError error={err} />
      <div className="tgrid">
        <Field label="Category" required error={fieldError(err, kind === "blocker" ? "category" : "reason_category")} help={category ? (BLOCKER_CATEGORIES[category] ? (category === "Resource" ? "Excludable once the HOD validates it." : "Excludable once validated.") : "Not excludable: still counts as a delay.") : undefined}>
          <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Choose…</option>
            {Object.keys(BLOCKER_CATEGORIES).map((c) => <option key={c}>{c}</option>)}
          </select>
        </Field>
        {kind === "blocker" ? (
          <Field label="Blocked since" required error={fieldError(err, "blocked_since")}>
            <input type="date" className="input" max={todayISO()} value={since} onChange={(e) => setSince(e.target.value)} />
          </Field>
        ) : (
          <Field label="New due date" required help={`${fmtDate(t.due_date, false)} stays in force until validated.`} error={fieldError(err, "requested_date")}>
            <input type="date" className="input" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
          </Field>
        )}
        <Field label="Short reason" required className="full" error={fieldError(err, kind === "blocker" ? "description" : "comment")}>
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="Evidence" required error={fieldError(err, "evidence")}>
          <input className="input" value={evidence} placeholder="Ticket, email or record" onChange={(e) => setEvidence(e.target.value)} />
        </Field>
        <Field label="Validator" required help="Not you" error={fieldError(err, "validator_id")}>
          <PersonPicker value={validator} onChange={setValidator} exclude={me ? [me] : []} />
        </Field>
      </div>
      <div className="tsec-actions">
        <Button size="sm" onClick={onDone}>Cancel</Button>
        <Button
          size="sm"
          variant="primary"
          disabled={blocker.isPending || deadline.isPending}
          onClick={() => {
            const done = { onSuccess: () => { toast("Sent for independent validation. Nothing changes until it is validated."); onDone(); } };
            if (kind === "blocker") blocker.mutate({ category, description, blocked_since: since, evidence, validator_id: validator?.id }, done);
            else deadline.mutate({ requested_date: newDate || null, reason_category: category, comment: description, evidence, validator_id: validator?.id }, done);
          }}
        >
          Send for validation
        </Button>
      </div>
    </div>
  );
}

function AssigneesForm({ t, onDone }: { t: TaskDetail; onDone: () => void }) {
  const [rows, setRows] = useState(t.assignments.map((a) => ({ person: a.employee as Person | null, role: a.role as string, share: a.share })));
  const [reviewer, setReviewer] = useState<Person | null>(t.reviewer);
  const [reason, setReason] = useState("");
  const save = useApiMutation<Record<string, unknown>>("put", `/tasks/${t.id}/assignments`);
  const total = rows.reduce((s, r) => s + Number(r.share || 0), 0);
  const ids = rows.map((r) => r.person?.id).filter(Boolean) as number[];
  return (
    <section className="tsec tsec-open">
      <h3>Edit assignees</h3>
      <FormError error={save.error} />
      {rows.map((r, i) => (
        <div key={i} className="row" style={{ marginBottom: 8, flexWrap: "nowrap" }}>
          <select className="select-sm" value={r.role} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)))}>
            <option>Owner</option>
            <option>Contributor</option>
          </select>
          <div style={{ flex: 1, minWidth: 0 }}>
            <PersonPicker value={r.person} onChange={(p) => setRows(rows.map((x, j) => (j === i ? { ...x, person: p } : x)))} />
          </div>
          <input type="number" className="mini-in" aria-label="Contribution share %" value={r.share} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, share: Number(e.target.value) } : x)))} />%
          {rows.length > 1 && (
            <button type="button" className="icon-btn" aria-label="Remove" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
              <X size={15} />
            </button>
          )}
        </div>
      ))}
      <div className="row">
        <Button size="sm" onClick={() => setRows([...rows, { person: null, role: "Contributor", share: 0 }])}><Plus size={14} /> Add contributor</Button>
        <span className={`note ${total === 100 ? "ok-txt" : "warn-txt"}`}>Shares total {total}% · exactly one Owner</span>
      </div>
      <div className="form-grid mt">
        <Field label="Independent reviewer" required error={reviewer && ids.includes(reviewer.id) ? "The reviewer is an assignee. Choose another person." : fieldError(save.error, "reviewer_id")} help="Can't be any assignee">
          <PersonPicker value={reviewer} onChange={setReviewer} exclude={ids} />
        </Field>
        <Field label="Change reason" required error={fieldError(save.error, "reason")}>
          <input className="input" value={reason} placeholder="Split design and integration work" onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
      <div className="tsec-actions">
        <Button size="sm" onClick={onDone}>Cancel</Button>
        <Button
          size="sm"
          variant="primary"
          disabled={save.isPending}
          onClick={() =>
            save.mutate(
              { version: t.version, reviewer_id: reviewer?.id, reason, assignments: rows.filter((r) => r.person).map((r) => ({ employee_id: r.person!.id, role: r.role, share: Number(r.share) })) },
              { onSuccess: () => { toast("Assignments saved"); onDone(); } },
            )
          }
        >
          Save assignees
        </Button>
      </div>
    </section>
  );
}
