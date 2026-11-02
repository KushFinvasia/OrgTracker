/* Illustrative data for the Project Tier prototype. Names come from the sources (CLAUDE.md cast, RACI.xlsx, the HR framework's
   worked example); every date, task, score and amount is illustrative. "Today" is fixed so the prototype behaves the same every run. */
const TODAY = "2026-10-22";

const EMP = {
  "EMP-0324": { name: "Deepjyot Tiwari", desig: "Platform administrator", dept: "Admin" },
  "EMP-0081": { name: "Pradeep Thakur", desig: "Lead UI/UX", dept: "Product", manager: null },
  "EMP-0082": { name: "Sachin Barnwal", desig: "UI/UX designer", dept: "Product", manager: "EMP-0081" },
  "EMP-0083": { name: "Maninder Singh", desig: "UI/UX designer", dept: "Product", manager: "EMP-0081" },
  "EMP-0084": { name: "Harsh", desig: "UI/UX designer", dept: "Product", manager: "EMP-0081" },
  "EMP-0219": { name: "Kapil Abrol", desig: "HOD", dept: "Client Support" },
  "EMP-0221": { name: "Sahil Sharma", desig: "Team Lead", dept: "Client Support", manager: "EMP-0219" },
  "EMP-0109": { name: "Pawan Kumar", desig: "HOD", dept: "Operations & BO" },
  "EMP-0153": { name: "Miteeksha", desig: "Content manager", dept: "Digital Marketing" },
  "EMP-0118": { name: "Naveen Kumar", desig: "Email execution", dept: "Digital Marketing", dup: true },
  "EMP-D118": { name: "Naveen Kumar", desig: "Executive (second record, illustrative)", dept: "Operations & BO", dup: true },
  "EMP-0265": { name: "Gurjot Singh", desig: "HOD", dept: "Sales" },
  "ILL-01": { name: "Anita", desig: "Product manager (doc example)", dept: "Product", ill: true },
  "ILL-02": { name: "Ravi", desig: "Engineer (doc example)", dept: "Product", ill: true, manager: "EMP-0081" },
  "ILL-03": { name: "Simran", desig: "QA engineer (doc example)", dept: "Product", ill: true },
  "ILL-04": { name: "Kabir", desig: "Engineer (doc example)", dept: "Product", ill: true, manager: "EMP-0081" },
  "ILL-05": { name: "Meera", desig: "Compliance analyst (doc example)", dept: "Compliance", ill: true },
  "ILL-06": { name: "Arjun", desig: "Architect (doc example)", dept: "AI", ill: true },
  "MUKESH": { name: "Mukesh Thakur", desig: "Marketing POC (not in the org chart)", dept: "Digital Marketing", missing: true },
};

const PERSONAS = [
  { id: "admin", emp: "EMP-0324", role: "Admin", label: "Admin", fns: ["PMO validator", "HR calibrator", "R&R Panel member"] },
  { id: "manager", emp: "EMP-0081", role: "Manager", label: "Manager", fns: [] },
  { id: "hod", emp: "EMP-0219", role: "HOD", label: "HOD · Client Support", fns: ["R&R Panel member", "Quality assessor"], depts: ["Client Support"] },
  { id: "tl", emp: "EMP-0221", role: "Team Lead", label: "Team Lead · Client Support", fns: [] },
];
const FUNCTIONS = ["PMO validator", "Finance confirmer", "Quality assessor", "HR calibrator", "R&R Panel member"];

const DEPARTMENTS = ["Product", "Client Support", "Operations & BO", "Digital Marketing", "RMS & Dealer", "Sales", "Insurance", "Compliance", "AI"];

