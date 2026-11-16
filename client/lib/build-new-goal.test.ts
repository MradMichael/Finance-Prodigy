// InputPanel split, S4 (session 55): building a new goal as one function. My Finances' "+ Add goal" and the
// Wishlist's "save toward a goal" each built the record by hand, field for field the same. A pure move: the
// record is what both built before (the same fields in the same order). How achievement is set is not here
// (that is 2.8.3's rule).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildNewGoal } from "./localData";

beforeEach(() => { vi.useFakeTimers({ now: new Date("2026-11-16T10:00:00.000Z"), toFake: ["Date"] }); });
afterEach(() => { vi.useRealTimers(); });

describe("S4: buildNewGoal", () => {
  it("a dollar goal: the fields both callers wrote, in their order, with no rate", () => {
    const g = buildNewGoal({ name: "Laptop", emoji: "💻", targetAmount: 1200, openingAmount: 300, currency: "USD", targetDate: "2027-03-01" }, 89_500);
    expect(Object.keys(g)).toEqual(["id", "name", "emoji", "targetAmount", "currentAmount", "openingAmount", "currency", "targetDate", "createdAt"]);
    expect(g).toMatchObject({ name: "Laptop", emoji: "💻", targetAmount: 1200, currentAmount: 300, openingAmount: 300, currency: "USD", targetDate: "2027-03-01", createdAt: "2026-11-16T10:00:00.000Z" });
    expect(typeof g.id).toBe("string");
    expect(g.id.length).toBeGreaterThan(0);
  });

  it("a lira goal carries the rate it was created at, after the currency", () => {
    const g = buildNewGoal({ name: "Generator", emoji: "🎯", targetAmount: 90_000_000, openingAmount: 0, currency: "LBP", targetDate: "2027-06-30" }, 89_500);
    expect(Object.keys(g)).toEqual(["id", "name", "emoji", "targetAmount", "currentAmount", "openingAmount", "currency", "lbpRateAtEntry", "targetDate", "createdAt"]);
    expect(g.lbpRateAtEntry).toBe(89_500);
    expect(g.currentAmount).toBe(0);
  });

  it("the saved figure and the opening amount start equal (plan H 5a); it stamps nothing else", () => {
    const g = buildNewGoal({ name: "Trip", emoji: "✈️", targetAmount: 500, openingAmount: 120.5, currency: "USD", targetDate: "2027-01-15" }, 89_500);
    expect(g.currentAmount).toBe(g.openingAmount);
    expect("achievedAt" in g).toBe(false);
    expect("pausedAt" in g).toBe(false);
    expect("updatedAt" in g).toBe(false); // the caller marks the edit, as before
  });

  it("two goals get different ids", () => {
    const a = buildNewGoal({ name: "A", emoji: "🎯", targetAmount: 1, openingAmount: 0, currency: "USD", targetDate: "2027-01-01" }, 89_500);
    const b = buildNewGoal({ name: "B", emoji: "🎯", targetAmount: 1, openingAmount: 0, currency: "USD", targetDate: "2027-01-01" }, 89_500);
    expect(a.id).not.toBe(b.id);
  });
});
