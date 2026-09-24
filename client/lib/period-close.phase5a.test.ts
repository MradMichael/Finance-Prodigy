// Period close Phase 5a — the emergency fund and debts, corrected by
// ADJUSTMENT rather than by moving a baseline.
//
// The two mechanisms are not two implementations of one idea (Phase 5 plan
// §1). Reanchoring destroys seven fields and needed PeriodClose invented to
// become reversible; an adjustment writes one visible ledger row and is
// undone by removing it. These accounts keep the better mechanism.
//
// FIGURES AND THEIR UNITS (2.4.138). The suffixes are the contract:
//
//   EF     expectedUSD / countedUSD / deltaUSD      -- USD throughout. EF has
//          no currency field and efAmount is USD by contract, so there is no
//          boundary here to get wrong.
//   debt   expectedNative / countedNative / deltaNative -- the DEBT'S OWN
//          currency throughout. Phase 5a stores no USD figure for a debt,
//          because nothing in it compares debts to a dollar threshold.
//
// THE SIGN CONVENTIONS ARE OPPOSITE, and that is pre-existing, not a choice
// made here: derivedEfBalance ADDS efAmount, derivedDebtBalance SUBTRACTS
// amount+debtAdjustment. So EF delta is counted-expected and debt delta is
// expected-counted. Every test below asserts the ROUND TRIP -- that the
// derived balance afterwards equals what was counted -- rather than the sign
// of the delta, so the convention is verified and not restated.
//
// NO ROUND-NUMBER FIXTURES (2.4.139). A lira debt is exercised at figures
// where a stray conversion is unmissable: 7,607,500 native against $85.00
// converted. `1,000,000 - 900,000 = 100,000` is what let 2.4.137 ship.
//
// WHICH AXES THESE FIXTURES CANNOT REACH (2.4.116):
//
//   * an LBP emergency fund. Unreachable by construction, not skipped.
//   * a debt whose apr has actually accrued. Nothing in the app accrues it
//     (2.4.140), so the drift must be hand-built; the fixture below states
//     that it is simulating a lender figure rather than a produced one.
//   * a goal. Excluded from the phase; no fixture.
//   * two closes of the same cycle. Refused since Phase 3.
import { describe, it, expect } from "vitest";
import {
  DEFAULT_DATA, DEFAULT_LBP_RATE, derivedEfBalance, derivedDebtBalance,
  planEfClose, planDebtClose, buildPeriodClose, reopenCycle,
  type LocalFinancials, type StoredDebt, type StoredTransaction,
} from "./localData";
import { asCycleKey } from "./period";

const tx = (over: Partial<StoredTransaction>): StoredTransaction => ({
  id: over.id ?? "t", amount: 0, currency: "USD", bucket: "SAVINGS",
  description: "x", date: "2026-09-04", paymentMethod: "other", ...over,
});

/** Opening 2,400.00 plus three real contributions -> 2,425.50. */
const efData = (): LocalFinancials => ({
  ...DEFAULT_DATA, income: 3000,
  emergencyFundOpeningBalance: 2_400,
  transactions: [
    tx({ id: "e1", efAmount: 150 }),
    tx({ id: "e2", efAmount: 75.5 }),
    tx({ id: "e3", efAmount: -200 }),
  ],
} as LocalFinancials);

const DEBT_USD: StoredDebt = {
  id: "d1", name: "Car loan", balance: 0, apr: 0, minPayment: 250,
  currency: "USD", createdAt: "2026-01-01T00:00:00.000Z", openingBalance: 4_750,
};
const DEBT_LBP: StoredDebt = {
  id: "d2", name: "Family loan", balance: 0, apr: 0, minPayment: 500_000,
  currency: "LBP", lbpRateAtEntry: DEFAULT_LBP_RATE,
  createdAt: "2026-01-01T00:00:00.000Z", openingBalance: 8_950_000,
};

// ───────── 1. the emergency fund ─────────

