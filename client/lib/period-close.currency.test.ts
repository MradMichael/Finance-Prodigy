// The close dialog's currency defect (shipped in Phase 2, a03209c).
//
// `trackedBalanceExpectedAsOf` returns USD -- expectedFromRelevantTx converts
// the starting balance AND every transaction. The figure the user types is
// stored as `startingBalance`, which is in the account's OWN currency. Phase 2
// then subtracted one from the other.
//
// THE WORKED EXAMPLE IS THE TEST. 10,000,000 LBP at 89,500, counting
// 9,500,000. The arithmetic is asserted as real numbers, not as "it
// converts" -- a test that only checked a conversion happened would pass
// against a conversion in the wrong direction, or at the wrong rate.
//
//   expected (USD)        111.73     <- what the dialog prints
//   typed (LBP)         9,500,000
//   actualUSD             106.15     = 9,500,000 / 89,500
//   discrepancy (USD)      -5.58     = 106.15 - 111.73
//
// Phase 2 stored 9,499,888.27 for that last line.
//
// THIS WAS ALREADY FOUND ONCE. computeDashboard.ts:1054-1060 carries the fix
// for the identical bug in balanceChecks: "Comparing a raw LBP starting
// balance against a USD spend figure produced a nonsensical
// expected/discrepancy for LBP-tracked balances, so convert starting/actual
// to USD too." Phase 2 reintroduced it at a second site. That is why the
// conversion now happens in ONE place the screen owns, and buildPeriodClose
// is handed the result rather than repeating the policy.
//
// WHICH AXES THESE FIXTURES CANNOT REACH (2.4.116):
//
//   * a rate CHANGE between the close and the badge. Both read the same
//     lbpRateHistory, so a fixture cannot make them disagree on the rate
//     without also making the disagreement legitimate. Section 2 pins that
//     they agree at one rate; drift between two rates is a different claim
//     and is not made here.
//   * an LBP emergency fund. Unreachable by construction -- EF has no
//     currency field and efAmount is USD by contract.
//   * a currency other than USD/LBP. The Currency union has two members.
import { describe, it, expect } from "vitest";
import {
  DEFAULT_DATA, DEFAULT_LBP_RATE, buildPeriodClose, reanchorTrackedBalance,
  toUSD,
  type LocalFinancials, type TrackedBalance,
} from "./localData";
import { trackedBalanceExpectedAsOf, computeDashboard } from "./computeDashboard";
import { asCycleKey, cycleCloseInstant } from "./period";

const SD = 27;
const CUR = asCycleKey("2026-08");
const NOW = new Date(2026, 8, 10, 12, 0, 0);
const AT = cycleCloseInstant(CUR, SD);

/** The owner's real case: a lira account whose figures are ~5 orders of magnitude apart from USD. */
const LBP_TB: TrackedBalance = {
  id: "lbp1", name: "Cash LBP", paymentMethod: "cash",
  startingBalance: 10_000_000, startingDate: "2026-08-01",
  startingAt: "2026-08-01T09:00:00.000Z", currency: "LBP",
  lbpRateAtEntry: DEFAULT_LBP_RATE,
};
const USD_TB: TrackedBalance = {
  id: "usd1", name: "Cash", paymentMethod: "cash",
  startingBalance: 500, startingDate: "2026-08-01",
  startingAt: "2026-08-01T09:00:00.000Z", currency: "USD",
};

const dataWith = (tbs: TrackedBalance[]): LocalFinancials =>
  ({ ...DEFAULT_DATA, income: 3000, cycleStartDay: SD, trackedBalances: tbs, transactions: [] } as LocalFinancials);

/** Exactly what the screen does: convert once, hand the result to the builder. */
function closeOf(tb: TrackedBalance, typed: number, data = dataWith([tb])) {
  const expectedAtClose = trackedBalanceExpectedAsOf(tb, data, AT);
  // Rounded at the conversion, exactly as the dialog does it.
  const actualUSD = Math.round(toUSD(typed, tb.currency, DEFAULT_LBP_RATE) * 100) / 100;
  const record = buildPeriodClose({
    cycleKey: CUR, startDay: SD, closedAt: NOW, lbpRate: DEFAULT_LBP_RATE,
    accounts: [{ tb, actual: typed, actualUSD, expectedAtClose }],
  });
  return { expectedAtClose, record, acc: record.accounts[0] };
}

// ───────── 1. the worked example ─────────

