// Small fix (owner, 2026-10-07): the balance card dated an "Accounted for"
// note by the UTC day (fmtDate slices the ISO string), so a note written in
// the first hours after local midnight east of UTC showed yesterday. It now
// uses the instant's LOCAL day, like the close history beside it.
//
// The instant below is 00:30 on 27 Sep in Beirut (UTC+3) and 21:30 on 26 Sep
// in UTC; the expected day is computed in this run's own zone, so the test
// discriminates on the Beirut leg.
import { it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import BalanceCheckScreen from "./BalanceCheckScreen";
import { ThemeProvider } from "../../contexts/ThemeContext";
import { computeDashboard } from "../../lib/computeDashboard";
import { DEFAULT_DATA, type LocalFinancials, type TrackedBalance, type PeriodClose } from "../../lib/localData";
import { asCycleKey } from "../../lib/period";

afterEach(() => { cleanup(); vi.useRealTimers(); });

it("an acknowledgement made just after local midnight shows that local day", () => {
  vi.useFakeTimers({ now: new Date("2026-10-07T12:00:00.000Z"), toFake: ["Date"] });
  const ACKED_AT = "2026-09-26T21:30:00.000Z";
  const ANCHOR = "2026-09-26T20:59:59.999Z";
  const tb: TrackedBalance = {
    id: "tb-cash", name: "Wallet cash", paymentMethod: "cash", currency: "USD",
    startingBalance: 400, startingDate: "2026-09-26", startingAt: ANCHOR,
    actualBalance: 400, actualBalanceDate: "2026-09-26", expectedAtCheckUSD: 430,
  };
  const close: PeriodClose = {
    cycleKey: asCycleKey("2026-08"), rangeStart: "2026-08-27", rangeEnd: "2026-09-26", startDayAtClose: 27,
    closedAt: ACKED_AT,
    accounts: [{
      trackedBalanceId: "tb-cash", actual: 400, actualUSD: 400, expectedAtClose: 430, discrepancy: -30, currency: "USD", lbpRateAtClose: 89_500,
      priorState: { startingBalance: 430, startingDate: "2026-08-26" }, priorStateComplete: true, anchoredAt: ANCHOR,
      acknowledgement: { note: "Parking fees, paid in cash", acknowledgedAt: ACKED_AT, discrepancy: -30, startingAt: ANCHOR },
    }],
  };
  const d = { ...DEFAULT_DATA, income: 3000, cycleStartDay: 27, trackedBalances: [tb], periodCloses: [close] } as LocalFinancials;
  render(<ThemeProvider><BalanceCheckScreen financials={d} dashData={computeDashboard(d)} onChange={vi.fn()} /></ThemeProvider>);
  const local = new Date(ACKED_AT);
  const day = `${String(local.getDate()).padStart(2, "0")}/${String(local.getMonth() + 1).padStart(2, "0")}/${local.getFullYear()}`;
  const card = Array.from(document.querySelectorAll("p")).find((p) => p.textContent?.startsWith("Accounted for on") && !p.closest("ol"));
  expect(card?.textContent).toBe(`Accounted for on ${day} — “Parking fees, paid in cash”`);
});
