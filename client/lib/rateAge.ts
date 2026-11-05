import { calendarDaysSince, LBP_RATE_STALE_DAYS } from "./localData";

/**
 * Days without a rate edit or confirm before the rate is worth a mention.
 * Under this it is "fresh" and nothing says anything. Moved here unchanged
 * from CurrencyScreen's RateStaleness (`days < 3`).
 */
export const RATE_NUDGE_DAYS = 3;

export type RateAgeLevel = "fresh" | "nudge" | "stale";

/**
 * Rate staleness, phase 3 (owner-approved 2026-11-05): how old the LBP rate
 * is and what that means, said once. Read by CurrencyScreen's warning,
 * computeDashboard's `rate-stale` alert and the entry form's RateAgeChip,
 * so the three cannot drift apart (§6.5 #3).
 *
 * `ageDays` is whole LOCAL calendar days (COPY-08, calendarDaysSince), not
 * elapsed 24-hour periods. Null when the rate has never been edited: a rate
 * nobody set has not been neglected (owner's answer 3, and the rule both
 * existing readers already had).
 */
export function rateAge(updatedAt: string | undefined, now: Date = new Date()): { ageDays: number; level: RateAgeLevel } | null {
  if (!updatedAt) return null;
  const ageDays = calendarDaysSince(updatedAt, now);
  const level: RateAgeLevel = ageDays >= LBP_RATE_STALE_DAYS ? "stale" : ageDays >= RATE_NUDGE_DAYS ? "nudge" : "fresh";
  return { ageDays, level };
}
