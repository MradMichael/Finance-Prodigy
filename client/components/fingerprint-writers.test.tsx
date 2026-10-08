// Plan H, part 5b, on screen: a person's edit stamps when it was made;
// an automatic write never does; a deletion is recorded.
//
// The fingerprint rule settles a two-sided change by the later edit time, so
// the stamp must mean "a person changed this, then". An automatic write that
// stamped (the budget heal, a contribution's achievedAt) would let a machine
// beat the other device's real edit. A deletion that went unrecorded would
// come back from the other device's copy at the next merge (union).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SetupScreen from "./screens/SetupScreen";
import CurrencyScreen from "./screens/CurrencyScreen";
import BudgetScreen from "./screens/BudgetScreen";
import GoalsScreen from "./screens/GoalsScreen";
import EditGoalSheet from "./EditGoalSheet";
import EditDebtSheet from "./EditDebtSheet";
import EditRecurringSheet from "./EditRecurringSheet";
import PayDebtSheet from "./PayDebtSheet";
import InputPanel from "./InputPanel";
import { ThemeProvider } from "../contexts/ThemeContext";
import { computeDashboard } from "../lib/computeDashboard";
import { DEFAULT_DATA, type LocalFinancials, type StoredGoal, type StoredDebt, type StoredRecurring } from "../lib/localData";

const NOW = new Date("2026-10-08T12:00:00.000Z");
const AT = NOW.toISOString();
const GOAL: StoredGoal = { id: "g1", name: "Laptop", emoji: "💻", targetAmount: 1200, currentAmount: 0, openingAmount: 100, currency: "USD", targetDate: "2027-03-01", createdAt: "2026-05-01T09:00:00.000Z" };
const DEBT = { id: "d1", name: "Card", openingBalance: 2000, balance: 2000, apr: 18, minPayment: 50, currency: "USD", createdAt: "2026-01-01T00:00:00.000Z" } as StoredDebt;
const REC = { id: "r1", name: "Rent", emoji: "🏠", amount: 900, currency: "USD", frequency: "monthly", bucket: "NEEDS", startDate: "2026-01-01", createdAt: "2026-01-01T00:00:00.000Z" } as StoredRecurring;
const base = (o: Partial<LocalFinancials> = {}) => ({ ...DEFAULT_DATA, income: 3000, transactions: [], ...o }) as LocalFinancials;

let onChange: ReturnType<typeof vi.fn<(d: LocalFinancials) => void>>;
const last = () => onChange.mock.calls[onChange.mock.calls.length - 1][0] as LocalFinancials;
beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  onChange = vi.fn<(d: LocalFinancials) => void>();
  vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("settings: each editor stamps its own setting, and only that one", () => {
  const setup = (d = base()) => render(<SetupScreen financials={d} dashData={computeDashboard(d)} onChange={onChange} />);

  it("income", () => {
    setup();
    fireEvent.change(document.getElementById("setup-income")!, { target: { value: "3400" } });
    expect(last().settingsUpdatedAt).toEqual({ income: AT });
  });

  it("emergency-fund target", () => {
    setup();
    fireEvent.change(document.getElementById("ef-target-months")!, { target: { value: "8" } });
    expect(last().settingsUpdatedAt).toEqual({ efTarget: AT });
  });

  it("payday, once moved", () => {
    setup();
    fireEvent.change(document.getElementById("setup-payday")!, { target: { value: "25" } });
    fireEvent.click(screen.getByRole("button", { name: "Move payday" }));
    expect(last().settingsUpdatedAt).toEqual({ payday: AT });
  });

  it("the exchange rate", () => {
    render(<CurrencyScreen financials={base({ lbpRate: 89_500 })} onChange={onChange} />);
    const field = screen.getByLabelText(/LBP \/ USD exchange rate/i);
    fireEvent.change(field, { target: { value: "90000" } });
    fireEvent.blur(field, { target: { value: "90000" } });
    expect(last().settingsUpdatedAt).toEqual({ lbpRate: AT });
  });

  it("another setting's stamp is kept, not replaced", () => {
    setup(base({ settingsUpdatedAt: { lbpRate: "2026-10-01T00:00:00.000Z" } }));
    fireEvent.change(document.getElementById("setup-income")!, { target: { value: "3400" } });
    expect(last().settingsUpdatedAt).toEqual({ lbpRate: "2026-10-01T00:00:00.000Z", income: AT });
  });
});

