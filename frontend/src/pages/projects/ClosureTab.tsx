import { useState } from "react";

import type { ProjectDetail } from "@/api/types";
import { Badge, Button, Callout, Card, DecisionButton, FormError, Loading, toast } from "@/components/ui";
import { useApiMutation, useApiQuery } from "@/lib/hooks";

interface Closure {
  state: string;
  stages: { stage: string; done: boolean; note: string | null; evidence: string | null; gap: string | null }[];
  ready: boolean;
  hod_required: boolean;
  decision_owner: string;
  hod_available: boolean;
  decision_reason: string | null;
  history: { at: string; event: string; actor: string; note?: string }[];
}

const LABELS: Record<string, string> = {
  tasks: "Tasks accepted",
  milestones: "Milestones ready",
  deliverables: "Deliverables linked",
  objectives: "Objectives reviewed",
  issues: "Open issues assessed",
  lessons: "Lessons recorded",
  remarks: "Final remarks",
};

export function ClosureTab({ project }: { project: ProjectDetail }) {
  const { data, isLoading } = useApiQuery<Closure>(`/projects/${project.id}/closure`);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const stage = useApiMutation<{ stage: string; done: boolean; note: string | null }>("put", `/projects/${project.id}/closure/stage`);
  const submit = useApiMutation<Record<string, never>>("post", `/projects/${project.id}/closure/submit`);
  const decide = useApiMutation<{ decision: string; reason?: string }>("post", `/projects/${project.id}/closure/decide`);
  if (isLoading || !data) return <Loading />;
  const err = stage.error ?? submit.error ?? decide.error;
  const editable = project.can_manage && ["Draft", "Returned"].includes(data.state);

  return (
    <div className="grid grid-main">
      <Card title="Close a project with evidence" sub={`${project.priority ?? "No"} priority${data.hod_required ? " / HOD approval required" : ""}`}>
        <FormError error={err} />
        <table className="table">
          <thead><tr><th>Stage</th><th>Evidence / gap</th><th>Note</th><th>Ready</th></tr></thead>
          <tbody>
            {data.stages.map((s) => (
              <tr key={s.stage}>
                <td><b>{LABELS[s.stage]}</b></td>
                <td>{s.evidence ?? "—"}{s.gap && <div className="sub" style={{ color: "var(--red-fg)" }}>Gap: {s.gap}</div>}</td>
                <td>
                  {editable ? (
                    <input className="input" defaultValue={s.note ?? ""} onChange={(e) => setNotes({ ...notes, [s.stage]: e.target.value })} placeholder="Linked evidence or note" />
                  ) : (
                    s.note ?? "—"
                  )}
                </td>
                <td>
                  {editable ? (
                    <label className="check">
                      <input type="checkbox" checked={s.done} onChange={(e) => stage.mutate({ stage: s.stage, done: e.target.checked, note: notes[s.stage] ?? s.note })} /> Confirmed
                    </label>
                  ) : (
                    <Badge status={s.done ? "Completed" : "Pending"}>{s.done ? "Ready" : "Gap"}</Badge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row between mt">
          <Badge status={data.state} />
          {editable && <Button variant="primary" disabled={!data.ready} onClick={() => submit.mutate({}, { onSuccess: () => toast("Closure submitted for approval") })}>Submit for closure approval</Button>}
          {data.state === "Submitted" && (
            <span className="row">
              <DecisionButton label="Return with comment" decision="return" onDecide={(d, reason) => decide.mutate({ decision: d, reason })} />
              <DecisionButton label="Approve closure" decision="approve" variant="primary" reasonRequired={false} onDecide={(d, reason) => decide.mutate({ decision: d, reason }, { onSuccess: () => toast("Closure approved") })} />
            </span>
          )}
        </div>
      </Card>
      <div className="stack">
        <Callout title="Decision owner">{data.decision_owner}. {data.hod_required && !data.hod_available && "No HOD is linked to this department (vacant position); an Admin must assign one before High-priority closure."}</Callout>
        <Callout title="Reviewer decision">Approve closure / Return with a reason. Both decisions enter the audit history. A status change cannot hide unresolved mandatory work.</Callout>
        {data.decision_reason && <Callout tone="warn" title="Last decision reason">{data.decision_reason}</Callout>}
        <Card title="Closure history">
          {data.history.length === 0 && <p className="muted">No closure events yet.</p>}
          {data.history.map((h, i) => <p key={i}><b>{h.event}</b> / {h.actor} / {h.at.replace("T", " ")}{h.note ? ` / ${h.note}` : ""}</p>)}
        </Card>
      </div>
    </div>
  );
}
