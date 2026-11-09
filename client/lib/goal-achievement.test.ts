// Phase 2.8.1 (LB1; plan approved in session 47): a goal's achievement, derived
// from its ledger, the sibling of debtPayoff.
//
//   achieved: what's saved (goalProgress, the figure every screen shows) is at
//             or over the target; a target of 0 or less counts as met (today's
//             convention).
//   on:       the latest crossing that still stands. Walk the goal's live rows
//             (not deleted, not purged) by date, then creation time, then id,
//             with goalProgress's own rounding; the last row that takes the
//             total from under the target to at or over it dates it, as its
//             own day. No row crosses (the opening alone meets the target, or
//             the goal was never migrated): the before-ledger record (2.8.2),
//             the stored achievedAt read as a local day (a day string as it
//             is, an instant as its local day), else null.
//
// A debt crosses downward (above 0 to 0 or below); a goal crosses upward. The
// conditions mirror each other; they are not the same comparison (rule 18).
import { describe, it, expect } from "vitest";
import { DEFAULT_DATA, goalAchievement, goalProgress, type LocalFinancials, type StoredGoal, type StoredTransaction } from "./localData";

const goal = (o: Partial<StoredGoal> = {}): StoredGoal => ({
  id: "g1", name: "Laptop", emoji: "💻", targetAmount: 100, currentAmount: 0, openingAmount: 0, currency: "USD", targetDate: "2027-03-01",
  createdAt: "2026-05-01T09:00:00.000Z", ...o,
});
let n = 0;
const row = (date: string, amount: number, o: Partial<StoredTransaction> = {}): StoredTransaction => ({
  id: `r${++n}`, amount, currency: "USD", bucket: "SAVINGS", description: "Goal: Laptop", date, goalId: "g1",
  createdAt: `${date}T09:00:00.000Z`, ...o,
}) as StoredTransaction;
/** A $0 correction or withdrawal: only goalAmount moves the goal. */
const adjust = (date: string, goalAmount: number, o: Partial<StoredTransaction> = {}) => row(date, 0, { goalAmount, ...o });
const data = (g: StoredGoal, transactions: StoredTransaction[], o: Partial<LocalFinancials> = {}) =>
  ({ ...DEFAULT_DATA, income: 3000, goals: [g], transactions, ...o }) as LocalFinancials;
const ach = (g: StoredGoal, rows: StoredTransaction[], o: Partial<LocalFinancials> = {}) => goalAchievement(g, data(g, rows, o));

describe("achieved: the saved figure against the target", () => {
  it("exactly on target is achieved; one cent short is not", () => {
    expect(ach(goal(), [row("2026-10-01", 100)]).achieved).toBe(true);
    expect(ach(goal(), [row("2026-10-01", 99.99)])).toEqual({ achieved: false, on: null });
  });

  it("99.5% is not achieved (the rounded percent said it was)", () => {
    const g = goal({ targetAmount: 1200, openingAmount: 300 });
    expect(ach(g, [row("2026-08-10", 400), row("2026-09-12", 300), row("2026-10-05", 194)])).toEqual({ achieved: false, on: null });
  });

  it("a target of 0 or less counts as met (today's convention)", () => {
    expect(ach(goal({ targetAmount: 0 }), []).achieved).toBe(true);
  });

  it("a target raised above what's saved is not achieved", () => {
    expect(ach(goal({ targetAmount: 1500, openingAmount: 1300 }), []).achieved).toBe(false);
  });
});

