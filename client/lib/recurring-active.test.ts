// What "active" means after 2.4.112.
//
// isRecurringActive used to estimate exhaustion from elapsed calendar time
// (totalPeriods x 30.4375 days from startDate). Under confirm-on-due that is
// the wrong question -- a cycle can sit unconfirmed indefinitely, so calendar
// time elapsed and money actually paid are different things. The clause is
// gone; "active" is now purely "has it started, and has its endDate passed".
//
// These are behaviour-CHANGING tests. There is no zero-diff claim to make
// here: figures move, deliberately, and the before/after values are reported
// on the branch rather than hidden behind "no visible change".
import { describe, it, expect } from "vitest";
import {
  isRecurringActive, nominalMonthlyEquivalent, monthlyEquivalent,
  remainingInstallments, recurringPaidSoFar, nextConfirmTarget,
  type StoredRecurring, type StoredTransaction,
} from "./localData";

/** The owner's real Uni: $750/mo, $6,750 cap (9 cycles), start 2026-08-01, no endDate. */
const UNI = {
  id: "uni", name: "Uni", emoji: "", amount: 750, currency: "USD", frequency: "monthly",
  bucket: "NEEDS", startDate: "2026-08-01", endDate: null, totalAmount: 6750,
  createdAt: "2026-08-01T00:00:00.000Z",
} as unknown as StoredRecurring;

/** `n` confirmed cycles, consecutive from the start date. */
const confirmed = (n: number): StoredTransaction[] => Array.from({ length: n }, (_, i) => ({
  id: `c${i}`, amount: 750, currency: "USD", bucket: "NEEDS", description: "Uni",
  date: `2026-${String(8 + i).padStart(2, "0")}-01`, recurringId: "uni",
} as unknown as StoredTransaction));

const at = (iso: string) => new Date(`${iso}T12:00:00Z`);

describe("the 2027-05-02 case, on the owner's real item shape", () => {
  // 9 periods x 30.4375 = 273.94 days from 2026-08-01 lands on 2027-05-02.
  // That is the exact date the removed clause flipped this item to inactive.
  const AFTER_FLIP = at("2027-05-10");

  it("an item with NOTHING confirmed is still active after the old flip date", () => {
    // Premise: the money genuinely has not been paid, so "active" is the
    // correct answer and not merely a changed one.
    expect(recurringPaidSoFar(UNI, [])).toBe(0);
    expect(remainingInstallments(UNI, [], AFTER_FLIP)).not.toBeNull();
    expect(isRecurringActive(UNI, AFTER_FLIP)).toBe(true);
  });

  it("and it still reports a cost, instead of reading $0 while money is owed", () => {
    // WAS $0 -- the single most visible consequence, reaching RecurringScreen's
    // totals, InputPanel's list and printReport's PDF table.
    expect(nominalMonthlyEquivalent(UNI, AFTER_FLIP)).toBe(750);
    expect(monthlyEquivalent(UNI, AFTER_FLIP)).toBe(750);
  });

  it("the two surfaces now AGREE -- this is the contradiction the fix removes", () => {
    // The defect was never one wrong number. It was Overview demanding
    // payment for an item every other screen had written off at $0, so the
    // assertion that matters is agreement between them.
    const six = confirmed(6);
    const target = nextConfirmTarget(UNI, six, AFTER_FLIP);
    // Premise: the confirm flow really is still chasing this item.
    expect(target).not.toBeNull();
    expect(target!.overdueCount).toBeGreaterThan(0);
    // ...and so the rest of the app must not be calling it finished.
    expect(isRecurringActive(UNI, AFTER_FLIP)).toBe(true);
    expect(nominalMonthlyEquivalent(UNI, AFTER_FLIP)).toBe(750);
    expect(recurringPaidSoFar(UNI, six)).toBe(4500); // $2,250 still owed
  });

  it("it was ALSO declared ended before its own last cycle came due", () => {
    // A second consequence of the same clause, independent of confirmation:
    // the flip (2027-05-02) preceded the ninth outstanding installment.
    const remaining = remainingInstallments(UNI, [], at("2026-09-15"));
    expect(remaining!.endsOn.toISOString().slice(0, 10)).toBe("2027-06-01");
    expect(isRecurringActive(UNI, at("2027-05-10"))).toBe(true);
  });
});

