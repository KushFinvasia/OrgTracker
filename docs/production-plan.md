# Finvasia Elevate: production-level flow plan (Individual Tier)

Revised 16 Oct 2026. Status: **built.** Phases A, S, B, C, D and E are implemented and tested (16 Oct 2026). Guides: `docs/guides/`.

**Scope:** make the Individual Tier work end to end, month after month, the way Managers, the HOD and Admins will really use it.
**Out of scope for now** (later, separately): deployment, hosting, the database server, company sign-in and passwords.
Development sign-in stays as it is.

## The monthly flow this plan delivers

1. **The month opens by itself** on the 1st (India time). Every person's KPIs, targets and duty tasks carry over from last month, due on the new month's last day, with achieved values reset to 0.
2. **Managers mark in Team.** For each person: achieved values and done dates, ratings (Quality, CSAT), training. Or many people at once with the Excel upload. Then **Submit**.
3. **The HOD approves or returns** in Team (one by one, or several at once). Admin does the same for the people the HOD marks.
4. **The HOD closes the month** in Performance once everything is approved. Results freeze.
5. **Results** are read in Performance, Home (quarterly dashboard), Reports and Rewards. A mistake found after closing goes through a **correction** that keeps the old and new result.

## What is wrong or missing today

| # | Problem | Effect |
|---|---|---|
| 1 | Each KPI row stores a fixed due date (the Sep rows say 30 Sep). A new month starts empty; the "copy targets" button disappeared when Performance became read-only. | October has no KPIs unless they are added one by one, and dates would need editing every month. |
| 2 | Months are opened by hand. | If no one opens the month, there is nothing to mark. |
| 3 | Dates use the server clock, not India time. | Between 00:00 and 05:30 IST, "today", lateness and month boundaries are wrong. |
| 4 | KPI rows and duty tasks cannot be removed or renamed; the KPI type cannot be changed. | A wrong or discontinued KPI stays forever and drags the KPI average down. |
| 5 | Import warnings ("name match to confirm", "per day x 22 differs") can be read but never resolved. | The same warnings show every month. |
| 6 | The Team list has no status filters, and approving needs opening each person. | The HOD cannot see "what is waiting for me" at a glance or approve several at once. |
| 7 | Submitting does not show what is still missing until it fails. | Managers submit, get an error, and hunt for the field. |
| 8 | Training modules are added person by person; there is no list of modules to reuse. | Assigning one course to a 13-person team means 13 entries. |
| 9 | A closed (locked) month cannot be corrected at all. | One wrong mark after closing cannot be fixed. |
| 10 | No change history on a person's page. | Managers and the HOD cannot see who changed a value and when (the audit log exists but is not shown here). |
| 11 | Search opens the old Project Tier person page, which still shows the retired quarterly performance, training and recognition tabs. | Two different "performance" stories for the same person. |
| 12 | Nominations for non-score awards are not built; Rewards only shows tiers from closed months. | Recognition stops at a list of tiers. |

## Phase A: month and KPI lifecycle (done)

1. **Due date follows the month.** A row is due on the last day of its month unless the Manager sets a specific earlier date. Stored dates that equal the month end are cleared, so every month behaves the same. (Fixes problem 1.)
2. **Automatic month opening and rollover.** On the 1st (and at server start, catching up any missed month) the month opens and each person's rows carry over from their latest month: same KPI, type, target and duty tasks; achieved 0; no outcome; no flags. Carry-over runs once per person and month and never touches closed months. October is back-filled from September. (Fixes 1, 2.)
3. **India time everywhere.** One `today()`/`now()` in Asia/Kolkata replaces the 35 server-clock calls. (Fixes 3.)
4. **Edit and remove rows.** Managers can rename a KPI, change its type and target, and **remove** a KPI or duty task from the month (with a reason, kept in history). Removing in one month does not remove it from earlier months; it stops carrying over. (Fixes 4.)
5. **Resolve warnings.** A Manager or Admin can mark an import warning as checked (with a note); checked warnings stop showing and do not carry over. Name-match warnings (D7) are confirmed once by Admin. (Fixes 5.)

## Phase S: good-quality demo data (added and done 16 Oct 2026)

A realistic, clearly labelled demo layer so every screen can be shown and tested with believable numbers.

