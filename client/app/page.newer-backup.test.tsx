// Travel slice 0's message (owner-approved, session 15): when the backup was
// written by newer code (a higher schemaVersion), or this device's own copy
// came from newer code, this device stops syncing and says so, in the owner's
// words, instead of failing quietly. It neither merges into the backup nor
// writes over it, shows no "Offline", "Couldn't reach backup" or "Sync
// conflict", and makes no further sync request until it's reloaded. Three
// ways in: the fetch on open meets it; an upload meets it first (the server
// moved on after this device's fetch); or this device's own copy is newer.
// The real syncService runs against a stubbed server.
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, act } from "@testing-library/react";
import { DEFAULT_DATA, CURRENT_SCHEMA_VERSION, type LocalFinancials } from "../lib/localData";

const SESSION = { userId: "u1", email: "u1@example.test", name: "U One" };
const ROUTER = { replace: vi.fn(), push: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => ROUTER }));
vi.mock("../lib/auth", () => ({ getSession: () => SESSION, hasValidSession: () => true, signOut: vi.fn(), getRecoveryTokenForSync: vi.fn(async () => undefined) }));
vi.mock("../lib/crypto", async (o) => ({ ...(await o<typeof import("../lib/crypto")>()), getSyncToken: () => "session-token" }));
let store: LocalFinancials;
vi.mock("../lib/localData", async (o) => {
  const actual = await o<typeof import("../lib/localData")>();
  return { ...actual, loadData: vi.fn(async () => store), saveData: vi.fn(async (d: LocalFinancials) => { store = d; }) };
});
vi.mock("../lib/syncSeen", async (o) => ({ ...(await o<typeof import("../lib/syncSeen")>()), loadSeen: vi.fn(async () => null), saveSeen: vi.fn(async () => {}) }));
vi.mock("../lib/clashNotice", () => ({ takeUnseenClashes: vi.fn(async () => []) }));
vi.mock("../lib/syncService", async (o) => ({ ...(await o<typeof import("../lib/syncService")>()), checkEmailExists: vi.fn(async () => true) }));

import Home from "./page";

const MESSAGE = "Your backup was saved by a newer version of ESSA, so this device has stopped syncing. Reload ESSA to update it. Until then, changes stay on this device.";
const NEWER = CURRENT_SCHEMA_VERSION + 1;
const ON = { syncChoice: { enabled: true, decidedAt: "2026-09-28T12:00:00.000Z" } };
const NEWER_BACKUP = { ...DEFAULT_DATA, ...ON, income: 3150, schemaVersion: NEWER, trips: [{ id: "trip-1", name: "Lisbon" }] };
const CURRENT_BACKUP = { ...DEFAULT_DATA, ...ON, income: 3150, schemaVersion: CURRENT_SCHEMA_VERSION };
/** No snapshots yet: the monthly-snapshot write on load queues an upload. */
const unsettled = (extra: Record<string, unknown> = {}) => ({ ...DEFAULT_DATA, ...ON, income: 3150.75, ...extra }) as LocalFinancials;

let calls: string[];
let backup: Record<string, unknown>;
/** The other device (newer code) writes its backup just after this device's first fetch. */
let newerAfterFirstPull: boolean;
beforeEach(() => {
  localStorage.clear(); calls = []; newerAfterFirstPull = false;
  store = unsettled(); backup = NEWER_BACKUP;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    calls.push(String(url));
    if (String(url).includes("/pull")) {
      const res = new Response(JSON.stringify({ ok: true, data: backup, syncedAt: "2026-11-03T20:00:00.000Z", hasRecoveryCode: true }), { status: 200 });
      if (newerAfterFirstPull) backup = NEWER_BACKUP;
      return res;
    }
    // The server has moved on since this device's last sync: an upload is refused as stale, so it merges.
    return new Response(JSON.stringify({ code: "stale_push", error: "Server data has changed since your last sync." }), { status: 409 });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const pulls = () => calls.filter((u) => u.includes("/pull")).length;
const pushes = () => calls.filter((u) => u.includes("/push")).length;

async function stopsSyncing() {
  const [p0, u0] = [pulls(), pushes()];
  const realNow = Date.now.bind(Date);
  vi.spyOn(Date, "now").mockImplementation(() => realNow() + 61_000); // a fetch would be due again
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  await new Promise((r) => setTimeout(r, 3200)); // past any upload debounce
  expect([pulls(), pushes()]).toEqual([p0, u0]);
}

it("the fetch on open meets a newer backup: the owner's message, nothing uploaded, and syncing stops", { timeout: 40000 }, async () => {
  render(<Home />);
  expect(await screen.findByText(MESSAGE, undefined, { timeout: 10000 })).toBeTruthy();
  expect(document.body.innerHTML).not.toMatch(/Offline|Couldn.t reach backup|Sync conflict/);
  await new Promise((r) => setTimeout(r, 3200)); // the load's own write would upload by now
  expect(pushes()).toBe(0);
  expect((store as unknown as Record<string, unknown>).trips).toBeUndefined();
  await stopsSyncing();
});

it("an upload meets it first: the same message, no conflict shown", { timeout: 40000 }, async () => {
  backup = CURRENT_BACKUP; newerAfterFirstPull = true;
  render(<Home />);
  expect(await screen.findByText(MESSAGE, undefined, { timeout: 10000 })).toBeTruthy();
  expect(pushes()).toBe(1); // the one the server refused as stale
  expect(document.body.innerHTML).not.toMatch(/Offline|Couldn.t reach backup|Sync conflict/);
  await stopsSyncing();
});

it("this device's own copy came from newer code: the message, and it isn't uploaded", { timeout: 40000 }, async () => {
  backup = CURRENT_BACKUP;
  store = unsettled({ schemaVersion: NEWER });
  render(<Home />);
  expect(await screen.findByText(MESSAGE, undefined, { timeout: 10000 })).toBeTruthy();
  expect(pushes()).toBe(0);
  await waitFor(() => expect(store.schemaVersion).toBe(NEWER));
});
