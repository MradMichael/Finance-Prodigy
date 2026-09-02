import { describe, it, expect, vi } from "vitest";
import {
  monthlyEquivalent, nominalMonthlyEquivalent, isRecurringActive, isPaidThisCycle,
  nextOccurrence, recurringPaidSoFar, buildRecurringPaymentLog, buildGoalContributionTx, fmtDate, valueForMonth,
  loadData, saveData, DEFAULT_DATA, type StoredRecurring, type StoredGoal, type StoredTransaction, type StoredDebt,
  allCategories, categoryLabel, categoryIcon, CATEGORIES,
  matchCategoryRule, type CategoryRule,
  roundMoney, moneyEquals, isEmptyFinancials, type LocalFinancials,
  migrateFinancials, schemaVersionOf, withRate, CURRENT_SCHEMA_VERSION, todayISO,
  dueCycles, isCycleConfirmed, isCycleOverdue, buildRecurringConfirmLog, cycleMonthDivergence,
  nextConfirmTarget, historizedRecurringContribution, pendingBackfillCycles,
  derivedEfBalance, derivedDebtBalance, activeTransactions, purgeTransaction, autoPurgeExpired,
  buildDebtPaymentTx, buildEfAdjustmentTx, buildDebtAdjustmentTx, applyGoalContribution,
  mergeTransactions, buildTransferTx, retagBucketAmount, reanchorTrackedBalance, type TrackedBalance,
} from "./localData";
import { trackedBalanceExpected } from "./computeDashboard";

// UTC midnight of a given local calendar date -- matches nextOccurrence's
// own basis (localData.ts's own comment: date-only strings parse as UTC
// midnight, and every occurrence nextOccurrence returns is built from that
// same UTC-anchored arithmetic) and computeDashboard.ts's existing
// `todayMidnight` pattern for the same reason. isCycleOverdue compares
// `dueDate` (UTC-anchored, from dueCycles/nextOccurrence) against `asOf` --
// passing a raw `new Date()` here would make "due today" already read as
// overdue for most of the day, off by up to a day depending on time zone.
function utcMidnight(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m, d));
}

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
  it("is 0 without a totalAmount cap, regardless of any confirmed transactions", () => {
    const uncapped = makeRecurring({ id: "r1", totalAmount: null });
    const tx: StoredTransaction = { id: "t1", amount: 100, currency: "USD", bucket: "NEEDS", description: "Rent", date: "2026-02-01", recurringId: "r1" };
    expect(recurringPaidSoFar(uncapped, [tx])).toBe(0);
  });

  it("is 0 for a capped item with real pre-cutover history and nothing confirmed -- NO grandfathered credit, even with a confirmCutoverDate (2.4.31 fix)", () => {
    // Regression guard for the exact live bug: 3 grandfathered pre-cutover
    // cycles used to count as $2,250 "paid" with zero StoredTransaction
    // behind them. Every dollar in this figure must now have a real ledger
    // row -- confirmed live: Uni's progress bar read "$1,500 paid" against
    // exactly one real $750 transaction before this fix.
    const r = makeRecurring({ id: "r1", amount: 750, totalAmount: 6750, startDate: "2026-01-01", confirmCutoverDate: "2026-04-01" });
    expect(recurringPaidSoFar(r, [])).toBe(0);
  });

  it("counts only real confirmed transactions, ignoring grandfathered pre-cutover cycles entirely", () => {
    const r = makeRecurring({ id: "r1", amount: 750, totalAmount: 6750, startDate: "2026-01-01", confirmCutoverDate: "2026-04-01" });
    const tx: StoredTransaction = { id: "t1", amount: 750, currency: "USD", bucket: "NEEDS", description: "Uni", date: "2026-04-01", recurringId: "r1" };
    // Not $2,250 (3 grandfathered) + $750 -- just the one real transaction.
    expect(recurringPaidSoFar(r, [tx])).toBe(750);
  });

  it("sums every confirmed transaction for this item", () => {
    const r = makeRecurring({ id: "r1", amount: 750, totalAmount: 6750, startDate: "2026-01-01" });
    const tx = (date: string): StoredTransaction => ({ id: `t-${date}`, amount: 750, currency: "USD", bucket: "NEEDS", description: "Uni", date, recurringId: "r1" });
    expect(recurringPaidSoFar(r, [tx("2026-04-01"), tx("2026-05-01"), tx("2026-06-01")])).toBe(2250);
  });

  it("clamps at totalAmount even if confirmed transactions alone would exceed it", () => {
    const r = makeRecurring({ id: "r1", amount: 750, totalAmount: 1500, startDate: "2026-01-01" });
    const tx = (date: string): StoredTransaction => ({ id: `t-${date}`, amount: 750, currency: "USD", bucket: "NEEDS", description: "Uni", date, recurringId: "r1" });
    expect(recurringPaidSoFar(r, [tx("2026-01-01"), tx("2026-02-01"), tx("2026-03-01")])).toBe(1500);
  });

  it("counts a confirmed transaction dated in the FUTURE relative to today -- paid-ahead money is genuinely paid and belongs against the cap (2.4.30 fix, unaffected by this change)", () => {
    const r = makeRecurring({ id: "r1", amount: 750, totalAmount: 6750, startDate: "2026-01-01" });
    const tx: StoredTransaction = { id: "t1", amount: 750, currency: "USD", bucket: "NEEDS", description: "Uni", date: "2026-09-01", recurringId: "r1" };
    expect(recurringPaidSoFar(r, [tx])).toBe(750);
  });

  it("ignores a transaction belonging to a different recurring item", () => {
    const r = makeRecurring({ id: "r1", amount: 750, totalAmount: 6750, startDate: "2026-01-01" });
    const tx: StoredTransaction = { id: "t1", amount: 750, currency: "USD", bucket: "NEEDS", description: "Other", date: "2026-04-01", recurringId: "r2" };
    expect(recurringPaidSoFar(r, [tx])).toBe(0);
  });

  it("Phase 2.6.3b: a soft-deleted confirming transaction no longer counts toward paid-so-far -- deleting it un-pays the cycle, no special-case code needed", () => {
    const r = makeRecurring({ id: "r1", amount: 750, totalAmount: 6750, startDate: "2026-01-01" });
    const tx: StoredTransaction = { id: "t1", amount: 750, currency: "USD", bucket: "NEEDS", description: "Uni", date: "2026-04-01", recurringId: "r1", deletedAt: "2026-08-20T00:00:00.000Z" };
    expect(recurringPaidSoFar(r, [tx])).toBe(0);
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

  // Found while writing dueCycles' own tests (Phase 2.5.2, Standing Rule 4):
  // the two tests just above only query FROM AFTER the boundary (endDate/cap
  // already passed) and correctly get null. Neither covers querying from
  // BEFORE the boundary where the COMPUTED next occurrence lands past it --
  // the two checks above only ever inspect the query point (asOfDay), never
  // the date the function is about to return.
  it("BUG: querying from before endDate can still return a computed date PAST it, when the next real cycle would fall after the item has ended", () => {
    // Monthly, ends Jul 15. Queried Jul 2 (before the end) -- the next
    // monthly cycle from Jul 2 is Aug 1, which is after Jul 15. The item
    // has no more real occurrences at all past Jul 1; this must be null,
    // not a phantom Aug 1 the item will never actually reach.
    const r = makeRecurring({ frequency: "monthly", startDate: "2026-01-01", endDate: "2026-07-15" });
    const next = nextOccurrence(r, new Date("2026-07-02"));
    expect(next).toBeNull();
  });

  it("contrast: querying from before endDate correctly still returns a real upcoming cycle when one exists before the end", () => {
    const r = makeRecurring({ frequency: "monthly", startDate: "2026-01-01", endDate: "2026-07-15" });
    const next = nextOccurrence(r, new Date("2026-06-02"));
    expect(next?.toISOString().slice(0, 10)).toBe("2026-07-01"); // still within bounds
  });

  it("BUG: querying before the total-amount cap is reached can still return a computed date that would exceed it", () => {
    // 3 payments of 500 = cap of 1500. Queried Mar 2 (after 2 payments have
    // actually happened, Jan 1 and Feb 1) -- the next monthly cycle is
    // Apr 1, but by Apr 1 a 4th payment would push cumulative paid to 2000,
    // over the 1500 cap. There is no real 4th occurrence; this must be
    // null, not a phantom Apr 1.
    const r = makeRecurring({ frequency: "monthly", amount: 500, startDate: "2026-01-01", totalAmount: 1500 });
    const next = nextOccurrence(r, new Date("2026-03-02"));
    expect(next).toBeNull();
  });

  it("contrast: querying before the cap correctly still returns a real upcoming cycle when the cap isn't reached yet", () => {
    const r = makeRecurring({ frequency: "monthly", amount: 500, startDate: "2026-01-01", totalAmount: 1500 });
    const next = nextOccurrence(r, new Date("2026-02-02"));
    expect(next?.toISOString().slice(0, 10)).toBe("2026-03-01"); // the 3rd and final payment, still within the cap
  });
});

