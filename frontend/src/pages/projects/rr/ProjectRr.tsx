import { AlertTriangle, Check } from "lucide-react";
import { useState, type ReactNode } from "react";

import { crore, fmt2, inr, type ChecklistItem, type RrBundle, type Run } from "@/api/rr";
import type { Person, ProjectDetail, TaskBrief } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { Badge, Button, Callout, DecisionButton, Drawer, Empty, Field, Figures, FormError, Panel, PersonChip, PersonPicker, Tier, fieldError, toast } from "@/components/ui";
import { fmtDate, todayISO } from "@/lib/format";
import { useApiMutation } from "@/lib/hooks";
import { GxHead, GxLegend, GxRow, GX_LEGEND, gxRange } from "@/components/tasks/Gantt";

/** A person in the People section or a Charter RACI row: opens their work in this project. */
export function CharterPersonButton({ person, label, onOpen, children }: { person: Person; label: string; onOpen: (p: Person) => void; children?: ReactNode }) {
  return (
    <button type="button" className="charter-person" onClick={() => onOpen(person)} aria-label={`View ${person.name}'s assigned tasks`}>
      {children ?? <PersonChip person={person} />}
      <span className="sub">{label} · View work →</span>
    </button>
  );
}

export function personTaskLabel(person: Person, tasks: TaskBrief[], rr: RrBundle | null): string {
  const count = tasks.filter((t) => t.assignments.some((a) => a.employee.id === person.id)).length;
  const lead = !!rr && (rr.charter.champion?.id === person.id || rr.raci.some((r) => r.letter === "A" && r.person?.id === person.id));
  if (lead && rr) {
    const team = (rr.charter.mode === "programme" ? (rr.programme_raci?.rows ?? []).filter((r) => r.letter === "R").map((r) => r.person?.id) : rr.raci.filter((r) => r.letter === "R").map((r) => r.person?.id)).filter((id) => id && id !== person.id);
    const teamCount = tasks.filter((t) => t.assignments.some((a) => team.includes(a.employee.id))).length;
    return `${count} own task${count === 1 ? "" : "s"} · ${teamCount} Responsible task${teamCount === 1 ? "" : "s"}`;
  }
  const stages = rr?.charter.mode === "programme" ? rr.stages.filter((s) => s.responsible?.id === person.id).length : 0;
  return stages ? `${stages} responsible stage${stages === 1 ? "" : "s"}` : `${count} assigned task${count === 1 ? "" : "s"}`;
}

function Letters({ letters, active, dropped = [] }: { letters: string[] | Record<string, number[]>; active?: string; dropped?: string[] }) {
  const items = Array.isArray(letters) ? letters.map((L) => [L, [] as number[]] as const) : (Object.entries(letters).filter(([, v]) => v.length) as [string, number[]][]);
  return (
    <span className="letters">
      {items.map(([L, steps]) => (
        <span key={L} className={`${L} ${dropped.includes(L) || (L === "A" && active && active !== "A") ? "x" : ""}`} title={steps.length ? `Stages ${steps.join(", ")}` : undefined}>
          {L}
          {steps.join("")}
        </span>
      ))}
    </span>
  );
}

function Checklist({ items, render }: { items: ChecklistItem[]; render?: (i: ChecklistItem) => ReactNode }) {
  return (
    <ul className="rr-checklist">
      {items.map((i) => (
        <li key={i.key}>
          <span className={`st ${i.ok ? "ok" : "no"}`}>{i.ok ? "✓" : "!"}</span>
          <span>
            {i.label}
            {!i.ok && i.why && <span className="note" style={{ display: "block" }}>{i.why}</span>}
          </span>
          {!i.ok && render && <span className="act">{render(i)}</span>}
        </li>
      ))}
    </ul>
  );
}

// --- enrol --------------------------------------------------------------------------------------------------------------

export function EnrolPanel({ project, canEnrol }: { project: ProjectDetail; canEnrol: boolean }) {
  const enrol = useApiMutation<Record<string, unknown>>("post", `/projects/${project.id}/rr/enrol`);
  const [mode, setMode] = useState(project.template ? "programme" : "closure");
  const [type, setType] = useState("Standard");
  return (
    <Panel title="Project R&R" pad>
      <p className="small muted">Not in the scheme. {canEnrol ? "Add it to the pilot; it then needs a locked charter before it can be scored." : "Admin can add it to the pilot."}</p>
      {canEnrol && (
        <div className="stack mt" style={{ gap: 10 }}>
          <FormError error={enrol.error} />
          <div className="form-grid">
            <Field label="Scoring">
              <select className="input" value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="closure">At closure</option>
                {project.template && <option value="programme">Quarterly programme (template work)</option>}
              </select>
            </Field>
            <Field label="Project type">
              <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
                <option>Standard</option>
                <option>Complex</option>
                <option>Strategic</option>
              </select>
            </Field>
          </div>
          <div>
            <Button variant="primary" size="sm" disabled={enrol.isPending} onClick={() => enrol.mutate({ mode, project_type: type }, { onSuccess: () => toast("Added to the Project R&R pilot. The charter draft is open.") })}>Add to the pilot</Button>
          </div>
        </div>
      )}
    </Panel>
  );
}

// --- charter ------------------------------------------------------------------------------------------------------------

