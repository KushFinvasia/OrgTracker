import { useState } from "react";

import { api } from "@/api/client";
import type { Person, TrainingAssignment } from "@/api/types";
import { Badge, Button, Callout, DecisionButton, Drawer, Field, FormError, Kv, PersonPicker, Tabs, fieldError, toast } from "@/components/ui";
import { fmtDate, fmtDateTime, todayISO } from "@/lib/format";
import { useApiMutation, useApiQuery } from "@/lib/hooks";
import { useQueryClient } from "@tanstack/react-query";

interface Course {
  id: number;
  code: string;
  version: number;
  title: string;
  course_type: string;
  completion_criteria: string;
  pass_mark: number | null;
  duration_hours: number | null;
  state: string;
}

interface Outcome {
  employee?: Person;
  employee_id?: number;
  result: string;
  message?: string;
  code?: string;
}

export function AssignTrainingDrawer({ people, periodId, onClose }: { people: Person[]; periodId?: number; onClose: () => void }) {
  const courses = useApiQuery<Course[]>("/training/courses");
  const [selected, setSelected] = useState<number[]>(people.map((p) => p.id));
  const [form, setForm] = useState({ course_id: "", assigned_date: todayISO(), due_date: "", training_type: "Mandatory", completion_criteria: "", pass_mark: "" });
  const [verifier, setVerifier] = useState<Person | null>(null);
  const [outcomes, setOutcomes] = useState<Outcome[] | null>(null);
  const assign = useApiMutation<Record<string, unknown>, { outcomes: Outcome[] }>("post", "/training/assignments");
  const course = (courses.data ?? []).find((c) => String(c.id) === form.course_id);
  const body = (preview: boolean) => ({
    employee_ids: selected,
    course_id: Number(form.course_id),
    assigned_date: form.assigned_date,
    due_date: form.due_date,
    training_type: form.training_type,
    verifier_id: verifier?.id,
    period_id: periodId ?? null,
    completion_criteria: form.completion_criteria || null,
    pass_mark: form.pass_mark ? Number(form.pass_mark) : null,
    preview,
  });

  return (
    <Drawer
      open
      onClose={onClose}
      wide
      eyebrow="Person > Training > Assign training"
      title="Assign training to a person or reporting team"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <span className="row">
            <Button onClick={() => assign.mutate(body(true), { onSuccess: (r) => setOutcomes(r.outcomes) })}>Preview recipients</Button>
            <Button variant="primary" onClick={() => assign.mutate(body(false), { onSuccess: (r) => { setOutcomes(r.outcomes); toast(`${r.outcomes.filter((o) => o.result === "assigned").length} assigned`); } })}>Assign training</Button>
          </span>
        </>
      }
    >
      <FormError error={assign.error} />
      <div className="drawer-split">
        <div className="form-grid">
          <Field label="Training / course" required className="full" error={fieldError(assign.error, "course_id")}>
            <select className="input" value={form.course_id} onChange={(e) => setForm({ ...form, course_id: e.target.value })}>
              <option value="">Choose an approved catalog course</option>
              {(courses.data ?? []).filter((c) => c.state === "Approved").map((c) => <option key={c.id} value={c.id}>{c.code} v{c.version} / {c.title} / {c.course_type}</option>)}
            </select>
          </Field>
          <Field label="Employee / group" required className="full">
            <div className="stack" style={{ gap: 6 }}>
              {people.map((p) => (
                <label key={p.id} className="check"><input type="checkbox" checked={selected.includes(p.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, p.id] : selected.filter((x) => x !== p.id))} /> {p.name} / {p.code}</label>
              ))}
            </div>
          </Field>
          <Field label="Assigned date" required><input type="date" className="input" value={form.assigned_date} onChange={(e) => setForm({ ...form, assigned_date: e.target.value })} /></Field>
          <Field label="Due date" required error={fieldError(assign.error, "due_date")} help="Due date determines period eligibility."><input type="date" className="input" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></Field>
          <Field label="Training type" required>
            <select className="input" value={form.training_type} onChange={(e) => setForm({ ...form, training_type: e.target.value })}><option>Mandatory</option><option>Role-based</option><option>Optional</option></select>
          </Field>
          <Field label="Independent verifier" required help="Must differ from the person recording completion.">
            <PersonPicker value={verifier} onChange={setVerifier} exclude={selected} />
          </Field>
          <Field label="Completion criteria" required><input className="input" value={form.completion_criteria} placeholder={course?.completion_criteria ?? "From catalog"} onChange={(e) => setForm({ ...form, completion_criteria: e.target.value })} /></Field>
          <Field label="Pass requirement %"><input type="number" className="input" value={form.pass_mark} placeholder={course?.pass_mark ? String(course.pass_mark) : "Policy setting"} onChange={(e) => setForm({ ...form, pass_mark: e.target.value })} /></Field>
        </div>
        <div className="aside-panel">
          <h4>Assignment identity</h4>
          <p>One employee-course occurrence per assignment ID. Retakes are attempts, not additional denominator entries.</p>
          <h4>Scope</h4>
          <p>Managers assign within their reporting tree. Scoring decisions stay with authorised managers.</p>
          {outcomes && (
            <>
              <h4>Per-person outcome</h4>
              {outcomes.map((o, i) => (
                <div key={i} className="row between">
                  <span>{o.employee?.name ?? `#${o.employee_id}`}</span>
                  <Badge tone={o.result === "assigned" || o.result === "ready" ? "green" : o.result === "skipped" ? "amber" : "red"}>{o.result}{o.message ? `: ${o.message}` : ""}</Badge>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </Drawer>
  );
}

export function TrainingRecordDrawer({ assignmentId, onClose, canRecord }: { assignmentId: number; onClose: () => void; canRecord: boolean }) {
  const qc = useQueryClient();
  const { data: a } = useApiQuery<TrainingAssignment>(`/training/assignments/${assignmentId}`);
  const [tab, setTab] = useState<"progress" | "verify" | "exception" | "history">("progress");
  const [form, setForm] = useState<Record<string, string | number | boolean | null>>({});
  const [exc, setExc] = useState({ exception_type: "Exemption", reason: "", evidence: "", proposed_due_date: "", effective_date: todayISO() });
  const [approver, setApprover] = useState<Person | null>(null);
  const update = useApiMutation<Record<string, unknown>>("patch", `/training/assignments/${assignmentId}`);
  const submit = useApiMutation<Record<string, never>>("post", `/training/assignments/${assignmentId}/submit`);
  const verify = useApiMutation<{ decision: string; reason?: string }>("post", `/training/assignments/${assignmentId}/verify`);
  const exception = useApiMutation<Record<string, unknown>>("post", `/training/assignments/${assignmentId}/exceptions`);
  const decideExc = useApiMutation<{ id: number; decision: string; reason: string }>("post", (b) => `/training/exceptions/${b.id}/decide`);
  const attempt = useApiMutation<Record<string, unknown>>("post", `/training/assignments/${assignmentId}/attempts`);
  const err = update.error ?? submit.error ?? verify.error ?? exception.error ?? decideExc.error ?? attempt.error;
  if (!a) return null;
  const val = (k: keyof TrainingAssignment) => (form[k as string] ?? a[k] ?? "") as string;
  const editable = canRecord && ["Assigned", "In progress", "Returned"].includes(a.status);

  return (
    <Drawer open onClose={onClose} wide eyebrow={`${a.code} / ${a.employee.name}`} title={a.course.title}>
      <div className="row mb">
        <Badge status={a.display_status} />
        {a.overdue && <Badge tone="red">Overdue</Badge>}
        <span className="muted">Due {fmtDate(a.due_date)}{a.due_date !== a.due_date_original ? ` (original ${fmtDate(a.due_date_original)})` : ""}</span>
        {a.illustrative && <Badge tone="grey">Illustrative</Badge>}
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "progress", label: "Progress & evidence" }, { id: "verify", label: "Verification", hidden: !a.can_verify && a.status !== "Verified complete" }, { id: "exception", label: "Exception" }, { id: "history", label: "History" }]} />
      <FormError error={err} />
      <div className="drawer-split">
        <div className="stack">
          {tab === "progress" && (
            <>
              <div className="form-grid">
                <Field label="Training status" required>
                  <select className="input" disabled={!editable} value={val("status")} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                    {editable ? ["Assigned", "In progress"].map((s) => <option key={s}>{s}</option>) : <option>{a.status}</option>}
                  </select>
                </Field>
                <Field label="Reported progress %" help="A 100% update or attendance alone does not verify the assignment.">
                  <input type="number" min={0} max={100} className="input" disabled={!editable} value={val("progress")} onChange={(e) => setForm({ ...form, progress: Number(e.target.value) })} />
                </Field>
                <Field label="Completion date" required error={fieldError(err, "completion_date")}>
                  <input type="date" max={todayISO()} className="input" disabled={!editable} value={val("completion_date")} onChange={(e) => setForm({ ...form, completion_date: e.target.value })} />
                </Field>
                <Field label={`Assessment result %${a.pass_mark ? ` / pass ${a.pass_mark}%` : ""}`} error={fieldError(err, "assessment_result")}>
                  <input type="number" className="input" disabled={!editable} value={val("assessment_result")} onChange={(e) => setForm({ ...form, assessment_result: Number(e.target.value) })} />
                </Field>
                <label className="check full"><input type="checkbox" disabled={!editable} checked={Boolean(form.attendance_ok ?? a.attendance_ok)} onChange={(e) => setForm({ ...form, attendance_ok: e.target.checked })} /> Required sessions attended</label>
                <Field label="Certificate / evidence note" required className="full" error={fieldError(err, "evidence")}>
                  <input className="input" disabled={!editable} value={val("evidence_note")} onChange={(e) => setForm({ ...form, evidence_note: e.target.value })} placeholder="Certificate + attendance record" />
                </Field>
                {editable && (
                  <Field label="Upload evidence" className="full">
                    <input type="file" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { try { await api.upload(`/training/assignments/${a.id}/evidence`, f); toast("Evidence uploaded"); void qc.invalidateQueries(); } catch { toast("Upload failed. Retry the file.", true); } } }} />
                  </Field>
                )}
              </div>
              {a.evidence.length > 0 && <p>Files: {a.evidence.map((f) => <button key={f.id} className="link-btn" style={{ marginRight: 10 }} onClick={() => api.download(`/evidence/${f.id}`, f.filename)}>{f.filename}</button>)}</p>}
              {editable && (
                <div className="row between">
                  <Button onClick={() => update.mutate(form, { onSuccess: () => { setForm({}); toast("Training record saved"); } })}>Save progress</Button>
                  <Button variant="primary" onClick={() => update.mutate(form, { onSuccess: () => submit.mutate({}, { onSuccess: () => { setForm({}); toast("Sent for verification"); } }) })}>Send for verification</Button>
                </div>
              )}
              {editable && (
                <Button size="sm" onClick={() => attempt.mutate({ attempt_date: todayISO(), result: form.assessment_result ?? null, note: "Retake recorded" }, { onSuccess: () => toast("Attempt recorded on the same assignment") })}>
                  Record retake attempt
                </Button>
              )}
            </>
          )}
          {tab === "verify" && (
            <>
              <Kv
                items={[
                  ["Completion criteria", a.completion_criteria],
                  ["Completed", fmtDate(a.completion_date)],
                  ["Assessment", a.assessment_result !== null ? `${a.assessment_result}%${a.pass_mark ? ` / pass requirement ${a.pass_mark}%` : ""}` : "—"],
                  ["Attendance", a.attendance_ok ? "Required sessions attended" : "Not recorded"],
                  ["Evidence", a.evidence_note ?? (a.evidence.length ? `${a.evidence.length} file(s)` : "—")],
                  ["Recorded by", a.recorded_by?.name ?? "—"],
                  ["Verified", a.verified_by ? `${a.verified_by.name} / ${fmtDateTime(a.verified_at)}` : "—"],
                ]}
              />
              {a.can_verify && (
                <div className="row between">
                  <DecisionButton label="Return evidence" decision="return" variant="danger" onDecide={(d, reason) => verify.mutate({ decision: d, reason }, { onSuccess: () => toast("Evidence returned") })} />
                  <DecisionButton label="Verify complete" decision="verify" variant="primary" reasonRequired={false} title="Verify the training outcome" onDecide={(d, reason) => verify.mutate({ decision: d, reason }, { onSuccess: () => toast("Verified complete") })} />
                </div>
              )}
            </>
          )}
          {tab === "exception" && (
            <>
              {a.exceptions.map((x) => (
                <div key={x.id} className="card" style={{ padding: 14 }}>
                  <div className="row between"><b>{x.type}</b><Badge status={x.state} /></div>
                  <p className="small">{x.reason} / approver {x.approver?.name}{x.proposed_due_date ? ` / proposed ${fmtDate(x.proposed_due_date)}` : ""}</p>
                  {x.decision_note && <p className="small muted">Decision: {x.decision_note}</p>}
                  {x.state === "Pending" && (
                    <span className="row">
                      <DecisionButton size="sm" variant="green" label="Approve" decision="approve" onDecide={(d, reason) => decideExc.mutate({ id: x.id, decision: d, reason })} />
                      <DecisionButton size="sm" variant="danger" label="Reject" decision="reject" onDecide={(d, reason) => decideExc.mutate({ id: x.id, decision: d, reason })} />
                    </span>
                  )}
                </div>
              ))}
              {canRecord && !["Verified complete", "Exempt", "Cancelled"].includes(a.status) && (
                <div className="form-grid">
                  <Field label="Exception type" required>
                    <select className="input" value={exc.exception_type} onChange={(e) => setExc({ ...exc, exception_type: e.target.value })}><option>Exemption</option><option>Cancellation</option><option>Due-date change</option></select>
                  </Field>
                  {exc.exception_type === "Due-date change" && <Field label="Proposed due date" required><input type="date" className="input" value={exc.proposed_due_date} onChange={(e) => setExc({ ...exc, proposed_due_date: e.target.value })} /></Field>}
                  <Field label="Effective date" required><input type="date" className="input" value={exc.effective_date} onChange={(e) => setExc({ ...exc, effective_date: e.target.value })} /></Field>
                  <Field label="Independent approver" required error={fieldError(exception.error, "approver_id")}><PersonPicker value={approver} onChange={setApprover} placeholder="HOD / authorised policy approver" /></Field>
                  <Field label="Reason" required className="full"><input className="input" value={exc.reason} onChange={(e) => setExc({ ...exc, reason: e.target.value })} placeholder="Role transfer makes training inapplicable" /></Field>
                  <Field label="Evidence" required className="full"><input className="input" value={exc.evidence} onChange={(e) => setExc({ ...exc, evidence: e.target.value })} placeholder="Effective-dated transfer record" /></Field>
                  <div className="full"><Button variant="primary" onClick={() => exception.mutate({ ...exc, proposed_due_date: exc.proposed_due_date || null, approver_id: approver?.id }, { onSuccess: () => toast("Exception requested") })}>Request exception</Button></div>
                </div>
              )}
            </>
          )}
          {tab === "history" && (
            <>
              <h4>Attempts</h4>
              {a.attempts.length === 0 ? <p className="muted">Attempt 1 / original assignment.</p> : a.attempts.map((t) => <p key={t.attempt_no}>Attempt {t.attempt_no}: {t.result ?? "—"}% / {fmtDate(t.date)} / {t.note}</p>)}
              <Kv items={[["Course version", `${a.course.code} v${a.course.version}`], ["Assigned", fmtDate(a.assigned_date)], ["Verifier", a.verifier?.name ?? "—"], ["Verification note", a.verification_note ?? "—"]]} />
            </>
          )}
        </div>
        <div className="aside-panel">
          <h4>No employee sign-in</h4>
          <p>Managers (and permitted Team Leads) record progress and evidence on the employee's behalf.</p>
          <h4>Progress vs completion</h4>
          <p>Completion for scoring means verified completion by the cutoff, not a progress percentage.</p>
          <h4>Independence</h4>
          <p>The verifier must differ from the person who submitted the completion record.</p>
          <h4>Exceptions</h4>
          <p>Overdue training stays in the denominator until an approved exception applies. Originals are kept.</p>
          <Callout tone="warn" title="Cutoff protection">Verification after a locked cutoff uses an authorised correction process. A locked result never changes silently.</Callout>
        </div>
      </div>
    </Drawer>
  );
}
