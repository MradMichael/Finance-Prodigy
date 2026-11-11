// Review fix 1 (owner, 2026-11-10): in the goal edit sheet, an empty or
// non-numeric "Saved" box means NO CHANGE to what's saved. It used to be read
// as 0 (parseFloat(...) || 0): one cleared box and a Save wrote a correction
// row for minus everything saved and cleared the achieved stamp, with no
// warning. Found by running exactly the first case below.
//   - Empty, or not a number: no correction row, the achieved stamp kept, the
//     other fields still saved.
//   - A typed 0, or a typed different figure, is a statement: it still writes
//     its correction (pins; unchanged).
// Money: the correction's goalAmount is in the goal's currency (USD here).
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import EditGoalSheet from "./EditGoalSheet";
import { ThemeProvider } from "../contexts/ThemeContext";
import { DEFAULT_DATA, goalProgress, type LocalFinancials, type StoredGoal, type StoredTransaction } from "../lib/localData";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const SAVED: StoredTransaction = { id: "t1", amount: 1000, currency: "USD", bucket: "SAVINGS", description: "saved", date: "2026-05-01", goalId: "g1" } as StoredTransaction;
const goal = (o: Partial<StoredGoal> = {}): StoredGoal =>
  ({ id: "g1", name: "Car", emoji: "🚗", targetAmount: 1000, currentAmount: 0, openingAmount: 0, currency: "USD", targetDate: "2027-01-01", achievedAt: "2026-05-01", ...o }) as StoredGoal;
const data = (g: StoredGoal, transactions: StoredTransaction[] = [SAVED]) => ({ ...DEFAULT_DATA, goals: [g], transactions }) as LocalFinancials;

/** Opens the sheet, types into its boxes by id, saves, and returns what it wrote. */
function saveWith(d: LocalFinancials, fields: Record<string, string>) {
  const onChange = vi.fn<(f: LocalFinancials) => void>();
  render(<ThemeProvider><EditGoalSheet goal={d.goals[0]} financials={d} onChange={onChange} onClose={vi.fn()} /></ThemeProvider>);
  for (const [id, value] of Object.entries(fields)) fireEvent.change(document.getElementById(id)!, { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(onChange).toHaveBeenCalledTimes(1);
  return onChange.mock.calls[0][0];
}
const corrections = (out: LocalFinancials) => out.transactions.filter((t) => t.id !== "t1");

describe("an empty or non-numeric \"Saved\" box is no change", () => {
  it("emptied on an achieved $1,000 goal: no correction row, the achieved stamp kept, $1,000 still saved", () => {
    const d = data(goal());
    const out = saveWith(d, { "edit-goal-saved": "" });
    expect(corrections(out)).toEqual([]);
    expect(out.goals[0].achievedAt).toBe("2026-05-01");
    expect(goalProgress(out.goals[0], out)).toBe(1000);
  });

  it("the other fields are still saved", () => {
    const out = saveWith(data(goal()), { "edit-goal-saved": "", "edit-goal-name": "New car" });
    expect(out.goals[0].name).toBe("New car");
    expect(corrections(out)).toEqual([]);
  });

  it.each(["abc", "-", ".", "  "])("not a number (%j): no correction row, the stamp kept", (typed) => {
    const out = saveWith(data(goal()), { "edit-goal-saved": typed });
    expect(corrections(out)).toEqual([]);
    expect(out.goals[0].achievedAt).toBe("2026-05-01");
  });

  it("a goal never migrated (its stored total is its progress): the total stays", () => {
    const unmigrated = goal({ openingAmount: undefined, currentAmount: 400, targetAmount: 1000, achievedAt: undefined });
    const out = saveWith(data(unmigrated, []), { "edit-goal-saved": "" });
    expect(out.goals[0].currentAmount).toBe(400);
    expect(out.transactions).toEqual([]);
  });
});

describe("a typed figure is still a statement (unchanged)", () => {
  it("a typed 0 writes the correction for everything saved and clears the stamp", () => {
    const out = saveWith(data(goal()), { "edit-goal-saved": "0" });
    expect(corrections(out).map((t) => t.goalAmount)).toEqual([-1000]);
    expect(out.goals[0].achievedAt).toBeUndefined();
  });

  it("a typed different figure writes the difference", () => {
    const out = saveWith(data(goal()), { "edit-goal-saved": "1,250" });
    expect(corrections(out).map((t) => t.goalAmount)).toEqual([250]);
    expect(out.goals[0].achievedAt).toBe("2026-05-01");
  });
});
