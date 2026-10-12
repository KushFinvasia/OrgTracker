import { useState } from "react";

import type { Person } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { Badge, Button, Callout, Card, DecisionButton, FormError, Loading, PageHeader, Tabs, toast } from "@/components/ui";
import { LineChart } from "@/components/ui/charts";
import { fmtDateTime, fmtScore } from "@/lib/format";
import { useApiMutation, useApiQuery, useQueryParam } from "@/lib/hooks";

type Tab = "weights" | "curves" | "mappings" | "training" | "approval";

interface Rule {
  id: number;
  kind: string;
  label: string;
  config: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  state: string;
  summary: string | null;
  author: Person | null;
  approver: Person | null;
  decision_note: string | null;
  created_at: string;
  can_decide: boolean;
}
interface RulesData {
  rules: Rule[];
  metrics: Record<string, string>;
  categories: string[];
  departments: { id: number; name: string; category: string; category_proposed: boolean; aliases: string | null; notes: string | null }[];
}

export function RulesStudioPage() {
  const { isRole } = useAuth();
  const [tabParam, setTabParam] = useQueryParam("tab");
  const tab = (tabParam as Tab) || "weights";
  const { data, isLoading } = useApiQuery<RulesData>("/rules");
  if (isLoading || !data) return <Loading rows={2} />;
  const kpi = data.rules.find((r) => r.kind === "kpi" && r.state === "Approved") ?? data.rules.find((r) => r.kind === "kpi")!;
  const training = data.rules.find((r) => r.kind === "training");
  const pending = data.rules.filter((r) => r.state === "Pending approval");

  return (
    <>
      <PageHeader title="A rules studio, not a maze of settings." sub={`KPI ${kpi.label} (${kpi.state}) / Training ${training ? `${training.label} (${training.state})` : "none"} / Locked periods retain their versions`} />
      <Callout tone="warn" title="A second person must approve score-affecting changes.">Named author &gt; independent approver. Impact preview before activation. Existing locked snapshots are unchanged.</Callout>
      <div className="mt" />
      <Tabs
        value={tab}
        onChange={(t) => setTabParam(t)}
        tabs={[
          { id: "weights", label: "Category weights" },
          { id: "curves", label: "Scoring curves" },
          { id: "mappings", label: "Mappings" },
          { id: "training", label: "Training policy" },
          { id: "approval", label: `Approvals${pending.length ? ` (${pending.length})` : ""}` },
        ]}
      />
      {tab === "weights" && (
        <div className="grid grid-main">
          <Card title="Category weights / Each column totals 100%" sub={`Rule ${kpi.label}`}>
            <table className="table">
              <thead><tr><th>Metric</th>{data.categories.map((c) => <th key={c}>{c}{kpi.config.proposed_categories?.includes(c) ? " (proposed)" : ""}</th>)}</tr></thead>
              <tbody>
                {Object.entries(data.metrics).map(([m, label]) => (
                  <tr key={m}><td><b>{label}</b></td>{data.categories.map((c) => <td key={c} className="num">{kpi.config.weights[c]?.[m] ?? 0}%</td>)}</tr>
                ))}
                <tr><td><b>Total</b></td>{data.categories.map((c) => <td key={c} className="num strong">{Object.values(kpi.config.weights[c] as Record<string, number>).reduce((a, b) => a + b, 0)}%</td>)}</tr>
              </tbody>
            </table>
            <p className="small muted">Productivity is an unweighted recognition tie-breaker. "Culture" maps to Collaboration (to confirm). The old 60/40 split is retired.</p>
          </Card>
          <Card title="Minimum evidence">
            {Object.entries(kpi.config.minimums as Record<string, number>).map(([k, v]) => <p key={k}>{k.replace(/_/g, " ")}: <b>{v}</b></p>)}
            <p className="small muted">Coverage below 70% shows Insufficient Data. Unavailable metrics are never fabricated as zero.</p>
          </Card>
        </div>
      )}
      {tab === "curves" && (
        <div className="grid grid-2">
          {Object.entries(kpi.config.anchors as Record<string, [number, number][]>).map(([name, pts]) => (
            <Card key={name} title={`${name.replace("_", " ")} curve`} sub={pts.map(([x, y]) => `${x} > ${y}`).join("; ")}>
              <LineChart label={`${name} scoring curve`} points={pts.map(([x, y]) => ({ label: String(x), value: y }))} max={100} />
            </Card>
          ))}
          <Card title="Rules">
            <p>Linear interpolation between anchors, clamped at endpoints. Compliance: start 100; Minor -20, Medium -40, Major -100; floor 0. Quality = 60% rework score + 40% (manager rating x 20). Collaboration and Innovation = rubric rating x 20.</p>
          </Card>
        </div>
      )}
      {tab === "mappings" && <Mappings data={data} canEdit={isRole("admin")} />}
      {tab === "training" && training && (
        <div className="grid grid-main">
          <Card title="Configure the training contribution once" sub={`Policy ${training.label} / ${training.state}`}>
            <table className="table">
              <tbody>
                <tr><td>Base KPI weight</td><td className="num strong">{Math.round(training.config.base_weight * 100)}%</td></tr>
                <tr><td>Training completion weight</td><td className="num strong">{Math.round(training.config.training_weight * 100)}%</td></tr>
                <tr><td>Eligible assignments</td><td>{training.config.eligibility}</td></tr>
                <tr><td>Completion requirement</td><td>{training.config.completion_requirement}</td></tr>
                <tr><td>Equal-course weighting</td><td>{training.config.equal_course_weight ? "Enabled / baseline proposal" : "Off"}</td></tr>
                <tr><td>No applicable due training</td><td>{training.config.no_due_treatment}</td></tr>
                <tr><td>Known due / none completed</td><td>Training score = 0%</td></tr>
                <tr><td>Missing training records</td><td>Readiness exception / no assumed zero</td></tr>
              </tbody>
            </table>
          </Card>
          <div className="stack">
            <Callout title="Outside the category weights">Training sits outside the existing category KPI weights. Combined weights total 100%. No double-counting.</Callout>
            <Callout tone="warn" title="KPI sufficiency still required">A training score cannot rescue a base KPI result with coverage below 70%.</Callout>
            <Callout tone="warn" title="Configurable proposals">90/10, equal course counts, exemption rules and cutoff are proposed values, not approved production policy.</Callout>
          </div>
        </div>
      )}
      {tab === "approval" && <Approvals rules={data.rules} />}
    </>
  );
}

