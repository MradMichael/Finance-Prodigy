// Rate staleness, phase 3 commit 1 (owner-approved 2026-11-05): one function
// says how old the rate is and what that means. Three readers -- the Currency
// screen's warning, the Overview alert, and the entry form's label -- read it
// rather than each restating "3 days" and "14 days" (§6.5 #3: a rule fixed in
// one place and repeated in another is the shape 2.4.137 shipped).
// Behaviour unchanged: these pin the thresholds the two existing readers had.
import { describe, it, expect } from "vitest";
import { rateAge, RATE_NUDGE_DAYS } from "./rateAge";
import { LBP_RATE_STALE_DAYS } from "./localData";

const NOW = new Date(2026, 10, 5, 10);
const editedDaysAgo = (n: number, hour = 9) => new Date(2026, 10, 5 - n, hour).toISOString();

describe("rateAge", () => {
  it("a rate never edited has no age (owner's answer 3: silent)", () => {
    expect(rateAge(undefined, NOW)).toBeNull();
  });

  it("the thresholds are the ones already shipped: nudge from 3, stale from 14", () => {
    expect(RATE_NUDGE_DAYS).toBe(3);
    expect(LBP_RATE_STALE_DAYS).toBe(14);
  });

  it.each([
    [0, "fresh"], [2, "fresh"],
    [3, "nudge"], [13, "nudge"],
    [14, "stale"], [40, "stale"],
  ] as const)("%i days: %s", (days, level) => {
    expect(rateAge(editedDaysAgo(days), NOW)).toEqual({ ageDays: days, level });
  });

  it("counts calendar days, as calendarDaysSince does (COPY-08): 23 hours short of 14 days is still 14", () => {
    expect(rateAge(new Date(2026, 9, 22, 11).toISOString(), NOW)).toEqual({ ageDays: 14, level: "stale" });
  });

  it("defaults to the clock", () => {
    expect(rateAge(new Date().toISOString())).toEqual({ ageDays: 0, level: "fresh" });
  });
});
