import {
  Award,
  BarChart3,
  Bell,
  Calendar,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Folder,
  Gauge,
  Home,
  Lock,
  LogOut,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  ShieldCheck,
  Sliders,
  Sun,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";

import { useAuth } from "@/auth/AuthContext";
import { Avatar, FloatingMenu, usePopover } from "@/components/ui";
import { CrumbProvider, useCrumb } from "@/lib/crumb";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { useApiMutation, useApiQuery } from "@/lib/hooks";
import { setStoredMonth, useStoredMonth } from "@/lib/month";
import { usePrefs } from "@/lib/prefs";
import { homeFor, rememberTier, TIER_LABELS, tierFromPath, type Tier } from "@/lib/tier";
import type { PersonRow, PilotContext } from "@/pages/individual/shared";
import { SearchDialog } from "./SearchDialog";

type NavItem = { to: string; label: string; icon: LucideIcon; end?: boolean; count?: number };
type NavGroup = { label: string; items: NavItem[] };

const CRUMBS: Record<string, string> = {
  home: "Home", projects: "Projects", tasks: "Tasks", team: "Team", people: "People", performance: "Performance",
  rewards: "Rewards", reports: "Reports", admin: "Administration", settings: "Preferences", "kpi-scoring": "KPI Scoring",
};

interface HomeLite {
  pinned: { id: number; title: string }[];
  actions: unknown[];
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
  const { account, isRole } = useAuth();
  const crumbLabel = useCrumb();
  const location = useLocation();
  const navigate = useNavigate();
  const prefs = usePrefs();
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const tier = tierFromPath(location.pathname);
  const home = useApiQuery<HomeLite>(tier === "project" ? "/home" : null);
  const pilot = useApiQuery<PilotContext>(tier === "individual" && account?.in_pilot ? "/individual/context" : null);
  // Sidebar counts use the month chosen in the top bar and the same people list the pages load (one shared request).
  const storedMonth = useStoredMonth();
  const navMonth = pilot.data ? (pilot.data.months.some((m) => m.id === storedMonth) ? storedMonth : pilot.data.focus_month_id) : null;
  const navPeople = useApiQuery<{ rows: PersonRow[] }>(navMonth ? `/individual/months/${navMonth}/people` : null);

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

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  if (!account) return null;
  const parts = location.pathname.split("/").filter(Boolean);
  const section = (tier === "individual" ? parts[1] : parts[0]) || "home";
  const sectionPath = tier === "individual" ? `/individual/${section}` : section === "people" ? "/home" : `/${section}`;
  const isDetail = parts.length > (tier === "individual" ? 2 : 1) && !(section === "admin" && parts[1] === "workflows");
  const goBack = () => {
    if ((window.history.state?.idx ?? 0) > 0) navigate(-1);
    else navigate(sectionPath);
  };

  // Attention counts: only what this viewer can act on (scope and approval rules come from the server).
  const navRows = navPeople.data?.rows ?? [];
  const approvals = navRows.filter((r) => r.can_approve).length;
  const returned = navRows.filter((r) => r.evaluation_state === "Returned" && r.can_edit).length;
  const groups: NavGroup[] =
    tier === "individual"
      ? [
          {
            label: "Monthly cycle",
            items: [
              { to: "/individual/home", label: "Home", icon: Home, count: account.role !== "manager" ? approvals : 0 },
              { to: "/individual/team", label: "Team", icon: Users, count: account.role === "manager" ? returned : 0 },
              { to: "/individual/performance", label: "Performance", icon: Gauge },
            ],
          },
          { label: "Results", items: [{ to: "/individual/rewards", label: "Rewards", icon: Award }, { to: "/individual/reports", label: "Reports", icon: BarChart3 }] },
          ...(isRole("admin") ? [{ label: "Administration", items: [{ to: "/individual/kpi-scoring", label: "KPI Scoring", icon: Sliders }] }] : []),
        ]
      : [
          {
            label: "Delivery",
            items: [
              { to: "/home", label: "Home", icon: Home, count: home.data?.actions?.length ?? 0 },
              { to: "/projects", label: "Projects", icon: Folder },
              { to: "/tasks", label: "Tasks", icon: CheckSquare },
            ],
          },
          ...(isRole("admin")
            ? [{ label: "Control centre", items: [{ to: "/admin", label: "People & access", icon: ShieldCheck, end: true }, { to: "/admin/workflows", label: "Workflows & data", icon: Workflow }] }]
            : isRole("hod", "manager")
              ? [{ label: "Control centre", items: [{ to: "/admin/workflows", label: "Workflows & data", icon: Workflow }] }]
              : []),
        ];
  const pinned = tier === "project" ? home.data?.pinned ?? [] : [];

  return (
    <div className={`app ${prefs.collapsed ? "collapsed" : ""} ${mobileOpen ? "mobile-open" : ""}`}>
      <aside className="side" aria-label="Primary">
        <div className="side-top">
          <Link className="brand" to={homeFor(tier)} aria-label="Finvasia Elevate home">
            <Logo variant="dark" />
            <img className="logo-f" src="/finvasia-mark.svg" alt="" />
          </Link>
          <button
            type="button"
            className="side-toggle"
            onClick={() => prefs.setCollapsed(!prefs.collapsed)}
            aria-label={prefs.collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!prefs.collapsed}
            title={prefs.collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {prefs.collapsed ? <PanelLeftOpen size={18} strokeWidth={1.75} aria-hidden="true" /> : <PanelLeftClose size={18} strokeWidth={1.75} aria-hidden="true" />}
          </button>
        </div>
        <TierButton tier={tier} inPilot={!!account.in_pilot} />
        <nav className="nav">
          {groups.map((g) => (
            <div className="nav-group" key={g.label}>
              <div className="nav-label">{g.label}</div>
              {g.items.map((n) => (
                <NavLink key={n.to} to={n.to} end={n.end ?? n.to.endsWith("home")} data-tip={n.label} className={({ isActive }) => (isActive ? "active" : "")}>
                  <n.icon size={16} strokeWidth={1.75} aria-hidden="true" />
                  <span className="hide-c">{n.label}</span>
                  {!!n.count && (
                    <span className="count" aria-label={`${n.count} need attention`}>
                      {n.count}
                    </span>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
          {pinned.length > 0 && (
            <div className="nav-group">
              <div className="nav-label">Pinned</div>
              {pinned.map((p) => (
                <NavLink key={p.id} to={`/projects/${p.id}`} className={({ isActive }) => `pin ${isActive ? "active" : ""}`}>
                  <span className="hide-c" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{p.title}</span>
                </NavLink>
              ))}
            </div>
          )}
        </nav>
        <div className="side-foot">
          <MeMenu />
        </div>
      </aside>
      {mobileOpen && <div className="scrim" style={{ zIndex: 25 }} onClick={() => setMobileOpen(false)} />}

      <div className="main">
        <header className="topbar">
          <button type="button" className="icon-btn menu-btn" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
            <Menu size={18} />
          </button>
          <nav className="crumbs" aria-label="Breadcrumb">
            <Link to={homeFor(tier)}>{TIER_LABELS[tier]}</Link>
            <ChevronRight size={14} aria-hidden="true" />
            {isDetail ? <Link to={sectionPath}>{CRUMBS[section] ?? "Home"}</Link> : <b aria-current="page">{CRUMBS[section] ?? "Home"}</b>}
            {isDetail && (
              <>
                <ChevronRight size={14} aria-hidden="true" />
                <b aria-current="page">{crumbLabel ?? "Details"}</b>
              </>
            )}
          </nav>
          <div className="top-actions">
            {tier === "individual" && pilot.data && pilot.data.months.length > 0 && <MonthMenu ctx={pilot.data} />}
            <button type="button" className="search-btn" onClick={() => setSearchOpen(true)} aria-label="Search (Ctrl K)">
              <Search size={16} aria-hidden="true" />
              <span className="lbl">{tier === "individual" ? "Search people in your scope" : "Search projects, tasks, people"}</span>
              <span className="kbd">Ctrl K</span>
            </button>
            <Notifications />
          </div>
        </header>
        <main className="content enter" id="main" key={location.pathname}>
          {isDetail && (
            <button type="button" className="back" onClick={goBack}>
              <ChevronLeft size={14} aria-hidden="true" /> Back
            </button>
          )}
          <Outlet />
        </main>
      </div>
      {searchOpen && <SearchDialog onClose={() => setSearchOpen(false)} />}
    </div>
  );
}

export function Logo({ variant }: { variant: "dark" | "light" }) {
  return (
    <span className={`logo logo-${variant}`} role="img" aria-label="Finvasia Elevate">
      <img src={variant === "dark" ? "/finvasia-logo-light.svg" : "/finvasia-logo.svg"} alt="" />
      <span className="logo-sub" aria-hidden="true">Elevate</span>
    </span>
  );
}

function TierButton({ tier, inPilot }: { tier: Tier; inPilot: boolean }) {
  const pop = usePopover();
  const navigate = useNavigate();
  const go = (t: Tier) => {
    pop.setOpen(false);
    rememberTier(t);
    navigate(homeFor(t));
  };
  const Icon = tier === "individual" ? Users : Folder;
  const btn = useRef<HTMLButtonElement>(null);
  return (
    <div ref={pop.ref} style={{ position: "relative" }}>
      <button ref={btn} type="button" className="tier-btn" style={{ width: "calc(100% - 20px)" }} aria-haspopup="menu" aria-expanded={pop.open} aria-label={`Switch tier, current ${TIER_LABELS[tier]}`} onClick={pop.toggle}>
        <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
        <span className="grow hide-c">
          <span className="t1">Finvasia</span>
          <span className="t2">{TIER_LABELS[tier]}</span>
        </span>
        <span className="hide-c" style={{ display: "inline-flex" }}><ChevronDown size={14} aria-hidden="true" /></span>
      </button>
      {pop.open && (
        <FloatingMenu anchor={btn} popRef={pop.popRef} width={260}>
          <div className="ph-l">Finvasia</div>
          {inPilot && (
            <button type="button" role="menuitemradio" aria-checked={tier === "individual"} className={`pi ${tier === "individual" ? "sel" : ""}`} onClick={() => go("individual")}>
              <Users size={16} aria-hidden="true" />
              <span className="grow">
                <b style={{ fontWeight: 500 }}>Individual Tier</b>
                <small>Sales monthly performance pilot</small>
              </span>
              {tier === "individual" && <Check size={16} aria-hidden="true" />}
            </button>
          )}
          <button type="button" role="menuitemradio" aria-checked={tier === "project"} className={`pi ${tier === "project" ? "sel" : ""}`} onClick={() => go("project")}>
            <Folder size={16} aria-hidden="true" />
            <span className="grow">
              <b style={{ fontWeight: 500 }}>Project Tier</b>
              <small>Projects, tasks and reviews</small>
            </span>
            {tier === "project" && <Check size={16} aria-hidden="true" />}
          </button>
          {!inPilot && (
            <>
              <hr />
              <div className="ph-l" style={{ maxWidth: 240 }}>The Individual Tier is limited to the Sales pilot logins and Admins.</div>
            </>
          )}
        </FloatingMenu>
      )}
    </div>
  );
}

function MeMenu() {
  const { account, signOut } = useAuth();
  const prefs = usePrefs();
  const pop = usePopover();
  const navigate = useNavigate();
  const btn = useRef<HTMLButtonElement>(null);
  if (!account) return null;
  const roleLine = `${account.role_label}${account.in_pilot ? ", Sales pilot" : ""}`;
  return (
    <div ref={pop.ref} style={{ position: "relative" }}>
      <button ref={btn} type="button" className="me-btn" aria-haspopup="menu" aria-expanded={pop.open} onClick={pop.toggle}>
        <Avatar person={account.employee} />
        <span className="who hide-c">
          <b>{account.employee.name}</b>
          <span>{roleLine}</span>
        </span>
      </button>
      {pop.open && (
        <FloatingMenu anchor={btn} popRef={pop.popRef} place="above" width={220}>
          <div style={{ padding: "8px 10px 6px" }}>
            <b style={{ fontWeight: 600 }}>{account.employee.name}</b>
            <div className="small muted">{account.email}</div>
            <div className="small muted">
              {account.role_label}, {account.employee.code}
              {account.employee.designation ? `, ${account.employee.designation}` : ""}
            </div>
          </div>
          <hr />
          <button type="button" className="pi" role="menuitem" onClick={() => { pop.setOpen(false); navigate("/settings"); }}>
            <Settings size={16} aria-hidden="true" /> Preferences
          </button>
          <button type="button" className="pi" role="menuitem" onClick={() => prefs.setTheme(prefs.theme === "dark" ? "light" : "dark")}>
            {prefs.theme === "dark" ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
            {prefs.theme === "dark" ? "Use light theme" : "Use dark theme"}
          </button>
          <hr />
          <button type="button" className="pi" role="menuitem" onClick={signOut}>
            <LogOut size={16} aria-hidden="true" /> Sign out
          </button>
        </FloatingMenu>
      )}
    </div>
  );
}

function MonthMenu({ ctx }: { ctx: PilotContext }) {
  const pop = usePopover();
  const stored = useStoredMonth();
  const id = ctx.months.some((m) => m.id === stored) ? stored : ctx.focus_month_id;
  const month = ctx.months.find((m) => m.id === id) ?? ctx.months[0];
  const short = (label: string) => label.replace(/^(\w{3})\w*\s/, "$1 ");
  return (
    <div ref={pop.ref} style={{ position: "relative" }}>
      <button type="button" className="month-pick" aria-haspopup="menu" aria-expanded={pop.open} onClick={pop.toggle} aria-label={`Performance month, ${month.label}`}>
        <Calendar size={14} aria-hidden="true" />
        <span>
          <span className="lbl-long">{month.label}</span>
          <span className="lbl-short">{short(month.label)}</span>
        </span>
        {month.state === "Locked" && <Lock size={14} aria-hidden="true" />}
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {pop.open && (
        <div className="pop from-tr" role="menu" style={{ right: 0, top: "calc(100% + 6px)", width: 290 }}>
          <div className="ph-l">Performance month</div>
          {[...ctx.months].reverse().map((m) => (
            <button
              type="button"
              key={m.id}
              role="menuitemradio"
              aria-checked={m.id === month.id}
              className={`pi ${m.id === month.id ? "sel" : ""}`}
              onClick={() => {
                pop.setOpen(false);
                setStoredMonth(m.id);
              }}
            >
              {m.state === "Locked" ? <Lock size={16} aria-hidden="true" /> : <Calendar size={16} aria-hidden="true" />}
              <span className="grow">
                {m.label}
                {m.illustrative ? " (demo)" : ""}
                <small>
                  {m.state === "Locked"
                    ? `Closed${m.locked_at ? ` ${fmtDate(m.locked_at)}` : ""}`
                    : m.id === ctx.current_month_id
                      ? "Open, month in progress"
                      : `Open, in review. Training cut-off ${fmtDate(m.training_cutoff)}`}
                </small>
              </span>
              {m.id === month.id && <Check size={16} aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Notifications() {
  const pop = usePopover();
  const navigate = useNavigate();
  const notes = useApiQuery<Notice[]>("/notifications");
  const readAll = useApiMutation("post", "/notifications/read-all");
  const list = notes.data ?? [];
  const unread = list.filter((n) => !n.read).length;
  return (
    <div ref={pop.ref} style={{ position: "relative" }}>
      <button type="button" className="icon-btn" aria-label={`Notifications, ${unread} unread`} aria-haspopup="dialog" aria-expanded={pop.open} onClick={pop.toggle}>
        {/* The badge is anchored to the icon, not the button, so it never covers or shifts the bell. */}
        <span className="bell">
          <Bell size={17} strokeWidth={1.75} aria-hidden="true" />
          {unread > 0 && (
            <span className="count-badge" aria-hidden="true">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </span>
      </button>
      {pop.open && (
        <div className="pop notif from-tr" style={{ right: 0, top: "calc(100% + 6px)" }}>
          <div className="nh">
            <b>Notifications</b>
            {unread > 0 && (
              <button type="button" className="link-btn small" style={{ marginLeft: "auto" }} onClick={() => readAll.mutate({})}>
                Mark all as read
              </button>
            )}
          </div>
          {list.length === 0 ? (
            <div style={{ padding: "28px 16px", textAlign: "center" }} className="muted small">
              Nothing new. Decisions and returns will appear here.
            </div>
          ) : (
            list.slice(0, 8).map((n) => (
              <button
                type="button"
                key={n.id}
                className={`ni ${n.read ? "" : "unread"}`}
                onClick={() => {
                  pop.setOpen(false);
                  if (n.link) navigate(n.link);
                }}
              >
                <span className="st-ico" style={{ background: "var(--info-tint)", color: "var(--info)" }}>
                  <Clock size={11} aria-hidden="true" />
                </span>
                <span>
                  {n.title}
                  {n.body && <span className="small muted" style={{ display: "block" }}>{n.body}</span>}
                  <time>{fmtDateTime(n.created_at)}</time>
                </span>
              </button>
            ))
          )}
          <div className="small muted" style={{ padding: "10px 14px" }}>Notifications never approve work. Decisions happen on the record itself.</div>
        </div>
      )}
    </div>
  );
}
