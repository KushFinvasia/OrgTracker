/* Shared UI kit for the prototype: formatting, badges, people, persona scope, drawers and toasts. Mirrors components/ui in the app. */
EMP.HOS = { name: "Head of Sales", desig: "Informed", dept: "Sales" };

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fd = (iso, year = true) => { if (!iso) return "—"; const [y, m, d] = iso.split("-"); return `${d} ${MONTHS[+m - 1]}${year ? " " + y : ""}`; };
const inr = (n) => "₹" + Math.round(n).toLocaleString("en-IN");
const crore = (n) => "₹" + (n / 1e7).toFixed(2) + " crore";
const fmt2 = (n) => (Math.round(n * 100) / 100).toFixed(2);
const pct = (n) => n == null ? `<span class="unavail">Unavailable</span>` : Math.round(n) + "%";
const fac = (f) => f === 1 ? "1.0" : String(f);
const initials = (n) => n.replace(/[()]/g, "").split(/\s+/).filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
const pname = (id) => !id ? "—" : id.startsWith("@") ? id.slice(1) : EMP[id]?.name ?? id;
const icon = (d, cls = "ico") => `<svg class="${cls}" viewBox="0 0 24 24">${d.split("|").map((x) => `<path d="${x}"/>`).join("")}</svg>`;
const I = {
  home: "M3 10.5 12 3l9 7.5V21H3z|M9 21v-6h6v6", folder: "M3 6h7l2 2h9v11H3z", check: "M5 5h14v14H5z|m8 12 3 3 5-6", award: "M12 3a6 6 0 1 1 0 12a6 6 0 0 1 0-12z|m8.5 14-1.5 7 5-3 5 3-1.5-7",
  flow: "M4 6h16M4 12h16M4 18h10", gear: "M12 9a3 3 0 1 1 0 6a3 3 0 0 1 0-6z|M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2", doc: "M6 3h9l4 4v14H6z|M9 12h6M9 16h6",
  warn: "M12 3 2 21h20z|M12 10v5M12 18v.5", ok: "m5 12 5 5 9-10", plus: "M12 5v14M5 12h14", search: "M11 4a7 7 0 1 1 0 14a7 7 0 0 1 0-14z|m20 20-4-4", bell: "M6 16V11a6 6 0 0 1 12 0v5l2 2H4z|M10 21h4",
  flag: "M5 21V4|M5 4h11l-2 4 2 4H5", down: "M12 3v12M7 10l5 5 5-5M4 21h16", upload: "M12 21V9M7 14l5-5 5 5M4 3h16", x: "M6 6l12 12M18 6 6 18",
};

/* status words → badge tone (words plus a tint, never colour alone) */
const TONE = { "Not Started": "", "In Progress": "info", Blocked: "bad", Block: "bad", Delayed: "bad", "In Development": "info", "Unit testing": "info", "Testing QA": "info", "Internal CUG": "info",
  Product: "warn", Vendor: "warn", "Exotel Vendor": "warn", "Ready For Live": "brandt", Production: "brandt", "Live Today": "brandt", Live: "brandt", "In Review": "warn", Rework: "warn", Completed: "ok", "On Hold": "", Cancelled: "", Planning: "", "On Track": "ok", "At Risk": "warn", "Off Track": "bad",
  High: "bad", Medium: "warn", Low: "", Critical: "bad", Open: "warn", Mitigating: "info", Closed: "ok", Pending: "warn", Validated: "ok", Rejected: "bad", Returned: "bad", Submitted: "info", Accepted: "ok", Draft: "",
  Approved: "ok", "On time": "ok", Late: "bad", Overdue: "bad", "Due soon": "warn", "No deadline": "", "Not eligible": "", Locked: "ok", "Under analysis": "info", "Correction done": "info", "Preventive action in progress": "info", Reopened: "bad",
  Planned: "", "In progress": "info", "Panel approved": "brandt", "Panel review": "info", Published: "ok", "Awaiting Finance": "warn", "Charter draft": "warn", "In delivery": "info", "Collecting inputs": "info", Logged: "info", Challenged: "warn", Major: "bad", Minor: "" };
