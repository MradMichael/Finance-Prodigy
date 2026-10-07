// DI-11 (owner, 2026-10-07): a close history on Balance Check.
//
// The close dialog won't accept an acknowledgement without a written reason,
// yet once a close is reopened -- or undone by a sync merge because another
// device closed the same cycle earlier (SYNC-1 step 2) -- its note showed on
// no screen. Balance Check shows a note only while it explains the account's
// CURRENT gap (acknowledgementFor), and skips a superseded close. The note
// survived only in "Download my data".
//
// Now each tracked account lists its past closes, newest first: the cycle (by
// the payday it was closed under), the day it was closed, the figures at
// close, the difference, the note, and whether it's in force, reopened, or
// undone by a merge. Read-only: nothing here edits or removes history.
//
// WHAT THESE FIXTURES CANNOT REACH: a close whose account was later removed.
// The history hangs off each CURRENT tracked balance, so such a close isn't
// listed (recorded for the owner, not built).
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within, fireEvent } from "@testing-library/react";
import BalanceCheckScreen from "./BalanceCheckScreen";
import { ThemeProvider } from "../../contexts/ThemeContext";
import { computeDashboard } from "../../lib/computeDashboard";
import {
  DEFAULT_DATA, closeHistoryFor,
  type LocalFinancials, type TrackedBalance, type PeriodClose, type PeriodCloseAccount,
} from "../../lib/localData";
import { asCycleKey } from "../../lib/period";

afterEach(() => { cleanup(); vi.useRealTimers(); });

const CASH: TrackedBalance = {
  id: "tb-cash", name: "Wallet cash", paymentMethod: "cash", currency: "USD",
  startingBalance: 430, startingDate: "2026-08-26", startingAt: "2026-08-26T20:59:59.999Z",
};
const LIRA: TrackedBalance = {
  id: "tb-lira", name: "Lira envelope", paymentMethod: "cash", currency: "LBP",
  startingBalance: 38_000_000, startingDate: "2026-08-26", startingAt: "2026-08-26T20:59:59.999Z",
};
const NEVER: TrackedBalance = {
  id: "tb-card", name: "Visa current", paymentMethod: "other", currency: "USD",
  startingBalance: 1210.4, startingDate: "2026-09-01", startingAt: "2026-09-01T09:00:00.000Z",
};

const acc = (tb: TrackedBalance, actual: number, expectedAtClose: number, discrepancy: number, note?: string, at?: string): PeriodCloseAccount => ({
  trackedBalanceId: tb.id, actual, actualUSD: tb.currency === "LBP" ? 424.58 : actual, expectedAtClose, discrepancy,
  currency: tb.currency, lbpRateAtClose: 89_500,
  priorState: { startingBalance: tb.startingBalance, startingDate: tb.startingDate }, priorStateComplete: true,
  ...(note ? { acknowledgement: { note, acknowledgedAt: at!, discrepancy, startingAt: "2026-07-26T20:59:59.999Z" } } : {}),
});
const close = (key: string, rangeStart: string, rangeEnd: string, closedAt: string, accounts: PeriodCloseAccount[], extra: Partial<PeriodClose> = {}): PeriodClose => ({
  cycleKey: asCycleKey(key), rangeStart, rangeEnd, startDayAtClose: 27, closedAt, accounts, ...extra,
});

// Payday the 27th. Cycle "2026-06" is 27 Jun - 26 Jul; "2026-07" is 27 Jul - 26 Aug.
const JUL_STANDING = close("2026-06", "2026-06-27", "2026-07-26", "2026-07-27T06:00:00.000Z", [acc(CASH, 412.35, 430.1, -17.75)]);
const JUL_UNDONE = close("2026-06", "2026-06-27", "2026-07-26", "2026-07-27T08:00:00.000Z",
  [acc(CASH, 405, 430.1, -25.1, "Cash gift from Rania not logged", "2026-07-27T08:00:00.000Z")],
  { supersededAt: "2026-07-28T09:00:00.000Z", reopenedAt: "2026-07-28T09:00:00.000Z" });
const AUG_REOPENED = close("2026-07", "2026-07-27", "2026-08-26", "2026-08-27T07:30:00.000Z",
  [acc(CASH, 380, 402.5, -22.5, "Parking fees, paid in cash", "2026-08-27T07:30:00.000Z")],
  { reopenedAt: "2026-08-28T10:00:00.000Z" });
const AUG_IN_FORCE = close("2026-07", "2026-07-27", "2026-08-26", "2026-08-29T07:00:00.000Z",
  [acc(CASH, 430, 461, -31), acc(LIRA, 38_000_000, 430.5, -5.92)]);
const ALL = [JUL_STANDING, JUL_UNDONE, AUG_REOPENED, AUG_IN_FORCE];

