// Review fix 3 (owner, 2026-11-10): the before-ledger stamp (2.8.2) counts as a
// day only when it names a REAL calendar day. localDayOfStamp checked the shape
// alone (NNNN-NN-NN), so "2026-13-45" came back as the day a goal was achieved
// (found by running it in the review). A stamp like that can only come from a
// hand-edited or damaged import, since the app's own writers stamp real days;
// read as a date it would print as one.
//
// The check is lib/calendarDay.ts's own round trip: dayStart(day) builds the
// UTC midnight, occurrenceDay reads the day back, and a real day comes back
// unchanged. Month 13 gives no date at all; 30 February rolls over to March
// and comes back different. (calendarDay.ts's asCalendarDay checks the shape
// only, and is not changed here.)
import { describe, it, expect } from "vitest";
import { DEFAULT_DATA, goalAchievement, type LocalFinancials, type StoredGoal, type StoredTransaction } from "./localData";

// Opening alone meets the target, so no row crosses and the stamp is the date.
const goal = (achievedAt: string | undefined, o: Partial<StoredGoal> = {}): StoredGoal =>
  ({ id: "g1", name: "Laptop", emoji: "💻", targetAmount: 100, currentAmount: 0, openingAmount: 150, currency: "USD", targetDate: "2027-03-01", achievedAt, ...o }) as StoredGoal;
const on = (g: StoredGoal, transactions: StoredTransaction[] = []) =>
  goalAchievement(g, { ...DEFAULT_DATA, goals: [g], transactions } as LocalFinancials);

describe("a day-shaped stamp that isn't a real day is no date", () => {
  it.each([
    ["month 13", "2026-13-45"],
    ["month 00", "2026-00-10"],
    ["day 00", "2026-05-00"],
    ["day 32", "2026-01-32"],
    ["30 February", "2026-02-30"],
    ["31 April", "2026-04-31"],
    ["29 February in a year that isn't a leap year", "2025-02-29"],
  ])("%s (%s): achieved, with no date", (_what, stamp) => {
    expect(on(goal(stamp))).toEqual({ achieved: true, on: null });
  });

  it("the same for a goal never migrated", () => {
    expect(on(goal("2026-13-45", { openingAmount: undefined, currentAmount: 150 }))).toEqual({ achieved: true, on: null });
  });
});

describe("a real day is kept as it is (unchanged)", () => {
  it.each(["2026-10-02", "2024-02-29", "2026-12-31", "2026-01-01", "1999-07-04"])("%s", (stamp) => {
    expect(on(goal(stamp))).toEqual({ achieved: true, on: stamp });
  });

  it("a crossing row's own date is the date, whatever the stamp says", () => {
    const g = goal("2026-13-45", { openingAmount: 0 });
    const row = { id: "r1", amount: 100, currency: "USD", bucket: "SAVINGS", description: "saved", date: "2026-06-01", goalId: "g1" } as StoredTransaction;
    expect(on(g, [row])).toEqual({ achieved: true, on: "2026-06-01" });
  });

  it("an instant is still read as a day, and text that isn't a date is still no date", () => {
    expect(on(goal("2026-10-02T12:00:00.000Z")).on).toMatch(/^2026-10-0[23]$/); // noon UTC: the 2nd, or the 3rd east of UTC+12; never anything else
    expect(on(goal("not a date")).on).toBeNull();
  });
});
