/** Pieces shared by the Team (marking) and Performance (results) pages. */
import { useState } from "react";

import type { Person } from "@/api/types";
import { Badge, Button, Callout, Card, DecisionButton, Drawer, ErrorState, Field, fieldError, FormError, Loading, PersonChip, Stat, toast } from "@/components/ui";
import { fmtDate, fmtDateTime, todayISO } from "@/lib/format";
import { useApiMutation, useApiQuery } from "@/lib/hooks";
import type { Flag, KpiType, MonthInfo } from "./shared";

export function numOrNull(v: string): number | null {
  if (v.trim() === "") return null;
  const n = Number(v.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Import and data notes. Open warnings can be marked as checked (name matches by an Admin only); checked ones stay visible, struck through. */
export function FlagsCell({ flags, onResolve, isAdmin }: { flags: Flag[]; onResolve?: (index: number, note: string) => void; isAdmin?: boolean }) {
  const open = flags.filter((f) => f.level === "warn" && !f.resolved);
  if (!flags.length) return null;
  return (
    <details className="small">
      <summary style={{ cursor: "pointer", color: open.length ? "var(--amber-fg)" : "var(--muted)" }}>
        {open.length ? `${open.length} to check` : `${flags.length} note${flags.length > 1 ? "s" : ""}`}
      </summary>
      <ul style={{ margin: "6px 0 0", paddingLeft: 16, maxWidth: 340 }}>
        {flags.map((f, i) => {
          const nameMatch = f.text.startsWith("Name match");
          const canResolve = onResolve && f.level === "warn" && !f.resolved && (!nameMatch || isAdmin);
          return (
            <li key={i} className={f.level === "warn" && !f.resolved ? "" : "muted"}>
              <span style={f.resolved ? { textDecoration: "line-through" } : undefined}>{f.text}</span>
              {f.resolved && <div>Checked by {f.resolved_by}: {f.note}</div>}
              {canResolve && (
                <div style={{ marginTop: 4 }}>
                  <DecisionButton size="sm" label="Mark checked" decision="resolve" title="Mark this warning as checked" onDecide={(_, note) => onResolve(i, note)} />
                </div>
              )}
              {f.level === "warn" && !f.resolved && nameMatch && !isAdmin && <div>An Admin confirms name matches.</div>}
            </li>
          );
        })}
      </ul>
    </details>
  );
}

export function AddItemDrawer({ kind, month, people, types, defaultPerson, onClose }: { kind: "kpi" | "duty"; month: MonthInfo; people: Person[]; types: KpiType[]; defaultPerson: number | null; onClose: () => void }) {
  const [form, setForm] = useState({ employee_id: defaultPerson && people.some((p) => p.id === defaultPerson) ? defaultPerson : people[0]?.id ?? 0, title: "", kpi_type_id: 0, target_value: "", is_team: false });
  const create = useApiMutation<object, { id: number }>("post", `/individual/months/${month.id}/items`);
  const err = create.error;
  return (
    <Drawer
      open
      onClose={onClose}
      dirty={!!form.title}
      eyebrow={month.label}
      title={kind === "kpi" ? "Add KPI target" : "Add duty task"}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={create.isPending}
            onClick={() =>
              create.mutate(
                { employee_id: form.employee_id, kind, title: form.title, kpi_type_id: kind === "kpi" ? form.kpi_type_id || null : null, is_team: form.is_team, target_value: kind === "kpi" ? numOrNull(form.target_value) : null },
                { onSuccess: () => { toast("Row added."); onClose(); } },
              )
            }
          >
            {kind === "kpi" ? "Add target" : "Add duty task"}
          </Button>
        </>
      }
    >
      <FormError error={err} />
      <div className="form-grid">
        <Field label="Person" required className="full">
          <select className="input" value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: Number(e.target.value) })}>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name} / {p.code} / {p.designation}</option>)}
          </select>
        </Field>
        {kind === "kpi" && (
          <Field label="KPI type" required error={fieldError(err, "kpi_type_id")}>
            <select className="input" value={form.kpi_type_id} onChange={(e) => setForm({ ...form, kpi_type_id: Number(e.target.value) })}>
              <option value={0}>Choose</option>
              {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
        )}
        {kind === "kpi" && (
          <Field label="Monthly target" error={fieldError(err, "target_value")} help="For call targets: per day × 22 working days. Funds in rupees.">
            <input className="input" inputMode="decimal" value={form.target_value} onChange={(e) => setForm({ ...form, target_value: e.target.value })} />
          </Field>
        )}
        <Field label={kind === "kpi" ? "Description" : "Duty task"} required error={fieldError(err, "title")} className="full">
          <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={kind === "kpi" ? "Call volume 200 calls per day" : "Team audit"} />
        </Field>
        {kind === "kpi" && (
          <label className="check full"><input type="checkbox" checked={form.is_team} onChange={(e) => setForm({ ...form, is_team: e.target.checked })} /> Team KPI (blank values use the sum of the reportees' rows)</label>
        )}
      </div>
      <p className="small muted mt">The target date is the last day of {month.label}. Duty tasks have no numbers; they count for On-time and delays only.</p>
    </Drawer>
  );
}

