import { BrowserRouter, Routes, Route } from "react-router-dom";
import EpisodeList from "./pages/EpisodeList";
import EpisodeNew from "./pages/EpisodeNew";
import EpisodeDetail from "./pages/EpisodeDetail";
import Settings from "./pages/Settings";
import { Sidebar } from "./components/Sidebar";
import { EnvironmentBadge } from "./components/EnvironmentBadge";
import { TaskTray } from "./components/TaskTray";
import { useBackgroundTasks } from "./hooks/useBackgroundTasks";

function AppContent() {
  // バックグラウンドタスクを起動時に実行
  useBackgroundTasks();

  return (
    <div className="min-h-screen bg-[var(--color-bg-base)] text-[var(--color-text-primary)]">
      <Sidebar />
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
      <AppContent />
    </BrowserRouter>
  );
}
