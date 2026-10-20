import { Lock } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import type { Person } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { Badge, Button, Callout, Card, DecisionButton, Drawer, Empty, ErrorState, Field, fieldError, FormError, Loading, Modal, PageHeader, PersonChip, Stat, Tier, toast } from "@/components/ui";
import { fmtDateTime, fmtPct, fmtScore } from "@/lib/format";
import { useApiMutation, useApiQuery } from "@/lib/hooks";
import { FinalScore, type MonthInfo, NotInPilot, TierBadge, useMonth, usePilot } from "./shared";

interface RewardRow {
  employee: Person;
  final: number | null;
  base: number | null;
  coverage?: number; // Admin only
  twcs: number | null;
  band: string | null;
  tier: string | null;
  status: string;
  eligible: boolean;
  gates: { gate: string; result: "pass" | "fail" | "unknown"; source: string }[];
}

interface RewardsData {
  months: MonthInfo[];
  month: MonthInfo | null;
  rows: RewardRow[];
  tiers: Record<string, number> | null;
  tier_rules?: [string, number][] | null; // Admin only
  tiers_proposed?: boolean;
}

export function IndividualRewardsPage() {
  const { isRole } = useAuth();
  const navigate = useNavigate();
  const ctx = usePilot();
  // The month is the one chosen in the top bar, shared with every Individual Tier page.
  const [monthId, setMonth] = useMonth(ctx.data);
  const data = useApiQuery<RewardsData>(monthId ? `/individual/rewards?month_id=${monthId}` : null);
  const [publishing, setPublishing] = useState(false);
  const [note, setNote] = useState("");
  const d = data.data;
  const publish = useApiMutation<{ note: string }>("post", `/individual/months/${d?.month?.id}/publish`);

  if (ctx.isLoading || data.isLoading || (ctx.data && ctx.data.people > 0 && !monthId)) return <Loading rows={2} />;
  if (ctx.data && ctx.data.people === 0) return (<><PageHeader title="Rewards" /><NotInPilot /></>);
  if (!d) return <ErrorState error={data.error} />;
  const m = d.month;
  const closed = m?.state === "Locked";

  return (
    <>
      <PageHeader
        title="Rewards"
        sub="Monthly recognition from closed months only. No points and no typed bonuses: the tracker's points sheet is retired."
        actions={
          d.months.length > 0 && (
            <>
              <select className="input" style={{ width: 200 }} aria-label="Closed month" value={closed ? m!.id : ""} onChange={(e) => e.target.value && setMonth(Number(e.target.value))}>
                {!closed && <option value="">Choose a closed month</option>}
                {d.months.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
              </select>
              {isRole("hod", "admin") && closed && !m!.published_at && <Button variant="primary" onClick={() => setPublishing(true)}>Publish recognition</Button>}
            </>
          )
        }
      />
      {d.months.length === 0 && (
        <Card>
          <Empty title="No closed month yet">Rewards use a month's frozen results. The HOD closes a month from Performance → Close month once check-ins are approved.</Empty>
        </Card>
      )}
      {m && !closed && d.months.length > 0 && (
        <div className="panel">
          <Empty
            title={`${m.label} is not closed yet`}
            icon={Lock}
            action={
              <div className="row" style={{ justifyContent: "center", marginTop: 16 }}>
                {d.months.slice(0, 3).map((x) => (
                  <Button key={x.id} onClick={() => setMonth(x.id)}>View {x.label}</Button>
                ))}
                {isRole("hod", "admin") && <Button variant="primary" onClick={() => navigate("/individual/performance?close=1")}>Review month close</Button>}
              </div>
            }
          >
            Rewards use frozen scorecards, so they appear once the HOD closes the month. Choose a closed month to see its tiers.
          </Empty>
        </div>
      )}
      {m && closed && (
        <div className="stack">
          {d.tiers_proposed && (
            <Callout tone="warn" title="Tier thresholds are proposed (D6)">
              {d.tier_rules ? `${d.tier_rules.map(([n, t]) => `${n} ≥ ${t}`).join(" · ")}, applied to the unrounded final score. ` : ""}They stay labelled proposed until confirmed.
            </Callout>
          )}
          {m.published_at ? (
            <Callout title="Published">{fmtDateTime(m.published_at)} by {m.published_by?.name}. Published recognition shows names and tiers only, never ratings or training detail.</Callout>
          ) : null}
          <div className="grid grid-4">
            {Object.entries(d.tiers ?? {}).map(([name, n]) => <Stat key={name} label={<Tier tier={name} />} value={n} hint="Eligible people at this tier" />)}
            <Stat label="Not evaluated" value={d.rows.filter((r) => r.status === "not_evaluated").length} hint="Closed without an approved check-in" />
          </div>
          <Card title={`${m.label} results`} sub="Gates are shown with their source. A high score never bypasses a gate.">
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Person</th><th>Final</th><th>Tier</th>{isRole("admin") && <th>Coverage</th>}<th>Training</th><th>Gates</th><th>Eligible</th></tr></thead>
                <tbody>
                  {d.rows.map((r) => (
                    <tr key={r.employee.id} className="clickable" onClick={() => navigate(`/individual/performance/${r.employee.id}/${m.id}`)}>
                      <td><PersonChip person={r.employee} meta={r.employee.code} /></td>
                      <td><FinalScore row={r} /></td>
                      <td><TierBadge tier={r.tier} /></td>
                      {isRole("admin") && <td className="num">{fmtPct(r.coverage)}</td>}
                      <td>{r.twcs === null ? <span className="muted">—</span> : <span className="num">{fmtScore(r.twcs)} {r.band && <Badge status={r.band} />}</span>}</td>
                      <td>
                        <div className="row" style={{ gap: 4 }}>
                          {r.gates.map((g) => <span key={g.gate} title={`${g.gate} (${g.source})`}><Badge status={g.result}>{g.gate}</Badge></span>)}
                        </div>
                      </td>
                      <td>{r.eligible ? <Badge tone="green">Eligible</Badge> : <Badge tone="grey">Not eligible</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <Nominations month={m} people={d.rows.map((r) => r.employee)} />
        </div>
      )}
      <Modal open={publishing} title={`Publish ${m?.label} recognition`} onClose={() => setPublishing(false)}>
        <p className="muted">Audience preview: names and tiers of eligible people. Scores, ratings, training detail and comments are not published.</p>
        <FormError error={publish.error} />
        <Field label="Publication note" required>
          <textarea className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <div className="row between mt">
          <Button onClick={() => setPublishing(false)}>Cancel</Button>
          <Button variant="primary" disabled={!note.trim() || publish.isPending} onClick={() => publish.mutate({ note }, { onSuccess: () => { setPublishing(false); toast("Recognition published."); } })}>Publish</Button>
        </div>
      </Modal>
    </>
  );
}

interface Nomination {
  id: number;
  employee: Person | null;
  award: string;
  citation: string;
  evidence: string | null;
  state: string;
  nominated_by: Person | null;
  decided_by: Person | null;
  decision_note: string | null;
  illustrative: boolean;
  can_decide: boolean;
}

/** Monthly recognition nominations for a closed month: nominate with a citation; someone else approves. */
function Nominations({ month, people }: { month: MonthInfo; people: Person[] }) {
  const { isRole } = useAuth();
  const q = useApiQuery<{ awards: string[]; min_words: number; rows: Nomination[] }>(`/individual/nominations?month_id=${month.id}`);
  const decide = useApiMutation<{ id: number; decision: string; reason: string }>("post", (b) => `/individual/nominations/${b.id}/decide`);
  const [open, setOpen] = useState(false);
  const rows = q.data?.rows ?? [];
  return (
    <Card
      title="Nominations"
      sub={`Recognition beyond the score tiers. A citation of at least ${q.data?.min_words ?? 50} words is required; the HOD or an Admin decides, never the nominator.`}
      actions={isRole("manager", "hod", "admin") && people.length > 0 && <Button variant="primary" onClick={() => setOpen(true)}>Nominate</Button>}
    >
      {rows.length === 0 && <p className="muted">No nominations for {month.label} yet.</p>}
      <div className="stack" style={{ gap: 12 }}>
        {rows.map((n) => (
          <div key={n.id} className="aside-panel" style={{ gap: 8 }}>
            <div className="row between">
              <span className="row" style={{ gap: 10 }}>
                <PersonChip person={n.employee} />
                <Badge tone="gold">{n.award}</Badge>
                <Badge status={n.state} />
              </span>
              {n.can_decide && (
                <span className="row" style={{ gap: 6 }}>
                  <DecisionButton size="sm" variant="green" label="Approve" decision="approve" reasonRequired={false} onDecide={(dd, r) => decide.mutate({ id: n.id, decision: dd, reason: r }, { onSuccess: () => toast("Nomination approved."), onError: (e) => toast(e.message, true) })} />
                  <DecisionButton size="sm" label="Reject" decision="reject" onDecide={(dd, r) => decide.mutate({ id: n.id, decision: dd, reason: r }, { onSuccess: () => toast("Nomination rejected."), onError: (e) => toast(e.message, true) })} />
                </span>
              )}
            </div>
            <p style={{ margin: 0 }}>{n.citation}</p>
            <div className="small muted">
              Nominated by {n.nominated_by?.name ?? "—"}
              {n.decided_by && ` · ${n.state.toLowerCase()} by ${n.decided_by.name}`}
              {n.decision_note && ` · ${n.decision_note}`}
              {n.evidence && ` · Evidence: ${n.evidence}`}
            </div>
          </div>
        ))}
      </div>
      {open && q.data && <NominateDrawer month={month} people={people} awards={q.data.awards} minWords={q.data.min_words} onClose={() => setOpen(false)} />}
    </Card>
  );
}

function NominateDrawer({ month, people, awards, minWords, onClose }: { month: MonthInfo; people: Person[]; awards: string[]; minWords: number; onClose: () => void }) {
  const [form, setForm] = useState({ employee_id: people[0]?.id ?? 0, award: awards[0], citation: "", evidence: "" });
  const save = useApiMutation<object>("post", "/individual/nominations");
  const words = form.citation.split(/\s+/).filter(Boolean).length;
  return (
    <Drawer
      open
      onClose={onClose}
      dirty={!!form.citation}
      eyebrow={`Rewards / ${month.label}`}
      title="Nominate for recognition"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={save.isPending || words < minWords} onClick={() => save.mutate(form, { onSuccess: () => { toast("Nomination sent for a decision."); onClose(); } })}>Send nomination</Button></>}
    >
      <FormError error={save.error} />
      <div className="form-grid">
        <Field label="Person" required>
          <select className="input" value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: Number(e.target.value) })}>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name} / {p.code}</option>)}
          </select>
        </Field>
        <Field label="Award" required>
          <select className="input" value={form.award} onChange={(e) => setForm({ ...form, award: e.target.value })}>
            {awards.map((a) => <option key={a}>{a}</option>)}
          </select>
        </Field>
        <Field label="Citation" required className="full" error={fieldError(save.error, "citation")} help={`${words} of at least ${minWords} words. Describe what the person did and the effect it had.`}>
          <textarea className="input" style={{ minHeight: 160 }} value={form.citation} onChange={(e) => setForm({ ...form, citation: e.target.value })} />
        </Field>
        <Field label="Evidence" className="full" help="Where the approver can check it (report, ticket, client message).">
          <input className="input" value={form.evidence} onChange={(e) => setForm({ ...form, evidence: e.target.value })} />
        </Field>
      </div>
    </Drawer>
  );
}
