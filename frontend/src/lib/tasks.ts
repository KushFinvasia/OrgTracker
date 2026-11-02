/**
 * Task statuses from the team's tracker dropdown, in its order (user direction, 23 Oct 2026). Values match the server and the tracker.
 * Completed is listed but only the reviewer's Accept sets it; In Review and Rework come only from the review workflow.
 * A status is a label: "Delayed" doesn't log a delay and "Live" doesn't complete a task (timing and delays come from dates).
 */
export const TASK_STATUSES = [
  "Not Started", "In Progress", "Completed", "On Hold", "Delayed", "Testing QA", "Exotel Vendor", "Pending", "In Development",
  "Block", "Production", "Ready For Live", "Product", "Vendor", "Live Today", "Unit testing", "Internal CUG", "Live",
] as const;

/** Statuses set by the review workflow: a manual status change can't replace them. */
export const WORKFLOW_STATUSES = ["In Review", "Rework", "Completed"];

/** Board lanes: each groups several statuses. */
export const LANES: [string, string[]][] = [
  ["To do", ["Not Started"]],
  ["In progress", ["In Progress", "In Development", "Unit testing", "Testing QA", "Internal CUG"]],
  ["Waiting or blocked", ["Pending", "On Hold", "Delayed", "Block", "Blocked", "Product", "Vendor", "Exotel Vendor"]],
  ["Going live", ["Ready For Live", "Production", "Live Today", "Live"]],
  ["In review", ["In Review", "Rework"]],
  ["Completed", ["Completed"]],
];

export const BLOCKER_CATEGORIES: Record<string, boolean> = {
  "Internal dependency": true,
  "External or vendor": true,
  "Approval pending": true,
  "Management reprioritisation": true,
  "Requirement change": true,
  Resource: true,
  "Technical issue": false,
  "Own-team rework": false,
};

export const TASK_DATE_NOTE =
  "End date is the due date in force; changes need validation. Actual working days count weekdays and exclude calendar holidays, from start to the accepted submission, pending submission, or today. They show elapsed time, not effort. Delay is calendar days after the end date. Go-live is recorded separately from acceptance.";

export const isBlocked = (status: string) => status === "Block" || status === "Blocked";