export interface TrainingModuleRow {
  id: number;
  employee_id: number;
  title: string;
  track: string;
  assigned_date: string;
  due_date: string;
  completed_date: string | null;
  status: string;
  attempts: number;
  days_late: number | null;
  credit: number | null;
  credit_note: string;
  verified: boolean;
  in_month: boolean;
  can_verify: boolean;
  can_decide_exemption: boolean;
  exemption_reason: string | null;
}

export interface TrainingData {
  month: MonthInfo;
  cutoff: string;
  tracks: string[];
  bands: [number, string, number][];
  credits: [number, number][];
  credit_beyond: number;
  team_twcs: number | null;
  people: {
    employee: Person;
    twcs: number | null;
    status: "scored" | "na" | "missing";
    band: string | null;
    keka: number | null;
    due: number;
    counted: number;
    future: number;
    exempt: number;
    provisional: number;
    reason: string;
    can_edit: boolean;
    modules: TrainingModuleRow[];
  }[];
}

export function ModuleDrawer({ month, tracks, people, module, defaultPerson, onClose }: { month: MonthInfo; tracks: string[]; people: Person[]; module?: TrainingModuleRow; defaultPerson?: number | null; onClose: () => void }) {
  const monthStart = month.month;
  const [form, setForm] = useState({
    employee_id: module?.employee_id ?? (defaultPerson && people.some((p) => p.id === defaultPerson) ? defaultPerson : people[0]?.id ?? 0),
    title: module?.title ?? "",
    track: module?.track ?? tracks[0],
    assigned_date: module?.assigned_date ?? monthStart,
    due_date: module?.due_date ?? "",
    completed_date: module?.completed_date ?? "",
    attempts: module?.attempts ?? 1,
  });
  const create = useApiMutation<object>("post", "/individual/training");
  const catalog = useApiQuery<{ id: number; title: string; track: string }[]>("/individual/training-catalog");
  const update = useApiMutation<object>("patch", `/individual/training/${module?.id}`);
  const m = module ? update : create;
  const err = m.error;
  const save = () => {
    const body = module
      ? { title: form.title, track: form.track, due_date: form.due_date, completed_date: form.completed_date || null, attempts: form.attempts }
      : { ...form, completed_date: form.completed_date || null };
    m.mutate(body, { onSuccess: () => { toast(module ? "Module updated. A changed completion needs verifying again." : "Module added."); onClose(); } });
  };
  return (
    <Drawer
      open
      onClose={onClose}
      eyebrow="Training (TWCS)"
      title={module ? `${module.title}` : "Add training module"}
      dirty={!module && !!form.title}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={m.isPending} onClick={save}>{module ? "Save module" : "Add module"}</Button></>}
    >
      <FormError error={err} />
      <div className="drawer-split">
        <div className="form-grid">
          {!module && (
            <Field label="Person" required className="full">
              <select className="input" value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: Number(e.target.value) })}>
                {people.map((p) => <option key={p.id} value={p.id}>{p.name} / {p.code}</option>)}
              </select>
            </Field>
          )}
          <Field label="Module" required error={fieldError(err, "title")} className="full" help="Pick from the module list or type a new one.">
            <input
              className="input"
              list="module-catalog"
              value={form.title}
              onChange={(e) => {
                const c = catalog.data?.find((x) => x.title === e.target.value);
                setForm({ ...form, title: e.target.value, ...(c ? { track: c.track } : {}) });
              }}
            />
          </Field>
          <datalist id="module-catalog">{(catalog.data ?? []).map((c) => <option key={c.id} value={c.title}>{c.track}</option>)}</datalist>
          <Field label="Track" required error={fieldError(err, "track")}>
            <select className="input" value={form.track} onChange={(e) => setForm({ ...form, track: e.target.value })}>
              {tracks.map((t) => <option key={t}>{t}</option>)}
            </select>
          </Field>
          {!module && (
            <Field label="Assigned on" required>
              <input className="input" type="date" value={form.assigned_date} onChange={(e) => setForm({ ...form, assigned_date: e.target.value })} />
            </Field>
          )}
          <Field label="Due date" required error={fieldError(err, "due_date")} help="The module counts in the month its due date falls in.">
            <input className="input" type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
          </Field>
          <Field label="Completed on" error={fieldError(err, "completed_date")} help="Leave blank if not completed.">
            <input className="input" type="date" max={todayISO()} value={form.completed_date} onChange={(e) => setForm({ ...form, completed_date: e.target.value })} />
          </Field>
          {module && (
            <Field label="Attempts" help="Retakes are attempts on the same module.">
              <input className="input" type="number" min={1} max={20} value={form.attempts} onChange={(e) => setForm({ ...form, attempts: Number(e.target.value) })} />
            </Field>
          )}
        </div>
        <div className="aside-panel">
          <h4>Before you save</h4>
          <p>You record the completion date; someone else (the HOD) verifies it. Changing a completion clears its verification.</p>
          <p>Days late = completed − due. Early completion earns no bonus (D11).</p>
          <p>Not completed by {fmtDate(month.training_cutoff)} = 0 credit for {month.label}.</p>
        </div>
      </div>
    </Drawer>
  );
}

