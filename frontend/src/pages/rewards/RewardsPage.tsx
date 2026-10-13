import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import type { Period, Person } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { Badge, Button, Callout, Card, Drawer, Empty, Field, FormError, Loading, PageHeader, PersonChip, Stat, Tabs, toast } from "@/components/ui";
import { fmtDate, fmtDateTime, fmtPct, fmtScore } from "@/lib/format";
import { useApiMutation, useApiQuery, useQueryParam } from "@/lib/hooks";

type Tab = "overview" | "eligibility" | "nominations" | "published";

interface Cycle {
  id: number;
  title: string;
  period: { id: number; name: string; state: string };
  nomination_start: string | null;
  nomination_end: string | null;
  review_deadline: string | null;
  gold_cap_enabled: boolean;
  audience: string;
  state: string;
  owner: Person | null;
  published_at: string | null;
  counts: Record<string, number>;
}
interface CyclesData {
  cycles: Cycle[];
  policy: { config: { tiers: [string, number][]; min_coverage: number; min_days_in_role: number; gold_cap_pct: number }; label: string; state: string };
  award_types: string[];
}
interface EligibilityRow {
  employee: Person;
  snapshot_id: number;
  final: number | null;
  coverage: number;
  status: string;
  tier: string | null;
  gates: { gate: string; result: string; source: string }[];
  eligible: boolean;
}
export interface NominationRow {
  id: number;
  cycle_id: number;
  employee: Person;
  award_type: string;
  citation: string;
  citation_words: number;
  evidence: string | null;
  state: string;
  nominator: Person | null;
  reviewer: Person | null;
  decision_reason: string | null;
  snapshot?: { final: number | null; tier: string | null; coverage: number; gates: { gate: string; result: string; source: string }[] };
  can_decide: boolean;
}