describe("on: the latest crossing that still stands", () => {
  it("a single crossing row dates it, by its own day", () => {
    expect(ach(goal(), [row("2026-09-20", 40), row("2026-10-02", 60), row("2026-10-09", 10)])).toEqual({ achieved: true, on: "2026-10-02" });
  });

  it("up, a withdrawal under, and up again: dated by the second crossing", () => {
    expect(ach(goal(), [row("2026-09-01", 120), adjust("2026-09-15", -50), row("2026-10-03", 40)])).toEqual({ achieved: true, on: "2026-10-03" });
  });

  it("up, then a withdrawal under: not achieved, no date", () => {
    expect(ach(goal(), [row("2026-09-01", 120), adjust("2026-09-15", -50)])).toEqual({ achieved: false, on: null });
  });

  it("a deleted crossing row is out: the date moves to the row that now crosses; restored, it's back; purged, out for good", () => {
    const a = row("2026-09-01", 60), b = row("2026-09-05", 60), c = row("2026-09-10", 60);
    expect(ach(goal(), [a, b, c]).on).toBe("2026-09-05");
    expect(ach(goal(), [a, { ...b, deletedAt: "2026-10-20T09:00:00.000Z" }, c]).on).toBe("2026-09-10");
    expect(ach(goal(), [a, b, c]).on).toBe("2026-09-05"); // restored
    expect(ach(goal(), [a, { ...b, deletedAt: "2026-10-20T09:00:00.000Z", purgedAt: "2026-11-19T09:00:00.000Z" }, c]).on).toBe("2026-09-10");
  });

  it("the deleted row that reached the goal leaves it not achieved", () => {
    const g = goal({ targetAmount: 600, openingAmount: 400, achievedAt: "2026-10-02" });
    expect(ach(g, [row("2026-10-02", 200, { deletedAt: "2026-10-20T09:00:00.000Z" })])).toEqual({ achieved: false, on: null });
  });

  it("the order rows arrive in doesn't matter: date, then creation time, then id", () => {
    const rows = [
      row("2026-09-01", 150, { createdAt: "2026-09-01T09:00:00.000Z" }), adjust("2026-09-01", -100, { createdAt: "2026-09-01T10:00:00.000Z" }),
      row("2026-09-04", 30, { id: "zz", createdAt: "2026-09-04T09:00:00.000Z" }), row("2026-09-04", 30, { id: "aa", createdAt: "2026-09-04T09:00:00.000Z" }),
    ];
    const expected = ach(goal(), rows);
    expect(expected).toEqual({ achieved: true, on: "2026-09-04" });
    for (const order of [[3, 2, 1, 0], [1, 3, 0, 2], [2, 0, 3, 1]]) expect(ach(goal(), order.map((i) => rows[i]))).toEqual(expected);
  });

  it("a backdated row is dated by its own day, not the day it was typed in", () => {
    const g = goal({ targetAmount: 600, openingAmount: 400, achievedAt: "2026-10-02" });
    expect(ach(g, [row("2026-09-28", 200, { createdAt: "2026-10-02T09:00:00.000Z" })])).toEqual({ achieved: true, on: "2026-09-28" });
  });

  it("a future-dated row counts, as the saved figure counts it, and dates it (owner, session 47)", () => {
    expect(ach(goal(), [row("2026-09-01", 50), row("2027-01-15", 50)])).toEqual({ achieved: true, on: "2027-01-15" });
  });
});

describe("corrections and withdrawals ($0 rows carrying goalAmount)", () => {
  it("a correction that crosses dates it by its day", () => {
    expect(ach(goal({ openingAmount: 70 }), [adjust("2026-10-06", 35)])).toEqual({ achieved: true, on: "2026-10-06" });
  });

  it("a negative correction un-achieves", () => {
    expect(ach(goal({ openingAmount: 120 }), [adjust("2026-10-06", -30)])).toEqual({ achieved: false, on: null });
  });
});

describe("lira: each row converts as the saved figure converts it", () => {
  const RATE_LOG = [{ from: "2026-09-01", value: 90_000 }, { from: "2026-10-15", value: 100_000 }];

  it("an LBP goal at real magnitudes: L£45,000,000 reached by a backdated row", () => {
    const g = goal({ currency: "LBP", targetAmount: 45_000_000, openingAmount: 9_000_000 });
    const rows = [row("2026-09-03", 18_000_000, { currency: "LBP" }), row("2026-09-28", 18_000_000, { currency: "LBP", createdAt: "2026-10-02T09:00:00.000Z" })];
    expect(ach(g, rows)).toEqual({ achieved: true, on: "2026-09-28" });
  });

  it("a dollar row toward an LBP goal at its stored rate; one without a rate at the rate on its own day; a frozen goalAmount as is", () => {
    const g = goal({ currency: "LBP", targetAmount: 45_000_000, openingAmount: 0 });
    const stored = row("2026-09-05", 200, { lbpRateAtEntry: 89_500 });  // L£17,900,000
    const onItsDay = row("2026-10-20", 100);                            // no rate: L£10,000,000 (the 15 Oct rate)
    const frozen = row("2026-10-25", 50, { goalAmount: 17_100_000 });   // as stored
    const d = data(g, [stored, onItsDay, frozen], { lbpRate: 120_000, lbpRateLog: RATE_LOG });
    expect(goalProgress(g, d)).toBe(45_000_000); // premise: the figure
    expect(goalAchievement(g, d)).toEqual({ achieved: true, on: "2026-10-25" });
  });

  it("rows worth fractions of a cent: the walk rounds as the saved figure does, so it still finds the crossing", () => {
    // Three lira rows toward a dollar goal, each L£2,970,360 at L£90,000 = $33.004. Saved: 99.012 -> $99.01.
    // Rounded row by row they'd make $99.00, under the target, and no row would date it.
    const g = goal({ targetAmount: 99.01, openingAmount: 0 });
    const rows = ["2026-09-01", "2026-09-02", "2026-09-03"].map((day) => row(day, 2_970_360, { currency: "LBP", lbpRateAtEntry: 90_000 }));
    expect(goalProgress(g, data(g, rows))).toBe(99.01); // premise
    expect(ach(g, rows)).toEqual({ achieved: true, on: "2026-09-03" });
  });

  it("today's rate moving changes nothing", () => {
    const g = goal({ currency: "LBP", targetAmount: 17_900_000, openingAmount: 0 });
    const rows = [row("2026-09-05", 200, { lbpRateAtEntry: 89_500 })];
    for (const lbpRate of [50_000, 89_500, 150_000]) expect(goalAchievement(g, data(g, rows, { lbpRate, lbpRateLog: RATE_LOG }))).toEqual({ achieved: true, on: "2026-09-05" });
  });
});

