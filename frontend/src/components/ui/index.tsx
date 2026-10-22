import {
  AlertTriangle,
  Ban,
  Check,
  CircleDashed,
  Circle,
  Clock,
  EyeOff,
  Info,
  Lock,
  Play,
  Search,
  TrendingDown,
  TrendingUp,
  ShieldCheck,
  Undo2,
  X,
  type LucideIcon,
} from "lucide-react";
import { cloneElement, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { api, ApiError } from "@/api/client";
import type { Person } from "@/api/types";
import { statusLabel, toneFor, type Tone } from "@/lib/status";

const TONE_CLASS: Record<Tone, string> = { blue: "info", amber: "warn", green: "ok", red: "bad", grey: "", gold: "tone-gold", dark: "tone-dark" };

/** Icons that carry a status's meaning next to its word (never colour alone). */
const STATUS_ICON: Record<string, LucideIcon> = {
  "Not started": Circle, "Not Started": Circle, Draft: CircleDashed, Submitted: Clock, "Pending approval": Clock, Approved: Check, Returned: Undo2,
  "Not evaluated": Ban, "On time": Check, Delayed: Clock, "Delay validated": ShieldCheck, "No outcome": AlertTriangle, Open: Circle, "No deadline": CircleDashed,
  "In Progress": Play, "In progress": Play, Blocked: Ban, "In Review": Clock, "In review": Clock, Rework: Undo2, Completed: Check, "On Hold": CircleDashed,
  Cancelled: X, Planning: CircleDashed, Locked: Lock, Validated: Check, Rejected: X, "Pending validation": Clock, "Verified complete": Check,
  Exempt: Ban, "Exemption requested": Clock, Overdue: AlertTriangle, Late: AlertTriangle, "On Track": Check, "At Risk": AlertTriangle, "Off Track": AlertTriangle,
  "Insufficient data": AlertTriangle, pass: Check, fail: X, "Under achieved": TrendingDown, Achieved: Check, "Over achieved": TrendingUp,
};
const TIERS = new Set(["Gold", "Silver", "Bronze"]);

export function Badge({ children, tone, status, icon }: { children?: ReactNode; tone?: Tone; status?: string | null; icon?: LucideIcon | false }) {
  const key = status ?? (typeof children === "string" ? children : null);
  if (key && TIERS.has(key) && !tone) return <Tier tier={key} />;
  const t = tone ?? toneFor(key);
  const Icon = icon === false ? null : icon ?? (key ? STATUS_ICON[key] : undefined);
  return (
    <span className={`badge ${TONE_CLASS[t]}`}>
      {Icon && <Icon size={13} strokeWidth={2} aria-hidden="true" />}
      {children ?? (status ? statusLabel(status) : "")}
    </span>
  );
}

/** Score tier with its diamond marker. */
export function Tier({ tier, empty = "No tier" }: { tier: string | null | undefined; empty?: string }) {
  if (!tier) return <span className="tier none">{empty}</span>;
  return <span className={`tier ${tier.toLowerCase()}`}>{tier}</span>;
}

type Variant = "primary" | "secondary" | "green" | "danger" | "ghost";
export function Button({
  children,
  variant = "secondary",
  size,
  busy,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "lg"; busy?: boolean }) {
  const cls = ["btn", (variant === "primary" || variant === "green") && "primary", variant === "danger" && "danger", variant === "ghost" && "ghost", size, busy && "is-busy", rest.className]
    .filter(Boolean)
    .join(" ");
  return (
    <button type="button" {...rest} className={cls}>
      {children}
    </button>
  );
}

export function PageHeader({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="ph">
      <div className="titles">
        <h1>{title}</h1>
        {sub && <div className="sub">{sub}</div>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: ReactNode; hidden?: boolean; count?: number }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs
        .filter((t) => !t.hidden)
        .map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={value === t.id} className={value === t.id ? "active" : ""} onClick={() => onChange(t.id)}>
            {t.label}
            {t.count !== undefined && t.count > 0 && <span className="count">{t.count}</span>}
          </button>
        ))}
    </div>
  );
}

