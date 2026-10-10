// Session 10, item 3 (DI-15's fix, on pulls): the first-load restore (an
// empty device adopting the server's copy) records the restore's sync time
// only once that copy is stored here. It used to record it first (inside
// pullFromServer), so a restore whose store failed left this device empty
// with the server's newest time: the next push of anything typed here landed
// without a conflict and replaced the server's whole copy with it.
//
// The real pullFromServer and pushToServer run against a fake server with the
// real push rule (a base older than the server's copy is refused: 409
// stale_push; lib/sync-time-per-account.test.ts has the same server).
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { DEFAULT_DATA, type LocalFinancials } from "../lib/localData";

const SESSION = { userId: "u1", email: "u1@example.test", name: "U One" };
const ON = { syncChoice: { enabled: true, decidedAt: "2026-09-28T12:00:00.000Z" } };
const SERVER_INCOME = 3150.75;
const SERVER = { ...DEFAULT_DATA, ...ON, income: SERVER_INCOME, transactions: [] } as LocalFinancials;
const T2 = "2026-10-09T09:00:00.000Z";

let store: LocalFinancials;
let failRestoreStore = false;
let server: { data: LocalFinancials; syncedAt: string };

const ROUTER = { replace: vi.fn(), push: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => ROUTER }));
vi.mock("../lib/auth", () => ({ getSession: () => SESSION, hasValidSession: () => true, signOut: vi.fn(), getRecoveryTokenForSync: vi.fn(async () => null) }));
vi.mock("../lib/crypto", async (importOriginal) => ({ ...(await importOriginal<typeof import("../lib/crypto")>()), getSyncToken: () => "token" }));
vi.mock("../lib/localData", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/localData")>();
  return {
    ...actual, loadData: vi.fn(async () => store),
    saveData: vi.fn(async (d: LocalFinancials) => {
      if (failRestoreStore && d.income === SERVER_INCOME) throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      store = d;
    }),
  };
});
const seenSaved = vi.fn(async () => {});
vi.mock("../lib/syncSeen", () => ({ saveSeen: () => seenSaved(), loadSeen: vi.fn(async () => null) }));
vi.mock("../lib/clashNotice", () => ({ takeUnseenClashes: vi.fn(async () => []) }));
vi.mock("../lib/syncService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/syncService")>()),
  checkEmailExists: vi.fn(async () => true),
}));

import Home from "./page";
import { pushToServer } from "../lib/syncService";

beforeEach(() => {
  localStorage.clear(); failRestoreStore = false; seenSaved.mockClear();
  store = { ...DEFAULT_DATA, ...ON, transactions: [] } as LocalFinancials;
  server = { data: SERVER, syncedAt: T2 };
  let clock = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { data?: LocalFinancials; baseSyncedAt?: string };
    if (url === "/api/sync/pull") return new Response(JSON.stringify({ data: server.data, syncedAt: server.syncedAt, hasRecoveryCode: false }), { status: 200 });
    if (body.baseSyncedAt && new Date(body.baseSyncedAt) < new Date(server.syncedAt)) {
      return new Response(JSON.stringify({ code: "stale_push", error: "moved on" }), { status: 409 });
    }
    server = { data: body.data!, syncedAt: new Date(Date.UTC(2026, 9, 10, 9, ++clock)).toISOString() };
    return new Response(JSON.stringify({ syncedAt: server.syncedAt }), { status: 200 });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function firstLoad() {
  render(<Home />);
  await screen.findByRole("button", { name: "Setup" }, { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 300));
}

it("a first-load restore whose store fails leaves this device with no sync time", { timeout: 30000 }, async () => {
  failRestoreStore = true;
  await firstLoad();
  expect(store.income).toBe(0); // still empty: the restore wasn't stored
  expect(localStorage.getItem("essa_last_sync_u1")).toBeNull();
});

it("reproduced: after it, an edit's push meets the conflict instead of replacing the server's copy", { timeout: 30000 }, async () => {
  failRestoreStore = true;
  await firstLoad();
  const typed = { ...store, income: 100 } as LocalFinancials; // typed here on the empty device
  const next = await pushToServer(SESSION.email, typed); // its upload
  expect(next).toMatchObject({ ok: false, conflict: true });
  expect(server.data.income).toBe(SERVER_INCOME);
});

it("a first-load restore that is stored records its time, then its record", { timeout: 30000 }, async () => {
  await firstLoad();
  await waitFor(() => expect(store.income).toBe(SERVER_INCOME));
  expect(localStorage.getItem("essa_last_sync_u1")).toBe(T2);
  expect(seenSaved).toHaveBeenCalled();
});
