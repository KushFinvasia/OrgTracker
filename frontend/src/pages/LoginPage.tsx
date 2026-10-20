import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { api, API_BASE, ApiError } from "@/api/client";
import type { Account } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { Logo } from "@/components/layout/AppShell";
import { Avatar, Button, Field } from "@/components/ui";
import { rememberTier, type Tier } from "@/lib/tier";

const DEMO_ROLES: { role: Account["role"]; label: string }[] = [
  { role: "manager", label: "Manager" },
  { role: "hod", label: "HOD" },
  { role: "admin", label: "Admin" },
  { role: "team_lead", label: "Team Lead" },
];

const CYCLE = ["Targets imported from the Sales tracker", "Manager enters actuals and ratings", "Check-in submitted", "HOD approves or returns with a reason", "Month closed, scorecards frozen"];

export function LoginPage() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [devAccounts, setDevAccounts] = useState<Account[]>([]);
  const [pick, setPick] = useState<Account | null>(null);
  const [codeRequired, setCodeRequired] = useState(false);
  const [code, setCode] = useState(() => {
    try {
      return sessionStorage.getItem("orgtrack.accessCode") ?? "";
    } catch {
      return "";
    }
  });
  const [serverDown, setServerDown] = useState(false);
  const [devLogin, setDevLogin] = useState(true);
  // Why the demo account list is (not) showing, so a hidden list is never a mystery.
  const [listState, setListState] = useState<"need_code" | "loading" | "ok" | "wrong_code" | "empty" | "unreachable">("loading");

  useEffect(() => {
    api
      .get<{ dev_login: boolean; access_code_required: boolean }>("/auth/config")
      .then((c) => {
        setServerDown(false);
        setDevLogin(c.dev_login);
        setCodeRequired(c.access_code_required);
      })
      .catch(() => setServerDown(true));
  }, []);

  useEffect(() => {
    if (serverDown) return setListState("unreachable");
    if (codeRequired && !code) {
      setDevAccounts([]);
      return setListState("need_code");
    }
    setListState("loading");
    const t = setTimeout(() => {
      api
        .get<Account[]>("/auth/dev-accounts", code ? { "X-Access-Code": code } : undefined)
        .then((rows) => {
          setDevAccounts(rows);
          setListState(rows.length ? "ok" : "empty");
        })
        .catch((e) => {
          setDevAccounts([]);
          setListState(e instanceof ApiError && e.status === 401 ? "wrong_code" : "unreachable");
        });
    }, 300);
    return () => clearTimeout(t);
  }, [code, codeRequired, serverDown]);

  const [devError, setDevError] = useState<string | null>(null);

  const submit = async (value: string | null = email, demoRole?: Account["role"], tier?: Tier, fromList = false) => {
    if (tier) rememberTier(tier);
    setBusy(true);
    setError(null);
    setDevError(null);
    try {
      await signIn(value, code, demoRole);
      try {
        sessionStorage.setItem("orgtrack.accessCode", code);
      } catch {
        /* ignore */
      }
      navigate("/", { replace: true }); // the router sends the account to its starting tier
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Sign-in failed.";
      // Errors show next to what was used: the email box, or the development account list.
      if (demoRole || fromList) setDevError(msg);
      else setError(msg);
    } finally {
      setBusy(false);
    }
  };

  const pilotAccounts = devAccounts.filter((a) => a.in_pilot);
  const otherAccounts = devAccounts.filter((a) => !a.in_pilot);
  const accountGroup = (title: string, list: Account[]) =>
    list.length > 0 && (
      <div style={{ marginTop: 20 }}>
        <div className="small muted">{title}</div>
        <div className="acct-list" role="radiogroup" aria-label={title}>
          {list.map((a) => (
            <button type="button" key={a.id} className="acct" role="radio" aria-checked={pick?.id === a.id} aria-pressed={pick?.id === a.id} onClick={() => setPick(a)} onDoubleClick={() => void submit(a.email, undefined, a.in_pilot ? "individual" : "project", true)}>
              <Avatar person={a.employee} />
              <span className="grow">
                <b>{a.employee.name}</b>
                <span>
                  {a.role_label}, {a.headed_departments.length ? `head of ${a.headed_departments.join(", ")}` : a.employee.designation ?? a.employee.department ?? "Organisation"}
                </span>
              </span>
              {pick?.id === a.id && <Check size={16} aria-hidden="true" />}
            </button>
          ))}
        </div>
      </div>
    );

  return (
    <div className="signin">
      <section className="signin-l">
        <div className="signin-logo"><Logo variant="dark" /></div>
        <div className="cycle-art" aria-hidden="true">
          {CYCLE.map((s, i) => (
            <div className="cy" key={s} style={{ animationDelay: `${200 + i * 110}ms` }}>
              <i>{i + 1}</i>
              {s}
            </div>
          ))}
        </div>
        <h1>Projects are the unit of work. Employees are the unit of performance.</h1>
        <p>Plan and review project delivery, and close each month's Sales performance with an approved, auditable scorecard.</p>
      </section>

      <section className="signin-r">
        <h1 style={{ fontSize: 24 }}>Sign in</h1>
        <p className="muted" style={{ marginTop: 6, maxWidth: "58ch" }}>
          Named accounts only: Admin, HOD and Manager, each linked to one employee record. There are no shared or employee logins. Company single sign-on is not connected yet.
        </p>
        {serverDown && (
          <div className="form-error" style={{ marginTop: 16 }}>
            <span>
              Cannot reach the server at <code>{API_BASE}</code>. Free hosting may take up to a minute to wake up; refresh shortly. If this persists, check VITE_API_URL (frontend) and
              ORGTRACK_CORS_ORIGINS (backend).
            </span>
          </div>
        )}
        <form
          className="row"
          style={{ alignItems: "flex-end", marginTop: 20, gap: 10 }}
          onSubmit={(e) => {
            e.preventDefault();
            setPick(null);
            void submit();
          }}
        >
          <div style={{ flex: "1 1 260px", maxWidth: 360 }}>
            <Field label="Company email" error={error}>
              <input className="input" type="email" placeholder="name@shoonya.com" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
            </Field>
          </div>
          <Button variant="primary" type="submit" disabled={busy || !email}>
            Continue
          </Button>
        </form>
        {codeRequired && (
          <div style={{ marginTop: 16, maxWidth: 320 }}>
            <Field label="Demo access code" required help="Shared code for this demo deployment. Company SSO replaces it in production.">
              <input className="input" type="password" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="current-password" placeholder="Required on shared demos" />
            </Field>
          </div>
        )}

        {devLogin && (
          <>
            <h2 style={{ fontSize: 15, marginTop: 28 }}>Development sign-in</h2>
            <p className="small muted" style={{ marginTop: 2 }}>Choose a provisioned account. Replace with company SSO before real use.</p>
            {accountGroup("Sales pilot accounts (Individual Tier)", pilotAccounts)}
            {accountGroup("Project Tier accounts", otherAccounts)}
            <p className="small muted" role="status" style={{ marginTop: 10 }}>
              {listState === "need_code" && "Enter the demo access code above to see the named accounts."}
              {listState === "loading" && "Loading accounts..."}
              {listState === "wrong_code" && "That access code is not correct."}
              {listState === "empty" && "No accounts are provisioned yet. The server may still be loading its data after a restart; refresh in a few seconds."}
              {listState === "unreachable" && "The server is unreachable, so development sign-in is unavailable right now."}
            </p>
            {devError && <div className="form-error" role="alert">{devError}</div>}
            <div className="row" style={{ marginTop: 18, gap: 10 }}>
              <Button variant="primary" size="lg" disabled={busy || !pick} busy={busy && !!pick} onClick={() => pick && void submit(pick.email, undefined, pick.in_pilot ? "individual" : "project", true)}>
                {pick ? `Continue as ${pick.employee.name}` : "Choose an account"}
              </Button>
            </div>
            <div style={{ marginTop: 22 }}>
              <div className="small muted">Project Tier demo by role</div>
              <div className="row" style={{ gap: 6, marginTop: 6 }}>
                {DEMO_ROLES.map((r) => (
                  <Button key={r.role} size="sm" disabled={busy || (codeRequired && !code)} onClick={() => void submit(null, r.role, "project")}>
                    {r.label}
                  </Button>
                ))}
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