const LABEL = { "Not Started": "Not started", "In Progress": "In progress", "In Review": "In review", "On Hold": "On hold", "In Development": "In development", "Exotel Vendor": "Exotel vendor", "Ready For Live": "Ready for live", "Live Today": "Live today", "On Track": "On track", "At Risk": "At risk", "Off Track": "Off track" };
const badge = (s, extra = "") => s ? `<span class="badge ${TONE[s] === "brandt" ? "" : TONE[s] ?? ""}" ${TONE[s] === "brandt" ? 'style="background:var(--brand-tint);color:var(--brand-ink)"' : ""}>${esc(LABEL[s] ?? s)}${extra}</span>` : "";
// Task status picker: the tracker's statuses in its order. Completed is listed but only the reviewer's Accept sets it.
const statusOptions = (cur) => DELIVERY.TASK_STATUSES.map((s) => s === "Completed" ? `<option disabled title="Only the reviewer's Accept sets Completed">Completed (on Accept)</option>` : `<option value="${esc(s)}" ${s === cur ? "selected" : ""}>${esc(LABEL[s] ?? s)}</option>`).join("");
const tierCls = (b) => ({ Platinum: "platinum", Gold: "gold", Silver: "silver", Bronze: "bronze", Review: "review" })[b] || "none";
const tier = (b) => b ? `<span class="tier ${tierCls(b)}">${b}</span>` : `<span class="tier none">Not scored</span>`;
const avatar = (id, cls = "sm") => `<span class="avatar ${cls}">${initials(pname(id))}</span>`;
const chip = (id, sub = true) => !id ? `<span class="muted">Unassigned</span>` : id.startsWith("@") ? `<span class="badge outline">${esc(id.slice(1))}</span>`
  : `<span class="person-cell">${avatar(id)}<span><b>${esc(pname(id))}</b>${sub && EMP[id] ? `<span class="sub">${esc(EMP[id].ill ? "Illustrative" : id)} · ${esc(EMP[id].desig)}</span>` : ""}</span></span>`;
