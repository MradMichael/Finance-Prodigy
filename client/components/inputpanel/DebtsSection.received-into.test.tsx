// Session 68's plan, step B (owner approved, session 69): "Money received into (optional)" on My Finances' New debt
// form. "Not recorded" (the default) writes exactly what the form writes today. Cash or a saved card writes the debt
// and the money received (a gained Transfer, "Borrowed: {name}", linked by borrowedForDebtId) in ONE update, after the
// lira check on a lira balance. Deleting a debt whose money was received keeps that entry, and the confirm says so.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useState } from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import InputPanel from "../InputPanel";
import { computeDashboard } from "../../lib/computeDashboard";
import { DEFAULT_DATA, derivedDebtBalance, type LocalFinancials, type StoredDebt, type StoredTransaction } from "../../lib/localData";

beforeEach(() => { vi.useFakeTimers({ now: new Date(2026, 10, 13, 12, 0), toFake: ["Date"] }); }); // 13 November 2026
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

let latest: LocalFinancials;
let writes = 0;
function Harness({ initial }: { initial: LocalFinancials }) {
  const [d, setD] = useState(initial);
  latest = d;
  return <InputPanel financials={d} dashData={computeDashboard(d)} onChange={(n) => { writes++; setD(n); }} onEdit={vi.fn()} onPay={vi.fn()} />;
}
const OLD: StoredTransaction = { id: "t0", amount: 12, currency: "USD", bucket: "WANTS", description: "Coffee", date: "2026-11-02", paymentMethod: "cash" };
const base = (o: Partial<LocalFinancials> = {}) => ({ ...DEFAULT_DATA, income: 3000, lbpRate: 89_500, cards: [{ id: "c1", type: "Visa", last4: "4821", label: "Visa •••• 4821" }], transactions: [OLD], ...o }) as LocalFinancials;
const type = (id: string, v: string) => fireEvent.change(document.getElementById(id)!, { target: { value: v } });
const setDate = (id: string, iso: string) => fireEvent.change(document.getElementById(id)!.parentElement!.querySelector('input[type="date"]')!, { target: { value: iso } });
const received = () => screen.getByLabelText("Money received into (optional)", { exact: true }) as HTMLSelectElement;
function debtsForm(initial = base()) {
  render(<Harness initial={initial} />);
  fireEvent.click(screen.getByRole("button", { name: /Manage/ }));
  fireEvent.click(screen.getByRole("button", { name: /Debts/ }));
  writes = 0;
}
function fill(name = "Loan from Dad", balance = "5,000") { type("new-debt-name", name); type("new-debt-balance", balance); }
const add = () => fireEvent.click(screen.getByRole("button", { name: "+ Add debt" }));

describe("the select", () => {
  it("offers Not recorded (the default), Cash and each saved card", () => {
    debtsForm();
    expect(Array.from(received().options).map((o) => o.textContent)).toEqual(["Not recorded", "Cash", "Visa •••• 4821"]);
    expect(received().value).toBe("");
  });

  it("with a pool and a balance, one line says what it adds, where and when; none without a pool", () => {
    debtsForm();
    fill();
    expect(screen.queryByText(/Not counted as income\./)).toBeNull();
    fireEvent.change(received(), { target: { value: "cash" } });
    expect(screen.getByText("Adds $5,000.00 to Cash on 13/11/2026. Not counted as income.")).toBeTruthy();
    setDate("new-debt-opened", "2026-10-02");
    expect(screen.getByText("Adds $5,000.00 to Cash on 02/10/2026. Not counted as income.")).toBeTruthy();
    setDate("new-debt-opened", "2026-12-01"); // in the future: today
    expect(screen.getByText("Adds $5,000.00 to Cash on 13/11/2026. Not counted as income.")).toBeTruthy();
    fireEvent.change(received(), { target: { value: "card:c1" } });
    expect(screen.getByText("Adds $5,000.00 to Visa •••• 4821 on 13/11/2026. Not counted as income.")).toBeTruthy();
    type("new-debt-balance", "");
    expect(screen.queryByText(/Not counted as income\./)).toBeNull();
  });
});

