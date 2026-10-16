import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { api, ApiError, API_BASE, getToken } from "@/api/client";
import type { Person } from "@/api/types";
import { Badge, Button, Callout, Card, Drawer, ErrorState, Loading, PageHeader, PersonChip, toast } from "@/components/ui";
import { fmtPct } from "@/lib/format";
import { useApiQuery } from "@/lib/hooks";
import { type MonthInfo, MonthPicker, NotInPilot, type PersonRow, useMonth, usePilot } from "./shared";

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

/** Team: everyone under you. Click a person to mark their KPIs; or mark many at once with the Excel upload. */
export function IndividualTeamPage() {
  const navigate = useNavigate();
  const ctx = usePilot();
  const [monthId, setMonth] = useMonth(ctx.data);
  const [q, setQ] = useState("");
  const [uploading, setUploading] = useState(false);
  const team = useApiQuery<TeamData>(monthId ? `/individual/team?month_id=${monthId}` : null);
  const ordered = useMemo(() => (team.data ? hierarchy(team.data.rows, team.data.tree) : []), [team.data]);

  if (ctx.isLoading) return <Loading rows={2} />;
  if (ctx.data && ctx.data.people === 0) return (<><PageHeader title="Team" /><NotInPilot /></>);
  const t = team.data;
  const month = t?.month;
  const query = q.trim().toLowerCase();
  const shown = ordered.filter(({ row }) => !query || `${row.employee.name} ${row.employee.code}`.toLowerCase().includes(query));
  const canMark = (t?.rows ?? []).some((r) => r.can_edit);

  return (
    <>
      <PageHeader
        title="Team"
        sub={t && month ? `${t.rows.length} people under you / ${month.label}. Click a person to mark their KPIs.` : undefined}
        actions={
          <>
            {ctx.data && <MonthPicker months={ctx.data.months} value={monthId} onChange={setMonth} />}
            {month && canMark && month.state === "Open" && (
              <>
                <Button onClick={() => void api.download(`/individual/months/${month.id}/checkin-template.xlsx`, `checkin-${month.month.slice(0, 7)}.xlsx`).catch((e) => toast(e.message, true))}>
                  Download Excel template
                </Button>
                <Button variant="primary" onClick={() => setUploading(true)}>Upload Excel</Button>
              </>
            )}
          </>
        }
      />
      <ErrorState error={team.error} />
      {team.isLoading && <Loading rows={2} />}
      {t && month && (
        <Card actions={<input className="input" style={{ width: 240 }} placeholder="Search name or employee ID" aria-label="Search team" value={q} onChange={(e) => setQ(e.target.value)} />} title="Employees">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Employee</th><th>Reports to</th><th>KPIs</th><th>Achievement</th><th>Check-in</th><th /></tr>
              </thead>
              <tbody>
                {shown.map(({ row, depth }) => (
                  <tr key={row.employee.id} className="clickable" onClick={() => navigate(`/individual/team/${row.employee.id}?month=${month.id}`)}>
                    <td style={{ paddingLeft: 14 + depth * 26 }}>
                      <PersonChip person={row.employee} />
                    </td>
                    <td>{row.manager?.name ?? "—"}</td>
                    <td className="num">{row.kpi_rows ? `${row.kpi_rows} KPI${row.kpi_rows > 1 ? "s" : ""}${row.duty_rows ? ` + ${row.duty_rows} duties` : ""}` : <span className="muted">No targets set</span>}</td>
                    <td className="num">{row.achievement_pct === null ? <span className="muted">No actuals</span> : <Badge tone={row.achievement_pct >= 100 ? "green" : row.achievement_pct >= 80 ? "blue" : "red"}>{fmtPct(row.achievement_pct, 1)}</Badge>}</td>
                    <td><Badge status={row.evaluation_state} /></td>
                    <td className="small">
                      {row.can_edit ? <span className="green strong">Mark</span> : row.can_approve ? <span className="green strong">Approve</span> : <span className="muted">View</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {shown.length === 0 && <p className="muted">No one matches.</p>}
        </Card>
      )}
      {uploading && month && <UploadDrawer month={month} onClose={() => setUploading(false)} />}
    </>
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
