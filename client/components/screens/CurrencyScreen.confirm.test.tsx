// Rate staleness, phase 1 (owner-approved 2026-11-05): "the rate is still
// correct" in one tap, on the Currency screen, beside the warning that asks
// for it. The tap is confirmRate (lib/confirm-rate.test.ts pins what it
// writes); these pin when the button appears and what it hands onChange.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import CurrencyScreen from "./CurrencyScreen";
import { DEFAULT_DATA, recordRateEdit, type LocalFinancials } from "../../lib/localData";

const NOW = new Date(2026, 10, 5, 10); // 5 Nov 2026
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

/** An account whose rate was last edited `days` calendar days before NOW. */
const editedDaysAgo = (days: number) =>
  recordRateEdit({ ...DEFAULT_DATA, income: 3000, lbpRate: 80_000 } as LocalFinancials, 89_500, new Date(2026, 10, 5 - days, 9));

function renderWith(d: LocalFinancials) {
  const onChange = vi.fn();
  const view = render(<CurrencyScreen financials={d} onChange={onChange} />);
  return { onChange, rerender: (next: LocalFinancials) => view.rerender(<CurrencyScreen financials={next} onChange={onChange} />) };
}
const confirmButton = () => screen.queryByRole("button", { name: /still L£89,500 per \$1/i });

describe("when the Confirm button appears", () => {
  it("not under 3 days, when there is no warning to answer", () => {
    renderWith(editedDaysAgo(2));
    expect(confirmButton()).toBeNull();
  });
  it("not when the rate has never been edited (owner's answer 3: those stay silent)", () => {
    renderWith({ ...DEFAULT_DATA, income: 3000 } as LocalFinancials);
    expect(confirmButton()).toBeNull();
  });
  it("from 3 days, with the nudge", () => {
    renderWith(editedDaysAgo(5));
    expect(confirmButton()).not.toBeNull();
  });
  it("at 14 days and beyond, with the stale warning", () => {
    renderWith(editedDaysAgo(16));
    expect(screen.getByText(/LBP moves fast/i)).toBeTruthy();
    expect(confirmButton()).not.toBeNull();
  });
  it("is a phone-sized target: at least 44 px tall", () => {
    renderWith(editedDaysAgo(16));
    expect(confirmButton()!.className).toMatch(/min-h-\[44px\]/);
  });
});

describe("tapping it", () => {
  it("hands onChange the same data with only the check time moved", () => {
    const d = editedDaysAgo(16);
    const { onChange } = renderWith(d);
    fireEvent.click(confirmButton()!);
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as LocalFinancials;
    expect(next.lbpRateUpdatedAt).toBe(NOW.toISOString());
    expect(next.lbpRate).toBe(89_500);
    expect(next.lbpRateLog).toEqual(d.lbpRateLog);
    expect(next.settingsUpdatedAt).toEqual(d.settingsUpdatedAt);
  });

  it("clears the warning and says, plainly, that it was confirmed", () => {
    const { onChange, rerender } = renderWith(editedDaysAgo(16));
    fireEvent.click(confirmButton()!);
    rerender(onChange.mock.calls[0][0] as LocalFinancials);
    expect(screen.queryByText(/Rate last updated/i)).toBeNull();
    expect(confirmButton()).toBeNull();
    expect(screen.getByText(/Rate confirmed today/i)).toBeTruthy();
  });

  it("a real edit after it is an edit: the confirmed line goes", () => {
    const { onChange, rerender } = renderWith(editedDaysAgo(16));
    fireEvent.click(confirmButton()!);
    rerender(onChange.mock.calls[0][0] as LocalFinancials);
    const field = screen.getByLabelText(/LBP \/ USD exchange rate/i) as HTMLInputElement;
    fireEvent.change(field, { target: { value: "95000" } });
    fireEvent.blur(field);
    rerender(onChange.mock.calls[1][0] as LocalFinancials);
    expect((onChange.mock.calls[1][0] as LocalFinancials).lbpRate).toBe(95_000);
    expect(screen.queryByText(/Rate confirmed today/i)).toBeNull();
  });

  it("does not change the rate field", () => {
    const { onChange, rerender } = renderWith(editedDaysAgo(16));
    fireEvent.click(confirmButton()!);
    rerender(onChange.mock.calls[0][0] as LocalFinancials);
    expect((screen.getByLabelText(/LBP \/ USD exchange rate/i) as HTMLInputElement).value).toBe("89500");
  });
});
