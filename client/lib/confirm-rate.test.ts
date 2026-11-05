// Rate staleness, phase 1 (owner-approved 2026-11-05): "the rate is still
// correct" in one tap. confirmRate says the rate was checked; it does not
// edit it. Owner's answer 1: it writes lbpRateUpdatedAt and does NOT advance
// settingsUpdatedAt.lbpRate, so a real change on another device always wins
// a clash.
//
// Found before this was built, by probe: a confirm built as
// recordRateEdit(d, sameValue) beat a real change made earlier the same day
// on another device -- the merged rate came back as the OLD value (89,500
// over a real 100,000), because recordRateEdit advances settingsUpdatedAt and
// writes a same-day lbpRateLog entry whose `at` is later. Hence confirmRate
// touches neither the edit time nor the log.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DEFAULT_DATA, confirmRate, recordRateEdit, rateOn, type LocalFinancials, type StoredTransaction } from "./localData";
import { computeDashboard } from "./computeDashboard";
import { mergeFinancials } from "./syncMerge";
import { seenOf } from "./syncSeen";
import { clashSentence } from "./syncService";

const NOW = new Date(2026, 10, 5, 10, 0); // 5 Nov 2026, 10:00 local
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); });

// Payday the 1st. A rate history with a real past change, so "unchanged for
// every day" is tested against a log that actually varies.
const lira = (id: string, date: string, amount: number) =>
  ({ id, amount, currency: "LBP", bucket: "WANTS", description: id, date }) as StoredTransaction;
function fixture(): LocalFinancials {
  let d = { ...DEFAULT_DATA, income: 3000, cycleStartDay: 1, lbpRate: 89_500 } as LocalFinancials;
  d = recordRateEdit(d, 89_500, new Date(2026, 8, 3, 9));   // 3 Sep
  d = recordRateEdit(d, 95_000, new Date(2026, 9, 10, 9));  // 10 Oct
  d = recordRateEdit(d, 89_500, new Date(2026, 9, 20, 9));  // 20 Oct: 16 days before NOW, stale
  return {
    ...d,
    transactions: [lira("sep", "2026-09-15", 1_790_000), lira("oct", "2026-10-12", 1_900_000), lira("nov", "2026-11-02", 895_000)],
    assets: [{ id: "a1", name: "Cash at home", value: 8_950_000, currency: "LBP", type: "cash", createdAt: "2026-01-01T00:00:00.000Z" } as never],
  };
}

describe("confirmRate: says the rate was checked, changes nothing else", () => {
  it("stamps lbpRateUpdatedAt with the instant given, and nothing else", () => {
    const d = fixture();
    const c = confirmRate(d, NOW);
    expect(c.lbpRateUpdatedAt).toBe(NOW.toISOString());
    const { lbpRateUpdatedAt: _a, ...before } = d;
    const { lbpRateUpdatedAt: _b, ...after } = c;
    expect(after).toEqual(before);
  });

  it("does not advance settingsUpdatedAt.lbpRate (owner's answer 1)", () => {
    const d = fixture();
    expect(confirmRate(d, NOW).settingsUpdatedAt).toEqual(d.settingsUpdatedAt);
    expect(confirmRate(d, NOW).settingsUpdatedAt?.lbpRate).toBe(new Date(2026, 9, 20, 9).toISOString());
  });

  it("writes no rate-log entry, so the rate in effect is unchanged on every day", () => {
    const d = fixture();
    const c = confirmRate(d, NOW);
    expect(c.lbpRateLog).toEqual(d.lbpRateLog);
    for (const day of ["2026-08-15", "2026-09-01", "2026-09-15", "2026-10-12", "2026-10-20", "2026-11-01", "2026-11-04", "2026-11-05"]) {
      expect(rateOn(c, day)).toBe(rateOn(d, day));
    }
  });

  it("rule 4: every dollar figure on Overview is the same before and after", () => {
    const d = fixture();
    const before = computeDashboard(d), after = computeDashboard(confirmRate(d, NOW));
    expect(after.month).toEqual(before.month);
    expect(after.netWorth).toEqual(before.netWorth);
    // Premise: the fixture's figures are real, not zeros that trivially agree.
    expect(before.month.wantsSpend).toBeCloseTo(10, 2); // L£895,000 on 2 Nov at 89,500
    expect(before.netWorth.total).toBe(100);           // L£8,950,000 held, at 89,500
  });

  it("clears the stale alert, and only that", () => {
    const d = fixture();
    const ids = (x: LocalFinancials) => computeDashboard(x).alerts.map((a) => a.id).sort();
    expect(ids(d)).toContain("rate-stale");
    expect(ids(confirmRate(d, NOW))).toEqual(ids(d).filter((id) => id !== "rate-stale"));
  });
});

