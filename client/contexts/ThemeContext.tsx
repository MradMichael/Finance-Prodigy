"use client";

import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { THEMES, getStoredTheme, setStoredTheme, type ThemeKey, type ThemeColors } from "../lib/theme";

interface ThemeCtx {
  T: ThemeColors;
  theme: ThemeKey;
  setTheme: (k: ThemeKey) => void;
}

const Ctx = createContext<ThemeCtx | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeKey>("ivory");

  useEffect(() => {
    setThemeState(getStoredTheme());
  }, []);

  function setTheme(k: ThemeKey) {
    setStoredTheme(k);
    setThemeState(k);
    document.documentElement.setAttribute("data-theme", k);
  }

  return (
    <Ctx.Provider value={{ T: THEMES[theme], theme, setTheme }}>
      {children}
    </Ctx.Provider>
  );
}

const FALLBACK = THEMES.ivory;

export function useTheme(): ThemeColors {
  const ctx = useContext(Ctx);
  return ctx ? ctx.T : FALLBACK;
}

export function useThemeControl(): { theme: ThemeKey; setTheme: (k: ThemeKey) => void } {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useThemeControl must be inside ThemeProvider");
  return { theme: ctx.theme, setTheme: ctx.setTheme };
}
