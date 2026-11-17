// R4 (owner, session 56: "the safe indexes"). Adding an entry recomputes the dashboard, and at 13,500 entries two
// readings were most of its own time (session 55's profile): which rows fall in a period (isInCycle, 112 ms, asked
// of every row once for each of the ~35 periods the dashboard looks at) and each goal's contributions (68 ms, every
// row scanned for every goal). Both now read an index built in one pass per transaction list, kept as long as the
// list lives (lists are never changed in place; every write makes a new array).
// The answers must be exactly the old ones, rows in the same order (so every sum adds in the same order): the old
// readings are kept here as the reference. Nothing stored changes, and nothing about when data is saved.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { isInCycle, transactionsInCycle, cycleKeyMinus, type CycleKey } from "./period";
import { goalContributions, migrateFinancials, rateOn, roundMoney, DEFAULT_DATA, type LocalFinancials, type StoredGoal, type StoredTransaction } from "./localData";

/** The old readings (the reference). */
const oldInCycle = (list: StoredTransaction[], key: CycleKey, startDay: number) => list.filter((t) => isInCycle(t.date, key, startDay));
function oldContributions(g: StoredGoal, d: LocalFinancials): number {
  const one = (t: StoredTransaction) => {
    if (t.goalAmount != null) return t.goalAmount;
    if (t.currency === g.currency) return t.amount;
    const rate = t.lbpRateAtEntry ?? rateOn(d, t.date);
    return g.currency === "LBP" ? t.amount * rate : t.amount / rate;
  };
  return roundMoney((d.transactions ?? []).filter((t) => t.goalId === g.id && t.deletedAt == null && t.purgedAt == null).reduce((s, t) => s + one(t), 0));
}

let n = 0;
const tx = (o: Partial<StoredTransaction>): StoredTransaction =>
  ({ id: `t${n++}`, amount: 10, currency: "USD", bucket: "WANTS", description: "x", date: "2026-03-15", createdAt: "2026-03-15T10:00:00.000Z", ...o }) as StoredTransaction;
const key = (k: string) => k as CycleKey;

function seeds(): LocalFinancials[] {
  const dir = process.env.SEEDS_DIR;
  const files = ["seed-1500.json", "seed-15000.json"].map((f) => (dir ? path.join(dir, f) : "")).filter((p) => p && fs.existsSync(p));
  return files.map((p) => migrateFinancials(JSON.parse(fs.readFileSync(p, "utf8"))));
}

/** Dates at the edges: month ends, a leap day, the year's turn, each start day's own day and the day before. */
function edgeDates(): string[] {
  const out: string[] = [];
  for (const y of [2024, 2025, 2026]) for (let m = 1; m <= 12; m++) for (const d of [1, 2, 14, 15, 16, 27, 28, 29, 30, 31]) {
    const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    if (!Number.isNaN(new Date(`${iso}T00:00:00Z`).getTime()) && new Date(`${iso}T00:00:00Z`).getUTCDate() === d) out.push(iso);
  }
  return out;
}