export function RewardsPage() {
  const { isRole } = useAuth();
  const navigate = useNavigate();
  const [tabParam, setTabParam] = useQueryParam("tab");
  const tab = (tabParam as Tab) || "overview";
  const data = useApiQuery<CyclesData>("/reward-cycles");
  const [cycleId, setCycleId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [nominating, setNominating] = useState<EligibilityRow | null>(null);
  useEffect(() => {
    if (!cycleId && data.data?.cycles.length) setCycleId(data.data.cycles[0].id);
  }, [data.data, cycleId]);
  const cycle = data.data?.cycles.find((c) => c.id === cycleId);
  const privateOk = !isRole("team_lead");
  const eligibility = useApiQuery<{ rows: EligibilityRow[] }>(cycleId && privateOk && (tab === "eligibility" || tab === "overview") ? `/reward-cycles/${cycleId}/eligibility` : null);
  const nominations = useApiQuery<NominationRow[]>(cycleId && privateOk ? `/nominations?cycle_id=${cycleId}` : null);
  const awards = useApiQuery<{ id: number; award_type: string; citation: string; employee: Person; cycle: string; published_at: string; audience: string }[]>("/awards");
  const advance = useApiMutation<Record<string, never>>("post", `/reward-cycles/${cycleId}/advance`);
  if (data.isLoading) return <Loading rows={2} />;
  const policy = data.data!.policy;

  return (
    <>
      <PageHeader
        title="Recognise the work that made a difference."
        sub={cycle ? `${cycle.title} / Linked period ${cycle.period.name} (${cycle.period.state}) / Tier policy ${policy.label} (${policy.state})` : "No recognition cycle yet"}
        actions={
          <>
            {(data.data?.cycles.length ?? 0) > 1 && (
              <select className="input" style={{ width: 220 }} value={cycleId ?? ""} onChange={(e) => setCycleId(Number(e.target.value))}>
                {data.data!.cycles.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
            )}
            {isRole("admin", "hod") && <Button onClick={() => setCreating(true)}>New cycle</Button>}
            {cycle?.state === "Nominations" && privateOk && <Button variant="primary" onClick={() => setTabParam("eligibility")}>New nomination</Button>}
          </>
        }
      />
      <Tabs
        value={tab}
        onChange={(t) => setTabParam(t)}
        tabs={[
          { id: "overview", label: "Cycle overview" },
          { id: "eligibility", label: "Eligibility", hidden: !privateOk },
          { id: "nominations", label: `Nominations (${nominations.data?.length ?? 0})`, hidden: !privateOk },
          { id: "published", label: "Published awards" },
        ]}
      />
      <FormError error={advance.error} />
      {tab === "overview" && (
        <div className="stack">
          <div className="grid grid-3">
            {policy.config.tiers.map(([name, threshold]) => (
              <div key={name} className="stat"><div className="label">{name}</div><div className="value">{threshold}+</div><div className="hint">{policy.state === "Approved" ? "Approved threshold" : "Proposed threshold"}</div></div>
            ))}
          </div>
          {cycle ? (
            <Card title={cycle.title} actions={<Badge status={cycle.state} />}>
              <div className="grid grid-4">
                <Stat label="Nomination window" value={<span style={{ fontSize: 18 }}>{fmtDate(cycle.nomination_start, false)} - {fmtDate(cycle.nomination_end, false)}</span>} hint={`Review by ${fmtDate(cycle.review_deadline)}`} />
                <Stat label="Submitted" value={cycle.counts.Submitted ?? 0} hint="Awaiting independent review" />
                <Stat label="Approved" value={cycle.counts.Approved ?? 0} hint="Approval is separate from publication" />
                <Stat label="Linked period" value={<Badge status={cycle.period.state} />} hint={cycle.period.name} />
              </div>
              {cycle.period.state !== "Locked" && <Callout tone="warn" title="Locked first">The linked performance period must be Locked before nominations open.</Callout>}
              <div className="row mt">
                {isRole("admin", "hod") && ["Draft", "Nominations", "Review"].includes(cycle.state) && (
                  <Button variant="primary" onClick={() => advance.mutate({}, { onSuccess: () => toast("Cycle advanced") })}>
                    {cycle.state === "Draft" ? "Open nominations" : cycle.state === "Nominations" ? "Close nominations / start review" : "Approve cycle"}
                  </Button>
                )}
                {isRole("admin", "hod") && cycle.state === "Approved" && <Button variant="primary" onClick={() => setPublishing(true)}>Publish awards</Button>}
              </div>
              <p className="small muted mt">Draft &gt; Nominations &gt; Review &gt; Approved &gt; Published. Gates: coverage &ge; {policy.config.min_coverage}% / no validated Major incident / &ge; {policy.config.min_days_in_role} days in role / no disciplinary action.{cycle.gold_cap_enabled ? ` Optional Gold cap ${policy.config.gold_cap_pct}% (proposed).` : ""}</p>
            </Card>
          ) : (
            <Card><Empty title="No recognition cycle" /></Card>
          )}
          <Callout title="Celebrate contributions, not task counts.">Published awards show citations and accepted work. No separate points system and no free bonus points.</Callout>
        </div>
      )}
      {tab === "eligibility" && (
        <Card title="Eligibility from the locked snapshot" sub="Tiers use the unrounded stored final score; every gate is shown with its source">
          {cycle?.period.state !== "Locked" ? (
            <Empty title="Period not locked">Eligibility is read from locked snapshots only.</Empty>
          ) : eligibility.isLoading ? (
            <Loading />
          ) : (
            <table className="table">
              <thead><tr><th>Eligible person</th><th>Final R&amp;R</th><th>Coverage</th><th>Tier</th><th>Gates</th><th /></tr></thead>
              <tbody>
                {(eligibility.data?.rows ?? []).map((r) => (
                  <tr key={r.employee.id}>
                    <td><PersonChip person={r.employee} meta={`${r.employee.code} / ${r.employee.department ?? "No department"}`} /></td>
                    <td className="num">{r.final !== null ? fmtScore(r.final) : r.status}</td>
                    <td className="num">{fmtPct(r.coverage)}</td>
                    <td>{r.tier ? <Badge status={r.tier} /> : "—"}</td>
                    <td>{r.gates.map((g) => <Badge key={g.gate} status={g.result}>{g.gate}</Badge>)}</td>
                    <td>{cycle?.state === "Nominations" && r.final !== null && !r.gates.some((g) => g.result === "fail") && <Button size="sm" variant="primary" onClick={() => setNominating(r)}>Nominate</Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
      {tab === "nominations" && (
        <Card title="Nominations" sub="A nominator cannot approve their own nomination">
          {(nominations.data ?? []).length === 0 ? <Empty title="No nominations yet" /> : (
            <table className="table">
              <thead><tr><th>Person</th><th>Award</th><th>Citation</th><th>Nominator</th><th>Reviewer</th><th>State</th><th /></tr></thead>
              <tbody>
                {nominations.data!.map((n) => (
                  <tr key={n.id}>
                    <td>{n.employee.name}</td>
                    <td>{n.award_type}</td>
                    <td>{n.citation_words} words</td>
                    <td>{n.nominator?.name}</td>
                    <td>{n.reviewer?.name ?? "—"}</td>
                    <td><Badge status={n.state} /></td>
                    <td><button className="link-btn" onClick={() => navigate(`/rewards/nominations/${n.id}`)}>{n.can_decide ? "Review" : "Open"}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
      {tab === "published" && (
        <div className="grid grid-2">
          {(awards.data ?? []).length === 0 && <Card><Empty title="No published awards yet">Approval alone does not publish.</Empty></Card>}
          {(awards.data ?? []).map((a) => (
            <Card key={a.id} title={a.award_type} sub={`${a.cycle} / Published ${fmtDateTime(a.published_at)} / ${a.audience}`}>
              <PersonChip person={a.employee} meta={a.employee.department ?? "No department"} />
              <p>{a.citation}</p>
            </Card>
          ))}
        </div>
      )}
      {creating && <CycleDrawer onClose={() => setCreating(false)} />}
      {publishing && cycle && <PublishDrawer cycle={cycle} onClose={() => setPublishing(false)} />}
      {nominating && cycle && <NominateDrawer cycle={cycle} row={nominating} awardTypes={data.data!.award_types} onClose={() => setNominating(null)} />}
    </>
  );
}

function CycleDrawer({ onClose }: { onClose: () => void }) {
  const periods = useApiQuery<Period[]>("/periods");
  const [form, setForm] = useState({ title: "", period_id: "", nomination_start: "", nomination_end: "", review_deadline: "", gold_cap_enabled: false, audience: "Approved internal audience" });
  const save = useApiMutation<Record<string, unknown>>("post", "/reward-cycles");
  return (
    <Drawer open onClose={onClose} eyebrow="Rewards > New cycle" title="Set up a recognition cycle" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => save.mutate({ ...form, period_id: Number(form.period_id) }, { onSuccess: () => { toast("Cycle draft saved"); onClose(); } })}>Save cycle draft</Button></>}>
      <FormError error={save.error} />
      <div className="form-grid">
        <Field label="Cycle title" required className="full"><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
        <Field label="Locked performance period" required>
          <select className="input" value={form.period_id} onChange={(e) => setForm({ ...form, period_id: e.target.value })}><option value="">Choose</option>{(periods.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name} / {p.state}</option>)}</select>
        </Field>
        <Field label="Publication audience" required><input className="input" value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })} /></Field>
        <Field label="Nominations open" required><input type="date" className="input" value={form.nomination_start} onChange={(e) => setForm({ ...form, nomination_start: e.target.value })} /></Field>
        <Field label="Nominations close" required><input type="date" className="input" value={form.nomination_end} onChange={(e) => setForm({ ...form, nomination_end: e.target.value })} /></Field>
        <Field label="Review deadline" required><input type="date" className="input" value={form.review_deadline} onChange={(e) => setForm({ ...form, review_deadline: e.target.value })} /></Field>
        <label className="check"><input type="checkbox" checked={form.gold_cap_enabled} onChange={(e) => setForm({ ...form, gold_cap_enabled: e.target.checked })} /> Apply optional Gold cap (proposed 10%)</label>
      </div>
      <p className="small muted mt">Uses the final score stored with the locked training policy. No new training bonus at nomination time.</p>
    </Drawer>
  );
}

function PublishDrawer({ cycle, onClose }: { cycle: Cycle; onClose: () => void }) {
  const [audience, setAudience] = useState(cycle.audience);
  const [confirm, setConfirm] = useState(false);
  const pub = useApiMutation<Record<string, unknown>>("post", `/reward-cycles/${cycle.id}/publish`);
  return (
    <Drawer open onClose={onClose} eyebrow="Rewards > Cycle > Publish" title="Publish approved recognition" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!confirm} onClick={() => pub.mutate({ audience, confirm }, { onSuccess: () => { toast("Awards published"); onClose(); } })}>Publish awards</Button></>}>
      <FormError error={pub.error} />
      <div className="stack">
        <Stat label="Approved nominations" value={cycle.counts.Approved ?? 0} hint="All reviews complete" />
        <Field label="Audience" required><input className="input" value={audience} onChange={(e) => setAudience(e.target.value)} /></Field>
        <Callout title="Announcement preview">Award name + approved citation + permitted evidence. Private KPI breakdowns and raw training evidence are not public award content.</Callout>
        <label className="check"><input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} /> Audience and approved results reviewed</label>
      </div>
    </Drawer>
  );
}

function NominateDrawer({ cycle, row, awardTypes, onClose }: { cycle: Cycle; row: EligibilityRow; awardTypes: string[]; onClose: () => void }) {
  const navigate = useNavigate();
  const [form, setForm] = useState({ award_type: awardTypes[1] ?? awardTypes[0], citation: "", evidence: "" });
  const create = useApiMutation<Record<string, unknown>, NominationRow>("post", "/nominations");
  const words = form.citation.split(/\s+/).filter(Boolean).length;
  return (
    <Drawer open onClose={onClose} dirty={!!form.citation} eyebrow="Rewards > New nomination" title="Nominate a contribution with evidence" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => create.mutate({ cycle_id: cycle.id, employee_id: row.employee.id, ...form }, { onSuccess: (n) => { toast("Nomination draft saved"); navigate(`/rewards/nominations/${n.id}`); } })}>Save draft</Button></>}>
      <FormError error={create.error} />
      <div className="drawer-split">
        <div className="form-grid">
          <Field label="Employee" required className="full"><input className="input" readOnly value={`${row.employee.name} / ${row.employee.code}`} /></Field>
          <Field label="Award type" required><select className="input" value={form.award_type} onChange={(e) => setForm({ ...form, award_type: e.target.value })}>{awardTypes.map((a) => <option key={a}>{a}</option>)}</select></Field>
          <Field label="Recognition cycle" required><input className="input" readOnly value={cycle.title} /></Field>
          <Field label={`Citation / ${form.award_type === "Top Performer" ? "optional" : "50 words minimum"}`} required={form.award_type !== "Top Performer"} className="full" help={`${words} words${form.award_type !== "Top Performer" ? (words >= 50 ? " / requirement met" : " / below 50") : ""}`}>
            <textarea className="input" style={{ minHeight: 160 }} value={form.citation} onChange={(e) => setForm({ ...form, citation: e.target.value })} />
          </Field>
          <Field label="Linked evidence" required className="full"><input className="input" value={form.evidence} onChange={(e) => setForm({ ...form, evidence: e.target.value })} placeholder="Accepted onboarding review + handoff checklist" /></Field>
        </div>
        <div className="aside-panel">
          <h4>Final score</h4>
          <p>{row.final !== null ? fmtScore(row.final) : row.status} / {row.tier ?? "no tier"} (draft thresholds)</p>
          <h4>Gates</h4>
          {row.gates.map((g) => <p key={g.gate}><Badge status={g.result}>{g.result}</Badge> {g.gate}</p>)}
          <h4>Independent decision</h4>
          <p>The nominator cannot approve this nomination.</p>
        </div>
      </div>
    </Drawer>
  );
}
