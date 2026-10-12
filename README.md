# Orgtrack

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
.venv/bin/python -m pytest -q         # 36 tests
```

Frontend (Node 22):

```bash
cd frontend
npm install
npm run dev                           # http://localhost:5173 (proxies /api to :8000)
npm run build                         # type-check + production build
```

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
