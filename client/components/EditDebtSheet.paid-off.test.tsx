// Session 68's plan, step A (owner approved, session 69, decision D4 (a)): a paid-off debt's Balance field read
// blank (`balance || ""` turned a 0 balance into an empty field), with nothing saying why. It shows 0, stays editable,
// and one line under the fields says it's paid off and that a typed balance is saved as a correction (S1, or S2 when
// there's no payoff date). A debt that still has a balance shows its balance and no such line.
import { it, expect, afterEach } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import EditDebtSheet from "./EditDebtSheet";
import { ThemeProvider } from "../contexts/ThemeContext";
import { DEFAULT_DATA, derivedDebtBalance, type LocalFinancials, type StoredDebt, type StoredTransaction } from "../lib/localData";

afterEach(cleanup);

const LOAN = { id: "d1", name: "Car loan", openingBalance: 5000, balance: 5000, apr: 9, minPayment: 150, currency: "USD", createdAt: "2026-01-01T00:00:00.000Z" } as StoredDebt;
const PAID: StoredTransaction = { id: "p1", date: "2026-03-10", amount: 5000, currency: "USD", bucket: "NEEDS", description: "Car loan payment", debtId: "d1", createdAt: "2026-03-10T09:00:00.000Z" } as StoredTransaction;
const S1 = "Paid off on 10/03/2026. Type a balance only if you still owe something; it's saved as a correction.";
const S2 = "Paid off. Type a balance only if you still owe something; it's saved as a correction.";

function open(debt: StoredDebt, transactions: StoredTransaction[]) {
  const writes: LocalFinancials[] = [];
  function Harness() {
    const [data, setData] = useState({ ...DEFAULT_DATA, income: 3000, debts: [debt], transactions } as LocalFinancials);
    return <ThemeProvider><EditDebtSheet debt={data.debts[0]} financials={data} onChange={(d) => { writes.push(d); setData(d); }} onClose={() => {}} /></ThemeProvider>;
  }
  render(<Harness />);
  return { writes };
}
const balanceField = () => document.getElementById("edit-debt-balance") as HTMLInputElement;
const setBalance = (v: string) => { fireEvent.change(balanceField(), { target: { value: v } }); fireEvent.blur(balanceField(), { target: { value: v } }); };

it("a debt paid off by a payment shows 0 and says when it was paid off (S1)", () => {
  open(LOAN, [PAID]);
  expect(balanceField().value).toBe("0");
  expect(screen.getByText(S1)).toBeTruthy();
  expect(balanceField().getAttribute("aria-describedby")).toBe("edit-debt-paid-off");
  expect(document.getElementById("edit-debt-paid-off")!.textContent).toBe(S1);
});

it("a debt with no payoff date (it started at 0) shows 0 and S2", () => {
  open({ ...LOAN, openingBalance: 0, balance: 0 }, []);
  expect(balanceField().value).toBe("0");
  expect(screen.getByText(S2)).toBeTruthy();
  expect(screen.queryByText(S1)).toBeNull();
});

it("a debt that still has a balance shows it and neither sentence", () => {
  open(LOAN, [{ ...PAID, amount: 1200 }]);
  expect(balanceField().value).toBe("3800");
  expect(screen.queryByText(/^Paid off/)).toBeNull();
  expect(balanceField().getAttribute("aria-describedby")).toBeNull();
});

it("the field stays editable: typing 150 on a paid-off debt writes one correction, and the line goes", () => {
  const { writes } = open(LOAN, [PAID]);
  expect(balanceField().readOnly).toBe(false);
  setBalance("150");
  expect(writes).toHaveLength(1);
  const rows = writes[0].transactions;
  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({ amount: 0, currency: "USD", debtId: "d1", debtAdjustment: -150 });
  expect(derivedDebtBalance(LOAN, rows, DEFAULT_DATA)).toBe(150);
  expect(balanceField().value).toBe("150");
  expect(screen.queryByText(/^Paid off/)).toBeNull();
});
