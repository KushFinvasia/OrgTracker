# Finvasia Elevate

Formerly Orgtrack (renamed 15 Oct 2026). Internal identifiers keep the old name: `ORGTRACK_*` environment variables, browser storage keys and the `orgtrack-api` Render service.

Internal Finvasia / Shoonya platform for **project delivery** and **employee performance, training and Rewards & Recognition**.
React (Vite + TypeScript) frontend and FastAPI backend. The UI follows `Orgtrack_Premium_SaaS_Redesign.pdf`; business rules follow `Orgtrack_Complete_New_Chat_Prompt.docx` (summarised in `CLAUDE.md`).

## Layout 

```
Org Tracker/
├── backend/                 FastAPI + SQLAlchemy (SQLite in dev, Postgres-ready via ORGTRACK_DATABASE_URL)
│   ├── app/
│   │   ├── core/            config, database, JWT, error types
│   │   ├── models/          org, access/audit, project, task, workflow, training, performance/rewards
│   │   ├── schemas/         request bodies
│   │   ├── services/        scoring engine (pure), scope enforcement, evaluation, delivery, templates, audit
│   │   ├── api/routes/      auth, home, people, projects, tasks, training, performance, rewards, reports, admin, rules, workflows
│   │   └── seed/            corrected-workbook import + illustrative demo layer
│   └── tests/               scoring worked examples, business rules, API invariants
├── frontend/                React 18 + TypeScript + React Router + TanStack Query
│   └── src/
│       ├── api/             fetch client and types
│       ├── auth/            named-account session
│       ├── components/      app shell, UI kit, charts, task and training drawers
│       ├── pages/           the 14 screens (home, projects, tasks, team, people, performance, rewards, reports, admin)
│       ├── lib/             formatting (09 Oct 2026, IST, en-IN), status tones, hooks
│       └── styles/          Shoonya design tokens and components
├── CLAUDE.md                project context for Claude Code
└── *.pdf / *.docx / *.xlsx  source design, handoff and data files
```

## Run locally

Backend (Python 3.12):

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m app.seed          # reset dev DB, import PT_RR_Corrected_Data.xlsx + demo layer
.venv/bin/uvicorn app.main:app --reload --port 8000
.venv/bin/python -m pytest -q         # 94 tests (ORGTRACK_TEST_DATABASE_URL=... runs them on Postgres)
```

Frontend (Node 22):

```bash
cd frontend
npm install
npm run dev                           # http://localhost:5173 (proxies /api to :8000)
npm run build                         # type-check + production build
```

## Deploy: Render (backend, SQLite) and Vercel (frontend)

**1. Render (backend).** Push the repo, then Render dashboard > **New > Blueprint** and pick it. `render.yaml` creates one
Python web service from `backend/` with a **local SQLite database** (no Postgres). When prompted, set:
- `ORGTRACK_CORS_ORIGINS` = your Vercel URL, e.g. `https://orgtrack.vercel.app` (exact origin, no trailing slash).
- `ORGTRACK_DEMO_ACCESS_CODE` = a shared code for sign-in. **Set this**: the seeded data names real employees.
- `ORGTRACK_CORS_ORIGIN_REGEX` (optional) for preview URLs, e.g. `https://orgtrack-.*\.vercel\.app`.

`ORGTRACK_JWT_SECRET` is generated. `ORGTRACK_AUTO_SEED=true` loads `backend/seed_data/PT_RR_Corrected_Data.xlsx`
plus the demo layer whenever the database is empty, so no manual seeding is needed.
`ORGTRACK_INDIVIDUAL_DEMO=true` also loads the Individual Tier demo months (Jul–Oct 2026, labelled illustrative). It is off by
default when `ORGTRACK_ENVIRONMENT=production`, so the demo site needs it.

**2. Vercel (frontend).** New Project > import the repo > **Root Directory `frontend`**. Add `VITE_API_URL` = your Render
service URL, e.g. `https://orgtrack-api.onrender.com` (no `/api`). Redeploy after changing it.

