// Period close, Phase 4 — reopen.
//
// THE SEVEN-FIELD ROUND TRIP IS THE TEST THAT MATTERS (section 1).
// reanchorTrackedBalance overwrites SEVEN fields; Phase 1's `priorState`
// captured four. That was an accurate description of an anchor and an
// incomplete description of what a close DESTROYS:
//
//   startingBalance      captured        actualBalanceDate    NOT captured
//   startingDate         captured        expectedAtCheckUSD   NOT captured
//   startingAt           captured        lbpRateAtEntry       NOT captured
//   actualBalance        captured
//
// Restoring four of seven pairs a pre-close `actualBalance` with the CLOSE's
// `expectedAtCheckUSD`, and the badge computes discrepancy from those two --
// so a partial reopen manufactures a gap out of two different moments. That
// is the same fault Phase 3 found in expectedAtClose, reintroduced by its
// own undo. A round-trip test written against the four fields priorState
// happened to hold would have passed while the restore was wrong.
//
// WHICH AXES THESE FIXTURES CANNOT REACH (2.4.116):
//
//   * a cycle reopened TWICE. The second is refused as "already-reopened",
//     which is a different branch from "not-closed" -- both are asserted
//     separately, because canReopen's reason ordering would otherwise be
//     untested and a reordering could go unnoticed.
//   * an account DELETED between close and reopen. The row is gone, so the
//     restore has nothing to write and must not resurrect it. Covered; a
//     fixture whose accounts all survive cannot see that branch.
//   * a payday change between close and reopen. Listed here as untestable
//     through reopen, on the assumption that canReopen would defer to
//     isCycleClosedBySpan. It does not -- it does its own span lookup, so
//     the axis WAS reachable and is now covered in section 2. A
//     perturbation that matched on cycleKey alone had passed silently
//     until then. The two lookups now share one function.
//   * the UI's own rendering of a refusal reason. canReopen returns it;
//     whether the screen shows it is the component test's job.
import { describe, it, expect } from "vitest";
import {
  DEFAULT_DATA, DEFAULT_LBP_RATE, buildPeriodClose, reanchorTrackedBalance,
  canReopen, reopenCycle, isCycleClosedBySpan,
  type LocalFinancials, type TrackedBalance,
} from "./localData";
import { asCycleKey, cycleBounds, cycleCloseInstant, currentCycleKey } from "./period";

const START_DAY = 27;
// 10 Sep 2026 -> current cycle 2026-08 (27 Aug - 26 Sep). Closing and
// reopening the CURRENT cycle is the only supported path, so the fixture
// clock has to sit inside it.
const NOW = new Date(2026, 8, 10, 12, 0, 0);
const CUR = asCycleKey("2026-08");
const localISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** A fully-populated pre-close balance: every field a close will overwrite. */
const TB = (over: Partial<TrackedBalance> = {}): TrackedBalance => ({
  id: "tb1", name: "Cash", paymentMethod: "cash",
  startingBalance: 500, startingDate: "2026-08-01", startingAt: "2026-08-01T09:00:00.000Z",
  actualBalance: 500, actualBalanceDate: "2026-08-01T09:00:00.000Z",
  expectedAtCheckUSD: 512, currency: "USD", ...over,
});

const data = (over: Partial<LocalFinancials> = {}): LocalFinancials =>
  ({ ...DEFAULT_DATA, income: 3000, cycleStartDay: START_DAY, ...over } as LocalFinancials);

/** Close `tb` for the current cycle, exactly as the screen does. */
function closed(tb: TrackedBalance, actual = 430, expectedAtClose = 461) {
  const at = cycleCloseInstant(CUR, START_DAY);
  const record = buildPeriodClose({
    cycleKey: CUR, startDay: START_DAY, closedAt: NOW, lbpRate: DEFAULT_LBP_RATE,
    accounts: [{ tb, actual, expectedAtClose }],
  });
  return data({
    trackedBalances: [reanchorTrackedBalance(tb, actual, expectedAtClose, DEFAULT_LBP_RATE, at)],
    periodCloses: [record],
  });
}

// ───────── 1. the seven-field round trip ─────────

