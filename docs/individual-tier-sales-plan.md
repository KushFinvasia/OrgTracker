# Individual Tier: Sales pilot implementation plan

Revised 15 Oct 2026. Status: approved direction, build not started. The formatted version is
`Orgtrack_Individual_Tier_Sales_Plan.pdf` in the project root (not in git).

## 1. Scope
- The app is split into a **Project Tier** and an **Individual Tier**, switched from the "Finvasia" dropdown at the top of the sidebar.
  - Project Tier: Home, Projects, Tasks. Kept as built; no new work.
  - Individual Tier: Home, Team, Performance, Rewards, Reports, **KPI Scoring** (Admin only). **Built first.**
- Pilot covers **only the Sales team** (37 people in `Employee_Master`, head Gurjot Singh EMP-0265).
- For Sales, **the tasks in `Project Tracker Sales (Shoonya).xlsx` are the KPIs**: each row is a monthly target for one person, with an achieved number.
- Periods are **monthly** (Sep 2026 imported, Oct 2026 open).

## 2. Logins and approval
Only **Manager, HOD and Admin** log in (7 accounts). Team Leads and executives have no login.

| Role | People | Does |
|---|---|---|
| Admin | Kushagra Kataria (EMP-0324) | Everything, incl. KPI Scoring; approves evaluations the HOD writes |
| HOD | Gurjot Singh (EMP-0265) | Sees all Sales; approves or returns Manager evaluations; locks the month |
| Manager | Amit Kumar (0266), Rajesh Kumar (0280), Anju Kumari (0295), Durga Paswan (0298), Keshav Khullar (0293) | Evaluates their reporting tree: targets, actuals, ratings, submit |

| Evaluator | Evaluates | Count |
|---|---|---|
| Amit | TLs Parmodh, Amanpreet, Shubham + their teams | 13 |
| Rajesh | TLs Sakshi, Anshul + their teams | 12 |
| Anju | Sunaina Joshi, Neha Solanki | 2 |
| Durga | Deepak Moraina | 1 |
| Keshav | Kunal Sethi | 1 |
| Gurjot (HOD) | The 5 Managers + Dipanshu Gupta, Pratham Arora (approved by Admin, proposed) | 7 |

Flow per month: Manager sets targets → enters actuals → records training → completes evaluation (Quality, CSAT, delay reasons) and **submits** →
HOD **verifies training and approves or returns with reason** → HOD **locks** the month (scores frozen; later changes need a recorded correction).
No one approves their own evaluation. Every change goes to the audit log.

## 3. KPIs from the Sales tracker
- 108 numeric target rows (sheet *Project & Task Tracker*) and 38 duty rows (*Extra Tasks*), all Sep 2026.
- KPI types: call volume (per-day × 22 = monthly), client interaction (connected calls), account openings, funded clients,
  funds added (₹; text like "2 cr", "10 lacs" converted to rupees), account reactivation, zero-funded clients, conversion %,
  and team versions for Managers (calculated as the sum of their reportees).
- Extra Tasks (audits, Jira, meetings, testing, reception, TAT) have deadlines but no numbers: they feed **On-time and delays**, not Achievement.
- Import keeps every row; problems are flagged. Name matches to confirm: "Gurjot Sodhi" = Gurjot Singh, "Shivani Sharma" = Shivani (EMP-0274),
  "Shivani. D" = Shivani Dhiman (EMP-0275), "Upasana" = Upasna (EMP-0288). No tracker rows for Shweta Jadhav, Keshav Khullar,
  Kunal Sethi, Sunaina Joshi, Dipanshu Gupta, Pratham Arora ("No targets set").
- The tracker's *Rewards & Recognition* points sheet (two different formulas, typed bonus points) is retired.

## 4. Scoring (R&R parameters of 15 Oct 2026, with Training 10%)
| Category | Teams | Achievement | CSAT | On-time | Quality | Compliance | Collab. & automation | Innovation | Training | Penalty |
|---|---|---|---|---|---|---|---|---|---|---|
| **Core Revenue** (pilot) | CS, Sales, DM | 30 | 15 | 25 | 20 | – | – | – | **10** | −2 per delay |
| Revenue-Enabling | Product, UI/UX, Compliance, Back Office, Demat, DP | 20 | – | 25 | 20 | 15 | 10 | – | **10** | −2 per delay |
| Support | HR, Finance, IT | – | – | 25 | 20 | 10 | 15 | 20 | **10** | −2 per delay |

Training's 10% comes from: Core Revenue CSAT 25 → 15; Revenue-Enabling Achievement 25 → 20 and On-time 30 → 25; Support Collaboration 25 → 15.
Training is inside the category weights, so the earlier "base × 90% + training × 10%" blend is **dropped** (training counted once).

