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
    expect(nominalMonthlyEquivalent(UNI, [], AFTER_FLIP)).toBe(750);
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
    expect(nominalMonthlyEquivalent(UNI, six, AFTER_FLIP)).toBe(750);
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

describe("a fully paid item costs $0 — closed, and it was wrong in BOTH directions before", () => {
  // This shipped as `it.fails` on the previous branch: dropping
  // isRecurringActive's elapsed-time clause left nominalMonthlyEquivalent
  // reporting $750 for an item owing nothing. Promoted here now that the
  // wrapper asks recurringPaidSoFar directly.
  //
  // The measurement that produced it also showed the wrapper had NEVER
  // handled a finished item correctly -- paid off early it already read
  // $750 before any of this. The old clause masked exactly one of the two
  // sub-cases, by the coincidence of calendar time having passed. Both are
  // asserted below, which is why this is two tests and not one.
  it("paid off AFTER the old flip date — the case the removal exposed", () => {
    const all = confirmed(9);
    // Premise: genuinely finished.
    expect(recurringPaidSoFar(UNI, all)).toBe(6750);
    expect(remainingInstallments(UNI, all, at("2027-05-10"))).toBeNull();
    expect(nominalMonthlyEquivalent(UNI, all, at("2027-05-10"))).toBe(0);
  });

  it("paid off EARLY — the half that was always wrong and was never reported", () => {
    const all = confirmed(9);
    // Measured $750 both before the clause was removed and after, i.e. the
    // elapsed-time clause never helped here at all.
    expect(remainingInstallments(UNI, all, at("2027-01-15"))).toBeNull();
    expect(nominalMonthlyEquivalent(UNI, all, at("2027-01-15"))).toBe(0);
  });

  it("an item still owing money is NOT zeroed — the pair, so the above isn't 'always 0'", () => {
    const six = confirmed(6);
    expect(recurringPaidSoFar(UNI, six)).toBe(4500);
    expect(nominalMonthlyEquivalent(UNI, six, at("2027-05-10"))).toBe(750);
  });
});

describe("the neighbouring clauses are untouched", () => {
  it("endDate still ends an item, regardless of payments", () => {
    const withEnd = { ...UNI, endDate: "2026-12-01" } as StoredRecurring;
    expect(isRecurringActive(withEnd, at("2026-11-01"))).toBe(true);
    expect(isRecurringActive(withEnd, at("2027-01-01"))).toBe(false);
    expect(nominalMonthlyEquivalent(withEnd, [], at("2027-01-01"))).toBe(0);
  });

  it("startDate still gates an item that has not begun", () => {
    expect(isRecurringActive(UNI, at("2026-07-01"))).toBe(false);
    expect(nominalMonthlyEquivalent(UNI, [], at("2026-07-01"))).toBe(0);
  });

  it("an item with no totalAmount is unaffected in every direction — the control", () => {
    const uncapped = { ...UNI, totalAmount: null } as StoredRecurring;
    // Never touched the removed clause, so nothing here can have moved.
    expect(isRecurringActive(uncapped, at("2027-08-01"))).toBe(true);
    expect(nominalMonthlyEquivalent(uncapped, [], at("2027-08-01"))).toBe(750);
  });
});
