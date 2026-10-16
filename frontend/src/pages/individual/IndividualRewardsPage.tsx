import { useState } from "react";
import { useNavigate } from "react-router-dom";

import type { Person } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { Badge, Button, Callout, Card, Empty, ErrorState, Field, FormError, Loading, Modal, PageHeader, PersonChip, Stat, toast } from "@/components/ui";
import { fmtDateTime, fmtPct, fmtScore } from "@/lib/format";
import { useApiMutation, useApiQuery, useQueryParam } from "@/lib/hooks";
import { FinalScore, type MonthInfo, NotInPilot, TierBadge, usePilot } from "./shared";

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
  const [monthParam, setMonth] = useQueryParam("month");
  const data = useApiQuery<RewardsData>(`/individual/rewards${monthParam ? `?month_id=${monthParam}` : ""}`);
  const [publishing, setPublishing] = useState(false);
  const [note, setNote] = useState("");
  const d = data.data;
  const publish = useApiMutation<{ note: string }>("post", `/individual/months/${d?.month?.id}/publish`);

  if (ctx.isLoading || data.isLoading) return <Loading rows={2} />;
  if (ctx.data && ctx.data.people === 0) return (<><PageHeader title="Rewards" /><NotInPilot /></>);
  if (!d) return <ErrorState error={data.error} />;
  const m = d.month;

  return (
    <>
      <PageHeader
        title="Rewards"
        sub="Monthly recognition from locked scores only. No points and no typed bonuses: the tracker's points sheet is retired."
        actions={
          d.months.length > 0 && (
            <>
              <select className="input" style={{ width: 200 }} aria-label="Locked month" value={m?.id ?? ""} onChange={(e) => setMonth(e.target.value)}>
                {d.months.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
              </select>
              {isRole("hod", "admin") && m && !m.published_at && <Button variant="primary" onClick={() => setPublishing(true)}>Publish recognition</Button>}
            </>
          )
        }
      />
      {d.months.length === 0 && (
        <Card>
          <Empty title="No locked month yet">Rewards use a month's frozen scorecards. The HOD locks a month from Performance → Month close once evaluations are approved.</Empty>
        </Card>
      )}
      {m && (
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
            {Object.entries(d.tiers ?? {}).map(([name, n]) => <Stat key={name} label={name} value={n} hint="Eligible people at this tier" />)}
            <Stat label="Not evaluated" value={d.rows.filter((r) => r.status === "not_evaluated").length} hint="Locked without an approved evaluation" />
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
