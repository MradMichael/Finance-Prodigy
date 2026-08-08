"use client";

// Privacy-respecting product analytics: opt-in, defaulted to on, no
// third-party SDK, no user identity attached — just aggregate counts of a
// closed set of named events, sent to our own server (see
// server/src/routes/events.ts) and logged, not to any ad/analytics network.
// Without this there's no way to know whether onboarding actually works,
// which undercuts the point of having built it. Still a real opt-OUT,
// not mandatory: Profile → Help improve ESSA can turn it off at any time.

const OPT_IN_KEY = "essa_analytics_opt_in";

export type AnalyticsEvent =
  | "onboarding_step_income"
  | "onboarding_step_transaction"
  | "onboarding_step_overview";

export function isAnalyticsOptedIn(): boolean {
  if (typeof window === "undefined") return false;
  const stored = localStorage.getItem(OPT_IN_KEY);
  // No explicit choice yet -> the current default (on). Once the user (or
  // setAnalyticsOptIn's own default-stamping below) has written a real
  // value, that explicit choice always wins over whatever the default is.
  if (stored === null) return true;
  return stored === "1";
}

export function setAnalyticsOptIn(optIn: boolean): void {
  localStorage.setItem(OPT_IN_KEY, optIn ? "1" : "0");
}

export function trackEvent(event: AnalyticsEvent): void {
  if (!isAnalyticsOptedIn()) return;
  fetch("/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event }),
  }).catch(() => {}); // best-effort, never surfaced to the user
}
