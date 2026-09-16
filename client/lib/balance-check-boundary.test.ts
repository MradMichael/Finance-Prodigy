// 2.4.65: a real instant for the balance-check baseline.
//
// `relevantTx` filtered `t.date >= tb.startingDate` -- a date-only
// comparison. A check-in sets startingDate to today, so a transaction dated
// TODAY but logged BEFORE the check was counted twice: once inside the
// `actual` figure the user typed (they counted cash that already reflected
// it) and again in every live `expected` afterwards.
//
// The boundary is now three-tier. A date decides when it can; the timestamp
// is consulted ONLY for the same calendar day, and only when both sides
// carry one. Otherwise the old behaviour stands -- so the change is strictly
// NARROWING: it can exclude a transaction it can prove was entered before
// the check, and can never newly include anything.
//
// WHAT THIS DOES NOT FIX, asserted at the bottom rather than left implicit:
// `createdAt` is ENTRY time, not transaction time, so "was this already
// reflected in the balance I counted" is still unanswerable in general.
import { describe, it, expect } from "vitest";
import { computeDashboard, trackedBalanceExpected, balanceCheckReconciliation } from "./computeDashboard";
import { DEFAULT_DATA, type LocalFinancials, type StoredTransaction, type TrackedBalance } from "./localData";

const CHECK_DAY = "2026-09-05";
/** The instant the user confirmed their balance: 18:00 on the check day. */
const CHECK_AT = "2026-09-05T18:00:00.000Z";

function tx(over: Partial<StoredTransaction> = {}): StoredTransaction {
  return {
    id: "t1", date: CHECK_DAY, amount: 50, currency: "USD", bucket: "NEEDS",
    description: "Coffee", paymentMethod: "cash", ...over,
  } as unknown as StoredTransaction;
}

function balance(over: Partial<TrackedBalance> = {}): TrackedBalance {
  return {
    id: "tb1", name: "Wallet", paymentMethod: "cash",
    startingBalance: 700, startingDate: CHECK_DAY,
    currency: "USD", actualBalance: 700, actualBalanceDate: CHECK_AT,
    expectedAtCheckUSD: 740,
    ...over,
  } as unknown as TrackedBalance;
}

function data(transactions: StoredTransaction[], tb: TrackedBalance): LocalFinancials {
  return { ...DEFAULT_DATA, income: 3000, transactions, trackedBalances: [tb] } as LocalFinancials;
}

const expectedOf = (d: LocalFinancials) => computeDashboard(d).balanceChecks[0].expected;

describe("1. the bug: a same-day transaction entered BEFORE the check is not counted again", () => {
  it("expected stays at the confirmed balance instead of subtracting it twice", () => {
    const before = tx({ createdAt: "2026-09-05T10:00:00.000Z" }); // 10:00, check was 18:00
    const tb = balance({ startingAt: CHECK_AT });
    // Premise: the two really are the same calendar day, so tier 3 is the
    // path under test and not tier 1 or 2.
    expect(before.date).toBe(tb.startingDate);
    expect(expectedOf(data([before], tb))).toBe(700);
  });
});

describe("2. the mirror: a same-day transaction entered AFTER the check still counts", () => {
  it("expected drops by the amount -- the fix must not over-correct", () => {
    const after = tx({ createdAt: "2026-09-05T21:00:00.000Z" }); // 21:00, after 18:00
    const tb = balance({ startingAt: CHECK_AT });
    expect(after.date).toBe(tb.startingDate);
    expect(expectedOf(data([after], tb))).toBe(650);
  });
});

describe("3. legacy: neither side carries a timestamp", () => {
  it("includes, exactly as before -- no historical row is silently reclassified", () => {
    const legacy = tx(); // no createdAt
    const tb = balance();  // no startingAt
    expect(legacy.createdAt).toBeUndefined();
    expect(tb.startingAt).toBeUndefined();
    expect(expectedOf(data([legacy], tb))).toBe(650);
  });
});

describe("4. half-legacy: one side has a timestamp, the other does not", () => {
  // A partial pair must be treated as NO pair. Comparing against undefined
  // is the failure this pins -- `"..." >= undefined` is false in JS, which
  // would silently flip these to excluded.
  it("transaction has createdAt, balance has no startingAt -> included", () => {
    const t = tx({ createdAt: "2026-09-05T10:00:00.000Z" });
    expect(expectedOf(data([t], balance()))).toBe(650);
  });

  it("balance has startingAt, transaction has no createdAt -> included", () => {
    const tb = balance({ startingAt: CHECK_AT });
    expect(expectedOf(data([tx()], tb))).toBe(650);
  });
});

