// TEST-02 (blind-spot audit, session 21): the Edit debt sheet writes a balance
// correction and the debt's own fields, and no test checked what it stored
// (DI-02's sign was found reversed in a sibling form). These pin it: typing a
// different balance and leaving the field records one correction that brings
// the derived balance to exactly the figure typed, in either direction, and
// the same figure records nothing; Save stores the fields as typed, a negative
// APR as 0, and a blank name saves nothing.
import { it, expect, vi, afterEach } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import EditDebtSheet from "./EditDebtSheet";
import { ThemeProvider } from "../contexts/ThemeContext";
import { DEFAULT_DATA, derivedDebtBalance, type LocalFinancials, type StoredDebt } from "../lib/localData";

afterEach(cleanup);

const LOAN = { id: "d1", name: "Car loan", openingBalance: 5000, balance: 5000, apr: 9, minPayment: 150, currency: "USD", createdAt: "2026-01-01T00:00:00.000Z" } as StoredDebt;

function open(debt: StoredDebt = LOAN) {
  const writes: LocalFinancials[] = [];
  const onClose = vi.fn();
  function Harness() {
    const [data, setData] = useState({ ...DEFAULT_DATA, income: 3000, debts: [debt], transactions: [] } as LocalFinancials);
    return <ThemeProvider><EditDebtSheet debt={data.debts[0]} financials={data} onChange={(d) => { writes.push(d); setData(d); }} onClose={onClose} /></ThemeProvider>;
  }
  render(<Harness />);
  const last = () => writes.at(-1)!;
  return { writes, last, onClose };
}
const balanceField = () => document.getElementById("edit-debt-balance") as HTMLInputElement;
const setBalance = (v: string) => { fireEvent.change(balanceField(), { target: { value: v } }); fireEvent.blur(balanceField(), { target: { value: v } }); };

it("a lower balance typed records one correction that brings the debt to exactly that: $5,000 to $4,200", () => {
  const { last, writes } = open();
  setBalance("4200");
  expect(writes).toHaveLength(1);
  expect(last().transactions).toHaveLength(1);
  expect(last().transactions[0]).toMatchObject({ amount: 0, currency: "USD", debtId: "d1", debtAdjustment: 800 });
  expect(derivedDebtBalance(LOAN, last().transactions, DEFAULT_DATA)).toBe(4200);
});

it("a higher balance typed records a correction the other way: $5,000 to $5,300", () => {
  const { last } = open();
  setBalance("5300");
  expect(last().transactions[0].debtAdjustment).toBe(-300);
  expect(derivedDebtBalance(LOAN, last().transactions, DEFAULT_DATA)).toBe(5300);
});

it("the same balance typed records nothing", () => {
  const { writes } = open();
  setBalance("5000");
  expect(writes).toHaveLength(0);
});

it("Save stores the fields as typed, a negative APR as 0, and closes", () => {
  const { last, onClose } = open();
  fireEvent.change(screen.getByLabelText("Name", { exact: true }), { target: { value: "  Car loan (BLOM)  " } });
  fireEvent.change(screen.getByLabelText("APR (%)", { exact: true }), { target: { value: "-4" } });
  fireEvent.change(screen.getByLabelText("Min/mo", { exact: true }), { target: { value: "175" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(last().debts[0]).toMatchObject({ id: "d1", name: "Car loan (BLOM)", apr: 0, minPayment: 175, openingBalance: 5000 });
  expect(onClose).toHaveBeenCalled();
});

it("a blank name saves nothing", () => {
  const { writes, onClose } = open();
  fireEvent.change(screen.getByLabelText("Name", { exact: true }), { target: { value: "   " } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(writes).toHaveLength(0);
  expect(onClose).not.toHaveBeenCalled();
});
