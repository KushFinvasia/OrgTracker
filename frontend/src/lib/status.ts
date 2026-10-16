export type Tone = "blue" | "amber" | "green" | "red" | "grey" | "gold" | "dark";

const TONES: Record<string, Tone> = {
  // task / project
  "In Progress": "blue",
  "In progress": "blue",
  "In Review": "amber",
  "In review": "amber",
  Rework: "red",
  Completed: "green",
  Blocked: "red",
  "Not Started": "grey",
  "Not started": "grey",
  Planning: "grey",
  "On Hold": "grey",
  Cancelled: "grey",
  // derived
  "On time": "green",
  "Submitted on time": "green",
  "Submitted late": "amber",
  "Awaiting review": "amber",
  Late: "red",
  Overdue: "red",
  "Due soon": "amber",
  "No deadline": "grey",
  "On Track": "green",
  "At Risk": "amber",
  "Off Track": "red",
  // priority / criticality
  High: "red",
  Medium: "amber",
  Low: "grey",
  Critical: "red",
  // validation / training / review
  Pending: "amber",
  "Pending approval": "amber",
  "Pending validation": "amber",
  Validated: "green",
  Rejected: "red",
  Returned: "red",
  Submitted: "amber",
  "Verified complete": "green",
  Assigned: "grey",
  Upcoming: "grey",
  Exempt: "grey",
  Approved: "green",
  Draft: "grey",
  Finalized: "green",
  Open: "blue",
  Mitigating: "amber",
  Closed: "green",
  "Under analysis": "amber",
  "Under Review": "amber",
  Locked: "dark",
  Published: "green",
  Nominations: "blue",
  Review: "amber",
  "Ready for review": "green",
  "Insufficient data": "red",
  "Readiness exception": "amber",
  Gold: "gold",
  Silver: "grey",
  Bronze: "amber",
  // Individual Tier
  Delayed: "red",
  "Delay validated": "grey",
  "No outcome": "amber",
  "Enter the date": "amber",
  Recognised: "green",
  Standard: "blue",
  Developing: "amber",
  Support: "red",
  "Exemption requested": "amber",
  pass: "green",
  fail: "red",
  unknown: "amber",
};

export function toneFor(value: string | null | undefined): Tone {
  if (!value) return "grey";
  return TONES[value] ?? "grey";
}

export const STATUS_LABELS: Record<string, string> = {
  "Not Started": "Not started",
  "In Progress": "In progress",
  "In Review": "In review",
  "On Hold": "On hold",
};

export function statusLabel(s: string): string {
  return STATUS_LABELS[s] ?? s;
}
