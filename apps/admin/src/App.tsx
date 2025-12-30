import { BrowserRouter, Routes, Route } from "react-router-dom";
import EpisodeList from "./pages/EpisodeList";
import EpisodeNew from "./pages/EpisodeNew";
import EpisodeDetail from "./pages/EpisodeDetail";
import Settings from "./pages/Settings";
import { EnvironmentBadge } from "./components/EnvironmentBadge";

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-zinc-950 text-zinc-100">
        <EnvironmentBadge />
        <Routes>
          <Route path="/" element={<EpisodeList />} />
          <Route path="/new" element={<EpisodeNew />} />
          <Route path="/episodes/:id" element={<EpisodeDetail />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}
