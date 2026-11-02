import { AlertTriangle } from "lucide-react";

import type { DelayReason } from "@/api/rr";
import type { Person } from "@/api/types";
import { Button, DecisionButton, ErrorState, FormError, Loading, PageHeader, Panel, SectionTitle, toast } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { useApiMutation, useApiQuery } from "@/lib/hooks";

interface Policy {
  code: string;
  state: string;
  authored_by: Person | null;
  authored_on: string | null;
  approved_by: Person | null;
  approved_at: string | null;
  slabs: { parameter: string; slabs: string }[];
  caps: { label: string; value: string }[];
  reasons: DelayReason[];
  open_decisions: { code: string; decision: string; default: string }[];
  can_approve: boolean;
}

/** The Project R&R policy version. Score-affecting changes need a second Admin; locked scorecards keep the version they were scored with. */
export function PolicyPage() {
  const { data, isLoading, error } = useApiQuery<Policy>("/rr/policy");
  const approve = useApiMutation<{ reason: string }>("post", "/rr/policy/approve");
  if (isLoading) return <Loading rows={3} />;
  if (error || !data) return <ErrorState error={error} />;
  return (
    <>
      <PageHeader
        title={`Project R&R policy · ${data.code}`}
        sub="Versioned configuration. Score-affecting changes need a second Admin. Locked scorecards keep the version they were scored with."
        actions={
          data.state === "Proposed" &&
          (data.can_approve ? (
            <DecisionButton variant="primary" label="Approve as second Admin" decision="approve" onDecide={(_, reason) => approve.mutate({ reason }, { onSuccess: () => toast("Policy approved and activated") })} />
          ) : (
            <Button variant="primary" disabled title="You authored this version; a different Admin must approve">Approve as second Admin</Button>
          ))
        }
      />
      <FormError error={approve.error} />
      {data.state === "Proposed" ? (
        <div className="proposed">
          <AlertTriangle size={16} />
          <span><b>Proposed, not activated.</b> Authored by {data.authored_by?.name ?? "an Admin"}{data.authored_on ? ` on ${fmtDate(data.authored_on)}` : ""}. Approval is disabled for the author.</span>
        </div>
      ) : (
        <div className="callout ok mb"><span><b>Approved</b> by {data.approved_by?.name} · {fmtDate(data.approved_at)}</span></div>
      )}
      <div className="grid grid-2">
        <Panel title="Slabs">
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Parameter</th><th>Slabs</th></tr></thead>
              <tbody>{data.slabs.map((s) => <tr key={s.parameter}><td>{s.parameter}</td><td className="wrap">{s.slabs}</td></tr>)}</tbody>
            </table>
          </div>
        </Panel>
        <Panel title="Caps, bands and units" pad>
          <dl className="rr-kv">{data.caps.map((c) => <span key={c.label} style={{ display: "contents" }}><dt>{c.label}</dt><dd>{c.value}</dd></span>)}</dl>
        </Panel>
      </div>
      <div className="mt">
        <Panel title="Delay reasons" meta="One late task = one delay · the PMO validator confirms the reason">
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Code</th><th>Reason</th><th>Counts as</th><th>When to use</th></tr></thead>
              <tbody>
                {data.reasons.map((r) => (
                  <tr key={r.code}>
                    <td className="mono">{r.code}</td>
                    <td><b>{r.label}</b></td>
                    <td>{r.controllable ? <span className="bad-txt">Controllable · −2</span> : <span className="ok-txt">Excused · evidence needed</span>}</td>
                    <td className="wrap small">{r.help}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
      <SectionTitle title="Open decisions" meta="Defaults apply until answered" />
      <Panel>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>#</th><th>Decision</th><th>Default</th></tr></thead>
            <tbody>{data.open_decisions.map((d) => <tr key={d.code}><td className="mono">{d.code}</td><td className="wrap">{d.decision}</td><td className="wrap">{d.default}</td></tr>)}</tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
