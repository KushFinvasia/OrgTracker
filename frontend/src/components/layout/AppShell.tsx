import {
  Bell,
  CheckCircle2,
  ChevronDown,
  Home,
  LayoutGrid,
  LogOut,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Star,
  Users,
  Workflow,
  BarChart3,
  LineChart,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";

import { useAuth } from "@/auth/AuthContext";
import { Avatar } from "@/components/ui";
import { useApiMutation, useApiQuery } from "@/lib/hooks";
import { fmtDateTime } from "@/lib/format";
import { SearchDialog } from "./SearchDialog";

const NAV: { to: string; label: string; icon: ReactNode }[] = [
  { to: "/home", label: "Home", icon: <Home size={19} /> },
  { to: "/projects", label: "Projects", icon: <LayoutGrid size={19} /> },
  { to: "/tasks", label: "Tasks", icon: <CheckCircle2 size={19} /> },
  { to: "/team", label: "Team", icon: <Users size={19} /> },
  { to: "/performance", label: "Performance", icon: <BarChart3 size={19} /> },
  { to: "/rewards", label: "Rewards", icon: <Star size={19} /> },
  { to: "/reports", label: "Reports", icon: <LineChart size={19} /> },
];

const ADMIN_NAV = [
  { to: "/admin", label: "People & access", icon: <ShieldCheck size={19} />, end: true },
  { to: "/admin/rules", label: "KPI rules", icon: <SlidersHorizontal size={19} /> },
  { to: "/admin/workflows", label: "Workflows & data", icon: <Workflow size={19} /> },
];

const CRUMBS: Record<string, string> = {
  home: "Home", projects: "Projects", tasks: "Tasks", team: "Team", people: "Team", performance: "Performance",
  rewards: "Rewards", reports: "Reports", admin: "Admin", settings: "Preferences",
};

interface HomeLite {
  pinned: { id: number; title: string }[];
}
interface Notice {
  id: number;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  created_at: string;
}

export function AppShell() {
  const { account, signOut, isRole } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchOpen, setSearchOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const home = useApiQuery<HomeLite>("/home");
  const notes = useApiQuery<Notice[]>("/notifications");
  const readAll = useApiMutation("post", "/notifications/read-all");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  if (!account) return null;
  const section = location.pathname.split("/")[1] ?? "home";
  const unread = (notes.data ?? []).filter((n) => !n.read).length;
  const roleView = `${account.role_label} view`;

  return (
    <div className="shell">
      <aside className="sidebar" aria-label="Primary">
        <div className="brand">
          <img src="/logo-placeholder.svg" alt="" />
          <span>Orgtrack</span>
        </div>
        <button className="org-switch" type="button" aria-label="Organisation: Finvasia">
          Finvasia <ChevronDown size={16} />
        </button>
        <nav className="nav">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} className={({ isActive }) => (isActive ? "active" : "")}>
              {n.icon}
              <span className="label">{n.label}</span>
            </NavLink>
          ))}
        </nav>
        {isRole("admin") && (
          <>
            <div className="nav-section">CONTROL CENTRE</div>
            <nav className="nav">
              {ADMIN_NAV.map((n) => (
                <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? "active" : "")}>
                  {n.icon}
                  <span className="label">{n.label}</span>
                </NavLink>
              ))}
            </nav>
          </>
        )}
        {!isRole("admin") && isRole("hod") && (
          <>
            <div className="nav-section">APPROVALS</div>
            <nav className="nav">
              <NavLink to="/admin/rules" className={({ isActive }) => (isActive ? "active" : "")}>
                <SlidersHorizontal size={19} />
                <span className="label">KPI rules</span>
              </NavLink>
            </nav>
          </>
        )}
        {(home.data?.pinned?.length ?? 0) > 0 && (
          <>
            <div className="nav-section">PINNED</div>
            <div className="pinned">
              {home.data!.pinned.map((p) => (
                <NavLink key={p.id} to={`/projects/${p.id}`}>{p.title}</NavLink>
              ))}
            </div>
          </>
        )}
        <div className="sidebar-foot">
          <Avatar person={account.employee} />
          <div className="who" style={{ flex: 1, minWidth: 0 }}>
            <b style={{ color: "#fff" }}>{roleView}</b>
            <small>{account.headed_departments.length ? account.headed_departments.join(", ") : account.employee.department}</small>
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="crumbs">
            <span>Workspace</span>/<b>{CRUMBS[section] ?? "Home"}</b>
          </div>
          <div className="top-actions">
            <button className="search-btn" onClick={() => setSearchOpen(true)} aria-label="Search (Ctrl K)">
              <Search size={18} />
              <span className="desktop-only">Search anything...</span>
              <kbd className="desktop-only">Ctrl K</kbd>
            </button>
            <div style={{ position: "relative" }}>
              <button className="icon-btn" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} onClick={() => setNotesOpen(!notesOpen)}>
                <Bell size={20} />
                {unread > 0 && <span className="dot" />}
              </button>
              {notesOpen && (
                <div className="card" style={{ position: "absolute", right: 0, top: 44, width: 360, zIndex: 40, padding: 16 }}>
                  <div className="row between mb">
                    <b>Notifications</b>
                    <button className="link-btn small" onClick={() => readAll.mutate({})}>Mark all read</button>
                  </div>
                  <p className="small muted">Notifications do not approve work or training. Decisions live in the action inbox.</p>
                  {(notes.data ?? []).length === 0 && <p className="muted">No notifications.</p>}
                  {(notes.data ?? []).slice(0, 8).map((n) => (
                    <button key={n.id} className="link-btn" style={{ display: "block", padding: "8px 0", color: n.read ? "var(--muted)" : "var(--ink)", fontWeight: n.read ? 400 : 700 }} onClick={() => { setNotesOpen(false); if (n.link) navigate(n.link); }}>
                      {n.title}
                      <div className="small muted">{fmtDateTime(n.created_at)}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="me" style={{ position: "relative" }}>
              <button className="icon-btn row" style={{ gap: 10 }} onClick={() => setMenuOpen(!menuOpen)} aria-haspopup="menu">
                <Avatar person={account.employee} />
                <span className="desktop-only">{account.role_label}</span>
              </button>
              {menuOpen && (
                <div className="card" role="menu" style={{ position: "absolute", right: 0, top: 50, width: 260, zIndex: 40, padding: 14 }}>
                  <b>{account.employee.name}</b>
                  <div className="small muted mb">{account.employee.code} / {account.email}</div>
                  <button className="link-btn row" style={{ padding: "6px 0" }} onClick={() => { setMenuOpen(false); navigate("/settings"); }}><Settings2 size={16} /> Preferences</button>
                  <button className="link-btn row" style={{ padding: "6px 0" }} onClick={signOut}><LogOut size={16} /> Sign out</button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="content" id="main">
          <Outlet />
        </main>
      </div>
      <nav className="mobile-nav" aria-label="Mobile">
        {NAV.slice(0, 4).map((n) => (
          <NavLink key={n.to} to={n.to} className={({ isActive }) => (isActive ? "active" : "")}>
            {n.icon}
            {n.label}
          </NavLink>
        ))}
      </nav>
      {searchOpen && <SearchDialog onClose={() => setSearchOpen(false)} />}
    </div>
  );
}
