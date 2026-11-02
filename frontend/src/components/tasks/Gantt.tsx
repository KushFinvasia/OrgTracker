import type { ReactNode } from "react";

import { fmtDate, todayISO } from "@/lib/format";

/**
 * One gantt for tasks, runs and the portfolio: a week grid with dated headers, a labelled Today line, bars coloured by
 * status with a progress fill, a hatched overdue extension up to today, and a dashed marker where a due date was moved from.
 */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const D = (iso: string) => new Date(`${iso}T00:00:00Z`);
const ISO = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (iso: string, n: number) => {
  const d = D(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return ISO(d);
};
export const daysBetween = (a: string, b: string) => Math.round((D(b).getTime() - D(a).getTime()) / 86400000);
const dow = (iso: string) => D(iso).getUTCDay();

export interface GxRange {
  from: string;
  to: string;
  span: number;
  pos: (d: string) => number;
  mid: (d: string) => number;
  today: string;
}

export function gxRange(dates: (string | null | undefined)[]): GxRange {
  const today = todayISO();
  const ds = dates.filter(Boolean).sort() as string[];
  let from = ds[0] ?? today;
  let to = ds.length && ds[ds.length - 1] > today ? ds[ds.length - 1] : today;
  if (today < from) from = today;
  from = addDays(from, -((dow(from) + 6) % 7));
  to = addDays(to, 10);
  to = addDays(to, (7 - dow(to)) % 7);
  const span = daysBetween(from, to) + 1;
  return { from, to, span, today, pos: (d) => (daysBetween(from, d) / span) * 100, mid: (d) => ((daysBetween(from, d) + 0.5) / span) * 100 };
}

export function GxHead({ r, label }: { r: GxRange; label: string }) {
  const weeks: string[] = [];
  for (let d = r.from; d <= r.to; d = addDays(d, 7)) weeks.push(d);
  const dense = weeks.length > 14;
  return (
    <div className="gx-row gx-head">
      <div className="gx-label">{label}</div>
      <div className="gx-track" style={{ ["--wk" as string]: `${700 / r.span}%` }}>
        {weeks.map((w, i) => {
          const newMonth = i === 0 || w.slice(5, 7) !== weeks[i - 1].slice(5, 7);
          if ((dense && !newMonth) || Math.abs(r.pos(w) - r.mid(r.today)) < (dense ? 10 : 8)) return null; // nothing under the Today tag
          return (
            <span key={w} className="gx-wk" style={{ left: `${r.pos(w)}%` }}>
              {newMonth && <b>{MONTHS[Number(w.slice(5, 7)) - 1]} </b>}
              {dense ? "" : Number(w.slice(8))}
            </span>
          );
        })}
        <span className="gx-today-tag" style={{ left: `${r.mid(r.today)}%` }}>Today · {fmtDate(r.today, false)}</span>
      </div>
    </div>
  );
}

export interface GxBarSpec {
  start: string;
  end: string;
  cls: string;
  fill?: number | null;
  over?: boolean;
  ghost?: string | null;
  title: string;
  text: ReactNode;
  onClick?: () => void;
}

export function GxRow({ r, label, meta, bar, className }: { r: GxRange; label: ReactNode; meta?: ReactNode; bar: GxBarSpec; className?: string }) {
  const l = r.pos(bar.start);
  const end = r.pos(addDays(bar.end, 1));
  const w = Math.max(end - l, (100 / r.span) * 0.6);
  const over = bar.over ? r.pos(addDays(r.today, 1)) : null;
  const after = over ?? l + w;
  return (
    <div className={`gx-row ${className ?? ""}`}>
      <div className="gx-label">
        {label}
        {meta && <span className="gx-meta">{meta}</span>}
      </div>
      <div className="gx-track" style={{ ["--wk" as string]: `${700 / r.span}%` }}>
        <i className="gx-now" style={{ left: `${r.mid(r.today)}%` }} />
        <button type="button" className={`gx-bar ${bar.cls}`} style={{ left: `${l}%`, width: `${w}%` }} title={bar.title} aria-label={bar.title} onClick={bar.onClick} tabIndex={bar.onClick ? 0 : -1}>
          {bar.fill ? <i className="gx-fill" style={{ width: `${bar.fill}%` }} /> : null}
        </button>
        {over !== null && <span className="gx-over" style={{ left: `${l + w}%`, width: `${over - (l + w)}%` }} title={`Overdue since ${fmtDate(bar.end)}`} />}
        {bar.ghost && <span className="gx-ghost" style={{ left: `${r.pos(addDays(bar.ghost, 1))}%` }} title={`Original due date ${fmtDate(bar.ghost)}`} />}
        <span className="gx-text" style={after > 72 ? { right: `calc(${100 - l}% + 8px)` } : { left: `calc(${after}% + 8px)` }}>
          {bar.text}
        </span>
      </div>
    </div>
  );
}

export const GX_LEGEND: [string, string][] = [
  ["s-done", "Completed tasks"],
  ["s-progress", "In progress (fill = reported progress)"],
  ["s-review", "In review or rework"],
  ["s-blocked", "Blocked or off track"],
  ["s-todo", "Not started"],
  ["gx-over", "Overdue: past the due date"],
];

export function GxLegend({ keys = GX_LEGEND }: { keys?: [string, string][] }) {
  return (
    <div className="gx-legend">
      {keys.map(([c, l]) => (
        <span key={c}>
          <i className={c} />
          {l}
        </span>
      ))}
      <span>
        <i className="gx-ghost-key" />
        Original due date (moved)
      </span>
    </div>
  );
}
