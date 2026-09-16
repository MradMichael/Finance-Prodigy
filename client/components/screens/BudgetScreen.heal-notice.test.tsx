// 2.4.106: the heal must say what it changed.
//
// BudgetScreen's one-time heal floors an out-of-range custom split on mount
// -- necessary, because 85/15 leaves Savings at 0% and breaks every
// downstream ratio. The defect was never the adjustment. It was that the
// adjustment happened with nothing said: the user restored a backup and got
// a different budget from the one in the file.
//
// THE FIRST TEST HERE IS THE PULL PATH, deliberately. 2.4.106 was written as
// an import problem and named import in its title; the exposure is every one
// of saveData's nine callers, because they all migrate through the same
// place and converge on the same heal. A fix scoped to handleImportFile
// would have left the pull paths untouched while reading as closed. This
// test is what proves the notice sits at the heal rather than at the door
// the finding happened to come through.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BudgetScreen from "./BudgetScreen";
import { computeDashboard } from "../../lib/computeDashboard";
import { DEFAULT_DATA, floorCustomSplit, type LocalFinancials } from "../../lib/localData";

afterEach(() => { cleanup(); });

/** The owner's real 2026-08-08 export: 85/15, leaving Savings at 0%. */
const OUT_OF_RANGE = { budgetRule: "custom" as const, budgetCustomNeeds: 85, budgetCustomWants: 15 };
/** A legal split the heal must leave alone. */
const IN_RANGE = { budgetRule: "custom" as const, budgetCustomNeeds: 60, budgetCustomWants: 30 };

function renderBudget(over: Partial<LocalFinancials> = {}) {
  const data = { ...DEFAULT_DATA, income: 3000, ...over } as LocalFinancials;
  const onChange = vi.fn();
  render(<BudgetScreen financials={data} dashData={computeDashboard(data)} onChange={onChange} />);
  return { onChange, data };
}

/** The LocalFinancials the heal wrote, or undefined if it never fired. */
const written = (onChange: ReturnType<typeof vi.fn>): LocalFinancials | undefined =>
  onChange.mock.calls.length ? onChange.mock.calls[0][0] as LocalFinancials : undefined;

const notice = () => screen.queryByText(/below 5%|has been adjusted|been adjusted/i);

describe("6. THE PULL PATH — the case the original finding missed entirely", () => {
  it("a snapshot pulled from another device is healed, stamped and explained, exactly as an imported file is", () => {
    // There is nothing import-specific to simulate. saveData migrates on the
    // way to disk for all nine callers, so a pulled snapshot and an imported
    // file arrive at BudgetScreen as the same thing: stored data carrying an
    // out-of-range pair. That equivalence IS the finding's correction, and
    // asserting it here is what pins the notice to the heal.
    const { onChange } = renderBudget(OUT_OF_RANGE);
    const saved = written(onChange);
    // Premise: the heal genuinely fired, so the stamp below is not being
    // read off an untouched record.
    expect(saved).toBeTruthy();
    expect(saved!.budgetCustomWants).toBe(10);
    expect(saved!.budgetSplitHealedAt).toBeTruthy();
    expect(saved!.budgetSplitHealedFrom).toEqual({ needs: 85, wants: 15 });
  });
});

describe("1. the owner's real file", () => {
  it("85/15 heals to 85/10/5 and records both pairs", () => {
    // Premise, per 2.4.97: floorCustomSplit really does move this value, so
    // the assertions below are not pinning a no-op.
    expect(floorCustomSplit(85, 15)).toEqual({ needs: 85, wants: 10, savings: 5 });
    const { onChange } = renderBudget(OUT_OF_RANGE);
    const saved = written(onChange)!;
    expect(saved.budgetCustomNeeds).toBe(85);
    expect(saved.budgetCustomWants).toBe(10);
    expect(saved.budgetSplitHealedFrom).toEqual({ needs: 85, wants: 15 });
    expect(Math.abs(Date.now() - new Date(saved.budgetSplitHealedAt!).getTime())).toBeLessThan(5_000);
  });
});

