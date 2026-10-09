// NEW FINDING (session 8): the sync time, `essa_last_sync`, was one value for
// the whole browser, not one per account. A push sends it as its
// baseSyncedAt, and the server refuses a push based on an older copy than it
// holds (409 stale_push, then the conflict merge). After account A synced on
// this device, account B's next push carried A's time. A's time is newer than
// B's server copy, so the server took B's push without a conflict, and B's
// stale local copy overwrote what B's other device had pushed.
//
// Now each account has its own sync time. The old browser-wide value moves to
// the account signed in when the new code first reads it, and to no other.
//
// The fake server below applies the real push rule (server/src/routes/
// sync.ts): a push whose baseSyncedAt is older than the copy it holds is a
// 409; a missing one is accepted.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const A = { userId: "ua", email: "a@example.com", name: "A" };
const B = { userId: "ub", email: "b@example.com", name: "B" };
let session: typeof A | null = null;
vi.mock("./auth", () => ({ getRecoveryTokenForSync: vi.fn(async () => undefined), getSession: () => session }));

import { pushToServer, pullFromServer, getLastSyncTime, recordMergeStored } from "./syncService";
import { activateSessionKey } from "./crypto";
import { DEFAULT_DATA, type LocalFinancials, type StoredGoal } from "./localData";

const goal = (name: string): StoredGoal => ({
  id: "g1", name, emoji: "💻", targetAmount: 1200, currentAmount: 0, openingAmount: 100, currency: "USD", targetDate: "2027-03-01",
  createdAt: "2026-05-01T09:00:00.000Z", updatedAt: "2026-10-01T09:00:00.000Z",
});
const on = { syncChoice: { enabled: true, decidedAt: "2026-09-28T12:00:00.000Z" } };
const data = (name: string, income = 3000) => ({ ...DEFAULT_DATA, ...on, income, goals: [goal(name)] }) as LocalFinancials;

// One server copy per address, and one clock for the whole server.
let servers: Record<string, { data: LocalFinancials; syncedAt: string }>;
let clock = 0;
const T = (n: number) => new Date(Date.UTC(2026, 9, 8, 9, n)).toISOString();

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  sessionStorage.setItem("essa_st_v1", "tok");
  activateSessionKey(new Uint8Array(32).fill(7));
  servers = {}; clock = 0; session = null;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { email: string; data?: LocalFinancials; baseSyncedAt?: string };
    const copy = servers[body.email];
    if (url === "/api/sync/pull") {
      if (!copy) return new Response(JSON.stringify({ error: "No sync data found" }), { status: 404 });
      return new Response(JSON.stringify({ ok: true, data: copy.data, syncedAt: copy.syncedAt }), { status: 200 });
    }
    if (copy && body.baseSyncedAt && new Date(body.baseSyncedAt) < new Date(copy.syncedAt)) {
      return new Response(JSON.stringify({ code: "stale_push", error: "moved on" }), { status: 409 });
    }
    servers[body.email] = { data: body.data!, syncedAt: T(++clock) };
    return new Response(JSON.stringify({ ok: true, syncedAt: servers[body.email].syncedAt }), { status: 200 });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/** B syncs here; B's other device renames the goal; A then syncs here; B signs back in (a local sign-in: no pull). */
async function twoAccountsOneDevice() {
  session = B;
  expect((await pushToServer(B.email, data("Laptop"))).ok).toBe(true); // B's last sync on this device
  servers[B.email] = { data: data("MacBook"), syncedAt: T(++clock) }; // B's other device, later
  session = A;
  expect((await pushToServer(A.email, data("Camera", 5000))).ok).toBe(true); // A syncs, later still
  session = B;
}

describe("reproduced: one account's sync time used for another's push", () => {
  it("B's next push from this device meets the conflict instead of overwriting B's server copy", async () => {
    await twoAccountsOneDevice();
    const r = await pushToServer(B.email, data("Laptop", 3100)); // B's stale local copy, plus an edit
    expect(r.ok).toBe(false);
    expect(r.conflict).toBe(true);
    expect(servers[B.email].data.goals[0].name).toBe("MacBook");
  });

  it("each account reads its own sync time", async () => {
    await twoAccountsOneDevice();
    expect(getLastSyncTime()).toBe(T(1)); // B's, from B's own push
    session = A;
    expect(getLastSyncTime()).toBe(T(3));
  });
});

describe("one sync time per account", () => {
  it("a pull records the time for the account signed in, and only for it", async () => {
    servers[B.email] = { data: data("Laptop"), syncedAt: T(7) };
    session = B;
    expect((await pullFromServer(B.email)).ok).toBe(true);
    expect(getLastSyncTime()).toBe(T(7));
    session = A;
    expect(getLastSyncTime()).toBeNull();
  });

  it("with nobody signed in, nothing is recorded and nothing is read", async () => {
    servers[B.email] = { data: data("Laptop"), syncedAt: T(7) };
    expect((await pullFromServer(B.email)).ok).toBe(true);
    expect(getLastSyncTime()).toBeNull();
    session = B;
    expect(getLastSyncTime()).toBeNull();
  });

  it("a push or pull for an address other than the signed-in account's records nothing under the signed-in account", async () => {
    servers[B.email] = { data: data("Laptop"), syncedAt: T(7) };
    session = A;
    expect((await pullFromServer(B.email)).ok).toBe(true);
    expect(getLastSyncTime()).toBeNull();
  });
  it("a stored conflict merge records its time for that account only (DI-15's recordMergeStored)", async () => {
    session = B;
    await recordMergeStored(B.userId, { syncedAt: T(9), mergedData: data("MacBook") });
    // The keys themselves, before any read (a read would move an old-key value across).
    expect(localStorage.getItem("essa_last_sync_ub")).toBe(T(9));
    expect(localStorage.getItem("essa_last_sync")).toBeNull();
    expect(getLastSyncTime()).toBe(T(9));
    session = A;
    expect(getLastSyncTime()).toBeNull();
  });
});

describe("migration of the old browser-wide value", () => {
  it("moves to the account signed in when it's first read, and the old key is removed", () => {
    localStorage.setItem("essa_last_sync", T(4));
    session = B;
    expect(getLastSyncTime()).toBe(T(4));
    expect(localStorage.getItem("essa_last_sync")).toBeNull();
    expect(getLastSyncTime()).toBe(T(4));
  });

  it("goes to that account only: another account signed in later starts without one", () => {
    localStorage.setItem("essa_last_sync", T(4));
    session = B;
    getLastSyncTime();
    session = A;
    expect(getLastSyncTime()).toBeNull();
  });

  it("reading another account's time (the admin page's rows) doesn't take the old value", () => {
    localStorage.setItem("essa_last_sync", T(4));
    session = B;
    expect(getLastSyncTime("ua")).toBeNull();
    expect(localStorage.getItem("essa_last_sync")).toBe(T(4)); // still there, for B
    expect(getLastSyncTime()).toBe(T(4));
  });

  it("an account that already has its own time keeps it; the old value is left for no one", () => {
    session = A;
    localStorage.setItem("essa_last_sync_ua", T(6));
    localStorage.setItem("essa_last_sync", T(4));
    expect(getLastSyncTime()).toBe(T(6));
  });
});
