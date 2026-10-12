import { X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { api, ApiError } from "@/api/client";
import type { Person } from "@/api/types";
import { statusLabel, toneFor, type Tone } from "@/lib/status";

export function Badge({ children, tone, status }: { children?: ReactNode; tone?: Tone; status?: string | null }) {
  const t = tone ?? toneFor(status ?? (typeof children === "string" ? children : null));
  return <span className={`badge tone-${t}`}>{children ?? (status ? statusLabel(status) : "")}</span>;
}

export function Button({
  children,
  variant = "secondary",
  size,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "green" | "danger"; size?: "sm" }) {
  const cls = ["btn", variant === "primary" && "btn-primary", variant === "green" && "btn-green", variant === "danger" && "btn-danger", size === "sm" && "btn-sm", rest.className]
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
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <div className="sub">{sub}</div>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: ReactNode; hidden?: boolean }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs
        .filter((t) => !t.hidden)
        .map((t) => (
          <button key={t.id} role="tab" aria-selected={value === t.id} className={value === t.id ? "active" : ""} onClick={() => onChange(t.id)}>
            {t.label}
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
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function Callout({ title, children, tone = "mint" }: { title?: ReactNode; children?: ReactNode; tone?: "mint" | "warn" | "danger" }) {
  return (
    <div className={`callout ${tone === "mint" ? "" : tone}`}>
      {title && <b>{title}</b>}
      {children}
    </div>
  );
}

export function Avatar({ person, size }: { person?: Pick<Person, "initials" | "name"> | null; size?: "lg" }) {
  return (
    <span className={`avatar ${size ?? ""}`} aria-hidden="true" title={person?.name}>
      {person?.initials ?? "?"}
    </span>
  );
}

export function PersonChip({ person, meta }: { person: Person | null | undefined; meta?: ReactNode }) {
  if (!person) return <span className="muted">Not assigned</span>;
  return (
    <span className="person">
      <Avatar person={person} />
      <span>
        <div className="name">{person.name}</div>
        <div className="meta">{meta ?? `${person.code}${person.designation ? ` / ${person.designation}` : ""}`}</div>
      </span>
    </span>
  );
}

export function Progress({ value }: { value: number | null | undefined }) {
  const v = Math.max(0, Math.min(100, value ?? 0));
  return (
    <div className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
      <div className="progress" style={{ flex: 1 }} role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100}>
        <i style={{ width: `${v}%` }} />
      </div>
      <span className="small muted tabular">{v}%</span>
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
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
      <Card>
        <Empty title="Private record unavailable" action={<a className="btn" href="/home">Back to permitted work</a>}>
          {error.message}
        </Empty>
      </Card>
    );
  if (status === 404) return <Card><Empty title="Not found">{error.message}</Empty></Card>;
  return <div className="form-error" role="alert">{error.message}</div>;
}

export function Field({ label, required, error, help, children, className }: { label: string; required?: boolean; error?: string | null; help?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`field ${error ? "invalid" : ""} ${className ?? ""}`}>
      <label>
        {label} {required && <span className="req">*</span>}
      </label>
      {children}
      {error ? <span className="error" role="alert">{error}</span> : help ? <span className="help">{help}</span> : null}
    </div>
  );
}

export function Drawer({
  open,
  onClose,
  eyebrow,
  title,
  children,
  footer,
  wide,
  dirty,
}: {
  open: boolean;
  onClose: () => void;
  eyebrow?: ReactNode;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  dirty?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);
  const [confirming, setConfirming] = useState(false);
  const tryClose = () => (dirty ? setConfirming(true) : onClose());

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    const first = ref.current?.querySelector<HTMLElement>("input, select, textarea, button");
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") tryClose();
      if (e.key === "Tab" && ref.current) {
        const els = ref.current.querySelectorAll<HTMLElement>("a, button, input, select, textarea, [tabindex]");
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
      (opener.current as HTMLElement | null)?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, dirty]);

  if (!open) return null;
  return (
    <>
      <div className="overlay" onClick={tryClose} />
      <div className={`drawer ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" ref={ref}>
        <div className="drawer-head">
          <div>
            {eyebrow && <div className="eyebrow">{eyebrow}</div>}
            <h2>{title}</h2>
          </div>
          <button className="icon-btn" onClick={tryClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-foot">{footer}</div>}
      </div>
      {confirming && (
        <>
          <div className="overlay" style={{ zIndex: 55 }} />
          <div className="modal" role="alertdialog" aria-modal="true">
            <h3>Keep your unsaved draft?</h3>
            <p className="muted">You have changes that have not been saved. Discard only removes the current unsaved edits; no saved record is deleted.</p>
            <div className="row between mt">
              <Button
                variant="danger"
                onClick={() => {
                  setConfirming(false);
                  onClose();
                }}
              >
                Discard changes
              </Button>
              <Button variant="primary" onClick={() => setConfirming(false)}>
                Keep editing
              </Button>
            </div>
          </div>
        </>
      )}
    </>
  );
}

export function Modal({ open, title, children, onClose }: { open: boolean; title: string; children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <>
      <div className="overlay" style={{ zIndex: 55 }} onClick={onClose} />
      <div className="modal" role="dialog" aria-modal="true">
        <h3 className="mb">{title}</h3>
        {children}
      </div>
    </>
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
      <button type="button" id={id} className="input" style={{ textAlign: "left", cursor: "pointer" }} onClick={() => setOpen(true)}>
        {value.name} / {value.code}
        <span className="muted"> · {value.designation} · {value.department}</span>
      </button>
    );
  return (
    <div style={{ position: "relative" }}>
      <input id={id} className="input" autoFocus={open} placeholder={placeholder} value={q} onFocus={() => setOpen(true)} onChange={(e) => setQ(e.target.value)} onBlur={() => setTimeout(() => setOpen(false), 200)} />
      {open && results.length > 0 && (
        <div className="card" style={{ position: "absolute", zIndex: 30, left: 0, right: 0, top: "100%", padding: 6, maxHeight: 280, overflowY: "auto" }}>
          {results
            .filter((p) => !exclude.includes(p.id))
            .map((p) => (
              <button
                type="button"
                key={p.id}
                className="link-btn"
                style={{ display: "block", width: "100%", padding: "8px 10px", color: "var(--ink)", fontWeight: 400 }}
                onMouseDown={() => {
                  onChange(p);
                  setOpen(false);
                  setQ("");
                }}
              >
                <b>{p.name}</b> / {p.code} <span className="muted">· {p.designation} · {p.department}</span>
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
  el.className = `toast ${error ? "err" : ""}`;
  el.textContent = message;
  el.style.display = "block";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    if (el) el.style.display = "none";
  }, 3500);
}

export function FormError({ error }: { error: ApiError | null | undefined }) {
  if (!error) return null;
  return (
    <div className="form-error" role="alert">
      {error.message}
      {error.status === 409 && " Your draft is kept; refresh to compare the latest version."}
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

/** Decision with a required reason (validate / reject / approve / return). Opens a small modal. */
export function DecisionButton({
  label,
  decision,
  onDecide,
  variant = "secondary",
  reasonRequired = true,
  size,
  title,
  busy,
}: {
  label: string;
  decision: string;
  onDecide: (decision: string, reason: string) => void;
  variant?: "primary" | "secondary" | "green" | "danger";
  reasonRequired?: boolean;
  size?: "sm";
  title?: string;
  busy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <>
      <Button variant={variant} size={size} disabled={busy} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Modal open={open} title={title ?? label} onClose={() => setOpen(false)}>
        <Field label="Reason" required={reasonRequired}>
          <textarea className="input" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <p className="small muted">The decision, your identity, the time and this reason enter the audit history.</p>
        <div className="row between mt">
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
