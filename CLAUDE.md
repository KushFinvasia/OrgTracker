# CLAUDE.md — Orgtrack (Finvasia / Shoonya)

Orgtrack is one internal web platform for Finvasia / Shoonya with two connected areas:
**project delivery** (projects, milestones, tasks, reviews, workflows, risks, incidents/RCA) and
**employee performance** (reporting hierarchy, KPIs, monthly check-ins, training, Rewards & Recognition).

> **Projects are the unit of work. Employees are the unit of performance.**
> One master identity per person, one performance record per period. A late project must not
> automatically penalise everyone on it.

> This file is the working guide for Claude Code. It is **not** the "CLAUDE.md business context draft v2.0
> (29 Sep 2026)" that the source documents mention; that draft is not in this folder and has never been seen.

---

## 1. Current status (as of 12 Oct 2026)

- **First implementation exists**: React + FastAPI, chosen by the user. It is a working dev build, not deployed. See §20 for structure and commands.
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

**Not present (never claim to have read them):** the CLAUDE.md business draft v2.0, the two detailed
business and frontend PDFs it names, the supplied logo file, and the earlier compact PDFs.
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
Training is a **new layer outside the existing category weights** unless the user explicitly approves another approach.

## 4. Non-negotiable product constraints

- **No employee login. No shared or team login.** Only named accounts (Admin, HOD, Manager, Team Lead), each linked to one Employee record.
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

**Scoring (proposed, not activated):**
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

**Category weights** (each column totals 100%):

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

90/10 training blend · equal course-count weighting · eligible training types and criteria · cutoff and N/A rules · assignment, verification and exception authorities ·
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

Inspired by Linear and Notion for simplicity and navigation, not copied. Use the **supplied gold-gradient and charcoal ∞ logo**. Don't invent a replacement.

| Token | Hex | Use |
|---|---|---|
| ink | `#2D2D2D` | Primary text |
| muted | `#69766F` | Secondary text |
| canvas | `#F6FAF7` | App background (mint canvas) |
| surface | `#FFFFFF` | Cards |
| border | `#E2EAE4` | Restrained borders |
| primary green | `#23763F` | Emphasis, active tab underline, success, headings accent |
| mint | `#E7F5EB` | Tinted panels, info callouts |
| charcoal | `#242D28` | Sidebar, dark score cards |
| gold | `#DCB350` | Logo, active-nav marker, score-card labels |
| pale gold | `#F0D488` | Accent text on charcoal |
| orange | `#D88A2D` | **Primary action buttons** (charcoal text), per the PDF |

Note: the handoff text says "green primary actions", but the PDF renders primary buttons in **orange** with green for emphasis. Follow the PDF and confirm with the user if it matters.

**Type and layout:** 28px app titles, 15–18px section headings, 12–14px body and form values. Use **tabular numerals** for scores, dates and percentages.
Spacing scale is 4 / 8 / 12 / 16 / 24 / 32.

**Shell (from the PDF):** a charcoal left sidebar with the logo and "Orgtrack", an org switcher ("Finvasia"), nav items with icons, a gold left bar and green tint on the active item,
a PINNED section, and a role-view switcher at the bottom ("Manager view / Product"). The top bar has a breadcrumb (`Workspace / <Screen>`), "Search anything… Ctrl K",
a notification bell and the user avatar with role. Each page has a large title, a subtitle line, one primary action at the top right, then tabs.
Drawer forms are laid out as a field grid with a "Before you save" guidance panel on the right and Cancel / primary action at the bottom.

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
- The handoff calls primary actions green, but the PDF shows orange buttons (see §17).

## 19. Recommended implementation order and invariants

