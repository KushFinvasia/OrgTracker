/* Shell, router, actions and self-test for the Project Tier prototype. */
let S = seedData();
let Q = new URLSearchParams();

/* ------------------------------------------------------------------ shell ------------------------------------------------------------------ */
function crumbs(parts) { $("#crumbs").innerHTML = [["Project Tier", "#/home"], ...parts].map(([l, h], i, a) => i === a.length - 1 ? `<b>${esc(l)}</b>` : `<a href="${h || "javascript:void 0"}">${esc(l)}</a><span>›</span>`).join(""); }
function renderNav(route) {
  const nav = [{ group: "Delivery", items: [["#/home", "Home", I.home, inboxItems().length], ["#/projects", "Projects", I.folder], ["#/tasks", "Tasks", I.check], ["#/recognition", "Recognition", I.award, rrQueue().length]] },
    ...(isAdmin() ? [{ group: "Control centre", items: [["#/workflows", "Workflows & data", I.flow], ["#/admin", "Administration", I.gear], ["#/policy", "Project R&R policy", I.doc]] }] : []),
    { group: "Pinned", items: visibleProjects().filter((p) => p.status === "In Progress").slice(0, 3).map((p) => [`#/projects/${p.code}/overview`, p.title, "", 0, true]) }];
  $("#nav").innerHTML = nav.map((g) => `<div class="nav-group"><div class="nav-label">${g.group}</div>${g.items.map(([href, label, d, count, pin]) => {
    const active = pin ? route.startsWith(href.replace("/overview", "")) : route === href || route.startsWith(href + "/") || route.startsWith(href + "?");
    return `<a href="${href}" class="${active ? "active" : ""}${pin ? " pin" : ""}">${d ? icon(d, "") : ""}${esc(label)}${count ? `<span class="count">${count}</span>` : ""}</a>`; }).join("")}</div>`).join("");
  $("#persona").innerHTML = S.personas.map((p) => `<option value="${p.id}" ${p.id === S.persona ? "selected" : ""}>${esc(EMP[p.emp].name)} · ${esc(p.label)}</option>`).join("");
  $("#me").innerHTML = `${avatar(meEmp(), "")}<span class="who"><b>${esc(EMP[meEmp()].name)}</b><span>${esc(me().label)}${me().fns.length ? ` · ${me().fns.length} R&amp;R function${me().fns.length > 1 ? "s" : ""}` : ""}</span></span>`;
}
let DEEP_LINK = null; // the ?task= link already opened, so re-renders don't open it again
// Renders the route in the URL. The self-test passes a route to check screens without navigating (browsers throttle rapid URL changes).
function render(hash = location.hash) {
  const raw = (hash || "#/home").slice(1), [path, qs] = raw.split("?");
  Q = new URLSearchParams(qs || "");
  if (Q.get("as") && S.personas.some((p) => p.id === Q.get("as"))) S.persona = Q.get("as"); // ?as=manager etc. for shareable links
  const parts = path.split("/").filter(Boolean), route = "#/" + parts.join("/");
  renderNav(route);
  let html;
  switch (parts[0]) {
    case "projects": html = parts[1] ? viewProject(parts[1], parts[2] || "overview") : viewPortfolio(); break;
    case "tasks": html = viewTasks(parts[1] || "team"); break;
    case "people": html = viewPerson(parts[1], parts[2] || "overview"); break;
    case "recognition": html = viewRecognition(); break;
    case "admin": html = isAdmin() ? viewAdmin(parts[1] || "access") : denied(); break;
    case "workflows": html = isAdmin() ? viewWorkflows(parts[1] || "templates") : denied(); break;
    case "policy": html = isAdmin() ? viewPolicy() : denied(); break;
    default: html = viewHome();
  }
  $("#view").innerHTML = html;
  $("#bell-count").textContent = S.notifications.length;
  // Deep links: ?task=CODE opens a task; &mode=submit|rework|blocker|date|assign expands a section.
  // A link opens the drawer once. Every click re-renders, so without this check a closed drawer kept reopening.
  const deep = Q.get("task") ? `${path}?task=${Q.get("task")}&mode=${Q.get("mode") || ""}` : null;
  if (deep && deep !== DEEP_LINK && task(Q.get("task")) && !DRAWER) { openTask(Q.get("task")); if (Q.get("mode")) { DRAWER.form.mode = Q.get("mode"); renderLayer(); } }
  DEEP_LINK = deep;
}
const denied = () => { crumbs([["Not available"]]); return panel("Not available", empty("You don't have access to this page", "Navigation hides pages you can't use. Direct links go to a safe page without showing details.", `<a class="btn" href="#/home">Go to Home</a>`)); };
const go = (h) => { if (location.hash === h) render(); else location.hash = h; };

