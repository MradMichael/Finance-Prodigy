// Plan H, part 5a (owner-approved, session 5): goal progress is COMPUTED --
// openingAmount + the goal's live contributions -- instead of a stored
// running total that two devices' contributions would overwrite each other
// in. Contributions convert at the rate stored on each one, never today's;
// one with no stored rate whose currency differs from its goal's has its
// converted amount frozen (goalAmount) at the v7 migration. The migration
// sets openingAmount = currentAmount − live contributions, so nothing jumps,
// and never corrects a negative result: those are listed for the owner.
import { describe, it, expect } from "vitest";
import {
  DEFAULT_DATA, migrateFinancials, goalProgress, applyGoalContribution, negativeGoalOpenings, softDelete, buildGoalCorrectionTx,
  CURRENT_SCHEMA_VERSION, type LocalFinancials, type StoredGoal, type StoredTransaction,
} from "./localData";

const goal = (o: Partial<StoredGoal> = {}): StoredGoal => ({
  id: "g1", name: "Laptop", emoji: "💻", targetAmount: 1200, currentAmount: 0, currency: "USD", targetDate: "2027-03-01", createdAt: "2026-05-01T09:00:00.000Z", ...o,
});
const contrib = (id: string, amount: number, o: Partial<StoredTransaction> = {}): StoredTransaction =>
  ({ id, amount, currency: "USD", bucket: "SAVINGS", description: "Goal: Laptop", date: "2026-09-10", goalId: "g1", ...o }) as StoredTransaction;
const data = (o: Partial<LocalFinancials>): LocalFinancials => ({ ...DEFAULT_DATA, income: 3000, ...o }) as LocalFinancials;

describe("progress is computed", () => {
  it("is the opening amount plus live contributions; a deleted one doesn't count", () => {
    const d = data({ goals: [goal({ openingAmount: 100 })], transactions: [contrib("c1", 50), contrib("c2", 25), softDelete({}, contrib("c3", 999), "2026-09-11T00:00:00.000Z")] });
    expect(goalProgress(d.goals[0], d)).toBe(175);
  });

  it("converts at the rate stored on each contribution, not today's rate", () => {
    const lira = contrib("c1", 895_000, { currency: "LBP", lbpRateAtEntry: 89_500 }); // $10 at its own rate
    const d = data({ goals: [goal({ openingAmount: 0 })], transactions: [lira], lbpRate: 100_000 });
    expect(goalProgress(d.goals[0], d)).toBe(10);
    expect(goalProgress(d.goals[0], { ...d, lbpRate: 50_000 })).toBe(10); // today's rate moves nothing
  });

  it("uses a frozen converted amount when one was stored", () => {
    const d = data({ goals: [goal({ openingAmount: 0 })], transactions: [contrib("c1", 895_000, { currency: "LBP", goalAmount: 9.5 })] });
    expect(goalProgress(d.goals[0], d)).toBe(9.5);
  });

  it("two devices' contributions both count once their transactions have merged", () => {
    // Each device contributed; the stored total on each device knew only its own.
    const d = data({ goals: [goal({ openingAmount: 100, currentAmount: 150 })], transactions: [contrib("phone", 50), contrib("laptop", 70)] });
    expect(goalProgress(d.goals[0], d)).toBe(220);
  });
});

describe("the v7 migration", () => {
  const v6 = (goals: StoredGoal[], transactions: StoredTransaction[], extra: Partial<LocalFinancials> = {}) =>
    ({ ...DEFAULT_DATA, schemaVersion: 6, goals, transactions, ...extra }) as unknown as LocalFinancials;

  it("sets openingAmount so progress equals the stored total: nothing visibly jumps", () => {
    const m = migrateFinancials(v6(
      [goal({ currentAmount: 400 }), goal({ id: "g2", name: "Car", currentAmount: 1000, currency: "LBP" })],
      [contrib("c1", 150), contrib("c2", 50), softDelete({}, contrib("c3", 30), "2026-09-11T00:00:00.000Z"), contrib("c4", 500_000, { goalId: "g2", currency: "LBP", lbpRateAtEntry: 89_500 })],
    ));
    expect(m.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(m.goals.map((g) => g.openingAmount)).toEqual([200, -499_000]);
    expect(m.goals.map((g) => goalProgress(g, m))).toEqual([400, 1000]);
  });

  it("freezes the converted amount of a contribution with no stored rate in another currency", () => {
    // A lira goal funded in dollars, with no rate on the row: converted once, at its month's rate.
    const m = migrateFinancials(v6([goal({ currency: "LBP", currentAmount: 1_000_000 })], [contrib("c1", 10, { currency: "USD" })], { lbpRate: 89_500 }));
    expect(m.transactions[0].goalAmount).toBe(895_000);
    expect(goalProgress(m.goals[0], m)).toBe(1_000_000); // no jump
    expect(goalProgress(m.goals[0], { ...m, lbpRate: 120_000 })).toBe(1_000_000); // frozen
  });

  it("never corrects a negative opening amount, and lists it", () => {
    const m = migrateFinancials(v6([goal({ currentAmount: 100 }), goal({ id: "g2", name: "Car", currentAmount: 900 })], [contrib("c1", 250)]));
    expect(m.goals[0].openingAmount).toBe(-150);
    expect(goalProgress(m.goals[0], m)).toBe(100);
    expect(negativeGoalOpenings(m)).toEqual([{ id: "g1", name: "Laptop", currency: "USD", storedTotal: 100, contributions: 250, openingAmount: -150 }]);
  });

  it("keeps an opening amount a later run already set", () => {
    const m = migrateFinancials(v6([goal({ currentAmount: 400, openingAmount: 7 })], [contrib("c1", 150)]));
    expect(m.goals[0].openingAmount).toBe(7);
  });
});

describe("writers", () => {
  it("a contribution adds its transaction and leaves the stored total alone", () => {
    const d = data({ goals: [goal({ openingAmount: 100, currentAmount: 100 })], transactions: [] });
    const r = applyGoalContribution(d.goals, "g1", 60, 89_500, {}, d.transactions)!;
    expect(r.goals[0].currentAmount).toBe(100);
    expect(goalProgress(r.goals[0], { ...d, goals: r.goals, transactions: [r.transaction] })).toBe(160);
  });

  it("achievedAt is stamped once, the first time computed progress reaches the target", () => {
    const g = goal({ openingAmount: 1100, targetAmount: 1200 });
    const first = applyGoalContribution([g], "g1", 150, 89_500, {}, [])!;
    expect(first.goals[0].achievedAt).toBeTruthy();
    const second = applyGoalContribution(first.goals, "g1", 10, 89_500, {}, [first.transaction])!;
    expect(second.goals[0].achievedAt).toBe(first.goals[0].achievedAt);
  });

  it("an achievedAt already set is never moved by a later contribution", () => {
    const g = goal({ openingAmount: 1300, targetAmount: 1200, achievedAt: "2026-01-15" });
    expect(applyGoalContribution([g], "g1", 10, 89_500, {}, [])!.goals[0].achievedAt).toBe("2026-01-15");
  });

  it("an edit of the saved amount is a $0 correction row carrying the difference", () => {
    const g = goal({ openingAmount: 100 });
    const tx = buildGoalCorrectionTx(g, 40);
    expect(tx).toMatchObject({ amount: 0, goalId: "g1", goalAmount: 40, currency: "USD", bucket: "SAVINGS" });
    expect(goalProgress(g, data({ goals: [g], transactions: [tx] }))).toBe(140);
  });
});
