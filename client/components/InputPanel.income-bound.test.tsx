// 2.4.78: an absurd INCOME transaction reached month.income and inflated
// every figure derived from it. The Setup income ceiling (2.4.71) bounds
// `data.income`, but computeDashboard computes
//
//     const income = data.income + incomeTx;      // computeDashboard.ts:360
//
// and `incomeTx` -- the sum of this month's one-off INCOME transactions --
// had no ceiling at all, because transaction amounts are entered through
// MoneyInput, which bounded nothing. Observed live at 5,647,581,472,358,400
// on the Projections cap derived from it.
//
// This is the assertion that ties back to that finding: it drives the real
// transaction form, submits an absurd INCOME amount, and feeds the resulting
// financials to the real computeDashboard. It is deliberately end-to-end
// rather than a unit test of the clamp -- a unit test would prove MoneyInput
// clamps, not that an absurd income can no longer reach the figure that
// multiplies every budget target, the health score and every projection.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import InputPanel from "./InputPanel";
import { computeDashboard } from "../lib/computeDashboard";
import { DEFAULT_DATA, MONEY_MAX_USD, type LocalFinancials } from "../lib/localData";

const NOW = new Date(2026, 6, 15); // July 15, 2026

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); });

/** The figure from the live report -- ~10^15, far beyond any real income. */
const ABSURD = "5647581472358400";

function renderPanel() {
  const data: LocalFinancials = { ...DEFAULT_DATA, income: 1830, budgetRule: "50-30-20" };
  let latest: LocalFinancials = data;
  const onChange = vi.fn((updated: LocalFinancials) => { latest = updated; });
  render(
    <InputPanel
      financials={data}
      dashData={computeDashboard(data)}
      onChange={onChange}
      onEdit={vi.fn()}
      onPay={vi.fn()}
    />,
  );
  return { onChange, getLatest: () => latest };
}

describe("2.4.78 — an absurd INCOME transaction cannot reach month.income", () => {
  it("clamps the amount at entry, so the resulting month.income stays bounded", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { getLatest } = renderPanel();

    // Income type, so the amount lands in incomeTx rather than a spend bucket.
    await user.click(screen.getByRole("button", { name: /Income/i }));
    const amount = screen.getByLabelText("Amount") as HTMLInputElement;
    await user.clear(amount);
    await user.type(amount, ABSURD);
    fireEvent.blur(amount); // MoneyInput clamps on blur, not per keystroke
    await user.type(screen.getByLabelText("Description"), "Absurd");
    await user.click(screen.getByRole("button", { name: "+ Add entry" }));

    const after = getLatest();
    const income = after.transactions.filter((t) => t.bucket === "INCOME");
    expect(income).toHaveLength(1);

    // The stored amount is bounded...
    expect(income[0].amount).toBeLessThanOrEqual(MONEY_MAX_USD);
    // ...and so, therefore, is the figure that multiplies every target.
    const dash = computeDashboard(after);
    expect(dash.month.income).toBeLessThanOrEqual(1830 + MONEY_MAX_USD);
    expect(Number.isFinite(dash.month.income)).toBe(true);

    // The premise: without a bound this would have been ~5.6e15, so the
    // assertions above discriminate rather than passing vacuously.
    expect(Number(ABSURD)).toBeGreaterThan(MONEY_MAX_USD);
  });

  it("a legitimate income amount is untouched -- the bound catches magnitude, not plausibility", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { getLatest } = renderPanel();

    await user.click(screen.getByRole("button", { name: /Income/i }));
    const amount = screen.getByLabelText("Amount") as HTMLInputElement;
    await user.clear(amount);
    await user.type(amount, "2500");
    fireEvent.blur(amount);
    await user.type(screen.getByLabelText("Description"), "Bonus");
    await user.click(screen.getByRole("button", { name: "+ Add entry" }));

    const income = getLatest().transactions.filter((t) => t.bucket === "INCOME");
    expect(income).toHaveLength(1);
    expect(income[0].amount).toBe(2500);
  });
});
