// DI-01 (owner, session 30, DECISIONS_PENDING entry 3 (a)): a debt is paid
// off when its derived balance is zero, dated by the payment that brought it
// there. The stored flag (paidOffAt) is migrated away (v9 -> v10); kept, as
// paidOffBeforeLedger, only where it's the sole record of the payoff: a debt
// whose opening balance is already zero (paid before the ledger existed).
import { describe, it, expect } from "vitest";
import {
  DEFAULT_DATA, CURRENT_SCHEMA_VERSION, debtPayoff, migrateFinancials, migrateIfOlder,
  type LocalFinancials, type StoredDebt, type StoredTransaction,
} from "./localData";

const VISA = { id: "d-visa", name: "Visa", openingBalance: 1200, balance: 1200, apr: 24, minPayment: 50, currency: "USD", createdAt: "2026-01-01T00:00:00.000Z" } as StoredDebt;
const LOAN = { id: "d-loan", name: "Family loan", openingBalance: 8_950_000, balance: 8_950_000, apr: 0, minPayment: 895_000, currency: "LBP", createdAt: "2026-01-01T00:00:00.000Z" } as StoredDebt;
const pay = (debt: StoredDebt, amount: number, date: string, extra: Partial<StoredTransaction> = {}): StoredTransaction =>
  ({ id: `p-${debt.id}-${amount}-${date}`, amount, currency: debt.currency, bucket: "NEEDS", description: `${debt.name} payment`, date, debtId: debt.id, createdAt: "2026-10-14T09:00:00.000Z", ...extra }) as StoredTransaction;
/** Edit Debt's correction (buildDebtAdjustmentTx's shape): balance -> balance - delta. */
const correct = (debt: StoredDebt, delta: number, date: string): StoredTransaction =>
  ({ id: `c-${debt.id}-${delta}-${date}`, amount: 0, debtAdjustment: delta, currency: debt.currency, bucket: "SAVINGS", description: `Debt correction: ${debt.name}`, date, paymentMethod: "other", debtId: debt.id, createdAt: `${date}T10:00:00.000Z` }) as StoredTransaction;
const data = (patch: Partial<LocalFinancials> = {}) => ({ ...DEFAULT_DATA, lbpRate: 89_500, ...patch }) as LocalFinancials;
const payoff = (debt: StoredDebt, transactions: StoredTransaction[], d = data()) => debtPayoff(debt, transactions, d);

describe("DI-01: paid off is the balance at zero, dated by the payment that reached it", () => {
  it("paid with the pay button: paid off, dated the payment's date (29 Sep), not when it was typed (14 Oct)", () => {
    expect(payoff(VISA, [pay(VISA, 1200, "2026-09-29")])).toEqual({ paidOff: true, on: "2026-09-29" });
  });

  it("the write-up's Visa: paid, then corrected to $200 (a late fee): not paid off", () => {
    expect(payoff(VISA, [pay(VISA, 1200, "2026-09-29"), correct(VISA, -200, "2026-10-02")])).toEqual({ paidOff: false, on: null });
  });

  it("the reverse: a lira loan corrected to 0 in Edit Debt is paid off, dated the correction", () => {
    expect(payoff(LOAN, [correct(LOAN, 8_950_000, "2026-10-05")])).toEqual({ paidOff: true, on: "2026-10-05" });
  });

  it("soft-deleting the payment that paid it off un-pays it", () => {
    expect(payoff(VISA, [pay(VISA, 1200, "2026-09-29", { deletedAt: "2026-10-10T09:00:00.000Z" })])).toEqual({ paidOff: false, on: null });
  });

  it("paid, owed again, paid again: dated by the second payoff", () => {
    expect(payoff(VISA, [pay(VISA, 1200, "2026-09-29"), correct(VISA, -200, "2026-10-02"), pay(VISA, 200, "2026-10-08")])).toEqual({ paidOff: true, on: "2026-10-08" });
  });

  it("the rows are walked in date order, whatever order they're stored in", () => {
    expect(payoff(VISA, [pay(VISA, 700, "2026-10-08"), pay(VISA, 500, "2026-09-29")])).toEqual({ paidOff: true, on: "2026-10-08" });
  });

  it("an overpayment pays it off on its date", () => {
    expect(payoff(VISA, [pay(VISA, 1300, "2026-09-29")])).toEqual({ paidOff: true, on: "2026-09-29" });
  });

  it("a payment in the other currency counts at its day's rate (DI-03): L£107,400,000 clears $1,200 at 89,500", () => {
    expect(payoff(VISA, [pay(VISA, 107_400_000, "2026-09-29", { currency: "LBP" })])).toEqual({ paidOff: true, on: "2026-09-29" });
  });

  it("a part payment leaves it owed", () => {
    expect(payoff(VISA, [pay(VISA, 1199.99, "2026-09-29")])).toEqual({ paidOff: false, on: null });
  });

  it("a debt paid off before the ledger (opening balance 0) is dated by its kept record, read as its local day", () => {
    const old = { ...VISA, openingBalance: 0, balance: 0, paidOffBeforeLedger: "2026-03-10T12:00:00.000Z" } as StoredDebt;
    expect(payoff(old, [])).toEqual({ paidOff: true, on: "2026-03-10" });
  });

  it("an opening balance of 0 with no record: paid off, no date", () => {
    expect(payoff({ ...VISA, openingBalance: 0, balance: 0 }, [])).toEqual({ paidOff: true, on: null });
  });
});

