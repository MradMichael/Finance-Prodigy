// TEST-02 (blind-spot audit, session 21): the Debts screen converts and sums
// every debt's balance and minimum payment itself, and no test ran it. These
// pin its figures: the totals are each open debt's DERIVED balance (opening
// minus linked payments) in dollars, a lira debt at the live rate; a debt
// paid down to zero leaves both totals; each card shows its own figures in its
// own currency. (The "Paid off" badge reads a stored flag, DI-01, which waits
// on your Q13: deliberately not pinned here.)
import { it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import DebtsScreen from "./DebtsScreen";
import { ThemeProvider } from "../../contexts/ThemeContext";
import { computeDashboard } from "../../lib/computeDashboard";
import { DEFAULT_DATA, type LocalFinancials, type StoredDebt, type StoredTransaction } from "../../lib/localData";

afterEach(cleanup);

const CARD = { id: "d-usd", name: "Visa", openingBalance: 1200, balance: 1200, apr: 24, minPayment: 50, currency: "USD", createdAt: "2026-01-01T00:00:00.000Z" } as StoredDebt;
const LOAN = { id: "d-lbp", name: "Family loan", openingBalance: 8_950_000, balance: 8_950_000, apr: 0, minPayment: 895_000, currency: "LBP", createdAt: "2026-01-01T00:00:00.000Z" } as StoredDebt;
const paid = (debt: StoredDebt, amount: number, id: string) =>
  ({ id, amount, currency: debt.currency, bucket: "NEEDS", description: `${debt.name} payment`, date: "2026-10-01", debtId: debt.id }) as StoredTransaction;
const show = (debts: StoredDebt[], transactions: StoredTransaction[]) => {
  const data = { ...DEFAULT_DATA, income: 3000, lbpRate: 89_500, debts, transactions } as LocalFinancials;
  render(<ThemeProvider><DebtsScreen financials={data} dashData={computeDashboard(data)} onEdit={() => {}} onPay={() => {}} /></ThemeProvider>);
};
const figure = (label: string) => screen.getByText(label).nextElementSibling?.textContent;

it("the totals are each open debt's derived balance and minimum, in dollars: $1,000 + L£8,950,000 at 89,500 is $1,100; $50 + L£895,000 is $60", () => {
  show([CARD, LOAN], [paid(CARD, 200, "t1")]);
  expect(figure("Total balance")).toBe("$1,100");
  expect(figure("Min. payments / mo")).toBe("$60");
});

it("a debt paid down to zero leaves both totals", () => {
  show([CARD, LOAN], [paid(CARD, 1200, "t1")]);
  expect(figure("Total balance")).toBe("$100");
  expect(figure("Min. payments / mo")).toBe("$10");
});

it("each debt shows its own balance, minimum and monthly interest in its own currency", () => {
  show([CARD, LOAN], [paid(CARD, 200, "t1")]);
  const visa = screen.getByText("Visa").closest("div.rounded-2xl") as HTMLElement;
  expect(within(visa).getByText("$1,000.00")).toBeTruthy();
  expect(within(visa).getByText("$50.00/mo")).toBeTruthy();
  expect(within(visa).getByText("$20.00")).toBeTruthy(); // 24% / 12 of $1,000
  const loan = screen.getByText("Family loan").closest("div.rounded-2xl") as HTMLElement;
  expect(within(loan).getByText("L£8,950,000")).toBeTruthy();
  expect(within(loan).getByText("L£895,000/mo")).toBeTruthy();
});

it("with every debt paid down to zero, the screen says so", () => {
  show([CARD], [paid(CARD, 1200, "t1")]);
  expect(screen.getByText("Debt-free. 🏁")).toBeTruthy();
  expect(screen.queryByText("Total balance")).toBeNull();
});
