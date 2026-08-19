import { describe, it, expect } from "vitest";
import {
  monthlyEquivalent, nominalMonthlyEquivalent, isRecurringActive, isPaidThisCycle,
  nextOccurrence, recurringPaidSoFar, buildRecurringPaymentLog, fmtDate, valueForMonth,
  loadData, saveData, DEFAULT_DATA, type StoredRecurring,
  allCategories, categoryLabel, categoryIcon, CATEGORIES,
  matchCategoryRule, type CategoryRule,
  roundMoney, moneyEquals, isEmptyFinancials, type LocalFinancials,
  migrateFinancials, CURRENT_SCHEMA_VERSION,
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

  it("is 0 for the cycle marked lastPaidCycle, distinct from being ended", () => {
    // Regression guard: monthlyEquivalent returning 0 for BOTH "ended" and
    // "paid this cycle" used to make InputPanel/RecurringScreen/printReport
    // each independently mistake a just-paid, still-active item for a
    // cancelled one. isRecurringActive/isPaidThisCycle exist precisely so
    // callers can tell the two apart; monthlyEquivalent's own 0-return
    // behavior here must stay exactly as before (no regression risk to its
    // ~23 real call sites).
    const r = makeRecurring({ amount: 50, startDate: "2026-01-01", lastPaidCycle: "2026-07" });
    const asOf = new Date(2026, 6, 15); // July 15 -- matches lastPaidCycle
    expect(monthlyEquivalent(r, asOf)).toBe(0);
    expect(isRecurringActive(r, asOf)).toBe(true); // still very much active
    expect(isPaidThisCycle(r, asOf)).toBe(true);
    // A different month is unaffected -- both the suppression and the "is it active" question.
    const nextMonth = new Date(2026, 7, 15);
    expect(monthlyEquivalent(r, nextMonth)).toBe(50);
    expect(isPaidThisCycle(r, nextMonth)).toBe(false);
  });
});

