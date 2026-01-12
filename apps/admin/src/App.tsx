import { BrowserRouter, Routes, Route } from "react-router-dom";
import EpisodeList from "./pages/EpisodeList";
import EpisodeNew from "./pages/EpisodeNew";
import EpisodeDetail from "./pages/EpisodeDetail";
import Settings from "./pages/Settings";
import { Sidebar } from "./components/Sidebar";
import { MobileHeader } from "./components/MobileHeader";
import { EnvironmentBadge } from "./components/EnvironmentBadge";
import { TaskTray } from "./components/TaskTray";
import { useBackgroundTasks } from "./hooks/useBackgroundTasks";
import { MobileMenuProvider } from "./contexts/MobileMenuContext";

function AppContent() {
  // バックグラウンドタスクを起動時に実行
  useBackgroundTasks();

  return (
    <div className="min-h-screen bg-[var(--color-bg-base)] text-[var(--color-text-primary)]">
      <Sidebar />
      <MobileHeader />
      <main className="main-content">
        <EnvironmentBadge />
        <Routes>
          <Route path="/" element={<EpisodeList />} />
          <Route path="/new" element={<EpisodeNew />} />
          <Route path="/episodes/:id" element={<EpisodeDetail />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
      <TaskTray />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <MobileMenuProvider>
        <AppContent />
      </MobileMenuProvider>
    </BrowserRouter>
  );
}
