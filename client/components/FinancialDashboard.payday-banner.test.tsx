// The one-cycle payday banner.
//
// The point of interest is that it EXPIRES BY ITSELF. It is gated on
// cycleStartDayChangedAt -- a timestamp -- rather than a seen-flag, so once
// the cycle it was set in is no longer the current cycle, the banner is gone
// with nothing persisted and nothing to clean up. The tests that matter are
// therefore the two absence cases, not the presence one.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import FinancialDashboard from "./FinancialDashboard";
import { computeDashboard } from "../lib/computeDashboard";
import { DEFAULT_DATA, type LocalFinancials } from "../lib/localData";

vi.mock("next/navigation", () => ({
  // One stable object, not a fresh one per render: a new object each time
  // makes any effect depending on the router re-run every render (2.4.84).
  useRouter: () => ROUTER,
}));
const ROUTER = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn() };

const NOW = new Date(2026, 8, 30); // 30 Sep 2026 -- inside the 27-Sep cycle
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); cleanup(); });

function renderDash(overrides: Partial<LocalFinancials>) {
  const data = { ...DEFAULT_DATA, income: 3000, ...overrides } as LocalFinancials;
  render(<FinancialDashboard data={computeDashboard(data)} financials={data} />);
}
const banner = () => screen.queryByText(/Your budget cycle now runs/i);

describe("the payday banner", () => {
  it("explains the first cycle under a new boundary, naming the range", () => {
    renderDash({ cycleStartDay: 27, cycleStartDayChangedAt: new Date(2026, 8, 28).toISOString() });
    // Read off the banner's own text rather than a separate getByText, so
    // the assertion cannot pass by matching the range somewhere else on the
    // page (the header carries it too).
    expect(banner()!.textContent).toMatch(/27 Sep – 26 Oct/);
  });

  it("is gone once the cycle has advanced -- no flag, no dismissal, no cleanup", () => {
    // Changed during the PREVIOUS cycle (27 Aug - 26 Sep). Same stored data,
    // one cycle later: the banner expires purely because the key moved on.
    renderDash({ cycleStartDay: 27, cycleStartDayChangedAt: new Date(2026, 8, 10).toISOString() });
    expect(banner()).toBeNull();
  });

  it("never appears for an account that has not set a payday", () => {
    renderDash({});
    expect(banner()).toBeNull();
  });

  it("does not appear when payday was set back to 1 -- there is no cycle to explain", () => {
    renderDash({ cycleStartDay: 1, cycleStartDayChangedAt: new Date(2026, 8, 28).toISOString() });
    expect(banner()).toBeNull();
  });

  it("can be dismissed for the rest of the cycle", () => {
    // fireEvent, not userEvent: userEvent hangs under the fake timers this
    // file needs for its date assertions (a trap this project has hit
    // before). A dismiss button needs nothing userEvent provides.
    renderDash({ cycleStartDay: 27, cycleStartDayChangedAt: new Date(2026, 8, 28).toISOString() });
    fireEvent.click(screen.getByRole("button", { name: /Dismiss/i }));
    expect(banner()).toBeNull();
  });
});
