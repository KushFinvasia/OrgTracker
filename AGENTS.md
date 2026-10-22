# Finvasia Elevate — agent guide

This guide applies to the whole repository. It describes the working tree reviewed on 21 Oct 2026, including local changes; it does not establish deployment status. Read the relevant implementation and tests before changing behavior.

## Product and current direction

Finvasia Elevate (formerly **Orgtrack**) is an internal Finvasia / Shoonya application for project delivery and employee performance, training, and Rewards & Recognition (R&R).

**Projects are the unit of work; employees are the unit of performance.** Each person has one master identity. Assignments connect people to projects; a late project must not automatically penalize every contributor.

There are two tiers:

- **Project Tier:** delivery Home, Projects, project workspaces, Tasks, and people's assigned work. Includes milestones, review and acceptance, dependencies, blockers, deadlines, workflow/RACI templates, cross-department requests, risks, incidents/RCA, and closure.
- **Individual Tier:** the active **Sales-only pilot**, with monthly KPIs, duty tasks, manager check-ins, training, independent approval, month closing, frozen scorecards, corrections, recognition, and reports. Its Home also summarizes calendar-quarter performance.

The public product name is Finvasia Elevate. Existing `ORGTRACK_*` settings, `orgtrack.*` browser storage keys, package names, and the `orgtrack-api` hosting identifier remain intentional. Do not rename them incidentally.

## Read first and resolve conflicting context

1. Follow the latest user instruction.
2. Read `CLAUDE.md`, especially **§21** for current Individual Tier behavior and **§17** for the current interface. Later dated decisions within these sections override earlier descriptions.
3. Read `docs/production-plan.md` and the appropriate `docs/guides/{manager,hod,admin}.md`. `docs/individual-tier-sales-plan.md` is the original pilot plan; subsequent decisions refine it.
4. Check the current code and tests to establish what is implemented. If implementation and an explicit requirement differ, identify the discrepancy rather than treating a bug as policy.
5. Use `README.md` for setup, with commands checked against package/config files. Counts and old walkthroughs can become stale.

Original source material lives in the project root:

| Source | Purpose and precedence |
| --- | --- |
| `Orgtrack_Complete_New_Chat_Prompt.docx` | Original detailed business handoff; later user decisions supersede conflicting rules. |
| `Orgtrack_Premium_SaaS_Redesign.pdf` | Original 103-page UI reference. Pages represent states, tabs, and drawers, not 103 routes. |
| `PT_RR_Corrected_Data.xlsx` | Canonical organization and delivery seed/migration data; supersedes original workbooks. |
| `Project Tracker Sales (Shoonya).xlsx` | Sales pilot KPI targets/actuals and Extra Tasks; its old points formulas are retired. |
| Org chart, R&R Parameters, `RACI.xlsx`, `RCA.xlsx` | Historical context; corrected data and later decisions win. |

The 19 Oct interface direction documented in `CLAUDE.md` references `../prototype/finvasia-elevate-prototype.html`, outside this repository. Check availability before claiming to have read it. Current tokens/components are in the frontend. Never claim to have inspected missing historical documents or integrations.

**Important supersessions:**

- The former quarterly Team, Performance, Rewards, Reports, and Rules studio frontend screens were retired. Old performance-related routes redirect to Individual Tier equivalents for pilot accounts. Legacy backend APIs and scoring remain; do not delete them just because the frontend retired its screens.
- Individual Tier training is **10% inside category weights**, scored by TWCS. The older Project Tier 90/10 training blend must not also be applied to it.
- Individual KPI achieved values start at **0** in open months. This is an explicit input default, not permission to replace other missing data with zero.
- Since 20 Oct, KPI rows have an achievement **Result**, without completion dates or timing. Only **duty tasks** contribute to on-time and delay penalties.
- The current visual theme uses green primary actions and the Finvasia wordmark, superseding the PDF's orange buttons and older logo.

## Architecture and where to make changes

