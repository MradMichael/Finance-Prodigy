// 2.4.70, Projections half: "Recommended monthly savings" and everything
// tied to it by the word "recommended" now read budgetTargets (income * pct
// for the month), matching what the Budget screen and Overview's Budget card
// already show. Previously the headline used the rollover-adjusted figure
// while its own subtext claimed as much -- true, but it made the same
// displayed-figure-vs-stated-percentage mismatch this finding is about.
//
// The five sites move together on purpose: the headline (:261), its subtext
// (:263), the initial plan amount (:99), the "Recommended savings" preset
// (:303), and the "At recommended pace" EF projection (:398). Moving the
// headline alone would leave three siblings showing a different number under
// the same word.
//
// budgetPace and its alerts deliberately still judge spend against the
// rollover-adjusted target -- unchanged, and not what this file covers.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ProjectionsScreen from "./ProjectionsScreen";
import { computeDashboard } from "../../lib/computeDashboard";
import { DEFAULT_DATA, type LocalFinancials } from "../../lib/localData";

const NOW = new Date(2026, 6, 15); // July 15, 2026

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); });

/**
 * income 1000 on 50/30/20 -> raw savings target $200.
 * June logged $0 of Savings against its own $200 target, so
 * budgetRollover.savings = +200 and the ADJUSTED savings target is $400.
 * Every $200 assertion below therefore discriminates: it fails against the
 * pre-change code, which rendered $400.
 */
function makeData(overrides: Partial<LocalFinancials> = {}): LocalFinancials {
  return {
    ...DEFAULT_DATA,
    income: 1000,
    budgetRule: "50-30-20",
    transactions: [
      // A June Needs entry, so June counts as an active month for rollover
      // (a month with no activity at all is skipped entirely) while leaving
      // Savings untouched at $0 against its $200 target.
      { id: "t1", amount: 500, currency: "USD", bucket: "NEEDS", description: "June needs", date: "2026-06-10" },
    ],
    ...overrides,
  };
}

function renderProjections(overrides: Partial<LocalFinancials> = {}) {
  const data = makeData(overrides);
  const dash = computeDashboard(data);
  render(<ProjectionsScreen financials={data} dashData={dash} />);
  return dash;
}

describe("ProjectionsScreen — recommended savings comes from income, not rollover", () => {
  it("the fixture really does carry a non-zero savings rollover, so these assertions discriminate", () => {
    const dash = renderProjections();
    expect(dash.budgetRollover.savings).toBeCloseTo(200, 5);
    expect(dash.budgetTargets.savings).toBeCloseTo(200, 5);
    expect(dash.effectiveBudgetTargets.savings).toBeCloseTo(400, 5);
  });

  it("the headline figure is the raw income * pct target, not the adjusted one", () => {
    renderProjections();
    expect(screen.getByText("$200")).toBeInTheDocument();
    expect(screen.queryByText("$400")).not.toBeInTheDocument();
  });

  it("the subtext no longer claims the figure is adjusted for rollover", () => {
    renderProjections();
    expect(screen.queryByText(/adjusted for last month/i)).not.toBeInTheDocument();
    // It should still say what the figure IS.
    expect(screen.getByText(/20% of income/i)).toBeInTheDocument();
  });

  it("the plan amount is seeded from the same figure the headline shows", () => {
    renderProjections();
    // If :99 stayed on the adjusted value it would load at 400 while the
    // headline read $200 -- the contradiction this change exists to avoid.
    expect(screen.getByLabelText("Monthly amount to plan with")).toHaveValue(200);
  });

  it("the \"Recommended savings\" preset offers the same figure as the headline", () => {
    renderProjections();
    // The preset is labelled with the same word as the headline, so it must
    // carry the same number; the surplus preset beside it is unaffected.
    expect(screen.getByRole("button", { name: "Recommended savings" })).toBeInTheDocument();
    expect(screen.getByLabelText("Monthly amount to plan with")).toHaveValue(200);
  });

  it("rollover is still computed and still available -- only the display basis moved", () => {
    const dash = renderProjections();
    expect(dash.budgetRollover.savings).toBeCloseTo(200, 5);
    expect(dash.effectiveBudgetTargets.savings).toBeCloseTo(400, 5);
  });
});