// --- month close ---------------------------------------------------------------------------------

export interface LockCheck {
  month: MonthInfo;
  people: number;
  approved: number;
  not_approved: { employee: Person; state: string }[];
  readiness: string[];
  can_lock: boolean;
}

export function MonthClose({ month, months, onOpened }: { month: MonthInfo; months: MonthInfo[]; onOpened: (id: number) => void }) {
  const check = useApiQuery<LockCheck>(`/individual/months/${month.id}/lock-check`);
  const lock = useApiMutation<{ note: string; exclude_reason: string | null }>("post", `/individual/months/${month.id}/lock`);
  const openMonth = useApiMutation<{ month: string }, MonthInfo>("post", "/individual/months");
  const [note, setNote] = useState("");
  const [exclude, setExclude] = useState("");
  const [confirm, setConfirm] = useState(false);
  const latest = months.reduce((a, m) => (m.month > a ? m.month : a), "");
  const next = (() => {
    const [y, m] = latest.split("-").map(Number);
    return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  })();
  const c = check.data;
  if (check.isLoading) return <Loading rows={2} />;
  if (!c) return <ErrorState error={check.error} />;
  const missing = c.not_approved.length;
  return (
    <div className="grid grid-main">
      <Card title={`Close ${month.label}`} sub="Closing freezes every result with its inputs and rule version. Closed results never recalculate; a correction is the only way to change one.">
        {month.state === "Locked" ? (
          <Callout title="Closed">
            {fmtDateTime(month.locked_at)} by {month.locked_by?.name}. Note: {month.lock_note}
          </Callout>
        ) : (
          <div className="stack">
            <div className="grid grid-2">
              <Stat label="Check-ins approved" value={`${c.approved} of ${c.people}`} />
              <Stat label="Not approved" value={missing} hint={missing ? "Recorded as not evaluated if you close now" : "Ready to close"} />
            </div>
            {c.readiness.map((r) => <Callout key={r} tone="warn">{r}</Callout>)}
            <FormError error={lock.error} />
            <Field label="Closing note" required>
              <textarea className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Sep 2026 monthly close" />
            </Field>
            {missing > 0 && (
              <Field label="Reason to close without the remaining check-ins" required error={fieldError(lock.error, "exclude_reason")} help={`${missing} people will be stored as not evaluated, with no score or tier.`}>
                <textarea className="input" value={exclude} onChange={(e) => setExclude(e.target.value)} />
              </Field>
            )}
            <div className="row">
              <Button variant="primary" disabled={!note.trim() || (missing > 0 && !exclude.trim()) || lock.isPending} onClick={() => setConfirm(true)}>Close {month.label}</Button>
            </div>
            {confirm && (
              <Callout tone="danger" title={`Close ${month.label}? Results freeze; only a correction can change them.`}>
                <div className="row mt">
                  <Button onClick={() => setConfirm(false)}>Cancel</Button>
                  <Button variant="danger" onClick={() => lock.mutate({ note, exclude_reason: exclude || null }, { onSuccess: () => { setConfirm(false); toast(`${month.label} closed.`); } })}>Close and freeze results</Button>
                </div>
              </Callout>
            )}
          </div>
        )}
      </Card>
      <div className="stack">
        <Card title="Not approved yet">
          {missing === 0 && <p className="muted">Every check-in is approved.</p>}
          {c.not_approved.slice(0, 40).map((n) => (
            <div key={n.employee.id} className="row between" style={{ padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
              <a href={`/individual/team/${n.employee.id}?month=${month.id}`}><PersonChip person={n.employee} meta={n.employee.code} /></a>
              <Badge status={n.state} />
            </div>
          ))}
        </Card>
        <Card title="Open the next month" sub="Uses the approved scoring rule in effect for that month.">
          <FormError error={openMonth.error} />
          <Button onClick={() => openMonth.mutate({ month: next }, { onSuccess: (m) => { toast(`${m.label} opened.`); onOpened(m.id); } })}>Open {new Date(next).toLocaleString("en-IN", { month: "short", year: "numeric" })}</Button>
        </Card>
      </div>
    </div>
  );
}
