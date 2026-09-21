// 2.4.130: the heal notice is a standing state, not an event.
//
// 2.4.127 finding B had two halves. The half where the notice was FALSE --
// Setup's own sliders rewriting the split without clearing the stamp -- went
// with 2.4.129, which deleted that surface. This is the other half: on the
// BudgetScreen-only path the notice is entirely ACCURATE and merely late.
// The heal writes the healed values at the same moment it stamps, and
// applyRule leaves both untouched, so a preset round-trip returns to a
// notice whose "from" and "to" are both true. It just said "it was
// adjusted", which reads as "just now", weeks after the fact.
//
// Three changes, and the middle one is the load-bearing one:
//   * present tense for the current split ("is held at")
//   * THE DATE, read from budgetSplitHealedAt -- stored since 2.4.106 and
//     never once rendered; BudgetScreen used it only as a truthiness gate
//   * "Got it" instead of a bare x, because dismissing records an
//     acknowledgement rather than closing a transient
//
// WHICH INPUTS THESE FIXTURES CANNOT REACH (2.4.116):
//
//   * a stamp with no budgetSplitHealedFrom. `healedFrom` is gated on
//     budgetSplitHealedAt and both are written together by the heal, so the
//     half-stamped state is unconstructible through the app. The date render
//     is still guarded for it, and that guard is untested here on purpose --
//     asserting an unreachable branch would be asserting the guard, not the
//     behaviour.
//   * locale. fmtDate is DD/MM/YYYY unconditionally. Choosing a locale-aware
//     format is a localisation decision and is deliberately not taken here.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import BudgetScreen from "./BudgetScreen";
import { computeDashboard } from "../../lib/computeDashboard";
import { DEFAULT_DATA, type LocalFinancials } from "../../lib/localData";

afterEach(() => { cleanup(); });

/**
 * Stamped on 29 August 2026 -- WEEKS before any plausible run date, and a
 * different day/month/year-position from today whatever today is. If the
 * component rendered `new Date()` instead of reading the stored stamp, every
 * date assertion below would fail rather than coincidentally pass. That is
 * the whole point of not using a recent timestamp here.
 */
const HEALED_AT = "2026-08-29T09:00:00.000Z";
const HEALED_ON = "29/08/2026";

function renderHealed(over: Partial<LocalFinancials> = {}) {
  const data = {
    ...DEFAULT_DATA, income: 3000,
    budgetRule: "custom", budgetCustomNeeds: 85, budgetCustomWants: 10,
    budgetSplitHealedAt: HEALED_AT,
    budgetSplitHealedFrom: { needs: 85, wants: 15 },
    ...over,
  } as LocalFinancials;
  const onChange = vi.fn();
  render(<BudgetScreen financials={data} dashData={computeDashboard(data)} onChange={onChange} />);
  return { onChange };
}

const notice = () => screen.queryByRole("button", { name: /dismiss/i })?.parentElement ?? null;
const noticeText = () => notice()?.textContent ?? "";

describe("1. the date — read from the stamp, not from today", () => {
  it("renders the stored date, weeks old", () => {
    renderHealed();
    // Premise: the notice is rendering at all, so a missing date below is a
    // missing date rather than a missing notice.
    expect(notice()).toBeTruthy();
    expect(noticeText()).toContain(HEALED_ON);
  });

  it("does NOT render today's date — the assertion the fixture exists for", () => {
    // If the component called new Date() the test above would still pass on
    // 29 August and fail every other day, which is a flake rather than a
    // check. This states it directly: whatever today is, it is not in there.
    renderHealed();
    const today = new Date();
    const dd = String(today.getDate()).padStart(2, "0");
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    expect(noticeText()).not.toContain(`${dd}/${mm}/${today.getFullYear()}`);
  });

  it("a different stamp renders a different date — the value is read, not hardcoded", () => {
    cleanup();
    renderHealed({ budgetSplitHealedAt: "2026-02-03T00:00:00.000Z" });
    expect(noticeText()).toContain("03/02/2026");
    expect(noticeText()).not.toContain(HEALED_ON);
  });
});

describe("2. standing state, not an event", () => {
  it("states the current split in the present tense", () => {
    renderHealed();
    expect(noticeText()).toMatch(/is held at/i);
  });

  it("no longer claims the adjustment just happened", () => {
    // The exact phrasing that made a weeks-old fact read as news.
    renderHealed();
    expect(noticeText()).not.toMatch(/it was adjusted/i);
  });

  it("still states BOTH pairs — the 2.4.106 requirement survives the rewrite", () => {
    // A notice saying only "your split was adjusted" is barely better than
    // silence. Re-asserted here because the copy moved: the figures are now
    // in two separate paragraphs.
    renderHealed();
    expect(noticeText()).toMatch(/85\s*\/\s*10\s*\/\s*5/); // to (current)
    expect(noticeText()).toMatch(/85\s*\/\s*15/);          // from (saved)
  });

  it("still explains WHY, not just what", () => {
    renderHealed();
    expect(noticeText()).toMatch(/below 5%/);
    expect(noticeText()).toMatch(/floored|breaks at zero/i);
  });
});

describe("3. \"Got it\" — an acknowledgement, not a close", () => {
  it("renders that label rather than a bare multiplication sign", () => {
    renderHealed();
    const btn = screen.getByRole("button", { name: /dismiss/i });
    expect(btn.textContent).toBe("Got it");
    expect(btn.textContent).not.toContain("×");
  });

  it("still clears the stamp, exactly as the x did", () => {
    // The control changed label and styling; its behaviour must not have
    // moved with it.
    const { onChange } = renderHealed();
    // Premise: 85/10 is in range, so the heal does not fire and the only
    // onChange below is the dismissal.
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    const saved = onChange.mock.calls[0][0] as LocalFinancials;
    expect(saved.budgetSplitHealedAt).toBeUndefined();
    expect(saved.budgetSplitHealedFrom).toBeUndefined();
    // And it does not touch the split itself -- dismissing acknowledges the
    // adjustment, it does not undo it.
    expect(saved.budgetCustomNeeds).toBe(85);
    expect(saved.budgetCustomWants).toBe(10);
  });
});
