/* Self-test: open the prototype with ?selftest. Drives the real actions and checks the rules; the result goes in the page title and a <pre>. */
if (location.search.includes("selftest")) {
  window.confirm = () => true; window.prompt = () => "Self-test reason";
  const out = [], ok = (name, cond) => out.push((cond ? "PASS " : "FAIL ") + name);
  const text = () => document.body.innerText;
  const visit = (h) => { location.hash = h; render(); };
  const peek = (h) => render(h); // render a route without changing the URL, for read-only sweeps over many screens
  const as = (p) => { S.persona = p; render(); };
  const form = (o) => { Object.assign(DRAWER.form, o); };
  const click = (sel) => { const el = document.querySelector(sel); if (!el) throw new Error("missing " + sel); el.click(); };
  try {
    // Every route renders for every persona without throwing
    const routes = ["#/home", "#/projects", "#/projects?view=list", "#/projects?view=timeline", "#/projects?tab=requests", "#/tasks/team", "#/tasks/weekly", "#/tasks/review", "#/tasks/dependencies", "#/recognition", "#/people/EMP-0082/overview", "#/people/EMP-0082/work", "#/people/ILL-02/overview",
      ...["overview", "tasks", "timeline", "risks", "charter", "delays", "scorecard", "closure", "audit"].map((t) => `#/projects/PRJ-015/${t}`), "#/projects/PRJ-015/tasks?view=table", "#/projects/PRJ-015/timeline?done=hide", "#/projects/PRJ-D05/timeline",
      ...["charter", "delays", "scorecard"].map((t) => `#/projects/PRJ-D01/${t}`), ...["runs", "charter", "tasks", "scorecard"].map((t) => `#/projects/PRJ-D05/${t}`), "#/projects/PRJ-D04/charter",
      "#/admin/access", "#/admin/grants", "#/admin/imports", "#/admin/audit", "#/workflows/templates", "#/workflows/raci", "#/workflows/calendar", "#/workflows/inputs", "#/policy"];
    let crashes = 0;
    for (const p of ["admin", "manager", "hod", "tl"]) { as(p); for (const r of routes) { try { peek(r); } catch (e) { crashes++; out.push(`ERROR ${p} ${r}: ${e.message}`); } } }
    ok("All routes render for all four personas", crashes === 0);
    as("admin");
    // Task statuses come from the team's tracker dropdown; Completed is listed but only Accept sets it
    ok("Task statuses are the tracker's 18, in its order", DELIVERY.TASK_STATUSES.join("|") === "Not Started|In Progress|Completed|On Hold|Delayed|Testing QA|Exotel Vendor|Pending|In Development|Block|Production|Ready For Live|Product|Vendor|Live Today|Unit testing|Internal CUG|Live");
    openTask("PRJ-015-T02"); const opts = [...document.querySelectorAll('.drawer select[data-f="status"] option')];
    ok("Task drawer status picker lists all 18, with Completed disabled", opts.length === 18 && opts.find((o) => /Completed/.test(o.textContent))?.disabled && opts.some((o) => o.value === "Exotel Vendor"));
    form({ status: "Live" }); ACTIONS.taskSave("PRJ-015-T02"); ok("Setting Live is a label: the task isn't accepted", task("PRJ-015-T02").status === "Live" && !task("PRJ-015-T02").acceptedOn);
    form({ status: "Completed" }); ACTIONS.taskSave("PRJ-015-T02"); ok("Completed can't be set by hand", task("PRJ-015-T02").status === "Live"); closeDrawer(true); task("PRJ-015-T02").status = "In Progress";
    visit("#/projects/PRJ-015/tasks?view=board"); ok("Board has six lanes and every task sits in one", document.querySelectorAll(".kcol").length === 6 && document.querySelectorAll(".kcol .kcard").length === S.tasks.filter((t) => t.project === "PRJ-015" && t.status !== "Cancelled").length);
    visit("#/tasks/weekly"); ok("Weekly grid status picker uses the same list", [...document.querySelectorAll('select[data-weekly$=":status"]')].every((x) => x.options.length === 18));
    // Table is the primary task view; Board is second
    visit("#/projects/PRJ-015/tasks"); const seg = [...document.querySelectorAll("#view .seg button")];
    ok("Project Tasks opens in Table by default, with Table first and Board second", !document.querySelector(".kcol") && [...document.querySelectorAll("#view th")].some((th) => th.textContent === "Start date")
      && seg.map((b) => b.textContent).join() === "Table,Board" && seg[0].getAttribute("aria-pressed") === "true");
    // "Accepted" labels for finished tasks now read "Completed tasks" (wording only; Completed still needs Accept)
    const acceptedLabels = [];
    for (const r of ["#/home", "#/projects?view=list", "#/projects", "#/projects?view=timeline", "#/projects/PRJ-015/overview", "#/projects/PRJ-015/tasks", "#/projects/PRJ-015/timeline", "#/projects/PRJ-015/delays", "#/projects/PRJ-015/scorecard", "#/projects/PRJ-015/closure", "#/projects/PRJ-D05/runs", "#/projects/PRJ-D01/scorecard", "#/tasks/team", "#/people/EMP-0082/overview", "#/people/EMP-0082/work"]) {
      peek(r); for (const el of document.querySelectorAll("#view th, #view .figure .lbl, #view .figure .hint, #view .panel-h, #view .gx-tools, #view label, #view td, #view .kcard")) if (/\bAccepted\b(?! into)/.test(el.textContent) && !/campaign|request/i.test(el.textContent)) acceptedLabels.push(r + ": " + el.textContent.trim().slice(0, 40));
    }
    ok("No Accepted / Accepted work / Accepted delivery labels remain" + (acceptedLabels.length ? ": " + acceptedLabels.slice(0, 3).join(" | ") : ""), !acceptedLabels.length);
    visit("#/home"); ok("Home figure reads Completed tasks", [...document.querySelectorAll("#view .figure .lbl")].some((l) => l.textContent === "Completed tasks"));
    visit("#/projects/PRJ-015/overview"); ok("Project overview figure reads Completed tasks", [...document.querySelectorAll("#view .figure .lbl")].some((l) => l.textContent === "Completed tasks"));
    visit("#/people/EMP-0082/work"); ok("Person page shows Assigned and completed tasks, with Completed on finished rows", text().includes("Assigned and completed tasks") && [...document.querySelectorAll("#view td")].some((td) => td.textContent === "Completed"));
    visit("#/projects/PRJ-015/tasks"); ok("Task table marks a finished task Completed", [...document.querySelectorAll("#view td")].some((td) => td.textContent.trim().endsWith("Completed") && td.querySelector(".sub")));
    // A ?task= deep link opens its drawer once; closing it and clicking elsewhere must not reopen it
    visit("#/tasks/team?task=PRJ-015-T01"); ok("Task deep link opens the drawer", DRAWER?.kind === "t" && DRAWER.arg === "PRJ-015-T01");
    closeDrawer(true); render(); click('[data-act^="openTask:"]'); closeDrawer(true); render(); render();
    ok("Closed drawer stays closed on later clicks, and the link is cleared", !DRAWER && !document.querySelector(".drawer") && !location.hash.includes("task="));

    // Mandatory priority, no default
    ACTIONS.drawer("project"); form({ title: "Test project", dept: "Product", owner: "EMP-0081", start: TODAY, objective: "Test" }); ACTIONS.saveProject();
    ok("Create project is blocked without a priority", DRAWER?.errors.some((e) => e.field === "priority"));
    form({ priority: "Low" }); ACTIONS.saveProject(); ok("Project created once a priority is chosen", S.projects[0].title === "Test project" && S.projects[0].status === "Planning");

    // Task validation: shares, one owner, reviewer not an assignee
    ACTIONS.drawer("task", "PRJ-015"); form({ title: "T", description: "d", rows: [{ role: "Owner", emp: "EMP-0082", share: 60 }, { role: "Contributor", emp: "EMP-0083", share: 30 }], reviewer: "EMP-0082" }); ACTIONS.saveTask();
    ok("Task create rejects 90% shares and an assignee reviewer, keeps the draft", DRAWER.errors.some((e) => /total 90%/.test(e.msg)) && DRAWER.errors.some((e) => e.field === "reviewer") && DRAWER.form.title === "T");
    form({ rows: [{ role: "Owner", emp: "EMP-0082", share: 60 }, { role: "Contributor", emp: "EMP-0083", share: 40 }], reviewer: "EMP-0081", goLive: "2026-11-04" }); ACTIONS.saveTask();
    ok("Valid task created as Not started with its separate go-live date", S.tasks.at(-1).title === "T" && S.tasks.at(-1).status === "Not Started" && S.tasks.at(-1).goLive === "2026-11-04" && !DRAWER);

    // Review: reviewer accepts; completion date = submission date
    as("manager"); ok("Manager's review queue lists T01", (visit("#/tasks/review"), text().includes("Homepage hero redesign")));
    openTask("PRJ-015-T01"); ok("Task drawer is one view with no tab bar", document.querySelector(".drawer") && !document.querySelector(".drawer .tabs") && !!document.querySelector('.drawer [data-act="review:PRJ-015-T01:accept"]')); ACTIONS.review("PRJ-015-T01", "accept");
    const t1 = task("PRJ-015-T01"); ok("Accept sets Completed dated by the submission (17 Oct), on time", t1.status === "Completed" && t1.acceptedOn === "2026-10-17" && DELIVERY.timing(t1) === "On time");

    // Rework needs feedback
    openTask("PRJ-015-T07"); ok("Rework task status is locked with a note, not editable", !!document.querySelector(".drawer .tlock") && !document.querySelector('.drawer [data-field="status"] select')); closeDrawer(true);

    // Submission: future date rejected, evidence and checklist required
    as("admin"); openTask("PRJ-015-T02"); ACTIONS.tmode("submit"); form({ subDate: "2026-12-01", files: [], confirmed: false }); ACTIONS.submit("PRJ-015-T02");
    ok("Send for review rejects a future date, missing evidence and an unconfirmed checklist", DRAWER.errors.length >= 2 && task("PRJ-015-T02").status === "In Progress");
    form({ subDate: TODAY, confirmed: true }); ACTIONS.upload("PRJ-015-T02"); ACTIONS.submit("PRJ-015-T02");
    ok("Send for review creates immutable v1 and sets In review", task("PRJ-015-T02").status === "In Review" && task("PRJ-015-T02").submissions.length === 1); closeDrawer(true);
    as("manager"); openTask("PRJ-015-T02"); ACTIONS.tmode("rework"); form({ feedback: "" }); ACTIONS.review("PRJ-015-T02", "rework");
    ok("Rework without feedback is refused", DRAWER?.errors.some((e) => e.field === "feedback") && task("PRJ-015-T02").status === "In Review");
    form({ feedback: "Brokerage table still shows the old rate", failed: ["Brokerage table matches the rate card"] }); ACTIONS.review("PRJ-015-T02", "rework");
    ok("Rework with feedback and a failed criterion returns the task", task("PRJ-015-T02").status === "Rework" && task("PRJ-015-T02").due === "2026-10-28");
    as("tl"); openTask("PRJ-D07-T01"); ok("Team Lead sees no Edit assignees link", !document.querySelector('.drawer [data-act="tmode:assign"]')); closeDrawer(true);
    as("manager"); openTask("PRJ-015-T06"); ACTIONS.tmode("assign"); form({ rows: [{ role: "Owner", emp: "EMP-0084", share: 100 }], reviewer: "EMP-0084", reason: "x" }); ACTIONS.assignSave("PRJ-015-T06");
    ok("Edit assignees still refuses an assignee as reviewer", DRAWER.errors.some((e) => e.field === "reviewer")); closeDrawer(true);

    // Blocker validation: requester can't validate own; validator can
    as("manager"); ACTIONS.dep("PRJ-015-T03", "BLK-31", "Validated");
    ok("Validator validates the blocker", task("PRJ-015-T03").blockers[0].state === "Validated");
    ACTIONS.dep("PRJ-015-T08", "DCR-08", "Validated"); ok("Validated date change moves the due date in force, keeps the original", task("PRJ-015-T08").due === "2026-11-07" && task("PRJ-015-T08").dueOriginal === "2026-10-30");

    // Only the named validator decides; Admin can't validate someone else's request; High priority closure needs the HOD
    S.tasks.find((t) => t.code === "PRJ-015-T03").blockers.push({ id: "BLK-X", category: "Technical issue", desc: "x", since: TODAY, evidence: "x", requester: "EMP-0084", validator: "EMP-0081", state: "Pending" });
    as("admin"); ACTIONS.dep("PRJ-015-T03", "BLK-X", "Validated"); ok("Admin can't validate a blocker named to Pradeep", task("PRJ-015-T03").blockers.at(-1).state === "Pending");
    const pd = proj("PRJ-015"); pd.closure = { state: "Submitted", notes: {}, submittedBy: "EMP-0082" }; ok("High-priority closure: Admin can't decide, the Product HOD would", !canDecideClosure(pd)); pd.closure = { state: "Draft", notes: {} };
    as("manager");
    // Weekly grid: per-row result with a conflict, then retry
    WEEKLY = { "PRJ-015-T06": { progress: "20" }, "PRJ-015-T08": { progress: "40" } }; ACTIONS.weeklySave();
    ok("Weekly save keeps the conflicting row and saves the other", WEEKLY_RESULT["PRJ-015-T06"].ok && !WEEKLY_RESULT["PRJ-015-T08"].ok && task("PRJ-015-T06").progress === 20);
    ACTIONS.weeklyRetry("PRJ-015-T08"); ok("Retry saves the conflicting row", task("PRJ-015-T08").progress === 40);

    // Requests: HOD validates, receiving POC (Admin) accepts → new programme run
    as("hod"); ACTIONS.req("REQ-04", "validate"); as("admin"); ACTIONS.req("REQ-04", "accept");
    ok("Accepted request becomes run R4 of PRJ-D05", S.requests.find((r) => r.id === "REQ-04").state === "Accepted" && proj("PRJ-D05").rr.runs.some((r) => r.id === "R4"));

    // Closure: High priority D03 approved by Admin; PRJ-015 can't submit while tasks are open
    ACTIONS.closure("PRJ-D03", "approve"); ok("Closure approval completes PRJ-D03", proj("PRJ-D03").status === "Completed");
    ok("PRJ-015 closure isn't ready while work is open", !closureReadiness(proj("PRJ-015")).ready);

    // Workspace tabs and the timeline
    as("admin"); S.tasks.find((x) => x.code === "PRJ-015-T07").status = "Rework"; visit("#/projects/PRJ-015/timeline");
    const tabsText = [...document.querySelectorAll(".tabs button")].map((b) => b.textContent);
    ok("Workspace has no Milestones or Incidents tab, and has Audit logs", !tabsText.some((x) => /Milestones|Incidents/.test(x)) && tabsText.includes("Audit logs"));
    const dated = S.tasks.filter((x) => x.project === "PRJ-015" && x.due && x.status !== "Cancelled").length;
    ok("Timeline draws one bar per dated task and a Today tag, with no milestones anywhere", document.querySelectorAll(".gx-bar").length === dated && text().includes("Today · 22 Oct") && !/milestone/i.test(document.querySelector("#view").innerText));
    ok("Timeline flags overdue work and lists undated tasks", text().includes("1 day overdue") && /Not on the timeline[\s\S]*Accessibility contrast pass/.test(text()) && document.querySelector(".gx-over"));
    ok("Moved due date shows the dashed original-date marker", text().includes("moved from 30 Oct") && document.querySelector(".gx-ghost"));
    visit("#/projects/PRJ-015/timeline?done=hide"); ok("Hide accepted work removes accepted bars", document.querySelectorAll(".gx-bar.s-done").length === 0);
    ok("Business days skip the 20 Oct holiday in any time zone", addBdays("2026-10-19", 1) === "2026-10-21" && bdays("2026-10-19", "2026-10-21") === 1);

    // Project R&R
    visit("#/projects/PRJ-D01/scorecard"); ok("PRJ-D01 scores 88.00 under §3.2", text().includes("88.00"));
    S.p9doc = true; render(); ok("P9 doc reading gives 87.00, ₹2,31,000 and ₹39,000", text().includes("87.00") && text().includes("₹2,31,000") && text().includes("₹39,000")); S.p9doc = false;
    const res = RR.resolve(EMAIL_TEMPLATE.stages, "MUKESH"), nav = res.rows.find((x) => x.id === "EMP-0118"), mit = res.rows.find((x) => x.id === "EMP-0153");
    ok("RACI.xlsx: Naveen resolves to one R at 45.7%, C dropped; Miteeksha 42.0%", nav.L === "R" && nav.share.toFixed(3) === "0.457" && nav.dropped.includes("C") && mit.share.toFixed(3) === "0.420" && nav.suggested === 1);
    ok("C4 short-stage rule: 2 bd stage flagged on day 2 is late", RR.c4(2, "2026-10-14", "2026-10-16", "2026-10-16").miss === true && RR.c4(2, "2026-10-14", "2026-10-16", "2026-10-15").miss === false);
    ACTIONS.rrFixMukesh(); for (const s of [2, 4, 5, 6]) proj("PRJ-D05").rr.reviewers[s] = "EMP-0081"; ACTIONS.rrConfirm("EMP-0118"); ACTIONS.rrConfirm("EMP-0153"); proj("PRJ-D05").rr.c.target = 1200; ACTIONS.rrMetrics();
    ACTIONS.rrSubmit(); ACTIONS.rrSponsor(); ACTIONS.rrPmo(); ok("PRJ-D05 charter locks after sponsor + PMO", proj("PRJ-D05").rr.charter === "Locked");
    ACTIONS.drawer("delay", "PRJ-D05"); form({ task: "R3 · Client Support feedback survey", stage: "3", cause: "E2", due: "2026-10-23", reason: "Waiting for TRAI template approval" }); ACTIONS.rrSaveDelay("PRJ-D05");
    ok("Excused delay without evidence is refused", DRAWER?.errors.some((e) => e.field === "evidence"));
    form({ evidence: "TRAI portal reference" }); ACTIONS.rrSaveDelay("PRJ-D05"); ok("Delay logged as E2", proj("PRJ-D05").rr.delays.at(-1).cat === "E2");
    // No milestones: delivery timelines and delays come from tasks (one late task = one delay)
    ok("Seed PRJ-015 timelines from tasks: 1 of 3 due tasks on the baseline date, T05 and T07 late", (() => { const live = S; S = seedData(); const tl = RR.taskTimelines("PRJ-015"); S = live; return tl.onTime === 1 && tl.due === 3 && tl.late.map((t) => t.code).join() === "PRJ-015-T05,PRJ-015-T07"; })());
    visit("#/projects/PRJ-015/delays"); ok("Delay log lists the late tasks without a delay entry", text().includes("Late tasks without a delay entry") && text().includes("Footer and legal links update") && text().includes("SEO meta audit"));
    ACTIONS.drawer("delay", "PRJ-015", "PRJ-015-T05"); form({ cause: "C2", reason: "Legal links reviewed a day late" }); ACTIONS.rrSaveDelay("PRJ-015");
    const d15 = proj("PRJ-015").rr.delays.at(-1); ok("Delay logged on the task with its baseline due date", d15?.taskCode === "PRJ-015-T05" && d15.cat === "C2" && !DRAWER);
    ACTIONS.drawer("delay", "PRJ-015", "PRJ-015-T05"); form({ cause: "C2", reason: "Again" }); ACTIONS.rrSaveDelay("PRJ-015"); ok("A second delay on the same task is refused", DRAWER?.errors.some((e) => e.field === "task")); closeDrawer(true);
    visit("#/projects/PRJ-015/delays"); ok("Logged task leaves the to-log list", !document.querySelector('[data-act="drawer:delay:PRJ-015:PRJ-015-T05"]') && !!document.querySelector('[data-act="drawer:delay:PRJ-015:PRJ-015-T07"]'));
    ok("Delay reasons are the agreed list: 4 controllable, 3 excused, plus custom", DELAY_REASONS.map((r) => r.label).join("|") === "Planning / estimation|Rework / resource unavailable|Delay in compliances|Escalation miss|Client-caused|External dependency|Approved scope or baseline change|Custom"
      && DELAY_REASONS.filter((r) => r.ctrl).map((r) => r.code).join() === "C1,C2,C3,C4,X");
    ACTIONS.drawer("delay", "PRJ-015", "PRJ-015-T07"); form({ cause: "X", reason: "Design system tokens changed mid-task" }); ACTIONS.rrSaveDelay("PRJ-015"); ok("Custom reason needs a name", DRAWER?.errors.some((e) => e.field === "custom"));
    form({ custom: "Design system migration", flagged: "2026-10-15" }); ACTIONS.rrSaveDelay("PRJ-015"); const dx = proj("PRJ-015").rr.delays.at(-1);
    ok("Custom reason is logged as controllable with its name", dx.cat === "X" && dx.custom === "Design system migration" && RR.controllable("X") && RR.penalty([dx]) === 2);
    visit("#/projects/PRJ-015/delays"); ok("Delay log shows the custom reason", text().includes("Custom: Design system migration"));
    ok("Escalation miss is −2 once, never doubled; on top of another reason it adds −2", RR.penalty([{ cat: "C4", c4: false }]) === 2 && RR.penalty([{ cat: "C1", c4: true }]) === 4 && RR.penalty([{ cat: "E2", c4: true }]) === 0);
    let msHits = []; for (const r of ["#/recognition", "#/policy", ...["charter", "delays", "scorecard", "risks"].map((t) => `#/projects/PRJ-015/${t}`), ...["charter", "delays", "scorecard"].map((t) => `#/projects/PRJ-D01/${t}`), ...["runs", "delays", "scorecard"].map((t) => `#/projects/PRJ-D05/${t}`), "#/projects/PRJ-D04/charter"]) { peek(r); if (/milestone/i.test(document.querySelector("#view").innerText)) msHits.push(r); }
    for (const [k, a, b] of [["delay", "PRJ-015"], ["delay", "PRJ-D05"], ["baseline", "PRJ-015"]]) { ACTIONS.drawer(k, a, b); if (/milestone/i.test(document.querySelector("#layer").innerText)) msHits.push("drawer " + k + " " + a); closeDrawer(true); }
    ok("No milestones on any R&R screen or drawer" + (msHits.length ? ": " + msHits.join(", ") : ""), !msHits.length && S.projects.every((p) => !("milestones" in p)) && S.tasks.every((t) => !("milestone" in t)));

    // Task dates and person drill-down from project People and Charter
    as("admin"); visit("#/projects/PRJ-015/tasks?view=table");
    ok("Project task table shows all six requested tracker fields", ["Start date", "End date", "Go live date", "Actual working days", "Delay (No. of days)", "Status"].every((label) => [...document.querySelectorAll("#view th")].some((th) => th.textContent === label)));
    const calendarCase = { start: "2026-10-16", due: "2026-10-19", status: "Completed", acceptedOn: "2026-10-21", submissions: [] };
    ok("Working days include start, skip weekend and holiday; delay uses calendar days", DELIVERY.taskDates(calendarCase).working === 3 && DELIVERY.taskDates(calendarCase).delay === 2);
    ok("Pending review stops the day count at submission, missing dates stay unavailable", DELIVERY.taskDates({ ...calendarCase, status: "In Review", submissions: [{ date: "2026-10-19" }] }).working === 2 && DELIVERY.taskDates({ ...calendarCase, start: null, due: null }).working === null && DELIVERY.taskDates({ ...calendarCase, start: null, due: null }).delay === null);
    openTask("PRJ-015-T06"); ACTIONS.tmode("dates"); form({ goLive: "2026-10-01" }); ACTIONS.taskDatesSave("PRJ-015-T06");
    ok("Go-live before start is rejected and the date draft is kept", DRAWER.errors.some((e) => e.field === "goLive") && DRAWER.form.goLive === "2026-10-01" && !task("PRJ-015-T06").goLive);
    form({ goLive: "2026-11-06" }); ACTIONS.taskDatesSave("PRJ-015-T06");
    ok("Saving go-live records history without accepting work or moving the end date", task("PRJ-015-T06").goLive === "2026-11-06" && task("PRJ-015-T06").due === "2026-11-05" && !task("PRJ-015-T06").acceptedOn && S.audit.some((a) => a.action === "update_task_dates")); closeDrawer(true);
    visit("#/projects/PRJ-D07/overview"); click('[data-act="personTasks:PRJ-D07:EMP-0221"]');
    ok("Project People opens assigned work even without an R&R charter", DRAWER.kind === "personTasks" && document.querySelector('.drawer [data-act="openTask:PRJ-D07-T01"]') && document.querySelector('.drawer [data-act="closeDrawer"]')); closeDrawer(true);
    visit("#/projects/PRJ-015/charter"); click('tr[data-act="personTasks:PRJ-015:EMP-0082"] td:last-child');
    const assigned = S.tasks.filter((t) => t.project === "PRJ-015" && t.assignments.some((a) => a.emp === "EMP-0082"));
    ok("Clicking a charter person opens their project's tasks and progress", DRAWER.kind === "personTasks" && assigned.every((t) => document.querySelector(`.drawer [data-act="openTask:${t.code}"]`)) && document.querySelector(".drawer").textContent.includes("Reported progress") && !document.querySelector('.drawer [data-act="openTask:PRJ-D07-T01"]'));
    closeDrawer(true); click('tr[data-act="personTasks:PRJ-015:EMP-0082"] .person-cell b');
    ok("Clicking the name inside a person row opens the same tasks", DRAWER.kind === "personTasks" && assigned.every((t) => document.querySelector(`.drawer [data-act="openTask:${t.code}"]`)));
    closeDrawer(true); click('tr[data-act="personTasks:PRJ-015:EMP-0083"] .letters span');
    ok("Clicking a RACI letter opens that person's tasks", DRAWER.kind === "personTasks" && DRAWER.form.emp === "EMP-0083"); closeDrawer(true);
    click('button[data-act="personTasks:PRJ-015:EMP-0082"]');
    click(`.drawer [data-act="openTask:${assigned[0].code}"]`); ok("A charter person's task opens the task details", DRAWER.kind === "t" && DRAWER.arg === assigned[0].code); closeDrawer(true);
    // Accountable / Champion: own tasks plus the Responsible people's tasks, grouped by person (display only)
    const before = JSON.stringify([S.tasks, S.projects.map((p) => p.rr)]), scoreBefore = RR.score(proj("PRJ-D01")).score;
    const rPeople = proj("PRJ-015").rr.raci.filter((x) => x.L === "R").map((x) => x.emp), rTasks = S.tasks.filter((t) => t.project === "PRJ-015" && t.assignments.some((a) => rPeople.includes(a.emp)));
    visit("#/projects/PRJ-015/charter"); click('tr[data-act="personTasks:PRJ-015:EMP-0081"] td:last-child');
    ok("Charter A row opens own tasks plus every Responsible person's tasks", DRAWER.kind === "personTasks" && rPeople.every((id) => document.querySelector(`.drawer [data-responsible="${id}"]`)) && rTasks.every((t) => document.querySelector(`.drawer [data-act="openTask:${t.code}"]`)));
    const harsh = document.querySelector('.drawer [data-responsible="EMP-0084"]');
    ok("Each Responsible group keeps role/share, dates, status, progress and next action", harsh.textContent.includes("Contributor · 40%") && ["Start date", "End date", "Status", "Progress", "Next action"].every((h) => [...harsh.querySelectorAll("th")].some((th) => th.textContent === h)));
    ok("The lead view says who is Accountable and Champion", document.querySelector(".drawer").textContent.includes("Accountable (A) · Champion")); closeDrawer(true);
    visit("#/projects/PRJ-015/overview"); click('#view [data-act="personTasks:PRJ-015:EMP-0081"]'); ok("The project People section opens the same lead view for the Champion", !!document.querySelector('.drawer [data-responsible="EMP-0082"]')); closeDrawer(true);
    ACTIONS.personTasks("PRJ-015", "EMP-0082"); ok("A Responsible person's view is unchanged: own tasks only, no groups", !document.querySelector(".drawer [data-responsible]") && !document.querySelector('.drawer [data-act="openTask:PRJ-015-T03"]')); closeDrawer(true);
    ok("Opening the lead view changes no task, R&R data or score", JSON.stringify([S.tasks, S.projects.map((p) => p.rr)]) === before && RR.score(proj("PRJ-D01")).score === scoreBefore);
    as("manager"); ACTIONS.personTasks("PRJ-015", "EMP-0081"); ok("Manager (the Champion) sees the lead view within their own scope", !!document.querySelector('.drawer [data-responsible="EMP-0083"]')); closeDrawer(true); as("admin");
    ACTIONS.personTasks("PRJ-015", "EMP-0219"); ok("A charter person with no assignments sees an explicit empty state", document.querySelector(".drawer").textContent.includes("No tasks assigned to this person in this project")); closeDrawer(true);
    visit("#/projects/PRJ-D05/charter"); click('[data-act="personTasks:PRJ-D05:EMP-0118"]');
    ok("Programme people show template responsibilities without invented task dates", document.querySelector(".drawer").textContent.includes("Template stage responsibilities") && document.querySelector(".drawer").textContent.includes("Individual task dates and progress are not recorded")); closeDrawer(true);
    as("tl"); openTask("PRJ-D07-T01"); ok("Team Lead cannot edit task dates", !document.querySelector('.drawer [data-act="tmode:dates"]')); closeDrawer(true);
    ACTIONS.personTasks("PRJ-015", "EMP-0082"); ok("An out-of-scope project cannot open a charter person's work", !DRAWER);

    // Scope
    as("manager"); visit("#/projects/PRJ-D01/scorecard"); ok("Manager: no ₹, Anita out of scope, can't publish", !text().includes("₹2,40,000") && text().includes("Not in your reporting tree") && document.querySelector('[data-act="rrPublish"]')?.disabled);
    as("tl"); visit("#/projects/PRJ-D01/overview"); ok("Team Lead can't open PRJ-D01", text().includes("isn't available to you"));
    visit("#/tasks/team"); ok("Team Lead sees own team's work (PRJ-D07)", text().includes("Design and testing") && !text().includes("Homepage hero"));
    visit("#/admin/access"); ok("Team Lead denied Administration", text().includes("don't have access"));
    as("hod"); visit("#/recognition"); ok("HOD with the Panel function sees ₹", text().includes("₹"));
    as("admin"); ACTIONS.openPalette(); PALETTE.q = "naveen"; renderLayer(); ok("Search shows both Naveen Kumar records with IDs", (document.querySelector("#layer").innerText.match(/Naveen Kumar/g) || []).length >= 2); PALETTE = null; renderLayer();
  } catch (err) { out.push("ERROR " + err.message + " " + (err.stack || "").split("\n")[1]); }
  document.title = out.every((l) => l.startsWith("PASS")) ? "SELFTEST OK" : "SELFTEST FAILED";
  const pre = document.createElement("pre"); pre.id = "selftest"; pre.textContent = out.join("\n"); document.body.appendChild(pre);
}