describe("1. reopen restores every field the close overwrote", () => {
  it("all seven, byte-identical to the pre-close balance", () => {
    const before = TB();
    const after = closed(before);

    // Premise (2.4.97): the close really did move all seven, or "restored"
    // below would be indistinguishable from "never touched".
    const c = after.trackedBalances[0];
    expect(c.startingBalance).not.toBe(before.startingBalance);
    expect(c.startingDate).not.toBe(before.startingDate);
    expect(c.startingAt).not.toBe(before.startingAt);
    expect(c.actualBalance).not.toBe(before.actualBalance);
    expect(c.actualBalanceDate).not.toBe(before.actualBalanceDate);
    expect(c.expectedAtCheckUSD).not.toBe(before.expectedAtCheckUSD);

    const out = reopenCycle(after, CUR, NOW)!;
    expect(out.trackedBalances[0]).toStrictEqual(before);
  });

  it("an LBP account gets its lbpRateAtEntry back", () => {
    // withRate only writes this for LBP, so a USD-only fixture cannot see
    // the branch at all.
    const before = TB({ currency: "LBP", lbpRateAtEntry: 89_000 });
    const after = closed(before);
    expect(after.trackedBalances[0].lbpRateAtEntry).toBe(DEFAULT_LBP_RATE); // premise: it moved
    expect(reopenCycle(after, CUR, NOW)!.trackedBalances[0].lbpRateAtEntry).toBe(89_000);
  });

  it("an account that never had expectedAtCheckUSD gets the KEY REMOVED, not the close's value", () => {
    // The ambiguity priorStateComplete exists to resolve. Leaving the
    // close's figure behind would pair it with a restored older
    // actualBalance and manufacture a discrepancy from two moments --
    // exactly what a partial restore does wrong.
    const before = TB({ expectedAtCheckUSD: undefined, actualBalance: undefined, actualBalanceDate: undefined });
    const after = closed(before);
    expect(after.trackedBalances[0].expectedAtCheckUSD).toBe(461); // premise: the close set one

    const out = reopenCycle(after, CUR, NOW)!.trackedBalances[0];
    // Not `toBeUndefined()`: a key present with value undefined survives
    // toEqual and would serialise away silently. The key must be GONE.
    expect(Object.prototype.hasOwnProperty.call(out, "expectedAtCheckUSD")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(out, "actualBalance")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(out, "actualBalanceDate")).toBe(false);
  });
});

// ───────── 2. canReopen — every reason reachable and asserted ─────────

describe("2. canReopen", () => {
  it("permits a closed, current, complete record", () => {
    expect(canReopen(closed(TB()), CUR, NOW).ok).toBe(true);
  });

  it("refuses a cycle that was never closed", () => {
    const r = canReopen(data({ trackedBalances: [TB()] }), CUR, NOW);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe("not-closed");
  });

  it("refuses once the cycle has advanced", () => {
    // Reopen restores anchors, not the transactions logged since, so it is
    // clean immediately after and increasingly approximate later.
    const later = new Date(2026, 9, 10, 12, 0, 0); // current cycle is now 2026-09
    // Premise: the cycle really has advanced, or this asserts nothing.
    expect(currentCycleKey(later, START_DAY)).not.toBe(CUR);
    const r = canReopen(closed(TB()), CUR, later);
    expect(!r.ok && r.reason).toBe("not-current");
  });

  it("refuses a record already reopened", () => {
    const once = reopenCycle(closed(TB()), CUR, NOW)!;
    const r = canReopen(once, CUR, NOW);
    expect(!r.ok && r.reason).toBe("already-reopened");
  });

  it("refuses a record written before priorState was complete", () => {
    // Phases 2-3 wrote four of seven fields, and expectedAtCheckUSD absent
    // is genuinely ambiguous between "was never set" and "was never
    // captured". Refusing is the only honest answer for those.
    const legacy = closed(TB());
    delete (legacy.periodCloses![0].accounts[0] as { priorStateComplete?: true }).priorStateComplete;
    const r = canReopen(legacy, CUR, NOW);
    expect(!r.ok && r.reason).toBe("incomplete-record");
  });

  it("refuses a close whose stored span no longer matches today's payday", () => {
    // Phase 3's span rule reaches reopen too. The key "2026-08" denotes a
    // DIFFERENT range once payday moves, and the stored close describes the
    // old one -- so there is no close of the period the user is looking at.
    // Reported as not-closed, the same verdict the unclosed list gives:
    // this is the one axis the header note said reopen could not reach, and
    // it could, because canReopen does its own span lookup.
    const after = closed(TB());
    const moved = { ...after, cycleStartDay: 5 } as LocalFinancials;
    // Premise: the stored span really is the old one.
    const b = cycleBounds(CUR, 5);
    expect(after.periodCloses![0].rangeStart).not.toBe(localISO(b.start));
    const r = canReopen(moved, CUR, NOW);
    expect(!r.ok && r.reason).toBe("not-closed");
  });

  it("reopenCycle returns null for every refusal rather than half-applying", () => {
    expect(reopenCycle(data({ trackedBalances: [TB()] }), CUR, NOW)).toBeNull();
    const later = new Date(2026, 9, 10, 12, 0, 0);
    expect(reopenCycle(closed(TB()), CUR, later)).toBeNull();
  });
});

