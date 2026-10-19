import {
  ArrowLeft,
  Bell,
  Check,
  CheckCircle2,
  ChevronDown,
  Gauge,
  Home,
  LayoutGrid,
  LogOut,
  Search,
  Settings2,
  ShieldCheck,
  Star,
  Users,
  Workflow,
  BarChart3,
  LineChart,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";

import { useAuth } from "@/auth/AuthContext";
import { Avatar } from "@/components/ui";
import { useApiMutation, useApiQuery } from "@/lib/hooks";
import { fmtDateTime } from "@/lib/format";
import { CrumbProvider, useCrumb } from "@/lib/crumb";
import { homeFor, rememberTier, TIER_LABELS, tierFromPath, type Tier } from "@/lib/tier";
import { SearchDialog } from "./SearchDialog";

type NavItem = { to: string; label: string; icon: ReactNode; end?: boolean };

/** Project Tier: delivery work. Individual Tier: people, KPIs and recognition (Sales pilot). */
const NAV: Record<Tier, NavItem[]> = {
  project: [
    { to: "/home", label: "Home", icon: <Home size={19} /> },
    { to: "/projects", label: "Projects", icon: <LayoutGrid size={19} /> },
    { to: "/tasks", label: "Tasks", icon: <CheckCircle2 size={19} /> },
  ],
  individual: [
    { to: "/individual/home", label: "Home", icon: <Home size={19} /> },
    { to: "/individual/team", label: "Team", icon: <Users size={19} /> },
    { to: "/individual/performance", label: "Performance", icon: <BarChart3 size={19} /> },
    { to: "/individual/rewards", label: "Rewards", icon: <Star size={19} /> },
    { to: "/individual/reports", label: "Reports", icon: <LineChart size={19} /> },
  ],
};

const ADMIN_NAV = [
  { to: "/admin", label: "People & access", icon: <ShieldCheck size={19} />, end: true },
  { to: "/admin/workflows", label: "Workflows & data", icon: <Workflow size={19} /> },
];

const CRUMBS: Record<string, string> = {
  home: "Home", projects: "Projects", tasks: "Tasks", team: "Team", people: "Team", performance: "Performance",
  rewards: "Rewards", reports: "Reports", admin: "Admin", settings: "Preferences", "kpi-scoring": "KPI Scoring",
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
  return (
    <CrumbProvider>
      <Shell />
    </CrumbProvider>
  );
}

function Shell() {
  const { account, signOut, isRole } = useAuth();
  const crumbLabel = useCrumb();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchOpen, setSearchOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [tierOpen, setTierOpen] = useState(false);
  const tier = tierFromPath(location.pathname);
  const home = useApiQuery<HomeLite>(tier === "project" ? "/home" : null);
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

  useEffect(() => {
    rememberTier(tier);
  }, [tier]);

  if (!account) return null;
  const parts = location.pathname.split("/");
  const section = (tier === "individual" ? parts[2] : parts[1]) || "home";
  // Section root (e.g. /individual/team) and whether we are below it (a detail page).
  const sectionPath = tier === "individual" ? `/individual/${section}` : section === "people" ? "/team" : `/${section}`;
  const isDetail = parts.filter(Boolean).length > (tier === "individual" ? 2 : 1);
  const isHome = section === "home" && !isDetail;
  const goBack = () => {
    // Inside the app history: go back; opened directly: go up to the section.
    if ((window.history.state?.idx ?? 0) > 0) navigate(-1);
    else navigate(isDetail ? sectionPath : homeFor(tier));
  };
  const nav = NAV[tier];
  const switchTier = (next: Tier) => {
    setTierOpen(false);
    rememberTier(next);
    navigate(homeFor(next));
  };
  const unread = (notes.data ?? []).filter((n) => !n.read).length;
  const roleView = `${account.role_label} view`;

  return (
    <div className="shell">
      <aside className="sidebar" aria-label="Primary">
        <div className="brand">
          <img className="brand-wordmark" src="/finvasia-logo-light.svg" alt="Finvasia" />
          <img className="brand-mark" src="/finvasia-mark.svg" alt="Finvasia" />
          <span>Elevate</span>
        </div>
        <div className="tier-switch">
          <button className="org-switch" type="button" aria-haspopup="menu" aria-expanded={tierOpen} onClick={() => setTierOpen(!tierOpen)}>
            <span>{TIER_LABELS[tier]}</span>
            <ChevronDown size={16} />
          </button>
          {tierOpen && (
            <div className="tier-menu" role="menu" onKeyDown={(e) => e.key === "Escape" && setTierOpen(false)}>
              {(["project", "individual"] as Tier[])
                .map((t) => (
                  <button key={t} role="menuitemradio" aria-checked={tier === t} disabled={t === "individual" && !account.in_pilot} onClick={() => switchTier(t)}>
                    <span>
                      <b>{TIER_LABELS[t]}</b>
                      <small>
                        {t === "project" ? "Home, Projects, Tasks" : account.in_pilot ? "Team, Performance, Rewards, Reports (Sales pilot)" : "Sales pilot accounts and Admins only"}
                      </small>
                    </span>
                    {tier === t && <Check size={16} />}
                  </button>
                ))}
            </div>
          )}
        </div>
        <nav className="nav">
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? "active" : "")}>
              {n.icon}
              <span className="label">{n.label}</span>
            </NavLink>
          ))}
        </nav>
        {tier === "individual" && isRole("admin") && (
          <>
            <div className="nav-section">SCORING METHOD</div>
            <nav className="nav">
              <NavLink to="/individual/kpi-scoring" className={({ isActive }) => (isActive ? "active" : "")}>
                <Gauge size={19} />
                <span className="label">KPI Scoring</span>
              </NavLink>
            </nav>
          </>
        )}
        {tier === "project" && isRole("admin") && (
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
        {tier === "project" && (home.data?.pinned?.length ?? 0) > 0 && (
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
            <small>{account.headed_departments.length ? account.headed_departments.join(", ") : account.employee.department ?? "Organisation"}</small>
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="crumbs">
            <Link to={homeFor(tier)}>{TIER_LABELS[tier]}</Link>
            <span aria-hidden="true">/</span>
            {isDetail ? <Link to={sectionPath}>{CRUMBS[section] ?? "Home"}</Link> : <b aria-current="page">{CRUMBS[section] ?? "Home"}</b>}
            {isDetail && (
              <>
                <span aria-hidden="true">/</span>
                <b aria-current="page">{crumbLabel ?? "Details"}</b>
              </>
            )}
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
                  {account.in_pilot && (
                    <button className="link-btn row" style={{ padding: "6px 0" }} onClick={() => { setMenuOpen(false); switchTier(tier === "project" ? "individual" : "project"); }}>
                      <ChevronDown size={16} /> Switch to {TIER_LABELS[tier === "project" ? "individual" : "project"]}
                    </button>
                  )}
                  <button className="link-btn row" style={{ padding: "6px 0" }} onClick={() => { setMenuOpen(false); navigate("/settings"); }}><Settings2 size={16} /> Preferences</button>
                  <button className="link-btn row" style={{ padding: "6px 0" }} onClick={signOut}><LogOut size={16} /> Sign out</button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="content" id="main">
          {!isHome && (
            <button type="button" className="back-link" onClick={goBack}>
              <ArrowLeft size={16} /> Back
            </button>
          )}
          <Outlet />
        </main>
      </div>
      <nav className="mobile-nav" aria-label="Mobile">
        {nav.slice(0, 5).map((n) => (
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
