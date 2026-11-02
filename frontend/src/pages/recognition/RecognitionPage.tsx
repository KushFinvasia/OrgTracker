import { AlertTriangle } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";

import { BAND_COLOURS, BAND_RANGES, fmt2, inr, type Recognition } from "@/api/rr";
import { useAuth } from "@/auth/AuthContext";
import { Badge, Empty, ErrorState, Figures, Loading, PageHeader, Panel, SectionTitle, Tier } from "@/components/ui";
import { useApiQuery } from "@/lib/hooks";

const BANDS = ["Platinum", "Gold", "Silver", "Bronze", "Review"];

/** Project recognition: project scores, bands and indicative reward pools across the projects in the viewer's scope. */
export function RecognitionPage() {
  const navigate = useNavigate();
  const { isRole } = useAuth();
  const { data, isLoading, error } = useApiQuery<Recognition>("/recognition");
  if (isLoading) return <Loading rows={3} />;
  if (error || !data) return <ErrorState error={error} />;
  const money = data.money_visible;
  return (
    <>
      <PageHeader title="Project recognition" sub="Project scores, bands and reward units for projects in the Project R&R pilot. Only projects in your scope are listed." />
      {data.policy_state !== "Approved" && (
        <div className="proposed">
          <AlertTriangle size={16} />
          <span><b>Policy PR-1 is {data.policy_state.toLowerCase()}, not activated.</b> Slabs, caps, bands and pool rates follow the HR framework draft v1.0. ₹ amounts are indicative until Finance confirms them.</span>
        </div>
      )}
      <Figures
        items={[
          { label: "Projects in the scheme", value: data.rows.length, hint: `Pilot · ${data.programmes} programme${data.programmes === 1 ? "" : "s"}` },
          { label: "Scored", value: data.scored, unit: `of ${data.rows.length}`, hint: "Others need inputs, closure or a locked charter" },
          { label: "Average project score", value: data.average === null ? "—" : fmt2(data.average), hint: `Across ${data.scored} scored` },
          { label: "Indicative reward pool", value: money ? inr(data.pool_total) : "—", hint: money ? "Admin and Panel only" : "Hidden for your role" },
        ]}
      />
      <div className="grid grid-main mt">
        <Panel title="Project bands" meta="Scored projects" pad>
          <div className="bandbar">
            {BANDS.filter((b) => data.bands[b]).map((b) => <span key={b} style={{ flex: data.bands[b], background: BAND_COLOURS[b] }} />)}
            {!data.scored && <span style={{ flex: 1, background: "var(--sunken)" }} />}
          </div>
          <div className="rr-legend">
            {BANDS.map((b) => (
              <span key={b} style={{ display: "contents" }}>
                <span className="k"><i style={{ background: BAND_COLOURS[b] }} />{b} · {BAND_RANGES[b]}</span>
                <span className="v">{data.bands[b] ?? 0}</span>
              </span>
            ))}
          </div>
        </Panel>
        <Panel title="Waiting for you" meta={`Your functions: ${data.functions.join(", ") || "none"}`}>
          {data.queue.length ? (
            <ul className="queue">
              {data.queue.map((i, k) => (
                <li key={k}>
                  <span className="q-n">{i.count}</span>
                  <span className="q-t"><b><Link to={i.link}>{i.title}</Link></b><span>{i.context}</span></span>
                  <Badge tone={i.tone === "bad" ? "red" : i.tone === "warn" ? "amber" : i.tone === "info" ? "blue" : "grey"}>{i.tag}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="Nothing waiting">Items appear for the functions Admin tags on your account.</Empty>
          )}
        </Panel>
      </div>
      <SectionTitle title="Projects" meta="Scored at closure, by quarter for programmes, or each quarter for projects over 6 months" />
      <Panel>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Project</th><th>Champion (A)</th><th className="n">Tasks on time</th><th className="n">Delays</th><th>Gates</th><th className="n">Score</th><th>Project band</th><th>Stage</th><th className="n">Pool (indicative)</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.length === 0 && <tr><td colSpan={9}><Empty title="No projects in the scheme yet">{isRole("admin") ? "Add a project to the pilot from its Overview." : "Admin adds projects to the pilot."}</Empty></td></tr>}
              {data.rows.map((r) => (
                <tr key={r.project.id} className="clickable-row" onClick={() => navigate(`/projects/${r.project.id}?tab=${r.score !== null ? "scorecard" : "charter"}`)}>
                  <td><b>{r.project.title}</b><span className="sub">{r.project.code} · {r.project.department} · {r.mode === "programme" ? "Programme" : r.project_type}{r.illustrative ? " · illustrative" : ""}</span></td>
                  <td>{r.champion?.name ?? <span className="warn-txt">{r.champion_note ?? "Not named"}</span>}</td>
                  <td className="n">{r.tasks_on_time}</td>
                  <td className="n">{r.delays}</td>
                  <td>{r.gates}</td>
                  <td className="n big">{r.score === null ? <span className="unavail">Not scored</span> : fmt2(r.score)}</td>
                  <td><Tier tier={r.band} empty="Not scored" /></td>
                  <td><Badge status={r.stage} /></td>
                  <td className="n money">{r.pool === null ? <span className="unavail">{money ? "Not set" : "Hidden"}</span> : inr(r.pool)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
