import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import type { Period, Person } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { Badge, Button, Callout, Card, Drawer, Empty, ErrorState, Field, FormError, Loading, PageHeader, PersonChip, Stat, Tabs, toast } from "@/components/ui";
import { fmtDate, fmtDateTime, fmtPct, fmtScore } from "@/lib/format";
import { useApiMutation, useApiQuery, useQueryParam } from "@/lib/hooks";

type Tab = "overview" | "results" | "checkins" | "training" | "snapshots";

interface TeamRow {
  employee: Person;
  category: string;
  base_kpi: number | null;
  base_preview: number | null;
  coverage: number;
  training: { allotted: number; eligible: number; verified: number; pending_verification: number; score: number | null; status: string };
  final: { status: string; value: number | null };
  tier: string | null;
  checkin: { month: string; state: string } | null;
  status: string;
  readiness: string[];
  locked: boolean;
}

interface TeamData {
  period: Period;
  rows: TeamRow[];
  summary: { people: number; ready: number; insufficient: number; readiness_exceptions: number; checkins_finalized: number; training_pending: number };
}

export function PerformanceHubPage() {
  const { isRole } = useAuth();
  const navigate = useNavigate();
  const periods = useApiQuery<Period[]>("/periods");
  const [periodId, setPeriodId] = useState<number | null>(null);
  const [tabParam, setTabParam] = useQueryParam("tab");
  const tab = (tabParam as Tab) || "overview";
  const [creating, setCreating] = useState(false);
  const [locking, setLocking] = useState(false);
  useEffect(() => {
    if (!periodId && periods.data?.length) setPeriodId((periods.data.find((p) => p.state === "Under Review") ?? periods.data[0]).id);
  }, [periods.data, periodId]);
  const team = useApiQuery<TeamData>(periodId && !isRole("team_lead") ? `/periods/${periodId}/team` : null);

  if (isRole("team_lead"))
    return (
      <>
        <PageHeader title="Performance" />
        <Card><Empty title="Private performance unavailable">Team Leads update work and allowed training records. KPI, check-in and training-score data is not part of the Team Lead role.</Empty></Card>
      </>
    );
  if (periods.isLoading) return <Loading rows={2} />;
  const period = periods.data?.find((p) => p.id === periodId);
  const t = team.data;

  return (
    <>
      <PageHeader
        title="Every result has a clear story."
        sub={period ? `${period.name} / ${period.department} / KPI ${period.kpi_rule.label} (${period.kpi_rule.state}) / Training policy ${period.training_rule?.label ?? "none"} (${period.training_rule?.state ?? "—"})` : undefined}
        actions={
          <>
            <select className="input" style={{ width: 200 }} value={periodId ?? ""} onChange={(e) => setPeriodId(Number(e.target.value))} aria-label="Period">
              {(periods.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name} / {p.state}</option>)}
            </select>
            <Button onClick={() => setCreating(true)}>Open a period</Button>
            {isRole("admin", "hod") && period?.state !== "Locked" && <Button variant="primary" onClick={() => setLocking(true)}>Review period lock</Button>}
          </>
        }
      />
      <Tabs
        value={tab}
        onChange={(v) => setTabParam(v)}
        tabs={[
          { id: "overview", label: "Period overview" },
          { id: "results", label: "Team results" },
          { id: "checkins", label: "Check-ins" },
          { id: "training", label: "Training" },
          { id: "snapshots", label: "Snapshots" },
        ]}
      />
      {team.isLoading && <Loading rows={2} />}
      <ErrorState error={team.error} />
      {t && tab === "overview" && (
        <div className="stack">
          <div className="grid grid-4">
            <Stat label="Ready for review" value={`${t.summary.ready} of ${t.summary.people}`} hint="Completed inputs and evidence" />
            <Stat label="Insufficient data" value={t.summary.insufficient} hint="Coverage below 70%; never shown as zero" />
            <Stat label="Check-ins finalized" value={`${t.summary.checkins_finalized} / ${t.summary.people}`} hint={`${t.summary.training_pending} training record(s) awaiting verification`} />
            <Stat label="Period state" value={<Badge status={t.period.state} />} hint="Locked snapshots stay unchanged" />
          </div>
          {t.period.training_rule && t.period.training_rule.state !== "Approved" && (
            <Callout tone="warn" title={`Training policy ${t.period.training_rule.label} is ${t.period.training_rule.state}`}>
              The 90/10 blend is a proposal. Results show the proposed combined score as a preview; the period cannot be locked until an independent approver activates the policy.
            </Callout>
          )}
          <ResultsTable rows={t.rows.slice(0, 12)} periodId={t.period.id} onOpen={(e) => navigate(`/performance/${e}/${t.period.id}`)} />
        </div>
      )}
      {t && tab === "results" && <ResultsTable rows={t.rows} periodId={t.period.id} onOpen={(e) => navigate(`/performance/${e}/${t.period.id}`)} />}
      {t && tab === "checkins" && (
        <Card title="Monthly check-ins" sub="Category-aware; quick; never repeats data already recorded in project work">
          <table className="table">
            <thead><tr><th>Person</th><th>Category</th><th>Latest finalized</th><th /></tr></thead>
            <tbody>
              {t.rows.map((r) => (
                <tr key={r.employee.id}>
                  <td><PersonChip person={r.employee} meta={r.employee.code} /></td>
                  <td>{r.category}</td>
                  <td>{r.checkin ? `${fmtDate(r.checkin.month).slice(3)} / ${r.checkin.state}` : <Badge tone="amber">Due</Badge>}</td>
                  <td><button className="link-btn" onClick={() => navigate(`/performance/${r.employee.id}/${t.period.id}?tab=checkin`)}>{r.checkin ? "Open check-in" : "Complete check-in"}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {t && tab === "training" && (
        <Card title="Training readiness" sub="Verified eligible completions / eligible due assignments">
          <table className="table">
            <thead><tr><th>Person</th><th>Allotted</th><th>Eligible due</th><th>Verified</th><th>Pending verification</th><th>Completion</th></tr></thead>
            <tbody>
              {t.rows.map((r) => (
                <tr key={r.employee.id}>
                  <td><PersonChip person={r.employee} meta={r.employee.code} /></td>
                  <td className="num">{r.training.allotted}</td>
                  <td className="num">{r.training.eligible}</td>
                  <td className="num">{r.training.verified}</td>
                  <td className="num">{r.training.pending_verification}</td>
                  <td>{r.training.status === "scored" ? fmtPct(r.training.score, 2) : r.training.status === "na" ? "N/A" : <Badge tone="amber">Readiness exception</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {tab === "snapshots" && periodId && <Snapshots periodId={periodId} />}
      {creating && <PeriodDrawer onClose={() => setCreating(false)} />}
      {locking && periodId && <LockDrawer periodId={periodId} onClose={() => setLocking(false)} />}
    </>
  );
}

function ResultsTable({ rows, onOpen }: { rows: TeamRow[]; periodId: number; onOpen: (employeeId: number) => void }) {
  if (!rows.length) return <Card><Empty title="No people in your performance scope for this period" /></Card>;
  return (
    <Card title="Team results">
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Person</th><th>Category</th><th>Coverage</th><th>Base KPI</th><th>Training</th><th>Final R&amp;R</th><th>Status</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.employee.id}>
                <td><PersonChip person={r.employee} meta={r.employee.code} /></td>
                <td>{r.category}</td>
                <td className="num">{fmtPct(r.coverage)}</td>
                <td className="num">{r.base_kpi !== null ? `${fmtScore(r.base_kpi, 1)} / 100` : <Badge tone="red">Insufficient data</Badge>}</td>
                <td className="num">{r.training.status === "scored" ? `${r.training.verified}/${r.training.eligible} / ${fmtPct(r.training.score)}` : r.training.status === "na" ? "N/A" : "Exception"}</td>
                <td className="num">{r.final.value !== null ? fmtScore(r.final.value) : "—"}{r.tier && <> <Badge status={r.tier} /></>}</td>
                <td><Badge status={r.status} /></td>
                <td><button className="link-btn" onClick={() => onOpen(r.employee.id)}>{r.status === "Ready for review" ? "Review evaluation" : "Complete evidence"}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Snapshots({ periodId }: { periodId: number }) {
  const { data } = useApiQuery<{ id: number; employee: Person; base_kpi: number | null; coverage: number; training_score: number | null; final_score: number | null; status: string; created_at: string }[]>(`/periods/${periodId}/snapshots`);
  return (
    <Card title="Locked snapshots" sub="Immutable: original inputs, policy versions, coverage and eligibility. New data never recalculates them silently.">
      {(data ?? []).length === 0 ? (
        <Empty title="No snapshots yet">Snapshots are created when the period is locked.</Empty>
      ) : (
        <table className="table">
          <thead><tr><th>Person</th><th>Base KPI</th><th>Coverage</th><th>Training</th><th>Final</th><th>Status</th><th>Locked</th></tr></thead>
          <tbody>
            {data!.slice(0, 200).map((s) => (
              <tr key={s.id}>
                <td>{s.employee.name} <span className="muted small">{s.employee.code}</span></td>
                <td className="num">{s.base_kpi !== null ? fmtScore(s.base_kpi) : "Insufficient"}</td>
                <td className="num">{fmtPct(s.coverage)}</td>
                <td className="num">{fmtPct(s.training_score)}</td>
                <td className="num">{s.final_score !== null ? fmtScore(s.final_score) : "—"}</td>
                <td><Badge status={s.status} /></td>
                <td>{fmtDateTime(s.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function PeriodDrawer({ onClose }: { onClose: () => void }) {
  const rules = useApiQuery<{ rules: { id: number; kind: string; label: string; state: string }[] }>("/rules");
  const [form, setForm] = useState({ name: "", period_type: "Quarterly", start_date: "", end_date: "", kpi_rule_id: "", training_rule_id: "", evidence_cutoff: "" });
  const save = useApiMutation<Record<string, unknown>>("post", "/periods");
  const kpi = (rules.data?.rules ?? []).filter((r) => r.kind === "kpi");
  const training = (rules.data?.rules ?? []).filter((r) => r.kind === "training");
  return (
    <Drawer
      open
      onClose={onClose}
      eyebrow="Performance > Period setup"
      title="Open a performance period"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => save.mutate({ ...form, kpi_rule_id: Number(form.kpi_rule_id), training_rule_id: Number(form.training_rule_id) || null, evidence_cutoff: form.evidence_cutoff ? `${form.evidence_cutoff}T18:00:00` : null }, { onSuccess: () => { toast("Period draft saved"); onClose(); } })}>Save period draft</Button>
        </>
      }
    >
      <FormError error={save.error} />
      <div className="form-grid">
        <Field label="Period name" required><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Jan-Mar 2027" /></Field>
        <Field label="Period type" required>
          <select className="input" value={form.period_type} onChange={(e) => setForm({ ...form, period_type: e.target.value })}>{["Monthly", "Quarterly", "Half-yearly", "Annual"].map((x) => <option key={x}>{x}</option>)}</select>
        </Field>
        <Field label="Start date" required><input type="date" className="input" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></Field>
        <Field label="End date" required><input type="date" className="input" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></Field>
        <Field label="KPI rule version" required>
          <select className="input" value={form.kpi_rule_id} onChange={(e) => setForm({ ...form, kpi_rule_id: e.target.value })}><option value="">Choose</option>{kpi.map((r) => <option key={r.id} value={r.id}>{r.label} / {r.state}</option>)}</select>
        </Field>
        <Field label="Training policy" help="Draft policies cannot score a live lock until approved.">
          <select className="input" value={form.training_rule_id} onChange={(e) => setForm({ ...form, training_rule_id: e.target.value })}><option value="">No training extension</option>{training.map((r) => <option key={r.id} value={r.id}>{r.label} / {r.state}</option>)}</select>
        </Field>
        <Field label="Evidence cutoff (18:00 IST)" required><input type="date" className="input" value={form.evidence_cutoff} onChange={(e) => setForm({ ...form, evidence_cutoff: e.target.value })} /></Field>
      </div>
      <p className="small muted mt">Lifecycle: Open &gt; Calculating &gt; Under review &gt; Locked. Earlier locked periods keep their original rules.</p>
    </Drawer>
  );
}

function LockDrawer({ periodId, onClose }: { periodId: number; onClose: () => void }) {
  const { data } = useApiQuery<{ period: Period; blockers: string[]; warnings: string[]; can_lock: boolean }>(`/periods/${periodId}/lock-readiness`);
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState(false);
  const lock = useApiMutation<Record<string, unknown>, { snapshots: number }>("post", `/periods/${periodId}/lock`);
  return (
    <Drawer
      open
      onClose={onClose}
      eyebrow="Performance > Snapshots"
      title="Lock a reproducible period snapshot"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!data?.can_lock || !confirm || !reason} onClick={() => lock.mutate({ reason, confirm }, { onSuccess: (r) => { toast(`Locked: ${r.snapshots} snapshots`); onClose(); } })}>Confirm period lock</Button>
        </>
      }
    >
      <FormError error={lock.error} />
      {data && (
        <div className="stack">
          <Callout title={`${data.period.name} / KPI ${data.period.kpi_rule.label} (${data.period.kpi_rule.state}) / Training ${data.period.training_rule?.label ?? "none"} (${data.period.training_rule?.state ?? "—"})`}>
            Locked values preserve original inputs, policy versions, coverage and eligibility. Late evidence, source fixes and overrides create explicit correction records.
          </Callout>
          {data.blockers.map((b) => <Callout key={b} tone="danger" title="Policy activation required">{b}</Callout>)}
          {data.warnings.map((w) => <Callout key={w} tone="warn" title="Review before locking">{w}</Callout>)}
          {!data.can_lock && !data.blockers.length && <Callout tone="warn" title="Lock authority">Lock authority is the HOD of the period scope or an Admin.</Callout>}
          <Field label="Lock reason" required><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Approved results and exceptions reviewed" /></Field>
          <label className="check"><input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} /> I reviewed missing-data exceptions, training records and policy versions.</label>
        </div>
      )}
    </Drawer>
  );
}
