// F4 (owner, session 56; held for the owner's look): the monthly report's figures, one period at a time, in US
// dollars with lira rows at each day's rate (plan J), from the account's own rows. Sentences and thresholds are
// the owner's (session 55 item 9, approved in session 56): a comparison line when a figure moved by 25% AND by at
// least $50, at most three.
import { describe, it, expect } from "vitest";
import { buildMonthlyReport, reportPeriods, changeSentence, goalSentence, CHANGE_MIN_PCT, CHANGE_MIN_USD } from "./monthlyReport";
import { DEFAULT_DATA, type LocalFinancials, type StoredGoal, type StoredTransaction, type StoredRecurring, type StoredDebt } from "./localData";
import type { CycleKey } from "./period";

let n = 0;
const tx = (o: Partial<StoredTransaction>): StoredTransaction =>
  ({ id: `t${n++}`, amount: 10, currency: "USD", bucket: "WANTS", description: "x", date: "2026-10-03", paymentMethod: "cash", createdAt: "2026-10-03T10:00:00.000Z", ...o }) as StoredTransaction;
const K = (k: string) => k as CycleKey;
const NOW = new Date("2026-10-20T12:00:00");

const RENT: StoredRecurring = { id: "r-rent", name: "Flat rent", emoji: "🏠", amount: 800, currency: "USD", frequency: "monthly", bucket: "NEEDS", startDate: "2026-01-01", endDate: null } as unknown as StoredRecurring;
const LOAN: StoredDebt = { id: "d1", name: "Car loan", openingBalance: 5000, balance: 5000, apr: 9, minPayment: 150, currency: "USD", createdAt: "2026-01-01T00:00:00.000Z" } as StoredDebt;
const LAPTOP: StoredGoal = { id: "g1", name: "Laptop", emoji: "💻", targetAmount: 1500, currentAmount: 0, openingAmount: 100, currency: "USD", targetDate: "2027-06-30", createdAt: "2026-01-01T00:00:00.000Z" };
const CAR: StoredGoal = { id: "g2", name: "Car", emoji: "🚗", targetAmount: 900_000_000, currentAmount: 0, openingAmount: 0, currency: "LBP", targetDate: "2028-01-01", createdAt: "2026-01-01T00:00:00.000Z" };

function account(extra: StoredTransaction[] = []): LocalFinancials {
  const october = [
    tx({ bucket: "INCOME", amount: 500, description: "Freelance", date: "2026-10-05" }),
    tx({ bucket: "NEEDS", amount: 800, category: "rent", recurringId: "r-rent", description: "Flat rent", date: "2026-10-01" }),
    tx({ bucket: "NEEDS", amount: 150, category: "other", debtId: "d1", description: "Car loan payment", date: "2026-10-10" }),
    tx({ bucket: "NEEDS", amount: 200, category: "groceries", date: "2026-10-04" }),
    tx({ bucket: "NEEDS", amount: 100, category: "groceries", date: "2026-10-11" }),
    tx({ bucket: "WANTS", amount: 120, category: "dining", date: "2026-10-06" }),
    tx({ bucket: "WANTS", amount: 50, category: "dining", efAmount: -50, date: "2026-10-07" }), // drawn from the safety net
    tx({ bucket: "NEEDS", amount: 895_000, currency: "LBP", category: "transport", date: "2026-10-12" }), // $10 at 89,500
    tx({ bucket: "NEEDS", amount: 40, category: "health", date: "2026-10-13" }),
    tx({ bucket: "WANTS", amount: 30, category: "shopping", date: "2026-10-14" }),
    tx({ bucket: "WANTS", amount: 20, category: "gifts", date: "2026-10-14" }),
    tx({ bucket: "WANTS", amount: 15, category: "entertainment", date: "2026-10-14" }),
    tx({ bucket: "SAVINGS", amount: 300, efAmount: 300, description: "To the safety net", date: "2026-10-15" }),
    tx({ bucket: "SAVINGS", amount: 200, goalId: "g1", description: "Goal: Laptop", date: "2026-10-16" }),
    tx({ bucket: "SAVINGS", amount: 1_790_000, currency: "LBP", goalId: "g2", description: "Goal: Car", date: "2026-10-16" }), // $20
    tx({ bucket: "WANTS", amount: 999, category: "shopping", deletedAt: "2026-10-17T00:00:00.000Z", date: "2026-10-17" }), // deleted: nowhere
    tx({ bucket: "SAVINGS", amount: 0, efAmount: 1000, description: "Emergency fund balance correction", date: "2026-10-18" }), // a correction: not saved money
    tx({ bucket: "SAVINGS", amount: 0, goalId: "g1", goalAmount: 50, description: "Goal balance correction: Laptop", date: "2026-10-18" }),
  ];
  const september = [
    tx({ bucket: "NEEDS", amount: 800, category: "rent", recurringId: "r-rent", description: "Flat rent", date: "2026-09-01" }),
    tx({ bucket: "NEEDS", amount: 150, category: "groceries", date: "2026-09-04" }),
    tx({ bucket: "WANTS", amount: 142, category: "dining", date: "2026-09-06" }),
    tx({ bucket: "SAVINGS", amount: 100, goalId: "g1", description: "Goal: Laptop", date: "2026-09-16" }),
  ];
  return { ...DEFAULT_DATA, income: 3000, recurring: [RENT], debts: [LOAN], goals: [LAPTOP, CAR], transactions: [...october, ...september, ...extra] } as LocalFinancials;
}

