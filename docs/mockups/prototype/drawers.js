/* Delivery drawers. Each builder returns {title, eyebrow, sub, body, foot, wide}. Saving goes through ACTIONS in app.js. */
const STATUS_OPTS = ["Planning", "Not Started", "In Progress", "Blocked", "In Review", "On Hold", "Cancelled"];

DRAWERS.project = () => ({
  eyebrow: "Projects", title: "Create a project", sub: "Priority is mandatory and has no default.",
  body: `<div class="form-grid">
    ${field("Project name", "title", inp("title", 'placeholder="Website launch follow-up" data-autofocus'), { req: true, full: true })}
    ${field("Priority", "priority", sel("priority", ["High", "Medium", "Low"], "Choose a priority…"), { req: true, help: "No preselected priority" })}
    ${field("Department", "dept", sel("dept", DEPARTMENTS), { req: true })}
    ${field("Project owner", "owner", `<select class="input" data-f="owner">${personOptions(fv("owner"))}</select>`, { req: true })}
    ${field("Project reviewer", "reviewer", `<select class="input" data-f="reviewer">${personOptions(fv("reviewer"), [fv("owner")])}</select>`)}
    ${field("Start date", "start", inp("start", 'type="date"'), { req: true })}
    ${field("Target date", "target", inp("target", 'type="date"'))}
    ${field("Start from", "template", sel("template", ["Email campaign", "Client Support issue flow"], "Blank project"), { full: true })}
    ${fv("template") === "Email campaign" ? `<div class="full">${callout("warn", "Named roles still need resolution.", "4 stages have reviewer conflicts and the Marketing POC isn't in the org chart. The project stays in Planning until they are resolved.")}</div>` : ""}
    ${field("Objective", "objective", txt("objective", "What will be true when this is done?"), { req: true, full: true })}
    <label class="check full"><input type="checkbox" data-f="rr" ${fv("rr") ? "checked" : ""} value="1"> Add to the Project R&amp;R pilot (opens a charter draft: value target, baseline, RACI and SLAs)</label>
  </div>`,
  foot: `${btn("Cancel", "closeDrawer")}${btn("Create project", "saveProject", { primary: true })}`,
});
DRAWERS.editProject = (code) => { const p = proj(code); return {
  eyebrow: p.code, title: "Update project",
  body: `<div class="form-grid">
    ${field("Priority", "priority", sel("priority", ["High", "Medium", "Low"], "Choose a priority…"), { req: true })}
    ${field("Business status", "status", sel("status", STATUS_OPTS), { req: true, help: "Completed is reached through the closure review. Delayed is derived from dates, never set." })}
    ${field("Target date", "target", inp("target", 'type="date"'))}
    ${field("Project reviewer", "reviewer", `<select class="input" data-f="reviewer">${personOptions(fv("reviewer"), [p.owner])}</select>`)}
    ${field("Objective", "objective", txt("objective"), { full: true })}</div>`,
  foot: `${btn("Cancel", "closeDrawer")}${btn("Save project", `saveEditProject:${code}`, { primary: true })}`,
}; };
DRAWERS.request = () => ({
  eyebrow: "Projects › Requests", title: "Request work from another department", sub: "A short brief. Your manager validates it, then the receiving POC accepts it into the calendar.",
  body: `<div class="form-grid">
    ${field("Workflow template", "template", sel("template", ["Email campaign"]), { req: true })}
    ${field("Request title", "title", inp("title"), { req: true })}
    ${field("Requesting department", "from", sel("from", DEPARTMENTS), { req: true })}
    ${field("Receiving team", "to", sel("to", ["Digital Marketing"]), { req: true })}
    ${field("Audience", "audience", inp("audience"), { req: true })}
    ${field("Required date", "required", inp("required", 'type="date"'), { req: true })}
    ${field("Priority", "priority", sel("priority", ["High", "Medium", "Low"]), { req: true })}
    ${field("Request validator", "validator", `<select class="input" data-f="validator">${personOptions(fv("validator"), [meEmp()])}</select>`, { req: true, help: "Requester's manager" })}
    ${field("Objective", "objective", inp("objective"), { req: true, full: true })}
    ${field("Brief / assets", "brief", txt("brief", "Approved copy and design references"), { req: true, full: true })}</div>
    <p class="note mt">Preview: 6 stages, about 9 business days (14 max). The content approval stage waits on the head of your department.</p>`,
  foot: `${btn("Cancel", "closeDrawer")}${btn("Submit request", "saveRequest", { primary: true })}`,
});
DRAWERS.task = (code) => {
  const projects = visibleProjects().filter((p) => !["Completed", "Cancelled"].includes(p.status) && p.rr?.mode !== "programme");
  const p = proj(fv("project")), rows = fv("rows", []), total = rows.reduce((s, r) => s + Number(r.share || 0), 0), ids = rows.map((r) => r.emp);
  return { eyebrow: p ? `${p.code} · ${p.title}` : "Tasks", title: "Create a task in context", sub: "New tasks start at Not started. Validation keeps your draft.", wide: true,
    body: `<div class="form-grid">
      ${field("Task title", "title", inp("title", 'placeholder="Review onboarding screens" data-autofocus'), { req: true, full: true })}
      ${field("Project", "project", sel("project", projects.map((x) => [x.code, `${x.code} · ${x.title}`])), { req: true })}
      ${field("Description", "description", txt("description"), { req: true, full: true })}
      ${field("Start date", "start", inp("start", 'type="date"'))}
      ${field("End date", "due", inp("due", 'type="date"'), { help: "Planned deadline. Later changes need independent validation." })}
      ${field("Go live date", "goLive", inp("goLive", 'type="date"'), { help: "Release date, when known. Does not mark the task as accepted." })}
      ${field("Complexity / 1-5", "complexity", sel("complexity", ["1", "2", "3", "4", "5"]), { req: true })}
      ${field("Independent reviewer", "reviewer", `<select class="input" data-f="reviewer">${personOptions(fv("reviewer"))}</select>`, { req: true, help: ids.includes(fv("reviewer")) ? `<span class="bad-txt">The reviewer is an assignee. Choose another person.</span>` : "Can't be any assignee" })}
      <div class="field full" data-field="rows"><label>Assignments <span class="req">*</span></label>
        ${rows.map((r, i) => `<div class="row" style="margin-bottom:6px"><select class="select-sm" data-row="${i}:role"><option ${r.role === "Owner" ? "selected" : ""}>Owner</option><option ${r.role === "Contributor" ? "selected" : ""}>Contributor</option></select>
          <select class="input" style="flex:1" data-row="${i}:emp">${personOptions(r.emp)}</select><input class="mini-in" type="number" data-row="${i}:share" value="${r.share}" aria-label="Contribution share %">%
          ${rows.length > 1 ? `<button class="icon-btn" data-act="rowDel:${i}" aria-label="Remove assignment">${icon(I.x)}</button>` : ""}</div>`).join("")}
        <div class="row"><button class="btn sm" data-act="rowAdd">${icon(I.plus)} Add contributor</button><span class="note ${total === 100 ? "ok-txt" : "warn-txt"}">Shares total ${total}% (must be 100%) · exactly one Owner</span></div>${fieldErr("rows")}</div>
      ${field("Acceptance checklist (one per line)", "checklist", txt("checklist", "Matches the agreed brief\nResponsive states checked"), { full: true })}
      ${field("Required evidence", "evidenceReq", inp("evidenceReq", 'placeholder="Design file + checklist"'), { full: true })}</div>`,
    foot: `${btn("Cancel", "closeDrawer")}${btn("Create task", "saveTask", { primary: true })}` };
};

