// Session 68's plan, step C (owner approved, session 69, D3 (a)): "Money borrowed for" on the entry form, for a
// Transfer (money arriving) not split across currencies. "Not a loan" (the default) writes what the form writes
// today. A debt picked links the entry to it (borrowedForDebtId); the debt is unchanged. "A new debt" writes the debt
// (from the entry's amount, currency and date; interest and minimum 0; named by the description, or "Loan") and the
// entry linked to it, in ONE update. A debt whose money is already recorded isn't offered.
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import InputPanel from "../InputPanel";
import { computeDashboard } from "../../lib/computeDashboard";
import { DEFAULT_DATA, derivedDebtBalance, type LocalFinancials, type StoredDebt, type StoredTransaction } from "../../lib/localData";

beforeEach(() => { vi.useFakeTimers({ now: new Date(2026, 10, 13, 12, 0), toFake: ["Date"] }); }); // 13 November 2026
afterEach(() => { cleanup(); vi.useRealTimers(); });

let latest: LocalFinancials;
let writes = 0;
function Harness({ initial }: { initial: LocalFinancials }) {
  const [d, setD] = useState(initial);
  latest = d;
  return <InputPanel financials={d} dashData={computeDashboard(d)} onChange={(n) => { writes++; setD(n); }} onEdit={vi.fn()} onPay={vi.fn()} />;
}
const CAR: StoredDebt = { id: "d1", name: "Car loan", balance: 6000, openingBalance: 6000, apr: 9, minPayment: 150, currency: "USD", createdAt: "2026-01-01T00:00:00.000Z" };
const DAD: StoredDebt = { id: "d2", name: "Loan from Dad", balance: 200, openingBalance: 200, apr: 0, minPayment: 0, currency: "USD", createdAt: "2026-11-01T00:00:00.000Z" };
const CAR_RECEIPT: StoredTransaction = { id: "r1", amount: 6000, currency: "USD", bucket: "TRANSFER", description: "Borrowed: Car loan", date: "2026-01-01", paymentMethod: "cash", borrowedForDebtId: "d1" };
const start = (o: Partial<LocalFinancials> = {}) => ({ ...DEFAULT_DATA, income: 3000, lbpRate: 89_500, cards: [], debts: [CAR, DAD], transactions: [CAR_RECEIPT], ...o }) as LocalFinancials;
const toggle = (text: string) => fireEvent.click(screen.getAllByRole("button").find((b) => b.getAttribute("aria-pressed") !== null && b.textContent?.includes(text))!);
const amount = (v: string) => fireEvent.change(document.getElementById("tx-amount")!, { target: { value: v } });
const desc = (v: string) => fireEvent.change(document.getElementById("tx-desc")!, { target: { value: v } });
const add = () => fireEvent.click(screen.getByRole("button", { name: /\+ Add entry/ }));
const borrowedFor = () => screen.queryByLabelText("Money borrowed for", { exact: true }) as HTMLSelectElement | null;
function open(initial = start()) { render(<Harness initial={initial} />); writes = 0; }

it("is offered for a Transfer only: Not a loan, each debt not yet received, A new debt", () => {
  open();
  expect(borrowedFor()).toBeNull();
  toggle("Income");
  expect(borrowedFor()).toBeNull();
  toggle("Transfer");
  expect(Array.from(borrowedFor()!.options).map((o) => o.textContent)).toEqual(["Not a loan", "Loan from Dad", "A new debt"]);
  expect(borrowedFor()!.value).toBe("");
});

it("Not a loan writes the entry as today, with no link", () => {
  open();
  toggle("Transfer");
  amount("25");
  desc("Dad for fuel");
  add();
  expect(writes).toBe(1);
  expect(latest.transactions[0]).toMatchObject({ bucket: "TRANSFER", amount: 25, description: "Dad for fuel" });
  expect(latest.transactions[0].borrowedForDebtId).toBeUndefined();
  expect(latest.debts).toEqual([CAR, DAD]);
});

it("a debt picked: the entry is linked to it, and the debt is unchanged", () => {
  open();
  toggle("Transfer");
  amount("200");
  desc("From Dad");
  fireEvent.change(borrowedFor()!, { target: { value: "d2" } });
  add();
  expect(writes).toBe(1);
  expect(latest.transactions[0]).toMatchObject({ bucket: "TRANSFER", amount: 200, borrowedForDebtId: "d2" });
  expect(latest.transactions[0].debtId).toBeUndefined();
  expect(latest.debts).toEqual([CAR, DAD]);
  expect(derivedDebtBalance(DAD, latest.transactions, latest)).toBe(200);
  expect(borrowedFor()!.value).toBe(""); // the form resets
});

it("A new debt: one line says what it adds; the debt and the entry are written in one update", () => {
  open();
  toggle("Transfer");
  amount("1500");
  desc("Loan from Sami");
  fireEvent.change(borrowedFor()!, { target: { value: "new" } });
  expect(screen.getByText("Adds a debt named Loan from Sami of $1,500.00. Set its interest and monthly minimum under Manage → Debts.")).toBeTruthy();
  add();
  expect(writes).toBe(1);
  expect(latest.debts).toHaveLength(3);
  const debt = latest.debts[2];
  expect(debt).toMatchObject({ name: "Loan from Sami", balance: 1500, openingBalance: 1500, currency: "USD", apr: 0, minPayment: 0, openedDate: "2026-11-13" });
  expect(latest.transactions[0]).toMatchObject({ bucket: "TRANSFER", amount: 1500, borrowedForDebtId: debt.id, date: "2026-11-13" });
  expect(derivedDebtBalance(debt, latest.transactions, latest)).toBe(1500);
});

it("A new debt with no description is named Loan; a lira entry makes a lira debt", () => {
  open();
  toggle("Transfer");
  toggle("L£ LBP");
  amount("9000000");
  fireEvent.change(borrowedFor()!, { target: { value: "new" } });
  expect(screen.getByText("Adds a debt named Loan of L£9,000,000. Set its interest and monthly minimum under Manage → Debts.")).toBeTruthy();
  add();
  expect(latest.debts[2]).toMatchObject({ name: "Loan", currency: "LBP", openingBalance: 9_000_000, lbpRateAtEntry: 89_500 });
  expect(latest.transactions[0]).toMatchObject({ currency: "LBP", amount: 9_000_000, borrowedForDebtId: latest.debts[2].id });
});

it("a pick made for a Transfer isn't written if the type changes before saving", () => {
  open();
  toggle("Transfer");
  amount("200");
  fireEvent.change(borrowedFor()!, { target: { value: "new" } });
  toggle("Income");
  add();
  expect(latest.debts).toEqual([CAR, DAD]);
  expect(latest.transactions[0]).toMatchObject({ bucket: "INCOME", amount: 200 });
  expect(latest.transactions[0].borrowedForDebtId).toBeUndefined();
});

it("isn't offered when the entry is split across USD and LBP", () => {
  open();
  toggle("Transfer");
  fireEvent.click(screen.getByRole("button", { name: "Split across USD and LBP?" }));
  expect(borrowedFor()).toBeNull();
});
