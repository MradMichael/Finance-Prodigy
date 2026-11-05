// Phase 2.8.5b (owner-approved, session 42). isCorrectionFor -- "a ledger row
// that states a balance, as opposed to one that moves it" -- was private to
// the period close's reopen (planCloseUndo) and knew EF and debts only. The
// merge's concurrent-correction rule (2.8.5c) needs the same question for all
// three accounts, so it is exported and learns goals, rather than a second copy
// being written (F1). EF and debt answers are pinned unchanged.
import { describe, it, expect } from "vitest";
import { isCorrectionFor, buildEfAdjustmentTx, buildDebtAdjustmentTx, buildGoalCorrectionTx, type StoredTransaction, type StoredDebt, type StoredGoal } from "./localData";

const DEBT = { id: "d1", name: "Car", openingBalance: 5000, balance: 5000, apr: 0, minPayment: 100, currency: "USD", createdAt: "2026-01-01T00:00:00.000Z" } as StoredDebt;
const GOAL = { id: "g1", name: "Laptop", emoji: "💻", targetAmount: 1200, currentAmount: 500, openingAmount: 500, currency: "USD", targetDate: "2027-03-01", createdAt: "2026-05-01T09:00:00.000Z" } as StoredGoal;
const row = (o: Partial<StoredTransaction>) => ({ id: "t", amount: 50, currency: "USD", bucket: "SAVINGS", description: "x", date: "2026-10-01", ...o }) as StoredTransaction;

describe("isCorrectionFor", () => {
  it("emergency fund, unchanged: a $0 row carrying efAmount is one; a spend that also drew from the fund is not", () => {
    expect(isCorrectionFor(buildEfAdjustmentTx(-100), "ef")).toBe(true);
    expect(isCorrectionFor(row({ bucket: "NEEDS", amount: 325, efAmount: -300 }), "ef")).toBe(false);
  });

  it("debt, unchanged: a debtAdjustment on that debt is one; a payment is not; another debt's is not", () => {
    expect(isCorrectionFor(buildDebtAdjustmentTx(DEBT, -200), { debtId: "d1" })).toBe(true);
    expect(isCorrectionFor(row({ debtId: "d1", amount: 100 }), { debtId: "d1" })).toBe(false);
    expect(isCorrectionFor(buildDebtAdjustmentTx(DEBT, -200), { debtId: "d2" })).toBe(false);
  });

  it("goal: Edit Goal's $0 correction is one; a contribution is not, nor one whose value the v7 migration froze", () => {
    expect(isCorrectionFor(buildGoalCorrectionTx(GOAL, 150), { goalId: "g1" })).toBe(true);
    expect(isCorrectionFor(row({ goalId: "g1", amount: 50 }), { goalId: "g1" })).toBe(false);
    expect(isCorrectionFor(row({ goalId: "g1", amount: 10, currency: "USD", goalAmount: 895_000 }), { goalId: "g1" })).toBe(false);
    expect(isCorrectionFor(buildGoalCorrectionTx(GOAL, 150), { goalId: "g2" })).toBe(false);
  });

  it("a deleted row is never one, for any account", () => {
    const at = "2026-10-02T00:00:00.000Z";
    expect(isCorrectionFor({ ...buildEfAdjustmentTx(-100), deletedAt: at }, "ef")).toBe(false);
    expect(isCorrectionFor({ ...buildDebtAdjustmentTx(DEBT, -200), deletedAt: at }, { debtId: "d1" })).toBe(false);
    expect(isCorrectionFor({ ...buildGoalCorrectionTx(GOAL, 150), deletedAt: at }, { goalId: "g1" })).toBe(false);
  });
});
