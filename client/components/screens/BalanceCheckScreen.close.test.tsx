// Period close, Phase 2 — the UI half: the close action, the acknowledgement
// control, and the three-valued badge.
//
// The pure half (close instant, record builder, acknowledgement binding, the
// startingDate regression) is in lib/period-close.phase2.test.ts. What is
// here is what only the component can answer: that the close is ONE write,
// that the note is genuinely required at the control, and that the badge
// renders three states with "Accounted for" distinct from "Matches".
//
// WHICH AXES THESE FIXTURES CANNOT REACH (2.4.116):
//
//   * account count -- zero (the action is not offered at all), one, and
//     three are each their own case. A single-account fixture cannot show
//     that N accounts produce ONE write, which is the atomicity claim.
//   * `startingAt` absent -- a legacy pre-2.4.65 row. It can be closed, but
//     it can never read as acknowledged, because there is no anchor to bind
//     to. Covered; fails closed.
//   * currency -- an LBP account renders its own figures. Covered in the
//     multi-account case so the dialog is not only ever exercised in USD.
//   * gap size -- $0 (no acknowledgement control at all), exactly $1 (the
//     badge threshold), and $31 (both thresholds). The $5 alert boundary is
//     not observable from this component and is asserted in the pure file.
//   * NOT COVERED: what the modal does if the user edits a figure after
//     ticking acknowledge. The control clears on amount change by design,
//     but no test drives that sequence -- named rather than implied.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import BalanceCheckScreen from "./BalanceCheckScreen";
import { computeDashboard } from "../../lib/computeDashboard";
import {
  DEFAULT_DATA, DEFAULT_LBP_RATE, cycleStartDayOf,
  type LocalFinancials, type TrackedBalance,
} from "../../lib/localData";
import { asCycleKey, cycleCloseInstant, currentCycleKey } from "../../lib/period";

afterEach(() => { cleanup(); });

/** A checked-in balance whose frozen gap is `gap`. */
const TB = (id: string, name: string, gap: number, over: Partial<TrackedBalance> = {}): TrackedBalance => ({
  id, name, paymentMethod: "cash",
  startingBalance: 430, startingDate: "2026-09-01",
  startingAt: "2026-09-01T09:00:00.000Z",
  actualBalance: 430, actualBalanceDate: "2026-09-01T09:00:00.000Z",
  expectedAtCheckUSD: 430 - gap,
  currency: "USD", ...over,
});

function renderScreen(over: Partial<LocalFinancials> = {}) {
  const data = { ...DEFAULT_DATA, income: 3000, cycleStartDay: 27, ...over } as LocalFinancials;
  const onChange = vi.fn();
  render(<BalanceCheckScreen financials={data} dashData={computeDashboard(data)} onChange={onChange} />);
  return { onChange, data };
}
const written = (onChange: ReturnType<typeof vi.fn>): LocalFinancials =>
  onChange.mock.calls[onChange.mock.calls.length - 1][0] as LocalFinancials;

const closeButton = () => screen.getByRole("button", { name: /close this cycle/i });
const openDialog = () => fireEvent.click(closeButton());
const amountFor = (name: string) => screen.getByLabelText(new RegExp(`what ${name} actually holds`, "i"));
const confirmClose = () => fireEvent.click(screen.getByRole("button", { name: /^close cycle$/i }));

// ───────────────────── 1. the close action ─────────────────────

