// Period close Phase 5a — the UI half: the fund and debts in the dialog.
//
// The pure half (the planners, the sign conventions, the round trips, the
// reopen undo) is in lib/period-close.phase5a.test.ts. What is here is what
// only the component can answer: that the rows arrive pre-filled, that
// confirming untouched rows writes nothing, that no acknowledgement is
// offered on them, that a close with no tracked balances is possible at all,
// and that adding a second account type did not quietly make the close two
// writes.
//
// UNITS (2.4.138): the fund row is USD, a debt row is the debt's own
// currency, and nothing in this phase converts. The LBP debt is exercised at
// lira-scale figures for the reason 2.4.139 gives — at $85-scale a stray
// conversion would look like a plausible number.
//
// WHICH AXES THESE FIXTURES CANNOT REACH (2.4.116):
//
//   * a fund that is in use but derives to exactly 0 through offsetting
//     contributions. `efInUse` catches it via the opening balance, but the
//     fixture here uses a non-zero derived figure, so the zero-derived-but-
//     in-use branch is covered only by the opening-balance half.
//   * an LBP emergency fund. Unreachable by construction.
//   * MoneyInput's blur clamp on a pre-filled row. The primitive's own
//     behaviour (2.4.74), not this phase's.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import BalanceCheckScreen from "./BalanceCheckScreen";
import { computeDashboard } from "../../lib/computeDashboard";
import {
  DEFAULT_DATA, DEFAULT_LBP_RATE, derivedEfBalance, derivedDebtBalance,
  type LocalFinancials, type StoredDebt, type StoredTransaction, type TrackedBalance,
} from "../../lib/localData";

afterEach(() => { cleanup(); });

const tx = (over: Partial<StoredTransaction>): StoredTransaction => ({
  id: over.id ?? "t", amount: 0, currency: "USD", bucket: "SAVINGS",
  description: "x", date: "2026-09-04", paymentMethod: "other", ...over,
});

const DEBT_LBP: StoredDebt = {
  id: "d2", name: "Family loan", balance: 0, apr: 0, minPayment: 500_000,
  currency: "LBP", lbpRateAtEntry: DEFAULT_LBP_RATE,
  createdAt: "2026-01-01T00:00:00.000Z", openingBalance: 8_950_000,
};
const TB: TrackedBalance = {
  id: "tb1", name: "Cash", paymentMethod: "cash",
  startingBalance: 500, startingDate: "2026-08-01",
  startingAt: "2026-08-01T09:00:00.000Z", currency: "USD",
};

/** Fund derives to 2,425.50; the lira debt to 7,607,500. */
function renderScreen(over: Partial<LocalFinancials> = {}) {
  const data = {
    ...DEFAULT_DATA, income: 3000, cycleStartDay: 27,
    emergencyFundOpeningBalance: 2_400,
    debts: [DEBT_LBP],
    trackedBalances: [],
    transactions: [
      tx({ id: "e1", efAmount: 150 }),
      tx({ id: "e2", efAmount: 75.5 }),
      tx({ id: "e3", efAmount: -200 }),
      tx({ id: "p3", debtId: "d2", amount: 1_342_500, currency: "LBP" }),
    ],
    ...over,
  } as LocalFinancials;
  const onChange = vi.fn();
  render(<BalanceCheckScreen financials={data} dashData={computeDashboard(data)} onChange={onChange} />);
  return { onChange, data };
}
const written = (onChange: ReturnType<typeof vi.fn>): LocalFinancials =>
  onChange.mock.calls[onChange.mock.calls.length - 1][0] as LocalFinancials;

const openDialog = () => fireEvent.click(screen.getByRole("button", { name: /close this cycle/i }));
const confirmClose = () => fireEvent.click(screen.getByRole("button", { name: /^close cycle$/i }));
const fundInput = () => screen.getByLabelText(/what the fund actually holds/i) as HTMLInputElement;
const debtInput = () => screen.getByLabelText(/what Family loan says is owed/i) as HTMLInputElement;

// ───────── 1. the close is no longer about tracked balances ─────────

