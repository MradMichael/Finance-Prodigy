// Fix B (2.4.144) — a reopen never moves a baseline backwards.
//
// Phase 4's reopen restored `priorState` for every account the close
// touched. It asked "what did the close overwrite?" and never "what has
// happened SINCE?" — so an account checked in after the close would have its
// newer, better observation rolled back to the pre-close anchor. Reached for
// real on the owner's first close (export 2026-09-28): five of six accounts
// were checked in minutes after the close, and a reopen would have put all
// five back to anchors from 14 Sep and 26 Aug.
//
// THE RULE, carried over from Phase 3's no-backwards-reanchor: a later
// observation beats the one being undone, so a reopen LEAVES STANDING any
// account re-anchored since the close, and restores only the untouched ones.
// The same holds for the ledger half: a close's EF/debt correction row is
// left standing if a later correction for the same account was computed on
// top of it.
//
// DETECTION compares instants to instants (rule 18, tell one). `startingAt`
// is a UTC instant; `startingDate` is a local day and is never compared to
// one — that string comparison is what broke 2.4.65. Correction rows are
// ordered by `createdAt` (an instant), not `date` (a local day that ties).
//
// FIGURES: real-account amounts, not round numbers (2.4.139).
//
// WHICH AXES THESE FIXTURES CANNOT REACH (2.4.116):
//   * the owner's actual record. The sequence is modelled; their anchors are not.
//   * a legacy record reopened on a device in a different timezone. The
//     derived anchor would then differ from the one written, so the account
//     reads as re-anchored and is LEFT STANDING — the safe direction (never a
//     rollback). Named, not faked; `anchoredAt` is stored from now on so new
//     records cannot hit it.
//   * a payday change between close and reopen. The span rule makes such a
//     cycle read unclosed, so reopen is unreachable there.
import { describe, it, expect } from "vitest";
import {
  DEFAULT_DATA, DEFAULT_LBP_RATE, buildPeriodClose, reanchorTrackedBalance, reopenCycle, planReopen,
  planEfClose, derivedEfBalance, buildEfAdjustmentTx, toUSD,
  type LocalFinancials, type TrackedBalance, type StoredTransaction,
} from "./localData";
import { asCycleKey, cycleCloseInstant } from "./period";

const START_DAY = 27;
const NOW = new Date(2026, 8, 10, 12, 0, 0);         // inside 2026-08 (27 Aug – 26 Sep)
const CUR = asCycleKey("2026-08");
const AT = cycleCloseInstant(CUR, START_DAY);        // what a close writes as startingAt
const LATER = "2026-09-10T11:48:30.000Z";            // a check-in after the close

const TB = (id: string, over: Partial<TrackedBalance> = {}): TrackedBalance => ({
  id, name: id, paymentMethod: "card", cardId: id,
  startingBalance: 612.4, startingDate: "2026-08-14", startingAt: "2026-08-14T07:12:00.000Z",
  actualBalance: 612.4, actualBalanceDate: "2026-08-14T07:12:00.000Z",
  expectedAtCheckUSD: 598.15, currency: "USD", ...over,
});

const data = (over: Partial<LocalFinancials>): LocalFinancials =>
  ({ ...DEFAULT_DATA, income: 3000, cycleStartDay: START_DAY, transactions: [], ...over } as LocalFinancials);

/** Close both accounts exactly as the screen does, optionally recording anchoredAt. */
function closeBoth(storeAnchor: boolean) {
  const a = TB("visa"), b = TB("cash", { paymentMethod: "cash", cardId: undefined, startingBalance: 83.25 });
  const entry = (tb: TrackedBalance, actual: number, expectedAtClose: number) => ({
    tb, actual, actualUSD: toUSD(actual, tb.currency, DEFAULT_LBP_RATE), expectedAtClose,
    ...(storeAnchor ? { anchoredAt: AT } : {}),
  });
  const record = buildPeriodClose({
    cycleKey: CUR, startDay: START_DAY, closedAt: NOW, lbpRate: DEFAULT_LBP_RATE,
    accounts: [entry(a, 540.8, 571.35), entry(b, 61.9, 74.6)],
  });
  const closed = data({
    trackedBalances: [
      reanchorTrackedBalance(a, 540.8, 571.35, DEFAULT_LBP_RATE, AT),
      reanchorTrackedBalance(b, 61.9, 74.6, DEFAULT_LBP_RATE, AT),
    ],
    periodCloses: [record],
  });
  return { a, b, closed };
}

