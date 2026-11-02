/* Delivery screens: Home, Projects, Project workspace (delivery tabs), Tasks, Person. Mirrors pages/home, pages/projects, pages/tasks, pages/people. */
const proj = (code) => S.projects.find((p) => p.code === code);
const task = (code) => S.tasks.find((t) => t.code === code);
const owner = (t) => t.assignments.find((a) => a.role === "Owner")?.emp;
const tasksInScope = () => { const vis = new Set(visibleProjects().map((p) => p.code)); return S.tasks.filter((t) => vis.has(t.project)); };
const teamTasks = () => { const people = workPeople(); return tasksInScope().filter((t) => people === null || t.assignments.some((a) => people.has(a.emp))); };

/* ------------------------------------------------------------------ Home ------------------------------------------------------------------ */
function inboxItems() {
  const items = [], mine = meEmp(), admin = isAdmin();
  for (const t of tasksInScope()) {
    if (t.status === "In Review" && t.reviewer === mine) items.push({ type: "Work review", title: `Review ${t.title}`, ctx: `${t.code} · submitted ${fd(t.submissions.at(-1)?.date)} by ${pname(owner(t))}`, act: `openTask:${t.code}`, label: "Review work" });
    for (const b of t.blockers) if (b.state === "Pending" && b.validator === mine && b.requester !== mine) items.push({ type: "Validation", title: `Blocker on ${t.title}`, ctx: `${b.category} · since ${fd(b.since)} · ${pname(b.requester)}`, act: `openTask:${t.code}`, label: "Validate" });
    for (const c of t.dateChanges) if (c.state === "Pending" && c.validator === mine && c.requester !== mine) items.push({ type: "Validation", title: `New date for ${t.title}`, ctx: `${fd(c.from)} → ${fd(c.to)} · ${c.reason}`, act: `openTask:${t.code}`, label: "Validate" });
  }
  for (const p of S.projects) if (p.closure?.state === "Submitted" && canDecideClosure(p))
    items.push({ type: "Closure", title: `Close ${p.title}`, ctx: `${p.code} · ${p.priority} priority${p.priority === "High" ? " · HOD approval required" : ""}`, act: `go:#/projects/${p.code}/closure`, label: "Review closure" });
  for (const r of S.requests) {
    if (r.state === "Submitted" && r.validator === mine) items.push({ type: "Request", title: `Validate request: ${r.title}`, ctx: `${r.from} → ${r.to} · required ${fd(r.required)}`, act: "go:#/projects?tab=requests", label: "Validate" });
    if (r.state === "Validated" && admin) items.push({ type: "Request", title: `Accept into calendar: ${r.title}`, ctx: `${r.from} → ${r.to} · becomes a run of PRJ-D05`, act: "go:#/projects?tab=requests", label: "Accept as receiving POC" });
  }
  if (S.persona === "tl") for (const t of teamTasks().filter((t) => !["Completed", "Cancelled"].includes(t.status))) items.push({ type: "Work update", title: `Update ${t.title}`, ctx: `${t.code} · ${LABEL[t.status] ?? t.status} · ${t.progress}%`, act: `openTask:${t.code}`, label: "Update" });
  for (const q of rrQueue()) items.push({ type: "Project R&R", title: q.t, ctx: q.s, act: "go:" + q.href, label: "Open" });
  return items;
}
function viewHome() {
  const tasks = teamTasks(), active = visibleProjects().filter((p) => !["Completed", "Cancelled"].includes(p.status));
  const denom = tasks.filter((t) => t.status !== "Cancelled").reduce((s, t) => s + t.complexity, 0), acc = tasks.filter((t) => t.status === "Completed").reduce((s, t) => s + t.complexity, 0);
  const items = inboxItems(), group = Q.get("group") || "all";
  const shown = group === "all" ? items : items.filter((i) => i.type === group);
  const role = S.persona, title = role === "tl" ? "Keep your team's work up to date" : role === "hod" ? "Review your departments and required decisions" : "Good afternoon. Let's move work forward.";
  const weeks = [["15 Sep", 3], ["22 Sep", 5], ["29 Sep", 4], ["06 Oct", 6], ["13 Oct", 2 + S.tasks.filter((t) => t.acceptedOn && t.acceptedOn >= "2026-10-13" && t.acceptedOn < "2026-10-20").length], ["20 Oct", S.tasks.filter((t) => t.acceptedOn && t.acceptedOn >= "2026-10-20").length]];
  const max = Math.max(...weeks.map((w) => w[1]), 1), pts = weeks.map((w, i) => `${20 + i * 56},${110 - w[1] / max * 80}`).join(" ");
  crumbs([["Home"]]);
  return `<div class="ph"><div class="titles"><h1>${title}</h1><p class="sub">${fd(TODAY)} · ${esc(EMP[meEmp()].dept)} · ${role === "admin" ? "Organisation" : role === "hod" ? "Headed departments" : "My reporting team"}</p></div>
    <div class="actions">${role === "tl" || role === "manager" ? `<a class="btn primary" href="#/tasks/weekly">Update team work</a>` : `<a class="btn primary" href="#/home?group=Validation">Open approvals</a>`}</div></div>
  ${figures([fig("Active projects", active.length, `${active.filter((p) => p.target && p.target <= "2026-10-31").length} due this month`), fig("Completed tasks", denom ? Math.round(acc / denom * 100) + "%" : "—", "Completed complexity ÷ in-scope complexity"),
    fig("Reviews waiting", items.filter((i) => i.type === "Work review").length, "Independent reviewer queue"), fig("Overdue tasks", tasks.filter((t) => DELIVERY.timing(t) === "Overdue").length, `${tasks.filter((t) => t.status === "Block").length} blocked`)])}
  <div class="grid grid-main mt">
    ${panel("Needs your attention", `${tabs([["all", `All (${items.length})`], ["Work review", "Work reviews"], ["Validation", "Validations"], ["Closure", "Closures"], ["Request", "Requests"], ["Project R&R", "Project R&R"], ...(role === "tl" ? [["Work update", "Work updates"]] : [])], group, (id) => `#/home?group=${encodeURIComponent(id)}`)}
      ${shown.length ? `<ul class="queue" style="margin:-16px -18px">${shown.map((i) => `<li><span class="q-t"><b>${esc(i.title)}</b><span><span class="badge outline">${esc(i.type)}</span> ${esc(i.ctx)}</span></span>${btn(i.label, i.act, { sm: true })}</li>`).join("")}</ul>` : empty("You're all caught up", "No decisions are waiting in your scope.")}`)}
    <div class="stack">
      ${panel("Delivery rhythm", `<svg viewBox="0 0 330 130" width="100%" role="img" aria-label="Completed tasks per week"><polyline fill="none" stroke="var(--brand)" stroke-width="2.5" points="${pts}"/>${weeks.map((w, i) => `<circle cx="${20 + i * 56}" cy="${110 - w[1] / max * 80}" r="3.5" fill="var(--brand)"/><text x="${20 + i * 56}" y="126" font-size="10" text-anchor="middle" fill="var(--muted)">${w[0]}</text><text x="${20 + i * 56}" y="${100 - w[1] / max * 80}" font-size="10" text-anchor="middle" fill="var(--ink-2)">${w[1]}</text>`).join("")}</svg>
        <details class="small"><summary>Table</summary>${table(["Week", "#Completed tasks"], weeks.map((w) => `<tr><td>${w[0]}</td><td class="n">${w[1]}</td></tr>`))}</details>`, { meta: "Completed tasks per week" })}
      ${callout("neutral", "Fair acceptance.", "Reported progress is planning only. Work counts once its independent reviewer accepts it, dated by the accepted submission.")}
    </div></div>`;
}