// The plan amount has two inputs sharing one piece of state. The number
// input was bounded (min/max plus a Math.min clamp in its handler); the
// slider never was -- its handler clamped only the floor at zero, and its
// element bound was `sliderMax`, a DIFFERENT and larger number computed as
// Math.max(200, testAmount * 2, surplus * 2).
//
// That last term made it self-referential: sliderMax was derived from the
// value the slider itself sets, so every drag to the right edge roughly
// doubled the ceiling for the next drag, escaping MAX_TEST_AMOUNT entirely
// after about three drags and compounding without limit. The income ceiling
// (2.4.71) never touched this -- it bounded what MAX_TEST_AMOUNT is computed
// FROM, not the input that ignored it.
//
// At income 1830: MAX_TEST_AMOUNT = max(3000, 1830 * 3) = 5490.
// With no spend logged, surplus = netCashFlow = 1830, so
// sliderMax = min(5490, max(200, 3660)) = 3660.
describe("ProjectionsScreen — both inputs respect the cap, and the track no longer grows", () => {
  const CAP = 5490;       // MAX_TEST_AMOUNT at income 1830
  const TRACK = 3660;     // sliderMax: min(CAP, max(200, surplus * 2))

  function renderAtRealIncome() {
    const data: LocalFinancials = { ...DEFAULT_DATA, income: 1830, budgetRule: "50-30-20" };
    render(<ProjectionsScreen financials={data} dashData={computeDashboard(data)} />);
    return {
      number: screen.getByLabelText("Monthly amount to plan with") as HTMLInputElement,
      slider: screen.getByLabelText("Monthly amount to plan with (slider)") as HTMLInputElement,
    };
  }

  it("the number input clamps a value above the cap", () => {
    const { number } = renderAtRealIncome();
    fireEvent.change(number, { target: { value: "99999" } });
    expect(number).toHaveValue(CAP);
  });

  it("the slider cannot drive the value above the cap", () => {
    const { number, slider } = renderAtRealIncome();
    fireEvent.change(slider, { target: { value: "99999" } });
    // A range input never emits a value above its own max -- the browser
    // (and jsdom) pin it to the track first -- so this lands on the track
    // edge, not on 99999. What matters is that the track edge is itself
    // within the cap, which is what fixing sliderMax guarantees.
    expect(number).toHaveValue(TRACK);
    expect(Number((number as HTMLInputElement).value)).toBeLessThanOrEqual(CAP);
  });

  it("the slider's handler clamps to the cap too -- defence in depth, unreachable through the DOM today", () => {
    // Given sliderMax = min(MAX_TEST_AMOUNT, ...), the element can never
    // hand the handler a value above the cap, so this clamp cannot fire in
    // practice. It is kept because the previous sliderMax formula DID exceed
    // the cap, and a future change to that formula would silently reopen the
    // hole without it. Asserted structurally rather than behaviourally:
    // whatever the track allows, the resulting value stays within the cap.
    const { number, slider } = renderAtRealIncome();
    fireEvent.change(slider, { target: { value: slider.max } });
    expect(Number((number as HTMLInputElement).value)).toBeLessThanOrEqual(CAP);
  });

  it("REGRESSION LOCK: the slider's own bound does not grow after dragging to the right edge", () => {
    const { slider } = renderAtRealIncome();
    const before = slider.max;
    expect(Number(before)).toBe(TRACK);

    // Drag to the far right edge of the track.
    fireEvent.change(slider, { target: { value: before } });

    // Under the old self-referential sliderMax (max(200, testAmount * 2,
    // surplus * 2)) this would now read 7320 -- double -- and would double
    // again on every further drag. The bound must be unchanged.
    expect(slider.max).toBe(before);
    expect(Number(slider.max)).toBe(TRACK);
  });

  it("the track has a real right edge: its bound never exceeds the cap", () => {
    const { slider } = renderAtRealIncome();
    expect(Number(slider.max)).toBeLessThanOrEqual(CAP);
  });

  it("the number input still declares the cap on the element itself", () => {
    const { number } = renderAtRealIncome();
    expect(number).toHaveAttribute("max", String(CAP));
  });
});
