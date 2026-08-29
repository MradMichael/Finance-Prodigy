// AUD-09 (external audit, 2026-08-28): the "Net" row on the this-month-vs-
// last-month comparison table computed income - needs - wants, omitting
// savings -- overstating Net by exactly the savings amount, and disagreeing
// with the canonical dashData.month.netCashFlow this same screen already
// shows elsewhere (the Net worth forecast section, income - ALL spend).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import StatisticsScreen from "./StatisticsScreen";
import { computeDashboard } from "../../lib/computeDashboard";
import { DEFAULT_DATA, type LocalFinancials } from "../../lib/localData";

function makeData(overrides: Partial<LocalFinancials> = {}): LocalFinancials {
  return { ...DEFAULT_DATA, ...overrides };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 7, 15)); // Aug 15, 2026
});
afterEach(() => {
  vi.useRealTimers();
});

describe("StatisticsScreen -- period comparison 'Net' row (AUD-09)", () => {
  it("includes savings in Net, matching income - needs - wants - savings", () => {
    const data = makeData({
      income: 3000,
      transactions: [
        { id: "t1", amount: 1000, currency: "USD", bucket: "NEEDS", description: "Rent", date: "2026-08-01" },
        { id: "t2", amount: 500, currency: "USD", bucket: "WANTS", description: "Fun", date: "2026-08-02" },
        { id: "t3", amount: 300, currency: "USD", bucket: "SAVINGS", description: "Save", date: "2026-08-03" },
      ],
    });
    const dashData = computeDashboard(data);

    render(<StatisticsScreen financials={data} dashData={dashData} />);

    // "Net" also appears as a <th> in the six-month trend table elsewhere
    // on this same screen -- scope to the comparison section specifically.
    const comparisonHeading = screen.getByText("This month vs. last month");
    const comparisonSection = comparisonHeading.closest("div")!;
    const netLabel = within(comparisonSection).getByText("Net");
    const netRow = netLabel.closest("div");
    // Correct: 3000 - 1000 - 500 - 300 = 1200. Buggy (pre-fix): 3000 - 1000 - 500 = 1500.
    expect(netRow?.textContent).toContain("$1,200");
    expect(netRow?.textContent).not.toContain("$1,500");
  });

  it("matches dashData.month.netCashFlow for the current month exactly -- same figure this screen already shows elsewhere", () => {
    const data = makeData({
      income: 3000,
      transactions: [
        { id: "t1", amount: 1000, currency: "USD", bucket: "NEEDS", description: "Rent", date: "2026-08-01" },
        { id: "t2", amount: 500, currency: "USD", bucket: "WANTS", description: "Fun", date: "2026-08-02" },
        { id: "t3", amount: 300, currency: "USD", bucket: "SAVINGS", description: "Save", date: "2026-08-03" },
      ],
    });
    const dashData = computeDashboard(data);
    expect(dashData.month.netCashFlow).toBe(1200);

    render(<StatisticsScreen financials={data} dashData={dashData} />);

    // "Net" also appears as a <th> in the six-month trend table elsewhere
    // on this same screen -- scope to the comparison section specifically.
    const comparisonHeading = screen.getByText("This month vs. last month");
    const comparisonSection = comparisonHeading.closest("div")!;
    const netLabel = within(comparisonSection).getByText("Net");
    const netRow = netLabel.closest("div");
    expect(netRow?.textContent).toContain(`$${dashData.month.netCashFlow.toLocaleString()}`);
  });
});
