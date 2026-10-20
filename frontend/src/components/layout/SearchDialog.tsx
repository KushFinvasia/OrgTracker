import { CheckSquare, ChevronRight, Folder, Search, Users, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { api } from "@/api/client";
import type { Person } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { tierFromPath } from "@/lib/tier";

interface Results {
  projects: { id: number; code: string; title: string; department: string | null }[];
  tasks: { id: number; code: string; title: string; status: string }[];
  people: Person[];
}
interface Hit {
  group: string;
  label: string;
  sub: string;
  to: string;
  icon: LucideIcon;
}

/** Scope-aware search. Results come only from records the account may open.
 * Project Tier: projects, tasks and people's work. Individual Tier: people in your pilot scope, opening their page in Team. */
export function SearchDialog({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<Results | null>(null);
  const [sel, setSel] = useState(0);
  const navigate = useNavigate();
  const { isRole, account } = useAuth();
  const individual = tierFromPath(useLocation().pathname) === "individual";
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, [onClose]);

  useEffect(() => {
    if (q.trim().length < 2) {
      setRes(null);
      return;
    }
    const url = individual ? `/individual/search?q=${encodeURIComponent(q)}` : `/search?q=${encodeURIComponent(q)}`;
    const t = setTimeout(
      () => api.get<Partial<Results>>(url).then((r) => setRes({ projects: r.projects ?? [], tasks: r.tasks ?? [], people: r.people ?? [] })).catch(() => setRes(null)),
      200,
    );
    return () => clearTimeout(t);
  }, [q, individual]);

  const pages: [string, string, string][] = [
    ...(account?.in_pilot
      ? ([
          ["Home", "/individual/home", "Individual Tier"],
          ["Team", "/individual/team", "Individual Tier"],
          ["Performance", "/individual/performance", "Individual Tier"],
          ["Rewards", "/individual/rewards", "Individual Tier"],
          ["Reports", "/individual/reports", "Individual Tier"],
        ] as [string, string, string][])
      : []),
    ...(isRole("admin") ? ([["KPI Scoring", "/individual/kpi-scoring", "Admin"]] as [string, string, string][]) : []),
    ["Projects", "/projects", "Project Tier"],
    ["Tasks", "/tasks", "Project Tier"],
    ["Preferences", "/settings", "Account"],
  ];
  const t = q.trim().toLowerCase();
  const hits: Hit[] = [
    ...pages.filter((p) => !t || p[0].toLowerCase().includes(t)).map((p) => ({ group: "Pages", label: p[0], sub: p[2], to: p[1], icon: ChevronRight })),
    ...(res?.people ?? []).map((p) => ({ group: individual ? "People in your scope" : "People", label: p.name, sub: `${p.code}, ${p.designation ?? ""}`, to: individual ? `/individual/team/${p.id}` : `/people/${p.id}`, icon: Users })),
    ...(res?.projects ?? []).map((p) => ({ group: "Projects", label: p.title, sub: `${p.code}${p.department ? `, ${p.department}` : ""}`, to: `/projects/${p.id}`, icon: Folder })),
    ...(res?.tasks ?? []).map((x) => ({ group: "Tasks", label: x.title, sub: `${x.code}, ${x.status}`, to: `/tasks?task=${x.id}`, icon: CheckSquare })),
  ];
  const cur = Math.min(sel, Math.max(0, hits.length - 1));

  const go = (path: string) => {
    onClose();
    navigate(path);
  };

  let last = "";
  return (
    <>
      <div className="scrim" style={{ zIndex: 61 }} onClick={onClose} />
      <div className="cmdk" role="dialog" aria-modal="true" aria-label="Search" ref={box}>
        <div className="cmdk-in">
          <Search size={20} aria-hidden="true" />
          <input
            autoFocus
            placeholder={individual ? "Search people and pages" : "Search projects, tasks, people and pages"}
            aria-label="Search"
            autoComplete="off"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setSel(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSel(Math.min(cur + 1, hits.length - 1));
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setSel(Math.max(cur - 1, 0));
              }
              if (e.key === "Enter" && hits[cur]) go(hits[cur].to);
            }}
          />
          <span className="kbd">Esc</span>
        </div>
        <div className="cmdk-list">
          {hits.length === 0 ? (
            <div className="empty" style={{ padding: 28 }}>
              <h3>No matches</h3>
              <p>Only people and records in your access scope are searched.</p>
            </div>
          ) : (
            hits.map((h, i) => {
              const head = h.group !== last ? <div className="grp">{h.group}</div> : null;
              last = h.group;
              return (
                <div key={`${h.group}-${h.to}-${i}`}>
                  {head}
                  <button type="button" className={`res ${i === cur ? "sel" : ""}`} onMouseEnter={() => setSel(i)} onClick={() => go(h.to)}>
                    <h.icon size={16} aria-hidden="true" />
                    {h.label}
                    <small>{h.sub}</small>
                  </button>
                </div>
              );
            })
          )}
          {t.length > 0 && t.length < 2 && <p className="small muted" style={{ padding: "6px 10px" }}>Type at least two characters to search records.</p>}
        </div>
      </div>
    </>
  );
}