**Important: SQLite on Render's free plan is temporary.** The disk is wiped on every deploy, restart and idle spin-down
(about 15 minutes without traffic). The demo data comes back automatically, but anything created or changed in the app
(tasks, reviews, check-ins, locks, nominations, uploads) is lost. For data that must persist, either attach a Render
persistent disk (paid plan) and point `ORGTRACK_DATABASE_URL` at it, or use Postgres (set `DATABASE_URL`; the code supports it).

Other notes: the free service sleeps when idle and the first request takes up to about a minute. Dev sign-in plus a shared
access code is a demo safeguard, not production authentication.

## Two tiers

The **Finvasia** dropdown at the top of the sidebar switches between:
- **Project Tier** (`/home`, `/projects`, `/tasks`): the delivery build below.
- **Individual Tier** (`/individual/...`): the Sales pilot. It has Home, Team, Performance (targets and actuals, outcomes and delays, TWCS training, evaluations, month close), Rewards, Reports and, for Admin only, KPI Scoring.
  On first start it imports `backend/seed_data/Project Tracker Sales (Shoonya).xlsx` (Sep 2026) and provisions the Sales logins:
  Gurjot Singh (HOD, `gurjot.singh@shoonya.com`) and Managers Amit Kumar, Rajesh Kumar, Anju Kumari, Durga Paswan and Keshav Khullar (`firstname.lastname@shoonya.com`, decision D1).
  Team Leads and executives have no login. See CLAUDE.md §21.

## Sign-in

There is no employee or shared login. In development, the sign-in page lists the **demo-provisioned** named accounts
(Admin, two HODs, two Managers, one Team Lead). Production must replace dev sign-in with company SSO
(`ORGTRACK_DEV_LOGIN_ENABLED=false`).

| Role | Demo account | Why |
|---|---|---|
| Admin | Balneet Birah (VP-HR) | Organisation data, imports, rule drafts |
| HOD | Kapil Abrol (Client Support) | Department decisions; independent policy approver |
| HOD | Pawan Kumar (Demat, Operations & BO, Compliance) | Multi-department head; validator of demo inputs |
| Manager | Pradeep Thakur (Product) | Reporting tree Sachin, Maninder, Harsh (the PDF cast) |
| Manager | Sahil Sharma (Client Support) | Second manager scope |
| Team Lead | First proposed Team Lead in Client Support | Work updates without private scores |
| Admin | Kushagra Kataria (`kushagra.kataria@shoonya.com`) | Platform administrator; not in the org chart, so a separate flagged employee record (`app/seed/platform.py`) |

These are demo choices, not confirmed provisioning. The workbook proposes Pradeep as Team Lead; he is a Manager here so the performance flows can be demonstrated.

## Data

- `PT_RR_Corrected_Data.xlsx` is imported as-is: 317 employees, 5 vacant positions, 17 departments, 60 projects (25 missing priority), 109 tasks / 175 assignments, the Email campaign template and 12 template risks. Source defects (two Owners, shares ≠ 100%, unresolved names) are imported **with flags**, never silently fixed.
- The demo layer (project `PRJ-D01`, training catalog, check-ins, targets, an incident, a recognition cycle) is labelled **illustrative** in the UI.
- Proposed policies stay proposed: the 90/10 training blend is `Pending approval`, reward tiers are `Draft`. Locking the Jul-Sep 2026 period is blocked until a second person approves the training policy (try it as HOD Kapil Abrol in Rules studio > Approvals).

## Demo walkthrough

1. **Manager (Pradeep)**: Home action inbox → review `Review onboarding screens` (Accept uses the 08 Oct submission date) → validate the pending blocker → weekly update grid → Sachin's training (verify needs the HR verifier) → evaluation with base KPI, training ledger and combined score.
2. **HOD (Kapil)**: Rules studio > Approvals → approve training policy v3 (author was Admin).
3. **Admin (Balneet)**: Performance → Review period lock → lock Jul-Sep 2026 → Rewards → open nominations.
4. **Manager**: nominate from Eligibility (≥50-word citation, independent reviewer) → **HOD** approves → **Admin/HOD** publishes.
