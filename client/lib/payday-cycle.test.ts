// Phase 2b: what actually changes when a payday is set.
//
// Everything here is asserted at BOTH startDay 1 and startDay 27 against the
// same fixture, because "the figure moved" is only meaningful next to "and it
// did not move before". A test that only ran at 27 could not tell a cycle
// effect from a fixture quirk.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { computeDashboard } from "./computeDashboard";
import { cycleMonthDivergence, DEFAULT_DATA, type LocalFinancials, type StoredTransaction } from "./localData";

const NOW = new Date(2026, 8, 30); // 30 Sep 2026 — inside the 27-Sep cycle, day 4
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); });

const tx = (id: string, date: string, amount: number, bucket: StoredTransaction["bucket"]): StoredTransaction =>
  ({ id, date, amount, currency: "USD", bucket, description: id } as StoredTransaction);

function makeData(cycleStartDay: number | undefined, overrides: Partial<LocalFinancials> = {}): LocalFinancials {
  return {
    ...DEFAULT_DATA, income: 3000, budgetRule: "50-30-20",
    ...(cycleStartDay ? { cycleStartDay } : {}),
    transactions: [
      // Straddles the 27th on purpose: these two are in the SAME calendar
      // month and DIFFERENT cycles once payday is the 27th.
      tx("before", "2026-09-20", 400, "WANTS"),
      tx("after", "2026-09-28", 100, "WANTS"),
    ],
    ...overrides,
  } as LocalFinancials;
}

describe("membership: the boundary is the payday, not the 1st", () => {
  it("at startDay 1 both September transactions are this period", () => {
    const d = computeDashboard(makeData(undefined));
    expect(d.month.wantsSpend).toBe(500);
  });

  it("at startDay 27 only the one on or after the 27th is", () => {
    const d = computeDashboard(makeData(27));
    expect(d.month.wantsSpend).toBe(100);
  });

  it("the 26th is the previous cycle and the 27th is this one — the exact edge", () => {
    const edge = (day: string) => computeDashboard(makeData(27, {
      transactions: [tx("e", `2026-09-${day}`, 50, "WANTS")],
    })).month.wantsSpend;
    expect(edge("26")).toBe(0);  // previous cycle
    expect(edge("27")).toBe(50); // this cycle
  });
});

describe("pacing is measured from the cycle start, not the 1st", () => {
  it("at startDay 1 on the 30th, the month is nearly over", () => {
    const d = computeDashboard(makeData(undefined));
    expect(d.budgetPace[0].pctOfMonthElapsed).toBe(100); // day 30 of 30
  });

  it("at startDay 27 on the 30th, the cycle has barely begun", () => {
    // Day 4 of a 30-day cycle (27 Sep -> 26 Oct) = 13%, not 100%.
    const d = computeDashboard(makeData(27));
    expect(d.budgetPace[0].pctOfMonthElapsed).toBe(13);
  });

  it("cycle length varies 28-31 and pacing follows it", () => {
    // 27 Feb -> 26 Mar is 27 days in 2026; the divisor must be the cycle's
    // own length, not a fixed 30 or the calendar month's.
    vi.setSystemTime(new Date(2026, 1, 28)); // 28 Feb 2026, day 2
    const d = computeDashboard(makeData(27, { transactions: [] }));
    expect(d.budgetPace[0].pctOfMonthElapsed).toBeGreaterThan(0);
    expect(d.budgetPace[0].pctOfMonthElapsed).toBeLessThan(15);
  });
});

describe("the pacing copy no longer claims a calendar date", () => {
  // The branch carrying this message needs BOTH an over-100% projection and
  // at least MIN_DAYS_FOR_PROJECTION (10) days elapsed. On 30 Sep the 27-Sep
  // cycle is only 4 days old, so the branch cannot fire and a test set there
  // would pass without ever rendering the string. Clock moved to day 10.
  it("says how far into the cycle you are, not 'the Nth'", () => {
    vi.setSystemTime(new Date(2026, 9, 6)); // 6 Oct = day 10 of the 27-Sep cycle
    const d = computeDashboard(makeData(27, {
      transactions: [tx("big", "2026-09-28", 800, "WANTS")],
    }));
    const msgs = d.budgetPace.map((p) => p.message).join(" | ");
    // Premise: the branch actually fired, so the assertion below is not
    // measuring an absent string.
    expect(msgs).toMatch(/At this rate/);
    // "it's only the 10th" would be false -- day 10 of this cycle is 6 Oct.
    expect(msgs).not.toMatch(/only the \d+(st|nd|rd|th)/);
    expect(msgs).toMatch(/only 10 days in/);
  });
});

