import { useCallback, useEffect, useState } from "react";

/** Per-browser display preferences (theme, sidebar). They never hold business state. */
export type Theme = "light" | "dark";

const THEME_KEY = "orgtrack.theme";
const SIDEBAR_KEY = "orgtrack.sidebar";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: the preference lasts for this page only */
  }
}

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function getTheme(): Theme {
  return read(THEME_KEY) === "dark" ? "dark" : "light";
}
let themeTimer: ReturnType<typeof setTimeout> | undefined;
export function setTheme(t: Theme) {
  write(THEME_KEY, t);
  // Ease the brightness change instead of flashing (styles: html.theme-switching).
  const root = document.documentElement;
  root.classList.add("theme-switching");
  root.setAttribute("data-theme", t);
  clearTimeout(themeTimer);
  themeTimer = setTimeout(() => root.classList.remove("theme-switching"), 300);
  notify();
}
export function getCollapsed(): boolean {
  return read(SIDEBAR_KEY) === "collapsed";
}
export function setCollapsed(c: boolean) {
  write(SIDEBAR_KEY, c ? "collapsed" : "expanded");
  notify();
}

/** Re-renders when a preference changes anywhere in the app. */
export function usePrefs() {
  const [, tick] = useState(0);
  useEffect(() => {
    const l = () => tick((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return {
    theme: getTheme(),
    collapsed: getCollapsed(),
    setTheme: useCallback((t: Theme) => setTheme(t), []),
    setCollapsed: useCallback((c: boolean) => setCollapsed(c), []),
  };
}
