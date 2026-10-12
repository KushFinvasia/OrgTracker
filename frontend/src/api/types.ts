export type Role = "admin" | "hod" | "manager" | "team_lead";

export interface Person {
  id: number;
  code: string;
  name: string;
  designation: string | null;
  department: string | null;
  initials: string;
  record_type?: string;
}

export interface Account {
  id: number;
  email: string;
  role: Role;
  role_label: string;
  employee: Person;
  preferences: Record<string, unknown>;
  headed_departments: string[];
  reporting_count?: number;
  can_see_performance?: boolean;
}

export interface ProjectMetrics {
  tasks_total: number;
  tasks_accepted: number;
  accepted_delivery: number | null;
  reported_progress: number | null;
  overdue: number;
  blocked: number;
  open_risks: number;
  open_high_risks: number;
  health: "On Track" | "At Risk" | "Off Track" | null;
  health_note: string;
  timing: string;
}

export interface Project {
  id: number;
  code: string;
  title: string;
  objective: string | null;
  owner: Person | null;
  reviewer: Person | null;
  department: string | null;
  department_id: number | null;
  priority: "High" | "Medium" | "Low" | null;
  status: string;
  start_date: string | null;
  target_date: string | null;
  source: string;
  archived: boolean;
  template_id: number | null;
  version: number;
  metrics: ProjectMetrics;
}

export interface Milestone {
  id: number;
  title: string;
  owner: Person | null;
  target_date: string | null;
  acceptance_criterion: string | null;
  evidence: string | null;
  state: string;
  dependency: string | null;
  linked_tasks: number;
  accepted_tasks: number;
}

export interface ProjectDetail extends Project {
  people: { employee: Person; roles: string[] }[];
  milestones: Milestone[];
  can_manage: boolean;
  activation_blockers: string[];
  template: string | null;
}

export interface AssignmentRow {
  employee: Person;
  role: "Owner" | "Contributor";
  share: number;
}

export interface TaskBrief {
  id: number;
  code: string;
  title: string;
  category: string | null;
  project: { id: number; code: string; title: string } | null;
  milestone_id: number | null;
  status: string;
  progress: number;
  complexity: number;
  due_date: string | null;
  due_date_original: string | null;
  start_date: string | null;
  timing: string;
  owner: Person | null;
  assignments: AssignmentRow[];
  reviewer: Person | null;
  next_action: string | null;
  pending_blockers: number;
  accepted_submission_date: string | null;
  incident_id: number | null;
  source: string;
  data_flags: string | null;
  version: number;
}

export interface TaskDetail extends TaskBrief {
  description: string | null;
  checklist: string[];
  required_evidence: string | null;
  dependencies: { id: number; code: string; title: string; status: string }[];
  submissions: { id: number; version: number; submission_date: string; note: string | null; evidence_ids: number[]; source: string; created_at: string }[];
  reviews: {
    id: number;
    submission_id: number;
    decision: "accept" | "rework";
    reviewer: Person | null;
    reason_category: string | null;
    failed_criteria: string[];
    feedback: string | null;
    requirement_changed: boolean;
    decided_at: string;
    source: string;
  }[];
  blockers: { id: number; category: string; description: string | null; requester: Person | null; validator: Person | null; blocked_since: string | null; state: string; decision_reason: string | null; evidence: string | null; source: string }[];
  deadline_changes: { id: number; original_date: string | null; requested_date: string; reason_category: string; comment: string; requester: Person | null; validator: Person | null; state: string; decision_reason: string | null }[];
  evidence: { id: number; filename: string; size: number; uploaded_at: string; uploaded_by: Person | null }[];
  can_update: boolean;
  is_reviewer: boolean;
}

export interface ActionItem {
  type: string;
  title: string;
  context: string;
  since: string | null;
  action: string;
  link: string;
}