| Area | Location and responsibilities |
| --- | --- |
| Backend entry/config | `backend/app/main.py`, `core/config.py`, `core/database.py`: FastAPI lifespan, settings, SQLAlchemy engine/session. All API routes are under `/api`; health is `/api/health`. |
| Authentication/access | `core/security.py`, `api/deps.py`, `services/scope.py`: JWT, authenticated `Ctx`, work/private-performance scope. |
| Models | `backend/app/models/`: organization, accounts/audit, project, task, workflow, training, legacy performance, and Individual Tier. Register models through `models/__init__.py`. |
| API | `backend/app/api/router.py` registers routes. `api/routes/individual.py` owns `/api/individual/*`; other route modules serve delivery, legacy performance, and administration. |
| Delivery | `services/delivery.py`, `services/templates.py`, and project/task/workflow routes. |
| Legacy scoring | `services/scoring.py` is a pure engine; `services/evaluation.py` assembles legacy evaluations. |
| Sales scoring | `services/sales_scoring.py` is a separate pure engine. `services/individual.py` handles pilot population, evaluators, scorecards, snapshots, and redaction. |
| Check-in Excel | `services/checkin_excel.py` builds/parses workbooks. Individual routes match records and apply the same mutation helpers used by the person page. |
| Imports/demo | `seed/workbook.py` imports corrected data; `seed/demo.py` adds delivery illustrations; `seed/sales.py` provisions/imports the pilot and opens/carries months; `seed/individual_demo.py` manages removable illustrations; `seed/platform.py` provisions platform accounts. |
| Frontend entry | `frontend/src/main.tsx`, `App.tsx`: React providers and current route definitions. |
| API/session | `src/api/client.ts`, `api/types.ts`, `auth/AuthContext.tsx`: requests/errors, shared types, named-account session and query-cache clearing. |
| Navigation | `components/layout/AppShell.tsx`, `SearchDialog.tsx`, `lib/tier.ts`, `lib/month.ts`: tier-aware shell/search and shared month selection. |
| Individual pages | `pages/individual/`: Team roster/person marking, read-only Performance/scorecard, Home, Rewards, Reports, Admin KPI Scoring; `shared.tsx` and `marking.tsx` hold shared UI/types/marking behavior. |
| Shared UI/styles | `components/ui/index.tsx`, `components/ui/charts.tsx`, `styles/tokens.css`, `styles/app.css`. Reuse before adding another component or style system. |
| Tests | `backend/tests/`: pure scoring vectors, access/API invariants, monthly lifecycle, marking, workbook flow, and demo lifecycle. |

Backend: Python 3.12, FastAPI, SQLAlchemy 2, Pydantic 2, PyJWT, openpyxl, SQLite by default, PostgreSQL through psycopg 3. Frontend: React 18, strict TypeScript, Vite 5, React Router 6, TanStack Query 5, lucide-react, plain CSS. There is no frontend test runner or lint script configured.

Individual Tier models (`ScoringRule`, `KpiMonth`, `KpiType`, `KpiItem`, `TrainingModule`, `MonthlyEvaluation`, `ScorecardSnapshot`, corrections and monthly nominations) are separate from legacy `Period` / `RuleVersion` / `Snapshot` models. Preserve that separation.

## Local commands and environment

Run backend commands from `backend/` and frontend commands from `frontend/`. Existing local dependency directories may already be available.

```bash
# Backend: initial installation
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt

# Backend: development server and checks
.venv/bin/uvicorn app.main:app --reload --port 8000
.venv/bin/python -m pytest -q

# Examples of focused checks
.venv/bin/python -m pytest -q tests/test_sales_scoring.py
.venv/bin/python -m pytest -q tests/test_individual_api.py tests/test_month_flow.py tests/test_marking_flow.py tests/test_individual_excel.py
```

```bash
cd frontend
npm install
npm run dev
npm run typecheck
npm run build
```

Vite serves on `http://localhost:5173` and proxies `/api` to `http://127.0.0.1:8000`. `@/` resolves to `frontend/src/`. `npm run build` runs TypeScript checking and a production Vite build. Use existing scripts; do not assume `npm test` or `npm run lint` exists.

