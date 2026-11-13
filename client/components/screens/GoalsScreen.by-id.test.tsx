// Session 52 (owner, item 8): Goals found a goal by its place in the list. The dashboard numbers its goals 1, 2, ...
// in list order, and Add payment, Pause and Edit used that number to index the stored list. The two lists are
// separate props; when they disagree (the dashboard one render behind a sync that reordered or removed a goal),
// the action landed on the neighbouring goal. Each dashboard goal now carries the stored goal's own id.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import GoalsScreen from "./GoalsScreen";
import { ThemeProvider } from "../../contexts/ThemeContext";
import { computeDashboard } from "../../lib/computeDashboard";
import { DEFAULT_DATA, type LocalFinancials, type StoredGoal } from "../../lib/localData";

afterEach(cleanup);

const goal = (id: string, name: string): StoredGoal => ({ id, name, emoji: "G", targetAmount: 1000, currentAmount: 0, openingAmount: 0, currency: "USD", targetDate: "2027-12-31", createdAt: "2026-06-01T00:00:00.000Z" });
const LAPTOP = goal("g-laptop", "Laptop");
const TRIP = goal("g-trip", "Trip");
const data = (goals: StoredGoal[]) => ({ ...DEFAULT_DATA, income: 3000, goals, transactions: [] }) as LocalFinancials;

/** The dashboard was computed from [Laptop, Trip]; the stored list has since become [Trip, Laptop]. */
function show() {
  const onChange = vi.fn<(d: LocalFinancials) => void>();
  const onEdit = vi.fn<(id: string) => void>();
  render(<ThemeProvider><GoalsScreen dashData={computeDashboard(data([LAPTOP, TRIP]))} financials={data([TRIP, LAPTOP])} onChange={onChange} onEdit={onEdit} /></ThemeProvider>);
  const card = screen.getByText((_, el) => el?.tagName === "P" && (el.textContent ?? "").includes("Laptop") && el.className.includes("font-medium")).closest("div.rounded-2xl") as HTMLElement;
  return { onChange, onEdit, card };
}

describe("Goals acts on the goal shown, whatever its place in the stored list", () => {
  it("the dashboard's goal carries the stored goal's id", () => {
    expect(computeDashboard(data([LAPTOP, TRIP])).goals.map((g) => g.storedId)).toEqual(["g-laptop", "g-trip"]);
  });

  it("Add payment on Laptop pays Laptop", () => {
    const { onChange, card } = show();
    fireEvent.click(within(card).getByRole("button", { name: /Add payment/ }));
    fireEvent.change(within(card).getByPlaceholderText(/Custom amount/), { target: { value: "100" } });
    fireEvent.click(within(card).getByRole("button", { name: "Pay" }));
    const saved = onChange.mock.calls[0][0];
    expect(saved.transactions).toHaveLength(1);
    expect(saved.transactions[0]).toMatchObject({ amount: 100, goalId: "g-laptop" });
  });

  it("Pause on Laptop pauses Laptop", () => {
    const { onChange, card } = show();
    fireEvent.click(within(card).getByRole("button", { name: "Pause goal" }));
    const saved = onChange.mock.calls[0][0];
    expect(saved.goals.find((g) => g.id === "g-laptop")!.pausedAt).toBeTruthy();
    expect(saved.goals.find((g) => g.id === "g-trip")!.pausedAt).toBeUndefined();
  });

  it("Edit on Laptop opens Laptop", () => {
    const { onEdit, card } = show();
    fireEvent.click(within(card).getByRole("button", { name: "Edit goal" }));
    expect(onEdit).toHaveBeenCalledWith("g-laptop");
  });

  it("a goal that has gone from the stored list: nothing is written", () => {
    const onChange = vi.fn();
    render(<ThemeProvider><GoalsScreen dashData={computeDashboard(data([LAPTOP, TRIP]))} financials={data([TRIP])} onChange={onChange} onEdit={vi.fn()} /></ThemeProvider>);
    const card = screen.getByText((_, el) => el?.tagName === "P" && (el.textContent ?? "").includes("Laptop") && el.className.includes("font-medium")).closest("div.rounded-2xl") as HTMLElement;
    fireEvent.click(within(card).getByRole("button", { name: "Pause goal" }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
