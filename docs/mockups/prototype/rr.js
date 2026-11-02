/* Project R&R screens (docs/project-tier-rr-plan.md): Recognition, Charter, Runs, Delays, Scorecard, plus their drawers. */
const CAT = Object.fromEntries(DELAY_REASONS.map((r) => [r.code, r.label]));
const catLabel = (d) => d.cat === "X" ? `Custom: ${d.custom}` : CAT[d.cat];
const delayCounts = (delays) => `${delays.filter((d) => RR.controllable(d.cat)).length} · ${delays.filter((d) => !RR.controllable(d.cat)).length} excused`;

function d05Blockers(p) {
  const r = p.rr, out = [];
  out.push({ k: "Champion (A) is a named employee in the org chart", ok: r.c.mukeshAdded, why: "Mukesh Thakur (Marketing POC) is not in the org chart", act: "rrFixMukesh", actLabel: "Simulate: Admin adds him" });
  for (const step of [2, 4, 5, 6]) { const st = EMAIL_TEMPLATE.stages.find((s) => s.step === step); out.push({ k: `Stage ${step} · ${st.name}: independent reviewer`, ok: !!r.reviewers[step], why: `Reviewer is the Responsible person (${pname(st.validator)})`, pick: step }); }
  for (const x of RR.resolve(EMAIL_TEMPLATE.stages, p.rr.champion).rows.filter((x) => x.L === "R" && x.payable))
    out.push({ k: `Contribution factor for ${pname(x.id)}`, ok: !!r.confirmed[x.id], why: `Suggested ${fac(x.suggested)} from ${(x.share * 100).toFixed(1)}% of planned effort`, act: `rrConfirm:${x.id}`, actLabel: "Confirm " + fac(x.suggested) });
  out.push({ k: "Value target locked (conversions)", ok: !!r.c.target, why: "Set the quarter's conversion target", input: true });
  out.push({ k: "Baseline metrics are established (RSK-011/012 assumption)", ok: r.c.baselineMetrics, why: "Open rate, click rate and conversion baseline recorded", act: "rrMetrics", actLabel: "Mark established" });
  return out;
}
function rrQueue() {
  const items = [], d05 = proj("PRJ-D05"), d01 = proj("PRJ-D01");
  const logged = S.projects.flatMap((p) => p.rr?.delays || []).filter((d) => d.state === "Logged" || d.state === "Challenged");
  if (has("PMO validator") && logged.length) items.push({ n: logged.length, t: "Delays to validate", s: "PMO validator · PRJ-D05 run R2", href: "#/projects/PRJ-D05/delays", tone: "warn", tag: "Due 27 Oct" });
  if (has("PMO validator") && d05.rr.c.submitted && !d05.rr.c.pmoOk) items.push({ n: 1, t: "Charter to lock", s: "PMO · PRJ-D05 Email campaigns", href: "#/projects/PRJ-D05/charter", tone: "info", tag: "PMO" });
  if (isAdmin() && !S.personas.some((x) => x.fns.includes("Finance confirmer"))) items.push({ n: 1, t: "No Finance confirmer tagged", s: "Value confirmations wait · Administration → People & access", href: "#/admin/access", tone: "bad", tag: "Setup" });
  if (has("R&R Panel member") && d01.rr.stage === "Panel approved") items.push({ n: 1, t: "Scorecard ready to publish", s: "R&R Panel · PRJ-D01", href: "#/projects/PRJ-D01/scorecard", tone: "info", tag: "Panel" });
  if (has("Quality assessor")) items.push({ n: 2, t: "Quality inputs", s: "Quality assessor · satisfaction and rework", href: "#/workflows/inputs", tone: "outline", tag: "Open" });
  if (S.persona === "manager") items.push({ n: 1, t: "Contribution factors to confirm", s: "Your people on PRJ-015 (set at kickoff)", href: "#/projects/PRJ-015/charter", tone: "outline", tag: "Open" });
  return items;
}
function rrQueuePanel() {
  const q = rrQueue();
  return panel("Waiting for you", q.length ? `<ul class="queue">${q.map((i) => `<li><span class="q-n">${i.n}</span><span class="q-t"><b><a href="${i.href}">${esc(i.t)}</a></b><span>${esc(i.s)}</span></span><span class="badge ${i.tone}">${esc(i.tag)}</span></li>`).join("")}</ul>` : empty("Nothing waiting", "Items appear for the functions Admin tags on your account."), { meta: `Your functions: ${esc(me().fns.join(", ") || "none")}`, pad: false });
}
// Late tasks (against the baseline) that have no delay entry yet: the delay log is fed by the task list.
const unloggedLate = (p) => RR.taskTimelines(p.code).late.filter((t) => !(p.rr.delays || []).some((d) => d.taskCode === t.code));
// Programme mode: each run is six stage tasks; a stage task over its SLA is late.
const stageTasks = (r) => { const done = r.runs.reduce((n, x) => n + x.done.filter(Boolean).length, 0), late = r.runs.reduce((n, x) => n + x.late.filter((st) => x.done[st - 1]).length, 0); return { done, onTime: done - late }; };
function rrRow(p) {
  const r = p.rr;
  if (p.code === "PRJ-D01") { const sc = RR.score(p); return { p, champion: pname(r.champion), tasks: `${sc.onTime} of ${r.timedTasks}`, delays: delayCounts(r.delays), gates: `${sc.gates.filter((g) => g.ok).length}/4`, score: sc.score, stage: r.stage, pool: sc.pool }; }
  if (r.fixed) return { p, champion: pname(r.champion), ...r.fixed, stage: r.stage };
  if (r.mode === "programme") { const st = stageTasks(r); return { p, champion: pname(r.champion), tasks: `${st.onTime} of ${st.done}`, delays: delayCounts(r.delays), gates: r.charter === "Locked" ? "Finance pending" : "No locked baseline", score: null, stage: r.charter === "Locked" ? "Collecting inputs" : "Charter draft", pool: null }; }
  const tl = RR.taskTimelines(p.code), toLog = unloggedLate(p).length; return { p, champion: pname(r.champion), tasks: `${tl.onTime} of ${tl.due}`, delays: `${r.delays.length}${toLog ? ` · ${toLog} to log` : ""}`, gates: "Scored at closure", score: null, stage: r.stage, pool: null };
}
function viewRecognition() {
  crumbs([["Recognition"]]);
  const rows = visibleProjects().filter((p) => p.rr).map(rrRow), scored = rows.filter((r) => r.score != null), money = seesMoney();
  const avg = scored.length ? scored.reduce((s, r) => s + r.score, 0) / scored.length : null, poolTotal = rows.reduce((s, r) => s + (r.pool || 0), 0);
  const colors = { Platinum: "#3e536b", Gold: "var(--gold)", Silver: "var(--silver)", Bronze: "var(--bronze)", Review: "var(--bad)" };
  const bands = ["Platinum", "Gold", "Silver", "Bronze", "Review"].map((b) => [b, scored.filter((r) => RR.band(r.score) === b).length]);
  return `<div class="ph"><div class="titles"><h1>Project recognition</h1><p class="sub">Project scores, bands and reward units across the organisation for Oct–Dec 2026. Only projects in your scope are listed.</p></div>
    <div class="actions">${btn(`${icon(I.down)} Export`, "toast:Export keeps scope: units and ₹ are removed for viewers without the Panel function")}${isAdmin() ? btn("Draw audit sample", "toast:10% audit sample drawn: PRJ-D02 (seeded, recorded in the audit history)") : ""}</div></div>
  <div class="proposed">${icon(I.warn)}<span><b>Policy PR-1 is ${S.policyState.toLowerCase()}, not activated.</b> Slabs, caps, bands and pool rates follow the HR framework draft v1.0. ₹ amounts are indicative until Finance confirms them.</span></div>
  ${figures([fig("Projects in the scheme", rows.length, "Pilot · 1 programme"), fig("Scored this quarter", `${scored.length}<small>of ${rows.length}</small>`, "Others need inputs, closure or a locked charter"), fig("Average project score", avg == null ? "—" : fmt2(avg), `Across ${scored.length} scored`),
    fig("PRJ-D01 collaboration", S.p9doc ? "+3" : "+4", S.p9doc ? "Doc §13 reading (P9)" : "§3.2 rule · default"), fig("Indicative reward pool", money ? inr(poolTotal) : "—", money ? "Admin and Panel only" : "Hidden for your role")])}
  <div class="grid grid-main mt">${panel("Project bands", `<div class="bandbar">${bands.filter((b) => b[1]).map(([b, n]) => `<span style="flex:${n};background:${colors[b]}"></span>`).join("") || `<span style="flex:1;background:var(--sunken)"></span>`}</div>
    <div class="legend">${bands.map(([b, n]) => `<span class="k"><i style="background:${colors[b]}"></i>${b} · ${{ Platinum: "90+", Gold: "80–89", Silver: "70–79", Bronze: "60–69", Review: "below 60" }[b]}</span><span class="v">${n}</span>`).join("")}</div>`, { meta: "Scored projects" })}${rrQueuePanel()}</div>
  <div class="sec-title"><h2>Projects</h2><span class="meta">Scored at closure, by quarter for programmes, or each quarter for projects over 6 months</span></div>
  ${panel("", table(["Project", "Champion (A)", "#Tasks on time", "#Delays", "Gates", "#Score", "Project band", "Stage", "#Pool (indicative)"], rows.map((r) => `<tr class="clickable" data-go="#/projects/${r.p.code}/${r.score != null || r.p.rr.fixed ? "scorecard" : "charter"}">
    <td><b>${esc(r.p.title)}</b><span class="sub">${r.p.code} · ${r.p.dept} · ${r.p.rr.mode === "programme" ? "Programme" : r.p.rr.type}</span></td><td>${esc(r.champion)}</td><td class="n">${r.tasks}</td><td class="n">${r.delays}</td><td>${r.gates}</td>
    <td class="n big">${r.score == null ? `<span class="unavail">Not scored</span>` : fmt2(r.score)}</td><td>${tier(r.score == null ? null : RR.band(r.score))}</td><td>${badge(r.stage)}</td>
    <td class="n money">${r.pool == null ? `<span class="unavail">Not set</span>` : money ? inr(r.pool) : `<span class="hidden-role">Hidden</span>`}</td></tr>`)), { pad: false }).replace('<div class="panel-h"><h2></h2></div>', "")}`;
}

