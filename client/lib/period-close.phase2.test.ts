// Period close, Phase 2 — the pure half: the close instant, the record
// builder, the acknowledgement match, and the startingDate regression.
//
// THE REGRESSION TEST IS THE ONE THAT MATTERS (section 1). Phase 2 pins a
// close to the cycle's END INSTANT rather than a date, and
// reanchorTrackedBalance already accepts a full instant for `startingAt`.
// But it also assigned that same instant to `startingDate`, whose contract
// is `YYYY-MM-DD`. isAfterBalanceBaseline compares them as strings:
//
//   "2026-09-26" < "2026-09-26T20:59:59.999Z"   -> true
//
// so a transaction dated on the boundary day takes tier 1 and is EXCLUDED,
// and tier 3 -- the createdAt/startingAt comparison that is the whole of
// 2.4.65's fix -- never runs. A boundary-pinned close lands on that day by
// construction, so this would have fired EVERY CYCLE. Same shape as 2.4.65
// itself, reintroduced by its caller.
//
// WHICH AXES THESE FIXTURES CANNOT REACH (2.4.116):
//
//   * TIMEZONE. This machine is UTC+3. For the close instant specifically,
//     a naive `.toISOString().slice(0,10)` and a local-date derivation give
//     the SAME answer here (both 2026-09-26), so the close-instant tests do
//     NOT discriminate between them. Section 2's late-evening instant does:
//     at UTC+3, 22:30Z is already the next local day. West of UTC the
//     discriminating case would be a different instant, and no test here
//     covers that direction -- named, not silently skipped.
//   * `startingAt` absent. Legacy rows predating 2.4.65 have none, and the
//     acknowledgement binds to it. Covered in section 4 as its own case,
//     because a fixture that always sets it would never see the branch.
//   * account count. Zero / one / several are section 3's axis; the record
//     builder behaves differently at zero (an empty `accounts`) and that is
//     legal per Phase 1.
//   * currency. An LBP account carries its own lbpRateAtEntry and a
//     different `currency` on the record; covered so the builder is not
//     only ever exercised in USD.
import { describe, it, expect } from "vitest";
import {
  reanchorTrackedBalance, isAfterBalanceBaseline, acknowledgementFor,
  buildPeriodClose, DEFAULT_LBP_RATE,
  type TrackedBalance, type StoredTransaction, type PeriodClose,
} from "./localData";
import { asCycleKey, cycleBounds, cycleCloseInstant } from "./period";
import { computeDashboard } from "./computeDashboard";
import { DEFAULT_DATA, type LocalFinancials } from "./localData";

const AUG = asCycleKey("2026-08");
const localISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const TB = (over: Partial<TrackedBalance> = {}): TrackedBalance => ({
  id: "tb1", name: "Cash", paymentMethod: "cash",
  startingBalance: 500, startingDate: "2026-08-01", startingAt: "2026-08-01T00:00:00.000Z",
  currency: "USD", ...over,
});

// ───────── 1. the regression: a boundary-day transaction still reaches tier 3 ─────────

describe("1. REGRESSION — an instant-pinned close must not break isAfterBalanceBaseline", () => {
  const instant = cycleCloseInstant(AUG, 27);           // 26 Sep 23:59:59.999 local
  const boundaryDay = localISO(new Date(cycleBounds(AUG, 27).end.getTime() - 1));

  it("startingDate stays a bare date, so the boundary day hits tier 3 not tier 1", () => {
    const closed = reanchorTrackedBalance(TB(), 430, 461, DEFAULT_LBP_RATE, instant);

    // Premise: the close really did pin to the instant -- otherwise the
    // assertion below is about a date-pinned close and proves nothing.
    expect(closed.startingAt).toBe(instant);
    expect(instant.length).toBeGreaterThan(10);

    // The contract: YYYY-MM-DD, not the instant.
    expect(closed.startingDate).toBe(boundaryDay);
    expect(closed.startingDate).toHaveLength(10);

    // And the consequence, asserted through the real predicate rather than
    // by inspecting the string. A transaction dated on the boundary day,
    // created BEFORE the close instant, belongs to the closed cycle.
    const before: StoredTransaction = {
      id: "t1", amount: 10, currency: "USD", bucket: "NEEDS", description: "x",
      date: boundaryDay, createdAt: "2026-09-26T09:00:00.000Z",
    };
    expect(isAfterBalanceBaseline(before, closed)).toBe(false);

    // ...and one created AFTER it belongs to the next cycle. This is the
    // pair that proves tier 3 ran: under the bug BOTH returned false,
    // because tier 1 swallowed them before tier 3 was reached.
    const after: StoredTransaction = {
      ...before, id: "t2", createdAt: "2026-09-27T09:00:00.000Z",
    };
    expect(isAfterBalanceBaseline(after, closed)).toBe(true);
  });

  it("the two directions differ — which is what a tier-1 swallow cannot produce", () => {
    const closed = reanchorTrackedBalance(TB(), 430, 461, DEFAULT_LBP_RATE, instant);
    const mk = (createdAt: string): StoredTransaction => ({
      id: "t", amount: 1, currency: "USD", bucket: "NEEDS", description: "x",
      date: boundaryDay, createdAt,
    });
    const results = ["2026-09-26T09:00:00.000Z", "2026-09-27T09:00:00.000Z"]
      .map((c) => isAfterBalanceBaseline(mk(c), closed));
    expect(results).toEqual([false, true]);
  });

  it("a bare-date asOf is unchanged — ImportStatement's existing case", () => {
    // The slice must be identity on a date, or the second caller moves.
    const closed = reanchorTrackedBalance(TB(), 430, 461, DEFAULT_LBP_RATE, "2026-09-05");
    expect(closed.startingDate).toBe("2026-09-05");
    expect(closed.startingAt).toBe("2026-09-05T23:59:59.999Z");
  });
});