export function CharterTab({ project, rr, onPerson, tasks }: { project: ProjectDetail; rr: RrBundle; onPerson: (p: Person) => void; tasks: TaskBrief[] }) {
  const c = rr.charter;
  const [baseline, setBaseline] = useState(false);
  const [editing, setEditing] = useState<null | "charter" | "raci" | "slas">(null);
  if (c.mode === "programme") return <ProgrammeCharter project={project} rr={rr} onPerson={onPerson} />;
  const locked = c.state === "Locked";
  return (
    <>
      {locked ? (
        <Callout tone="ok" title={`Baseline locked on ${fmtDate(c.locked_on)}`} actions={rr.permissions.request_baseline_change && <Button size="sm" onClick={() => setBaseline(true)}>Request baseline change</Button>}>
          by the sponsor and PMO. Changes go through a baseline change request; an approved change is an E3 excuse and keeps the original.
        </Callout>
      ) : (
        <CharterLockBar project={project} rr={rr} onEdit={rr.permissions.edit_charter ? setEditing : undefined} />
      )}
      <div className="split wide-side mt">
        <div className="stack">
          <Panel title="RACI" meta="One A · one letter per person · select a person to view assigned work" tools={!locked && rr.permissions.edit_charter && <Button size="sm" onClick={() => setEditing("raci")}>Edit RACI</Button>}>
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>Person</th><th>Letter</th><th>Detail</th></tr></thead>
                <tbody>
                  {rr.raci.length === 0 && <tr><td colSpan={3}><Empty title="No RACI yet" /></td></tr>}
                  {rr.raci.map((x) => (
                    <tr key={x.id} className={x.person ? "clickable-row" : undefined} onClick={x.person ? () => onPerson(x.person!) : undefined} data-person={x.person?.code}>
                      <td>{x.person ? <CharterPersonButton person={x.person} label={personTaskLabel(x.person, tasks, rr)} onOpen={onPerson} /> : <span className="badge outline">{x.label}</span>}</td>
                      <td><Letters letters={[x.letter]} /></td>
                      <td className="wrap">
                        {x.note}
                        {x.letter === "R" && !x.factor_confirmed && <> <Badge tone="amber">Confirm factor</Badge></>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
          <Panel title="SLA list" meta="Fixed at kickoff · can't be dropped later" tools={!locked && rr.permissions.edit_charter && <Button size="sm" onClick={() => setEditing("slas")}>Edit SLAs</Button>}>
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>SLA</th><th>Kind</th><th>TAT</th></tr></thead>
                <tbody>
                  {rr.slas.length === 0 && <tr><td colSpan={3}><Empty title="No SLAs yet" /></td></tr>}
                  {rr.slas.map((s) => <tr key={s.id}><td>{s.name}</td><td>{s.kind}</td><td>{s.tat}</td></tr>)}
                </tbody>
              </table>
            </div>
          </Panel>
          {rr.baseline_changes.length > 0 && (
            <Panel title="Baseline change requests">
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead><tr><th>Task</th><th>New date</th><th>Reason</th><th>State</th></tr></thead>
                  <tbody>{rr.baseline_changes.map((b) => <tr key={b.id}><td>{b.task_label}</td><td>{fmtDate(b.requested_date)}</td><td className="wrap">{b.reason}</td><td><Badge status={b.state} /></td></tr>)}</tbody>
                </table>
              </div>
            </Panel>
          )}
        </div>
        <div className="stack">
          <ValuePanel rr={rr} onEdit={!locked && rr.permissions.edit_charter ? () => setEditing("charter") : undefined} />
          <HistoryPanel rr={rr} />
        </div>
      </div>
      {baseline && <BaselineDrawer project={project} tasks={tasks} onClose={() => setBaseline(false)} />}
      {editing === "charter" && <CharterEditDrawer project={project} rr={rr} onClose={() => setEditing(null)} />}
      {editing === "raci" && <RaciEditDrawer project={project} rr={rr} onClose={() => setEditing(null)} />}
      {editing === "slas" && <SlaEditDrawer project={project} rr={rr} onClose={() => setEditing(null)} />}
    </>
  );
}

function ValuePanel({ rr, onEdit }: { rr: RrBundle; onEdit?: () => void }) {
  const c = rr.charter;
  const v = rr.scorecard.inputs?.value;
  return (
    <Panel title="Value target" pad tools={onEdit && <Button size="sm" onClick={onEdit}>Edit charter</Button>}>
      <dl className="rr-kv">
        <dt>Kind</dt><dd>{c.value_kind ?? "—"}</dd>
        <dt>Target (locked)</dt><dd>{c.value_target ? (c.value_kind?.includes("₹") ? crore(c.value_target) : c.value_target.toLocaleString("en-IN")) : c.value_target_text ?? "—"}</dd>
        <dt>Actual</dt><dd>{v?.actual ? (c.value_kind?.includes("₹") ? crore(v.actual) : v.actual.toLocaleString("en-IN")) : <span className="unavail">{rr.permissions.money || v?.confirmed === undefined ? "Not yet" : v?.confirmed ? "Confirmed" : "Not yet"}</span>}</dd>
        <dt>Finance</dt><dd>{v?.confirmed ? <span className="ok-txt">Confirmed</span> : <span className="warn-txt">Not confirmed</span>}</dd>
        <dt>Project type</dt><dd>{c.project_type}</dd>
        <dt>Sponsor</dt><dd>{c.sponsor ?? "—"}</dd>
      </dl>
      {c.mode === "programme" && <p className="note mt">Non-revenue value is scored on the same slabs (P4).</p>}
    </Panel>
  );
}

function HistoryPanel({ rr }: { rr: RrBundle }) {
  return (
    <Panel title="Charter history" pad>
      {rr.charter.history.length === 0 && <span className="muted small">No events yet.</span>}
      {[...rr.charter.history].reverse().map((h, i) => (
        <div key={i} className="small" style={{ marginBottom: 6 }}>
          {h.at.slice(0, 10)} · <b>{h.event}</b> · {h.actor}
          {h.note && <span className="muted"> · {h.note}</span>}
        </div>
      ))}
    </Panel>
  );
}

function CharterLockBar({ project, rr, onEdit }: { project: ProjectDetail; rr: RrBundle; onEdit?: (k: "charter" | "raci" | "slas") => void }) {
  const c = rr.charter;
  const act = useApiMutation<{ action: string; reason?: string }>("post", (b) => `/projects/${project.id}/rr/charter/${b.action}`);
  const ready = rr.lock_checklist.every((i) => i.ok);
  return (
    <>
      <Callout
        tone="warn"
        title="Charter draft."
        actions={
          !c.submitted ? (
            rr.permissions.edit_charter && <Button variant="primary" size="sm" disabled={!ready || act.isPending} title={ready ? "" : "Clear the checklist first"} onClick={() => act.mutate({ action: "submit" }, { onSuccess: () => toast("Submitted. Sponsor and PMO must both approve; the champion can't lock alone.") })}>Submit for lock</Button>
          ) : (
            <>
              <Button size="sm" disabled={c.sponsor_ok || !rr.permissions.sponsor} title={rr.permissions.sponsor ? "" : "The sponsor (the department's HOD or Admin) approves"} onClick={() => act.mutate({ action: "sponsor" }, { onSuccess: () => toast("Sponsor approved") })}>{c.sponsor_ok ? "Sponsor approved" : "Approve as sponsor"}</Button>
              <Button size="sm" variant="primary" disabled={c.pmo_ok || !rr.permissions.pmo} title={rr.permissions.pmo ? "" : "Needs the PMO validator function"} onClick={() => act.mutate({ action: "pmo" }, { onSuccess: () => toast("PMO approved") })}>{c.pmo_ok ? "PMO approved" : "Approve as PMO"}</Button>
              {(rr.permissions.pmo || rr.permissions.sponsor) && <DecisionButton size="sm" label="Return" decision="return" onDecide={(_, reason) => act.mutate({ action: "return", reason }, { onSuccess: () => toast("Returned with a reason") })} />}
            </>
          )
        }
      >
        {c.mode === "programme" ? "Derived from the Email campaign template (RACI.xlsx, named Sheet3 defaults)." : project.source === "import" ? "Imported project: no locked baseline, so it can't be scored for reward." : "Set the value target, baseline dates, RACI and SLAs, then submit for sponsor and PMO approval."}{" "}
        {rr.lock_checklist.filter((i) => !i.ok).length} item(s) block the lock.
      </Callout>
      <FormError error={act.error} />
      {c.mode === "closure" && (
        <div className="mt">
          <Panel title="Before the charter can lock" pad tools={onEdit && <Button size="sm" onClick={() => onEdit("charter")}>Edit charter</Button>}>
            <Checklist items={rr.lock_checklist} />
          </Panel>
        </div>
      )}
    </>
  );
}

function ProgrammeCharter({ project, rr, onPerson }: { project: ProjectDetail; rr: RrBundle; onPerson: (p: Person) => void }) {
  const c = rr.charter;
  const res = rr.programme_raci!;
  const reviewer = useApiMutation<{ step: number; employee_id: number | null }>("post", `/projects/${project.id}/rr/stage-reviewer`);
  const confirm = useApiMutation<{ id: number; factor: number }>("post", (b) => `/projects/${project.id}/rr/raci/${b.id}/confirm`);
  const check = useApiMutation<{ key: string; value: boolean }>("post", `/projects/${project.id}/rr/checks`);
  const patch = useApiMutation<Record<string, unknown>>("patch", `/projects/${project.id}/rr/charter`);
  const [target, setTarget] = useState("");
  const [champion, setChampion] = useState<Person | null>(null);
  const [picks, setPicks] = useState<Record<number, Person | null>>({});
  const err = reviewer.error ?? confirm.error ?? check.error ?? patch.error;
  const locked = c.state === "Locked";
  const fac = (f: number | null) => (f === 1 ? "1.0" : String(f));
  return (
    <>
      {locked ? <Callout tone="ok" title="Baseline locked">by the sponsor and PMO. Stage SLAs and the RACI below are fixed for the quarter.</Callout> : <CharterLockBar project={project} rr={rr} />}
      <FormError error={err} />
      <div className="split wide-side mt">
        <div className="stack">
          <Panel title="Project RACI, derived from the template stages" meta="Strongest letter per person (A > R > C > I) · stage-level A becomes workstream lead">
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>Person or label</th><th>Stage letters</th><th>Project letter</th><th className="n">Planned effort</th><th>Factor</th><th>Resolution</th></tr></thead>
                <tbody>
                  {res.rows.map((x) => (
                    <tr key={x.key}>
                      <td>
                        {x.person ? <CharterPersonButton person={x.person} label={`${x.letter === "R" ? "Responsible" : x.letter}`} onOpen={onPerson}><b>{x.person.name}</b><span className="sub">{x.person.designation}</span></CharterPersonButton> : <><b>{x.label}</b><span className="sub">{c.champion_note && x.letter === "A" ? <span className="badge bad" style={{ marginTop: 4 }}>Not in org chart</span> : "Group label · name a person"}</span></>}
                      </td>
                      <td><Letters letters={x.letters} active={x.letter} dropped={x.dropped} /></td>
                      <td><Letters letters={[x.letter]} /></td>
                      <td className="n">{x.share ? `${(x.share * 100).toFixed(1)}%` : "—"}</td>
                      <td>{x.letter === "R" && x.payable ? (x.factor_confirmed ? <Badge tone="green">{fac(x.suggested)} confirmed</Badge> : <Badge tone="amber">{fac(x.suggested)} suggested</Badge>) : x.letter === "A" ? "Champion" : "—"}</td>
                      <td className="wrap small">{x.notes.join(" · ") || (x.label ? "Name people for R or C; fine as I" : "")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="note" style={{ padding: "10px 18px" }}>Planned effort = midpoint of each R stage ÷ {res.total_effort} h. Suggested factor: ≥ 40% → 1.0, 20–40% → 0.75, &lt; 20% → 0.5 (P12). The manager confirms.</p>
          </Panel>
          <Panel title="Stages, SLAs and validators" meta="Stage SLAs become the locked SLA list automatically">
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>#</th><th>Stage</th><th>SLA target / max</th><th>Effort</th><th>Validator</th><th>Source flag</th></tr></thead>
                <tbody>
                  {rr.stages.map((st) => (
                    <tr key={st.step}>
                      <td className="mono">{st.step}</td>
                      <td><b>{st.name}</b></td>
                      <td>{st.sla_target ?? "—"} / {st.sla_max ?? "—"} bd</td>
                      <td>{st.effort[0] ?? "—"}–{st.effort[1] ?? "—"} h</td>
                      <td>{st.reviewer_rule ? <><Badge tone="blue">Rule</Badge> <span className="small">{st.reviewer_rule.split("(")[0]}</span></> : st.reviewer ? <Badge tone="green">{st.reviewer.name}</Badge> : <Badge tone="red">{st.conflict_reason ?? "Unresolved"}</Badge>}</td>
                      <td className="wrap small muted">{st.flags}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
        <div className="stack">
          {!locked && (
            <Panel title="Before the charter can lock" pad>
              <Checklist
                items={rr.lock_checklist}
                render={(i) => {
                  if (!rr.permissions.edit_charter && !i.key.startsWith("factor")) return null;
                  if (i.key === "champion")
                    return (
                      <span className="row" style={{ flexWrap: "nowrap" }}>
                        <span style={{ width: 170 }}><PersonPicker value={champion} onChange={setChampion} placeholder="Name the champion" /></span>
                        <Button size="sm" disabled={!champion} onClick={() => patch.mutate({ champion_id: champion?.id }, { onSuccess: () => toast("Champion named") })}>Save</Button>
                      </span>
                    );
                  if (i.step)
                    return (
                      <span className="row" style={{ flexWrap: "nowrap" }}>
                        <span style={{ width: 170 }}><PersonPicker value={picks[i.step] ?? null} onChange={(p) => setPicks({ ...picks, [i.step!]: p })} placeholder="Name reviewer…" /></span>
                        <Button size="sm" disabled={!picks[i.step]} onClick={() => reviewer.mutate({ step: i.step!, employee_id: picks[i.step!]!.id }, { onSuccess: () => toast(`Stage ${i.step} reviewer named`) })}>Save</Button>
                      </span>
                    );
                  if (i.raci_id && i.suggested) return <Button size="sm" onClick={() => confirm.mutate({ id: i.raci_id!, factor: i.suggested! }, { onSuccess: () => toast("Factor confirmed") })}>Confirm {fac(i.suggested)}</Button>;
                  if (i.key === "target")
                    return (
                      <span className="row" style={{ flexWrap: "nowrap" }}>
                        <input className="mini-in" style={{ width: 90 }} placeholder="e.g. 1200" value={target} onChange={(e) => setTarget(e.target.value)} />
                        <Button size="sm" disabled={!Number(target)} onClick={() => patch.mutate({ value_target: Number(target) }, { onSuccess: () => toast("Value target set") })}>Set</Button>
                      </span>
                    );
                  if (i.key === "baseline_metrics") return <Button size="sm" onClick={() => check.mutate({ key: "baseline_metrics", value: true })}>Mark established</Button>;
                  return null;
                }}
              />
            </Panel>
          )}
          <ValuePanel rr={rr} />
          <HistoryPanel rr={rr} />
        </div>
      </div>
    </>
  );
}

function CharterEditDrawer({ project, rr, onClose }: { project: ProjectDetail; rr: RrBundle; onClose: () => void }) {
  const c = rr.charter;
  const [form, setForm] = useState({ project_type: c.project_type, sponsor: c.sponsor ?? "", value_kind: c.value_kind ?? "", value_target: c.value_target ? String(c.value_target) : "", value_target_text: c.value_target_text ?? "" });
  const [champion, setChampion] = useState<Person | null>(c.champion);
  const save = useApiMutation<Record<string, unknown>>("patch", `/projects/${project.id}/rr/charter`);
  return (
    <Drawer open onClose={onClose} eyebrow={project.code} title="Edit the charter" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={save.isPending} onClick={() => save.mutate({ ...form, value_target: Number(form.value_target) || null, value_target_text: form.value_target_text || null, sponsor: form.sponsor || null, value_kind: form.value_kind || null, ...(champion && champion.id !== c.champion?.id ? { champion_id: champion.id } : {}) }, { onSuccess: () => { toast("Charter saved"); onClose(); } })}>Save charter</Button></>}>
      <FormError error={save.error} />
      <div className="form-grid">
        <Field label="Project type" help="Sets the pool rate: 2 / 2.5 / 3% (proposed)">
          <select className="input" value={form.project_type} onChange={(e) => setForm({ ...form, project_type: e.target.value })}><option>Standard</option><option>Complex</option><option>Strategic</option></select>
        </Field>
        <Field label="Sponsor"><input className="input" value={form.sponsor} placeholder="Head of Product" onChange={(e) => setForm({ ...form, sponsor: e.target.value })} /></Field>
        <Field label="Champion (A)" error={fieldError(save.error, "champion_id")}><PersonPicker value={champion} onChange={setChampion} /></Field>
        <Field label="Value kind"><input className="input" value={form.value_kind} placeholder="Revenue (₹), hours saved, adoption…" onChange={(e) => setForm({ ...form, value_kind: e.target.value })} /></Field>
        <Field label="Value target (number)" error={fieldError(save.error, "value_target")}><input className="input" type="number" value={form.value_target} onChange={(e) => setForm({ ...form, value_target: e.target.value })} /></Field>
        <Field label="Value target (as written)" help="Shown until a numeric target is set"><input className="input" value={form.value_target_text} placeholder="1,200 a month" onChange={(e) => setForm({ ...form, value_target_text: e.target.value })} /></Field>
      </div>
    </Drawer>
  );
}

function RaciEditDrawer({ project, rr, onClose }: { project: ProjectDetail; rr: RrBundle; onClose: () => void }) {
  const [rows, setRows] = useState(rr.raci.map((r) => ({ person: r.person, label: r.label ?? "", letter: r.letter as string, factor: r.factor ?? 1, response_days: r.response_days ?? 2, note: r.note ?? "" })));
  const [reason, setReason] = useState("");
  const save = useApiMutation<Record<string, unknown>>("put", `/projects/${project.id}/rr/raci`);
  return (
    <Drawer open onClose={onClose} wide eyebrow={project.code} title="Edit the project RACI" sub="Exactly one A (the champion) · one letter per person · R needs a contribution factor · only Informed can be a role" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={save.isPending} onClick={() => save.mutate({ reason, rows: rows.map((r) => ({ employee_id: r.person?.id ?? null, label: r.person ? null : r.label || null, letter: r.letter, factor: r.letter === "R" ? Number(r.factor) : null, response_days: r.letter === "C" ? Number(r.response_days) : null, note: r.note || null })) }, { onSuccess: () => { toast("RACI saved"); onClose(); } })}>Save RACI</Button></>}>
      <FormError error={save.error} />
      {rows.map((r, i) => (
        <div key={i} className="row" style={{ marginBottom: 8, flexWrap: "nowrap", alignItems: "center" }}>
          <select className="select-sm" value={r.letter} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, letter: e.target.value } : x)))}>
            {["A", "R", "C", "I"].map((L) => <option key={L}>{L}</option>)}
          </select>
          <div style={{ flex: 1, minWidth: 0 }}>{r.letter === "I" && !r.person ? <input className="input" placeholder="Role, e.g. Head of Sales" value={r.label} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} /> : <PersonPicker value={r.person} onChange={(p) => setRows(rows.map((x, j) => (j === i ? { ...x, person: p } : x)))} />}</div>
          {r.letter === "R" && <select className="select-sm" aria-label="Contribution factor" value={r.factor} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, factor: Number(e.target.value) } : x)))}>{[0.5, 0.75, 1, 1.25].map((f) => <option key={f} value={f}>{f}</option>)}</select>}
          {r.letter === "C" && <><input className="mini-in" type="number" aria-label="Agreed response days" value={r.response_days} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, response_days: Number(e.target.value) } : x)))} /> days</>}
          <input className="input" style={{ width: 200 }} placeholder="Note" value={r.note} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))} />
          <button type="button" className="icon-btn" aria-label="Remove" onClick={() => setRows(rows.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <Button size="sm" onClick={() => setRows([...rows, { person: null, label: "", letter: "R", factor: 1, response_days: 2, note: "" }])}>Add person</Button>
      <div className="mt">
        <Field label="Change reason" required error={fieldError(save.error, "reason")}><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </div>
    </Drawer>
  );
}

