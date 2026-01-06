import { useState, useEffect, useCallback } from "react";

export type ThemeMode = "light" | "dark" | "system";

const STORAGE_KEY = "theme-mode";

function getSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(mode: ThemeMode) {
  const root = document.documentElement;
  const effectiveTheme = mode === "system" ? getSystemTheme() : mode;
  root.setAttribute("data-theme", effectiveTheme);
}

export function useTheme() {
  const [mode, setModeState] = useState<ThemeMode>(() => {
    if (typeof window === "undefined") return "system";
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") {
      return stored;
    }
    return "system";
  });

  // Apply theme on mount and when mode changes
  useEffect(() => {
    applyTheme(mode);
    localStorage.setItem(STORAGE_KEY, mode);
  }, [mode]);

  // Listen for system theme changes when in "system" mode
  useEffect(() => {
    if (mode !== "system") return;

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme("system");

    mediaQuery.addEventListener("change", handler);
    return () => mediaQuery.removeEventListener("change", handler);
  }, [mode]);

  const setMode = useCallback((newMode: ThemeMode) => {
    setModeState(newMode);
  }, []);

  const cycleTheme = useCallback(() => {
    setModeState((current) => {
      if (current === "system") return "light";
      if (current === "light") return "dark";
      return "system";
    });
  }, []);

  // Get the effective theme for display purposes
  const effectiveTheme = mode === "system" ? getSystemTheme() : mode;

  return {
    mode,
    effectiveTheme,
    setMode,
    cycleTheme,
  };
}
