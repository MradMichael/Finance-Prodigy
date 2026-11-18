// Item 3 (owner, session 57; wording approved): a goal payment's lira check speaks of a goal payment. The entry
// form's words ("for a real purchase", "Did you mean to log this in USD instead?", "Let me fix the currency") didn't
// fit a goal's box, which can't switch currency. On a goal: "{amount} LBP is unusually low for a goal payment. Did
// you mean a larger amount?" with "Let me fix the amount" and "No, save it as {amount} LBP". Goals' Add payment uses
// it (since session 56 it asked, with the entry's words), and My Finances' Add to this goal now asks too (it never
// did): a lira goal's amount under L£500 asks first; fixing pays nothing; saving pays.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import LbpMistypeDialog from "./LbpMistypeDialog";
import InputPanel from "./InputPanel";
import { ThemeProvider } from "../contexts/ThemeContext";
import { computeDashboard } from "../lib/computeDashboard";
import { DEFAULT_DATA, type LocalFinancials, type StoredGoal } from "../lib/localData";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn() }) }));
afterEach(cleanup);

const GOAL_SENTENCE = "400 LBP is unusually low for a goal payment. Did you mean a larger amount?";
const PURCHASE = /unusually low for a real purchase/;

describe("the dialog's goal words", () => {
  it("on a goal: the approved sentence and buttons", () => {
    render(<ThemeProvider><LbpMistypeDialog amount={400} forGoal onFix={vi.fn()} onSave={vi.fn()} /></ThemeProvider>);
    const d = screen.getByRole("dialog", { name: "Confirm low LBP amount" });
    expect(d.textContent).toContain(GOAL_SENTENCE);
    expect(d.textContent).not.toMatch(PURCHASE);
    expect(within(d).getAllByRole("button").map((b) => b.textContent)).toEqual(["Let me fix the amount", "No, save it as 400 LBP"]);
  });

  it("on an entry: the words it had", () => {
    render(<ThemeProvider><LbpMistypeDialog amount={400} onFix={vi.fn()} onSave={vi.fn()} /></ThemeProvider>);
    const d = screen.getByRole("dialog", { name: "Confirm low LBP amount" });
    expect(d.textContent).toMatch(PURCHASE);
    expect(within(d).getAllByRole("button").map((b) => b.textContent)).toEqual(["Let me fix the currency", "No, save it as 400 LBP"]);
  });
});

describe("My Finances: Add to this goal", () => {
  const goal = (currency: "USD" | "LBP"): StoredGoal => ({ id: "g1", name: currency === "LBP" ? "Car" : "Laptop", emoji: "G", targetAmount: currency === "LBP" ? 900_000_000 : 1500, currentAmount: 0, openingAmount: 0, currency, targetDate: "2027-12-31", createdAt: "2026-01-01T00:00:00.000Z" });
  function open(currency: "USD" | "LBP", amount: string) {
    const data = { ...DEFAULT_DATA, income: 3000, goals: [goal(currency)], transactions: [] } as LocalFinancials;
    const onChange = vi.fn<(d: LocalFinancials) => void>();
    render(<InputPanel financials={data} dashData={computeDashboard(data)} onChange={onChange} onEdit={vi.fn()} onPay={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Manage/ }));
    fireEvent.click(screen.getByRole("button", { name: /Goals/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add to this goal" }));
    fireEvent.change(screen.getByPlaceholderText("Amount", { exact: true }), { target: { value: amount } });
    const save = () => fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const paid = () => onChange.mock.calls.map((c) => c[0].transactions.find((t) => t.goalId === "g1")?.amount).filter((a) => a !== undefined);
    return { save, paid, onChange };
  }

  it("a lira goal at L£400: it asks with the goal's words, and nothing is paid yet", () => {
    const s = open("LBP", "400");
    s.save();
    expect(screen.getByRole("dialog", { name: "Confirm low LBP amount" }).textContent).toContain(GOAL_SENTENCE);
    expect(s.paid()).toEqual([]);
  });

  it("\"Let me fix the amount\" closes it and pays nothing", () => {
    const s = open("LBP", "400");
    s.save();
    fireEvent.click(screen.getByRole("button", { name: "Let me fix the amount" }));
    expect(screen.queryByRole("dialog", { name: "Confirm low LBP amount" })).toBeNull();
    expect(s.paid()).toEqual([]);
  });

  it("\"No, save it as 400 LBP\" pays L£400 to the goal", () => {
    const s = open("LBP", "400");
    s.save();
    fireEvent.click(screen.getByRole("button", { name: "No, save it as 400 LBP" }));
    expect(s.paid()).toEqual([400]);
  });

  it("L£500 pays without asking; so does a dollar goal at $400", () => {
    const a = open("LBP", "500");
    a.save();
    expect(screen.queryByRole("dialog", { name: "Confirm low LBP amount" })).toBeNull();
    expect(a.paid()).toEqual([500]);
    cleanup();
    const b = open("USD", "400");
    b.save();
    expect(screen.queryByRole("dialog", { name: "Confirm low LBP amount" })).toBeNull();
    expect(b.paid()).toEqual([400]);
  });
});
