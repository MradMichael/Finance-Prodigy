// DI-15: a conflict merge reached the server but this device couldn't store
// it. The device still holds its pre-merge copy, so nothing may say it holds
// the merged one:
// - the sync record (plan H 5b) was written at the push, so the next merge
//   read every record the other device had changed as this device's own
//   edit, kept it with no clock compared and no notice, and pushed it;
// - the sync time was written at the pull and the push, so the next plain
//   push landed without a conflict and overwrote the merged copy outright.
// Now the conflict merge records neither; the caller records both once the
// merged copy is stored. When the store fails, both stay as they were (owner,
// session 8): the previous record still describes the copy this device holds,
// so the next merge takes the other device's changes, with nothing to
// announce. (Session 7 dropped the record instead; that made the next merge a
// first merge that kept this device's copy and said what may differ.)
//
// The fake server below applies the real push rule (server/src/routes/
// sync.ts): a push whose baseSyncedAt is older than the server's copy is a
// 409 stale_push; a missing one is accepted.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const SESSION = { userId: "u1", email: "u1@example.com", name: "U One" };
vi.mock("./auth", () => ({ getRecoveryTokenForSync: vi.fn(async () => undefined), getSession: () => SESSION }));

import { pushToServer, mergeAndPush, getLastSyncTime, recordMergeStored } from "./syncService";
import { loadSeen, saveSeen, seenOf } from "./syncSeen";
import { activateSessionKey } from "./crypto";
import { DEFAULT_DATA, type LocalFinancials, type StoredGoal } from "./localData";

const SEEN = "essa_seen_u1";
const LAST_SYNC = "essa_last_sync_u1"; // DI-16: this account's own sync time (the old shared key is no account's, session 9)
const goal = (o: Partial<StoredGoal> = {}): StoredGoal => ({
  id: "g1", name: "Laptop", emoji: "💻", targetAmount: 1200, currentAmount: 0, openingAmount: 100, currency: "USD", targetDate: "2027-03-01",
  createdAt: "2026-05-01T09:00:00.000Z", updatedAt: "2026-10-01T09:00:00.000Z", ...o,
});
const on = { syncChoice: { enabled: true, decidedAt: "2026-09-28T12:00:00.000Z" } };
const data = (o: Partial<LocalFinancials> = {}) => ({ ...DEFAULT_DATA, ...on, income: 3150.75, goals: [goal()], ...o }) as LocalFinancials;

// The server's state, and every push it was sent.
let server: { data: LocalFinancials; syncedAt: string };
let clock = 0;
const pushes: { base?: string; data: LocalFinancials; status: number }[] = [];
const T = (n: number) => new Date(Date.UTC(2026, 9, 8, 9, n)).toISOString();

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  sessionStorage.setItem("essa_st_v1", "tok");
  activateSessionKey(new Uint8Array(32).fill(7));
  clock = 10;
  pushes.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    if (url === "/api/sync/pull") return new Response(JSON.stringify({ ok: true, data: server.data, syncedAt: server.syncedAt }), { status: 200 });
    const body = JSON.parse(String(init.body)) as { data: LocalFinancials; baseSyncedAt?: string };
    if (body.baseSyncedAt && new Date(body.baseSyncedAt) < new Date(server.syncedAt)) {
      pushes.push({ base: body.baseSyncedAt, data: body.data, status: 409 });
      return new Response(JSON.stringify({ code: "stale_push", error: "moved on" }), { status: 409 });
    }
    server = { data: body.data, syncedAt: T(++clock) };
    pushes.push({ base: body.baseSyncedAt, data: body.data, status: 200 });
    return new Response(JSON.stringify({ ok: true, syncedAt: server.syncedAt }), { status: 200 });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/**
 * This device last synced at T(1), holding data(); the other device has
 * since renamed the goal ("MacBook", T(5)). This device then makes an edit
 * of its own (income), and its push meets the conflict.
 */
async function setUp() {
  const base = data();
  await saveSeen("u1", base);
  localStorage.setItem(LAST_SYNC, T(1));
  server = { data: data({ goals: [goal({ name: "MacBook", updatedAt: "2026-10-07T09:00:00.000Z" })] }), syncedAt: T(5) };
  return data({ income: 3300 }); // this device's copy
}