/* ---------- Charter ---------- */
function charterPersonRow(p, emp) {
  return EMP[emp] && !EMP[emp].missing && !emp.startsWith("@")
    ? `class="clickable" data-act="personTasks:${esc(p.code)}:${esc(emp)}"` : "";
}
// The Accountable (A) person or the Champion also sees the Responsible (R) people's tasks. Display only: no R&R input or scope rule changes.
const projectLead = (p, emp) => !!p.rr && (p.rr.champion === emp || (p.rr.raci || []).some((x) => x.L === "A" && x.emp === emp));
function responsiblePeople(p) {
  if (!p.rr) return [];
  const ids = p.rr.mode === "programme" ? RR.resolve(EMAIL_TEMPLATE.stages, p.rr.champion).rows.filter((x) => x.L === "R").map((x) => x.id) : (p.rr.raci || []).filter((x) => x.L === "R").map((x) => x.emp);
  return [...new Set(ids)].filter((id) => EMP[id] && !EMP[id].missing && !id.startsWith("@"));
}
function charterPerson(p, emp, content = chip(emp)) {
  if (!EMP[emp] || EMP[emp].missing || emp.startsWith("@")) return content;
  const count = S.tasks.filter((t) => t.project === p.code && t.assignments.some((a) => a.emp === emp)).length;
  const stages = p.rr?.mode === "programme" ? EMAIL_TEMPLATE.stages.filter((st) => st.R.includes(emp)).length : 0;
  const team = projectLead(p, emp) ? responsiblePeople(p).filter((id) => id !== emp) : [];
  const teamCount = S.tasks.filter((t) => t.project === p.code && t.assignments.some((a) => team.includes(a.emp))).length;
  const label = team.length ? `${count} own task${count === 1 ? "" : "s"} · ${teamCount} Responsible task${teamCount === 1 ? "" : "s"}`
    : stages ? `${stages} responsible stage${stages === 1 ? "" : "s"}` : `${count} assigned task${count === 1 ? "" : "s"}`;
  return `<button class="link-btn charter-person" data-act="personTasks:${p.code}:${emp}" aria-label="View ${esc(pname(emp))}'s assigned tasks in ${esc(p.title)}">${content}<span class="sub">${label} · View work →</span></button>`;
}
DRAWERS.personTasks = (code) => {
  const p = proj(code), emp = fv("emp"), e = EMP[emp];
  if (!p || !e || !visibleProjects().some((x) => x.code === code)) return { title: "Not available", body: empty("This project isn't available to you") };
  const inProject = tasksInScope().filter((t) => t.project === code), ts = inProject.filter((t) => t.assignments.some((a) => a.emp === emp));
  const team = projectLead(p, emp) ? responsiblePeople(p).filter((id) => id !== emp) : [];
  if (team.length) return leadTasks(p, emp, ts, team, inProject);
  const active = ts.filter((t) => !["Completed", "Cancelled"].includes(t.status));
  const accepted = ts.filter((t) => t.status === "Completed");
  const total = ts.filter((t) => t.status !== "Cancelled");
  const weight = (t) => t.complexity * t.assignments.find((a) => a.emp === emp).share / 100;
  const denom = total.reduce((n, t) => n + weight(t), 0);
  const progress = denom ? Math.round(total.reduce((n, t) => n + t.progress * weight(t), 0) / denom) : null;
  const stages = p.rr?.mode === "programme" ? EMAIL_TEMPLATE.stages.filter((st) => st.R.includes(emp)) : [];
  const responsibilities = stages.length ? panel("Template stage responsibilities", table(["Run", "Responsible stage", "Status"], p.rr.runs.flatMap((run) => stages.map((st) => `<tr><td>${esc(run.id)} · ${esc(run.title)}</td><td>${st.step} · ${esc(st.name)}</td><td>${run.done[st.step - 1] ? badge("Completed") : st.step - 1 === run.done.indexOf(0) ? badge("In Progress") : badge("Not Started")}${run.late.includes(st.step) ? ` ${badge("Late")}` : ""}</td></tr>`))), { pad: false, meta: "From the campaign template and run tracker. Individual task dates and progress are not recorded here." }) : "";
  return { eyebrow: `${code} · ${p.title}`, title: `${e.name} — assigned work`, wide: true, width: 1240, // fits the ten tracking columns
    sub: `${esc(emp)} · ${esc(e.desig)} · ${esc(e.dept)}`,
    body: `${figures([fig("Assigned tasks", ts.length, "This project"), fig("Active", active.length, `${accepted.length} completed tasks`), fig("Reported progress", progress == null ? "—" : progress + "%", "Weighted by complexity and share"), fig("Overdue / blocked", `${active.filter((t) => DELIVERY.timing(t) === "Overdue").length} / ${active.filter((t) => ["Block", "Blocked"].includes(t.status)).length}`, "This person's assigned work")])}
      <div class="mt">${panel("Assigned tasks", taskTrackingTable(ts, emp), { pad: false })}</div>${responsibilities}
      <p class="note mt">Select a task to open its details and updates. Reported progress and reviewer acceptance are separate.</p>`,
    foot: btn("Back to project", "closeDrawer") };
};
// Accountable or Champion: own tasks, then one group per Responsible person (their role/share), from tasks already in the viewer's scope
function leadTasks(p, emp, own, team, inProject) {
  const e = EMP[emp], role = [(p.rr.raci || []).some((x) => x.L === "A" && x.emp === emp) ? "Accountable (A)" : "", p.rr.champion === emp ? "Champion" : ""].filter(Boolean).join(" · ");
  const groups = team.map((id) => [id, inProject.filter((t) => t.assignments.some((a) => a.emp === id))]);
  const all = [...new Set([...own, ...groups.flatMap(([, list]) => list)])], live = all.filter((t) => t.status !== "Cancelled");
  const active = live.filter((t) => t.status !== "Completed"), denom = live.reduce((n, t) => n + t.complexity, 0);
  const progress = denom ? Math.round(live.reduce((n, t) => n + (t.status === "Completed" ? 100 : t.progress) * t.complexity, 0) / denom) : null;
  const teamTasks = [...new Set(groups.flatMap(([, list]) => list))];
  return { eyebrow: `${p.code} · ${p.title}`, title: `${e.name} — own and Responsible people's work`, wide: true, width: 1240,
    sub: `${esc(emp)} · ${esc(e.desig)} · ${esc(e.dept)} · ${role}`,
    body: `${figures([fig("Own tasks", own.length, "Assigned to them"), fig("Responsible people's tasks", teamTasks.length, `${team.length} Responsible ${team.length === 1 ? "person" : "people"}`), fig("Active", active.length, `${live.length - active.length} completed tasks`),
        fig("Reported progress", progress == null ? "—" : progress + "%", "All tasks shown, weighted by complexity"), fig("Overdue / blocked", `${active.filter((t) => DELIVERY.timing(t) === "Overdue").length} / ${active.filter((t) => t.status === "Block").length}`, "Across the tasks shown")])}
      <div class="mt">${panel("Own tasks", taskTrackingTable(own, emp, false), { pad: false, meta: role })}</div>
      ${groups.map(([id, list]) => `<div class="mt" data-responsible="${esc(id)}">${panel(`Responsible · ${esc(pname(id))}`, taskTrackingTable(list, id, false), { pad: false, meta: `${list.length} task${list.length === 1 ? "" : "s"} · ${esc(EMP[id].desig)}` })}</div>`).join("")}
      <p class="note mt">${TASK_DATE_NOTE} A task shared by two Responsible people appears under each, with that person's role and share. This view is for following the work; it doesn't change R&amp;R scores or who can see what.</p>`,
    foot: btn("Back to project", "closeDrawer") };
}
function rrCharter(p) {
  const r = p.rr;
  if (r.mode === "programme") return rrCharterProgramme(p);
  if (r.charter !== "Locked") return `${callout("warn", "Charter draft.", "Imported project: no locked baseline, so it can't be scored for reward. Set the value target, baseline dates, RACI and SLAs, then submit for sponsor and PMO approval.")}${panel("Before the charter can lock", `<ul class="checklist">${["Priority chosen (currently missing)", "Value target and sponsor", "Baseline due date on every task", "Named RACI with one A", "SLA list"].map((x) => `<li><span class="st no">!</span><span>${x}</span></li>`).join("")}</ul>`)}`;
  return `${callout("ok", `Baseline locked on ${r.lockedOn}`, "by the sponsor and PMO. Changes go through a baseline change request; an approved change is an E3 excuse and keeps the original.", canManageProject(p) ? btn("Request baseline change", `drawer:baseline:${p.code}`, { sm: true }) : "")}
  <div class="split wide-side"><div class="stack">
    ${panel("RACI", r.raci ? table(["Person", "Letter", "Detail"], (r.raci || []).map((x) => `<tr ${charterPersonRow(p, x.emp)}><td>${charterPerson(p, x.emp)}</td><td><span class="letters"><span class="${x.L}">${x.L}</span></span></td><td class="wrap">${esc(x.note)}${S.persona === "manager" && x.L === "R" && reportingTree(meEmp()).has(x.emp) && p.code === "PRJ-015" ? ` ${badge("Pending").replace("Pending", "Confirm factor")}` : ""}</td></tr>`)) : `<p class="muted">RACI recorded in the source charter (not shown in this prototype).</p>`, { meta: "One A · one letter per person · select a person to view assigned work", pad: !r.raci })}
    ${r.slas ? panel("SLA list", table(["SLA", "Kind", "TAT"], r.slas.map((s) => `<tr><td>${esc(s.name)}</td><td>${s.kind}</td><td>${s.tat}</td></tr>`)), { meta: "Fixed at kickoff · can't be dropped later", pad: false }) : ""}
  </div><div class="stack">${panel("Value target", `<dl class="kv"><dt>Kind</dt><dd>${esc(r.value?.kind ?? "—")}</dd><dt>Target (locked)</dt><dd>${typeof r.value?.target === "number" ? crore(r.value.target) : esc(r.value?.target ?? "—")}</dd><dt>Actual</dt><dd>${typeof r.value?.actual === "number" ? crore(r.value.actual) : `<span class="unavail">Not yet</span>`}</dd><dt>Finance</dt><dd>${r.value?.confirmed ? `<span class="ok-txt">Confirmed (illustrative)</span>` : `<span class="warn-txt">Not confirmed</span>`}</dd><dt>Project type</dt><dd>${r.type}</dd><dt>Sponsor</dt><dd>${esc(r.sponsor ?? "—")}</dd></dl>`)}
    ${panel("Charter history", `<div class="small">${r.lockedOn} · Locked by sponsor and PMO</div><div class="small muted">Submitted by ${esc(pname(r.champion))}</div>`)}</div></div>`;
}
function rrCharterProgramme(p) {
  const r = p.rr, res = RR.resolve(EMAIL_TEMPLATE.stages, r.champion), blockers = d05Blockers(p), ready = blockers.every((b) => b.ok);
  const state = r.charter === "Locked" ? callout("ok", "Baseline locked", "by the sponsor and PMO. Stage SLAs and the RACI below are fixed for Oct–Dec 2026.")
    : callout("warn", "Charter draft.", `Derived from the Email campaign template (RACI.xlsx, named Sheet3 defaults). ${blockers.filter((b) => !b.ok).length} item(s) block the lock.`,
      !r.c.submitted ? btn("Submit for lock", "rrSubmit", { primary: true, sm: true, disabled: !ready, title: ready ? "" : "Clear the checklist first" })
        : `${btn(r.c.sponsorOk ? "Sponsor approved" : "Simulate: sponsor approves", "rrSponsor", { sm: true, disabled: r.c.sponsorOk })}${btn("Approve as PMO", "rrPmo", { sm: true, primary: true, disabled: !has("PMO validator") || r.c.pmoOk, title: has("PMO validator") ? "" : "Needs the PMO validator function" })}`);
  return `${state}<div class="split wide-side"><div class="stack">
    ${panel("Project RACI, derived from the template stages", table(["Person or label", "Stage letters", "Project letter", "#Planned effort", "Factor", "Resolution"], res.rows.map((x) => `<tr ${charterPersonRow(p, x.id)}>
      <td>${charterPerson(p, x.id, `<b>${esc(pname(x.id))}</b><span class="sub">${x.label ? "Group label · name a person" : esc(EMP[x.id]?.desig ?? "")}</span>`)}${EMP[x.id]?.missing ? `<span class="badge bad" style="margin-top:4px">Not in org chart</span>` : ""}</td>
      <td><span class="letters">${["A", "R", "C", "I"].map((L) => x[L].length ? `<span class="${L} ${x.dropped.includes(L) || (L === "A" && x.L !== "A") ? "x" : ""}" title="Stages ${x[L].join(", ")}">${L}${x[L].join("")}</span>` : "").join("")}</span></td>
      <td>${x.L ? `<span class="letters"><span class="${x.L}">${x.L}</span></span>` : ""}</td><td class="n">${x.share ? (x.share * 100).toFixed(1) + "%" : "—"}</td>
      <td>${x.L === "R" && x.payable ? (r.confirmed[x.id] ? `<span class="badge ok">${fac(x.suggested)} confirmed</span>` : `<span class="badge warn">${fac(x.suggested)} suggested</span>`) : x.L === "A" ? "Champion" : "—"}</td>
      <td class="wrap small">${esc(x.notes.join(" · ") || (x.label ? "Name people for R or C; fine as I" : ""))}</td></tr>`)), { meta: "Strongest letter per person (A > R > C > I) · stage-level A becomes workstream lead", pad: false, foot: `<span class="note">Planned effort = midpoint of each R stage ÷ ${res.total} h. Suggested factor: ≥ 40% → 1.0, 20–40% → 0.75, &lt; 20% → 0.5 (P12). The manager confirms.</span>` })}
    ${panel("Stages, SLAs and validators", table(["#", "Stage", "SLA target / max", "Effort", "Validator", "Source flag"], EMAIL_TEMPLATE.stages.map((st) => `<tr><td class="mono">${st.step}</td><td><b>${esc(st.name)}</b>${st.regulator ? `<span class="sub">Regulator approval (TRAI / WhatsApp) where needed</span>` : ""}</td><td>${st.sla[0]} / ${st.sla[1]} bd</td><td>${st.effort[0]}–${st.effort[1]} h</td>
      <td>${st.vRule ? `<span class="badge info">Rule</span> ${esc(st.validator)}` : r.reviewers[st.step] ? `<span class="badge ok">${esc(pname(r.reviewers[st.step]))}</span>` : `<span class="badge bad">${esc(pname(st.validator))} is R</span>`}</td><td class="wrap small muted">${esc(st.flag || "")}</td></tr>`)), { meta: "Stage SLAs become the locked SLA list automatically", pad: false })}
  </div><div class="stack">${panel("Before the charter can lock", `<ul class="checklist">${blockers.map((b) => `<li><span class="st ${b.ok ? "ok" : "no"}">${b.ok ? "✓" : "!"}</span><span>${esc(b.k)}${b.ok ? "" : `<span class="note" style="display:block">${esc(b.why)}</span>`}</span>
      <span class="act">${b.ok || r.charter === "Locked" ? "" : b.pick ? `<select class="select-sm" data-rrpick="${b.pick}"><option value="">Name reviewer…</option>${["EMP-0081", "EMP-0221", "EMP-0118"].map((id) => `<option value="${id}">${esc(pname(id))} (${id})</option>`).join("")}</select>` : b.input ? `<input class="mini-in" style="width:90px" placeholder="e.g. 1200" data-rrtarget>` : btn(esc(b.actLabel), b.act, { sm: true })}</span></li>`).join("")}</ul>`)}
    ${panel("Value target", `<dl class="kv"><dt>Kind</dt><dd>Conversions (stage 6 tracking)</dd><dt>Target for the quarter</dt><dd>${r.c.target ? r.c.target.toLocaleString("en-IN") : "Not set"}</dd><dt>Confirmed by</dt><dd>Finance confirmer</dd></dl><p class="note mt">Non-revenue value is scored on the same slabs (P4).</p>`)}</div></div>`;
}

