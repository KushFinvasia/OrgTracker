/* Pure rules, mirroring the plan: delivery derivations (services/common.py, services/delivery.py) and the Project R&R engine
   (services/project_scoring.py). No DOM access here. */
// Dates are ISO strings handled in UTC, so the browser's time zone (IST is +5:30) never shifts a day.
const D = (iso) => new Date(iso + "T00:00:00Z");
const ISO = (d) => d.toISOString().slice(0, 10);
const addDays = (iso, n) => { const d = D(iso); d.setUTCDate(d.getUTCDate() + n); return ISO(d); };
const dow = (iso) => D(iso).getUTCDay();
const isWorkday = (iso) => { const w = dow(iso); return w !== 0 && w !== 6 && !(typeof S !== "undefined" ? S.holidays : []).some((h) => h.day === iso); };
function bdays(aISO, bISO) { // business days after a, up to and including b; weekends and calendar holidays skipped
  let a = aISO, b = bISO, sign = 1, n = 0;
  if (b < a) { [a, b] = [b, a]; sign = -1; }
  while (a < b) { a = addDays(a, 1); if (isWorkday(a)) n++; }
  return n * sign;
}
function addBdays(startISO, days) { let d = startISO, n = 0; while (n < days) { d = addDays(d, 1); if (isWorkday(d)) n++; } return d; }
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);

const DELIVERY = {
  // Task statuses from the team's tracker dropdown, in its order (user direction, 23 Oct 2026). Values match the tracker for imports.
  // Completed is still set only by the reviewer's Accept; In Review and Rework only by the review workflow. A status is a label:
  // "Delayed" doesn't log a delay and "Live" doesn't complete a task (timing and delays come from dates).
  TASK_STATUSES: ["Not Started", "In Progress", "Completed", "On Hold", "Delayed", "Testing QA", "Exotel Vendor", "Pending", "In Development", "Block", "Production", "Ready For Live", "Product", "Vendor", "Live Today", "Unit testing", "Internal CUG", "Live"],
  get MANUAL_STATUSES() { return this.TASK_STATUSES.filter((s) => s !== "Completed"); },
  // Board lanes: each groups several statuses
  LANES: [["To do", ["Not Started"]], ["In progress", ["In Progress", "In Development", "Unit testing", "Testing QA", "Internal CUG"]], ["Waiting or blocked", ["Pending", "On Hold", "Delayed", "Block", "Product", "Vendor", "Exotel Vendor"]],
    ["Going live", ["Ready For Live", "Production", "Live Today", "Live"]], ["In review", ["In Review", "Rework"]], ["Completed", ["Completed"]]],
  BLOCKERS: { "Internal dependency": true, "External or vendor": true, "Approval pending": true, "Management reprioritisation": true, "Requirement change": true, "Resource": true, "Technical issue": false, "Own-team rework": false },
  timing(t) {
    if (t.status === "Cancelled" || t.status === "On Hold") return "Not eligible";
    if (!t.due) return "No deadline";
    if (t.status === "Completed") return t.acceptedOn <= t.due ? "On time" : "Late";
    if (t.status === "In Review") { const s = t.submissions.at(-1); return s && s.date <= t.due ? "On time" : "Late"; }
    if (t.due < TODAY) return "Overdue";
    if (daysBetween(TODAY, t.due) <= 3) return "Due soon";
    return "On time";
  },
  taskDates(t) {
    // Elapsed working days, not recorded effort. Reviewer waiting time stops at submission.
    const finish = t.status === "Completed" ? t.acceptedOn : t.status === "In Review" ? t.submissions.at(-1)?.date : TODAY;
    const working = t.start && finish && t.start <= finish && !["Not Started", "On Hold", "Cancelled"].includes(t.status)
      ? bdays(addDays(t.start, -1), finish) : null;
    const delay = t.due && finish && !["On Hold", "Cancelled"].includes(t.status) ? Math.max(0, daysBetween(t.due, finish)) : null;
    return { working, delay };
  },
  validateDates(d) {
    const errs = [];
    if (d.start && d.due && d.due < d.start) errs.push({ field: "due", msg: "The end date is before the start date." });
    if (d.start && d.goLive && d.goLive < d.start) errs.push({ field: "goLive", msg: "The go-live date is before the start date." });
    return errs;
  },
  // Validation rules from CLAUDE.md §8. Returns [{field, msg}].
  validateTask(d) {
    const errs = [];
    if (!d.title?.trim()) errs.push({ field: "title", msg: "Enter a task title." });
    if (!d.project) errs.push({ field: "project", msg: "Choose a project." });
    if (!d.description?.trim()) errs.push({ field: "description", msg: "Describe the work." });
    const owners = d.rows.filter((r) => r.role === "Owner");
    if (owners.length !== 1) errs.push({ field: "rows", msg: "Exactly one Owner is required." });
    const ids = d.rows.map((r) => r.emp).filter(Boolean);
    if (ids.length !== d.rows.length) errs.push({ field: "rows", msg: "Choose a person for every assignment." });
    if (new Set(ids).size !== ids.length) errs.push({ field: "rows", msg: "The same person appears twice." });
    const total = d.rows.reduce((s, r) => s + Number(r.share || 0), 0);
    if (total !== 100) errs.push({ field: "rows", msg: `Contribution shares total ${total}%. They must total 100%.` });
    if (!d.reviewer) errs.push({ field: "reviewer", msg: "Choose an independent reviewer." });
    else if (ids.includes(d.reviewer)) errs.push({ field: "reviewer", msg: "The reviewer is an assignee. Choose another person." });
    errs.push(...this.validateDates(d));
    return errs;
  },
  projectMetrics(p) {
    const tasks = S.tasks.filter((t) => t.project === p.code && t.status !== "Cancelled");
    const denom = tasks.reduce((s, t) => s + t.complexity, 0);
    const accepted = tasks.filter((t) => t.status === "Completed");
    const overdue = tasks.filter((t) => DELIVERY.timing(t) === "Overdue");
    const blocked = tasks.filter((t) => t.status === "Block");
    const risks = p.risks.filter((r) => r.state !== "Closed");
    const high = risks.filter((r) => r.crit === "High" || r.crit === "Critical");
    let health = null;
    if (!["Completed", "Cancelled"].includes(p.status)) health = p.status === "Blocked" || overdue.length >= 2 || risks.some((r) => r.crit === "Critical") ? "Off Track" : overdue.length || blocked.length || high.length ? "At Risk" : "On Track";
    return { total: tasks.length, accepted: accepted.length, delivery: denom ? accepted.reduce((s, t) => s + t.complexity, 0) / denom * 100 : null,
      progress: denom ? Math.round(tasks.reduce((s, t) => s + (t.status === "Completed" ? 100 : t.progress) * t.complexity, 0) / denom) : null,
      overdue: overdue.length, blocked: blocked.length, openRisks: risks.length, highRisks: high.length, health };
  },
  acceptedOutput(emp) { // Σ complexity × contribution fraction over accepted tasks
    return S.tasks.filter((t) => t.status === "Completed").reduce((s, t) => s + t.complexity * ((t.assignments.find((a) => a.emp === emp)?.share || 0) / 100), 0);
  },
};