/* ------------------------------------------------------------------ Projects ------------------------------------------------------------------ */
function viewPortfolio() {
  const tab = Q.get("tab") || "all", view = Q.get("view") || "cards", f = { dept: Q.get("dept") || "", pr: Q.get("pr") || "", st: Q.get("st") || "", q: (Q.get("q") || "").toLowerCase() };
  crumbs([["Projects"]]);
  let list = visibleProjects().filter((p) => tab === "archived" ? p.archived : !p.archived);
  if (tab === "team") { const people = workPeople(); list = list.filter((p) => people === null || S.tasks.some((t) => t.project === p.code && t.assignments.some((a) => people.has(a.emp))) || p.owner === meEmp()); }
  list = list.filter((p) => (!f.dept || p.dept === f.dept) && (!f.pr || (f.pr === "Missing" ? !p.priority : p.priority === f.pr)) && (!f.st || p.status === f.st) && (!f.q || (p.title + p.code).toLowerCase().includes(f.q)));
  const qs = (k, v) => { const n = new URLSearchParams(Q); v ? n.set(k, v) : n.delete(k); return "#/projects?" + n.toString(); };
  const head = `<div class="ph"><div class="titles"><h1>Your project portfolio</h1><p class="sub">A clear picture of delivery, priorities and dependencies</p></div><div class="actions">${btn("New project", "drawer:project", { primary: true })}</div></div>
  ${tabs([["all", "All projects"], ["team", "My team"], ["requests", `Requests (${S.requests.filter((r) => r.state !== "Accepted").length})`], ["archived", "Archived"]], tab, (id) => `#/projects?tab=${id}`)}`;
  if (tab === "requests") return head + viewRequests();
  const filters = `<div class="row mb">
    <select class="select-sm" data-nav="dept" aria-label="Department"><option value="">All departments</option>${DEPARTMENTS.map((d) => `<option ${d === f.dept ? "selected" : ""}>${d}</option>`).join("")}</select>
    <select class="select-sm" data-nav="pr" aria-label="Priority"><option value="">Any priority</option>${["High", "Medium", "Low", "Missing"].map((d) => `<option ${d === f.pr ? "selected" : ""}>${d}</option>`).join("")}</select>
    <select class="select-sm" data-nav="st" aria-label="Status"><option value="">Any status</option>${["Planning", "Not Started", "In Progress", "Blocked", "In Review", "Completed", "On Hold", "Cancelled"].map((d) => `<option value="${d}" ${d === f.st ? "selected" : ""}>${LABEL[d] ?? d}</option>`).join("")}</select>
    <input class="input" style="width:220px;height:30px" placeholder="Search projects" data-nav="q" value="${esc(Q.get("q") || "")}">
    <span style="margin-left:auto"></span><div class="seg">${["cards", "list", "timeline"].map((v) => `<button ${v === view ? 'aria-pressed="true"' : ""} data-go="${qs("view", v)}">${v[0].toUpperCase() + v.slice(1)}</button>`).join("")}</div></div>`;
  if (!list.length) return head + filters + panel("No filter matches", empty("No filter matches", "Clear or change your filters.", `<a class="btn" href="#/projects">Clear filters</a>`));
  const band = (p) => p.rr ? (p.code === "PRJ-D01" ? RR.band(RR.score(p).score) : p.rr.fixed?.score != null ? RR.band(p.rr.fixed.score) : null) : null;
  let body;
  if (view === "list") body = panel("Projects", table(["Project", "Priority", "Status", "Health", "Owner", "Target", "#Completed tasks", "Project band"], list.map((p) => { const m = DELIVERY.projectMetrics(p);
    return `<tr class="clickable" data-go="#/projects/${p.code}/overview"><td><b>${esc(p.title)}</b><span class="sub">${p.code} · ${p.dept}</span></td><td>${p.priority ? badge(p.priority) : `<span class="badge bad">Missing</span>`}</td><td>${badge(p.status)}</td><td>${m.health ? badge(m.health) : "—"}</td><td>${esc(pname(p.owner))}</td><td>${fd(p.target)}</td><td class="n">${m.total ? `${m.accepted} of ${m.total}` : "—"}</td><td>${p.rr ? tier(band(p)) : `<span class="muted small">Not in the scheme</span>`}</td></tr>`; })), { pad: false });
  else if (view === "timeline") body = portfolioTimeline(list);
  else body = `<div class="grid grid-3">${list.map((p) => { const m = DELIVERY.projectMetrics(p), b = band(p);
    return `<section class="panel clickable" data-go="#/projects/${p.code}/overview" style="cursor:pointer"><div class="panel-b"><div class="row between"><span class="mono">${p.code}</span>${p.priority ? badge(p.priority) : `<span class="badge bad">Priority missing</span>`}</div>
      <h3 style="margin:8px 0 2px">${esc(p.title)}</h3><div class="small muted">${p.dept} · owner ${esc(pname(p.owner))}</div>
      <div class="row mt">${badge(p.status)} ${m.health ? badge(m.health) : ""} ${p.rr ? tier(b) : ""}</div>
      <div class="row mt small"><span class="muted">Completed tasks</span><b>${m.total ? `${m.accepted} of ${m.total}` : "—"}</b><span class="muted" style="margin-left:auto">Target ${fd(p.target, false)}</span></div>
      ${m.total ? `<div class="minibar" style="width:100%;margin-top:8px"><i style="width:${m.delivery}%"></i></div>` : ""}</div></section>`; }).join("")}</div>`;
  return head + filters + body + (tab === "all" ? `<div class="mt">${panel("Requests to coordinate", `${S.requests.filter((r) => r.state !== "Accepted").length} request(s) waiting for validation or acceptance.`, { tools: `<a class="btn sm" href="#/projects?tab=requests">Open requests</a>` })}</div>` : "");
}
function viewRequests() {
  const rows = S.requests.map((r) => {
    let next = "—";
    if (r.state === "Submitted") next = r.validator === meEmp() ? `${btn("Validate", `req:${r.id}:validate`, { sm: true })} ${btn("Return", `req:${r.id}:return`, { sm: true })}` : `<span class="muted small">Waiting for ${esc(pname(r.validator))}</span>`;
    else if (r.state === "Validated") next = isAdmin() ? `${btn("Accept into calendar", `req:${r.id}:accept`, { sm: true, primary: true })} ${btn("Return", `req:${r.id}:return`, { sm: true })}` : `<span class="muted small">Waiting for the receiving POC</span>`;
    else if (r.state === "Accepted") next = r.run ? `<a href="#/projects/PRJ-D05/runs">Run ${r.run} of PRJ-D05</a>` : "Scheduled";
    return `<tr><td><b>${esc(r.title)}</b><span class="sub">${r.id} · ${r.template}</span></td><td>${r.from} → ${r.to}</td><td>${fd(r.required)}</td><td>${esc(pname(r.validator))}<span class="sub">Requester's manager</span></td><td>${badge(r.state)}</td><td>${next}</td></tr>`;
  });
  return `<div class="row mb"><span class="note">Requester's manager validates, then the receiving POC accepts it into the calendar. Accepted email campaigns become runs of the quarterly programme.</span><span style="margin-left:auto"></span>${btn("Request work from another department", "drawer:request", { primary: true })}</div>
  ${panel("Cross-department requests", table(["Request", "From / to", "Required", "Validator", "State", "Next action"], rows), { pad: false })}`;
}

