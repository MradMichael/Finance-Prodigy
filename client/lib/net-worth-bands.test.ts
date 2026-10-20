// Item 4a (owner, session 25; plan "NET WORTH BANDS", session 24): the tier
// is net worth in months of Setup's monthly income, not fixed dollars. The
// thresholds and the no-income rule are approved; the four advice lines that
// named fixed dollars are rewritten as drafted, HELD for approval.
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { computeDashboard } from "./computeDashboard";
import { DEFAULT_DATA, type LocalFinancials, type StoredAsset, type StoredDebt } from "./localData";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 9, 14, 12, 0)); });
afterEach(() => { vi.useRealTimers(); });

const asset = (value: number) => ({ id: "a1", name: "Car", value, currency: "USD", createdAt: "2026-01-01T00:00:00.000Z" }) as StoredAsset;
const debt = (balance: number) => ({ id: "d1", name: "Loan", balance, openingBalance: balance, apr: 10, minPayment: 100, currency: "USD", createdAt: "2026-01-01T00:00:00.000Z" }) as StoredDebt;
/** Net worth exactly `total` at `income` a month. */
const nw = (total: number, income: number) =>
  computeDashboard({ ...DEFAULT_DATA, income, ...(total >= 0 ? { assets: [asset(total)] } : { debts: [debt(-total)] }) } as LocalFinancials).netWorth;

const TIERS = ["Heavy debt load", "Rebuilding", "Closing the gap", "Almost positive", "Breaking even", "Foundation builder", "Growing wealth", "Wealth building"];

it("the audit's +$4,841: Growing wealth at $800 a month, Foundation builder at $1,500 and at $3,000", () => {
  expect(nw(4841, 800).tier).toBe("Growing wealth");
  expect(nw(4841, 1500).tier).toBe("Foundation builder");
  expect(nw(4841, 3000).tier).toBe("Foundation builder");
});

it("every edge at $1,500 a month: a dollar below is the tier under it, the edge itself the tier above", () => {
  const edges = [-6, -2, -0.5, 0, 1, 6, 24].map((m) => m * 1500); // −9,000 … 36,000
  edges.forEach((e, i) => {
    expect(nw(e - 1, 1500).tier, `below ${e}`).toBe(TIERS[i]);
    expect(nw(e, 1500).tier, `at ${e}`).toBe(TIERS[i + 1]);
  });
});

it("the colours stay with their tiers", () => {
  expect(nw(-9001, 1500).tierColor).toBe("coral");
  expect(nw(-3001, 1500).tierColor).toBe("coral");
  expect(nw(-1000, 1500).tierColor).toBe("brass");
  expect(nw(500, 1500).tierColor).toBe("brass");
  expect(nw(4841, 1500).tierColor).toBe("jade");
});

it("no income set: no tier, no advice, a neutral colour", () => {
  const r = nw(4841, 0);
  expect(r.total).toBe(4841);
  expect(r.tier).toBeNull();
  expect(r.suggestions).toEqual([]);
  expect(r.tierColor).toBe("mute");
});

it("the four advice lines that named fixed dollars, as drafted (HELD for approval)", () => {
  expect(nw(-20000, 1500).suggestions).toContain("Even a little extra each month cuts months off your payoff date. Run the numbers in Debts.");
  expect(nw(-5000, 1500).suggestions).toContain("Consider a small side income for a few months; even a little a month accelerates this significantly.");
  expect(nw(500, 1500).suggestions).toContain("Set a goal to save one month of income; that buffer changes how you handle surprises.");
  const withGoal = computeDashboard({ ...DEFAULT_DATA, income: 1500, assets: [asset(500)], goals: [{ id: "g1", name: "Laptop", emoji: "💻", targetAmount: 1200, currentAmount: 0, openingAmount: 0, currency: "USD", targetDate: "2027-12-01", createdAt: "2026-05-01T09:00:00.000Z" }] } as unknown as LocalFinancials).netWorth;
  expect(withGoal.suggestions).toContain("Keep funding your goals; a month of income in savings changes how you handle surprises.");
  expect(nw(4841, 1500).suggestions).toContain("Compound growth starts to matter here. Even modest returns make a difference at this size.");
});
