// Plan J on screen (session 22; HELD). The rate was L£89,500 per $1 until an
// edit to 120,000 on 20 Sep (the log: 89,500 from 1 Sep, 120,000 from 20 Sep).
// - CUR-05: the edit sheet showed a past lira entry's emergency-fund portion
//   at today's rate (L£1,200,000 for what was typed as L£895,000), so
//   correcting it to what was typed moved the fund. It's now shown and saved
//   at the entry's own day's rate. The entry form prices a backdated draw at
//   its day's rate too.
// - A rate edit writes the log.
// - J3: a lira balance check reads in lira, at its own day's rate.
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import EditTransactionSheet from "./EditTransactionSheet";
import CurrencyScreen from "./screens/CurrencyScreen";
import BalanceCheckScreen from "./screens/BalanceCheckScreen";
import { ThemeProvider } from "../contexts/ThemeContext";
import { computeDashboard } from "../lib/computeDashboard";
import { DEFAULT_DATA, type LocalFinancials, type StoredTransaction, type TrackedBalance } from "../lib/localData";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 8, 25, 12, 0)); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

const base = (o: Partial<LocalFinancials> = {}) => ({
  ...DEFAULT_DATA, income: 3000, cycleStartDay: 1, lbpRate: 120_000,
  lbpRateHistory: [{ ym: "2026-09", value: 120_000 }],
  lbpRateLog: [{ from: "2026-09-01", value: 89_500 }, { from: "2026-09-20", value: 120_000 }],
  ...o,
}) as LocalFinancials;

it("CUR-05: a past lira entry's emergency-fund draw shows as typed, L£895,000, and saving it unchanged leaves the fund at −$10", () => {
  const tx = { id: "t1", amount: 895_000, currency: "LBP", bucket: "NEEDS", description: "Generator", date: "2026-09-02", efAmount: -10 } as StoredTransaction;
  const data = base({ transactions: [tx] });
  const onChange = vi.fn<(d: LocalFinancials) => void>();
  render(<ThemeProvider><EditTransactionSheet transaction={tx} financials={data} onChange={onChange} onClose={vi.fn()} /></ThemeProvider>);
  const box = screen.getByText("Emergency fund").parentElement!.parentElement!;
  expect((box.querySelector("input") as HTMLInputElement).value.replace(/,/g, "")).toBe("-895000");
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(onChange.mock.calls.at(-1)![0].transactions.find((t) => t.id === "t1")!.efAmount).toBe(-10);
});

it("a rate edit on the Currency screen writes the log, dated today", () => {
  const data = base();
  const onChange = vi.fn<(d: LocalFinancials) => void>();
  render(<ThemeProvider><CurrencyScreen financials={data} onChange={onChange} /></ThemeProvider>);
  const field = document.getElementById("currency-lbp-rate") as HTMLInputElement;
  fireEvent.change(field, { target: { value: "125000" } });
  fireEvent.blur(field, { target: { value: "125000" } });
  const written = onChange.mock.calls.at(-1)![0];
  expect(written.lbpRate).toBe(125_000);
  expect(written.lbpRateLog!.at(-1)).toMatchObject({ from: "2026-09-25", value: 125_000 });
});

it("J3: a lira balance check reads in lira at its own day's rate: expected L£8,950,000, you said L£8,950,000", () => {
  const tb: TrackedBalance = { id: "tb1", name: "Cash at home", paymentMethod: "cash", currency: "LBP", startingBalance: 8_950_000, startingDate: "2026-09-01", actualBalance: 8_950_000, actualBalanceDate: "2026-09-05T09:00:00.000Z", expectedAtCheckUSD: 100 };
  const data = base({ lbpRate: 100_000, lbpRateLog: [{ from: "2026-09-01", value: 89_500 }, { from: "2026-09-15", value: 100_000 }], trackedBalances: [tb] });
  render(<ThemeProvider><BalanceCheckScreen financials={data} dashData={computeDashboard(data)} onChange={vi.fn()} /></ThemeProvider>);
  const row = (label: string) => screen.getAllByText(label)[0].nextElementSibling?.textContent;
  expect(row("Expected at check-in")).toBe("L£8,950,000");
  expect(row("You said you had")).toBe("L£8,950,000");
  expect(screen.queryByText("Difference")).toBeNull();
});