/* ------------------------------------------------------------------ Project workspace ------------------------------------------------------------------ */
function viewProject(code, tab) {
  const p = proj(code);
  if (!p || !visibleProjects().includes(p)) return panel("Not available", empty("This project isn't available to you", "It may be outside your scope. No details are shown.", `<a class="btn" href="#/projects">Back to projects</a>`));
  const m = DELIVERY.projectMetrics(p);
  crumbs([["Projects", "#/projects"], [p.title]]);
  const list = [["overview", "Overview"], ["tasks", "Tasks"], ["timeline", "Timeline"], ["risks", `Risks${m.openRisks ? ` (${m.openRisks})` : ""}`],
    ...(p.rr?.mode === "programme" ? [["runs", "Runs"]] : []), ...(p.rr ? [["charter", "Charter"], ["delays", `Delays${p.rr.delays?.length ? ` (${p.rr.delays.length})` : ""}`], ["scorecard", "Scorecard"]] : []), ["closure", "Closure"], ["audit", "Audit logs"]];
  const head = `<a class="back" href="#/projects">‹ Projects</a>
  <div class="ph"><div class="titles"><h1>${esc(p.title)}</h1><p class="sub">${p.code} · ${p.dept} · ${p.priority ? p.priority + " priority" : "Priority missing"} · ${LABEL[p.status] ?? p.status} · owner ${esc(pname(p.owner))}${p.template ? ` · from the ${p.template} template` : ""}</p></div>
    <div class="actions">${canManageProject(p) ? btn("Edit project", `drawer:editProject:${p.code}`) : ""}${canManageProject(p) || canUpdateTask({ assignments: [] }) ? btn(`${icon(I.plus)} Add task`, `drawer:task:${p.code}`, { primary: true }) : ""}</div></div>
  ${!p.priority ? callout("warn", "Priority missing.", "Imported from the legacy tracker. Choose High, Medium or Low in Edit project; saving anything else is blocked until then.") : ""}
  ${tabs(list, tab, (id) => `#/projects/${p.code}/${id}`)}`;
  const views = { overview: projOverview, tasks: projTasks, timeline: projTimeline, risks: projRisks, closure: projClosure, audit: projAudit, activity: projAudit,
    runs: () => rrRuns(p), charter: () => rrCharter(p), delays: () => rrDelays(p), scorecard: () => rrScorecard(p) };
  return head + (views[tab] || projOverview)(p, m);
}
function projOverview(p, m) {
  const people = [...new Set(S.tasks.filter((t) => t.project === p.code).flatMap((t) => t.assignments.map((a) => a.emp)))];
  const sc = p.rr ? (p.code === "PRJ-D01" ? RR.score(p) : null) : null;
  return `${figures([fig("Completed tasks", m.total ? `${m.accepted}<small>of ${m.total}</small>` : "—", `${pct(m.delivery)} by complexity`), fig("Target date", fd(p.target), `Timing: ${p.status === "Completed" ? "Closed" : DELIVERY.timing({ status: p.status, due: p.target, submissions: [] })}`),
    fig("Open risks", m.openRisks, `${m.highRisks} High / Critical`), fig("Health", m.health ? LABEL[m.health] : LABEL[p.status] ?? p.status, "From approved rules; can't be set by hand"), fig("Reported progress", m.progress == null ? "—" : m.progress + "%", "Planning only, never acceptance")])}
  <div class="grid grid-main mt"><div class="stack">
    ${panel("Delivery objective", `<p>${esc(p.objective || "No objective recorded.")}</p>`)}
    ${(() => { const next = S.tasks.filter((t) => t.project === p.code && !["Completed", "Cancelled"].includes(t.status) && t.due).sort((a, b) => a.due.localeCompare(b.due)).slice(0, 5);
      return panel("Due next", next.length ? table(["Task", "Owner", "Due in force", "Timing"], next.map((t) => `<tr class="clickable" data-act="openTask:${t.code}"><td><b>${esc(t.title)}</b><span class="sub">${t.code}</span></td><td>${esc(pname(owner(t)))}</td><td>${fd(t.due)}</td><td>${badge(DELIVERY.timing(t))}</td></tr>`)) : empty("Nothing due", "Open work with a due date appears here."), { pad: !next.length, tools: `<a class="btn sm" href="#/projects/${p.code}/timeline">Open timeline</a>` }); })()}
  </div><div class="stack">
    ${panel("People and responsibility", `<dl class="kv"><dt>Owner</dt><dd>${charterPerson(p, p.owner, esc(pname(p.owner)))}</dd><dt>Project reviewer</dt><dd>${charterPerson(p, p.reviewer, esc(pname(p.reviewer)))}</dd><dt>Department</dt><dd>${p.dept}</dd></dl>
      <div class="stack mt">${people.map((id) => charterPerson(p, id)).join("")}</div>`, { meta: "Select a person to view their assigned work in this project" })}
    ${p.rr ? panel("Project R&amp;R", `<dl class="kv"><dt>Charter</dt><dd>${badge(p.rr.charter)}</dd><dt>Scoring</dt><dd>${p.rr.mode === "programme" ? "Quarterly programme" : "At closure"}</dd><dt>Project band</dt><dd>${sc ? tier(sc.band) : p.rr.fixed?.score != null ? tier(RR.band(p.rr.fixed.score)) : `<span class="muted">Not scored yet</span>`}</dd></dl>`, { tools: `<a class="btn sm" href="#/projects/${p.code}/${sc || p.rr.fixed ? "scorecard" : "charter"}">Open</a>` })
      : panel("Project R&amp;R", `<p class="small muted">Not in the scheme. Admin can add it to the pilot; it then needs a locked charter before it can be scored.</p>`)}
  </div></div>`;
}
function taskCard(t) {
  const tm = DELIVERY.timing(t), blocked = t.blockers.some((b) => b.state === "Pending");
  return `<button class="kcard" data-act="openTask:${t.code}"><span class="row between"><span class="mono">${t.code.split("-").at(-1)}</span><span class="row">${blocked ? `<span class="badge bad">${icon(I.flag)} Blocker</span>` : ""}${t.status === "Completed" ? "" : badge(t.status)}</span></span>
    <b>${esc(t.title)}</b><span class="row small">${avatar(owner(t))}<span class="muted">${fd(t.due, false)}</span>${badge(tm)}</span>${t.progress && t.status !== "Completed" ? `<span class="minibar" style="width:100%"><i style="width:${t.progress}%"></i></span>` : ""}</button>`;
}
function projTasks(p) {
  if (p.rr?.mode === "programme") return panel("Run stages", table(["Run", ...EMAIL_TEMPLATE.stages.map((s) => `${s.step} · ${s.name}`)], p.rr.runs.map((r) => `<tr><td><b>${r.id}</b><span class="sub">${esc(r.title)}</span></td>${r.done.map((d, i) => `<td>${r.late.includes(i + 1) ? badge("Late") : d ? badge("Completed") : i === r.done.indexOf(0) ? badge("In Progress") : badge("Not Started")}</td>`).join("")}</tr>`)), { meta: "Each run's stages are tasks with finish-to-start dependencies", pad: false });
  // Table is the primary view; Board is the second option (?view=board)
  const ts = S.tasks.filter((t) => t.project === p.code), view = Q.get("view") === "board" ? "board" : "table";
  const toggle = `<div class="row mb"><div class="seg">${["table", "board"].map((v) => `<button ${v === view ? 'aria-pressed="true"' : ""} data-go="#/projects/${p.code}/tasks?view=${v}">${v === "board" ? "Board" : "Table"}</button>`).join("")}</div><span class="note">${view === "board" ? "Dropping a card into In review can't skip evidence submission or review." : "Select a task to open its details and updates."}</span></div>`;
  if (!ts.length) return toggle + panel("Tasks", empty("No tasks yet", "Use Add task to create the first task.", btn("Add task", `drawer:task:${p.code}`, { primary: true })));
  if (view === "table") return toggle + panel("Tasks", taskTrackingTable(ts), { pad: false });
  return toggle + `<div class="kanban">${DELIVERY.LANES.map(([label, sts]) => { const items = ts.filter((t) => sts.includes(t.status)); return `<div class="kcol"><div class="kcol-h"><span title="${esc(sts.map((s) => LABEL[s] ?? s).join(", "))}">${label}</span><span class="muted">${items.length}</span></div>${items.map(taskCard).join("")}<button class="btn sm ghost kadd" data-act="drawer:task:${p.code}:${sts[0]}">${icon(I.plus)} Add task</button></div>`; }).join("")}</div>`;
}
const taskRow = (t) => `<tr class="clickable" data-act="openTask:${t.code}"><td><b>${esc(t.title)}</b><span class="sub">${t.code}</span></td><td>${esc(pname(owner(t)))}</td><td>${badge(t.status)}</td><td>${t.status === "Completed" ? "Completed" : minibar(t.progress)}</td><td>${fd(t.due)}${t.dueOriginal && t.dueOriginal !== t.due ? `<span class="sub">was ${fd(t.dueOriginal, false)}</span>` : ""}</td><td>${badge(DELIVERY.timing(t))}</td><td>${esc(pname(t.reviewer))}</td></tr>`;

