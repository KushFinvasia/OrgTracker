# CLAUDE.md — Finvasia Elevate (formerly Orgtrack; Finvasia / Shoonya)

Finvasia Elevate (called Orgtrack in the source documents) is one internal web platform for Finvasia / Shoonya with two connected areas:
**project delivery** (projects, milestones, tasks, reviews, workflows, risks, incidents/RCA) and
**employee performance** (reporting hierarchy, KPIs, monthly check-ins, training, Rewards & Recognition).

> **Projects are the unit of work. Employees are the unit of performance.**
> One master identity per person, one performance record per period. A late project must not
> automatically penalise everyone on it.

> This file is the working guide for Claude Code. It is **not** the "CLAUDE.md business context draft v2.0
> (29 Sep 2026)" that the source documents mention; that draft is not in this folder and has never been seen.

---

## 1. Current status (as of 15 Oct 2026)

- **First implementation exists**: React + FastAPI, chosen by the user, deployed as a demo (Render backend, Vercel frontend). See §20 for structure and commands.
- **Current direction (§21): the Individual Tier, piloted with the Sales team only.** It overrides the earlier sections where they conflict
  (login roles, category weights with Training 10% inside them, Training scored by TWCS, monthly periods, no 90/10 training blend).
  The plan is `docs/individual-tier-sales-plan.md`. **Build steps 1–7 are implemented locally (15 Oct 2026); deployment (step 8) is pending.** Sections §1–§20 still describe the Project Tier and the org-wide design.
- The 103-page PDF is a **design reference** with illustrative data, not evidence of a live app.
- Don't restart discovery or recreate the 67 legacy views as routes. Extend the 14 screens with tabs, drawers and states.
- New instructions from the user override older design choices.

## 2. Files in this folder

| File | What it is | Notes |
|---|---|---|
| `Orgtrack_Complete_New_Chat_Prompt.docx` | **Authoritative handoff prompt**: full business rules, 19 sections | Primary context. Read it before making detailed changes. |
| `Orgtrack_Premium_SaaS_Redesign.pdf` | **UI reference**: 103 pages, 14 screens with their states, dated 09 Oct 2026 | Page directory in §6. Pages are states, tabs or drawers, not routes. |
| `PT_RR_Corrected_Data.xlsx` | **Canonical seed and migration data** (12 sheets, see §13) | Corrected and normalised. It overrides the original sheets. |
| `Project Tracker -Rest (Shoonya) (1).xlsx` | Original tracker: `Project & Task Tracker` (115 rows), `Rewards & Recognition`, `Dashboard` | Legacy reference only. Its formulas are broken (see Issue_Register). |
| `Organizational Chart - 23-Aug-26 (1) (1).xlsx` | Org chart, one sheet per department | **SmartArt only, so the cells are empty.** Already extracted to `Employee_Master`. Hidden sheets `Prodduct` and `Product-Shoonya` are outdated and must not be imported. |
| `R&R Parameters 2 (1).xlsx` | Original metric intentions (1–5 scale, 60/40 split, 3 categories) | Corrected rules supersede it wherever they conflict. |
| `RACI.xlsx` | Email campaign RACI: visible generic-role sheet, hidden `Sheet3` with named people, plus a risks sheet | Already turned into `Workflow_Templates` and `Risk_Register`. |
| `RCA.xlsx` | RCA template, **headers only** (10 combined columns) | Already expanded into `RCA_Register`. |
| `Project Tracker Sales (Shoonya).xlsx` | **Sales KPI source** for the pilot (§21): `Project & Task Tracker` (108 monthly target rows, Sep 2026), `Extra Tasks` (38 duty rows), `Rewards & Recognition` points sheet, `Dashboard` | The tasks are the KPIs. The points sheet has two inconsistent formulas and is retired. |
| `docs/individual-tier-sales-plan.md` | **Current plan** for the Individual Tier Sales pilot (in git) | The formatted copy `Orgtrack_Individual_Tier_Sales_Plan.pdf` (9 pages) is gitignored. |

**Not present (never claim to have read them):** the CLAUDE.md business draft v2.0, the two detailed
business and frontend PDFs it names, the supplied gold ∞ logo file (superseded by the Finvasia wordmark, §17), and the earlier compact PDFs.
The handoff prompt says RACI.xlsx and RCA.xlsx "were not supplied". They are here now, but their content
is already reflected in the corrected workbook.

**Reading tips:** use `pdftotext` to read the PDF and read page images only when layout matters. `openpyxl` is
not installed system-wide, so use `pip install --target <scratch> openpyxl` and run Python with `-I`.
`Project & Task Tracker` reports 1,048,450 rows because of a stray cell, so iterate over non-empty rows only.

## 3. Source precedence

1. The user's latest instruction.
2. The handoff prompt (docx) and the 103-page PDF. These are the latest design: the Shoonya theme, 14 screens and the training extension.
3. `PT_RR_Corrected_Data.xlsx`, the functional and data baseline.
4. The original workbooks (tracker, org chart, R&R Parameters, RACI, RCA), which are background only.

The Shoonya palette supersedes the older navy/teal palette. The 14-screen architecture supersedes earlier screen counts.
The handoff made Training a layer outside the category weights (the 90/10 blend in §12). **On 15 Oct 2026 the user approved another approach:**
Training is a 10% metric **inside** every category's weights, scored by TWCS (§21). Don't apply both.

## 4. Non-negotiable product constraints

- **No employee login. No shared or team login.** Only named accounts (Admin, HOD, Manager, Team Lead), each linked to one Employee record.
  The Sales pilot has **no Team Lead logins**: only Admin, HOD and Manager (§21).
  Managers record check-ins and training on behalf of their team. An earlier "team login" request does not mean a shared account.
- **Mandatory project priority** (High/Medium/Low), with **no default**. Saving is blocked until a value is chosen.
- **Unique employee identity.** Pickers show employee ID, designation and department, because duplicate names exist.
- **Independent acceptance.** No one reviews, validates or approves their own work, blocker, exception or nomination.
- **Reported progress ≠ accepted completion.** Only a reviewer's *Accept* sets a task to Completed.
- **Scope controls are enforced on the server and in every query** (dashboards, totals, chart series, search, notifications, direct URLs,
  attachments, reports, exports, saved views). Never send unauthorised records to the browser. Hiding buttons is not enough.
- **Append-only audit.** Even Admin cannot edit or delete audit events.
- **Unavailable data is never a fabricated zero.** Show Insufficient Data or a readiness exception instead.
- **Locked snapshots never silently recalculate.** Changes go through an explicit correction workflow.
- **Proposed policies stay labelled "proposed / not activated"** until they have a named author and an independent approver (see §15).

## 5. Roles and access

| Role | Work access | Private KPI / check-in / training score | Key decisions |
|---|---|---|---|
| Admin | Authorised organisation administration | Authorised admin scope | Accounts, imports, policies. Score-affecting policy needs a **second independent approver**. |
| HOD | Headed departments (can be several) and permitted work | Own headed departments | High-priority project closure, resource-blocker validation, justified performance overrides |
| Manager | Reporting tree and permitted work projects | **Own reporting tree only** | Configured reviews and validations, check-ins, training records, nominations |
| Team Lead | Own-team task status, progress, comments, and permitted training evidence or status | **None** | No private score or check-in decisions |

**Sales pilot (§21):** Team Leads have no login. Managers evaluate their reporting tree, the HOD approves or returns and locks the month,
and the Admin approves evaluations the HOD writes (proposed).

- **Work access** can come from the reporting tree, project ownership or review responsibility, project membership, a reporting employee's assignment,
  a read-only dependency link, or an approved **time-bound grant**. A grant records recipient, resource, permission, reason and expiry.
- **Project access never extends to private performance access.** In a shared project, a manager edits their own team's work only.
- Reporting relationships are **effective-dated**. Transfers keep the same identity. Locked snapshots keep their original scope.
  Historical private access must be defined explicitly. It is never inferred from a current project relationship.
- Hide navigation and actions the user can't use. A denied direct link goes to a safe permitted destination without leaking record details.
- Home variants: **Manager** shows overdue work, review queues, blocker validations, check-ins, training to verify, missing data and nominations.
  **Team Lead** shows work updates. **HOD** shows department decisions and evidence review.

## 6. Application structure: 14 screens

Routes are examples only and don't mandate a router. Training adds tabs and drawers inside existing screens and has **no top-level page**.

