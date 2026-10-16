import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { api, API_BASE, ApiError } from "@/api/client";
import type { Account } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { Button, Field } from "@/components/ui";
import { rememberTier, type Tier } from "@/lib/tier";

const DEMO_ROLES: { role: Account["role"]; label: string }[] = [
  { role: "manager", label: "Manager" },
  { role: "hod", label: "HOD" },
  { role: "admin", label: "Admin" },
  { role: "team_lead", label: "Team Lead" },
];

const PILOT_ROLES: { role: Account["role"]; label: string }[] = [
  { role: "manager", label: "Manager" },
  { role: "hod", label: "HOD" },
  { role: "admin", label: "Admin" },
];

/** A Sales pilot account for the role; for Admin, prefer a real platform account over the demo-provisioned one. */
function pilotAccount(accounts: Account[], role: Account["role"]): Account | undefined {
  const inRole = accounts.filter((a) => a.role === role && a.in_pilot);
  return role === "admin" ? inRole.find((a) => !a.email.endsWith(".example")) ?? inRole[0] : inRole[0];
}

export function LoginPage() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [devAccounts, setDevAccounts] = useState<Account[]>([]);
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

  const submit = async (value: string | null = email, demoRole?: Account["role"], tier?: Tier) => {
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
      if (demoRole) setDevError(msg);
      else setError(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <div className="login-left">
        <div className="brand" style={{ color: "var(--ink)", padding: 0 }}>
          <img src="/logo-placeholder.svg" alt="" style={{ width: 44, height: 44 }} />
          Finvasia Elevate
        </div>
        <h1 style={{ fontSize: 34 }}>Welcome back</h1>
        <p className="muted">Sign in with your named company account.</p>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {serverDown && (
            <div className="form-error">
              Cannot reach the server at <code>{API_BASE}</code>. Free hosting may take up to a minute to wake up; refresh shortly. If this persists, check
              VITE_API_URL (frontend) and ORGTRACK_CORS_ORIGINS (backend).
            </div>
          )}
          <Field label="Company email" required error={error}>
            <input className="input" type="email" placeholder="name@finvasia.com" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
          </Field>
          {codeRequired && (
            <Field label="Demo access code" required help="Shared code for this demo deployment. Company SSO replaces it in production.">
              <input className="input" type="password" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="current-password" />
            </Field>
          )}
          <Button variant="primary" type="submit" disabled={busy || !email}>
            Continue with company sign-in
          </Button>
        </form>
        <p className="small muted">
          Admin, HOD and Manager accounts (and Team Leads outside the Sales pilot) are linked to one employee identity. Access follows your assigned role and reporting scope. No regular employee or shared team login.
          Need access? Contact your administrator.
        </p>
        {devLogin && (
          <div className="card" style={{ padding: 16 }}>
            <b>Development sign-in</b>
            <p className="small muted">One-click accounts from the seed data. Replace with company SSO before real use.</p>
            <b className="small">Individual Tier: Sales pilot (KPIs, training, evaluations, rewards)</b>
            <div className="row" style={{ gap: 8, margin: "8px 0 14px" }}>
              {PILOT_ROLES.map((r) => {
                const acc = pilotAccount(devAccounts, r.role);
                return (
                  <Button key={r.role} size="sm" variant="green" disabled={busy || !acc} title={acc ? `${acc.employee.name} / ${acc.email}` : undefined} onClick={() => acc && void submit(acc.email, undefined, "individual")}>
                    Sales {r.label}{acc ? `: ${acc.employee.name.split(" ")[0]}` : ""}
                  </Button>
                );
              })}
            </div>
            <b className="small">Project Tier demo (projects and tasks)</b>
            <div className="row" style={{ gap: 8, margin: "8px 0 10px" }}>
              {DEMO_ROLES.map((r) => (
                <Button key={r.role} size="sm" disabled={busy || (codeRequired && !code)} onClick={() => void submit(null, r.role, "project")}>
                  {r.label}
                </Button>
              ))}
            </div>
            {devError && <div className="form-error" role="alert">{devError}</div>}
            <p className="small muted" role="status">
              {listState === "need_code" && "Enter the demo access code above to enable these buttons and see the named accounts."}
              {listState === "loading" && "Loading demo accounts..."}
              {listState === "wrong_code" && "That access code is not correct."}
              {listState === "empty" && "No accounts are provisioned yet. The server may still be loading its data after a restart; refresh in a few seconds."}
              {listState === "unreachable" && "The server is unreachable, so demo sign-in is unavailable right now."}
            </p>
            {devAccounts.some((a) => a.in_pilot && a.role !== "admin") && (
              <div className="stack" style={{ gap: 6, marginBottom: 12 }}>
                <b className="small">Individual Tier: Sales pilot</b>
                {devAccounts.filter((a) => a.in_pilot && a.role !== "admin").map((a) => (
                  <button key={a.id} className="link-btn" style={{ textAlign: "left" }} onClick={() => void submit(a.email, undefined, "individual")} disabled={busy}>
                    {a.role_label}: {a.employee.name} <span className="muted">/ {a.employee.code} / {a.employee.designation}</span>
                  </button>
                ))}
              </div>
            )}
            {devAccounts.length > 0 && (
              <div className="stack" style={{ gap: 6 }}>
                <b className="small">Admins and Project Tier demo accounts</b>
                {devAccounts.filter((a) => !(a.in_pilot && a.role !== "admin")).map((a) => (
                  <button key={a.id} className="link-btn" style={{ textAlign: "left" }} onClick={() => void submit(a.email)} disabled={busy}>
                    {a.role_label}: {a.employee.name} <span className="muted">/ {a.employee.code} / {a.headed_departments.join(", ") || a.employee.department || "Organisation"}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      <div className="login-right">
        <h2>Work moves forward. Contribution stays visible.</h2>
        <p style={{ color: "#c7d1cb" }}>A single workspace for project delivery, employee performance, training and recognition.</p>
        <div className="feat"><b>Project delivery</b>Tasks, reviews and dependencies</div>
        <div className="feat"><b>Employee progress</b>KPI evidence and verified training</div>
        <div className="feat"><b>Recognition</b>Locked scores and fair review</div>
      </div>
    </div>
  );
}