- `backend/.env.example` documents overrides; settings load `backend/.env`. Most settings use `ORGTRACK_`; the DB also accepts `DATABASE_URL`. PostgreSQL URLs are normalized to `postgresql+psycopg://`.
- Default development DB is `backend/orgtrack.db`; evidence is in `backend/uploads/`. Keep DBs, uploads, secrets, and generated output out of commits.
- `frontend/.env.example`: `VITE_API_URL` is the **backend origin without `/api`**. Leave it unset/empty for local proxying; changing a deployed value requires rebuilding the frontend.
- Workbook paths prefer `backend/seed_data/`, falling back to project-root copies. Overrides are `ORGTRACK_SEED_WORKBOOK` and `ORGTRACK_SALES_TRACKER`.
- **Destructive seed:** `.venv/bin/python -m app.seed` drops and recreates all application tables in the configured DB, including SQLite. Use only for an intentional disposable reset, never as a routine startup/check. Non-SQLite targets additionally require `--yes-wipe-database`.
- Startup calls `create_all`, a limited additive schema patch, and idempotent account/pilot setup. Empty-database auto-seeding requires `ORGTRACK_AUTO_SEED=true`. There is no Alembic; `core/schema_patch.py` handles only supported added columns, not arbitrary migrations.

## Access and data invariants

- Accounts are named and linked to an employee; there is no employee self-service login or shared/team account. Delivery supports Admin, HOD, Manager, Team Lead. The Sales pilot provisions only Admin/HOD/Manager access; Team Leads and executives have no pilot login.
- Use `Ctx` / `Scope` on the server. Work access and private performance access are distinct. Project membership or a temporary project grant must never confer access to unrelated private scores.
- Pilot population is Sales employees excluding department heads. Viewer access is that population intersected with `Scope.perf_people`; Managers do not see their own private row.
- Check authorization for lists, totals, charts, search, direct IDs, downloads, evidence, exports, and mutation paths. Frontend role checks are supplementary.
- Employee code/ID is the stable identity. Show designation/department alongside ambiguous names; preserve IDs across renames/transfers. Do not silently merge people by name.
- Acceptance, validation, verification, and approval require independence. Keep actor/recorder/submitter conflicts enforced server-side, including Admin paths.
- Audit history is append-only, including for Admin. Use `services/audit.py:record` with relevant old/new values and reasons. Preserve source and illustrative flags.
- Missing/unavailable metrics are not fabricated zeros. Distinguish missing, confirmed N/A, genuine zero, and insufficient data.
- Proposed policies/defaults remain visibly proposed until their appropriate approval workflow completes. Do not describe a demo default as confirmed company policy.

## Individual Tier workflow

1. Months open automatically through `seed/sales.py:open_due_months` at startup and on `/individual/context`, up to the current India-time month. This is request/startup-driven, not a background scheduler. Carry-over runs once per month from each person's latest data: targets/duties copy, individual achieved values reset to 0, team values remain blank, removed rows stay removed.
2. **Team is the marking workspace.** `/individual/team/:person?month=...` contains KPIs/duties, weighted ratings, training, and Save/Submit/Approve/Return. Avoid tabs inside tabs. Bulk workbook marking lives on Team too.
3. The evaluator is the first active Manager/HOD account up the reporting chain. Only that evaluator or an Admin may edit, subject to self-edit/state/lock checks. A HOD cannot edit a Manager's people simply because they can view the department.
4. Check-ins use `Draft → Submitted → Approved | Returned`. Returned records are editable. Required weighted ratings block submission; other readiness gaps have their configured warnings. The approver differs from the author/submitter; HOD-written evaluations go to an Admin. Independent approval verifies eligible training completions.
5. **Performance and person scorecards are read-only.** The HOD/Admin closes a month through the lock flow. Every evaluation needs approval or an explicit reason to close without it; unapproved people freeze as `not_evaluated`.
6. Locked snapshots preserve inputs, rule version, and results. A correction reopens only one person's closed month after a different Admin approves the request; subsequent approval re-freezes it, retaining old/new results and history.
7. Nominations require a closed month and a citation of at least 50 words. HOD/Admin decisions are independent of the nominator and nominee. Publication is explicit.

`Locked` is the stored month state; UI copy says **closed**. `MonthlyEvaluation` is the monthly **check-in** in the pilot, not an additional parallel workflow.

Month selection is shared through `lib/month.ts` / `useMonth` in `pages/individual/shared.tsx`, persisted per tab and mirrored in `?month=`. Tier follows the URL. Keep month and tier consistent across navigation, queries, drawers, exports, and invalidation.

### KPI, duty, training, and score rules