describe("1. 10,000,000 LBP at 89,500, counting 9,500,000", () => {
  it("the premise: the rate and the expected figure are what the example says", () => {
    // If either of these drifts, every number below is asserting something
    // else and the section stops being the worked example.
    expect(DEFAULT_LBP_RATE).toBe(89_500);
    expect(trackedBalanceExpectedAsOf(LBP_TB, dataWith([LBP_TB]), AT)).toBe(111.73);
  });

  it("stores the discrepancy in USD: -5.58, not 9,499,888.27", () => {
    const { acc } = closeOf(LBP_TB, 9_500_000);
    expect(acc.discrepancy).toBe(-5.58);
    // The figure Phase 2 stored, named so a regression is unmistakable.
    expect(acc.discrepancy).not.toBe(9_499_888.27);
  });

  it("records BOTH figures: the native one it anchors from and the USD one it compares with", () => {
    const { acc } = closeOf(LBP_TB, 9_500_000);
    expect(acc.actual).toBe(9_500_000);      // native -- becomes startingBalance
    expect(acc.actualUSD).toBe(106.15);      // 9,500,000 / 89,500
    expect(acc.expectedAtClose).toBe(111.73);
    expect(acc.currency).toBe("LBP");
    expect(acc.lbpRateAtClose).toBe(89_500);
  });

  it("the discrepancy is actualUSD - expectedAtClose, checkable from the record alone", () => {
    const { acc } = closeOf(LBP_TB, 9_500_000);
    expect(acc.discrepancy).toBe(Math.round((acc.actualUSD! - acc.expectedAtClose) * 100) / 100);
  });

  it("a USD account is untouched -- actualUSD equals actual and nothing shifts", () => {
    const { acc } = closeOf(USD_TB, 430);
    expect(acc.actual).toBe(430);
    expect(acc.actualUSD).toBe(430);
    expect(acc.discrepancy).toBe(Math.round((430 - acc.expectedAtClose) * 100) / 100);
  });
});

// ───────── 2. two surfaces, one answer ─────────

describe("2. the record and the badge no longer disagree", () => {
  /** Close the LBP account, then read the badge the way the screen does. */
  function closeThenRead(typed: number) {
    const data = dataWith([LBP_TB]);
    const { record, acc, expectedAtClose } = closeOf(LBP_TB, typed, data);
    const after = {
      ...data,
      trackedBalances: [reanchorTrackedBalance(LBP_TB, typed, expectedAtClose, DEFAULT_LBP_RATE, AT)],
      periodCloses: [record],
    } as LocalFinancials;
    return { acc, after, badge: computeDashboard(after).balanceChecks[0] };
  }

  it("both say -5.58", () => {
    // This is the test the defect was found by. computeDashboard converts
    // `actual` before subtracting; Phase 2's builder did not. The badge was
    // therefore RIGHT while the stored record was WRONG -- the same account,
    // the same close, two surfaces, two answers, and only one of them
    // written down. A record that disagrees with the screen above it is
    // worse than no record: it is the version that survives.
    const { acc, badge } = closeThenRead(9_500_000);
    expect(badge.discrepancy).toBe(-5.58);
    expect(acc.discrepancy).toBe(-5.58);
    expect(acc.discrepancy).toBe(badge.discrepancy);
  });

  it("and still agree when the count is exact", () => {
    // 111.73 USD at 89,500 -> 10,000,000 lira (the untouched baseline).
    const { acc, badge } = closeThenRead(10_000_000);
    expect(acc.discrepancy).toBe(0);
    expect(badge.discrepancy).toBe(0);
  });
});

// ───────── 3. deliberately NOT here ─────────

// The acknowledgement's copied discrepancy is the fourth wrong output, and
// its consequence is the worst of the four: acknowledgementFor compares
// ack.discrepancy against balanceChecks[].discrepancy, which is USD, so a
// lira-scale stored figure can never match. The user writes the required
// note, the close records it, and the badge it was meant to clear stays lit.
// Nothing errors -- the control silently does nothing.
//
// It is asserted in BalanceCheckScreen.currency.test.tsx, NOT here. A pure
// test would have to build the acknowledgement itself, and an ack built by
// hand from the right figure proves only that acknowledgementFor matches
// equal numbers -- which it always did. The defect is in what the DIALOG
// copies into it, so the test has to drive the dialog. Written here first,
// passing, and moved once that was noticed.
