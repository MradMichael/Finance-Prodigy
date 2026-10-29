// Plan J (FIX_PLANS.md; owner-approved, session 22: J1 this cycle onward, so
// TIME-01 closes as by design and the income half isn't built; J2 schema v9;
// J3 a lira balance check in lira at the check day's rate; J4 later). HELD.
// A dated log of rate edits: each entry is priced at the rate in effect on
// its own day; held values (net worth, holdings) stay on today's rate; past
// cycles are unchanged. Each finding reproduced first:
// - 2.4.90's residual: a mid-cycle rate edit re-priced spending already
//   entered this cycle (AUDIT's example: L£1,200,000 on 2 Sep, $13.41 at
//   89,500, became $10.00 after an edit to 120,000 on 20 Sep).
// - CUR-04: a lira balance check's actual re-converted at its cycle's rate
//   while its expectation stayed frozen: a false mismatch after a later edit.
// - CUR-05: in the edit sheet (components/ test).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { computeDashboard } from "./computeDashboard";
import { DEFAULT_DATA, migrateFinancials, rateOn, recordRateEdit, CURRENT_SCHEMA_VERSION, type LocalFinancials, type StoredTransaction, type TrackedBalance } from "./localData";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 8, 25, 12, 0)); }); // 25 Sep 2026
afterEach(() => { vi.useRealTimers(); });

// Payday the 1st: September's cycle is 1–30 Sep.
const base = (o: Partial<LocalFinancials> = {}) => ({
  ...DEFAULT_DATA, income: 3000, cycleStartDay: 1, lbpRate: 120_000,
  lbpRateHistory: [{ ym: "2026-08", value: 89_500 }, { ym: "2026-09", value: 120_000 }],
  lbpRateLog: [{ from: "2026-08-01", value: 89_500 }, { from: "2026-09-20", value: 120_000 }],
  ...o,
}) as LocalFinancials;
const lira = (id: string, date: string, amount: number, bucket = "WANTS") => ({ id, amount, currency: "LBP", bucket, description: id, date }) as StoredTransaction;

describe("rateOn: the rate in effect on a day", () => {
  it("is the latest log entry on or before it", () => {
    const d = base();
    expect(rateOn(d, "2026-09-02")).toBe(89_500);
    expect(rateOn(d, "2026-09-19")).toBe(89_500);
    expect(rateOn(d, "2026-09-20")).toBe(120_000);
    expect(rateOn(d, "2026-09-25")).toBe(120_000);
  });
  it("before the log begins, or with no log, falls back as the cycle history and the live rate do today", () => {
    // Before the first entry: exactly today's path (the cycle history, then the live rate), so nothing past moves.
    expect(rateOn(base(), "2026-07-15")).toBe(120_000);
    expect(rateOn(base({ lbpRateLog: undefined }), "2026-08-15")).toBe(89_500); // no log: the cycle's own value
    expect(rateOn({ ...DEFAULT_DATA, lbpRate: 95_000, lbpRateHistory: [], lbpRateLog: [] } as LocalFinancials, "2026-09-01")).toBe(95_000);
  });
});

describe("2.4.90's residual: a mid-cycle edit no longer re-prices what's already entered", () => {
  it("AUDIT's example: L£1,200,000 on 2 Sep stays $13.41 after the edit to 120,000 on 20 Sep", () => {
    const dash = computeDashboard(base({ transactions: [lira("spinneys", "2026-09-02", 1_200_000)] }));
    expect(dash.month.wantsSpend).toBeCloseTo(13.41, 2);
  });
  it("a spend after the edit is priced at the new rate: L£1,200,000 on 21 Sep is $10.00", () => {
    expect(computeDashboard(base({ transactions: [lira("taxi", "2026-09-21", 1_200_000)] })).month.wantsSpend).toBeCloseTo(10, 2);
  });
  it("a backdated entry, typed after the edit, is priced at its own day's rate", () => {
    const entered = { ...lira("backdated", "2026-09-10", 895_000), createdAt: "2026-09-24T10:00:00.000Z" };
    expect(computeDashboard(base({ transactions: [entered] })).month.wantsSpend).toBeCloseTo(10, 2);
  });
  it("held values stay on today's rate: a L£12,000,000 asset is $100 at 120,000", () => {
    const d = base({ assets: [{ id: "a1", name: "Cash at home", value: 12_000_000, currency: "LBP", type: "cash", createdAt: "2026-01-01T00:00:00.000Z" } as never] });
    expect(computeDashboard(d).netWorth.total).toBe(100);
  });
  it("past cycles are unchanged: August's L£895,000 is still $10.00", () => {
    const d = base({ transactions: [lira("aug", "2026-08-15", 895_000)] });
    const aug = computeDashboard(d).sixMonthTrend.find((m) => m.ymKey === 202608)!;
    expect(aug.spend).toBeCloseTo(10, 2);
  });
});