const TASK_DATE_NOTE = "End date is the due date in force; changes need validation. Actual working days count weekdays and exclude calendar holidays, from start to the accepted submission, pending submission, or today. They show elapsed time, not effort. Delay is calendar days after the end date. Go-live is recorded separately from acceptance.";
function taskTrackingTable(ts, emp = null, note = true) {
  return table(["Task", emp ? "Role / share" : "Owner", "Start date", "End date", "Go live date", "#Actual working days", "#Delay (No. of days)", "Status", "Progress", "Next action"], ts.map((t) => {
    const d = DELIVERY.taskDates(t), a = emp && t.assignments.find((x) => x.emp === emp);
    return `<tr><td style="min-width:200px"><button class="link-btn" data-act="openTask:${t.code}"><b>${esc(t.title)}</b></button><span class="sub">${t.code}</span></td>
      <td>${a ? `${a.role} · ${a.share}%` : esc(pname(owner(t)))}</td><td>${fd(t.start)}</td><td>${fd(t.due)}${t.dueOriginal && t.dueOriginal !== t.due ? `<span class="sub">was ${fd(t.dueOriginal, false)}</span>` : ""}</td><td>${fd(t.goLive)}</td>
      <td class="n">${d.working ?? "—"}</td><td class="n${d.delay > 0 ? " bad-txt" : ""}">${d.delay ?? "—"}</td><td>${badge(t.status)}</td><td>${minibar(t.progress)}${t.status === "Completed" ? `<span class="sub">Completed</span>` : ""}</td><td class="wrap">${esc(t.nextAction || "—")}</td></tr>`;
  }), "No tasks assigned to this person in this project") + (note ? `<p class="note" style="padding:12px 18px">${TASK_DATE_NOTE}</p>` : "");
}
/* ------------------------------------------------------------------ Timeline ------------------------------------------------------------------
   One gantt for projects and the portfolio: week grid with dated headers, a labelled Today line, bars coloured by status with a
   progress fill, a hatched overdue extension up to today, and a dashed marker where a due date was moved from. */
