// The emergency-fund correction field, as DI-02's debt field (owner, session
// 8). Its help text, "Positive adds to it, negative draws from it.", matches
// the stored sign (derivedEfBalance adds efAmount), but the field stripped a
// typed minus: a draw couldn't be entered, and editing a stored draw turned it
// into a deposit. It now takes one leading minus and keeps it.
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import EditTransactionSheet from "./EditTransactionSheet";
import { ThemeProvider } from "../contexts/ThemeContext";
import { DEFAULT_DATA, derivedEfBalance, type LocalFinancials, type StoredTransaction } from "../lib/localData";

afterEach(cleanup);

const HELP = "Positive adds to it, negative draws from it.";
// A $200 draw from a $1,000 fund.
const DRAW = { id: "t1", amount: 200, currency: "USD", bucket: "SAVINGS", description: "Car repair from the fund", date: "2026-10-01", efAmount: -200 } as StoredTransaction;

function open(tx: StoredTransaction = DRAW) {
  const data = { ...DEFAULT_DATA, income: 3000, emergencyFundOpeningBalance: 1000, transactions: [tx] } as LocalFinancials;
  const onChange = vi.fn<(d: LocalFinancials) => void>();
  render(<ThemeProvider><EditTransactionSheet transaction={tx} financials={data} onChange={onChange} onClose={vi.fn()} /></ThemeProvider>);
  const field = screen.getByText(HELP).parentElement!.querySelector("input")!;
  const saved = () => {
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const out = onChange.mock.calls.at(-1)![0];
    return { tx: out.transactions.find((t) => t.id === tx.id)!, fund: derivedEfBalance(out) };
  };
  return { field, saved };
}

it("a stored draw reads as negative, and saving it unchanged keeps the fund where it is", () => {
  const { field, saved } = open();
  expect(field.value).toBe("-200");
  const { tx, fund } = saved();
  expect(tx.efAmount).toBe(-200);
  expect(fund).toBe(800);
});

it("editing a stored draw keeps its sign", () => {
  const { field, saved } = open();
  fireEvent.focus(field);
  fireEvent.change(field, { target: { value: "-250" } });
  fireEvent.blur(field);
  expect(field.value).toBe("-250");
  const { tx, fund } = saved();
  expect(tx.efAmount).toBe(-250);
  expect(fund).toBe(750);
});

it("a minus can be typed: a deposit becomes a draw, as the text says", () => {
  const DEPOSIT = { ...DRAW, id: "t2", efAmount: 100, description: "To the fund" } as StoredTransaction;
  const { field, saved } = open(DEPOSIT);
  expect(field.value).toBe("100");
  fireEvent.focus(field);
  fireEvent.change(field, { target: { value: "-100" } });
  fireEvent.blur(field);
  const { tx, fund } = saved();
  expect(tx.efAmount).toBe(-100);
  expect(fund).toBe(900);
});

it("a lira draw keeps its sign through the conversion both ways", () => {
  const LIRA = { ...DRAW, id: "t3", currency: "LBP", amount: 8_950_000, efAmount: -100 } as StoredTransaction; // $100 at 89,500
  const { field, saved } = open(LIRA);
  expect(field.value).toBe("-8,950,000");
  fireEvent.focus(field);
  fireEvent.change(field, { target: { value: "-17900000" } });
  fireEvent.blur(field);
  expect(saved().tx.efAmount).toBe(-200);
});
