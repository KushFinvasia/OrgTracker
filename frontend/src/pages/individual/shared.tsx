import { useEffect } from "react";

import type { Person } from "@/api/types";
import { Badge, Card, Empty } from "@/components/ui";
import { fmtNum, fmtScore } from "@/lib/format";
import { useApiQuery, useQueryParam } from "@/lib/hooks";

export interface MonthInfo {
  id: number;
  month: string;
  label: string;
  state: "Open" | "Locked";
  training_cutoff: string;
  rule: { id: number; label: string; state: string };
  locked_at: string | null;
  locked_by: Person | null;
  lock_note: string | null;
  published_at: string | null;
  published_by: Person | null;
  counts?: { people: number; approved: number; submitted: number; returned: number; rows: number };
}

export interface PilotContext {
  in_pilot: boolean;
  department: string;
  category: string;
  people: number;
  evaluates: number;
  role: string;
  months: MonthInfo[];
  current_month_id: number | null;
  focus_month_id: number | null;
}

export interface OnTime {
  on_time: number;
  delayed: number;
  delay_validated: number;
  no_outcome: number;
}

export interface PersonRow {
  employee: Person;
  manager: Person | null;
  evaluator: Person | null;
  evaluator_is_me: boolean;
  approver_roles: string[];
  evaluation_state: string;
  can_edit: boolean;
  can_approve: boolean;
  kpi_rows: number;
  duty_rows: number;
  achievement_pct: number | null;
  kpis_marked: number;
  kpis_total: number;
  achievement_score: number | null;
  on_time: OnTime;
  twcs: number | null;
  twcs_status: "scored" | "na" | "missing";
  band: string | null;
  keka: number | null;
  coverage?: number; // Admin only
  base?: number | null; // Admin only
  final: number | null;
  status: string;
  tier: string | null;
  penalty_total?: number; // Admin only
  readiness: string[];
  warnings: number;
  locked: boolean;
  check_in: CheckInValues;
}

export const RATING_KEYS = ["quality", "collaboration", "innovation", "compliance", "csat"] as const;
export type RatingMetric = (typeof RATING_KEYS)[number];
export type CountKey = "on_time_count" | "delayed_count" | "achievement_pct" | "twcs_score";

export interface CheckInValues {
  quality_rating: number | null;
  collaboration_rating: number | null;
  innovation_rating: number | null;
  compliance_rating: number | null;
  csat_rating: number | null;
  entered: Partial<Record<CountKey, number | null>>;
  derived: Partial<Record<CountKey, number | null>>;
  version: number | null;
  can_submit: boolean;
}

/** The R&R parameter columns (R&R Parameters sheet) plus Training (TWCS). */
export const SHEET_COLUMNS: { key: CountKey | `${RatingMetric}_rating`; label: string; help: string; kind: "count" | "pct" | "rating" | "twcs" }[] = [
  { key: "on_time_count", label: "Tasks on-time", help: "Count of tasks completed by the deadline", kind: "count" },
  { key: "delayed_count", label: "Tasks delayed", help: "Count of tasks completed late", kind: "count" },
  { key: "achievement_pct", label: "KPI average %", help: "Average of every KPI's achieved ÷ target (each capped at 150%)", kind: "pct" },
  { key: "quality_rating", label: "Quality", help: "Manager assessment, 1–5", kind: "rating" },
  { key: "collaboration_rating", label: "Collaboration", help: "Teamwork and support, 1–5", kind: "rating" },
  { key: "innovation_rating", label: "Innovation", help: "Process improvements and ideas, 1–5", kind: "rating" },
  { key: "compliance_rating", label: "Compliance", help: "Regulatory and control adherence, 1–5", kind: "rating" },
  { key: "csat_rating", label: "CSAT", help: "Customer satisfaction, 1–5", kind: "rating" },
  { key: "twcs_score", label: "Training (TWCS)", help: "Timeliness-Weighted Completion Score, 0–100", kind: "twcs" },
];

export interface Flag {
  level: "info" | "warn";
  text: string;
}

export interface KpiItem {
  id: number;
  kind: "kpi" | "duty";
  employee_id: number;
  employee?: Person;
  title: string;
  kpi_type: { id: number; code: string; name: string; unit: string } | null;
  is_team: boolean;
  priority: string | null;
  target_date: string | null;
  target_value: number | null;
  target_text: string | null;
  per_day: number | null;
  achieved_value: number | null;
  effective_target: number | null;
  effective_achieved: number | null;
  value_source: string;
  team_sum: { rows: number; target_sum: number | null; achieved_sum: number | null; achieved_partial: number | null; achieved_missing: number } | null;
  pct: number | null;
  outcome: "Completed" | "Not completed" | null;
  completed_date: string | null;
  timing: string;
  delay_reason: string | null;
  delay_validated: boolean;
  remarks: string | null;
  source: string;
  source_row: number | null;
  source_name: string | null;
  source_status: string | null;
  flags: Flag[];
  version: number;
  can_edit?: boolean;
  locked_reason?: string | null;
  can_validate_delay?: boolean;
}

