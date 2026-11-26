import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ClipViewer } from "./pages/ClipViewer";
import { TranscriptTruth } from "./pages/TranscriptTruth";
import { ReviewCards } from "./pages/ReviewCards";
import EpisodeList from "./pages/EpisodeList";
import EpisodeNew from "./pages/EpisodeNew";
import EpisodeDetail from "./pages/EpisodeDetail";
import Settings from "./pages/Settings";
import { Shell } from "./components/Shell";
import { EnvironmentBadge } from "./components/EnvironmentBadge";
import { TaskTray } from "./components/TaskTray";
import { useBackgroundTasks } from "./hooks/useBackgroundTasks";

function AppContent() {
  // バックグラウンドタスクを起動時に実行
  useBackgroundTasks();

  return (
    <div className="min-h-screen bg-[var(--color-bg-base)] text-[var(--color-text-primary)]">
      <Shell>
        <EnvironmentBadge />
        <Routes>
          <Route path="/" element={<EpisodeList />} />
          <Route path="/new" element={<EpisodeNew />} />
          <Route path="/episodes/:id" element={<EpisodeDetail />} />
          <Route path="/episodes/:id/clips/:clipId" element={<ClipViewer />} />
          <Route path="/episodes/:id/truth" element={<TranscriptTruth />} />
          <Route path="/episodes/:id/review" element={<ReviewCards />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </Shell>
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