function SlaEditDrawer({ project, rr, onClose }: { project: ProjectDetail; rr: RrBundle; onClose: () => void }) {
  const [rows, setRows] = useState(rr.slas.map((s) => ({ name: s.name, kind: s.kind, tat: s.tat })));
  const save = useApiMutation<{ name: string; kind: string; tat: string }[]>("put", `/projects/${project.id}/rr/slas`);
  return (
    <Drawer open onClose={onClose} eyebrow={project.code} title="Edit the SLA list" sub="Fixed at kickoff; it can't be dropped later" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={save.isPending} onClick={() => save.mutate(rows, { onSuccess: () => { toast("SLA list saved"); onClose(); } })}>Save SLAs</Button></>}>
      <FormError error={save.error} />
      {rows.map((r, i) => (
        <div key={i} className="row" style={{ marginBottom: 8, flexWrap: "nowrap" }}>
          <input className="input" placeholder="SLA" value={r.name} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
          <select className="select-sm" value={r.kind} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, kind: e.target.value } : x)))}><option>Client</option><option>Internal TAT</option></select>
          <input className="input" style={{ width: 90 }} placeholder="2 bd" value={r.tat} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, tat: e.target.value } : x)))} />
          <button type="button" className="icon-btn" aria-label="Remove" onClick={() => setRows(rows.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <Button size="sm" onClick={() => setRows([...rows, { name: "", kind: "Client", tat: "" }])}>Add SLA</Button>
    </Drawer>
  );
}

