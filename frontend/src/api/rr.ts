import type { Person } from "@/api/types";

/** Project R&R payloads (backend app/api/routes/project_rr.py). Units and ₹ arrive only for Admin and R&R Panel members. */

export interface DelayReason {
  code: string;
  label: string;
  help: string;
  controllable: boolean;
}

export interface Charter {
  id: number;
  mode: "closure" | "programme";
  project_type: string;
  sponsor: string | null;
  champion: Person | null;
  champion_note: string | null;
  value_kind: string | null;
  value_target: number | null;
  value_target_text: string | null;
  pool_rate: number;
  state: "Draft" | "Submitted" | "Locked";
  submitted: boolean;
  sponsor_ok: boolean;
  pmo_ok: boolean;
  locked_on: string | null;
  lock_checks: Record<string, boolean>;
  doc_reading: boolean;
  illustrative: boolean;
  history: { at: string; event: string; actor: string; note?: string | null }[];
}

export interface RaciRow {
  id: number;
  person: Person | null;
  label: string | null;
  letter: "A" | "R" | "C" | "I";
  factor: number | null;
  factor_confirmed: boolean;
  response_days: number | null;
  adjustment: number;
  note: string | null;
}

export interface ProgrammeRaciRow {
  key: string;
  person: Person | null;
  label: string | null;
  letters: Record<"A" | "R" | "C" | "I", number[]>;
  letter: "A" | "R" | "C" | "I";
  dropped: string[];
  share: number;
  suggested: number | null;
  factor_confirmed: boolean;
  raci_id: number | null;
  payable: boolean;
  notes: string[];
}

export interface StageRow {
  step: number;
  name: string;
  sla_target: number | null;
  sla_max: number | null;
  effort: [number | null, number | null];
  responsible: Person | null;
  reviewer_rule: string | null;
  reviewer: Person | null;
  reviewer_conflict: boolean;
  conflict_reason: string | null;
  flags: string | null;
}

export interface Delay {
  id: number;
  code: string;
  task_id: number | null;
  task_code: string | null;
  task_label: string;
  run_request_id: number | null;
  stage: number | null;
  reason_code: string;
  reason_label: string;
  custom_reason: string | null;
  controllable: boolean;
  points: number;
  explanation: string;
  evidence: string | null;
  due_date: string | null;
  flagged_on: string | null;
  escalation_miss: boolean;
  tagged: Person[];
  state: string;
  logged_by: Person | null;
  logged_by_account_id: number | null;
  validated_by: Person | null;
  illustrative: boolean;
}

export interface LateTask {
  id: number;
  code: string;
  title: string;
  status: string;
  owner: Person | null;
  baseline_due: string | null;
  accepted_on: string | null;
  days_past: number | null;
}

export interface RunStage {
  step: number;
  task_id: number;
  code: string;
  name: string;
  status: string;
  done: boolean;
  late: boolean;
  start: string | null;
  due: string | null;
  accepted_on: string | null;
}

export interface Run {
  id: string;
  request_id: number;
  title: string;
  requesting_department: string | null;
  validator_rule: string;
  stages: RunStage[];
  started: string | null;
  delivered: string | null;
  max_due: string | null;
}

export interface RrInput {
  id: number;
  project: { id: number; code: string; title: string };
  kind: string;
  kind_label: string;
  function: string;
  value: Record<string, number>;
  display: string;
  state: string;
  author: Person | null;
  author_account_id: number | null;
  validator: Person | null;
  reason: string | null;
  illustrative: boolean;
  created_at: string;
  can_decide?: boolean;
}

export interface ScorecardPerson {
  key: string | number;
  person: Person | null;
  label: string | null;
  letter: "A" | "R" | "C" | "I";
  note: string | null;
  visible: boolean;
  hidden_reason?: string;
  adjustment?: number;
  tagged?: number;
  individual?: number | null;
  band?: string | null;
  units?: number;
  payout_pct?: number | null;
  share?: number;
  payout?: number;
}

