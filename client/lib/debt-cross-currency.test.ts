// Session 24, item 3 (owner; plan J's day rate): DI-03. A debt-linked
// transaction can be in the other currency (the edit sheet links any
// transaction to any debt), and the derived balance subtracted its raw amount:
// a $1,200 Visa read paid after an L£1,000,000 (~$11.17) payment. A linked
// transaction in another currency now converts into the debt's currency at the
// rate on the payment's own day. Same-currency links are unchanged.
import { it, expect } from "vitest";
import { derivedDebtBalance, DEFAULT_DATA, type LocalFinancials, type StoredDebt, type StoredTransaction } from "./localData";
import { computeDashboard } from "./computeDashboard";

const VISA: StoredDebt = { id: "visa", name: "Visa", balance: 1200, openingBalance: 1200, apr: 20, minPayment: 50, currency: "USD", createdAt: "2026-09-01T00:00:00.000Z" };
const LOAN: StoredDebt = { id: "loan", name: "Loan", balance: 50_000_000, openingBalance: 50_000_000, apr: 10, minPayment: 1_000_000, currency: "LBP", createdAt: "2026-09-01T00:00:00.000Z" };
const pay = (id: string, debtId: string, amount: number, currency: "USD" | "LBP", date: string, extra: Partial<StoredTransaction> = {}) =>
  ({ id, amount, currency, bucket: "NEEDS", description: id, date, debtId, ...extra }) as StoredTransaction;
const data = (transactions: StoredTransaction[], o: Partial<LocalFinancials> = {}) => ({ ...DEFAULT_DATA, income: 3000, lbpRate: 89_500, debts: [VISA, LOAN], transactions, ...o }) as LocalFinancials;

it("a USD debt with a lira payment: $1,200 less L£1,000,000 at 89,500 is $1,188.83, not paid off", () => {
  const d = data([pay("p1", "visa", 1_000_000, "LBP", "2026-10-05")]);
  expect(derivedDebtBalance(VISA, d.transactions, d)).toBe(1188.83);
});

it("a lira debt with a dollar payment: L£50,000,000 less $500 at 89,500 is L£5,250,000", () => {
  const d = data([pay("p2", "loan", 500, "USD", "2026-10-05")]);
  expect(derivedDebtBalance(LOAN, d.transactions, d)).toBe(5_250_000);
});

it("at the payment's own day's rate, not today's", () => {
  const d = data([pay("p1", "visa", 1_000_000, "LBP", "2026-10-05")], { lbpRate: 179_000, lbpRateLog: [{ from: "2026-10-01", value: 100_000 }, { from: "2026-10-12", value: 179_000 }] });
  expect(derivedDebtBalance(VISA, d.transactions, d)).toBe(1190);
});

it("a debt adjustment in the payment's currency converts with it", () => {
  const d = data([pay("p3", "visa", 895_000, "LBP", "2026-10-05", { debtAdjustment: 895_000 })]);
  expect(derivedDebtBalance(VISA, d.transactions, d)).toBe(1180);
});

it("same-currency links are unchanged", () => {
  const d = data([pay("p4", "visa", 200, "USD", "2026-10-05"), pay("p5", "loan", 5_000_000, "LBP", "2026-10-05")]);
  expect(derivedDebtBalance(VISA, d.transactions, d)).toBe(1000);
  expect(derivedDebtBalance(LOAN, d.transactions, d)).toBe(45_000_000);
});

it("the dashboard's debt total follows: Visa still counts, at $1,188.83", () => {
  const dash = computeDashboard(data([pay("p1", "visa", 1_000_000, "LBP", "2026-10-05")], { debts: [VISA] }));
  expect(dash.debt.count).toBe(1);
  expect(dash.debt.totalBalance).toBeCloseTo(1188.83, 2);
});
