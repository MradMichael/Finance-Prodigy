// Fix B (2.4.144) — the UI half. The pure rule is in
// lib/period-close.reopen-later.test.ts; here is what only the screen can
// answer: that the confirm names the account being kept, that the write
// keeps it, that a close records the anchor it wrote, and that the reopen
// write carries `transactions` at all.
//
// That last one is a defect found while building this fix: commitReopen
// wrote trackedBalances and periodCloses and DROPPED transactions, so Phase
// 5a's undo of an EF/debt correction was computed by reopenCycle and never
// saved. 5a's tests exercised only the pure function.
//
// WHICH AXES THESE FIXTURES CANNOT REACH (2.4.116):
//   * the owner's actual record — the sequence is modelled, not their anchors.
//   * a cycle rolling over between render and click (Phase 4's named axis).
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import BalanceCheckScreen from "./BalanceCheckScreen";
import { computeDashboard } from "../../lib/computeDashboard";
import {
  DEFAULT_DATA, DEFAULT_LBP_RATE, buildPeriodClose, reanchorTrackedBalance, planEfClose, toUSD,
  type LocalFinancials, type TrackedBalance,
} from "../../lib/localData";
import { asCycleKey, cycleCloseInstant } from "../../lib/period";

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

const START_DAY = 27;
const NOW = new Date(2026, 8, 10, 12, 0, 0);
const CUR = asCycleKey("2026-08");
const AT = cycleCloseInstant(CUR, START_DAY);

const TB = (id: string, name: string, over: Partial<TrackedBalance> = {}): TrackedBalance => ({
  id, name, paymentMethod: "card", cardId: id,
  startingBalance: 612.4, startingDate: "2026-08-14", startingAt: "2026-08-14T07:12:00.000Z",
  currency: "USD", ...over,
});

function renderScreen(data: LocalFinancials) {
  vi.useFakeTimers(); vi.setSystemTime(NOW);
  const onChange = vi.fn();
  render(<BalanceCheckScreen financials={data} dashData={computeDashboard(data)} onChange={onChange} />);
  return onChange;
}
const written = (onChange: ReturnType<typeof vi.fn>): LocalFinancials =>
  onChange.mock.calls[onChange.mock.calls.length - 1][0] as LocalFinancials;

/** Visa and Cash closed; Visa then checked in after the close — the owner's sequence. */
function closedThenVisaCheckedIn() {
  const visa = TB("visa", "Visa"), cash = TB("cash", "Cash", { paymentMethod: "cash", cardId: undefined, startingBalance: 83.25 });
  const e = (tb: TrackedBalance, actual: number, exp: number) =>
    ({ tb, actual, actualUSD: toUSD(actual, "USD", DEFAULT_LBP_RATE), expectedAtClose: exp, anchoredAt: AT });
  const record = buildPeriodClose({ cycleKey: CUR, startDay: START_DAY, closedAt: NOW, lbpRate: DEFAULT_LBP_RATE,
    accounts: [e(visa, 540.8, 571.35), e(cash, 61.9, 74.6)] });
  const visaClosed = reanchorTrackedBalance(visa, 540.8, 571.35, DEFAULT_LBP_RATE, AT);
  const visaChecked = reanchorTrackedBalance(visaClosed, 505.35, 540.8, DEFAULT_LBP_RATE, "2026-09-10T11:48:30.000Z");
  const data = { ...DEFAULT_DATA, income: 3000, cycleStartDay: START_DAY, transactions: [], periodCloses: [record],
    trackedBalances: [visaChecked, reanchorTrackedBalance(cash, 61.9, 74.6, DEFAULT_LBP_RATE, AT)] } as LocalFinancials;
  return { data, cash, visaChecked };
}

describe("1. reopen after a later check-in, through the screen", () => {
  it("the confirm names the account being kept, and says why", () => {
    const spy = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderScreen(closedThenVisaCheckedIn().data);
    fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
    const msg = spy.mock.calls[0][0] as string;
    expect(msg).toContain("Visa has been checked in since, so it keeps its newer figure.");
    expect(msg).not.toContain("Cash has been");
  });

  it("the write keeps Visa's newer figure and restores Cash, in one write", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { data, cash, visaChecked } = closedThenVisaCheckedIn();
    const onChange = renderScreen(data);
    fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const out = written(onChange);
    expect(out.trackedBalances![0]).toEqual(visaChecked);
    expect(out.trackedBalances![1]).toEqual(cash);
    expect(out.periodCloses![0].reopenedAt).toBeTruthy();
  });

  it("with nobody checked in since, the confirm keeps nothing back", () => {
    const spy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { data } = closedThenVisaCheckedIn();
    const untouched = { ...data, trackedBalances: [
      reanchorTrackedBalance(TB("visa", "Visa"), 540.8, 571.35, DEFAULT_LBP_RATE, AT), data.trackedBalances![1]] } as LocalFinancials;
    renderScreen(untouched);
    fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
    expect(spy.mock.calls[0][0] as string).not.toMatch(/checked in since/);
  });
});

describe("2. the reopen write carries transactions", () => {
  it("a close's EF correction is actually removed from what gets saved", () => {
    // Until this fix, the screen dropped `transactions` from the write, so
    // this row stayed live in storage while the record said "reopened".
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const base = { ...DEFAULT_DATA, income: 3000, cycleStartDay: START_DAY, emergencyFundOpeningBalance: 2_400,
      trackedBalances: [], transactions: [] } as unknown as LocalFinancials;
    const ef = planEfClose(base, 2_361.4);
    const record = buildPeriodClose({ cycleKey: CUR, startDay: START_DAY, closedAt: NOW, lbpRate: DEFAULT_LBP_RATE,
      accounts: [], emergencyFund: ef.entry });
    const data = { ...base, transactions: [ef.transaction!], periodCloses: [record] } as LocalFinancials;
    const onChange = renderScreen(data);
    fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
    const row = written(onChange).transactions!.find((t) => t.id === ef.transaction!.id)!;
    expect(row.deletedAt).toBeTruthy();
  });
});

describe("3. a close records the anchor it wrote", () => {
  it("anchoredAt is stored for a re-anchored account", () => {
    const data = { ...DEFAULT_DATA, income: 3000, cycleStartDay: START_DAY, transactions: [],
      trackedBalances: [TB("visa", "Visa")] } as LocalFinancials;
    const onChange = renderScreen(data);
    fireEvent.click(screen.getByRole("button", { name: /close this cycle/i }));
    fireEvent.change(screen.getByLabelText(/what Visa actually holds/i), { target: { value: "540.80" } });
    fireEvent.click(screen.getByRole("button", { name: /^close cycle$/i }));
    const out = written(onChange);
    expect(out.periodCloses![0].accounts[0].anchoredAt).toBe(out.trackedBalances![0].startingAt);
  });
});