const fig = (lbl, val, hint = "") => `<div class="figure"><div class="lbl">${lbl}</div><div class="val">${val}</div>${hint ? `<div class="hint">${hint}</div>` : ""}</div>`;
const figures = (items) => `<div class="figures" style="--n:${items.length}">${items.join("")}</div>`;
const panel = (title, body, { meta = "", tools = "", foot = "", pad = true } = {}) => `<section class="panel"><div class="panel-h"><h2>${title}</h2>${meta ? `<span class="meta">${meta}</span>` : ""}${tools ? `<span class="tools">${tools}</span>` : ""}</div>${pad ? `<div class="panel-b">${body}</div>` : body}${foot ? `<div class="panel-f">${foot}</div>` : ""}</section>`;
const table = (heads, rows, empty = "Nothing here yet") => `<div class="tbl-wrap"><table class="tbl"><thead><tr>${heads.map((h) => `<th${h.startsWith("#") ? ' class="n"' : ""}>${h.replace(/^#/, "")}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.join("") : `<tr><td colspan="${heads.length}"><div class="empty"><h3>${empty}</h3></div></td></tr>`}</tbody></table></div>`;
const callout = (tone, title, body = "", actions = "") => `<div class="callout ${tone} mb">${icon(tone === "ok" ? I.ok : tone === "neutral" ? "M12 3a9 9 0 1 1 0 18a9 9 0 0 1 0-18z|M12 11v6M12 7.5v.5" : I.warn)}<span><b>${title}</b>${body ? " " + body : ""}</span>${actions ? `<span class="c-actions">${actions}</span>` : ""}</div>`;
const tabs = (list, active, hrefFn) => `<div class="tabs" role="tablist">${list.map(([id, label]) => `<button role="tab" ${id === active ? 'aria-selected="true"' : ""} data-go="${hrefFn(id)}">${label}</button>`).join("")}</div>`;
const empty = (title, body = "", action = "") => `<div class="empty"><h3>${title}</h3>${body ? `<p>${body}</p>` : ""}${action}</div>`;
const btn = (label, act, { primary = false, sm = false, disabled = false, title = "", danger = false } = {}) => `<button class="btn${primary ? " primary" : ""}${sm ? " sm" : ""}${danger ? " danger" : ""}" data-act="${act}" ${disabled ? "disabled" : ""} ${title ? `title="${esc(title)}"` : ""}>${label}</button>`;
const minibar = (v) => `<span class="pct-cell">${v}%<span class="minibar"><i class="${v < 40 ? "low" : ""}" style="width:${v}%"></i></span></span>`;
const personOptions = (selected, exclude = [], filter = null) => `<option value="">Choose a person…</option>` + Object.entries(EMP).filter(([id, e]) => !exclude.includes(id) && !e.missing && id !== "HOS" && (!filter || filter(id, e)))
  .map(([id, e]) => `<option value="${id}" ${id === selected ? "selected" : ""}>${esc(e.name)} · ${esc(e.ill ? "illustrative" : id)} · ${esc(e.desig)} · ${esc(e.dept)}</option>`).join("");

/* persona and scope (services/scope.py in spirit: the server decides, the UI only reflects it) */
const me = () => S.personas.find((p) => p.id === S.persona);
const meEmp = () => me().emp;
const has = (fn) => me().fns.includes(fn);
const isAdmin = () => S.persona === "admin";
const seesMoney = () => isAdmin() || has("R&R Panel member");
const reportingTree = (root) => { const out = new Set(); let frontier = [root]; while (frontier.length) { const next = []; for (const id of Object.keys(EMP)) if (frontier.includes(EMP[id].manager)) { out.add(id); next.push(id); } frontier = next; } return out; };
const perfPeople = () => { // private R&R individual scores: Admin all, HOD own departments, Manager reporting tree, Team Lead none
  if (isAdmin()) return null;
  if (S.persona === "tl") return new Set();
  if (S.persona === "hod") return new Set(Object.keys(EMP).filter((id) => me().depts.includes(EMP[id].dept)));
  return reportingTree(meEmp());
};
const canSeePerf = (id) => { const p = perfPeople(); return p === null || p.has(id); };
const workPeople = () => { const p = perfPeople(); if (p === null) return null; const s = new Set(p); s.add(meEmp()); if (S.persona === "tl") s.add("EMP-0221"); return s; };
const visibleProjects = () => {
  if (isAdmin()) return S.projects;
  const people = workPeople();
  return S.projects.filter((p) => p.owner === meEmp() || p.reviewer === meEmp() || (S.persona === "hod" && me().depts.includes(p.dept))
    || S.tasks.some((t) => t.project === p.code && t.assignments.some((a) => people.has(a.emp)))
    || (S.persona === "manager" && p.rr?.raci?.some((r) => people.has(r.emp))));
};
const canManageProject = (p) => isAdmin() || p.owner === meEmp() || (S.persona === "hod" && me().depts.includes(p.dept));
const canUpdateTask = (t) => { if (isAdmin()) return true; const people = workPeople(); return t.assignments.some((a) => people.has(a.emp)); };
const isReviewerOf = (t) => t.reviewer === meEmp();

/* toasts */
let TOAST = null, TOAST_T = null;
function toast(msg, bad = false) { TOAST = { msg, bad }; renderLayer(); clearTimeout(TOAST_T); TOAST_T = setTimeout(() => { TOAST = null; renderLayer(); }, 2800); }
function audit(action, record, reason = "") { S.audit.unshift({ at: TODAY + " " + new Date().toTimeString().slice(0, 5), by: meEmp(), action, record, reason }); }

/* drawers: registry of builders, one open at a time, draft kept until saved, unsaved-draft guard on close */
const DRAWERS = {};
let DRAWER = null;
function openDrawer(kind, arg, form = {}) { DRAWER = { kind, arg, form, dirty: false, errors: [], tab: null }; renderLayer(); setTimeout(() => document.querySelector(".drawer [data-autofocus], .drawer input, .drawer select, .drawer textarea")?.focus(), 30); }
function closeDrawer(force = false) {
  if (!force && DRAWER?.dirty && !confirm("Discard your unsaved changes?")) return;
  DRAWER = null; renderLayer();
  // Drop a ?task= deep link once its drawer closes, so the URL matches the screen and a reload doesn't reopen it
  const [h, qs] = (location.hash || "").split("?"), q = new URLSearchParams(qs || "");
  if (q.has("task")) { q.delete("task"); q.delete("mode"); history.replaceState(null, "", h + (q.toString() ? "?" + q : "")); }
}
function fieldErr(name) { const e = DRAWER?.errors?.find((x) => x.field === name); return e ? `<div class="field-err">${esc(e.msg)}</div>` : ""; }
function field(label, name, control, { req = false, help = "", full = false } = {}) {
  const e = DRAWER?.errors?.find((x) => x.field === name);
  return `<div class="field${full ? " full" : ""}${e ? " invalid" : ""}" data-field="${name}"><label>${label}${req ? '<span class="req">*</span>' : ""}</label>${control}${help ? `<span class="help">${help}</span>` : ""}${fieldErr(name)}</div>`;
}
const fv = (k, d = "") => DRAWER?.form?.[k] ?? d;
const inp = (k, attrs = "") => `<input class="input" data-f="${k}" value="${esc(fv(k))}" ${attrs}>`;
const txt = (k, ph = "") => `<textarea class="input" data-f="${k}" placeholder="${esc(ph)}">${esc(fv(k))}</textarea>`;
const sel = (k, opts, ph = "Choose…") => `<select class="input" data-f="${k}"><option value="">${ph}</option>${opts.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}" ${String(fv(k)) === String(v) ? "selected" : ""}>${esc(l)}</option>`; }).join("")}</select>`;
function showErrors(errs) { DRAWER.errors = errs; renderLayer(); const first = document.querySelector(`.drawer [data-field="${errs[0]?.field}"] input, .drawer [data-field="${errs[0]?.field}"] select, .drawer [data-field="${errs[0]?.field}"] textarea`); first?.focus(); }

function renderLayer() {
  let html = "";
  if (DRAWER && DRAWERS[DRAWER.kind]) {
    const d = DRAWERS[DRAWER.kind](DRAWER.arg, DRAWER.form);
    html += `<div class="scrim" data-act="closeDrawer"></div><aside class="drawer${d.wide ? " wide" : ""}"${d.width ? ` style="width:min(${d.width}px,100vw)"` : ""} role="dialog" aria-modal="true" aria-label="${esc(d.title)}">
      <div class="drawer-head"><div class="grow">${d.eyebrow ? `<div class="eyebrow">${esc(d.eyebrow)}</div>` : ""}<h2>${esc(d.title)}</h2>${d.sub ? `<div class="sub">${d.sub}</div>` : ""}</div><button class="icon-btn" data-act="closeDrawer" aria-label="Close">${icon(I.x)}</button></div>
      ${DRAWER.errors.length ? `<div class="form-error" style="margin:14px 22px 0">${icon(I.warn)}<span>${DRAWER.errors.length} thing${DRAWER.errors.length > 1 ? "s" : ""} to fix. Your draft is kept.</span></div>` : ""}
      <div class="drawer-body">${d.body}</div>${d.foot ? `<div class="drawer-foot">${d.foot}</div>` : ""}</aside>`;
  }
  if (PALETTE) html += renderPalette();
  if (BELL) html += `<div class="scrim" data-act="closeBell" style="background:transparent"></div><div class="pop" style="position:fixed;top:52px;right:24px;width:340px">${S.notifications.map((n) => `<div class="pi"><span class="grow">${esc(n.t)}</span><span class="muted small">${n.at}</span></div>`).join("")}</div>`;
  if (TOAST) html += `<div class="toast${TOAST.bad ? " bad" : ""}" role="status">${esc(TOAST.msg)}</div>`;
  $("#layer").innerHTML = html;
}

/* Ctrl K search: pages, projects, tasks and people within scope */
let PALETTE = null, BELL = false;
function renderPalette() {
  const q = PALETTE.q.toLowerCase(), people = workPeople();
  const items = [
    ...[["Home", "#/home"], ["Projects", "#/projects"], ["Tasks", "#/tasks"], ["Recognition", "#/recognition"], ...(isAdmin() ? [["Administration", "#/admin"], ["Workflows & data", "#/workflows"], ["Project R&R policy", "#/policy"]] : [])].map(([l, h]) => ({ g: "Pages", l, h })),
    ...visibleProjects().map((p) => ({ g: "Projects", l: `${p.code} · ${p.title}`, h: `#/projects/${p.code}/overview` })),
    ...S.tasks.filter((t) => visibleProjects().some((p) => p.code === t.project)).map((t) => ({ g: "Tasks", l: `${t.code} · ${t.title}`, task: t.code })),
    ...Object.keys(EMP).filter((id) => !EMP[id].missing && id !== "HOS" && (people === null || people.has(id))).map((id) => ({ g: "People", l: `${EMP[id].name} · ${EMP[id].ill ? "illustrative" : id} · ${EMP[id].dept}`, h: `#/people/${id}/overview` })),
  ].filter((i) => !q || i.l.toLowerCase().includes(q)).slice(0, 12);
  let g = "";
  return `<div class="scrim" data-act="closePalette"></div><div class="pop" role="dialog" aria-label="Search" style="position:fixed;top:80px;left:50%;transform:translateX(-50%);width:min(560px,92vw);padding:8px">
    <input class="input" id="palette-q" placeholder="Search pages, projects, tasks and people" value="${esc(PALETTE.q)}" autocomplete="off">
    <div style="max-height:380px;overflow:auto;margin-top:6px">${items.map((i) => `${i.g !== g ? `<div class="nav-label" style="color:var(--muted);padding:8px 10px 2px">${(g = i.g)}</div>` : ""}<button class="pi" data-act="${i.task ? "openTask:" + i.task : "go:" + i.h}">${esc(i.l)}</button>`).join("") || `<div class="empty"><h3>No matches</h3><p>Only records in your scope are searched.</p></div>`}</div></div>`;
}
