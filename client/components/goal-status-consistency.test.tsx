// Session 32 review, batch 3 (existing labels only):
// - T4: Projections' goal row said "On track" next to a date after the goal's own target.
// - T5: the Overview called an achieved goal "on pace" ("$0.00/mo keeps this on schedule") and a paused
//   one "needs a push" ("$700.00/mo keeps this on schedule"); the Goals screen calls them "achieved!" and
//   "paused" (GoalsScreen's badge). The schedule line is left out for both.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import ProjectionsScreen from "./screens/ProjectionsScreen";
import FinancialDashboard from "./FinancialDashboard";
import { computeDashboard } from "../lib/computeDashboard";
import { DEFAULT_DATA, type LocalFinancials, type StoredGoal } from "../lib/localData";

vi.mock("next/navigation", () => ({ useRouter: () => ROUTER }));
const ROUTER = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn() };

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-31T10:00:00")); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

const goal = (over: Partial<StoredGoal>): StoredGoal => ({ id: "g", name: "Goal", emoji: "🎯", targetAmount: 1000, currentAmount: 0, openingAmount: 0, currency: "USD", targetDate: "2027-12-01", createdAt: "2025-11-01T08:00:00.000Z", ...over });
const base = (over: Partial<LocalFinancials>) => ({ ...DEFAULT_DATA, income: 3000, budgetRule: "50-30-20", ...over }) as LocalFinancials;

describe("T4: Projections doesn't call a goal on track that it lands after its target", () => {
  it("a goal whose target passes while the safety net is being funded reads 'Needs adjustment', not 'On track'", () => {
    // Safety net first: 6 months of essentials (1,500) = 9,000 at 600 a month is 15 months, so the goals
    // stage starts in early 2028. The laptop's target, 1 Mar 2027, passes during that wait.
    const d = base({ emergencyFundTargetMonths: 6, emergencyFundBalance: 0, emergencyFundOpeningBalance: 0, goals: [goal({ id: "g1", name: "Laptop", emoji: "💻", targetAmount: 1000, openingAmount: 530, currentAmount: 530, targetDate: "2027-03-01" })] });
    render(<ProjectionsScreen financials={d} dashData={computeDashboard(d)} />);
    const row = screen.getAllByText(/Laptop/).map((el) => el.closest("div.rounded-xl")).find((el) => el && /target 01\/03\/2027/.test(el.textContent ?? ""))!;
    expect(row).toBeTruthy();
    expect(within(row as HTMLElement).queryByText("On track")).toBeNull();
    expect(within(row as HTMLElement).getByText("Needs adjustment")).toBeTruthy();
  });
});

describe("T5: the Overview's goals say paused and achieved, as the Goals screen does", () => {
  function card(name: string) {
    const el = screen.getByText((_, n) => n?.tagName === "P" && (n.textContent ?? "").endsWith(name)).closest("div.rounded-xl");
    return el as HTMLElement;
  }

  it("paused: 'paused', and no schedule line", () => {
    const d = base({ goals: [goal({ id: "p", name: "Wedding gift", openingAmount: 300, currentAmount: 300, pausedAt: "2026-08-20T09:00:00.000Z" })] });
    render(<FinancialDashboard data={computeDashboard(d)} financials={d} />);
    const c = card("Wedding gift");
    expect(within(c).getByText("paused")).toBeTruthy();
    expect(c.textContent).not.toMatch(/keeps this on schedule/);
  });

  it("achieved: 'achieved!', and no schedule line", () => {
    const d = base({ goals: [goal({ id: "a", name: "New phone", targetAmount: 600, openingAmount: 600, currentAmount: 600, targetDate: "2026-06-01" })] });
    render(<FinancialDashboard data={computeDashboard(d)} financials={d} />);
    const c = card("New phone");
    expect(within(c).getByText("achieved!")).toBeTruthy();
    expect(c.textContent).not.toMatch(/keeps this on schedule/);
  });

  it("an open goal is unchanged: its pace badge and its schedule line", () => {
    const d = base({ goals: [goal({ id: "o", name: "New car", targetAmount: 8000, openingAmount: 3000, currentAmount: 3000, targetDate: "2028-06-30" })] });
    render(<FinancialDashboard data={computeDashboard(d)} financials={d} />);
    const c = card("New car");
    expect(within(c).getByText(/^(on pace|behind pace)$/)).toBeTruthy(); // T7 (session 33): one word, approved
    expect(c.textContent).toMatch(/keeps this on schedule for 30\/06\/2028/);
  });
});
