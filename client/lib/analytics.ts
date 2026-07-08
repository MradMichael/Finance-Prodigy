"use client";

// Privacy-respecting product analytics: opt-in (off by default), no
// third-party SDK, no user identity attached — just aggregate counts of a
// closed set of named events, sent to our own server (see
// server/src/routes/events.ts) and logged, not to any ad/analytics network.
// Without this there's no way to know whether onboarding actually works,
// which undercuts the point of having built it.

const OPT_IN_KEY = "essa_analytics_opt_in";

export type AnalyticsEvent =
  | "onboarding_step_income"
  | "onboarding_step_transaction"
  | "onboarding_step_overview";

export function isAnalyticsOptedIn(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(OPT_IN_KEY) === "1";
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