function seedData() {
  const T = (o) => ({ desc: "", complexity: 3, start: null, goLive: null, dueOriginal: o.due ?? null, status: "Not Started", progress: 0, nextAction: "", checklist: [], evidenceReq: "",
    files: [], submissions: [], decisions: [], blockers: [], dateChanges: [], comments: [], events: [], acceptedOn: null, version: 1, ...o });
  const tasks = [
    T({ code: "PRJ-015-T01", project: "PRJ-015", title: "Homepage hero redesign", desc: "New hero with the account-opening CTA and live market strip.", complexity: 3, start: "2026-10-05", due: "2026-10-20",
      status: "In Review", progress: 100, reviewer: "EMP-0081", assignments: [{ emp: "EMP-0082", role: "Owner", share: 100 }], checklist: ["Matches the approved brief", "Responsive at 360 / 768 / 1280", "CTA tracking parameters added"], evidenceReq: "Figma link + responsive screenshots",
      files: [{ name: "hero-v2.fig", size: "4.2 MB", at: "2026-10-17" }, { name: "responsive-screens.pdf", size: "1.1 MB", at: "2026-10-17" }],
      submissions: [{ v: 1, date: "2026-10-17", note: "Hero with CTA and market strip; mobile variant included.", files: ["hero-v2.fig", "responsive-screens.pdf"], by: "EMP-0082" }],
      events: [{ at: "2026-10-05", by: "EMP-0081", text: "Created (Not started)" }, { at: "2026-10-09", by: "EMP-0081", text: "Status: In progress, 40%" }, { at: "2026-10-17", by: "EMP-0082", text: "Sent for review (v1)" }] }),
    T({ code: "PRJ-015-T02", project: "PRJ-015", title: "Pricing page content refresh", complexity: 2, start: "2026-10-12", due: "2026-10-28", status: "In Progress", progress: 60, nextAction: "Legal check on brokerage table",
      reviewer: "EMP-0081", assignments: [{ emp: "EMP-0083", role: "Owner", share: 60 }, { emp: "EMP-0084", role: "Contributor", share: 40 }], checklist: ["Copy approved by Compliance", "Brokerage table matches the rate card"], evidenceReq: "Approved copy document" }),
    T({ code: "PRJ-015-T03", project: "PRJ-015", title: "Responsive QA across devices", complexity: 3, start: "2026-10-14", due: "2026-10-24", status: "Block", progress: 30, nextAction: "Waiting for the device lab slot",
      reviewer: "EMP-0081", assignments: [{ emp: "EMP-0084", role: "Owner", share: 100 }], checklist: ["Tested on the agreed device list", "Defects logged with screenshots"],
      blockers: [{ id: "BLK-31", category: "Internal dependency", desc: "Device lab booked by the app team until 27 Oct", since: "2026-10-20", evidence: "IT ticket #4471", requester: "EMP-0084", validator: "EMP-0081", state: "Pending" }] }),
    T({ code: "PRJ-015-T04", project: "PRJ-015", title: "Account-opening CTA tracking", complexity: 2, start: "2026-10-01", due: "2026-10-12", status: "Completed", progress: 100, reviewer: "EMP-0081",
      assignments: [{ emp: "EMP-0082", role: "Owner", share: 100 }], acceptedOn: "2026-10-10", submissions: [{ v: 1, date: "2026-10-10", note: "UTM and event tags live on staging", files: [], by: "EMP-0082" }],
      decisions: [{ v: 1, decision: "accept", at: "2026-10-13", by: "EMP-0081" }] }),
    T({ code: "PRJ-015-T05", project: "PRJ-015", title: "Footer and legal links update", complexity: 1, start: "2026-10-06", due: "2026-10-14", status: "Completed", progress: 100, reviewer: "EMP-0081",
      assignments: [{ emp: "EMP-0083", role: "Owner", share: 100 }], acceptedOn: "2026-10-15", submissions: [{ v: 1, date: "2026-10-15", note: "Links updated", files: [], by: "EMP-0083" }], decisions: [{ v: 1, decision: "accept", at: "2026-10-16", by: "EMP-0081" }] }),
    T({ code: "PRJ-015-T06", project: "PRJ-015", title: "Blog section templates", complexity: 2, start: "2026-10-27", due: "2026-11-05", reviewer: "EMP-0081", assignments: [{ emp: "EMP-0084", role: "Owner", share: 100 }] }),
    T({ code: "PRJ-015-T07", project: "PRJ-015", title: "SEO meta audit", complexity: 2, start: "2026-10-08", due: "2026-10-21", status: "Rework", progress: 80, nextAction: "Fix canonical tags", reviewer: "EMP-0081",
      assignments: [{ emp: "EMP-0083", role: "Owner", share: 100 }], checklist: ["Every page has a unique title and description", "Canonical tags correct"],
      submissions: [{ v: 1, date: "2026-10-18", note: "Meta audit sheet and fixes", files: ["seo-audit.xlsx"], by: "EMP-0083" }],
      decisions: [{ v: 1, decision: "rework", reason: "Acceptance criterion not met", failed: ["Canonical tags correct"], feedback: "12 product pages still point canonicals at staging.", reqChanged: false, at: "2026-10-19", by: "EMP-0081" }] }),
    T({ code: "PRJ-015-T08", project: "PRJ-015", title: "Performance budget fixes", complexity: 4, start: "2026-10-13", due: "2026-10-30", status: "In Development", progress: 30, reviewer: "EMP-0081",
      assignments: [{ emp: "EMP-0082", role: "Owner", share: 50 }, { emp: "EMP-0084", role: "Contributor", share: 50 }],
      dateChanges: [{ id: "DCR-08", from: "2026-10-30", to: "2026-11-07", reason: "Requirement change", comment: "Image CDN scope added by Product", evidence: "Product email 19 Oct", requester: "EMP-0082", validator: "EMP-0081", state: "Pending" }] }),
    T({ code: "PRJ-015-T09", project: "PRJ-015", title: "Accessibility contrast pass", complexity: 2, reviewer: "EMP-0081", assignments: [{ emp: "EMP-0082", role: "Owner", share: 100 }] }),
    T({ code: "PRJ-D07-T01", project: "PRJ-D07", title: "Design and testing", complexity: 3, start: "2026-10-12", due: "2026-10-23", status: "Testing QA", progress: 70, nextAction: "UAT with two agents",
      reviewer: "EMP-0219", assignments: [{ emp: "EMP-0221", role: "Owner", share: 100 }], checklist: ["Triage rules tested on 50 tickets"] }),
    T({ code: "PRJ-D07-T02", project: "PRJ-D07", title: "Co-ordination with Product", complexity: 2, start: "2026-10-26", due: "2026-11-04", reviewer: "EMP-0219", assignments: [{ emp: "EMP-0221", role: "Owner", share: 100 }] }),
    T({ code: "PRJ-D07-T03", project: "PRJ-D07", title: "Implementation sign-off", complexity: 1, start: "2026-11-05", due: "2026-11-10", reviewer: "EMP-0219", assignments: [{ emp: "EMP-0221", role: "Owner", share: 100 }] }),
  ];
  tasks.forEach((t) => { if (t.status === "Completed" || t.status === "In Review" || t.status === "Rework") t.dueOriginal = t.dueOriginal ?? t.due; });

  const P = (o) => ({ risks: [], incidents: [], members: [], closure: null, rr: null, archived: false, template: null, ...o });
  const projects = [
    P({ code: "PRJ-015", title: "Shoonya Website Enhancements", dept: "Product", priority: "High", status: "In Progress", owner: "EMP-0081", reviewer: "EMP-0219", start: "2026-10-01", target: "2026-11-14",
      objective: "Refresh the public website so more visitors start account opening, with accurate pricing and accessible pages.",
      risks: [
        { code: "RSK-W1", risk: "Image CDN migration may slip the performance work", stage: "Performance budget fixes", crit: "High", owner: "EMP-0081", mitigation: "Ship the critical images first; keep the old CDN as fallback", next: "2026-10-27", state: "Open", deps: "IT CDN change window", assumptions: "CDN vendor confirms the date" },
        { code: "RSK-W2", risk: "Compliance approval of pricing copy", stage: "Pricing page content refresh", crit: "Medium", owner: "EMP-0083", mitigation: "Share the draft early; weekly slot with Compliance", next: "2026-10-24", state: "Mitigating", deps: "Compliance desk", assumptions: "Rate card unchanged" },
        { code: "RSK-W3", risk: "Device lab availability", stage: "Responsive QA across devices", crit: "Low", owner: "EMP-0084", mitigation: "Use the cloud device farm as backup", next: "2026-10-30", state: "Open", deps: "App team lab booking", assumptions: "" },
      ],
      incidents: [{ code: "INC-015-01", title: "Broken KYC link on the homepage", system: "Website", date: "2026-10-16", received: "2026-10-16", reporter: "EMP-0221", severity: "Medium", severityValidated: null, clients: 37, orders: 0,
        respDept: "Product", stakeholder: "EMP-0082", state: "Under analysis", rootCause: "", category: "", gap: "", correction: "Link restored within 2 hours", correctionDate: "2026-10-16", expected: "2026-10-30",
        attribution: "pending", preventive: [{ title: "Add link checks to the release checklist", owner: "EMP-0083", due: "2026-10-29", reviewer: "EMP-0081", status: "Not Started" }],
        history: [{ at: "2026-10-16", text: "Recorded by Sahil Sharma" }, { at: "2026-10-16", text: "Correction done: link restored" }, { at: "2026-10-17", text: "Under analysis" }] }],
      closure: { state: "Draft", notes: {} },
      rr: { charter: "Locked", lockedOn: "01 Oct 2026", mode: "closure", type: "Standard", sponsor: "Head of Product", champion: "EMP-0081", value: { kind: "Account-opening starts from the website", target: "1,200 a month", actual: null },
        raci: [{ emp: "EMP-0081", L: "A", note: "Champion" }, { emp: "EMP-0082", L: "R", f: 1, note: "Full scope · factor 1.0" }, { emp: "EMP-0083", L: "R", f: 0.75, note: "Moderate scope · factor 0.75" }, { emp: "EMP-0084", L: "R", f: 0.75, note: "Moderate scope · factor 0.75" }, { emp: "EMP-0219", L: "C", resp: 2, note: "Agreed response: 2 days" }],
        slas: [{ name: "Review comments returned", tat: "2 bd", kind: "Internal TAT" }, { name: "Website defects fixed (P1)", tat: "1 bd", kind: "Client" }], delays: [], stage: "In delivery" } }),
    P({ code: "PRJ-D01", title: "Instant account-opening journey upgrade", dept: "Product", priority: "High", status: "Completed", owner: "ILL-01", reviewer: "EMP-0081", start: "2026-07-01", target: "2026-10-15",
      objective: "Cut account-opening time and lift completed openings (the HR framework's worked example).", closure: { state: "Approved", notes: {} },
      rr: { charter: "Locked", lockedOn: "02 Jul 2026", mode: "closure", type: "Complex", sponsor: "Head of Product", champion: "ILL-01", stage: "Panel approved", worked: true,
        value: { kind: "Revenue (₹)", target: 12000000, actual: 13500000, confirmed: true }, poolRate: 0.02, timedTasks: 10, sla: { within: 46, total: 50 }, rework: 8, errors: { crit: 0, minor: 2 }, sat: 4.3, satN: 14,
        innovation: 2, collab: { avg: 4.4, raters: 5, items: 1 }, recovery: 0, compliance: true,
        delays: [
          { id: "D1", task: "API integration", reason: "Vendor sandbox ready 5 days late; flagged on time with email evidence", cat: "E2", tagged: [], c4: false, evidence: "Vendor email, 14 Aug 2026", state: "Closed" },
          { id: "D2", task: "UAT test cases", reason: "QA engineer unavailable for a week; test cases submitted late", cat: "C2", tagged: ["ILL-03"], c4: false, evidence: "Jira UAT-112 history", state: "Closed" },
          { id: "D3", task: "Compliance review pack", reason: "Compliance review pack sent 3 days late", cat: "C3", tagged: ["ILL-01"], c4: false, evidence: "Compliance desk ticket", state: "Closed" },
        ],
        raci: [
          { emp: "ILL-01", L: "A", adj: 3, note: "Champion · adjustment set by the sponsor" }, { emp: "ILL-02", L: "R", f: 1, adj: 4, note: "Full scope · factor 1.0" },
          { emp: "ILL-03", L: "R", f: 1, adj: 0, note: "Full scope · factor 1.0" }, { emp: "ILL-04", L: "R", f: 0.5, adj: 2, note: "Joined late · factor 0.5" },
          { emp: "ILL-05", L: "C", adj: 2, resp: 2, note: "Agreed response: 2 days" }, { emp: "ILL-06", L: "C", adj: 5, resp: 3, note: "Agreed response: 3 days" },
          { emp: "HOS", L: "I", note: "Head of Sales · recognition only" },
        ],
        slas: [{ name: "Account-opening requests closed within TAT", tat: "1 bd", kind: "Client" }, { name: "Review comments returned", tat: "2 bd", kind: "Internal TAT" }], disputes: [] } }),
    P({ code: "PRJ-D06", title: "Trading-app watchlist revamp", dept: "Product", priority: "Medium", status: "Completed", owner: "EMP-0081", reviewer: "EMP-0219", start: "2026-06-02", target: "2026-09-26", objective: "Faster, configurable watchlists.",
      closure: { state: "Approved", notes: {} }, rr: { charter: "Locked", lockedOn: "05 Jun 2026", mode: "closure", type: "Standard", champion: "EMP-0081", stage: "Published", fixed: { score: 91.5, tasks: "14 of 14", delays: "0 · 1 excused", gates: "4/4", pool: 180000 } } }),
    P({ code: "PRJ-D02", title: "KYC re-verification drive", dept: "Client Support", priority: "Medium", status: "Completed", owner: "EMP-0219", reviewer: "EMP-0109", start: "2026-07-07", target: "2026-09-30", objective: "Re-verify dormant KYC records before the regulatory deadline.",
      closure: { state: "Approved", notes: {} }, rr: { charter: "Locked", lockedOn: "08 Jul 2026", mode: "closure", type: "Standard", champion: "EMP-0219", stage: "Panel review", fixed: { score: 74, tasks: "19 of 22", delays: "3 · 2 excused", gates: "4/4", pool: 291000 } } }),
    P({ code: "PRJ-D03", title: "Back-office reconciliation automation", dept: "Operations & BO", priority: "Medium", status: "In Review", owner: "EMP-0109", reviewer: "EMP-0324", start: "2026-06-15", target: "2026-10-10", objective: "Automate the daily reconciliation of client funds.",
      closure: { state: "Submitted", notes: {} }, rr: { charter: "Locked", lockedOn: "16 Jun 2026", mode: "closure", type: "Strategic", champion: "EMP-0109", stage: "Awaiting Finance", fixed: { score: null, tasks: "11 of 12", delays: "1 · 1 excused", gates: "Finance pending", pool: null } } }),
    P({ code: "PRJ-D04", title: "Dealer onboarding SLA revamp", dept: "RMS & Dealer", priority: null, status: "In Progress", owner: "EMP-0265", reviewer: null, start: "2026-09-01", target: "2026-12-15", objective: "Imported from the legacy tracker.", source: "import",
      rr: { charter: "Draft", mode: "closure", type: "Standard", champion: "EMP-0265", stage: "Charter draft", fixed: { score: null, tasks: "No baseline", delays: "0", gates: "No locked baseline", pool: null } } }),
    P({ code: "PRJ-D05", title: "Email campaigns · Oct–Dec 2026", dept: "Digital Marketing", priority: "Medium", status: "In Progress", owner: "EMP-0153", reviewer: "EMP-0324", start: "2026-10-01", target: "2026-12-31", template: "Email campaign",
      objective: "Run cross-department email campaigns through the Email campaign workflow, scored as one quarterly programme.",
      rr: { charter: "Draft", mode: "programme", type: "Standard", sponsor: "Head of Digital Marketing", champion: "MUKESH", stage: "Charter draft",
        c: { target: null, baselineMetrics: false, mukeshAdded: false, submitted: false, sponsorOk: false, pmoOk: false }, reviewers: { 2: null, 4: null, 5: null, 6: null }, confirmed: {},
        delays: [{ id: "D1", task: "R2 · MTF awareness mailer", stage: 3, reason: "Department sign-off took 3 bd against a 2 bd stage SLA", cat: "E1", tagged: [], c4: false, evidence: "Approval email thread", state: "Logged" }],
        runs: [
          { id: "R1", title: "Diwali trading offer", req: "Sales", started: "2026-10-01", done: [1, 1, 1, 1, 1, 1], late: [], delivered: "2026-10-12", maxDue: "2026-10-19" },
          { id: "R2", title: "MTF awareness mailer", req: "RMS & Dealer", started: "2026-10-05", done: [1, 1, 1, 1, 1, 0], late: [3], delivered: null, maxDue: "2026-10-23" },
          { id: "R3", title: "Client Support feedback survey", req: "Client Support", started: "2026-10-19", done: [1, 1, 0, 0, 0, 0], late: [], delivered: null, maxDue: "2026-11-06" },
        ] } }),
    P({ code: "PRJ-D07", title: "Client Support ticket triage revamp", dept: "Client Support", priority: "Medium", status: "In Progress", owner: "EMP-0219", reviewer: "EMP-0109", start: "2026-10-12", target: "2026-11-10", template: "Client Support issue flow",
      objective: "Route tickets to the right queue on first touch.", closure: { state: "Draft", notes: {} } }),
  ];

  const requests = [
    { id: "REQ-01", title: "Diwali trading offer email", template: "Email campaign", from: "Sales", to: "Digital Marketing", required: "2026-10-15", priority: "High", requester: "EMP-0265", validator: "EMP-0265", state: "Accepted", run: "R1" },
    { id: "REQ-02", title: "MTF awareness mailer", template: "Email campaign", from: "RMS & Dealer", to: "Digital Marketing", required: "2026-10-20", priority: "Medium", requester: "EMP-0265", validator: "EMP-0265", state: "Accepted", run: "R2" },
    { id: "REQ-03", title: "Client Support feedback survey", template: "Email campaign", from: "Client Support", to: "Digital Marketing", required: "2026-11-05", priority: "Medium", requester: "EMP-0221", validator: "EMP-0219", state: "Accepted", run: "R3" },
    { id: "REQ-04", title: "Insurance renewal reminder", template: "Email campaign", from: "Insurance", to: "Digital Marketing", required: "2026-11-12", priority: "Medium", requester: "EMP-0221", validator: "EMP-0219", state: "Submitted",
      audience: "Policy holders renewing in December", objective: "Lift on-time renewals", brief: "Approved copy attached; WhatsApp variant needs TRAI template approval" },
  ];

  const accounts = [
    { emp: "EMP-0324", email: "deepjyot.tiwari@shoonya.com", role: "Admin", scope: "Organisation", active: true },
    { emp: "EMP-0081", email: "pradeep.thakur@shoonya.com", role: "Manager", scope: "Reporting tree (3)", active: true },
    { emp: "EMP-0219", email: "kapil.abrol@shoonya.com", role: "HOD", scope: "Client Support", active: true },
    { emp: "EMP-0221", email: "sahil.sharma@shoonya.com", role: "Team Lead", scope: "Own team work", active: true },
    { emp: "EMP-0109", email: "pawan.kumar@shoonya.com", role: "HOD", scope: "Demat · Operations & BO · Compliance", active: true },
  ];
  const grants = [{ to: "EMP-0153", project: "PRJ-015", permission: "Comment", reason: "Copy review for the pricing page", expires: "2026-10-31" }];
  const audit = [
    { at: "2026-10-21 17:42", by: "EMP-0081", action: "send_to_rework", record: "PRJ-015-T07", reason: "Canonical tags still point at staging" },
    { at: "2026-10-20 11:05", by: "EMP-0084", action: "report_blocker", record: "PRJ-015-T03", reason: "Device lab booked" },
    { at: "2026-10-19 16:20", by: "EMP-0082", action: "request_date_change", record: "PRJ-015-T08", reason: "Image CDN scope added" },
    { at: "2026-10-17 18:02", by: "EMP-0082", action: "send_for_review", record: "PRJ-015-T01", reason: "" },
    { at: "2026-10-16 12:30", by: "EMP-0221", action: "record_incident", record: "INC-015-01", reason: "" },
    { at: "2026-10-13 10:15", by: "EMP-0081", action: "accept_work", record: "PRJ-015-T04", reason: "" },
    { at: "2026-10-01 09:00", by: "EMP-0081", action: "lock_charter", record: "PRJ-015", reason: "Sponsor and PMO approved" },
  ];
  const holidays = [{ day: "2026-10-20", name: "Diwali (illustrative calendar)" }, { day: "2026-11-05", name: "Guru Nanak Jayanti" }, { day: "2026-12-25", name: "Christmas" }];

  const rrInputs = [
    { project: "PRJ-D03", kind: "Value actual (₹ saved a year)", value: "₹48,00,000", by: "EMP-0109", fn: "Finance confirmer", state: "Submitted" },
    { project: "PRJ-D02", kind: "Stakeholder satisfaction", value: "4.1 of 5 (22 responses)", by: "EMP-0219", fn: "Quality assessor", state: "Submitted" },
    { project: "PRJ-D02", kind: "Rework % of effort", value: "9%", by: "EMP-0221", fn: "Quality assessor", state: "Validated" },
    { project: "PRJ-D05", kind: "Client SLA count (manual)", value: "16 of 17 stages within SLA", by: "EMP-0153", fn: "PMO validator", state: "Submitted" },
  ];
  return { rrInputs, persona: "admin", personas: JSON.parse(JSON.stringify(PERSONAS)), tasks, projects, requests, accounts, grants, audit, holidays, p9doc: false, policyState: "Proposed",
    notifications: [{ t: "Sachin Barnwal sent PRJ-015-T01 for review", at: "17 Oct" }, { t: "Harsh reported a blocker on PRJ-015-T03", at: "20 Oct" }, { t: "Policy PR-1 is waiting for a second Admin", at: "22 Oct" }] };
}