describe("CUR-04: a lira balance check isn't re-priced by a later edit in its cycle", () => {
  const tb = (rateAfter: number): LocalFinancials => {
    const checked: TrackedBalance = { id: "tb1", name: "Cash", paymentMethod: "cash", currency: "LBP", startingBalance: 8_950_000, startingDate: "2026-09-01", actualBalance: 8_950_000, actualBalanceDate: "2026-09-05T09:00:00.000Z", expectedAtCheckUSD: 100 };
    return base({ lbpRate: rateAfter, lbpRateHistory: [{ ym: "2026-09" as never, value: rateAfter }], lbpRateLog: [{ from: "2026-09-01", value: 89_500 }, { from: "2026-09-15", value: rateAfter }], trackedBalances: [checked] });
  };
  it("a check at 89,500, then an edit to 100,000: no mismatch", () => {
    const check = computeDashboard(tb(100_000)).balanceChecks[0];
    expect(check.actual).toBeCloseTo(100, 2);
    expect(check.discrepancy ?? 0).toBeCloseTo(0, 2);
  });
  it("and an edit the other way, to 80,000: no mismatch either", () => {
    const check = computeDashboard(tb(80_000)).balanceChecks[0];
    expect(check.actual).toBeCloseTo(100, 2);
    expect(check.discrepancy ?? 0).toBeCloseTo(0, 2);
  });
});

describe("the log is written at the edit", () => {
  it("an edit appends an entry dated the local day", () => {
    const d = recordRateEdit(base(), 125_000, new Date(2026, 8, 25, 23, 30));
    expect(d.lbpRate).toBe(125_000);
    expect(d.lbpRateLog!.at(-1)).toMatchObject({ from: "2026-09-25", value: 125_000 });
    expect(d.lbpRateLog).toHaveLength(3);
  });
  it("a second edit the same day replaces that day's entry only", () => {
    const once = recordRateEdit(base(), 125_000, new Date(2026, 8, 25, 9, 0));
    const twice = recordRateEdit(once, 126_000, new Date(2026, 8, 25, 18, 0));
    expect(twice.lbpRateLog!.filter((e) => e.from === "2026-09-25")).toEqual([expect.objectContaining({ value: 126_000 })]);
    expect(twice.lbpRateLog).toHaveLength(3);
  });
  it("a Beirut DST night: an edit at 00:30 local belongs to that local day, not the UTC one", () => {
    const d = recordRateEdit(base(), 125_000, new Date(2026, 9, 25, 0, 30));
    expect(d.lbpRateLog!.at(-1)!.from).toBe("2026-10-25");
  });
});

describe("J2: schema v9", () => {
  it("plan J took v9; the current version is 10 (DI-01, session 30)", () => expect(CURRENT_SCHEMA_VERSION).toBe(10));
  it("a v8 copy gains the log from its cycle history, each entry from its cycle's first day; the history is kept", () => {
    const v8 = { ...DEFAULT_DATA, schemaVersion: 8, cycleStartDay: 27, lbpRate: 89_500, lbpRateHistory: [{ ym: "2026-08", value: 89_500 }, { ym: "2026-09", value: 90_000 }] };
    const m = migrateFinancials(v8);
    expect(m.schemaVersion).toBe(10); // on through DI-01's v10 (session 30)
    expect(m.lbpRateLog).toEqual([{ from: "2026-08-27", value: 89_500 }, { from: "2026-09-27", value: 90_000 }]);
    expect(m.lbpRateHistory).toEqual(v8.lbpRateHistory);
  });
  it("runs once: a copy already at v9 keeps its log as it is", () => {
    const v9 = { ...DEFAULT_DATA, schemaVersion: 9, lbpRateLog: [{ from: "2026-09-20", value: 120_000 }] };
    expect(migrateFinancials(v9).lbpRateLog).toEqual([{ from: "2026-09-20", value: 120_000 }]);
  });
});
