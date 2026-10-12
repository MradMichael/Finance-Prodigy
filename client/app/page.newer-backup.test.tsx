// Travel slice 0 (owner, session 14), the dashboard's half: when the backup
// was written by newer code (a higher schemaVersion), this device neither
// merges into it nor writes over it, and says nothing yet: its message waits
// for the owner's approval, and nothing can write a higher version before
// travel's slice 2. So: no "Offline", no "Couldn't reach backup", no "Sync
// conflict", and no upload, whether the fetch or an upload meets it.
// The real syncService runs against a stubbed server.
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
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

const NEWER_BACKUP = { ...DEFAULT_DATA, income: 3150, schemaVersion: CURRENT_SCHEMA_VERSION + 1, trips: [{ id: "trip-1", name: "Lisbon" }] };
/** No snapshots yet: the monthly-snapshot write on load queues an upload, which meets the newer backup. */
const unsettled = () => ({ ...DEFAULT_DATA, income: 3150.75, syncChoice: { enabled: true, decidedAt: "2026-09-28T12:00:00.000Z" } }) as LocalFinancials;

let calls: string[];
beforeEach(() => {
  localStorage.clear(); calls = [];
  store = unsettled();
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    calls.push(String(url));
    if (String(url).includes("/pull")) return new Response(JSON.stringify({ ok: true, data: NEWER_BACKUP, syncedAt: "2026-11-03T20:00:00.000Z", hasRecoveryCode: true }), { status: 200 });
    // The server has moved on since this device's last sync, so an upload is refused as stale: the merge path.
    return new Response(JSON.stringify({ code: "stale_push", error: "Server data has changed since your last sync." }), { status: 409 });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("meets a newer backup quietly: no failure or conflict shown, nothing merged into it, one refused upload and no more", { timeout: 30000 }, async () => {
  render(<Home />);
  await screen.findAllByText(/financial health/i, undefined, { timeout: 10000 });
  // Right after the fetch on open, before the upload's 2.5 s debounce could cover a flash.
  await waitFor(() => expect(calls.some((u) => u.includes("/pull"))).toBe(true), { timeout: 5000 });
  await new Promise((r) => setTimeout(r, 300));
  expect(document.body.innerHTML).not.toMatch(/Offline|Couldn.t reach backup|Sync conflict/);
  await new Promise((r) => setTimeout(r, 3500)); // past the upload debounce, and the merge it leads to
  const html = document.body.innerHTML;
  expect(html).not.toMatch(/Offline|Couldn.t reach backup|Sync conflict/);
  expect(calls.filter((u) => u.includes("/push")).length).toBeLessThanOrEqual(1);
  expect((store as unknown as Record<string, unknown>).trips).toBeUndefined();
  expect(store.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
});