describe("one period's figures", () => {
  const r = buildMonthlyReport(account(), K("2026-10"), NOW);

  it("names the period and the one before it", () => {
    expect(r.label).toBe("Oct 2026");
    expect(r.previousLabel).toBe("Sep 2026");
    expect(r.noun).toBe("month");
    expect(r.empty).toBe(false);
    expect(r.first).toBe(false);
  });

  it("money in: the salary as Income, then each income entry by its name", () => {
    expect(r.moneyIn.lines).toEqual([{ label: "Income", usd: 3000 }, { label: "Freelance", usd: 500 }]);
    expect(r.moneyIn.total).toBe(3500);
  });

  it("bills and debt payments: confirmed bills by the bill's name, payments by the debt's name", () => {
    expect(r.bills.lines).toEqual([{ label: "Flat rent", usd: 800 }, { label: "Car loan", usd: 150 }]);
    expect(r.bills.total).toBe(950);
  });

  it("where it went: spending by category, largest first, the top six, then Other (with the Other category)", () => {
    expect(r.whereItWent.lines).toEqual([
      { label: "Rent / Mortgage", usd: 800 },
      { label: "Groceries", usd: 300 },
      { label: "Dining out", usd: 170 },
      { label: "Health", usd: 40 },
      { label: "Shopping", usd: 30 },
      { label: "Gifts & donations", usd: 20 },
      { label: "Other", usd: 150 + 15 + 10 }, // the Other category, Entertainment, Transport
    ]);
    expect(r.whereItWent.total).toBe(1535);
  });

  it("saved: the Savings type, the safety net's change (corrections left out), and goal contributions", () => {
    expect(r.saved.lines).toEqual([{ label: "Savings", usd: 520 }, { label: "Safety net", usd: 250 }, { label: "Goals", usd: 220 }]);
  });

  it("goals: what each goal had at the period's end, and what was added in it (corrections not added)", () => {
    expect(r.goals).toEqual([
      { name: "Laptop", currency: "USD", saved: 450, target: 1500, percent: 30, added: 200 },
      { name: "Car", currency: "LBP", saved: 1_790_000, target: 900_000_000, percent: 0, added: 1_790_000 },
    ]);
  });

  it("the goal sentence, as approved", () => {
    expect(goalSentence(r.goals[0], r.noun)).toBe("Laptop: $450.00 of $1,500.00 (30%), $200.00 added this month.");
  });

  it("a past period's goal figures stop at its end", () => {
    const sep = buildMonthlyReport(account(), K("2026-09"), NOW);
    expect(sep.goals[0]).toMatchObject({ saved: 200, added: 100 });
  });

  it("compared with the period before: only what moved by 25% and $50, the largest move first", () => {
    // Savings 100 → 520 and Groceries 150 → 300 qualify. Money in 3,000 → 3,500 is 17%; bills 800 → 950 is 19%;
    // dining 142 → 170 is 20%; a category with nothing before has no percent.
    expect(r.changes).toEqual([
      { name: "Savings", percent: 420, amount: 420, up: true },
      { name: "Groceries", percent: 100, amount: 150, up: true },
    ]);
  });

  it("the comparison sentences, as approved", () => {
    expect(changeSentence({ name: "Groceries", percent: 100, amount: 150, up: true }, "Sep 2026")).toBe("Groceries was 100% higher than Sep 2026 ($150.00 more).");
    expect(changeSentence({ name: "Dining out", percent: 40, amount: 60, up: false }, "Sep 2026")).toBe("Dining out was 40% lower than Sep 2026 ($60.00 less).");
  });
});