- **Achievement:** per row achieved ÷ target × 100, capped at 150%; person's % = average of rows that have an actual.
  Score on the existing curve 0→0, 60→40, 80→60, 100→90, 150→100.
- **On-time:** on-time ÷ (on-time + delayed) over tracker rows and Extra Tasks; curve 45→0, 75→60, 85→80, 95→100.
- **CSAT, Quality** (and later Compliance, Collaboration, Innovation): rating 1–5 × 20.
- **Training** = verified completions ÷ courses due in the month × 100 (score = that %).
  - Manager assigns courses and records progress/completion on the person's behalf; a completion counts only once **verified by someone other than the recorder** (pilot: the HOD, while approving the month). 100% recorded but unverified doesn't count.
  - Counts in a month: assignments whose due date falls in that month; future-due wait; approved exemptions/cancellations excluded with history. Courses count equally; retakes are attempts on the same assignment.
  - Confirmed nothing due → **N/A** (10% drops out). Due but none verified → **0%**. Team % = total verified ÷ total due.
- **Base** = Σ(score × weight) ÷ Σ(weights with data). **Coverage** < 70% → Insufficient data. Missing data is never zero.
- **Final** = max(0, base − 2 × delayed cases). Validated delays excluded from penalty and On-time (proposed).
- **Tiers** (proposed): Gold ≥ 90, Silver ≥ 80, Bronze ≥ 70 on the unrounded final.

Test vectors: rows 4000/4180, 1900/1881, 380/410 → 95.69%, 101.01%, 92.68% → average 96.46% → score 84.69.
With CSAT 4 (15%), On-time 3/3, Quality 4, Training 3 of 4 verified (75%): contributions 25.41 + 12.00 + 25.00 + 16.00 + 7.50 = base **85.91**; one delay → **83.91** (Silver).
Without CSAT: 86.95 at 85% coverage. No training due: 87.12 at 90% coverage.
Kulwinder 4000/4400 = 90.91% → 76.36.

## 5. Screens (Individual Tier)
| Screen | Pilot content |
|---|---|
| Home | Manager: actuals to enter, evaluations to complete or returned, people below target, overdue Extra Tasks. HOD: approvals waiting, month-lock status |
| Team | Sales roster and hierarchy with month-to-date Achievement % |
| Performance | Monthly target-and-actuals grid (person × KPI, quick entry, per-row save), Training tab (assign, record, HOD verifies), monthly evaluation (Quality, CSAT), scorecard with full calculation, HOD approval, month lock |
| Rewards | Monthly tiers from locked scores, eligibility, nominations, publishing |
| Reports | Target vs achieved by person/team/KPI type, monthly trend, on-time and delays, data gaps, scoped CSV export |
| KPI Scoring (Admin) | KPI catalogue, category weights, curves, penalty on/off, coverage, tiers, impact preview, effective month; locked months keep their rules |

## 6. Data model additions
KPI type · monthly KPI target (person, month, type, target, achieved, source, entered by, approved by) · duty task (Extra Task, with target/completed date, status, delay reason, validated) ·
training (reused: course catalogue, assignments, verification, exemptions) · monthly evaluation (ratings, state Draft → Submitted → Approved/Returned, evaluator, approver) · scoring rule version (weights, curves, penalty, coverage, tiers, effective month) ·
monthly scorecard snapshot (frozen on lock). Reused: accounts, server-side scope, audit, rewards/nominations, reports/export.

## 7. Build order
1. Tier switch and the two side navs; KPI Scoring Admin-only.
2. Sales logins (7) and scope; Managers limited to their reporting tree; Sales-only data.
3. KPI model and importer for the Sales tracker (targets, actuals, Extra Tasks, name mapping, flags).
4. Scoring engine for the new parameters, including Training 10%, with tests using the vectors in §4.
5. Performance grid, Training tab (assign, record, HOD verifies), monthly evaluation, scorecard; HOD approval; month lock.
6. KPI Scoring admin page with impact preview.
7. Home, Team, Reports, Rewards adapted to Sales KPIs.
8. Deploy (Render + Vercel) and browser checks.

## 8. Open decisions (defaults apply until answered)
| # | Decision | Default |
|---|---|---|
| D1 | Login emails | firstname.lastname@shoonya.com |
| D2 | Approver for evaluations the HOD writes (5 Managers + 2 analysts) | Admin approves |
| D3 | CSAT source for Sales | Manager enters in evaluation |
| D4 | Keep −2 per delay on top of On-time | Keep |
| D5 | Exclude validated delays | Yes |
| D6 | Tiers | 90 / 80 / 70 |
| D7 | Name matches (§3) | As proposed |
| D8 | Who verifies training completions the Manager records | HOD, while approving the month |
| D9 | "Customer Experience" / "Pure Support" categories in the parameter header | Not used; CS in Core Revenue |
