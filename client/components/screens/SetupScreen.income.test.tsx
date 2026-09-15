// Setup's Monthly income field and its MAX_INCOME clamp.
//
// The clamp exists because of 2.4.78: an unbounded income fed
// `Math.max(200, Math.round(month.income * 2))` in Projections, so a
// mistyped figure propagated into a slider ceiling and a cascade of
// downstream bounds. The guard was added and never tested, which is the
// same state commitEfBalance was in before 2.4.104.
//
// METHOD (2.4.104): the sibling fields' test lists were diffed against this
// one BEFORE writing, because comparing against a sibling rather than
// against the implementation is what surfaced the EF defect. The three
// siblings are commitLbpRate (CurrencyScreen), the payday field, and
// commitEfBalance. What that diff found is reported on the branch; the
// short version is that all three siblings hold a DRAFT and commit on blur
// or on confirm, and this field alone commits on every keystroke -- so the
// two sibling tests named "typing does not write" and "an emptied field
// writes nothing" have no counterpart here BY CONSTRUCTION, not by
// omission. Tests below assert what this field actually does; the
// divergence is reported rather than encoded as desirable.
import { useState } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SetupScreen from "./SetupScreen";
import { computeDashboard } from "../../lib/computeDashboard";
import { DEFAULT_DATA, type LocalFinancials } from "../../lib/localData";

afterEach(() => { cleanup(); });

/** Mirrors SetupScreen's own module-level constant, which is not exported. */
const MAX_INCOME = 1_000_000;

function renderSetup(overrides: Partial<LocalFinancials> = {}) {
  const data = { ...DEFAULT_DATA, income: 3000, transactions: [], ...overrides } as LocalFinancials;
  const onChange = vi.fn();
  render(<SetupScreen financials={data} dashData={computeDashboard(data)} onChange={onChange} />);
  return { onChange, data };
}

/**
 * A STATEFUL harness, required for any test that types more than one
 * character.
 *
 * The other Setup fields hold a local draft, so they accumulate keystrokes
 * on their own and a vi.fn() parent is enough. This field holds nothing --
 * `value` is bound straight to `financials.income` -- so if the parent does
 * not apply each change, React restores the input to the old prop value and
 * every keystroke lands in an effectively empty field. Typing "3500" against
 * a vi.fn() parent yields 3, 5, 0, 0 rather than 3, 35, 350, 3500.
 *
 * That is a harness artifact, not a product defect (2.4.104 records the same
 * trap from the other direction). But it is also a real property worth
 * naming: this field cannot function at all unless its parent round-trips
 * every keystroke, which is the cost of having no draft.
 */
function renderStateful(initial: Partial<LocalFinancials> = {}) {
  const seen: number[] = [];
  function Harness() {
    const [data, setData] = useState<LocalFinancials>(
      { ...DEFAULT_DATA, income: 3000, transactions: [], ...initial } as LocalFinancials);
    return (
      <SetupScreen
        financials={data}
        dashData={computeDashboard(data)}
        onChange={(next) => { seen.push(next.income); setData(next); }}
      />
    );
  }
  render(<Harness />);
  return { seen };
}

const field = () => screen.getByLabelText(/Monthly income/i) as HTMLInputElement;

/** The income carried by the LAST onChange call, or undefined if none fired. */
function committed(onChange: ReturnType<typeof vi.fn>): number | undefined {
  const calls = onChange.mock.calls;
  return calls.length ? (calls[calls.length - 1][0] as LocalFinancials).income : undefined;
}

describe("the field is seeded and bounded", () => {
  it("renders, seeded from the stored income", () => {
    renderSetup();
    expect(field().value).toBe("3000");
  });

  it("shows empty rather than 0 for an account that has not set one", () => {
    // `value={financials.income || ""}` -- the placeholder should be visible
    // on a fresh account, not a literal zero.
    renderSetup({ income: 0 });
    expect(field().value).toBe("");
  });

  it("declares the bounds on the element itself, not only in the handler", () => {
    renderSetup();
    expect(field()).toHaveAttribute("min", "0");
    expect(field()).toHaveAttribute("max", String(MAX_INCOME));
  });
});