export interface KpiType {
  id: number;
  code: string;
  name: string;
  unit: string;
  description: string | null;
}

export const ROLE_NAMES: Record<string, string> = { hod: "HOD", admin: "Admin", manager: "Manager" };

export function usePilot() {
  return useApiQuery<PilotContext>("/individual/context");
}

/** Month in the URL (?month=), defaulting to the earliest open month. */
export function useMonth(ctx: PilotContext | undefined): [number | null, (id: number) => void] {
  const [param, setParam] = useQueryParam("month");
  const id = param ? Number(param) : ctx?.focus_month_id ?? null;
  useEffect(() => {
    if (!param && ctx?.focus_month_id) setParam(String(ctx.focus_month_id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx?.focus_month_id]);
  return [id, (v: number) => setParam(String(v))];
}

export function MonthPicker({ months, value, onChange, lockedOnly }: { months: MonthInfo[]; value: number | null; onChange: (id: number) => void; lockedOnly?: boolean }) {
  const list = lockedOnly ? months.filter((m) => m.state === "Locked") : months;
  return (
    <select className="input" style={{ width: 210 }} aria-label="Month" value={value ?? ""} onChange={(e) => onChange(Number(e.target.value))}>
      {list.map((m) => (
        <option key={m.id} value={m.id}>
          {m.label} / {m.state}
        </option>
      ))}
    </select>
  );
}

export function NotInPilot() {
  return (
    <Card>
      <Empty title="No Sales pilot people in your scope">
        The Individual Tier is piloted with the Sales team only. Managers see their reporting tree, the Sales HOD sees the department, and Admins see everyone in the pilot.
      </Empty>
    </Card>
  );
}

export function FinalScore({ row }: { row: Pick<PersonRow, "final" | "status" | "base"> & { evaluation_state?: string } }) {
  if (row.status === "not_evaluated") return <Badge tone="grey">Not evaluated</Badge>;
  // Missing inputs during the month are work in progress; "Insufficient data" is the verdict once it is submitted.
  if (row.final === null && ["Not started", "Draft", "Returned"].includes(row.evaluation_state ?? "")) return <Badge tone="grey">In progress</Badge>;
  if (row.final === null) return <Badge tone="red">Insufficient data</Badge>;
  return <span className="num strong">{fmtScore(row.final)}</span>;
}

export function TierBadge({ tier }: { tier: string | null }) {
  return tier ? <Badge status={tier} /> : <span className="muted">—</span>;
}

export function TwcsCell({ row }: { row: Pick<PersonRow, "twcs" | "twcs_status" | "band" | "keka"> }) {
  if (row.twcs_status === "na") return <span className="muted">N/A (none due)</span>;
  if (row.twcs === null) return <span className="muted">Not recorded</span>;
  return (
    <span className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
      <span className="num">{fmtScore(row.twcs)}</span>
      <Badge status={row.band ?? undefined} />
    </span>
  );
}

export function fmtValue(v: number | null | undefined, unit?: string): string {
  if (v === null || v === undefined) return "—";
  if (unit === "rupees") return `₹${fmtNum(v)}`;
  if (unit === "percent") return `${fmtNum(v, 2)}%`;
  return fmtNum(v, 2);
}

export function OnTimeCell({ ot }: { ot: OnTime }) {
  const total = ot.on_time + ot.delayed;
  return (
    <span className="num">
      {total ? `${ot.on_time}/${total}` : "—"}
      {ot.delayed > 0 && <span className="small" style={{ color: "var(--red-fg)" }}> · {ot.delayed} delayed</span>}
      {ot.no_outcome > 0 && <div className="small muted">{ot.no_outcome} not recorded</div>}
    </span>
  );
}

export const METHOD_NOTE = "How the parameters are weighted and combined is visible to Admins only.";

/** Value shown for a parameter: what the Manager entered, else what the records give. */
export function paramValue(r: PersonRow, key: string): { value: number | null; fromRecords: boolean } {
  if (key.endsWith("_rating")) return { value: (r.check_in as unknown as Record<string, number | null>)[key] ?? null, fromRecords: false };
  const entered = r.check_in.entered[key as CountKey];
  if (entered !== null && entered !== undefined) return { value: entered, fromRecords: false };
  const derived = r.check_in.derived[key as CountKey];
  return { value: derived ?? null, fromRecords: derived !== null && derived !== undefined };
}
