// Phase 2.8.5c (owner-approved, session 42): concurrent corrections, the pure
// rule (tests 1-15 of the approved plan). Two devices each correcting the same
// account before they sync used to have BOTH differences applied (LB3 /
// 2.4.58): neither device's figure. The rule, approved:
//   - a clash is a NEW correction on each side for the same account (present
//     on one side only = made since the copies last met; rows are never
//     removed, only tombstoned, so no clock is needed to see it);
//   - the later statement stays; the OTHER side's new corrections are set
//     aside (soft-deleted, restorable). The kept side's own earlier
//     corrections stay: the kept one was computed on top of them;
//   - a correction crossing an ordinary movement on the other side, or a
//     clash that includes a period close's row: nothing set aside, a notice.
import { describe, it, expect } from "vitest";
import {
  DEFAULT_DATA, mergeTransactions, goalProgress, derivedEfBalance, derivedDebtBalance,
  buildEfAdjustmentTx, buildDebtAdjustmentTx, buildGoalCorrectionTx,
  type LocalFinancials, type StoredTransaction, type StoredGoal, type StoredDebt,
} from "./localData";
import { settleConcurrentCorrections } from "./concurrentCorrections";

const AT = "2026-11-05T12:00:00.000Z";
const GOAL: StoredGoal = { id: "g1", name: "Laptop", emoji: "💻", targetAmount: 1200, currentAmount: 500, openingAmount: 500, currency: "USD", targetDate: "2027-03-01", createdAt: "2026-05-01T09:00:00.000Z" };
const GOAL2: StoredGoal = { ...GOAL, id: "g2", name: "Trip" };
const DEBT = { id: "d1", name: "Car", openingBalance: 5000, balance: 5000, apr: 0, minPayment: 100, currency: "USD", createdAt: "2026-01-01T00:00:00.000Z" } as StoredDebt;
const LBP_DEBT = { ...DEBT, id: "d2", name: "Loan", currency: "LBP", openingBalance: 89_500_000 } as StoredDebt;

const copy = (txs: StoredTransaction[], o: Partial<LocalFinancials> = {}) =>
  ({ ...DEFAULT_DATA, income: 3000, lbpRate: 89_500, emergencyFundOpeningBalance: 1000, goals: [GOAL, GOAL2], debts: [DEBT, LBP_DEBT], transactions: txs, ...o }) as LocalFinancials;
const at = (hm: string) => `2026-11-05T${hm}:00.000Z`;
const as = (t: StoredTransaction, id: string, hm: string): StoredTransaction => ({ ...t, id, createdAt: at(hm), updatedAt: at(hm) });

const goalFix = (id: string, hm: string, stated: number, base: number, goal = GOAL) => as(buildGoalCorrectionTx(goal, stated - base, { stated, base }), id, hm);
const efFix = (id: string, hm: string, stated: number, base: number) => as(buildEfAdjustmentTx(stated - base, { stated, base }), id, hm);
const debtFix = (id: string, hm: string, stated: number, base: number, debt = DEBT) => as(buildDebtAdjustmentTx(debt, base - stated, { stated, base }), id, hm);

/** What a merge does before this rule (union by id), then the rule. */
function settle(local: LocalFinancials, server: LocalFinancials) {
  const merged = { ...local, transactions: mergeTransactions(local.transactions, server.transactions).transactions };
  const ids = (d: LocalFinancials) => new Set(d.transactions.map((t) => t.id));
  return settleConcurrentCorrections(merged, ids(local), ids(server), AT);
}
const live = (d: LocalFinancials) => d.transactions.filter((t) => t.deletedAt == null).map((t) => t.id).sort();
const goalOf = (d: LocalFinancials, id = "g1") => goalProgress(d.goals.find((g) => g.id === id)!, d);

