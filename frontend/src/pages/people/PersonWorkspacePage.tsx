import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import type { Person, TrainingAssignment, TrainingSummary } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { Avatar, Badge, Button, Callout, Card, Empty, ErrorState, Kv, Loading, PageHeader, PersonChip, Progress, Stat, Tabs } from "@/components/ui";
import { AssignTrainingDrawer, TrainingRecordDrawer } from "@/components/training/TrainingDrawers";
import { fmtDate, fmtNum, fmtPct, fmtScore } from "@/lib/format";
import { useApiQuery, useQueryParam } from "@/lib/hooks";

type Tab = "overview" | "work" | "training" | "performance" | "recognition" | "history";

interface PersonData extends Person {
  hrms_code: string | null;
  manager: Person | null;
  flags: string | null;
  proposed_role: string | null;
  reports: Person[];
  work: { assigned: number; active: number; accepted: number; accepted_output: number; reported_progress: number | null; overdue: number; blocked: number; projects: number };
  reporting_history: { manager: Person | null; from: string; to: string | null; reason: string | null }[];
  can_see_performance: boolean;
  period: { id: number; name: string; state: string } | null;
  performance?: {
    base_kpi: number | null;
    coverage: number;
    final: { status: string; value: number | null };
    tier: string | null;
    training: { allotted: number; eligible: number; verified: number; score: number | null; status: string };
    period: { id: number; name: string; state: string };
    training_rule: { label: string; state: string } | null;
  };
  recognition?: { id: number; award_type: string; state: string }[];
  snapshots?: { id: number; period_id: number; final: number | null; base: number | null; status: string }[];
}

interface WorkRow {
  task_id: number;
  code: string;
  title: string;
  role: string;
  share: number;
  status: string;
  due_date: string | null;
  progress: number;
  complexity: number;
  timing: string;
  weighted_output: number | null;
}

