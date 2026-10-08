// Plan H 5a on screen: the Goals screen shows computed progress, and Edit
// Goal's "Saved" field starts from it and saves a different figure as a $0
// correction row, not an edited total.
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import GoalsScreen from "./screens/GoalsScreen";
import EditGoalSheet from "./EditGoalSheet";
import InputPanel from "./InputPanel";
import ProjectionsScreen from "./screens/ProjectionsScreen";
import WishlistScreen from "./screens/WishlistScreen";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "../contexts/ThemeContext";
import { computeDashboard } from "../lib/computeDashboard";
import { DEFAULT_DATA, goalProgress, type LocalFinancials, type StoredTransaction } from "../lib/localData";

afterEach(cleanup);

const contrib = (id: string, amount: number): StoredTransaction =>
  ({ id, amount, currency: "USD", bucket: "SAVINGS", description: "Goal: Laptop", date: "2026-09-10", goalId: "g1" }) as StoredTransaction;
const DATA = {
  ...DEFAULT_DATA, income: 3000,
  // The stored total (90) is stale -- progress is 100 + 50 + 25.
  goals: [{ id: "g1", name: "Laptop", emoji: "💻", targetAmount: 1200, currentAmount: 90, openingAmount: 100, currency: "USD", targetDate: "2027-03-01", createdAt: "2026-05-01T09:00:00.000Z" }],
  transactions: [contrib("c1", 50), contrib("c2", 25)],
} as LocalFinancials;

it("the Goals screen shows the computed figure, not the stored total", () => {
  render(<ThemeProvider><GoalsScreen dashData={computeDashboard(DATA)} financials={DATA} onChange={vi.fn()} onEdit={vi.fn()} /></ThemeProvider>);
  expect(document.body.textContent).toContain("$175");
  expect(document.body.textContent).not.toContain("$90");
});

it("My Finances' goal list shows the computed figure", async () => {
  render(<InputPanel financials={DATA} dashData={computeDashboard(DATA)} onChange={vi.fn()} onEdit={vi.fn()} onPay={vi.fn()} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /Manage/ }));
  await user.click(screen.getByRole("button", { name: /Goals/ }));
  expect(document.body.textContent).toContain("$175.00 of $1,200.00");
});

it("Projections plans from the computed figure: the same goal stored either way renders the same", () => {
  vi.useFakeTimers({ now: new Date(2026, 9, 8, 12, 0), toFake: ["Date"] });
  try {
    const base = { ...DEFAULT_DATA, income: 3000, budgetRule: "50-30-20" } as LocalFinancials;
    const g = { id: "g1", name: "Laptop", emoji: "💻", targetAmount: 6000, currency: "USD", targetDate: "2027-04-01", createdAt: "2026-05-01T09:00:00.000Z" };
    // Old-style: the stored total holds everything. New-style: a stale stored total, the progress in contributions.
    const oldStyle = { ...base, goals: [{ ...g, currentAmount: 600 }] } as LocalFinancials;
    const newStyle = { ...base, goals: [{ ...g, currentAmount: 0, openingAmount: 0 }], transactions: [contrib("c1", 400), contrib("c2", 200)] } as LocalFinancials;
    render(<ProjectionsScreen financials={oldStyle} dashData={computeDashboard(oldStyle)} />);
    const expected = document.body.textContent;
    cleanup();
    render(<ProjectionsScreen financials={newStyle} dashData={computeDashboard(newStyle)} />);
    expect(expected).toContain("Needs $4,800/mo more"); // premise: the plan's numbers depend on what's saved ($5,400 with nothing saved)
    expect(document.body.textContent).toBe(expected);
  } finally { vi.useRealTimers(); }
});

it("\"Save toward this\" starts its goal with an opening amount of 0", () => {
  const onChange = vi.fn();
  const data = { ...DEFAULT_DATA, income: 3000, wishlist: [{ id: "w1", name: "Quartz lamp", emoji: "✨", price: 64.2, currency: "USD", priority: "medium", createdAt: "2026-10-01T09:00:00.000Z" }] } as unknown as LocalFinancials;
  render(<ThemeProvider><WishlistScreen financials={data} onChange={onChange} /></ThemeProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Save toward this" }));
  const out = onChange.mock.calls.at(-1)![0] as LocalFinancials;
  expect(out.goals.at(-1)).toMatchObject({ name: "Quartz lamp", openingAmount: 0 });
});

it("the Goals screen's contribution counts the ones already made toward achievedAt", () => {
  const onChange = vi.fn();
  const data = { ...DATA, goals: [{ ...DATA.goals[0], openingAmount: 1100, targetAmount: 1200 }], transactions: [contrib("c1", 50)] } as LocalFinancials;
  render(<ThemeProvider><GoalsScreen dashData={computeDashboard(data)} financials={data} onChange={onChange} onEdit={vi.fn()} /></ThemeProvider>);
  fireEvent.click(screen.getByRole("button", { name: /Add payment/ }));
  fireEvent.change(screen.getByPlaceholderText("Custom amount ($)"), { target: { value: "60" } });
  fireEvent.click(screen.getByRole("button", { name: "Pay" }));
  const out = onChange.mock.calls.at(-1)![0] as LocalFinancials;
  expect(out.goals[0].achievedAt).toBeTruthy(); // 1100 + 50 + 60 = 1210 ≥ 1200
});

it("Edit Goal starts from the computed figure and saves a change as a correction row", () => {
  const onChange = vi.fn();
  render(<ThemeProvider><EditGoalSheet goal={DATA.goals[0]} financials={DATA} onChange={onChange} onClose={vi.fn()} /></ThemeProvider>);
  const saved = document.getElementById("edit-goal-saved") as HTMLInputElement;
  expect(saved.value.replace(/,/g, "")).toBe("175");
  fireEvent.change(saved, { target: { value: "200" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  const out = onChange.mock.calls.at(-1)![0] as LocalFinancials;
  const correction = out.transactions.find((t) => t.goalAmount != null)!;
  expect(correction).toMatchObject({ amount: 0, goalId: "g1", goalAmount: 25 });
  expect(out.goals[0].currentAmount).toBe(90); // the stored total isn't written
  expect(goalProgress(out.goals[0], out)).toBe(200);
});