// ───────── 2. the derivation is LOCAL, not a UTC slice ─────────

describe("2. startingDate is the instant's LOCAL day", () => {
  it("a late-evening UTC instant rolls to the next local day (UTC+3)", () => {
    // 22:30Z on the 26th is 01:30 on the 27th in Asia/Beirut. A
    // `.toISOString().slice(0,10)` implementation returns 2026-09-26 and is
    // wrong; the local derivation returns 2026-09-27. This is the only test
    // here that tells the two apart, and it does so only east of UTC.
    const closed = reanchorTrackedBalance(TB(), 430, 461, DEFAULT_LBP_RATE, "2026-09-26T22:30:00.000Z");
    expect(closed.startingDate).toBe(localISO(new Date("2026-09-26T22:30:00.000Z")));
    expect(closed.startingDate).not.toBe("2026-09-26T22:30:00.000Z".slice(0, 10));
  });
});

// ───────── 3. cycleCloseInstant and buildPeriodClose ─────────

describe("3. the close instant and the record", () => {
  it("the instant is the last millisecond of the cycle, not the next cycle's first", () => {
    const { start, end } = cycleBounds(AUG, 27);
    const inst = new Date(cycleCloseInstant(AUG, 27));
    expect(inst.getTime()).toBe(end.getTime() - 1);
    expect(inst.getTime()).toBeGreaterThan(start.getTime());
    // Named explicitly: it belongs to the cycle being closed.
    expect(localISO(inst)).toBe("2026-09-26");
  });

  it("builds a record carrying the real span, the startDay, and priorState", () => {
    const tb = TB({ actualBalance: 500 });
    const rec = buildPeriodClose({
      cycleKey: AUG, startDay: 27, closedAt: new Date("2026-09-27T06:00:00.000Z"),
      lbpRate: DEFAULT_LBP_RATE,
      accounts: [{ tb, actual: 430, expectedAtClose: 461 }],
    });
    expect(rec.cycleKey).toBe(AUG);
    expect(rec.startDayAtClose).toBe(27);
    expect(rec.rangeStart).toBe(localISO(cycleBounds(AUG, 27).start));
    expect(rec.rangeEnd).toBe("2026-09-26");
    expect(rec.closedAt).toBe("2026-09-27T06:00:00.000Z");

    const a = rec.accounts[0];
    expect(a.trackedBalanceId).toBe("tb1");
    expect(a.actual).toBe(430);
    expect(a.expectedAtClose).toBe(461);
    expect(a.discrepancy).toBe(-31);
    expect(a.currency).toBe("USD");
    // priorState is the anchor being overwritten, captured BEFORE the
    // reanchor -- Phase 4 restores from it.
    expect(a.priorState).toEqual({
      startingBalance: 500, startingDate: "2026-08-01",
      startingAt: "2026-08-01T00:00:00.000Z", actualBalance: 500,
    });
  });

  it("zero accounts produces a legal record with an empty list", () => {
    const rec = buildPeriodClose({
      cycleKey: AUG, startDay: 27, closedAt: new Date("2026-09-27T06:00:00.000Z"),
      lbpRate: DEFAULT_LBP_RATE, accounts: [],
    });
    expect(rec.accounts).toEqual([]);
    expect(rec.rangeStart).toBeTruthy();
  });

  it("several accounts, including LBP, each keep their own currency and rate", () => {
    const usd = TB();
    const lbp = TB({ id: "tb2", name: "LBP cash", currency: "LBP", lbpRateAtEntry: 89_000 });
    const rec = buildPeriodClose({
      cycleKey: AUG, startDay: 27, closedAt: new Date("2026-09-27T06:00:00.000Z"),
      lbpRate: 89_500,
      accounts: [{ tb: usd, actual: 430, expectedAtClose: 461 }, { tb: lbp, actual: 1_000_000, expectedAtClose: 900_000 }],
    });
    expect(rec.accounts).toHaveLength(2);
    expect(rec.accounts.map((a) => a.currency)).toEqual(["USD", "LBP"]);
    expect(rec.accounts.every((a) => a.lbpRateAtClose === 89_500)).toBe(true);
    expect(rec.accounts[1].discrepancy).toBe(100_000);
  });

  it("a legacy account with no startingAt records priorState without one", () => {
    const legacy = TB({ startingAt: undefined, actualBalance: undefined });
    const rec = buildPeriodClose({
      cycleKey: AUG, startDay: 27, closedAt: new Date("2026-09-27T06:00:00.000Z"),
      lbpRate: DEFAULT_LBP_RATE, accounts: [{ tb: legacy, actual: 430, expectedAtClose: 461 }],
    });
    expect(rec.accounts[0].priorState.startingAt).toBeUndefined();
    expect(rec.accounts[0].priorState.actualBalance).toBeUndefined();
    expect(rec.accounts[0].priorState.startingBalance).toBe(500);
  });
});

