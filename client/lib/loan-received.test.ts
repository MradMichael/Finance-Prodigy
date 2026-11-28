// Session 68's plan, step B (owner approved, session 69): a loan received. Adding a debt can record the money
// arriving: a gained Transfer on Cash or a card, in the debt's currency, carrying `borrowedForDebtId` and never
// `debtId` (a `debtId` would count it as a payment and pay the debt off). Rule 7: its amount is positive, the pool
// gained, the polarity TRANSFER shares with `efAmount`; checked here by a round trip (the pool's expected figure
// rises by the amount), not by asserting a sign alone.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { computeDashboard, trackedBalanceExpected, periodTotals } from "./computeDashboard";
import { DEFAULT_DATA, buildLoanReceiptTx, derivedDebtBalance, mergeTransactions, type LocalFinancials, type StoredDebt, type StoredTransaction, type TrackedBalance } from "./localData";
import { mergeFinancials } from "./syncMerge";
import { seenOf } from "./syncSeen";
import { isReimbursement } from "./trips";
import { asCycleKey } from "./period";

beforeEach(() => { vi.useFakeTimers({ now: new Date(2026, 6, 20, 12, 0), toFake: ["Date"] }); }); // 20 July 2026
afterEach(() => { vi.useRealTimers(); });

const LOAN: StoredDebt = { id: "d1", name: "Loan from Dad", balance: 800, openingBalance: 800, apr: 0, minPayment: 0, currency: "USD", createdAt: "2026-07-05T10:00:00.000Z" };
const LIRA: StoredDebt = { ...LOAN, id: "d2", name: "Family loan", balance: 89_500_000, openingBalance: 89_500_000, currency: "LBP", lbpRateAtEntry: 89_500 };
const CASH: TrackedBalance = { id: "b1", name: "Cash", paymentMethod: "cash", startingBalance: 100, startingDate: "2026-07-01", currency: "USD" };
const VISA: TrackedBalance = { id: "b2", name: "Visa", paymentMethod: "card", cardId: "c1", startingBalance: 1000, startingDate: "2026-07-01", currency: "USD" };
const data = (o: Partial<LocalFinancials> = {}) => ({ ...DEFAULT_DATA, income: 3000, lbpRate: 89_500, cards: [{ id: "c1", type: "Visa", last4: "4821", label: "Visa •••• 4821" }], trackedBalances: [CASH, VISA], transactions: [], debts: [], ...o }) as LocalFinancials;

describe("buildLoanReceiptTx", () => {
  it("a gained Transfer for the debt's balance, in its currency, on the pool, linked by borrowedForDebtId and never debtId", () => {
    const r = buildLoanReceiptTx(LOAN, { paymentMethod: "cash" }, 89_500, "2026-07-05");
    expect(r).toMatchObject({ bucket: "TRANSFER", amount: 800, currency: "USD", paymentMethod: "cash", date: "2026-07-05", description: "Borrowed: Loan from Dad", borrowedForDebtId: "d1" });
    expect(r.debtId).toBeUndefined();
    expect(r.cardId).toBeUndefined();
    expect(r.id).toBeTruthy();
    expect(r.createdAt).toBeTruthy();
    expect(r.updatedAt).toBe(r.createdAt);
  });

  it("on a card: the card's id and label; a lira debt's receipt is in lira and carries the rate", () => {
    const r = buildLoanReceiptTx(LIRA, { paymentMethod: "card", cardId: "c1", cardLabel: "Visa •••• 4821" }, 89_500, "2026-07-05");
    expect(r).toMatchObject({ amount: 89_500_000, currency: "LBP", paymentMethod: "card", cardId: "c1", cardLabel: "Visa •••• 4821", lbpRateAtEntry: 89_500, borrowedForDebtId: "d2" });
  });
});

