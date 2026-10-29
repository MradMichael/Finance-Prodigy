// DI-01 (owner, session 30, DECISIONS_PENDING entry 3 (a)): every screen
// that says "paid off" reads the balance, not a stored flag. Each fixture
// carries the flag the old code wrote (paidOffAt), the way a debt looked
// before: the Visa was paid with the pay button (stamped), then corrected to
// $200 for a late fee; the lira loan was corrected to 0 in Edit Debt (never
// stamped). The screens must follow the balance, whatever the flag says.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, fireEvent } from "@testing-library/react";
import DebtsScreen from "./DebtsScreen";
import JourneyScreen from "./JourneyScreen";
import InputPanel from "../InputPanel";
import PayDebtSheet from "../PayDebtSheet";
import { ThemeProvider } from "../../contexts/ThemeContext";
import { computeDashboard } from "../../lib/computeDashboard";
import { buildReportHtml } from "../../lib/printReport";
import { DEFAULT_DATA, type LocalFinancials, type StoredDebt, type StoredTransaction } from "../../lib/localData";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 9, 14, 12, 0)); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

const VISA = { id: "d-visa", name: "Visa", openingBalance: 1200, balance: 1200, apr: 24, minPayment: 50, currency: "USD", createdAt: "2026-01-01T00:00:00.000Z", paidOffAt: "2026-09-29T09:00:00.000Z" } as StoredDebt;
const LOAN = { id: "d-loan", name: "Family loan", openingBalance: 8_950_000, balance: 8_950_000, apr: 0, minPayment: 895_000, currency: "LBP", createdAt: "2026-01-01T00:00:00.000Z" } as StoredDebt;
const pay = (debt: StoredDebt, amount: number, date: string): StoredTransaction =>
  ({ id: `p-${debt.id}-${date}`, amount, currency: debt.currency, bucket: "NEEDS", description: `${debt.name} payment`, date, debtId: debt.id, createdAt: "2026-09-29T09:00:00.000Z" }) as StoredTransaction;
const correct = (debt: StoredDebt, delta: number, date: string): StoredTransaction =>
  ({ id: `c-${debt.id}-${date}`, amount: 0, debtAdjustment: delta, currency: debt.currency, bucket: "SAVINGS", description: `Debt correction: ${debt.name}`, date, paymentMethod: "other", debtId: debt.id, createdAt: `${date}T10:00:00.000Z` }) as StoredTransaction;
const VISA_TX = [pay(VISA, 1200, "2026-09-29"), correct(VISA, -200, "2026-10-02")]; // owed $200 again
const LOAN_TX = [correct(LOAN, 8_950_000, "2026-10-05")];                          // corrected to 0
const data = (debts: StoredDebt[], transactions: StoredTransaction[]) =>
  ({ ...DEFAULT_DATA, income: 3000, lbpRate: 89_500, debts, transactions }) as LocalFinancials;

describe("the Debts screen", () => {
  const show = (d: LocalFinancials) => render(<ThemeProvider><DebtsScreen financials={d} dashData={computeDashboard(d)} onEdit={() => {}} onPay={() => {}} /></ThemeProvider>);
  const row = (name: string) => screen.getByText(name).closest("div.rounded-2xl") as HTMLElement;

  it("the Visa owed again: no \"Paid off\", no paid date, the pay button back", () => {
    show(data([VISA], VISA_TX));
    expect(within(row("Visa")).queryByText("Paid off")).toBeNull();
    expect(within(row("Visa")).queryByText(/^Paid \d/)).toBeNull();
    expect(within(row("Visa")).getByRole("button", { name: "Record a payment" })).toBeTruthy();
  });

  it("the lira loan corrected to 0: \"Paid off\", \"Paid 05/10/2026\", no pay button", () => {
    show(data([LOAN], LOAN_TX));
    expect(within(row("Family loan")).getByText("Paid off")).toBeTruthy();
    expect(within(row("Family loan")).getByText("Paid 05/10/2026")).toBeTruthy();
    expect(within(row("Family loan")).queryByRole("button", { name: "Record a payment" })).toBeNull();
  });
});

