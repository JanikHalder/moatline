import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark" | "system";

/** Kept in sync with the inline bootstrap script in index.html. */
export const THEME_KEY = "pc-theme";

function isTheme(value: string | null): value is Theme {
  return value === "light" || value === "dark" || value === "system";
}

export function getStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return isTheme(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

export function resolveTheme(theme: Theme): "light" | "dark" {
  if (theme !== "system") return theme;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle(
    "dark",
    resolveTheme(theme) === "dark"
  );
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Private mode / storage disabled – the theme just won't persist.
  }
}

export function useTheme(): {
  theme: Theme;
  resolved: "light" | "dark";
  setTheme: (t: Theme) => void;
} {
  const [theme, setThemeState] = useState<Theme>(() =>
    typeof window === "undefined" ? "system" : getStoredTheme()
  );

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    applyTheme(next);
  }, []);

  // "system" has to keep following the OS while the tab stays open.
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  return { theme, resolved: resolveTheme(theme), setTheme };
}