| # | Screen | Route | Contains |
|---|---|---|---|
| 01 | Home | `/home` | Action inbox, notifications, search (Ctrl K), preferences |
| 02 | Projects | `/projects` | Portfolio (Cards/List/Timeline), requests, create/edit drawer |
| 03 | Project workspace | `/projects/:id` | Overview, Tasks (board/table), Timeline, Milestones, Risks, Incidents & RCA, Activity, Details/Closure |
| 04 | Tasks | `/tasks` | My team tasks, Weekly update grid, Review queue, Dependencies, task drawers |
| 05 | Team | `/team` | Roster, Directory, Hierarchy, Capacity, Transfers |
| 06 | Person workspace | `/people/:id` | Overview, Assigned work, Training, Performance, Recognition, History |
| 07 | Performance hub | `/performance` | Period overview, Team results, Check-ins, Targets, Training, Snapshots |
| 08 | Evaluation | `/performance/:person/:period` | KPI result, Training contribution, Final R&R, Evidence history, Override |
| 09 | Rewards | `/rewards` | Cycle overview, Eligibility, Nominations, Published awards |
| 10 | Nomination & review | `/rewards/nominations/:id` | Citation, evidence, gates, independent decision |
| 11 | Reports | `/reports` | Delivery, People, Performance, Training, Recognition, Data quality, Export |
| 12 | Administration | `/admin` | People & access, Imports, Data quality, Audit history, Organisation |
| 13 | Rules studio | `/admin/rules` | Category weights, Scoring curves, Minimum data, Mappings, Training policy, Impact preview |
| 14 | Workflows & data | `/admin/workflows` | Workflow templates, RACI & review, Working calendar, Training catalog, Data sources, Input validation |

Primary nav: **Home, Projects, Tasks, Team, Performance, Rewards, Reports**, plus a "Control centre" group for authorised admins
(People & access, KPI rules, Workflows & data, Administration). Sign-in, responsive variants and shared error states are not business screens.
**Planned change (§21):** the tier dropdown at the top of the sidebar switches between a Project Tier nav (Home, Projects, Tasks) and an Individual Tier nav
(Home, Team, Performance, Rewards, Reports, KPI Scoring for Admin).

**Add task must be visible as a labelled action**, never a bare "+" icon. It appears in the project workspace header, in each task-board column
and in the team Tasks view. It opens a contextual drawer with project and milestone prefilled when known.

### PDF page directory

| Pages | Coverage |
|---|---|
| 1–6 | Purpose, directory, 14-screen nav map (p3), theme (p4), roles (p5), sources (p6) |
| 7–11 | Named sign-in, manager Home, action inbox, search, preferences |
| 12–26 | Portfolio, create project, overview, board, timeline, milestones, risks, incidents, RCA, attribution, RCA closure, project closure, cross-team request, request planning |
| 27–36 | Weekly grid, **create task (p28)**, assignments, task drawer, blockers and deadline change, review, evidence upload, send for review, rework, version history |
| 37–41 | Team roster and person, directory, hierarchy, **person progress (p40)**, capacity |
| 42–46 | **Training**: workspace, assign, update, verify, exception |
| 47–55 | Performance hub, period setup, targets, check-in, Support check-in, **evaluation (p52)**, **training ledger (p53)**, snapshot lock, HOD override |
| 56–60 | Rewards and nomination review, cycle setup, nomination, publication, award detail |
| 61–67 | Reports: Delivery, People, Performance, **Training (p64)**, Recognition, Data quality, Export |
| 68–73 | Admin control centre, named account, import dry run, dated transfer, temporary access, audit |
| 74–77 | Rules studio: **category weights (p74)**, mappings and rubrics, **training policy (p76)**, rule approval |
| 78–86 | Templates, named RACI, training catalog, business calendar, CSAT/Targets/Compliance/Capacity/Innovation inputs |
| 87–95 | Team Lead and HOD home variants, save conflict, partial save, assignment validation, permission/locked, unsaved draft, empty states, mobile |
| 96–103 | Reference: KPI calculations, training rules, progress measures, R&R rules, **field catalog (p100)**, responsive contract, feature coverage, activation checklist |

The illustrative cast in the PDF: Pradeep Thakur (EMP-0081, Lead UI/UX, the manager and reviewer), Sachin Barnwal (EMP-0082), Maninder Singh (EMP-0083),
Harsh (EMP-0084), Kapil Abrol (EMP-0219, HOD Client Support), Sahil Sharma (EMP-0221), Miteeksha (EMP-0153), and project PRJ-015 Shoonya Website Enhancements.
The names come from the sources. The dates, courses, scores and incidents are illustrative.

## 7. Projects

**Project fields:** ID, title, objective, owner, canonical department, **priority (mandatory, no default)**, start date, target date, status, members,
workflow template, project reviewer, optional milestones, risks, incidents, closure, history.

