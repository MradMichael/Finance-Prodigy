// Plan J (session 22; HELD), a gap found before the live check: the first
// rate edit on an account whose log has nothing before today (a new account
// carries no log) repriced this cycle's earlier lira entries. rateOn fell back
// to the cycle's history entry for a day the log didn't cover, and the
// load-time snapshot rewrites the current cycle's entry to the live rate after
// every change. So the edit now first records the rate that was in effect, from
// the start of the current cycle, when the log doesn't cover the earlier days.
import { it, expect } from "vitest";
import { DEFAULT_DATA, recordRateEdit, makeToUSDOn, type LocalFinancials, type StoredTransaction } from "./localData";
import { asCycleKey } from "./period";

const spend = (id: string, amount: number, date: string) => ({ id, amount, currency: "LBP", bucket: "WANTS", category: "dining", description: id, date }) as StoredTransaction;
const DAY10 = new Date(2026, 9, 10, 12, 0);
// What the load-time snapshot does after a change: the current cycle's entry takes the live rate.
const snapshot = (d: LocalFinancials, ym: string) => ({ ...d, lbpRateHistory: [...(d.lbpRateHistory ?? []).filter((h) => h.ym !== ym), { ym: asCycleKey(ym), value: d.lbpRate }] }) as LocalFinancials;

it("a new account's first edit leaves a spend from earlier this cycle at its own day's rate: $10, not $5", () => {
  const before = { ...DEFAULT_DATA, cycleStartDay: 1, lbpRate: 89_500, lbpRateHistory: [{ ym: asCycleKey("2026-10"), value: 89_500 }], transactions: [spend("dinner", 895_000, "2026-10-02")] } as LocalFinancials;
  expect(before.lbpRateLog ?? []).toEqual([]);
  const after = snapshot(recordRateEdit(before, 179_000, DAY10), "2026-10");
  const toUSDOn = makeToUSDOn(after);
  expect(toUSDOn(895_000, "LBP", "2026-10-02")).toBe(10);
  expect(toUSDOn(1_790_000, "LBP", "2026-10-10")).toBe(10);
  expect(after.lbpRateLog!.map(({ from, value }) => ({ from, value }))).toEqual([{ from: "2026-10-01", value: 89_500 }, { from: "2026-10-10", value: 179_000 }]);
});

it("on a payday cycle, the rate in effect is recorded from that cycle's first day", () => {
  const before = { ...DEFAULT_DATA, cycleStartDay: 25, lbpRate: 89_500, lbpRateHistory: [{ ym: asCycleKey("2026-09"), value: 89_500 }] } as LocalFinancials;
  const after = recordRateEdit(before, 179_000, DAY10);
  expect(after.lbpRateLog!.map(({ from, value }) => ({ from, value }))).toEqual([{ from: "2026-09-25", value: 89_500 }, { from: "2026-10-10", value: 179_000 }]);
});

it("a log that already covers the earlier days only gains the edit", () => {
  const before = { ...DEFAULT_DATA, cycleStartDay: 1, lbpRate: 100_000, lbpRateLog: [{ from: "2026-09-01", value: 100_000 }] } as LocalFinancials;
  const after = recordRateEdit(before, 179_000, DAY10);
  expect(after.lbpRateLog!.map(({ from, value }) => ({ from, value }))).toEqual([{ from: "2026-09-01", value: 100_000 }, { from: "2026-10-10", value: 179_000 }]);
});

it("a second edit the same day replaces that day's entry, and adds nothing before it", () => {
  const once = recordRateEdit({ ...DEFAULT_DATA, cycleStartDay: 1, lbpRate: 89_500 } as LocalFinancials, 179_000, DAY10);
  const twice = recordRateEdit(once, 150_000, new Date(2026, 9, 10, 18, 0));
  expect(twice.lbpRateLog!.map(({ from, value }) => ({ from, value }))).toEqual([{ from: "2026-10-01", value: 89_500 }, { from: "2026-10-10", value: 150_000 }]);
});
