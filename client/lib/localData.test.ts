import { describe, it, expect } from "vitest";
import {
  monthlyEquivalent, nextOccurrence, recurringPaidSoFar, fmtDate, valueForMonth,
  loadData, saveData, DEFAULT_DATA, type StoredRecurring,
  allCategories, categoryLabel, categoryIcon, CATEGORIES,
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

  it("a Jan-31 monthly recurring clamps to Feb 28 in a non-leap year instead of overflowing into March", () => {
    const r = makeRecurring({ frequency: "monthly", startDate: "2026-01-31" });
    const next = nextOccurrence(r, new Date("2026-02-15"));
    // 2026 is not a leap year -- Feb only has 28 days, so the occurrence
    // clamps to Feb 28 rather than a naive Date.setMonth overflowing to Mar 3.
    expect(next?.toISOString().slice(0, 10)).toBe("2026-02-28");
  });

  it("a Jan-31 monthly recurring clamps to Feb 29 in a leap year", () => {
    const r = makeRecurring({ frequency: "monthly", startDate: "2028-01-31" });
    const next = nextOccurrence(r, new Date("2028-02-15"));
    expect(next?.toISOString().slice(0, 10)).toBe("2028-02-29");
  });

  it("a day-31 monthly recurring returns to day 31 in a month that has one, after being clamped", () => {
    const r = makeRecurring({ frequency: "monthly", startDate: "2026-01-31" });
    // Feb 28 (clamped) -> next occurrence should be March 31 (March has 31 days again), not stuck at 28.
    const next = nextOccurrence(r, new Date("2026-03-01"));
    expect(next?.toISOString().slice(0, 10)).toBe("2026-03-31");
  });
});

describe("valueForMonth", () => {
  it("returns the fallback when there's no history yet", () => {
    expect(valueForMonth(undefined, "2026-07", 500)).toBe(500);
    expect(valueForMonth([], "2026-07", 500)).toBe(500);
  });

  it("returns the most recent entry at or before the target month", () => {
    const history = [{ ym: "2026-01", value: 1000 }, { ym: "2026-05", value: 2000 }];
    expect(valueForMonth(history, "2026-07", 999)).toBe(2000);
    expect(valueForMonth(history, "2026-05", 999)).toBe(2000); // exact match
    expect(valueForMonth(history, "2026-03", 999)).toBe(1000); // between entries -> most recent past one
  });

  it("falls back when the target month is before any recorded history", () => {
    const history = [{ ym: "2026-06", value: 2000 }];
    expect(valueForMonth(history, "2026-01", 999)).toBe(999);
  });

  it("is unaffected by history entries out of chronological order", () => {
    const history = [{ ym: "2026-05", value: 2000 }, { ym: "2026-01", value: 1000 }];
    expect(valueForMonth(history, "2026-07", 999)).toBe(2000);
  });
});

describe("category helpers", () => {
  const custom = [{ value: "pet-care", label: "Pet care", icon: "🐾" }];

  it("allCategories appends custom categories to the built-ins without mutating CATEGORIES", () => {
    expect(allCategories(undefined)).toEqual(CATEGORIES);
    expect(allCategories([])).toEqual(CATEGORIES);
    const combined = allCategories(custom);
    expect(combined).toHaveLength(CATEGORIES.length + 1);
    expect(combined.at(-1)).toEqual(custom[0]);
    expect(CATEGORIES).toHaveLength(14); // unchanged by the call above
  });

  it("categoryLabel/categoryIcon resolve built-in keys the same as the static Records", () => {
    expect(categoryLabel("groceries")).toBe("Groceries");
    expect(categoryIcon("groceries")).toBe("🛒");
  });

  it("categoryLabel/categoryIcon resolve a custom key when given the account's customCategories", () => {
    expect(categoryLabel("pet-care", custom)).toBe("Pet care");
    expect(categoryIcon("pet-care", custom)).toBe("🐾");
  });

  it("falls back to the raw key/a generic icon for an orphaned key (custom category deleted) instead of crashing", () => {
    expect(categoryLabel("pet-care", [])).toBe("pet-care");
    expect(categoryIcon("pet-care", [])).toBe("•");
  });

  it("treats undefined and the synthetic 'uncategorized' grouping key as Uncategorized", () => {
    expect(categoryLabel(undefined)).toBe("Uncategorized");
    expect(categoryLabel("uncategorized")).toBe("Uncategorized");
    expect(categoryIcon(undefined)).toBe("❔");
    expect(categoryIcon("uncategorized")).toBe("❔");
  });
});

describe("loadData / saveData round trip", () => {
  it("saves and loads data for a user, round-tripping through real encryption", async () => {
    const { createEnvelopes, activateSessionKey } = await import("./crypto");
    const { dek } = await createEnvelopes("pw", "test-user-1");
    activateSessionKey(dek);

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

  it("propagates decryptJSON's ENCRYPTION_KEY_MISSING instead of silently returning DEFAULT_DATA", async () => {
    // Regression guard for the fix that made decryptJSON throw instead of
    // fail-open: if loadData's own catch-all swallowed that throw, a real
    // encrypted record that can't be opened would look identical to a fresh
    // empty account again — exactly the bug the crypto.ts fix targeted.
    const { createEnvelopes, activateSessionKey, clearEncryptionKey } = await import("./crypto");
    const userId = "test-user-locked";
    const { dek } = await createEnvelopes("pw", userId);
    activateSessionKey(dek);
    await saveData({ ...DEFAULT_DATA, income: 9999 }, userId);

    clearEncryptionKey(); // simulate the session-outlives-its-key gap (browser restart / fresh tab)
    await expect(loadData(userId)).rejects.toThrow("ENCRYPTION_KEY_MISSING");
  });

  it("falls back to DEFAULT_DATA for genuinely corrupted/unparseable storage, not a key-mismatch case", async () => {
    const userId = "test-user-corrupted";
    localStorage.setItem(`essa_data_${userId}`, "{not valid json at all");
    const loaded = await loadData(userId);
    expect(loaded).toEqual(DEFAULT_DATA);
  });
});
