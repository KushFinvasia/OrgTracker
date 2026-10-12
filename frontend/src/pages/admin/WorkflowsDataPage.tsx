import { useEffect, useState } from "react";

import type { MetricInput, Period, Person } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { Badge, Button, Callout, Card, DecisionButton, Drawer, Empty, Field, FormError, Loading, PageHeader, PersonPicker, Tabs, toast } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { useApiMutation, useApiQuery, useQueryParam } from "@/lib/hooks";

type Tab = "templates" | "raci" | "catalog" | "calendar" | "inputs";

interface Stage {
  id: number;
  step: number;
  name: string;
  responsible_role: string | null;
  responsible: Person | null;
  accountable_label: string | null;
  accountable: Person | null;
  consulted: string | null;
  informed: string | null;
  checklist: string | null;
  reviewer_label: string | null;
  reviewer: Person | null;
  required_evidence: string | null;
  sla_target_days: number | null;
  sla_max_days: number | null;
  effort_min_hours: number | null;
  effort_max_hours: number | null;
  source_flags: string | null;
  conflicts: string[];
}
interface Template {
  id: number;
  name: string;
  description: string | null;
  sla_target_days: number | null;
  sla_max_days: number | null;
  effort_min_hours: number | null;
  effort_max_hours: number | null;
  state: string;
  stages: Stage[];
  risks: { code: string; stage: string; risk: string; criticality: string }[];
  blocking_conflicts: number;
}

export function WorkflowsDataPage() {
  const { isRole } = useAuth();
  const [tabParam, setTabParam] = useQueryParam("tab");
  const tab = (tabParam as Tab) || "templates";
  return (
    <>
      <PageHeader title="Design the workflow. Trust the inputs." sub="Templates, calendars and validated sources / No live connector assumed" />
      <Tabs
        value={tab}
        onChange={(t) => setTabParam(t)}
        tabs={[
          { id: "templates", label: "Workflow templates" },
          { id: "raci", label: "RACI & review" },
          { id: "catalog", label: "Training catalog" },
          { id: "calendar", label: "Working calendar" },
          { id: "inputs", label: "Input validation" },
        ]}
      />
      {(tab === "templates" || tab === "raci") && <Templates raci={tab === "raci"} canEdit={isRole("admin")} />}
      {tab === "catalog" && <Catalog canEdit={isRole("admin")} />}
      {tab === "calendar" && <Calendar canEdit={isRole("admin")} />}
      {tab === "inputs" && <Inputs />}
    </>
  );
}

