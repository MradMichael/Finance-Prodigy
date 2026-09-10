// The displayed budget targets are income * pct for the current month, with
// no rollover applied, so the three reconcile against their own percentage
// labels and sum to income. Rollover is NOT removed -- it stays computed and
// still drives budgetPace and its alerts; only what feeds the DISPLAYED
// target changed (2.4.70).
//
// The fixture below deliberately carries a non-zero rollover: without one,
// budgetTargets and effectiveBudgetTargets are identical and every assertion
// here would pass against either, proving nothing.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import BudgetScreen from "./BudgetScreen";
import { computeDashboard } from "../../lib/computeDashboard";
import { DEFAULT_DATA, type LocalFinancials } from "../../lib/localData";

const NOW = new Date(2026, 6, 15); // July 15, 2026

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); });

/**
 * income 1000 on the default 50/30/20 -> raw targets 500 / 300 / 200.
 * One past month (June) with $400 of Needs against its own $500 target
 * leaves budgetRollover.needs = +100, so the ADJUSTED Needs target is $600.
 * Any assertion of $500 below therefore discriminates: it fails against the
 * pre-change code, which rendered the adjusted figure.
 */
function makeData(overrides: Partial<LocalFinancials> = {}): LocalFinancials {
  return {
    ...DEFAULT_DATA,
    income: 1000,
    budgetRule: "50-30-20",
    transactions: [
      { id: "t1", amount: 400, currency: "USD", bucket: "NEEDS", description: "June needs", date: "2026-06-10" },
    ],
    ...overrides,
  };
}

function renderBudget(overrides: Partial<LocalFinancials> = {}) {
  const data = makeData(overrides);
  const dash = computeDashboard(data);
  render(<BudgetScreen financials={data} dashData={dash} onChange={vi.fn()} />);
  return dash;
}

describe("BudgetScreen — displayed targets come from income, not from rollover", () => {
  it("the fixture really does carry a non-zero rollover, so these assertions discriminate", () => {
    const dash = renderBudget();
    // Guard on the premise itself: if this ever becomes 0, every other test
    // in this file silently stops testing anything.
    expect(dash.budgetRollover.needs).toBeCloseTo(100, 5);
    expect(dash.effectiveBudgetTargets.needs).toBeCloseTo(600, 5);
    expect(dash.budgetTargets.needs).toBeCloseTo(500, 5);
  });

  it("renders the raw income * pct target, not the rollover-adjusted one", () => {
    renderBudget();
    // "target 50% · $500" -- $500, not the adjusted $600.
    expect(screen.getByText(/target 50% · \$500/)).toBeInTheDocument();
    expect(screen.queryByText(/target 50% · \$600/)).not.toBeInTheDocument();
  });

  it("all three displayed targets reconcile against their own percentage labels", () => {
    renderBudget();
    expect(screen.getByText(/target 50% · \$500/)).toBeInTheDocument();
    expect(screen.getByText(/target 30% · \$300/)).toBeInTheDocument();
    expect(screen.getByText(/target 20% · \$200/)).toBeInTheDocument();
  });

  it("the three displayed targets sum to income", () => {
    const dash = renderBudget();
    const { needs, wants, savings } = dash.budgetTargets;
    expect(needs + wants + savings).toBeCloseTo(dash.month.income, 5);
  });

  it("a custom rule reconciles too -- the property is not specific to 50/30/20", () => {
    renderBudget({ budgetRule: "custom", budgetCustomNeeds: 70, budgetCustomWants: 25 });
    expect(screen.getByText(/target 70% · \$700/)).toBeInTheDocument();
    expect(screen.getByText(/target 25% · \$250/)).toBeInTheDocument();
    expect(screen.getByText(/target 5% · \$50/)).toBeInTheDocument();
  });

  it("rollover is still computed and still available -- this change scoped the display only", () => {
    const dash = renderBudget();
    expect(dash.budgetRollover.needs).toBeCloseTo(100, 5);
    expect(dash.effectiveBudgetTargets.needs).toBeCloseTo(600, 5);
  });
});
