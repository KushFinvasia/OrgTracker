import { useQueryClient } from "@tanstack/react-query";
import { BookOpen, Check, Download, List, ListChecks, Network, Search, Upload } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { api, ApiError, API_BASE, getToken } from "@/api/client";
import type { Person } from "@/api/types";
import { Avatar, Badge, Button, Callout, Card, DecisionButton, Drawer, Empty, ErrorState, Field, Loading, PageHeader, PersonChip, Segmented, Tier, toast } from "@/components/ui";
import { todayISO } from "@/lib/format";
import { useApiQuery, useQueryParam } from "@/lib/hooks";
import { EvalBadge, FinalScore, KpiAvgCell, type MonthInfo, NotInPilot, OnTimeCell, type PersonRow, TwcsCell, useMonth, usePilot } from "./shared";

interface TeamData {
  month: MonthInfo | null;
  department: string;
  heads: Person[];
  rows: PersonRow[];
  tree: { id: number; manager_id: number | null }[];
}

/** Depth-first order with indentation, starting from people whose manager is outside the viewer's scope. */
function hierarchy(rows: PersonRow[], tree: TeamData["tree"]) {
  const inScope = new Set(rows.map((r) => r.employee.id));
  const byId = new Map(rows.map((r) => [r.employee.id, r]));
  const children = new Map<number, number[]>();
  const roots: number[] = [];
  for (const t of tree) {
    if (t.manager_id && inScope.has(t.manager_id)) children.set(t.manager_id, [...(children.get(t.manager_id) ?? []), t.id]);
    else roots.push(t.id);
  }
  const out: { row: PersonRow; depth: number }[] = [];
  const walk = (id: number, depth: number) => {
    out.push({ row: byId.get(id)!, depth });
    (children.get(id) ?? []).sort((a, b) => byId.get(a)!.employee.name.localeCompare(byId.get(b)!.employee.name)).forEach((k) => walk(k, depth + 1));
  };
  roots.sort((a, b) => (children.get(b)?.length ?? 0) - (children.get(a)?.length ?? 0)).forEach((r) => walk(r, 0));
  return out;
}

type Filter = "all" | "to_mark" | "draft" | "submitted" | "returned" | "approved" | "mine";

const FILTERS: { id: Filter; label: string; test: (r: PersonRow) => boolean }[] = [
  { id: "all", label: "All", test: () => true },
  { id: "to_mark", label: "To mark", test: (r) => r.can_edit && ["Not started", "Draft"].includes(r.evaluation_state) },
  { id: "draft", label: "Draft or not started", test: (r) => ["Not started", "Draft"].includes(r.evaluation_state) },
  { id: "returned", label: "Returned", test: (r) => r.evaluation_state === "Returned" },
  { id: "submitted", label: "Submitted", test: (r) => r.evaluation_state === "Submitted" },
  { id: "mine", label: "Waiting for my approval", test: (r) => r.can_approve },
  { id: "approved", label: "Approved", test: (r) => r.evaluation_state === "Approved" },
];