describe("5. unambiguous days: the timestamp is never consulted", () => {
  it("a transaction dated before the baseline is excluded, timestamps or not", () => {
    // createdAt deliberately AFTER the check instant -- if tier 3 were
    // reached it would be included, so this pins that tier 1 wins.
    const earlier = tx({ date: "2026-09-04", createdAt: "2026-09-05T23:00:00.000Z" });
    expect(expectedOf(data([earlier], balance({ startingAt: CHECK_AT })))).toBe(700);
  });

  it("a transaction dated after the baseline is included, timestamps or not", () => {
    // createdAt BEFORE the check instant -- tier 2 must win over it.
    const later = tx({ date: "2026-09-06", createdAt: "2026-09-05T01:00:00.000Z" });
    expect(expectedOf(data([later], balance({ startingAt: CHECK_AT })))).toBe(650);
  });
});

describe("6. both filter sites agree", () => {
  it("trackedBalanceExpected matches the balanceChecks payload for the same fixture", () => {
    // The two sites used to hold parallel copies of the comparison. One
    // fixed and one not would leave ImportStatement's expectedAtCheckUSD
    // disagreeing with the screen -- worse than the original bug, because
    // it would be written into storage.
    const t = tx({ createdAt: "2026-09-05T10:00:00.000Z" });
    const tb = balance({ startingAt: CHECK_AT });
    const d = data([t], tb);
    // Premise: this fixture is the ambiguous case, so the two sites are
    // being compared where they could actually differ.
    expect(t.date).toBe(tb.startingDate);
    expect(trackedBalanceExpected(tb, d)).toBe(expectedOf(d));
    expect(trackedBalanceExpected(tb, d)).toBe(700);
  });
});

describe("7. the 2.4.64 branches, through balanceCheckReconciliation", () => {
  it("a fresh check with a same-day prior transaction reports NO activity since", () => {
    const t = tx({ createdAt: "2026-09-05T10:00:00.000Z" });
    const tb = balance({ startingAt: CHECK_AT }); // expectedAtCheckUSD 740, actual 700
    const b = computeDashboard(data([t], tb)).balanceChecks[0];
    // Premise: there IS a discrepancy to reconcile, so the branch below is
    // the "no activity yet" one and not the trivial zero-gap case.
    expect(b.discrepancy).toBe(-40);
    // The payoff: changeSinceCheck equals the discrepancy exactly, so the
    // net is 0 -- the phantom "$50 spent since check-in" is gone. Before
    // the fix expected was 650, giving changeSinceCheck -90 and a net of -50.
    expect(b.changeSinceCheck).toBe(-40);
    const r = balanceCheckReconciliation(b.discrepancy!, b.changeSinceCheck);
    expect(r.netActivitySinceCheck).toBe(0);
    expect(r.residual).toBe(-40);
    expect(r.explainedByActivity).toBe(false);
  });

  it("and a genuine post-check transaction still reads as real activity", () => {
    // The pair: the fix must not suppress activity that truly happened after.
    const t = tx({ date: "2026-09-06", amount: 50 });
    const tb = balance({ startingAt: CHECK_AT });
    const b = computeDashboard(data([t], tb)).balanceChecks[0];
    expect(b.discrepancy).toBe(-40);
    expect(b.changeSinceCheck).toBe(-90);
    expect(balanceCheckReconciliation(b.discrepancy!, b.changeSinceCheck).netActivitySinceCheck).toBe(-50);
  });
});

describe("8. what this does NOT fix -- the bound on the bug, pinned", () => {
  it("a BACKDATED transaction entered after the check is still excluded by its date", () => {
    // createdAt is ENTRY time, not transaction time. Entered at 21:00, three
    // hours after the check, but dated four days earlier -- so tier 1
    // excludes it on the date and the timestamp is never consulted.
    //
    // That is correct for THIS bug (the balance the user counted did not
    // include it either way, since they counted cash on the 5th). It is
    // recorded here because it shows the general question -- "was this
    // already reflected in the balance I counted?" -- remains unanswerable
    // from either field. 2.4.65 bounds the same-day case; it does not close
    // the class.
    const backdated = tx({ date: "2026-09-01", createdAt: "2026-09-05T21:00:00.000Z" });
    const tb = balance({ startingAt: CHECK_AT });
    expect(expectedOf(data([backdated], tb))).toBe(700);
  });
});