describe("the MAX_INCOME clamp, both directions", () => {
  it("clamps an above-ceiling income down to 1,000,000", () => {
    const { onChange } = renderSetup();
    // fireEvent, not typing: the ceiling can only be exceeded in one step by
    // paste or autofill. Typing digit by digit clamps at the keystroke that
    // first crosses it (covered separately below).
    fireEvent.change(field(), { target: { value: "2500000" } });
    expect(committed(onChange)).toBe(MAX_INCOME);
  });

  it("clamps a negative income up to 0", () => {
    const { onChange } = renderSetup();
    fireEvent.change(field(), { target: { value: "-4000" } });
    expect(committed(onChange)).toBe(0);
  });

  it("commits an in-range income unchanged -- the clamp must not touch ordinary values", () => {
    const { onChange } = renderSetup();
    fireEvent.change(field(), { target: { value: "7250.50" } });
    expect(committed(onChange)).toBe(7250.5);
  });

  it("accepts exactly the ceiling -- the bound is inclusive, not off by one", () => {
    const { onChange } = renderSetup();
    fireEvent.change(field(), { target: { value: String(MAX_INCOME) } });
    expect(committed(onChange)).toBe(MAX_INCOME);
  });

  it("the clamp actually protects 2.4.78's cascade, not just the stored number", () => {
    // Premise, and the reason this test is not redundant with the clamp
    // tests above: 2.4.78 was not about the stored figure, it was about what
    // month.income feeds downstream. An income clamped at the field but
    // un-clamped in the payload would pass every assertion above.
    const { onChange } = renderSetup();
    fireEvent.change(field(), { target: { value: "99999999" } });
    const saved = onChange.mock.calls[onChange.mock.calls.length - 1][0] as LocalFinancials;
    expect(saved.income).toBe(MAX_INCOME);
    expect(computeDashboard(saved).month.income).toBe(MAX_INCOME);
  });
});

describe("typing, and what reaches the ceiling on the way", () => {
  it("every prefix of an ordinary income is committed unchanged -- the clamp never rewrites mid-entry", async () => {
    const user = userEvent.setup();
    const { seen } = renderStateful({ income: 0 });
    // The counterpart of commitLbpRate's strongest test. The rate needed a
    // draft because every prefix of 89500 is below its floor of 100; income
    // has no floor above 0, so 3 / 35 / 350 / 3500 are all in range and
    // per-keystroke commit cannot corrupt them. This is why the absence of a
    // draft here is defensible, and the test that shows it.
    await user.type(field(), "3500");
    expect(seen).toEqual([3, 35, 350, 3500]);
    expect(field().value).toBe("3500");
  });

  it("but it DOES commit on every keystroke -- there is no draft and no blur", async () => {
    const user = userEvent.setup();
    const { seen } = renderStateful({ income: 0 });
    await user.type(field(), "3500");
    // Recorded as a fact about this field, not as a virtue. All three
    // sibling fields hold a draft; this one writes four times for one
    // four-digit income, and each write reaches incomeHistory's snapshot
    // effect. See the branch report.
    expect(seen).toHaveLength(4);
  });

  it("typing past the ceiling clamps, and the clamp then blocks further digits", async () => {
    const user = userEvent.setup();
    const { seen } = renderStateful({ income: 0 });
    await user.type(field(), "10000000");
    // Premise: the ceiling really was crossed during this entry, so the
    // final value is a clamp result and not merely a short number.
    expect(Math.max(...seen)).toBe(MAX_INCOME);
    expect(seen[seen.length - 1]).toBe(MAX_INCOME);
  });
});

describe("input that is not a number", () => {
  // commitLbpRate and (since 2.4.104) commitEfBalance both DISCARD this.
  // This field cannot: with no draft, `value` is bound straight to
  // `financials.income`, so "don't write" would leave the field unable to
  // render what the user typed. It resolves to 0 instead. Reported rather
  // than asserted as correct -- see the branch report for why it is judged
  // materially less severe than 2.4.104 (loud, reversible, and not a ledger
  // write) and for the one narrow case where it persists.
  it("an emptied field resolves to 0 income", async () => {
    const user = userEvent.setup();
    const { onChange } = renderSetup();
    await user.clear(field());
    expect(committed(onChange)).toBe(0);
  });

  it("PASTED unparseable text also resolves to 0, silently", () => {
    const { onChange } = renderSetup();
    // A typed letter never reaches the handler -- type="number" swallows it.
    // Paste and autofill do, exactly as in 2.4.104.
    fireEvent.change(field(), { target: { value: "abc" } });
    expect(committed(onChange)).toBe(0);
  });

  it("a 0 income is LOUD -- the dashboard says so, which is what makes the above recoverable", () => {
    // The material difference from 2.4.104: an accidental zero here
    // announces itself, where an accidental EF wipe did not. Premise for
    // the severity judgement in the report, asserted rather than claimed.
    renderSetup({ income: 0 });
    expect(screen.getByText(/Set your monthly income to unlock the dashboard/i)).toBeTruthy();
  });
});