describe("closeHistoryFor", () => {
  it("one account's closes, newest first, with what became of each", () => {
    const h = closeHistoryFor(CASH.id, ALL);
    expect(h.map((e) => [e.close.closedAt, e.status, e.statusAt])).toEqual([
      ["2026-08-29T07:00:00.000Z", "in-force", undefined],
      ["2026-08-27T07:30:00.000Z", "reopened", "2026-08-28T10:00:00.000Z"],
      ["2026-07-27T08:00:00.000Z", "undone", "2026-07-28T09:00:00.000Z"],
      ["2026-07-27T06:00:00.000Z", "in-force", undefined],
    ]);
    expect(h[1].account.acknowledgement?.note).toBe("Parking fees, paid in cash");
    expect(h[2].account.acknowledgement?.note).toBe("Cash gift from Rania not logged");
  });

  it("only that account's figures; none for an account never closed", () => {
    expect(closeHistoryFor(LIRA.id, ALL).map((e) => e.account.actual)).toEqual([38_000_000]);
    expect(closeHistoryFor(NEVER.id, ALL)).toEqual([]);
    expect(closeHistoryFor(CASH.id, undefined)).toEqual([]);
  });
});

function show(extra: Partial<LocalFinancials> = {}) {
  vi.useFakeTimers({ now: new Date("2026-10-07T12:00:00.000Z"), toFake: ["Date"] });
  const d = { ...DEFAULT_DATA, income: 3150.75, cycleStartDay: 27, trackedBalances: [CASH, LIRA, NEVER], periodCloses: ALL, ...extra } as LocalFinancials;
  render(<ThemeProvider><BalanceCheckScreen financials={d} dashData={computeDashboard(d)} onChange={vi.fn()} /></ThemeProvider>);
}
const historyOf = (name: string) => screen.getByRole("list", { name: `Close history for ${name}` });
const items = (name: string) => within(historyOf(name)).getAllByRole("listitem");

describe("the close history on Balance Check", () => {
  it("lists each close newest first, by the cycle it closed", () => {
    show();
    expect(items("Wallet cash").map((li) => li.querySelector("[data-cycle]")?.textContent)).toEqual([
      "27 Jul – 26 Aug 2026", "27 Jul – 26 Aug 2026", "27 Jun – 26 Jul 2026", "27 Jun – 26 Jul 2026",
    ]);
  });

  it("shows the day it was closed, and whether it's in force, reopened, or undone by a merge", () => {
    show();
    const [inForce, reopened, undone, standing] = items("Wallet cash");
    expect(inForce.textContent).toContain("Closed on 29/08/2026");
    expect(inForce.textContent).toContain("In force");
    expect(reopened.textContent).toContain("Reopened on 28/08/2026");
    expect(undone.textContent).toContain("Undone on 28/07/2026: another device closed this cycle earlier");
    expect(standing.textContent).toContain("In force");
  });

  it("shows the figures at close and the difference", () => {
    show();
    const inForce = items("Wallet cash")[0];
    expect(inForce.textContent).toContain("Expected at close$461.00");
    expect(inForce.textContent).toContain("You said you had$430.00");
    expect(inForce.textContent).toContain("Difference-$31.00");
  });

  it("a lira account shows what was counted in lira", () => {
    show();
    const [only] = items("Lira envelope");
    expect(only.textContent).toContain("You said you hadL£38,000,000");
    expect(only.textContent).toContain("Expected at close$430.50");
    expect(only.textContent).toContain("Difference-$5.92");
  });

  it("reopened and undone closes still show their notes", () => {
    show();
    const [, reopened, undone] = items("Wallet cash");
    expect(reopened.textContent).toContain("Accounted for on 27/08/2026 — “Parking fees, paid in cash”");
    expect(undone.textContent).toContain("Accounted for on 27/07/2026 — “Cash gift from Rania not logged”");
  });

  it("labels each close by the payday it was closed under, not today's", () => {
    show({ cycleStartDay: 1 });
    expect(items("Wallet cash")[0].querySelector("[data-cycle]")?.textContent).toBe("27 Jul – 26 Aug 2026");
  });

  it("with payday on the 1st, a close is labelled by its month", () => {
    const sep = { ...close("2026-09", "2026-09-01", "2026-09-30", "2026-10-01T07:00:00.000Z", [acc(NEVER, 1180, 1210.4, -30.4)]), startDayAtClose: 1 };
    show({ cycleStartDay: 1, periodCloses: [sep] });
    expect(items("Visa current")[0].querySelector("[data-cycle]")?.textContent).toBe("Sep 2026");
  });

  it("an account never closed says so", () => {
    show();
    fireEvent.click(screen.getAllByText(/^Close history/).at(-1)!);
    expect(screen.queryByRole("list", { name: "Close history for Visa current" })).toBeNull();
    expect(screen.getByText("Not closed yet.")).toBeTruthy();
  });

  it("is read-only: nothing in it edits or removes a close", () => {
    show();
    for (const name of ["Wallet cash", "Lira envelope"]) {
      expect(within(historyOf(name)).queryAllByRole("button")).toEqual([]);
      expect(within(historyOf(name)).queryAllByRole("textbox")).toEqual([]);
    }
  });
});