// ───────── 3. the record is marked, not deleted ─────────

describe("3. marking over deleting", () => {
  it("keeps the record and stamps reopenedAt", () => {
    const out = reopenCycle(closed(TB()), CUR, NOW)!;
    expect(out.periodCloses).toHaveLength(1);
    expect(out.periodCloses![0].reopenedAt).toBe(NOW.toISOString());
    // The close's own facts survive -- this is an undo, not an erasure.
    expect(out.periodCloses![0].closedAt).toBe(NOW.toISOString());
    expect(out.periodCloses![0].accounts[0].actual).toBe(430);
  });

  it("the cycle reads UNCLOSED again", () => {
    const out = reopenCycle(closed(TB()), CUR, NOW)!;
    expect(isCycleClosedBySpan(out, CUR, START_DAY).closed).toBe(false);
  });

  it("and is NOT reported as closed-under-a-different-span", () => {
    // The trap in filtering: a reopened close of the SAME span would
    // otherwise fall through to closedUnderOtherSpan and tell the user
    // "you closed a different period", which is false.
    const out = reopenCycle(closed(TB()), CUR, NOW)!;
    expect(isCycleClosedBySpan(out, CUR, START_DAY).closedUnderOtherSpan).toBeNull();
  });
});

// ───────── 4. acknowledgements ─────────

describe("4. reopening discards the cycle's acknowledgements", () => {
  const ackClosed = () => {
    const at = cycleCloseInstant(CUR, START_DAY);
    const tb = TB();
    const record = buildPeriodClose({
      cycleKey: CUR, startDay: START_DAY, closedAt: NOW, lbpRate: DEFAULT_LBP_RATE,
      accounts: [{
        tb, actual: 430, expectedAtClose: 461,
        acknowledgement: { note: "Explained.", acknowledgedAt: NOW.toISOString(), discrepancy: -31, startingAt: at },
      }],
    });
    return data({
      trackedBalances: [reanchorTrackedBalance(tb, 430, 461, DEFAULT_LBP_RATE, at)],
      periodCloses: [record],
    });
  };

  it("they stop applying, because the anchor they bound to is gone", () => {
    // ASSERTED DELIBERATELY, per the plan: the opposite -- an
    // acknowledgement outliving the close that carried it -- is defensible
    // and must not be arrived at by accident. It stops applying because
    // reopen restores the OLD startingAt, and the ack binds to the close's.
    const before = ackClosed();
    const ack = before.periodCloses![0].accounts[0].acknowledgement!;
    expect(ack.startingAt).toBe(cycleCloseInstant(CUR, START_DAY)); // premise

    const out = reopenCycle(before, CUR, NOW)!;
    expect(out.trackedBalances[0].startingAt).toBe("2026-08-01T09:00:00.000Z");
    expect(out.trackedBalances[0].startingAt).not.toBe(ack.startingAt);
  });

  it("the note survives IN THE RECORD as history, and that is the distinction", () => {
    // Discarded means "no longer applies to the account", not "erased".
    // Marking over deleting is what makes both true at once.
    const out = reopenCycle(ackClosed(), CUR, NOW)!;
    expect(out.periodCloses![0].accounts[0].acknowledgement!.note).toBe("Explained.");
    expect(out.periodCloses![0].reopenedAt).toBeTruthy();
  });
});

// ───────── 5. backwards-recorded accounts ─────────

