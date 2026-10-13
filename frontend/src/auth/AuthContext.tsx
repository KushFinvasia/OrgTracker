import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { api, getToken, setToken, setUnauthorizedHandler } from "@/api/client";
import type { Account } from "@/api/types";

interface AuthState {
  account: Account | null;
  loading: boolean;
  signIn: (email: string, accessCode?: string) => Promise<void>;
  signOut: () => void;
  isRole: (...roles: Account["role"][]) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState<boolean>(!!getToken());
  const qc = useQueryClient();

  const signOut = useCallback(() => {
    setToken(null);
    setAccount(null);
    qc.clear();
  }, [qc]);

  useEffect(() => {
    setUnauthorizedHandler(() => signOut());
    if (!getToken()) return;
    api
      .get<Account>("/auth/me")
      .then(setAccount)
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, [signOut]);

  const signIn = useCallback(async (email: string, accessCode?: string) => {
    const res = await api.post<{ token: string; account: Account }>("/auth/login", { email, access_code: accessCode || null });
    setToken(res.token);
    const me = await api.get<Account>("/auth/me");
    qc.clear();
    setAccount(me);
  }, [qc]);

  const value = useMemo<AuthState>(
    () => ({ account, loading, signIn, signOut, isRole: (...roles) => !!account && roles.includes(account.role) }),
    [account, loading, signIn, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}