/* ---------- Runs ---------- */
function rrRuns(p) {
  const r = p.rr, due = r.runs.filter((x) => x.delivered || x.maxDue <= TODAY), onTime = due.filter((x) => x.delivered && x.delivered <= x.maxDue).length, st = stageTasks(r);
  return `${figures([fig("Runs this quarter", r.runs.length, "Six stage tasks per accepted request"), fig("Stage tasks on time", `${st.onTime}<small>of ${st.done} done</small>`, "Timelines parameter (programme mode)"), fig("Runs delivered within max SLA", `${onTime}<small>of ${due.length} due</small>`, "All six stage tasks completed"), fig("Stage SLA adherence", "94%", "16 of 17 stage tasks within target"), fig("Excused delays", r.delays.filter((d) => !RR.controllable(d.cat)).length, "Client-caused, external or approved change")])}
  <div class="mt">${panel("Runs", table(["Run", "Requested by", "Validator (rule)", "Stage tasks", "Started", "Max SLA due", "Result"], r.runs.map((x) => `<tr><td><b>${x.id} · ${esc(x.title)}</b></td><td>${esc(x.req)}</td><td class="small">Head of ${esc(x.req)}</td>
    <td><span class="stage-dots">${x.done.map((d, i) => `<i class="${x.late.includes(i + 1) ? "late" : d ? "done" : i === x.done.indexOf(0) ? "now" : ""}" title="Stage ${i + 1} task"></i>`).join("")}</span></td><td>${fd(x.started, false)}</td><td>${fd(x.maxDue, false)}</td>
    <td>${x.delivered ? badge("Completed").replace("Completed", "Delivered " + fd(x.delivered, false)) : x.late.length ? `<span class="badge warn">Stage ${x.late[0]} over SLA</span>` : badge("In Progress")}</td></tr>`)), { pad: false, meta: "Accepting a request in Projects → Requests adds a run" })}</div>`;
}