const GX_LEGEND = [["s-done", "Completed tasks"], ["s-progress", "In progress (fill = reported progress)"], ["s-review", "In review or rework"], ["s-blocked", "Blocked or off track"], ["s-todo", "Not started"], ["gx-over", "Overdue: past the due date"]];
function gxRange(dates) {
  const ds = dates.filter(Boolean).sort(); let from = ds[0], to = ds.at(-1) > TODAY ? ds.at(-1) : TODAY;
  if (TODAY < from) from = TODAY;
  from = addDays(from, -((dow(from) + 6) % 7)); to = addDays(to, 10); to = addDays(to, (7 - dow(to)) % 7);
  const span = daysBetween(from, to) + 1;
  return { from, to, span, pos: (d) => daysBetween(from, d) / span * 100, mid: (d) => (daysBetween(from, d) + 0.5) / span * 100 };
}
function gxHead(r, label) {
  const weeks = []; for (let d = r.from; d <= r.to; d = addDays(d, 7)) weeks.push(d);
  return `<div class="gx-row gx-head"><div class="gx-label">${label}</div><div class="gx-track" style="--wk:${700 / r.span}%">
    ${weeks.map((w, i) => { // long ranges label months only; nothing is drawn under the Today tag
      const newMonth = i === 0 || w.slice(5, 7) !== weeks[i - 1].slice(5, 7), dense = weeks.length > 14;
      if ((dense && !newMonth) || Math.abs(r.pos(w) - r.mid(TODAY)) < (dense ? 10 : 8)) return "";
      return `<span class="gx-wk" style="left:${r.pos(w)}%">${newMonth ? `<b>${MONTHS[+w.slice(5, 7) - 1]}</b> ` : ""}${dense ? "" : +w.slice(8)}</span>`; }).join("")}
    <span class="gx-today-tag" style="left:${r.mid(TODAY)}%">Today · ${fd(TODAY, false)}</span></div></div>`;
}
function gxBar(r, b) {
  const l = r.pos(b.start), end = r.pos(addDays(b.end, 1)), w = Math.max(end - l, 100 / r.span * 0.6), over = b.over ? r.pos(addDays(TODAY, 1)) : null, after = over ?? l + w;
  let h = `<span class="gx-bar ${b.cls}" style="left:${l}%;width:${w}%" ${b.act ? `data-act="${b.act}"` : ""} title="${esc(b.title)}">${b.fill ? `<i class="gx-fill" style="width:${b.fill}%"></i>` : ""}</span>`;
  if (over) h += `<span class="gx-over" style="left:${l + w}%;width:${over - (l + w)}%" title="Overdue since ${fd(b.end)}"></span>`;
  if (b.ghost) h += `<span class="gx-ghost" style="left:${r.pos(addDays(b.ghost, 1))}%" title="Original due date ${fd(b.ghost)}"></span>`;
  h += after > 72 ? `<span class="gx-text" style="right:calc(${100 - l}% + 8px)">${b.text}</span>` : `<span class="gx-text" style="left:calc(${after}% + 8px)">${b.text}</span>`;
  return h;
}
const gxRow = (r, label, meta, bar, cls = "") => `<div class="gx-row ${cls}"><div class="gx-label">${label}${meta ? `<span class="gx-meta">${meta}</span>` : ""}</div><div class="gx-track" style="--wk:${700 / r.span}%"><i class="gx-now" style="left:${r.mid(TODAY)}%"></i>${bar}</div></div>`;
const gxLegend = (keys = GX_LEGEND) => `<div class="gx-legend">${keys.map(([c, l]) => `<span><i class="${c}"></i>${l}</span>`).join("")}<span><i class="gx-ghost-key"></i>Original due date (moved)</span></div>`;
function taskBar(t) {
  const tm = DELIVERY.timing(t), moved = t.dueOriginal && t.dueOriginal !== t.due ? t.dueOriginal : null, over = tm === "Overdue";
  const b = { start: t.start || t.due, end: t.due, act: `openTask:${t.code}`, over, ghost: moved, title: `${t.code} · ${t.title}\n${fd(t.start)} → ${fd(t.due)} · ${LABEL[t.status] ?? t.status}` };
  if (t.status === "Completed") Object.assign(b, { cls: "s-done", text: `Completed ${fd(t.acceptedOn, false)}${t.acceptedOn > t.due ? ` · <b class="bad-txt">late</b>` : ""}` });
  else if (t.status === "In Review") Object.assign(b, { cls: "s-review", fill: 100, text: `In review · submitted ${fd(t.submissions.at(-1)?.date, false)}` });
  else if (t.status === "Rework") Object.assign(b, { cls: "s-review", fill: t.progress, text: `Rework · due ${fd(t.due, false)}` });
  else if (["Block", "Delayed"].includes(t.status)) Object.assign(b, { cls: "s-blocked", fill: t.progress, text: `${LABEL[t.status] ?? t.status} · ${t.progress}% · due ${fd(t.due, false)}` });
  else if (t.status !== "Not Started") Object.assign(b, { cls: "s-progress", fill: t.progress, text: `${LABEL[t.status] ?? t.status} · ${t.progress}% · due ${fd(t.due, false)}` });
  else Object.assign(b, { cls: "s-todo", text: `Due ${fd(t.due, false)}` });
  if (over) b.text += ` · <b class="bad-txt">${daysBetween(t.due, TODAY)} day${daysBetween(t.due, TODAY) > 1 ? "s" : ""} overdue</b>`;
  if (moved) b.text += ` · moved from ${fd(moved, false)}`;
  return b;
}
function projTimeline(p) {
  if (p.rr?.mode === "programme") return runsTimeline(p);
  const all = S.tasks.filter((t) => t.project === p.code && t.status !== "Cancelled"), hideDone = Q.get("done") === "hide";
  const dated = all.filter((t) => t.due && !(hideDone && t.status === "Completed")), undated = all.filter((t) => !t.due);
  const qs = (k, v) => { const n = new URLSearchParams(Q); v ? n.set(k, v) : n.delete(k); return `#/projects/${p.code}/timeline?${n}`; };
  const tools = `<div class="gx-tools"><label class="toggle"><input type="checkbox" data-go-toggle="${qs("done", hideDone ? "" : "hide")}" ${hideDone ? "checked" : ""}> Hide completed tasks</label><span style="margin-left:auto"></span>${gxLegend()}</div>`;
  if (!dated.length) return tools + panel("Timeline", empty("No dated tasks", "Add due dates to place work on the timeline."));
  const r = gxRange([...dated.map((t) => t.start), ...dated.map((t) => t.due), ...dated.map((t) => t.dueOriginal)]);
  const label = (t) => `<button class="gx-name" data-act="openTask:${t.code}"><span class="mono">${t.code.split("-").at(-1)}</span>${esc(t.title)}</button>`;
  const meta = (t) => `${avatar(owner(t))}<span>${esc(pname(owner(t)))}</span>${badge(t.status)}`;
  const rows = dated.slice().sort((a, b) => (a.start || a.due).localeCompare(b.start || b.due)).map((t) => gxRow(r, label(t), meta(t), gxBar(r, taskBar(t)))).join("");
  return tools + `<section class="panel"><div class="gx-scroll"><div class="gx">${gxHead(r, `Task · ${fd(r.from, false)} to ${fd(r.to, false)}`)}${rows}</div></div>
    ${undated.length ? `<div class="gx-off">Not on the timeline (no due date): ${undated.map((t) => `<button class="link-btn" data-act="openTask:${t.code}">${t.code.split("-").at(-1)} · ${esc(t.title)}</button>`).join(", ")}</div>` : ""}</section>
  <p class="note mt">Click a bar or task name to open it. Bars run from start to the due date in force; completed tasks are dated by their accepted submission. Weeks start on Monday.</p>`;
}
function runsTimeline(p) {
  const runs = p.rr.runs, r = gxRange([...runs.map((x) => x.started), ...runs.map((x) => x.maxDue), ...runs.map((x) => x.delivered)]);
  const rows = runs.map((x) => { const done = x.done.filter(Boolean).length, late = x.late.length;
    const b = { start: x.started, end: x.delivered || x.maxDue, title: `${x.id} · ${x.title}`, over: !x.delivered && x.maxDue < TODAY,
      cls: x.delivered ? "s-done" : late ? "s-review" : "s-progress", fill: x.delivered ? null : Math.round(done / 6 * 100),
      text: x.delivered ? `Delivered ${fd(x.delivered, false)} · max SLA ${fd(x.maxDue, false)}` : `${done} of 6 stages${late ? ` · <b class="warn-txt">stage ${x.late[0]} over SLA</b>` : ""} · max ${fd(x.maxDue, false)}` };
    return gxRow(r, `<span class="gx-name"><span class="mono">${x.id}</span>${esc(x.title)}</span>`, `<span>From ${esc(x.req)}</span>`, gxBar(r, b)); }).join("");
  return `<div class="gx-tools">${gxLegend(GX_LEGEND.filter(([c]) => c !== "s-blocked" && c !== "s-todo"))}</div>
  <section class="panel"><div class="gx-scroll"><div class="gx">${gxHead(r, "Campaign run")}${rows}</div></div></section><p class="note mt">Each run is one campaign request through the 6 template stages; bars end at delivery or at the 14-business-day maximum SLA.</p>`;
}
function portfolioTimeline(list) {
  const dated = list.filter((p) => p.start && p.target).sort((a, b) => a.start.localeCompare(b.start)), undated = list.filter((p) => !p.start || !p.target);
  if (!dated.length) return panel("Timeline", empty("No dated projects", "Projects without start and target dates can't be placed on the timeline."));
  const r = gxRange([...dated.map((p) => p.start), ...dated.map((p) => p.target)]);
  const rows = dated.map((p) => { const m = DELIVERY.projectMetrics(p), done = p.status === "Completed";
    const cls = done ? "s-done" : m.health === "Off Track" ? "s-blocked" : m.health === "At Risk" ? "s-review" : ["Planning", "Not Started"].includes(p.status) ? "s-todo" : "s-progress";
    const b = { start: p.start, end: p.target, cls, fill: done ? null : m.delivery ? Math.round(m.delivery) : null, act: `go:#/projects/${p.code}/timeline`, over: !done && p.target < TODAY, title: `${p.code} · ${p.title}\n${fd(p.start)} → ${fd(p.target)}`,
      text: done ? `Closed · target ${fd(p.target, false)}` : `Target ${fd(p.target, false)}${m.total ? ` · ${Math.round(m.delivery)}% completed tasks` : ""}` };
    if (b.over) b.text += ` · <b class="bad-txt">${daysBetween(p.target, TODAY)} days past target</b>`;
    return gxRow(r, `<a class="gx-name" href="#/projects/${p.code}/overview"><span class="mono">${p.code}</span>${esc(p.title)}</a>`, `${p.priority ? badge(p.priority) : `<span class="badge bad">No priority</span>`}${m.health ? badge(m.health) : badge(p.status)}<span>${esc(p.dept)}</span>`, gxBar(r, b)); }).join("");
  return `<div class="gx-tools">${gxLegend([["s-done", "Completed"], ["s-progress", "On track (fill = completed tasks)"], ["s-review", "At risk"], ["s-blocked", "Off track"], ["s-todo", "Planning"], ["gx-over", "Past target date"]])}</div>
  <section class="panel"><div class="gx-scroll"><div class="gx">${gxHead(r, `Project · ${fd(r.from, false)} to ${fd(r.to, false)}`)}${rows}</div></div>
  ${undated.length ? `<div class="gx-off">Not on the timeline (no start or target date): ${undated.map((p) => esc(p.code)).join(", ")}</div>` : ""}</section>`;
}
function projRisks(p) {
  return `<div class="row mb"><span class="note">Open High or Critical risks show in project health.${p.template ? " Template risks were added when the project started." : ""}</span><span style="margin-left:auto"></span>${canManageProject(p) ? btn("Record risk", `drawer:risk:${p.code}`, { primary: true }) : ""}</div>
  ${panel("Risks", table(["Risk", "Stage", "Criticality", "Owner", "Mitigation", "Next review", "State", ""], p.risks.map((r, i) => `<tr><td class="wrap"><b>${esc(r.risk)}</b><span class="sub">${r.code}${r.deps ? " · depends on " + esc(r.deps) : ""}</span></td><td>${esc(r.stage)}</td><td>${badge(r.crit)}</td><td>${esc(pname(r.owner))}</td><td class="wrap small">${esc(r.mitigation)}</td><td>${fd(r.next)}</td><td>${badge(r.state)}</td><td>${canManageProject(p) ? btn("Update", `drawer:risk:${p.code}:${i}`, { sm: true }) : ""}</td></tr>`), "No risks match"), { pad: false })}`;
}
const CLOSURE_STAGES = [["tasks", "Tasks"], ["deliverables", "Deliverables"], ["objectives", "Objectives"], ["issues", "Open issues"], ["lessons", "Lessons learned"], ["remarks", "Final remarks"]];
function closureReadiness(p) {
  const ts = S.tasks.filter((t) => t.project === p.code && t.status !== "Cancelled"), open = p.incidents.filter((i) => i.state !== "Closed");
  const auto = { tasks: [ts.every((t) => t.status === "Completed"), `${ts.filter((t) => t.status === "Completed").length} of ${ts.length} completed tasks`], issues: [!open.length, `${open.length} open incident(s)`] };
  const c = p.closure || (p.closure = { state: "Draft", notes: {} });
  const stages = CLOSURE_STAGES.map(([id, label]) => { const n = c.notes[id] || {}; const a = auto[id]; return { id, label, done: a ? !!n.done && a[0] : !!n.done, gap: a && !a[0] ? a[1] : null, evidence: a ? a[1] : null, note: n.note || "" }; });
  return { c, stages, ready: stages.every((s) => s.done) };
}
function projClosure(p) {
  const { c, stages, ready } = closureReadiness(p), editable = canManageProject(p) && ["Draft", "Returned"].includes(c.state);
  const canDecide = c.state === "Submitted" && canDecideClosure(p);
  return `<div class="split wide-side"><div class="stack">${panel("Close a project with evidence", table(["Stage", "Evidence / gap", "Note", "Ready"], [...stages.map((s) => `<tr><td><b>${s.label}</b></td><td class="wrap small">${s.gap ? `<span class="bad-txt">${esc(s.gap)}</span>` : esc(s.evidence || "Linked evidence or note")}</td><td>${editable ? `<input class="input" style="height:30px" data-closure-note="${p.code}:${s.id}" value="${esc(s.note)}" placeholder="Linked evidence or note">` : esc(s.note || "—")}</td><td><label class="check"><input type="checkbox" data-closure-done="${p.code}:${s.id}" ${s.done ? "checked" : ""} ${editable && !s.gap ? "" : "disabled"}> Ready</label></td></tr>`),
    `<tr><td><b>Approval</b></td><td colspan="3">${badge(c.state)} ${p.priority === "High" ? "HOD of the project department decides" : "Project reviewer or HOD decides"}</td></tr>`]), { pad: false, meta: `${p.priority ?? "No"} priority${p.priority === "High" ? " · HOD approval required" : ""}`,
    foot: `${editable ? btn("Submit for closure approval", `closure:${p.code}:submit`, { primary: true, disabled: !ready, title: ready ? "" : "Every stage must be ready" }) : ""}${canDecide ? `${btn("Return with comment", `closure:${p.code}:return`)} ${btn("Approve closure", `closure:${p.code}:approve`, { primary: true })}` : ""}${c.state === "Submitted" && !canDecide ? `<span class="note">${c.submittedBy === meEmp() ? "You submitted this closure; an independent person decides." : p.priority === "High" ? "Waiting for the HOD of " + esc(p.dept) + "." : "Waiting for the project reviewer or HOD."}</span>` : ""}` })}</div>
  <div class="stack">${callout("neutral", "Decision owner.", p.priority === "High" ? "High priority: the HOD of the project department." : "The project reviewer or the department HOD.")}${callout("neutral", "Return with comment keeps the project open.", "A status change can't hide unresolved mandatory work.")}
    ${panel("Closure history", (c.history || []).length ? c.history.map((h) => `<div class="small">${fd(h.at)} · ${esc(h.text)}</div>`).join("") : `<span class="muted small">No decisions yet.</span>`)}</div></div>`;
}
// High priority: only the HOD of the project department. Otherwise the project reviewer or that HOD. Never the submitter.
function canDecideClosure(p) {
  const c = p.closure, hod = S.persona === "hod" && me().depts.includes(p.dept);
  if (!c || c.submittedBy === meEmp()) return false;
  return p.priority === "High" ? hod : p.reviewer === meEmp() || hod;
}
function projAudit(p) {
  const codes = new Set([p.code, ...S.tasks.filter((t) => t.project === p.code).map((t) => t.code), ...p.incidents.map((i) => i.code)]);
  return panel("Audit logs", table(["Event", "Record", "Actor", "Reason", "Time"], S.audit.filter((a) => codes.has(a.record)).map((a) => `<tr><td>${esc(a.action.replace(/_/g, " "))}</td><td class="mono">${a.record}</td><td>${esc(pname(a.by))}</td><td class="wrap">${esc(a.reason || "—")}</td><td>${esc(a.at)}</td></tr>`), "No audit events yet"), { pad: false, meta: "Append-only: every decision on this project and its tasks, with actor, time and reason. Nobody can edit or delete an entry." });
}

