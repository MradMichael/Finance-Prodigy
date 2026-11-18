// Item 4 (owner, session 57): a correction row (debt, safety net, goal) is stored at 0 on purpose: its change is in
// its own field, and the edit sheet saves it at 0 (D-a, session 56). Saving a lira one asked "0 LBP is unusually low
// for a real purchase …": the shared mistype check counted 0 as a low lira amount. 0 is never a mistyped amount, so
// the check asks only above 0. Its four callers (the edit sheet; the entry form twice; Goals): only the edit sheet
// can pass 0 (the others refuse 0 first), so nothing else changes.
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import EditTransactionSheet from "./EditTransactionSheet";
import { ThemeProvider } from "../contexts/ThemeContext";
import { looksLikeMistypedLbp } from "../lib/entryGuards";
import { DEFAULT_DATA, type LocalFinancials, type StoredDebt, type StoredTransaction } from "../lib/localData";

afterEach(cleanup);

const DIALOG = { name: "Confirm low LBP amount" };
const LOAN = { id: "d1", name: "Family loan", openingBalance: 9_000_000, balance: 9_000_000, apr: 0, minPayment: 500_000, currency: "LBP", createdAt: "2026-01-01T00:00:00.000Z" } as StoredDebt;

function open(tx: StoredTransaction) {
  const data = { ...DEFAULT_DATA, income: 3000, debts: [LOAN], transactions: [tx] } as LocalFinancials;
  const onChange = vi.fn<(d: LocalFinancials) => void>();
  render(<ThemeProvider><EditTransactionSheet transaction={tx} financials={data} onChange={onChange} onClose={vi.fn()} /></ThemeProvider>);
  return { onChange, save: () => fireEvent.click(screen.getByRole("button", { name: "Save" })) };
}

it("the shared check: 0 is never a mistyped amount; L£400 still is; L£500 and $400 aren't", () => {
  expect(looksLikeMistypedLbp(0, "LBP")).toBe(false);
  expect(looksLikeMistypedLbp(400, "LBP")).toBe(true);
  expect(looksLikeMistypedLbp(500, "LBP")).toBe(false);
  expect(looksLikeMistypedLbp(400, "USD")).toBe(false);
});

it("a lira debt correction row at 0 saves from the edit sheet without asking", () => {
  const s = open({ id: "t1", amount: 0, currency: "LBP", bucket: "SAVINGS", description: "Debt correction: Family loan", date: "2026-10-01", paymentMethod: "other", debtId: "d1", debtAdjustment: -300_000 } as StoredTransaction);
  s.save();
  expect(screen.queryByRole("dialog", DIALOG)).toBeNull();
  expect(s.onChange).toHaveBeenCalledTimes(1);
  expect(s.onChange.mock.calls[0][0].transactions[0].amount).toBe(0);
});

it("a lira entry at L£400 still asks first", () => {
  const s = open({ id: "t2", amount: 400, currency: "LBP", bucket: "NEEDS", description: "Bread", date: "2026-10-01", paymentMethod: "cash" } as StoredTransaction);
  s.save();
  expect(screen.getByRole("dialog", DIALOG)).toBeTruthy();
  expect(s.onChange).not.toHaveBeenCalled();
});