/** Team: everyone under you. Click a person to mark their KPIs; mark many at once with the Excel upload; approve several at once. */
export function IndividualTeamPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const ctx = usePilot();
  const [monthId] = useMonth(ctx.data);
  const [view, setView] = useState<"list" | "tree">("list");
  const [filterParam, setFilter] = useQueryParam("filter");
  const filter = (filterParam as Filter) || "all";
  const [q, setQ] = useState("");
  const [uploading, setUploading] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Record<number, string>>({});
  const team = useApiQuery<TeamData>(monthId ? `/individual/team?month_id=${monthId}` : null);
  const ordered = useMemo(() => (team.data ? hierarchy(team.data.rows, team.data.tree) : []), [team.data]);

  if (ctx.isLoading) return <Loading rows={2} />;
  if (ctx.data && ctx.data.people === 0) return (<><PageHeader title="Team" /><NotInPilot /></>);
  const t = team.data;
  const month = t?.month;
  const rows = t?.rows ?? [];
  const query = q.trim().toLowerCase();
  const active = FILTERS.find((f) => f.id === filter) ?? FILTERS[0];
  const shown = ordered.filter(({ row }) => active.test(row) && (!query || `${row.employee.name} ${row.employee.code}`.toLowerCase().includes(query)));
  const canMark = rows.some((r) => r.can_edit);
  const canApproveAny = rows.some((r) => r.can_approve);
  const approved = rows.filter((r) => r.evaluation_state === "Approved").length;
  const selectable = shown.filter(({ row }) => row.can_approve).map(({ row }) => row.employee.id);
  const toggle = (id: number) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const decide = async (decision: "approve" | "return", reason = "") => {
    if (!month) return;
    setBusy(true);
    try {
      const r = await api.post<{ done: number; failed: number; results: { employee_id: number; ok: boolean; message?: string }[] }>(
        `/individual/months/${month.id}/decide-many`, { employee_ids: [...picked], decision, reason },
      );
      setResults(Object.fromEntries(r.results.map((x) => [x.employee_id, x.ok ? (decision === "approve" ? "Approved" : "Returned") : x.message ?? "Failed"])));
      setPicked(new Set());
      await qc.invalidateQueries();
      toast(r.failed ? `${r.done} done, ${r.failed} could not be changed (see the list).` : `${r.done} check-in(s) ${decision === "approve" ? "approved" : "returned"}.`, r.failed > 0);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Failed", true);
    } finally {
      setBusy(false);
    }
  };

  const open = (id: number) => month && navigate(`/individual/team/${id}?month=${month.id}`);
  const locked = month?.state === "Locked";

  return (
    <>
      <PageHeader
        title="Team"
        sub={month ? `Everyone in your scope for ${month.label}: ${approved} of ${rows.length} check-ins approved. Open a person to mark KPIs, ratings and training on one page.` : undefined}
        actions={
          month && canMark && month.state === "Open" ? (
            <>
              <Button onClick={() => setAssigning(true)}>
                <BookOpen size={14} aria-hidden="true" /> Assign training
              </Button>
              <Button onClick={() => void api.download(`/individual/months/${month.id}/checkin-template.xlsx`, `checkin-${month.month.slice(0, 7)}.xlsx`).catch((e) => toast(e.message, true))}>
                <Download size={14} aria-hidden="true" /> Download check-in template
              </Button>
              <Button onClick={() => setUploading(true)}>
                <Upload size={14} aria-hidden="true" /> Upload marked template
              </Button>
            </>
          ) : undefined
        }
      />
      <ErrorState error={team.error} />
      {team.isLoading && <Loading rows={2} />}
      {t && month && (
        <>
          <div className="panel" style={{ marginBottom: 16 }}>
            <div className="toolbar">
              <label className="search-in">
                <Search size={14} aria-hidden="true" />
                <input placeholder="Search by name or ID" aria-label="Search team" value={q} onChange={(e) => setQ(e.target.value)} />
              </label>
              <div className="chips" role="group" aria-label="Filter by check-in">
                {FILTERS.filter((f) => f.id !== "mine" || canApproveAny).map((f) => (
                  <button
                    type="button"
                    key={f.id}
                    className="chip"
                    aria-pressed={filter === f.id}
                    onClick={() => {
                      setFilter(f.id === "all" ? null : f.id);
                      setPicked(new Set());
                    }}
                  >
                    {f.label}
                    <b>{rows.filter(f.test).length}</b>
                  </button>
                ))}
              </div>
              <span className="grow" />
              <Segmented
                label="View"
                value={view}
                onChange={setView}
                options={[
                  { id: "list", label: <><List size={14} aria-hidden="true" />List</> },
                  { id: "tree", label: <><Network size={14} aria-hidden="true" />Hierarchy</> },
                ]}
              />
            </div>
          </div>
          {canApproveAny && month.state === "Open" && view === "list" && (
            <div style={{ marginBottom: 16 }}>
              <Callout
                tone="neutral"
                icon={ListChecks}
                actions={
                  <>
                    <Button size="sm" variant="primary" disabled={!picked.size || busy} onClick={() => void decide("approve")}>
                      <Check size={14} aria-hidden="true" /> Approve selected
                    </Button>
                    <DecisionButton size="sm" variant="danger" label="Return selected" decision="return" busy={busy || !picked.size} onDecide={(_, reason) => void decide("return", reason)} />
                  </>
                }
              >
                <label className="check" style={{ alignItems: "center" }}>
                  <input
                    type="checkbox"
                    aria-label="Select all waiting for approval"
                    checked={selectable.length > 0 && selectable.every((id) => picked.has(id))}
                    onChange={(e) => setPicked(e.target.checked ? new Set(selectable) : new Set())}
                  />
                  <span>{picked.size ? <b>{picked.size} selected</b> : <>Select the check-ins waiting for your approval ({selectable.length})</>}</span>
                </label>
              </Callout>
            </div>
          )}
          {view === "tree" ? (
            <HierarchyView rows={rows} tree={t.tree} onOpen={open} />
          ) : shown.length === 0 ? (
            <div className="panel">
              <Empty title="No people match" action={<Button onClick={() => { setFilter(null); setQ(""); }}>Clear filters</Button>}>
                Try another filter or clear the search.
              </Empty>
            </div>
          ) : (
            <div className="panel">
              <div className="tbl-wrap">
                <table className="tbl stackable">
                  <thead>
                    <tr>
                      {canApproveAny && <th aria-label="Select" />}
                      <th>Person</th>
                      <th>Reports to</th>
                      <th>Evaluator</th>
                      <th className="n">KPI average</th>
                      <th className="n">On-time</th>
                      <th className="n">Training</th>
                      <th className="n">{locked ? "Final" : "Score (live)"}</th>
                      <th>Tier</th>
                      <th>Check-in</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map(({ row, depth }) => (
                      <tr key={row.employee.id} className="clickable" onClick={() => open(row.employee.id)}>
                        {canApproveAny && (
                          <td data-l="Select" onClick={(e) => e.stopPropagation()}>
                            {row.can_approve && <input type="checkbox" aria-label={`Select ${row.employee.name}`} checked={picked.has(row.employee.id)} onChange={() => toggle(row.employee.id)} />}
                          </td>
                        )}
                        <td className="person" data-l="Person" style={{ paddingLeft: 12 + (filter === "all" && !query ? depth * 22 : 0) }}>
                          <PersonChip person={row.employee} />
                        </td>
                        <td data-l="Reports to" className="nowrap">{row.manager?.name ?? "—"}</td>
                        <td data-l="Evaluator" className="nowrap">{row.evaluator_is_me ? "You" : row.evaluator?.name ?? "—"}</td>
                        <td className="n" data-l="KPI average"><KpiAvgCell row={row} /></td>
                        <td className="n" data-l="On-time"><OnTimeCell ot={row.on_time} /></td>
                        <td className="n" data-l="Training"><TwcsCell row={row} /></td>
                        <td className="n" data-l="Score"><FinalScore row={row} /></td>
                        <td data-l="Tier">{row.final !== null && row.status !== "not_evaluated" ? <Tier tier={row.tier} /> : null}</td>
                        <td data-l="Check-in">
                          <EvalBadge state={row.evaluation_state} />
                          {results[row.employee.id] && (
                            <span className="sub" style={{ color: ["Approved", "Returned"].includes(results[row.employee.id]) ? "var(--ok)" : "var(--bad)" }}>{results[row.employee.id]}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
      {uploading && month && <UploadDrawer month={month} onClose={() => setUploading(false)} />}
      {assigning && month && <AssignTrainingDrawer month={month} people={rows.filter((r) => r.can_edit).map((r) => r.employee)} onClose={() => setAssigning(false)} />}
    </>
  );
}

/** Reporting tree of the people in scope, with each person's check-in state. */
function HierarchyView({ rows, tree, onOpen }: { rows: PersonRow[]; tree: TeamData["tree"]; onOpen: (id: number) => void }) {
  const byId = new Map(rows.map((r) => [r.employee.id, r]));
  const kids = new Map<number, number[]>();
  const roots: number[] = [];
  for (const t of tree) {
    if (!byId.has(t.id)) continue;
    if (t.manager_id && byId.has(t.manager_id)) kids.set(t.manager_id, [...(kids.get(t.manager_id) ?? []), t.id]);
    else roots.push(t.id);
  }
  const node = (id: number): JSX.Element => {
    const r = byId.get(id)!;
    const children = (kids.get(id) ?? []).sort((a, b) => byId.get(a)!.employee.name.localeCompare(byId.get(b)!.employee.name));
    return (
      <li key={id}>
        <div className="node">
          <Avatar person={r.employee} size="sm" />
          <div className="grow">
            <b>
              <button type="button" className="link-btn" onClick={() => onOpen(id)}>{r.employee.name}</button>
            </b>
            <span>
              {r.employee.code}, {r.employee.designation}
              {r.evaluator_is_me ? ", you evaluate" : ""}
            </span>
          </div>
          <EvalBadge state={r.evaluation_state} />
        </div>
        {children.length > 0 && <ul>{children.map(node)}</ul>}
      </li>
    );
  };
  return (
    <div className="panel">
      <div className="panel-b">
        <ul className="tree">{roots.sort((a, b) => (kids.get(b)?.length ?? 0) - (kids.get(a)?.length ?? 0)).map(node)}</ul>
      </div>
    </div>
  );
}

const TRACKS = ["Technical", "Functional", "Behavioural", "Leadership", "Compliance"];

/** Assign one training module to several people in one step. */
function AssignTrainingDrawer({ month, people, onClose }: { month: MonthInfo; people: Person[]; onClose: () => void }) {
  const qc = useQueryClient();
  const catalog = useApiQuery<{ id: number; title: string; track: string }[]>("/individual/training-catalog");
  const [title, setTitle] = useState("");
  const [track, setTrack] = useState(TRACKS[0]);
  const [due, setDue] = useState("");
  const [chosen, setChosen] = useState<Set<number>>(new Set(people.map((p) => p.id)));
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<{ done: number; failed: number; results: { employee_id: number; name: string; ok: boolean; message?: string }[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pickCatalog = (t: string) => {
    setTitle(t);
    const c = catalog.data?.find((x) => x.title === t);
    if (c) setTrack(c.track);
  };
  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<typeof out>("/individual/training/assign", { title, track, assigned_date: todayISO() < month.month ? month.month : todayISO(), due_date: due, employee_ids: [...chosen] });
      setOut(r);
      await qc.invalidateQueries();
      toast(`Assigned to ${r!.done} people.`, r!.failed > 0);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Drawer
      open
      wide
      onClose={onClose}
      eyebrow={`Team / ${month.label}`}
      title="Assign training"
      dirty={!out && !!title}
      footer={<><Button onClick={onClose}>{out ? "Done" : "Cancel"}</Button>{!out && <Button variant="primary" disabled={busy || !title.trim() || !due || !chosen.size} onClick={() => void send()}>Assign to {chosen.size} people</Button>}</>}
    >
      <div className="stack">
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="form-grid">
          <Field label="Module" required className="full" help="Pick from the list or type a new module; new ones are added to the list.">
            <input className="input" list="training-catalog" value={title} onChange={(e) => pickCatalog(e.target.value)} placeholder="e.g. SEBI KYC and AML refresher" />
          </Field>
          <datalist id="training-catalog">{(catalog.data ?? []).map((c) => <option key={c.id} value={c.title}>{c.track}</option>)}</datalist>
          <Field label="Track" required>
            <select className="input" value={track} onChange={(e) => setTrack(e.target.value)}>{TRACKS.map((t) => <option key={t}>{t}</option>)}</select>
          </Field>
          <Field label="Due date" required help={`The module counts in the month its due date falls in. Completions count until the cut-off (${month.training_cutoff}).`}>
            <input className="input" type="date" min={month.month} value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
        </div>
        <Card title={`People (${chosen.size} of ${people.length})`} actions={<button className="link-btn" onClick={() => setChosen(chosen.size === people.length ? new Set() : new Set(people.map((p) => p.id)))}>{chosen.size === people.length ? "Clear all" : "Select all"}</button>}>
          <div className="grid grid-3" style={{ gap: 8 }}>
            {people.map((p) => {
              const res = out?.results.find((x) => x.employee_id === p.id);
              return (
                <label key={p.id} className="check" style={{ alignItems: "flex-start" }}>
                  <input type="checkbox" disabled={!!out} checked={chosen.has(p.id)} onChange={() => setChosen((c) => { const n = new Set(c); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n; })} />
                  <span>
                    {p.name} <span className="small muted">{p.code}</span>
                    {res && <div className="small" style={{ color: res.ok ? "var(--green)" : "var(--red-fg)" }}>{res.ok ? "Assigned" : res.message}</div>}
                  </span>
                </label>
              );
            })}
          </div>
        </Card>
        <p className="small muted">Each person's completion date is recorded on their page in Team; the HOD verifies it when approving the month.</p>
      </div>
    </Drawer>
  );
}

interface UploadResult {
  dry_run: boolean;
  file: string;
  rows: { row: number; code: string; name: string | null; employee: Person | null; changes: Record<string, number>; errors: string[] }[];
  ready: number;
  with_errors: number;
  applied: number;
}

const FIELD_LABELS: Record<string, string> = {
  on_time_count: "On-time", delayed_count: "Delayed", achievement_pct: "Achievement %", quality_rating: "Quality", collaboration_rating: "Collaboration",
  innovation_rating: "Innovation", compliance_rating: "Compliance", csat_rating: "CSAT", twcs_score: "Training",
};

function UploadDrawer({ month, onClose }: { month: MonthInfo; onClose: () => void }) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const send = async (dryRun: boolean) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const token = getToken();
      const res = await fetch(`${API_BASE}/individual/months/${month.id}/checkin-upload?dry_run=${dryRun}`, { method: "POST", body: fd, headers: token ? { Authorization: `Bearer ${token}` } : {} });
      const data = await res.json();
      if (!res.ok) throw new ApiError(res.status, data?.detail?.message ?? "Upload failed.");
      setResult(data);
      if (!dryRun) {
        await qc.invalidateQueries();
        toast(`${data.applied} check-in(s) updated from ${data.file}.`);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Cannot reach the server.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open
      wide
      onClose={onClose}
      eyebrow={`Team / ${month.label}`}
      title="Upload marks from Excel"
      footer={
        <>
          <Button onClick={onClose}>{result && !result.dry_run ? "Done" : "Cancel"}</Button>
          {result?.dry_run && result.ready > 0 && (
            <Button variant="primary" disabled={busy} onClick={() => void send(false)}>
              Apply {result.ready} row{result.ready > 1 ? "s" : ""}
            </Button>
          )}
        </>
      }
    >
      <div className="stack">
        <Callout title="Steps">
          1. Download the Excel template (it lists the people you mark, with the values already entered). 2. Fill the columns: Tasks On-Time, Tasks Delayed, Achievement % (0–150),
          Quality, Collaboration, Innovation, Compliance, CSAT (1–5), Training (TWCS 0–100). Blank cells leave values unchanged. 3. Upload and check the preview, then apply.
        </Callout>
        <div className="row">
          <input ref={input} type="file" accept=".xlsx" aria-label="Excel file" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setResult(null); }} />
          <Button variant="primary" disabled={!file || busy} onClick={() => void send(true)}>{busy ? "Checking..." : "Check file"}</Button>
        </div>
        {error && <div className="form-error" role="alert">{error}</div>}
        {result && (
          <>
            {result.dry_run ? (
              <Callout tone={result.with_errors ? "warn" : "mint"} title={`Preview: ${result.ready} ready, ${result.with_errors} with problems`}>
                Nothing is saved yet. Rows with problems are skipped when you apply; fix them in the file and upload again.
              </Callout>
            ) : (
              <Callout title={`Applied ${result.applied} row(s)`}>Each change is in the audit history with the file name and row.</Callout>
            )}
            <table className="table">
              <thead><tr><th>Row</th><th>Employee</th><th>Values</th><th>Result</th></tr></thead>
              <tbody>
                {result.rows.map((r) => (
                  <tr key={r.row}>
                    <td className="num">{r.row}</td>
                    <td>{r.employee ? <PersonChip person={r.employee} /> : <>{r.name ?? "—"}<div className="sub">{r.code || "No Employee ID"}</div></>}</td>
                    <td className="small">{Object.entries(r.changes).map(([k, v]) => `${FIELD_LABELS[k] ?? k} ${v}`).join(" · ") || <span className="muted">No values</span>}</td>
                    <td className="small">
                      {r.errors.length ? <span style={{ color: "var(--red-fg)" }}>{r.errors.join(" ")}</span> : Object.keys(r.changes).length ? <Badge tone="green">{result.dry_run ? "Ready" : "Saved"}</Badge> : <Badge tone="grey">Nothing to change</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </Drawer>
  );
}