/* RACI.xlsx Email campaign template (corrected workbook defaults, named Sheet3) */
const EMAIL_TEMPLATE = {
  name: "Email campaign", sla: [9, 14], effort: [15.5, 25], state: "Draft",
  stages: [
    { step: 1, name: "Campaign request initiation", R: ["@Requester's manager (per run)"], A: "MUKESH", C: [], I: ["EMP-0118"], effort: [2, 3], sla: [2, 3], validator: "Head of requesting department", vRule: true,
      checklist: "Define objective; target audience; key messages; timeline", evidence: "Email request form; campaign brief" },
    { step: 2, name: "Content creation", R: ["EMP-0153"], A: "MUKESH", C: ["@Requesting department"], I: ["EMP-0118"], effort: [4, 8], sla: [2, 3], validator: "EMP-0153",
      checklist: "Email copy; subject lines; preview text; CTA", evidence: "Draft content; revision history", flag: "Miteeksha is both R and reviewer" },
    { step: 3, name: "Content approval", R: ["EMP-0153"], A: "@Head of requesting department", C: ["@Compliance team"], I: ["MUKESH"], effort: [2, 3], sla: [1, 2], validator: "Head of requesting department", vRule: true, regulator: true,
      checklist: "Accuracy; messaging; compliance", evidence: "Approval email; regulator approval (TRAI / WhatsApp)", flag: "Generic sheet: R = Marketing POC, C = Legal team" },
    { step: 4, name: "HTML development", R: ["EMP-0118"], A: "MUKESH", C: ["@Email execution team"], I: ["@Content team", "MUKESH"], effort: [4, 6], sla: [1, 2], validator: "EMP-0118",
      checklist: "Template; responsive; email clients; tracking", evidence: "HTML files; test screenshots", flag: "Sheet3: Naveen is R, A and reviewer" },
    { step: 5, name: "Campaign setup and launch", R: ["EMP-0118"], A: "MUKESH", C: ["EMP-0118"], I: ["@Requesting department", "@Marketing team"], effort: [3, 4], sla: [1, 2], validator: "EMP-0118",
      checklist: "Upload; list; segmentation; tracking; schedule", evidence: "Test sends; settings; list report", flag: "Sheet3: Naveen is R, A, C and reviewer" },
    { step: 6, name: "Performance tracking", R: ["EMP-0118"], A: "MUKESH", C: ["@Data analyst"], I: ["@Requesting department", "@Stakeholders"], effort: [0.5, 1], sla: [2, 2], validator: "EMP-0118",
      checklist: "Delivery, open, click, conversion", evidence: "Campaign analytics", flag: "SLA covers the first report only" },
  ],
  risks: {
    1: { codes: "RSK-001/002", deps: "Marketing calendar available; clear business objectives", assumptions: "Requesting team has identified the target audience; business case is justified" },
    2: { codes: "RSK-003/004", deps: "Complete brief from requesting department; updated brand guidelines", assumptions: "Content team has capacity; brand guidelines are current" },
    3: { codes: "RSK-005/006", deps: "Content creation completed; approvers available", assumptions: "Department head has final say; legal review not always required" },
    4: { codes: "RSK-007/008", deps: "Final approved content; email template available", assumptions: "HTML developer has required skills" },
    5: { codes: "RSK-009/010", deps: "Completed HTML; clean contact list; approved content", assumptions: "Email platform is functioning; contact list is up to date" },
    6: { codes: "RSK-011/012", deps: "Tracking implemented correctly; analytics platform working", assumptions: "Baseline metrics are established" },
  },
};
const CS_TEMPLATE = { name: "Client Support issue flow", state: "Draft", stages: [
  { step: 1, name: "Design and testing", R: ["@Client Support team"], flag: "People and SLA not defined in sources" },
  { step: 2, name: "Co-ordination with Product", R: ["@Client Support team"], flag: "People and SLA not defined in sources" },
  { step: 3, name: "Implementation sign-off", R: ["@Client Support team"], flag: "People and SLA not defined in sources" },
] };
