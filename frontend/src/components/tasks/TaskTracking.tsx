import { Flag, Plus } from "lucide-react";
import type { ReactNode } from "react";

import type { TaskBrief } from "@/api/types";
import { Avatar, Badge, Empty, Panel } from "@/components/ui";
import { fmtDate, todayISO } from "@/lib/format";
import { statusLabel } from "@/lib/status";
import { LANES, TASK_DATE_NOTE, TASK_STATUSES, isBlocked } from "@/lib/tasks";
import { GxHead, GxLegend, GxRow, daysBetween, gxRange, type GxBarSpec } from "./Gantt";

/** Status picker: the tracker's statuses in its order. Completed is listed but only the reviewer's Accept sets it. */
export function StatusOptions({ includeCancelled = true }: { includeCancelled?: boolean }) {
  return (
    <>
      {TASK_STATUSES.map((s) =>
        s === "Completed" ? (
          <option key={s} disabled title="Only the reviewer's Accept sets Completed">
            Completed (on Accept)
          </option>
        ) : (
          <option key={s} value={s}>
            {statusLabel(s)}
          </option>
        ),
      )}
      {includeCancelled && <option value="Cancelled">Cancelled</option>}
    </>
  );
}

export function MiniBar({ value }: { value: number }) {
  return (
    <span className="pct-cell" style={{ justifyContent: "flex-start" }}>
      {value}%
      <span className="minibar">
        <i className={value < 40 ? "low" : ""} style={{ width: `${value}%` }} />
      </span>
    </span>
  );
}

