// 2.4.70, Projections half: "Recommended monthly savings" and everything
// tied to it by the word "recommended" now read budgetTargets (income * pct
// for the month), matching what the Budget screen and Overview's Budget card
// already show. Previously the headline used the rollover-adjusted figure
// while its own subtext claimed as much -- true, but it made the same
// displayed-figure-vs-stated-percentage mismatch this finding is about.
//
// The five sites move together on purpose: the headline (:261), its subtext
// (:263), the initial plan amount (:99), the "Recommended savings" preset
// (:303), and the "At recommended pace" EF projection (:398). Moving the
// headline alone would leave three siblings showing a different number under
// the same word.
//
// budgetPace and its alerts deliberately still judge spend against the
// rollover-adjusted target -- unchanged, and not what this file covers.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import ProjectionsScreen from "./ProjectionsScreen";
import { computeDashboard } from "../../lib/computeDashboard";
import { DEFAULT_DATA, type LocalFinancials } from "../../lib/localData";

const NOW = new Date(2026, 6, 15); // July 15, 2026

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); });

/**
 * income 1000 on 50/30/20 -> raw savings target $200.
 * June logged $0 of Savings against its own $200 target, so
 * budgetRollover.savings = +200 and the ADJUSTED savings target is $400.
 * Every $200 assertion below therefore discriminates: it fails against the
 * pre-change code, which rendered $400.
 */
function makeData(overrides: Partial<LocalFinancials> = {}): LocalFinancials {
  return {
    ...DEFAULT_DATA,
    income: 1000,
    budgetRule: "50-30-20",
    transactions: [
      // A June Needs entry, so June counts as an active month for rollover
      // (a month with no activity at all is skipped entirely) while leaving
      // Savings untouched at $0 against its $200 target.
      { id: "t1", amount: 500, currency: "USD", bucket: "NEEDS", description: "June needs", date: "2026-06-10" },
    ],
    ...overrides,
  };
}

function renderProjections(overrides: Partial<LocalFinancials> = {}) {
  const data = makeData(overrides);
  const dash = computeDashboard(data);
  render(<ProjectionsScreen financials={data} dashData={dash} />);
  return dash;
}

describe("ProjectionsScreen — recommended savings comes from income, not rollover", () => {
  it("the fixture really does carry a non-zero savings rollover, so these assertions discriminate", () => {
    const dash = renderProjections();
    expect(dash.budgetRollover.savings).toBeCloseTo(200, 5);
    expect(dash.budgetTargets.savings).toBeCloseTo(200, 5);
    expect(dash.effectiveBudgetTargets.savings).toBeCloseTo(400, 5);
  });

  it("the headline figure is the raw income * pct target, not the adjusted one", () => {
    renderProjections();
    expect(screen.getByText("$200")).toBeInTheDocument();
    expect(screen.queryByText("$400")).not.toBeInTheDocument();
  });

  it("the subtext no longer claims the figure is adjusted for rollover", () => {
    renderProjections();
    expect(screen.queryByText(/adjusted for last month/i)).not.toBeInTheDocument();
    // It should still say what the figure IS.
    expect(screen.getByText(/20% of income/i)).toBeInTheDocument();
  });

  it("the plan amount is seeded from the same figure the headline shows", () => {
    renderProjections();
    // If :99 stayed on the adjusted value it would load at 400 while the
    // headline read $200 -- the contradiction this change exists to avoid.
    expect(screen.getByLabelText("Monthly amount to plan with")).toHaveValue(200);
  });

  it("the \"Recommended savings\" preset offers the same figure as the headline", () => {
    renderProjections();
    // The preset is labelled with the same word as the headline, so it must
    // carry the same number; the surplus preset beside it is unaffected.
    expect(screen.getByRole("button", { name: "Recommended savings" })).toBeInTheDocument();
    expect(screen.getByLabelText("Monthly amount to plan with")).toHaveValue(200);
  });

  it("rollover is still computed and still available -- only the display basis moved", () => {
    const dash = renderProjections();
    expect(dash.budgetRollover.savings).toBeCloseTo(200, 5);
    expect(dash.effectiveBudgetTargets.savings).toBeCloseTo(400, 5);
  });
});
