import { useEffect, useState } from "react";

import { api, ApiError } from "@/api/client";
import type { Account } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { Button, Field } from "@/components/ui";

export function LoginPage() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [devAccounts, setDevAccounts] = useState<Account[]>([]);

  useEffect(() => {
    api.get<Account[]>("/auth/dev-accounts").then(setDevAccounts).catch(() => setDevAccounts([]));
  }, []);

  const submit = async (value = email) => {
    setBusy(true);
    setError(null);
    try {
      await signIn(value);
      window.history.replaceState(null, "", "/home");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <div className="login-left">
        <div className="brand" style={{ color: "var(--ink)", padding: 0 }}>
          <img src="/logo-placeholder.svg" alt="" style={{ width: 44, height: 44 }} />
          Orgtrack
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
          <Field label="Company email" required error={error}>
            <input className="input" type="email" placeholder="name@finvasia.com" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
          </Field>
          <Button variant="primary" type="submit" disabled={busy || !email}>
            Continue with company sign-in
          </Button>
        </form>
        <p className="small muted">
          Admin, HOD, Manager and Team Lead accounts are linked to one employee identity. Access follows your assigned role and reporting scope. No regular employee or shared team login.
          Need access? Contact your administrator.
        </p>
        {devAccounts.length > 0 && (
          <div className="card" style={{ padding: 16 }}>
            <b>Development sign-in</b>
            <p className="small muted">Demo provisioning from the seed. Replace with company SSO before real use.</p>
            <div className="stack" style={{ gap: 6 }}>
              {devAccounts.map((a) => (
                <button key={a.id} className="link-btn" style={{ textAlign: "left" }} onClick={() => void submit(a.email)} disabled={busy}>
                  {a.role_label}: {a.employee.name} <span className="muted">/ {a.employee.code} / {a.headed_departments.join(", ") || a.employee.department}</span>
                </button>
              ))}
            </div>
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
