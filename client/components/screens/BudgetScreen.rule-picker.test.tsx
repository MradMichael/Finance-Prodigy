// The budget-rule picker: applyRule and its three call sites.
//
// 2.4.92 carried "the budget-rule picker is uncovered" forward for four
// sessions. 2.4.104's method first -- diff against the tested siblings
// before writing anything -- and the diff is what shaped this file:
//
//   * BudgetScreen.test.tsx covers DISPLAYED TARGETS (income * pct, not
//     rollover-adjusted). It never clicks anything.
//   * BudgetScreen.heal-notice.test.tsx covers the CUSTOM side only, and
//     only the heal: floorCustomSplit firing on mount, the stamp, dismissal.
//     Its one preset fixture (`50-30-20`) exists solely to prove the heal
//     does NOT fire, so the preset side is a control there, never a subject.
//   * SetupScreen.remaining-fields.test.tsx covers floorCustomSplit as a
//     pure function.
//
// So the untested surface is exactly the picker: the five preset tiles, the
// Custom tile, and the suggestion banner -- the preset/custom axis the heal
// tests sit on one side of. That is what this file covers.
//
// WHICH INPUTS THESE FIXTURES CANNOT REACH (2.4.116):
//
//   * the sliders. They live behind `ruleKey === "custom"` and are already
//     covered by the heal tests; this file asserts only that they APPEAR,
//     which is the picker's own consequence.
//   * budgetRuleHistory. applyRule does not write it -- the snapshot effect
//     in page.tsx does, on save. Asserted here as an absence (applyRule's
//     contract), not exercised; the write itself belongs to page.tsx's own
//     tests.
//   * startDay. The picker has no period logic at all -- no cycle key, no
//     date. Stated rather than run at both values, because running it twice
//     would assert nothing extra and imply a dependency that is not there.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import BudgetScreen from "./BudgetScreen";
import { computeDashboard } from "../../lib/computeDashboard";
import {
  DEFAULT_DATA, BUDGET_RULES, todayISO,
  type LocalFinancials, type StoredTransaction,
} from "../../lib/localData";
import { asCycleKey } from "../../lib/period";

afterEach(() => { cleanup(); });

const INCOME = 3000;

/** NEEDS spend in the current cycle, as a share of income. */
function needsTx(pctOfIncome: number): StoredTransaction[] {
  return [{
    id: "n1", amount: Math.round(INCOME * (pctOfIncome / 100)), currency: "USD",
    bucket: "NEEDS", description: "Rent", date: todayISO(),
  }];
}

function renderBudget(over: Partial<LocalFinancials> = {}) {
  const data = { ...DEFAULT_DATA, income: INCOME, ...over } as LocalFinancials;
  const onChange = vi.fn();
  render(<BudgetScreen financials={data} dashData={computeDashboard(data)} onChange={onChange} />);
  return { onChange, data };
}
const saved = (onChange: ReturnType<typeof vi.fn>): LocalFinancials | undefined =>
  onChange.mock.calls.length ? onChange.mock.calls[0][0] as LocalFinancials : undefined;

