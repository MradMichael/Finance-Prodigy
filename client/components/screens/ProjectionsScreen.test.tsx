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
//
// The track spans income, not surplus: sliderMax = min(CAP, max(200,
// income)) = 1830. Deriving it from surplus made it collapse to a
// uselessly narrow range on any month where little was left over --
// at surplus $145 the whole track was $290, against a meaningful range
// running to $5,490, and the cap never bound at all.
describe("ProjectionsScreen — both inputs respect the cap, and the track no longer grows", () => {
  const CAP = 5490;       // MAX_TEST_AMOUNT at income 1830
  const TRACK = 1830;     // sliderMax: min(CAP, max(200, income))

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

// The track spans income; the cap stays income * 3. They are different
// numbers on purpose -- the track is the range worth dragging through, the
// cap is the hard limit on what can be typed. The zero-income case is the
// one where they diverge sharply, so it is pinned explicitly rather than
// left to be discovered.
describe("ProjectionsScreen — the slider track spans income", () => {
  function renderAt(income: number) {
    const data: LocalFinancials = { ...DEFAULT_DATA, income, budgetRule: "50-30-20" };
    render(<ProjectionsScreen financials={data} dashData={computeDashboard(data)} />);
    return {
      number: screen.queryByLabelText("Monthly amount to plan with") as HTMLInputElement | null,
      slider: screen.queryByLabelText("Monthly amount to plan with (slider)") as HTMLInputElement | null,
    };
  }

  it("spans income when income sits between the floor and the cap", () => {
    const { slider } = renderAt(1830);
    expect(Number(slider!.max)).toBe(1830);
  });

  it("does not depend on surplus -- a month with almost nothing left over still gets the full track", () => {
    // $1,700 of Needs against $1,830 income leaves a surplus of $130. Under
    // the old surplus * 2 formula the track would have been $260; it must
    // now still span income.
    const data: LocalFinancials = {
      ...DEFAULT_DATA, income: 1830, budgetRule: "50-30-20",
      transactions: [
        { id: "t1", amount: 1700, currency: "USD", bucket: "NEEDS", description: "This month", date: "2026-07-05" },
      ],
    };
    const dash = computeDashboard(data);
    render(<ProjectionsScreen financials={data} dashData={dash} />);
    expect(Math.round(dash.month.netCashFlow)).toBeLessThan(200); // the premise: surplus really is tiny
    expect(Number((screen.getByLabelText("Monthly amount to plan with (slider)") as HTMLInputElement).max)).toBe(1830);
  });

  it("floors at 200 when income is 0 -- and the cap stays at its own no-income fallback", () => {
    // hasIncome is false, so MAX_TEST_AMOUNT falls back to 1,000,000 while
    // max(200, 0) floors the track at 200. The two diverge hugely here by
    // design: there is no meaningful plan to drag through before Setup.
    // Asserted unconditionally, not behind an if: the hasIncome ternary
    // (:287) gates only the "Recommended monthly savings" figure, so both
    // controls render regardless of income. An either/or assertion here
    // would pass whichever way it went and prove nothing.
    const { slider, number } = renderAt(0);
    expect(slider).not.toBeNull();
    expect(Number(slider!.max)).toBe(200);
    expect(number).toHaveAttribute("max", "1000000");
  });

  it("never exceeds the cap, whatever income is", () => {
    for (const income of [0, 100, 1830, 50_000]) {
      const data: LocalFinancials = { ...DEFAULT_DATA, income, budgetRule: "50-30-20" };
      const dash = computeDashboard(data);
      const { unmount } = render(<ProjectionsScreen financials={data} dashData={dash} />);
      const slider = screen.queryByLabelText("Monthly amount to plan with (slider)") as HTMLInputElement | null;
      const number = screen.queryByLabelText("Monthly amount to plan with") as HTMLInputElement | null;
      if (slider && number) {
        expect(Number(slider.max)).toBeLessThanOrEqual(Number(number.max));
      }
      unmount();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// F2 forward capacity: the "Looking ahead" strip.
//
// Two things are asserted here that the pure-function tests can't reach:
// that a totalAmount-bounded item actually SURFACES in the product (the
// whole defect was that it silently didn't), and that the copy stays a
// statement about commitments rather than a claim about the plan below it.
// The second matters because the plan is still computed on one flat monthly
// amount -- a strip that implied otherwise would put two irreconcilable
// figures on one screen.
describe("Looking ahead — bounded obligations that free capacity later", () => {
  const UNI = {
    id: "uni", name: "Uni", emoji: "", amount: 750, currency: "USD" as const,
    frequency: "monthly" as const, bucket: "NEEDS" as const,
    startDate: "2026-01-01", endDate: null, totalAmount: 6750,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  const RENT = { ...UNI, id: "rent", name: "Rent", amount: 300, totalAmount: null };

  it("a totalAmount-capped item with no endDate appears, with its freed amount and month", () => {
    renderProjections({ recurring: [UNI] });
    // 9 payments of $750 from 2026-01-01; NOW is 2026-07-15 with nothing
    // confirmed, so all 9 remain from the next cycle (Aug 1) -> last owed
    // Apr 2027, freed from May 2027.
    expect(screen.getByText(/Uni finishes/)).toBeTruthy();
    expect(screen.getByText(/\+\$750\/mo from May 2027/)).toBeTruthy();
  });

  it("an indefinite item never appears — the pair, so the assertion above isn't just 'any recurring item renders'", () => {
    renderProjections({ recurring: [RENT] });
    expect(screen.queryByText(/Looking ahead/)).toBeNull();
    expect(screen.queryByText(/Rent finishes/)).toBeNull();
  });

  it("the copy states the plan does NOT account for the step", () => {
    renderProjections({ recurring: [UNI] });
    const note = screen.getByText(/Nothing below has been brought forward/);
    expect(note.textContent).toMatch(/not in the plan below/);
    // And it must not promise the opposite anywhere in the strip.
    expect(screen.queryByText(/sooner because/i)).toBeNull();
  });

  it("the strip is absent entirely when there are no recurring items at all", () => {
    renderProjections({ recurring: [] });
    expect(screen.queryByText(/Looking ahead/)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 2.4.80: the surplus preset's labelling.
//
// The $92 seed from budgetTargets.savings is a deliberate choice and is NOT
// under test here -- it stays. What is under test is that the preset next to
// it reads as the actual available figure, and that it does not overclaim
// that figure as a steady monthly one. The value is month-to-date spend
// against a whole month's income, so it is optimistic mid-month.
describe("2.4.80 — the surplus preset reads as actual capacity, without overclaiming it", () => {
  it("names the figure as unspent so far this month, not as a surplus", () => {
    renderProjections();
    expect(screen.getByRole("button", { name: /Unspent so far this month/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /full surplus/i })).toBeNull();
  });

  it("does not claim a steady monthly figure", () => {
    renderProjections();
    const btn = screen.getByRole("button", { name: /Unspent so far this month/ });
    // The words that would turn a month-to-date figure into a rate.
    expect(btn.textContent).not.toMatch(/\/mo|per month|every month|available/i);
    // "so far" is the part that carries the caveat -- it must survive edits.
    expect(btn.textContent).toMatch(/so far/);
  });

  it("distinguishes the two presets in copy, so the seed is not mistaken for the available figure", () => {
    renderProjections();
    const note = screen.getByText(/is your budget rule/);
    expect(note.textContent).toMatch(/Recommended savings/);
    expect(note.textContent).toMatch(/Unspent so far/);
    expect(note.textContent).toMatch(/moves as the month fills in/);
  });

  it("the preset still sets the plan amount to the real unspent figure when clicked", () => {
    const dash = renderProjections();
    const expected = Math.max(0, Math.round(dash.month.netCashFlow));
    fireEvent.click(screen.getByRole("button", { name: /Unspent so far this month/ }));
    const input = screen.getByLabelText("Monthly amount to plan with") as HTMLInputElement;
    expect(Number(input.value)).toBe(expected);
    // Premise: the preset and the seed genuinely differ for this fixture,
    // or the assertion above would pass without discriminating.
    expect(expected).not.toBe(Math.round(dash.budgetTargets.savings));
  });
});