describe("a loan received, through the dashboard (round trip)", () => {
  function before_after(debt: StoredDebt, pool: Parameters<typeof buildLoanReceiptTx>[1]) {
    const spend: StoredTransaction = { id: "s1", amount: 40, currency: "USD", bucket: "WANTS", description: "Dinner", date: "2026-07-03", paymentMethod: "cash" };
    const before = data({ transactions: [spend] });
    const after = data({ debts: [debt], transactions: [buildLoanReceiptTx(debt, pool, 89_500, "2026-07-05"), spend] });
    return { before, after };
  }

  it("Cash's expected figure rises by the amount; the debt equals it; net worth, income and spending don't move", () => {
    const { before, after } = before_after(LOAN, { paymentMethod: "cash" });
    expect(trackedBalanceExpected(CASH, after) - trackedBalanceExpected(CASH, before)).toBe(800);
    expect(trackedBalanceExpected(VISA, after)).toBe(trackedBalanceExpected(VISA, before));
    expect(derivedDebtBalance(LOAN, after.transactions, after)).toBe(800);
    const [b, a] = [computeDashboard(before), computeDashboard(after)];
    expect(a.netWorth.total).toBe(b.netWorth.total);
    expect(a.netWorth.liabilities - b.netWorth.liabilities).toBe(800);
    expect(a.month.income).toBe(b.month.income);
    expect([a.month.needsSpend, a.month.wantsSpend, a.month.savingsContrib]).toEqual([b.month.needsSpend, b.month.wantsSpend, b.month.savingsContrib]);
    expect(periodTotals(after, asCycleKey("2026-07"), new Date(2026, 6, 20))).toEqual(periodTotals(before, asCycleKey("2026-07"), new Date(2026, 6, 20)));
  });

  it("a lira debt received into a USD card: the card rises by its dollar value; net worth unchanged", () => {
    const { before, after } = before_after(LIRA, { paymentMethod: "card", cardId: "c1", cardLabel: "Visa •••• 4821" });
    expect(trackedBalanceExpected(VISA, after) - trackedBalanceExpected(VISA, before)).toBe(1000);
    expect(trackedBalanceExpected(CASH, after)).toBe(trackedBalanceExpected(CASH, before));
    expect(derivedDebtBalance(LIRA, after.transactions, after)).toBe(89_500_000);
    const [b, a] = [computeDashboard(before), computeDashboard(after)];
    expect(a.netWorth.total).toBe(b.netWorth.total);
    expect(a.month.income).toBe(b.month.income);
  });
});

describe("trips", () => {
  it("a loan received is not a reimbursement (it can't lower a trip's spending); an ordinary gained Transfer still is", () => {
    const receipt = buildLoanReceiptTx(LOAN, { paymentMethod: "cash" }, 89_500, "2026-07-05");
    const payback: StoredTransaction = { id: "p1", amount: 25, currency: "USD", bucket: "TRANSFER", description: "Dad for fuel", date: "2026-07-06", paymentMethod: "cash" };
    expect(isReimbursement(receipt, [receipt, payback])).toBe(false);
    expect(isReimbursement(payback, [receipt, payback])).toBe(true);
  });
});

describe("sync", () => {
  it("the debt and its receipt, pushed together, arrive together (a pull after a sync, as syncs merge: with the last synced copy seen)", () => {
    const receipt = buildLoanReceiptTx(LOAN, { paymentMethod: "cash" }, 89_500, "2026-07-05");
    const lastSynced = data();
    const server = data({ debts: [{ ...LOAN, updatedAt: "2026-07-05T10:00:00.000Z" }], transactions: [receipt] });
    const merged = mergeFinancials(data(), server, new Date(2026, 6, 20), seenOf(lastSynced)).data;
    expect(merged.debts.map((d) => d.id)).toEqual(["d1"]);
    expect(merged.transactions.find((t) => t.id === receipt.id)).toMatchObject({ borrowedForDebtId: "d1", amount: 800, bucket: "TRANSFER" });
    expect(derivedDebtBalance(LOAN, merged.transactions, merged)).toBe(800);
  });

  it("the link survives a merge with another device's later edit of the receipt", () => {
    const receipt = buildLoanReceiptTx(LOAN, { paymentMethod: "cash" }, 89_500, "2026-07-05");
    const edited = { ...receipt, description: "Borrowed from Dad", updatedAt: "2026-07-21T09:00:00.000Z" };
    const { transactions } = mergeTransactions([receipt], [edited]);
    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({ description: "Borrowed from Dad", borrowedForDebtId: "d1" });
  });
});
