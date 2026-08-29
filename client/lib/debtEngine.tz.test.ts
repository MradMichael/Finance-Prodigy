// AUD-08 (external audit, 2026-08-28) needs process.env.TZ set to a
// positive-UTC-offset zone to reproduce -- see computeDashboard.tz.test.ts
// for why this is isolated into its own file (V8/Node caches the process's
// resolved timezone and doesn't reliably re-read process.env.TZ after
// deleting it, confirmed directly; leaks into every other date-dependent
// test in a shared file otherwise). Set at module load, before any Date is
// constructed anywhere.
process.env.TZ = "Asia/Beirut"; // UTC+3, this app's own primary audience

import { describe, it, expect } from "vitest";
import { simulateDebtPayoff, type DebtInput } from "./debtEngine";

describe("simulateDebtPayoff cache, local midnight (AUD-08)", () => {
  it("does NOT collide two calls that are on different LOCAL calendar days but the same UTC calendar day", () => {
    const debts: DebtInput[] = [{ id: "d1", name: "Card", balance: 3000, aprPct: 22, minimumPayment: 100 }];
    // 23:30 Beirut (day X) = 20:30 UTC (day X). 01:00 Beirut (day X+1) =
    // 22:00 UTC (still day X) -- same UTC calendar day, different LOCAL one.
    const first = simulateDebtPayoff(debts, 100, "AVALANCHE", new Date(2027, 1, 27, 23, 30, 0));
    const second = simulateDebtPayoff(debts, 100, "AVALANCHE", new Date(2027, 1, 28, 1, 0, 0));
    expect(second.debtFreeDate).not.toBe(first.debtFreeDate);
  });

  it("still treats two calls on the SAME local calendar day as a cache hit (unchanged behavior)", () => {
    const debts: DebtInput[] = [{ id: "d1", name: "Card", balance: 3000, aprPct: 22, minimumPayment: 100 }];
    const first = simulateDebtPayoff(debts, 100, "AVALANCHE", new Date(2027, 1, 27, 9, 0, 0));
    const second = simulateDebtPayoff(debts, 100, "AVALANCHE", new Date(2027, 1, 27, 18, 0, 0));
    expect(second.debtFreeDate).toBe(first.debtFreeDate);
  });
});