/* ------------------------------------------------------------------ actions ------------------------------------------------------------------ */
const nextCode = (prefix, list, key = "code") => { let n = 1; while (list.some((x) => x[key] === `${prefix}${String(n).padStart(2, "0")}`)) n++; return `${prefix}${String(n).padStart(2, "0")}`; };
const need = (f, keys) => keys.filter(([k]) => !String(f[k] ?? "").trim()).map(([k, msg]) => ({ field: k, msg }));
const addEvent = (t, text) => t.events.push({ at: TODAY, by: meEmp(), text });

function openTask(code) {
  const t = task(code);
  if (!t || !visibleProjects().some((p) => p.code === t.project)) return toast("This task isn't available to you", true);
  openDrawer("t", code, { mode: null, status: t.status, progress: t.progress, nextAction: t.nextAction, start: t.start || "", goLive: t.goLive || "", rows: t.assignments.map((a) => ({ ...a })), reviewer: t.reviewer, subDate: TODAY, files: t.files.map((f) => f.name), failed: [] });
}
const ACTIONS = {
  go: (h) => { closeDrawer(true); PALETTE = null; go(h); },
  toast: (...m) => toast(m.join(":")),
  closeDrawer: () => closeDrawer(), closePalette: () => { PALETTE = null; renderLayer(); }, closeBell: () => { BELL = false; renderLayer(); },
  openPalette: () => { PALETTE = { q: "" }; renderLayer(); setTimeout(() => $("#palette-q")?.focus(), 10); }, openBell: () => { BELL = !BELL; renderLayer(); },
  openTask: (code) => { PALETTE = null; openTask(code); },
  personTasks: (project, emp) => {
    if (!visibleProjects().some((p) => p.code === project) || !EMP[emp]) return toast("This project isn't available to you", true);
    openDrawer("personTasks", project, { emp });
  },
  // Task drawer: open or close one inline section (submit, rework, blocker, date, assign)
  tmode: (m) => { const t = task(DRAWER.arg); DRAWER.form.mode = DRAWER.form.mode === m ? null : m; DRAWER.errors = []; if (m === "assign") Object.assign(DRAWER.form, { rows: t.assignments.map((x) => ({ ...x })), reviewer: t.reviewer, reason: "" }); renderLayer(); },
  drawer: (kind, a, b) => {
    const forms = {
      project: () => ({}),
      editProject: () => { const p = proj(a); return { priority: p.priority || "", status: p.status, target: p.target, reviewer: p.reviewer || "", objective: p.objective }; },
      request: () => ({ template: "Email campaign", to: "Digital Marketing", from: EMP[meEmp()].dept, priority: "Medium" }),
      task: () => ({ project: a && proj(a)?.rr?.mode !== "programme" ? a : "", rows: [{ role: "Owner", emp: "", share: 100 }], complexity: "3", start: TODAY, _status: b }),
      risk: () => { const r = b != null ? proj(a).risks[+b] : null; return r ? { ...r } : { state: "Open" }; },
      delay: () => (b ? { task: b } : { stage: 3, start: "2026-10-14", due: "2026-10-15" }), dispute: () => ({}), baseline: () => ({}),
    };
    openDrawer(kind, b != null ? `${a}|${b}` : a, (forms[kind] || (() => ({})))());
  },
  rowAdd: () => { DRAWER.form.rows = [...DRAWER.form.rows, { role: "Contributor", emp: "", share: 0 }]; DRAWER.dirty = true; renderLayer(); },
  rowDel: (i) => { DRAWER.form.rows = DRAWER.form.rows.filter((_, k) => k !== +i); renderLayer(); },

  /* projects */
  saveProject: () => {
    const f = DRAWER.form, errs = need(f, [["title", "Enter a project name."], ["priority", "Choose a priority. There is no default."], ["dept", "Choose a department."], ["owner", "Choose a named owner."], ["start", "Enter a start date."], ["objective", "State the objective."]]);
    if (f.reviewer && f.reviewer === f.owner) errs.push({ field: "reviewer", msg: "The reviewer can't be the owner." });
    if (f.start && f.target && f.target < f.start) errs.push({ field: "target", msg: "The target date is before the start date." });
    if (errs.length) return showErrors(errs);
    const code = nextCode("PRJ-N", S.projects);
    S.projects.unshift({ code, title: f.title, dept: f.dept, priority: f.priority, status: "Planning", owner: f.owner, reviewer: f.reviewer || null, start: f.start, target: f.target || null, objective: f.objective, template: f.template || null, risks: f.template === "Email campaign" ? JSON.parse(JSON.stringify(proj("PRJ-015").risks)).slice(0, 0) : [], incidents: [], closure: { state: "Draft", notes: {} }, archived: false,
      rr: f.rr ? { charter: "Draft", mode: "closure", type: "Standard", champion: f.owner, stage: "Charter draft", delays: [], fixed: { score: null, tasks: "0 of 0", delays: "0", gates: "No locked baseline", pool: null } } : null });
    audit("create_project", code, f.priority + " priority"); closeDrawer(true); toast(`${code} created in Planning. Add task is in the project header.`); go(`#/projects/${code}/overview`);
  },
  saveEditProject: (code) => {
    const f = DRAWER.form, p = proj(code), errs = need(f, [["priority", "Choose a priority."], ["status", "Choose a status."]]);
    if (f.reviewer && f.reviewer === p.owner) errs.push({ field: "reviewer", msg: "The reviewer can't be the owner." });
    if (errs.length) return showErrors(errs);
    Object.assign(p, { priority: f.priority, status: f.status, target: f.target, reviewer: f.reviewer || null, objective: f.objective });
    audit("update_project", code, "Project updated"); closeDrawer(true); toast("Project updated"); render();
  },
  saveRequest: () => {
    const f = DRAWER.form, errs = need(f, [["title", "Enter a title."], ["from", "Choose the requesting department."], ["audience", "Describe the audience."], ["required", "Enter the required date."], ["priority", "Choose a priority."], ["validator", "Choose your manager as validator."], ["objective", "State the objective."], ["brief", "Add the brief."]]);
    if (f.validator === meEmp()) errs.push({ field: "validator", msg: "You can't validate your own request." });
    if (errs.length) return showErrors(errs);
    S.requests.push({ id: nextCode("REQ-", S.requests, "id"), title: f.title, template: f.template, from: f.from, to: f.to, required: f.required, priority: f.priority, requester: meEmp(), validator: f.validator, state: "Submitted", audience: f.audience, objective: f.objective, brief: f.brief });
    closeDrawer(true); toast("Request submitted to your manager for validation"); render();
  },
  req: (id, decision) => {
    const r = S.requests.find((x) => x.id === id);
    if (decision === "return") { const why = prompt("Reason for returning the request"); if (!why) return; r.state = "Returned"; audit("return_request", id, why); toast("Request returned with a reason"); }
    else if (decision === "validate") { if (r.requester === meEmp()) return toast("You can't validate your own request", true); if (r.validator !== meEmp()) return toast(`Only ${pname(r.validator)} can validate this request`, true); r.state = "Validated"; audit("validate_request", id); toast("Validated. The receiving POC accepts it into the calendar next."); }
    else { const d05 = proj("PRJ-D05"), rid = "R" + (d05.rr.runs.length + 1); d05.rr.runs.push({ id: rid, title: r.title, req: r.from, started: TODAY, done: [0, 0, 0, 0, 0, 0], late: [], delivered: null, maxDue: addBdays(TODAY, 14) }); r.state = "Accepted"; r.run = rid; audit("accept_request", id, "Run " + rid); toast(`Accepted into the calendar as run ${rid} of PRJ-D05`); }
    render();
  },
  closure: (code, what) => {
    const p = proj(code), c = p.closure; c.history = c.history || [];
    if (what === "submit") { c.state = "Submitted"; c.submittedBy = meEmp(); c.history.push({ at: TODAY, text: `Submitted by ${pname(meEmp())}` }); audit("submit_closure", code); toast("Closure submitted for approval"); }
    else if (!canDecideClosure(p)) { return toast("Only the decision owner can decide this closure", true); }
    else if (what === "approve") { c.state = "Approved"; p.status = "Completed"; c.history.push({ at: TODAY, text: `Approved by ${pname(meEmp())}` }); audit("approve_closure", code); toast("Closure approved. Project completed."); }
    else { const why = prompt("Comment for the team (required)"); if (!why) return; c.state = "Returned"; c.history.push({ at: TODAY, text: `Returned: ${why}` }); audit("return_closure", code, why); toast("Returned with comment. The project stays open."); }
    render();
  },
  saveRisk: (code, idx) => {
    const f = DRAWER.form, errs = need(f, [["risk", "Describe the risk."], ["stage", "Enter the stage."], ["crit", "Choose a criticality."], ["owner", "Choose an owner."], ["next", "Set the next review date."], ["mitigation", "Describe the mitigation."]]);
    if (errs.length) return showErrors(errs);
    const p = proj(code), r = { code: idx !== "" ? p.risks[+idx].code : nextCode("RSK-P", p.risks), risk: f.risk, stage: f.stage, crit: f.crit, owner: f.owner, next: f.next, state: f.state, deps: f.deps, assumptions: f.assumptions, mitigation: f.mitigation };
    if (idx !== "") p.risks[+idx] = r; else p.risks.push(r);
    closeDrawer(true); toast("Risk saved"); render();
  },
  /* tasks */
  saveTask: () => {
    const f = DRAWER.form, d = { title: f.title, project: f.project, description: f.description, rows: f.rows, reviewer: f.reviewer, start: f.start, due: f.due, goLive: f.goLive };
    const errs = DELIVERY.validateTask(d); if (errs.length) return showErrors(errs);
    const n = S.tasks.filter((t) => t.project === f.project).length + 1, code = `${f.project}-T${String(n).padStart(2, "0")}`;
    const t = { code, project: f.project, title: f.title, desc: f.description, complexity: +f.complexity, start: f.start || null, due: f.due || null, dueOriginal: f.due || null, status: "Not Started", progress: 0, nextAction: "", reviewer: f.reviewer,
      checklist: (f.checklist || "").split("\n").map((x) => x.trim()).filter(Boolean), evidenceReq: f.evidenceReq || "", assignments: f.rows.map((r) => ({ emp: r.emp, role: r.role, share: +r.share })), files: [], submissions: [], decisions: [], blockers: [], dateChanges: [], comments: [], events: [{ at: TODAY, by: meEmp(), text: "Created (Not started)" }], acceptedOn: null, version: 1 };
    t.goLive = f.goLive || null;
    S.tasks.push(t);
    audit("create_task", code); closeDrawer(true); toast(`${code} created (Not started)`); render();
  },
  taskSave: (code) => {
    const f = DRAWER.form, t = task(code), p = Number(f.progress);
    if (!(p >= 0 && p <= 100)) return showErrors([{ field: "progress", msg: "Progress is 0 to 100." }]);
    const changes = [];
    if (!["In Review", "Completed", "Rework"].includes(t.status) && DELIVERY.MANUAL_STATUSES.includes(f.status) && f.status !== t.status) { changes.push(`Status: ${LABEL[f.status] ?? f.status}`); t.status = f.status; }
    if (p !== t.progress) { changes.push(`Progress ${p}%`); t.progress = p; }
    if (f.nextAction !== t.nextAction) { changes.push("Next action updated"); t.nextAction = f.nextAction; }
    if (changes.length) { addEvent(t, changes.join(" · ")); t.version++; audit("update_task", code, changes.join(", ")); }
    DRAWER.dirty = false; toast(changes.length ? "Task updated" : "Nothing changed"); render(); renderLayer();
  },
  taskDatesSave: (code) => {
    const t = task(code), f = DRAWER.form;
    if (!canUpdateTask(t) || S.persona === "tl" || ["Completed", "Cancelled"].includes(t.status)) return toast("These dates are read-only", true);
    const errs = DELIVERY.validateDates({ start: f.start, due: t.due, goLive: f.goLive });
    if (errs.length) return showErrors(errs);
    const old = { start: t.start || null, goLive: t.goLive || null }, next = { start: f.start || null, goLive: f.goLive || null };
    if (JSON.stringify(old) !== JSON.stringify(next)) {
      Object.assign(t, next); t.version++;
      const reason = `Start date: ${old.start || "not set"} → ${next.start || "not set"}; go-live: ${old.goLive || "not set"} → ${next.goLive || "not set"}`;
      addEvent(t, reason); audit("update_task_dates", code, reason);
    }
    DRAWER.errors = []; DRAWER.dirty = false; DRAWER.form.mode = null;
    toast("Task dates saved"); render(); renderLayer();
  },
  assignSave: (code) => {
    const f = DRAWER.form, t = task(code), errs = DELIVERY.validateTask({ title: t.title, project: t.project, description: t.desc || "-", rows: f.rows, reviewer: f.reviewer, start: t.start, due: t.due });
    if (!String(f.reason || "").trim()) errs.push({ field: "reason", msg: "Give a reason for the change." });
    if (errs.length) return showErrors(errs);
    t.assignments = f.rows.map((r) => ({ emp: r.emp, role: r.role, share: +r.share })); t.reviewer = f.reviewer; addEvent(t, "Assignments changed: " + f.reason); audit("change_assignments", code, f.reason);
    DRAWER.dirty = false; DRAWER.errors = []; DRAWER.form.mode = null; toast("Assignments saved"); render(); renderLayer();
  },
  upload: (code) => { const t = task(code), name = `evidence-${t.files.length + 1}.pdf`; t.files.push({ name, size: "0.8 MB", at: TODAY }); DRAWER.form.files = [...(DRAWER.form.files || []), name]; toast("Uploaded " + name); renderLayer(); },
  submit: (code) => {
    const f = DRAWER.form, t = task(code), errs = [];
    if (!f.subDate) errs.push({ field: "subDate", msg: "Enter the submission date." }); else if (f.subDate > TODAY) errs.push({ field: "subDate", msg: "Future submission dates are rejected." });
    if (t.evidenceReq && !(f.files || []).length) errs.push({ field: "files", msg: "Include the required evidence before sending." });
    if (t.checklist.length && !f.confirmed) errs.push({ field: "confirmed", msg: "Confirm the acceptance checklist." });
    if (errs.length) return showErrors(errs);
    const v = t.submissions.length + 1; t.submissions.push({ v, date: f.subDate, note: f.note || "", files: f.files || [], by: meEmp() }); t.status = "In Review"; t.progress = 100; t.version++;
    addEvent(t, `Sent for review (v${v})`); audit("send_for_review", code); S.notifications.unshift({ t: `${pname(meEmp())} sent ${code} for review`, at: fd(TODAY, false) });
    DRAWER.dirty = false; DRAWER.errors = []; DRAWER.form.mode = null; toast(`Sent for review as immutable version v${v}`); render(); renderLayer();
  },
  review: (code, decision) => {
    const f = DRAWER.form, t = task(code), s = t.submissions.at(-1);
    if (t.assignments.some((a) => a.emp === meEmp())) return toast("You're an assignee, so you can't review this work", true);
    if (t.reviewer !== meEmp()) return toast(`Only the named reviewer (${pname(t.reviewer)}) can decide`, true);
    if (decision === "accept") {
      t.status = "Completed"; t.acceptedOn = s.date; t.decisions.push({ v: s.v, decision: "accept", at: TODAY, by: meEmp() }); addEvent(t, `Accepted v${s.v}`); audit("accept_work", code);
      DRAWER.dirty = false; closeDrawer(true); toast(`Work accepted. Completion date ${fd(s.date)} (${DELIVERY.timing(t)}).`); render(); return;
    }
    const errs = []; if (!String(f.feedback || "").trim()) errs.push({ field: "feedback", msg: "Feedback is required for rework." });
    if (t.checklist.length && !(f.failed || []).length && !f.reqChanged) errs.push({ field: "failed", msg: "Tick the criterion that failed, or mark the requirement as changed." });
    if (errs.length) return showErrors(errs);
    const reason = f.reqChanged ? "Requirement changed" : (f.failed || []).length ? "Acceptance criterion not met" : "Quality issue";
    t.status = "Rework"; t.decisions.push({ v: s.v, decision: "rework", reason, failed: f.failed || [], feedback: f.feedback, reqChanged: !!f.reqChanged, at: TODAY, by: meEmp() }); addEvent(t, `Sent to rework (v${s.v})`); audit("send_to_rework", code, f.feedback);
    DRAWER.dirty = false; closeDrawer(true); toast("Sent to rework. The due date doesn't move; earlier versions are kept."); render();
  },
  dep: (code, id, state) => {
    const t = task(code), r = [...t.blockers, ...t.dateChanges].find((x) => x.id === id);
    if (r.requester === meEmp()) return toast("You can't validate your own request", true);
    if (r.validator !== meEmp()) return toast(`Only the named validator (${pname(r.validator)}) can decide this`, true);
    if (r.category === "Resource" && state === "Validated" && S.persona !== "hod" && !isAdmin()) return toast("A resource blocker needs HOD validation", true);
    let why = ""; if (state === "Rejected") { why = prompt("Reason for rejecting"); if (!why) return; }
    r.state = state; r.reason = why;
    if (r.to && state === "Validated") { t.due = r.to; addEvent(t, `Due date in force changed to ${fd(r.to)} (validated)`); }
    else addEvent(t, `${r.to ? "Date change" : "Blocker"} ${state.toLowerCase()}`);
    audit(state === "Validated" ? "validate_" + (r.to ? "date_change" : "blocker") : "reject_" + (r.to ? "date_change" : "blocker"), code, why);
    toast(state === "Validated" ? (r.to ? `Validated. Due date in force is now ${fd(r.to)}; the original is kept.` : DELIVERY.BLOCKERS[r.category] ? "Blocker validated: excludable from on-time" : "Recorded: not excludable") : "Rejected with a reason");
    render(); if (DRAWER) renderLayer();
  },
  depSave: (code) => {
    const f = DRAWER.form, t = task(code), kind = f.mode === "date" ? "date" : "blocker";
    const errs = need(f, [["cat", "Choose a category."], ["desc", "Describe it."], ["evidence", "Add evidence."], ["validator", "Choose a validator."], ...(kind === "blocker" ? [["since", "Enter the blocked-since date."]] : [["newDate", "Enter the requested date."]])]);
    if (f.validator === meEmp()) errs.push({ field: "validator", msg: "You can't validate your own request." });
    if (f.since && f.since > TODAY) errs.push({ field: "since", msg: "Future dates are rejected." });
    if (errs.length) return showErrors(errs);
    if (kind === "blocker") { t.blockers.push({ id: "BLK-" + (40 + t.blockers.length), category: f.cat, desc: f.desc, since: f.since, evidence: f.evidence, requester: meEmp(), validator: f.validator, state: "Pending" }); if (!["In Review", "Completed", "Rework"].includes(t.status)) t.status = "Block"; addEvent(t, "Blocker reported: " + f.cat); }
    else { t.dateChanges.push({ id: "DCR-" + (40 + t.dateChanges.length), from: t.due, to: f.newDate, reason: f.cat, comment: f.desc, evidence: f.evidence, requester: meEmp(), validator: f.validator, state: "Pending" }); addEvent(t, "New date requested: " + fd(f.newDate)); }
    Object.assign(f, { cat: "", desc: "", evidence: "", since: "", newDate: "", mode: null }); DRAWER.dirty = false; DRAWER.errors = [];
    toast("Sent for independent validation. Nothing changes until it is validated."); render(); renderLayer();
  },
  weeklySave: () => {
    let ok = 0, bad = 0;
    for (const [code, e] of Object.entries(WEEKLY)) {
      if (code === "PRJ-015-T08" && !WEEKLY_RESULT[code]?.retried) { WEEKLY_RESULT[code] = { ok: false, msg: "Changed by Sachin Barnwal at 11:02 (v2)" }; bad++; continue; }
      const t = task(code); if (DELIVERY.MANUAL_STATUSES.includes(e.status) && !["In Review", "Rework"].includes(t.status)) t.status = e.status; if (e.progress != null) t.progress = Math.max(0, Math.min(100, +e.progress)); if (e.nextAction != null) t.nextAction = e.nextAction;
      addEvent(t, "Weekly update"); WEEKLY_RESULT[code] = { ok: true }; delete WEEKLY[code]; ok++;
    }
    toast(`${ok} saved${bad ? ` · ${bad} need attention` : ""}`, bad > 0); render();
  },
  weeklyRetry: (code) => { WEEKLY_RESULT[code] = { retried: true }; toast("Latest version loaded: Sachin set progress to 35%. Your change is re-applied on top."); ACTIONS.weeklySave(); },

  /* admin */
  grantAdd: () => { const to = $("#g_to").value, r = $("#g_r").value, e = $("#g_e").value; if (!to || !r || !e) return toast("Recipient, reason and expiry are required", true); S.grants.push({ to, project: $("#g_p").value, permission: $("#g_perm").value, reason: r, expires: e }); audit("grant_access", $("#g_p").value, r); toast("Time-bound grant recorded"); render(); },
  holidayAdd: () => { const n = $("#h_name").value, d = $("#h_day").value; if (!n || !d) return toast("Name and date are required", true); S.holidays.push({ day: d, name: n }); S.holidays.sort((a, b) => a.day.localeCompare(b.day)); toast("Holiday added; SLA dates recalculate"); render(); },
  importNext: () => { IMPORT_STEP = Math.min(4, IMPORT_STEP + 1); render(); }, importBack: () => { IMPORT_STEP = Math.max(0, IMPORT_STEP - 1); render(); }, importReset: () => { IMPORT_STEP = 0; render(); },
  inputDecide: (i, state) => { const x = S.rrInputs[+i]; if (x.by === meEmp()) return toast("You can't validate your own input", true); x.state = state; audit(state === "Validated" ? "validate_input" : "return_input", x.project, x.kind); toast(`${x.kind}: ${state.toLowerCase()}`); render(); },

  /* R&R */
  rrFixMukesh: () => { EMP.MUKESH.missing = false; EMP.MUKESH.desig = "Marketing POC (EMP-0325, illustrative)"; proj("PRJ-D05").rr.c.mukeshAdded = true; toast("Mukesh Thakur added to the org chart (illustrative)"); render(); },
  rrConfirm: (id) => { proj("PRJ-D05").rr.confirmed[id] = true; toast(`Factor confirmed for ${pname(id)}`); render(); },
  rrMetrics: () => { proj("PRJ-D05").rr.c.baselineMetrics = true; render(); },
  rrSubmit: () => { proj("PRJ-D05").rr.c.submitted = true; toast("Submitted. Sponsor and PMO must both approve; the champion can't lock alone."); render(); },
  rrSponsor: () => { proj("PRJ-D05").rr.c.sponsorOk = true; rrMaybeLock(); render(); },
  rrPmo: () => { proj("PRJ-D05").rr.c.pmoOk = true; rrMaybeLock(); render(); },
  rrValidate: (code, i) => { const d = proj(code).rr.delays[+i]; d.state = "Validated"; audit("validate_delay", code, d.id); toast(`${d.id} validated (PMO). Challenge window: 5 working days.`); render(); },
  rrChallenge: (code, i) => { const d = proj(code).rr.delays[+i]; d.state = "Challenged"; toast(`${d.id} challenged: the team can add evidence to change the category`); render(); },
  rrPublish: () => { proj("PRJ-D01").rr.stage = "Published"; audit("publish_scorecard", "PRJ-D01"); toast("Published. Dispute window: 7 working days."); render(); },
  rrSaveDelay: (code) => {
    const f = DRAWER.form, p = proj(code), prog = p.rr.mode === "programme", { s, st } = delaySuggestion(code, f), t = prog ? null : task(f.task);
    if (t) f.due = t.dueOriginal; // the baseline due date comes from the task, never typed
    const errs = need(f, [["task", prog ? "Choose the run." : "Choose the late task."], ["due", "Enter the due date."], ["cause", "Choose the reason for the delay."], ["reason", "Explain what happened."]]);
    if (f.cause === "X" && !String(f.custom || "").trim()) errs.push({ field: "custom", msg: "Name the custom reason." });
    if (s && !RR.controllable(s[0]) && !String(f.evidence || "").trim()) errs.push({ field: "evidence", msg: "Excused delays need written evidence." });
    const label = t ? t.title : f.task;
    if (p.rr.delays.some((d) => (t ? d.taskCode === t.code : d.task === label && d.stage === st?.step))) errs.push({ field: "task", msg: "This task already has a delay. One late task is one delay." });
    if (errs.length) return showErrors(errs);
    const c4 = f.flagged ? RR.c4(st ? st.sla[0] : null, prog ? f.start : null, f.due, f.flagged).miss : true;
    p.rr.delays.push({ id: "D" + (p.rr.delays.length + 1), task: label, taskCode: t?.code, stage: st?.step, reason: f.reason, cat: s[0], custom: s[0] === "X" ? f.custom.trim() : undefined, tagged: [], c4: RR.controllable(s[0]) && s[0] !== "C4" && c4, evidence: f.evidence, state: "Logged" });
    audit("log_delay", t?.code || code, s[0]); closeDrawer(true); toast("Delay logged. The PMO validator has 3 working days."); render();
  },
  rrSaveDispute: (code) => { const f = DRAWER.form, errs = need(f, [["what", "Choose what is disputed."], ["reason", "Give written grounds."]]); if (errs.length) return showErrors(errs); proj(code).rr.disputes.push(f.what); audit("raise_dispute", code, f.reason); closeDrawer(true); toast("Dispute logged. PMO and HR review within 5 working days."); render(); },
  rrSaveBaseline: (code) => { const f = DRAWER.form, errs = need(f, [["task", "Choose a task."], ["date", "Enter the new date."], ["reason", "Give the reason."]]); if (errs.length) return showErrors(errs); audit("request_baseline_change", code, f.reason); closeDrawer(true); toast("Change request sent to the sponsor and PMO"); render(); },
};
function rrMaybeLock() { const r = proj("PRJ-D05").rr; if (r.c.sponsorOk && r.c.pmoOk && r.charter !== "Locked") { r.charter = "Locked"; r.stage = "Collecting inputs"; audit("lock_charter", "PRJ-D05"); toast("Charter locked. Stage SLAs and the RACI are now fixed."); } }

