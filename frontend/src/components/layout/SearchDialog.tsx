import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { api } from "@/api/client";
import type { Person } from "@/api/types";

interface Results {
  projects: { id: number; code: string; title: string; department: string | null }[];
  tasks: { id: number; code: string; title: string; status: string }[];
  people: Person[];
  training: { id: number; code: string; title: string; employee: string; employee_id: number }[];
}

/** Scope-aware search. Results come only from records the account may open. */
export function SearchDialog({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<Results | null>(null);
  const navigate = useNavigate();

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
    const t = setTimeout(() => api.get<Results>(`/search?q=${encodeURIComponent(q)}`).then(setRes).catch(() => setRes(null)), 200);
    return () => clearTimeout(t);
  }, [q]);

  const go = (path: string) => {
    onClose();
    navigate(path);
  };
  const empty = res && !res.projects.length && !res.tasks.length && !res.people.length && !res.training.length;

  return (
    <>
      <div className="overlay" style={{ zIndex: 65 }} onClick={onClose} />
      <div className="search-dialog" role="dialog" aria-modal="true" aria-label="Search">
        <input autoFocus placeholder="Search projects, tasks, people and training in your scope" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="search-results">
          {!res && <p className="muted" style={{ padding: "8px 20px" }}>Type at least two characters. A project match never exposes someone else's private performance or training score.</p>}
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
            <button key={`e${p.id}`} onClick={() => go(`/people/${p.id}`)}>
              <b>{p.name}</b> <span className="muted">{p.code} / {p.designation} / {p.department}</span>
            </button>
          ))}
          {res && res.training.length > 0 && <h5>Training</h5>}
          {res?.training.map((t) => (
            <button key={`r${t.id}`} onClick={() => go(`/people/${t.employee_id}?tab=training&assignment=${t.id}`)}>
              <b>{t.title}</b> <span className="muted">{t.code} / {t.employee}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
