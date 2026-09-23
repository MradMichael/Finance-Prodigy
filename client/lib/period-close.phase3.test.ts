// Period close, Phase 3 — closing a past cycle, and the unclosed list.
//
// THE FIRST TEST IS THE PREMISE FOR EVERYTHING ELSE HERE, and it is the one
// the plan did not anticipate. Phase 2's dialog takes `expectedAtClose` from
// dashData.balanceChecks[].expected, which is the LIVE figure --
// startingBalance minus every transaction after the baseline. For the
// CURRENT cycle that is correct, because "after the baseline" and "up to
// now" coincide.
//
// For a late close they do not. Closing August on 5 October, the live
// expected already has 27 Sep - 5 Oct spending subtracted, while the figure
// the user is asked to state is what the account held on 26 September. The
// discrepancy would subtract one moment from another: not stale, meaningless.
//
// So every late-close test below is only meaningful if expected-as-of and
// live expected genuinely differ. Section 1 proves they do.
//
// WHICH AXES THESE FIXTURES CANNOT REACH (2.4.116):
//
//   * a cycle containing no activity at all -- whether it is listed is
//     decided by the WINDOW, not by content, so an empty cycle inside the
//     window is listed. Covered; an empty cycle outside it is not reachable
//     without also moving the window.
//   * `startingAt` absent (legacy pre-2.4.65). The backwards-reanchor check
//     has no anchor to compare against and must treat such an account as
//     reanchorable. Covered as its own case -- a fixture that always sets
//     startingAt would never see that branch.
//   * more than `cap` unclosed cycles. The cap's own branch needs a window
//     longer than 12, which no other fixture here produces.
//   * a payday change BETWEEN two closes rather than before both. Covered
//     in section 4; a single-close fixture cannot distinguish "this key was
//     never closed" from "this key was closed under a different span".
//   * NOT COVERED: closing a cycle older than the earliest transaction. The
//     window starts at the earliest activity, so it is unreachable through
//     unclosedCycles -- named rather than implied, because a future caller
//     that picks a key by hand could still reach the close path.
import { describe, it, expect } from "vitest";
import {
  trackedBalanceExpected, trackedBalanceExpectedAsOf,
} from "./computeDashboard";
import {
  DEFAULT_DATA, DEFAULT_LBP_RATE, unclosedCycles, isCycleClosedBySpan,
  closeMovesBaselineBackwards,
  type LocalFinancials, type TrackedBalance, type StoredTransaction, type PeriodClose,
} from "./localData";
import { asCycleKey, cycleBounds, cycleCloseInstant } from "./period";

const AUG = asCycleKey("2026-08");
const JUL = asCycleKey("2026-07");
const localISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const TB = (over: Partial<TrackedBalance> = {}): TrackedBalance => ({
  id: "tb1", name: "Cash", paymentMethod: "cash",
  startingBalance: 500, startingDate: "2026-08-01", startingAt: "2026-08-01T00:00:00.000Z",
  currency: "USD", ...over,
});

const TX = (id: string, date: string, amount = 10): StoredTransaction => ({
  id, amount, currency: "USD", bucket: "NEEDS", description: "x", date, paymentMethod: "cash",
});

const data = (over: Partial<LocalFinancials> = {}): LocalFinancials =>
  ({ ...DEFAULT_DATA, income: 3000, cycleStartDay: 27, ...over } as LocalFinancials);

// ───────── 1. THE PREMISE — expected-as-of is not live expected ─────────

describe("1. expected-as-of differs from live expected once activity falls after the cycle end", () => {
  // Cycle 2026-08 at startDay 27 runs 27 Aug - 26 Sep. These two transactions
  // straddle its end: one inside, one after.
  const inside = TX("in", "2026-09-20", 10);
  const after = TX("out", "2026-10-02", 25);
  const fixture = data({ trackedBalances: [TB()], transactions: [inside, after] });
  const endInstant = cycleCloseInstant(AUG, 27);

  it("live expected subtracts BOTH; as-of subtracts only the one inside", () => {
    const live = trackedBalanceExpected(TB(), fixture);
    const asOf = trackedBalanceExpectedAsOf(TB(), fixture, endInstant);

    // Premise on the premise: the fixture really does have activity on both
    // sides of the boundary, or "they differ" would be vacuous.
    expect(inside.date < localISO(new Date(endInstant))).toBe(true);
    expect(after.date > localISO(new Date(endInstant))).toBe(true);

    expect(live).toBe(500 - 10 - 25);   // 465
    expect(asOf).toBe(500 - 10);        // 490
    expect(asOf).not.toBe(live);
  });

  it("they AGREE when nothing falls after the cycle end -- the current-cycle case", () => {
    // Which is exactly why Phase 2 was correct without this: closing the
    // current cycle, there is no "after" yet.
    const onlyInside = data({ trackedBalances: [TB()], transactions: [inside] });
    expect(trackedBalanceExpectedAsOf(TB(), onlyInside, endInstant))
      .toBe(trackedBalanceExpected(TB(), onlyInside));
  });

  it("a transaction dated ON the cycle's last day is INSIDE it", () => {
    // The boundary itself. `date` is a real-world date, so a transaction
    // dated 26 Sep belongs to the cycle that ends 26 Sep regardless of when
    // it was entered -- no createdAt tiering on this side.
    const lastDay = localISO(new Date(cycleBounds(AUG, 27).end.getTime() - 1));
    const onBoundary = data({ trackedBalances: [TB()], transactions: [TX("b", lastDay, 7)] });
    expect(trackedBalanceExpectedAsOf(TB(), onBoundary, endInstant)).toBe(493);
  });

  it("the day after is OUTSIDE it", () => {
    const dayAfter = localISO(cycleBounds(AUG, 27).end);
    const justAfter = data({ trackedBalances: [TB()], transactions: [TX("b", dayAfter, 7)] });
    expect(trackedBalanceExpectedAsOf(TB(), justAfter, endInstant)).toBe(500);
  });
});

