"use client";

import { useState, useEffect } from "react";
import { useTheme } from "../contexts/ThemeContext";
import type { Screen } from "./screens/shared";
import { trackEvent } from "../lib/analytics";

const SERIF = { fontFamily: "Spectral, Georgia, serif" };
const DISMISS_KEY = "essa_onboarding_dismissed";

/**
 * A brief-lived nudge for a genuinely fresh account (no income set yet,
 * gated by the caller) — three concrete next steps instead of a blank
 * Setup screen. This is a niche, word-of-mouth product, not one with a paid
 * acquisition funnel behind it; a fast first "aha" moment matters more here
 * than for an app onboarding people already primed by an ad.
 */
export default function OnboardingChecklist({
  hasIncome, hasTransactions, onNavigate,
}: {
  hasIncome: boolean;
  hasTransactions: boolean;
  onNavigate: (screen: Screen) => void;
}) {
  const T = useTheme();
  const [dismissed, setDismissed] = useState(true); // default true to avoid a server/client render mismatch on first paint

  useEffect(() => {
    setDismissed(localStorage.getItem(DISMISS_KEY) === "1");
  }, []);

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
  }

  if (dismissed) return null;

  const steps = [
    { done: hasIncome, label: "Set your monthly income", detail: "Unlocks your health score, budget targets, and every projection.", action: () => { trackEvent("onboarding_step_income"); onNavigate("setup"); } },
    { done: hasTransactions, label: "Log your first transaction", detail: "Real spending, not a demo. Takes about 10 seconds.", action: () => { trackEvent("onboarding_step_transaction"); onNavigate("finances"); } },
    { done: false, label: "Come back to Overview", detail: "See your health score and where you actually stand.", action: () => { trackEvent("onboarding_step_overview"); onNavigate("overview"); } },
  ];

  return (
    <div className="rounded-2xl p-5" style={{ background: T.panel, border: `1px solid ${T.jade}40` }}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-widest" style={{ color: T.jade }}>Get started</p>
          <h2 className="text-lg mt-0.5" style={{ ...SERIF, color: T.text }}>Three steps to your first real picture</h2>
        </div>
        <button
          onClick={dismiss}
          className="text-xs px-2 py-1 rounded-lg transition-opacity hover:opacity-70 flex-shrink-0"
          style={{ color: T.mute }}
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
      <div className="mt-4 space-y-2">
        {steps.map((s, i) => (
          <button
            key={s.label}
            onClick={s.action}
            className="w-full flex items-center gap-3 text-left rounded-xl px-3 py-2.5 transition-all hover:opacity-90"
            style={{ background: T.panelSoft }}
          >
            <span
              className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
              style={{
                background: s.done ? T.jade : "transparent",
                border: `1.5px solid ${s.done ? T.jade : T.line}`,
                color: s.done ? T.ink : T.mute,
              }}
            >
              {s.done ? "✓" : i + 1}
            </span>
            <span className="flex-1 min-w-0">
              <p className="text-sm" style={{ color: s.done ? T.mute : T.text, textDecoration: s.done ? "line-through" : "none" }}>
                {s.label}
              </p>
              <p className="text-[11px] mt-0.5" style={{ color: T.mute }}>{s.detail}</p>
            </span>
            <span style={{ color: T.mute }}>→</span>
          </button>
        ))}
      </div>
    </div>
  );
}
