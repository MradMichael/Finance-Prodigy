// TEST-02 (blind-spot audit, session 21): the debt payment sheet parses the
// amount and STORES the payment, and no test checked what it wrote. These pin
// it: the payment is one transaction in the debt's own currency, linked to
// the debt, on the bucket and date chosen, and the debt's derived balance
// drops by exactly that; a draw from the safety net is stored as a negative
// dollar amount; a blank or zero amount saves nothing. (Whether the debt is
// marked "paid off" is DI-01's question, Q13: deliberately not pinned here.)
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import PayDebtSheet from "./PayDebtSheet";
import { ThemeProvider } from "../contexts/ThemeContext";
import { DEFAULT_DATA, derivedDebtBalance, todayISO, type LocalFinancials, type StoredDebt } from "../lib/localData";

afterEach(cleanup);

const CARD = { id: "d-usd", name: "Visa", openingBalance: 5000, balance: 5000, apr: 24, minPayment: 50, currency: "USD", createdAt: "2026-01-01T00:00:00.000Z" } as StoredDebt;
const LOAN = { id: "d-lbp", name: "Family loan", openingBalance: 8_950_000, balance: 8_950_000, apr: 0, minPayment: 895_000, currency: "LBP", createdAt: "2026-01-01T00:00:00.000Z" } as StoredDebt;

function pay(debt: StoredDebt, amount: string, opts: { bucket?: string; fromSafetyNet?: boolean } = {}) {
  const data = { ...DEFAULT_DATA, income: 3000, lbpRate: 89_500, emergencyFundOpeningBalance: 500, debts: [CARD, LOAN], transactions: [] } as LocalFinancials;
  const onChange = vi.fn<(d: LocalFinancials) => void>();
  const onClose = vi.fn();
  render(<ThemeProvider><PayDebtSheet debt={debt} financials={data} onChange={onChange} onClose={onClose} /></ThemeProvider>);
  fireEvent.change(screen.getByLabelText("Amount", { exact: true }), { target: { value: amount } });
  if (opts.bucket) fireEvent.click(screen.getByRole("button", { name: new RegExp(opts.bucket) }));
  if (opts.fromSafetyNet) fireEvent.click(screen.getByRole("button", { name: /Pay this from Safety net/ }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  return { onChange, onClose, written: onChange.mock.calls.at(-1)?.[0] };
}

it("a payment of 1,234.50 is one transaction in the debt's currency, linked to it, and lowers its balance by exactly that", () => {
  const { written, onClose } = pay(CARD, "1,234.50");
  expect(written!.transactions).toHaveLength(1);
  expect(written!.transactions[0]).toMatchObject({ amount: 1234.5, currency: "USD", debtId: "d-usd", bucket: "NEEDS", date: todayISO() });
  expect(derivedDebtBalance(CARD, written!.transactions)).toBe(3765.5);
  expect(onClose).toHaveBeenCalled();
});

it("on the bucket chosen", () => {
  const { written } = pay(CARD, "100", { bucket: "Wants" });
  expect(written!.transactions[0].bucket).toBe("WANTS");
});

it("a lira debt's payment is stored in lira, not converted", () => {
  const { written } = pay(LOAN, "895,000");
  expect(written!.transactions[0]).toMatchObject({ amount: 895_000, currency: "LBP", debtId: "d-lbp" });
  expect(derivedDebtBalance(LOAN, written!.transactions)).toBe(8_055_000);
});

it("paid from the safety net, the draw is stored as a negative dollar amount: L£895,000 at 89,500 is −$10", () => {
  const { written } = pay(LOAN, "895,000", { fromSafetyNet: true });
  expect(written!.transactions[0].efAmount).toBe(-10);
});

it("a blank or zero amount saves nothing", () => {
  expect(pay(CARD, "").onChange).not.toHaveBeenCalled();
  cleanup();
  expect(pay(CARD, "0").onChange).not.toHaveBeenCalled();
});