export interface Scorecard {
  state: string; // Scored | Provisional | Insufficient data | Not eligible
  stage: string;
  frozen: boolean;
  missing: string[];
  money_visible: boolean;
  score: number | null;
  band: string | null;
  value_pct?: number;
  timelines_pct?: number;
  sla_pct?: number;
  points?: Record<"revenue" | "timelines" | "sla" | "rework" | "errors" | "satisfaction", number>;
  quality?: number;
  base?: number;
  collaboration?: number;
  bonus?: number;
  penalty?: number;
  recovery?: number;
  gates?: { key: string; label: string; ok: boolean; source: string }[];
  gates_ok?: boolean;
  pool?: number;
  total_units?: number;
  unit_value?: number | null;
  paid?: number;
  to_fund?: number;
  people: ScorecardPerson[];
  published_on?: string;
  inputs?: {
    value?: { target?: number | null; actual?: number | null; confirmed?: boolean; source?: string };
    timelines?: { due: number; on_time: number };
    sla?: { within: number; total: number } | null;
    rework_pct?: number | null;
    errors?: { critical: number; minor: number } | null;
    satisfaction?: { avg: number; n: number } | null;
    innovation?: number;
    collab?: { avg: number; raters: number; items: number } | null;
    doc_reading?: boolean;
  };
}

export interface ChecklistItem {
  key: string;
  label: string;
  ok: boolean;
  why: string;
  step?: number;
  raci_id?: number;
  suggested?: number;
}

export interface RrBundle {
  enrolled: true;
  charter: Charter;
  stage: string;
  raci: RaciRow[];
  programme_raci: { rows: ProgrammeRaciRow[]; total_effort: number } | null;
  stages: StageRow[];
  slas: { id: number; name: string; kind: string; tat: string }[];
  lock_checklist: ChecklistItem[];
  delays: Delay[];
  late_tasks: LateTask[];
  runs: Run[];
  stage_counts: { done: number; on_time: number } | null;
  baseline_changes: { id: number; task_label: string; requested_date: string; reason: string; state: string; requested_by: Person | null }[];
  disputes: { id: number; subject: string; grounds: string; state: string; raised_by: Person | null; created_at: string }[];
  inputs: RrInput[];
  scorecard: Scorecard;
  reasons: DelayReason[];
  permissions: { edit_charter: boolean; log_delay: boolean; request_baseline_change: boolean; sponsor: boolean; pmo: boolean; hr: boolean; panel: boolean; money: boolean; functions: string[] };
}

export type RrResponse = RrBundle | { enrolled: false; can_enrol: boolean };

export interface RecognitionRow {
  project: { id: number; code: string; title: string; department: string | null; status: string };
  mode: "closure" | "programme";
  project_type: string;
  champion: Person | null;
  champion_note: string | null;
  tasks_on_time: string;
  delays: string;
  gates: string;
  score: number | null;
  band: string | null;
  stage: string;
  pool: number | null;
  illustrative: boolean;
}

export interface QueueItem {
  count: number;
  title: string;
  context: string;
  link: string;
  tone: string;
  tag: string;
}

export interface Recognition {
  rows: RecognitionRow[];
  bands: Record<string, number>;
  scored: number;
  average: number | null;
  programmes: number;
  pool_total: number | null;
  money_visible: boolean;
  queue: QueueItem[];
  functions: string[];
  policy_state: string;
}

export const RR_FUNCTIONS = ["PMO validator", "Finance confirmer", "Quality assessor", "HR calibrator", "R&R Panel member"];

export const inr = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `₹${Math.round(n).toLocaleString("en-IN")}`);
export const crore = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `₹${(n / 1e7).toFixed(2)} crore`);
export const fmt2 = (n: number | null | undefined) => (n === null || n === undefined ? "—" : (Math.round(n * 100) / 100).toFixed(2));
export const BAND_COLOURS: Record<string, string> = { Platinum: "#3e536b", Gold: "var(--gold)", Silver: "var(--silver)", Bronze: "var(--bronze, #9a5a2c)", Review: "var(--bad)" };
export const BAND_RANGES: Record<string, string> = { Platinum: "90+", Gold: "80–89", Silver: "70–79", Bronze: "60–69", Review: "below 60" };