describe("5. a recorded-but-not-reanchored account restores as a no-op", () => {
  /** Phase 3's case: baseline already newer than the cycle end, so the close left it alone. */
  const backwardsClosed = () => {
    const tb = TB({ startingAt: "2026-10-20T09:00:00.000Z", startingDate: "2026-10-20" });
    const record = buildPeriodClose({
      cycleKey: CUR, startDay: START_DAY, closedAt: NOW, lbpRate: DEFAULT_LBP_RATE,
      accounts: [{ tb, actual: 400, expectedAtClose: 400 }],
    });
    return { tb, d: data({ trackedBalances: [tb], periodCloses: [record] }) };
  };

  it("priorState really does equal current state -- confirmed, not assumed", () => {
    const { tb, d } = backwardsClosed();
    const ps = d.periodCloses![0].accounts[0].priorState;
    expect(ps.startingBalance).toBe(tb.startingBalance);
    expect(ps.startingAt).toBe(tb.startingAt);
    expect(ps.expectedAtCheckUSD).toBe(tb.expectedAtCheckUSD);
  });

  it("the row comes back by REFERENCE, not rebuilt equal", () => {
    // TrackedBalance has no updatedAt, so nothing can be stamped -- the
    // testable property is identity. A gratuitous .map() rebuild would pass
    // a toEqual and fail this.
    const { d } = backwardsClosed();
    const out = reopenCycle(d, CUR, NOW)!;
    expect(out.trackedBalances[0]).toBe(d.trackedBalances[0]);
  });

  it("a close that changes ONLY the optionals is still a real change", () => {
    // The no-op shortcut must not be decided on startingBalance and
    // startingDate alone. reanchorTrackedBalance sets startingBalance to
    // the actual and startingDate to the close instant's local day, so an
    // account that matched EXACTLY and whose baseline already sat on the
    // cycle's last day comes out of the close with that pair unchanged --
    // while startingAt, actualBalanceDate and expectedAtCheckUSD all moved.
    // Reopen still has work to do, and returning the row by reference here
    // would silently strand the close's values.
    const b = cycleBounds(CUR, START_DAY);
    const lastDay = localISO(new Date(b.end.getTime() - 1));
    const before = TB({ startingBalance: 430, startingDate: lastDay });
    const after = closed(before, 430, 461);

    const reanchored = after.trackedBalances[0];
    // premise: the pair really is unchanged, the optionals really did move
    expect(reanchored.startingBalance).toBe(before.startingBalance);
    expect(reanchored.startingDate).toBe(before.startingDate);
    expect(reanchored.expectedAtCheckUSD).not.toBe(before.expectedAtCheckUSD);
    expect(reanchored.startingAt).not.toBe(before.startingAt);

    const out = reopenCycle(after, CUR, NOW)!.trackedBalances[0];
    expect(out).not.toBe(reanchored);
    expect(out).toEqual(before);
  });
});
// ───────── 6. an account deleted between close and reopen ─────────

describe("6. accounts outside the close", () => {
  it("an account opened AFTER the close is left alone, by reference", () => {
    // The close names the accounts it touched. A row it never saw has no
    // priorState to restore, and writing one from its own current values
    // would be a no-op only by luck -- the testable property is that reopen
    // does not rebuild it at all.
    const after = closed(TB());
    const fresh = TB({ id: "tb2", name: "New card", startingBalance: 90, startingDate: "2026-09-09" });
    const withNew = { ...after, trackedBalances: [...after.trackedBalances!, fresh] } as LocalFinancials;
    // Premise: the close really does not mention it.
    expect(withNew.periodCloses![0].accounts.map((a) => a.trackedBalanceId)).not.toContain("tb2");
    const out = reopenCycle(withNew, CUR, NOW)!;
    expect(out.trackedBalances![1]).toBe(fresh);
  });
});

describe("6. a deleted account is not resurrected", () => {
  it("restore writes nothing for a row that no longer exists", () => {
    const after = closed(TB());
    const withoutIt = { ...after, trackedBalances: [] } as LocalFinancials;
    const out = reopenCycle(withoutIt, CUR, NOW)!;
    expect(out.trackedBalances).toEqual([]);
    // ...and the reopen still happened, so the cycle is unclosed again.
    expect(isCycleClosedBySpan(out, CUR, START_DAY).closed).toBe(false);
  });
});
