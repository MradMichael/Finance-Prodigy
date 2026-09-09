import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildReportHtml } from "./printReport";
import { computeDashboard } from "./computeDashboard";
import { DEFAULT_DATA, type LocalFinancials, type StoredTransaction } from "./localData";

const NOW = new Date(2026, 7, 15); // August 15, 2026

function makeData(overrides: Partial<LocalFinancials> = {}): LocalFinancials {
  return {
    ...DEFAULT_DATA,
    income: 3000,
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("buildReportHtml -- detailed ledger LBP historization (2.4.22)", () => {
  it("converts an LBP transaction at the rate that was in effect in ITS OWN month, not today's flat rate", () => {
    // Today's live rate is 90,000. January's historized rate was 80,000.
    // An 8,000,000 LBP transaction dated in January must convert at 80,000
    // ($100), not at today's 90,000 (~$88.89) -- the exact gap 2.4.22 found:
    // the PDF disagreeing with Overview/Statistics, which already use
    // toUSDForMonth for this.
    const tx: StoredTransaction = {
      id: "t1", amount: 8_000_000, currency: "LBP", bucket: "NEEDS",
      description: "Old bill", date: "2026-01-15",
    };
    const data = makeData({
      lbpRate: 90000,
      lbpRateHistory: [{ ym: "2026-01", value: 80000 }],
      transactions: [tx],
    });
    const dash = computeDashboard(data);
    const html = buildReportHtml("Test User", data, dash, { detailed: true });
    expect(html).toContain("$100");
    expect(html).not.toContain("$89");
  });

  it("still uses today's live rate for a transaction with no historized month entry", () => {
    const tx: StoredTransaction = {
      id: "t1", amount: 900_000, currency: "LBP", bucket: "NEEDS",
      description: "Recent bill", date: "2026-08-10",
    };
    const data = makeData({ lbpRate: 90000, lbpRateHistory: [], transactions: [tx] });
    const dash = computeDashboard(data);
    const html = buildReportHtml("Test User", data, dash, { detailed: true });
    expect(html).toContain("$10");
  });
});

// 2.4.72: this file's own toUSDForMonth divided by valueForMonth(...)
// directly, so a zero stored history entry rendered "$Infinity" into the
// exported report. It now routes through makeToUSDForMonth.
describe("buildReportHtml -- a zero rate in history cannot render Infinity into the report (2.4.72)", () => {
  it("falls back to the default rate instead of dividing by a zero history entry", () => {
    const tx: StoredTransaction = {
      id: "t1", amount: 895_000, currency: "LBP", bucket: "NEEDS",
      description: "Groceries", date: "2026-08-10",
    };
    const data = makeData({
      lbpRate: 89_500,
      lbpRateHistory: [{ ym: "2026-01", value: 0 }],
      transactions: [tx],
    });
    const html = buildReportHtml("Test", data, computeDashboard(data), { detailed: true });

    expect(html).not.toContain("Infinity");
    expect(html).not.toContain("NaN");
    // L£895,000 at the fallback rate (89,500) is $10 -- the value proves
    // the zero entry was replaced rather than the row being dropped.
    expect(html).toContain("$10");
  });
});
