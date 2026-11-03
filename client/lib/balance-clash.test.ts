// Session 38 (the sync proof), HELD for the owner's words: a tracked balance
// both devices checked in since their last sync. The later check-in is kept,
// as before (SYNC-1 step 2); now the merge also records it, so each device
// says it once, the one whose check-in was overridden included (plan H 5d).
//
// Its records live in their own field, balanceClashRecords: older code words
// every clashRecords entry and has no noun for a tracked balance (the reason
// transactions' records are kept apart). Which side changed is judged against
// the device's record of its last sync, as the rule judges everything else, so
// a check-in on one device only is no clash. A record from before tracked
// balances were in it names none.
import { describe, it, expect, beforeEach } from "vitest";
import { DEFAULT_DATA, reanchorTrackedBalance, type LocalFinancials, type TrackedBalance } from "./localData";
import { mergeFinancials } from "./syncMerge";
import { seenOf } from "./syncSeen";
import { takeUnseenClashes } from "./clashNotice";
import { clashSentence } from "./syncService";
import { activateSessionKey } from "./crypto";

const T0 = new Date("2026-10-08T12:00:00.000Z");
const WALLET: TrackedBalance = { id: "tb1", name: "Wallet", paymentMethod: "cash", startingBalance: 200, startingDate: "2026-10-01", currency: "USD" };
const base = (o: Partial<LocalFinancials> = {}) => ({ ...DEFAULT_DATA, income: 3000, trackedBalances: [WALLET], ...o }) as LocalFinancials;
const BASE = base();
const checkIn = (amount: number, at: string) => base({ trackedBalances: [reanchorTrackedBalance(WALLET, amount, undefined, 89_500, at)] });
const PHONE = checkIn(181, "2026-10-08T10:00:00.000Z"); // the earlier check-in
const LAPTOP = checkIn(182, "2026-10-08T11:00:00.000Z"); // the later one

beforeEach(() => { localStorage.clear(); activateSessionKey(new Uint8Array(32).fill(7)); });

describe("a tracked balance both devices checked in", () => {
  it("keeps the later check-in, as before, and records the clash: its id, its name, the later change", () => {
    const r = mergeFinancials(PHONE, LAPTOP, T0, seenOf(BASE));
    expect(r.data.trackedBalances).toEqual(LAPTOP.trackedBalances);
    expect(r.data.balanceClashRecords).toEqual([{ id: expect.any(String), at: T0.toISOString(), key: "tb1", kind: "trackedBalance", name: "Wallet", later: true }]);
    expect(r.clashes).toEqual([{ kind: "trackedBalance", name: "Wallet", later: true }]);
    expect(r.data.clashRecords).toBeUndefined(); // not where older code words every entry
  });

  it("the same clash from either device is one record", () => {
    const one = mergeFinancials(PHONE, LAPTOP, T0, seenOf(BASE)).data;
    const two = mergeFinancials(LAPTOP, PHONE, new Date(T0.getTime() + 60_000), seenOf(BASE)).data;
    expect(one.balanceClashRecords![0].id).toBe(two.balanceClashRecords![0].id);
    expect(mergeFinancials(one, two, T0, seenOf(one)).data.balanceClashRecords).toHaveLength(1);
  });

  it("a check-in on one device only is no clash", () => {
    const r = mergeFinancials(BASE, LAPTOP, T0, seenOf(BASE));
    expect(r.data.trackedBalances).toEqual(LAPTOP.trackedBalances);
    expect(r.data.balanceClashRecords ?? []).toEqual([]);
    expect(r.clashes).toEqual([]);
  });

  it("a record of the last sync from before tracked balances were in it names no clash", () => {
    const older = seenOf(BASE);
    delete older.kinds.trackedBalances;
    expect(mergeFinancials(PHONE, LAPTOP, T0, older).data.balanceClashRecords ?? []).toEqual([]);
  });

  it("is shown once on each device that holds the record", async () => {
    const merged = mergeFinancials(PHONE, LAPTOP, T0, seenOf(BASE)).data;
    expect((await takeUnseenClashes("u1", merged, T0)).map((c) => c.kind)).toEqual(["trackedBalance"]);
    expect(await takeUnseenClashes("u1", merged, T0)).toEqual([]);
  });
});

describe("its sentences, the approved ones with the noun drafted for it (HELD)", () => {
  it("the later check-in", () => {
    expect(clashSentence({ kind: "trackedBalance", name: "Wallet", later: true })).toBe('Both devices changed the tracked balance "Wallet" — kept the later change.');
  });
  it("neither later", () => {
    expect(clashSentence({ kind: "trackedBalance", name: "Wallet", later: false })).toBe('Your devices had different versions of the tracked balance "Wallet" — ESSA kept one of them.');
  });
});
