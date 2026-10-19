import { Navigate, Route, Routes } from "react-router-dom";

import { useAuth } from "./auth/AuthContext";
import { AppShell } from "./components/layout/AppShell";
import { Loading } from "./components/ui";
import { AdministrationPage } from "./pages/admin/AdministrationPage";
import { WorkflowsDataPage } from "./pages/admin/WorkflowsDataPage";
import { HomePage } from "./pages/home/HomePage";
import { IndividualHomePage } from "./pages/individual/IndividualHomePage";
import { IndividualPerformancePage } from "./pages/individual/IndividualPerformancePage";
import { IndividualReportsPage } from "./pages/individual/IndividualReportsPage";
import { IndividualRewardsPage } from "./pages/individual/IndividualRewardsPage";
import { IndividualTeamPage } from "./pages/individual/IndividualTeamPage";
import { KpiScoringPage } from "./pages/individual/KpiScoringPage";
import { ScorecardPage } from "./pages/individual/ScorecardPage";
import { TeamPersonPage } from "./pages/individual/TeamPersonPage";
import { PreferencesPage } from "./pages/home/PreferencesPage";
import { LoginPage } from "./pages/LoginPage";
import { PersonWorkspacePage } from "./pages/people/PersonWorkspacePage";
import { PortfolioPage } from "./pages/projects/PortfolioPage";
import { ProjectWorkspacePage } from "./pages/projects/ProjectWorkspacePage";
import { TasksPage } from "./pages/tasks/TasksPage";
import { homeFor, startTier } from "./lib/tier";

/**
 * Two tiers. Project Tier: Home, Projects, Tasks (and people's assigned work). Individual Tier: the Sales pilot under /individual
 * (people, KPIs, check-ins, training, results, rewards). The old quarterly performance screens were retired.
 */
export function App() {
  const { account, loading, isRole } = useAuth();
  if (loading) return <div className="content"><Loading rows={3} /></div>;
  if (!account) return <LoginPage />;
  const start = homeFor(startTier(account));
  const pilot = !!account.in_pilot;
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/home" element={<HomePage />} />
        <Route path="/settings" element={<PreferencesPage />} />
        <Route path="/projects" element={<PortfolioPage />} />
        <Route path="/projects/:id" element={<ProjectWorkspacePage />} />
        <Route path="/tasks" element={<TasksPage />} />
        <Route path="/people/:id" element={<PersonWorkspacePage />} />
        <Route path="/admin" element={isRole("admin") ? <AdministrationPage /> : <Navigate to="/home" replace />} />
        <Route path="/admin/workflows" element={isRole("admin", "hod", "manager") ? <WorkflowsDataPage /> : <Navigate to="/home" replace />} />
        {/* The old quarterly screens were retired; their links now open the Individual Tier equivalents. */}
        <Route path="/team" element={<Navigate to={pilot ? "/individual/team" : "/home"} replace />} />
        <Route path="/performance/*" element={<Navigate to={pilot ? "/individual/performance" : "/home"} replace />} />
        <Route path="/rewards/*" element={<Navigate to={pilot ? "/individual/rewards" : "/home"} replace />} />
        <Route path="/reports" element={<Navigate to={pilot ? "/individual/reports" : "/home"} replace />} />
        <Route path="/individual" element={<Navigate to="/individual/home" replace />} />
        <Route path="/individual/home" element={pilot ? <IndividualHomePage /> : <Navigate to="/home" replace />} />
        <Route path="/individual/team" element={pilot ? <IndividualTeamPage /> : <Navigate to="/home" replace />} />
        <Route path="/individual/team/:person" element={pilot ? <TeamPersonPage /> : <Navigate to="/home" replace />} />
        <Route path="/individual/performance" element={pilot ? <IndividualPerformancePage /> : <Navigate to="/home" replace />} />
        <Route path="/individual/performance/:person/:month" element={pilot ? <ScorecardPage /> : <Navigate to="/home" replace />} />
        <Route path="/individual/rewards" element={pilot ? <IndividualRewardsPage /> : <Navigate to="/home" replace />} />
        <Route path="/individual/reports" element={pilot ? <IndividualReportsPage /> : <Navigate to="/home" replace />} />
        <Route path="/individual/kpi-scoring" element={isRole("admin") ? <KpiScoringPage /> : <Navigate to="/individual/home" replace />} />
        <Route path="*" element={<Navigate to={start} replace />} />
      </Route>
    </Routes>
  );
}
