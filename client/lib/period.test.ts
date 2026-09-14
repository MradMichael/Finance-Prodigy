// The period primitive.
//
// Phase 1 wires this in at startDay 1, where every function is a no-op
// restatement of the calendar arithmetic it replaces — so the tests that
// matter most here are the startDay-1 identities (proving the threading is
// safe) and the non-1 cases (proving the primitive is actually correct for
// Phase 2, rather than a stub that happens to pass because 1 is trivial).
//
// Testing the non-1 behaviour now is deliberate. If it were left until
// Phase 2, Phase 1 would ship a primitive whose only exercised
// configuration is the one it replaced, and the first real use would be its
// first test.
import { describe, it, expect } from "vitest";
import {
  CYCLE_START_DAY, calendarKeyForDate, calendarKeyForISO, cycleKeyForDate,
  cycleKeyForISO, currentCycleKey, cycleBounds, cycleKeyMinus, isInCycle,
  cycleProgress, cycleLabel, cycleLabelLong, cycleTickLabel, ymKeyToCycleKey, type CycleKey,
} from "./period";

const k = (s: string) => s as CycleKey;

describe("startDay 1 — the Phase 1 identity, which is what makes the threading safe", () => {
  it("a cycle key is the date's own calendar month", () => {
    expect(cycleKeyForDate(new Date(2026, 8, 13), 1)).toBe("2026-09");
    expect(cycleKeyForDate(new Date(2026, 8, 1), 1)).toBe("2026-09");
    expect(cycleKeyForDate(new Date(2026, 8, 30), 1)).toBe("2026-09");
  });

  it("cycleKeyForISO matches the slice(0,7) it replaces, across a year boundary", () => {
    for (const iso of ["2026-01-01", "2026-09-13", "2026-12-31", "2027-01-01"]) {
      expect(cycleKeyForISO(iso, 1)).toBe(iso.slice(0, 7));
    }
  });

  it("isInCycle matches the startsWith(ym) membership test it replaces", () => {
    expect(isInCycle("2026-09-13", k("2026-09"), 1)).toBe(true);
    expect(isInCycle("2026-08-31", k("2026-09"), 1)).toBe(false);
    expect(isInCycle("2026-10-01", k("2026-09"), 1)).toBe(false);
  });

  it("cycleProgress matches now.getDate() / daysInMonth", () => {
    expect(cycleProgress(new Date(2026, 8, 13), 1)).toEqual({ daysInto: 13, daysInCycle: 30 });
    expect(cycleProgress(new Date(2026, 1, 5), 1)).toEqual({ daysInto: 5, daysInCycle: 28 });   // Feb 2026
    expect(cycleProgress(new Date(2026, 0, 31), 1)).toEqual({ daysInto: 31, daysInCycle: 31 });
  });

  it("cycleBounds spans exactly the calendar month", () => {
    const { start, end } = cycleBounds(k("2026-09"), 1);
    expect(start.getDate()).toBe(1);
    expect(start.getMonth()).toBe(8);
    expect(end.getDate()).toBe(1);
    expect(end.getMonth()).toBe(9); // exclusive
  });
});

describe("startDay 27 — the Phase 2 behaviour, tested now so the primitive is not a stub", () => {
  it("a date on or after the start day belongs to the cycle starting that month", () => {
    expect(cycleKeyForDate(new Date(2026, 8, 27), 27)).toBe("2026-09");
    expect(cycleKeyForDate(new Date(2026, 8, 30), 27)).toBe("2026-09");
  });

  it("a date BEFORE the start day belongs to the previous month's cycle — the case a slice cannot express", () => {
    expect(cycleKeyForDate(new Date(2026, 8, 26), 27)).toBe("2026-08");
    expect(cycleKeyForDate(new Date(2026, 8, 1), 27)).toBe("2026-08");
  });

  it("crosses a year boundary correctly in both directions", () => {
    expect(cycleKeyForDate(new Date(2027, 0, 3), 27)).toBe("2026-12");
    expect(cycleKeyForDate(new Date(2026, 11, 27), 27)).toBe("2026-12");
  });

  it("cycle bounds run start-day to start-day, exclusive at the end", () => {
    const { start, end } = cycleBounds(k("2026-09"), 27);
    expect(start.getMonth()).toBe(8); expect(start.getDate()).toBe(27);
    expect(end.getMonth()).toBe(9);   expect(end.getDate()).toBe(27);
  });

  it("progress is measured from the cycle start, not from the 1st", () => {
    // 28 Sep under a 27th cycle is day 2, not day 28.
    expect(cycleProgress(new Date(2026, 8, 28), 27)).toEqual({ daysInto: 2, daysInCycle: 30 });
    // 26 Sep is the LAST day of the cycle that began 27 Aug (31 days).
    expect(cycleProgress(new Date(2026, 8, 26), 27)).toEqual({ daysInto: 31, daysInCycle: 31 });
  });

  it("membership follows the cycle, so a transaction on the 26th is the PREVIOUS period", () => {
    expect(isInCycle("2026-09-26", k("2026-09"), 27)).toBe(false);
    expect(isInCycle("2026-09-26", k("2026-08"), 27)).toBe(true);
    expect(isInCycle("2026-09-27", k("2026-09"), 27)).toBe(true);
  });
});

