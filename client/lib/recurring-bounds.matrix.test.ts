// OUTPUT MATRIX for remainingInstallments / capacityFreedFrom.
//
// This file is the local equivalent of the Phase 1 zero-diff snapshot, and
// it exists because that snapshot does NOT reach here: computeDashboard
// contains zero references to either function -- both are called only from
// components (ProjectionsScreen, RecurringScreen, InputPanel). So the fix in
// 2.4.109 (bounding the walk by byAmount instead of a 100-year horizon) has
// no global gate to prove it output-preserving, and needs its own.
//
// WRITTEN AND PASSED AGAINST UNCHANGED CODE FIRST, then re-run after the
// change. Every expectation below is the behaviour of the code BEFORE the
// bound was introduced. If any value moves, the change is wrong and the
// answer is to report it, not to adjust the expectation.
//
// Five cases, chosen to cover each branch the bound could interact with:
//   1  totalAmount only, no endDate          -- the expensive path, the one being fixed
//   2  totalAmount + endDate, endDate binds  -- the limit must NOT bind
//   3  endDate only                          -- a different branch entirely
//   4  cap already met                       -- returns null before any walk
//   5  totalAmount + endDate, cap exhausts first -- the cap is the answer (2.4.110)
//   6  both bounds on the same cycle           -- they agree; min() must not be off by one
//   7  cap met AND endDate set                 -- null; the obligation is already over
import { describe, it, expect } from "vitest";
import {
  remainingInstallments, capacityFreedFrom, recurringPaidSoFar,
  type StoredRecurring, type StoredTransaction,
} from "./localData";

const NOW = new Date(2026, 6, 15); // 15 Jul 2026

function rec(over: Partial<StoredRecurring> = {}): StoredRecurring {
  return {
    id: "uni", name: "Uni", emoji: "", amount: 750, currency: "USD",
    frequency: "monthly", bucket: "NEEDS", startDate: "2026-01-01",
    endDate: null, totalAmount: 6750, createdAt: "2026-01-01T00:00:00.000Z",
    ...over,
  } as unknown as StoredRecurring;
}

/** Nine confirmed payments, i.e. the full 6750 cap. */
const PAID_IN_FULL: StoredTransaction[] = Array.from({ length: 9 }, (_, i) => ({
  id: `p${i}`, amount: 750, currency: "USD", bucket: "NEEDS",
  description: "Uni", date: `2026-0${(i % 9) + 1}-01`, recurringId: "uni",
} as unknown as StoredTransaction));

const iso = (d: Date | null | undefined) => d ? d.toISOString().slice(0, 10) : null;

describe("case 1 — totalAmount only, no endDate (the path being fixed)", () => {
  it("nine installments ending Apr 2027, capacity freed from May 2027", () => {
    const r = rec();
    // Premise: nothing is confirmed, so all nine remain and byAmount is 9.
    expect(recurringPaidSoFar(r, [])).toBe(0);
    const remaining = remainingInstallments(r, [], NOW);
    expect(remaining).toBeTruthy();
    expect(remaining!.count).toBe(9);
    expect(iso(remaining!.endsOn)).toBe("2027-04-01");
    expect(iso(capacityFreedFrom(r, [], NOW))).toBe("2027-05-01");
  });
});

describe("case 2 — totalAmount + endDate, the endDate binds first", () => {
  it("count is truncated by the endDate, not by byAmount", () => {
    const r = rec({ endDate: "2026-12-01" });
    const remaining = remainingInstallments(r, [], NOW);
    // Premise for this case's whole point: byAmount is 9, and the answer is
    // fewer than 9 -- so the endDate, not the cap, is what limits it. A
    // byAmount limit on the walk must therefore not bind here.
    expect(Math.ceil((r.totalAmount! - 0) / r.amount)).toBe(9);
    expect(remaining!.count).toBe(5); // Aug, Sep, Oct, Nov, Dec
    expect(iso(remaining!.endsOn)).toBe("2026-12-01");
    expect(iso(capacityFreedFrom(r, [], NOW))).toBe("2026-12-01");
  });
});