/* ---------- Delays ---------- */
function rrDelays(p) {
  const r = p.rr, prog = r.mode === "programme", late = prog ? [] : unloggedLate(p), canLog = canManageProject(p) || isAdmin();
  return `<div class="row mb"><span class="note">One late ${prog ? "stage task" : "task"} = one delay, judged against its baseline due date · controllable −2, an escalation miss on top of another reason −2 more (max −4 each, −20 per project) · excused delays need evidence and an on-time flag</span><span style="margin-left:auto"></span>${canLog ? btn("Log a delay", `drawer:delay:${p.code}`, { primary: !late.length }) : ""}</div>
  ${late.length ? `<div class="mb">${panel("Late tasks without a delay entry", table(["Task", "Owner", "Baseline due", "Status", "Timing", ""], late.map((t) => `<tr><td><b>${esc(t.title)}</b><span class="sub">${t.code}</span></td><td>${esc(pname(owner(t)))}</td><td>${fd(t.dueOriginal)}</td><td>${badge(t.status)}</td>
    <td>${t.status === "Completed" ? `<span class="warn-txt">Completed ${fd(t.acceptedOn, false)}</span>` : `<span class="bad-txt">${daysBetween(t.dueOriginal, TODAY)} day(s) past baseline</span>`}</td><td>${canLog ? btn("Log delay", `drawer:delay:${p.code}:${t.code}`, { sm: true, primary: true }) : ""}</td></tr>`)), { pad: false, meta: "From the task list · the champion logs each within 2 working days" })}</div>` : ""}
  ${panel("Delay log", table(["#", prog ? "Run · stage task" : "Task", "Reason", "Category", "Tagged to", "Evidence", "State", "#Penalty", ""], (r.delays || []).map((d, i) => `<tr><td class="mono">${d.id}</td><td>${esc(d.task)}${d.taskCode ? `<span class="sub">${d.taskCode}</span>` : ""}${d.stage ? `<span class="sub">Stage ${d.stage} · ${esc(EMAIL_TEMPLATE.stages[d.stage - 1].name)}</span>` : ""}</td><td class="wrap">${esc(d.reason)}</td>
    <td>${p.code === "PRJ-D01" && isAdmin() ? `<select class="select-sm" data-rrcat="${p.code}:${i}">${DELAY_REASONS.filter((x) => x.code !== "X").map((x) => `<option value="${x.code}" ${x.code === d.cat ? "selected" : ""}>${x.code} · ${esc(x.label)}</option>`).join("")}</select>` : `<span class="cat ${RR.controllable(d.cat) ? "" : "ex"}">${d.cat}</span> ${esc(catLabel(d))}`}</td>
    <td class="wrap">${d.tagged.length ? d.tagged.map(pname).join(", ") : `<span class="muted">${RR.controllable(d.cat) ? "Project" : "No one"}</span>`}</td><td class="wrap small">${esc(d.evidence || "—")}</td><td>${badge(d.state)}</td>
    <td class="n ${RR.controllable(d.cat) ? "bad-txt" : ""}">${RR.controllable(d.cat) ? "−" + Math.min(4, 2 + (d.c4 ? 2 : 0)) : 0}</td>
    <td>${d.state === "Logged" ? btn("Validate", `rrValidate:${p.code}:${i}`, { sm: true, disabled: !has("PMO validator"), title: has("PMO validator") ? "" : "Needs the PMO validator function" }) : d.state === "Validated" ? btn("Challenge", `rrChallenge:${p.code}:${i}`, { sm: true }) : ""}</td></tr>`), "No delays logged"), { pad: false, foot: p.code === "PRJ-D01" && isAdmin() ? `<span class="note">Prototype: change a category and the Scorecard and Recognition figures recalculate.</span>` : "" })}`;
}