describe("confirmRate across two devices", () => {
  // Both phones synced on 1 Nov; seen is each one's record of that sync.
  const synced = () => fixture();
  const at = (h: number) => new Date(2026, 10, 5, h);

  it("a real change made earlier the same day wins over a later confirm, in both merge orders", () => {
    const start = synced(), seen = seenOf(start);
    const changed = recordRateEdit(start, 100_000, at(9)); // phone B, 09:00: a real change
    const confirmed = confirmRate(start, at(10));          // phone A, 10:00: "still correct"
    for (const m of [mergeFinancials(confirmed, changed, at(11), seen).data, mergeFinancials(changed, confirmed, at(11), seen).data]) {
      expect(m.lbpRate).toBe(100_000);
      expect(m.lbpRateUpdatedAt).toBe(at(9).toISOString()); // the age is the change's, not the confirm's
      expect(m.settingsUpdatedAt?.lbpRate).toBe(at(9).toISOString());
    }
  });

  // Owner, 2026-11-05: pin the notice. Characterization -- this is the
  // existing approved setting sentence (clashSentence, plan H 5d), not new
  // wording; it passed when written. Each merge order is one device's view,
  // and both name the change as kept and the confirmed value as the other.
  // Note it says "Both devices changed" though one only confirmed: the
  // sentence has no way to know, and rewording it needs the owner.
  it("the clash notice: one setting clash, the change kept, told in the approved sentence", () => {
    const start = synced(), seen = seenOf(start);
    const changed = recordRateEdit(start, 100_000, at(9));
    const confirmed = confirmRate(start, at(10));
    for (const r of [mergeFinancials(confirmed, changed, at(11), seen), mergeFinancials(changed, confirmed, at(11), seen)]) {
      expect(r.clashes).toEqual([{ kind: "setting", setting: "lbpRate", kept: 100_000, other: 89_500 }]);
      expect(clashSentence(r.clashes[0])).toBe("Both devices changed your LBP rate — kept L£ 100,000 / $1 (the other device had L£ 89,500 / $1).");
    }
  });

  it("the rate log, same day: today's entry is the change's, so the live rate and today's rate agree", () => {
    const start = synced(), seen = seenOf(start);
    const changed = recordRateEdit(start, 100_000, at(9));
    const confirmed = confirmRate(start, at(10));
    for (const m of [mergeFinancials(confirmed, changed, at(11), seen).data, mergeFinancials(changed, confirmed, at(11), seen).data]) {
      expect(m.lbpRateLog).toEqual(changed.lbpRateLog);
      expect(rateOn(m, "2026-11-05")).toBe(100_000);
      expect(rateOn(m, "2026-11-04")).toBe(89_500); // yesterday untouched
    }
  });

  it("a confirm with no change on the other device reaches it, in both merge orders", () => {
    const start = synced(), seen = seenOf(start);
    const confirmed = confirmRate(start, at(10));
    for (const m of [mergeFinancials(confirmed, start, at(11), seen).data, mergeFinancials(start, confirmed, at(11), seen).data]) {
      expect(m.lbpRateUpdatedAt).toBe(at(10).toISOString());
      expect(m.lbpRate).toBe(89_500);
    }
  });

  it("both devices confirming is not a clash anyone is told about", () => {
    const start = synced(), seen = seenOf(start);
    const r = mergeFinancials(confirmRate(start, at(10)), confirmRate(start, at(9)), at(11), seen);
    expect(r.data.lbpRate).toBe(89_500);
    expect(r.clashes.filter((c) => c.kind === "setting")).toEqual([]);
  });
});
