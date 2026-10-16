import type { Account } from "@/api/types";

/** Two tiers, switched from the organisation dropdown. The URL decides the tier, so deep links always open in the right one. */
export type Tier = "project" | "individual";

const KEY = "orgtrack.tier";

export const TIER_LABELS: Record<Tier, string> = { project: "Project Tier", individual: "Individual Tier" };

export function tierFromPath(pathname: string): Tier {
  return pathname.startsWith("/individual") ? "individual" : "project";
}

export function homeFor(tier: Tier): string {
  return tier === "individual" ? "/individual/home" : "/home";
}

export function rememberTier(tier: Tier) {
  try {
    localStorage.setItem(KEY, tier);
  } catch {
    /* storage unavailable: the URL still carries the tier */
  }
}

/** Last tier used on this browser; pilot accounts start in the Individual Tier. */
export function startTier(account: Account | null): Tier {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(KEY);
  } catch {
    saved = null;
  }
  if (saved === "project" || saved === "individual") return saved === "individual" && !account?.in_pilot ? "project" : saved;
  return account?.in_pilot ? "individual" : "project";
}
