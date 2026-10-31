// T3 (owner, session 33, DECISIONS_PENDING 15 (a); wording approved, headline replaced by the owner), T7 and
// U12 (wording approved):
// - the Overview's Spent card counts Needs and Wants, "{pct}% of income, before saving";
// - when spending stayed within income and saving tipped it over, the headline says so;
// - one goal word, "behind pace", on the Overview and the Goals screen;
// - Balance Check's example name, "Cash, salary card…".
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import FinancialDashboard from "./FinancialDashboard";
import GoalsScreen from "./screens/GoalsScreen";
import BalanceCheckScreen from "./screens/BalanceCheckScreen";
import { computeDashboard } from "../lib/computeDashboard";
import { DEFAULT_DATA, type LocalFinancials, type StoredTransaction, type StoredGoal } from "../lib/localData";

vi.mock("next/navigation", () => ({ useRouter: () => ROUTER }));
const ROUTER = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn() };

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-28T12:00:00")); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

const tx = (id: string, bucket: StoredTransaction["bucket"], amount: number, date = "2026-10-26"): StoredTransaction => ({ id, amount, currency: "USD", bucket, description: id, date, paymentMethod: "cash" });
const month = (needs: number, wants: number, savings: number, over: Partial<LocalFinancials> = {}) =>
  ({ ...DEFAULT_DATA, userName: "Quartz Nine", income: 3000, budgetRule: "50-30-20", transactions: [tx("n", "NEEDS", needs), tx("w", "WANTS", wants), ...(savings ? [tx("s", "SAVINGS", savings)] : [])], ...over }) as LocalFinancials;
const dash = (d: LocalFinancials) => render(<FinancialDashboard data={computeDashboard(d)} financials={d} />);
const h1 = () => document.querySelector("h1")!.textContent!.replace(/\s+/g, " ");

describe("T3: the Spent card counts spending, not saving", () => {
  it("Needs plus Wants, with the share of income before saving", () => {
    dash(month(2000, 800, 400));
    const card = screen.getByText("Spent").parentElement!;
    expect(card.textContent).toContain("$2,800");
    expect(card.textContent).toContain("93% of income, before saving");
  });
});

describe("T3: the headline", () => {
  it("spending within income, saving tipping it over: the owner's sentence (a calendar month)", () => {
    dash(month(2000, 800, 400));
    expect(h1()).toBe("You spent within your income this month, Quartz, but saving $400 took $200 more than was left.");
  });

  it("on a payday cycle it says cycle", () => {
    dash(month(2000, 800, 400, { cycleStartDay: 25 }));
    expect(h1()).toBe("You spent within your income this cycle, Quartz, but saving $400 took $200 more than was left.");
  });

  it("spending itself over income: the exceeded sentence, by spending alone", () => {
    dash(month(2600, 700, 100));
    expect(h1()).toBe("Spending exceeded income by $300 this month, Quartz. The plan below shows the path.");
  });

  it("money left over: unchanged", () => {
    dash(month(1000, 500, 200));
    expect(h1()).toBe("You've kept $1,300 so far this month, Quartz. Every dollar counts.");
  });

  it("at the savings target: unchanged", () => {
    dash(month(1500, 600, 700));
    expect(h1()).toBe("Quartz, you saved $700, at or above your 20% target.");
  });
});

describe("T7: one word for a goal behind its pace", () => {
  const behind: StoredGoal = { id: "g", name: "New car", emoji: "🚗", targetAmount: 8000, currentAmount: 100, openingAmount: 100, currency: "USD", targetDate: "2027-03-01", createdAt: "2025-11-01T08:00:00.000Z" };
  it("the Overview", () => {
    dash(month(1000, 500, 200, { goals: [behind] }));
    expect(screen.getByText("behind pace")).toBeTruthy();
    expect(screen.queryByText("needs a push")).toBeNull();
  });
  it("the Goals screen", () => {
    const d = month(1000, 500, 200, { goals: [behind] });
    render(<GoalsScreen dashData={computeDashboard(d)} financials={d} onChange={vi.fn()} onEdit={vi.fn()} />);
    expect(screen.getByText("behind pace")).toBeTruthy();
    expect(screen.queryByText("needs push")).toBeNull();
  });
});

describe("U12: Balance Check's example name", () => {
  it("reads 'Cash, salary card…'", () => {
    const d = month(1000, 500, 0);
    render(<BalanceCheckScreen financials={d} dashData={computeDashboard(d)} onChange={vi.fn()} />);
    expect((document.getElementById("new-tb-name") as HTMLInputElement).placeholder).toBe("Cash, salary card…");
  });
});
