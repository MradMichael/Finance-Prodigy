// Session 68's plan, step B (owner approved, session 69): the money received for a debt is an ordinary gained
// Transfer carrying `borrowedForDebtId`. Edit entry saves `{...t, ...}`, so an edit (this build's, or an older
// build's, which doesn't know the field) keeps the link, and the debt's balance is untouched by it.
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import EditTransactionSheet from "./EditTransactionSheet";
import { ThemeProvider } from "../contexts/ThemeContext";
import { DEFAULT_DATA, derivedDebtBalance, type LocalFinancials, type StoredDebt, type StoredTransaction } from "../lib/localData";

afterEach(cleanup);

const DEBT: StoredDebt = { id: "d1", name: "Loan from Dad", balance: 800, openingBalance: 800, apr: 0, minPayment: 0, currency: "USD", createdAt: "2026-07-05T10:00:00.000Z" };
const RECEIPT: StoredTransaction = { id: "r1", amount: 800, currency: "USD", bucket: "TRANSFER", description: "Borrowed: Loan from Dad", date: "2026-07-05", paymentMethod: "cash", borrowedForDebtId: "d1", createdAt: "2026-07-05T10:00:00.000Z", updatedAt: "2026-07-05T10:00:00.000Z" };

it("editing the receipt's description keeps the link, the amount and the debt's balance", () => {
  const data = { ...DEFAULT_DATA, income: 3000, debts: [DEBT], transactions: [RECEIPT] } as LocalFinancials;
  const onChange = vi.fn<(d: LocalFinancials) => void>();
  render(<ThemeProvider><EditTransactionSheet transaction={RECEIPT} financials={data} onChange={onChange} onClose={vi.fn()} /></ThemeProvider>);
  fireEvent.change(screen.getByLabelText("Description", { exact: true }), { target: { value: "Borrowed from Dad" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  const out = onChange.mock.calls.at(-1)![0];
  const r = out.transactions.find((t) => t.id === "r1")!;
  expect(r).toMatchObject({ description: "Borrowed from Dad", amount: 800, bucket: "TRANSFER", borrowedForDebtId: "d1" });
  expect(r.debtId).toBeUndefined();
  expect(derivedDebtBalance(DEBT, out.transactions, out)).toBe(800);
});
