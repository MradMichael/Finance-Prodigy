// COPY-08 on the Currency screen: "Rate last updated N days ago" counts
// calendar days, the same as the Overview alert (lib/rate-age.test.ts).
import { it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import CurrencyScreen from "./CurrencyScreen";
import { ThemeProvider } from "../../contexts/ThemeContext";
import { DEFAULT_DATA, type LocalFinancials } from "../../lib/localData";

afterEach(() => { cleanup(); vi.useRealTimers(); });

it("an edit 20 calendar days ago reads 20 days, even an hour short of 20 full days", () => {
  vi.useFakeTimers({ now: new Date(2026, 9, 7, 8), toFake: ["Date"] });
  const d = { ...DEFAULT_DATA, income: 3000, lbpRate: 89_500, lbpRateUpdatedAt: new Date(2026, 8, 17, 9).toISOString() } as LocalFinancials;
  render(<ThemeProvider><CurrencyScreen financials={d} onChange={vi.fn()} /></ThemeProvider>);
  expect(document.body.textContent).toContain("20 days ago");
  expect(document.body.textContent).not.toContain("19 days ago");
});