const tile = (label: string) => screen.getByRole("button", { name: new RegExp(label.replace(/\//g, "\\/")) });

// ───────────────────── 1. the five preset tiles ─────────────────────

const PRESETS = ["40-30-30", "50-30-20", "60-20-20", "70-20-10", "80-15-5"] as const;

describe("1. the preset tiles", () => {
  for (const key of PRESETS) {
    it(`"${BUDGET_RULES[key].label}" selects ${key}`, () => {
      // Start from a rule that is NOT the one being clicked, so a click that
      // did nothing cannot pass by coincidence.
      const from = key === "50-30-20" ? "40-30-30" : "50-30-20";
      const { onChange } = renderBudget({ budgetRule: from });
      fireEvent.click(tile(BUDGET_RULES[key].label));
      expect(saved(onChange)!.budgetRule).toBe(key);
    });
  }

  it("marks exactly one tile active, and it is the stored rule", () => {
    renderBudget({ budgetRule: "70-20-10" });
    const active = screen.getAllByText("✓ active");
    expect(active).toHaveLength(1);
    // The marker is inside the tile, so the tile's text carries both.
    expect(active[0].closest("button")!.textContent).toContain("70 / 20 / 10");
  });

  it("renders all five presets plus Custom — six tiles, not five", () => {
    // The grid filters `custom` out of BUDGET_RULES and renders it as its
    // own tile afterwards. A regression that dropped the separate tile would
    // leave no way to reach custom at all from this screen.
    renderBudget();
    for (const key of PRESETS) expect(tile(BUDGET_RULES[key].label)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Custom/ })).toBeTruthy();
  });
});

// ───────────────────── 2. applyRule's contract ─────────────────────

describe("2. applyRule writes the rule and nothing else", () => {
  it("leaves the custom percentages, the heal stamp and the history untouched", () => {
    // This is the contract the heal tests depend on from the other side:
    // switching to a preset must not clear or rewrite the custom split, or
    // switching back would silently lose it.
    const { onChange, data } = renderBudget({
      budgetRule: "custom", budgetCustomNeeds: 60, budgetCustomWants: 30,
      // Flat shape, not {ym, value}: budgetRuleHistory is
      // CycleHistory<{needs,wants,savings}>, which spreads the payload onto
      // the row. tsc caught this fixture being wrong -- worth the comment,
      // because the sibling histories (income, netWorth, lbpRate) DO use
      // `value` and the difference is easy to miss.
      budgetRuleHistory: [{ ym: asCycleKey("2026-08"), needs: 50, wants: 30, savings: 20 }],
    } as Partial<LocalFinancials>);
    fireEvent.click(tile(BUDGET_RULES["70-20-10"].label));
    const out = saved(onChange)!;
    expect(out.budgetRule).toBe("70-20-10");
    expect(out.budgetCustomNeeds).toBe(60);
    expect(out.budgetCustomWants).toBe(30);
    // Same array reference: applyRule spreads financials, so history is
    // carried, not rebuilt. page.tsx's snapshot effect owns the write.
    expect(out.budgetRuleHistory).toBe(data.budgetRuleHistory);
  });
});

// ───────────────────── 3. the custom tile ─────────────────────

describe("3. the Custom tile", () => {
  it("selects custom and reveals the sliders", () => {
    const { onChange } = renderBudget({ budgetRule: "50-30-20" });
    // Premise: the sliders are genuinely hidden on a preset, so their
    // appearance below is the picker's doing.
    expect(screen.queryByLabelText(/Custom Needs percentage/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Custom/ }));
    expect(saved(onChange)!.budgetRule).toBe("custom");
  });

  it("shows the sliders once custom is the stored rule", () => {
    renderBudget({ budgetRule: "custom", budgetCustomNeeds: 60, budgetCustomWants: 30 });
    expect(screen.getByLabelText(/Custom Needs percentage/i)).toBeTruthy();
  });

  it("a fresh account's Custom is 50/30/20 — the same split as the Standard preset", () => {
    // Not a defect, pinned because it is surprising: budgetCustomNeeds
    // defaults to 50 and budgetCustomWants to 30, so choosing "Custom" on a
    // new account changes the label and nothing else until a slider moves.
    renderBudget({ budgetRule: "custom" });
    const needs = screen.getByLabelText(/Custom Needs percentage/i) as HTMLInputElement;
    const wants = screen.getByLabelText(/Custom Wants percentage/i) as HTMLInputElement;
    expect(needs.value).toBe("50");
    expect(wants.value).toBe("30");
  });
});

// ───────────────────── 4. the suggestion banner ─────────────────────

describe("4. the suggestion banner — the third call site", () => {
  it("offers the tightest preset that actually fits the overrun", () => {
    // Needs at 60% of income against a 50% split: the first rule in
    // suggestRule's order whose needs >= 60 is 60-20-20.
    renderBudget({ budgetRule: "50-30-20", transactions: needsTx(60) });
    expect(screen.getByText("A better fit might be available")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Switch to 60 \/ 20 \/ 20/ })).toBeTruthy();
  });

  it("applies that rule when clicked", () => {
    const { onChange } = renderBudget({ budgetRule: "50-30-20", transactions: needsTx(60) });
    fireEvent.click(screen.getByRole("button", { name: /Switch to 60 \/ 20 \/ 20/ }));
    expect(saved(onChange)!.budgetRule).toBe("60-20-20");
  });

  it("stays hidden when needs fit inside the current split", () => {
    renderBudget({ budgetRule: "50-30-20", transactions: needsTx(40) });
    expect(screen.queryByText("A better fit might be available")).toBeNull();
  });

  it("stays hidden on a custom rule, whatever the overrun", () => {
    // Deliberate: there is no "tighter preset" to offer someone who has
    // already set their own percentages.
    renderBudget({ budgetRule: "custom", budgetCustomNeeds: 50, budgetCustomWants: 30, transactions: needsTx(90) });
    expect(screen.queryByText("A better fit might be available")).toBeNull();
  });

  it("stays hidden at zero income — every percentage would be meaningless", () => {
    renderBudget({ income: 0, budgetRule: "50-30-20", transactions: needsTx(60) });
    expect(screen.queryByText("A better fit might be available")).toBeNull();
  });
});