export interface MetricRow {
  metric: string;
  label: string;
  available: boolean;
  score: number | null;
  raw: number | null;
  raw_display: string;
  reason: string;
  weight: number;
  contribution: number | null;
  detail: Record<string, unknown>;
}

export interface TrainingSummary {
  allotted: number;
  future_due: number;
  excluded: number;
  eligible: number;
  verified: number;
  pending_verification: number;
  in_progress: number;
  uncompleted: number;
  overdue: number;
  score: number | null;
  status: "scored" | "na" | "readiness_exception";
  ledger: Record<string, string[]>;
}

export interface Evaluation {
  employee: Person;
  period: { id: number; name: string; state: string; start: string; end: string };
  category: string;
  category_proposed: boolean;
  kpi_rule: { id: number; label: string; state: string };
  training_rule: { id: number; label: string; state: string; config: { base_weight: number; training_weight: number } } | null;
  base: { value: number | null; preview: number | null; coverage: number; sufficient: boolean; rows: MetricRow[] };
  original_base: Evaluation["base"] | null;
  overrides: { metric: string; original: number | null; new: number; reason: string; at: string }[];
  training: TrainingSummary;
  final: { status: string; value: number | null; base_part?: number; training_part?: number; explanation: string };
  original_final: Evaluation["final"] | null;
  tier: string | null;
  gates: { gate: string; result: "pass" | "fail" | "unknown"; source: string }[];
  readiness: string[];
  checkin: { month: string; state: string } | null;
  locked: boolean;
  illustrative_inputs: boolean;
  can_override?: boolean;
  checkins?: CheckIn[];
  inputs?: MetricInput[];
}

export interface CheckIn {
  id: number;
  employee_id: number;
  period_id: number;
  month: string;
  quality_rating: number | null;
  collaboration_rating: number | null;
  innovation_rating: number | null;
  collaboration_evidence: string | null;
  innovation_evidence: string | null;
  development_note: string | null;
  state: string;
  manager: Person | null;
  illustrative: boolean;
}

export interface MetricInput {
  id: number;
  employee: Person | null;
  period_id: number;
  metric: string;
  values: Record<string, unknown>;
  evidence: string | null;
  author: Person | null;
  validator: Person | null;
  state: string;
  decision_note: string | null;
  created_at: string;
  illustrative: boolean;
  can_decide: boolean;
}

export interface Period {
  id: number;
  name: string;
  period_type: string;
  start_date: string;
  end_date: string;
  department: string;
  department_id: number | null;
  kpi_rule: { id: number; label: string; state: string };
  training_rule: { id: number; label: string; state: string } | null;
  evidence_cutoff: string;
  state: string;
  review_owner: Person | null;
  locked_by: Person | null;
  locked_at: string | null;
  lock_reason: string | null;
}

export interface TrainingAssignment {
  id: number;
  code: string;
  course: { id: number; code: string; title: string; version: number };
  employee: Person;
  assigned_date: string;
  due_date: string;
  due_date_original: string;
  training_type: string;
  completion_criteria: string;
  pass_mark: number | null;
  duration_hours: number | null;
  verifier: Person | null;
  status: string;
  display_status: string;
  overdue: boolean;
  progress: number;
  completion_date: string | null;
  assessment_result: number | null;
  attendance_ok: boolean | null;
  evidence_note: string | null;
  recorded_by: Person | null;
  verified_by: Person | null;
  verified_at: string | null;
  verification_note: string | null;
  attempts: { attempt_no: number; result: number | null; date: string | null; note: string | null }[];
  exceptions: { id: number; type: string; reason: string; state: string; approver: Person | null; proposed_due_date: string | null; decision_note: string | null; requested_by: Person | null }[];
  evidence: { id: number; filename: string; uploaded_at: string }[];
  can_verify: boolean;
  illustrative: boolean;
}

export interface Department {
  id: number;
  name: string;
  category: string;
  category_proposed: boolean;
  aliases: string | null;
  heads: Person[];
  notes: string | null;
}
