import { Navigate, Route, Routes } from "react-router-dom";

import { useAuth } from "./auth/AuthContext";
import { AppShell } from "./components/layout/AppShell";
import { Loading } from "./components/ui";
import { AdministrationPage } from "./pages/admin/AdministrationPage";
import { RulesStudioPage } from "./pages/admin/RulesStudioPage";
import { WorkflowsDataPage } from "./pages/admin/WorkflowsDataPage";
import { HomePage } from "./pages/home/HomePage";
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

/** 14 essential screens. Detailed states live in tabs, drawers and workflow states. */
export function App() {
  const { account, loading, isRole } = useAuth();
  if (loading) return <div className="content"><Loading rows={3} /></div>;
  if (!account) return <LoginPage />;
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
        <Route path="*" element={<Navigate to="/home" replace />} />
      </Route>
    </Routes>
  );
}
