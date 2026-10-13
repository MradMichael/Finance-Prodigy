// ERR-07 (blind-spot audit, session 21): with no income, every budget bar on
// the Overview said "target rolled to $0 this month". That's rollover wording,
// and the Overview's targets don't roll over (2.4.70: income × the rule's
// percentage), so a $0 target there only ever means there's no income. The
// Budget screen already handles that case with its own sentence; the
// Overview's Budget panel now says the same, instead of three $0 bars.
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import FinancialDashboard from "./FinancialDashboard";
import { ThemeProvider } from "../contexts/ThemeContext";
import { computeDashboard } from "../lib/computeDashboard";
import { DEFAULT_DATA, todayISO, type LocalFinancials, type StoredTransaction } from "../lib/localData";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn() }) }));
vi.mock("../lib/auth", () => ({ getSession: () => ({ userId: "u1", email: "u1@example.test", name: "U One" }), getRecoveryTokenForSync: vi.fn(async () => null) }));

beforeEach(() => { localStorage.clear(); vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ exists: true }), { status: 200 }))); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const BUDGET_SENTENCE = "Set your monthly income in Setup to see how your spending compares to this budget.";
const show = (data: LocalFinancials) => render(<ThemeProvider><FinancialDashboard data={computeDashboard(data)} financials={data} /></ThemeProvider>);
const sentence = () => screen.queryByText((_, el) => el?.tagName === "P" && el.textContent === BUDGET_SENTENCE);
const spent = (amount: number) => ({ id: "t1", amount, currency: "USD", bucket: "WANTS", category: "dining", description: "Coffee", date: todayISO() }) as StoredTransaction;

it("with no income, the Budget panel says what the Budget screen says, and no bar claims a rollover", () => {
  show({ ...DEFAULT_DATA, income: 0 } as LocalFinancials);
  expect(sentence()).not.toBeNull();
  expect(screen.queryByText(/target rolled to/)).toBeNull();
});

it("the same with spending logged but still no income", () => {
  show({ ...DEFAULT_DATA, income: 0, transactions: [spent(12)] } as LocalFinancials);
  expect(sentence()).not.toBeNull();
  expect(screen.queryByText(/target rolled to/)).toBeNull();
});

it("with income set, the three bars are as before", () => {
  show({ ...DEFAULT_DATA, income: 3000 } as LocalFinancials);
  expect(sentence()).toBeNull();
  for (const bucket of ["Needs", "Wants", "Savings"]) expect(screen.getByText(new RegExp(`^${bucket} · \\d+%$`))).toBeTruthy();
});

it("with no salary but income logged this month, the bars show: their targets are that income's shares", () => {
  const paid = { ...spent(500), id: "t2", bucket: "INCOME", category: "salary", description: "Freelance" } as StoredTransaction;
  show({ ...DEFAULT_DATA, income: 0, transactions: [paid] } as LocalFinancials);
  expect(sentence()).toBeNull();
  expect(screen.getByText(/^Needs · \d+%$/)).toBeTruthy();
});