describe("start days past the end of a short month clamp, matching nextOccurrence", () => {
  it("a 31st start day lands on the last day of a 30-day month", () => {
    const { start } = cycleBounds(k("2026-09"), 31); // September has 30 days
    expect(start.getDate()).toBe(30);
  });

  it("a 30th start day lands on the last day of February", () => {
    const { start } = cycleBounds(k("2026-02"), 30);
    expect(start.getDate()).toBe(28); // 2026 is not a leap year
  });

  it("clamping keeps exactly one cycle per calendar month — the property key ordering relies on", () => {
    // If clamping ever produced two cycles in a month, or none, the bijection
    // with calendar months breaks and with it valueForMonth's lexical scan.
    const keys = new Set<string>();
    for (let m = 0; m < 12; m++) {
      for (let d = 1; d <= 28; d++) keys.add(cycleKeyForDate(new Date(2026, m, d), 31));
    }
    expect(keys.size).toBe(12);
  });
});

describe("key ordering — valueForMonth degrades silently if this ever stops holding", () => {
  it("lexical order matches chronological order across a year boundary", () => {
    const chronological = ["2026-10", "2026-11", "2026-12", "2027-01", "2027-02"];
    expect([...chronological].sort()).toEqual(chronological);
  });

  it("cycleKeyMinus steps backwards and stays sortable", () => {
    expect(cycleKeyMinus(k("2027-01"), 1)).toBe("2026-12");
    expect(cycleKeyMinus(k("2026-09"), 6)).toBe("2026-03");
    expect(cycleKeyMinus(k("2026-01"), 1)).toBe("2025-12");
  });
});

describe("calendar keys stay a separate space", () => {
  it("calendarKeyForDate and calendarKeyForISO agree", () => {
    expect(calendarKeyForDate(new Date(2026, 8, 13))).toBe("2026-09");
    expect(calendarKeyForISO("2026-09-13")).toBe("2026-09");
  });

  it("at startDay 27 a calendar key and a cycle key for the same date genuinely differ", () => {
    // The premise for branding: if these could never differ, the type
    // separation would be ceremony. On 1 September under a 27th cycle they
    // are different periods.
    const d = new Date(2026, 8, 1);
    expect(calendarKeyForDate(d)).toBe("2026-09");
    expect(cycleKeyForDate(d, 27)).toBe("2026-08");
  });
});

describe("Phase 1 is inert", () => {
  it("CYCLE_START_DAY is 1 — Phase 2 changes this constant, nothing else here", () => {
    expect(CYCLE_START_DAY).toBe(1);
  });

  it("currentCycleKey is the current calendar month", () => {
    expect(currentCycleKey(new Date(2026, 8, 13), 1)).toBe("2026-09");
  });
});

describe("cycleLabel — how a cycle is named to the user (form (b), explicit range)", () => {
  it("collapses to a plain month name at startDay 1, so nothing changes without a payday set", () => {
    expect(cycleLabel(k("2026-09"), 1)).toBe("Sep 2026");
    expect(cycleLabelLong(k("2026-09"), 1)).toBe("Sep 2026");
  });

  it("names the real range, not the month the key happens to carry", () => {
    // The key says 2026-09; the period is mostly October. Naming it "Sep 2026"
    // is the thing this form exists to avoid.
    expect(cycleLabel(k("2026-09"), 27)).toBe("27 Sep – 26 Oct");
  });

  it("crosses a year boundary without losing the year", () => {
    expect(cycleLabel(k("2026-12"), 27)).toBe("27 Dec – 26 Jan");
    expect(cycleLabelLong(k("2026-12"), 27)).toBe("27 Dec 2026 – 26 Jan 2027");
  });

  it("follows the clamp: a 31st payday in a 30-day month", () => {
    // September has 30 days, so the cycle starts on the 30th.
    expect(cycleLabel(k("2026-09"), 31)).toBe("30 Sep – 30 Oct");
  });

  it("the long form omits the first year when both ends share one", () => {
    expect(cycleLabelLong(k("2026-09"), 27)).toBe("27 Sep – 26 Oct 2026");
  });
});

describe("numeric ymKey labels — the axis form, which no brand can police", () => {
  // sixMonthTrend's ymKey is a CYCLE key reduced to a number for recharts.
  // A number carries no brand and no "month" word, so neither tsc nor
  // period-copy.test.ts can see a wrong label here (2.4.101). Pinned
  // directly instead.
  it("round-trips a numeric key back to the cycle key it came from", () => {
    expect(ymKeyToCycleKey(202608)).toBe("2026-08");
    expect(ymKeyToCycleKey(202601)).toBe("2026-01");
    expect(ymKeyToCycleKey(202612)).toBe("2026-12");
  });

  it("a tick names the cycle's START DATE, never the month the key carries", () => {
    // "Aug '26" for 27 Aug - 26 Sep is the rejected form (a): most of that
    // period is September.
    expect(cycleTickLabel(k("2026-08"), 27)).toBe("27 Aug");
    expect(cycleTickLabel(k("2026-08"), 27)).not.toMatch(/'26|Sep/);
  });

  it("collapses to the short month form at startDay 1, so no default chart changes", () => {
    expect(cycleTickLabel(k("2026-08"), 1)).toBe("Aug ’26");
  });

  it("the tick is SHORTER than the label it replaced, so it cannot overflow an axis that already fit", () => {
    // The reason a tick may not carry the full range at all: six of them
    // share ~48px each on a phone.
    expect(cycleTickLabel(k("2026-08"), 27).length)
      .toBeLessThanOrEqual(cycleTickLabel(k("2026-08"), 1).length);
    expect(cycleLabel(k("2026-08"), 27).length).toBeGreaterThan(cycleTickLabel(k("2026-08"), 27).length * 2);
  });
});