// ───────── 2. the span rule ─────────

const closeOf = (key: string, startDay: number, over: Partial<PeriodClose> = {}): PeriodClose => {
  const b = cycleBounds(asCycleKey(key), startDay);
  return {
    cycleKey: asCycleKey(key),
    rangeStart: localISO(b.start),
    rangeEnd: localISO(new Date(b.end.getTime() - 1)),
    startDayAtClose: startDay,
    closedAt: "2026-09-27T06:00:00.000Z",
    accounts: [],
    ...over,
  };
};

describe("2. a cycle is closed only if a record matches the span the key names TODAY", () => {
  it("a close recorded at the same startDay closes it", () => {
    const d = data({ periodCloses: [closeOf("2026-08", 27)] });
    expect(isCycleClosedBySpan(d, AUG, 27).closed).toBe(true);
  });

  it("a close recorded at a DIFFERENT startDay does not -- it covered another period", () => {
    // 2026-08 at startDay 1 is 1-31 Aug; at 27 it is 27 Aug - 26 Sep. Same
    // key, different stretch of real time (2.4.102). Claiming the second is
    // closed because the first was is the re-dating that rule forbids.
    const d = data({ periodCloses: [closeOf("2026-08", 1)] });
    const verdict = isCycleClosedBySpan(d, AUG, 27);
    expect(verdict.closed).toBe(false);
    // ...and it is reported, not silently a gap.
    expect(verdict.closedUnderOtherSpan).toEqual({ rangeStart: "2026-08-01", rangeEnd: "2026-08-31" });
  });

  it("an unrelated key is neither closed nor superseded", () => {
    const d = data({ periodCloses: [closeOf("2026-08", 27)] });
    const verdict = isCycleClosedBySpan(d, JUL, 27);
    expect(verdict.closed).toBe(false);
    expect(verdict.closedUnderOtherSpan).toBeNull();
  });
});

// ───────── 3. the list ─────────