**Project status:** `Planning | Not Started | In Progress | Blocked | In Review | Completed | On Hold | Cancelled`.
**"Delayed" is never a status.** Derived values:
- Timing: `On time | Late | Overdue | Due soon | No deadline` (from dates)
- Health: `On Track | At Risk | Off Track` (from approved rules; users can't set health to hide risk). Open High or Critical risks show in health.

**Milestones:** title, owner, target, linked tasks, acceptance criterion, state, dependency. **Completing a milestone does not accept its tasks.**
Scope and complexity changes stay visible because they change delivery denominators.

**Closure has 8 stages:** tasks, milestones, deliverables, objectives, open issues, lessons learned, final remarks, approval. Readiness gaps and evidence
are shown at every stage. **High priority requires HOD approval.** "Return with comment" keeps the project open. A status change can't hide unresolved mandatory work.

**Cross-department requests:** a short template-specific brief (template, title, requesting dept, receiving team, audience, objective, required date,
priority, brief/assets, request validator). The flow is: requester's manager validates, then the receiving POC (for example the marketing POC) accepts it into the calendar.
Dependencies, reviewer conflicts and SLA dates are previewed before activation. The states are accepted, returned and scheduled.
The request creates or links the project and keeps the brief, requester, manager decision, accepting owner and calendar history. **Never type the same data twice.**

## 8. Tasks, assignments, review and fair deadlines

Hierarchy: **Project → optional Milestone → Task → Assignment** (one assignment per person).

**Task form:** title, project, optional milestone, description, complexity (1–5), start and due dates, dependencies, **exactly one Owner**,
optional Contributors, **contribution shares totalling 100%**, independent reviewer, acceptance checklist, required evidence.
Validation keeps the draft: shares must equal 100%, there's no duplicate employee, the **reviewer can't be any assignee**, and dates must be valid.

**Task status:** `Not Started | In Progress | Blocked | In Review | Rework | Completed | On Hold | Cancelled`.
New tasks start at Not Started. Dropping a card into the In Review column can't skip evidence submission or review.

**Review flow:**
1. *Send for review* requires the required evidence, completed uploads and a checklist. It creates an **immutable submission version**. Future submission dates are rejected.
2. The reviewer previews the exact version and chooses **Accept** or **Send to rework**. Rework needs a reason category, the failed criterion, feedback, evidence,
   and "requirement changed?". Previous submissions are kept.
3. **The completion date for on-time scoring is the submission date of the accepted version.** Reviewer waiting time never makes the assignee late.
   Review decision timestamps are stored separately.

**Blockers:** type, requester, blocking task, blocked-since date, evidence, validator, validation state. The requester can't validate their own blocker.
- Excludable once validated: internal dependency, external/vendor, approval pending, management reprioritisation, requirement change, resource (**resource needs HOD**).
- Not excludable: technical problems and own-team rework.

**Deadline changes:** reason category and comment, plus independent validation. The original date is kept. The **due date in force changes only after validation**.
Returning work for rework never moves the due date automatically.

**Weekly grid:** a manager updates status, reported progress, next action and blockers inline and saves once. Values are prefilled. Each row shows its own save outcome,
and failed rows are kept. Targets: **under 2 minutes per team for the weekly update, under 5 minutes per employee for the monthly check-in.**

The task drawer has Details, Assignments, Dependencies, Acceptance, Evidence, Discussion and Version history.

## 9. Workflow templates and named RACI

A template is an ordered plan whose steps become tasks with **finish-to-start** dependencies. It carries checklists, required evidence, reviewer criteria,
target and maximum SLAs in business days, effort ranges and linked risks. Generic roles must resolve to **named people** before activation.

**Email campaign template** (from `Workflow_Templates`). The overall target is **9 business days**, the maximum is **14**, and effort is **15.5–25 hours**:

| # | Stage | Default R | SLA target/max (bd) | Effort (h) |
|---|---|---|---|---|
| 1 | Campaign request initiation | Manager of requesting dept | 2 / 3 | 2–3 |
| 2 | Content creation | Miteeksha (EMP-0153) | 2 / 3 | 4–8 |
| 3 | Content approval | Miteeksha (routes for sign-off); A = head of requesting dept | 1 / 2 | 2–3 |
| 4 | HTML development | Naveen Kumar (EMP-0118) | 1 / 2 | 4–6 |
| 5 | Campaign setup and launch | Naveen Kumar | 1 / 2 | 3–4 |
| 6 | Performance tracking | Naveen Kumar | 2 / 2 (first report only) | 0.5–1 per report |

The **Client Support** template adds the stages *Design and Testing → Co-ordination with Product → Implementation sign-off*. This is the CS 3-sub-task pattern seen 25 times in the tracker.

**RACI rules:**
- Responsible maps to the task assignees (one Owner plus Contributors with valid shares).
- **Accountable is exactly one named person per step.** A department label is not enough. That person gets SLA-breach alerts and signs off.
- Consulted people can comment when the stage starts. Informed people get completion notices and read-only context.
- The validation owner becomes the **independent reviewer**, and the validation checklist becomes the acceptance criteria.
- **One RACI letter per person per step. An assignee can't review.** If the source shows R = A = reviewer, display the conflict and **block activation**.
- **Approval waiting time belongs to the approval stage and its Accountable person**, not to the previous assignee. Approval-turnaround reports are separate from on-time attribution.
- Known source defects: Mukesh Thakur (Marketing POC) is not in the org chart. "Gurjot Sodhi" and "Rajesh Gaddam" don't match org names.
  Naveen Kumar matches two employees. Steps 4–6 have Naveen as R, A, C and reviewer. Miteeksha is both R and reviewer on step 2. All of these need confirmation.
- Campaign metrics (delivery, opens, clicks, conversions) feed Achievement **only** once their targets and authority are approved.

## 10. Risks, incidents and RCA

**Risk:** risk, stage, criticality `Low | Medium | High | Critical`, dependencies, assumptions, mitigation, owner, linked action task,
state `Open | Mitigating | Closed`, next review date. Each project starts with the template's default risks (RSK-001…012 for Email campaign).

**Incident:** ID, title, product/system, incident date, received date, reporter, proposed severity, clients impacted, orders impacted, responsible department,
responsible stakeholder. **RCA** adds: root cause, root-cause category, gap identified, correction action and completion date, preventive tasks (owner and due date),
expected and actual closure, verifier, repeat-of link, evidence.

**Incident states:** `Open → Under analysis → Correction done → Preventive action in progress → Closed`, plus `Reopened`. Keep the history and never overwrite findings.

- Preventive actions are **real tasks**, with the same evidence and independent-acceptance rules as other tasks.
- **An RCA closes only when its preventive tasks are accepted** and someone **other than the responsible stakeholder** verifies closure.
- Compliance severity is `Minor | Medium | Major`. A personal deduction requires **both validated severity and validated individual attribution**.
  Without validated attribution, the incident counts in department reports only. Severity alone never penalises a person.
- Department reports show counts, severity, repeats, prevention readiness and closure on time, kept separate from individual deductions.
- Validator authority is **not yet confirmed**. The proposal is Compliance validates and the HOD can dispute. Keep it configurable.

## 11. People, capacity and progress measures

- **Accepted weighted output** = Σ over accepted tasks of (complexity × the person's contribution fraction). Example: complexity 4 at 50% gives 2 units.
  Raw task counts are descriptive only and never a reward score.
- **Reported progress** (proposed) = the complexity × contribution weighted average of active task progress. Label it "Reported progress" and show its denominator and exclusions.
  It's separate from accepted output and from KPI.
- **Project accepted delivery** (proposed) = Σ accepted task complexity / Σ in-scope task complexity × 100. Approved cancellations are excluded and scope changes are disclosed.
- **On-time eligibility:** only accepted Completed work with a due date and an accepted submission date counts. No-deadline, Cancelled and On Hold work is ineligible.
  In Review is not a completion. Validated excludable blockers and date changes protect eligibility.
- **Capacity** uses available working days, allocation and accepted weighted output, with approved leave and the working calendar. Scheduled training time
  appears in capacity but is **not rewarded as output**. Don't compare productivity when team size is under 3 or available days are under 10.
- Transfers keep work, training assignments and locked history. An inapplicable course needs an approved exemption and is **never silently removed**.

## 12. Training (new extension, proposed policy)

Training lives in Team, Person, Performance, Reports, Rules studio and Workflows & data. There's no employee portal.

- **Course catalog (versioned):** course ID, title, type (Mandatory/Optional, role-based), role applicability, criteria version, planned duration,
  evidence requirements, assessment/pass rule, validity or recurrence, lifecycle. An assignment keeps the version it was created with.
- **Assignment:** assignment ID, course and version, employee ID, assigned date, approved due date, type, planned duration, completion criteria, pass rule,
  **named verifier**, related period, progress, attempts, assessment result, evidence, effective exceptions. Bulk assignment shows a per-person preview and outcome.
- **Lifecycle:** allocation → progress → evidence submission → verification → **verified complete**, or returned with a reason.
  The verifier must differ from the recorder. Store the recorder, verifier, completion event, verification event, evidence version and decision.
- **Retakes are attempts on the same assignment** and don't add denominator entries. A replacement course needs an explicit relation.
- **Exceptions** (exemption, cancellation, due-date change) use a separate drawer with reason, evidence, effective date and an independent decision.
  Originals are kept. The applicant can't approve their own exception. Overdue training stays eligible until an exception is approved.
- The workspace shows counts for allotted, future due, eligible due, in progress, pending verification, verified complete, uncompleted and overdue. Each count drills into its records.

**Scoring (original handoff proposal, not activated).** For the Sales pilot it is **superseded by TWCS at a 10% weight (§21)**. The catalog, assignment,
lifecycle, verifier ≠ recorder, retake and exception rules above still apply. The demo seed and `services/scoring.py` still implement this version.
- Eligible means an approved assignment whose **due date in force falls inside the period**. Future-due assignments and approved exemptions are excluded, with history kept.
- **Training % = verified eligible completions / eligible due assignments × 100.** Courses count equally.
- **Final R&R = base KPI × 0.90 + training score × 0.10.** Never also put training inside the category weights, because that double-counts. No extra bonus or penalty.
- No applicable training due (confirmed) gives **N/A**, and the final score equals the base KPI.
- Known eligible training with none verified scores a **genuine 0%**.
- Missing allocations or unknown outcomes create a **readiness exception**. Never infer 0%, 100% or N/A.
- If base KPI coverage is insufficient, the result stays **Insufficient Data**. Training can't rescue it.
- Evidence verified after the locked cutoff can't silently change the stored result.
- **Team rate is aggregated by totals**, never by averaging percentages.

## 13. KPI scoring engine

Every metric is scored 0–100 by **linear interpolation between anchors, clamped at the endpoints**. An optional 1–5 display value is score / 20.
All weights, anchors, minimums and mappings are **versioned configuration**.

**Category weights** (each column totals 100%). These are the corrected-workbook weights, used by the current demo (KPI rule v2).
**The Sales pilot uses the 15 Oct 2026 weights in §21, with Training at 10%.**

| Metric | Core Revenue | Revenue-Enabling | Support | Customer Service *(proposed)* |
|---|---|---|---|---|
| On-time | 20 | 30 | 20 | 20 |
| Achievement | 30 | 25 | 0 | 15 |
| Compliance | 0 | 20 | 10 | 10 |
| CSAT | 25 | 0 | 0 | 30 |
| Quality | 15 | 15 | 25 | 25 |
| Collaboration | 10 | 10 | 25 | 0 |
| Innovation | 0 | 0 | 20 | 0 |
| Productivity | 0 | 0 | 0 | 0 (tie-breaker only) |

"Culture" (Core Revenue) maps to Collaboration, pending confirmation. The original 60% quantitative / 40% qualitative split is **retired**.

**Anchors and data minimums:**

| Metric | Raw → score anchors | Minimum / rule |
|---|---|---|
| On-time % | 45→0, 75→60, 85→80, 95→100 | ≥3 eligible accepted assignments, using the due date in force |
| Achievement % | 0→0, 60→40, 80→60, 100→90, 150→100 (raw capped at 150) | Approved target required. **No target means unavailable, not zero.** |
| Compliance | Starts at 100, then Minor −20, Medium −40, Major −100, floor 0 | Explicit period attestation. An empty register doesn't prove 100. |
| CSAT avg (1–5) | 1→0, 3→60, 4→80, 4.5→100 | ≥30 responses (proposed). Always show the count. |
| Quality | 0.6 × rework score + 0.4 × (manager rating × 20) | ≥3 reviewed tasks. Requirement-change rework is excluded. |
| Rework % | 0→100, 2→80, 5→60, 15→0 | (input to Quality) |
| Productivity ratio | 0.2→0, 0.8→60, 1.0→80, 1.2→100 | Team of ≥3 and ≥10 available days. **Unweighted.** |
| Collaboration | Rubric rating 1–5 × 20 | Evidence required for ratings 1, 2 and 5 |
| Innovation | Rubric rating 1–5 × 20 | Before/after evidence at every level |

**Base KPI** = Σ(score × weight over available metrics) / Σ(available weights). **Coverage** = available weight.
**Coverage below 70% means Insufficient Data.** Never substitute zero for unavailable metrics.

Category-aware forms show only weighted metrics. For example, a Support check-in hides Achievement and CSAT.

### Worked examples to use as test vectors

| Case | Expected |
|---|---|
| Revenue-Enabling: On-time 80 (30%), Achievement 90 (25%), Compliance 100 (20%), Quality 80 (15%), Collaboration 80 (10%) | 24 + 22.5 + 20 + 12 + 8 = **base 86.5**, 100% coverage |
| Training: 12 allotted, 2 future-due, 10 eligible, 8 verified | **80%** (not 8/12) |
| Final R&R: 86.5 × 0.9 + 80 × 0.1 | 77.85 + 8.00 = **85.85** (Silver threshold) |
| HOD override: Collaboration 80 → 90 | base **87.5**, final **86.75**. Keep both the original and corrected results. |
| Team training: 8/10, 1/2, 2/2 | 11/14 = **78.57%** (not the 76.67% average) |
| CSAT 4.4 with ≥30 responses | **96** |
| Source period: Sachin Barnwal | On-time 3/3 = 100%. Maninder Singh is Insufficient Data. |

Store full precision. Display final scores to two decimals. **Apply tiers to the unrounded value.**

## 14. Performance periods, rewards and reports

**Periods:** Monthly, Quarterly, Half-yearly or Annual. The baseline is a **quarterly KPI card with targets set at quarter start and monthly manager check-ins**.
The Sales pilot uses **monthly** periods (§21).
A period holds type, dates, scope, KPI rule version, category mapping, training policy version, evidence cutoff, reviewers and lock authority.
The lifecycle is `Open → Calculating → Under Review → Locked`. Automatic values are prefilled from accepted work and validated sources. Managers enter only manual ratings and evidence.
Before locking, check missing inputs, unresolved validations, training outcomes, draft policy versions, reviewer conflicts and exemptions.
A **locked snapshot** stores raw inputs, accepted work versions, validated blockers and dates, mapping, metric scores, coverage, the training numerator, denominator,
exclusions and cutoff, the final result, gates and both rule versions.
**HOD override:** only within department scope, with a reason and evidence. The original value, override, actor, timestamp and impact preview are all kept.
Manual or batch inputs (Targets, CSAT, Compliance, Capacity, Innovation) go `Draft → Submitted → Validated | Returned` with an independent validator.
**Don't claim any HRMS, LMS or CRM integration exists.**

**Rewards (R&R = Rewards and Recognition).** There's no points system and no free bonus points.
- Draft tiers are **Gold ≥ 90, Silver 80–<90, Bronze 70–<80**, applied to the final score from a **locked** snapshot.
- Gates, each shown with its source: **coverage ≥70%**, **no validated attributable Major incident**, **≥60 days in role**, **no active disqualifying disciplinary action**.
- An optional department **Gold cap of 10% of eligible employees** is proposed. Ties go to Productivity, then On-time.
- The cycle runs `Draft → Nominations → Review → Approved → Published`. Nominations open only after the linked period is **Locked**.
- Top Performer can be score-based. Every other award needs a **citation of ≥50 words plus linked evidence**. Don't invent new authoritative award types.
- **The nominator can't approve their own nomination.** Approval and publication are separate. Publishing is an explicit action with an audience preview.
  Published cards never expose private check-ins, raw assessments or disciplinary data.

**Reports** are a manager tool, not an org-wide leaderboard. The tabs are Delivery, People, Performance, Training, Recognition and Data quality.
Each has filter chips, drill-down to records, and a table alternative for every chart. Approval waiting, employee lateness and department incidents are never conflated.
Exports (CSV/PDF) and saved views keep the scope, filters, period, cutoff, rule versions and "unavailable" labels, and **permissions are rechecked when they're opened**.

## 15. Open decisions (keep visibly "proposed" until approved)

For the Sales pilot, the open decisions are **D1–D12 in §21**. Their defaults apply until the user answers. The org-wide list:

90/10 training blend (replaced by Training at 10% inside the weights for the pilot) · equal course-count weighting · eligible training types and criteria · cutoff and N/A rules · assignment, verification and exception authorities ·
Customer Service category and mappings · Collaboration interpretation (Culture) · sample minimums and 70% coverage · 90/80/70 tiers, Gold cap and rounding ·
disciplinary gate source · blocker validators · RACI identity conflicts · severity and attribution validators · health and progress aggregation ·
source-system integrations · historical private scope · HRMS identity migration · upload file types and size limits (don't invent them) ·
the NBFC, jUMPP and RMS & Dealer team-level category overrides.

## 16. Data and migration (`PT_RR_Corrected_Data.xlsx`)

README as-of date: **29 Sep 2026** (prepared 29 Sep, extended 08 Oct).

| Sheet | Rows | Key columns |
|---|---|---|
| Employee_Master | 325 rows = 317 unique employees + 5 unique vacant positions (multi-department heads repeat) | Record ID (EMP-/POS-), HRMS Emp Code (fill), Record Type, Full Name, Designation, Department, Level, Reporting Manager ID, Direct Reports, Proposed Platform Role (227 none, 58 Manager, 21 TL, 13 HOD), Flags |
| Name_Collisions | 16 groups | Name, Record ID, Designation, Dept, Manager, Likely same person?, Resolution |
| Departments | 17 | Head Record ID, Headcount, Vacant, **Proposed Category**, Tracker aliases, Notes |
| Category_Weights | 8 metrics × 4 categories | see §13 |
| Tracker_Cleaned | 175 assignments / 109 tasks / 60 projects | Project ID, Task ID, Emp ID, Assignment Role, Contribution %, Priority, dates, Original → Mapped Status, Timing, Blocker Type, Validated?, Excludable?, On-Time Eligible, DQ flags |
| Project_Register | 60 (Product 28, Client Support 25, Ops & BO 7) | Priority: 30 High, 5 Medium, **25 missing** |
| OnTime_Recalc | per employee | Corrected rate beside the old sheet value, with the reason it changed |
| Workflow_Templates | Email campaign, 6 steps | R/A/C/I with Emp IDs, checklist, reviewer, evidence, SLA, effort, flags |
| Risk_Register | RSK-001…012 | mapped to template steps by row order (needs confirmation) |
| RCA_Register | 1 example row (RCA-001) | the full RCA field set from §10 |
| Issue_Register | **58 issues** | Source, Area, Issue, Severity, Fix / Rule adopted, Where fixed (references "Spec x.y" sections of the unseen business draft) |

**Departments and proposed categories.** Core Revenue: Sales, Insurance, NBFC, jUMPP CS & Sales.
Revenue-Enabling: Product, AI, Operations & BO, Demat, RMS & Dealer, Compliance, Digital Marketing. Customer Service (new): Client Support.
Support: IT, HR (includes L&D), Accounts, Admin, Front Desk. One person can head several departments.
For example, Pawan Kumar (EMP-0109) heads Demat, Operations & BO and Compliance, and the MD position POS-0001 heads Product and AI.

**Canonical aliases:** Customer Support → Client Support. Operations or Back ofc & Operations → Operations & BO. Finance → Accounts.
Learning & Development → HR. IT / Tech → IT. Human Resources → HR.

**Import rules:** field mapping, then a **dry run**, then severity-coded issues, then per-row results, then commit (`Upload > Map > Validate > Confirm > Result`).
Critical identity, share and reviewer conflicts must be resolved first. Status mapping:
- Legacy `Completed` with no reliable date or evidence becomes **In Review**, not accepted output.
- `Ongoing` becomes **In Progress**.
- `Delayed` becomes **Blocked** only if an eligible blocker exists. Otherwise it becomes **In Progress**.
- Only Completed with a date counts as completed. Future completion dates are flagged and blocked.

Tracker blocker types: Internal dependency (Product/Development) 24, Management reprioritisation 9, Not a blocker – status note 9,
Technical issue 6, No update from owner 6, Requirement change 1, Rework (own team) 1, Internal dependency (other team review) 1.
**Only 4 of 175 assignments are on-time eligible.** These are migration facts to validate, not production totals.

EMP-, POS- and PRJ- codes are **placeholders**. Replace EMP codes with HRMS codes before go-live without breaking links. **Never hard-code sample IDs in business logic.**

**Conceptual entities** (an inventory, not an imposed schema): Employee, Position, ReportingRelationship, Account, ProjectMembership, Project, Milestone, Task,
Assignment, EvidenceVersion, Submission, ReviewDecision, Blocker, DeadlineChange, WorkflowTemplate, Stage, RACI, Risk, Incident, RCAAction,
TrainingCourseVersion, TrainingAssignment, Attempt, Verification, Exception, PerformancePeriod, Target, MetricInput, CheckIn, RuleVersion, Snapshot,
Override, RewardCycle, Nomination, Publication, AccessGrant, ImportBatch, AuditEvent.
Audit events record actor, timestamp, old and new values, reason, related record and version, and they're append-only. Keep the source batch and validator for every scoring input.

## 17. Visual design system (Shoonya-inspired, premium SaaS)

Inspired by Linear and Notion for simplicity and navigation, not copied. **Logo: the Finvasia wordmark** (user direction, 19 Oct 2026; it replaces the PDF's gold ∞ Shoonya-style logo), taken from `https://finvasia.com/assets/images/logo.svg`. Files in `frontend/public`: `finvasia-logo.svg` (light backgrounds, login), `finvasia-logo-light.svg` (charcoal sidebar, the ® lightened), `finvasia-mark.svg` (the F on copper `#CA705F`, used as the favicon and in the collapsed sidebar). "Elevate" is set as text under the wordmark. Don't redraw the logo.

**UI reference (user direction, 19 Oct 2026): `../prototype/finvasia-elevate-prototype.html`** (outside the repo, next to the project folder). It supersedes the PDF's look:
the palette, type, shell and page layouts below come from it. The tokens live in `frontend/src/styles/tokens.css` (light and dark), the components in `styles/app.css`.

| Token | Light | Use |
|---|---|---|
| ink / ink-2 / muted / faint | `#17201A` / `#3A453E` / `#637068` / `#8B958E` | Text, strongest to weakest |
| bg / surface / surface-2 / sunken | `#F3F5F2` / `#FFFFFF` / `#F8F9F7` / `#EDF0EC` | Canvas, panels, table heads, inputs and tracks |
| line / line-strong | `#E0E5DF` / `#C9D1CA` | Borders |
| brand | `#1F6B3A` | **Primary action buttons** (white text), active tab underline, charts |
| brand-ink / brand-tint | `#155A2D` / `#E5F1E8` | Links, selected rows |
| side / side-2 / side-3 | `#1A221D` / `#232D27` / `#2C3830` | Sidebar, its hover and active item |
| gold-mark | `#DCB350` | Active-nav marker, nav counts, "Elevate" on dark (`#F0D488`) |
| tier gold / silver / bronze | `#A87B1F` / `#66737D` / `#9A5A2C` | Score tiers only, with a diamond marker |
| ok / warn / bad / info / neutral | `#23763F` / `#8A5A00` / `#B0393A` / `#2B5B93` / `#59645D` | Status badges and callouts, each with a tint |

Primary buttons are **green**, as in the prototype (this replaces the PDF's orange). A dark theme exists (`data-theme="dark"` on `<html>`, chosen in the account menu or Preferences, kept in `orgtrack.theme`).
The legacy token names (`--green`, `--mint`, `--charcoal`, `--orange`, ...) are aliases of the new ones so older inline styles still work.

**Type and layout:** IBM Plex Sans for text and IBM Plex Sans Condensed for figures (Google Fonts). 22px page titles, 15px section and panel headings, 13–14px body.
Use **tabular numerals** for scores, dates and percentages. Spacing scale is 4 / 8 / 12 / 16 / 24 / 32.

**Shell:** a dark sidebar with the logo lockup, the tier switcher ("Finvasia / Individual Tier"), nav groups with small labels (Individual: Monthly cycle, Results, Administration;
Project: Delivery, Control centre, Pinned), a gold bar on the active item and gold attention counts, the account menu (Preferences, theme, sign out) and a Collapse button
(icons only, kept in `orgtrack.sidebar`). Under 900px the sidebar becomes a drawer opened from the menu button. The top bar has a chevron breadcrumb, the **month picker**
(Individual Tier; shared by every page through `lib/month.ts` and mirrored as `?month=`), search (Ctrl K, a command palette with Pages, People, Projects and Tasks) and the notification bell.
Pages have a title, a subtitle and their actions at the top right. Key numbers sit in one **figures strip** (`Figures`), not separate cards. Detail pages get a Back link.

**Individual Tier patterns (from the prototype):** the **month-close rail** (`shared.tsx:MonthRail`: a segmented bar of check-in states with a clickable legend and the close steps)
on Home and Performance; Team as a toolbar (search, filter chips with counts, List / Hierarchy) over one table with KPI-average minibars; the person page as a header, a workflow strip
(Draft → Submitted → Approved or returned → Month closed), a five-figure summary, numbered sections (1 KPIs and duty tasks, 2 Ratings as 1–5 scales, 3 Training) and a sticky action bar;
the scorecard as a hero score plus, for Admins only, the weight ledger and calculation. Home shows the selected month first (rail and role-specific attention panels), then "Quarter to date".

**Status badges** use words plus a tint, never colour alone: In progress (blue tint), In review / Pending validation (amber), Verified complete (green), Blocked (red), Not started (grey).

**Conventions:**
- Use sentence case.
- Write dates as `09 Oct 2026`, with Asia/Kolkata (IST) context.
- Use Indian digit grouping where relevant.
- Buttons name outcomes, for example "Add task", "Send for review", "Verify completion", "Accept work", "Send to rework", "Publish awards".
- Keep one primary action per context.

**States to support:** loading skeleton, no records, no filter matches, unavailable data, validation errors (focus the first invalid field and keep the draft),
upload progress and retry (keep successful files), network failure, partial save (per-row), version conflict (compare before retry, never silently overwrite),
permission denied, expired session, locked read-only, success. Warn before an unsaved draft is abandoned. Restore focus when a modal closes.
Esc closes drawers. Focus is trapped inside dialogs. Error summaries link to fields.

**Responsive:**

| Width | Behaviour |
|---|---|
| ≥1280px | Full workspace |
| 1024–1279px | Collapse secondary panels, keep identity columns pinned, move advanced filters into a drawer |
| 768–1023px | Icon nav or menu, stacked forms |
| <768px | Read context and make quick updates only. Complex scoring, policy activation, final approvals and publication need the full workspace. |

Scope rules apply at every size.

## 18. Known source discrepancies (preserve, don't "fix" silently)

- CLAUDE.md v2.0 cites a worked example of **86.8** whose inputs are unseen. The PDF uses a separately reproducible **86.5 / 85.85**. Don't equate them or invent the 86.8 inputs.
- `Employee_Master` has 325 rows, but heads of several departments appear once per department (POS-0001 twice, EMP-0109 three times).
  Unique records are **317 employees + 5 vacant positions**, which matches the handoff. The Departments sheet's "6 vacant" counts POS-0001 twice.
- RACI has two disagreeing versions (generic visible sheet versus named hidden `Sheet3`). The named version supplies the defaults, and conflicts are flagged.
- The handoff calls primary actions green and the PDF shows orange buttons; the prototype (19 Oct 2026) settles it as green (see §17).

## 19. Recommended implementation order and invariants

**Order:** source clean-up → auth and server-side scope → people and import → projects → assignments and review → templates and RCA →
training assignment and verification → dashboards → performance and period snapshots → final training blend → recognition → reports and administration.
The earlier recommended pilot was a **Product and Client Support shadow quarter**. It is **replaced by the Sales Individual Tier pilot**, which has its own build order (§21).

**Invariants to test:** mandatory priority; exactly one Owner; shares = 100%; no self-review or self-approved exception, blocker or nomination;
the accepted submission date is the completion date; future dates are rejected; excludable versus non-excludable blockers; source validation;
interpolation, clamping and coverage; training eligibility, no-due N/A, known-zero versus missing, and retakes; team aggregation by totals;
role-scoped queries and exports; locks and corrections; independent publication; unavailable is not zero. Also check the worked examples in §13.

**UI acceptance:** visible Add task entry points; complete creation and review forms; per-person progress drill-down; all manager report tabs;
the training numerator and denominator are shown; consistent components; recoverable drafts; accessible focus; responsive layouts; scope-safe exports.
Visually inspect any rendered deliverable before handing it over.

## 20. Implementation (React + FastAPI)

The user chose **React + FastAPI**. See `README.md` for setup and the demo walkthrough.

**Commands**
- Backend: `cd backend && .venv/bin/python -m app.seed`, then `.venv/bin/uvicorn app.main:app --reload --port 8000`. Run tests with `.venv/bin/python -m pytest -q`.
- Frontend: `cd frontend && npm run dev` serves port 5173 and proxies `/api` to port 8000. Use `npm run build` to type-check and build.
- There are no database migrations yet. `app.seed` drops and recreates the database; for any non-SQLite target it requires `--yes-wipe-database`. Add Alembic before a shared database holds data worth keeping.
- Deployment: Render (`render.yaml`, backend with local SQLite, `ORGTRACK_AUTO_SEED=true` reloads `backend/seed_data/PT_RR_Corrected_Data.xlsx` + demo data when the DB is empty, and `ORGTRACK_INDIVIDUAL_DEMO=true` adds the Individual Tier demo months, which production otherwise skips; the free disk is wiped on deploy/restart/sleep, so in-app changes don't persist) and Vercel (frontend, root `frontend/`, `vercel.json`, env `VITE_API_URL`). Postgres still works via `DATABASE_URL` (normalised to `postgresql+psycopg://`). `ORGTRACK_ENVIRONMENT=production` refuses to start without `ORGTRACK_JWT_SECRET`. `ORGTRACK_DEMO_ACCESS_CODE` gates dev sign-in. See README "Deploy".

**Backend layout (`backend/app`)**
- `services/scoring.py` is the **pure** scoring engine: anchors, base KPI and coverage, training completion, the 90/10 blend, tiers and gates. Keep it free of database access. The §13 worked examples live in `tests/test_scoring.py`. The whole suite (94 tests) passes on SQLite; Postgres runs via `ORGTRACK_TEST_DATABASE_URL`.
  `services/sales_scoring.py` is the **pure** Individual Tier engine (TWCS, Training as a weighted metric, the −2 penalties); its §21 vectors are in `tests/test_sales_scoring.py`. Keep both engines.
- `services/scope.py` enforces access on the **server**. `work_people`, `perf_people` and `visible_project_ids` drive every list, search, report and export. Team Leads get an empty `perf_people`. Project membership never extends `perf_people`.
- `services/evaluation.py` builds a person's period inputs from records. A locked period returns its stored `Snapshot` and is never recalculated.
- `services/delivery.py` holds task and assignment rules (`validate_assignments`), derived timing, health and progress, and serialisers. `services/common.py:task_timing` judges In-review work by its submission date.
- `services/audit.py:record` must be called for every decision. `AuditEvent` rejects updates and deletes at the ORM level.
- Business-rule failures raise `core.errors.RuleViolation(message, field)`. The frontend shows `field` inline next to the matching input.
- Responses are plain dicts built by serialiser helpers, and request bodies are Pydantic models in `schemas/` or local to a route.

**Frontend layout (`frontend/src`)**
- `App.tsx` defines the routes (Project Tier: Home, Projects, Tasks, people's work, Admin; Individual Tier under `/individual`). `components/layout/AppShell.tsx` holds the sidebar, top bar, Ctrl K search and notifications.
  The top-bar breadcrumb is clickable (tier → its Home, section → its list, then the record name set by a detail page with `lib/crumb.tsx:useCrumbLabel`), and every page except the two Homes has a **Back** link under the top bar (previous page, or the section list when opened directly).
- `components/ui` is the shared kit: Badge, Button, Card, Stat, Tabs, Drawer (focus trap and unsaved-draft guard), Field, PersonPicker (shows ID, designation and department) and DecisionButton (a decision with a required reason).
- `components/tasks` (CreateTaskDrawer, TaskDrawer) and `components/training` are reused across screens.
- `lib/hooks.ts` provides `useApiQuery(path)` (the query key is the path), `useApiMutation` (invalidates everything on success), `useDraft` (recoverable sessionStorage drafts) and `useQueryParam` for tab and drawer state in the URL.
- Styling is plain CSS: tokens in `styles/tokens.css`, components in `styles/app.css`, both from the prototype (§17). Primary buttons are green (`Button variant="primary"`). The kit also has `Panel`, `Figures`, `SectionTitle`, `Segmented`, `Tier`, `Minibar`, `Unavailable` and `usePopover`; `lib/prefs.ts` holds the theme and sidebar preferences.
- Show dates through `lib/format.ts` (`09 Oct 2026`, IST, en-IN grouping). Show unavailable values as "Unavailable" or "Insufficient", never as 0.

**Seed data**
- `seed/workbook.py` imports the corrected workbook as-is and flags source defects rather than fixing them. It also provides the admin dry-run report.
- `seed/platform.py` provisions named platform accounts that must always exist (currently Kushagra Kataria, Admin, `kushagra.kataria@shoonya.com`). He is not in the org chart, so he gets his own flagged Employee record. It runs after seeding and at every startup, and is idempotent.
- `seed/demo.py` adds a clearly illustrative layer and marks its records `illustrative=True` or `source="demo"`: six demo-provisioned accounts, KPI rule v2 (Approved), training policy v3 (Pending approval), reward policy r1 (Draft), the Jul-Sep and Oct-Dec 2026 periods, a training catalog with assignments matching the PDF (12/10/8, team 11/14), project PRJ-D01, incident INC-DEMO-01 and a Draft reward cycle.
- Live scores come from the records, so Sachin's evaluation shows a computed 94.30 / 92.87, not the PDF's illustrative 86.5 / 85.85.

**Known gaps and next steps**
- Individual Tier: not deployed yet; non-score award nominations are not built (Rewards shows tiers, gates and publishing only); there is no post-lock correction workflow.
- Company SSO is not wired yet; dev sign-in is email-only for provisioned accounts (plus the optional shared demo access code).
- Evidence uploads go to local disk, which is ephemeral on Render.
- There are no Alembic migrations.
- Upload type and size policy is still pending, so the 10 MB limit is a dev placeholder.
- Productivity benchmarking, post-lock correction workflow, Gold-cap application, saved report views, HRMS/LMS/CRM integrations and the mobile quick-update screens are not built yet.

## 21. Current direction: Individual Tier, Sales pilot (15 Oct 2026)

Full plan: `docs/individual-tier-sales-plan.md` (formatted copy `Orgtrack_Individual_Tier_Sales_Plan.pdf` in the project root, not in git).
**Built locally (steps 1–7), not deployed.** Keep the plan, its PDF and this section in step when the direction changes.

### Implementation (Individual Tier)
- Backend: `models/individual.py` has its own tables (`scoring_rules`, `kpi_months`, `kpi_types`, `kpi_items`, `training_modules`, `monthly_evaluations`, `scorecard_snapshots`).
  They are deliberately separate from the Project Tier's `Period`/`RuleVersion`/`Snapshot`, so the old quarterly screens never see Sales months.
  `services/individual.py` handles population, scope, evaluators, scorecards and snapshots. `api/routes/individual.py` serves `/api/individual/*`. `seed/sales.py` provides the catalogue, rule v1, months, logins and the importer.
- `seed/sales.py:ensure_individual_tier` runs at startup and in `app.seed`. It is idempotent: it imports `backend/seed_data/Project Tracker Sales (Shoonya).xlsx`
  (bundled, gitignore exception) once when there are no KPI rows, opens the current month, and provisions the Sales HOD and the Sales employees whose `proposed_role` is Manager (D1 emails).
- Population: Sales employees minus the department head (36). Viewer scope = population ∩ `Scope.perf_people`, so Managers never see their own row.
  The evaluator is the first person up the chain with a Manager or HOD login. Only the evaluator or an Admin edits a person's month, so the HOD cannot edit a Manager's people.
  The approver must differ from whoever saved or submitted the evaluation; HOD-written evaluations go to Admin.
- Rules decided while building: a row with no recorded outcome is excluded from On-time (shown as "No outcome"), never counted as a delay.
  An unvalidated delay counts in On-time **and** costs −2 (D4). A changed outcome or completion clears its validation or verification.
  Team KPI rows use their own value, or the reportee sum when every reportee row has a value. Approving an evaluation verifies that month's training completions (D8).
  Lock needs every evaluation approved, or a reason; anyone not approved is stored as `not_evaluated`.
- Frontend: `lib/tier.ts` (the URL decides the tier: `/individual/*`), `components/layout/AppShell.tsx` (tier dropdown, per-tier nav), and `pages/individual/*`.
  The old Team, Performance, Rewards and Reports screens still exist at their old routes for Project Tier links, but they are not in either nav.
- **Each tier has its own Home (user direction, 15 Oct 2026).** The Project Tier home (`/api/home`) shows delivery work only: work reviews, blocker and date validations, closures, requests, overdue and blocked tasks.
  `home.py:action_items` tags every item with `tier`, and people items (check-ins, training, recognition, scoring policy) are excluded there.
- **Individual Tier Home = quarterly performance dashboard (user direction, 16 Oct 2026; replaced the action inbox).** `GET /api/individual/dashboard?year=&quarter=`
  (calendar quarters, Q1 = Jan–Mar; labels show the months). Quarter-to-date values are built from the existing monthly scorecard rows (`_people_rows`), so scoring,
  scope and redaction are unchanged: a person's quarter score = average of their scored months; group averages cover only people with a value and always return the count.
  Manager: own team's summary, monthly tiles, employee progress, "Needs attention" (no team comparison). HOD: department + teams by Manager (grouped by evaluator) + employees + attention.
  Admin: organisation (pilot departments; others listed as not in the pilot), department table, quarterly trend for the year, teams by Manager, employees.
  Rows open a month-by-month drawer linking to Team and the read-only result. The old `/api/individual/home` endpoint was removed.
  **In the pilot, the monthly check-in is the monthly evaluation** (`MonthlyEvaluation`). The UI calls it "Monthly check-in".
- **The scoring method is Admin-only (user direction, 15 Oct 2026).** Weights, per-metric scores, contributions, coverage, base, penalties and tier thresholds
  are removed on the server for HOD and Managers (`services/individual.py:redact_card` and `method_visible`; people rows, rewards and CSV exports are redacted too).
  They see the inputs, the final score, the tier and the status. KPI Scoring (`/api/individual/rules*`) is Admin-only, and **a second Admin approves rule versions** (not the HOD).
- **Flow (user direction, 15 Oct 2026; keep it flat, no tabs inside tabs):**
  **Team** (`/individual/team`) lists everyone under the viewer. A person (`/individual/team/:person?month=`) is **one page** with 1. KPIs (target, achieved, done?, completed on, delay reason) and duty tasks,
  2. Ratings (the R&R columns), 3. Training (modules, TWCS), and Save / Submit / Approve / Return. **All marking happens there**, or in bulk with the Excel template and upload on the Team page
  (`GET /months/{id}/checkin-template.xlsx`, `POST /months/{id}/checkin-upload?dry_run=`; matched by Employee ID; blank cells leave values unchanged; per-row preview before applying).
  **Performance** (`/individual/performance`) is **read-only**: one table with every employee's value for each parameter, final score, tier and check-in state, plus the HOD's Close month.
  The person scorecard (`/individual/performance/:person/:month`) is read-only too.
- **Check-in parameters (latest direction, 15 Oct 2026):** Tasks on-time, Tasks delayed and Achievement % are **always worked out from the KPIs and duty tasks**
  (never typed, never uploaded). The Manager rates only the ratings **weighted in the person's category** (Sales: Quality and CSAT) and may type the Training score (TWCS 0–100),
  which replaces the TWCS from the modules. Collaboration, Innovation and Compliance are hidden for Sales because they carry no weight there. The person page in Team recalculates
  % achieved, timing and the three automatic values live as the Manager types, before saving.
  Achievement is shown as **"KPI average %"** (user choice, 15 Oct 2026): the average of every KPI's achieved ÷ target (each capped at 150%), with "x of y KPIs".
  **KPI achieved values default to 0 (user direction, 16 Oct 2026)**, so every KPI with a numeric target counts, at 0% until marked. This supersedes "unmarked KPIs are left out".
  It applies to individual KPI rows only (import, new rows, copied targets, a cleared box, and `seed/sales.py:backfill_achieved_defaults` for open months at startup).
  Team rows stay blank and use the reportees' sum. Locked months are never changed. The person page lists each KPI's % above the average; the Performance table shows the average and the x-of-y count. `MonthlyEvaluation.on_time_count`, `delayed_count` and `achievement_pct` are unused.
- `core/schema_patch.py:add_missing_columns` adds new nullable columns (and non-null columns with a scalar default) to an existing database at startup (there is no Alembic yet).
- **Production-level flow plan:** `docs/production-plan.md` (phases A, S, B, C, D, E; deployment and logins are out of scope for now). Done so far:
  - **India time:** `core/clock.py` (`today_ist`, `now_ist`, `month_last_day`) replaces every server-clock call, including model defaults.
  - **Due dates follow the month:** `KpiItem.target_date` is blank unless a Manager sets an earlier date inside the month; `KpiItem.due_date` is the date in force.
  - **Months open and carry over automatically:** `seed/sales.py:open_due_months` (startup and every `/individual/context` call) opens months up to the current one,
    and `carry_over` copies each person's KPIs, targets and duty tasks from their latest month once (`KpiMonth.carried_over_at`; achieved 0, team rows blank). The old copy-targets endpoint is gone.
  - **Rows can be edited and removed** (`POST /items/{id}/remove` with a reason; removed rows are kept, filtered everywhere and never carried). **Warnings can be checked**
    (`POST /items/{id}/resolve-warning`; name matches by Admin only).
  - **Demo data:** `seed/individual_demo.py` (fixed seed, per-person profiles; Jul and Aug 2026 closed, Sep nearly finished, current month in progress). Every demo value has `illustrative=True`;
    real values and existing check-ins are never overwritten. `python -m app.seed.individual_demo add|clear` or Admin → KPI Scoring → Demo data. Auto-loads once outside production
    (`ORGTRACK_INDIVIDUAL_DEMO`), never again after a clear. Tests never load it except `tests/test_zz_demo_data.py`, which runs last.
  - **Marking and approval (Phase B):** Team list filters (To mark, Returned, Submitted, Waiting for my approval, Approved); `POST /months/{id}/decide-many`
    (same rules as one by one via `_decide`, per-person results); training catalogue (`training_catalog`, `GET/POST /training-catalog`) and `POST /training/assign`
    for several people; "Before you submit" checklist (required ratings block, the rest warn); `GET /history/{emp}/{month}` from the audit log.
  - **Closing, correcting, recognising (Phase C):** `CorrectionRequest` (HOD/Admin request → a different Admin approves → only that person's closed month reopens
    for the evaluator → approval re-freezes the snapshot via `services/individual.py:refreeze_person`, old and new results kept). `_require_open(month, emp_id, db)`
    lets an approved correction through. `MonthlyNomination` (closed months only, citation ≥ 50 words, decided by HOD/Admin, never the nominator or nominee).
  - **Consistency (Phase D):** the old quarterly Team, Performance, Rewards, Reports, Nomination and Rules studio pages and the old training drawers were deleted;
    their routes redirect to the Individual Tier. The Project Tier person page shows work only. Search is tier-aware (`/individual/search`). The UI says "closed"
    for `Locked` months (`lib/status.ts`) and "check-in" for the monthly evaluation.
  - **Guides:** `docs/guides/manager.md`, `hod.md`, `admin.md`.
Where this section conflicts with earlier sections, **this section wins** (it is the user's latest instruction).

### Tiers and navigation
- Two tiers, switched from the **tier dropdown** at the top of the sidebar (it shows only the current tier name, e.g. "Individual Tier"):
  - **Project Tier**: Home, Projects, Tasks. Keep it as built, with no new work.
  - **Individual Tier**: Home, Team, Performance, Rewards, Reports, plus **KPI Scoring** (the scoring method), which only Admin sees. **Build this first.**
- The switch is built: the tier dropdown, or the user menu on small screens, moves between `/home` and `/individual/home`. Pilot accounts and Admins start in the Individual Tier.
  The deployed demo (`https://orgtrack-api.onrender.com` + Vercel) still runs the old build until this is pushed and redeployed.
- **The app is named Finvasia Elevate** (user decision, 15 Oct 2026). User-visible text uses it. Internal identifiers keep `orgtrack`:
  `ORGTRACK_*` env vars, `orgtrack.*` storage keys, the `orgtrack-api` Render service, package names and the source file names. Don't rename them without a migration plan.

### Scope, logins and approval
- **Sales team only**: 37 records in `Employee_Master`, headed by Gurjot Singh (EMP-0265).
- **Only Manager, HOD and Admin log in** (7 named accounts). There are no Team Lead, employee or shared logins.

| Role | Person | Does |
|---|---|---|
| Admin | Kushagra Kataria (EMP-0324, `kushagra.kataria@shoonya.com`) | Everything, including KPI Scoring. Approves evaluations the HOD writes (proposed). |
| HOD | Gurjot Singh (EMP-0265) | Sees all of Sales. Approves or returns Manager evaluations, verifies training, locks the month. |
| Manager | Amit Kumar (0266), Rajesh Kumar (0280), Anju Kumari (0295), Durga Paswan (0298), Keshav Khullar (0293) | Evaluates their reporting tree: targets, actuals, training records, ratings, submit |

Evaluator load: Amit 13 (TLs Parmodh, Amanpreet, Shubham and their teams), Rajesh 12 (TLs Sakshi, Anshul and their teams), Anju 2, Durga 1, Keshav 1,
and Gurjot 7 (the 5 Managers plus analysts Dipanshu Gupta and Pratham Arora).

**Monthly flow:** Manager sets targets → enters actuals → records training → completes the evaluation (Quality, CSAT, delay reasons) and **submits** →
HOD **verifies training and approves, or returns with a reason** → HOD **locks** the month. Locked scores are frozen, and later changes need a recorded correction.
No one approves their own evaluation, and every change is audited.

### KPIs from the Sales tracker
- **The tasks in `Project Tracker Sales (Shoonya).xlsx` are the KPIs.** Each of the 108 numeric rows (Sep 2026) is a monthly target and achieved value for one person.
- KPI types:
  - call volume (per day × 22 = monthly)
  - client interaction (connected calls)
  - account openings
  - funded clients
  - funds added in ₹ (text such as "2 cr" or "10 lacs" is converted to rupees)
  - account reactivation
  - zero-funded clients
  - conversion %
  - team versions for Managers, which are the sum of their reportees' rows
- The 38 *Extra Tasks* rows (audits, Jira, meetings, testing, reception, TAT) have deadlines but no numbers. They feed **On-time and delays**, not Achievement.
- The import keeps every row and flags problems.
- Name matches to confirm: "Gurjot Sodhi" = Gurjot Singh, "Shivani Sharma" = EMP-0274, "Shivani. D" = Shivani Dhiman (EMP-0275), "Upasana" = Upasna (EMP-0288).
- These people have no tracker rows and show **"No targets set"**: Shweta Jadhav, Keshav Khullar, Kunal Sethi, Sunaina Joshi, Dipanshu Gupta and Pratham Arora.
- Periods are **monthly**: Sep 2026 is imported and Oct 2026 is open. The tracker's points sheet is retired, and there are no points or typed bonuses.

### Scoring (R&R parameters of 15 Oct 2026, Training 10% in every category)

| Category | Teams | Achievement | CSAT | On-time | Quality | Compliance | Collab. & automation | Innovation | Training |
|---|---|---|---|---|---|---|---|---|---|
| **Core Revenue** (pilot) | CS, Sales, DM | 30 | 15 | 25 | 20 | – | – | – | **10** |
| Revenue-Enabling | Product, UI/UX, Compliance, Back Office, Demat, DP | 20 | – | 25 | 20 | 15 | 10 | – | **10** |
| Support | HR, Finance, IT | – | – | 25 | 20 | 10 | 15 | 20 | **10** |

Training's 10% came from CSAT 25 → 15 (Core Revenue), Achievement 25 → 20 and On-time 30 → 25 (Revenue-Enabling), and Collaboration 25 → 15 (Support).
Training sits **inside** the weights, so the 90/10 blend in §12 is **not** applied.

- **Achievement:** for each row, achieved ÷ target × 100, capped at 150. The person's value is the average over rows with an actual, scored on the existing curve (0→0, 60→40, 80→60, 100→90, 150→100).
- **On-time:** on-time ÷ (on-time + delayed) over tracker rows and Extra Tasks, scored on the existing curve (45→0, 75→60, 85→80, 95→100).
- **CSAT and Quality:** the Manager's rating 1–5 × 20. Compliance, Collaboration and Innovation are scored the same way when used.
- **Training = TWCS (Timeliness-Weighted Completion Score), 0–100:**
  - Credit per module: **100%** on or before the due date, **75%** if 1–7 days late, **50%** if 8–14 days late, **25%** if 15+ days late, and **0%** if not done by the cut-off.
  - TWCS = the average credit over modules **due in the month**. Example: (100 + 100 + 100 + 50 + 0) ÷ 5 = **70**.
  - Bands, with the KEKA rating:
    - **90–100 Recognised (5)**
    - **75–89 Standard (4)**
    - **50–74 Developing (3)**
    - **below 50 Support (0)**: flagged to the Manager, with **−2 on the final score**
  - The KEKA rating is shown on the scorecard and goes into a monthly export for upload. **There is no live KEKA connection**, so never claim one.
  - What counts in a month:
    - Future-due modules wait for their month.
    - Approved exemptions are excluded, and their history is kept.
    - Retakes are attempts on the same module.
    - The cut-off is the 5th of the next month (proposed).
  - The Manager records completion dates. A completion counts only once it's **verified by someone other than the recorder** (in the pilot, the HOD verifies while approving the month).
  - If it's confirmed that nothing was due, Training is **N/A**: its 10% drops out of the coverage and there's no training penalty.
  - Team TWCS = the average credit across all of the team's modules.
  - Stored per module: assigned date, due date, completion date (blank if not done), **days late** (negative if early, with no early bonus), credit and
    **module track** (Technical, Functional, Behavioural, Leadership or Compliance, weighted equally for now).
- **Base** = Σ(score × weight) ÷ Σ(weights with data). **Coverage below 70% means Insufficient data.** Missing data is never zero.
- **Final** = max(0, base − 2 × delayed cases − (2 if TWCS < 50)). Validated delays are excluded from both the penalty and On-time (proposed).
- **Tiers** (proposed): Gold ≥ 90, Silver ≥ 80, Bronze ≥ 70, applied to the unrounded final. Store full precision and display two decimals.

**Test vectors** (use them in `tests/`):

| Case | Expected |
|---|---|
| Rows 4000/4180, 1900/1881, 380/410 | 95.69%, 101.01%, 92.68% → average 96.46% → Achievement **84.69** |
| Same person, CSAT 4, On-time 3/3, Quality 4, TWCS 70 | 25.41 + 12.00 + 25.00 + 16.00 + 7.00 = base **85.41**. One delay gives a final of **83.41** (Silver). |
| Same, TWCS 40 | base 82.41, minus 2 for the delay and 2 for training = **78.41** (Bronze) |
| Same, no CSAT (TWCS 70) | **86.36** at 85% coverage |
| Same, no training due | **87.12** at 90% coverage |
| Kulwinder 4000/4400 | 90.91% → **76.36** |
| TWCS: 3 on time, 1 ten days late, 1 not done | **70** |

### Build order
1. The tier switch and the two side navs, with KPI Scoring for Admin only.
2. The 7 Sales logins and server-side scope (Managers see their reporting tree, Sales-only data).
3. The KPI model and the Sales tracker importer (targets, actuals, Extra Tasks, name mapping, flags).
4. The scoring engine for the new parameters, including TWCS and both −2 penalties, tested with the vectors above.
5. The Performance target and actuals grid, the Training tab, the monthly evaluation and scorecard, HOD approval, and the month lock.
6. The KPI Scoring admin page with an impact preview. Locked months keep their rules.
7. Home, Team, Reports and Rewards adapted to the Sales KPIs.
8. Deploy to Render and Vercel, then run browser checks.

**Data model additions:** KPI type · monthly KPI target (person, month, type, target, achieved, source, entered by, approved by) ·
duty task (Extra Task: target and completed date, status, delay reason, validated) · training module (per-module dates, days late, credit, track, verifier) ·
monthly evaluation (ratings, `Draft → Submitted → Approved | Returned`, evaluator, approver) · scoring rule version (weights, curves, penalties, coverage, tiers, effective month) ·
monthly scorecard snapshot (frozen on lock).
Reused as they are: accounts, server-side scope, audit, rewards and nominations, reports and export.

### Open decisions (the defaults apply until the user answers)

| # | Decision | Default |
|---|---|---|
| D1 | Login emails | firstname.lastname@shoonya.com |
| D2 | Approver for evaluations the HOD writes | Admin |
| D3 | CSAT source for Sales | The Manager enters it in the evaluation |
| D4 | Keep −2 per delay on top of On-time | Keep |
| D5 | Exclude validated delays | Yes |
| D6 | Tiers | 90 / 80 / 70 |
| D7 | Name matches | As proposed above |
| D8 | Who verifies the training completions a Manager records | The HOD, while approving the month |
| D9 | The "Customer Experience" and "Pure Support" categories in the parameter header | Not used, and CS stays in Core Revenue |
| D10 | Training cut-off | The 5th of the next month |
| D11 | Early-completion bonus from negative days late | Not applied (days late are stored) |
| D12 | Keep −2 when TWCS < 50 on top of the lower Training contribution | Keep, as specified |