function Mappings({ data, canEdit }: { data: RulesData; canEdit: boolean }) {
  const save = useApiMutation<{ department_id: number; category: string; reason: string }>("post", "/rules/mappings");
  const [edits, setEdits] = useState<Record<number, string>>({});
  return (
    <Card title="Map departments to effective scoring categories" sub="Effective-dated mappings prevent team moves from rewriting prior results">
      <FormError error={save.error} />
      <table className="table">
        <thead><tr><th>Department</th><th>Category</th><th>Tracker aliases</th><th>Notes</th>{canEdit && <th />}</tr></thead>
        <tbody>
          {data.departments.map((d) => (
            <tr key={d.id}>
              <td><b>{d.name}</b></td>
              <td>
                {canEdit ? (
                  <select className="input" value={edits[d.id] ?? d.category} onChange={(e) => setEdits({ ...edits, [d.id]: e.target.value })}>{data.categories.map((c) => <option key={c}>{c}</option>)}</select>
                ) : (
                  d.category
                )}
                {d.category_proposed && <Badge tone="amber">Proposed</Badge>}
              </td>
              <td className="small">{d.aliases ?? "—"}</td>
              <td className="small">{d.notes ?? "—"}</td>
              {canEdit && <td>{edits[d.id] && edits[d.id] !== d.category && <DecisionButton size="sm" label="Save mapping" decision="save" onDecide={(_, reason) => save.mutate({ department_id: d.id, category: edits[d.id], reason }, { onSuccess: () => toast("Mapping saved") })} />}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small muted">NBFC, jUMPP and RMS & Dealer teams may need approved team-level overrides. Customer Service remains proposed until approved.</p>
    </Card>
  );
}

function Approvals({ rules }: { rules: Rule[] }) {
  const [ruleParam, setRuleParam] = useQueryParam("rule");
  const selected = rules.find((r) => String(r.id) === ruleParam) ?? rules.find((r) => r.state === "Pending approval") ?? rules[0];
  const impact = useApiQuery<{ rows: { employee: Person; base: number | null; training: number | null; current_final: number | null; proposed_final: number | null; change: number | null; status: string }[]; period: { name: string } | null; note: string }>(selected ? `/rules/${selected.id}/impact` : null);
  const decide = useApiMutation<{ decision: string; reason?: string }>("post", `/rules/${selected?.id}/decide`);
  const submit = useApiMutation<Record<string, never>>("post", `/rules/${selected?.id}/submit`);
  return (
    <div className="grid grid-main">
      <Card title="Score impact preview" sub={`${selected?.kind.toUpperCase()} ${selected?.label} / ${impact.data?.period?.name ?? ""}`}>
        <FormError error={decide.error ?? submit.error} />
        {impact.isLoading ? <Loading /> : (
          <table className="table">
            <thead><tr><th>Person</th><th>Existing base</th><th>Training</th><th>Proposed final</th><th>Change</th></tr></thead>
            <tbody>
              {(impact.data?.rows ?? []).map((r) => (
                <tr key={r.employee.id}>
                  <td>{r.employee.name} <span className="small muted">{r.employee.code}</span></td>
                  <td className="num">{r.base !== null ? fmtScore(r.base) : "Insufficient"}</td>
                  <td className="num">{r.training !== null ? `${fmtScore(r.training, 0)}%` : "—"}</td>
                  <td className="num">{r.proposed_final !== null ? fmtScore(r.proposed_final) : "No score"}</td>
                  <td className="num">{r.change !== null ? (r.change >= 0 ? "+" : "") + fmtScore(r.change) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="small muted">{impact.data?.note}</p>
      </Card>
      <div className="stack">
        <Card title="Versions">
          {rules.map((r) => (
            <button key={r.id} className="link-btn" style={{ display: "block", padding: "6px 0", color: r.id === selected?.id ? "var(--green)" : "var(--ink)" }} onClick={() => setRuleParam(String(r.id))}>
              {r.kind.toUpperCase()} {r.label} <Badge status={r.state} />
            </button>
          ))}
        </Card>
        {selected && (
          <Card title="Approval checklist">
            <p>{selected.summary}</p>
            <p className="small muted">Author: {selected.author?.name ?? "—"} / Approver: {selected.approver?.name ?? "pending"} {selected.decision_note ? `/ ${selected.decision_note}` : ""}</p>
            <p className="small muted">Created {fmtDateTime(selected.created_at)}</p>
            {selected.state === "Draft" && <Button variant="primary" onClick={() => submit.mutate({}, { onSuccess: () => toast("Sent for second approval") })}>Send for approval</Button>}
            {selected.can_decide && (
              <div className="row between mt">
                <DecisionButton label="Return draft" decision="return" onDecide={(d, reason) => decide.mutate({ decision: d, reason })} />
                <DecisionButton label="Approve version" decision="approve" variant="primary" onDecide={(d, reason) => decide.mutate({ decision: d, reason }, { onSuccess: () => toast("Version approved and activated for its effective period") })} />
              </div>
            )}
            {selected.state === "Pending approval" && !selected.can_decide && <Callout tone="warn" title="Independent approver required">A different named Admin or HOD approves score-affecting changes.</Callout>}
          </Card>
        )}
      </div>
    </div>
  );
}