describe("reproduced: the merge reached the server, and this device never stored it", () => {
  // No store, no record call: exactly what a device whose store threw is left with.
  async function notStored() {
    const mine = await setUp();
    const r = await mergeAndPush("u1@example.com", mine);
    if (!r.ok) throw new Error("expected a merge");
    expect(r.mergedData.goals[0].name).toBe("MacBook"); // the server now holds the other device's rename
    return mine;
  }

  it("the next merge doesn't read the rename as this device's own edit and revert it", async () => {
    const mine = await notStored();
    const again = await mergeAndPush("u1@example.com", mine);
    if (!again.ok) throw new Error("expected a merge");
    expect(again.mergedData.goals[0].name).toBe("MacBook");
    expect(server.data.goals[0].name).toBe("MacBook");
  });

  it("the next plain push is refused as stale instead of overwriting the merged copy", async () => {
    const mine = await notStored();
    const r = await pushToServer("u1@example.com", { ...mine, income: 3400 });
    expect(r.ok).toBe(false);
    expect(r.conflict).toBe(true);
    expect(server.data.goals[0].name).toBe("MacBook");
  });
});

describe("the conflict merge records nothing itself", () => {
  it("neither the sync record nor the sync time moves at the merge's pull or push", async () => {
    const mine = await setUp();
    const before = await loadSeen("u1");
    const r = await mergeAndPush("u1@example.com", mine);
    expect(r.ok).toBe(true);
    expect(pushes.map((p) => p.status)).toEqual([200]); // the merge's own push still lands
    expect(await loadSeen("u1")).toEqual(before);
    expect(getLastSyncTime()).toBe(T(1));
  });

  it("the merge's push is based on the copy it pulled, so it isn't refused as stale", async () => {
    const mine = await setUp();
    await mergeAndPush("u1@example.com", mine);
    expect(pushes[0].base).toBe(T(5));
  });

  it("once the merged copy is stored, recording it writes both", async () => {
    const mine = await setUp();
    const r = await mergeAndPush("u1@example.com", mine);
    if (!r.ok) throw new Error("expected a merge");
    await recordMergeStored("u1", r);
    expect(await loadSeen("u1")).toEqual(seenOf(r.mergedData));
    expect(getLastSyncTime()).toBe(r.syncedAt);
  });
});

describe("the caller's store failed (owner, session 8: keep the previous record)", () => {
  // The caller does nothing to the record: it still describes the copy this
  // device holds, the one it last synced, so the next merge reads it right.
  async function failedStore() {
    const mine = await setUp();
    const before = await loadSeen("u1");
    const r = await mergeAndPush("u1@example.com", mine);
    if (!r.ok) throw new Error("expected a merge");
    return { mine, before };
  }

  it("keeps the previous sync record, and the sync time at the last sync this device holds", async () => {
    const { before } = await failedStore();
    expect(before).not.toBeNull();
    expect(localStorage.getItem(SEEN)).not.toBeNull(); // still stored, not just held
    expect(await loadSeen("u1")).toEqual(before);
    expect(getLastSyncTime()).toBe(T(1));
  });

  it("the next merge takes the other device's rename, with nothing to announce: not a first merge, not a clash", async () => {
    const { mine } = await failedStore();
    const again = await mergeAndPush("u1@example.com", mine);
    if (!again.ok) throw new Error("expected a merge");
    expect(again.mergedData.goals[0].name).toBe("MacBook");
    expect(again.mergedData.income).toBe(3300); // this device's own edit still stands
    expect(again.firstSync).toBe(false);
    expect(again.nonTransactionDivergence).toEqual([]);
    expect(again.clashes).toEqual([]);
  });
});

describe("unchanged", () => {
  it("a plain push still records the sync time and what it pushed", async () => {
    server = { data: data(), syncedAt: T(1) };
    localStorage.setItem(LAST_SYNC, T(1));
    const mine = data({ income: 3300 });
    const r = await pushToServer("u1@example.com", mine);
    expect(r.ok).toBe(true);
    expect(getLastSyncTime()).toBe(r.syncedAt);
    expect(await loadSeen("u1")).toEqual(seenOf(mine));
  });
});
