const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parse(value: string | Date): Date {
  if (value instanceof Date) return value;
  // Plain ISO dates are calendar dates (no timezone shift).
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date(value);
}

/** 09 Oct 2026 */
export function fmtDate(value: string | Date | null | undefined, withYear = true): string {
  if (!value) return "—";
  const d = parse(value);
  if (Number.isNaN(d.getTime())) return "—";
  const day = String(d.getDate()).padStart(2, "0");
  return withYear ? `${day} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` : `${day} ${MONTHS[d.getMonth()]}`;
}

/** 09 Oct, 15:20 IST */
export function fmtDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = parse(value);
  if (Number.isNaN(d.getTime())) return "—";
  return `${fmtDate(d, false)}, ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")} IST`;
}

/** Scores: two decimals for display; tiers are applied server-side to the unrounded value. */
export function fmtScore(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined) return "Unavailable";
  return value.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtPct(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined) return "Unavailable";
  return `${value.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
}

export function fmtNum(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString("en-IN", { maximumFractionDigits: digits });
}

export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function daysSince(value: string | null | undefined): number | null {
  if (!value) return null;
  return Math.max(0, Math.floor((Date.now() - parse(value).getTime()) / 86400000));
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}