describe("the budget split", () => {
  const budget = (d: LocalFinancials) => render(<BudgetScreen financials={d} dashData={computeDashboard(d)} onChange={onChange} />);

  it("choosing a model stamps it", () => {
    budget(base({ budgetRule: "50-30-20" }));
    fireEvent.click(screen.getByRole("button", { name: /^70 \/ 20 \/ 10/ }));
    expect(last().settingsUpdatedAt).toEqual({ budget: AT });
  });

  it("moving a slider stamps it", () => {
    budget(base({ budgetRule: "custom", budgetCustomNeeds: 60, budgetCustomWants: 30 }));
    fireEvent.change(screen.getByLabelText("Custom Needs percentage"), { target: { value: "55" } });
    expect(last().settingsUpdatedAt).toEqual({ budget: AT });
  });

  it("the heal is automatic: it corrects the split and stamps nothing", () => {
    budget(base({ budgetRule: "custom", budgetCustomNeeds: 85, budgetCustomWants: 15 }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(last().budgetCustomWants).not.toBe(15); // premise: the heal ran
    expect(last().settingsUpdatedAt).toBeUndefined();
  });

  it("dismissing the heal's notice changes no setting, so stamps nothing", () => {
    budget(base({ budgetRule: "custom", budgetCustomNeeds: 80, budgetCustomWants: 10, budgetSplitHealedAt: "2026-10-07T00:00:00.000Z", budgetSplitHealedFrom: { needs: 85, wants: 15 } }));
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(last().budgetSplitHealedAt).toBeUndefined(); // premise: dismissed
    expect(last().settingsUpdatedAt).toBeUndefined();
  });
});

describe("records: an edit stamps updatedAt", () => {
  it("a goal", () => {
    const d = base({ goals: [GOAL] });
    render(<ThemeProvider><EditGoalSheet goal={GOAL} financials={d} onChange={onChange} onClose={vi.fn()} /></ThemeProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(last().goals[0].updatedAt).toBe(AT);
  });

  it("a debt", () => {
    const d = base({ debts: [DEBT] });
    render(<ThemeProvider><EditDebtSheet debt={DEBT} financials={d} onChange={onChange} onClose={vi.fn()} /></ThemeProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(last().debts[0].updatedAt).toBe(AT);
  });

  it("a recurring item", () => {
    const d = base({ recurring: [REC] });
    render(<ThemeProvider><EditRecurringSheet recurring={REC} financials={d} onChange={onChange} onClose={vi.fn()} /></ThemeProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(last().recurring[0].updatedAt).toBe(AT);
  });

  it("pausing a goal", () => {
    const d = base({ goals: [GOAL] });
    render(<ThemeProvider><GoalsScreen dashData={computeDashboard(d)} financials={d} onChange={onChange} onEdit={vi.fn()} /></ThemeProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Pause goal" }));
    expect(last().goals[0]).toMatchObject({ pausedAt: AT, updatedAt: AT });
  });
});

describe("a payment that pays a debt off is the person's edit to it", () => {
  const pay = (amount: string) => {
    const d = base({ debts: [{ ...DEBT, openingBalance: 50, balance: 50 }] });
    render(<ThemeProvider><PayDebtSheet debt={d.debts[0]} financials={d} onChange={onChange} onClose={vi.fn()} /></ThemeProvider>);
    fireEvent.change(document.getElementById("pay-debt-amount")!, { target: { value: amount } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    return last().debts[0];
  };

  it("paid off: paidOffAt and updatedAt", () => {
    expect(pay("50")).toMatchObject({ paidOffAt: AT, updatedAt: AT });
  });

  it("a part payment changes nothing on the debt itself, so stamps nothing", () => {
    const d = pay("20");
    expect(d.paidOffAt).toBeUndefined();
    expect(d.updatedAt).toBeUndefined();
  });
});

describe("automatic writes don't stamp", () => {
  it("a contribution that reaches the target stamps achievedAt, not updatedAt", () => {
    const g = { ...GOAL, targetAmount: 150 };
    const d = base({ goals: [g] });
    render(<ThemeProvider><GoalsScreen dashData={computeDashboard(d)} financials={d} onChange={onChange} onEdit={vi.fn()} /></ThemeProvider>);
    fireEvent.click(screen.getByRole("button", { name: /Add payment/ }));
    fireEvent.change(screen.getByPlaceholderText(/amount/i), { target: { value: "50" } });
    fireEvent.click(screen.getByRole("button", { name: "Pay" }));
    expect(last().goals[0].achievedAt).toBeTruthy(); // premise: it was reached
    expect(last().goals[0].updatedAt).toBeUndefined();
  });
});

describe("deletions are recorded, so the other device's copy can't bring them back", () => {
  const panel = (d: LocalFinancials) => render(<InputPanel financials={d} dashData={computeDashboard(d)} onChange={onChange} onEdit={vi.fn()} onPay={vi.fn()} />);
  const manage = async (section: RegExp) => {
    vi.useRealTimers(); // userEvent waits on real timers
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Manage/ }));
    await user.click(screen.getByRole("button", { name: section }));
    return user;
  };

  it("a goal", async () => {
    panel(base({ goals: [GOAL] }));
    const user = await manage(/Goals/);
    await user.click(screen.getByRole("button", { name: "Delete goal" }));
    expect(last().goals).toEqual([]);
    expect(last().deletedKeys?.goals?.map((t) => t.key)).toEqual(["g1"]);
  });

  it("a debt", async () => {
    panel(base({ debts: [DEBT] }));
    const user = await manage(/Debts/);
    await user.click(screen.getByRole("button", { name: "Delete debt" }));
    expect(last().debts).toEqual([]);
    expect(last().deletedKeys?.debts?.map((t) => t.key)).toEqual(["d1"]);
  });
});
