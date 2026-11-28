// Session 68's plan, step D (owner approved, session 69): on the Monthly report screen, Money in reads by category
// ("Extra income" for none), and "Paid back and borrowed" comes right after it, with "Not counted in Money in." under
// its heading and no total; shown only when it has lines.
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import MonthlyReportScreen from "./MonthlyReportScreen";
import { ThemeProvider } from "../../contexts/ThemeContext";
import { DEFAULT_DATA, type LocalFinancials, type StoredDebt, type StoredTransaction } from "../../lib/localData";

let n = 0;
const tx = (o: Partial<StoredTransaction>): StoredTransaction =>
  ({ id: `p${n++}`, amount: 10, currency: "USD", bucket: "INCOME", description: "x", date: "2026-10-03", paymentMethod: "cash", createdAt: "2026-10-03T10:00:00.000Z", ...o }) as StoredTransaction;
const DAD: StoredDebt = { id: "d1", name: "Loan from Dad", balance: 200, openingBalance: 200, apr: 0, minPayment: 0, currency: "USD", createdAt: "2026-10-01T00:00:00.000Z" };
const DATA = {
  ...DEFAULT_DATA, income: 1500, debts: [DAD],
  transactions: [
    tx({ description: "DAD for Fuel", amount: 25, category: "transport" }),
    tx({ description: "DAD fuel", amount: 30, category: "transport" }),
    tx({ description: "Bonus", amount: 200 }),
    tx({ bucket: "TRANSFER", description: "Insurance payout", amount: 120, category: "insurance" }),
    tx({ bucket: "TRANSFER", description: "Borrowed: Loan from Dad", amount: 200, borrowedForDebtId: "d1" }),
    tx({ bucket: "WANTS", description: "Dinner", amount: 40, category: "dining" }),
  ],
} as LocalFinancials;

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-20T12:00:00")); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

const show = (data: LocalFinancials = DATA) => render(<ThemeProvider><MonthlyReportScreen financials={data} /></ThemeProvider>);
const section = (name: string) => screen.getByRole("heading", { level: 2, name }).closest("section")!;
const lines = (s: HTMLElement) => within(s).getAllByRole("listitem").map((li) => li.textContent);

it("Money in by category, one line for DAD for Fuel and DAD fuel", () => {
  show();
  expect(lines(section("Money in"))).toEqual(["Income$1,500.00", "Extra income$200.00", "Transport$55.00"]);
});

it("Paid back and borrowed comes right after Money in, with its note and no total", () => {
  show();
  const s = section("Paid back and borrowed");
  expect(section("Money in").nextElementSibling).toBe(s);
  expect(within(s).getByText("Not counted in Money in.")).toBeTruthy();
  expect(lines(s)).toEqual(["Borrowed: Loan from Dad$200.00", "Paid back: Insurance$120.00"]);
  expect(s.querySelector("h2")!.parentElement!.textContent).toBe("Paid back and borrowed");
});

it("isn't shown when the period has none", () => {
  show({ ...DATA, transactions: DATA.transactions.filter((t) => t.bucket !== "TRANSFER") });
  expect(screen.queryByRole("heading", { level: 2, name: "Paid back and borrowed" })).toBeNull();
  expect(screen.queryByText("Not counted in Money in.")).toBeNull();
});
