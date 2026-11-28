// Session 68's plan, step C (owner approved, session 69): "Money borrowed for" in Edit entry, on a Transfer that
// gained (not a foreign-cash row, not one leg of a transfer), without "A new debt"; a debt already received on
// another entry isn't offered. The link is cleared when the row stops being a Transfer that gained. "Linked debt" (a
// payment) shows on money coming in (a gained Transfer, or Income) only when it's already set, so a wrong link stays
// visible and can be removed (the session 68 H2 trap). The retag of an Income entry keeps the amount positive and
// leaves the pool's expected figure exactly where it was (re-derived, rule 18: retagBucketAmount keeps INCOME ->
// TRANSFER positive, and both raise the pool, computeDashboard.ts's -1 branch).
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import EditTransactionSheet from "./EditTransactionSheet";
import { ThemeProvider } from "../contexts/ThemeContext";
import { trackedBalanceExpected, periodTotals } from "../lib/computeDashboard";
import { DEFAULT_DATA, derivedDebtBalance, type LocalFinancials, type StoredDebt, type StoredTransaction, type TrackedBalance } from "../lib/localData";
import { asCycleKey } from "../lib/period";

afterEach(cleanup);

const DAD: StoredDebt = { id: "d1", name: "Loan from Dad", balance: 200, openingBalance: 200, apr: 0, minPayment: 0, currency: "USD", createdAt: "2026-07-01T00:00:00.000Z" };
const CAR: StoredDebt = { id: "d2", name: "Car loan", balance: 6000, openingBalance: 6000, apr: 9, minPayment: 150, currency: "USD", createdAt: "2026-01-01T00:00:00.000Z" };
const CASH: TrackedBalance = { id: "b1", name: "Cash", paymentMethod: "cash", startingBalance: 100, startingDate: "2026-07-01", currency: "USD" };
const INCOME_200: StoredTransaction = { id: "t1", amount: 200, currency: "USD", bucket: "INCOME", description: "Loan from Dad", date: "2026-07-10", paymentMethod: "cash" };
const RECEIPT: StoredTransaction = { id: "r1", amount: 800, currency: "USD", bucket: "TRANSFER", description: "Borrowed: Loan from Dad", date: "2026-07-05", paymentMethod: "cash", borrowedForDebtId: "d1" };

function open(tx: StoredTransaction, o: Partial<LocalFinancials> = {}) {
  const data = { ...DEFAULT_DATA, income: 3000, debts: [DAD, CAR], trackedBalances: [CASH], transactions: [tx], ...o } as LocalFinancials;
  const onChange = vi.fn<(d: LocalFinancials) => void>();
  render(<ThemeProvider><EditTransactionSheet transaction={tx} financials={data} onChange={onChange} onClose={vi.fn()} /></ThemeProvider>);
  const save = () => { fireEvent.click(screen.getByRole("button", { name: "Save" })); return onChange.mock.calls.at(-1)![0]; };
  return { data, save };
}
const borrowedFor = () => screen.queryByLabelText("Money borrowed for", { exact: true }) as HTMLSelectElement | null;
const linkedDebt = () => screen.queryByLabelText("Linked debt", { exact: true }) as HTMLSelectElement | null;
const type = (label: string) => fireEvent.click(screen.getByRole("button", { name: new RegExp(`^\\S+ ${label}$`) }));

it("the owner's retag: Income -> Transfer, then the debt. Positive, linked; Cash unchanged; that month's income drops", () => {
  const { data, save } = open(INCOME_200);
  expect(borrowedFor()).toBeNull();
  type("Transfer");
  expect(screen.getByRole("button", { name: /Pool gained this/ }).getAttribute("aria-pressed")).toBe("true");
  expect(Array.from(borrowedFor()!.options).map((o) => o.textContent)).toEqual(["Not a loan", "Loan from Dad", "Car loan"]);
  fireEvent.change(borrowedFor()!, { target: { value: "d1" } });
  const out = save();
  const t = out.transactions[0];
  expect(t).toMatchObject({ bucket: "TRANSFER", amount: 200, borrowedForDebtId: "d1" });
  expect(t.debtId).toBeUndefined();
  expect(trackedBalanceExpected(CASH, out)).toBe(trackedBalanceExpected(CASH, data));
  const now = new Date(2026, 6, 20);
  expect(periodTotals(data, asCycleKey("2026-07"), now).income - periodTotals(out, asCycleKey("2026-07"), now).income).toBe(200);
  expect(derivedDebtBalance(DAD, out.transactions, out)).toBe(200);
});