describe("rows by period: the same rows as filtering by isInCycle, in the same order", () => {
  const list = edgeDates().flatMap((date, i) => [tx({ date }), tx({ date, deletedAt: i % 7 === 0 ? "2026-11-01T00:00:00.000Z" : undefined })]);

  it.each([1, 2, 15, 28, 29, 30, 31])("start day %i: every period from Dec 2023 to Mar 2027", (startDay) => {
    let rows = 0;
    for (let i = 0; i < 40; i++) {
      const k = cycleKeyMinus(key("2027-03"), i);
      const want = oldInCycle(list, k, startDay);
      const got = transactionsInCycle(list, k, startDay);
      expect(got.length, `${k}`).toBe(want.length);
      expect(got.every((t, j) => t === want[j]), `${k}: same rows, same order`).toBe(true);
      rows += got.length;
    }
    expect(rows).toBe(list.length); // premise: every row landed in exactly one of these periods
  });

  it("a period with no rows is empty; a new list (every write makes one) is read afresh", () => {
    const first = [tx({ date: "2026-03-05" })];
    expect(transactionsInCycle(first, key("2026-04"), 1)).toEqual([]);
    const added = [...first, tx({ date: "2026-04-05" })];
    expect(transactionsInCycle(added, key("2026-04"), 1)).toHaveLength(1);
    expect(transactionsInCycle(first, key("2026-04"), 1)).toEqual([]); // the old list still answers for itself
  });

  it("one list asked at two start days keeps them apart", () => {
    const l = [tx({ date: "2026-03-20" })];
    expect(transactionsInCycle(l, key("2026-03"), 1)).toHaveLength(1);
    expect(transactionsInCycle(l, key("2026-03"), 15)).toHaveLength(1);
    expect(transactionsInCycle(l, key("2026-04"), 15)).toHaveLength(0);
    expect(transactionsInCycle(l, key("2026-03"), 25)).toHaveLength(0);
    expect(transactionsInCycle(l, key("2026-02"), 25)).toHaveLength(1);
  });

  it("on the seeded accounts (when present), every period of the last two years at start days 1 and 25", () => {
    for (const d of seeds()) for (const startDay of [1, 25]) for (let i = 0; i < 24; i++) {
      const k = cycleKeyMinus(key("2026-11"), i);
      const want = oldInCycle(d.transactions, k, startDay);
      const got = transactionsInCycle(d.transactions, k, startDay);
      expect(got.length).toBe(want.length);
      expect(got.every((t, j) => t === want[j])).toBe(true);
    }
  });

  it("asking 36 periods of a 1,000-row list reads each row once", () => {
    const rows = Array.from({ length: 1000 }, (_, i) => tx({ date: `2026-${String(1 + (i % 12)).padStart(2, "0")}-${String(1 + (i % 28)).padStart(2, "0")}` }));
    let reads = 0;
    const counted = new Proxy(rows, { get(target, k, recv) { if (typeof k === "string" && /^\d+$/.test(k)) reads++; return Reflect.get(target, k, recv); } });
    for (let i = 0; i < 36; i++) transactionsInCycle(counted, cycleKeyMinus(key("2026-12"), i % 12), 1);
    expect(reads).toBeLessThanOrEqual(rows.length);
  });

  it("computeDashboard no longer filters the whole list once per period", () => {
    const src = fs.readFileSync(path.join(__dirname, "computeDashboard.ts"), "utf8");
    expect(src.match(/\.filter\(\(t\) => isInCycle\(/g) ?? []).toEqual([]);
    expect((src.match(/transactionsInCycle\(/g) ?? []).length).toBe(6);
  });
});

describe("each goal's contributions: the same sum as the scan", () => {
  const goal = (id: string, currency: "USD" | "LBP"): StoredGoal => ({ id, name: id, emoji: "G", targetAmount: 5000, currentAmount: 0, openingAmount: 0, currency, targetDate: "2027-12-31", createdAt: "2026-01-01T00:00:00.000Z" });
  const goals = [goal("usd", "USD"), goal("lbp", "LBP"), goal("none", "USD")];
  const transactions = [
    tx({ goalId: "usd", amount: 100.1 }), tx({ goalId: "usd", amount: 0.2 }), tx({ goalId: "usd", amount: 0.3 }), // float order matters
    tx({ goalId: "usd", amount: 895000, currency: "LBP", lbpRateAtEntry: 89500 }), // at its stored rate
    tx({ goalId: "usd", amount: 447500, currency: "LBP", date: "2026-05-01" }), // at its own day's rate
    tx({ goalId: "usd", amount: 0, goalAmount: -25 }), // a correction
    tx({ goalId: "usd", amount: 999, deletedAt: "2026-06-01T00:00:00.000Z" }), // deleted: out
    tx({ goalId: "usd", amount: 0, purgedAt: "2026-06-02T00:00:00.000Z" }), // purged: out
    tx({ goalId: "lbp", amount: 50, currency: "USD", lbpRateAtEntry: 90000 }), tx({ goalId: "lbp", amount: 1_000_000, currency: "LBP" }),
    tx({ amount: 40 }), // no goal
  ];
  const d = { ...DEFAULT_DATA, goals, transactions } as LocalFinancials;

  it.each(goals.map((g) => [g.id, g] as const))("goal %s", (_, g) => {
    expect(goalContributions(g, d)).toBe(oldContributions(g, d));
  });

  it("the premise: the hand-made sums are what they say", () => {
    expect(oldContributions(goals[0], d)).toBe(roundMoney(100.1 + 0.2 + 0.3 + 10 + 447500 / rateOn(d, "2026-05-01") - 25));
    expect(oldContributions(goals[2], d)).toBe(0);
  });

  it("a row deleted in a new list stops counting at once; the old list still answers for itself", () => {
    const g = goals[1];
    const after = { ...d, transactions: d.transactions.map((t) => (t.goalId === "lbp" && t.currency === "LBP" ? { ...t, deletedAt: "2026-07-01T00:00:00.000Z" } : t)) };
    expect(goalContributions(g, after)).toBe(oldContributions(g, after));
    expect(goalContributions(g, d)).toBe(oldContributions(g, d));
    expect(goalContributions(g, after)).not.toBe(goalContributions(g, d));
  });

  it("on the seeded accounts (when present), every goal", () => {
    for (const s of seeds()) for (const g of s.goals) expect(goalContributions(g, s), g.name).toBe(oldContributions(g, s));
  });

  it("20 goals against a 1,000-row list read each row once", () => {
    const many = Array.from({ length: 20 }, (_, i) => goal(`g${i}`, "USD"));
    const rows = Array.from({ length: 1000 }, (_, i) => tx({ goalId: `g${i % 25}` }));
    let reads = 0;
    const counted = new Proxy(rows, { get(target, k, recv) { if (typeof k === "string" && /^\d+$/.test(k)) reads++; return Reflect.get(target, k, recv); } });
    const dd = { ...DEFAULT_DATA, goals: many, transactions: counted } as LocalFinancials;
    for (const g of many) goalContributions(g, dd);
    expect(reads).toBeLessThanOrEqual(rows.length);
  });
});