describe("+ Add debt", () => {
  it("Not recorded writes the debt only, as today", () => {
    debtsForm();
    fill();
    add();
    expect(writes).toBe(1);
    expect(latest.debts).toHaveLength(1);
    expect(latest.debts[0]).toMatchObject({ name: "Loan from Dad", balance: 5000, openingBalance: 5000, currency: "USD" });
    expect(latest.transactions).toEqual([OLD]);
  });

  it("Cash writes the debt and the money received in one update; the debt's balance stays its full amount", () => {
    debtsForm();
    fill();
    setDate("new-debt-opened", "2026-10-02");
    fireEvent.change(received(), { target: { value: "cash" } });
    add();
    expect(writes).toBe(1);
    const debt = latest.debts[0] as StoredDebt;
    expect(latest.transactions).toHaveLength(2);
    const r = latest.transactions[0];
    expect(r).toMatchObject({ bucket: "TRANSFER", amount: 5000, currency: "USD", paymentMethod: "cash", date: "2026-10-02", description: "Borrowed: Loan from Dad", borrowedForDebtId: debt.id });
    expect(r.debtId).toBeUndefined();
    expect(latest.transactions[1]).toEqual(OLD);
    expect(derivedDebtBalance(debt, latest.transactions, latest)).toBe(5000);
    expect(received().value).toBe(""); // the form resets
  });

  it("a card writes the receipt on that card", () => {
    debtsForm();
    fill();
    fireEvent.change(received(), { target: { value: "card:c1" } });
    add();
    expect(writes).toBe(1);
    expect(latest.transactions[0]).toMatchObject({ paymentMethod: "card", cardId: "c1", cardLabel: "Visa •••• 4821", date: "2026-11-13", borrowedForDebtId: latest.debts[0].id });
  });

  it("a low lira balance with a pool asks first: fixing writes nothing; saving writes both", () => {
    debtsForm();
    fill("Family loan", "300");
    fireEvent.click(screen.getByRole("button", { name: "L£ LBP" }));
    fireEvent.change(received(), { target: { value: "cash" } });
    add();
    expect(screen.getByRole("dialog", { name: "Confirm low LBP amount" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Let me fix the currency" }));
    expect(writes).toBe(0);
    add();
    fireEvent.click(screen.getByRole("button", { name: "No, save it as 300 LBP" }));
    expect(writes).toBe(1);
    expect(latest.debts[0]).toMatchObject({ currency: "LBP", openingBalance: 300 });
    expect(latest.transactions[0]).toMatchObject({ currency: "LBP", amount: 300, borrowedForDebtId: latest.debts[0].id });
  });

  it("a low lira balance with Not recorded doesn't ask (as today)", () => {
    debtsForm();
    fill("Family loan", "300");
    fireEvent.click(screen.getByRole("button", { name: "L£ LBP" }));
    add();
    expect(screen.queryByRole("dialog", { name: "Confirm low LBP amount" })).toBeNull();
    expect(writes).toBe(1);
  });
});

describe("deleting a debt", () => {
  const DEBT: StoredDebt = { id: "d1", name: "Loan from Dad", balance: 5000, openingBalance: 5000, apr: 0, minPayment: 0, currency: "USD", createdAt: "2026-10-02T10:00:00.000Z" };
  const RECEIPT: StoredTransaction = { id: "r1", amount: 5000, currency: "USD", bucket: "TRANSFER", description: "Borrowed: Loan from Dad", date: "2026-10-02", paymentMethod: "cash", borrowedForDebtId: "d1" };

  it("whose money was received: the confirm says the entry stays, and it does", () => {
    debtsForm(base({ debts: [DEBT], transactions: [RECEIPT, OLD] }));
    const ask = vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Delete debt" }));
    expect(ask).toHaveBeenCalledWith("Delete this debt? The money you received for it stays in your entries.");
    expect(latest.debts).toHaveLength(0);
    expect(latest.transactions).toEqual([RECEIPT, OLD]);
  });

  it("with no money received (or its entry deleted): the confirm is today's", () => {
    debtsForm(base({ debts: [DEBT], transactions: [{ ...RECEIPT, deletedAt: "2026-11-01T00:00:00.000Z" }, OLD] }));
    const ask = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: "Delete debt" }));
    expect(ask).toHaveBeenCalledWith("Delete this debt?");
    expect(latest.debts).toHaveLength(1);
  });
});