/* Task drawer: one view, no tabs. Header, facts, update, one state-dependent primary action, blocker/date links, and an
   "Edit assignees" link for managers. History lives in the project's Audit logs. */
const canEditAssignees = (t) => S.persona !== "tl" && (canManageProject(proj(t.project)) || canUpdateTask(t));
DRAWERS.t = (code) => {
  const t = task(code), p = proj(t.project), f = DRAWER.form, mode = f.mode || null, can = canUpdateTask(t), locked = ["In Review", "Completed", "Rework"].includes(t.status);
  const tm = DELIVERY.timing(t), late = tm === "Overdue" ? daysBetween(t.due, TODAY) : 0, moved = t.dueOriginal && t.dueOriginal !== t.due ? t.dueOriginal : null;
  const sec = (title, body, extra = "") => `<section class="tsec${extra}">${title ? `<h3>${title}</h3>` : ""}${body}</section>`;
  const parts = [];

  // 2. Facts line
  const dates = DELIVERY.taskDates(t);
  parts.push(`<div class="tfacts"><span>Start date <b>${fd(t.start)}</b></span><span>End date <b>${fd(t.due)}</b>${moved ? ` <span class="muted">(moved from ${fd(moved, false)})</span>` : ""}</span><span>Go live date <b>${fd(t.goLive)}</b></span><span>Actual working days <b>${dates.working ?? "—"}</b></span><span>Delay (No. of days) <b class="${dates.delay > 0 ? "bad-txt" : ""}">${dates.delay ?? "—"}</b></span><span>Status ${badge(t.status)}</span><span>Complexity <b>${t.complexity}</b></span><span>Reported progress <b>${t.progress}%</b></span>${t.desc ? `<span class="tdesc">${esc(t.desc)}</span>` : ""}</div><p class="note">${TASK_DATE_NOTE}</p>`);
  if (can && S.persona !== "tl" && !["Completed", "Cancelled"].includes(t.status)) {
    parts.push(sec("", mode === "dates" ? `<div class="form-grid">
      ${field("Start date", "start", inp("start", 'type="date"'))}
      ${field("Go live date", "goLive", inp("goLive", 'type="date"'))}</div>
      <p class="note mt">To change the end date, use Request a new date below.</p>
      <div class="tsec-actions">${btn("Cancel", "tmode:dates", { sm: true })}${btn("Save dates", `taskDatesSave:${code}`, { sm: true, primary: true })}</div>`
      : `<button class="link-btn" data-act="tmode:dates">Edit dates</button>`));
  }

  // 6. Edit assignees (managers only), inline
  if (mode === "assign") {
    const rows = f.rows, total = rows.reduce((x, r) => x + Number(r.share || 0), 0), ids = rows.map((r) => r.emp);
    parts.push(sec("Edit assignees", `${rows.map((r, i) => `<div class="row" style="margin-bottom:8px"><select class="select-sm" data-row="${i}:role"><option ${r.role === "Owner" ? "selected" : ""}>Owner</option><option ${r.role === "Contributor" ? "selected" : ""}>Contributor</option></select>
        <select class="input" style="flex:1;min-width:0" data-row="${i}:emp">${personOptions(r.emp)}</select><input class="mini-in" type="number" data-row="${i}:share" value="${r.share}" aria-label="Contribution share %">%${rows.length > 1 ? `<button class="icon-btn" data-act="rowDel:${i}" aria-label="Remove">${icon(I.x)}</button>` : ""}</div>`).join("")}
      <div class="row"><button class="btn sm" data-act="rowAdd">${icon(I.plus)} Add contributor</button><span class="note ${total === 100 ? "ok-txt" : "warn-txt"}">Shares total ${total}% · exactly one Owner</span></div>${fieldErr("rows")}
      <div class="form-grid mt">${field("Independent reviewer", "reviewer", `<select class="input" data-f="reviewer">${personOptions(f.reviewer)}</select>`, { req: true, help: ids.includes(f.reviewer) ? `<span class="bad-txt">The reviewer is an assignee. Choose another person.</span>` : "Can't be any assignee" })}
        ${field("Change reason", "reason", inp("reason", 'placeholder="Split design and integration work"'), { req: true })}</div>
      <div class="tsec-actions">${btn("Cancel", "tmode:assign", { sm: true })}${btn("Save assignees", `assignSave:${code}`, { sm: true, primary: true })}</div>`, " tsec-open"));
  }

  // 3. Update section (hidden for accepted work, which is read-only)
  if (can && !["Completed", "Cancelled"].includes(t.status)) {
    const submitted = t.status === "In Review";
    parts.push(sec("Update", `${locked ? `<p class="tlock">${icon(I.flag)} Status <b>${LABEL[t.status] ?? t.status}</b> is set by the review workflow.</p>` : ""}
      <div class="form-grid tgrid${locked ? " locked" : ""}${submitted ? " nostat" : ""}">
        ${locked ? "" : field("Status", "status", `<select class="input" data-f="status">${statusOptions(fv("status"))}</select>`)}
        ${submitted ? "" : field("Progress %", "progress", inp("progress", 'type="number" min="0" max="100" title="Reported progress is planning only; 100% never means accepted"'))}
        ${field("Next action", "nextAction", inp("nextAction", 'placeholder="What happens next"'))}
        <div class="tsave">${btn("Save update", `taskSave:${code}`, { sm: true })}</div></div>`));
  }

  // 4. One primary action by state
  const sub = t.submissions.at(-1), lastRework = [...t.decisions].reverse().find((d) => d.decision === "rework");
  if (t.status === "Completed") {
    parts.push(sec("", `<div class="callout ok">${icon(I.ok)}<span><b>Completed on ${fd(t.acceptedOn)}</b>${t.acceptedOn > t.due ? ` · <span class="bad-txt">after the due date</span>` : " · on time"}. Reviewed by ${esc(pname(t.reviewer))}; the accepted submission's date is the completion date.</span></div>`));
  } else if (t.status === "In Review") {
    const files = sub?.files?.length ? sub.files.map(esc).join(", ") : "no files";
    if (isReviewerOf(t)) {
      const failed = f.failed || [];
      parts.push(sec("Review submission v" + sub.v, `<p class="small">Submitted ${fd(sub.date)} by ${esc(pname(sub.by))} · ${files}</p>${sub.note ? `<p class="small muted">“${esc(sub.note)}”</p>` : ""}
        ${mode === "rework" ? `<div class="tsub">
            <div class="field" data-field="failed"><label>Which criteria failed?</label>${t.checklist.map((c) => `<label class="check"><input type="checkbox" data-failed="${esc(c)}" ${failed.includes(c) ? "checked" : ""}> ${esc(c)}</label>`).join("") || `<span class="note">No checklist on this task.</span>`}${fieldErr("failed")}</div>
            ${field("Feedback for the assignee", "feedback", txt("feedback", "What to change, and how you'll check it"), { req: true })}
            <label class="check"><input type="checkbox" data-f="reqChanged" value="1" ${f.reqChanged ? "checked" : ""}> The requirement changed (excluded from Quality)</label>
            <div class="tsec-actions">${btn("Cancel", "tmode:rework", { sm: true })}${btn("Send to rework", `review:${code}:rework`, { sm: true, danger: true })}</div></div>`
          : `<div class="tsec-actions start">${btn("Accept work", `review:${code}:accept`, { primary: true })}${btn("Send to rework", "tmode:rework")}<span class="note">Accept dates completion ${fd(sub.date, false)}, the submission date.</span></div>`}`));
    } else parts.push(sec("", `<p class="small muted">Waiting for ${esc(pname(t.reviewer))} to review v${sub.v}, submitted ${fd(sub.date)}. Only the named reviewer can accept or send it to rework.</p>`));
  } else if (can && t.status !== "Cancelled") {
    const chosen = f.files || [];
    parts.push(sec("", `${lastRework ? `<div class="callout warn" style="margin-bottom:12px">${icon(I.warn)}<span><b>Returned for rework ${fd(lastRework.at, false)}:</b> ${esc(lastRework.feedback)}</span></div>` : ""}
      ${mode === "submit" ? `<h3>Send for review</h3><div class="tsub">
          ${t.evidenceReq ? `<p class="small"><b>Required evidence:</b> ${esc(t.evidenceReq)}</p>` : ""}
          <div class="field" data-field="files"><label>Evidence files <span class="req">*</span></label>${t.files.length ? t.files.map((x) => `<label class="check"><input type="checkbox" data-file="${esc(x.name)}" ${chosen.includes(x.name) ? "checked" : ""}> ${esc(x.name)} <span class="muted small">${x.size} · ${fd(x.at, false)}</span></label>`).join("") : `<span class="note">No files yet.</span>`}
            <div>${btn(`${icon(I.upload)} Upload file`, `upload:${code}`, { sm: true })}</div>${fieldErr("files")}</div>
          ${t.checklist.length ? `<div class="field" data-field="confirmed"><label class="check"><input type="checkbox" data-f="confirmed" value="1" ${f.confirmed ? "checked" : ""}> I checked the acceptance checklist: ${esc(t.checklist.join("; "))}</label>${fieldErr("confirmed")}</div>` : ""}
          <div class="form-grid tgrid">${field("Submission date", "subDate", inp("subDate", `type="date" max="${TODAY}"`), { req: true, help: "No future dates. If accepted, this is the completion date." })}
            ${field("Note for the reviewer", "note", inp("note"))}</div>
          <div class="tsec-actions">${btn("Cancel", "tmode:submit", { sm: true })}${btn("Send for review", `submit:${code}`, { sm: true, primary: true })}</div></div>`
        : `<div class="tsec-actions start">${btn("Send for review", "tmode:submit", { primary: true })}<span class="note">Creates an immutable version for ${esc(pname(t.reviewer))} to review.</span></div>`}`));
  }

  // 5. Blockers and date changes
  const deps = [...t.blockers.map((b) => ({ k: "Blocker", r: b, txt: `${b.category}${DELIVERY.BLOCKERS[b.category] ? "" : " (not excludable)"} · since ${fd(b.since, false)}` })), ...t.dateChanges.map((c) => ({ k: "New date", r: c, txt: `${fd(c.from, false)} → ${fd(c.to, false)} · ${c.reason}` }))].filter((x) => x.r.state !== "Rejected");
  const depForm = mode === "blocker" || mode === "date";
  const depHtml = `${deps.map(({ k, r, txt: x }) => `<div class="tdep"><span>${badge(r.state)} <b>${k}</b> · ${esc(x)} <span class="muted">· validator ${esc(pname(r.validator))}</span></span>${r.state === "Pending" && r.validator === meEmp() && r.requester !== meEmp() ? `<span class="row">${btn("Validate", `dep:${code}:${r.id}:Validated`, { sm: true })}${btn("Reject", `dep:${code}:${r.id}:Rejected`, { sm: true })}</span>` : ""}</div>`).join("")}
    ${can && t.status !== "Completed" && t.status !== "Cancelled" ? `<div class="tlinks">${["blocker", "date"].map((m) => `<button class="link-btn ${mode === m ? "on" : ""}" data-act="tmode:${m}">${m === "blocker" ? "Report a blocker" : "Request a new date"}</button>`).join("<span class=\"muted\">·</span>")}${canEditAssignees(t) ? `<span class="muted">·</span><button class="link-btn ${mode === "assign" ? "on" : ""}" data-act="tmode:assign">Edit assignees</button>` : ""}</div>` : canEditAssignees(t) && t.status !== "Completed" ? `<div class="tlinks"><button class="link-btn" data-act="tmode:assign">Edit assignees</button></div>` : ""}
    ${depForm ? `<div class="tsub"><div class="form-grid tgrid">
        ${field("Category", "cat", sel("cat", Object.keys(DELIVERY.BLOCKERS)), { req: true, help: f.cat ? (DELIVERY.BLOCKERS[f.cat] ? (f.cat === "Resource" ? "Excludable once the HOD validates it." : "Excludable once validated.") : "Not excludable: still counts as a delay.") : "" })}
        ${mode === "blocker" ? field("Blocked since", "since", inp("since", `type="date" max="${TODAY}"`), { req: true }) : field("New due date", "newDate", inp("newDate", 'type="date"'), { req: true, help: `${fd(t.due, false)} stays in force until validated.` })}
        ${field("Short reason", "desc", inp("desc"), { req: true, full: true })}
        ${field("Evidence", "evidence", inp("evidence", 'placeholder="Ticket, email or record"'), { req: true })}
        ${field("Validator", "validator", `<select class="input" data-f="validator">${personOptions(f.validator, [meEmp()])}</select>`, { req: true, help: "Not you" })}</div>
      <div class="tsec-actions">${btn("Cancel", "tmode:" + mode, { sm: true })}${btn("Send for validation", `depSave:${code}`, { sm: true, primary: true })}</div></div>` : ""}`;
  if (depHtml.trim()) parts.push(sec("", depHtml, " tsec-quiet"));

  if (!can) parts.unshift(`<p class="small muted" style="margin-bottom:12px">Read-only: this task is outside the team you update.</p>`);
  const timing = `${badge(tm)}${late ? ` <span class="bad-txt small"><b>${late} day${late > 1 ? "s" : ""} overdue</b></span>` : ""}`;
  return { eyebrow: `${t.code} · ${p.title}`, title: t.title, wide: true,
    sub: `<span class="row" style="gap:6px;margin-top:6px">${badge(t.status)}${timing}<span class="muted">·</span>${avatar(owner(t))}<span>Owner <b>${esc(pname(owner(t)))}</b>${t.assignments.length > 1 ? ` +${t.assignments.length - 1}` : ""}</span><span class="muted">·</span><span>Reviewer <b>${esc(pname(t.reviewer))}</b></span></span>`,
    body: parts.join(""), foot: `<span class="note" style="margin-right:auto">History is in the project's <a href="#/projects/${p.code}/audit" data-act="go:#/projects/${p.code}/audit">Audit logs</a>.</span>${btn("Close", "closeDrawer")}` };
};
DRAWERS.risk = (arg) => { const [code, idx] = arg.split("|");
  return { eyebrow: code, title: idx ? "Update risk" : "Record and mitigate a project risk",
    body: `<div class="form-grid">${field("Risk", "risk", inp("risk"), { req: true, full: true })}${field("Stage", "stage", inp("stage"), { req: true })}${field("Criticality", "crit", sel("crit", ["Low", "Medium", "High", "Critical"]), { req: true })}
      ${field("Owner", "owner", `<select class="input" data-f="owner">${personOptions(fv("owner"))}</select>`, { req: true })}${field("Next review date", "next", inp("next", 'type="date"'), { req: true })}${field("Status", "state", sel("state", ["Open", "Mitigating", "Closed"]), { req: true })}
      ${field("Dependency", "deps", inp("deps"), { full: true })}${field("Assumption", "assumptions", inp("assumptions"), { full: true })}${field("Mitigation", "mitigation", txt("mitigation"), { req: true, full: true })}</div>`,
    foot: `${btn("Cancel", "closeDrawer")}${btn("Save risk", `saveRisk:${code}:${idx ?? ""}`, { primary: true })}` }; };