/** Segmented control (two to four exclusive views). */
export function Segmented<T extends string>({ options, value, onChange, label }: { options: { id: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" aria-pressed={value === o.id} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Card({ title, sub, actions, children, className }: { title?: ReactNode; sub?: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <section className={`card ${className ?? ""}`}>
      {(title || actions) && (
        <div className="card-head">
          <div>
            {title && <h2>{title}</h2>}
            {sub && <div className="muted">{sub}</div>}
          </div>
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/** Panel with a header strip; the body is unpadded unless `pad` is set (tables and lists sit flush). */
export function Panel({ title, meta, tools, children, footer, pad, className, style }: { title?: ReactNode; meta?: ReactNode; tools?: ReactNode; children?: ReactNode; footer?: ReactNode; pad?: boolean; className?: string; style?: React.CSSProperties }) {
  return (
    <section className={`panel ${className ?? ""}`} style={style}>
      {(title || tools) && (
        <div className="panel-h">
          {title && <h2>{title}</h2>}
          {meta && <span className="meta">{meta}</span>}
          {tools && <div className="tools">{tools}</div>}
        </div>
      )}
      {pad ? <div className="panel-b">{children}</div> : children}
      {footer && <div className="panel-f">{footer}</div>}
    </section>
  );
}

export function SectionTitle({ num, title, meta, tools }: { num?: number; title: ReactNode; meta?: ReactNode; tools?: ReactNode }) {
  return (
    <div className="sec-title">
      {num !== undefined && <span className="section-num">{num}</span>}
      <h2>{title}</h2>
      {meta && <span className="meta">{meta}</span>}
      {tools && <span className="tools">{tools}</span>}
    </div>
  );
}

export function Stat({ label, value, hint }: { label: ReactNode; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

/** Key figures as one strip. */
export function Figures({ items, style }: { items: { label: ReactNode; value: ReactNode; hint?: ReactNode; unit?: ReactNode }[]; style?: React.CSSProperties }) {
  return (
    <div className="figures" style={{ ["--n" as string]: items.length, ...style }}>
      {items.map((f, i) => (
        <div className="figure" key={i}>
          <div className="lbl">{f.label}</div>
          <div className="val">
            {f.value}
            {f.unit && <small>{f.unit}</small>}
          </div>
          {f.hint && <div className="hint">{f.hint}</div>}
        </div>
      ))}
    </div>
  );
}

/** A value that is not available. Never a zero. */
export function Unavailable({ children = "Unavailable" }: { children?: ReactNode }) {
  return <span className="unavail">{children}</span>;
}

/** Achieved ÷ target bar, scaled to the 150% cap; the tick marks 100%. */
export function Minibar({ pct }: { pct: number | null | undefined }) {
  if (pct === null || pct === undefined) return null;
  const w = (Math.min(Math.max(pct, 0), 150) / 150) * 100;
  return (
    <span className="minibar" aria-hidden="true">
      <i className={pct < 80 ? "low" : ""} style={{ width: `${w}%` }} />
      <span className="tick" />
    </span>
  );
}

type CalloutTone = "mint" | "ok" | "warn" | "danger" | "bad" | "info" | "neutral";
const CALLOUT_ICON: Record<CalloutTone, LucideIcon> = { mint: Check, ok: Check, warn: AlertTriangle, danger: AlertTriangle, bad: AlertTriangle, info: Info, neutral: Info };
export function Callout({ title, children, tone = "info", icon, actions }: { title?: ReactNode; children?: ReactNode; tone?: CalloutTone; icon?: LucideIcon; actions?: ReactNode }) {
  const Icon = icon ?? CALLOUT_ICON[tone];
  return (
    <div className={`callout ${tone}`} role={tone === "danger" || tone === "bad" ? "alert" : undefined}>
      <Icon size={16} aria-hidden="true" />
      <div className="grow">
        {title && <b>{title}</b>}
        {title && children ? " " : null}
        {children}
      </div>
      {actions && <div className="c-actions">{actions}</div>}
    </div>
  );
}

export function Avatar({ person, size, name }: { person?: Pick<Person, "initials" | "name"> | null; size?: "sm" | "lg"; name?: string }) {
  const initials = person?.initials ?? (name ? name.split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join("").toUpperCase() : "?");
  return (
    <span className={`avatar ${size ?? ""}`} aria-hidden="true" title={person?.name ?? name}>
      {initials}
    </span>
  );
}

export function PersonChip({ person, meta, size = "sm" }: { person: Person | null | undefined; meta?: ReactNode; size?: "sm" | "lg" }) {
  if (!person) return <span className="muted">Not assigned</span>;
  return (
    <span className="person-cell">
      <Avatar person={person} size={size} />
      <span style={{ minWidth: 0 }}>
        <b>{person.name}</b>
        <span className="sub" style={{ display: "block", fontSize: 12, color: "var(--muted)" }}>
          {meta ?? `${person.code}${person.designation ? `, ${person.designation}` : ""}`}
        </span>
      </span>
    </span>
  );
}

export function Progress({ value }: { value: number | null | undefined }) {
  const v = Math.max(0, Math.min(100, value ?? 0));
  return (
    <div className="row nowrap" style={{ gap: 8 }}>
      <div className="pbar" style={{ flex: 1 }} role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100}>
        <i style={{ width: `${v}%` }} />
      </div>
      <span className="small muted tabular">{Math.round(v)}%</span>
    </div>
  );
}

/** Accepted (solid) and reported (striped) progress, never merged. */
export function DualProgress({ accepted, reported }: { accepted: number | null | undefined; reported: number | null | undefined }) {
  const a = Math.max(0, Math.min(100, accepted ?? 0));
  const r = Math.max(0, Math.min(100, reported ?? 0));
  return (
    <div className="progress-dual">
      <div className="pl">
        <span>Accepted {accepted === null || accepted === undefined ? "n/a" : `${Math.round(a)}%`}</span>
        <span>Reported {reported === null || reported === undefined ? "n/a" : `${Math.round(r)}%`}</span>
      </div>
      <div className="pbar"><i style={{ width: `${a}%` }} /></div>
      <div className="pbar reported"><i style={{ width: `${r}%` }} /></div>
    </div>
  );
}

export function Empty({ title, children, action, icon: Icon = Search }: { title: string; children?: ReactNode; action?: ReactNode; icon?: LucideIcon }) {
  return (
    <div className="empty">
      <div className="ico"><Icon size={20} aria-hidden="true" /></div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Loading({ rows = 1 }: { rows?: number }) {
  return (
    <div className="stack" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading current records</span>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton" />
      ))}
    </div>
  );
}

export function ErrorState({ error }: { error: ApiError | Error | null }) {
  if (!error) return null;
  const status = error instanceof ApiError ? error.status : 0;
  if (status === 403)
    return (
      <div className="panel" style={{ maxWidth: 620, margin: "40px auto 0" }}>
        <Empty title="Not available" icon={EyeOff} action={<a className="btn primary" href="/">Back to permitted work</a>}>
          {error.message}
        </Empty>
      </div>
    );
  if (status === 404)
    return (
      <div className="panel">
        <Empty title="Not found">{error.message}</Empty>
      </div>
    );
  return (
    <div className="form-error" role="alert">
      <AlertTriangle size={16} aria-hidden="true" />
      {error.message}
    </div>
  );
}

/** Labelled form field. The label is linked to its control (htmlFor/id) and the message via aria-describedby. */
export function Field({ label, required, error, help, children, className }: { label: string; required?: boolean; error?: string | null; help?: ReactNode; children: ReactNode; className?: string }) {
  const autoId = useId();
  const child = isValidElement(children) ? (children as ReactElement<Record<string, unknown>>) : null;
  const controlId = (child?.props.id as string | undefined) ?? autoId;
  const msgId = `${controlId}-msg`;
  const control = child
    ? cloneElement(child, {
        id: controlId,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": error || help ? msgId : undefined,
        "aria-required": required || undefined,
      })
    : children;
  return (
    <div className={`field ${error ? "invalid" : ""} ${className ?? ""}`}>
      <label htmlFor={child ? controlId : undefined}>
        {label}
        {required && <span className="req" aria-hidden="true">*</span>}
      </label>
      {control}
      {error ? (
        <span className="error" role="alert" id={msgId}>
          <AlertTriangle size={13} aria-hidden="true" />
          {error}
        </span>
      ) : help ? (
        <span className="help" id={msgId}>{help}</span>
      ) : null}
    </div>
  );
}

function useFocusTrap(open: boolean, ref: React.RefObject<HTMLElement>, onEscape: () => void, deps: unknown[] = []) {
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>("[autofocus], input:not([type=hidden]), select, textarea, .drawer-b button, .drawer-body button, button");
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onEscape();
      }
      if (e.key === "Tab" && ref.current) {
        const els = [...ref.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex='0']")].filter((x) => x.offsetParent !== null);
        if (!els.length) return;
        const firstEl = els[0];
        const last = els[els.length - 1];
        if (e.shiftKey && document.activeElement === firstEl) {
          last.focus();
          e.preventDefault();
        } else if (!e.shiftKey && document.activeElement === last) {
          firstEl.focus();
          e.preventDefault();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (opener && document.contains(opener)) opener.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ...deps]);
}

/** Dismissal that leaves the way the surface came in; the caller's onClose runs once the exit animation ends. */
function useLeave(onDone: () => void, ms = 200) {
  const [leaving, setLeaving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);
  const leave = () => {
    if (timer.current) return;
    const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    setLeaving(true);
    timer.current = setTimeout(() => {
      timer.current = undefined;
      setLeaving(false);
      onDone();
    }, reduced ? 120 : ms);
  };
  return [leaving, leave] as const;
}

export function Drawer({
  open,
  onClose,
  eyebrow,
  title,
  sub,
  children,
  footer,
  wide,
  dirty,
}: {
  open: boolean;
  onClose: () => void;
  eyebrow?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  dirty?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [confirming, setConfirming] = useState(false);
  const [leaving, leave] = useLeave(onClose);
  const tryClose = () => (dirty ? setConfirming(true) : leave());
  useFocusTrap(open && !confirming, ref, tryClose, [dirty]);

  if (!open) return null;
  return (
    <>
      <div className={`scrim ${leaving ? "leaving" : ""}`} onClick={tryClose} />
      <div className={`drawer ${wide ? "wide" : ""} ${leaving ? "leaving" : ""}`} role="dialog" aria-modal="true" ref={ref}>
        <div className="drawer-h">
          <div className="grow">
            {eyebrow && <div className="eyebrow small muted">{eyebrow}</div>}
            <h2>{title}</h2>
            {sub && <p className="sub">{sub}</p>}
          </div>
          <button type="button" className="icon-btn" onClick={tryClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="drawer-b">{children}</div>
        {footer && <div className="drawer-f">{footer}</div>}
      </div>
      {confirming && (
        <ConfirmDiscard
          onDiscard={() => {
            setConfirming(false);
            leave();
          }}
          onKeep={() => setConfirming(false)}
        />
      )}
    </>
  );
}

function ConfirmDiscard({ onDiscard, onKeep }: { onDiscard: () => void; onKeep: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(true, ref, onKeep);
  return (
    <>
      <div className="scrim" style={{ zIndex: 62 }} />
      <div className="dialog" style={{ zIndex: 63 }} role="alertdialog" aria-modal="true" ref={ref}>
        <div className="dialog-h"><h2>Discard your unsaved changes?</h2></div>
        <div className="dialog-b muted">You have changes in this panel that are not saved. Discarding removes only those edits; no saved record changes.</div>
        <div className="dialog-f">
          <Button variant="danger" onClick={onDiscard}>Discard changes</Button>
          <Button variant="primary" onClick={onKeep}>Keep editing</Button>
        </div>
      </div>
    </>
  );
}

export function Modal({ open, title, children, onClose }: { open: boolean; title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [leaving, leave] = useLeave(onClose, 140);
  useFocusTrap(open, ref, leave);
  if (!open) return null;
  return (
    <>
      <div className={`scrim ${leaving ? "leaving" : ""}`} style={{ zIndex: 62 }} onClick={leave} />
      <div className={`modal ${leaving ? "leaving" : ""}`} style={{ zIndex: 63 }} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <h2 style={{ fontSize: 17, marginBottom: 12 }}>{title}</h2>
        {children}
      </div>
    </>
  );
}

/** Popover anchored under (or above) its trigger. Closes on outside click and Esc. */
export function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null); // a FloatingMenu lives outside `ref`, on <body>
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return { open, setOpen, ref, popRef, toggle: () => setOpen((o) => !o) };
}

/**
 * A menu drawn on <body>, fixed next to its trigger, so a container that clips its overflow (the sidebar) never cuts it off.
 * `place` puts it below or above the trigger; it is kept inside the window horizontally.
 */
export function FloatingMenu({
  anchor,
  popRef,
  place = "below",
  width,
  className,
  children,
}: {
  anchor: React.RefObject<HTMLElement>;
  popRef: React.RefObject<HTMLDivElement>;
  place?: "below" | "above";
  width: number;
  className?: string;
  children: ReactNode;
}) {
  const [pos, setPos] = useState<React.CSSProperties | null>(null);
  useLayoutEffect(() => {
    const update = () => {
      const r = anchor.current?.getBoundingClientRect();
      if (!r) return;
      const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
      setPos(place === "above" ? { left, bottom: window.innerHeight - r.top + 6, width } : { left, top: r.bottom + 6, width });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [anchor, place, width]);
  if (!pos) return null;
  return createPortal(
    <div ref={popRef} className={`pop ${place === "above" ? "from-bl" : ""} ${className ?? ""}`} role="menu" style={{ position: "fixed", ...pos }}>
      {children}
    </div>,
    document.body,
  );
}

/** Identity-rich picker: ID, designation and department, because duplicate names exist. */
export function PersonPicker({
  value,
  onChange,
  placeholder = "Search by name or employee ID",
  exclude = [],
  id,
}: {
  value: Person | null;
  onChange: (p: Person | null) => void;
  placeholder?: string;
  exclude?: number[];
  id?: string;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<Person[]>([]);
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      api.get<Person[]>(`/people/lookup?q=${encodeURIComponent(q)}&limit=12`).then(setResults).catch(() => setResults([]));
    }, 180);
    return () => clearTimeout(t);
  }, [q, open]);
  if (value && !open)
    return (
      <button type="button" id={id} className="input" style={{ textAlign: "left", cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} onClick={() => setOpen(true)}>
        {value.name} <span className="muted">({value.code}, {value.designation}, {value.department})</span>
      </button>
    );
  return (
    <div style={{ position: "relative" }}>
      <input id={id} className="input" autoFocus={open} placeholder={placeholder} value={q} onFocus={() => setOpen(true)} onChange={(e) => setQ(e.target.value)} onBlur={() => setTimeout(() => setOpen(false), 200)} />
      {open && results.length > 0 && (
        <div className="pop" style={{ left: 0, right: 0, top: "calc(100% + 4px)", maxHeight: 280, overflowY: "auto" }}>
          {results
            .filter((p) => !exclude.includes(p.id))
            .map((p) => (
              <button
                type="button"
                key={p.id}
                className="pi"
                onMouseDown={() => {
                  onChange(p);
                  setOpen(false);
                  setQ("");
                }}
              >
                <Avatar person={p} size="sm" />
                <span className="grow">
                  {p.name}
                  <small>{p.code}, {p.designation}, {p.department}</small>
                </span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(message: string, error = false) {
  let el = document.getElementById("orgtrack-toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "orgtrack-toast";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    document.body.appendChild(el);
  }
  el.className = `toast ${error ? "bad" : ""}`;
  el.textContent = message;
  el.style.display = "flex";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    if (el) el.style.display = "none";
  }, 3500);
}

export function FormError({ error }: { error: ApiError | null | undefined }) {
  if (!error) return null;
  return (
    <div className="form-error" role="alert">
      <AlertTriangle size={16} aria-hidden="true" style={{ flex: "none", marginTop: 2 }} />
      <span>
        {error.message}
        {error.status === 409 && " Your draft is kept; refresh to compare the latest version."}
      </span>
    </div>
  );
}

export function fieldError(error: ApiError | null | undefined, field: string): string | null {
  return error && error.field === field ? error.message : null;
}

export function Kv({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="kv">
      {items.map(([k, v], i) => (
        <div key={i} style={{ display: "contents" }}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Decision with a required reason (validate / reject / approve / return). Opens a small dialog. */
export function DecisionButton({
  label,
  decision,
  onDecide,
  variant = "secondary",
  reasonRequired = true,
  size,
  title,
  busy,
  icon,
  hideLabel,
}: {
  label: string;
  decision: string;
  onDecide: (decision: string, reason: string) => void;
  variant?: Variant;
  reasonRequired?: boolean;
  size?: "sm";
  title?: string;
  busy?: boolean;
  icon?: ReactNode;
  /** Show only the icon; the label stays as the accessible name and the dialog title. */
  hideLabel?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <>
      <Button variant={variant} size={size} disabled={busy} onClick={() => setOpen(true)} aria-label={hideLabel ? label : undefined} title={hideLabel ? label : undefined}>
        {icon}
        {!hideLabel && label}
      </Button>
      <Modal open={open} title={title ?? label} onClose={() => setOpen(false)}>
        <Field label="Reason" required={reasonRequired}>
          <textarea className="input" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <p className="small muted" style={{ marginTop: 8 }}>The decision, your identity, the time and this reason enter the audit history.</p>
        <div className="row" style={{ justifyContent: "flex-end", marginTop: 16 }}>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            variant={variant === "danger" ? "danger" : "primary"}
            disabled={reasonRequired && !reason.trim()}
            onClick={() => {
              onDecide(decision, reason.trim());
              setOpen(false);
              setReason("");
            }}
          >
            {label}
          </Button>
        </div>
      </Modal>
    </>
  );
}
