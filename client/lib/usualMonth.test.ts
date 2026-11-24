// Session 60 (owner: plan first; built held, approved in session 61): "your usual month" (ROADMAP Phase 6, F5). Each spending category this
// period so far, against the person's own average of the three periods before it; and at most three plain lines for
// a category already well above its usual month. The money rule (FIX_PLANS session 60, Part 2):
// - spending is the shared rule, Needs and Wants by category (a change-back nets in its own category); Savings out;
//   live rows only; each row at its own day's rate (plan J); US dollars;
// - the usual month = the three previous periods' spending ÷ 3 (a period without that category counts 0), shown only
//   when each of those periods has at least one live entry;
// - a line when this period so far is above the usual month by 25% or more AND $50 or more (whole cents), a category
//   with no usual spending has none, never for "below", at most three, the largest first.
import { describe, it, expect } from "vitest";
import { usualMonth, usualSentence, USUAL_MIN_PCT, USUAL_MIN_USD } from "./usualMonth";
import { DEFAULT_DATA, type LocalFinancials, type StoredTransaction } from "./localData";

let n = 0;
const tx = (o: Partial<StoredTransaction>): StoredTransaction =>
  ({ id: `t${n++}`, amount: 10, currency: "USD", bucket: "NEEDS", description: "x", date: "2026-10-03", paymentMethod: "cash", createdAt: "2026-10-03T10:00:00.000Z", ...o }) as StoredTransaction;
const NOW = new Date("2026-11-20T12:00:00");
const data = (rows: StoredTransaction[], extra: Partial<LocalFinancials> = {}) => ({ ...DEFAULT_DATA, income: 3000, transactions: rows, ...extra }) as LocalFinancials;

const ACCOUNT = [
  // August
  tx({ category: "groceries", amount: 300, date: "2026-08-05" }),
  tx({ category: "dining", bucket: "WANTS", amount: 90, date: "2026-08-09" }),
  // September
  tx({ category: "groceries", amount: 150, date: "2026-09-05" }),
  tx({ category: "dining", bucket: "WANTS", amount: 120, date: "2026-09-09" }),
  tx({ category: "transport", amount: 895_000, currency: "LBP", date: "2026-09-12" }), // $10 at 89,500 on its day
  // October
  tx({ category: "groceries", amount: 150, date: "2026-10-05" }),
  tx({ category: "dining", bucket: "WANTS", amount: 90, date: "2026-10-09" }),
  tx({ category: "dining", bucket: "TRANSFER", amount: 30, fx: { code: "EUR", amount: 28, kind: "back" }, date: "2026-10-20" } as Partial<StoredTransaction>), // a change-back nets in dining
  tx({ category: "groceries", amount: 999, date: "2026-10-06", deletedAt: "2026-10-07T00:00:00.000Z" }), // deleted: nowhere
  tx({ bucket: "SAVINGS", amount: 500, date: "2026-10-15" }), // Savings: not in these figures
  // November (this period, so far)
  tx({ category: "groceries", amount: 260, date: "2026-11-04" }),
  tx({ category: "dining", bucket: "WANTS", amount: 50, date: "2026-11-08" }),
];

describe("the usual month", () => {
  const r = usualMonth(data(ACCOUNT), NOW);

  it("is ready when each of the last three periods has entries", () => {
    expect(r.ready).toBe(true);
    expect(r.noun).toBe("month");
    expect(r.nounPlural).toBe("months");
  });

  it("is the average of the three previous periods, by category: lira at its day's rate, deleted and Savings out, a change-back netted", () => {
    const byLabel = Object.fromEntries(r.rows.map((x) => [x.label, x]));
    expect(byLabel["Groceries"]).toMatchObject({ soFar: 260, usual: 200 }); // (300 + 150 + 150) / 3
    expect(byLabel["Dining out"]).toMatchObject({ soFar: 50, usual: 90 }); // (90 + 120 + (90 - 30)) / 3
    expect(byLabel["Transport"]).toMatchObject({ soFar: 0, usual: 3.33 }); // 10 / 3
    expect(r.rows.map((x) => x.label)).toEqual(["Groceries", "Dining out", "Transport"]); // the usual month, largest first
  });

  it("a line only for a category above its usual month by 25% and $50: Groceries (260 against 200); never for one below", () => {
    expect(r.observations).toEqual([{ label: "Groceries", percent: 30, amount: 60 }]);
  });

  it("the line, as drafted", () => {
    expect(usualSentence(r.observations[0], r.noun)).toBe("Groceries is already 30% above your usual month ($60 more).");
  });

  it("a brand-new account isn't ready; nor is one whose last three periods include one with no entries", () => {
    expect(usualMonth(data([]), NOW).ready).toBe(false);
    const gap = ACCOUNT.filter((t) => !t.date.startsWith("2026-08"));
    const g = usualMonth(data(gap), NOW);
    expect(g.ready).toBe(false);
    expect(g.observations).toEqual([]);
  });
});

