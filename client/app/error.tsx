"use client";

import { useEffect } from "react";
import { useTheme } from "../contexts/ThemeContext";

// Catches any render/runtime error in a page or its children and shows a
// friendly screen instead of Next's default crash page — this renders
// inside the root layout's ThemeProvider, so it can still use the theme.
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const T = useTheme();

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: T.ink }}>
      <div className="max-w-sm text-center space-y-4">
        <div className="text-4xl">⚠️</div>
        <h1 className="text-xl font-medium" style={{ color: T.text, fontFamily: "Spectral, Georgia, serif" }}>
          Something went wrong
        </h1>
        <p className="text-sm" style={{ color: T.mute }}>
          Your financial data is safe — it lives in your browser, not on this screen. Try again, or reload the page.
        </p>
        <button
          onClick={reset}
          className="px-5 py-2.5 rounded-xl text-sm font-semibold transition-all hover:opacity-90"
          style={{ background: T.jade, color: T.ink }}
        >
          Try again
        </button>
      </div>
    </div>
  );
}
