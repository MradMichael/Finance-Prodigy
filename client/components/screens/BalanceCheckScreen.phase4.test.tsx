// Period close Phase 4 — the UI half: the closure line, the reopen action,
// and the released confirm sentence.
//
// The pure half (the seven-field round trip, canReopen's reasons, marking
// over deleting) is in lib/period-close.phase4.test.ts. What is here is what
// only the component can answer: that the closure line replaces the close
// button rather than sitting beside it, that the reopen confirm is asked and
// obeyed in both directions, that a pre-Phase-4 record says why instead of
// offering a button that half-works, and that the reopen promise is printed
// only where it is true.
//
// WHICH AXES THESE FIXTURES CANNOT REACH (2.4.116):
//
//   * a cycle that rolls over WHILE the screen is open. Driving it means
//     advancing the fake clock between render and click without a
//     re-render, which asserts the harness more than the behaviour.
//     commitReopen handles it by computing reopenCycle BEFORE asking, so
//     the stale button refuses silently instead of asking a question it
//     would ignore -- and by going through reopenCycle rather than a second
//     canReopen call, the refusal is the same one the lib file already
//     asserts. A perturbation that dropped an explicit re-ask here was not
//     caught by any test, which is what prompted collapsing it.
//   * the reopened record's survival in storage. The screen writes through
//     onChange; that the marked record persists is a localData concern and
//     is asserted there.
//   * a reopen on a cycle closed under a DIFFERENT payday. The line is not
//     rendered at all in that case (activeCloseForCycle returns null), so
//     the component shows the ordinary close button -- the span rule's own
//     assertion lives in the lib file.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import BalanceCheckScreen from "./BalanceCheckScreen";
import { computeDashboard } from "../../lib/computeDashboard";
import {
  DEFAULT_DATA, DEFAULT_LBP_RATE, buildPeriodClose, reanchorTrackedBalance,
  type LocalFinancials, type TrackedBalance,
} from "../../lib/localData";
import { asCycleKey, cycleCloseInstant, currentCycleKey } from "../../lib/period";

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

const START_DAY = 27;
// 10 Sep 2026 -> current cycle 2026-08 (27 Aug - 26 Sep). Reopen is only
// offered for the current cycle, so the clock has to sit inside it.
const NOW = new Date(2026, 8, 10, 12, 0, 0);
const CUR = asCycleKey("2026-08");

const TB = (over: Partial<TrackedBalance> = {}): TrackedBalance => ({
  id: "tb1", name: "Cash", paymentMethod: "cash",
  startingBalance: 500, startingDate: "2026-08-01", startingAt: "2026-08-01T09:00:00.000Z",
  actualBalance: 500, actualBalanceDate: "2026-08-01T09:00:00.000Z",
  expectedAtCheckUSD: 512, currency: "USD", ...over,
});

/** A blob whose current cycle is already closed, exactly as the screen writes one. */
function closedNow(tb = TB(), actual = 430, expectedAtClose = 461) {
  const at = cycleCloseInstant(CUR, START_DAY);
  return {
    trackedBalances: [reanchorTrackedBalance(tb, actual, expectedAtClose, DEFAULT_LBP_RATE, at)],
    periodCloses: [buildPeriodClose({
      cycleKey: CUR, startDay: START_DAY, closedAt: NOW, lbpRate: DEFAULT_LBP_RATE,
      accounts: [{ tb, actual, expectedAtClose }],
    })],
  };
}

function renderScreen(over: Partial<LocalFinancials> = {}) {
  vi.useFakeTimers(); vi.setSystemTime(NOW);
  const data = {
    ...DEFAULT_DATA, income: 3000, cycleStartDay: START_DAY,
    trackedBalances: [TB()], transactions: [],
    ...over,
  } as LocalFinancials;
  const onChange = vi.fn();
  render(<BalanceCheckScreen financials={data} dashData={computeDashboard(data)} onChange={onChange} />);
  return { onChange, data };
}
const written = (onChange: ReturnType<typeof vi.fn>): LocalFinancials =>
  onChange.mock.calls[onChange.mock.calls.length - 1][0] as LocalFinancials;