function Templates({ raci, canEdit }: { raci: boolean; canEdit: boolean }) {
  const { data, isLoading } = useApiQuery<Template[]>("/templates");
  const [selected, setSelected] = useState<number | null>(null);
  const [editing, setEditing] = useState<Stage | null>(null);
  const activate = useApiMutation<Record<string, never>>("post", `/templates/${selected}/activate`);
  useEffect(() => {
    if (!selected && data?.length) setSelected(data[0].id);
  }, [data, selected]);
  if (isLoading || !data) return <Loading />;
  const t = data.find((x) => x.id === selected) ?? data[0];
  return (
    <div className="stack">
      <div className="row">
        {data.map((x) => (
          <button key={x.id} className={`btn ${x.id === t.id ? "btn-green" : ""}`} onClick={() => setSelected(x.id)}>{x.name} {x.blocking_conflicts > 0 && <Badge tone="red">{x.blocking_conflicts} conflicts</Badge>}</button>
        ))}
      </div>
      <Card
        title={t.name}
        sub={`${t.stages.length} stages${t.sla_target_days ? ` / Target ${t.sla_target_days} / Maximum ${t.sla_max_days} business days` : ""}${t.effort_min_hours ? ` / ${t.effort_min_hours}-${t.effort_max_hours} hours` : ""} / ${t.state}`}
        actions={canEdit && <Button variant="primary" onClick={() => activate.mutate({}, { onSuccess: () => toast("Template activated") })}>Activate template</Button>}
      >
        <FormError error={activate.error} />
        <p className="muted">{t.description}</p>
        <table className="table">
          <thead>
            <tr>{raci ? <><th>Step</th><th>Responsible</th><th>Accountable (one)</th><th>Consulted / Informed</th><th>Independent reviewer</th><th>Conflicts</th><th /></> : <><th>Step</th><th>Stage</th><th>Checklist</th><th>Evidence</th><th>SLA target / max</th><th>Effort</th></>}</tr>
          </thead>
          <tbody>
            {t.stages.map((s) =>
              raci ? (
                <tr key={s.id}>
                  <td className="num">{s.step}</td>
                  <td>{s.responsible ? `${s.responsible.name} / ${s.responsible.code}` : <span className="muted">{s.responsible_role}</span>}</td>
                  <td>{s.accountable ? s.accountable.name : <span className="muted">{s.accountable_label ?? "Unresolved"}</span>}</td>
                  <td className="small">{s.consulted} / {s.informed}</td>
                  <td>{s.reviewer ? s.reviewer.name : <span className="muted">{s.reviewer_label || "Unresolved"}</span>}</td>
                  <td>{s.conflicts.length ? s.conflicts.map((c) => <div key={c}><Badge tone="red">{c}</Badge></div>) : <Badge tone="green">Resolved</Badge>}</td>
                  <td>{canEdit && <button className="link-btn" onClick={() => setEditing(s)}>Resolve</button>}</td>
                </tr>
              ) : (
                <tr key={s.id}>
                  <td className="num">{String(s.step).padStart(2, "0")}</td>
                  <td><b>{s.name}</b>{s.source_flags && <div className="sub">{s.source_flags}</div>}</td>
                  <td className="small">{s.checklist}</td>
                  <td className="small">{s.required_evidence}</td>
                  <td className="num">{s.sla_target_days ?? "—"} / {s.sla_max_days ?? "—"}</td>
                  <td className="num">{s.effort_min_hours ?? "—"}-{s.effort_max_hours ?? "—"} h</td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </Card>
      {raci ? (
        <Callout tone="warn" title="One named A / One RACI letter per person, per step">An assignee cannot review the step. Source conflicts block activation. Approval waiting belongs to the approval stage and its Accountable person, not the previous stage's assignees.</Callout>
      ) : (
        <Card title="Template risks">
          {t.risks.length === 0 ? <Empty title="No default risks" /> : (
            <table className="table"><thead><tr><th>Risk</th><th>Stage</th><th>Criticality</th></tr></thead>
              <tbody>{t.risks.map((r) => <tr key={r.code + r.risk}><td>{r.risk}<div className="sub">{r.code}</div></td><td>{r.stage}</td><td><Badge status={r.criticality} /></td></tr>)}</tbody>
            </table>
          )}
        </Card>
      )}
      {editing && <StageDrawer stage={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function StageDrawer({ stage, onClose }: { stage: Stage; onClose: () => void }) {
  const [r, setR] = useState<Person | null>(stage.responsible);
  const [a, setA] = useState<Person | null>(stage.accountable);
  const [rev, setRev] = useState<Person | null>(stage.reviewer);
  const [reason, setReason] = useState("");
  const save = useApiMutation<Record<string, unknown>>("patch", `/templates/stages/${stage.id}`);
  return (
    <Drawer open onClose={onClose} eyebrow={`Workflows & data > Step ${stage.step}`} title={`Resolve RACI: ${stage.name}`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => save.mutate({ responsible_id: r?.id ?? null, accountable_id: a?.id ?? null, reviewer_id: rev?.id ?? null, reason }, { onSuccess: () => { toast("Responsibilities saved"); onClose(); } })}>Save responsibilities</Button></>}>
      <FormError error={save.error} />
      {stage.source_flags && <Callout tone="warn" title="Source flags">{stage.source_flags}</Callout>}
      <div className="form-grid mt">
        <Field label="Responsible owner" required help={stage.responsible_role ?? undefined}><PersonPicker value={r} onChange={setR} /></Field>
        <Field label="Accountable / one person" required help={stage.accountable_label ?? "A department label cannot be Accountable."}><PersonPicker value={a} onChange={setA} exclude={r ? [r.id] : []} /></Field>
        <Field label="Independent reviewer" required help={stage.reviewer_label ?? "Choose a person outside assignees."}><PersonPicker value={rev} onChange={setRev} exclude={r ? [r.id] : []} /></Field>
        <Field label="Change reason" required><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </div>
    </Drawer>
  );
}

interface Course {
  id: number;
  code: string;
  version: number;
  title: string;
  course_type: string;
  applicability: string | null;
  completion_criteria: string;
  pass_mark: number | null;
  duration_hours: number | null;
  evidence_requirements: string | null;
  recurrence: string | null;
  state: string;
  illustrative: boolean;
}

function Catalog({ canEdit }: { canEdit: boolean }) {
  const { data } = useApiQuery<Course[]>("/training/courses");
  const [form, setForm] = useState({ code: "", title: "", course_type: "Mandatory", applicability: "", completion_criteria: "Attendance + assessment + certificate", pass_mark: "", duration_hours: "", evidence_requirements: "", recurrence: "Annual" });
  const create = useApiMutation<Record<string, unknown>>("post", "/training/courses");
  const approve = useApiMutation<{ id: number }>("post", (b) => `/training/courses/${b.id}/approve`);
  return (
    <div className="grid grid-main">
      <Card title="Define reusable training and completion criteria" sub="Existing assignments retain their assigned criteria version">
        <table className="table">
          <thead><tr><th>Course</th><th>Type</th><th>Criteria / pass</th><th>Duration</th><th>State</th><th /></tr></thead>
          <tbody>
            {(data ?? []).map((c) => (
              <tr key={c.id}>
                <td><b>{c.title}</b><div className="sub">{c.code} / Version {c.version}{c.illustrative ? " / illustrative" : ""}</div></td>
                <td>{c.course_type}</td>
                <td className="small">{c.completion_criteria}{c.pass_mark ? ` / ${c.pass_mark}%` : ""}</td>
                <td className="num">{c.duration_hours ?? "—"} h</td>
                <td><Badge status={c.state} /></td>
                <td>{canEdit && c.state === "Draft" && <button className="link-btn" onClick={() => approve.mutate({ id: c.id })}>Approve version</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {canEdit ? (
        <Card title="New course or version">
          <FormError error={create.error} />
          <div className="form-grid">
            <Field label="Course code" required><input className="input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="TRN-013" /></Field>
            <Field label="Mandatory / optional" required><select className="input" value={form.course_type} onChange={(e) => setForm({ ...form, course_type: e.target.value })}><option>Mandatory</option><option>Optional</option></select></Field>
            <Field label="Course name" required className="full"><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
            <Field label="Applicable role/category" required className="full"><input className="input" value={form.applicability} onChange={(e) => setForm({ ...form, applicability: e.target.value })} /></Field>
            <Field label="Completion criteria" required className="full"><input className="input" value={form.completion_criteria} onChange={(e) => setForm({ ...form, completion_criteria: e.target.value })} /></Field>
            <Field label="Assessment pass mark %"><input type="number" className="input" value={form.pass_mark} onChange={(e) => setForm({ ...form, pass_mark: e.target.value })} /></Field>
            <Field label="Expected duration (h)"><input type="number" className="input" value={form.duration_hours} onChange={(e) => setForm({ ...form, duration_hours: e.target.value })} /></Field>
            <Field label="Evidence requirements" required className="full"><input className="input" value={form.evidence_requirements} onChange={(e) => setForm({ ...form, evidence_requirements: e.target.value })} /></Field>
          </div>
          <Button className="mt" variant="primary" onClick={() => create.mutate({ ...form, pass_mark: Number(form.pass_mark) || null, duration_hours: Number(form.duration_hours) || null }, { onSuccess: () => toast("Course draft saved") })}>Save course draft</Button>
          <p className="small muted mt">Manager records attendance and result; no employee quiz portal is implied. New versions cannot rewrite verified assignments.</p>
        </Card>
      ) : (
        <Callout title="Catalog">Course versions are managed by Admin. Managers assign approved versions from the person workspace.</Callout>
      )}
    </div>
  );
}

function Calendar({ canEdit }: { canEdit: boolean }) {
  const { data } = useApiQuery<{ name: string; working_week: string; work_window: string; holidays: { id: number; day: string; name: string }[] }>("/calendar");
  const [start, setStart] = useState("2026-10-12");
  const [days, setDays] = useState("14");
  const preview = useApiQuery<{ due: string }>(`/calendar/preview?start=${start}&days=${days || 0}`);
  const [h, setH] = useState({ day: "", name: "" });
  const add = useApiMutation<Record<string, unknown>>("post", "/calendar/holidays");
  return (
    <div className="grid grid-main">
      <Card title="Use one business calendar for scheduling" sub={data ? `${data.name} / ${data.working_week} / ${data.work_window}` : ""}>
        <table className="table">
          <thead><tr><th>Holiday</th><th>Date</th></tr></thead>
          <tbody>{(data?.holidays ?? []).map((x) => <tr key={x.id}><td>{x.name}</td><td>{fmtDate(x.day)}</td></tr>)}</tbody>
        </table>
        {canEdit && (
          <div className="row mt">
            <input type="date" className="input" style={{ width: 180 }} value={h.day} onChange={(e) => setH({ ...h, day: e.target.value })} />
            <input className="input" style={{ width: 260 }} placeholder="Approved holiday name" value={h.name} onChange={(e) => setH({ ...h, name: e.target.value })} />
            <Button onClick={() => add.mutate(h, { onSuccess: () => toast("Holiday added") })}>Add holiday</Button>
          </div>
        )}
        <FormError error={add.error} />
      </Card>
      <Card title="Deadline preview" sub="Start + maximum business-day SLA using the chosen calendar">
        <div className="form-grid">
          <Field label="Start"><input type="date" className="input" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label="Business days"><input type="number" className="input" value={days} onChange={(e) => setDays(e.target.value)} /></Field>
        </div>
        <p className="mt">Due: <b>{fmtDate(preview.data?.due)}</b></p>
        <p className="small muted">Calendar changes cannot silently revise accepted work or locked scoring dates. Email campaign: target 9 / maximum 14 business days.</p>
      </Card>
    </div>
  );
}

const INPUT_FIELDS: Record<string, { label: string; key: string; type: string }[]> = {
  csat: [{ label: "Average / 1-5", key: "average", type: "number" }, { label: "Responses", key: "responses", type: "number" }],
  achievement: [{ label: "Target", key: "target", type: "number" }, { label: "Actual", key: "actual", type: "number" }, { label: "Unit / source", key: "unit", type: "text" }],
  compliance: [{ label: "Attestation note", key: "note", type: "text" }],
  capacity: [{ label: "Available days", key: "available_days", type: "number" }],
  innovation: [{ label: "Before measure", key: "before", type: "text" }, { label: "After measure", key: "after", type: "text" }],
  training_none: [{ label: "Confirmation note", key: "note", type: "text" }],
};
const INPUT_LABELS: Record<string, string> = { csat: "CSAT", achievement: "Targets", compliance: "Compliance", capacity: "Capacity", innovation: "Innovation", training_none: "No training due" };

function Inputs() {
  const periods = useApiQuery<Period[]>("/periods");
  const [metric, setMetric] = useState("achievement");
  const list = useApiQuery<MetricInput[]>(`/metric-inputs`);
  const [creating, setCreating] = useState(false);
  const decide = useApiMutation<{ id: number; decision: string; reason?: string }>("post", (b) => `/metric-inputs/${b.id}/decide`);
  return (
    <div className="stack">
      <div className="row between">
        <div className="seg">
          {Object.keys(INPUT_FIELDS).map((m) => <button key={m} className={metric === m ? "active" : ""} onClick={() => setMetric(m)}>{INPUT_LABELS[m]}</button>)}
        </div>
        <Button variant="primary" onClick={() => setCreating(true)}>Record {INPUT_LABELS[metric]} input</Button>
      </div>
      <Callout tone="warn" title="Source selection is pending">Manual records or batch imports are supported without claiming a live HRMS, LMS or CRM feed. Draft &gt; Submitted &gt; Validated or Returned; author, validator, evidence and versions are kept.</Callout>
      <FormError error={decide.error} />
      <Card title={`${INPUT_LABELS[metric]} inputs`}>
        {(list.data ?? []).filter((m) => m.metric === metric).length === 0 ? <Empty title="No inputs recorded" /> : (
          <table className="table">
            <thead><tr><th>Employee</th><th>Values</th><th>Evidence</th><th>Author / validator</th><th>State</th><th /></tr></thead>
            <tbody>
              {(list.data ?? []).filter((m) => m.metric === metric).map((m) => (
                <tr key={m.id}>
                  <td>{m.employee?.name}<div className="sub">{m.employee?.code}</div></td>
                  <td className="small">{Object.entries(m.values).map(([k, v]) => `${k}: ${String(v)}`).join(" / ")}</td>
                  <td className="small">{m.evidence}{m.illustrative ? " (illustrative)" : ""}</td>
                  <td className="small">{m.author?.name} / {m.validator?.name}</td>
                  <td><Badge status={m.state} /></td>
                  <td>{m.can_decide && <span className="row"><Button size="sm" variant="green" onClick={() => decide.mutate({ id: m.id, decision: "validate" }, { onSuccess: () => toast("Validated") })}>Validate</Button><DecisionButton size="sm" label="Return" decision="return" onDecide={(d, reason) => decide.mutate({ id: m.id, decision: d, reason })} /></span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {creating && <InputDrawer metric={metric} periods={periods.data ?? []} onClose={() => setCreating(false)} />}
    </div>
  );
}

function InputDrawer({ metric, periods, onClose }: { metric: string; periods: Period[]; onClose: () => void }) {
  const [employee, setEmployee] = useState<Person | null>(null);
  const [validator, setValidator] = useState<Person | null>(null);
  const [periodId, setPeriodId] = useState(String(periods.find((p) => p.state !== "Locked")?.id ?? ""));
  const [values, setValues] = useState<Record<string, string>>({});
  const [evidence, setEvidence] = useState("");
  const save = useApiMutation<Record<string, unknown>>("post", "/metric-inputs");
  const fields = INPUT_FIELDS[metric];
  return (
    <Drawer
      open
      onClose={onClose}
      eyebrow="Workflows & data / Manual or batch input"
      title={`Validate ${INPUT_LABELS[metric].toLowerCase()} source inputs`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => {
              const parsed: Record<string, unknown> = Object.fromEntries(fields.map((f) => [f.key, f.type === "number" ? Number(values[f.key]) : values[f.key]]));
              if (metric === "compliance") parsed.attested = true;
              save.mutate({ employee_id: employee?.id, period_id: Number(periodId), metric, values: parsed, evidence, validator_id: validator?.id }, { onSuccess: () => { toast("Sent for validation"); onClose(); } });
            }}
          >
            Send for validation
          </Button>
        </>
      }
    >
      <FormError error={save.error} />
      <div className="form-grid">
        <Field label="Employee" required><PersonPicker value={employee} onChange={setEmployee} /></Field>
        <Field label="Period" required>
          <select className="input" value={periodId} onChange={(e) => setPeriodId(e.target.value)}>{periods.map((p) => <option key={p.id} value={p.id}>{p.name} / {p.state}</option>)}</select>
        </Field>
        {fields.map((f) => (
          <Field key={f.key} label={f.label} required><input type={f.type} className="input" value={values[f.key] ?? ""} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} /></Field>
        ))}
        <Field label="Evidence batch" required className="full"><input className="input" value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="Aggregate export / approved plan / attestation" /></Field>
        <Field label="Independent validator" required><PersonPicker value={validator} onChange={setValidator} exclude={employee ? [employee.id] : []} /></Field>
      </div>
      {metric === "csat" && <p className="small muted mt">Minimum 30 responses. 4.4 average scores 96 / 100.</p>}
      {metric === "compliance" && <p className="small muted mt">100 only after a valid attestation; no assumption from an empty incident register. Severity + attribution both required for a personal deduction.</p>}
      {metric === "capacity" && <p className="small muted mt">Productivity remains a tie-breaker; minimum 10 available days and a team of 3.</p>}
      {metric === "innovation" && <p className="small muted mt">Every innovation rating needs before/after evidence; score = rating x 20.</p>}
    </Drawer>
  );
}