/* ---------- Scorecard ---------- */
function rrScorecard(p) {
  const r = p.rr;
  if (r.fixed && r.fixed.score != null) return `${callout("neutral", `${p.code} is ${r.stage.toLowerCase()}`, `with a final score of ${fmt2(r.fixed.score)} (${RR.band(r.fixed.score)}). The full worked scorecard is wired for PRJ-D01 in this prototype.`, `<a class="btn sm" href="#/projects/PRJ-D01/scorecard">Open PRJ-D01</a>`)}`;
  if (p.code !== "PRJ-D01") {
    const why = r.mode === "programme" ? (r.charter === "Locked" ? "Collecting inputs for the quarter. Scored at quarter end from stage tasks, stage SLAs, computed rework and Finance-confirmed conversions." : "The charter isn't locked. A project without a locked baseline can't be scored for reward.")
      : r.charter !== "Locked" ? "No locked baseline: not eligible for scoring." : r.fixed ? "Waiting for Finance to confirm the value figure. The Finance gate fails until then." : "Scored at closure. Inputs collected so far are below; missing inputs show as Insufficient data, never 0.";
    const m = DELIVERY.projectMetrics(p);
    return panel("Scorecard", `${empty(r.mode === "programme" && r.charter !== "Locked" ? "Not eligible for scoring yet" : "Not scored yet", why, r.mode === "programme" ? `<a class="btn" href="#/projects/${p.code}/charter">Open charter</a>` : "")}
      ${r.mode !== "programme" && r.charter === "Locked" && !r.fixed ? table(["Parameter", "Input so far", "Source"], [`<tr><td>Revenue / value</td><td><span class="unavail">Insufficient data</span></td><td>Finance confirms after go-live</td></tr>`, `<tr><td>Delivery timelines</td><td>${RR.taskTimelines(p.code).onTime} of ${RR.taskTimelines(p.code).due} due tasks completed by the baseline date</td><td>Tasks (baseline due dates)</td></tr>`, `<tr><td>TAT / SLA</td><td>${r.slas.length} SLAs locked</td><td>Stage tasks + manual counts</td></tr>`, `<tr><td>Quality</td><td>${S.tasks.filter((t) => t.project === p.code && t.decisions.some((d) => d.decision === "rework")).length} rework decision(s) so far</td><td>Reviews, incidents, satisfaction survey</td></tr>`, `<tr><td>Completed tasks</td><td>${pct(m.delivery)}</td><td>Completed task complexity</td></tr>`]) : ""}`);
  }
  const sc = RR.score(p), money = seesMoney(), steps = ["Baseline locked", "Inputs validated", "HR calibrated", "Panel approved", "Published"], at = steps.indexOf(r.stage);
  const row = (label, target, actual, by, pts, max, indent) => `<tr><td ${indent ? 'style="padding-left:24px"' : ""}>${indent ? label : `<b>${label}</b>`}</td><td>${target}</td><td class="wrap">${actual}</td><td>${by}</td><td class="n"><span class="pct-cell"><span class="minibar"><i class="${pts / max < 0.72 ? "low" : ""}" style="width:${pts / max * 100}%"></i></span><b>${pts}</b>&nbsp;/ ${max}</span></td></tr>`;
  return `<div class="steps">${steps.map((s, i) => `<span class="${i < at ? "done" : i === at ? "now" : ""}"><span class="dot">${i < at ? "✓" : i + 1}</span>${s}</span>`).join("")}<span class="right">Policy PR-1 (proposed)</span></div>
  <div class="row mb"><label class="toggle"><input type="checkbox" data-p9 ${S.p9doc ? "checked" : ""}> P9: use the doc §13 reading of collaboration (+3 instead of +4)</label><span style="margin-left:auto"></span>
    ${btn("Raise dispute", `drawer:dispute:${p.code}`)}${r.stage === "Panel approved" ? btn("Publish scorecard", "rrPublish", { primary: true, disabled: !has("R&R Panel member"), title: has("R&R Panel member") ? "" : "Needs the R&R Panel member function" }) : badge("Published")}</div>
  <div class="split wide-side"><div class="stack">
    <section class="panel"><div class="panel-b"><div class="phero"><div><div class="small muted">Final project score</div><div class="score">${fmt2(sc.score)}<small>/ 110</small></div><div class="row" style="margin-top:8px">${tier(sc.band)}<span class="small muted">Project band</span></div></div>
      <div class="pcalc"><div><div class="lbl">Base</div><div class="v">${sc.base}</div></div><div><div class="lbl">Bonus</div><div class="v pos">+${sc.bonus}</div></div><div><div class="lbl">Delays</div><div class="v neg">−${sc.penalty}</div></div><div><div class="lbl">Recovery</div><div class="v">${r.recovery}</div></div><div><div class="lbl">Final</div><div class="v">${fmt2(sc.score)}</div></div></div></div></div></section>
    ${panel("Scorecard", table(["Parameter", "Baseline target", "Actual", "Validated by", "#Points"], [
      row("Revenue / business value", crore(r.value.target), `${crore(r.value.actual)} <span class="muted">(${sc.valuePct.toFixed(1)}%)</span>`, "Finance", sc.pts.revenue, 30),
      row("Delivery timelines", r.timedTasks + " tasks with baseline dates", `${sc.onTime} completed by the baseline date <span class="muted">(${sc.onTime / r.timedTasks * 100}%)</span>`, "PMO", sc.pts.timelines, 25),
      row("TAT / SLA adherence", "95% within SLA", `${(r.sla.within / r.sla.total * 100).toFixed(0)}% <span class="muted">(${r.sla.within} of ${r.sla.total})</span>`, "PMO", sc.pts.sla, 20),
      `<tr class="group"><td colspan="5">Quality · ${sc.quality} of 25 (bonus gate: 15 or more)</td></tr>`,
      row("Rework", "5% or less of effort", r.rework + "%", "QA", sc.pts.rework, 10, 1), row("Errors after go-live (30 days)", "0 critical", `${r.errors.crit} critical, ${r.errors.minor} minor`, "Operations", sc.pts.errors, 8, 1), row("Stakeholder satisfaction", "4.5 of 5", `${r.sat} <span class="muted">(${r.satN} responses)</span>`, "HR survey", sc.pts.sat, 7, 1),
      `<tr class="group"><td colspan="5">Bonus · ${sc.quality >= 15 ? "counts because Quality ≥ 15" : "does not count: Quality below 15"}</td></tr>`,
      `<tr><td style="padding-left:24px">Innovation</td><td colspan="2">Reusable KYC checklist adopted by two other teams</td><td>R&amp;R Panel</td><td class="n"><b>+${r.innovation}</b> / 5</td></tr>`,
      `<tr><td style="padding-left:24px">Collaboration</td><td colspan="2" class="wrap">Outside feedback ${r.collab.avg} of 5 (${r.collab.raters} raters) · playbook published ${S.p9doc ? `<span class="badge warn">Doc §13 reading</span>` : `<span class="badge outline">§3.2: +3 and +1</span>`}</td><td>HR</td><td class="n"><b>+${sc.collab}</b> / 5</td></tr>`]), { pad: false, meta: "Targets locked at kickoff; actuals validated outside the team" })}
  </div><div class="stack">
    ${panel("Gates", sc.gates.map((g) => `<div class="gate-row"><span class="ok-dot" style="${g.ok ? "" : "background:var(--bad-tint);color:var(--bad)"}">${g.ok ? "✓" : "✕"}</span><span>${g.k}<span class="src">${esc(g.src)}</span></span></div>`).join(""), { meta: "All must pass for any reward" })}
    ${panel("Reward pool", money ? `<dl class="kv"><dt>Confirmed value</dt><dd>${inr(r.value.actual)}</dd><dt>Pool rate</dt><dd>${r.poolRate * 100}%</dd><dt>Reward pool</dt><dd>${inr(sc.pool)}</dd><dt>Total units</dt><dd>${sc.totalUnits}</dd><dt>Value of one unit</dt><dd>${inr(sc.pool / sc.totalUnits)}</dd><dt class="tot">Indicative payouts</dt><dd class="tot">${inr(sc.paid)}</dd><dt>To Recognition &amp; Learning Fund</dt><dd>${inr(sc.fund)}</dd></dl><p class="note mt">Visible because you are ${isAdmin() ? "Admin" : "an R&amp;R Panel member"}. 80% at closure, 20% after the 90-day holdback.</p>`
      : `<p class="hidden-role">Units and ₹ are visible to Admin and R&amp;R Panel members only. They are removed on the server and in exports.</p>`, { tools: `<span class="badge warn">Indicative</span>` })}
    ${panel("Disputes", (r.disputes || []).length ? r.disputes.map((d) => `<div class="small">${badge("Open")} ${esc(d)}</div>`).join("") : `<span class="muted small">No disputes raised.</span>`, { meta: "Window closes 03 Nov 2026" })}</div></div>
  <div class="sec-title"><h2>People</h2><span class="meta">Individual score = project score + contribution adjustment − own tagged delays (max −10)${has("HR calibrator") ? " · adjustments editable as HR calibrator" : ""}</span></div>
  ${panel("", table(["Person", "RACI", ...(money ? ["#Units"] : []), "#Contribution adj.", "#Tagged delays", "#Individual score", "Band", ...(money ? ["#Payout %", "#Indicative payout"] : [])], [...sc.people.map((x, i) => !canSeePerf(x.emp) && x.L !== "I" ? `<tr><td><b>${esc(pname(x.emp))}</b></td><td>${x.L}</td><td colspan="${money ? 7 : 4}" class="hidden-role">${S.persona === "tl" ? "Team Leads don't see individual scores" : "Not in your reporting tree"}</td></tr>`
    : `<tr><td><b>${esc(pname(x.emp))}</b><span class="sub">${esc(x.note)}</span></td><td>${x.L}</td>${money ? `<td class="n">${x.units}</td>` : ""}<td class="n">${x.L === "I" ? "—" : has("HR calibrator") ? `<input class="mini-in" type="number" min="-10" max="10" value="${x.adj}" data-rradj="${i}">` : (x.adj > 0 ? "+" : "") + x.adj}</td>
      <td class="n ${x.tagged ? "bad-txt" : ""}">${x.L === "I" ? "—" : x.tagged ? "−" + x.tagged : 0}</td><td class="n big">${x.indiv == null ? "—" : fmt2(x.indiv)}</td><td>${x.indiv == null ? `<span class="badge outline">Recognition only</span>` : tier(x.band)}</td>
      ${money ? `<td class="n">${x.indiv == null ? "—" : x.pct * 100 + "%"}</td><td class="n money">${x.indiv == null ? "—" : inr(x.payout)}</td>` : ""}</tr>`),
    ...(money ? [`<tr class="total"><td>Total</td><td></td><td class="n">${sc.totalUnits}</td><td></td><td class="n">−${sc.people.reduce((s, x) => s + (x.tagged || 0), 0)}</td><td></td><td></td><td></td><td class="n money">${inr(sc.paid)}</td></tr>`] : [])]), { pad: false }).replace('<div class="panel-h"><h2></h2></div>', "")}`;
}