describe("two devices' corrections to one account", () => {
  it("1. goal: phone $600, laptop $650 later -> $650 (was $750); the phone's row set aside, restorable", () => {
    const r = settle(copy([goalFix("p", "10:00", 600, 500)]), copy([goalFix("l", "10:05", 650, 500)]));
    expect(goalOf(r.data)).toBe(650);
    const aside = r.data.transactions.find((t) => t.id === "p")!;
    expect(aside.deletedAt).toBe(AT);
    expect(aside.goalAmount).toBe(100); // intact: Restore brings it back as it was
    expect(r.clashes).toEqual([expect.objectContaining({ kind: "correction", how: "later", account: "goal", key: "goal:g1", name: "Laptop", currency: "USD", kept: 650, other: 600 })]);
  });

  it("2. both state the same $600 -> $600 (was $700), and says they agreed", () => {
    const r = settle(copy([goalFix("p", "10:00", 600, 500)]), copy([goalFix("l", "10:05", 600, 500)]));
    expect(goalOf(r.data)).toBe(600);
    expect(r.clashes).toEqual([expect.objectContaining({ how: "same", kept: 600, other: 600 })]);
  });

  it("3. emergency fund: $900 then $950 -> $950 (was $850)", () => {
    const r = settle(copy([efFix("p", "10:00", 900, 1000)]), copy([efFix("l", "10:05", 950, 1000)]));
    expect(derivedEfBalance(r.data)).toBe(950);
    expect(r.clashes).toEqual([expect.objectContaining({ account: "ef", key: "ef", kept: 950, other: 900, currency: "USD" })]);
  });

  it("4. debt (it subtracts): $5,200 then $5,150 -> $5,150 (was $5,350), and the other way round -> $5,200", () => {
    const later = settle(copy([debtFix("p", "10:00", 5200, 5000)]), copy([debtFix("l", "10:05", 5150, 5000)]));
    expect(derivedDebtBalance(DEBT, later.data.transactions, later.data)).toBe(5150);
    const earlier = settle(copy([debtFix("p", "10:10", 5200, 5000)]), copy([debtFix("l", "10:05", 5150, 5000)]));
    expect(derivedDebtBalance(DEBT, earlier.data.transactions, earlier.data)).toBe(5200);
    expect(earlier.clashes[0]).toMatchObject({ account: "debt", key: "debt:d1", name: "Car", kept: 5200, other: 5150 });
  });

  it("5. the kept side's own earlier correction stays (the kept one was built on it); the other side's go", () => {
    const phone = copy([goalFix("a1", "10:00", 600, 500), goalFix("a2", "10:10", 700, 600)]);
    const laptopEarlier = copy([goalFix("b1", "10:05", 650, 500)]);
    const r1 = settle(phone, laptopEarlier);
    expect(goalOf(r1.data)).toBe(700);
    expect(live(r1.data)).toEqual(["a1", "a2"]);
    const laptopLater = copy([goalFix("b1", "10:20", 650, 500)]);
    const r2 = settle(phone, laptopLater);
    expect(goalOf(r2.data)).toBe(650);
    expect(live(r2.data)).toEqual(["b1"]);
  });
});

describe("what is not a clash", () => {
  it("6. a correction made after seeing the other one (on both sides now) is left alone", () => {
    const seen = goalFix("l", "10:05", 650, 500);
    const r = settle(copy([seen, goalFix("p", "10:30", 700, 650)]), copy([seen]));
    expect(goalOf(r.data)).toBe(700);
    expect(r.clashes).toEqual([]);
  });

  it("7. a correction on one side only is left alone", () => {
    const r = settle(copy([goalFix("p", "10:00", 600, 500)]), copy([]));
    expect(goalOf(r.data)).toBe(600);
    expect(r.clashes).toEqual([]);
  });

  it("8. corrections to two different accounts don't touch each other; only the shared one is settled", () => {
    const r = settle(
      copy([goalFix("p1", "10:00", 600, 500), goalFix("p2", "10:00", 300, 500, GOAL2)]),
      copy([goalFix("l1", "10:05", 650, 500)]),
    );
    expect(goalOf(r.data, "g1")).toBe(650);
    expect(goalOf(r.data, "g2")).toBe(300);
    expect(r.clashes.map((c) => c.key)).toEqual(["goal:g1"]);
  });

  it("15. a deleted or purged correction on the other side doesn't count", () => {
    const gone = { ...goalFix("l", "10:05", 650, 500), deletedAt: at("10:06") };
    const r = settle(copy([goalFix("p", "10:00", 600, 500)]), copy([gone]));
    expect(goalOf(r.data)).toBe(600);
    expect(r.clashes).toEqual([]);
  });
});