describe("buildRecurringPaymentLog", () => {
  const RATE = 89500;

  it("returns null when there's no next occurrence (ended item)", () => {
    const r = makeRecurring({ endDate: "2026-06-30" });
    expect(buildRecurringPaymentLog(r, RATE, new Date(2026, 6, 1))).toBeNull(); // July 1, after end
  });

  it("the transaction date and the lastPaidCycle stamp always agree on which month they refer to", () => {
    // The invariant the fix exists to guarantee, checked directly rather
    // than inferred from a specific scenario: no matter what `now` is
    // relative to the due date, tx.date's month must equal cycleYm exactly,
    // because both are sliced from the same `due` value.
    const r = makeRecurring({ frequency: "monthly", startDate: "2026-01-01" });
    for (const now of [new Date(2026, 7, 19), new Date(2026, 7, 25), new Date(2026, 7, 31), new Date(2026, 8, 1)]) {
      const result = buildRecurringPaymentLog(r, RATE, now)!;
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
    const result = buildRecurringPaymentLog(r, RATE, clickNow)!;

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
      const result = buildRecurringPaymentLog(r, RATE, new Date(2026, 7, day))!;
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
    const result = buildRecurringPaymentLog(r, RATE, new Date(2026, 7, 19))!;
    expect(result.cycleYm).toBe("2026-08");
    expect(result.tx.date).toBe("2026-08-25");

    const stamped: StoredRecurring = { ...r, lastPaidCycle: result.cycleYm };
    expect(monthlyEquivalent(stamped, new Date(2026, 7, 30))).toBe(0); // suppressed, no double count
  });

  it("carries amount/currency/bucket/description/paymentMethod from the recurring item, category only when set", () => {
    const withCategory = makeRecurring({ category: "rent", currency: "LBP", bucket: "WANTS", name: "Netflix" });
    const r1 = buildRecurringPaymentLog(withCategory, RATE, new Date(2026, 5, 1))!;
    expect(r1.tx).toMatchObject({ amount: 100, currency: "LBP", bucket: "WANTS", category: "rent", description: "Netflix", paymentMethod: "cash" });

    const withoutCategory = makeRecurring({ name: "Gym" });
    const r2 = buildRecurringPaymentLog(withoutCategory, RATE, new Date(2026, 5, 1))!;
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
    const a = buildRecurringPaymentLog(r, RATE, new Date(2026, 5, 1))!;
    const b = buildRecurringPaymentLog(r, RATE, new Date(2026, 5, 1))!;
    expect(a.tx.id).not.toBe(b.tx.id);
  });

  it("captures lbpRateAtEntry on the created transaction for an LBP item, using the CURRENT rate passed in -- not a historical lookup for due's month", () => {
    // due can be a few days in the future (paid early); there's no
    // historical rate for a month that hasn't happened yet, so "the rate
    // at which this was entered" has to mean the rate at click-time.
    const r = makeRecurring({ currency: "LBP", amount: 500000 });
    const result = buildRecurringPaymentLog(r, 91000, new Date(2026, 5, 1))!;
    expect(result.tx.lbpRateAtEntry).toBe(91000);
  });

  it("does NOT set lbpRateAtEntry for a USD item -- nothing to capture", () => {
    const r = makeRecurring({ currency: "USD" });
    const result = buildRecurringPaymentLog(r, RATE, new Date(2026, 5, 1))!;
    expect(result.tx.lbpRateAtEntry).toBeUndefined();
  });
});

// Phase 2.5.2 -- pure cycle logic for the confirm-on-due-date model
// (docs/ROADMAP.md Phase 2.5). Built and tested here, completely unwired:
// nothing in computeDashboard.ts or any UI calls these yet (that's 2.5.3).
// Standing Rule 4 in full -- this is the highest-value test surface in the
// whole phase, and the logic everything else depends on, so it gets proven
// correct in isolation before anything live touches it.
//
// One deliberate refinement from the original plan, worth recording:
// confirmation is keyed by the cycle's EXACT due date (YYYY-MM-DD), not by
// month (YYYY-MM) the way the old lastPaidCycle mechanism was. A weekly or
// biweekly item can have several distinct due dates within the same
// calendar month -- a month-granularity key would let one confirmed cycle
// silently "confirm" every other cycle sharing that month, which is exactly
// the kind of quiet correctness gap this whole phase exists to remove.
// dueCycles already enumerates individual dates, not months, so keying off
// the same unit costs nothing and closes the gap before it ships.
describe("dueCycles", () => {
  it("monthly item: returns each month's due date across a 3-month window, inclusive of both ends", () => {
    const r = makeRecurring({ frequency: "monthly", startDate: "2026-01-01" });
    const cycles = dueCycles(r, utcMidnight(2026, 5, 1), utcMidnight(2026, 7, 1)); // Jun 1 - Aug 1
    expect(cycles.map((d) => d.toISOString().slice(0, 10))).toEqual(["2026-06-01", "2026-07-01", "2026-08-01"]);
  });

  it("weekly item: returns every distinct week's due date, not collapsed to one per month", () => {
    const r = makeRecurring({ frequency: "weekly", startDate: "2026-08-03" }); // a Monday
    const cycles = dueCycles(r, utcMidnight(2026, 7, 3), utcMidnight(2026, 7, 24)); // Aug 3 - Aug 24
    expect(cycles.map((d) => d.toISOString().slice(0, 10))).toEqual(["2026-08-03", "2026-08-10", "2026-08-17", "2026-08-24"]);
  });

  it("an item that hasn't started yet within the window returns no cycles before its own start", () => {
    const r = makeRecurring({ frequency: "monthly", startDate: "2026-09-01" });
    const cycles = dueCycles(r, utcMidnight(2026, 5, 1), utcMidnight(2026, 7, 1)); // Jun 1 - Aug 1, starts Sep 1
    expect(cycles).toEqual([]);
  });

  it("stops at an item's endDate -- cycles after it are never returned even though the window extends further", () => {
    const r = makeRecurring({ frequency: "monthly", startDate: "2026-01-01", endDate: "2026-07-15" });
    const cycles = dueCycles(r, utcMidnight(2026, 5, 1), utcMidnight(2026, 8, 1)); // Jun 1 - Sep 1
    expect(cycles.map((d) => d.toISOString().slice(0, 10))).toEqual(["2026-06-01", "2026-07-01"]); // not Aug 1
  });

  it("stops once a totalAmount cap is exhausted, same as nextOccurrence's own ending logic", () => {
    const r = makeRecurring({ frequency: "monthly", amount: 500, startDate: "2026-01-01", totalAmount: 1500 }); // 3 payments total
    const cycles = dueCycles(r, utcMidnight(2026, 0, 1), utcMidnight(2026, 5, 1)); // Jan 1 - Jun 1
    expect(cycles.map((d) => d.toISOString().slice(0, 10))).toEqual(["2026-01-01", "2026-02-01", "2026-03-01"]);
  });

  it("from after to: returns no cycles rather than looping forever or throwing", () => {
    const r = makeRecurring({ frequency: "monthly", startDate: "2026-01-01" });
    expect(dueCycles(r, utcMidnight(2026, 7, 1), utcMidnight(2026, 5, 1))).toEqual([]);
  });
});

describe("isCycleConfirmed", () => {
  const r = makeRecurring({ id: "r1" });
  const due = utcMidnight(2026, 7, 1); // Aug 1, 2026

  it("false when no transaction references this recurring item at all", () => {
    expect(isCycleConfirmed(r, due, [])).toBe(false);
  });

  it("true when a transaction has this item's recurringId and is dated exactly on the cycle's due date", () => {
    const tx: StoredTransaction = { id: "t1", amount: 100, currency: "USD", bucket: "NEEDS", description: "Rent", date: "2026-08-01", recurringId: "r1" };
    expect(isCycleConfirmed(r, due, [tx])).toBe(true);
  });

  it("false when the recurringId matches but the date is a DIFFERENT cycle -- exact-date keying, not month keying", () => {
    // Same item, same month, but a different week's cycle (the reason this
    // is keyed by date and not by month -- see this describe block's own
    // header comment).
    const tx: StoredTransaction = { id: "t1", amount: 100, currency: "USD", bucket: "NEEDS", description: "Rent", date: "2026-08-08", recurringId: "r1" };
    expect(isCycleConfirmed(r, due, [tx])).toBe(false);
  });

  it("false when the date matches but recurringId points at a DIFFERENT recurring item", () => {
    const tx: StoredTransaction = { id: "t1", amount: 100, currency: "USD", bucket: "NEEDS", description: "Coincidence", date: "2026-08-01", recurringId: "r2" };
    expect(isCycleConfirmed(r, due, [tx])).toBe(false);
  });

  it("false when the date matches but the transaction has no recurringId at all -- a manually-logged entry never counts as confirmation", () => {
    const tx: StoredTransaction = { id: "t1", amount: 100, currency: "USD", bucket: "NEEDS", description: "Unrelated", date: "2026-08-01" };
    expect(isCycleConfirmed(r, due, [tx])).toBe(false);
  });

  it("matches on cycleDate when present, even if the transaction's own date (the actual paid date) differs -- paid late, still confirms the right cycle", () => {
    const tx: StoredTransaction = { id: "t1", amount: 100, currency: "USD", bucket: "NEEDS", description: "Rent", date: "2026-08-05", cycleDate: "2026-08-01", recurringId: "r1" };
    expect(isCycleConfirmed(r, due, [tx])).toBe(true);
  });

  it("falls back to date when cycleDate is absent -- backward compatible with transactions confirmed before this field existed", () => {
    const tx: StoredTransaction = { id: "t1", amount: 100, currency: "USD", bucket: "NEEDS", description: "Rent", date: "2026-08-01", recurringId: "r1" };
    expect(isCycleConfirmed(r, due, [tx])).toBe(true);
  });

  it("BUG regression (4a/4c): an explicit null cycleDate never matches, even if the transaction's own date happens to coincide with the cycle -- a deliberately detached transaction", () => {
    // Reproduces the live sequence: Uni's Sep 1 cycle was confirmed, then the
    // transaction's date was edited away from Sep 1 -- but cycleDate stayed
    // pinned to Sep 1 by design (4b), so isCycleConfirmed kept matching it
    // and September silently stayed "settled" with no money in its own
    // ledger. Detaching (explicit cycleDate: null) is what actually frees
    // the cycle -- and must NOT fall back to `date`, even when `date`
    // happens to still equal the cycle's own due date, or detaching would
    // be a no-op for the one case (date unedited) it's most likely to be used for.
    const tx: StoredTransaction = { id: "t1", amount: 100, currency: "USD", bucket: "NEEDS", description: "Rent", date: "2026-08-01", cycleDate: null, recurringId: "r1" };
    expect(isCycleConfirmed(r, due, [tx])).toBe(false);
  });

  it("Phase 2.6.3b: a soft-deleted transaction never counts as confirming, even though every other field matches exactly", () => {
    const tx: StoredTransaction = { id: "t1", amount: 100, currency: "USD", bucket: "NEEDS", description: "Rent", date: "2026-08-01", recurringId: "r1", deletedAt: "2026-08-20T00:00:00.000Z" };
    expect(isCycleConfirmed(r, due, [tx])).toBe(false);
  });
});

describe("cycleMonthDivergence (2.4.36)", () => {
  const recurring = [makeRecurring({ id: "r1", name: "Uni" })];

  it("null when there's no cycleDate at all -- nothing to compare, not a divergence", () => {
    const tx: StoredTransaction = { id: "t1", amount: 100, currency: "USD", bucket: "NEEDS", description: "Uni", date: "2026-08-01", recurringId: "r1" };
    expect(cycleMonthDivergence(tx, recurring)).toBeNull();
  });

  it("null when cycleDate is explicitly detached (null) -- matches isCycleConfirmed's own null handling, nothing to compare against", () => {
    const tx: StoredTransaction = { id: "t1", amount: 100, currency: "USD", bucket: "NEEDS", description: "Uni", date: "2026-08-01", cycleDate: null, recurringId: "r1" };
    expect(cycleMonthDivergence(tx, recurring)).toBeNull();
  });

  it("null when cycleDate and date fall in the SAME month, even if the exact day differs", () => {
    const tx: StoredTransaction = { id: "t1", amount: 100, currency: "USD", bucket: "NEEDS", description: "Uni", date: "2026-08-05", cycleDate: "2026-08-01", recurringId: "r1" };
    expect(cycleMonthDivergence(tx, recurring)).toBeNull();
  });

  it("a label naming the settled month and the recurring item's name when the months genuinely differ -- the owner's exact live case (date Aug 1, cycleDate Sep 1)", () => {
    const tx: StoredTransaction = { id: "t1", amount: 100, currency: "USD", bucket: "NEEDS", description: "Uni", date: "2026-08-01", cycleDate: "2026-09-01", recurringId: "r1" };
    expect(cycleMonthDivergence(tx, recurring)).toBe("Settles Sep 2026 — Uni");
  });

  it("falls back to 'a deleted recurring item' when recurringId no longer resolves -- same fallback the edit form's own Settles line already uses (2.4.32)", () => {
    const tx: StoredTransaction = { id: "t1", amount: 100, currency: "USD", bucket: "NEEDS", description: "Uni", date: "2026-08-01", cycleDate: "2026-09-01", recurringId: "gone" };
    expect(cycleMonthDivergence(tx, recurring)).toBe("Settles Sep 2026 — a deleted recurring item");
  });
});

describe("pendingBackfillCycles", () => {
  it("returns nothing for an item with no confirmCutoverDate -- nothing to backfill for a v3-native item", () => {
    const r = makeRecurring({ id: "r1", amount: 750, totalAmount: 6750, startDate: "2026-01-01" }); // no cutover
    expect(pendingBackfillCycles(r, [])).toEqual([]);
  });

  it("returns nothing for an uncapped item -- backfill only matters where recurringPaidSoFar's cap is displayed", () => {
    const r = makeRecurring({ id: "r1", amount: 750, totalAmount: null, startDate: "2026-01-01", confirmCutoverDate: "2026-04-01" });
    expect(pendingBackfillCycles(r, [])).toEqual([]);
  });

  it("lists every pre-cutover cycle when none have been confirmed", () => {
    const r = makeRecurring({ id: "r1", amount: 750, totalAmount: 6750, startDate: "2026-01-01", confirmCutoverDate: "2026-04-01" });
    const cycles = pendingBackfillCycles(r, []);
    expect(cycles.map((d) => d.toISOString().slice(0, 10))).toEqual(["2026-01-01", "2026-02-01", "2026-03-01"]);
  });

  it("excludes a pre-cutover cycle that already has a confirming transaction -- already backfilled once, not offered again", () => {
    const r = makeRecurring({ id: "r1", amount: 750, totalAmount: 6750, startDate: "2026-01-01", confirmCutoverDate: "2026-04-01" });
    const tx: StoredTransaction = { id: "t1", amount: 750, currency: "USD", bucket: "NEEDS", description: "Uni", date: "2026-02-01", recurringId: "r1", cycleDate: "2026-02-01" };
    const cycles = pendingBackfillCycles(r, [tx]);
    expect(cycles.map((d) => d.toISOString().slice(0, 10))).toEqual(["2026-01-01", "2026-03-01"]);
  });

  it("never includes a cycle due on or after the cutover -- those aren't grandfathered, they go through the normal confirm flow instead", () => {
    const r = makeRecurring({ id: "r1", amount: 750, totalAmount: 6750, startDate: "2026-01-01", confirmCutoverDate: "2026-02-15" });
    const cycles = pendingBackfillCycles(r, []);
    // Jan 1 and Feb 1 both precede the Feb 15 cutover; Mar 1 does not.
    expect(cycles.map((d) => d.toISOString().slice(0, 10))).toEqual(["2026-01-01", "2026-02-01"]);
  });

  it("returns nothing once every pre-cutover cycle is already confirmed", () => {
    const r = makeRecurring({ id: "r1", amount: 750, totalAmount: 1500, startDate: "2026-01-01", confirmCutoverDate: "2026-03-01" });
    const tx = (date: string): StoredTransaction => ({ id: `t-${date}`, amount: 750, currency: "USD", bucket: "NEEDS", description: "Uni", date, recurringId: "r1", cycleDate: date });
    expect(pendingBackfillCycles(r, [tx("2026-01-01"), tx("2026-02-01")])).toEqual([]);
  });

  it("integration: backfilling a listed cycle via buildRecurringConfirmLog removes it from the pending list and makes recurringPaidSoFar count it -- the full 2.4.31 fix, end to end", () => {
    const r = makeRecurring({ id: "r1", amount: 750, totalAmount: 6750, startDate: "2026-01-01", confirmCutoverDate: "2026-04-01" });
    expect(recurringPaidSoFar(r, [])).toBe(0);
    const pending = pendingBackfillCycles(r, []);
    expect(pending.length).toBe(3);
    const { tx } = buildRecurringConfirmLog(r, 89500, pending[0]); // backfill Jan 1
    expect(tx.date).toBe("2026-01-01"); // dated to its own historical due date, not today
    expect(tx.cycleDate).toBe("2026-01-01");
    const afterBackfill = [tx];
    expect(pendingBackfillCycles(r, afterBackfill).length).toBe(2); // Jan no longer pending
    expect(recurringPaidSoFar(r, afterBackfill)).toBe(750); // and now counts toward the cap
  });
});

describe("isCycleOverdue", () => {
  it("false when the cycle is already confirmed, even if it's well past due", () => {
    const r = makeRecurring({ id: "r1" });
    const due = utcMidnight(2026, 0, 1); // Jan 1, long past
    const tx: StoredTransaction = { id: "t1", amount: 100, currency: "USD", bucket: "NEEDS", description: "Rent", date: "2026-01-01", recurringId: "r1" };
    expect(isCycleOverdue(r, due, utcMidnight(2026, 7, 1), [tx])).toBe(false);
  });

  it("false when the cycle isn't due yet", () => {
    const r = makeRecurring();
    const due = utcMidnight(2026, 8, 1); // Sep 1
    expect(isCycleOverdue(r, due, utcMidnight(2026, 7, 1), [])).toBe(false); // asOf Aug 1
  });

  it("false on the due date itself -- overdue starts the day after, not the moment the day begins", () => {
    const r = makeRecurring();
    const due = utcMidnight(2026, 7, 1); // Aug 1
    expect(isCycleOverdue(r, due, utcMidnight(2026, 7, 1), [])).toBe(false); // asOf also Aug 1
  });

  it("true the day after an unconfirmed cycle's due date, no cutover on the item at all", () => {
    const r = makeRecurring(); // no confirmCutoverDate -- a fresh item, no grace ever
    const due = utcMidnight(2026, 7, 1); // Aug 1
    expect(isCycleOverdue(r, due, utcMidnight(2026, 7, 2), [])).toBe(true); // asOf Aug 2
  });

  it("false for a cycle due BEFORE the item's confirmCutoverDate -- grandfathered, never overdue no matter how much time has passed", () => {
    const r = makeRecurring({ confirmCutoverDate: "2026-08-15" });
    const due = utcMidnight(2026, 6, 1); // Jul 1 -- well before the Aug 15 cutover
    expect(isCycleOverdue(r, due, utcMidnight(2026, 9, 1), [])).toBe(false); // asOf Oct 1, months later
  });

  it("true for a cycle due ON OR AFTER confirmCutoverDate, once past due and unconfirmed -- cutover itself is not grandfathered", () => {
    const r = makeRecurring({ confirmCutoverDate: "2026-08-15" });
    const dueOnCutover = utcMidnight(2026, 7, 15); // exactly Aug 15
    expect(isCycleOverdue(r, dueOnCutover, utcMidnight(2026, 7, 16), [])).toBe(true); // asOf Aug 16
  });
});

describe("buildRecurringConfirmLog", () => {
  const RATE = 89500;

  it("dates the transaction to the exact cycle passed in, not to today -- confirming an old overdue cycle stays dated when it was actually due", () => {
    const r = makeRecurring({ amount: 500, startDate: "2026-01-01" });
    const oldCycle = utcMidnight(2026, 2, 1); // Mar 1, an overdue cycle confirmed much later
    const result = buildRecurringConfirmLog(r, RATE, oldCycle);
    expect(result.tx.date).toBe("2026-03-01");
    expect(result.cycleYm).toBe("2026-03");
  });

  it("stamps recurringId to the item's own id -- this is what makes isCycleConfirmed find it later", () => {
    const r = makeRecurring({ id: "r7" });
    const result = buildRecurringConfirmLog(r, RATE, utcMidnight(2026, 5, 1));
    expect(result.tx.recurringId).toBe("r7");
  });

  it("carries amount/currency/bucket/description/paymentMethod from the recurring item, category only when set", () => {
    const withCategory = makeRecurring({ category: "rent", currency: "LBP", bucket: "WANTS", name: "Netflix" });
    const r1 = buildRecurringConfirmLog(withCategory, RATE, utcMidnight(2026, 5, 1));
    expect(r1.tx).toMatchObject({ amount: 100, currency: "LBP", bucket: "WANTS", category: "rent", description: "Netflix", paymentMethod: "cash" });

    const withoutCategory = makeRecurring({ name: "Gym" });
    const r2 = buildRecurringConfirmLog(withoutCategory, RATE, utcMidnight(2026, 5, 1));
    expect("category" in r2.tx).toBe(false);
  });

  it("captures lbpRateAtEntry for an LBP item using the rate passed in; nothing for USD", () => {
    const lbpItem = makeRecurring({ currency: "LBP", amount: 500000 });
    const lbpResult = buildRecurringConfirmLog(lbpItem, 91000, utcMidnight(2026, 5, 1));
    expect(lbpResult.tx.lbpRateAtEntry).toBe(91000);

    const usdItem = makeRecurring({ currency: "USD" });
    const usdResult = buildRecurringConfirmLog(usdItem, RATE, utcMidnight(2026, 5, 1));
    expect(usdResult.tx.lbpRateAtEntry).toBeUndefined();
  });

  it("generates a fresh id on every call", () => {
    const r = makeRecurring();
    const a = buildRecurringConfirmLog(r, RATE, utcMidnight(2026, 5, 1));
    const b = buildRecurringConfirmLog(r, RATE, utcMidnight(2026, 5, 1));
    expect(a.tx.id).not.toBe(b.tx.id);
  });

  it("dates the transaction to the paid date when given, defaulting to the due date when not -- cycleDate always tracks the real cycle regardless (2.4.30 fix, finding A)", () => {
    const r = makeRecurring({ amount: 500, startDate: "2026-01-01" });
    const due = utcMidnight(2026, 7, 1); // Aug 1
    const paidLate = utcMidnight(2026, 7, 5); // Aug 5
    const result = buildRecurringConfirmLog(r, RATE, due, paidLate);
    expect(result.tx.date).toBe("2026-08-05"); // the real payment date
    expect(result.tx.cycleDate).toBe("2026-08-01"); // still the cycle it confirms
  });

  it("defaults paidDate to the due date when not given -- unchanged behavior for the common case", () => {
    const r = makeRecurring({ amount: 500, startDate: "2026-01-01" });
    const due = utcMidnight(2026, 7, 1);
    const result = buildRecurringConfirmLog(r, RATE, due);
    expect(result.tx.date).toBe("2026-08-01");
    expect(result.tx.cycleDate).toBe("2026-08-01");
  });
});

describe("historizedRecurringContribution", () => {
  it("returns 0 for an item with NO confirmCutoverDate at all -- a v3-native item needs confirmation from its own first month, it does not fall back to the old accrual", () => {
    // Naive implementation risk: `!cutoverYm || ym < cutoverYm` reads as
    // "no cutover -> always old rule," which is backwards -- a fresh item
    // created after the account was already on schema v3 has no history to
    // grandfather at all.
    const r = makeRecurring({ amount: 100, startDate: "2026-03-01" }); // no confirmCutoverDate
    expect(historizedRecurringContribution(r, "2026-03", utcMidnight(2026, 2, 15))).toBe(0);
  });

  it("returns the old monthlyEquivalent accrual for a month strictly before the item's own cutover", () => {
    const r = makeRecurring({ amount: 100, startDate: "2026-01-01", confirmCutoverDate: "2026-04-01" });
    const asOf = utcMidnight(2026, 1, 15); // Feb 15 -- before the Apr 1 cutover
    expect(historizedRecurringContribution(r, "2026-02", asOf)).toBe(monthlyEquivalent(r, asOf));
    expect(historizedRecurringContribution(r, "2026-02", asOf)).toBe(100);
  });

  it("returns 0 for the cutover's own month, not the old accrual -- the cutover month itself is NOT grandfathered", () => {
    const r = makeRecurring({ amount: 100, startDate: "2026-01-01", confirmCutoverDate: "2026-04-01" });
    expect(historizedRecurringContribution(r, "2026-04", utcMidnight(2026, 3, 15))).toBe(0);
  });

  it("returns 0 for a month well after the cutover, even though monthlyEquivalent alone would still report a nonzero accrual", () => {
    const r = makeRecurring({ amount: 100, startDate: "2026-01-01", confirmCutoverDate: "2026-04-01" });
    const asOf = utcMidnight(2026, 5, 15); // Jun 15, well past cutover
    expect(monthlyEquivalent(r, asOf)).toBe(100); // the old estimate would still say $100...
    expect(historizedRecurringContribution(r, "2026-06", asOf)).toBe(0); // ...but the new rule says 0 -- confirmed cycles are already real transactions, counted elsewhere
  });
});

describe("nextConfirmTarget", () => {
  it("before the item's own startDate, returns the start date itself as the next confirmable cycle -- confirmable early, same as today's behavior, not null", () => {
    const r = makeRecurring({ id: "r1", amount: 100, startDate: "2026-06-01" });
    const result = nextConfirmTarget(r, [], utcMidnight(2026, 4, 1)); // May 1, before the Jun 1 start
    expect(result?.dueDate.toISOString().slice(0, 10)).toBe("2026-06-01");
    expect(result?.overdueCount).toBe(0);
  });

  it("a confirmed current cycle with no backlog returns the NEXT cycle, not the one just confirmed", () => {
    const r = makeRecurring({ id: "r1", amount: 100, startDate: "2026-01-01" });
    const tx: StoredTransaction = { id: "t1", amount: 100, currency: "USD", bucket: "NEEDS", description: "Rent", date: "2026-01-01", recurringId: "r1" };
    const result = nextConfirmTarget(r, [tx], utcMidnight(2026, 0, 20)); // Jan 20 -- Jan 1 cycle already confirmed
    expect(result?.dueDate.toISOString().slice(0, 10)).toBe("2026-02-01");
    expect(result?.overdueCount).toBe(0);
  });

  it("a 3-cycle backlog returns the OLDEST outstanding cycle first (FIFO), with the real count", () => {
    const r = makeRecurring({ id: "r1", amount: 100, startDate: "2026-01-01" }); // no cutover -- overdue from day one
    const result = nextConfirmTarget(r, [], utcMidnight(2026, 2, 15)); // Mar 15 -- Jan 1/Feb 1/Mar 1 all past due, none confirmed
    expect(result?.dueDate.toISOString().slice(0, 10)).toBe("2026-01-01");
    expect(result?.overdueCount).toBe(3);
  });

  it("confirming the oldest outstanding cycle decrements the count and advances to the next-oldest", () => {
    const r = makeRecurring({ id: "r1", amount: 100, startDate: "2026-01-01" });
    const tx: StoredTransaction = { id: "t1", amount: 100, currency: "USD", bucket: "NEEDS", description: "Rent", date: "2026-01-01", recurringId: "r1" };
    const result = nextConfirmTarget(r, [tx], utcMidnight(2026, 2, 15)); // same asOf as the 3-cycle-backlog test, Jan 1 now confirmed
    expect(result?.dueDate.toISOString().slice(0, 10)).toBe("2026-02-01");
    expect(result?.overdueCount).toBe(2);
  });

  it("null once totalAmount is fully accounted for -- even though calendar time would otherwise keep producing cycles", () => {
    const r = makeRecurring({ id: "r1", amount: 100, totalAmount: 200, startDate: "2026-01-01" });
    const paid = ["2026-01-01", "2026-02-01"].map((date): StoredTransaction => ({ id: `t-${date}`, amount: 100, currency: "USD", bucket: "NEEDS", description: "Rent", date, recurringId: "r1" }));
    expect(nextConfirmTarget(r, paid, utcMidnight(2026, 2, 15))).toBeNull(); // Mar 15 -- fully paid off, nothing left to confirm
  });

  it("null once the item has genuinely ended -- endDate passed, and everything that was ever due is already confirmed", () => {
    const r = makeRecurring({ id: "r1", amount: 100, startDate: "2026-01-01", endDate: "2026-01-31" }); // exactly one cycle, ever
    const tx: StoredTransaction = { id: "t1", amount: 100, currency: "USD", bucket: "NEEDS", description: "Rent", date: "2026-01-01", recurringId: "r1" };
    expect(nextConfirmTarget(r, [tx], utcMidnight(2026, 2, 1))).toBeNull(); // Mar 1, well past endDate
  });

  it("BUG regression (2.4.30): confirming a cycle EARLY -- before its own due date -- must not be re-offered on the next call", () => {
    const r = makeRecurring({ id: "r1", amount: 750, startDate: "2026-02-01" }); // no cutover
    const asOf = utcMidnight(2026, 0, 25); // Jan 25 -- before the Feb 1 start/first cycle is even due
    const first = nextConfirmTarget(r, [], asOf);
    expect(first?.dueDate.toISOString().slice(0, 10)).toBe("2026-02-01"); // confirmable early, as designed
    // Confirm it early -- a transaction dated to the cycle (Feb 1); asOf hasn't moved, still Jan 25,
    // so this cycle is nowhere near "overdue" -- exactly the blind spot that produced 3 duplicate
    // transactions in live use (the owner clicking Confirm on Uni in Renewing Soon).
    const tx: StoredTransaction = { id: "t1", amount: 750, currency: "USD", bucket: "NEEDS", description: "Uni", date: "2026-02-01", recurringId: "r1" };
    const second = nextConfirmTarget(r, [tx], asOf);
    // Must advance to the NEXT cycle (Mar 1), not re-offer the one just confirmed.
    expect(second?.dueDate.toISOString().slice(0, 10)).toBe("2026-03-01");
  });

  it("confirming several cycles ahead in a row advances past all of them, not just the first -- a loop, not a single check", () => {
    const r = makeRecurring({ id: "r1", amount: 750, startDate: "2026-02-01" });
    const asOf = utcMidnight(2026, 0, 25); // Jan 25
    const tx1: StoredTransaction = { id: "t1", amount: 750, currency: "USD", bucket: "NEEDS", description: "Uni", date: "2026-02-01", recurringId: "r1" };
    const tx2: StoredTransaction = { id: "t2", amount: 750, currency: "USD", bucket: "NEEDS", description: "Uni", date: "2026-03-01", recurringId: "r1" };
    const result = nextConfirmTarget(r, [tx1, tx2], asOf);
    expect(result?.dueDate.toISOString().slice(0, 10)).toBe("2026-04-01");
  });
});

// CRITICAL, written before the implementation per Standing Rule 4: this is
// the fix for a real defect the Phase 1.4 plan review caught before it
// shipped -- GoalsScreen.pay() and InputPanel.contributeToGoal() both
// hardcoded `currency: "USD"` on the transaction they log for a
// contribution, independent of the goal's own (now possibly LBP) currency.
// Left unfixed, an LBP goal contribution logs a transaction carrying the
// raw LBP number tagged as USD -- computeDashboard.ts's toUSD treats that
// as a bare USD amount, inflating that month's savingsContrib/budget
// totals by roughly the LBP rate (tens of thousands of times over).
// Consolidating both call sites into one function closes the exact
// duplicate-site drift this codebase has already been bitten by more than
// once (GoalsScreen.pay vs InputPanel.contributeToGoal is literally the
// same pair that drifted on `achievedAt` earlier in this project).
describe("buildGoalContributionTx", () => {
  const goal: StoredGoal = { id: "g1", name: "Travel", emoji: "🎯", targetAmount: 1000, currentAmount: 0, currency: "USD", targetDate: "2027-01-01", createdAt: "2026-01-01T00:00:00.000Z" };

  it("a USD goal's contribution transaction is USD, no rate captured", () => {
    const tx = buildGoalContributionTx(goal, 100, 89500);
    expect(tx.currency).toBe("USD");
    expect(tx.amount).toBe(100);
    expect(tx.bucket).toBe("SAVINGS");
    expect(tx.description).toBe("Goal: Travel");
    expect(tx.lbpRateAtEntry).toBeUndefined();
  });

  it("an LBP goal's contribution transaction is LBP, with the current rate captured -- NOT silently tagged USD", () => {
    const lbpGoal: StoredGoal = { ...goal, currency: "LBP" };
    const tx = buildGoalContributionTx(lbpGoal, 4_500_000, 89500);
    expect(tx.currency).toBe("LBP");
    expect(tx.amount).toBe(4_500_000);
    expect(tx.lbpRateAtEntry).toBe(89500);
  });

  it("generates a fresh id per call", () => {
    const a = buildGoalContributionTx(goal, 50, 89500);
    const b = buildGoalContributionTx(goal, 50, 89500);
    expect(a.id).not.toBe(b.id);
  });

  // Phase 2.6.4 -- closes half of 2.4.41 (buildGoalContributionTx hardcoded
  // paymentMethod "other", so a contribution could never reduce a tracked
  // balance's expected figure no matter which real account funded it).
  it("defaults to paymentMethod 'other' when no opts are given -- backward compatible with every existing call site until they're updated", () => {
    const tx = buildGoalContributionTx(goal, 50, 89500);
    expect(tx.paymentMethod).toBe("other");
    expect(tx.cardId).toBeUndefined();
  });

  it("carries a real payment method when given one", () => {
    const tx = buildGoalContributionTx(goal, 50, 89500, { paymentMethod: "cash" });
    expect(tx.paymentMethod).toBe("cash");
  });

  it("carries card + cardLabel when paid by card", () => {
    const tx = buildGoalContributionTx(goal, 50, 89500, { paymentMethod: "card", cardId: "c1", cardLabel: "Visa •••• 4242" });
    expect(tx.paymentMethod).toBe("card");
    expect(tx.cardId).toBe("c1");
    expect(tx.cardLabel).toBe("Visa •••• 4242");
  });

  it("carries a payment note only when paymentMethod is 'other'", () => {
    const tx = buildGoalContributionTx(goal, 50, 89500, { paymentMethod: "other", paymentNote: "Dad chipped in" });
    expect(tx.paymentNote).toBe("Dad chipped in");
  });

  // 2.4.47: neither goal-contribution form had a date field at all -- a
  // contribution made a few days ago could only ever be logged as today.
  it("defaults to today when no date is given -- backward compatible", () => {
    const tx = buildGoalContributionTx(goal, 50, 89500);
    expect(tx.date).toBe(todayISO());
  });

  it("carries a real, past date when one is given", () => {
    const tx = buildGoalContributionTx(goal, 50, 89500, { date: "2026-08-20" });
    expect(tx.date).toBe("2026-08-20");
  });
});

// AUD-05 (external audit, 2026-08-28): GoalsScreen.tsx's pay() and
// InputPanel.tsx's contributeToGoal() each independently reimplemented "what
// happens when you contribute to a goal" -- the exact duplication class
// that already caused a real shipped bug (git log: 2334ea9, "set achievedAt
// in InputPanel's quick-add goal contribution" -- one of the two forgot to
// set it at all). Third time this was flagged (ROADMAP.md's own Phase 2.6.4
// notes, then 2334ea9's own fix touching only one side, then this audit)
// without the underlying duplication actually being removed. Extracted the
// ONE implementation both callers now share.
describe("applyGoalContribution (AUD-05)", () => {
  const goal: StoredGoal = { id: "g1", name: "Travel", emoji: "🎯", targetAmount: 1000, currentAmount: 200, currency: "USD", targetDate: "2027-01-01", createdAt: "2026-01-01T00:00:00.000Z" };

  it("returns null when the goal doesn't exist -- callers can bail without a crash", () => {
    expect(applyGoalContribution([goal], "nonexistent", 50, 89500)).toBeNull();
  });

  it("bumps currentAmount by the contribution amount, leaving other goals untouched", () => {
    const other: StoredGoal = { ...goal, id: "g2", name: "Other", currentAmount: 500 };
    const result = applyGoalContribution([goal, other], "g1", 50, 89500)!;
    expect(result.goals.find((g) => g.id === "g1")!.currentAmount).toBe(250);
    expect(result.goals.find((g) => g.id === "g2")!.currentAmount).toBe(500); // untouched
  });

  it("sets achievedAt once a contribution crosses the target -- the exact case 2334ea9 fixed on only one of the two call sites", () => {
    const almostDone: StoredGoal = { ...goal, currentAmount: 950, targetAmount: 1000 };
    const result = applyGoalContribution([almostDone], "g1", 50, 89500)!;
    expect(result.goals[0].currentAmount).toBe(1000);
    expect(result.goals[0].achievedAt).toBeTruthy();
  });

  it("never clears an already-set achievedAt or overwrites it with a later date -- a contribution only ever increases currentAmount, there's no un-achieving case to handle", () => {
    const alreadyDone: StoredGoal = { ...goal, currentAmount: 1000, targetAmount: 1000, achievedAt: "2026-03-01" };
    const result = applyGoalContribution([alreadyDone], "g1", 20, 89500)!;
    expect(result.goals[0].achievedAt).toBe("2026-03-01"); // unchanged, not re-stamped to today
  });

  it("does not set achievedAt when the contribution doesn't reach the target", () => {
    const result = applyGoalContribution([goal], "g1", 10, 89500)!; // 200 + 10 = 210, target 1000
    expect(result.goals[0].achievedAt).toBeUndefined();
  });

  it("builds the contribution transaction via buildGoalContributionTx, carrying opts through -- one formula, not a second independent one", () => {
    const result = applyGoalContribution([goal], "g1", 50, 89500, { paymentMethod: "cash" })!;
    expect(result.transaction.amount).toBe(50);
    expect(result.transaction.description).toBe("Goal: Travel");
    expect(result.transaction.paymentMethod).toBe("cash");
  });
});

describe("Phase 2.6.3c -- buildDebtPaymentTx and buildEfAdjustmentTx (tests-first per Standing Rule 4)", () => {
  describe("buildDebtPaymentTx", () => {
    const debt: StoredDebt = { id: "d1", name: "Dad", balance: 2000, apr: 0, minPayment: 0, currency: "USD", createdAt: "2026-01-01T00:00:00.000Z", openingBalance: 2000 };

    it("links debtId and carries the picked bucket -- no silent default (owner's explicit instruction)", () => {
      const tx = buildDebtPaymentTx(debt, 325, "SAVINGS", 89500);
      expect(tx.debtId).toBe("d1");
      expect(tx.bucket).toBe("SAVINGS");
      expect(tx.amount).toBe(325);
      expect(tx.currency).toBe("USD");
      expect(tx.lbpRateAtEntry).toBeUndefined();
    });

    it("a payment on an LBP debt is LBP, with the current rate captured", () => {
      const lbpDebt: StoredDebt = { ...debt, currency: "LBP" };
      const tx = buildDebtPaymentTx(lbpDebt, 29_100_000, "NEEDS", 89500);
      expect(tx.currency).toBe("LBP");
      expect(tx.amount).toBe(29_100_000);
      expect(tx.lbpRateAtEntry).toBe(89500);
    });

    it("stamps createdAt and updatedAt", () => {
      const tx = buildDebtPaymentTx(debt, 100, "NEEDS", 89500);
      expect(tx.createdAt).toBeTruthy();
      expect(tx.updatedAt).toBe(tx.createdAt);
    });

    it("feeds derivedDebtBalance correctly -- a real payment reduces the debt by its own amount, matching the exact 2.4.27 scenario", () => {
      const tx = buildDebtPaymentTx(debt, 325, "NEEDS", 89500);
      expect(derivedDebtBalance(debt, [tx])).toBe(1675);
    });

    // Phase 2.6.4 -- closes 2.4.27 at its actual point of use (a partial
    // EF-sourced debt payment was enterable on the main transaction form
    // since (c), but never on the debt-payment form itself) plus the other
    // half of 2.4.41.
    it("defaults to paymentMethod 'other', no category, no efAmount, when no opts are given -- backward compatible", () => {
      const tx = buildDebtPaymentTx(debt, 100, "NEEDS", 89500);
      expect(tx.paymentMethod).toBe("other");
      expect(tx.category).toBeUndefined();
      expect(tx.efAmount).toBeUndefined();
    });

    it("carries a category when given one", () => {
      const tx = buildDebtPaymentTx(debt, 100, "NEEDS", 89500, { category: "debt-payoff" });
      expect(tx.category).toBe("debt-payoff");
    });

    it("carries a partial EF-sourced amount, the exact real 2.4.27 case -- $300 of a $325 payment came from EF", () => {
      const tx = buildDebtPaymentTx(debt, 325, "NEEDS", 89500, { efAmount: -300 });
      expect(tx.efAmount).toBe(-300);
      expect(derivedDebtBalance(debt, [tx])).toBe(1675);
      const data = { ...DEFAULT_DATA, emergencyFundOpeningBalance: 900, transactions: [tx] };
      expect(derivedEfBalance(data)).toBe(600); // 900 - 300, not the full 900 - 325
    });

    it("carries a real payment method and card when paid by card", () => {
      const tx = buildDebtPaymentTx(debt, 100, "NEEDS", 89500, { paymentMethod: "card", cardId: "c1", cardLabel: "Visa •••• 4242" });
      expect(tx.paymentMethod).toBe("card");
      expect(tx.cardId).toBe("c1");
      expect(tx.cardLabel).toBe("Visa •••• 4242");
    });

    // 2.4.47: the debt-payment form had no date field at all -- a payment
    // made a few days ago could only ever be logged as today.
    it("defaults to today when no date is given -- backward compatible", () => {
      const tx = buildDebtPaymentTx(debt, 100, "NEEDS", 89500);
      expect(tx.date).toBe(todayISO());
    });

    it("carries a real, past date when one is given", () => {
      const tx = buildDebtPaymentTx(debt, 100, "NEEDS", 89500, { date: "2026-08-20" });
      expect(tx.date).toBe("2026-08-20");
    });
  });

  // 2.4.55, sub-phase 2, tests-first per Standing Rule 4. Written after the
  // sign-polarity fix (see the flip commit), so these already assert the
  // CORRECT convention: positive = this pool gained, matching efAmount.
  describe("buildTransferTx", () => {
    const source = { paymentMethod: "cash" as const, label: "Cash" };
    const dest = { paymentMethod: "card" as const, cardId: "c1", cardLabel: "Visa •••• 4242", label: "Visa •••• 4242" };

    it("returns two transactions: a negative (lost) leg on the source pool, a positive (gained) leg on the destination", () => {
      const [outgoing, incoming] = buildTransferTx(50, "USD", source, dest, 89500);
      expect(outgoing.amount).toBe(-50);
      expect(outgoing.paymentMethod).toBe("cash");
      expect(incoming.amount).toBe(50);
      expect(incoming.paymentMethod).toBe("card");
      expect(incoming.cardId).toBe("c1");
      expect(incoming.cardLabel).toBe("Visa •••• 4242");
    });

    it("both legs are bucket TRANSFER, excluded from every budget total by construction", () => {
      const [outgoing, incoming] = buildTransferTx(50, "USD", source, dest, 89500);
      expect(outgoing.bucket).toBe("TRANSFER");
      expect(incoming.bucket).toBe("TRANSFER");
    });

    it("both legs share the same linkedPaymentId, and it's a fresh id -- not either leg's own id (Batch C's own precedent)", () => {
      const [outgoing, incoming] = buildTransferTx(50, "USD", source, dest, 89500);
      expect(outgoing.linkedPaymentId).toBeTruthy();
      expect(outgoing.linkedPaymentId).toBe(incoming.linkedPaymentId);
      expect(outgoing.linkedPaymentId).not.toBe(outgoing.id);
      expect(outgoing.linkedPaymentId).not.toBe(incoming.id);
      expect(outgoing.id).not.toBe(incoming.id);
    });

    it("each leg's own description names the OTHER side, so either row is self-explanatory read alone in the ledger", () => {
      const [outgoing, incoming] = buildTransferTx(50, "USD", source, dest, 89500);
      expect(outgoing.description).toContain(dest.label);
      expect(incoming.description).toContain(source.label);
    });

    it("correctly moves both tracked balances' expected figures in the real Balance Check formula -- not just isolated field assertions", () => {
      const [outgoing, incoming] = buildTransferTx(50, "USD", source, dest, 89500);
      const cashBalance: TrackedBalance = { id: "b1", name: "Cash", paymentMethod: "cash", startingBalance: 100, startingDate: "2026-07-01", currency: "USD" };
      const cardBalance: TrackedBalance = { id: "b2", name: "Card", paymentMethod: "card", cardId: "c1", startingBalance: 20, startingDate: "2026-07-01", currency: "USD" };
      const data = { ...DEFAULT_DATA, trackedBalances: [cashBalance, cardBalance], transactions: [outgoing, incoming] };
      expect(trackedBalanceExpected(cashBalance, data)).toBe(50);  // 100 - 50 (source lost 50)
      expect(trackedBalanceExpected(cardBalance, data)).toBe(70);  // 20 + 50 (destination gained 50)
    });

    it("an LBP transfer captures the current rate on both legs", () => {
      const [outgoing, incoming] = buildTransferTx(100_000, "LBP", source, dest, 89500);
      expect(outgoing.lbpRateAtEntry).toBe(89500);
      expect(incoming.lbpRateAtEntry).toBe(89500);
      expect(outgoing.currency).toBe("LBP");
      expect(incoming.currency).toBe("LBP");
    });

    it("defaults to today when no date is given; carries a real past date when one is given", () => {
      const [outgoing] = buildTransferTx(50, "USD", source, dest, 89500);
      expect(outgoing.date).toBe(todayISO());
      const [pastLeg] = buildTransferTx(50, "USD", source, dest, 89500, { date: "2026-08-20" });
      expect(pastLeg.date).toBe("2026-08-20");
    });

    it("source and destination on the SAME payment method (not a real transfer) is left to the caller to block -- this function doesn't guess intent, it just builds what it's given", () => {
      const samePool = { paymentMethod: "cash" as const, label: "Cash" };
      const [outgoing, incoming] = buildTransferTx(50, "USD", samePool, samePool, 89500);
      // Structurally valid (two real transactions), even though a same-pool
      // "transfer" is a no-op the UI should prevent before calling this --
      // documented here so that decision isn't silently assumed elsewhere.
      expect(outgoing.paymentMethod).toBe(incoming.paymentMethod);
    });
  });

  describe("retagBucketAmount (2.4.56)", () => {
    // The bug this closes: EditTransactionSheet.tsx lets a user reclassify
    // an existing transaction's bucket to TRANSFER (the documented,
    // intended reimbursement workflow), but TRANSFER's amount is signed
    // (positive = this pool gained money, negative = lost -- matching
    // efAmount's convention) while every other bucket's amount is always
    // non-negative. Retagging without adjusting the sign silently produces
    // a backwards-signed transaction with no error and no warning.
    it("retagging FROM a spend bucket (NEEDS/WANTS/SAVINGS) TO TRANSFER negates the amount -- the pool LOST that money, it didn't gain it", () => {
      expect(retagBucketAmount("NEEDS", "TRANSFER", 400)).toBe(-400);
      expect(retagBucketAmount("WANTS", "TRANSFER", 20)).toBe(-20);
      expect(retagBucketAmount("SAVINGS", "TRANSFER", 100)).toBe(-100);
    });

    it("retagging FROM INCOME TO TRANSFER does NOT flip the sign -- the pool genuinely gained that money (e.g. a repayment first logged as one-off Income, now correctly reclassified)", () => {
      expect(retagBucketAmount("INCOME", "TRANSFER", 400)).toBe(400);
    });

    it("retagging OUT of TRANSFER back to a normal bucket always returns a non-negative amount, matching every other bucket's own convention", () => {
      expect(retagBucketAmount("TRANSFER", "NEEDS", -400)).toBe(400);
      expect(retagBucketAmount("TRANSFER", "INCOME", -400)).toBe(400);
      expect(retagBucketAmount("TRANSFER", "WANTS", 400)).toBe(400);
    });

    it("switching between two non-TRANSFER buckets leaves the amount untouched -- both sides are already non-negative by construction", () => {
      expect(retagBucketAmount("NEEDS", "WANTS", 50)).toBe(50);
      expect(retagBucketAmount("WANTS", "INCOME", 50)).toBe(50);
    });

    it("re-selecting the same bucket (including TRANSFER twice) is a no-op", () => {
      expect(retagBucketAmount("TRANSFER", "TRANSFER", -75)).toBe(-75);
      expect(retagBucketAmount("NEEDS", "NEEDS", 75)).toBe(75);
    });

    it("is idempotent under a round trip -- retag to TRANSFER then immediately back recovers the original magnitude", () => {
      const original = 250;
      const asTransfer = retagBucketAmount("NEEDS", "TRANSFER", original);
      const back = retagBucketAmount("TRANSFER", "NEEDS", asTransfer);
      expect(back).toBe(original);
    });
  });

  describe("reanchorTrackedBalance (2.4.53)", () => {
    // The bug this closes: "Update" only ever RECORDED a mismatch
    // (actualBalance/expectedAtCheckUSD) -- startingBalance/startingDate
    // stayed wherever they were, so a real, unexplained drift (an ATM
    // withdrawal or card top-up never logged) compounded forever and no
    // check-in could ever resolve it, only re-certify it.
    const tb: TrackedBalance = {
      id: "b1", name: "Cash", paymentMethod: "cash",
      startingBalance: 100, startingDate: "2026-07-01", currency: "USD",
    };

    it("resets startingBalance to the newly confirmed actual figure, and startingDate to today", () => {
      const result = reanchorTrackedBalance(tb, 42, 55, 89500);
      expect(result.startingBalance).toBe(42);
      expect(result.startingDate).toBe(todayISO());
    });

    it("records actualBalance and a fresh actualBalanceDate, same as before this fix", () => {
      const result = reanchorTrackedBalance(tb, 42, 55, 89500);
      expect(result.actualBalance).toBe(42);
      expect(result.actualBalanceDate).toBeTruthy();
    });

    it("preserves the caller-supplied expectedAtCheckUSD (the OLD baseline's prediction) unchanged -- the discrepancy this check-in reveals must survive the re-anchor, not be erased by it", () => {
      const result = reanchorTrackedBalance(tb, 42, 55, 89500);
      expect(result.expectedAtCheckUSD).toBe(55);
    });

    it("re-captures the LBP rate at the new startingDate for an LBP-currency balance", () => {
      const lbpTb: TrackedBalance = { ...tb, currency: "LBP", startingBalance: 1_000_000 };
      const result = reanchorTrackedBalance(lbpTb, 500_000, 400_000, 91000);
      expect(result.lbpRateAtEntry).toBe(91000);
    });

    it("a USD balance carries no lbpRateAtEntry, same as every other USD record", () => {
      const result = reanchorTrackedBalance(tb, 42, 55, 89500);
      expect(result.lbpRateAtEntry).toBeUndefined();
    });

    it("leaves every other field (id, name, paymentMethod, currency) untouched", () => {
      const result = reanchorTrackedBalance(tb, 42, 55, 89500);
      expect(result.id).toBe(tb.id);
      expect(result.name).toBe(tb.name);
      expect(result.paymentMethod).toBe(tb.paymentMethod);
      expect(result.currency).toBe(tb.currency);
    });

    it("an explicit asOf date is used for BOTH actualBalanceDate and startingDate verbatim -- ImportStatement.tsx's own case, where a bank statement's closing balance was true as of the statement's own date, not whenever the file happened to be imported", () => {
      const result = reanchorTrackedBalance(tb, 42, 55, 89500, "2026-08-15");
      expect(result.actualBalanceDate).toBe("2026-08-15");
      expect(result.startingDate).toBe("2026-08-15");
    });

    it("real-world case: a $50 untracked ATM withdrawal drifted expected to $150 against a real $100 balance -- re-anchoring makes the NEXT check-in start from the true $100, not keep comparing against the stale $150 prediction forever", () => {
      const drifted: TrackedBalance = { ...tb, startingBalance: 200, startingDate: "2026-07-01" };
      // Simulates: expected was $150 (drifted), owner confirms the real $100.
      const reanchored = reanchorTrackedBalance(drifted, 100, 150, 89500);
      const txAfterReanchor = [{
        id: "t1", amount: 20, currency: "USD" as const, bucket: "NEEDS" as const,
        description: "Groceries", date: todayISO(), paymentMethod: "cash" as const,
      }];
      const data = { ...DEFAULT_DATA, trackedBalances: [reanchored], transactions: txAfterReanchor };
      // Correct going forward: $100 (the true, re-anchored balance) - $20 spent = $80.
      // Before this fix, the stale $200 starting balance would have produced
      // $180 instead -- still $50 too high, the exact undetected drift amount.
      expect(trackedBalanceExpected(reanchored, data)).toBe(80);
    });
  });

  describe("buildEfAdjustmentTx", () => {
    it("carries the delta as efAmount, with amount 0 -- a correction is not real spend or income and must not move any budget total", () => {
      const tx = buildEfAdjustmentTx(150);
      expect(tx.efAmount).toBe(150);
      expect(tx.amount).toBe(0);
      expect(tx.currency).toBe("USD");
      expect(tx.bucket).toBe("SAVINGS");
    });

    it("supports a negative delta (correcting the balance downward)", () => {
      const tx = buildEfAdjustmentTx(-75);
      expect(tx.efAmount).toBe(-75);
    });

    it("feeds derivedEfBalance correctly -- brings a stale opening balance to match a corrected current-balance figure", () => {
      const data = { ...DEFAULT_DATA, emergencyFundOpeningBalance: 900, transactions: [] as StoredTransaction[] };
      const delta = 1200 - derivedEfBalance(data); // owner says real balance is $1,200
      const tx = buildEfAdjustmentTx(delta);
      expect(derivedEfBalance({ ...data, transactions: [tx] })).toBe(1200);
    });
  });

  describe("buildDebtAdjustmentTx (Phase 2.6.4 step 3)", () => {
    const debt: StoredDebt = { id: "d1", name: "Dad", balance: 2000, apr: 0, minPayment: 0, currency: "USD", createdAt: "2026-01-01T00:00:00.000Z", openingBalance: 2000 };

    it("carries the delta as debtAdjustment, with amount 0 -- a correction is not a real payment and must not move any budget total", () => {
      const tx = buildDebtAdjustmentTx(debt, 150);
      expect(tx.debtAdjustment).toBe(150);
      expect(tx.amount).toBe(0);
      expect(tx.debtId).toBe("d1");
      expect(tx.currency).toBe("USD");
    });

    it("carries the debt's own currency, not USD unconditionally -- unlike buildEfAdjustmentTx, a debt correction is in the debt's own terms", () => {
      const lbpDebt: StoredDebt = { ...debt, currency: "LBP" };
      const tx = buildDebtAdjustmentTx(lbpDebt, 5_000_000);
      expect(tx.currency).toBe("LBP");
      expect(tx.debtAdjustment).toBe(5_000_000);
    });

    it("supports a negative delta (correcting the balance downward)", () => {
      const tx = buildDebtAdjustmentTx(debt, -75);
      expect(tx.debtAdjustment).toBe(-75);
    });

    it("feeds derivedDebtBalance correctly -- brings a stale opening balance to match a corrected current-balance figure", () => {
      // Sign is the OPPOSITE of buildEfAdjustmentTx's own delta (current -
      // entered, not entered - current): derivedDebtBalance SUBTRACTS `paid`
      // (amount + debtAdjustment) from openingBalance, while derivedEfBalance
      // ADDS contributions to its opening balance -- the two balances move
      // in opposite directions relative to their carrier field, so the same
      // delta formula would land on the wrong sign here.
      const delta = derivedDebtBalance(debt, []) - 1500; // owner says the real balance is $1,500
      const tx = buildDebtAdjustmentTx(debt, delta);
      expect(derivedDebtBalance(debt, [tx])).toBe(1500);
    });

    it("a debt correction moving the balance UP (e.g. missed interest) uses a negative debtAdjustment", () => {
      const delta = derivedDebtBalance(debt, []) - 2200; // owner says the real balance is actually $2,200, higher than the $2,000 shown
      const tx = buildDebtAdjustmentTx(debt, delta);
      expect(tx.debtAdjustment).toBe(-200);
      expect(derivedDebtBalance(debt, [tx])).toBe(2200);
    });

    it("stamps createdAt and updatedAt", () => {
      const tx = buildDebtAdjustmentTx(debt, 100);
      expect(tx.createdAt).toBeTruthy();
      expect(tx.updatedAt).toBe(tx.createdAt);
    });
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

  it("Phase 1.2: a v0 record loaded from storage is migrated AND the migrated result is written back immediately -- not deferred to the next save", async () => {
    // This is the case the migration-chain-gap fix and this test both
    // exist for: a real account that predates schemaVersion entirely,
    // taken through BOTH hops (0->1->2) via loadData's own write-back path
    // -- not migrateFinancials in isolation -- checking the actual bytes
    // that end up on disk, not just the in-memory return value.
    const { createEnvelopes, activateSessionKey, encryptJSON, decryptJSON } = await import("./crypto");
    const userId = "test-user-v0-writeback";
    const { dek } = await createEnvelopes("pw", userId);
    activateSessionKey(dek);

    const v0Raw: Partial<LocalFinancials> = {
      ...DEFAULT_DATA,
      goals: [{ id: "g1", name: "Old goal", emoji: "🎯", targetAmount: 100, currentAmount: 0, targetDate: "2027-01-01", createdAt: "2026-01-01T00:00:00.000Z" } as StoredGoal],
    };
    delete v0Raw.schemaVersion; // no schemaVersion key at all -- every real account before 1.1
    const encrypted = await encryptJSON(JSON.stringify(v0Raw));
    localStorage.setItem(`essa_data_${userId}`, encrypted);

    const loaded = await loadData(userId);
    expect(loaded.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect((loaded.goals[0] as StoredGoal).currency).toBe("USD");

    // Decrypt what's actually in storage now, independent of loaded's own
    // return value -- proves the write-back really happened.
    const stillStored = localStorage.getItem(`essa_data_${userId}`)!;
    const decrypted = JSON.parse(await decryptJSON(stillStored));
    expect(decrypted.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(decrypted.goals[0].currency).toBe("USD");
  });

  it("a write-back failure during load does not discard the successfully-migrated in-memory data", async () => {
    // The inner try/catch around loadData's write-back call must be doing
    // its job: a saveData hiccup (quota, encryption) should never fall
    // into the OUTER catch, which would silently hand back DEFAULT_DATA in
    // place of a real, correctly-migrated account.
    const { createEnvelopes, activateSessionKey, encryptJSON } = await import("./crypto");
    const userId = "test-user-writeback-fails";
    const { dek } = await createEnvelopes("pw", userId);
    activateSessionKey(dek);

    const v0Raw: Partial<LocalFinancials> = { ...DEFAULT_DATA, userName: "Should Survive A Failed Write-Back" };
    delete v0Raw.schemaVersion;
    const encrypted = await encryptJSON(JSON.stringify(v0Raw));
    localStorage.setItem(`essa_data_${userId}`, encrypted);

    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("simulated quota/storage failure");
    });
    try {
      const loaded = await loadData(userId);
      expect(loaded.userName).toBe("Should Survive A Failed Write-Back");
      expect(loaded.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    } finally {
      setItemSpy.mockRestore();
    }
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

  it("migrates a record with no schemaVersion at all (every real account today): every pre-existing value is unchanged, and the new v2 fields are correctly backfilled", () => {
    // Rewritten for Phase 1.2 -- the previous version of this test asserted
    // whole-object equality against the raw fixture, which was the actual
    // proof of "no behavior change" back when v1 had no real transform.
    // Now that v2 adds currency to goals/debts and backfills lbpRateAtEntry
    // on LBP records, that assertion is EXPECTED to fail -- planned work,
    // not a regression (see docs/ROADMAP.md Phase 1.2 planning notes).
    // Checking field-by-field instead: everything pre-existing is
    // byte-identical, and only the new fields are populated, with exactly
    // the values the app's own existing conversion logic already produces.
    const legacy = legacyFixture();
    const migrated = migrateFinancials(legacy);
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);

    // Goals/debts: currency backfilled to USD, nothing else touched.
    expect(migrated.goals).toEqual([
      { id: "g1", name: "Trip", emoji: "🎯", targetAmount: 3000, currentAmount: 500, targetDate: "2027-01-01", createdAt: "2026-01-01T00:00:00.000Z", currency: "USD" },
      { id: "g2", name: "Paused Goal", emoji: "🎯", targetAmount: 1000, currentAmount: 0, targetDate: "2027-06-01", createdAt: "2026-02-01T00:00:00.000Z", pausedAt: "2026-07-01T00:00:00.000Z", currency: "USD" },
    ]);
    expect(migrated.debts).toEqual([
      { id: "d1", name: "Loan", balance: 1500, apr: 0, minPayment: 0, createdAt: "2026-01-01T00:00:00.000Z", openedDate: "2026-01-01", currency: "USD", openingBalance: 1500 },
    ]);
    // Phase 2.6.1 (v3 -> v4): emergencyFundOpeningBalance snapshotted from
    // the fixture's own emergencyFundBalance (500).
    expect(migrated.emergencyFundOpeningBalance).toBe(500);

    // Transactions: the LBP one (t2) gets lbpRateAtEntry backfilled from
    // valueForMonth(lbpRateHistory, "2026-08", lbpRate) -- the fixture's
    // history has an exact "2026-08" entry (89500), so that's the value.
    // Both USD transactions are byte-identical, untouched.
    expect(migrated.transactions).toEqual([
      { id: "t1", amount: 25.5, currency: "USD", bucket: "WANTS", description: "Dining", date: "2026-08-01", paymentMethod: "cash", category: "dining" },
      { id: "t2", amount: 150000, currency: "LBP", bucket: "NEEDS", description: "Groceries", date: "2026-08-02", paymentMethod: "card", cardId: "c1", cardLabel: "Visa •••• 1234", category: "groceries", lbpRateAtEntry: 89500 },
      { id: "t3", amount: 0, currency: "USD", bucket: "NEEDS", description: "Split bill", date: "2026-08-03", paymentMethod: "other", paymentNote: "Paid by roommate", category: "utilities" },
    ]);

    // Recurring: deliberately never gets a rate -- byte-identical on every
    // pre-existing field, both being USD anyway. Phase 2.5's v2->v3 step
    // additionally stamps confirmCutoverDate = today on both, since this
    // fixture has no schemaVersion at all (a v0 record walks the full
    // 0->1->2->3 chain in one migrateFinancials call).
    expect(migrated.recurring).toEqual([
      { id: "r1", name: "Tuition", emoji: "🔄", amount: 500, currency: "USD", frequency: "monthly", bucket: "NEEDS", startDate: "2026-01-01", endDate: null, totalAmount: 4500, createdAt: "2026-01-01T00:00:00.000Z", confirmCutoverDate: todayISO() },
      { id: "r2", name: "Streaming", emoji: "🔄", amount: 8, currency: "USD", frequency: "monthly", bucket: "WANTS", startDate: "2026-01-01", endDate: null, totalAmount: null, createdAt: "2026-01-01T00:00:00.000Z", confirmCutoverDate: todayISO() },
    ]);

    // Tracked balance: USD, untouched.
    expect(migrated.trackedBalances).toEqual([
      { id: "tb1", name: "Cash", paymentMethod: "cash", startingBalance: 100, startingDate: "2026-08-01", currency: "USD", actualBalance: 80, actualBalanceDate: "2026-08-15T00:00:00.000Z", expectedAtCheckUSD: 82.5 },
    ]);

    // Spot-check representative top-level fields the transform never touches.
    expect(migrated.userName).toBe("Test User");
    expect(migrated.income).toBe(2000);
    expect(migrated.lbpRate).toBe(89500);
    expect(migrated.customCategories).toEqual(legacy.customCategories);
  });

  it("v1 -> v2 in isolation (single-hop, not the v0 double-hop): a record already at v1 gets the same currency/rate backfill", () => {
    const v1 = { ...legacyFixture(), schemaVersion: 1 };
    const migrated = migrateFinancials(v1);
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrated.goals.every((g) => g.currency === "USD")).toBe(true);
    expect(migrated.debts.every((d) => d.currency === "USD")).toBe(true);
    expect((migrated.transactions.find((t) => t.id === "t2") as StoredTransaction).lbpRateAtEntry).toBe(89500);
  });

  it("does not overwrite a goal/debt that already has a currency, or an LBP record that already has lbpRateAtEntry -- idempotent, and safe once 1.4 adds real non-USD goals", () => {
    const withExisting: Record<string, unknown> = {
      ...legacyFixture(),
      goals: [{ id: "g3", name: "Already LBP", emoji: "🎯", targetAmount: 100, currentAmount: 0, targetDate: "2027-01-01", createdAt: "2026-01-01T00:00:00.000Z", currency: "LBP" }],
      transactions: [{ id: "t9", amount: 1000, currency: "LBP", bucket: "WANTS", description: "Already rated", date: "2026-08-01", paymentMethod: "cash", lbpRateAtEntry: 12345 }],
    };
    const migrated = migrateFinancials(withExisting);
    expect(migrated.goals[0].currency).toBe("LBP"); // not clobbered to USD
    expect((migrated.transactions[0] as StoredTransaction).lbpRateAtEntry).toBe(12345); // not re-backfilled to today's rate
  });

  it("never populates lbpRateAtEntry on a recurring item, even one denominated in LBP (regression guard -- see StoredRecurring's own type comment for why)", () => {
    const withLbpRecurring: Record<string, unknown> = {
      ...legacyFixture(),
      recurring: [{ id: "r9", name: "LBP rent", emoji: "🔄", amount: 500000, currency: "LBP", frequency: "monthly", bucket: "NEEDS", startDate: "2026-01-01", endDate: null, totalAmount: null, createdAt: "2026-01-01T00:00:00.000Z" }],
    };
    const migrated = migrateFinancials(withLbpRecurring);
    expect(migrated.recurring[0].lbpRateAtEntry).toBeUndefined();
  });

  it("v2 -> v3 in isolation (Phase 2.5.1): every existing recurring item gets confirmCutoverDate stamped to today, nothing else changes", () => {
    const originalRecurring = legacyFixture().recurring as StoredRecurring[];
    const v2 = { ...legacyFixture(), schemaVersion: 2 };
    const migrated = migrateFinancials(v2);
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrated.recurring.every((r) => r.confirmCutoverDate === todayISO())).toBe(true);
    // Nothing else about the recurring items moved -- same amounts, same
    // totalAmount cap, same ids, same order.
    expect(migrated.recurring.map((r) => ({ ...r, confirmCutoverDate: undefined }))).toEqual(
      originalRecurring.map((r) => ({ ...r, confirmCutoverDate: undefined })),
    );
  });

  it("does not overwrite a recurring item that already has confirmCutoverDate -- idempotent, and correct for a device migrating a second time", () => {
    const withExistingCutover: Record<string, unknown> = {
      ...legacyFixture(),
      recurring: [{ id: "r9", name: "Already cut over", emoji: "🔄", amount: 200, currency: "USD", frequency: "monthly", bucket: "NEEDS", startDate: "2025-01-01", endDate: null, totalAmount: null, createdAt: "2025-01-01T00:00:00.000Z", confirmCutoverDate: "2025-06-15" }],
    };
    const migrated = migrateFinancials(withExistingCutover);
    expect(migrated.recurring[0].confirmCutoverDate).toBe("2025-06-15"); // not overwritten to today
  });

  it("v3 -> v4 (Phase 2.6.1): emergencyFundOpeningBalance and every debt's openingBalance are snapshotted from their current values, nothing else changes", () => {
    const v3 = { ...legacyFixture(), schemaVersion: 3 };
    const migrated = migrateFinancials(v3);
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrated.emergencyFundOpeningBalance).toBe(500); // legacyFixture's emergencyFundBalance
    // Field-specific, not a full toEqual -- this fixture is artificially
    // relabeled schemaVersion:3 (skipping v1->v2's currency backfill, which
    // a genuine v3 record would already have gone through), so only the
    // field this migration step itself is responsible for is asserted.
    expect(migrated.debts[0].id).toBe("d1");
    expect(migrated.debts[0].balance).toBe(1500);
    expect(migrated.debts[0].openingBalance).toBe(1500);
    // StoredTransaction's new fields (createdAt/deletedAt/debtId/efAmount)
    // get NO migration action -- unlike an opening balance, there's no
    // historical value to recover for a pre-existing transaction.
    for (const t of migrated.transactions) {
      expect(t.createdAt).toBeUndefined();
      expect(t.deletedAt).toBeUndefined();
      expect(t.debtId).toBeUndefined();
      expect(t.efAmount).toBeUndefined();
    }
  });

  it("does not overwrite emergencyFundOpeningBalance or a debt's openingBalance that's already set -- idempotent, and correct for a device migrating a second time", () => {
    const withExistingOpening: Record<string, unknown> = {
      ...legacyFixture(),
      emergencyFundBalance: 900, // current balance has since moved...
      emergencyFundOpeningBalance: 500, // ...but the real opening snapshot must not be re-taken from the new current value
      debts: [{ id: "d9", name: "Already migrated", balance: 800, apr: 0, minPayment: 0, createdAt: "2026-01-01T00:00:00.000Z", currency: "USD", openingBalance: 1500 }],
    };
    const migrated = migrateFinancials(withExistingOpening);
    expect(migrated.emergencyFundOpeningBalance).toBe(500); // not reset to the current 900
    expect(migrated.debts[0].openingBalance).toBe(1500); // not reset to the current 800
  });

  it("running the v3 -> v4 migration twice over the same fixture produces identical output (idempotent)", () => {
    const v3 = { ...legacyFixture(), schemaVersion: 3 };
    const once = migrateFinancials(v3);
    const twice = migrateFinancials(once);
    expect(twice).toEqual(once);
  });

  it("a recurring item created fresh (no schemaVersion migration involved -- already at CURRENT_SCHEMA_VERSION) never gets a confirmCutoverDate: there's no history to grandfather", () => {
    const freshAccount: LocalFinancials = {
      ...DEFAULT_DATA,
      recurring: [{ id: "r-new", name: "New subscription", emoji: "🔄", amount: 10, currency: "USD", frequency: "monthly", bucket: "WANTS", startDate: todayISO(), endDate: null, totalAmount: null, createdAt: new Date().toISOString() }],
    };
    // Already current -- migrateFinancials should pass it through untouched,
    // exactly like the "already at CURRENT_SCHEMA_VERSION" test below.
    expect(migrateFinancials(freshAccount).recurring[0].confirmCutoverDate).toBeUndefined();
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

  // Regression guard for the chain-gap bug: MIGRATIONS must be a contiguous
  // fromVersion chain, or a record several versions behind silently stops
  // partway through and still gets stamped current -- the version marker
  // lying about a transform that never ran. There's only one real version
  // transition in the codebase today (0->1, a no-op bump), so a second,
  // synthetic step with a REAL field change is supplied here to prove the
  // chain-walking mechanism itself correctly carries a v0 record through
  // multiple hops -- not just that the final version number looks right,
  // which is exactly the value this failure mode gets wrong for free.
  describe("multi-step chain walking (synthetic steps -- exercises the general chain-walking mechanism directly, independent of whatever the real MIGRATIONS table currently contains)", () => {
    const bridgeStep = { fromVersion: 0, migrate: (d: LocalFinancials) => ({ ...d, schemaVersion: 1 }) };
    const realTransformStep = {
      fromVersion: 1,
      migrate: (d: LocalFinancials) => ({ ...d, schemaVersion: 2, userName: `${d.userName} [migrated-v2]` }),
    };

    it("a v0 record walks through BOTH hops, receiving the second step's real field change -- not just a version number", () => {
      const legacy = legacyFixture();
      const migrated = migrateFinancials(legacy, [bridgeStep, realTransformStep]);
      // If the bridge step were missing (the actual bug), this record would
      // never reach realTransformStep at all, and userName would be untouched.
      expect(migrated.userName).toBe("Test User [migrated-v2]");
      // Still correctly normalized to today's real CURRENT_SCHEMA_VERSION (1)
      // regardless of the synthetic chain's own higher intermediate number --
      // migrateFinancials's final line stamps this independently of migrations.
      expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    });

    it("documents the exact failure mode: without the bridge step, a v0 record skips the transform entirely while the version stamp still claims current", () => {
      const legacy = legacyFixture();
      const migrated = migrateFinancials(legacy, [realTransformStep]); // no bridge -- reproduces the original bug
      expect(migrated.userName).toBe("Test User"); // unchanged -- silently skipped
      expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION); // yet the stamp still lies, claiming current
    });
  });

  describe("Phase 2.6.3b -- activeTransactions (soft-delete filter, tests-first per Standing Rule 4)", () => {
    function makeTx(overrides: Partial<StoredTransaction> = {}): StoredTransaction {
      return {
        id: "t1", amount: 100, currency: "USD", bucket: "NEEDS",
        description: "Test", date: "2026-08-01",
        ...overrides,
      };
    }

    it("returns every transaction unchanged when nothing is deleted", () => {
      const txs = [makeTx({ id: "t1" }), makeTx({ id: "t2" })];
      expect(activeTransactions(txs)).toEqual(txs);
    });

    it("excludes a transaction with deletedAt set", () => {
      const txs = [makeTx({ id: "t1" }), makeTx({ id: "t2", deletedAt: "2026-08-20T00:00:00.000Z" })];
      expect(activeTransactions(txs).map((t) => t.id)).toEqual(["t1"]);
    });

    it("returns an empty array when every transaction is deleted", () => {
      const txs = [makeTx({ id: "t1", deletedAt: "2026-08-20T00:00:00.000Z" })];
      expect(activeTransactions(txs)).toEqual([]);
    });

    it("treats undefined deletedAt as active, not just a literal absence check quirk", () => {
      const txs = [makeTx({ id: "t1", deletedAt: undefined })];
      expect(activeTransactions(txs)).toEqual(txs);
    });
  });

  describe("purgeTransaction (permanent delete, 2026-09-01 -- scrub, not remove, tests-first per Standing Rule 4)", () => {
    function makeDeletedTx(overrides: Partial<StoredTransaction> = {}): StoredTransaction {
      return {
        id: "t1", amount: 42, currency: "USD", bucket: "NEEDS",
        description: "Sensitive grocery run", date: "2026-08-01",
        deletedAt: "2026-08-20T00:00:00.000Z",
        category: "groceries", paymentMethod: "card", cardId: "c1", cardLabel: "Visa •••• 1234",
        paymentNote: "split with roommate", recurringId: "r1", cycleDate: "2026-08-01",
        debtId: "d1", debtAdjustment: 5, efAmount: 10, linkedPaymentId: "split-1",
        createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z",
        ...overrides,
      };
    }
    const now = new Date("2026-09-01T12:00:00.000Z");

    it("stamps purgedAt with the given time", () => {
      const result = purgeTransaction(makeDeletedTx(), now);
      expect(result.purgedAt).toBe(now.toISOString());
    });

    it("zeroes amount and empties description", () => {
      const result = purgeTransaction(makeDeletedTx(), now);
      expect(result.amount).toBe(0);
      expect(result.description).toBe("");
    });

    it("drops every other identifying/linking field -- not just the two named when purge was designed", () => {
      const result = purgeTransaction(makeDeletedTx(), now);
      expect(result.category).toBeUndefined();
      expect(result.paymentMethod).toBeUndefined();
      expect(result.paymentNote).toBeUndefined();
      expect(result.cardId).toBeUndefined();
      expect(result.cardLabel).toBeUndefined();
      expect(result.recurringId).toBeUndefined();
      expect(result.cycleDate).toBeUndefined();
      expect(result.debtId).toBeUndefined();
      expect(result.debtAdjustment).toBeUndefined();
      expect(result.efAmount).toBeUndefined();
      expect(result.linkedPaymentId).toBeUndefined();
      expect(result.createdAt).toBeUndefined();
      expect(result.updatedAt).toBeUndefined();
    });

    it("keeps id, bucket, currency, date, and the original deletedAt -- the merge-safety skeleton", () => {
      const original = makeDeletedTx();
      const result = purgeTransaction(original, now);
      expect(result.id).toBe(original.id);
      expect(result.bucket).toBe(original.bucket);
      expect(result.currency).toBe(original.currency);
      expect(result.date).toBe(original.date);
      expect(result.deletedAt).toBe(original.deletedAt);
    });

    it("a purged row is still excluded by activeTransactions, same as any soft-deleted row", () => {
      const result = purgeTransaction(makeDeletedTx(), now);
      expect(activeTransactions([result])).toEqual([]);
    });
  });

  describe("autoPurgeExpired (30-day retention, 2026-09-01, tests-first per Standing Rule 4)", () => {
    const now = new Date("2026-09-01T00:00:00.000Z");
    function makeTx(overrides: Partial<StoredTransaction> = {}): StoredTransaction {
      return { id: "t1", amount: 10, currency: "USD", bucket: "NEEDS", description: "Test", date: "2026-07-01", ...overrides };
    }

    it("purges a transaction deleted more than 30 days ago", () => {
      const deletedAt = new Date(now.getTime() - 31 * 24 * 3600 * 1000).toISOString();
      const result = autoPurgeExpired([makeTx({ deletedAt })], now);
      expect(result[0].purgedAt).toBe(now.toISOString());
      expect(result[0].description).toBe("");
    });

    it("leaves a transaction deleted exactly 30 days ago alone -- the window hasn't passed, it's still within it", () => {
      const deletedAt = new Date(now.getTime() - 30 * 24 * 3600 * 1000).toISOString();
      const result = autoPurgeExpired([makeTx({ deletedAt, description: "Still here" })], now);
      expect(result[0].purgedAt).toBeUndefined();
      expect(result[0].description).toBe("Still here");
    });

    it("leaves an active (non-deleted) transaction alone regardless of age", () => {
      const oldTx = makeTx({ date: "2020-01-01" }); // no deletedAt at all
      const result = autoPurgeExpired([oldTx], now);
      expect(result[0]).toEqual(oldTx);
    });

    it("leaves an already-purged transaction alone -- doesn't re-stamp purgedAt with a new timestamp", () => {
      const originalPurgedAt = "2026-08-01T00:00:00.000Z";
      const alreadyPurged = makeTx({ deletedAt: "2026-07-01T00:00:00.000Z", purgedAt: originalPurgedAt, description: "" });
      const result = autoPurgeExpired([alreadyPurged], now);
      expect(result[0].purgedAt).toBe(originalPurgedAt);
    });

    it("returns the same array reference when nothing needs purging -- a cheap no-op check for the caller", () => {
      const txs = [makeTx({ deletedAt: new Date(now.getTime() - 5 * 24 * 3600 * 1000).toISOString() })];
      const result = autoPurgeExpired(txs, now);
      expect(result).toBe(txs);
    });

    it("purges only the expired one out of a mix of active, recently-deleted, and long-deleted transactions", () => {
      const txs = [
        makeTx({ id: "active" }),
        makeTx({ id: "recent", deletedAt: new Date(now.getTime() - 5 * 24 * 3600 * 1000).toISOString() }),
        makeTx({ id: "expired", deletedAt: new Date(now.getTime() - 45 * 24 * 3600 * 1000).toISOString() }),
      ];
      const result = autoPurgeExpired(txs, now);
      expect(result.find((t) => t.id === "active")!.purgedAt).toBeUndefined();
      expect(result.find((t) => t.id === "recent")!.purgedAt).toBeUndefined();
      expect(result.find((t) => t.id === "expired")!.purgedAt).toBe(now.toISOString());
    });
  });

  // Phase 2.7 (sync merge), sub-phase 1 -- the pure mergeTransactions
  // engine, tests-first per Standing Rule 4. Written before the
  // implementation. The FIRST case is deliberately the tombstone-rank
  // rule, not the routine "two devices, two new transactions" case: it's
  // what makes purgeTransaction's whole "scrub the payload, don't remove
  // the row" design (2026-09-01) actually pay off -- if this merge ever
  // let a stale active or soft-deleted copy of a purged row win, every
  // purge in the app would be silently undone the next time two devices
  // sync, exactly the failure purgedAt's own doc comment warns about.
  describe("mergeTransactions (Phase 2.7 sub-phase 1 -- pure engine, unwired, tests-first per Standing Rule 4)", () => {
    function makeTx(overrides: Partial<StoredTransaction> = {}): StoredTransaction {
      return { id: "t1", amount: 10, currency: "USD", bucket: "NEEDS", description: "Test", date: "2026-08-01", ...overrides };
    }

    it("a purged row's payload is never resurrected by merging with a stale active or soft-deleted copy from the other side -- purgedAt outranks deletedAt outranks active, unconditionally", () => {
      const purged = makeTx({ purgedAt: "2026-09-01T00:00:00.000Z", deletedAt: "2026-08-20T00:00:00.000Z", amount: 0, description: "" });
      const staleActive = makeTx({ amount: 500, description: "Sensitive grocery run" });
      // Direction 1: local already purged, server hasn't seen it yet.
      const r1 = mergeTransactions([purged], [staleActive]);
      expect(r1.transactions).toHaveLength(1);
      expect(r1.transactions[0].purgedAt).toBe("2026-09-01T00:00:00.000Z");
      expect(r1.transactions[0].amount).toBe(0);
      expect(r1.transactions[0].description).toBe("");
      // Direction 2: server already purged, local is the stale one -- same
      // outcome regardless of which side initiated the sync.
      const r2 = mergeTransactions([staleActive], [purged]);
      expect(r2.transactions[0].purgedAt).toBe("2026-09-01T00:00:00.000Z");
      expect(r2.transactions[0].amount).toBe(0);
      // A merely soft-deleted (not purged) copy loses to a purged one too.
      const staleDeleted = makeTx({ deletedAt: "2026-08-25T00:00:00.000Z", amount: 500 });
      const r3 = mergeTransactions([purged], [staleDeleted]);
      expect(r3.transactions[0].purgedAt).toBe("2026-09-01T00:00:00.000Z");
    });

    it("two devices each log a different transaction between syncs -- both survive (the routine case this phase exists to fix)", () => {
      const local = [makeTx({ id: "local-only", description: "Coffee" })];
      const server = [makeTx({ id: "server-only", description: "Gas" })];
      const result = mergeTransactions(local, server);
      expect(result.transactions.map((t) => t.id).sort()).toEqual(["local-only", "server-only"]);
      expect(result.addedFromServer).toBe(1);
      expect(result.conflictsResolved).toBe(0);
    });

    it("deletedAt tombstone wins over an active copy of the same transaction", () => {
      const deletedLocally = makeTx({ deletedAt: "2026-08-15T00:00:00.000Z" });
      const stillActiveOnServer = makeTx({ amount: 999 });
      const result = mergeTransactions([deletedLocally], [stillActiveOnServer]);
      expect(result.transactions[0].deletedAt).toBe("2026-08-15T00:00:00.000Z");
    });

    it("a genuine edit-vs-edit conflict (same id, both active, content differs) resolves via updatedAt -- the newer edit wins, and it's reported, not silent", () => {
      const older = makeTx({ amount: 50, description: "Original", updatedAt: "2026-08-01T00:00:00.000Z" });
      const newer = makeTx({ amount: 75, description: "Corrected", updatedAt: "2026-08-10T00:00:00.000Z" });
      const result = mergeTransactions([older], [newer]);
      expect(result.transactions[0].amount).toBe(75);
      expect(result.transactions[0].description).toBe("Corrected");
      expect(result.conflictsResolved).toBe(1);
      // Order-independent: the NEWER edit wins regardless of which side is "local".
      const reversed = mergeTransactions([newer], [older]);
      expect(reversed.transactions[0].amount).toBe(75);
      expect(reversed.conflictsResolved).toBe(1);
    });

    it("a transaction that's never been touched again (no updatedAt) loses to a copy that has one -- absence of a timestamp is treated as older, not as 'no conflict'", () => {
      const neverEdited = makeTx({ amount: 50, description: "Original" }); // no updatedAt at all
      const editedElsewhere = makeTx({ amount: 75, description: "Corrected", updatedAt: "2026-08-10T00:00:00.000Z" });
      const result = mergeTransactions([neverEdited], [editedElsewhere]);
      expect(result.transactions[0].amount).toBe(75);
      expect(result.conflictsResolved).toBe(1);
    });

    it("identical content on both sides is not counted as a conflict, even with the same id", () => {
      const same = makeTx({ updatedAt: "2026-08-01T00:00:00.000Z" });
      const result = mergeTransactions([same], [{ ...same }]);
      expect(result.transactions).toHaveLength(1);
      expect(result.conflictsResolved).toBe(0);
      expect(result.addedFromServer).toBe(0);
    });

    it("is order-independent: merging A into B settles every id to the same final content as merging B into A", () => {
      const local = [
        makeTx({ id: "shared", amount: 50, updatedAt: "2026-08-01T00:00:00.000Z" }),
        makeTx({ id: "local-only" }),
        makeTx({ id: "deleted-locally", deletedAt: "2026-08-05T00:00:00.000Z" }),
      ];
      const server = [
        makeTx({ id: "shared", amount: 75, updatedAt: "2026-08-10T00:00:00.000Z" }),
        makeTx({ id: "server-only" }),
        makeTx({ id: "deleted-locally", amount: 999 }), // stale active copy of the one deleted on local
      ];
      const forward = mergeTransactions(local, server);
      const backward = mergeTransactions(server, local);
      const byId = (r: ReturnType<typeof mergeTransactions>) =>
        Object.fromEntries(r.transactions.map((t) => [t.id, t]));
      expect(byId(forward)).toEqual(byId(backward));
    });

    it("both empty is empty; one empty is just the other side, with no false conflicts", () => {
      expect(mergeTransactions([], [])).toEqual({ transactions: [], addedFromServer: 0, conflictsResolved: 0, conflicts: [] });
      const local = [makeTx()];
      const result = mergeTransactions(local, []);
      expect(result.transactions).toEqual(local);
      expect(result.addedFromServer).toBe(0);
    });

    // A bare count isn't enough for a caller (Phase 2.7 sub-phase 2) to
    // tell the USER what actually happened -- a silent last-writer-wins on
    // a transaction's amount is exactly the kind of thing that should
    // leave a trace, even though it resolves correctly (owner's
    // instruction, 2026-09-01). `conflicts` carries the winning copy of
    // each resolved conflict, so a caller can name what changed (amount,
    // description, date) instead of just saying "something changed."
    it("conflicts carries the winning copy of each resolved conflict, in the same order they occur in local, so a caller can name what changed -- not just count it", () => {
      const olderA = makeTx({ id: "a", amount: 50, description: "Groceries", updatedAt: "2026-08-01T00:00:00.000Z" });
      const newerA = makeTx({ id: "a", amount: 75, description: "Groceries (corrected)", updatedAt: "2026-08-10T00:00:00.000Z" });
      const noConflict = makeTx({ id: "b" });
      const result = mergeTransactions([olderA, noConflict], [newerA, { ...noConflict }]);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0]).toEqual(newerA);
      expect(result.conflicts.length).toBe(result.conflictsResolved);
    });
  });

  describe("Phase 2.6.2 -- derivedEfBalance and derivedDebtBalance (pure derivation logic, shipped completely unwired, tests-first per Standing Rule 4)", () => {
    function makeDebt(overrides: Partial<StoredDebt> = {}): StoredDebt {
      return {
        id: "d1", name: "Dad", balance: 2000, apr: 0, minPayment: 0, currency: "USD",
        createdAt: "2026-01-01T00:00:00.000Z", openingBalance: 2000,
        ...overrides,
      };
    }
    function makeTx(overrides: Partial<StoredTransaction> = {}): StoredTransaction {
      return {
        id: "t1", amount: 100, currency: "USD", bucket: "NEEDS",
        description: "Test", date: "2026-08-01",
        ...overrides,
      };
    }

    describe("derivedEfBalance", () => {
      it("returns the opening balance unchanged when no transaction has an efAmount", () => {
        const data = { ...DEFAULT_DATA, emergencyFundOpeningBalance: 900, transactions: [makeTx()] };
        expect(derivedEfBalance(data)).toBe(900);
      });

      it("adds a positive efAmount (an EF contribution)", () => {
        const data = { ...DEFAULT_DATA, emergencyFundOpeningBalance: 900, transactions: [makeTx({ efAmount: 200 })] };
        expect(derivedEfBalance(data)).toBe(1100);
      });

      it("subtracts a negative efAmount (an EF draw) -- the exact 2.4.27 scenario: $300 of a $325 debt payment sourced from EF", () => {
        const data = { ...DEFAULT_DATA, emergencyFundOpeningBalance: 900, transactions: [makeTx({ id: "t1", amount: 325, debtId: "d1", efAmount: -300 })] };
        expect(derivedEfBalance(data)).toBe(600);
      });

      it("sums efAmount across multiple transactions, mixed sign", () => {
        const data = {
          ...DEFAULT_DATA, emergencyFundOpeningBalance: 500,
          transactions: [makeTx({ id: "t1", efAmount: 200 }), makeTx({ id: "t2", efAmount: -50 }), makeTx({ id: "t3", efAmount: 100 })],
        };
        expect(derivedEfBalance(data)).toBe(750);
      });

      it("excludes a soft-deleted transaction's efAmount entirely, even though the field is still set on it", () => {
        const data = {
          ...DEFAULT_DATA, emergencyFundOpeningBalance: 900,
          transactions: [makeTx({ id: "t1", efAmount: 300 }), makeTx({ id: "t2", efAmount: -500, deletedAt: "2026-08-20T00:00:00.000Z" })],
        };
        expect(derivedEfBalance(data)).toBe(1200); // only t1 counts -- t2 is soft-deleted
      });

      it("ignores a transaction with no efAmount at all -- not treated as a 0 contribution needing special-casing, just absent from the sum", () => {
        const data = { ...DEFAULT_DATA, emergencyFundOpeningBalance: 900, transactions: [makeTx({ id: "t1" }), makeTx({ id: "t2", efAmount: 50 })] };
        expect(derivedEfBalance(data)).toBe(950);
      });

      it("rounds the final result to the cent, absorbing float accumulation dust from many small contributions", () => {
        const data = {
          ...DEFAULT_DATA, emergencyFundOpeningBalance: 0,
          transactions: Array.from({ length: 3 }, (_, i) => makeTx({ id: `t${i}`, efAmount: 0.1 })),
        };
        expect(derivedEfBalance(data)).toBe(0.3); // not 0.30000000000000004
      });
    });

    describe("derivedDebtBalance", () => {
      it("returns the opening balance unchanged when no transaction links to this debt", () => {
        expect(derivedDebtBalance(makeDebt(), [makeTx()])).toBe(2000);
      });

      it("subtracts a single linked payment", () => {
        expect(derivedDebtBalance(makeDebt(), [makeTx({ debtId: "d1", amount: 325 })])).toBe(1675);
      });

      it("reproduces the exact real 2.4.27 scenario: $2,000 opening balance, one real $325 payment, correct $1,675 result", () => {
        const debt = makeDebt({ id: "p76rh1el", name: "Dad", balance: 2000, openingBalance: 2000 });
        const tx = makeTx({ id: "t1", amount: 325, debtId: "p76rh1el", efAmount: -300 });
        expect(derivedDebtBalance(debt, [tx])).toBe(1675);
      });

      it("accumulates multiple linked payments", () => {
        const txs = [makeTx({ id: "t1", debtId: "d1", amount: 325 }), makeTx({ id: "t2", debtId: "d1", amount: 200 })];
        expect(derivedDebtBalance(makeDebt(), txs)).toBe(1475);
      });

      it("ignores a transaction linked to a DIFFERENT debt", () => {
        expect(derivedDebtBalance(makeDebt({ id: "d1" }), [makeTx({ debtId: "d2", amount: 1000 })])).toBe(2000);
      });

      it("ignores a transaction with no debtId at all", () => {
        expect(derivedDebtBalance(makeDebt(), [makeTx({ amount: 1000 })])).toBe(2000);
      });

      it("excludes a soft-deleted linked transaction from the sum", () => {
        const txs = [makeTx({ id: "t1", debtId: "d1", amount: 325 }), makeTx({ id: "t2", debtId: "d1", amount: 500, deletedAt: "2026-08-20T00:00:00.000Z" })];
        expect(derivedDebtBalance(makeDebt(), txs)).toBe(1675); // only t1 counts
      });

      it("clamps at 0 -- an overpayment doesn't produce a negative debt balance", () => {
        expect(derivedDebtBalance(makeDebt({ openingBalance: 100 }), [makeTx({ debtId: "d1", amount: 500 })])).toBe(0);
      });

      it("rounds the final result to the cent", () => {
        const txs = Array.from({ length: 3 }, (_, i) => makeTx({ id: `t${i}`, debtId: "d1", amount: 0.1 }));
        expect(derivedDebtBalance(makeDebt({ openingBalance: 1 }), txs)).toBe(0.7); // 1 - 0.3, not float dust
      });

      // Phase 2.6.4 step 3 -- debtAdjustment is an independent carrier field,
      // same relationship to `amount` that efAmount already has to EF: paid
      // = amount + (debtAdjustment ?? 0), so a correction transaction
      // (amount: 0, debtAdjustment: delta) moves the debt balance without
      // being counted as a real payment anywhere else.
      it("adds a positive debtAdjustment on top of amount", () => {
        const txs = [makeTx({ debtId: "d1", amount: 325, debtAdjustment: 50 })];
        expect(derivedDebtBalance(makeDebt(), txs)).toBe(1625); // 2000 - 325 - 50
      });

      it("a negative debtAdjustment reduces the amount paid down, increasing the remaining balance", () => {
        const txs = [makeTx({ debtId: "d1", amount: 325, debtAdjustment: -50 })];
        expect(derivedDebtBalance(makeDebt(), txs)).toBe(1725); // 2000 - 325 + 50
      });

      it("a correction transaction (amount 0, debtAdjustment set) moves the balance on its own", () => {
        const txs = [makeTx({ debtId: "d1", amount: 0, debtAdjustment: -300 })];
        expect(derivedDebtBalance(makeDebt(), txs)).toBe(2300); // 2000 - 0 - (-300)
      });

      it("treats undefined debtAdjustment as contributing 0 -- the ordinary, non-correction case", () => {
        const txs = [makeTx({ debtId: "d1", amount: 325 })];
        expect(derivedDebtBalance(makeDebt(), txs)).toBe(1675); // unchanged from the plain-amount test above
      });

      it("treats explicit null debtAdjustment as contributing 0 -- a deliberately detached correction, same as undefined", () => {
        const txs = [makeTx({ debtId: "d1", amount: 325, debtAdjustment: null })];
        expect(derivedDebtBalance(makeDebt(), txs)).toBe(1675);
      });

      it("excludes debtAdjustment from a soft-deleted linked transaction, same as amount", () => {
        const txs = [makeTx({ id: "t1", debtId: "d1", amount: 325, debtAdjustment: -300, deletedAt: "2026-08-20T00:00:00.000Z" })];
        expect(derivedDebtBalance(makeDebt(), txs)).toBe(2000); // fully excluded, not just amount
      });
    });
  });
});