describe("case 3 — endDate only, no totalAmount (a different branch)", () => {
  it("walks to the endDate and stops; the cap logic is never entered", () => {
    const r = rec({ totalAmount: null, endDate: "2026-12-01" });
    // Premise: with no cap, recurringPaidSoFar is 0 by definition and the
    // byAmount branch is unreachable for this item.
    expect(recurringPaidSoFar(r, [])).toBe(0);
    const remaining = remainingInstallments(r, [], NOW);
    expect(remaining!.count).toBe(5);
    expect(iso(remaining!.endsOn)).toBe("2026-12-01");
    expect(iso(capacityFreedFrom(r, [], NOW))).toBe("2026-12-01");
  });
});

describe("case 4 — the cap is already met", () => {
  it("returns null before walking anything", () => {
    const r = rec();
    // Premise: the fixture really does reach the cap, so null below means
    // "nothing remains" and not "the fixture was empty".
    expect(recurringPaidSoFar(r, PAID_IN_FULL)).toBe(6750);
    expect(remainingInstallments(r, PAID_IN_FULL, NOW)).toBeNull();
    expect(capacityFreedFrom(r, PAID_IN_FULL, NOW)).toBeNull();
  });
});

describe("case 5 — totalAmount + a distant endDate: the CAP binds, not the endDate", () => {
  it("capacity is freed when the money runs out, not when the outer boundary arrives", () => {
    const r = rec({ endDate: "2030-01-01" });
    const remaining = remainingInstallments(r, [], NOW);
    expect(remaining!.count).toBe(9);
    expect(iso(remaining!.endsOn)).toBe("2027-04-01");
    // 2.4.110. This previously returned 2030-01-01 -- capacityFreedFrom
    // took an early return on endDate before ever consulting the cap, so it
    // disagreed with remainingInstallments about the same item by nearly
    // three years. totalAmount is a statement about MONEY: nine payments of
    // $750 exhaust $6,750 and the obligation genuinely ends in April 2027.
    // endDate is an outer boundary ("no later than"), not a schedule.
    //
    // This expectation was UPDATED in place rather than joined by a second
    // case, so the matrix asserts one answer for this input, not both.
    expect(iso(capacityFreedFrom(r, [], NOW))).toBe("2027-05-01");
  });
});

describe("case 6 — both bounds land on the same cycle", () => {
  it("agree, and the answer is that shared date", () => {
    // endDate set exactly to the date the cap frees capacity. The two
    // bounds coincide, so min() must not be off by a cycle in either
    // direction -- the failure mode a <= vs < would produce.
    const r = rec({ endDate: "2027-05-01" });
    const remaining = remainingInstallments(r, [], NOW);
    // Premise: the cap still resolves to nine installments here, i.e. the
    // endDate has not truncated the walk, so both bounds really are live.
    expect(remaining!.count).toBe(9);
    expect(iso(remaining!.endsOn)).toBe("2027-04-01");
    expect(iso(capacityFreedFrom(r, [], NOW))).toBe("2027-05-01");
  });
});

describe("case 7 — the cap is met AND an endDate is set", () => {
  it("returns null: the obligation is already over, so there is no future step", () => {
    const r = rec({ endDate: "2030-01-01" });
    // Premise: the cap really is met, so null below means "nothing remains"
    // rather than "the fixture was empty".
    expect(recurringPaidSoFar(r, PAID_IN_FULL)).toBe(6750);
    expect(remainingInstallments(r, PAID_IN_FULL, NOW)).toBeNull();
    // Also 2.4.110, and the same root cause: the old early return handed
    // back 2030-01-01 for an item that finished paying already, promising a
    // future capacity step for money the user has in hand. ProjectionsScreen
    // drops a null, which is the correct treatment (its own comment at :99
    // says an already-ended obligation "would read as a promise of money the
    // user already has").
    expect(capacityFreedFrom(r, PAID_IN_FULL, NOW)).toBeNull();
  });
});

describe("premise: case 1 is genuinely the expensive one", () => {
  it("only the unbounded case has an unbounded walk to bound", () => {
    // Guards the matrix itself: if a future edit gave case 1 an endDate,
    // every assertion above would still pass while testing nothing about
    // the horizon.
    expect(rec().endDate).toBeNull();
    expect(rec().totalAmount).toBe(6750);
  });
});
