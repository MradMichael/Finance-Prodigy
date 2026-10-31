// R1 (session 32 review): My Finances built a row for every past entry on every render, while History
// was closed -- 500 ms a render at 15,000 entries on a desktop, 0.65 s per action on a mid-range phone at
// 1,500. The rows are built only while History is open. Counted through the per-row helper
// (cycleMonthDivergence), which every row in both lists calls once.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type * as LocalData from "../lib/localData";

const calls = vi.hoisted(() => ({ n: 0 }));
vi.mock("../lib/localData", async (orig) => {
  const actual = await orig<typeof LocalData>();
  return {
    ...actual,
    cycleMonthDivergence: (...a: Parameters<typeof actual.cycleMonthDivergence>) => { calls.n++; return actual.cycleMonthDivergence(...a); },
  };
});

import InputPanel from "./InputPanel";
import { computeDashboard } from "../lib/computeDashboard";
import { DEFAULT_DATA, type LocalFinancials, type StoredTransaction } from "../lib/localData";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-15T12:00:00")); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

const tx = (i: number, date: string, description: string): StoredTransaction => ({
  id: `t${i}`, amount: 10 + i, currency: "USD", bucket: "NEEDS", category: "groceries", description, date, paymentMethod: "cash",
});

function data(): LocalFinancials {
  const thisCycle = [tx(1, "2026-10-02", "Now one"), tx(2, "2026-10-05", "Now two"), tx(3, "2026-10-09", "Now three")];
  const past = Array.from({ length: 300 }, (_, i) => {
    const month = String(1 + (i % 9)).padStart(2, "0"); // January to September 2026
    return tx(100 + i, `2026-${month}-${String(1 + (i % 27)).padStart(2, "0")}`, i === 0 ? "Earlier marker" : `Past ${i}`);
  });
  return { ...DEFAULT_DATA, income: 3000, transactions: [...thisCycle, ...past] } as LocalFinancials;
}

function renderPanel() {
  const d = data();
  const dash = computeDashboard(d);
  calls.n = 0;
  render(<InputPanel financials={d} dashData={dash} onChange={vi.fn()} onEdit={vi.fn()} onPay={vi.fn()} />);
}

describe("My Finances builds History's rows only while it's open", () => {
  it("closed: the per-row work runs for this cycle's rows, not for the 300 past ones", () => {
    renderPanel();
    // Premise: this cycle's rows are there, and History is closed with its count.
    expect(screen.getByText("Now one")).toBeTruthy();
    expect(screen.queryByText("Earlier marker")).toBeNull();
    expect(screen.getByText("300")).toBeTruthy();
    expect(calls.n).toBeGreaterThan(0);
    expect(calls.n).toBeLessThan(50);
  });

  it("opened: the past rows are built and shown", () => {
    renderPanel();
    const before = calls.n;
    fireEvent.click(screen.getByRole("button", { name: /History/ }));
    expect(screen.getByText("Earlier marker")).toBeTruthy();
    expect(calls.n - before).toBeGreaterThanOrEqual(300);
  });
});