/* ------------------------------------------------------------------ Tasks ------------------------------------------------------------------ */
let WEEKLY = {}, WEEKLY_RESULT = {};
function viewTasks(tab) {
  crumbs([["Tasks"]]);
  const review = tasksInScope().filter((t) => t.status === "In Review" && isReviewerOf(t));
  const head = `<div class="ph"><div class="titles"><h1>A calmer way to update team work</h1><p class="sub">Weekly updates in under 2 minutes per team. Acceptance stays with the independent reviewer.</p></div><div class="actions">${btn(`${icon(I.plus)} Add task`, "drawer:task", { primary: true })}</div></div>
  ${tabs([["team", "My team tasks"], ["weekly", "Weekly update"], ["review", `Review queue (${review.length})`], ["dependencies", "Dependencies"]], tab, (id) => `#/tasks/${id}`)}`;
  if (tab === "weekly") return head + weeklyGrid();
  if (tab === "review") return head + panel("Independent reviewer workspace", table(["Task", "Owner", "Submitted", "Due in force", "Status", ""], review.map((t) => `<tr><td><b>${esc(t.title)}</b><span class="sub">${t.code}</span></td><td>${esc(pname(owner(t)))}</td><td>${fd(t.submissions.at(-1)?.date)}</td><td>${fd(t.due)}</td><td>${badge(t.status)}</td><td>${btn("Review", `openTask:${t.code}`, { sm: true, primary: true })}</td></tr>`), "Nothing waiting for your review"), { pad: false, meta: "Accept the output, or return clear feedback" });
  if (tab === "dependencies") return head + depsTable();
  const own = Q.get("owner") || "", st = Q.get("st") || "";
  const rows = teamTasks().filter((t) => (!own || owner(t) === own) && (!st || t.status === st));
  const owners = [...new Set(teamTasks().map(owner))];
  return head + `<div class="row mb"><select class="select-sm" data-nav="owner"><option value="">Every owner</option>${owners.map((o) => `<option value="${o}" ${o === own ? "selected" : ""}>${esc(pname(o))}</option>`).join("")}</select>
    <select class="select-sm" data-nav="st"><option value="">Any status</option>${[...DELIVERY.TASK_STATUSES, "In Review", "Rework"].map((s) => `<option value="${s}" ${s === st ? "selected" : ""}>${LABEL[s] ?? s}</option>`).join("")}</select></div>
  ${panel("My team tasks", table(["Task / project", "Owner", "Status", "Progress", "Due in force", "Timing", "Reviewer"], rows.map(taskRow), "No active work in your scope"), { pad: false })}`;
}
function weeklyGrid() {
  const rows = teamTasks().filter((t) => !["Completed", "Cancelled"].includes(t.status) && canUpdateTask(t));
  const changed = Object.keys(WEEKLY).length;
  return `<div class="split wide-side"><div>${panel("Weekly update", `${changed ? `<div class="callout neutral mb"><span><b>${changed} change${changed > 1 ? "s are" : " is"} ready to save.</b> Successful rows save even if another row conflicts.</span></div>` : ""}
    ${table(["Task / project", "Status", "Progress", "This week", "Result"], rows.map((t) => { const e = WEEKLY[t.code] || {}, locked = ["In Review", "Rework"].includes(t.status), r = WEEKLY_RESULT[t.code];
      return `<tr><td><b>${esc(t.title)}</b><span class="sub">${t.code} · ${esc(pname(owner(t)))}</span></td>
        <td>${locked ? `${badge(t.status)}<span class="sub">Set by the review workflow</span>` : `<select class="select-sm" data-weekly="${t.code}:status">${statusOptions(e.status ?? t.status)}</select>`}</td>
        <td><input class="mini-in" type="number" min="0" max="100" data-weekly="${t.code}:progress" value="${e.progress ?? t.progress}" ${locked ? "disabled" : ""}></td>
        <td><input class="input" style="height:30px;min-width:220px" data-weekly="${t.code}:nextAction" value="${esc(e.nextAction ?? t.nextAction)}" placeholder="Next action"></td>
        <td>${r ? (r.ok ? `<span class="save-state saved">Saved</span>` : `<span class="save-state failed">${esc(r.msg)}</span> ${btn("Compare and retry", `weeklyRetry:${t.code}`, { sm: true })}`) : e && Object.keys(e).length ? `<span class="save-state dirty">Unsaved</span>` : ""}</td></tr>`; }), "No active work to update")}`,
    { tools: btn("Save updates", "weeklySave", { primary: true, sm: true, disabled: !changed }), pad: true })}</div>
  <div class="stack">${callout("neutral", "Fair acceptance.", "A 100% update alone never completes work. Only the independent reviewer's Accept sets Completed, using the submission date.")}
    ${callout("neutral", "Recovery.", "Conflicting rows stay unsaved. Compare the latest version, then retry.")}${callout("warn", "Blocked or late?", "Open the task, then Dependencies, to report a blocker or request a new date. A requested date never silently improves performance.")}</div></div>`;
}
function depsTable() {
  const rows = [];
  for (const t of tasksInScope()) {
    for (const b of t.blockers) rows.push({ t, kind: "Blocker", r: b, text: `${b.category}${DELIVERY.BLOCKERS[b.category] ? "" : " (not excludable)"}`, sub: b.desc });
    for (const c of t.dateChanges) rows.push({ t, kind: "Date change", r: c, text: `${fd(c.from)} → ${fd(c.to)}`, sub: `${c.reason}: ${c.comment}` });
  }
  return panel("Blockers and deadline changes", table(["Request", "Task", "Requester", "Validator", "State", ""], rows.map(({ t, kind, r, text, sub }) => `<tr><td><b>${kind}</b> · ${esc(text)}<span class="sub">${esc(sub)}</span></td><td><a href="javascript:void 0" data-act="openTask:${t.code}:dependencies">${t.code}</a></td><td>${esc(pname(r.requester))}</td><td>${esc(pname(r.validator))}</td><td>${badge(r.state)}</td>
    <td>${r.state === "Pending" && r.validator === meEmp() && r.requester !== meEmp() ? `${btn("Validate", `dep:${t.code}:${r.id}:Validated`, { sm: true })} ${btn("Reject", `dep:${t.code}:${r.id}:Rejected`, { sm: true })}` : r.state === "Pending" && r.requester === meEmp() ? `<span class="note">You can't validate your own request</span>` : ""}</td></tr>`), "No blockers or date changes in your scope"), { pad: false, meta: "Separate validation records. Requesters can't validate their own requests." });
}

/* ------------------------------------------------------------------ Person ------------------------------------------------------------------ */
function viewPerson(id, tab) {
  const e = EMP[id], people = workPeople();
  if (!e || (people !== null && !people.has(id))) return panel("Not available", empty("This person isn't in your scope", "No details are shown.", `<a class="btn" href="#/home">Home</a>`));
  crumbs([["People"], [e.name]]);
  const rows = S.tasks.filter((t) => t.assignments.some((a) => a.emp === id)), active = rows.filter((t) => !["Completed", "Cancelled"].includes(t.status));
  const denom = active.reduce((s, t) => s + t.complexity * (t.assignments.find((a) => a.emp === id).share / 100), 0);
  const prog = denom ? Math.round(active.reduce((s, t) => s + t.progress * t.complexity * (t.assignments.find((a) => a.emp === id).share / 100), 0) / denom) : null;
  const rrRows = S.projects.filter((p) => p.rr?.raci?.some((r) => r.emp === id)).map((p) => {
    const r = p.rr.raci.find((x) => x.emp === id), sc = p.code === "PRJ-D01" ? RR.score(p) : null, mine = sc?.people.find((x) => x.emp === id);
    return `<tr><td><a href="#/projects/${p.code}/scorecard">${esc(p.title)}</a><span class="sub">${p.code}</span></td><td>${r.L}</td><td>${mine?.indiv != null ? `<b>${fmt2(mine.indiv)}</b>` : `<span class="muted">Scored at ${p.rr.mode === "programme" ? "quarter end" : "closure"}</span>`}</td><td>${mine?.indiv != null ? tier(mine.band) : "—"}</td></tr>`;
  });
  const head = `<div class="ph"><div class="titles"><h1><span class="row">${avatar(id, "lg")} ${esc(e.name)}</span></h1><p class="sub">${e.ill ? "Illustrative person (HR framework example)" : id} · ${esc(e.desig)} · ${esc(e.dept)}${e.manager ? " · reports to " + esc(pname(e.manager)) : ""}</p></div></div>
  ${tabs([["overview", "Overview"], ["work", "Assigned work"], ["history", "History"]], tab, (t) => `#/people/${id}/${t}`)}`;
  const workTable = table(["Task", "Role / share", "State", "Due in force", "Progress", "#Weighted output"], rows.map((t) => { const a = t.assignments.find((x) => x.emp === id); return `<tr class="clickable" data-act="openTask:${t.code}"><td><b>${esc(t.title)}</b><span class="sub">${t.code}</span></td><td>${a.role} · ${a.share}%</td><td>${badge(t.status)}</td><td>${fd(t.due)}</td><td>${t.status === "Completed" ? "Completed" : t.progress + "%"}</td><td class="n">${t.status === "Completed" ? fmt2(t.complexity * a.share / 100) : "—"}</td></tr>`; }), "No assigned work in your permitted projects");
  if (tab === "work") return head + panel("Assigned and completed tasks", workTable, { pad: false });
  if (tab === "history") return head + `<div class="grid grid-2">${panel("Identity", `<dl class="kv"><dt>Record</dt><dd>${e.ill ? "Illustrative" : id}</dd><dt>HRMS code</dt><dd class="muted">To reconcile before go-live</dd><dt>Designation</dt><dd>${esc(e.desig)}</dd><dt>Department</dt><dd>${esc(e.dept)}</dd>${e.dup ? `<dt>Name check</dt><dd class="warn-txt">Same name as another record. Pickers show ID, designation and department.</dd>` : ""}</dl>`)}
    ${panel("Reporting history", `<div class="small">${e.manager ? `From 01 Apr 2026 · reports to ${esc(pname(e.manager))}` : "No manager on record"}</div><p class="note mt">Effective-dated. A transfer keeps the same identity and locked history.</p>`)}</div>`;
  return head + `${figures([fig("Assigned work", rows.length, `Across ${new Set(rows.map((t) => t.project)).size} permitted project(s)`), fig("Completed task output", fmt2(DELIVERY.acceptedOutput(id)), "Complexity × contribution"), fig("Reported progress", prog == null ? "—" : prog + "%", "Active task update (planning only)"), fig("Overdue / blocked", `${active.filter((t) => DELIVERY.timing(t) === "Overdue").length} / ${active.filter((t) => t.status === "Block").length}`, "Active tasks")])}
  <div class="grid grid-main mt">${panel("Current contributions", workTable, { pad: false })}
  <div class="stack">${canSeePerf(id) ? panel("Project R&amp;R", rrRows.length ? table(["Project", "RACI", "Individual score", "Band"], rrRows) : empty("Not in any scored project"), { pad: !rrRows.length, meta: "Visible to their Manager, HOD and Admin" })
    : panel("Project R&amp;R", `<p class="hidden-role">Individual project scores are private to the person's Manager, HOD and Admin.</p>`)}
    ${callout("neutral", "KPIs, check-ins and training", "live in the Individual Tier.")}</div></div>`;
}
