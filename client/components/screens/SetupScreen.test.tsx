// The LBP/USD rate is a DIVISOR on every dual-currency figure in the app,
// so an absurd value magnifies rather than offsets: at 0.01, L£100 reads as
// $10,000. The field previously accepted any positive number, leaving the
// whole fractional range reachable by typing. These lock the bounds.
//
// Bounds are applied on blur, not per keystroke, and that is required
// rather than stylistic: the input is controlled by the stored rate, so
// rejecting every out-of-range prefix ("8", "89", "895"...) would snap the
// display back and make a rate impossible to type. The last test here is
// the one that would catch a regression to per-keystroke enforcement.
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SetupScreen from "./SetupScreen";
import { computeDashboard } from "../../lib/computeDashboard";
import { DEFAULT_DATA, DEFAULT_LBP_RATE, type LocalFinancials } from "../../lib/localData";

function makeData(overrides: Partial<LocalFinancials> = {}): LocalFinancials {
  return { ...DEFAULT_DATA, income: 3000, ...overrides };
}

function renderSetup(overrides: Partial<LocalFinancials> = {}) {
  const data = makeData(overrides);
  const onChange = vi.fn();
  render(<SetupScreen financials={data} dashData={computeDashboard(data)} onChange={onChange} />);
  return { onChange, field: screen.getByLabelText("LBP / USD exchange rate") };
}

/** The lbpRate carried by the last onChange call, or undefined if none committed. */
function committedRate(onChange: ReturnType<typeof vi.fn>): number | undefined {
  const calls = onChange.mock.calls;
  return calls.length ? (calls[calls.length - 1][0] as LocalFinancials).lbpRate : undefined;
}

describe("SetupScreen — LBP rate bounds", () => {
  it("declares the bounds on the element itself, not only in the handler", () => {
    const { field } = renderSetup();
    expect(field).toHaveAttribute("min", "100");
    expect(field).toHaveAttribute("max", "10000000");
  });

  it("clamps a below-floor rate up to 100 on blur", async () => {
    const user = userEvent.setup();
    const { onChange, field } = renderSetup();
    await user.clear(field);
    await user.type(field, "0.01"); // the 100x-magnification case
    await user.tab();
    expect(committedRate(onChange)).toBe(100);
  });

  it("clamps an above-ceiling rate down to 10,000,000 on blur", async () => {
    const user = userEvent.setup();
    const { onChange, field } = renderSetup();
    await user.clear(field);
    await user.type(field, "895000000"); // an extra few digits
    await user.tab();
    expect(committedRate(onChange)).toBe(10_000_000);
  });

  it("commits an in-range rate unchanged", async () => {
    const user = userEvent.setup();
    const { onChange, field } = renderSetup();
    await user.clear(field);
    await user.type(field, "120000");
    await user.tab();
    expect(committedRate(onChange)).toBe(120_000);
  });

  it("discards an emptied field rather than committing a bogus rate or stamping it as just-updated", async () => {
    const user = userEvent.setup();
    const { onChange, field } = renderSetup({ lbpRate: DEFAULT_LBP_RATE });
    await user.clear(field);
    await user.tab();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not enforce bounds mid-typing -- a real rate's own prefixes must remain typable", async () => {
    const user = userEvent.setup();
    const { onChange, field } = renderSetup();
    await user.clear(field);
    await user.type(field, "89500"); // passes through "8", "89", "895" -- all below the floor
    // Nothing committed yet, and crucially nothing rejected: the field still
    // holds what was typed rather than having snapped back to the stored rate.
    expect(onChange).not.toHaveBeenCalled();
    expect(field).toHaveValue(89500);
    await user.tab();
    expect(committedRate(onChange)).toBe(89_500);
  });
});