/** The task tracking table: start, end (due date in force), go-live, actual working days, delay, status, progress, next action. */
export function TaskTrackingTable({ tasks, onOpen, employeeId, note = true, empty = "No tasks assigned to this person in this project" }: { tasks: TaskBrief[]; onOpen: (id: number) => void; employeeId?: number; note?: boolean; empty?: string }) {
  return (
    <>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>Task</th>
              <th>{employeeId ? "Role / share" : "Owner"}</th>
              <th>Start date</th>
              <th>End date</th>
              <th>Go live date</th>
              <th className="n">Actual working days</th>
              <th className="n">Delay (No. of days)</th>
              <th>Status</th>
              <th>Progress</th>
              <th>Next action</th>
            </tr>
          </thead>
          <tbody>
            {tasks.length === 0 && (
              <tr>
                <td colSpan={10}>
                  <Empty title={empty} />
                </td>
              </tr>
            )}
            {tasks.map((t) => {
              const a = employeeId ? t.assignments.find((x) => x.employee.id === employeeId) : null;
              return (
                <tr key={t.id}>
                  <td style={{ minWidth: 200 }}>
                    <button type="button" className="link-btn" onClick={() => onOpen(t.id)}>
                      <b>{t.title}</b>
                    </button>
                    <span className="sub">{t.code}</span>
                  </td>
                  <td className={a ? "nw" : undefined}>{a ? `${a.role} · ${a.share}%` : t.owner?.name ?? <span className="muted">No owner</span>}</td>
                  <td className="nw">{fmtDate(t.start_date)}</td>
                  <td className="nw">
                    {fmtDate(t.due_date)}
                    {t.due_date_original && t.due_date_original !== t.due_date && <span className="sub">was {fmtDate(t.due_date_original, false)}</span>}
                  </td>
                  <td className="nw">{fmtDate(t.go_live_date)}</td>
                  <td className="n">{t.working_days ?? "—"}</td>
                  <td className={`n ${t.delay_days ? "bad-txt" : ""}`}>{t.delay_days ?? "—"}</td>
                  <td><Badge status={t.status} /></td>
                  <td>
                    <MiniBar value={t.progress} />
                    {t.status === "Completed" && <span className="sub">Completed</span>}
                  </td>
                  <td className="wrap">{t.next_action || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {note && <p className="note" style={{ padding: "12px 18px" }}>{TASK_DATE_NOTE}</p>}
    </>
  );
}

export function TaskCard({ t, onOpen }: { t: TaskBrief; onOpen: (id: number) => void }) {
  return (
    <button type="button" className="kcard" onClick={() => onOpen(t.id)}>
      <span className="row between">
        <span className="mono">{t.code.split("-").at(-1)}</span>
        <span className="row" style={{ gap: 4 }}>
          {t.pending_blockers > 0 && (
            <span className="badge bad">
              <Flag size={12} /> Blocker
            </span>
          )}
          {t.status !== "Completed" && <Badge status={t.status} />}
        </span>
      </span>
      <b>{t.title}</b>
      <span className="row small" style={{ gap: 6 }}>
        <Avatar person={t.owner} size="sm" />
        <span className="muted">{fmtDate(t.due_date, false)}</span>
        <Badge status={t.timing}>{t.timing}</Badge>
      </span>
      {t.progress > 0 && t.status !== "Completed" && (
        <span className="minibar" style={{ width: "100%" }}>
          <i style={{ width: `${t.progress}%` }} />
        </span>
      )}
    </button>
  );
}

/** Six lanes, each grouping several tracker statuses. Add task sits in every lane. */
export function TaskBoard({ tasks, onOpen, onAdd }: { tasks: TaskBrief[]; onOpen: (id: number) => void; onAdd?: () => void }) {
  return (
    <div className="kanban">
      {LANES.map(([label, statuses]) => {
        const items = tasks.filter((t) => statuses.includes(t.status));
        return (
          <div className="kcol" key={label}>
            <div className="kcol-h">
              <span title={statuses.map(statusLabel).join(", ")}>{label}</span>
              <span className="muted">{items.length}</span>
            </div>
            {items.map((t) => <TaskCard key={t.id} t={t} onOpen={onOpen} />)}
            {onAdd && (
              <button type="button" className="btn sm ghost kadd" onClick={onAdd}>
                <Plus size={14} /> Add task
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function taskBar(t: TaskBrief, onOpen: (id: number) => void): GxBarSpec {
  const today = todayISO();
  const moved = t.due_date_original && t.due_date_original !== t.due_date ? t.due_date_original : null;
  const over = t.timing === "Overdue";
  const b: GxBarSpec = { start: t.start_date || t.due_date!, end: t.due_date!, cls: "s-todo", over, ghost: moved, title: `${t.code} · ${t.title}\n${fmtDate(t.start_date)} → ${fmtDate(t.due_date)} · ${statusLabel(t.status)}`, text: null, onClick: () => onOpen(t.id) };
  let text: ReactNode;
  if (t.status === "Completed") {
    b.cls = "s-done";
    text = <>Completed {fmtDate(t.accepted_submission_date, false)}{t.accepted_submission_date && t.due_date && t.accepted_submission_date > t.due_date ? <> · <b className="bad-txt">late</b></> : null}</>;
  } else if (t.status === "In Review") {
    b.cls = "s-review";
    b.fill = 100;
    text = <>In review</>;
  } else if (t.status === "Rework") {
    b.cls = "s-review";
    b.fill = t.progress;
    text = <>Rework · due {fmtDate(t.due_date, false)}</>;
  } else if (isBlocked(t.status) || t.status === "Delayed") {
    b.cls = "s-blocked";
    b.fill = t.progress;
    text = <>{statusLabel(t.status)} · {t.progress}% · due {fmtDate(t.due_date, false)}</>;
  } else if (t.status !== "Not Started") {
    b.cls = "s-progress";
    b.fill = t.progress;
    text = <>{statusLabel(t.status)} · {t.progress}% · due {fmtDate(t.due_date, false)}</>;
  } else text = <>Due {fmtDate(t.due_date, false)}</>;
  const late = over && t.due_date ? daysBetween(t.due_date, today) : 0;
  b.text = (
    <>
      {text}
      {over && <> · <b className="bad-txt">{late} day{late > 1 ? "s" : ""} overdue</b></>}
      {moved && <> · moved from {fmtDate(moved, false)}</>}
    </>
  );
  return b;
}

export function TaskTimeline({ tasks, onOpen, hideDone, onToggleDone }: { tasks: TaskBrief[]; onOpen: (id: number) => void; hideDone: boolean; onToggleDone: (v: boolean) => void }) {
  const all = tasks.filter((t) => t.status !== "Cancelled");
  const dated = all.filter((t) => t.due_date && !(hideDone && t.status === "Completed"));
  const undated = all.filter((t) => !t.due_date);
  const tools = (
    <div className="gx-tools">
      <label className="toggle">
        <input type="checkbox" checked={hideDone} onChange={(e) => onToggleDone(e.target.checked)} /> Hide completed tasks
      </label>
      <span style={{ marginLeft: "auto" }} />
      <GxLegend />
    </div>
  );
  if (!dated.length)
    return (
      <>
        {tools}
        <Panel title="Timeline" pad>
          <Empty title="No dated tasks">Add due dates to place work on the timeline.</Empty>
        </Panel>
      </>
    );
  const r = gxRange([...dated.map((t) => t.start_date), ...dated.map((t) => t.due_date), ...dated.map((t) => t.due_date_original)]);
  const rows = [...dated].sort((a, b) => (a.start_date || a.due_date!).localeCompare(b.start_date || b.due_date!));
  return (
    <>
      {tools}
      <section className="panel">
        <div className="gx-scroll">
          <div className="gx">
            <GxHead r={r} label={`Task · ${fmtDate(r.from, false)} to ${fmtDate(r.to, false)}`} />
            {rows.map((t) => (
              <GxRow
                key={t.id}
                r={r}
                label={
                  <button type="button" className="gx-name" onClick={() => onOpen(t.id)}>
                    <span className="mono">{t.code.split("-").at(-1)}</span>
                    {t.title}
                  </button>
                }
                meta={
                  <>
                    <Avatar person={t.owner} size="sm" />
                    <span>{t.owner?.name ?? "No owner"}</span>
                    <Badge status={t.status} />
                  </>
                }
                bar={taskBar(t, onOpen)}
              />
            ))}
          </div>
        </div>
        {undated.length > 0 && (
          <div className="gx-off">
            Not on the timeline (no due date):{" "}
            {undated.map((t, i) => (
              <span key={t.id}>
                {i > 0 && ", "}
                <button type="button" className="link-btn" onClick={() => onOpen(t.id)}>
                  {t.code.split("-").at(-1)} · {t.title}
                </button>
              </span>
            ))}
          </div>
        )}
      </section>
      <p className="note mt">Click a bar or task name to open it. Bars run from start to the due date in force; completed tasks are dated by their accepted submission. Weeks start on Monday.</p>
    </>
  );
}