describe("1. closing a cycle", () => {
  it("is ONE write, not one per account", () => {
    // The atomicity claim, in its only observable form. Three accounts, one
    // onChange. A per-account loop would produce three.
    const { onChange } = renderScreen({
      trackedBalances: [TB("a", "Cash", -31), TB("b", "Visa", 0), TB("c", "LBP jar", 12, { currency: "LBP" })],
    });
    openDialog();
    fireEvent.change(amountFor("Cash"), { target: { value: "400" } });
    fireEvent.change(amountFor("Visa"), { target: { value: "1200" } });
    fireEvent.change(amountFor("LBP jar"), { target: { value: "500000" } });
    confirmClose();
    expect(onChange).toHaveBeenCalledTimes(1);

    const out = written(onChange);
    expect(out.periodCloses).toHaveLength(1);
    expect(out.periodCloses![0].accounts).toHaveLength(3);
    expect(out.trackedBalances.map((t) => t.startingBalance)).toEqual([400, 1200, 500000]);
  });

  it("pins every account's baseline to the cycle's end INSTANT", () => {
    const { onChange, data } = renderScreen({ trackedBalances: [TB("a", "Cash", -31)] });
    openDialog();
    fireEvent.change(amountFor("Cash"), { target: { value: "400" } });
    confirmClose();
    const expected = cycleCloseInstant(currentCycleKey(new Date(), cycleStartDayOf(data)), cycleStartDayOf(data));
    expect(written(onChange).trackedBalances[0].startingAt).toBe(expected);
    // ...and startingDate stays a bare date, which is the 2.4.65 regression.
    expect(written(onChange).trackedBalances[0].startingDate).toHaveLength(10);
  });

  it("records priorState per account, so Phase 4 can reopen", () => {
    const { onChange } = renderScreen({ trackedBalances: [TB("a", "Cash", -31)] });
    openDialog();
    fireEvent.change(amountFor("Cash"), { target: { value: "400" } });
    confirmClose();
    expect(written(onChange).periodCloses![0].accounts[0].priorState).toEqual({
      startingBalance: 430, startingDate: "2026-09-01",
      startingAt: "2026-09-01T09:00:00.000Z", actualBalance: 430,
    });
  });

  it("refuses while any amount is missing", () => {
    const { onChange } = renderScreen({ trackedBalances: [TB("a", "Cash", -31), TB("b", "Visa", 0)] });
    openDialog();
    fireEvent.change(amountFor("Cash"), { target: { value: "400" } });
    // Premise: the button exists and is the one being checked.
    expect(screen.getByRole("button", { name: /^close cycle$/i })).toBeDisabled();
    confirmClose();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("is not offered at all with zero tracked balances", () => {
    renderScreen({ trackedBalances: [] });
    expect(screen.queryByRole("button", { name: /close this cycle/i })).toBeNull();
  });

  it("IS offered for an account that has never been checked in", () => {
    // The case the first draft of this file hid. The button originally sat
    // inside the reconciliation block, which is gated on at least one
    // account having an `actual` -- so it was unreachable for exactly the
    // account that most needs it, and the zero-balances test above passed
    // either way because the outer gate hid the button regardless of its
    // own condition. Found by perturbation, not by reading.
    renderScreen({
      trackedBalances: [TB("a", "Cash", 0, { actualBalance: undefined, actualBalanceDate: undefined, expectedAtCheckUSD: undefined })],
    });
    // Premise: the reconciliation section really is absent for this
    // fixture, so the button being present is not the old nesting.
    expect(screen.queryByText("Reconciliation")).toBeNull();
    expect(screen.getByRole("button", { name: /close this cycle/i })).toBeTruthy();
  });
});

// ───────────────────── 2. the acknowledgement control ─────────────────────

describe("2. marking a gap accounted for", () => {
  const open1 = () => {
    const r = renderScreen({ trackedBalances: [TB("a", "Cash", -31)] });
    openDialog();
    fireEvent.change(amountFor("Cash"), { target: { value: "399" } }); // gap of -31 vs expected 461... see below
    return r;
  };

  it("offers the control only where there is a gap to explain", () => {
    renderScreen({ trackedBalances: [TB("a", "Cash", -31), TB("b", "Visa", 0)] });
    openDialog();
    fireEvent.change(amountFor("Cash"), { target: { value: "400" } });
    fireEvent.change(amountFor("Visa"), { target: { value: "430" } });
    // Cash is off by 31; Visa matches exactly, so there is nothing to
    // acknowledge and no control is rendered for it.
    expect(screen.getAllByRole("checkbox", { name: /mark this gap as accounted for/i })).toHaveLength(1);
  });

  it("REFUSES an empty note", () => {
    const { onChange } = open1();
    fireEvent.click(screen.getByRole("checkbox", { name: /mark this gap as accounted for/i }));
    expect(screen.getByRole("button", { name: /^close cycle$/i })).toBeDisabled();
    confirmClose();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("REFUSES a whitespace-only note", () => {
    const { onChange } = open1();
    fireEvent.click(screen.getByRole("checkbox", { name: /mark this gap as accounted for/i }));
    fireEvent.change(screen.getByLabelText(/what explains it/i), { target: { value: "   \t  " } });
    expect(screen.getByRole("button", { name: /^close cycle$/i })).toBeDisabled();
    confirmClose();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("accepts a real note and binds it to the anchor and the figure", () => {
    const { onChange } = open1();
    fireEvent.click(screen.getByRole("checkbox", { name: /mark this gap as accounted for/i }));
    fireEvent.change(screen.getByLabelText(/what explains it/i), { target: { value: "Cash I gave my brother." } });
    confirmClose();
    const acc = written(onChange).periodCloses![0].accounts[0];
    expect(acc.acknowledgement!.note).toBe("Cash I gave my brother.");
    // Bound to the anchor the close itself just minted, and to this gap.
    expect(acc.acknowledgement!.startingAt).toBe(written(onChange).trackedBalances[0].startingAt);
    expect(acc.acknowledgement!.discrepancy).toBe(acc.discrepancy);
  });

  it("has no bulk control — acknowledgement is per account, by construction", () => {
    renderScreen({ trackedBalances: [TB("a", "Cash", -31), TB("b", "Visa", -20)] });
    openDialog();
    fireEvent.change(amountFor("Cash"), { target: { value: "400" } });
    fireEvent.change(amountFor("Visa"), { target: { value: "400" } });
    expect(screen.getAllByRole("checkbox", { name: /mark this gap as accounted for/i })).toHaveLength(2);
    expect(screen.queryByRole("checkbox", { name: /all|every/i })).toBeNull();
  });
});

// ───────────────────── 3. the three-valued badge ─────────────────────

/**
 * The single verdict badge on screen. Not scoped by account name: the name
 * renders twice (the reconciliation card and the tracked-balances list
 * below it), so a name-anchored walk picks whichever matched first. Every
 * fixture in this section has exactly ONE account, asserted, so the badge
 * is unique -- stated rather than assumed.
 */
const theBadge = (): string => {
  const all = screen.getAllByText(/^(Matches|Accounted for|Mismatch)$/);
  expect(all).toHaveLength(1);
  return all[0].textContent!;
};

describe("3. the badge is three-valued and 'Accounted for' is not 'Matches'", () => {
  const ACK_ANCHOR = "2026-09-01T09:00:00.000Z";
  const acked = (discrepancy: number): LocalFinancials["periodCloses"] => ([{
    cycleKey: asCycleKey("2026-08"), rangeStart: "2026-08-27", rangeEnd: "2026-09-26",
    startDayAtClose: 27, closedAt: "2026-09-26T21:00:00.000Z",
    accounts: [{
      trackedBalanceId: "a", actual: 430, expectedAtClose: 430 - discrepancy,
      discrepancy, currency: "USD", lbpRateAtClose: DEFAULT_LBP_RATE,
      priorState: { startingBalance: 1, startingDate: "2026-08-01" },
      acknowledgement: { note: "Explained.", acknowledgedAt: "2026-09-26T21:00:00.000Z", discrepancy, startingAt: ACK_ANCHOR },
    }],
  }]);

  it("Matches, when the gap is under a dollar", () => {
    renderScreen({ trackedBalances: [TB("a", "Cash", 0)] });
    expect(theBadge()).toBe("Matches");
  });

  it("Mismatch, at exactly the $1 threshold", () => {
    renderScreen({ trackedBalances: [TB("a", "Cash", -1)] });
    expect(theBadge()).toBe("Mismatch");
  });

  it("Accounted for, once acknowledged — and NOT 'Matches'", () => {
    renderScreen({ trackedBalances: [TB("a", "Cash", -31)], periodCloses: acked(-31) });
    const badge = theBadge();
    expect(badge).toBe("Accounted for");
    expect(badge).not.toBe("Matches");
  });

  it("still shows the gap — an acknowledged gap is a gap that was explained", () => {
    // 2.4.64's objection survives: this must not read as "no gap".
    renderScreen({ trackedBalances: [TB("a", "Cash", -31)], periodCloses: acked(-31) });
    expect(screen.getByText(/Explained\./)).toBeTruthy();
    expect(screen.getAllByText(/\$31/).length).toBeGreaterThan(0);
  });

  it("LAPSES back to Mismatch after a fresh check-in", () => {
    // Same acknowledgement, new anchor. The whole anti-auto-absorb binding.
    renderScreen({
      trackedBalances: [TB("a", "Cash", -31, { startingAt: "2026-10-05T10:00:00.000Z" })],
      periodCloses: acked(-31),
    });
    expect(theBadge()).toBe("Mismatch");
  });

  it("a legacy row with no startingAt can never read as accounted for", () => {
    renderScreen({
      trackedBalances: [TB("a", "Cash", -31, { startingAt: undefined })],
      periodCloses: acked(-31),
    });
    expect(theBadge()).toBe("Mismatch");
  });
});