describe("DI-01: the stored flag migrated away (v9 -> v10)", () => {
  const flagged = (d: StoredDebt, at: string) => ({ ...d, paidOffAt: at }) as StoredDebt;
  const PAID = flagged(VISA, "2026-09-29T09:00:00.000Z");
  const OWED_AGAIN = flagged({ ...VISA, id: "d-visa2", name: "Visa 2" }, "2026-09-29T09:00:00.000Z");
  const BEFORE_LEDGER = flagged({ ...VISA, id: "d-old", name: "Old card", openingBalance: 0, balance: 0 }, "2026-03-10T12:00:00.000Z");
  const PLAIN = { ...LOAN };
  const tx = [pay(PAID, 1200, "2026-09-29"), pay(OWED_AGAIN, 1200, "2026-09-29"), correct(OWED_AGAIN, -200, "2026-10-02")];
  const v9 = { ...data(), schemaVersion: 9, debts: [PAID, OWED_AGAIN, BEFORE_LEDGER, PLAIN], transactions: tx } as LocalFinancials;
  const out = migrateFinancials(JSON.parse(JSON.stringify(v9)));

  it("the current version is 10", () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(10);
    expect(out.schemaVersion).toBe(10);
  });

  it("no debt keeps paidOffAt", () => {
    expect(out.debts.map((d) => "paidOffAt" in d)).toEqual([false, false, false, false]);
  });

  it("only the debt with no payment to date it keeps its date, as paidOffBeforeLedger", () => {
    expect(out.debts.map((d) => d.paidOffBeforeLedger)).toEqual([undefined, undefined, "2026-03-10T12:00:00.000Z", undefined]);
  });

  it("every other field, every transaction, unchanged", () => {
    const strip = ({ paidOffAt: _p, ...rest }: StoredDebt & { paidOffAt?: string }) => rest;
    expect(out.debts[0]).toEqual(strip(PAID));
    expect(out.debts[1]).toEqual(strip(OWED_AGAIN));
    expect(out.debts[3]).toEqual(PLAIN);
    expect(out.transactions).toEqual(tx);
  });

  it("after it, each reads as its balance says: paid (29 Sep), owed, paid (10 Mar), owed", () => {
    expect(out.debts.map((d) => debtPayoff(d, out.transactions, out))).toEqual([
      { paidOff: true, on: "2026-09-29" }, { paidOff: false, on: null }, { paidOff: true, on: "2026-03-10" }, { paidOff: false, on: null },
    ]);
  });

  it("a v10 copy passes through unchanged", () => {
    expect(migrateFinancials(JSON.parse(JSON.stringify(out))).debts).toEqual(out.debts);
  });

  it("an older server copy is migrated before a merge (migrateIfOlder)", () => {
    expect(migrateIfOlder(JSON.parse(JSON.stringify(v9))).debts.some((d) => "paidOffAt" in d)).toBe(false);
  });
});
