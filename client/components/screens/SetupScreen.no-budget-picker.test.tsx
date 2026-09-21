// 2.4.129: the budget rule has exactly one editing surface.
//
// Setup carried a second, independent copy of BudgetScreen's rule picker and
// custom sliders. Its own source comment admitted the duplication and named
// the consequence -- "must floor the same way (MIN_SPLIT_PCT) or a user
// editing the split from Setup instead of Budget can still squeeze
// Needs/Wants to 0%, the exact bug fixed elsewhere this session but missed
// here since this is a separate implementation".
//
// It had drifted again by 2026-09-21: Setup's sliders wrote
// budgetCustomNeeds/Wants through a plain update() and never cleared
// budgetSplitHealedAt/From, so editing the split there left BudgetScreen's
// heal notice standing and describing the user's OWN choice as the heal's
// doing (2.4.127 finding B). `grep budgetSplitHealed SetupScreen.tsx`
// returned 0 -- that screen had no knowledge of the mechanism at all.
//
// THE PAIR BELOW IS THE POINT, and neither half means much alone:
//
//   1. Setup writes nothing -- no picker, no sliders, no path at all.
//   2. The one remaining writer clears the stamp.
//
// Together they say "one writer, and it maintains the invariant." Part 2
// overlaps BudgetScreen.heal-notice.test.tsx's own slider test, and that
// duplication is deliberate rather than overlooked: over there it asserts
// that a writer behaves; here it is the second half of an exhaustiveness
// claim, and if Setup's copy ever comes back this file is where the pair
// stops holding.
//
// WHICH INPUTS THESE FIXTURES CANNOT REACH (2.4.116):
//
//   * a THIRD writer added somewhere else later. Part 1 asserts Setup
//     specifically, not "no other screen in the app" -- a test cannot prove
//     a global absence. The grep that established there were only two
//     writers is recorded in 2.4.129; re-run it, do not trust this file for
//     that claim.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import SetupScreen from "./SetupScreen";
import BudgetScreen from "./BudgetScreen";
import { computeDashboard } from "../../lib/computeDashboard";
import { DEFAULT_DATA, BUDGET_RULES, type LocalFinancials } from "../../lib/localData";

afterEach(() => { cleanup(); });

function setup(over: Partial<LocalFinancials> = {}) {
  const data = { ...DEFAULT_DATA, income: 3000, ...over } as LocalFinancials;
  const onChange = vi.fn();
  render(<SetupScreen financials={data} dashData={computeDashboard(data)} onChange={onChange} />);
  return { onChange };
}

// ───────── 1. Setup no longer edits the budget split at all ─────────

describe("1. Setup has no budget-rule surface", () => {
  it("renders none of the five preset tiles, on a preset account", () => {
    setup({ budgetRule: "50-30-20" });
    for (const key of ["40-30-30", "50-30-20", "60-20-20", "70-20-10", "80-15-5"] as const) {
      expect(screen.queryByText(BUDGET_RULES[key].label)).toBeNull();
    }
  });

  it("renders no sliders, on a CUSTOM account — the branch that used to reveal them", () => {
    // The custom side is the one that mattered: the sliders were gated on
    // `budgetRule === "custom"`, so a preset fixture would show nothing here
    // even before the removal and would prove nothing.
    setup({ budgetRule: "custom", budgetCustomNeeds: 85, budgetCustomWants: 10 });
    expect(screen.queryByLabelText(/Custom Needs percentage/i)).toBeNull();
    expect(screen.queryByLabelText(/Custom Wants percentage/i)).toBeNull();
    expect(screen.queryByText(/Budget split model/i)).toBeNull();
    expect(screen.queryByText(/Custom percentages/i)).toBeNull();
  });

  it("still renders the fields it kept — this is a removal, not an emptying", () => {
    // Premise for every absence above: the screen rendered at all. Without
    // this, a SetupScreen that threw and rendered nothing would pass the
    // whole of section 1.
    setup({ budgetRule: "custom" });
    expect(screen.getByText("Profile")).toBeTruthy();
    expect(screen.getByText("Safety net")).toBeTruthy();
    expect(screen.getByLabelText(/Target \(months of income\)/i)).toBeTruthy();
  });

  it("has no clickable control left at all — the picker tiles were its only buttons", () => {
    // queryAllByRole, and the COUNT is the assertion. A "click every button
    // and check nothing writes" sweep would be vacuous here, because there
    // are none -- so the honest form is to state that, not to run an empty
    // loop and call it coverage (2.4.97).
    setup({ budgetRule: "custom", budgetCustomNeeds: 85, budgetCustomWants: 10 });
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("its remaining inputs never touch budgetRule or the custom split", () => {
    // The inputs DO write (income, payday, EF target, EF balance). Driving
    // each one and asserting the three budget fields come through unchanged
    // is what rules out a shared handler still carrying them.
    const { onChange } = setup({ budgetRule: "custom", budgetCustomNeeds: 85, budgetCustomWants: 10 });
    const inputs = screen.getAllByRole("textbox").concat(screen.getAllByRole("spinbutton", { hidden: true }));
    // Premise: there really are inputs to drive, so the assertions below are
    // not passing on an empty list.
    expect(inputs.length).toBeGreaterThan(0);
    for (const el of inputs) fireEvent.change(el, { target: { value: "7" } });
    expect(onChange.mock.calls.length).toBeGreaterThan(0);
    for (const call of onChange.mock.calls) {
      const next = call[0] as LocalFinancials;
      expect(next.budgetRule).toBe("custom");
      expect(next.budgetCustomNeeds).toBe(85);
      expect(next.budgetCustomWants).toBe(10);
    }
  });
});

// ───────── 2. the one remaining writer maintains the invariant ─────────

describe("2. the single remaining writer clears the heal stamp", () => {
  it("moving Budget's slider drops budgetSplitHealedAt and budgetSplitHealedFrom", () => {
    const data = {
      ...DEFAULT_DATA, income: 3000,
      budgetRule: "custom", budgetCustomNeeds: 85, budgetCustomWants: 10,
      budgetSplitHealedAt: "2026-08-29T09:00:00.000Z",
      budgetSplitHealedFrom: { needs: 85, wants: 15 },
    } as LocalFinancials;
    const onChange = vi.fn();
    render(<BudgetScreen financials={data} dashData={computeDashboard(data)} onChange={onChange} />);

    // Premise: 85/10 is already in range, so the heal effect does NOT fire
    // and the only onChange below is the slider's own.
    expect(onChange).not.toHaveBeenCalled();
    // fireEvent, not userEvent: a range input does not respond to typed keys
    // in jsdom, so a keyboard-driven version would assert on an event that
    // never happened.
    fireEvent.change(screen.getByLabelText(/Custom Needs percentage/i), { target: { value: "80" } });

    const saved = onChange.mock.calls[0][0] as LocalFinancials;
    expect(saved.budgetCustomNeeds).toBe(80);
    expect(saved.budgetSplitHealedAt).toBeUndefined();
    expect(saved.budgetSplitHealedFrom).toBeUndefined();
  });
});
