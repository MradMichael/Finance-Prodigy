// Item 3e (owner, session 25): COPY-06's last part. Plan J's J3 put a lira
// balance check's "Expected at check-in" and "You said you had" in lira; the
// tracked-balance list's "Expected now" still read in dollars. It now reads in
// lira for a lira balance, at the check day's rate (J3's rule), or the start
// day's for a balance not yet checked (CUR-04's day). Dollar balances are
// unchanged.
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import BalanceCheckScreen from "./BalanceCheckScreen";
import { ThemeProvider } from "../../contexts/ThemeContext";
import { computeDashboard } from "../../lib/computeDashboard";
import { DEFAULT_DATA, type LocalFinancials, type TrackedBalance } from "../../lib/localData";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 8, 25, 12, 0)); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

// Live rate 100,000; 89,500 until 15 September.
const base = (trackedBalances: TrackedBalance[]) => ({
  ...DEFAULT_DATA, income: 3000, cycleStartDay: 1, lbpRate: 100_000,
  lbpRateHistory: [{ ym: "2026-09", value: 100_000 }],
  lbpRateLog: [{ from: "2026-09-01", value: 89_500 }, { from: "2026-09-15", value: 100_000 }],
  trackedBalances,
}) as LocalFinancials;
const expectedNow = () => screen.getByText(/^Expected now:/).querySelector("span")?.textContent;
const show = (data: LocalFinancials) => render(<ThemeProvider><BalanceCheckScreen financials={data} dashData={computeDashboard(data)} onChange={vi.fn()} /></ThemeProvider>);

it("a lira balance checked on 5 September reads L£8,950,000 at that day's 89,500, not dollars, though the live rate is now 100,000", () => {
  show(base([{ id: "tb1", name: "Cash at home", paymentMethod: "cash", currency: "LBP", startingBalance: 8_950_000, startingDate: "2026-09-01", actualBalance: 8_950_000, actualBalanceDate: "2026-09-05T09:00:00.000Z", expectedAtCheckUSD: 100 }]));
  expect(expectedNow()).toBe("L£8,950,000");
});

it("a lira balance not yet checked reads in lira at its start day's rate", () => {
  show(base([{ id: "tb2", name: "Wallet", paymentMethod: "cash", currency: "LBP", startingBalance: 8_950_000, startingDate: "2026-09-01" } as TrackedBalance]));
  expect(expectedNow()).toBe("L£8,950,000");
});

it("a dollar balance still reads in dollars", () => {
  show(base([{ id: "tb3", name: "Card", paymentMethod: "cash", currency: "USD", startingBalance: 250, startingDate: "2026-09-01", actualBalance: 250, actualBalanceDate: "2026-09-05T09:00:00.000Z", expectedAtCheckUSD: 250 }]));
  expect(expectedNow()).toMatch(/^\$250/);
});