/* ---------- R&R drawers ---------- */
function delaySuggestion(code, f) {
  const prog = proj(code).rr.mode === "programme", st = prog ? EMAIL_TEMPLATE.stages.find((s) => s.step === Number(f.stage || 3)) : null;
  const lines = st ? [`Stage ${st.step} dependencies: ${EMAIL_TEMPLATE.risks[st.step].deps}.`, `Assumptions: ${EMAIL_TEMPLATE.risks[st.step].assumptions}.`, ...(st.regulator ? ["This stage can wait on a regulator (TRAI / WhatsApp): that wait is External dependency (E2)."] : [])] : [];
  const r = DELAY_REASONS.find((x) => x.code === f.cause);
  return { s: r ? [r.code, r.help] : null, lines, st };
}
DRAWERS.delay = (arg) => {
  const [code] = arg.split("|"), p = proj(code), prog = p.rr.mode === "programme", f = DRAWER.form, { s, lines, st } = delaySuggestion(code, f), t = prog ? null : task(f.task);
  const own = S.tasks.filter((x) => x.project === code && x.dueOriginal), lateCodes = RR.taskTimelines(code).late.map((x) => x.code);
  const due = t ? t.dueOriginal : f.due, c4 = f.flagged && due ? RR.c4(st ? st.sla[0] : null, prog ? f.start : null, due, f.flagged) : null, excused = s && !RR.controllable(s[0]);
  return { eyebrow: p.code, title: "Log a delay", sub: "Logged by the champion within 2 working days of knowing about the slip", body: `<div class="stack">
    ${field(prog ? "Run" : "Late task", "task", sel("task", prog ? p.rr.runs.map((x) => `${x.id} · ${x.title}`) : own.length ? own.map((x) => [x.code, `${x.code} · ${x.title}${lateCodes.includes(x.code) ? " (late)" : ""}`]) : ["Front-end build", "UAT sign-off", "Go-live checklist"]), { req: true, help: prog ? "" : "Every delay belongs to one task." })}
    ${prog ? field("Stage task", "stage", sel("stage", EMAIL_TEMPLATE.stages.map((x) => [x.step, `${x.step} · ${x.name} (SLA ${x.sla[0]}/${x.sla[1]} bd)`])), { req: true }) : ""}
    ${field("Reason for the delay", "cause", sel("cause", DELAY_REASONS.map((x) => [x.code, `${x.label}${x.ctrl ? "" : " (excused)"}`])), { req: true })}
    ${f.cause === "X" ? field("Custom reason", "custom", inp("custom", 'placeholder="Name the reason"'), { req: true }) : ""}
    <div class="sug"><b>${s ? `${s[0]} · ${esc(f.cause === "X" && f.custom ? "Custom: " + f.custom : CAT[s[0]])} · ${RR.controllable(s[0]) ? "controllable, −2" : "excused"}` : "Choose a reason"}</b>${s ? `<div style="margin-top:4px">${esc(s[1])}</div>` : ""}${lines.map((l) => `<div class="note" style="margin-top:4px">${esc(l)}</div>`).join("")}<div class="note" style="margin-top:6px">The PMO validator confirms the category. It isn't final until then.</div></div>
    <div class="form-grid">${prog ? field("Stage started", "start", inp("start", 'type="date"')) : ""}${t ? field("Baseline due date", "due", `<div class="input" style="display:flex;align-items:center">${fd(t.dueOriginal)}</div>`, { help: "From the task" }) : field("Due date", "due", inp("due", 'type="date"'), { req: true })}${field("First flagged on", "flagged", inp("flagged", 'type="date"'))}</div>
    ${c4 && f.cause !== "C4" ? `<div class="callout ${c4.miss ? "bad" : "ok"}"><span><b>${c4.miss ? "Escalation miss: another −2" : "Escalated in time"}</b><span class="note" style="display:block">${esc(c4.why)}</span></span></div>` : ""}
    ${field("Reason", "reason", txt("reason", "What happened"), { req: true })}
    ${field("Evidence", "evidence", inp("evidence", 'placeholder="Email, ticket or approved change request"'), { req: excused, help: excused ? "Excused delays need written evidence and an on-time flag. Without evidence in 5 working days this becomes controllable." : "Optional for controllable delays." })}</div>`,
    foot: `${btn("Cancel", "closeDrawer")}${btn("Log delay", `rrSaveDelay:${code}`, { primary: true, disabled: !s })}` };
};
DRAWERS.dispute = (code) => ({ eyebrow: code, title: "Raise a dispute", sub: "Within 7 working days of publication · PMO and HR review in 5, then the R&amp;R Panel in 10",
  body: `<div class="stack">${field("What is disputed", "what", sel("what", ["Delay D2 category (C2 → E2)", "Contribution adjustment", "Quality input"]), { req: true })}${field("Written grounds", "reason", txt("reason", "Explain and attach evidence"), { req: true })}<p class="note">Raising a dispute in good faith is never held against anyone. An upheld dispute re-freezes the scorecard and keeps the old and new results.</p></div>`,
  foot: `${btn("Cancel", "closeDrawer")}${btn("Submit dispute", `rrSaveDispute:${code}`, { primary: true })}` });
DRAWERS.baseline = (code) => ({ eyebrow: code, title: "Request a baseline change", sub: "Sponsor and PMO approve before the task's due date · becomes an E3 excuse · the original is kept",
  body: `<div class="stack">${field("Task", "task", sel("task", (S.tasks.filter((t) => t.project === code && t.dueOriginal).map((t) => [t.code, `${t.code} · ${t.title} (due ${fd(t.dueOriginal, false)})`])).concat(S.tasks.some((t) => t.project === code) ? [] : ["Front-end build", "UAT sign-off", "Go-live checklist"])), { req: true })}${field("New date", "date", inp("date", 'type="date"'), { req: true })}${field("Reason", "reason", txt("reason", "Approved scope change, with the change request reference"), { req: true })}</div>`,
  foot: `${btn("Cancel", "closeDrawer")}${btn("Send to sponsor and PMO", `rrSaveBaseline:${code}`, { primary: true })}` });
