// TEST-02 (blind-spot audit; session 24, item 5): what the main entry form
// (My Finances) stores, which no test pinned at the field level: a spend's
// amount, currency, type, category, description, date and payment method; a
// lira entry kept in lira with its rate; an income entry; a draw from the
// safety net at the entry's own day's rate (plan J); and nothing stored for an
// empty amount. They pin today's behaviour; perturbations prove they bite.
import { it, expect, vi, afterEach } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import InputPanel from "./InputPanel";
import { computeDashboard } from "../lib/computeDashboard";
import { DEFAULT_DATA, todayISO, type LocalFinancials } from "../lib/localData";

afterEach(cleanup);

let latest: LocalFinancials;
function Harness({ initial }: { initial: LocalFinancials }) {
  const [d, setD] = useState(initial);
  latest = d;
  return <InputPanel financials={d} dashData={computeDashboard(d)} onChange={setD} onEdit={vi.fn()} onPay={vi.fn()} />;
}
const start = (o: Partial<LocalFinancials> = {}) => ({ ...DEFAULT_DATA, income: 3000, lbpRate: 89_500, cards: [], transactions: [], ...o }) as LocalFinancials;
const toggle = (text: string) => fireEvent.click(screen.getAllByRole("button").find((b) => b.getAttribute("aria-pressed") !== null && b.textContent?.includes(text))!);
const amount = (v: string) => fireEvent.change(document.getElementById("tx-amount")!, { target: { value: v } });
const add = () => fireEvent.click(screen.getByRole("button", { name: /\+ Add entry/ }));

it("a spend is stored as typed: amount, currency, type, category, description, today, the payment method", () => {
  render(<Harness initial={start()} />);
  toggle("Wants");
  amount("46.8");
  fireEvent.change(document.getElementById("tx-category")!, { target: { value: "dining" } });
  fireEvent.change(document.getElementById("tx-desc")!, { target: { value: "Bistro Margaux" } });
  add();
  expect(latest.transactions).toHaveLength(1);
  expect(latest.transactions[0]).toMatchObject({ amount: 46.8, currency: "USD", bucket: "WANTS", category: "dining", description: "Bistro Margaux", date: todayISO() });
  expect(typeof latest.transactions[0].paymentMethod).toBe("string");
  expect(latest.transactions[0].efAmount).toBeUndefined();
});

it("a lira entry stays in lira, with the rate it was entered at", () => {
  render(<Harness initial={start()} />);
  toggle("L£ LBP");
  amount("895000");
  add();
  expect(latest.transactions[0]).toMatchObject({ amount: 895_000, currency: "LBP", lbpRateAtEntry: 89_500 });
});

it("an income entry is income, and its description defaults to the type", () => {
  render(<Harness initial={start()} />);
  toggle("Income");
  amount("3000");
  add();
  expect(latest.transactions[0]).toMatchObject({ amount: 3000, bucket: "INCOME", description: "Income" });
});

it("a draw from the safety net is stored at the entry's own day's rate: L£895,000 is −$10 at today's logged 89,500, not the live 100,000", () => {
  render(<Harness initial={start({ lbpRate: 100_000, emergencyFundOpeningBalance: 500, lbpRateLog: [{ from: todayISO(), value: 89_500 }] })} />);
  toggle("L£ LBP");
  amount("895000");
  fireEvent.click(screen.getByRole("button", { name: /Pay this from Safety net/ }));
  add();
  expect(latest.transactions[0]).toMatchObject({ currency: "LBP", efAmount: -10 });
});

it("an empty or zero amount stores nothing: Add entry stays disabled", () => {
  render(<Harness initial={start()} />);
  const button = () => screen.getByRole("button", { name: /\+ Add entry/ }) as HTMLButtonElement;
  expect(button().disabled).toBe(true);
  add();
  amount("0");
  expect(button().disabled).toBe(true);
  add();
  expect(latest.transactions).toHaveLength(0);
  amount("12");
  expect(button().disabled).toBe(false);
});