**Order:** source clean-up → auth and server-side scope → people and import → projects → assignments and review → templates and RCA →
training assignment and verification → dashboards → performance and period snapshots → final training blend → recognition → reports and administration.
The earlier recommended pilot is a **Product and Client Support shadow quarter**, pending the user's direction.

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
- Deployment: Render (backend + Postgres via `render.yaml`) and Vercel (frontend, root `frontend/`, `vercel.json`, env `VITE_API_URL`). Postgres URLs are normalised to `postgresql+psycopg://`; `ORGTRACK_ENVIRONMENT=production` refuses to start without `ORGTRACK_JWT_SECRET`. `ORGTRACK_DEMO_ACCESS_CODE` gates dev sign-in on internet-facing demos. Tests run on Postgres with `ORGTRACK_TEST_DATABASE_URL`. See README "Deploy".

**Backend layout (`backend/app`)**
- `services/scoring.py` is the **pure** scoring engine: anchors, base KPI and coverage, training completion, the 90/10 blend, tiers and gates. Keep it free of database access. The §13 worked examples live in `tests/test_scoring.py`.
- `services/scope.py` enforces access on the **server**. `work_people`, `perf_people` and `visible_project_ids` drive every list, search, report and export. Team Leads get an empty `perf_people`. Project membership never extends `perf_people`.
- `services/evaluation.py` builds a person's period inputs from records. A locked period returns its stored `Snapshot` and is never recalculated.
- `services/delivery.py` holds task and assignment rules (`validate_assignments`), derived timing, health and progress, and serialisers. `services/common.py:task_timing` judges In-review work by its submission date.
- `services/audit.py:record` must be called for every decision. `AuditEvent` rejects updates and deletes at the ORM level.
- Business-rule failures raise `core.errors.RuleViolation(message, field)`. The frontend shows `field` inline next to the matching input.
- Responses are plain dicts built by serialiser helpers, and request bodies are Pydantic models in `schemas/` or local to a route.

**Frontend layout (`frontend/src`)**
- `App.tsx` defines the 14 routes. `components/layout/AppShell.tsx` holds the sidebar, top bar, Ctrl K search and notifications.
- `components/ui` is the shared kit: Badge, Button, Card, Stat, Tabs, Drawer (focus trap and unsaved-draft guard), Field, PersonPicker (shows ID, designation and department) and DecisionButton (a decision with a required reason).
- `components/tasks` (CreateTaskDrawer, TaskDrawer) and `components/training` are reused across screens.
- `lib/hooks.ts` provides `useApiQuery(path)` (the query key is the path), `useApiMutation` (invalidates everything on success), `useDraft` (recoverable sessionStorage drafts) and `useQueryParam` for tab and drawer state in the URL.
- Styling is plain CSS with the Shoonya tokens in `styles/tokens.css`. Primary buttons are orange (`btn-primary`), as in the PDF.
- Show dates through `lib/format.ts` (`09 Oct 2026`, IST, en-IN grouping). Show unavailable values as "Unavailable" or "Insufficient", never as 0.

**Seed data**
- `seed/workbook.py` imports the corrected workbook as-is and flags source defects rather than fixing them. It also provides the admin dry-run report.
- `seed/demo.py` adds a clearly illustrative layer and marks its records `illustrative=True` or `source="demo"`: six demo-provisioned accounts, KPI rule v2 (Approved), training policy v3 (Pending approval), reward policy r1 (Draft), the Jul-Sep and Oct-Dec 2026 periods, a training catalog with assignments matching the PDF (12/10/8, team 11/14), project PRJ-D01, incident INC-DEMO-01 and a Draft reward cycle.
- Live scores come from the records, so Sachin's evaluation shows a computed 94.30 / 92.87, not the PDF's illustrative 86.5 / 85.85.

**Known gaps and next steps**
- Company SSO is not wired yet; dev sign-in is email-only for provisioned accounts (plus the optional shared demo access code).
- Evidence uploads go to local disk, which is ephemeral on Render.
- There are no Alembic migrations.
- Upload type and size policy is still pending, so the 10 MB limit is a dev placeholder.
- Productivity benchmarking, post-lock correction workflow, Gold-cap application, saved report views, HRMS/LMS/CRM integrations and the mobile quick-update screens are not built yet.
