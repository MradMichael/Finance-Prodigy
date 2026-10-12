// Session 18, item 1 (found while planning foreign-cash model 2): a server
// copy pulled for a merge was merged as it arrived, unmigrated. A plain pull
// is migrated (saveData), but the two merges (fetchAndMerge, mergeAndPush)
// took `json.data` raw, and the merged copy carries this device's version, so
// no later load ever migrates what came from the older copy.
//
// Reproduced with a v6 copy (before plan H 5a): a goal added on a device still
// on older code has no openingAmount, so merged in raw its progress reads the
// stored total forever and ignores every contribution made afterwards.
//
// Now an OLDER copy is migrated before it's merged, and it's also what the
// record of the last sync is taken from (`serverCopy`). A copy at this code's
// version is merged exactly as it arrives; a newer one is still refused.
import { it, expect, vi, beforeEach, afterEach } from "vitest";
vi.mock("./auth", () => ({ getRecoveryTokenForSync: vi.fn(async () => undefined), getSession: () => ({ userId: "u1", email: "u1@example.com", name: "U One" }) }));
import { fetchAndMerge, mergeAndPush } from "./syncService";
import { activateSessionKey } from "./crypto";
import { saveSeen } from "./syncSeen";
import { CURRENT_SCHEMA_VERSION, DEFAULT_DATA, goalProgress, type LocalFinancials, type StoredGoal, type StoredTransaction } from "./localData";

const on = { syncChoice: { enabled: true, decidedAt: "2026-09-28T12:00:00.000Z" } };
// Added on the other device, on older code: no openingAmount.
const CAR = { id: "g-car", name: "Car", emoji: "🚗", targetAmount: 5000, currentAmount: 500, currency: "USD", targetDate: "2027-06-01", createdAt: "2026-09-01T09:00:00.000Z", updatedAt: "2026-09-01T09:00:00.000Z" } as StoredGoal;
const CONTRIBUTION = { id: "c1", amount: 100, currency: "USD", bucket: "SAVINGS", description: "Car fund", date: "2026-10-10", goalId: "g-car", createdAt: "2026-10-10T09:00:00.000Z", updatedAt: "2026-10-10T09:00:00.000Z" } as StoredTransaction;
const local = () => ({ ...DEFAULT_DATA, ...on, income: 3150.75 }) as LocalFinancials;

let serverData: LocalFinancials;
const pushed: LocalFinancials[] = [];
// This device has synced before (a record of the last sync, holding no goals),
// so goals merge under the fingerprint rule and the other device's goal arrives.
beforeEach(async () => {
  localStorage.clear(); sessionStorage.clear();
  sessionStorage.setItem("essa_st_v1", "tok");
  activateSessionKey(new Uint8Array(32).fill(7));
  pushed.length = 0;
  await saveSeen("u1", local());
  localStorage.setItem("essa_last_sync_u1", "2026-10-10T09:00:00.000Z");
  serverData = { ...DEFAULT_DATA, ...on, income: 3150.75, schemaVersion: 6, goals: [CAR] } as LocalFinancials;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    if (url === "/api/sync/pull") return new Response(JSON.stringify({ ok: true, data: serverData, syncedAt: "2026-10-11T09:00:00.000Z", hasRecoveryCode: true }), { status: 200 });
    pushed.push((JSON.parse(String(init.body)) as { data: LocalFinancials }).data);
    return new Response(JSON.stringify({ ok: true, syncedAt: "2026-10-12T09:00:00.000Z" }), { status: 200 });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const progressAfterContribution = (d: LocalFinancials) =>
  goalProgress(d.goals.find((g) => g.id === "g-car")!, { ...d, transactions: [...d.transactions, CONTRIBUTION] });

it("fetch: an older copy's goal arrives migrated, so a contribution made afterwards counts", async () => {
  const r = await fetchAndMerge("u1@example.com", local);
  if (!r.ok || r.skipped) throw new Error("expected a merge");
  expect(r.mergedData.goals.find((g) => g.id === "g-car")!.openingAmount).toBe(500);
  expect(progressAfterContribution(r.mergedData)).toBe(600);
  expect(r.mergedData.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  // The record of the last sync is taken from the migrated copy, so the next
  // merge doesn't read the migration as a change made on the other device.
  expect(r.serverCopy.goals[0].openingAmount).toBe(500);
  expect(r.serverCopy.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
});

it("merge and push: the same, and the copy pushed back carries it", async () => {
  const r = await mergeAndPush("u1@example.com", local());
  if (!r.ok) throw new Error(r.error);
  expect(progressAfterContribution(r.mergedData)).toBe(600);
  expect(pushed.at(-1)!.goals.find((g) => g.id === "g-car")!.openingAmount).toBe(500);
});

it("a copy at this code's version is merged exactly as it arrives (nothing filled in)", async () => {
  const { wishlist: _absent, ...sparse } = { ...DEFAULT_DATA, ...on, income: 3150.75, goals: [{ ...CAR, openingAmount: 500 }] } as LocalFinancials;
  serverData = sparse as LocalFinancials;
  const r = await fetchAndMerge("u1@example.com", local);
  if (!r.ok || r.skipped) throw new Error("expected a merge");
  expect(r.serverCopy).not.toHaveProperty("wishlist");
});

it("a newer copy is still refused, not migrated", async () => {
  serverData = { ...DEFAULT_DATA, ...on, schemaVersion: CURRENT_SCHEMA_VERSION + 1 } as LocalFinancials;
  expect(await fetchAndMerge("u1@example.com", local)).toEqual({ ok: false, newerVersion: true });
  expect(await mergeAndPush("u1@example.com", local())).toEqual({ ok: false, newerVersion: true });
  expect(pushed).toEqual([]);
});
