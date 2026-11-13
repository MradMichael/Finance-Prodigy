// SESSION 47 PLANS item 5 (FIX_PLANS.md; owner, session 47, LB1 question 2): a goal contribution dated in the
// future counts, in "saved" and in achievement, as soon as it's entered. Nothing said so: a year typed wrong
// (2027 for 2026) silently filled the goal. One line under the date in the three goal-contribution forms, while
// the date is after today (the device's local day, todayISO): it doesn't block the save and stores nothing.
// Its wording is a DRAFT, held for the owner's approval.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useState } from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import GoalsScreen from "./screens/GoalsScreen";
import InputPanel from "./InputPanel";
import EditTransactionSheet from "./EditTransactionSheet";
import { ThemeProvider } from "../contexts/ThemeContext";
import { computeDashboard } from "../lib/computeDashboard";
import { DEFAULT_DATA, type LocalFinancials, type StoredGoal, type StoredTransaction } from "../lib/localData";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn() }) }));
beforeEach(() => { vi.useFakeTimers({ now: new Date(2026, 10, 9, 12, 0), toFake: ["Date"] }); }); // 9 November 2026, local
afterEach(() => { cleanup(); vi.useRealTimers(); });

const NOTE = "That date is in the future. It counts toward this goal now.";
const GOAL: StoredGoal = { id: "g1", name: "Laptop", emoji: "L", targetAmount: 1200, currentAmount: 0, openingAmount: 0, currency: "USD", targetDate: "2027-03-01", createdAt: "2026-05-01T09:00:00.000Z" };
const base = (o: Partial<LocalFinancials> = {}) => ({ ...DEFAULT_DATA, income: 3000, goals: [GOAL], transactions: [], ...o }) as LocalFinancials;
/** DateFieldDMY's own calendar input, which takes a whole YYYY-MM-DD. */
const setDate = (id: string, iso: string) => fireEvent.change(document.getElementById(id)!.parentElement!.querySelector('input[type="date"]')!, { target: { value: iso } });
const note = () => screen.queryByText(NOTE);
/** Goals keys its form by the dashboard goal (1, 2, ...), not the stored id. */
const PAY_DATE = "goals-pay-date-1";

let latest: LocalFinancials;
function Goals({ initial }: { initial: LocalFinancials }) {
  const [d, setD] = useState(initial);
  latest = d;
  return <ThemeProvider><GoalsScreen dashData={computeDashboard(d)} financials={d} onChange={setD} onEdit={vi.fn()} /></ThemeProvider>;
}

describe("Goals: Add payment", () => {
  it("the line shows for tomorrow, not for today or yesterday", () => {
    render(<Goals initial={base()} />);
    fireEvent.click(screen.getByRole("button", { name: /Add payment/ }));
    expect(note()).toBeNull();
    setDate(PAY_DATE, "2026-11-10");
    expect(note()).toBeTruthy();
    setDate(PAY_DATE, "2026-11-09");
    expect(note()).toBeNull();
    setDate(PAY_DATE, "2026-11-08");
    expect(note()).toBeNull();
  });

  it("the save still goes through, with the date as entered", () => {
    render(<Goals initial={base()} />);
    fireEvent.click(screen.getByRole("button", { name: /Add payment/ }));
    setDate(PAY_DATE, "2027-11-10");
    fireEvent.change(screen.getByPlaceholderText(/Custom amount/), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "Pay" }));
    const row = latest.transactions.find((t) => t.goalId === "g1");
    expect(row).toMatchObject({ amount: 100, date: "2027-11-10" });
  });
});

describe("My Finances: Add to this goal", () => {
  it("the line shows for tomorrow, not for today", () => {
    render(<InputPanel financials={base()} dashData={computeDashboard(base())} onChange={vi.fn()} onEdit={vi.fn()} onPay={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Manage/ }));
    fireEvent.click(screen.getByRole("button", { name: /Goals/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add to this goal" }));
    expect(note()).toBeNull();
    setDate("contribute-date-g1", "2026-11-10");
    expect(note()).toBeTruthy();
    setDate("contribute-date-g1", "2026-11-09");
    expect(note()).toBeNull();
  });
});

describe("the edit sheet", () => {
  const sheet = (tx: StoredTransaction) => {
    const d = base({ transactions: [tx] });
    render(<ThemeProvider><EditTransactionSheet transaction={tx} financials={d} onChange={vi.fn()} onClose={vi.fn()} /></ThemeProvider>);
  };
  const CONTRIBUTION = { id: "c1", amount: 100, currency: "USD", bucket: "SAVINGS", description: "Goal: Laptop", date: "2026-11-01", goalId: "g1", createdAt: "2026-11-01T09:00:00.000Z" } as StoredTransaction;

  it("a goal's row: the line shows for tomorrow, not for today", () => {
    sheet(CONTRIBUTION);
    expect(note()).toBeNull();
    setDate("edit-tx-date", "2026-11-10");
    expect(note()).toBeTruthy();
    setDate("edit-tx-date", "2026-11-09");
    expect(note()).toBeNull();
  });

  it("a row with no goal: never", () => {
    const { goalId: _g, ...plain } = CONTRIBUTION;
    sheet({ ...plain, bucket: "WANTS", description: "Coffee" } as StoredTransaction);
    setDate("edit-tx-date", "2026-11-10");
    expect(note()).toBeNull();
  });

  it("follows the device's own day: at 00:30 on the 3rd, the 3rd is today and the 4th is the future", () => {
    vi.setSystemTime(new Date(2026, 10, 3, 0, 30));
    sheet(CONTRIBUTION);
    setDate("edit-tx-date", "2026-11-03");
    expect(note()).toBeNull();
    setDate("edit-tx-date", "2026-11-04");
    expect(note()).toBeTruthy();
  });
});
