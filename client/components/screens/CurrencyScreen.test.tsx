// Rate editing moves from Setup to the Currency screen.
//
// The field, RateStaleness, both bounds and commitLbpRate move UNCHANGED --
// draft state, commit on blur, 100..10,000,000, and lbpRateUpdatedAt stamped
// only when a real number is committed. These tests pin that behaviour at its
// new home, and pin that Setup no longer offers a second editable copy: two
// writers for one value, both stamping "just verified", would make the
// staleness indicator report on whichever surface was touched last.
//
// CurrencyScreen had no test file before this. These are its first.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CurrencyScreen from "./CurrencyScreen";
import SetupScreen from "./SetupScreen";
import { computeDashboard } from "../../lib/computeDashboard";
import { DEFAULT_DATA, type LocalFinancials } from "../../lib/localData";

const NOW = new Date(2026, 8, 13); // 13 September 2026
// Timers are NOT faked globally: userEvent hangs under fake timers, and only
// the date-sensitive describes below need a pinned clock. They opt in.
afterEach(() => { cleanup(); });
const pinClock = () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
  afterEach(() => { vi.useRealTimers(); });
};

const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

function makeData(overrides: Partial<LocalFinancials> = {}): LocalFinancials {
  return { ...DEFAULT_DATA, income: 3000, lbpRate: 89_500, ...overrides } as LocalFinancials;
}

function renderCurrency(overrides: Partial<LocalFinancials> = {}) {
  const data = makeData(overrides);
  const onChange = vi.fn();
  render(<CurrencyScreen financials={data} onChange={onChange} />);
  return { onChange, data };
}

const rateField = () => screen.getByLabelText(/LBP \/ USD exchange rate/i) as HTMLInputElement;

/** The lbpRate carried by the last onChange call, or undefined if none committed. */
function committedRate(onChange: ReturnType<typeof vi.fn>): number | undefined {
  const calls = onChange.mock.calls;
  return calls.length ? (calls[calls.length - 1][0] as LocalFinancials).lbpRate : undefined;
}

// The six bounds tests below moved here from SetupScreen.test.tsx along with
// the field itself, unchanged apart from the render helper. They were the
// only tests that file had, so it is deleted rather than left as a shell.
//
// Kept in their original userEvent form rather than rewritten: the last one
// types through "8", "89", "895" -- every prefix of a real rate is below the
// floor -- and asserts the field still holds what was typed. A fireEvent
// version cannot express that, and it is the test that would catch a
// regression to per-keystroke enforcement.
describe("the rate field now lives on the Currency screen — bounds", () => {
  it("renders, seeded from the stored rate", () => {
    renderCurrency();
    expect(rateField().value).toBe("89500");
  });

  it("declares the bounds on the element itself, not only in the handler", () => {
    renderCurrency();
    expect(rateField()).toHaveAttribute("min", "100");
    expect(rateField()).toHaveAttribute("max", "10000000");
  });

  it("clamps a below-floor rate up to 100 on blur", async () => {
    const user = userEvent.setup();
    const { onChange } = renderCurrency();
    await user.clear(rateField());
    await user.type(rateField(), "0.01"); // the 100x-magnification case
    await user.tab();
    expect(committedRate(onChange)).toBe(100);
  });

  it("clamps an above-ceiling rate down to 10,000,000 on blur", async () => {
    const user = userEvent.setup();
    const { onChange } = renderCurrency();
    await user.clear(rateField());
    await user.type(rateField(), "895000000"); // an extra few digits
    await user.tab();
    expect(committedRate(onChange)).toBe(10_000_000);
  });

  it("commits an in-range rate unchanged, and stamps it as just-updated", async () => {
    const user = userEvent.setup();
    const { onChange } = renderCurrency();
    await user.clear(rateField());
    await user.type(rateField(), "120000");
    await user.tab();
    expect(committedRate(onChange)).toBe(120_000);
    // Real clock here (see the note at the top), so the stamp is checked for
    // freshness rather than an exact instant -- the point is that a committed
    // edit IS stamped, which the discard test below pairs with.
    const stamp = onChange.mock.calls[onChange.mock.calls.length - 1][0].lbpRateUpdatedAt!;
    expect(Math.abs(Date.now() - new Date(stamp).getTime())).toBeLessThan(5_000);
  });

  it("discards an emptied field rather than committing a bogus rate or stamping it as just-updated", async () => {
    const user = userEvent.setup();
    const { onChange } = renderCurrency();
    await user.clear(rateField());
    await user.tab();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not enforce bounds mid-typing -- a real rate's own prefixes must remain typable", async () => {
    const user = userEvent.setup();
    const { onChange } = renderCurrency();
    await user.clear(rateField());
    await user.type(rateField(), "89500"); // passes through "8", "89", "895" -- all below the floor
    expect(onChange).not.toHaveBeenCalled();
    expect(rateField()).toHaveValue(89500);
    await user.tab();
    expect(committedRate(onChange)).toBe(89_500);
  });
});

describe("the staleness indicator moved with it, thresholds unchanged", () => {
  pinClock();
  it("says nothing under 3 days", () => {
    renderCurrency({ lbpRateUpdatedAt: daysAgo(2) });
    expect(screen.queryByText(/Rate last updated/i)).toBeNull();
  });

  it("nudges from 3 days, without the stale wording", () => {
    renderCurrency({ lbpRateUpdatedAt: daysAgo(5) });
    const el = screen.getByText(/Rate last updated 5 days ago/i);
    expect(el.textContent).not.toMatch(/LBP moves fast/);
  });

  it("escalates at 14 days, with the stale wording", () => {
    renderCurrency({ lbpRateUpdatedAt: daysAgo(14) });
    expect(screen.getByText(/LBP moves fast/i)).toBeTruthy();
  });

  it("says nothing at all when the rate has never been edited", () => {
    renderCurrency({});
    expect(screen.queryByText(/Rate last updated/i)).toBeNull();
  });
});

describe("Setup no longer offers a second editable copy", () => {
  pinClock();
  it("renders no rate field", () => {
    const data = makeData({ lbpRateUpdatedAt: daysAgo(30) });
    render(<SetupScreen financials={data} dashData={computeDashboard(data)} onChange={vi.fn()} />);
    expect(screen.queryByLabelText(/LBP \/ USD exchange rate/i)).toBeNull();
  });

  it("renders no staleness warning either — the warning belongs where the fix is", () => {
    // 30 days stale: if Setup still had the indicator this would be visible.
    const data = makeData({ lbpRateUpdatedAt: daysAgo(30) });
    render(<SetupScreen financials={data} dashData={computeDashboard(data)} onChange={vi.fn()} />);
    expect(screen.queryByText(/Rate last updated/i)).toBeNull();
    // Premise: the fixture really is stale, so the absence above is the move
    // and not an under-threshold date.
    expect(computeDashboard(data).alerts.some((a) => a.id === "rate-stale")).toBe(true);
  });
});