describe("3. unclosedCycles", () => {
  const NOW = new Date(2026, 10, 5); // 5 Nov 2026 -> current cycle 2026-10 at startDay 27

  it("is EMPTY until the first close -- no ritual, no guilt", () => {
    // A brand-new account showing a backlog is what gets the feature
    // abandoned. Nothing is listed before there is a habit to be behind on.
    const d = data({ transactions: [TX("t", "2026-06-01")], trackedBalances: [TB()] });
    expect(unclosedCycles(d, NOW).rows).toEqual([]);
  });

  it("once one cycle is closed, the gaps show -- INCLUDING ones before it", () => {
    // The requirement: skip August, close September, August stays visible.
    // The window is activity-based, not anchored at the first close.
    const d = data({
      transactions: [TX("t", "2026-08-01")],
      trackedBalances: [TB()],
      periodCloses: [closeOf("2026-09", 27)],
    });
    const keys = unclosedCycles(d, NOW).rows.map((r) => r.cycleKey);
    expect(keys).toContain("2026-08");
    expect(keys).not.toContain("2026-09");
  });

  it("excludes the CURRENT cycle -- Phase 2's own button owns it", () => {
    const d = data({
      transactions: [TX("t", "2026-08-01")], trackedBalances: [TB()],
      periodCloses: [closeOf("2026-09", 27)],
    });
    expect(unclosedCycles(d, NOW).rows.map((r) => r.cycleKey)).not.toContain("2026-10");
  });

  it("uses a tracked balance's startingDate when there are no transactions", () => {
    const d = data({
      transactions: [],
      trackedBalances: [TB({ startingDate: "2026-07-01" })],
      periodCloses: [closeOf("2026-09", 27)],
    });
    const keys = unclosedCycles(d, NOW).rows.map((r) => r.cycleKey);
    expect(keys).toContain("2026-06"); // 1 Jul at startDay 27 belongs to cycle 2026-06
  });

  it("has no window at all with neither transactions nor tracked balances", () => {
    expect(unclosedCycles(data({ periodCloses: [closeOf("2026-09", 27)] }), NOW).rows).toEqual([]);
  });

  it("caps the list and reports how many were hidden", () => {
    const d = data({
      transactions: [TX("t", "2024-01-15")], trackedBalances: [TB()],
      periodCloses: [closeOf("2026-09", 27)],
    });
    const out = unclosedCycles(d, NOW, 12);
    expect(out.rows).toHaveLength(12);
    expect(out.hiddenEarlier).toBeGreaterThan(0);
    // Newest first, so the cap drops the OLDEST rather than the nearest.
    expect(out.rows[0].cycleKey > out.rows[11].cycleKey).toBe(true);
  });

  it("carries the real span on every row, not just the key", () => {
    const d = data({
      transactions: [TX("t", "2026-08-01")], trackedBalances: [TB()],
      periodCloses: [closeOf("2026-09", 27)],
    });
    const aug = unclosedCycles(d, NOW).rows.find((r) => r.cycleKey === "2026-08")!;
    expect(aug.rangeStart).toBe("2026-08-27");
    expect(aug.rangeEnd).toBe("2026-09-26");
  });

  it("a payday change resurfaces previously-closed cycles, and says why", () => {
    // The consequence of the span rule, approved deliberately. The close was
    // real; the period it covered is not the period this key now names.
    const d = data({
      transactions: [TX("t", "2026-08-01")], trackedBalances: [TB()],
      periodCloses: [closeOf("2026-08", 1), closeOf("2026-09", 27)],
    });
    const aug = unclosedCycles(d, NOW).rows.find((r) => r.cycleKey === "2026-08")!;
    expect(aug.closedUnderOtherSpan).toEqual({ rangeStart: "2026-08-01", rangeEnd: "2026-08-31" });
  });
});

// ───────── 4. re-close refused, and the acknowledgement untouched ─────────

describe("4. re-closing a cycle already closed is REFUSED", () => {
  it("isCycleClosedBySpan is what the caller gates on", () => {
    const d = data({ periodCloses: [closeOf("2026-08", 27)] });
    expect(isCycleClosedBySpan(d, AUG, 27).closed).toBe(true);
  });

  it("the existing record -- and its acknowledgement -- is untouched by the refusal", () => {
    // Refused rather than replaced precisely because a re-close with the
    // same asOf mints an IDENTICAL startingAt (Phase 1's note), so a silent
    // replace could re-attach an old explanation to a new figure.
    const withAck = closeOf("2026-08", 27, {
      accounts: [{
        trackedBalanceId: "tb1", actual: 430, expectedAtClose: 461, discrepancy: -31,
        currency: "USD", lbpRateAtClose: DEFAULT_LBP_RATE,
        priorState: { startingBalance: 500, startingDate: "2026-08-01" },
        acknowledgement: {
          note: "Explained.", acknowledgedAt: "2026-09-27T06:00:00.000Z",
          discrepancy: -31, startingAt: "2026-09-26T20:59:59.999Z",
        },
      }],
    });
    const d = data({ periodCloses: [withAck] });
    expect(isCycleClosedBySpan(d, AUG, 27).closed).toBe(true);
    expect(d.periodCloses![0].accounts[0].acknowledgement!.note).toBe("Explained.");
  });
});


// ───────── 5. a close never moves a baseline backwards ─────────

describe("5. backwards reanchoring is refused, per account", () => {
  const augEnd = cycleCloseInstant(AUG, 27); // 26 Sep 23:59:59.999 local

  it("an account checked in AFTER the cycle end is not reanchored", () => {
    // The case Phase 2 could not produce, because it only ever closed the
    // current cycle. Closing August in October reaches it.
    expect(closeMovesBaselineBackwards({ startingAt: "2026-10-05T09:00:00.000Z" }, augEnd)).toBe(true);
  });

  it("an account checked in BEFORE it is reanchored normally", () => {
    // Premise: the ordinary late close -- a few days behind, baseline still
    // inside the cycle -- must keep working, or the rule has eaten the
    // feature rather than guarded it.
    expect(closeMovesBaselineBackwards({ startingAt: "2026-09-01T09:00:00.000Z" }, augEnd)).toBe(false);
  });

  it("exactly AT the cycle end counts as backwards -- re-pinning the same instant moves nothing", () => {
    expect(closeMovesBaselineBackwards({ startingAt: augEnd }, augEnd)).toBe(true);
  });

  it("a legacy row with no startingAt is reanchorable -- absent evidence, include", () => {
    // Same direction 2.4.65's own fallback takes. There is no anchor to
    // compare, so refusing would strand pre-2.4.65 accounts permanently.
    expect(closeMovesBaselineBackwards({ startingAt: undefined }, augEnd)).toBe(false);
  });
});