// ───────── 4. acknowledgementFor — the binding ─────────

const ackRecord = (over: Partial<{ startingAt: string; discrepancy: number }> = {}): PeriodClose => ({
  cycleKey: AUG, rangeStart: "2026-08-27", rangeEnd: "2026-09-26",
  startDayAtClose: 27, closedAt: "2026-09-27T06:00:00.000Z",
  accounts: [{
    trackedBalanceId: "tb1", actual: 430, expectedAtClose: 461, discrepancy: -31,
    currency: "USD", lbpRateAtClose: DEFAULT_LBP_RATE,
    priorState: { startingBalance: 500, startingDate: "2026-08-01" },
    acknowledgement: {
      note: "Cash withdrawal on the 14th I never logged.",
      acknowledgedAt: "2026-09-27T06:00:00.000Z",
      discrepancy: over.discrepancy ?? -31,
      startingAt: over.startingAt ?? "2026-09-26T20:59:59.999Z",
    },
  }],
});

describe("4. acknowledgementFor — honoured only while BOTH still match", () => {
  const closedTb = TB({ id: "tb1", startingAt: "2026-09-26T20:59:59.999Z" });

  it("matches when startingAt and discrepancy both agree", () => {
    expect(acknowledgementFor(closedTb, -31, [ackRecord()])!.note).toMatch(/withdrawal/);
  });

  it("LAPSES after a fresh check-in — a new startingAt", () => {
    // The anti-auto-absorb mechanism. A later check-in mints a new instant,
    // and the old acknowledgement stops applying to the new gap.
    const rechecked = TB({ id: "tb1", startingAt: "2026-10-02T09:00:00.000Z" });
    expect(acknowledgementFor(rechecked, -31, [ackRecord()])).toBeNull();
  });

  it("LAPSES when the discrepancy changes, same anchor", () => {
    expect(acknowledgementFor(closedTb, -45, [ackRecord()])).toBeNull();
  });

  it("never matches an account that has no startingAt at all", () => {
    // Legacy pre-2.4.65 row. There is no identity to bind to, so it cannot
    // be acknowledged -- fails closed, which is the right direction.
    const legacy = TB({ id: "tb1", startingAt: undefined });
    expect(acknowledgementFor(legacy, -31, [ackRecord()])).toBeNull();
  });

  it("does not match a different account", () => {
    expect(acknowledgementFor(TB({ id: "tb2", startingAt: "2026-09-26T20:59:59.999Z" }), -31, [ackRecord()])).toBeNull();
  });

  it("returns null for a null discrepancy, and for no closes at all", () => {
    expect(acknowledgementFor(closedTb, null, [ackRecord()])).toBeNull();
    expect(acknowledgementFor(closedTb, -31, undefined)).toBeNull();
    expect(acknowledgementFor(closedTb, -31, [])).toBeNull();
  });

  it("takes the most recent close when several acknowledge the same anchor", () => {
    const older = ackRecord();
    const newer = ackRecord();
    newer.closedAt = "2026-10-01T06:00:00.000Z";
    newer.accounts[0].acknowledgement!.note = "Later explanation.";
    expect(acknowledgementFor(closedTb, -31, [older, newer])!.note).toBe("Later explanation.");
  });
});


// ───────── 5. the payload: ONE derived value, read by both surfaces ─────────