export function PersonWorkspacePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { account, isRole } = useAuth();
  const [tabParam, setTabParam] = useQueryParam("tab");
  const [assignmentParam, setAssignmentParam] = useQueryParam("assignment");
  const tab = (tabParam as Tab) || "overview";
  const [assigning, setAssigning] = useState(false);
  const person = useApiQuery<PersonData>(`/people/${id}`);
  const work = useApiQuery<WorkRow[]>(tab === "work" || tab === "overview" ? `/people/${id}/work` : null);
  const training = useApiQuery<{ assignments: TrainingAssignment[]; summary: TrainingSummary | null; period: { id: number; name: string } | null }>(`/people/${id}/training`);
  if (person.isLoading) return <Loading rows={3} />;
  if (person.error || !person.data) return <ErrorState error={person.error} />;
  const p = person.data;
  const perf = p.performance;
  const ts = training.data?.summary;

  return (
    <>
      <PageHeader
        title={<span className="row"><Avatar person={p} size="lg" /> {p.name}</span>}
        sub={`${p.code} / ${p.designation} / ${p.department}${p.manager ? ` / Reporting to ${p.manager.name}` : ""}`}
        actions={
          <>
            {tab === "training" && p.can_see_performance && !isRole("team_lead") && <Button variant="primary" onClick={() => setAssigning(true)}>Assign training</Button>}
            {p.can_see_performance && perf && tab !== "training" && <Button variant="primary" onClick={() => navigate(`/performance/${p.id}/${perf.period.id}`)}>Open evaluation</Button>}
          </>
        }
      />
      <Tabs
        value={tab}
        onChange={(t) => setTabParam(t)}
        tabs={[
          { id: "overview", label: "Overview" },
          { id: "work", label: "Assigned work" },
          { id: "training", label: "Training" },
          { id: "performance", label: "Performance", hidden: !p.can_see_performance },
          { id: "recognition", label: "Recognition", hidden: !p.can_see_performance },
          { id: "history", label: "History" },
        ]}
      />
      {tab === "overview" && (
        <div className="stack">
          <div className="grid grid-4">
            <Stat label="Assigned work" value={p.work.assigned} hint={`Across ${p.work.projects} permitted project(s)`} />
            <Stat label="Accepted output" value={fmtNum(p.work.accepted_output, 2)} hint="Complexity x contribution" />
            <Stat label="Reported progress" value={fmtPct(p.work.reported_progress)} hint="Active task update (planning only)" />
            <Stat label="Training due" value={ts ? ts.eligible : "—"} hint={ts ? `${ts.verified} verified / ${fmtPct(ts.score)} completion` : "Score hidden for your role"} />
          </div>
          <div className="grid grid-main">
            <Card title="Current contributions">
              <WorkTable rows={(work.data ?? []).filter((w) => w.status !== "Completed").slice(0, 8)} onOpen={(tid) => navigate(`/tasks?task=${tid}`)} />
            </Card>
            <div className="stack">
              {perf ? (
                <div className="score-card">
                  <div className="label">BASE KPI SNAPSHOT</div>
                  <div className="big">{perf.base_kpi !== null ? fmtScore(perf.base_kpi, 1) : "Insufficient"}</div>
                  <div>{perf.period.name} / {perf.period.state} / {fmtPct(perf.coverage)} data coverage</div>
                  <hr />
                  <div>Training {fmtPct(perf.training.score)} ({perf.training.verified}/{perf.training.eligible})</div>
                  <div>Final R&amp;R {perf.final.value !== null ? fmtScore(perf.final.value) : perf.final.status.replace("_", " ")}</div>
                  {perf.training_rule && perf.training_rule.state !== "Approved" && <span className="pill mt" style={{ marginTop: 12 }}>Policy {perf.training_rule.label} / proposed, not activated</span>}
                </div>
              ) : (
                <Callout title="Private performance unavailable">Your access includes this person's work, not their private KPI, check-in or training score.</Callout>
              )}
              <Callout title="Work progress and performance are different measures">A reported progress update helps delivery planning. Accepted output and validated records feed the KPI score.</Callout>
            </div>
          </div>
        </div>
      )}
      {tab === "work" && (
        <Card title="Assigned and accepted work">
          {work.isLoading ? <Loading /> : <WorkTable rows={work.data ?? []} onOpen={(tid) => navigate(`/tasks?task=${tid}`)} />}
        </Card>
      )}
      {tab === "training" && (
        <div className="stack">
          {ts && (
            <div className="grid grid-4">
              <Stat label="Allotted" value={ts.allotted} hint="All training assignments" />
              <Stat label="Due this period" value={ts.eligible} hint={`Eligible denominator / ${ts.future_due} future-due excluded`} />
              <Stat label="Verified complete" value={ts.verified} hint="Within the period cutoff" />
              <Stat label="Completion" value={ts.status === "scored" ? fmtPct(ts.score) : ts.status === "na" ? "N/A" : "Readiness exception"} hint={`${ts.verified} / ${ts.eligible} eligible assignments`} />
            </div>
          )}
          <Card title="Training assignments" sub={training.data?.period?.name}>
            {(training.data?.assignments ?? []).length === 0 ? (
              <Empty title="No training assigned">This alone does not prove no training is applicable.</Empty>
            ) : (
              <table className="table">
                <thead><tr><th>Training</th><th>Assigned / due</th><th>Status</th><th>Progress</th><th>Evidence</th><th /></tr></thead>
                <tbody>
                  {training.data!.assignments.map((a) => (
                    <tr key={a.id}>
                      <td><b>{a.course.title}</b><div className="sub">{a.course.code} / {a.training_type}</div></td>
                      <td>{fmtDate(a.assigned_date, false)} / {fmtDate(a.due_date, false)}</td>
                      <td><Badge status={a.display_status} />{a.overdue && <Badge tone="red">Overdue</Badge>}</td>
                      <td style={{ minWidth: 140 }}><Progress value={a.progress} /></td>
                      <td>{a.status === "Verified complete" ? "Certificate verified" : a.status === "Submitted" ? "Awaiting reviewer" : a.display_status === "Upcoming" ? "Not due this period" : a.status === "In progress" ? "Assessment pending" : "—"}</td>
                      <td><button className="link-btn" onClick={() => setAssignmentParam(String(a.id))}>{a.can_verify ? "Verify" : a.status === "Verified complete" ? "View record" : "Update"}</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <Callout title="Scoring uses verified completion">Submitted at 100% is not verified. Future-due training is excluded from the current denominator.</Callout>
          </Card>
        </div>
      )}
      {tab === "performance" && perf && (
        <div className="grid grid-3">
          <Stat label="Base KPI" value={perf.base_kpi !== null ? fmtScore(perf.base_kpi) : "Insufficient"} hint={`${fmtPct(perf.coverage)} coverage`} />
          <Stat label="Training completion" value={fmtPct(perf.training.score)} hint={`${perf.training.verified} / ${perf.training.eligible}`} />
          <Stat label="Final R&R" value={perf.final.value !== null ? fmtScore(perf.final.value) : "Unavailable"} hint={perf.tier ? `${perf.tier} threshold (draft tiers)` : perf.final.status} />
          <div style={{ gridColumn: "1 / -1" }}>
            <Button variant="primary" onClick={() => navigate(`/performance/${p.id}/${perf.period.id}`)}>Open evaluation</Button>
          </div>
        </div>
      )}
      {tab === "recognition" && (
        <Card title="Recognition">
          {(p.recognition ?? []).length === 0 ? <Empty title="No nominations yet" /> : (
            <table className="table"><thead><tr><th>Award</th><th>State</th><th /></tr></thead>
              <tbody>{p.recognition!.map((r) => <tr key={r.id}><td>{r.award_type}</td><td><Badge status={r.state} /></td><td><button className="link-btn" onClick={() => navigate(`/rewards/nominations/${r.id}`)}>Open</button></td></tr>)}</tbody>
            </table>
          )}
        </Card>
      )}
      {tab === "history" && (
        <div className="grid grid-2">
          <Card title="Identity">
            <Kv items={[["Record ID", p.code], ["HRMS code", p.hrms_code ?? "To confirm before go-live"], ["Proposed role", p.proposed_role ?? "—"], ["Flags", p.flags ?? "None"]]} />
            {p.reports.length > 0 && (<><h4 className="mt mb">Direct reports</h4>{p.reports.map((r) => <PersonChip key={r.id} person={r} />)}</>)}
          </Card>
          <Card title="Reporting history" sub="Effective-dated; identity never changes">
            {p.reporting_history.map((h, i) => <p key={i}>{h.manager?.name ?? "—"} from {fmtDate(h.from)}{h.to ? ` to ${fmtDate(h.to)}` : ""} <span className="muted">/ {h.reason}</span></p>)}
            {(p.snapshots ?? []).length > 0 && (<><h4 className="mt">Locked snapshots</h4>{p.snapshots!.map((s) => <p key={s.id}>Period #{s.period_id}: {s.final !== null ? fmtScore(s.final) : s.status}</p>)}</>)}
          </Card>
        </div>
      )}
      {assigning && <AssignTrainingDrawer people={[p]} periodId={training.data?.period?.id} onClose={() => setAssigning(false)} />}
      {assignmentParam && <TrainingRecordDrawer assignmentId={Number(assignmentParam)} canRecord={account?.employee.id !== p.id} onClose={() => setAssignmentParam(null)} />}
    </>
  );
}

function WorkTable({ rows, onOpen }: { rows: WorkRow[]; onOpen: (id: number) => void }) {
  if (!rows.length) return <Empty title="No assigned work in your permitted projects" />;
  return (
    <table className="table">
      <thead><tr><th>Task</th><th>Role / share</th><th>State</th><th>Due in force</th><th>Progress</th><th>Weighted output</th></tr></thead>
      <tbody>
        {rows.map((w) => (
          <tr key={w.task_id} className="clickable" onClick={() => onOpen(w.task_id)}>
            <td><b>{w.title}</b><div className="sub">{w.code}</div></td>
            <td>{w.role} / {w.share}%</td>
            <td><Badge status={w.status} /></td>
            <td>{fmtDate(w.due_date, false)}</td>
            <td className="num">{w.progress}%</td>
            <td className="num">{w.weighted_output ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