describe("1. the emergency fund, in USD throughout", () => {
  it("the premise: the fund derives to 2,425.50 before anything is closed", () => {
    expect(derivedEfBalance(efData())).toBe(2_425.5);
  });

  it("counting 2,380.25 writes an adjustment that makes the derived balance agree", () => {
    const data = efData();
    const { entry, transaction } = planEfClose(data, 2_380.25);
    expect(entry.expectedUSD).toBe(2_425.5);
    expect(entry.countedUSD).toBe(2_380.25);
    expect(entry.deltaUSD).toBe(-45.25);

    // The round trip: apply what it produced and the fund reports what was
    // counted. This is what verifies the sign, rather than asserting it.
    const after = { ...data, transactions: [transaction!, ...data.transactions] };
    expect(derivedEfBalance(after)).toBe(2_380.25);
  });

  it("the adjustment is a real ledger row, carrying no spend", () => {
    const { transaction } = planEfClose(efData(), 2_380.25);
    expect(transaction!.efAmount).toBe(-45.25);
    expect(transaction!.amount).toBe(0);     // corrections are not spending
    expect(transaction!.currency).toBe("USD");
  });

  it("confirming an unchanged fund writes NOTHING", () => {
    // The whole reason an adjustment account can be confirmed in one tap:
    // a zero delta is not a zero-valued row, it is no row.
    const { entry, transaction } = planEfClose(efData(), 2_425.5);
    expect(entry.deltaUSD).toBe(0);
    expect(transaction).toBeUndefined();
    expect(entry.transactionId).toBeUndefined();
  });
});

// ───────── 2. debts, in their own currency throughout ─────────

describe("2. a USD debt", () => {
  const paid = [
    tx({ id: "p1", debtId: "d1", amount: 325, description: "Debt payment" }),
    tx({ id: "p2", debtId: "d1", amount: 412.5, description: "Debt payment" }),
  ];

  it("the premise: 4,750.00 less two payments derives to 4,012.50", () => {
    expect(derivedDebtBalance(DEBT_USD, paid)).toBe(4_012.5);
  });

  it("a statement of 4,058.75 is recorded and the derived balance follows it", () => {
    const { entry, transaction } = planDebtClose(DEBT_USD, paid, 4_058.75);
    expect(entry.expectedNative).toBe(4_012.5);
    expect(entry.countedNative).toBe(4_058.75);
    expect(entry.deltaNative).toBe(-46.25);
    expect(entry.currency).toBe("USD");
    expect(derivedDebtBalance(DEBT_USD, [transaction!, ...paid])).toBe(4_058.75);
  });
});

describe("3. an LBP debt stays in lira, start to finish", () => {
  const paid = [tx({ id: "p3", debtId: "d2", amount: 1_342_500, currency: "LBP", description: "Debt payment" })];

  it("the premise: 8,950,000 less 1,342,500 derives to 7,607,500 lira", () => {
    expect(derivedDebtBalance(DEBT_LBP, paid)).toBe(7_607_500);
  });

  it("nothing is converted -- the figures stay five orders of magnitude from dollars", () => {
    // The unit test proper. 7,607,500 lira is $85.00 at 89,500, so any stray
    // conversion lands three orders of magnitude away and cannot be mistaken
    // for a rounding difference. This is the shape 2.4.137's fixture lacked.
    const { entry, transaction } = planDebtClose(DEBT_LBP, paid, 7_830_000);
    expect(entry.currency).toBe("LBP");
    expect(entry.expectedNative).toBe(7_607_500);
    expect(entry.countedNative).toBe(7_830_000);
    expect(entry.deltaNative).toBe(-222_500);
    // Named explicitly so a converted figure fails loudly rather than
    // looking like a plausible small number.
    expect(entry.expectedNative).not.toBeCloseTo(85, 0);
    expect(transaction!.currency).toBe("LBP");
    expect(transaction!.debtAdjustment).toBe(-222_500);
    expect(derivedDebtBalance(DEBT_LBP, [transaction!, ...paid])).toBe(7_830_000);
  });

  it("stores no USD figure for the debt at all", () => {
    // Deliberate: nothing in this phase compares debts to a dollar
    // threshold, so a USD field would exist only to be believed later.
    const { entry } = planDebtClose(DEBT_LBP, paid, 7_830_000);
    expect(Object.keys(entry).some((k) => k.endsWith("USD"))).toBe(false);
  });
});

// ───────── 4. the cases the code does not guarantee ─────────

describe("4. an interest-bearing debt drifts, and the close mislabels the fix", () => {
  it("records the accrued interest as a CORRECTION, because that is all it has", () => {
    // 2.4.140: derivedDebtBalance never reads apr, so this debt's real
    // balance is above the app's by one month of interest. The fixture
    // supplies the lender's figure by hand -- nothing in the app produces
    // the drift, so it cannot be driven, only simulated.
    const interestBearing: StoredDebt = { ...DEBT_USD, id: "d3", apr: 18 };
    const paid = [tx({ id: "p4", debtId: "d3", amount: 325 })];
    const derived = derivedDebtBalance(interestBearing, paid);
    expect(derived).toBe(4_425);                       // 4,750.00 - 325.00
    const statement = 4_491.38;                        // + 18%/12 on 4,425

    const { entry, transaction } = planDebtClose(interestBearing, paid, statement);
    expect(entry.deltaNative).toBe(-66.38);
    expect(derivedDebtBalance(interestBearing, [transaction!, ...paid])).toBe(statement);
    // The balance becomes true and the LEDGER becomes misleading about why:
    // this row is interest, filed under a name that says someone erred. It
    // will recur every cycle for as long as the debt carries an APR.
    expect(transaction!.description).toContain("correction");
  });
});