describe("notice only, nothing set aside", () => {
  it("9. a correction crossing a contribution: both stay ($650), and it says so with both figures", () => {
    const contribution = { id: "c", amount: 50, currency: "USD", bucket: "SAVINGS", goalId: "g1", description: "Goal: Laptop", date: "2026-11-05", createdAt: at("10:00"), updatedAt: at("10:00") } as StoredTransaction;
    const r = settle(copy([contribution]), copy([goalFix("l", "10:05", 600, 500)]));
    expect(goalOf(r.data)).toBe(650);
    expect(live(r.data)).toEqual(["c", "l"]);
    expect(r.clashes).toEqual([expect.objectContaining({ how: "crossed", key: "goal:g1", kept: 600, moved: 50, result: 650 })]);
  });

  it("10. a clash that includes a period close's row: nothing set aside, a notice", () => {
    const closeRow = efFix("p", "10:00", 900, 1000);
    const phone = copy([closeRow], { periodCloses: [{ cycleKey: "2026-10", emergencyFund: { expectedUSD: 1000, countedUSD: 900, deltaUSD: -100, transactionId: "p" } } as never] });
    const r = settle(phone, copy([efFix("l", "10:05", 950, 1000)]));
    expect(derivedEfBalance(r.data)).toBe(850);
    expect(live(r.data)).toEqual(["l", "p"]);
    expect(r.clashes).toEqual([expect.objectContaining({ how: "close", key: "ef" })]);
  });
});

describe("properties", () => {
  it("11. which device is 'local' changes nothing: same row set aside, same record id", () => {
    const phone = copy([goalFix("p", "10:00", 600, 500)]), laptop = copy([goalFix("l", "10:05", 650, 500)]);
    const a = settle(phone, laptop), b = settle(laptop, phone);
    expect(live(a.data)).toEqual(live(b.data));
    expect(a.clashes[0].id).toBe(b.clashes[0].id);
  });

  it("12. settling the result again changes nothing", () => {
    const r = settle(copy([goalFix("p", "10:00", 600, 500)]), copy([goalFix("l", "10:05", 650, 500)]));
    const ids = new Set(r.data.transactions.map((t) => t.id));
    const again = settleConcurrentCorrections(r.data, ids, ids, "2026-11-06T00:00:00.000Z");
    expect(again.data.transactions).toEqual(r.data.transactions);
    expect(again.clashes).toEqual([]);
  });

  it("13. rows from before 2.8.5a (no statement) are still caught; their figures are unknown, not guessed", () => {
    const old = (id: string, hm: string, delta: number) => as(buildGoalCorrectionTx(GOAL, delta), id, hm);
    const r = settle(copy([old("p", "10:00", 100)]), copy([old("l", "10:05", 150)]));
    expect(goalOf(r.data)).toBe(650);
    expect(r.clashes[0]).toMatchObject({ how: "later", kept: null, other: null });
  });

  it("13b. a statement no longer matching its row (the row was edited since) isn't trusted", () => {
    const edited = { ...goalFix("l", "10:05", 650, 500), goalAmount: 120 };
    const r = settle(copy([goalFix("p", "10:00", 600, 500)]), copy([edited]));
    expect(goalOf(r.data)).toBe(620);
    expect(r.clashes[0]).toMatchObject({ kept: null, other: 600 });
  });

  it("14. lira accounts in lira: an LBP debt L£90,000,000 then L£90,200,000 -> L£90,200,000", () => {
    const r = settle(copy([debtFix("p", "10:00", 90_000_000, 89_500_000, LBP_DEBT)]), copy([debtFix("l", "10:05", 90_200_000, 89_500_000, LBP_DEBT)]));
    expect(derivedDebtBalance(LBP_DEBT, r.data.transactions, r.data)).toBe(90_200_000);
    expect(r.clashes[0]).toMatchObject({ key: "debt:d2", currency: "LBP", kept: 90_200_000, other: 90_000_000 });
  });
});
