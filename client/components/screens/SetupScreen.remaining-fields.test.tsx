// Setup's last three untested fields, plus floorCustomSplit's own behaviour.
//
// 2.4.92 carried these forward and they stayed uncovered through four
// sessions: EF target months (13 fixture mentions, ZERO assertions), the
// income-history display (none at all), and floorCustomSplit (4 references,
// all of them 2.4.97 premise assertions inside the heal tests -- never
// tested for its own sake). The budget-rule picker is covered in
// BudgetScreen.rule-picker.test.tsx, since applyRule lives there.
//
// WHICH INPUTS THESE FIXTURES CANNOT REACH (2.4.116), stated up front
// because that is the check, not an afterthought:
//
//   * startDay -- every test here runs at BOTH 1 and 27 where the value can
//     differ, because startDay 1 is the configuration that made 2.4.120's
//     five formatters look correct for three sweeps.
//   * incomeHistory length -- the display is gated on `> 1`, so a fixture
//     with 2+ entries can never exercise the one-entry branch. Tested
//     explicitly at 0, 1 and 2 rather than assumed.
//   * budgetRule -- preset vs custom are opposite sides of a branch;
//     floorCustomSplit is only reachable on the custom side.
//   * EF target months is an integer field with no history, so there is no
//     boundary axis here of the kind 2.4.105 turned on.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import SetupScreen from "./SetupScreen";
import { computeDashboard } from "../../lib/computeDashboard";
import { DEFAULT_DATA, floorCustomSplit, MIN_SPLIT_PCT, type LocalFinancials } from "../../lib/localData";
import { asCycleKey } from "../../lib/period";

afterEach(() => { cleanup(); });

function renderSetup(over: Partial<LocalFinancials> = {}) {
  const data = { ...DEFAULT_DATA, income: 3000, ...over } as LocalFinancials;
  const onChange = vi.fn();
  render(<SetupScreen financials={data} dashData={computeDashboard(data)} onChange={onChange} />);
  return { onChange, data };
}
const saved = (onChange: ReturnType<typeof vi.fn>): LocalFinancials | undefined =>
  onChange.mock.calls.length ? onChange.mock.calls[onChange.mock.calls.length - 1][0] as LocalFinancials : undefined;

const months = () => screen.getByLabelText(/Target \(months of income\)/i) as HTMLInputElement;

// ───────────────────────── EF target months ─────────────────────────