// ───────── 1. the closure line ─────────

describe("1. the closure line replaces the close button", () => {
  it("an unclosed current cycle offers Close and says nothing about being closed", () => {
    renderScreen();
    expect(screen.getByRole("button", { name: "Close this cycle" })).toBeTruthy();
    expect(screen.queryByText(/Closed on/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Reopen" })).toBeNull();
  });

  it("a closed current cycle shows the date and Reopen, and no longer offers Close", () => {
    renderScreen(closedNow());
    // Premise: the two are mutually exclusive, not merely both present.
    expect(screen.queryByRole("button", { name: "Close this cycle" })).toBeNull();
    expect(screen.getByRole("button", { name: "Reopen" })).toBeTruthy();
    expect(screen.getByText(/Closed on/).textContent).toContain("10/09/2026");
  });

  it("a record written before Phase 4 says why instead of offering the button", () => {
    const d = closedNow();
    delete (d.periodCloses[0].accounts[0] as { priorStateComplete?: true }).priorStateComplete;
    renderScreen(d);
    expect(screen.getByText(/Closed on/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reopen" })).toBeNull();
    expect(screen.getByText(/closed before reopening was supported/)).toBeTruthy();
  });
});

// ───────── 2. the reopen action ─────────

describe("2. reopening", () => {
  it("asks first, and writes nothing when the confirm is declined", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { onChange } = renderScreen(closedNow());
    fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("the confirm states what survives and what stops applying", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderScreen(closedNow());
    fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
    const msg = confirmSpy.mock.calls[0][0] as string;
    expect(msg).toContain("Transactions you have logged since are untouched");
    expect(msg).toContain("stops applying");
  });

  it("restores the pre-close balance and marks the record, in ONE write", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const before = TB();
    const { onChange } = renderScreen(closedNow(before));
    fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const out = written(onChange);
    expect(out.trackedBalances![0]).toEqual(before);
    expect(out.periodCloses![0].reopenedAt).toBeTruthy();
  });

  it("the cycle reads unclosed again, so Close comes back", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { onChange } = renderScreen(closedNow());
    fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
    // Re-rendered against what the screen actually wrote, not against a blob
    // the test assembled to look like it.
    const out = written(onChange);
    cleanup();
    render(<BalanceCheckScreen financials={out} dashData={computeDashboard(out)} onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Close this cycle" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reopen" })).toBeNull();
  });
});

// ───────── 3. the released sentence ─────────

describe("3. the reopen promise is printed only where it holds", () => {
  const SENTENCE = /You can reopen this cycle while it is still current\./;

  it("appears when closing the CURRENT cycle", () => {
    renderScreen();
    fireEvent.click(screen.getByRole("button", { name: "Close this cycle" }));
    expect(screen.getByText(SENTENCE, { exact: false })).toBeTruthy();
  });

  it("is absent when closing a PAST cycle from the unclosed list", () => {
    // Premise: the row really is a past cycle, and it really does open the
    // same dialog -- otherwise this asserts the absence of a dialog.
    const past = asCycleKey("2026-07");
    expect(currentCycleKey(NOW, START_DAY)).not.toBe(past);
    // The unclosed list is quiet until at least one close exists, so the
    // fixture needs a close record AND a balance old enough to put an
    // earlier cycle in range.
    renderScreen({
      periodCloses: closedNow().periodCloses,
      trackedBalances: [TB({ startingDate: "2026-07-01", startingAt: "2026-07-01T09:00:00.000Z" })],
    });
    // The row button is named by its aria-label ("Close the cycle <label>"),
    // not by its visible "Close" text -- matching the text alone finds nothing.
    const row = screen.getAllByRole("button", { name: /^Close the cycle/ })[0];
    fireEvent.click(row);
    expect(screen.getByText(/State what each account actually holds/)).toBeTruthy();
    expect(screen.queryByText(SENTENCE, { exact: false })).toBeNull();
  });
});
