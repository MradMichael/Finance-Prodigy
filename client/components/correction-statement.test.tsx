// Phase 2.8.5a (owner-approved, session 42). A correction row states a
// balance; until now it kept only the difference. Each of the five writers now
// also records what was stated and the balance it was computed against, in the
// account's own unit (EF: USD; a debt: its currency; a goal: its currency), so a
// merge can tell two devices' statements apart (2.8.5c/d). This pins, for all
// five, that the stored difference is exactly what the statement implies, with
// each account's own sign:
//   EF and goal:  difference = stated - base   (derivedEfBalance / goalProgress ADD it)
//   debt:         difference = base - stated   (derivedDebtBalance SUBTRACTS it)
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, screen, cleanup } from "@testing-library/react";
import SetupScreen from "./screens/SetupScreen";
import EditDebtSheet from "./EditDebtSheet";
import EditGoalSheet from "./EditGoalSheet";
import { ThemeProvider } from "../contexts/ThemeContext";
import { computeDashboard } from "../lib/computeDashboard";
import {
  DEFAULT_DATA, planEfClose, planDebtClose, derivedEfBalance, derivedDebtBalance, goalProgress,
  type LocalFinancials, type StoredGoal, type StoredDebt, type StoredTransaction,
} from "../lib/localData";

afterEach(cleanup);

const base = (o: Partial<LocalFinancials> = {}) => ({ ...DEFAULT_DATA, income: 3000, transactions: [], ...o }) as LocalFinancials;
const DEBT = { id: "d1", name: "Car", openingBalance: 5000, balance: 5000, apr: 0, minPayment: 100, currency: "USD", createdAt: "2026-01-01T00:00:00.000Z" } as StoredDebt;
const LBP_DEBT = { ...DEBT, id: "d2", name: "Loan", currency: "LBP", openingBalance: 89_500_000 } as StoredDebt;
const GOAL: StoredGoal = { id: "g1", name: "Laptop", emoji: "💻", targetAmount: 1200, currentAmount: 500, openingAmount: 500, currency: "USD", targetDate: "2027-03-01", createdAt: "2026-05-01T09:00:00.000Z" };
const LBP_GOAL: StoredGoal = { ...GOAL, id: "g2", name: "Trip", currency: "LBP", targetAmount: 100_000_000, currentAmount: 0, openingAmount: 44_750_000 };

const onlyNewRow = (before: LocalFinancials, after: LocalFinancials): StoredTransaction => {
  const ids = new Set(before.transactions.map((t) => t.id));
  const fresh = after.transactions.filter((t) => !ids.has(t.id));
  expect(fresh).toHaveLength(1);
  return fresh[0];
};

describe("each correction writer records what was stated and from what", () => {
  it("Setup's emergency fund: $1,000 corrected to $900 states 900 from 1,000, efAmount -100", () => {
    const d = base({ emergencyFundOpeningBalance: 1000 });
    const onChange = vi.fn<(x: LocalFinancials) => void>();
    render(<SetupScreen financials={d} dashData={computeDashboard(d)} onChange={onChange} />);
    const field = document.getElementById("ef-balance")!;
    fireEvent.change(field, { target: { value: "900" } });
    fireEvent.blur(field, { target: { value: "900" } });
    const out = onChange.mock.calls.at(-1)![0];
    const row = onlyNewRow(d, out);
    expect(row.correction).toEqual({ account: "ef", stated: 900, base: 1000 });
    expect(row.efAmount).toBe(-100);
    expect(derivedEfBalance(out)).toBe(900);
  });

  it("Edit Debt: $5,000 corrected to $5,200 states 5,200 from 5,000, debtAdjustment -200", () => {
    const d = base({ debts: [DEBT] });
    const onChange = vi.fn<(x: LocalFinancials) => void>();
    render(<ThemeProvider><EditDebtSheet debt={DEBT} financials={d} onChange={onChange} onClose={vi.fn()} /></ThemeProvider>);
    const field = document.getElementById("edit-debt-balance")!;
    fireEvent.change(field, { target: { value: "5200" } });
    fireEvent.blur(field, { target: { value: "5200" } });
    const out = onChange.mock.calls.at(-1)![0];
    const row = onlyNewRow(d, out);
    expect(row.correction).toEqual({ account: "debt", stated: 5200, base: 5000 });
    expect(row.debtAdjustment).toBe(-200);
    expect(derivedDebtBalance(DEBT, out.transactions, out)).toBe(5200);
  });

  it("Edit Goal: $500 corrected to $650 states 650 from 500, goalAmount +150", () => {
    const d = base({ goals: [GOAL] });
    const onChange = vi.fn<(x: LocalFinancials) => void>();
    render(<ThemeProvider><EditGoalSheet goal={GOAL} financials={d} onChange={onChange} onClose={vi.fn()} /></ThemeProvider>);
    fireEvent.change(document.getElementById("edit-goal-saved")!, { target: { value: "650" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const out = onChange.mock.calls.at(-1)![0];
    const row = onlyNewRow(d, out);
    expect(row.correction).toEqual({ account: "goal", stated: 650, base: 500 });
    expect(row.goalAmount).toBe(150);
    expect(goalProgress(out.goals[0], out)).toBe(650);
  });

  it("an LBP goal is stated in lira: L£44,750,000 corrected to L£53,700,000", () => {
    const d = base({ goals: [LBP_GOAL] });
    const onChange = vi.fn<(x: LocalFinancials) => void>();
    render(<ThemeProvider><EditGoalSheet goal={LBP_GOAL} financials={d} onChange={onChange} onClose={vi.fn()} /></ThemeProvider>);
    fireEvent.change(document.getElementById("edit-goal-saved")!, { target: { value: "53700000" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const row = onlyNewRow(d, onChange.mock.calls.at(-1)![0]);
    expect(row.correction).toEqual({ account: "goal", stated: 53_700_000, base: 44_750_000 });
    expect(row.goalAmount).toBe(8_950_000);
  });

  it("a period close's emergency-fund row: counted $950 against expected $1,000", () => {
    const { transaction } = planEfClose(base({ emergencyFundOpeningBalance: 1000 }), 950);
    expect(transaction!.correction).toEqual({ account: "ef", stated: 950, base: 1000 });
    expect(transaction!.efAmount).toBe(-50);
  });

  it("a period close's debt row, in the debt's own currency: counted L£90,000,000 against L£89,500,000", () => {
    const d = base({ debts: [LBP_DEBT], lbpRate: 89_500 });
    const { transaction } = planDebtClose(LBP_DEBT, [], 90_000_000, d);
    expect(transaction!.correction).toEqual({ account: "debt", stated: 90_000_000, base: 89_500_000 });
    expect(transaction!.debtAdjustment).toBe(-500_000);
    expect(derivedDebtBalance(LBP_DEBT, [transaction!], d)).toBe(90_000_000);
  });
});
