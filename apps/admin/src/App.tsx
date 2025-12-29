import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { PodcastProvider, usePodcast } from "./contexts/PodcastContext";
import EpisodeList from "./pages/EpisodeList";
import EpisodeNew from "./pages/EpisodeNew";
import EpisodeDetail from "./pages/EpisodeDetail";
import Settings from "./pages/Settings";
import PodcastList from "./pages/PodcastList";

function RequirePodcast({ children }: { children: React.ReactNode }) {
  const { currentPodcast, isLoading, podcasts } = usePodcast();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center">
        <div className="w-8 h-8 border-3 border-zinc-700 border-t-violet-500 rounded-full animate-spin" />
      </div>
    );
  }

  // No podcasts exist, redirect to create one
  if (podcasts.length === 0) {
    return <Navigate to="/podcasts" replace />;
  }

  // No podcast selected (shouldn't happen normally)
  if (!currentPodcast) {
    return <Navigate to="/podcasts" replace />;
  }

  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      {/* Podcast management (always accessible) */}
      <Route path="/podcasts" element={<PodcastList />} />

      {/* Routes that require a selected podcast */}
      <Route
        path="/"
        element={
          <RequirePodcast>
            <EpisodeList />
          </RequirePodcast>
        }
      />
      <Route
        path="/new"
        element={
          <RequirePodcast>
            <EpisodeNew />
          </RequirePodcast>
        }
      />
      <Route
        path="/episodes/:id"
        element={
          <RequirePodcast>
            <EpisodeDetail />
          </RequirePodcast>
        }
      />
      <Route
        path="/settings"
        element={
          <RequirePodcast>
            <Settings />
          </RequirePodcast>
        }
      />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <PodcastProvider>
        <div className="min-h-screen bg-zinc-950 text-zinc-100">
          <AppRoutes />
        </div>
      </PodcastProvider>
    </BrowserRouter>
  );
}