describe("the comparison's edges (25% and $50)", () => {
  const pair = (before: number, after: number) => {
    const d = { ...DEFAULT_DATA, income: 0, transactions: [tx({ category: "travel", amount: before, date: "2026-09-10" }), tx({ category: "travel", amount: after, date: "2026-10-10" })] } as LocalFinancials;
    return buildMonthlyReport(d, K("2026-10"), NOW).changes;
  };
  it("thresholds are the approved ones", () => {
    expect([CHANGE_MIN_PCT, CHANGE_MIN_USD]).toEqual([25, 50]);
  });
  it("$200 → $250: 25% and $50, shown", () => expect(pair(200, 250)).toEqual([{ name: "Travel", percent: 25, amount: 50, up: true }]));
  it("$200 → $249.99: under $50, not shown", () => expect(pair(200, 249.99)).toEqual([]));
  it("$400 → $499.60: 24.9%, not shown", () => expect(pair(400, 499.6)).toEqual([]));
  it("$400 → $300: 25% down, shown as lower", () => expect(pair(400, 300)).toEqual([{ name: "Travel", percent: 25, amount: 100, up: false }]));
  it("nothing before ($0 → $500): no percent to give, not shown", () => expect(pair(0, 500)).toEqual([]));

  it("at most three, the largest moves first", () => {
    const rows = ["travel", "dining", "shopping", "health", "gifts"].flatMap((c, i) => [
      tx({ category: c, amount: 100, date: "2026-09-10" }), tx({ category: c, amount: 200 + i * 50, date: "2026-10-10" }),
    ]);
    const d = { ...DEFAULT_DATA, income: 0, transactions: rows } as LocalFinancials;
    expect(buildMonthlyReport(d, K("2026-10"), NOW).changes.map((c) => c.name)).toEqual(["Gifts & donations", "Health", "Shopping"]);
  });
});

describe("first and empty periods; the period list", () => {
  it("the account's first period has nothing to compare", () => {
    const r = buildMonthlyReport(account(), K("2026-09"), NOW);
    expect(r.first).toBe(true);
    expect(r.changes).toEqual([]);
  });

  it("a period with no entries is empty (a deleted row doesn't count)", () => {
    const d = account([tx({ amount: 5, date: "2026-08-03", deletedAt: "2026-08-04T00:00:00.000Z" })]);
    const r = buildMonthlyReport(d, K("2026-08"), NOW);
    expect(r.empty).toBe(true);
  });

  it("the picker lists this period and every past one back to the first entry, newest first", () => {
    expect(reportPeriods(account(), NOW)).toEqual(["2026-10", "2026-09"]);
    const d = account([tx({ amount: 5, date: "2026-06-03" })]);
    expect(reportPeriods(d, NOW)).toEqual(["2026-10", "2026-09", "2026-08", "2026-07", "2026-06"]);
  });

  it("a new account: only this period", () => {
    expect(reportPeriods({ ...DEFAULT_DATA, transactions: [] } as LocalFinancials, NOW)).toEqual(["2026-10"]);
  });

  it("at a start day of 25, periods and labels follow the account's cycle", () => {
    const d = { ...account(), cycleStartDay: 25 } as LocalFinancials;
    const r = buildMonthlyReport(d, K("2026-09"), NOW); // 25 Sep – 24 Oct
    expect(r.label).toBe("25 Sep – 24 Oct");
    expect(r.noun).toBe("cycle");
    expect(reportPeriods(d, NOW)[0]).toBe("2026-09");
  });
});