/** The owner's sequence: close, then check in ONE account afterwards. */
function closeThenCheckInVisa(storeAnchor = true) {
  const { a, b, closed } = closeBoth(storeAnchor);
  const visaAfterClose = closed.trackedBalances![0];
  const visaChecked = reanchorTrackedBalance(visaAfterClose, 505.35, 540.8, DEFAULT_LBP_RATE, LATER);
  const after = { ...closed, trackedBalances: [visaChecked, closed.trackedBalances![1]] } as LocalFinancials;
  return { a, b, after, visaChecked };
}

// ───────── 1. the case reached for real ─────────

describe("1. a reopen after a later check-in leaves that account standing", () => {
  it("the premise: the check-in really did move the account's anchor past the close's", () => {
    const { visaChecked } = closeThenCheckInVisa();
    expect(visaChecked.startingAt).toBe(LATER);
    expect(visaChecked.startingAt).not.toBe(AT);
  });

  it("the checked-in account keeps its newer figure — by reference", () => {
    const { after, visaChecked } = closeThenCheckInVisa();
    const out = reopenCycle(after, CUR, NOW)!;
    expect(out.trackedBalances![0]).toBe(visaChecked);
    expect(out.trackedBalances![0].startingBalance).toBe(505.35);
  });

  it("the untouched account is restored exactly to its pre-close state", () => {
    const { b, after } = closeThenCheckInVisa();
    const out = reopenCycle(after, CUR, NOW)!;
    expect(out.trackedBalances![1]).toEqual(b);
  });

  it("the reopen still happens: the record is marked, not refused", () => {
    // Partial reopen, deliberately. Refusing the whole thing would stop the
    // owner getting back the account the wrong-cycle close hurt most.
    const { after } = closeThenCheckInVisa();
    const out = reopenCycle(after, CUR, NOW)!;
    expect(out.periodCloses![0].reopenedAt).toBeTruthy();
  });

  it("planReopen names what will be left standing, for the confirm copy", () => {
    const { after } = closeThenCheckInVisa();
    const plan = planReopen(after, CUR, NOW)!;
    expect(plan.keptTrackedIds).toEqual(["visa"]);
    expect(plan.restoredTrackedIds).toEqual(["cash"]);
  });

  it("with nobody checked in since, every account is restored (Phase 4 unchanged)", () => {
    const { a, b, closed } = closeBoth(true);
    const out = reopenCycle(closed, CUR, NOW)!;
    expect(out.trackedBalances).toEqual([a, b]);
    expect(planReopen(closed, CUR, NOW)!.keptTrackedIds).toEqual([]);
  });
});

// ───────── 2. anchoredAt stored, and the legacy derivation ─────────

describe("2. the anchor the close wrote", () => {
  it("is stored on new records, so detection never has to reconstruct it", () => {
    const { closed } = closeBoth(true);
    expect(closed.periodCloses![0].accounts[0].anchoredAt).toBe(AT);
  });

  it("a record written before anchoredAt existed is detected by derivation", () => {
    // Phases 2–5a records carry no anchoredAt. The close wrote
    // cycleCloseInstant(cycleKey, startDayAtClose) — the payday stored ON
    // the record, not today's — so the same instant is derived.
    const { after, visaChecked, b } = closeThenCheckInVisa(false);
    expect(after.periodCloses![0].accounts[0].anchoredAt).toBeUndefined();
    const out = reopenCycle(after, CUR, NOW)!;
    expect(out.trackedBalances![0]).toBe(visaChecked);
    expect(out.trackedBalances![1]).toEqual(b);
  });
});

