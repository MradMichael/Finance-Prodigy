import { describe, it, expect } from "vitest";
import {
  monthlyEquivalent, nextOccurrence, recurringPaidSoFar, fmtDate,
  loadData, saveData, DEFAULT_DATA, type StoredRecurring,
} from "./localData";

function makeRecurring(overrides: Partial<StoredRecurring> = {}): StoredRecurring {
  return {
    id: "r1", name: "Rent", emoji: "🏠", amount: 100, currency: "USD",
    frequency: "monthly", bucket: "NEEDS", startDate: "2026-01-01",
    endDate: null, totalAmount: null, createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("fmtDate", () => {
  it("formats YYYY-MM-DD as DD/MM/YYYY", () => {
    expect(fmtDate("2026-07-04")).toBe("04/07/2026");
  });
  it("returns empty string for null/undefined", () => {
    expect(fmtDate(null)).toBe("");
    expect(fmtDate(undefined)).toBe("");
  });
});

describe("monthlyEquivalent", () => {
  it("is 0 before the start date", () => {
    const r = makeRecurring({ startDate: "2026-06-01" });
    expect(monthlyEquivalent(r, new Date(2026, 4, 15))).toBe(0); // May 15, before June 1
  });

  it("is 0 after the end date", () => {
    const r = makeRecurring({ endDate: "2026-06-30" });
    expect(monthlyEquivalent(r, new Date(2026, 6, 1))).toBe(0); // July 1, after June 30
  });

  it("returns amount * FREQ_MONTHLY while active", () => {
    const r = makeRecurring({ amount: 120, frequency: "monthly" });
    expect(monthlyEquivalent(r, new Date(2026, 5, 1))).toBe(120);
  });

  it("is 0 once cumulative totalAmount has been exhausted", () => {
    // $100/month, $300 cap -> exhausted after 3 months.
    const r = makeRecurring({ amount: 100, totalAmount: 300, startDate: "2026-01-01" });
    expect(monthlyEquivalent(r, new Date(2026, 1, 15))).toBe(100); // Feb, still active
    expect(monthlyEquivalent(r, new Date(2027, 0, 1))).toBe(0); // a year later, exhausted
  });
});

describe("recurringPaidSoFar", () => {
  it("is 0 before the start date and 0 without a totalAmount cap", () => {
    const capped = makeRecurring({ totalAmount: 500 });
    expect(recurringPaidSoFar(capped, new Date(2025, 11, 1))).toBe(0); // before start
    const uncapped = makeRecurring({ totalAmount: null });
    expect(recurringPaidSoFar(uncapped, new Date(2026, 5, 1))).toBe(0);
  });

  it("never exceeds the totalAmount cap", () => {
    const r = makeRecurring({ amount: 100, totalAmount: 250, startDate: "2026-01-01" });
    // Many periods elapsed by 2030 -- paid-so-far must clamp at the cap, not overshoot.
    expect(recurringPaidSoFar(r, new Date(2030, 0, 1))).toBe(250);
  });
});

describe("nextOccurrence", () => {
  it("returns the start date itself when queried before it starts", () => {
    const r = makeRecurring({ startDate: "2026-08-01" });
    const next = nextOccurrence(r, new Date(2026, 6, 1));
    expect(next?.toISOString().slice(0, 10)).toBe("2026-08-01");
  });

  it("returns null once past the end date", () => {
    const r = makeRecurring({ endDate: "2026-06-30" });
    expect(nextOccurrence(r, new Date(2026, 6, 1))).toBeNull();
  });

  it("returns null once the total-amount cap is exhausted", () => {
    const r = makeRecurring({ amount: 100, totalAmount: 100, startDate: "2026-01-01" });
    expect(nextOccurrence(r, new Date(2026, 6, 1))).toBeNull();
  });

  it("weekly frequency advances in exact 7-day increments", () => {
    // Dates constructed as UTC ISO strings throughout (matching how the
    // production code parses r.startDate) to avoid local-timezone drift
    // between how "start" and "asOf" represent midnight.
    const r = makeRecurring({ frequency: "weekly", startDate: "2026-07-01" });
    const next = nextOccurrence(r, new Date("2026-07-10")); // partway into week 2
    expect(next?.toISOString().slice(0, 10)).toBe("2026-07-15");
  });

  it("monthly frequency on a normal day advances one calendar month", () => {
    const r = makeRecurring({ frequency: "monthly", startDate: "2026-01-15" });
    const next = nextOccurrence(r, new Date("2026-03-01"));
    expect(next?.toISOString().slice(0, 10)).toBe("2026-03-15");
  });

  it("KNOWN QUIRK: a Jan-31 monthly recurring skips February and lands on a shifted day, due to JS Date.setMonth's end-of-month rollover", () => {
    // Documents actual current behavior, not necessarily desired behavior —
    // flagged for a decision on whether to fix (see plan discussion).
    const r = makeRecurring({ frequency: "monthly", startDate: "2026-01-31" });
    const next = nextOccurrence(r, new Date(2026, 1, 15)); // Feb 15
    // 2026 is not a leap year: Jan 31 + 1 month via setMonth() overflows
    // Feb's 28 days into March 3, skipping a "due in February" occurrence
    // entirely and silently shifting the recurring day-of-month.
    expect(next?.toISOString().slice(0, 10)).toBe("2026-03-03");
  });
});

describe("loadData / saveData round trip", () => {
  it("saves and loads data for a user, round-tripping through real encryption", async () => {
    const userId = "test-user-1";
    const data = { ...DEFAULT_DATA, userName: "Test User", income: 4200 };
    await saveData(data, userId);
    const loaded = await loadData(userId);
    expect(loaded.userName).toBe("Test User");
    expect(loaded.income).toBe(4200);
  });

  it("returns DEFAULT_DATA for a user with nothing saved", async () => {
    const loaded = await loadData("never-saved-user");
    expect(loaded).toEqual(DEFAULT_DATA);
  });
});
