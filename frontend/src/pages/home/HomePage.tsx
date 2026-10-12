import { CheckCircle2, Flag, GraduationCap, Star, Users, ShieldCheck, FileCheck2 } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import type { ActionItem, Person } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { Badge, Button, Card, Empty, ErrorState, Loading, PageHeader, Stat, Tabs } from "@/components/ui";
import { LineChart } from "@/components/ui/charts";
import { daysSince, fmtDate, fmtDateTime, fmtPct } from "@/lib/format";
import { useApiQuery } from "@/lib/hooks";

interface HomeData {
  today: string;
  role: string;
  employee: Person;
  period: { id: number; name: string; state: string } | null;
  stats: {
    active_projects: number;
    due_this_month: number;
    accepted_delivery: number | null;
    reviews_waiting: number;
    oldest_review: string | null;
    checkins: { done: number; total: number } | null;
    team_size: number;
  };
  actions: ActionItem[];
  rhythm: { label: string; accepted: number }[];
}

const ICONS: Record<string, JSX.Element> = {
  "Work review": <CheckCircle2 size={22} />,
  Validation: <Flag size={22} />,
  "Training review": <GraduationCap size={22} />,
  "Training exception": <GraduationCap size={22} />,
  "Check-in": <Users size={22} />,
  "R&R review": <Star size={22} />,
  Recognition: <Star size={22} />,
  "Policy approval": <ShieldCheck size={22} />,
  Closure: <FileCheck2 size={22} />,
  Request: <Flag size={22} />,
};
const ICON_TONE: Record<string, string> = { Validation: "red", Recognition: "amber", "R&R review": "amber", "Policy approval": "amber" };

const GROUPS: Record<string, string[]> = {
  all: [],
  work: ["Work review", "Closure", "Request"],
  validations: ["Validation", "Policy approval"],
  performance: ["Check-in"],
  training: ["Training review", "Training exception"],
  recognition: ["Recognition", "R&R review"],
};

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export function HomePage() {
  const { account } = useAuth();
  const navigate = useNavigate();
  const [group, setGroup] = useState<keyof typeof GROUPS>("all");
  const [showInbox, setShowInbox] = useState(false);
  const { data, isLoading, error } = useApiQuery<HomeData>("/home");
  if (isLoading) return <Loading rows={3} />;
  if (error || !data) return <ErrorState error={error} />;

  const role = account!.role;
  const actions = group === "all" ? data.actions : data.actions.filter((a) => GROUPS[group].includes(a.type));
  const reviews = data.actions.filter((a) => a.type === "Work review").length;
  const nextLine =
    role === "team_lead"
      ? "Keep your team's work up to date. Private KPI, check-in and training scores are not part of your view."
      : role === "hod"
        ? "Review your departments and the decisions that need your authority."
        : `${reviews} deliverable${reviews === 1 ? "" : "s"} need review. Your next action is ready.`;
  const title = role === "team_lead" ? "Keep your team's work up to date" : role === "hod" ? "Review your departments and required decisions" : `${greeting()}. Let's move work forward.`;

  return (
    <>
      <PageHeader
        title={title}
        sub={`${fmtDate(data.today)} / ${account!.headed_departments.join(", ") || data.employee.department} / ${role === "admin" ? "Organisation" : "My reporting team"}`}
        actions={
          <Button variant="primary" onClick={() => (role === "hod" || role === "admin" ? setShowInbox(true) : navigate("/tasks?tab=weekly"))}>
            {role === "hod" || role === "admin" ? "Open approvals" : "Update team work"}
          </Button>
        }
      />
      <div className="hero">
        <div>
          <span className="chip">THIS WEEK</span>
          <h2>Less chasing. More clarity.</h2>
        </div>
        <div className="green" style={{ flex: 1 }}>{nextLine}</div>
        <Button variant="primary" onClick={() => setShowInbox(true)}>Open action inbox</Button>
      </div>

      <div className="grid grid-4 mb">
        <Stat label="Active projects" value={data.stats.active_projects} hint={`${data.stats.due_this_month} due this month`} />
        <Stat label="Accepted delivery" value={fmtPct(data.stats.accepted_delivery)} hint="Accepted complexity / in-scope complexity" />
        <Stat label="Reviews waiting" value={data.stats.reviews_waiting} hint={data.stats.oldest_review ? `Oldest: ${daysSince(data.stats.oldest_review)} day(s)` : "Nothing waiting"} />
        {data.stats.checkins ? (
          <Stat label="Check-ins completed" value={`${data.stats.checkins.done} / ${data.stats.checkins.total}`} hint={`${data.stats.checkins.total - data.stats.checkins.done} still due this month`} />
        ) : (
          <Stat label="People in scope" value={data.stats.team_size} hint="Reporting tree" />
        )}
      </div>

      <div className="grid grid-main">
        <Card title="Needs your attention" sub="One place for work reviews, validations and people decisions">
          {(showInbox || group !== "all") && (
            <Tabs
              value={group}
              onChange={setGroup}
              tabs={[
                { id: "all", label: `All actions (${data.actions.length})` },
                { id: "work", label: "Work reviews" },
                { id: "validations", label: "Validations" },
                { id: "performance", label: "Performance", hidden: role === "team_lead" },
                { id: "training", label: "Training" },
                { id: "recognition", label: "Recognition", hidden: role === "team_lead" },
              ]}
            />
          )}
          {actions.length === 0 && <Empty title="You're all caught up">No decisions are waiting in your scope.</Empty>}
          {(showInbox ? actions : actions.slice(0, 6)).map((a, i) => (
            <div className="inbox-item" key={i}>
              <div className={`inbox-icon ${ICON_TONE[a.type] ?? ""}`}>{ICONS[a.type] ?? <CheckCircle2 size={22} />}</div>
              <div className="grow">
                <h4>{a.title}</h4>
                <div className="muted small">
                  <Badge tone="grey">{a.type}</Badge> {a.context} {a.since && <>· waiting since {fmtDateTime(a.since)}</>}
                </div>
              </div>
              <button className="link-btn" onClick={() => navigate(a.link)}>{a.action}</button>
            </div>
          ))}
          {!showInbox && actions.length > 6 && <Button className="mt" onClick={() => setShowInbox(true)}>Show all {actions.length} actions</Button>}
        </Card>
        <div className="stack">
          <Card title="Delivery rhythm" sub="Accepted tasks per week / last 6 weeks">
            <LineChart label="Accepted tasks per week" points={data.rhythm.map((r) => ({ label: r.label, value: r.accepted }))} />
          </Card>
          {data.period && (
            <Card>
              <div className="row between">
                <div>
                  <b>Performance period</b>
                  <div className="muted">{data.period.name}</div>
                </div>
                <Badge status={data.period.state} />
              </div>
              {role !== "team_lead" && <Button className="mt" onClick={() => navigate("/performance")}>Open performance hub</Button>}
            </Card>
          )}
          <p className="small muted">Updated {fmtDateTime(new Date().toISOString())} · Notifications and approvals stay separate.</p>
        </div>
      </div>
    </>
  );
}