describe("the lines' edges (25% and $50)", () => {
  const steady = (usualEach: number, now: number) => data([
    tx({ category: "travel", bucket: "WANTS", amount: usualEach, date: "2026-08-10" }),
    tx({ category: "travel", bucket: "WANTS", amount: usualEach, date: "2026-09-10" }),
    tx({ category: "travel", bucket: "WANTS", amount: usualEach, date: "2026-10-10" }),
    ...(now ? [tx({ category: "travel", bucket: "WANTS", amount: now, date: "2026-11-10" })] : []),
  ]);
  it("the thresholds are the approved ones", () => expect([USUAL_MIN_PCT, USUAL_MIN_USD]).toEqual([25, 50]));
  it("$200 usual, $250 so far: 25% and $50, a line", () => expect(usualMonth(steady(200, 250), NOW).observations).toEqual([{ label: "Travel", percent: 25, amount: 50 }]));
  it("$200 usual, $249.99: under $50, none", () => expect(usualMonth(steady(200, 249.99), NOW).observations).toEqual([]));
  it("$400 usual, $499.60: 24.9%, none", () => expect(usualMonth(steady(400, 499.6), NOW).observations).toEqual([]));
  it("a category with no usual spending: no percent, no line", () => {
    const d = data([...steady(200, 0).transactions, tx({ category: "health", amount: 500, date: "2026-11-10" })]);
    expect(usualMonth(d, NOW).observations).toEqual([]);
  });
  it("at most three, the largest first", () => {
    const rows = ["travel", "dining", "shopping", "health", "gifts"].flatMap((c, i) => [
      tx({ category: c, amount: 100, date: "2026-08-10" }), tx({ category: c, amount: 100, date: "2026-09-10" }), tx({ category: c, amount: 100, date: "2026-10-10" }),
      tx({ category: c, amount: 200 + i * 50, date: "2026-11-10" }),
    ]);
    expect(usualMonth(data(rows), NOW).observations.map((o) => o.label)).toEqual(["Gifts & donations", "Health", "Shopping"]);
  });
});

describe("periods follow the account's cycle", () => {
  it("at a start day of 25, this period is 25 Oct – 24 Nov and the usual month is July 25 to Oct 24", () => {
    const rows = [
      tx({ category: "groceries", amount: 120, date: "2026-07-30" }), // the 2026-07 cycle
      tx({ category: "groceries", amount: 120, date: "2026-08-30" }), // 2026-08
      tx({ category: "groceries", amount: 120, date: "2026-10-20" }), // 2026-09 (25 Sep – 24 Oct)
      tx({ category: "groceries", amount: 999, date: "2026-07-10" }), // 2026-06: outside the three
      tx({ category: "groceries", amount: 40, date: "2026-10-26" }), // this cycle (2026-10)
    ];
    const r = usualMonth(data(rows, { cycleStartDay: 25 }), NOW);
    expect(r.ready).toBe(true);
    expect(r.noun).toBe("cycle");
    expect(r.rows).toEqual([{ key: "groceries", label: "Groceries", soFar: 40, usual: 120 }]);
  });
});

// Owner, session 61: "Uncategorized" never gets a line (it names nothing to act on); its row stays in the table.
// Uncategorised is categoryLabel's own rule: no category, or an empty one (possible only from an imported backup).
describe("Uncategorized never gets a line; its row stays", () => {
  const account = (category: string | undefined) => {
    const c = category === undefined ? {} : { category };
    return data([
      ...["08", "09", "10"].map((m) => tx({ ...c, amount: 200, date: `2026-${m}-05` })),
      tx({ ...c, amount: 400, date: "2026-11-05" }), // 100% and $200 above
      ...["08", "09", "10"].map((m) => tx({ category: "groceries", amount: 200, date: `2026-${m}-06` })),
      tx({ category: "groceries", amount: 300, date: "2026-11-06" }), // 50% and $100 above: still a line
    ]);
  };
  it("no category: no line; its row is in the table", () => {
    const r = usualMonth(account(undefined), NOW);
    expect(r.observations).toEqual([{ label: "Groceries", percent: 50, amount: 100 }]);
    expect(r.rows.find((x) => x.label === "Uncategorized")).toMatchObject({ soFar: 400, usual: 200 });
  });
  it("an empty category: no line either; its row is in the table", () => {
    const r = usualMonth(account(""), NOW);
    expect(r.observations).toEqual([{ label: "Groceries", percent: 50, amount: 100 }]);
    expect(r.rows.find((x) => x.label === "Uncategorized")).toMatchObject({ soFar: 400, usual: 200 });
  });
});

// Owner, session 62: an empty category (possible only from an imported backup) counts as no category: one
// "Uncategorized" row, not two rows with the same name.
describe("an empty category counts as no category: one Uncategorized row", () => {
  it("$100 with no category and $50 with an empty one, in each period: one row, $150 so far and $150 usual", () => {
    const rows = ["08", "09", "10", "11"].flatMap((m) => [tx({ amount: 100, date: `2026-${m}-05` }), tx({ category: "", amount: 50, date: `2026-${m}-06` })]);
    expect(usualMonth(data(rows), NOW).rows).toEqual([{ key: "uncategorized", label: "Uncategorized", soFar: 150, usual: 150 }]);
  });
});
