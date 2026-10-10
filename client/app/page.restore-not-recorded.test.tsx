// Session 10, item 1: the first-load restore when this device can't save the
// sync time. Since 668764d a refused time write no longer reads as "Could not
// reach server" (before, the restore skipped the copy); since item 3 the time
// is written after the copy is stored (recordRestoreStored). Either way the
// copy is restored. This proves what a LATER load does then: it doesn't
// restore again, over edits this device hasn't pushed, because the restore is
// one-time (essa_auto_pull_done_<id>, written before the pull) and only for
// an empty device.
//
// The real pullFromServer, recordRestoreStored, hasAutoPulled, markAutoPulled
// and getLastSyncTime run against a real localStorage whose sync time write
// throws; the server answers through a stubbed fetch. Device data lives in
// `store` (loadData and saveData), and every push fails, so an edit stays
// unpushed.
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { DEFAULT_DATA, type LocalFinancials } from "../lib/localData";

const SESSION = { userId: "u1", email: "u1@example.test", name: "U One" };
const SERVER = { ...DEFAULT_DATA, income: 3150.75, transactions: [], syncChoice: { enabled: true, decidedAt: "2026-10-01T00:00:00.000Z" } } as LocalFinancials;
const EDIT = { id: "t-local", amount: 42, category: "Food", date: "2026-10-09", currency: "USD" } as unknown as LocalFinancials["transactions"][number];

let store: LocalFinancials;
let failKeys: (k: string) => boolean = () => false;

const ROUTER = { replace: vi.fn(), push: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => ROUTER }));
vi.mock("../lib/auth", () => ({ getSession: () => SESSION, hasValidSession: () => true, signOut: vi.fn(), getRecoveryTokenForSync: () => null }));
vi.mock("../lib/crypto", async (importOriginal) => ({ ...(await importOriginal<typeof import("../lib/crypto")>()), getSyncToken: () => "token" }));
vi.mock("../lib/localData", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/localData")>();
  return { ...actual, loadData: vi.fn(async () => store), saveData: vi.fn(async (d: LocalFinancials) => { store = d; }) };
});
vi.mock("../lib/syncSeen", () => ({ saveSeen: vi.fn(async () => {}), loadSeen: vi.fn(async () => null) }));
vi.mock("../lib/clashNotice", () => ({ takeUnseenClashes: vi.fn(async () => []) }));
const pageCalls: unknown[][] = [];
vi.mock("../lib/syncService", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/syncService")>();
  return {
    ...real,
    // The page's own pulls (the first-load restore). fetchAndMerge's are internal to the module.
    pullFromServer: vi.fn((...a: Parameters<typeof real.pullFromServer>) => { pageCalls.push(a); return real.pullFromServer(...a); }),
    fetchAndMerge: vi.fn(async () => ({ ok: false, error: "offline" })),
    pushToServer: vi.fn(async () => ({ ok: false, error: "Could not reach server. Is it running?" })),
    mergeAndPush: vi.fn(async () => ({ ok: false, error: "Could not reach server. Is it running?" })),
    checkEmailExists: vi.fn(async () => true),
  };
});

import Home from "./page";

const realSetItem = Storage.prototype.setItem;
beforeEach(() => {
  localStorage.clear(); pageCalls.length = 0;
  failKeys = (k) => k.startsWith("essa_last_sync_");
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k: string, v: string) {
    if (failKeys(k)) throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    return realSetItem.call(this, k, v);
  });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: SERVER, syncedAt: "2026-10-09T09:00:00.000Z", hasRecoveryCode: false }), { status: 200, headers: { "Content-Type": "application/json" } })));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function firstLoadRestores() {
  store = { ...DEFAULT_DATA, transactions: [] } as LocalFinancials;
  render(<Home />);
  await waitFor(() => expect(store.income).toBe(3150.75), { timeout: 8000 });
  expect(pageCalls).toHaveLength(1);
  expect(localStorage.getItem("essa_last_sync_u1")).toBeNull();     // the time couldn't be saved
  expect(localStorage.getItem("essa_auto_pull_done_u1")).toBe("1"); // the one-time flag was
  cleanup();
}

async function laterLoad() {
  render(<Home />);
  await screen.findByRole("button", { name: "Setup" }, { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 500));
}

it("668764d: a first load whose sync time can't be saved still restores the server's copy", { timeout: 30000 }, async () => {
  await firstLoadRestores();
});

it("a later load doesn't restore again over edits this device hasn't pushed", { timeout: 30000 }, async () => {
  await firstLoadRestores();
  store = { ...store, income: 4000, transactions: [EDIT] }; // edited here; every push failed
  await laterLoad();
  expect(pageCalls).toHaveLength(1); // no second restore pull
  expect(store.income).toBe(4000);
  expect(store.transactions.map((t) => t.id)).toEqual(["t-local"]);
});

it("nor over an unpushed 'delete everything' that leaves this device empty: the restore is one-time", { timeout: 30000 }, async () => {
  await firstLoadRestores();
  store = { ...DEFAULT_DATA, transactions: [], syncChoice: SERVER.syncChoice } as LocalFinancials;
  await laterLoad();
  expect(pageCalls).toHaveLength(1);
  expect(store.income).toBe(0);
});

it("when the one-time flag can't be saved either, the first load makes no restore pull at all", { timeout: 30000 }, async () => {
  failKeys = (k) => k.startsWith("essa_last_sync_") || k.startsWith("essa_auto_pull_done_");
  store = { ...DEFAULT_DATA, transactions: [] } as LocalFinancials;
  const rejections: unknown[] = [];
  const onRejection = (e: unknown) => { rejections.push(e); };
  process.on("unhandledRejection", onRejection);
  try {
    render(<Home />);
    await new Promise((r) => setTimeout(r, 1500));
  } finally { process.off("unhandledRejection", onRejection); }
  expect(pageCalls).toHaveLength(0);
  expect(store.income).toBe(0);
  // markAutoPulled's throw ends the load before the pull (session 10: the
  // page stays on its loading screen; reported, not changed here).
  expect(rejections.map(String)).toEqual(["QuotaExceededError: The quota has been exceeded."]);
});