- Individual numeric KPI rows start/reset to achieved 0 in open months, including import/new/carry-over/clear paths. Startup backfills open months without changing locked snapshots. A blank team KPI uses the matching reportees' sum only when all required actuals are available; an explicit team value takes precedence.
- **KPI average %** averages achieved ÷ target × 100 over eligible numeric KPI rows, each capped at 150%. Result is Under achieved (<100%), Achieved (=100%), Over achieved (>100%). KPI rows are **Not timed**; reject outcome, completion-date, and delay-reason edits on them. Historical imported outcomes stay stored but are ignored by live KPI timing.
- Only duty tasks feed on-time/delayed counts and delay penalties. No recorded outcome stays Open/No outcome rather than becoming an automatic delay. Validated delays are excluded under the configured policy; changed outcomes/completion clear relevant validation.
- Month-end is the default effective due date. An optional earlier due date must lie within the month. Reject future completion dates. On-time needs the configured minimum outcomes (default 3).
- Sales Core Revenue weights: Achievement 30, CSAT 15, On-time 25, Quality 20, Training 10. Category definitions live in `DEFAULT_SALES_CONFIG`; show/require only ratings weighted in the person's category.
- Quality/CSAT and other applicable ratings are 1–5 × 20. Achievement and on-time use configured interpolation curves, not a direct raw-percentage score.
- TWCS averages credit for eligible modules due in the month: 100 on time, 75 for 1–7 days late, 50 for 8–14, 25 thereafter, 0 if incomplete by cutoff. Default cutoff is the 5th of the next month (proposed). Independent verification matters, especially at lock. Confirmed no training due is N/A. A manually entered TWCS (0–100) overrides module-derived TWCS.
- Base is the weighted average over available metrics; coverage below the default 70% yields insufficient data. Default final is `max(0, base - 2 × delayed duty cases - 2 when scored TWCS < 50)`. Thresholds/penalties are versioned config. Default proposed tiers: Gold ≥90, Silver ≥80, Bronze ≥70, using **unrounded** values; display final scores to two decimals.
- **Scoring method is Admin-only.** Use `method_visible` / `redact_card` in `services/individual.py`; do not leak weights, metric scores/contributions, coverage, base, penalties, or thresholds via alternate payloads, reports, or exports to HOD/Managers. They can see inputs, final score, tier, and status.
- KPI rule management/impact is Admin-only and requires a **different Admin** to approve a rule version. Do not apply the older Project Tier HOD approval rule here.
- KEKA is a manual CSV export, not a live integration. There are no implemented live HRMS/LMS/CRM integrations to claim.

### Monthly workbook contract

`GET /api/individual/months/{id}/checkin-template.xlsx` exports Check-ins, KPIs, Duty tasks, Training, and How to use. `POST .../checkin-upload?dry_run=...` previews/applies; an older single-sheet R&R upload remains supported.

- Match by employee code plus row ID where applicable; hidden versions detect stale edits. Preserve this identity/concurrency contract.
- Blank upload cells mean **unchanged**. Clear values through the person page. Derived counts, KPI average, and computed spreadsheet columns are not user-entered authoritative values.
- Dry run saves nothing: changes are exercised and rolled back. Apply uses `_apply_evaluation`, `_apply_item_patch`, and `_apply_module_patch` with the same scope, evaluator, state, date, version, audit, and lock checks as the person page.
- Keep per-row old/new previews and errors, partial success, and audit provenance (file/sheet/row). Spreadsheet protection is a convenience; the server enforces permissions.

## Project Tier rules to preserve

- Priority is mandatory High/Medium/Low, with **no default**. Timing and health are derived; Delayed is not a stored project/task status.
- Hierarchy: Project → optional Milestone → Task → Assignment. Exactly one Owner, unique assignees, shares totaling 100%, independent reviewer who is not an assignee.
- Reported progress is distinct from accepted completion. Only reviewer acceptance completes a task. Sending for review creates an immutable submission version with checklist/evidence checks.
- On-time scoring uses the **submission date of the accepted version**, not the later acceptance timestamp. Rework does not automatically extend deadlines.
- Blocker exclusions/deadline changes require independent validation; resource blockers require HOD authority. Keep original dates and validation history.
- High-priority project closure requires HOD approval and readiness checks. Completing a milestone does not accept its tasks.
- Workflow templates resolve generic RACI roles to named people before activation. Preserve dependency, SLA/business-calendar, evidence, and reviewer checks.
- Legacy scoring/training/reward rules remain in their own services/models and tests; do not replace them wholesale with Sales rules.