describe("exhaustion is still answered — by the function that actually knows", () => {
  it("a fully paid item has no installments remaining, though it stays calendar-active", () => {
    const all = confirmed(9);
    // Premise: the cap really is met.
    expect(recurringPaidSoFar(UNI, all)).toBe(6750);
    expect(remainingInstallments(UNI, all, at("2027-05-10"))).toBeNull();
    // isRecurringActive alone no longer knows this, and should not: it is a
    // calendar question now. InputPanel's "Ended" badge combines the two.
    expect(isRecurringActive(UNI, at("2027-05-10"))).toBe(true);
  });

  it("paid off EARLY reads as finished immediately — the bug the removal fixes", () => {
    // All nine confirmed while the calendar is still only in early 2027.
    // The old clause would have kept this reading live until 2027-05-02.
    const all = confirmed(9);
    const early = at("2027-01-15");
    expect(remainingInstallments(UNI, all, early)).toBeNull();
    expect(nextConfirmTarget(UNI, all, early)).toBeNull();
  });
});

describe("KNOWN GAP the removal exposes — the cost figure for a fully paid item", () => {
  // Found by the before/after measurement, not by the plan, which said only
  // InputPanel's badge needed exhaustion. It was wrong about these two.
  //
  // monthlyEquivalent/nominalMonthlyEquivalent have NEVER handled a fully
  // paid capped item correctly. The removed clause masked it in exactly one
  // of the two sub-cases -- once calendar time had passed, the item read
  // inactive and the figure fell to $0 by coincidence. Paid off EARLY it
  // already reported $750 for an item owing nothing, before this branch
  // touched anything (measured: 2027-01-15, 9 of 9 confirmed, $750 both
  // before and after).
  //
  // So the removal does not introduce the bug; it stops hiding half of it.
  // Fixing it needs `transactions` threaded into both wrappers, which is
  // the signature change the plan explicitly weighed and rejected -- so it
  // is reported and held for a decision, not smuggled in here.
  it.fails("a fully paid capped item should cost $0, whenever it was paid (CURRENTLY $750)", () => {
    const all = confirmed(9);
    // Premise: genuinely finished, both before and after the old flip date.
    expect(recurringPaidSoFar(UNI, all)).toBe(6750);
    expect(remainingInstallments(UNI, all, at("2027-05-10"))).toBeNull();
    expect(nominalMonthlyEquivalent(UNI, at("2027-05-10"))).toBe(0);
  });

  it("documents the pre-existing half, so the regression is not mistaken for new", () => {
    // Paid off early: $750 before this branch and $750 after. Unchanged --
    // evidence that the wrappers were already wrong for a finished item.
    const all = confirmed(9);
    expect(remainingInstallments(UNI, all, at("2027-01-15"))).toBeNull();
    expect(nominalMonthlyEquivalent(UNI, at("2027-01-15"))).toBe(750);
  });
});

describe("the neighbouring clauses are untouched", () => {
  it("endDate still ends an item, regardless of payments", () => {
    const withEnd = { ...UNI, endDate: "2026-12-01" } as StoredRecurring;
    expect(isRecurringActive(withEnd, at("2026-11-01"))).toBe(true);
    expect(isRecurringActive(withEnd, at("2027-01-01"))).toBe(false);
    expect(nominalMonthlyEquivalent(withEnd, at("2027-01-01"))).toBe(0);
  });

  it("startDate still gates an item that has not begun", () => {
    expect(isRecurringActive(UNI, at("2026-07-01"))).toBe(false);
    expect(nominalMonthlyEquivalent(UNI, at("2026-07-01"))).toBe(0);
  });

  it("an item with no totalAmount is unaffected in every direction — the control", () => {
    const uncapped = { ...UNI, totalAmount: null } as StoredRecurring;
    // Never touched the removed clause, so nothing here can have moved.
    expect(isRecurringActive(uncapped, at("2027-08-01"))).toBe(true);
    expect(nominalMonthlyEquivalent(uncapped, at("2027-08-01"))).toBe(750);
  });
});