describe("the goal itself", () => {
  it("a pause doesn't change achievement", () => {
    const rows = [row("2026-10-02", 100)];
    expect(ach(goal({ pausedAt: "2026-10-05T09:00:00.000Z" }), rows)).toEqual(ach(goal(), rows));
  });

  it("a lowered target is dated by the row that crossed the new target (owner, session 47)", () => {
    // Saved 300 + 200 (15 Sep) + 250 (20 Oct) = 750 toward 1,000, not reached; lowered to 700.
    const rows = [row("2026-09-15", 200), row("2026-10-20", 250)];
    expect(ach(goal({ targetAmount: 1000, openingAmount: 300 }), rows).achieved).toBe(false);
    expect(ach(goal({ targetAmount: 700, openingAmount: 300 }), rows)).toEqual({ achieved: true, on: "2026-10-20" });
  });

  it("no row crosses when the opening alone meets the target: achieved, no date yet (2.8.2 reads the before-ledger record)", () => {
    expect(ach(goal({ targetAmount: 600, openingAmount: 600 }), [])).toEqual({ achieved: true, on: null });
    expect(ach(goal({ targetAmount: 600, openingAmount: 650 }), [row("2026-10-01", 20)])).toEqual({ achieved: true, on: null });
  });

  it("a goal never migrated (no openingAmount) reads its stored total, with no ledger to date it", () => {
    const { openingAmount: _o, ...unmigrated } = goal({ currentAmount: 120 });
    expect(ach(unmigrated as StoredGoal, [])).toEqual({ achieved: true, on: null });
  });

  it("another goal's rows don't count", () => {
    expect(ach(goal(), [row("2026-10-01", 100, { goalId: "g2" })])).toEqual({ achieved: false, on: null });
  });
});