## UI and implementation conventions

- Reuse the API client, TanStack Query, existing typed payloads, shared components, and CSS tokens. Coordinate backend response changes with `api/types.ts` and Individual Tier shared types; invalidate affected queries after mutations.
- Use structured `RuleViolation`, `Forbidden`, `NotFound`, and `Conflict` errors. Keep optimistic versions/current-record responses where supported; never silently overwrite stale edits. Reuse common mutation helpers for bulk/alternate entry paths.
- Keep scoring engines pure and deterministic. Put authorization, ORM assembly, lifecycle, and audit in their existing service/route layers.
- Use `core/clock.py` (`today_ist`, `now_ist`, `month_last_day`) for business time. Timestamps follow the existing naive-IST convention. Avoid server-local/UTC date assumptions for deadlines, monthly boundaries, and cutoffs.
- Use existing `lib/format.ts` helpers: dates like `09 Oct 2026`, Indian digit grouping and rupee formats. Keep full scoring precision internally.
- Current design: evergreen primary actions, charcoal sidebar, restrained gold navigation/tier accents; IBM Plex Sans text and Condensed figures; light and dark tokens. Reuse `frontend/public/finvasia-*.svg`; do not redraw the logo.
- Prefer the existing figures strip, month rail, tables, drawers, numbered marking sections, and sticky action bars. Keep action labels explicit (e.g. Add task), sentence case, status words alongside color, and one primary action per context.
- Preserve loading/empty/unavailable/error states, drafts after validation/network failure, per-row save results, conflict handling, closed/permission states, keyboard/focus behavior, and responsive navigation. Do not render unavailable values as 0.

## Data, deployment, and verification

- Corrected workbook baseline: 317 employees, 5 vacant positions, 17 departments, 60 projects, 109 tasks / 175 assignments. Treat these as source baseline counts, not permanent application totals.
- Preserve source defects as flags (missing priorities, ambiguous names, duplicate Owners, invalid shares). Never silently repair imported data to make validation pass. Org-chart SmartArt is already represented in corrected Employee_Master; hidden historical departments are not new imports.
- The two bundled seed workbooks contain real employee data and are explicit `.gitignore` exceptions; keep the repository private and avoid copying personnel data into logs, fixtures, generated documentation, or external services unnecessarily.
- Individual demo data is deterministic, labeled `illustrative`, removable, and must not overwrite real entries. It defaults on outside production; clearing it records a marker that suppresses automatic reloading. `test_zz_demo_data.py` intentionally runs last.
- `render.yaml` configures the backend; `frontend/vercel.json` configures Vercel and SPA rewrites. The free Render SQLite configuration is ephemeral. Startup seed behavior does not preserve user changes; use a persistent DB for durable data. Do not deploy or change hosting as an incidental code/documentation step.
- Current login is development/demo JWT sign-in for provisioned accounts (also supports demo role selection), optionally protected by a shared access code. It is not company SSO. Production requires a proper secret; replacing demo login with company authentication remains separate work.
- Start with `git status --short` and preserve existing local changes. Keep changes scoped; avoid generated files, dependency churn, and unrelated refactors.
- For backend behavior changes, run relevant tests, then the full suite when lifecycle/scoring/access or shared fixtures are affected. Tests use a temporary DB and uploads by default. **`ORGTRACK_TEST_DATABASE_URL` is destructive:** the session fixture drops/recreates its tables; point it only at a disposable test DB, never a real environment.
- Tests share a session-seeded database and some flows change it. Keep that ordering/state in mind when interpreting individual failures; do not change business rules simply to satisfy stale assertions.
- For frontend changes, run `npm run build` (or typecheck during iteration) and inspect affected role/month/theme/responsive states when relevant. No automated frontend UI suite is configured.
- Never rely on old documentation's fixed test count. Report commands actually run, results, and any unverified behavior. For documentation-only changes, check paths/commands and the final diff; application tests are not inherently required.
- Update this guide and relevant project docs when architecture, workflows, policy status, or development commands change. Keep newer decisions explicit so future agents do not revive superseded behavior.