function BaselineDrawer({ project, tasks, onClose }: { project: ProjectDetail; tasks: TaskBrief[]; onClose: () => void }) {
  const [taskId, setTaskId] = useState("");
  const [date, setDate] = useState("");
  const [reason, setReason] = useState("");
  const save = useApiMutation<Record<string, unknown>>("post", `/projects/${project.id}/rr/baseline-changes`);
  return (
    <Drawer open onClose={onClose} eyebrow={project.code} title="Request a baseline change" sub="Sponsor and PMO approve before the task's due date · becomes an E3 excuse · the original is kept" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={save.isPending} onClick={() => save.mutate({ task_id: Number(taskId) || null, requested_date: date, reason }, { onSuccess: () => { toast("Change request sent to the sponsor and PMO"); onClose(); } })}>Send to sponsor and PMO</Button></>}>
      <FormError error={save.error} />
      <div className="stack">
        <Field label="Task" required error={fieldError(save.error, "task_id")}>
          <select className="input" value={taskId} onChange={(e) => setTaskId(e.target.value)}>
            <option value="">Choose…</option>
            {tasks.filter((t) => t.due_date_original).map((t) => <option key={t.id} value={t.id}>{t.code} · {t.title} (due {fmtDate(t.due_date_original, false)})</option>)}
          </select>
        </Field>
        <Field label="New date" required><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Reason" required error={fieldError(save.error, "reason")}><textarea className="input" placeholder="Approved scope change, with the change request reference" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </div>
    </Drawer>
  );
}

// --- runs ---------------------------------------------------------------------------------------------------------------

export function RunsTab({ rr, onOpenTask }: { rr: RrBundle; onOpenTask: (id: number) => void }) {
  const runs = rr.runs;
  const today = todayISO();
  const due = runs.filter((x) => x.delivered || (x.max_due && x.max_due <= today));
  const onTime = due.filter((x) => x.delivered && x.max_due && x.delivered <= x.max_due).length;
  const sc = rr.stage_counts ?? { done: 0, on_time: 0 };
  const sla = rr.inputs.find((i) => i.kind === "sla");
  return (
    <>
      <Figures
        items={[
          { label: "Runs this quarter", value: runs.length, hint: "Six stage tasks per accepted request" },
          { label: "Stage tasks on time", value: sc.on_time, unit: `of ${sc.done} done`, hint: "Timelines parameter (programme mode)" },
          { label: "Runs delivered within max SLA", value: onTime, unit: `of ${due.length} due`, hint: "All six stage tasks completed" },
          { label: "Stage SLA adherence", value: sla ? sla.display : "—", hint: sla ? `Manual count · ${sla.state.toLowerCase()}` : "No count submitted yet" },
          { label: "Excused delays", value: rr.delays.filter((d) => !d.controllable).length, hint: "Client-caused, external or approved change" },
        ]}
      />
      <div className="mt">
        <Panel title="Runs" meta="Accepting a request in Projects → Requests adds a run">
          <RunsTable runs={runs} onOpenTask={onOpenTask} />
        </Panel>
      </div>
    </>
  );
}