1. **Months:** Jul and Aug 2026 (closed, results frozen, Jul recognition published), Sep 2026 (open, nearly finished: most check-ins approved, some submitted, one returned, a few still in draft), Oct 2026 (open, in progress).
2. **People keep a consistent profile** (strong, steady, improving, struggling) so quarter trends, tiers and "needs attention" make sense. Values come from a fixed random seed, so every reseed gives the same data.
3. **KPIs:** achieved values around each person's profile (some above 100%, a few below 60%), done dates with mostly on-time work and some late tasks, delay reasons on most delays and some validated by the HOD.
4. **Ratings and training:** Quality and CSAT ratings that follow performance; 3–5 training modules per person per month across the five tracks, with realistic lateness (TWCS from about 40 to 100) and HOD verification on approved months.
5. **Workflow states:** submitted by the right Manager, approved by the HOD (Admin for the people the HOD marks), returns with real-sounding reasons, audit entries for each step.
6. **Labelled and removable:** every demo value is marked as demo data. Real tracker values (for example Kulwinder's and Tanu's September actuals) are never overwritten. `python -m app.seed.individual_demo add` adds it and `... clear` removes it; Admins can do the same in KPI Scoring → Demo data. It loads automatically on a development database once (never again after it has been removed) and never in production.

## Phase B: marking and approval (done)

1. **Team list filters and counts:** All · To mark · Submitted · Returned · Approved, plus "Waiting for my approval" for the HOD and Admin. The month's progress (x of y approved) stays at the top. (Fixes 6.)
2. **Approve or return several at once** from the Team list for the HOD and Admin, with the same rules as one by one (never your own, never what you wrote; a return needs a reason). (Fixes 6.)
3. **Submit checklist** on the person page: before Submit, show what is complete and what is missing (KPIs with no done date, ratings not given, training not recorded) and let the Manager submit anyway where the rules allow. (Fixes 7.)
4. **Training module list:** a reusable list of modules (title, track) and "Assign to team": pick a module, due date and people in one step. Completion is still recorded per person. (Fixes 8.)
5. **History on the person page:** who changed which value, when, with the reason, for that person and month. (Fixes 10.)

## Phase C: closing, correcting and recognising (done)

1. **Correction after close:** the HOD requests a correction for one person and month with a reason; Admin approves; the stored result is replaced and the old one kept beside it, both visible in history and reports. (Fixes 9.)
2. **Nominations** (if wanted for the pilot): a Manager nominates someone from a closed month with a short citation; the HOD approves; recognition is published. Score tiers stay as they are. (Fixes 12.)
3. **Month close checks:** the close screen lists what blocks a clean close (unapproved check-ins, unvalidated delays, training after the cut-off) with links to each person.

## Phase D: consistency across the app (done)

1. **Search** in the Individual Tier opens the person's page in Team; in the Project Tier it opens their work. (Fixes 11.)
2. **Retire the old quarterly screens:** remove the old Team, Performance, Rewards and Reports pages and the performance, training and recognition tabs on the Project Tier person page. The Project Tier keeps Home, Projects, Tasks and people's assigned work. (Fixes 11.)
3. **Wording pass:** one name per thing everywhere ("check-in", "KPI average", "training score"), dates as 09 Oct 2026, and empty and error states on every Individual Tier page.

## Phase E: proving it works (done)

1. **Tests for every flow step:** month opening and carry-over, due dates, removal, warnings, filters, bulk approval, checklist, training assignment, history, correction, search links. The existing 99 tests keep passing.
2. **Scripted browser walkthrough** of a full month on the local app: Manager marks and submits, HOD returns one and approves the rest, HOD closes, dashboard and Rewards update, a correction is made.
3. **Docs:** CLAUDE.md and a one-page guide each for Managers, the HOD and Admins.

## Order and size

| Phase | Depends on | Size |
|---|---|---|
| A. Month and KPI lifecycle | none | medium |
| B. Marking and approval | A | medium |
| C. Closing, correcting, recognising | B | medium (nominations optional) |
| D. Consistency | none | small |
| S. Demo data | A | medium |
| E. Proving it works | all | runs alongside each phase |

## Decisions (defaults apply unless you say otherwise)

| # | Decision | Default |
|---|---|---|
| F1 | Targets each new month | Carry over unchanged; Managers edit what changes |
| F2 | Quarters on the dashboard | Calendar (Q1 = Jan–Mar). Alternative: financial year (Q1 = Apr–Jun) |
| F3 | Nominations for non-score awards in the pilot | Build them (Phase C2) |
| F4 | Retire the old quarterly screens (Phase D2) | Yes |

## Later (not in this plan)

Deployment and hosting, PostgreSQL with backups and migrations, company sign-in, removing real data from Git, error tracking and CI. These come when you are ready to deploy.
