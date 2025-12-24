import { BrowserRouter, Routes, Route } from "react-router-dom";
import EpisodeList from "./pages/EpisodeList";
import EpisodeNew from "./pages/EpisodeNew";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<EpisodeList />} />
        <Route path="/new" element={<EpisodeNew />} />
      </Routes>
    </BrowserRouter>
  );
}