describe("5. an overpaid debt reads zero, and the close cannot see the credit", () => {
  it("the clamp hides it, and the close neither creates nor surfaces that", () => {
    // Math.max(0, ...) in derivedDebtBalance. Pinned so a later reader does
    // not mistake the silence for the debt genuinely being settled exactly.
    const over = [tx({ id: "p5", debtId: "d1", amount: 5_120.4 })];
    expect(derivedDebtBalance(DEBT_USD, over)).toBe(0);  // really -370.40
    const { entry, transaction } = planDebtClose(DEBT_USD, over, 0);
    expect(entry.deltaNative).toBe(0);
    expect(transaction).toBeUndefined();
  });
});

// ───────── 6. reopening undoes the adjustments ─────────

describe("6. reopen removes what the close wrote", () => {
  // NOT IN THE APPROVED PLAN, and reachable the moment both phases are on
  // main: Phase 4's reopen restores priorState, which these accounts do not
  // have. Without this, reopening a cycle would leave the corrections
  // standing while the record said the close never happened.
  const SD = 27, CUR = asCycleKey("2026-08");
  const NOW = new Date(2026, 8, 10, 12, 0, 0);

  /** A close that corrected the fund down by 45.25 and a debt up by 222,500 lira. */
  function closedWithAdjustments() {
    const base = efData();
    const paid = [tx({ id: "p3", debtId: "d2", amount: 1_342_500, currency: "LBP" })];
    const data = { ...base, cycleStartDay: SD, debts: [DEBT_LBP],
      transactions: [...paid, ...base.transactions] } as LocalFinancials;
    const ef = planEfClose(data, 2_380.25);
    const debt = planDebtClose(DEBT_LBP, data.transactions, 7_830_000);
    const record = buildPeriodClose({
      cycleKey: CUR, startDay: SD, closedAt: NOW, lbpRate: DEFAULT_LBP_RATE,
      accounts: [], emergencyFund: ef.entry, debts: [debt.entry],
    });
    const after = {
      ...data,
      transactions: [ef.transaction!, debt.transaction!, ...data.transactions],
      periodCloses: [record],
    } as LocalFinancials;
    return { after, ef, debt };
  }

  it("the premise: the close really did move both balances", () => {
    const { after } = closedWithAdjustments();
    expect(derivedEfBalance(after)).toBe(2_380.25);
    expect(derivedDebtBalance(DEBT_LBP, after.transactions)).toBe(7_830_000);
  });

  it("both balances go back to what they were", () => {
    const { after } = closedWithAdjustments();
    const out = reopenCycle(after, CUR, NOW)!;
    expect(derivedEfBalance(out)).toBe(2_425.5);
    expect(derivedDebtBalance(DEBT_LBP, out.transactions)).toBe(7_607_500);
  });

  it("the rows are SOFT-deleted, not spliced out of the ledger", () => {
    // Same reasoning as marking the close reopened rather than deleting it:
    // the correction happened, and a record of a reversed correction is
    // worth more than a gap where one used to be.
    const { after, ef } = closedWithAdjustments();
    const out = reopenCycle(after, CUR, NOW)!;
    expect(out.transactions).toHaveLength(after.transactions.length);
    const row = out.transactions.find((t) => t.id === ef.transaction!.id)!;
    expect(row.deletedAt).toBeTruthy();
  });

  it("a close that wrote nothing leaves the ledger completely untouched", () => {
    // Confirming unchanged figures plans no transactions, so there is
    // nothing to undo and reopen must not invent a write.
    const base = efData();
    const data = { ...base, cycleStartDay: SD } as LocalFinancials;
    const ef = planEfClose(data, 2_425.5);
    expect(ef.transaction).toBeUndefined();
    const record = buildPeriodClose({
      cycleKey: CUR, startDay: SD, closedAt: NOW, lbpRate: DEFAULT_LBP_RATE,
      accounts: [], emergencyFund: ef.entry,
    });
    const after = { ...data, periodCloses: [record] } as LocalFinancials;
    const out = reopenCycle(after, CUR, NOW)!;
    expect(out.transactions).toBe(after.transactions);
  });
});