export function RunsTable({ runs, onOpenTask, stageCols }: { runs: Run[]; onOpenTask: (id: number) => void; stageCols?: { step: number; name: string }[] }) {
  if (!runs.length) return <Empty title="No runs yet">Accepted campaign requests become runs of this programme.</Empty>;
  if (stageCols)
    return (
      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>Run</th>{stageCols.map((s) => <th key={s.step}>{s.step} · {s.name}</th>)}</tr></thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.request_id}>
                <td><b>{r.id}</b><span className="sub">{r.title}</span></td>
                {stageCols.map((st) => {
                  const s = r.stages.find((x) => x.step === st.step);
                  return <td key={st.step}>{s ? <button type="button" className="link-btn" onClick={() => onOpenTask(s.task_id)}>{s.late ? <Badge status="Late" /> : <Badge status={s.status} />}</button> : "—"}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  return (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead><tr><th>Run</th><th>Requested by</th><th>Validator (rule)</th><th>Stage tasks</th><th>Started</th><th>Max SLA due</th><th>Result</th></tr></thead>
        <tbody>
          {runs.map((r) => {
            const firstOpen = r.stages.findIndex((s) => !s.done);
            const late = r.stages.find((s) => s.late);
            return (
              <tr key={r.request_id}>
                <td><b>{r.id} · {r.title}</b></td>
                <td>{r.requesting_department ?? "—"}</td>
                <td className="small">{r.validator_rule}</td>
                <td>
                  <span className="stage-dots">
                    {r.stages.map((s, i) => (
                      <i key={s.step} className={s.late ? "late" : s.done ? "done" : i === firstOpen ? "now" : ""} title={`Stage ${s.step} · ${s.name}`} onClick={() => onOpenTask(s.task_id)} style={{ cursor: "pointer" }} />
                    ))}
                  </span>
                </td>
                <td>{fmtDate(r.started, false)}</td>
                <td>{fmtDate(r.max_due, false)}</td>
                <td>{r.delivered ? <Badge tone="green">Delivered {fmtDate(r.delivered, false)}</Badge> : late ? <Badge tone="amber">Stage {late.step} over SLA</Badge> : <Badge status="In Progress" />}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function RunsTimeline({ rr }: { rr: RrBundle }) {
  const runs = rr.runs;
  if (!runs.length) return <Panel title="Timeline" pad><Empty title="No runs yet" /></Panel>;
  const r = gxRange([...runs.map((x) => x.started), ...runs.map((x) => x.max_due), ...runs.map((x) => x.delivered)]);
  return (
    <>
      <div className="gx-tools"><GxLegend keys={GX_LEGEND.filter(([c]) => c !== "s-blocked" && c !== "s-todo")} /></div>
      <section className="panel">
        <div className="gx-scroll">
          <div className="gx">
            <GxHead r={r} label="Campaign run" />
            {runs.map((x) => {
              const done = x.stages.filter((s) => s.done).length;
              const late = x.stages.find((s) => s.late);
              return (
                <GxRow
                  key={x.request_id}
                  r={r}
                  label={<span className="gx-name"><span className="mono">{x.id}</span>{x.title}</span>}
                  meta={<span>From {x.requesting_department ?? "—"}</span>}
                  bar={{
                    start: x.started ?? r.today,
                    end: x.delivered || x.max_due || r.today,
                    title: `${x.id} · ${x.title}`,
                    over: !x.delivered && !!x.max_due && x.max_due < r.today,
                    cls: x.delivered ? "s-done" : late ? "s-review" : "s-progress",
                    fill: x.delivered ? null : Math.round((done / Math.max(1, x.stages.length)) * 100),
                    text: x.delivered ? <>Delivered {fmtDate(x.delivered, false)} · max SLA {fmtDate(x.max_due, false)}</> : <>{done} of {x.stages.length} stages{late && <> · <b className="warn-txt">stage {late.step} over SLA</b></>} · max {fmtDate(x.max_due, false)}</>,
                  }}
                />
              );
            })}
          </div>
        </div>
      </section>
      <p className="note mt">Each run is one campaign request through the template stages; bars end at delivery or at the maximum SLA date.</p>
    </>
  );
}

// --- delays -------------------------------------------------------------------------------------------------------------

export function DelaysTab({ project, rr, tasks, onOpenTask }: { project: ProjectDetail; rr: RrBundle; tasks: TaskBrief[]; onOpenTask: (id: number) => void }) {
  const { isRole } = useAuth();
  const prog = rr.charter.mode === "programme";
  const [logging, setLogging] = useState<{ taskId?: number } | null>(null);
  const decide = useApiMutation<{ id: number; decision: string; reason_code?: string; reason?: string }>("post", (b) => `/rr/delays/${b.id}/decide`);
  const canPick = (rr.permissions.pmo || isRole("admin")) && !rr.scorecard.frozen;
  return (
    <>
      <div className="row mb" style={{ flexWrap: "nowrap" }}>
        <span className="note" style={{ flex: 1, minWidth: 0 }}>One late {prog ? "stage task" : "task"} = one delay, judged against its baseline due date · controllable −2, an escalation miss on top of another reason −2 more (max −4 each, −20 per project) · excused delays need evidence and an on-time flag</span>
        {rr.permissions.log_delay && !rr.scorecard.frozen && <Button variant={rr.late_tasks.length ? "secondary" : "primary"} onClick={() => setLogging({})}>Log a delay</Button>}
      </div>
      <FormError error={decide.error} />
      {rr.late_tasks.length > 0 && (
        <div className="mb">
          <Panel title="Late tasks without a delay entry" meta="From the task list · the champion logs each within 2 working days">
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>Task</th><th>Owner</th><th>Baseline due</th><th>Status</th><th>Timing</th><th /></tr></thead>
                <tbody>
                  {rr.late_tasks.map((t) => (
                    <tr key={t.id}>
                      <td><button type="button" className="link-btn" onClick={() => onOpenTask(t.id)}><b>{t.title}</b></button><span className="sub">{t.code}</span></td>
                      <td>{t.owner?.name ?? "—"}</td>
                      <td>{fmtDate(t.baseline_due)}</td>
                      <td><Badge status={t.status} /></td>
                      <td>{t.status === "Completed" ? <span className="warn-txt">Completed {fmtDate(t.accepted_on, false)}</span> : <span className="bad-txt">{t.days_past} day(s) past baseline</span>}</td>
                      <td>{rr.permissions.log_delay && <Button size="sm" variant="primary" onClick={() => setLogging({ taskId: t.id })}>Log delay</Button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      )}
      <Panel title="Delay log">
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>#</th><th>{prog ? "Run · stage task" : "Task"}</th><th>Reason</th><th>Category</th><th>Tagged to</th><th>Evidence</th><th>State</th><th className="n">Penalty</th><th /></tr></thead>
            <tbody>
              {rr.delays.length === 0 && <tr><td colSpan={9}><Empty title="No delays logged" /></td></tr>}
              {rr.delays.map((d) => (
                <tr key={d.id}>
                  <td className="mono">{d.code}</td>
                  <td>{d.task_id ? <button type="button" className="link-btn" onClick={() => onOpenTask(d.task_id!)}>{d.task_label}</button> : d.task_label}<span className="sub">{d.task_code}{d.stage ? ` · stage ${d.stage}` : ""}</span></td>
                  <td className="wrap">{d.explanation}{d.escalation_miss && <span className="sub bad-txt">Escalation miss: another −2</span>}</td>
                  <td>
                    {canPick && d.state !== "Closed" ? (
                      <select className="select-sm" value={d.reason_code} aria-label="Reason" onChange={(e) => decide.mutate({ id: d.id, decision: "reclassify", reason_code: e.target.value, reason: "PMO reclassified" }, { onSuccess: () => toast(`${d.code} is now ${e.target.value}: score recalculated`) })}>
                        {rr.reasons.filter((r) => r.code !== "X" || d.reason_code === "X").map((r) => <option key={r.code} value={r.code}>{r.code} · {r.label}</option>)}
                      </select>
                    ) : (
                      <><span className={`cat ${d.controllable ? "" : "ex"}`}>{d.reason_code}</span> {d.reason_label}</>
                    )}
                  </td>
                  <td className="wrap">{d.tagged.length ? d.tagged.map((p) => p.name).join(", ") : <span className="muted">{d.controllable ? "Project" : "No one"}</span>}</td>
                  <td className="wrap small">{d.evidence || "—"}</td>
                  <td><Badge status={d.state} /></td>
                  <td className={`n ${d.controllable ? "bad-txt" : ""}`}>{d.points ? `−${d.points}` : 0}</td>
                  <td>
                    {(d.state === "Logged" || d.state === "Challenged") && <Button size="sm" disabled={!rr.permissions.pmo} title={rr.permissions.pmo ? "" : "Needs the PMO validator function"} onClick={() => decide.mutate({ id: d.id, decision: "validate" }, { onSuccess: () => toast(`${d.code} validated (PMO). Challenge window: 5 working days.`) })}>Validate</Button>}
                    {d.state === "Validated" && <DecisionButton size="sm" label="Challenge" decision="challenge" onDecide={(_, reason) => decide.mutate({ id: d.id, decision: "challenge", reason }, { onSuccess: () => toast(`${d.code} challenged: the team can add evidence to change the category`) })} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      {logging && <LogDelayDrawer project={project} rr={rr} tasks={tasks} initialTask={logging.taskId} onClose={() => setLogging(null)} />}
    </>
  );
}

function LogDelayDrawer({ project, rr, tasks, initialTask, onClose }: { project: ProjectDetail; rr: RrBundle; tasks: TaskBrief[]; initialTask?: number; onClose: () => void }) {
  const prog = rr.charter.mode === "programme";
  const [taskId, setTaskId] = useState(initialTask ? String(initialTask) : "");
  const [run, setRun] = useState("");
  const [stage, setStage] = useState("3");
  const [cause, setCause] = useState("");
  const [custom, setCustom] = useState("");
  const [flagged, setFlagged] = useState("");
  const [reason, setReason] = useState("");
  const [evidence, setEvidence] = useState("");
  const save = useApiMutation<Record<string, unknown>>("post", `/projects/${project.id}/rr/delays`);
  const r = rr.reasons.find((x) => x.code === cause);
  const lateIds = new Set(rr.late_tasks.map((t) => t.id));
  const own = tasks.filter((t) => t.due_date_original && !rr.delays.some((d) => d.task_id === t.id));
  const task = tasks.find((t) => String(t.id) === taskId);
  const st = prog ? rr.stages.find((s) => String(s.step) === stage) : null;
  return (
    <Drawer
      open
      onClose={onClose}
      eyebrow={project.code}
      title="Log a delay"
      sub="Logged by the champion within 2 working days of knowing about the slip"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!cause || save.isPending} onClick={() => save.mutate(prog ? { run_request_id: Number(run) || null, stage: Number(stage), reason_code: cause, custom_reason: custom || null, explanation: reason, evidence: evidence || null, flagged_on: flagged || null } : { task_id: Number(taskId) || null, reason_code: cause, custom_reason: custom || null, explanation: reason, evidence: evidence || null, flagged_on: flagged || null }, { onSuccess: () => { toast("Delay logged. The PMO validator has 3 working days."); onClose(); } })}>
            Log delay
          </Button>
        </>
      }
    >
      <FormError error={save.error} />
      <div className="stack">
        {prog ? (
          <>
            <Field label="Run" required error={fieldError(save.error, "task_id")}>
              <select className="input" value={run} onChange={(e) => setRun(e.target.value)}>
                <option value="">Choose…</option>
                {rr.runs.map((x) => <option key={x.request_id} value={x.request_id}>{x.id} · {x.title}</option>)}
              </select>
            </Field>
            <Field label="Stage task" required error={fieldError(save.error, "stage")}>
              <select className="input" value={stage} onChange={(e) => setStage(e.target.value)}>
                {rr.stages.map((s) => <option key={s.step} value={s.step}>{s.step} · {s.name} (SLA {s.sla_target ?? "—"}/{s.sla_max ?? "—"} bd)</option>)}
              </select>
            </Field>
          </>
        ) : (
          <Field label="Late task" required help="Every delay belongs to one task." error={fieldError(save.error, "task_id")}>
            <select className="input" value={taskId} onChange={(e) => setTaskId(e.target.value)}>
              <option value="">Choose…</option>
              {own.map((t) => <option key={t.id} value={t.id}>{t.code} · {t.title}{lateIds.has(t.id) ? " (late)" : ""}</option>)}
            </select>
          </Field>
        )}
        <Field label="Reason for the delay" required error={fieldError(save.error, "reason_code")}>
          <select className="input" value={cause} onChange={(e) => setCause(e.target.value)}>
            <option value="">Choose…</option>
            {rr.reasons.map((x) => <option key={x.code} value={x.code}>{x.label}{x.controllable ? "" : " (excused)"}</option>)}
          </select>
        </Field>
        {cause === "X" && <Field label="Custom reason" required error={fieldError(save.error, "custom_reason")}><input className="input" placeholder="Name the reason" value={custom} onChange={(e) => setCustom(e.target.value)} /></Field>}
        <div className="sug">
          <b>{r ? `${r.code} · ${cause === "X" && custom ? `Custom: ${custom}` : r.label} · ${r.controllable ? "controllable, −2" : "excused"}` : "Choose a reason"}</b>
          {r && <div style={{ marginTop: 4 }}>{r.help}</div>}
          {st && st.step === 3 && <div className="note" style={{ marginTop: 4 }}>This stage can wait on a regulator (TRAI / WhatsApp): that wait is External dependency (E2).</div>}
          <div className="note" style={{ marginTop: 6 }}>The PMO validator confirms the category. It isn't final until then.</div>
        </div>
        <div className="form-grid">
          {task && <Field label="Baseline due date" help="From the task"><div className="input" style={{ display: "flex", alignItems: "center" }}>{fmtDate(task.due_date_original)}</div></Field>}
          <Field label="First flagged on" error={fieldError(save.error, "flagged_on")} help={cause === "C4" ? undefined : "Flagged less than 2 business days before the due date (or after half a short stage) is an escalation miss: another −2"}>
            <input type="date" className="input" max={todayISO()} value={flagged} onChange={(e) => setFlagged(e.target.value)} />
          </Field>
        </div>
        <Field label="Reason" required error={fieldError(save.error, "explanation")}><textarea className="input" placeholder="What happened" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <Field label="Evidence" required={!!r && !r.controllable} error={fieldError(save.error, "evidence")} help={r && !r.controllable ? "Excused delays need written evidence and an on-time flag. Without evidence in 5 working days this becomes controllable." : "Optional for controllable delays."}>
          <input className="input" placeholder="Email, ticket or approved change request" value={evidence} onChange={(e) => setEvidence(e.target.value)} />
        </Field>
      </div>
    </Drawer>
  );
}

// --- scorecard ----------------------------------------------------------------------------------------------------------

const STEPS = ["Baseline locked", "Inputs validated", "HR calibrated", "Panel approved", "Published"];
const INPUT_FORMS: Record<string, { label: string; fields: [string, string][] }> = {
  value_actual: { label: "Value actual (Finance confirms)", fields: [["actual", "Actual value"]] },
  sla: { label: "TAT / SLA counts (PMO validates)", fields: [["within", "Within SLA"], ["total", "Total"]] },
  rework: { label: "Rework % of effort (Quality assessor)", fields: [["pct", "Rework %"]] },
  errors: { label: "Errors after go-live, 30 days (Quality assessor)", fields: [["critical", "Critical"], ["minor", "Minor"]] },
  satisfaction: { label: "Stakeholder satisfaction (Quality assessor)", fields: [["avg", "Average of 5"], ["n", "Responses"]] },
  collaboration: { label: "Outside collaboration feedback (HR calibrator)", fields: [["avg", "Average of 5"], ["raters", "Raters"], ["items", "Help / playbook items"]] },
  innovation: { label: "Innovation award (R&R Panel)", fields: [["points", "Points 0–5"]] },
};

export function ScorecardTab({ project, rr }: { project: ProjectDetail; rr: RrBundle }) {
  const { isRole } = useAuth();
  const s = rr.scorecard;
  const [dispute, setDispute] = useState(false);
  const [input, setInput] = useState(false);
  const act = useApiMutation<{ action: string; reason?: string }>("post", (b) => `/projects/${project.id}/rr/scorecard/${b.action}`);
  const p9 = useApiMutation<Record<string, unknown>>("patch", `/projects/${project.id}/rr/charter`);
  const adjust = useApiMutation<{ id: number; adjustment: number; reason: string }>("patch", (b) => `/projects/${project.id}/rr/raci/${b.id}/adjustment`);
  const scored = s.score !== null && (s.state === "Scored" || s.state === "Provisional" || s.frozen);
  const canInput = rr.charter.state === "Locked" && !s.frozen;
  if (!scored)
    return (
      <>
        <Panel title="Scorecard" pad tools={canInput && <Button size="sm" onClick={() => setInput(true)}>Submit an input</Button>}>
          <Empty title={s.state === "Not eligible" ? "Not eligible for scoring yet" : "Not scored yet"}>
            {s.state === "Not eligible" ? "No locked baseline: a project without a locked charter can't be scored for reward." : rr.charter.mode === "programme" ? "Scored at quarter end from stage tasks, stage SLAs, rework and confirmed conversions." : project.status !== "Completed" ? "Scored at closure. Inputs collected so far are below; missing inputs show as Insufficient data, never 0." : "Waiting for inputs. Missing inputs show as Insufficient data, never 0."}
          </Empty>
          {s.missing.length > 0 && (
            <ul className="rr-checklist">
              {s.missing.map((m) => <li key={m}><span className="st no">!</span><span>{m}</span></li>)}
            </ul>
          )}
        </Panel>
        <InputsSoFar rr={rr} />
        {input && <InputDrawer project={project} rr={rr} onClose={() => setInput(false)} />}
      </>
    );
  const at = STEPS.indexOf(s.stage === "Inputs validated" ? "Inputs validated" : s.stage);
  const money = s.money_visible;
  const pts = s.points!;
  const inp = s.inputs ?? {};
  const row = (label: string, target: ReactNode, actual: ReactNode, by: string, p: number, max: number, indent = false) => (
    <tr key={label}>
      <td style={indent ? { paddingLeft: 24 } : undefined}>{indent ? label : <b>{label}</b>}</td>
      <td>{target}</td>
      <td className="wrap">{actual}</td>
      <td>{by}</td>
      <td className="n">
        <span className="pct-cell">
          <span className="minibar"><i className={p / max < 0.72 ? "low" : ""} style={{ width: `${(p / max) * 100}%` }} /></span>
          <b>{p}</b>&nbsp;/ {max}
        </span>
      </td>
    </tr>
  );
  const err = act.error ?? p9.error ?? adjust.error;
  return (
    <>
      <div className="steps">
        {STEPS.map((x, i) => (
          <span key={x} className={i < at ? "done" : i === at ? "now" : ""}>
            <span className="dot">{i < at ? "✓" : i + 1}</span>
            {x}
          </span>
        ))}
        <span className="right">Policy PR-1 (proposed)</span>
      </div>
      {s.state === "Provisional" && <Callout tone="neutral" title="Provisional.">Scored at closure; this shows where the project stands now from validated inputs.</Callout>}
      <FormError error={err} />
      <div className="row mb">
        {isRole("admin") && !s.frozen && (
          <label className="toggle">
            <input type="checkbox" checked={!!inp.doc_reading} onChange={(e) => p9.mutate({ doc_reading: e.target.checked })} /> P9: use the doc §13 reading of collaboration (+3 instead of +4)
          </label>
        )}
        <span style={{ marginLeft: "auto" }} />
        <Button onClick={() => setDispute(true)}>Raise dispute</Button>
        {canInput && <Button onClick={() => setInput(true)}>Submit an input</Button>}
        {s.stage === "Inputs validated" && <Button variant="primary" disabled={!rr.permissions.hr} title={rr.permissions.hr ? "" : "Needs the HR calibrator function (and not in this RACI)"} onClick={() => act.mutate({ action: "calibrate" }, { onSuccess: () => toast("HR calibrated") })}>Mark HR calibrated</Button>}
        {s.stage === "HR calibrated" && <Button variant="primary" disabled={!rr.permissions.panel} title={rr.permissions.panel ? "" : "Needs the R&R Panel member function (and not in this RACI)"} onClick={() => act.mutate({ action: "approve" }, { onSuccess: () => toast("Panel approved") })}>Approve scorecard</Button>}
        {s.stage === "Panel approved" && <Button variant="primary" disabled={!rr.permissions.panel} title={rr.permissions.panel ? "" : "Needs the R&R Panel member function (and not in this RACI)"} onClick={() => act.mutate({ action: "publish" }, { onSuccess: () => toast("Published. Dispute window: 7 working days.") })}>Publish scorecard</Button>}
        {s.frozen && <Badge status="Published" />}
      </div>
      <div className="split wide-side">
        <div className="stack">
          <section className="panel">
            <div className="panel-b">
              <div className="phero">
                <div>
                  <div className="small muted">Final project score</div>
                  <div className="score">{fmt2(s.score)}<small>/ 110</small></div>
                  <div className="row" style={{ marginTop: 8 }}><Tier tier={s.band} /><span className="small muted">Project band</span></div>
                </div>
                <div className="pcalc">
                  <div><div className="lbl">Base</div><div className="v">{s.base}</div></div>
                  <div><div className="lbl">Bonus</div><div className="v pos">+{s.bonus}</div></div>
                  <div><div className="lbl">Delays</div><div className="v neg">−{s.penalty}</div></div>
                  <div><div className="lbl">Recovery</div><div className="v">{s.recovery}</div></div>
                  <div><div className="lbl">Final</div><div className="v">{fmt2(s.score)}</div></div>
                </div>
              </div>
            </div>
          </section>
          <Panel title="Scorecard" meta="Targets locked at kickoff; actuals validated outside the team">
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>Parameter</th><th>Baseline target</th><th>Actual</th><th>Validated by</th><th className="n">Points</th></tr></thead>
                <tbody>
                  {row("Revenue / business value", money ? crore(inp.value?.target) : "Target locked", money ? <>{crore(inp.value?.actual)} <span className="muted">({s.value_pct?.toFixed(1)}%)</span></> : <>{s.value_pct?.toFixed(1)}% of target</>, "Finance", pts.revenue, 30)}
                  {row("Delivery timelines", `${inp.timelines?.due ?? "—"} ${rr.charter.mode === "programme" ? "stage tasks" : "tasks with baseline dates"}`, <>{inp.timelines?.on_time} completed by the baseline date <span className="muted">({Math.round(s.timelines_pct ?? 0)}%)</span></>, "PMO", pts.timelines, 25)}
                  {row("TAT / SLA adherence", "95% within SLA", <>{Math.round(s.sla_pct ?? 0)}% <span className="muted">({inp.sla?.within} of {inp.sla?.total})</span></>, "PMO", pts.sla, 20)}
                  <tr className="group"><td colSpan={5}>Quality · {s.quality} of 25 (bonus gate: 15 or more)</td></tr>
                  {row("Rework", "5% or less of effort", `${inp.rework_pct}%`, "QA", pts.rework, 10, true)}
                  {row("Errors after go-live (30 days)", "0 critical", `${inp.errors?.critical} critical, ${inp.errors?.minor} minor`, "Operations", pts.errors, 8, true)}
                  {row("Stakeholder satisfaction", "4.5 of 5", <>{inp.satisfaction?.avg} <span className="muted">({inp.satisfaction?.n} responses)</span></>, "HR survey", pts.satisfaction, 7, true)}
                  <tr className="group"><td colSpan={5}>Bonus · {(s.quality ?? 0) >= 15 ? "counts because Quality ≥ 15" : "does not count: Quality below 15"}</td></tr>
                  <tr><td style={{ paddingLeft: 24 }}>Innovation</td><td colSpan={2}>Awarded by the R&amp;R Panel</td><td>R&amp;R Panel</td><td className="n"><b>+{inp.innovation ?? 0}</b> / 5</td></tr>
                  <tr><td style={{ paddingLeft: 24 }}>Collaboration</td><td colSpan={2} className="wrap">{inp.collab ? <>Outside feedback {inp.collab.avg} of 5 ({inp.collab.raters} raters) · {inp.collab.items} help/playbook item(s) {inp.doc_reading ? <Badge tone="amber">Doc §13 reading</Badge> : <Badge tone="grey">§3.2: +3 and +1</Badge>}</> : "No outside feedback"}</td><td>HR</td><td className="n"><b>+{s.collaboration}</b> / 5</td></tr>
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
        <div className="stack">
          <Panel title="Gates" meta="All must pass for any reward" pad>
            {(s.gates ?? []).map((g) => (
              <div key={g.key} className="gate-row">
                <span className={`ok-dot ${g.ok ? "" : "no"}`}>{g.ok ? <Check size={11} /> : <AlertTriangle size={11} />}</span>
                <span>{g.label}<span className="src">{g.source}</span></span>
              </div>
            ))}
          </Panel>
          <Panel title="Reward pool" pad tools={<Badge tone="amber">Indicative</Badge>}>
            {money ? (
              <>
                <dl className="rr-kv">
                  <dt>Confirmed value</dt><dd>{inr(inp.value?.actual)}</dd>
                  <dt>Pool rate</dt><dd>{(rr.charter.pool_rate * 100).toFixed(1).replace(".0", "")}%</dd>
                  <dt>Reward pool</dt><dd>{inr(s.pool)}</dd>
                  <dt>Total units</dt><dd>{s.total_units}</dd>
                  <dt>Value of one unit</dt><dd>{inr(s.unit_value)}</dd>
                  <dt className="tot">Indicative payouts</dt><dd className="tot">{inr(s.paid)}</dd>
                  <dt>To Recognition &amp; Learning Fund</dt><dd>{inr(s.to_fund)}</dd>
                </dl>
                <p className="note mt">Visible because you are {isRole("admin") ? "Admin" : "an R&R Panel member"}. 80% at closure, 20% after the 90-day holdback. Finance to confirm.</p>
              </>
            ) : (
              <p className="hidden-role">Units and ₹ are visible to Admin and R&amp;R Panel members only. They are removed on the server and in exports.</p>
            )}
          </Panel>
          <Panel title="Disputes" meta={s.published_on ? `Published ${fmtDate(s.published_on)} · 7 working days to raise` : "Window opens at publication"} pad>
            {rr.disputes.length ? rr.disputes.map((d) => <div key={d.id} className="small"><Badge status={d.state} /> {d.subject} <span className="muted">· {d.raised_by?.name}</span></div>) : <span className="muted small">No disputes raised.</span>}
          </Panel>
        </div>
      </div>
      <div className="sec-title"><h2>People</h2><span className="meta">Individual score = project score + contribution adjustment − own tagged delays (max −10){rr.permissions.hr && !s.frozen ? " · adjustments editable as HR calibrator" : ""}</span></div>
      <Panel>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Person</th><th>RACI</th>{money && <th className="n">Units</th>}<th className="n">Contribution adj.</th><th className="n">Tagged delays</th><th className="n">Individual score</th><th>Band</th>{money && <><th className="n">Payout %</th><th className="n">Indicative payout</th></>}
              </tr>
            </thead>
            <tbody>
              {s.people.map((x) =>
                !x.visible ? (
                  <tr key={String(x.key)}><td><b>{x.person?.name ?? x.label}</b></td><td>{x.letter}</td><td colSpan={money ? 7 : 4} className="hidden-role">{x.hidden_reason}</td></tr>
                ) : (
                  <tr key={String(x.key)}>
                    <td><b>{x.person?.name ?? x.label}</b><span className="sub">{x.note}</span></td>
                    <td>{x.letter}</td>
                    {money && <td className="n">{x.units ?? "—"}</td>}
                    <td className="n">
                      {x.letter === "I" ? "—" : rr.permissions.hr && !s.frozen && s.stage !== "Panel approved" ? (
                        <AdjustInput value={x.adjustment ?? 0} onSave={(v, reason) => { const raci = rr.raci.find((r) => r.person?.id === x.person?.id); if (raci) adjust.mutate({ id: raci.id, adjustment: v, reason }, { onSuccess: () => toast("Adjustment saved (audited)") }); }} />
                      ) : (
                        `${(x.adjustment ?? 0) > 0 ? "+" : ""}${x.adjustment ?? 0}`
                      )}
                    </td>
                    <td className={`n ${x.tagged ? "bad-txt" : ""}`}>{x.letter === "I" ? "—" : x.tagged ? `−${x.tagged}` : 0}</td>
                    <td className="n big">{x.individual === null || x.individual === undefined ? "—" : fmt2(x.individual)}</td>
                    <td>{x.individual === null || x.individual === undefined ? <span className="badge outline">Recognition only</span> : <Tier tier={x.band} />}</td>
                    {money && <><td className="n">{x.individual === null || x.individual === undefined ? "—" : `${Math.round((x.payout_pct ?? 0) * 100)}%`}</td><td className="n money">{x.individual === null || x.individual === undefined ? "—" : inr(x.payout)}</td></>}
                  </tr>
                ),
              )}
              {money && (
                <tr className="total"><td>Total</td><td /><td className="n">{s.total_units}</td><td /><td className="n">−{s.people.reduce((n, x) => n + (x.tagged ?? 0), 0)}</td><td /><td /><td /><td className="n money">{inr(s.paid)}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>
      {dispute && <DisputeDrawer project={project} onClose={() => setDispute(false)} />}
      {input && <InputDrawer project={project} rr={rr} onClose={() => setInput(false)} />}
    </>
  );
}

function AdjustInput({ value, onSave }: { value: number; onSave: (v: number, reason: string) => void }) {
  const [v, setV] = useState(String(value));
  return (
    <span className="row" style={{ justifyContent: "flex-end", flexWrap: "nowrap" }}>
      <input className="mini-in" type="number" min={-10} max={10} value={v} onChange={(e) => setV(e.target.value)} aria-label="Contribution adjustment" />
      {Number(v) !== value && <DecisionButton size="sm" label="Save" decision="save" title="Save the adjustment" onDecide={(_, reason) => onSave(Math.max(-10, Math.min(10, Number(v) || 0)), reason)} />}
    </span>
  );
}

function InputsSoFar({ rr }: { rr: RrBundle }) {
  const inp = rr.scorecard.inputs ?? {};
  const byKind = Object.fromEntries(rr.inputs.map((i) => [i.kind, i]));
  const show = (kind: string, fallback: string) => (byKind[kind] ? <>{byKind[kind].display} <Badge status={byKind[kind].state} /></> : <span className="unavail">{fallback}</span>);
  return (
    <div className="mt">
      <Panel title="Inputs so far">
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Parameter</th><th>Input so far</th><th>Source</th></tr></thead>
            <tbody>
              <tr><td>Revenue / value</td><td>{rr.permissions.money || byKind.value_actual?.state !== "Validated" ? show("value_actual", "Insufficient data") : "Confirmed"}</td><td>Finance confirms after go-live</td></tr>
              <tr><td>Delivery timelines</td><td>{inp.timelines?.due ? `${inp.timelines.on_time} of ${inp.timelines.due} due ${rr.charter.mode === "programme" ? "stage tasks" : "tasks"} completed by the baseline date` : <span className="unavail">No task due yet</span>}</td><td>{rr.charter.mode === "programme" ? "Run stage tasks" : "Tasks (baseline due dates)"}</td></tr>
              <tr><td>TAT / SLA</td><td>{show("sla", `${rr.slas.length} SLAs locked · counts pending`)}</td><td>Stage tasks + manual counts</td></tr>
              <tr><td>Rework</td><td>{show("rework", "Insufficient data")}</td><td>Quality assessor</td></tr>
              <tr><td>Errors after go-live</td><td>{show("errors", "Insufficient data")}</td><td>Incident register</td></tr>
              <tr><td>Satisfaction</td><td>{show("satisfaction", "Insufficient data")}</td><td>Satisfaction survey</td></tr>
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

function InputDrawer({ project, rr, onClose }: { project: ProjectDetail; rr: RrBundle; onClose: () => void }) {
  const [kind, setKind] = useState("sla");
  const [values, setValues] = useState<Record<string, string>>({});
  const save = useApiMutation<{ kind: string; value: Record<string, number> }>("post", `/projects/${project.id}/rr/inputs`);
  const form = INPUT_FORMS[kind];
  return (
    <Drawer open onClose={onClose} eyebrow={project.code} title="Submit a scorecard input" sub="Validated by someone holding the input's function, never the author or the champion" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={save.isPending} onClick={() => save.mutate({ kind, value: Object.fromEntries(form.fields.map(([k]) => [k, Number(values[k])])) }, { onSuccess: () => { toast("Input submitted for validation"); onClose(); } })}>Submit input</Button></>}>
      <FormError error={save.error} />
      <div className="stack">
        <Field label="Input">
          <select className="input" value={kind} onChange={(e) => { setKind(e.target.value); setValues({}); }}>
            {Object.entries(INPUT_FORMS).filter(([k]) => k !== "innovation" || rr.permissions.functions.includes("R&R Panel member")).map(([k, f]) => <option key={k} value={k}>{f.label}</option>)}
          </select>
        </Field>
        <div className="form-grid">
          {form.fields.map(([k, label]) => (
            <Field key={k} label={label} required error={fieldError(save.error, "value")}><input className="input" type="number" value={values[k] ?? ""} onChange={(e) => setValues({ ...values, [k]: e.target.value })} /></Field>
          ))}
        </div>
      </div>
    </Drawer>
  );
}

function DisputeDrawer({ project, onClose }: { project: ProjectDetail; onClose: () => void }) {
  const [subject, setSubject] = useState("");
  const [grounds, setGrounds] = useState("");
  const save = useApiMutation<Record<string, unknown>>("post", `/projects/${project.id}/rr/disputes`);
  return (
    <Drawer open onClose={onClose} eyebrow={project.code} title="Raise a dispute" sub="Within 7 working days of publication · PMO and HR review in 5, then the R&R Panel in 10" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={save.isPending} onClick={() => save.mutate({ subject, grounds }, { onSuccess: () => { toast("Dispute logged. PMO and HR review within 5 working days."); onClose(); } })}>Submit dispute</Button></>}>
      <FormError error={save.error} />
      <div className="stack">
        <Field label="What is disputed" required error={fieldError(save.error, "subject")}><input className="input" placeholder="Delay category, contribution adjustment, quality input…" value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
        <Field label="Written grounds" required error={fieldError(save.error, "grounds")}><textarea className="input" placeholder="Explain and attach evidence" value={grounds} onChange={(e) => setGrounds(e.target.value)} /></Field>
        <p className="note">Raising a dispute in good faith is never held against anyone. An upheld dispute re-freezes the scorecard and keeps the old and new results.</p>
      </div>
    </Drawer>
  );
}