// ───────── 5. REPORTED, NOT ENCODED — these record wrong behaviour ─────────
//
// it.fails: the assertion is what SHOULD happen, and the test passes only
// while the app disagrees with it. When either is fixed, the test goes red
// and must be converted to a plain `it`. Nothing here asserts that the
// current behaviour is correct.

describe("5. known-wrong, recorded rather than pinned", () => {
  it.fails("A: needs over 80% should not be offered 'Switch to Custom' — it is a LOOSER-to-TIGHTER move in the wrong direction", () => {
    // suggestRule walks 40/50/60/70/80 and returns "custom" when nothing
    // fits. The banner then renders BUDGET_RULES.custom's label and desc and
    // offers "Switch to Custom" -- but custom's percentages come from
    // budgetCustomNeeds/Wants, which default to 50/30. So a user whose needs
    // are eating 90% of income is told a 50%-needs split "would be a more
    // realistic fit" than the 80% one they are already overrunning.
    //
    // The honest options are to suppress the banner once 80-15-5 is
    // exhausted (there is nothing tighter to suggest), or to have the custom
    // suggestion seed the sliders from actualNeedsPct. Not decided here.
    renderBudget({ budgetRule: "80-15-5", transactions: needsTx(90) });
    expect(screen.queryByText("A better fit might be available")).toBeNull();
  });

  it.fails("B: a heal stamp survives switching away from custom, so the notice resurfaces later", () => {
    // The heal notice renders only inside the `ruleKey === "custom"` block.
    // budgetSplitHealedAt/HealedFrom are cleared on dismiss or on moving a
    // slider -- neither of which happens if the user switches to a preset
    // instead. The stamp persists, hidden, and reappears whenever they next
    // choose Custom, describing an adjustment from another session entirely.
    //
    // Same family as 2.4.106: a notice that outlives the moment it
    // describes. The fix is presumably to clear the stamp in applyRule when
    // leaving custom, but that is a decision, not a cleanup.
    renderBudget({
      budgetRule: "50-30-20", budgetCustomNeeds: 85, budgetCustomWants: 10,
      budgetSplitHealedAt: new Date().toISOString(),
      budgetSplitHealedFrom: { needs: 85, wants: 15 },
    } as Partial<LocalFinancials>);
    fireEvent.click(screen.getByRole("button", { name: /Custom/ }));
    // Re-render as the app would after that write, now on custom:
    cleanup();
    renderBudget({
      budgetRule: "custom", budgetCustomNeeds: 85, budgetCustomWants: 10,
      budgetSplitHealedAt: new Date().toISOString(),
      budgetSplitHealedFrom: { needs: 85, wants: 15 },
    } as Partial<LocalFinancials>);
    expect(screen.queryByText(/has been adjusted|was adjusted|below 5%/i)).toBeNull();
  });
});