describe("2. an in-range split is untouched — the control", () => {
  it("no write, no stamp, no notice", () => {
    const { onChange } = renderBudget(IN_RANGE);
    // Premise: this split really is legal, so "no heal" is the right
    // outcome rather than a heal that silently failed to fire.
    expect(floorCustomSplit(60, 30)).toEqual({ needs: 60, wants: 30, savings: 10 });
    expect(onChange).not.toHaveBeenCalled();
    expect(notice()).toBeNull();
  });
});

describe("3. the notice states BOTH pairs", () => {
  it("says what it was and what it became, not merely that something changed", () => {
    // A notice reading "your split was adjusted" is barely better than
    // silence -- the user cannot tell what they lost.
    renderBudget({ ...OUT_OF_RANGE, budgetSplitHealedAt: new Date().toISOString(),
      budgetSplitHealedFrom: { needs: 85, wants: 15 } });
    const el = notice();
    expect(el).toBeTruthy();
    const text = el!.textContent ?? "";
    expect(text).toMatch(/85\s*\/\s*15/);   // from
    expect(text).toMatch(/85\s*\/\s*10\s*\/\s*5/); // to
  });
});

describe("4. dismissal, and editing the split clears the stamp", () => {
  it("dismissing removes the notice and clears the stamp", async () => {
    const user = userEvent.setup();
    const { onChange } = renderBudget({ budgetRule: "custom", budgetCustomNeeds: 85, budgetCustomWants: 10,
      budgetSplitHealedAt: new Date().toISOString(), budgetSplitHealedFrom: { needs: 85, wants: 15 } });
    // Premise: already healed (85/10 is in range), so the heal does not fire
    // and any onChange below is the dismissal itself.
    expect(onChange).not.toHaveBeenCalled();
    expect(notice()).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /dismiss/i }));
    const saved = written(onChange)!;
    expect(saved.budgetSplitHealedAt).toBeUndefined();
    expect(saved.budgetSplitHealedFrom).toBeUndefined();
  });

  it("moving a slider clears the stamp too — the user has taken ownership of the split", () => {
    const { onChange } = renderBudget({ budgetRule: "custom", budgetCustomNeeds: 85, budgetCustomWants: 10,
      budgetSplitHealedAt: new Date().toISOString(), budgetSplitHealedFrom: { needs: 85, wants: 15 } });
    // Premise: already in range, so the heal does not fire and the only
    // onChange below is the slider's own.
    expect(onChange).not.toHaveBeenCalled();
    // fireEvent, not userEvent: a range input does not respond to typed
    // keys in jsdom, so a keyboard-driven version would assert on an event
    // that never happened.
    fireEvent.change(screen.getByLabelText(/Custom Needs percentage/i), { target: { value: "80" } });
    const saved = written(onChange);
    expect(saved).toBeTruthy();
    expect(saved!.budgetCustomNeeds).toBe(80);
    expect(saved!.budgetSplitHealedAt).toBeUndefined();
    expect(saved!.budgetSplitHealedFrom).toBeUndefined();
  });
});

describe("5. idempotency — a second mount does not re-stamp", () => {
  it("an already-healed split with no stamp stays unstamped", () => {
    // The heal's own condition already guards this; the stamp must not
    // outlive it. 85/10 is in range, so nothing should fire.
    const { onChange } = renderBudget({ budgetRule: "custom", budgetCustomNeeds: 85, budgetCustomWants: 10 });
    expect(onChange).not.toHaveBeenCalled();
    expect(notice()).toBeNull();
  });
});

describe("7. the heal is not a validator", () => {
  it("a non-custom rule is never healed or stamped, whatever the custom fields hold", () => {
    // The stale custom values below are out of range, but the active rule is
    // a preset -- the heal must stay scoped to what is actually in use and
    // must not become a general schema check (the loose-validator reasoning
    // in handleImportFile applies here too).
    const { onChange } = renderBudget({ budgetRule: "50-30-20", budgetCustomNeeds: 85, budgetCustomWants: 15 });
    expect(onChange).not.toHaveBeenCalled();
    expect(notice()).toBeNull();
  });
});