describe("changing payday can retroactively break a savings streak — asserted, not discovered", () => {
  // A contribution on the 28th of each month counts toward THAT calendar
  // month, but under a 27th payday it lands in the cycle that began the
  // previous day -- so the months either side can gain or lose a
  // qualifying contribution. This is the most user-visible consequence of
  // changing payday with history, and it is pinned so it is a known output
  // rather than a support question.
  //
  // FIXTURE CORRECTED. The first version contributed on the 28th of every
  // month, which is on the SAME side of a 27th payday as it is of the 1st --
  // so every contribution stayed in the cycle its own month names and the
  // two configurations should have agreed. They disagreed only because the
  // month-walk was anchored on the 1st (fixed in this phase), so the test
  // was pinning that defect rather than the boundary. The last contribution
  // now lands on the 26th, which genuinely straddles: cycle 2026-08 at
  // startDay 1, cycle 2026-07 at startDay 27.
  const contributions = [
    ...Array.from({ length: 5 }, (_, i) => tx(`s${i}`, `2026-0${i + 3}-28`, 600, "SAVINGS")),
    tx("s5", "2026-08-26", 600, "SAVINGS"),
  ];

  it("the two configurations genuinely produce different streaks for the same data", () => {
    const at1 = computeDashboard(makeData(undefined, { transactions: contributions }));
    const at27 = computeDashboard(makeData(27, { transactions: contributions }));
    const streak = (d: ReturnType<typeof computeDashboard>) =>
      d.streaks.find((s) => s.key === "savings-streak")?.count ?? 0;
    // Premise: the fixture must actually produce a streak at all, or the
    // comparison below is between two zeroes.
    expect(streak(at1)).toBe(6);
    // At 27, 26 Aug falls in the cycle that began 27 Jul, so the cycle
    // beginning 27 Aug is empty and the streak stops dead at the first step
    // back. Pinned as an exact figure, not merely "different", so a future
    // change that alters HOW it differs still fails here.
    expect(streak(at27)).toBe(0);
  });
});

describe("cycleMonthDivergence: which pairs diverge changes, the recurring engine does not", () => {
  const settled = {
    id: "t", date: "2026-09-28", amount: 100, currency: "USD", bucket: "NEEDS",
    description: "Rent", recurringId: "r1", cycleDate: "2026-10-01",
  } as unknown as StoredTransaction;
  const recurring = [{ id: "r1", name: "Rent" }] as never;

  it("at startDay 1 the payment and the cycle it settles are in different months, so it diverges", () => {
    expect(cycleMonthDivergence(settled, recurring, 1)).toMatch(/Settles/);
  });

  it("at startDay 27 both fall in the SAME cycle, so it does not", () => {
    // 28 Sep and 1 Oct are both inside the cycle that began 27 Sep.
    expect(cycleMonthDivergence(settled, recurring, 27)).toBeNull();
  });
});

describe("membership filters that a brand cannot police: date.startsWith(cycleKey)", () => {
  // Phase 2a made every period KEY cycle-derived and the compiler enumerated
  // every site that passed one. It could not enumerate these: the keys here
  // were already correct, and the comparison was `t.date.startsWith(key)`.
  // String.prototype.startsWith takes a plain `string`, so a CycleKey passes
  // it silently -- the same blind spot as relational operators, one method
  // call further along. At startDay 1 a cycle key IS the calendar prefix, so
  // nothing showed; at any other value these read the wrong period.
  //
  // NOTE ON WHERE THIS IS ASSERTED. The first draft of this test asserted on
  // month.income and passed before the fix -- month.income is built from
  // `monthTx`, which already went through isInCycle. incomeTxForMonth (the
  // startsWith site) only ever feeds PAST cycles, via incomeForMonth ->
  // sixMonthTrend/savingsStreak/rollover. So the assertion has to be on a
  // past cycle or it is measuring the wrong code path.
  it("a one-off INCOME transaction lands in the cycle it falls in, for a PAST cycle", () => {
    // Now is 30 Sep 2026. Under a 27th payday the PREVIOUS cycle is
    // 27 Aug - 26 Sep, keyed "2026-08". A gift on 5 Sep belongs to it --
    // but `date.startsWith("2026-08")` is false for "2026-09-05", so the
    // buggy form drops it from that cycle entirely.
    const withGift = computeDashboard(makeData(27, {
      transactions: [tx("spend", "2026-09-05", 100, "NEEDS"), tx("gift", "2026-09-05", 500, "INCOME")],
    }));
    const without = computeDashboard(makeData(27, {
      transactions: [tx("spend", "2026-09-05", 100, "NEEDS")],
    }));
    // sixMonthTrend runs oldest -> current, so the entry before last is the
    // previous cycle. Premise: it is the one carrying the 5 Sep spend, so
    // the income assertion below is reading the cycle it means to.
    const prev = (d: ReturnType<typeof computeDashboard>) => d.sixMonthTrend[d.sixMonthTrend.length - 2];
    expect(prev(without).spend).toBe(100);
    expect(prev(withGift).income - prev(without).income).toBe(500);
  });

  it("and does NOT land in the cycle its calendar month merely names", () => {
    // The mirror case: 20 Sep is calendar-September but cycle 2026-08. The
    // CURRENT cycle (2026-09, from 27 Sep) must not gain it.
    const d = computeDashboard(makeData(27, { transactions: [tx("gift", "2026-09-20", 500, "INCOME")] }));
    const base = computeDashboard(makeData(27, { transactions: [] })).month.income;
    expect(d.month.income).toBe(base);
  });
});
