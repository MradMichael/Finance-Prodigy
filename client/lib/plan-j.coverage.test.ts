// Plan J (session 22; HELD): two parts no test reached, found by the
// perturbation run (they pass as written; each perturbation now fails here).
// - A past cycle's totals (periodTotals: the rollover and every per-cycle
//   view) price each row at its own day's rate, not today's.
// - A merge keeps both devices' rate edits: each device's log entries by day.
import { it, expect } from "vitest";
import { periodTotals } from "./computeDashboard";
import { mergeFinancials } from "./syncMerge";
import { seenOf } from "./syncSeen";
import { DEFAULT_DATA, makeToUSDOn, type LocalFinancials, type StoredTransaction } from "./localData";
import { asCycleKey } from "./period";

const spend = (id: string, amount: number, date: string) => ({ id, amount, currency: "LBP", bucket: "WANTS", category: "dining", description: id, date, createdAt: `${date}T12:00:00.000Z` }) as StoredTransaction;

it("a past cycle's totals price each row at its own day's rate: September's L£895,000 on the 2nd is $10, not today's $5", () => {
  const d = { ...DEFAULT_DATA, cycleStartDay: 1, income: 3000, lbpRate: 179_000,
    lbpRateHistory: [{ ym: asCycleKey("2026-09"), value: 179_000 }],
    lbpRateLog: [{ from: "2026-09-01", value: 89_500 }, { from: "2026-09-20", value: 179_000 }],
    transactions: [spend("dinner", 895_000, "2026-09-02"), spend("taxi", 1_790_000, "2026-09-25")] } as LocalFinancials;
  expect(periodTotals(d, asCycleKey("2026-09"), new Date(2026, 9, 14)).wants).toBe(20);
  expect(makeToUSDOn(d)(895_000, "LBP", "2026-09-02")).toBe(10);
});

it("a merge keeps both devices' edits from the log they shared", () => {
  const base = { ...DEFAULT_DATA, income: 3000, lbpRate: 89_500, lbpRateLog: [{ from: "2026-10-01", value: 89_500 }] } as LocalFinancials;
  const laptop = { ...base, lbpRate: 179_000, lbpRateLog: [...base.lbpRateLog!, { from: "2026-10-10", value: 179_000, at: "2026-10-10T09:00:00.000Z" }] } as LocalFinancials;
  const phone = { ...base, lbpRate: 200_000, lbpRateLog: [...base.lbpRateLog!, { from: "2026-10-12", value: 200_000, at: "2026-10-12T09:00:00.000Z" }] } as LocalFinancials;
  const merged = mergeFinancials(laptop, phone, new Date("2026-10-13T09:00:00.000Z"), seenOf(base)).data;
  expect(merged.lbpRateLog!.map(({ from, value }) => ({ from, value }))).toEqual([
    { from: "2026-10-01", value: 89_500 }, { from: "2026-10-10", value: 179_000 }, { from: "2026-10-12", value: 200_000 },
  ]);
});
