// Session 22, item 3 (wording drafts, HELD): COPY-09. The net-worth advice
// was fixed per tier and never read the data it talks about: "Set a goal to
// hit $5,000 in savings" beside two goals, "Start or grow your safety net"
// with $500 in it, "the negative number is shrinking each month" and "You've
// already cut the deficit a lot" with no look at the trend, and "You're ahead
// of most people your age" with no age. Each now reads what it claims, or
// claims less.
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { computeDashboard } from "./computeDashboard";
import { DEFAULT_DATA, type LocalFinancials, type StoredAsset, type StoredDebt } from "./localData";
import { asCalendarKey } from "./period";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 9, 14, 12, 0)); });
afterEach(() => { vi.useRealTimers(); });

const asset = (value: number) => ({ id: "a1", name: "Car", value, currency: "USD", createdAt: "2026-01-01T00:00:00.000Z" }) as StoredAsset;
const debt = (balance: number) => ({ id: "d1", name: "Loan", balance, openingBalance: balance, apr: 10, minPayment: 100, currency: "USD", createdAt: "2026-01-01T00:00:00.000Z" }) as StoredDebt;
const goal = (id: string, name: string) => ({ id, name, emoji: "🎯", targetAmount: 5000, currentAmount: 0, openingAmount: 0, currency: "USD", targetDate: "2027-12-01", createdAt: "2026-05-01T09:00:00.000Z" });
const SEP = asCalendarKey("2026-09");
const advice = (o: Partial<LocalFinancials>) => computeDashboard({ ...DEFAULT_DATA, income: 3000, ...o } as LocalFinancials).netWorth;

it("breaking even with two goals and $500 in the safety net: no \"Set a goal\", no \"Start or grow\"", () => {
  const nw = advice({ assets: [asset(4341)], emergencyFundOpeningBalance: 500, goals: [goal("g1", "Laptop"), goal("g2", "Wedding")] as LocalFinancials["goals"] });
  expect(nw.total).toBe(4841);
  expect(nw.tier).toBe("Breaking even");
  expect(nw.suggestions).toEqual([
    "Your liabilities are covered. Now every dollar saved is pure net worth growth.",
    "Keep growing your safety net: it's your first true asset.",
    "Keep funding your goals; $5,000 in savings changes how you handle surprises.",
  ]);
});

it("breaking even with no goals and nothing in the safety net: the advice to start both", () => {
  const nw = advice({ assets: [asset(3000)] });
  expect(nw.tier).toBe("Breaking even");
  expect(nw.suggestions).toEqual([
    "Your liabilities are covered. Now every dollar saved is pure net worth growth.",
    "Start your safety net: it's your first true asset.",
    "Set a goal to hit $5,000 in savings; that buffer changes how you handle surprises.",
  ]);
});

it("rebuilding: \"climbing\" only when net worth is up on last month", () => {
  const up = advice({ debts: [debt(10000)], netWorthHistory: [{ ym: SEP, value: -12000 }] });
  expect(up.tier).toBe("Rebuilding");
  expect(up.suggestions[0]).toBe("You're climbing: your net worth is higher than last month.");
  const down = advice({ debts: [debt(10000)], netWorthHistory: [{ ym: SEP, value: -8000 }] });
  expect(down.suggestions[0]).toBe("Each month the negative number shrinks brings zero closer.");
  // "Last month" is the latest month before this one, not the earliest: down on September, though up on August.
  const twoMonths = advice({ debts: [debt(10000)], netWorthHistory: [{ ym: asCalendarKey("2026-08"), value: -20000 }, { ym: SEP, value: -8000 }] });
  expect(twoMonths.suggestions[0]).toBe("Each month the negative number shrinks brings zero closer.");
  const none = advice({ debts: [debt(10000)] });
  expect(none.suggestions[0]).toBe("Each month the negative number shrinks brings zero closer.");
});

it("closing the gap: \"cut the deficit\" only when it's smaller than last month", () => {
  const up = advice({ debts: [debt(3000)], netWorthHistory: [{ ym: SEP, value: -4000 }] });
  expect(up.tier).toBe("Closing the gap");
  expect(up.suggestions[2]).toBe("You've cut the deficit since last month. This is the home stretch, not the starting line.");
  const flat = advice({ debts: [debt(3000)], netWorthHistory: [{ ym: SEP, value: -3000 }] });
  expect(flat.suggestions[2]).toBe("This is the home stretch, not the starting line.");
});

it("foundation builder: no comparison with people of an age ESSA doesn't know", () => {
  const nw = advice({ assets: [asset(10000)] });
  expect(nw.tier).toBe("Foundation builder");
  expect(nw.suggestions[0]).toBe("You're past breaking even. Keep the momentum going.");
});
