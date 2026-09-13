// Balance Check as its own page.
//
// A presentation move, so the tests are about WHERE the reconciliation lives
// rather than what it computes — the arithmetic is already covered by
// computeDashboard.test.ts and is untouched here.
//
// The decision these lock: the reconciliation verdict (badge, frozen
// discrepancy, the 2.4.53/2.4.64 residual copy) lives in exactly ONE place.
// Overview keeps only its non-verdict "expected" readout and the alert that
// already existed. Two surfaces rendering the same verdict is how the
// cross-surface disagreements this project keeps logging begin, so "Overview
// no longer renders it" is asserted directly rather than assumed from the
// diff.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import BalanceCheckScreen from "./BalanceCheckScreen";
import FinancialDashboard from "../FinancialDashboard";
import { computeDashboard } from "../../lib/computeDashboard";
import { DEFAULT_DATA, type LocalFinancials } from "../../lib/localData";

// One stable object -- next/navigation returns a stable reference, and a
// fresh one per call puts the page into a render loop (2.4.84).
const ROUTER = { replace: vi.fn(), push: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => ROUTER }));

const NOW = new Date(2026, 8, 13);
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); cleanup(); });

/**
 * One tracked balance with a REAL, checked-in mismatch: expected $100 from
 * the ledger, user confirmed $60, so a frozen discrepancy of -$40 that the
 * verdict apparatus must report.
 */
function makeData(overrides: Partial<LocalFinancials> = {}): LocalFinancials {
  return {
    ...DEFAULT_DATA,
    income: 3000,
    budgetRule: "50-30-20",
    trackedBalances: [
      {
        id: "tb1", name: "Wallet", paymentMethod: "cash",
        startingBalance: 100, startingDate: "2026-09-01", currency: "USD",
        actualBalance: 60, actualBalanceDate: "2026-09-10T00:00:00.000Z",
        expectedAtCheckUSD: 100,
      },
    ],
    ...overrides,
  } as LocalFinancials;
}

function renderPage(overrides: Partial<LocalFinancials> = {}) {
  const data = makeData(overrides);
  const dash = computeDashboard(data);
  render(<BalanceCheckScreen financials={data} dashData={dash} onChange={vi.fn()} />);
  return dash;
}

describe("BalanceCheckScreen — the page owns the reconciliation", () => {
  it("renders the tracked balance and its verdict", () => {
    renderPage();
    // "Wallet" appears twice by design: once on its reconciliation card and
    // once in the tracked-balances list below it. Two views of one balance on
    // one page, not two sources -- both read the same dashData entry.
    expect(screen.getAllByText("Wallet").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Mismatch/i).length).toBeGreaterThan(0);
  });

  it("shows the frozen discrepancy computed by computeDashboard, not a re-derivation", () => {
    const dash = renderPage();
    // Premise: the fixture really does produce a non-zero discrepancy, so the
    // assertion below cannot pass against a page that renders nothing.
    const check = dash.balanceChecks.find((b) => b.id === "tb1")!;
    expect(check.discrepancy).toBe(-40);
    expect(document.body.textContent).toContain("40");
  });

  it("offers the check-in control and the add form, so one surface owns the whole feature", () => {
    renderPage();
    expect(screen.getByPlaceholderText(/What you actually have now/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Track this balance/i })).toBeTruthy();
  });

  it("renders an empty state rather than a bare page when nothing is tracked", () => {
    renderPage({ trackedBalances: [] });
    expect(screen.getByRole("button", { name: /Track this balance/i })).toBeTruthy();
    expect(screen.queryByText("Wallet")).toBeNull();
  });
});

describe("Overview no longer duplicates the reconciliation", () => {
  const renderOverview = () => {
    const data = makeData();
    const dash = computeDashboard(data);
    render(
      <FinancialDashboard
        data={dash}
        onNavigate={vi.fn()}
        onConfirmRecurring={vi.fn()}
        loggingRecurringIds={new Set()}
        justConfirmedIds={new Set()}
      />,
    );
    return dash;
  };

  it("does NOT render the verdict badge — that now lives only on the page", () => {
    renderOverview();
    expect(screen.queryByText(/Mismatch/i)).toBeNull();
  });

  it("DOES still render the non-verdict expected readout — the move must not over-remove", () => {
    // This line sits in the cash-flow panel beside "Left this month". It
    // states what should be in the pool and renders no judgement, so it is
    // not a second copy of the reconciliation and is deliberately kept.
    renderOverview();
    expect(screen.getByText(/Wallet \(expected\)/i)).toBeTruthy();
  });

  it("still surfaces the mismatch as an alert, so the signal survives the move", () => {
    const dash = renderOverview();
    const alert = dash.alerts.find((a) => a.id === "balance-tb1");
    expect(alert).toBeTruthy();
    // And it must route to the page that now holds the reconciliation, not
    // to the surface it was moved off.
    expect(alert!.screen).toBe("balancecheck");
  });
});
