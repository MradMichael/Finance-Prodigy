// Session 19, item 2 (owner's condition): every Wants total in the app agrees,
// for a month with an exchange and a change-back. One shared rule
// (lib/spending.ts) counts spending everywhere; a change-back nets against
// Wants in its own month, and an ordinary reimbursement stays out.
// The month: a $500 exchange (Wants, Travel), $40 lunch (Wants), $30 rent
// (Needs), EUR 100 changed back for $105, and an ordinary $20 reimbursement.
// Wants = 500 + 40 - 105 = 435; all spending = 465; income stays $3,000.
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ThemeProvider } from "../contexts/ThemeContext";
import FinancialDashboard from "./FinancialDashboard";
import InputPanel from "./InputPanel";
import BudgetScreen from "./screens/BudgetScreen";
import TransactionsScreen from "./screens/TransactionsScreen";
import CategoriesScreen from "./screens/CategoriesScreen";
import CurrencyScreen from "./screens/CurrencyScreen";
import JourneyScreen from "./screens/JourneyScreen";
import { computeDashboard, periodTotals } from "../lib/computeDashboard";
import { buildReportHtml } from "../lib/printReport";
import { DEFAULT_DATA, todayISO, cycleStartDayOf, type LocalFinancials, type StoredTransaction } from "../lib/localData";
import { currentCycleKey } from "../lib/period";
import { buildExchange, buildChangeBack } from "../lib/foreignCash";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }) }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const day = todayISO();
const CASH = { paymentMethod: "cash" as const };
const plain = (id: string, amount: number, extra: Partial<StoredTransaction>) =>
  ({ id, amount, currency: "USD", bucket: "WANTS", description: id, date: day, paymentMethod: "cash", ...extra }) as StoredTransaction;
const D = {
  ...DEFAULT_DATA, income: 3000, lbpRate: 89_500,
  transactions: [
    buildExchange({ date: day, paid: 500, paidCurrency: "USD", from: CASH, code: "EUR", received: 460, description: "Exchange to EUR" }, 89_500),
    plain("Lunch", 40, { category: "dining" }),
    plain("Rent", 30, { bucket: "NEEDS" }),
    buildChangeBack({ date: day, code: "EUR", given: 100, received: 105, receivedCurrency: "USD", to: CASH, description: "Changed back from EUR" }, 89_500),
    plain("Ana paid me back", 20, { bucket: "TRANSFER", category: "dining" }),
  ],
} as LocalFinancials;
const dash = () => computeDashboard(D);

it("the library's totals: the period, the month, budget pace and the trend", () => {
  const ym = currentCycleKey(new Date(), cycleStartDayOf(D));
  expect(periodTotals(D, ym, new Date())).toMatchObject({ wants: 435, needs: 30, income: 3000 });
  expect(dash().month).toMatchObject({ wantsSpend: 435, needsSpend: 30, totalSpend: 465, income: 3000 });
  expect(dash().budgetPace.find((b) => b.bucket === "WANTS")!.pctOfBudgetUsed).toBeCloseTo((435 / 900) * 100, 0);
  expect(dash().sixMonthTrend.at(-1)!.spend).toBe(465);
});

// A change-back nets in its own month, past months included: last month's $500
// exchange and $105 change-back roll over into this month exactly as $395 of
// Wants would, and last month's trend bar is $395.
it("a past month: the change-back nets in that month, in the rollover and the trend", () => {
  const n = new Date();
  const last = new Date(n.getFullYear(), n.getMonth() - 1, 15);
  const lastDay = `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, "0")}-15`;
  const withBack = { ...DEFAULT_DATA, income: 3000, lbpRate: 89_500, transactions: [
    buildExchange({ date: lastDay, paid: 500, paidCurrency: "USD", from: CASH, code: "EUR", received: 460, description: "Exchange to EUR" }, 89_500),
    buildChangeBack({ date: lastDay, code: "EUR", given: 100, received: 105, receivedCurrency: "USD", to: CASH, description: "Changed back from EUR" }, 89_500),
  ] } as LocalFinancials;
  const asWants = { ...DEFAULT_DATA, income: 3000, lbpRate: 89_500, transactions: [plain("Trip", 395, { date: lastDay, category: "travel" })] } as LocalFinancials;
  expect(computeDashboard(withBack).budgetRollover).toEqual(computeDashboard(asWants).budgetRollover);
  expect(computeDashboard(withBack).sixMonthTrend.at(-2)!.spend).toBe(395);
});

it("the overview's Wants row", () => {
  render(<ThemeProvider><FinancialDashboard data={dash()} financials={D} onNavigate={vi.fn()} /></ThemeProvider>);
  expect(screen.getByText(/^Wants · /).parentElement!.textContent).toContain("$435");
});

it("the Budget screen: Wants against an unchanged target", () => {
  render(<ThemeProvider><BudgetScreen financials={D} dashData={dash()} onChange={vi.fn()} /></ThemeProvider>);
  expect(screen.getByText("This month vs target").parentElement!.textContent).toContain("Wantstarget 30% · $900$435");
});

it("My Finances' month: Wants, and the month's total", () => {
  render(<InputPanel financials={D} dashData={dash()} onChange={vi.fn()} onEdit={vi.fn()} onPay={vi.fn()} />);
  const wants = screen.getAllByText("Wants").find((el) => el.previousElementSibling?.textContent?.startsWith("$"))!;
  expect(wants.previousElementSibling!.textContent).toBe("$435");
});

it("the Transactions screen: the Wants card, and the month's total", () => {
  render(<TransactionsScreen financials={D} onChange={vi.fn()} onEdit={vi.fn()} />);
  const card = screen.getAllByText("Wants").find((el) => el.tagName === "P")!;
  expect(card.nextElementSibling!.textContent).toContain("435");
  // The month's header total: the line above the month's list of rows.
  const header = screen.getByText("Lunch").closest(".rounded-2xl")!.previousElementSibling!;
  expect(header.lastElementChild!.textContent).toContain("465");
});

it("Categories: Travel nets the change-back; the ordinary reimbursement counts nowhere; the whole is all spending", () => {
  render(<ThemeProvider><CategoriesScreen financials={D} onChange={vi.fn()} /></ThemeProvider>);
  const text = document.body.textContent ?? "";
  expect(text).toContain("$395"); // Travel: 500 - 105
  expect(text).toContain("$465"); // the donut's whole
  expect(text).not.toContain("$60"); // dining stays $40: the $20 reimbursement isn't spending
});

it("the currency screen's month of spending", () => {
  render(<ThemeProvider><CurrencyScreen financials={D} onChange={vi.fn()} /></ThemeProvider>);
  expect(screen.getByText("this month").previousElementSibling?.textContent ?? screen.getByText("this month").parentElement!.textContent).toContain("$465");
});

it("Journey's month mix", () => {
  render(<ThemeProvider><JourneyScreen financials={D} dashData={dash()} onNavigate={vi.fn()} /></ThemeProvider>);
  expect(screen.getByText(/^Wants ·/).textContent).toContain("$435");
});

it("the PDF report's ledger total", () => {
  expect(buildReportHtml("Quartz", D, dash(), { detailed: true })).toContain("&middot; $465</h2>");
});
