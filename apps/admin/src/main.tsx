import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { getEnvironment } from "./lib/env";

// 開発環境でErudaを有効化（モバイルデバッグ用）
const env = getEnvironment();
if (env === "local" || env === "preview") {
  import("eruda").then((eruda) => {
    eruda.default.init();
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