describe("1. a fund or an open debt is reason enough to close", () => {
  it("the action is offered with ZERO tracked balances", () => {
    // `tracked.length > 0` gated this until Phase 5a -- the last place the
    // feature assumed tracked balances were the only kind of account.
    renderScreen();
    expect(screen.getByRole("button", { name: /close this cycle/i })).toBeTruthy();
  });

  it("and is still not offered when there is genuinely nothing to state", () => {
    // The premise for the test above: the gate is doing work, not just
    // always true now.
    renderScreen({ emergencyFundOpeningBalance: 0, debts: [], transactions: [] });
    expect(screen.queryByRole("button", { name: /close this cycle/i })).toBeNull();
  });

  it("a debt that is fully paid off is not asked about", () => {
    renderScreen({ transactions: [tx({ id: "pz", debtId: "d2", amount: 8_950_000, currency: "LBP" })] });
    openDialog();
    expect(screen.queryByLabelText(/Family loan/i)).toBeNull();
  });
});

// ───────── 2. pre-filled, and free to confirm ─────────

describe("2. the rows arrive already answered", () => {
  it("each row is pre-filled with the figure on record, in its own currency", () => {
    renderScreen();
    openDialog();
    expect(fundInput().value.replace(/,/g, "")).toBe("2425.5");
    expect(debtInput().value.replace(/,/g, "")).toBe("7607500");
  });

  it("confirming without touching anything writes NO transactions", () => {
    // The whole reason adding two account types does not double the work of
    // a close: an unchanged row costs a glance, not a typed figure.
    const { onChange, data } = renderScreen();
    openDialog();
    confirmClose();
    const out = written(onChange);
    expect(out.transactions).toHaveLength(data.transactions!.length);
    const close = out.periodCloses![0];
    expect(close.emergencyFund!.deltaUSD).toBe(0);
    expect(close.emergencyFund!.transactionId).toBeUndefined();
    expect(close.debts![0].deltaNative).toBe(0);
  });

  it("no acknowledgement is offered on an adjustment row, however big the gap", () => {
    // These accounts have no Mismatch badge, so an acknowledgement would
    // suppress nothing -- a control that does nothing visible is worse than
    // no control (2.4.134).
    renderScreen();
    openDialog();
    fireEvent.change(fundInput(), { target: { value: "800" } });
    fireEvent.change(debtInput(), { target: { value: "3000000" } });
    expect(screen.queryByRole("checkbox", { name: /accounted for/i })).toBeNull();
  });
});

// ───────── 3. stating a different figure ─────────

describe("3. a corrected figure becomes a ledger row", () => {
  it("the fund and the lira debt are each corrected in their own unit, in ONE write", () => {
    const { onChange } = renderScreen();
    openDialog();
    fireEvent.change(fundInput(), { target: { value: "2380.25" } });
    fireEvent.change(debtInput(), { target: { value: "7830000" } });
    confirmClose();

    // Atomicity: a second account type must not turn one write into three.
    expect(onChange).toHaveBeenCalledTimes(1);
    const out = written(onChange);

    expect(derivedEfBalance(out)).toBe(2_380.25);
    expect(derivedDebtBalance(DEBT_LBP, out.transactions!)).toBe(7_830_000);

    const close = out.periodCloses![0];
    expect(close.emergencyFund!.deltaUSD).toBe(-45.25);
    expect(close.debts![0].deltaNative).toBe(-222_500);
    expect(close.debts![0].currency).toBe("LBP");
    // The lira figure is not silently a dollar figure: $85-scale would mean
    // a conversion crept in where this phase does none.
    expect(close.debts![0].expectedNative).toBe(7_607_500);
  });

  it("a tracked balance and an adjustment account close together, still one write", () => {
    const { onChange } = renderScreen({ trackedBalances: [TB] });
    openDialog();
    fireEvent.change(screen.getByLabelText(/what Cash actually holds/i), { target: { value: "472.40" } });
    fireEvent.change(fundInput(), { target: { value: "2380.25" } });
    confirmClose();
    expect(onChange).toHaveBeenCalledTimes(1);
    const out = written(onChange);
    // The reanchor, the adjustment and the record all landed together.
    expect(out.trackedBalances![0].startingBalance).toBe(472.4);
    expect(derivedEfBalance(out)).toBe(2_380.25);
    expect(out.periodCloses![0].accounts).toHaveLength(1);
  });
});