/* ------------------------------------------------------------------ events ------------------------------------------------------------------ */
document.addEventListener("click", (e) => {
  const fn = e.target.closest("[data-fn]");
  if (fn) { const [id, f] = fn.dataset.fn.split("|"), per = S.personas.find((x) => x.id === id); per.fns = per.fns.includes(f) ? per.fns.filter((x) => x !== f) : [...per.fns, f]; audit("change_functions", EMP[per.emp].name, `${f} ${per.fns.includes(f) ? "added" : "removed"}`); toast(`${EMP[per.emp].name}: ${f} ${per.fns.includes(f) ? "added" : "removed"} (audited)`); render(); return; }
  const el = e.target.closest("[data-act]");
  if (el) { if (el.disabled) return; e.preventDefault(); const [name, ...args] = el.dataset.act.split(":"); if (name === "go") return ACTIONS.go(args.join(":")); (ACTIONS[name] || (() => toast("Not wired in this prototype")))(...args); return; }
  const g = e.target.closest("[data-go]");
  if (g && !e.target.closest("a, input, select, textarea")) go(g.dataset.go);
});
document.addEventListener("change", (e) => {
  const t = e.target, d = t.dataset;
  if (t.id === "persona") { S.persona = t.value; closeDrawer(true); WEEKLY = {}; WEEKLY_RESULT = {}; const h = location.hash; if (/#\/(admin|workflows|policy)/.test(h) && !isAdmin()) go("#/home"); else render(); toast("Now viewing as " + EMP[meEmp()].name); return; }
  if (d.f !== undefined && DRAWER) { DRAWER.form[d.f] = t.type === "checkbox" ? t.checked : t.value; DRAWER.dirty = true; if (t.tagName === "SELECT" || t.type === "date" || t.type === "checkbox") renderLayer(); return; }
  if (d.row !== undefined && DRAWER) { const [i, k] = d.row.split(":"); DRAWER.form.rows[+i][k] = t.value; DRAWER.dirty = true; renderLayer(); return; }
  if (d.file !== undefined && DRAWER) { const s = new Set(DRAWER.form.files || []); t.checked ? s.add(d.file) : s.delete(d.file); DRAWER.form.files = [...s]; return; }
  if (d.failed !== undefined && DRAWER) { const s = new Set(DRAWER.form.failed || []); t.checked ? s.add(d.failed) : s.delete(d.failed); DRAWER.form.failed = [...s]; return; }
  if (d.mstask !== undefined && DRAWER) { const s = new Set(DRAWER.form.tasks || []); t.checked ? s.add(d.mstask) : s.delete(d.mstask); DRAWER.form.tasks = [...s]; DRAWER.dirty = true; return; }
  if (d.nav !== undefined) { const [path] = (location.hash || "#/").split("?"), n = new URLSearchParams(Q); t.value ? n.set(d.nav, t.value) : n.delete(d.nav); go(path + "?" + n.toString()); return; }
  if (d.weekly !== undefined) { const [code, k] = d.weekly.split(":"); WEEKLY[code] = { ...(WEEKLY[code] || {}), [k]: t.value }; delete WEEKLY_RESULT[code]; render(); return; }
  if (d.closureNote !== undefined) { const [code, s] = d.closureNote.split(":"), c = proj(code).closure; c.notes[s] = { ...(c.notes[s] || {}), note: t.value }; return; }
  if (d.closureDone !== undefined) { const [code, s] = d.closureDone.split(":"), c = proj(code).closure; c.notes[s] = { ...(c.notes[s] || {}), done: t.checked }; render(); return; }
  if (d.goToggle !== undefined) { go(d.goToggle); return; }
  if (d.p9 !== undefined) { S.p9doc = t.checked; render(); return; }
  if (d.rradj !== undefined) { const x = proj("PRJ-D01").rr.raci[+d.rradj]; x.adj = Math.max(-10, Math.min(10, Number(t.value) || 0)); audit("calibrate_adjustment", "PRJ-D01", `${pname(x.emp)} ${x.adj}`); toast("Adjustment saved (audited)"); render(); return; }
  if (d.rrcat !== undefined) { const [code, i] = d.rrcat.split(":"), x = proj(code).rr.delays[+i]; x.cat = t.value; x.tagged = RR.controllable(t.value) ? (x.tagged.length ? x.tagged : ["ILL-03"]) : []; toast(`${x.id} is now ${t.value}: score recalculated`); render(); return; }
  if (d.rrpick !== undefined) { const r = proj("PRJ-D05").rr, st = EMAIL_TEMPLATE.stages.find((s) => s.step === +d.rrpick); if (st.R.includes(t.value)) { r.reviewers[d.rrpick] = null; toast(`${pname(t.value)} is Responsible for this stage, so can't review it`, true); } else r.reviewers[d.rrpick] = t.value || null; render(); return; }
  if (d.rrtarget !== undefined) { proj("PRJ-D05").rr.c.target = Number(t.value) || null; render(); return; }
});
document.addEventListener("input", (e) => {
  const t = e.target;
  if (t.id === "palette-q") { PALETTE.q = t.value; renderLayer(); const q = $("#palette-q"); q.focus(); q.setSelectionRange(q.value.length, q.value.length); return; }
  if (t.dataset.f !== undefined && DRAWER && t.tagName !== "SELECT" && t.type !== "date" && t.type !== "checkbox") { DRAWER.form[t.dataset.f] = t.value; DRAWER.dirty = true; }
  if (t.dataset.row !== undefined && DRAWER && t.type === "number") { const [i, k] = t.dataset.row.split(":"); DRAWER.form.rows[+i][k] = t.value; DRAWER.dirty = true; }
});
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); ACTIONS.openPalette(); }
  if (e.key === "Escape") { if (PALETTE) { PALETTE = null; renderLayer(); } else if (BELL) { BELL = false; renderLayer(); } else if (DRAWER) closeDrawer(); }
  if (e.key === "Enter" && e.target.id === "palette-q") document.querySelector(".pop .pi")?.click();
});
window.addEventListener("hashchange", () => { document.body.classList.remove("nav-open"); render(); window.scrollTo(0, 0); });
$("#menu").addEventListener("click", () => document.body.classList.toggle("nav-open"));
$("#reset").addEventListener("click", () => { S = seedData(); EMP.MUKESH.missing = true; EMP.MUKESH.desig = "Marketing POC (not in the org chart)"; WEEKLY = {}; WEEKLY_RESULT = {}; IMPORT_STEP = 0; DRAWER = null; renderLayer(); render(); toast("Prototype reset"); });
render();