describe("EF target months — 13 fixture mentions across 5 files, zero assertions until now", () => {
  it("declares its bounds on the element", () => {
    renderSetup();
    expect(months()).toHaveAttribute("min", "1");
    expect(months()).toHaveAttribute("max", "24");
  });

  it("commits an in-range value", () => {
    const { onChange } = renderSetup({ emergencyFundTargetMonths: 6 });
    fireEvent.change(months(), { target: { value: "9" } });
    expect(saved(onChange)!.emergencyFundTargetMonths).toBe(9);
  });

  it("REJECTS out of range rather than clamping — unlike every sibling field", () => {
    // Worth pinning as a divergence, not a bug: the rate and income fields
    // CLAMP (Math.min/max), this one declines. Both are defensible; they are
    // not the same, and a future edit that "makes it consistent" by clamping
    // would silently accept 25 as 24.
    const { onChange } = renderSetup({ emergencyFundTargetMonths: 6 });
    fireEvent.change(months(), { target: { value: "25" } });
    fireEvent.change(months(), { target: { value: "0" } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("discards an emptied field, matching commitLbpRate", () => {
    // The 2.4.104 case. This field already gets it right -- `parseInt` then
    // `!isNaN && 1..24` -- and its comment names the `|| 6` bug it replaced.
    const { onChange } = renderSetup({ emergencyFundTargetMonths: 6 });
    fireEvent.change(months(), { target: { value: "" } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(months(), { target: { value: "abc" } });
    expect(onChange).not.toHaveBeenCalled();
  });
});

// ───────────────────── income-history display ─────────────────────

const HISTORY = [
  { ym: asCycleKey("2026-07"), value: 2400 },
  { ym: asCycleKey("2026-08"), value: 3000 },
];

describe("income-history display — the gate", () => {
  it("renders nothing with no history", () => {
    renderSetup({ incomeHistory: [] });
    expect(screen.queryByText(/Income history/i)).toBeNull();
  });

  it("renders nothing with exactly ONE entry — the branch a 2-entry fixture cannot reach", () => {
    // `length > 1`. A single entry is "your income, once" and says nothing a
    // history panel adds. Tested because every other fixture here has two.
    renderSetup({ incomeHistory: [HISTORY[1]] });
    expect(screen.queryByText(/Income history/i)).toBeNull();
  });

  it("renders from two entries, newest first", () => {
    renderSetup({ incomeHistory: HISTORY });
    expect(screen.getByText(/Income history/i)).toBeTruthy();
    const amounts = screen.getAllByText(/^\$[0-9,]+$/).map((e) => e.textContent);
    expect(amounts.slice(0, 2)).toEqual(["$3,000", "$2,400"]);
  });
});

describe("income-history display — incomeHistory is CYCLE-keyed, so its labels are ranges (2.4.120)", () => {
  it("at startDay 1 a key reads as a plain month, so nothing changed for a default account", () => {
    renderSetup({ incomeHistory: HISTORY });
    expect(screen.getByText("Aug 2026")).toBeTruthy();
    expect(screen.getByText("Jul 2026")).toBeTruthy();
  });

  it("at startDay 27 it reads as the RANGE, not the month the key carries", () => {
    // The defect this file exists downstream of: key 2026-08 is the cycle
    // 27 Aug - 26 Sep, which is mostly September. "Aug 2026" was the
    // rejected form (a).
    renderSetup({ incomeHistory: HISTORY, cycleStartDay: 27 });
    expect(screen.getByText("27 Aug – 26 Sep")).toBeTruthy();
    expect(screen.getByText("27 Jul – 26 Aug")).toBeTruthy();
    // Premise: the old rendering is genuinely gone, not merely joined.
    expect(screen.queryByText("Aug 2026")).toBeNull();
  });
});

// ───────────────────────── floorCustomSplit ─────────────────────────

describe("floorCustomSplit — tested for its own sake, not as a heal premise", () => {
  it("leaves a legal split untouched", () => {
    expect(floorCustomSplit(50, 30)).toEqual({ needs: 50, wants: 30, savings: 20 });
  });

  it("reserves MIN_SPLIT_PCT for Savings by squeezing WANTS, never Needs", () => {
    // The asymmetry is the whole behaviour: needs is floored/capped first,
    // then wants gets whatever is left above the Savings floor.
    expect(floorCustomSplit(85, 15)).toEqual({ needs: 85, wants: 10, savings: MIN_SPLIT_PCT });
    expect(floorCustomSplit(60, 40)).toEqual({ needs: 60, wants: 35, savings: MIN_SPLIT_PCT });
  });

  it("floors each bucket at MIN_SPLIT_PCT", () => {
    expect(floorCustomSplit(0, 0)).toEqual({ needs: 5, wants: 5, savings: 90 });
    expect(floorCustomSplit(100, 100)).toEqual({ needs: 95, wants: 5, savings: 0 });
  });

  it("is idempotent — healing an already-healed split changes nothing", () => {
    // Load-bearing for BudgetScreen's heal effect, which runs on every
    // mount and must not oscillate.
    const once = floorCustomSplit(85, 15);
    expect(floorCustomSplit(once.needs, once.wants)).toEqual(once);
  });

  it("the three parts always sum to 100", () => {
    for (const [n, w] of [[50, 30], [85, 15], [0, 0], [100, 100], [60, 40], [95, 5]]) {
      const r = floorCustomSplit(n, w);
      expect(r.needs + r.wants + r.savings).toBe(100);
    }
  });
});
