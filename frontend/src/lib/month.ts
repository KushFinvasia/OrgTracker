import { useEffect, useState } from "react";

/**
 * The Individual Tier month chosen in the top bar. It is kept for this browser tab (sessionStorage) and mirrored in the
 * page URL as ?month= so a link opens the same month. Pages read it through useMonth (pages/individual/shared.tsx).
 */
const KEY = "orgtrack.month";
const listeners = new Set<(id: number | null) => void>();

export function getStoredMonth(): number | null {
  try {
    const v = sessionStorage.getItem(KEY);
    return v ? Number(v) : null;
  } catch {
    return null;
  }
}

export function setStoredMonth(id: number) {
  try {
    sessionStorage.setItem(KEY, String(id));
  } catch {
    /* storage unavailable: the URL still carries the month */
  }
  const params = new URLSearchParams(window.location.search);
  if (window.location.pathname.startsWith("/individual")) {
    params.set("month", String(id));
    window.history.replaceState(window.history.state, "", `${window.location.pathname}?${params.toString()}`);
  }
  listeners.forEach((l) => l(id));
}

export function useStoredMonth(): number | null {
  const [id, setId] = useState<number | null>(getStoredMonth);
  useEffect(() => {
    const l = (v: number | null) => setId(v);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return id;
}