describe("property: the rule always agrees with the saved figure (500 seeded ledgers)", () => {
  // mulberry32: the same 500 ledgers on every run and every leg.
  function rng(seed: number) {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const DAYS = ["2026-08-30", "2026-09-01", "2026-09-14", "2026-09-30", "2026-10-01", "2026-10-15", "2026-11-02", "2027-01-10"];

  it("achieved is saved ≥ target; when it was reached by a row, on is a live row's day", () => {
    const r = rng(20261109);
    const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
    const cents = (max: number) => Math.round(r() * max * 100) / 100;
    for (let i = 0; i < 500; i++) {
      const lbp = r() < 0.4;
      const scale = lbp ? 89_500 : 1;
      const g = goal({ id: "g1", currency: lbp ? "LBP" : "USD", targetAmount: r() < 0.03 ? 0 : cents(2000) * scale, openingAmount: cents(1200) * scale });
      const rows: StoredTransaction[] = [];
      const count = Math.floor(r() * 9);
      for (let k = 0; k < count; k++) {
        const date = pick(DAYS);
        const kind = r();
        const other = r() < 0.25;
        const base: Partial<StoredTransaction> = {
          id: `p${i}-${k}`, createdAt: `${date}T0${Math.floor(r() * 10)}:00:00.000Z`,
          ...(r() < 0.15 ? { deletedAt: "2026-11-01T09:00:00.000Z" } : {}),
          ...(r() < 0.05 ? { deletedAt: "2026-11-01T09:00:00.000Z", purgedAt: "2026-12-01T09:00:00.000Z" } : {}),
        };
        if (kind < 0.2) rows.push(adjust(date, (r() < 0.5 ? -1 : 1) * cents(500) * scale, base));
        else if (other) rows.push(row(date, lbp ? cents(300) : cents(300) * 89_500, { ...base, currency: lbp ? "USD" : "LBP", ...(r() < 0.5 ? { lbpRateAtEntry: pick([85_000, 89_500, 92_000]) } : {}) }));
        else rows.push(row(date, (r() < 0.1 ? -1 : 1) * cents(400) * scale, { ...base, currency: lbp ? "LBP" : "USD" }));
      }
      const d = data(g, rows, { lbpRate: pick([89_500, 100_000]), lbpRateLog: [{ from: "2026-09-01", value: 90_000 }, { from: "2026-10-15", value: 100_000 }] });
      const res = goalAchievement(g, d);
      const saved = goalProgress(g, d);
      expect(res.achieved, `ledger ${i}`).toBe(g.targetAmount <= 0 || saved >= g.targetAmount);
      if (!res.achieved) expect(res.on, `ledger ${i}`).toBeNull();
      const live = rows.filter((t) => t.deletedAt == null && t.purgedAt == null);
      if (res.achieved && (g.openingAmount ?? 0) < g.targetAmount) {
        expect(res.on, `ledger ${i}: reached by a row, so a row dates it`).not.toBeNull();
      }
      if (res.on !== null) expect(live.map((t) => t.date), `ledger ${i}`).toContain(res.on);
    }
  });
});

describe("time zones: the date is the row's own day on every leg", () => {
  it(`on ${process.env.TZ ?? "this machine's zone"}`, () => {
    expect(ach(goal(), [row("2026-10-31", 100, { createdAt: "2026-10-31T23:30:00.000Z" })]).on).toBe("2026-10-31");
    expect(ach(goal(), [row("2026-11-01", 100, { createdAt: "2026-10-31T22:30:00.000Z" })]).on).toBe("2026-11-01");
  });
});

describe("2.8.2: the before-ledger record, when no row crosses", () => {
  // No migration and no schema bump (owner, session 47): the stored achievedAt
  // already holds the date a goal reached before the ledger began.
  const before = (achievedAt?: string, o: Partial<StoredGoal> = {}) =>
    goal({ targetAmount: 600, openingAmount: 600, ...(achievedAt ? { achievedAt } : {}), ...o });

  it("a day stamp is that day, in every zone (a contribution's stamp, todayISO())", () => {
    expect(ach(before("2026-10-02"), [])).toEqual({ achieved: true, on: "2026-10-02" });
  });

  it("no stamp: achieved, with no date", () => {
    expect(ach(before(), [])).toEqual({ achieved: true, on: null });
  });

  it("a target lowered below what was saved before the ledger: the stamp's day", () => {
    expect(ach(goal({ targetAmount: 1200, openingAmount: 1300, achievedAt: "2026-09-14" }), [])).toEqual({ achieved: true, on: "2026-09-14" });
  });

  it("a goal never migrated reads its stamp too", () => {
    const { openingAmount: _o, ...unmigrated } = goal({ currentAmount: 120, achievedAt: "2026-07-01" });
    expect(ach(unmigrated as StoredGoal, [])).toEqual({ achieved: true, on: "2026-07-01" });
  });

  it("a stamp is ignored whenever a row crosses: the row dates it (a stale stamp from the day it was typed in)", () => {
    const g = goal({ targetAmount: 600, openingAmount: 400, achievedAt: "2026-10-02" });
    expect(ach(g, [row("2026-09-28", 200, { createdAt: "2026-10-02T09:00:00.000Z" })])).toEqual({ achieved: true, on: "2026-09-28" });
  });

  it("a stamp on a goal not achieved is ignored", () => {
    expect(ach(goal({ targetAmount: 600, openingAmount: 400, achievedAt: "2026-10-02" }), [])).toEqual({ achieved: false, on: null });
  });

  it("a stamp that isn't a date reads as no date", () => {
    expect(ach(before("not a date"), [])).toEqual({ achieved: true, on: null });
  });

  // The edit sheet stamps an instant (toISOString()). 22:30 UTC on 2 October is
  // 01:30 on 3 October in Beirut: its local day there, not the UTC day.
  const INSTANT = "2026-10-02T22:30:00.000Z";
  const LOCAL_DAY: Record<string, string> = { UTC: "2026-10-02", "Asia/Beirut": "2026-10-03", "America/Los_Angeles": "2026-10-02" };
  const ZONE = process.env.TZ ?? "";
  it.runIf(ZONE in LOCAL_DAY)(`an instant stamp is its local day [${ZONE}]`, () => {
    expect(ach(before(INSTANT), [])).toEqual({ achieved: true, on: LOCAL_DAY[ZONE] });
  });
  it.runIf(ZONE === "America/Los_Angeles")("west of UTC, a day stamp is never read through a UTC midnight (it would read 1 October)", () => {
    expect(ach(before("2026-10-02"), []).on).toBe("2026-10-02");
  });
});