// ───────── 3. the ledger half ─────────

describe("3. a close's correction row is left standing if a later one was built on it", () => {
  const efData = (): LocalFinancials => data({
    emergencyFundOpeningBalance: 2_400,
    transactions: [{ id: "e1", amount: 0, currency: "USD", bucket: "SAVINGS", description: "x",
      date: "2026-08-20", paymentMethod: "other", efAmount: 175.5, createdAt: "2026-08-20T08:00:00.000Z" } as StoredTransaction],
  });

  function closedWithEfRow() {
    const base = efData();
    const ef = planEfClose(base, 2_530.75);                       // derived 2,575.50 -> -44.75
    const row = { ...ef.transaction!, createdAt: "2026-09-10T09:47:51.648Z" };
    const record = buildPeriodClose({
      cycleKey: CUR, startDay: START_DAY, closedAt: NOW, lbpRate: DEFAULT_LBP_RATE,
      accounts: [], emergencyFund: { ...ef.entry, transactionId: row.id },
    });
    return { base, row, closed: { ...base, transactions: [row, ...base.transactions], periodCloses: [record] } as LocalFinancials };
  }

  it("with no later correction, the close's row is removed (Phase 5a unchanged)", () => {
    const { closed } = closedWithEfRow();
    expect(derivedEfBalance(reopenCycle(closed, CUR, NOW)!)).toBe(2_575.5);
  });

  // DI-13 follow-up (session 4): the row is soft-deleted through softDelete,
  // so it carries the current restore generation, and a restore's revival of
  // it at that generation can't beat this later deletion.
  it("the removed row carries the current restore generation", () => {
    const { closed, row } = closedWithEfRow();
    const out = reopenCycle({ ...closed, revivedKeys: { transactions: { [row.id]: 2 } } }, CUR, NOW)!;
    const removed = out.transactions!.find((t) => t.id === row.id)!;
    expect(removed.deletedAt).toBeTruthy();
    expect(removed.deletedGen).toBe(2);
  });

  it("a later Setup correction keeps the close's row, so the owner's latest figure stands", () => {
    // 2.4.145's exact sequence: the fund is stated at the close, then
    // corrected from Setup twenty minutes later. That later delta was
    // computed against a balance INCLUDING the close's row — removing it
    // would move the fund away from the figure stated most recently.
    const { closed, row } = closedWithEfRow();
    const later = { ...buildEfAdjustmentTx(38.2), createdAt: "2026-09-10T10:07:13.457Z" };
    const withLater = { ...closed, transactions: [later, ...closed.transactions] } as LocalFinancials;
    const stated = derivedEfBalance(withLater);                   // 2,568.95
    expect(stated).toBe(2_568.95);

    const out = reopenCycle(withLater, CUR, NOW)!;
    expect(derivedEfBalance(out)).toBe(stated);
    expect(out.transactions!.find((t) => t.id === row.id)!.deletedAt).toBeUndefined();
    expect(planReopen(withLater, CUR, NOW)!.keptTransactionIds).toEqual([row.id]);
  });

  it("a later ordinary contribution does NOT keep the row — it was not computed from it", () => {
    // Only a CORRECTION depends on the balance it was stated against. A
    // contribution just adds, whatever the balance was.
    const { closed } = closedWithEfRow();
    // A debt payment partly drawn from the fund: amount > 0, efAmount set.
    const payment = { id: "e10", amount: 60, currency: "USD", bucket: "NEEDS", description: "x",
      date: "2026-09-12", paymentMethod: "other", efAmount: -60, createdAt: "2026-09-12T08:30:00.000Z" } as StoredTransaction;
    const withIt = { ...closed, transactions: [payment, ...closed.transactions] } as LocalFinancials;
    expect(planReopen(withIt, CUR, NOW)!.keptTransactionIds).toEqual([]);
  });
});
