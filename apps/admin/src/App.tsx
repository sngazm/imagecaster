import { BrowserRouter, Routes, Route } from "react-router-dom";
import EpisodeList from "./pages/EpisodeList";
import EpisodeNew from "./pages/EpisodeNew";
import EpisodeDetail from "./pages/EpisodeDetail";
import Settings from "./pages/Settings";
import { EnvironmentBadge } from "./components/EnvironmentBadge";
import { TaskTray } from "./components/TaskTray";
import { useBackgroundTasks } from "./hooks/useBackgroundTasks";

function AppContent() {
  // バックグラウンドタスクを起動時に実行
  useBackgroundTasks();

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <EnvironmentBadge />
      <Routes>
        <Route path="/" element={<EpisodeList />} />
        <Route path="/new" element={<EpisodeNew />} />
        <Route path="/episodes/:id" element={<EpisodeDetail />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
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