describe("the entry panel's Debts list", () => {
  const show = (d: LocalFinancials) => {
    render(<ThemeProvider><InputPanel financials={d} dashData={computeDashboard(d)} onChange={vi.fn()} onEdit={vi.fn()} onPay={vi.fn()} /></ThemeProvider>);
    fireEvent.click(screen.getByText("Manage", { exact: true }).closest("button") as HTMLElement); // the Debts list is on this tab
  };
  const badge = () => {
    const header = screen.getByText("Debts", { selector: "span" }).closest("button") as HTMLElement;
    return header.querySelector("span.rounded-full")?.textContent ?? null;
  };

  it("the Visa owed again counts in the badge", () => {
    show(data([VISA], VISA_TX));
    expect(badge()).toBe("1");
  });

  it("the lira loan at 0 doesn't", () => {
    show(data([LOAN], LOAN_TX));
    expect(badge()).toBeNull();
  });

  it("their rows: the Visa with its pay button and no tag; the loan tagged, dated, no pay button", () => {
    show(data([VISA, LOAN], [...VISA_TX, ...LOAN_TX]));
    fireEvent.click(screen.getByText("Debts", { selector: "span" }).closest("button") as HTMLElement);
    const visa = screen.getByText("Visa").closest("div.rounded-xl") as HTMLElement;
    const loan = screen.getByText("Family loan").closest("div.rounded-xl") as HTMLElement;
    expect(within(visa).queryByText("Paid off")).toBeNull();
    expect(within(visa).getByRole("button", { name: "Record a payment" })).toBeTruthy();
    expect(within(loan).getByText("Paid off")).toBeTruthy();
    expect(within(loan).getByText(/Paid 05\/10\/2026/)).toBeTruthy();
    expect(within(loan).queryByRole("button", { name: "Record a payment" })).toBeNull();
  });
});

describe("Journey's milestones", () => {
  const show = (d: LocalFinancials) => render(<ThemeProvider><JourneyScreen financials={d} dashData={computeDashboard(d)} onNavigate={vi.fn()} /></ThemeProvider>);

  it("the loan at 0 is one debt paid off", () => {
    show(data([LOAN], LOAN_TX));
    expect(screen.getByText("debt paid off").previousElementSibling?.textContent).toBe("1");
  });

  it("the Visa owed again isn't", () => {
    show(data([VISA], VISA_TX));
    expect(screen.queryByText(/paid off/)).toBeNull();
  });
});

describe("the report", () => {
  const html = (d: LocalFinancials) => buildReportHtml("Quartz Runner", d, computeDashboard(d));

  it("tags the loan at 0 \"paid off\", not the Visa owed again", () => {
    const h = html(data([VISA, LOAN], [...VISA_TX, ...LOAN_TX]));
    expect(h).toContain('Family loan <span class="tag">paid off</span>');
    expect(h).not.toContain('Visa <span class="tag">paid off</span>');
  });
});

describe("a payment adds its transaction and leaves the debt record alone", () => {
  it("paying a debt off writes no stamp on it", () => {
    const debt = { ...LOAN, id: "d-small", name: "Small", openingBalance: 50, balance: 50, currency: "USD", minPayment: 10 } as StoredDebt;
    const d = data([debt], []);
    let out: LocalFinancials = d;
    render(<ThemeProvider><PayDebtSheet debt={debt} financials={d} onChange={(u) => { out = u; }} onClose={vi.fn()} /></ThemeProvider>);
    fireEvent.change(document.getElementById("pay-debt-amount")!, { target: { value: "50" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(out.debts[0]).toEqual(debt);
    expect(out.transactions).toHaveLength(1);
  });
});