it("a debt received on another entry isn't offered; this entry's own debt is", () => {
  const other: StoredTransaction = { ...RECEIPT, id: "r2", borrowedForDebtId: "d2", description: "Borrowed: Car loan" };
  open(RECEIPT, { transactions: [RECEIPT, other] });
  expect(Array.from(borrowedFor()!.options).map((o) => o.textContent)).toEqual(["Not a loan", "Loan from Dad"]);
  expect(borrowedFor()!.value).toBe("d1");
});

it("Pool lost this clears the link (the amount goes negative)", () => {
  const { save } = open(RECEIPT);
  fireEvent.click(screen.getByRole("button", { name: /Pool lost this/ }));
  expect(borrowedFor()).toBeNull();
  const t = save().transactions[0];
  expect(t.amount).toBe(-800);
  expect(t.borrowedForDebtId).toBeUndefined();
});

it("retagged to another type, the link is cleared", () => {
  const { save } = open(RECEIPT);
  type("Income");
  const t = save().transactions[0];
  expect(t).toMatchObject({ bucket: "INCOME", amount: 800 });
  expect(t.borrowedForDebtId).toBeUndefined();
});

it("Not a loan removes the link", () => {
  const { save } = open(RECEIPT);
  fireEvent.change(borrowedFor()!, { target: { value: "" } });
  expect(save().transactions[0].borrowedForDebtId).toBeUndefined();
});

it("isn't offered on one leg of a transfer, nor on a foreign-cash change-back", () => {
  const legIn: StoredTransaction = { id: "l1", amount: 50, currency: "USD", bucket: "TRANSFER", description: "Transfer from Visa", date: "2026-07-05", paymentMethod: "cash", linkedPaymentId: "k1" };
  const legOut: StoredTransaction = { ...legIn, id: "l2", amount: -50, description: "Transfer to Cash", paymentMethod: "card", linkedPaymentId: "k1" };
  open(legIn, { transactions: [legIn, legOut] });
  expect(borrowedFor()).toBeNull();
  cleanup();
  const back: StoredTransaction = { id: "f1", amount: 30, currency: "USD", bucket: "TRANSFER", description: "Euros changed back", date: "2026-07-05", paymentMethod: "cash", fx: { kind: "back", amount: 28, code: "EUR" } } as StoredTransaction;
  open(back);
  expect(borrowedFor()).toBeNull();
});

it("Linked debt: hidden on an Income entry and on a gained Transfer unless already set; still offered on spending", () => {
  open(INCOME_200);
  expect(linkedDebt()).toBeNull();
  cleanup();
  open(RECEIPT);
  expect(linkedDebt()).toBeNull();
  cleanup();
  const spend: StoredTransaction = { id: "s1", amount: 150, currency: "USD", bucket: "NEEDS", description: "Car payment", date: "2026-07-05", paymentMethod: "cash" };
  open(spend);
  expect(linkedDebt()).not.toBeNull();
});

it("H2: an Income entry linked to its own loan shows Linked debt; Not linked plus the retag fixes both", () => {
  const h2: StoredTransaction = { ...INCOME_200, debtId: "d1" };
  const { save, data } = open(h2);
  expect(derivedDebtBalance(DAD, data.transactions, data)).toBe(0); // the loan counted as its own repayment
  expect(linkedDebt()!.value).toBe("d1");
  fireEvent.change(linkedDebt()!, { target: { value: "" } });
  expect(linkedDebt()).not.toBeNull(); // stays on screen while editing
  type("Transfer");
  fireEvent.change(borrowedFor()!, { target: { value: "d1" } });
  const out = save();
  expect(out.transactions[0]).toMatchObject({ bucket: "TRANSFER", amount: 200, borrowedForDebtId: "d1" });
  expect(out.transactions[0].debtId).toBeUndefined();
  expect(derivedDebtBalance(DAD, out.transactions, out)).toBe(200);
});
