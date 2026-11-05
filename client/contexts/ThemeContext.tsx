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

  // A11Y-01 (session 22, found live): the page takes the theme's text colour, so text with none of its own
  // (every screen's heading) doesn't fall back to the browser's black, unreadable on the dark themes.
  // PWA P2 (owner-approved, 2026-11-05): the phone's bars follow the theme too. <meta name="theme-color">
  // (the installed app's Android status bar) starts as Ledger ink from the layout, for the splash, and takes
  // the theme's ink here; the body takes the same ink, so a landscape notch's side strips and an overscroll
  // show the theme, not white.
  useEffect(() => {
    const { text, ink } = THEMES[theme];
    document.body.style.color = text;
    document.body.style.background = ink;
    let meta = document.head.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "theme-color";
      document.head.appendChild(meta);
    }
    meta.content = ink;
  }, [theme]);

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
