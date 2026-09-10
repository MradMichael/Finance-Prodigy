// 2.4.70, Journey half. This screen renders a safety-net completion DATE
// ("Keep this pace and your safety net is complete by X") and, directly
// beneath it, a button navigating to Projections -- which renders a date for
// the same question, from the identical projectCompletion call. Once
// Projections moved to budgetTargets, leaving Journey on
// effectiveBudgetTargets would make the two disagree whenever rollover is
// non-zero, with the app itself routing the user from one to the other.
//
// So the assertions below are about cross-screen agreement, not about a
// particular date: the rendered date must match the one the raw
// income * pct rate produces, and must NOT match the rollover-adjusted one.
// A premise test proves those two differ for this fixture, so the suite
// cannot pass vacuously.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import JourneyScreen from "./JourneyScreen";
import { computeDashboard } from "../../lib/computeDashboard";
import { projectCompletion } from "../../lib/projections";
import { DEFAULT_DATA, type LocalFinancials } from "../../lib/localData";

const NOW = new Date(2026, 6, 15); // July 15, 2026

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); });

/**
 * income 1000 on 50/30/20 -> raw savings target $200. June logs Needs but no
 * Savings, so budgetRollover.savings = +200 and the adjusted target is $400.
 * Twice the rate closes the same safety-net gap in half the months, so the
 * two bases produce visibly different dates.
 */
function makeData(overrides: Partial<LocalFinancials> = {}): LocalFinancials {
  return {
    ...DEFAULT_DATA,
    income: 1000,
    budgetRule: "50-30-20",
    transactions: [
      { id: "t1", amount: 500, currency: "USD", bucket: "NEEDS", description: "June needs", date: "2026-06-10" },
    ],
    ...overrides,
  };
}

function renderJourney(overrides: Partial<LocalFinancials> = {}) {
  const data = makeData(overrides);
  const dash = computeDashboard(data);
  render(<JourneyScreen financials={data} dashData={dash} onNavigate={vi.fn()} />);
  return dash;
}

describe("JourneyScreen — safety-net pace agrees with Projections", () => {
  it("the fixture discriminates: the two bases give different completion dates", () => {
    const dash = renderJourney();
    const remaining = dash.emergencyFund.remaining;
    expect(remaining).toBeGreaterThan(0); // otherwise there is no date to compare
    expect(dash.budgetTargets.savings).toBeCloseTo(200, 5);
    expect(dash.effectiveBudgetTargets.savings).toBeCloseTo(400, 5);

    const fromRaw = projectCompletion(remaining, dash.budgetTargets.savings).dateDisplay;
    const fromAdjusted = projectCompletion(remaining, dash.effectiveBudgetTargets.savings).dateDisplay;
    expect(fromRaw).not.toEqual(fromAdjusted);
  });

  it("renders the date the raw income * pct rate produces, matching Projections", () => {
    const dash = renderJourney();
    const expected = projectCompletion(dash.emergencyFund.remaining, dash.budgetTargets.savings).dateDisplay!;
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it("does not render the date the rollover-adjusted rate produces", () => {
    const dash = renderJourney();
    const wrong = projectCompletion(dash.emergencyFund.remaining, dash.effectiveBudgetTargets.savings).dateDisplay!;
    expect(screen.queryByText(wrong)).not.toBeInTheDocument();
  });

  it("still points the reader at Projections -- the navigation this agreement exists to protect", () => {
    renderJourney();
    expect(screen.getByRole("button", { name: /See the full path to financial stability/i })).toBeInTheDocument();
  });

  it("rollover is still computed and still available -- only this screen's display basis moved", () => {
    const dash = renderJourney();
    expect(dash.budgetRollover.savings).toBeCloseTo(200, 5);
    expect(dash.effectiveBudgetTargets.savings).toBeCloseTo(400, 5);
  });
});
