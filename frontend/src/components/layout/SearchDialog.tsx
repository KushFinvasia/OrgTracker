import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { api } from "@/api/client";
import type { Person } from "@/api/types";
import { tierFromPath } from "@/lib/tier";

interface Results {
  projects: { id: number; code: string; title: string; department: string | null }[];
  tasks: { id: number; code: string; title: string; status: string }[];
  people: Person[];
}

/** Scope-aware search. Results come only from records the account may open.
 * Project Tier: projects, tasks and people's work. Individual Tier: people in your pilot scope, opening their page in Team. */
export function SearchDialog({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<Results | null>(null);
  const navigate = useNavigate();
  const individual = tierFromPath(useLocation().pathname) === "individual";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
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

  const go = (path: string) => {
    onClose();
    navigate(path);
  };
  const empty = res && !res.projects.length && !res.tasks.length && !res.people.length;

  return (
    <>
      <div className="overlay" style={{ zIndex: 65 }} onClick={onClose} />
      <div className="search-dialog" role="dialog" aria-modal="true" aria-label="Search">
        <input autoFocus placeholder={individual ? "Search people in your team by name or employee ID" : "Search projects, tasks and people in your scope"} value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="search-results">
          {!res && <p className="muted" style={{ padding: "8px 20px" }}>Type at least two characters.</p>}
          {empty && <p className="muted" style={{ padding: "8px 20px" }}>No matches in your permitted scope.</p>}
          {res && res.projects.length > 0 && <h5>Projects</h5>}
          {res?.projects.map((p) => (
            <button key={`p${p.id}`} onClick={() => go(`/projects/${p.id}`)}>
              <b>{p.title}</b> <span className="muted">{p.code} / {p.department}</span>
            </button>
          ))}
          {res && res.tasks.length > 0 && <h5>Tasks</h5>}
          {res?.tasks.map((t) => (
            <button key={`t${t.id}`} onClick={() => go(`/tasks?task=${t.id}`)}>
              <b>{t.title}</b> <span className="muted">{t.code} / {t.status}</span>
            </button>
          ))}
          {res && res.people.length > 0 && <h5>People</h5>}
          {res?.people.map((p) => (
            <button key={`e${p.id}`} onClick={() => go(individual ? `/individual/team/${p.id}` : `/people/${p.id}`)}>
              <b>{p.name}</b> <span className="muted">{p.code} / {p.designation} / {p.department}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
