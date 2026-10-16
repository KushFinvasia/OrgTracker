import { Navigate, Route, Routes } from "react-router-dom";

import { useAuth } from "./auth/AuthContext";
import { AppShell } from "./components/layout/AppShell";
import { Loading } from "./components/ui";
import { AdministrationPage } from "./pages/admin/AdministrationPage";
import { RulesStudioPage } from "./pages/admin/RulesStudioPage";
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
import { EvaluationPage } from "./pages/performance/EvaluationPage";
import { PerformanceHubPage } from "./pages/performance/PerformanceHubPage";
import { PersonWorkspacePage } from "./pages/people/PersonWorkspacePage";
import { PortfolioPage } from "./pages/projects/PortfolioPage";
import { ProjectWorkspacePage } from "./pages/projects/ProjectWorkspacePage";
import { ReportsPage } from "./pages/reports/ReportsPage";
import { NominationPage } from "./pages/rewards/NominationPage";
import { RewardsPage } from "./pages/rewards/RewardsPage";
import { TasksPage } from "./pages/tasks/TasksPage";
import { TeamPage } from "./pages/team/TeamPage";
import { homeFor, startTier } from "./lib/tier";

/**
 * Two tiers. Project Tier: the 14-screen delivery build (Home, Projects, Tasks in the nav; the older Team, Performance,
 * Rewards and Reports screens stay reachable from its links). Individual Tier: the Sales pilot under /individual.
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
        <Route path="/team" element={<TeamPage />} />
        <Route path="/people/:id" element={<PersonWorkspacePage />} />
        <Route path="/performance" element={<PerformanceHubPage />} />
        <Route path="/performance/:person/:period" element={<EvaluationPage />} />
        <Route path="/rewards" element={<RewardsPage />} />
        <Route path="/rewards/nominations/:id" element={<NominationPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/admin" element={isRole("admin") ? <AdministrationPage /> : <Navigate to="/home" replace />} />
        <Route path="/admin/rules" element={isRole("admin", "hod") ? <RulesStudioPage /> : <Navigate to="/home" replace />} />
        <Route path="/admin/workflows" element={isRole("admin", "hod", "manager") ? <WorkflowsDataPage /> : <Navigate to="/home" replace />} />
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