describe("nominalMonthlyEquivalent", () => {
  it("ignores lastPaidCycle suppression -- stays the item's stable 'what this costs' figure even for a just-paid cycle", () => {
    const r = makeRecurring({ amount: 50, startDate: "2026-01-01", lastPaidCycle: "2026-07" });
    const asOf = new Date(2026, 6, 15);
    expect(monthlyEquivalent(r, asOf)).toBe(0); // suppressed, for spend/budget math
    expect(nominalMonthlyEquivalent(r, asOf)).toBe(50); // NOT suppressed, for display
  });

  it("is still 0 for a genuinely ended/not-yet-started item -- suppression is the only thing it ignores", () => {
    const r = makeRecurring({ startDate: "2026-06-01" });
    expect(nominalMonthlyEquivalent(r, new Date(2026, 4, 15))).toBe(0); // before start
    const ended = makeRecurring({ endDate: "2026-06-30" });
    expect(nominalMonthlyEquivalent(ended, new Date(2026, 6, 1))).toBe(0); // after end
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

describe("buildRecurringPaymentLog", () => {
  it("returns null when there's no next occurrence (ended item)", () => {
    const r = makeRecurring({ endDate: "2026-06-30" });
    expect(buildRecurringPaymentLog(r, new Date(2026, 6, 1))).toBeNull(); // July 1, after end
  });

  it("the transaction date and the lastPaidCycle stamp always agree on which month they refer to", () => {
    // The invariant the fix exists to guarantee, checked directly rather
    // than inferred from a specific scenario: no matter what `now` is
    // relative to the due date, tx.date's month must equal cycleYm exactly,
    // because both are sliced from the same `due` value.
    const r = makeRecurring({ frequency: "monthly", startDate: "2026-01-01" });
    for (const now of [new Date(2026, 7, 19), new Date(2026, 7, 25), new Date(2026, 7, 31), new Date(2026, 8, 1)]) {
      const result = buildRecurringPaymentLog(r, now)!;
      expect(result.tx.date.slice(0, 7)).toBe(result.cycleYm);
    }
  });

  it("THE BUG: clicking a few days before a due date that falls in the next month no longer double-counts the current month or phantom-suppresses the next one", () => {
    // Reproduces the exact scenario from the audit: a monthly item due on
    // the 1st, "Log payment" clicked Aug 27 while the upcoming due date
    // (Sep 1) is within the 7-day Renewing-soon window. Before the fix,
    // this dated the transaction Aug 27 (today) while stamping
    // lastPaidCycle "2026-09" (due's month) -- August's live estimate
    // stayed unsuppressed and stacked with the new Aug-dated transaction
    // (double count), while September's estimate, row, and renewal
    // reminder all silently zeroed despite no transaction ever landing
    // in it (phantom suppression).
    const r = makeRecurring({ amount: 750, frequency: "monthly", startDate: "2026-08-01" });
    const clickNow = new Date(2026, 7, 27); // Aug 27, 2026
    const result = buildRecurringPaymentLog(r, clickNow)!;

    expect(result.cycleYm).toBe("2026-09");
    expect(result.tx.date).toBe("2026-09-01"); // NOT "2026-08-27" -- dated what it's paying, not when clicked
    expect(result.tx.amount).toBe(750);

    const stamped: StoredRecurring = { ...r, lastPaidCycle: result.cycleYm };

    // August: no transaction was dated here (tx.date is September), so the
    // live estimate must NOT be suppressed -- August still, correctly,
    // shows exactly one representation of this bill (the estimate), not two.
    const laterInAugust = new Date(2026, 7, 30);
    expect(isPaidThisCycle(stamped, laterInAugust)).toBe(false);
    expect(monthlyEquivalent(stamped, laterInAugust)).toBe(750);

    // September: suppressed, and this time correctly backed by a real
    // transaction actually dated in September (result.tx) -- not a phantom.
    const inSeptember = new Date(2026, 8, 5);
    expect(isPaidThisCycle(stamped, inSeptember)).toBe(true);
    expect(monthlyEquivalent(stamped, inSeptember)).toBe(0);
    expect(result.tx.date.startsWith("2026-09")).toBe(true);
  });

  it("the 1st-of-month due date: every day in the button's entire 7-day visibility window hits the cross-month case, not just some of them", () => {
    // The owner's re-rating rationale, checked directly: RENEWAL_WINDOW_DAYS
    // is 7, so for an item due on the 1st, "today" can be anywhere from the
    // 25th to the 31st of the prior month while the button is clickable.
    // Every single one of those days must resolve to next month, not just
    // the early ones -- this is the "modal case, not an edge case" claim.
    const r = makeRecurring({ frequency: "monthly", startDate: "2026-01-01" });
    const daysInAugust = [25, 26, 27, 28, 29, 30, 31];
    for (const day of daysInAugust) {
      const result = buildRecurringPaymentLog(r, new Date(2026, 7, day))!;
      expect(result.cycleYm).toBe("2026-09");
      expect(result.tx.date).toBe("2026-09-01");
    }
  });

  it("contrast: a due date in the SAME month as the click was never affected, and still isn't", () => {
    // Due the 25th, clicked the 19th (6 days early, same month) -- both
    // before and after the fix this suppresses correctly. The one visible
    // change: the transaction is now dated the 25th (what it's for)
    // instead of the 19th (when it was clicked) -- an intentional,
    // accepted part of the fix, not a regression.
    const r = makeRecurring({ frequency: "monthly", startDate: "2026-01-25" });
    const result = buildRecurringPaymentLog(r, new Date(2026, 7, 19))!;
    expect(result.cycleYm).toBe("2026-08");
    expect(result.tx.date).toBe("2026-08-25");

    const stamped: StoredRecurring = { ...r, lastPaidCycle: result.cycleYm };
    expect(monthlyEquivalent(stamped, new Date(2026, 7, 30))).toBe(0); // suppressed, no double count
  });

  it("carries amount/currency/bucket/description/paymentMethod from the recurring item, category only when set", () => {
    const withCategory = makeRecurring({ category: "rent", currency: "LBP", bucket: "WANTS", name: "Netflix" });
    const r1 = buildRecurringPaymentLog(withCategory, new Date(2026, 5, 1))!;
    expect(r1.tx).toMatchObject({ amount: 100, currency: "LBP", bucket: "WANTS", category: "rent", description: "Netflix", paymentMethod: "cash" });

    const withoutCategory = makeRecurring({ name: "Gym" });
    const r2 = buildRecurringPaymentLog(withoutCategory, new Date(2026, 5, 1))!;
    expect(r2.tx.description).toBe("Gym");
    expect("category" in r2.tx).toBe(false);
  });

  it("generates a fresh id on every call -- two calls for the same item produce two distinct transactions", () => {
    // Not a guard itself (that lives in page.tsx's click handler, which
    // this project has no component-test harness for), but confirms this
    // function does nothing to prevent duplicate calls from producing
    // duplicate transactions -- which is exactly why the call site needs
    // its own re-entrancy guard, not something this layer can substitute for.
    const r = makeRecurring();
    const a = buildRecurringPaymentLog(r, new Date(2026, 5, 1))!;
    const b = buildRecurringPaymentLog(r, new Date(2026, 5, 1))!;
    expect(a.tx.id).not.toBe(b.tx.id);
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

describe("matchCategoryRule", () => {
  const rules: CategoryRule[] = [
    { id: "r1", keyword: "Spinneys", category: "groceries" },
    { id: "r2", keyword: "netflix", category: "entertainment" },
  ];

  it("matches case-insensitively, as a substring anywhere in the description", () => {
    expect(matchCategoryRule("SPINNEYS SUPERMARKET BEIRUT", rules)).toBe("groceries");
    expect(matchCategoryRule("Monthly Netflix Subscription", rules)).toBe("entertainment");
  });

  it("returns undefined when nothing matches, no rules exist, or the description is empty", () => {
    expect(matchCategoryRule("Uber ride", rules)).toBeUndefined();
    expect(matchCategoryRule("Spinneys run", undefined)).toBeUndefined();
    expect(matchCategoryRule("", rules)).toBeUndefined();
  });

  it("first-match-in-order wins when a description matches more than one rule", () => {
    const overlapping: CategoryRule[] = [
      { id: "r1", keyword: "Uber", category: "transport" },
      { id: "r2", keyword: "Uber Eats", category: "dining" },
    ];
    expect(matchCategoryRule("Uber Eats order", overlapping)).toBe("transport");
  });

  it("ignores a rule with a blank/whitespace-only keyword instead of matching everything", () => {
    const blank: CategoryRule[] = [{ id: "r1", keyword: "   ", category: "other" }];
    expect(matchCategoryRule("Anything at all", blank)).toBeUndefined();
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

  it("saveData always persists CURRENT_SCHEMA_VERSION even when handed data missing the field -- covers every pull-derived call site (signInFromSync, recoverFromSync, the two manual/auto pull handlers) without testing each one individually", async () => {
    const { createEnvelopes, activateSessionKey } = await import("./crypto");
    const userId = "test-user-legacy-shape";
    const { dek } = await createEnvelopes("pw", userId);
    activateSessionKey(dek);

    const legacyShaped = { ...DEFAULT_DATA } as Partial<LocalFinancials>;
    delete legacyShaped.schemaVersion;

    await saveData(legacyShaped as LocalFinancials, userId);
    const loaded = await loadData(userId);
    expect(loaded.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });
});

describe("roundMoney", () => {
  it("rounds to the nearest cent", () => {
    expect(roundMoney(1.004)).toBe(1);
    expect(roundMoney(1.006)).toBe(1.01);
    expect(roundMoney(10)).toBe(10);
    expect(roundMoney(0.1 + 0.2)).toBe(0.3); // the textbook 0.30000000000000004 case
  });

  it("known, accepted limitation: an exact .005 can round down, because 1.005 itself isn't exactly representable in a float", () => {
    // 1.005 is actually stored as ~1.00499999999999989 -- Math.round(100.4999...)
    // is 100, not 101. This is the same behavior the codebase's pre-existing
    // debtEngine round2 and computeDashboard's inline (n*100)/100 spots
    // already had; consolidating them here doesn't change it, and a more
    // "correct" epsilon-nudged version would trade this documented,
    // consistent behavior for a different, less-obvious one at some other
    // boundary. Documented, not silently relied on.
    expect(roundMoney(1.005)).toBe(1);
  });

  it("handles negative amounts the same way", () => {
    expect(roundMoney(-1.005)).toBe(-1); // Math.round rounds -0.5 toward 0, not away -- documenting the actual behavior, not asserting a "should"
    expect(roundMoney(-1.006)).toBe(-1.01);
  });

  it("is idempotent -- rounding an already-rounded value is a no-op", () => {
    const once = roundMoney(19.999999999999996);
    expect(roundMoney(once)).toBe(once);
  });

  it("repeated goal contributions don't drift, rounding at every step the way InputPanel.tsx's contributeToGoal and GoalsScreen.tsx's pay() both do", () => {
    // The actual risk this closes: goal.currentAmount is a running total
    // updated via currentAmount + amt on every contribution (two separate
    // call sites, same pattern) -- with no rounding at all, that's exactly
    // the kind of repeated float arithmetic that drifts over many additions.
    let currentAmount = 0;
    for (let i = 0; i < 20; i++) currentAmount = roundMoney(currentAmount + 10.1);
    expect(currentAmount).toBe(202); // not 201.99999999999997 or similar
  });
});

describe("moneyEquals", () => {
  it("treats float dust from a chain of arithmetic as equal", () => {
    expect(moneyEquals(0.1 + 0.2, 0.3)).toBe(true); // raw === would fail this
    expect(0.1 + 0.2 === 0.3).toBe(false); // the bug this exists to route around, made explicit
  });

  it("still distinguishes genuinely different amounts", () => {
    expect(moneyEquals(10, 10.01)).toBe(false);
    expect(moneyEquals(0, 0.01)).toBe(false);
  });

  it("two independently-computed values that round to the same cent always compare equal", () => {
    // Both land on 19.99 -- two different arithmetic paths reaching the
    // "same" money value, exactly the case this function exists for.
    expect(roundMoney(19.994)).toBe(19.99);
    expect(roundMoney(19.9905)).toBe(19.99);
    expect(moneyEquals(roundMoney(19.994), roundMoney(19.9905))).toBe(true);
  });

  it("adjacent cents are NOT treated as equal -- this isn't a loose fuzzy-match", () => {
    expect(moneyEquals(19.99, 20)).toBe(false);
  });

  it("respects a custom epsilon when the default half-cent isn't the right tolerance", () => {
    expect(moneyEquals(10, 10.02, 0.001)).toBe(false);
    expect(moneyEquals(10, 10.0005, 0.001)).toBe(true);
  });
});

describe("isEmptyFinancials — emergencyFundBalance drift", () => {
  const empty: LocalFinancials = {
    ...DEFAULT_DATA,
    income: 0, emergencyFundBalance: 0,
    transactions: [], goals: [], debts: [], recurring: [], cards: [], assets: [], trackedBalances: [],
  };

  it("a clean zero balance is empty", () => {
    expect(isEmptyFinancials(empty)).toBe(true);
  });

  it("a real nonzero balance is not empty", () => {
    expect(isEmptyFinancials({ ...empty, emergencyFundBalance: 50 })).toBe(false);
  });

  it("float-drifted near-zero (the result of many +/- edits landing just off exact 0) still reads as empty, not as having real data", () => {
    // Simulates what InputPanel's repeated (balance ?? 0) + amtUSD / - amtUSD
    // can produce over many transactions -- not exactly 0, but not a real balance either.
    const drifted = 0.1 + 0.2 - 0.3; // 5.551115123125783e-17 in IEEE754, not exactly 0
    expect(drifted).not.toBe(0); // confirms the drift is real, not a trivial test
    expect(isEmptyFinancials({ ...empty, emergencyFundBalance: drifted })).toBe(true);
  });
});

// docs/ROADMAP.md Phase 1.1 -- schema version marker + lazy migration
// harness. No currency logic yet; this only proves the mechanism itself
// changes nothing for an account that doesn't need migrating, and
// correctly stamps one that does.
describe("migrateFinancials", () => {
  // Same structural shape as a real, multi-year account (mixed USD/LBP,
  // cards, a paused goal, a recurring item with a totalAmount cap, custom
  // categories, all four history arrays) -- deliberately not real data,
  // see the commit message for why. Exercises the same field combinations
  // without any of it being anyone's actual financial information.
  function legacyFixture(): Record<string, unknown> {
    return {
      // No schemaVersion key at all -- every real account in production today.
      userName: "Test User",
      income: 2000,
      lbpRate: 89500,
      emergencyFundTargetMonths: 6,
      emergencyFundBalance: 500,
      transactions: [
        { id: "t1", amount: 25.5, currency: "USD", bucket: "WANTS", description: "Dining", date: "2026-08-01", paymentMethod: "cash", category: "dining" },
        { id: "t2", amount: 150000, currency: "LBP", bucket: "NEEDS", description: "Groceries", date: "2026-08-02", paymentMethod: "card", cardId: "c1", cardLabel: "Visa •••• 1234", category: "groceries" },
        { id: "t3", amount: 0, currency: "USD", bucket: "NEEDS", description: "Split bill", date: "2026-08-03", paymentMethod: "other", paymentNote: "Paid by roommate", category: "utilities" },
      ],
      goals: [
        { id: "g1", name: "Trip", emoji: "🎯", targetAmount: 3000, currentAmount: 500, targetDate: "2027-01-01", createdAt: "2026-01-01T00:00:00.000Z" },
        { id: "g2", name: "Paused Goal", emoji: "🎯", targetAmount: 1000, currentAmount: 0, targetDate: "2027-06-01", createdAt: "2026-02-01T00:00:00.000Z", pausedAt: "2026-07-01T00:00:00.000Z" },
      ],
      debts: [
        { id: "d1", name: "Loan", balance: 1500, apr: 0, minPayment: 0, createdAt: "2026-01-01T00:00:00.000Z", openedDate: "2026-01-01" },
      ],
      recurring: [
        { id: "r1", name: "Tuition", emoji: "🔄", amount: 500, currency: "USD", frequency: "monthly", bucket: "NEEDS", startDate: "2026-01-01", endDate: null, totalAmount: 4500, createdAt: "2026-01-01T00:00:00.000Z" },
        { id: "r2", name: "Streaming", emoji: "🔄", amount: 8, currency: "USD", frequency: "monthly", bucket: "WANTS", startDate: "2026-01-01", endDate: null, totalAmount: null, createdAt: "2026-01-01T00:00:00.000Z" },
      ],
      cards: [{ id: "c1", type: "Visa", last4: "1234", label: "Visa •••• 1234" }],
      assets: [],
      trackedBalances: [
        { id: "tb1", name: "Cash", paymentMethod: "cash", startingBalance: 100, startingDate: "2026-08-01", currency: "USD", actualBalance: 80, actualBalanceDate: "2026-08-15T00:00:00.000Z", expectedAtCheckUSD: 82.5 },
      ],
      customCategories: [{ value: "gym", label: "Gym", icon: "💪" }],
      categoryRules: [],
      wishlist: [],
      netWorthHistory: [{ ym: "2026-08", value: 500 }],
      incomeHistory: [{ ym: "2026-08", value: 2000 }],
      lbpRateHistory: [{ ym: "2026-08", value: 89500 }],
      budgetRuleHistory: [{ ym: "2026-08", needs: 60, wants: 25, savings: 15 }],
      budgetRule: "custom",
      budgetCustomNeeds: 60,
      budgetCustomWants: 25,
    };
  }

  it("a fresh DEFAULT_DATA is already stamped at CURRENT_SCHEMA_VERSION", () => {
    expect(DEFAULT_DATA.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it("migrates a record with no schemaVersion at all (every real account today), stamping the version without changing any other value", () => {
    const legacy = legacyFixture();
    const migrated = migrateFinancials(legacy);
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    // Byte-identical in value on every field except the stamp itself --
    // the actual proof of "no behavior change" for this sub-phase, not
    // just an assertion that migration runs without throwing.
    const { schemaVersion: _omit, ...migratedRest } = migrated;
    expect(migratedRest).toEqual(legacy);
  });

  it("running the migration twice over the same fixture produces identical output (idempotent, per the roadmap's explicit requirement)", () => {
    const legacy = legacyFixture();
    const once = migrateFinancials(legacy);
    const twice = migrateFinancials(once);
    expect(twice).toEqual(once);
  });

  it("a record already at CURRENT_SCHEMA_VERSION passes through unchanged", () => {
    const current: LocalFinancials = { ...DEFAULT_DATA, income: 999 };
    expect(migrateFinancials(current)).toEqual(current);
  });

  it("treats garbage/non-object input the same way the pre-existing corrupted-storage fallback did -- defaults, not a throw", () => {
    expect(migrateFinancials(null).schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrateFinancials("not an object").schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrateFinancials(undefined)).toEqual(DEFAULT_DATA);
  });
});