describe("5. balanceChecks.acknowledged -- computed once so the surfaces cannot disagree", () => {
  const ANCHOR = "2026-09-26T20:59:59.999Z";
  /** A tracked balance whose frozen gap is exactly -31. */
  const gapFixture = (over: Partial<TrackedBalance> = {}): LocalFinancials => ({
    ...DEFAULT_DATA, income: 3000,
    trackedBalances: [TB({
      startingBalance: 430, startingDate: "2026-09-26", startingAt: ANCHOR,
      actualBalance: 430, actualBalanceDate: ANCHOR, expectedAtCheckUSD: 461, ...over,
    })],
  } as LocalFinancials);

  const withAck = (d: LocalFinancials, discrepancy = -31, startingAt = ANCHOR): LocalFinancials => ({
    ...d, periodCloses: [ackRecord({ discrepancy, startingAt })],
  });

  it("the fixture really does produce a -31 gap -- premise for everything below", () => {
    const bc = computeDashboard(gapFixture()).balanceChecks[0];
    expect(bc.discrepancy).toBe(-31);
    expect(bc.acknowledged).toBeNull();
  });

  it("acknowledged is populated when the binding matches", () => {
    const bc = computeDashboard(withAck(gapFixture())).balanceChecks[0];
    expect(bc.acknowledged?.note).toMatch(/withdrawal/);
  });

  it("NARROWNESS -- acknowledging changes no figure anywhere", () => {
    // The test that proves this is a status change and not an adjustment.
    // If it ever fails, acknowledgement has become an adjustment.
    const plain = gapFixture();
    const acked = withAck(gapFixture());
    const a = computeDashboard(plain);
    const b = computeDashboard(acked);

    expect(b.balanceChecks[0].discrepancy).toBe(a.balanceChecks[0].discrepancy);
    expect(b.balanceChecks[0].expected).toBe(a.balanceChecks[0].expected);
    expect(b.balanceChecks[0].actual).toBe(a.balanceChecks[0].actual);
    expect(b.balanceChecks[0].changeSinceCheck).toBe(a.balanceChecks[0].changeSinceCheck);
    // The stored record is untouched too -- expectedAtCheckUSD,
    // startingBalance and the transaction list are the inputs an adjustment
    // would have had to move.
    expect(acked.trackedBalances[0].expectedAtCheckUSD).toBe(plain.trackedBalances[0].expectedAtCheckUSD);
    expect(acked.trackedBalances[0].startingBalance).toBe(plain.trackedBalances[0].startingBalance);
    expect(acked.transactions).toEqual(plain.transactions);
    // And every other headline figure in the payload.
    expect(b.month).toEqual(a.month);
    expect(b.health.score).toBe(a.health.score);
  });

  it("the ALERT is suppressed for an acknowledged gap, and only for it", () => {
    const alerts = (d: LocalFinancials) => computeDashboard(d).alerts.filter((x) => x.id.startsWith("balance-"));
    // Premise: this gap does fire an alert unacknowledged (-31 exceeds $5).
    expect(alerts(gapFixture())).toHaveLength(1);
    expect(alerts(withAck(gapFixture()))).toHaveLength(0);
  });

  it("LAPSES after a fresh check-in -- new startingAt, alert returns", () => {
    const rechecked = withAck(gapFixture({ startingAt: "2026-10-02T09:00:00.000Z", actualBalanceDate: "2026-10-02T09:00:00.000Z" }));
    const bc = computeDashboard(rechecked).balanceChecks[0];
    expect(bc.acknowledged).toBeNull();
    expect(computeDashboard(rechecked).alerts.filter((x) => x.id.startsWith("balance-"))).toHaveLength(1);
  });

  it("THRESHOLDS -- a $3 gap is badge-only, and acknowledging it still clears nothing on Overview", () => {
    // 2.4.111: the threshold pair is reachable. $3 is >= the badge's $1 and
    // < the alert's $5, so the alert was never firing and there is nothing
    // for the acknowledgement to suppress there. Asserted so 'both surfaces
    // honour it' is not read as 'both surfaces always had something to say'.
    const three = gapFixture({ expectedAtCheckUSD: 433 });
    const bc = computeDashboard(three).balanceChecks[0];
    expect(bc.discrepancy).toBe(-3);
    expect(computeDashboard(three).alerts.filter((x) => x.id.startsWith("balance-"))).toHaveLength(0);
  });

  it("a gap exactly AT each threshold behaves as the comparison says", () => {
    const at1 = computeDashboard(gapFixture({ expectedAtCheckUSD: 431 })).balanceChecks[0];
    expect(at1.discrepancy).toBe(-1);                      // badge: >= 1, mismatch
    const at5 = gapFixture({ expectedAtCheckUSD: 435 });
    expect(computeDashboard(at5).balanceChecks[0].discrepancy).toBe(-5);
    expect(computeDashboard(at5).alerts.filter((x) => x.id.startsWith("balance-"))).toHaveLength(1); // alert: >= 5
  });
});
