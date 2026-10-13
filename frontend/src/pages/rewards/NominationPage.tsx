import { useState } from "react";
import { useParams } from "react-router-dom";

import type { Person } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { Badge, Button, Callout, Card, DecisionButton, ErrorState, Field, FormError, Loading, PageHeader, PersonChip, toast } from "@/components/ui";
import { fmtPct, fmtScore, wordCount } from "@/lib/format";
import { useApiMutation, useApiQuery } from "@/lib/hooks";
import type { NominationRow } from "./RewardsPage";

interface NominationDetail extends NominationRow {
  reviewers: { account_id: number; employee: Person; role: string }[];
}

export function NominationPage() {
  const { id } = useParams();
  const { account } = useAuth();
  const { data: n, isLoading, error } = useApiQuery<NominationDetail>(`/nominations/${id}`);
  const [edit, setEdit] = useState<{ citation: string; evidence: string } | null>(null);
  const [reviewer, setReviewer] = useState("");
  const update = useApiMutation<Record<string, unknown>>("patch", `/nominations/${id}`);
  const submit = useApiMutation<{ reviewer_account_id: number }>("post", `/nominations/${id}/submit`);
  const decide = useApiMutation<{ decision: string; reason?: string }>("post", `/nominations/${id}/decide`);
  if (isLoading) return <Loading rows={2} />;
  if (error || !n) return <ErrorState error={error} />;
  const mine = n.nominator?.id === account?.employee.id;
  const editable = mine && ["Draft", "Returned"].includes(n.state);
  const cit = edit?.citation ?? n.citation;
  const ev = edit?.evidence ?? n.evidence ?? "";

  return (
    <>
      <PageHeader title="Review the contribution, then make the decision." sub={`${n.employee.name} / ${n.award_type} / ${n.state === "Submitted" ? "Independent review" : n.state}`} />
      <FormError error={update.error ?? submit.error ?? decide.error} />
      <div className="grid grid-main">
        <Card title="The contribution" actions={<Badge status={n.state} />}>
          {editable ? (
            <div className="stack">
              <Field label="Citation" required help={`${wordCount(cit)} words${n.award_type !== "Top Performer" ? " / minimum 50" : ""}`}>
                <textarea className="input" style={{ minHeight: 180 }} value={cit} onChange={(e) => setEdit({ citation: e.target.value, evidence: ev })} />
              </Field>
              <Field label="Linked evidence" required><input className="input" value={ev} onChange={(e) => setEdit({ citation: cit, evidence: e.target.value })} /></Field>
              <Button onClick={() => update.mutate({ cycle_id: n.cycle_id, employee_id: n.employee.id, award_type: n.award_type, citation: cit, evidence: ev }, { onSuccess: () => { setEdit(null); toast("Draft saved"); } })}>Save draft</Button>
              <Field label="Independent reviewer" required>
                <select className="input" value={reviewer} onChange={(e) => setReviewer(e.target.value)}>
                  <option value="">Choose a named reviewer</option>
                  {n.reviewers.filter((r) => r.employee.id !== account?.employee.id).map((r) => <option key={r.account_id} value={r.account_id}>{r.employee.name} / {r.role}</option>)}
                </select>
              </Field>
              <Button variant="primary" disabled={!reviewer} onClick={() => submit.mutate({ reviewer_account_id: Number(reviewer) }, { onSuccess: () => toast("Nomination sent") })}>Send nomination</Button>
            </div>
          ) : (
            <>
              <p style={{ fontSize: 15, lineHeight: 1.6 }}>{n.citation}</p>
              <p className="small muted">{n.citation_words}-word citation</p>
              <h4 className="mt">Linked evidence</h4>
              <p>{n.evidence ?? "—"}</p>
            </>
          )}
          {n.decision_reason && <Callout tone="warn" title="Decision note">{n.decision_reason}</Callout>}
          {n.can_decide && (
            <div className="row between mt">
              <DecisionButton label="Return with comment" decision="return" onDecide={(d, reason) => decide.mutate({ decision: d, reason }, { onSuccess: () => toast("Returned") })} />
              <DecisionButton label="Approve" decision="approve" variant="primary" reasonRequired={false} onDecide={(d, reason) => decide.mutate({ decision: d, reason }, { onSuccess: () => toast("Approved. Publication is a separate step.") })} />
            </div>
          )}
        </Card>
        <div className="stack">
          <Card title="Review safeguards">
            <PersonChip person={n.employee} meta={`${n.employee.code} / ${n.employee.department ?? "No department"}`} />
            {n.snapshot && (
              <>
                <p className="mt">Locked final {n.snapshot.final !== null ? fmtScore(n.snapshot.final) : "—"} / coverage {fmtPct(n.snapshot.coverage)} / {n.snapshot.tier ?? "no tier"} (draft)</p>
                {n.snapshot.gates.map((g) => <p key={g.gate}><Badge status={g.result}>{g.result}</Badge> {g.gate} <span className="muted small">/ {g.source}</span></p>)}
              </>
            )}
            <p className="small muted">Nominator: {n.nominator?.name} / Reviewer: {n.reviewer?.name ?? "not yet assigned"}</p>
          </Card>
          <Callout title={mine ? "You are the nominator" : "You are not the nominator"}>A nominator cannot approve their own nomination. Approval is separate from publication.</Callout>
        </div>
      </div>
    </>
  );
}