// Delay reasons (user list, 23 Oct 2026). Controllable reasons cost −2; excused reasons need written evidence and an on-time flag.
// A custom reason counts as controllable until the PMO validator re-categorises it.
const DELAY_REASONS = [
  { code: "C1", label: "Planning / estimation", help: "The plan or effort estimate was too optimistic", ctrl: true },
  { code: "C2", label: "Rework / resource unavailable", help: "Work came back for rework, or a person or resource wasn't available", ctrl: true },
  { code: "C3", label: "Delay in compliances", help: "A compliance check, approval or filing ran late", ctrl: true },
  { code: "C4", label: "Escalation miss", help: "The slip wasn't flagged in time for anyone to act", ctrl: true },
  { code: "E1", label: "Client-caused", help: "The requesting department or client was late with a brief, input or sign-off", ctrl: false },
  { code: "E2", label: "External dependency", help: "Vendor, another department, regulator or outage outside the team's control", ctrl: false },
  { code: "E3", label: "Approved scope or baseline change", help: "Only if the change request was approved before the due date", ctrl: false },
  { code: "X", label: "Custom", help: "Describe the reason. It counts as controllable until the PMO validator decides otherwise", ctrl: true },
];

const RR = {
  revenue: (pct) => pct >= 100 ? 30 : pct >= 90 ? 24 : pct >= 80 ? 18 : pct >= 70 ? 10 : 0,
  timelines: (pct) => pct >= 90 ? 25 : pct >= 80 ? 20 : pct >= 70 ? 14 : pct >= 60 ? 8 : 0,
  sla: (pct) => pct >= 95 ? 20 : pct >= 90 ? 16 : pct >= 80 ? 11 : pct >= 70 ? 6 : 0,
  rework: (pct) => pct <= 5 ? 10 : pct <= 10 ? 7 : pct <= 15 ? 4 : 0,
  errors: (crit, minor) => crit >= 2 ? 0 : crit === 1 ? 2 : minor <= 2 ? 8 : minor <= 5 ? 5 : 2,
  satisfaction: (s) => s >= 4.5 ? 7 : s >= 4.0 ? 5 : s >= 3.5 ? 3 : 0,
  collaboration: (avg, raters, items, docReading) => Math.min(5, (raters >= 3 && avg >= 4 ? 3 : 0) + (docReading ? 0 : Math.min(2, items))),
  band: (s) => s >= 90 ? "Platinum" : s >= 80 ? "Gold" : s >= 70 ? "Silver" : s >= 60 ? "Bronze" : "Review",
  payoutPct: (b) => ({ Platinum: 1, Gold: 0.8, Silver: 0.6 })[b] || 0,
  controllable: (cat) => DELAY_REASONS.find((r) => r.code === cat)?.ctrl ?? true,
  // Timing against the locked baseline: the task's original due date. An approved date change is an E3 excuse, never a new baseline.
  // Completed work is judged by its accepted submission date; In Review on time waits for the decision; open work past the baseline is late.
  baseline(t) {
    const base = t.dueOriginal;
    if (!base || t.status === "Cancelled" || t.status === "On Hold") return null;
    if (t.status === "Completed") return t.acceptedOn <= base ? "On time" : "Late";
    if (t.status === "In Review") { const s = t.submissions.at(-1); return s && s.date > base ? "Late" : "Pending"; }
    return base < TODAY ? "Late" : "Not due";
  },
  // Delivery timelines and the delay log both come from the project's tasks: one late task = one delay.
  taskTimelines(code) {
    const rows = S.tasks.filter((t) => t.project === code).map((t) => ({ t, b: RR.baseline(t) })).filter((x) => x.b === "On time" || x.b === "Late");
    return { due: rows.length, onTime: rows.filter((x) => x.b === "On time").length, late: rows.filter((x) => x.b === "Late").map((x) => x.t) };
  },
  penalty(delays) { let t = 0; for (const d of delays) if (RR.controllable(d.cat)) t += Math.min(4, 2 + (d.c4 ? 2 : 0)); return Math.min(20, t); },
  c4(slaDays, startISO, dueISO, flaggedISO) {
    if (!flaggedISO) return { miss: true, why: "Not flagged yet" };
    if (slaDays && slaDays <= 3 && startISO) { const used = bdays(startISO, flaggedISO), half = slaDays / 2; return { miss: used > half, why: `Short stage (${slaDays} bd SLA): flagged after ${used} bd, limit ${half} bd` }; }
    const before = bdays(flaggedISO, dueISO); return { miss: before < 2, why: `Flagged ${before} business day(s) before the due date, needs 2` };
  },
  units(raci) {
    const a = raci.filter((r) => r.L === "A").length * 3, r = raci.filter((x) => x.L === "R").reduce((s, x) => s + 2 * (x.f || 0), 0);
    const cs = raci.filter((x) => x.L === "C").length * 0.5, cap = 0.25 * (a + r), scale = cs > cap && cs > 0 ? cap / cs : 1;
    return raci.map((x) => ({ ...x, units: x.L === "A" ? 3 : x.L === "R" ? 2 * (x.f || 0) : x.L === "C" ? 0.5 * scale : 0 }));
  },
  score(p) { // full worked scorecard (PRJ-D01)
    const r = p.rr, valuePct = r.value.actual / r.value.target * 100, controllable = r.delays.filter((d) => RR.controllable(d.cat)).length, onTime = r.timedTasks - controllable;
    const pts = { revenue: RR.revenue(valuePct), timelines: RR.timelines(onTime / r.timedTasks * 100), sla: RR.sla(r.sla.within / r.sla.total * 100), rework: RR.rework(r.rework), errors: RR.errors(r.errors.crit, r.errors.minor), sat: RR.satisfaction(r.sat) };
    const quality = pts.rework + pts.errors + pts.sat, base = pts.revenue + pts.timelines + pts.sla + quality;
    const collab = RR.collaboration(r.collab.avg, r.collab.raters, r.collab.items, S.p9doc), bonus = quality >= 15 ? Math.min(10, r.innovation + collab) : 0;
    const penalty = RR.penalty(r.delays), score = Math.max(0, Math.min(110, base + bonus - penalty + r.recovery)), band = RR.band(score);
    const gates = [
      { k: "Baseline locked at kickoff", ok: r.charter === "Locked", src: "Sponsor and PMO · " + (r.lockedOn || "not locked") },
      { k: "Quality 15 or more", ok: quality >= 15, src: quality + " of 25" },
      { k: "Value confirmed by Finance", ok: !!r.value.confirmed, src: "₹" + (r.value.actual / 1e7).toFixed(2) + " crore · 17 Oct 2026" },
      { k: "No attributable compliance breach", ok: r.compliance, src: "Incident register · 0 validated Major" },
    ];
    const gatesOk = gates.every((g) => g.ok), pool = r.value.actual * r.poolRate, withUnits = RR.units(r.raci), totalUnits = withUnits.reduce((s, x) => s + x.units, 0);
    const people = withUnits.map((x) => {
      if (x.L === "I") return { ...x, tagged: 0, indiv: null };
      const tagged = Math.min(10, r.delays.filter((d) => RR.controllable(d.cat) && d.tagged.includes(x.emp)).length * 2);
      const indiv = Math.max(0, Math.min(110, score + (x.adj || 0) - tagged)), b = RR.band(indiv), pct = RR.payoutPct(b), share = totalUnits ? x.units / totalUnits * pool : 0;
      return { ...x, tagged, indiv, band: b, pct, share, payout: gatesOk && score >= 70 ? share * pct : 0 };
    });
    const paid = people.reduce((s, x) => s + (x.payout || 0), 0);
    return { valuePct, onTime, pts, quality, base, collab, bonus, penalty, score, band, gates, gatesOk, pool, totalUnits, people, paid, fund: pool - paid };
  },
  // resolve_project_raci: one letter per person, stage-level A → workstream lead, C on own stage dropped, effort share → suggested factor
  resolve(stages, champion) {
    const mid = (st) => (st.effort[0] + st.effort[1]) / 2, total = stages.reduce((s, st) => s + mid(st), 0), map = {};
    const touch = (id) => (map[id] ||= { id, A: [], R: [], C: [], I: [], notes: [] });
    for (const st of stages) { st.R.forEach((id) => touch(id).R.push(st.step)); if (st.A) touch(st.A).A.push(st.step); st.C.forEach((id) => touch(id).C.push(st.step)); st.I.forEach((id) => touch(id).I.push(st.step)); }
    const rows = [];
    for (const x of Object.values(map)) {
      const label = x.id.startsWith("@"); let L = null; const dropped = [];
      if (x.id === champion) { L = "A"; }
      else if (x.id === "@Head of requesting department") { L = "C"; x.notes.push("Outside approver, resolved per run. A missed stage SLA is a Client-caused delay (excused)"); }
      else if (x.A.length || x.R.length) { L = "R"; if (x.A.length) x.notes.push(`A on stage ${x.A.join(", ")} → workstream lead`); }
      else if (x.C.length) L = "C"; else if (x.I.length) L = "I";
      const own = new Set([...x.R, ...x.A]), cOwn = x.C.filter((s) => own.has(s));
      if (cOwn.length) { dropped.push("C"); x.notes.push(`C on stage ${cOwn.join(", ")} dropped (own stage)`); }
      if (L !== "I" && x.I.length) { dropped.push("I"); x.notes.push("I dropped: holds a stronger letter"); }
      const share = x.R.reduce((s, step) => s + mid(stages.find((st) => st.step === step)), 0) / total;
      if (x.id.startsWith("@Requester")) x.notes.push("The requesting side is the client, outside the delivery team. Their late brief is E1");
      rows.push({ ...x, label, L, dropped, share, suggested: L === "R" ? (share >= 0.4 ? 1 : share >= 0.2 ? 0.75 : 0.5) : null, payable: !label && !EMP[x.id]?.missing && ["A", "R", "C"].includes(L) });
    }
    const order = { A: 0, R: 1, C: 2, I: 3 };
    rows.sort((a, b) => (order[a.L] - order[b.L]) || (b.share - a.share));
    return { rows, total };
  },
};
