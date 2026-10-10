// Session 10, item 3 (DI-15's fix, on pulls): Profile → Restore from database
// records the restore's sync time only once the restored copy is stored here.
// It used to record it first (inside pullFromServer), so a restore whose
// store failed left this device on its old copy with the server's newest
// time: its next push then landed without a conflict and overwrote the
// server's copy with that old one.
//
// The real pullFromServer and pushToServer run against a fake server with the
// real push rule (a base older than the server's copy is refused: 409
// stale_push; lib/sync-time-per-account.test.ts has the same server).
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import type { LocalFinancials } from "../../lib/localData";

const SESSION = { userId: "u1", email: "u1@example.test", name: "U One" };
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("../../lib/auth", () => ({
  getSession: () => SESSION, hasValidSession: () => true, signOut: vi.fn(), updateProfile: vi.fn(),
  deleteAccount: vi.fn(), ensureFirstUserIsAdmin: vi.fn(), regenerateRecoveryCode: vi.fn(), getRecoveryTokenForSync: vi.fn(async () => null),
}));
let failRestoreStore = false;
vi.mock("../../lib/localData", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/localData")>();
  return {
    ...actual,
    saveData: vi.fn(async (d: LocalFinancials, id: string) => {
      if (failRestoreStore && d.income === SERVER_INCOME) throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      return actual.saveData(d, id);
    }),
  };
});
vi.mock("../../lib/syncService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/syncService")>()),
  confirmOverwriteIfNeeded: vi.fn(async () => true),
}));
vi.mock("../../lib/analytics", () => ({ isAnalyticsOptedIn: () => false, setAnalyticsOptIn: vi.fn() }));

import ProfilePage from "./page";
import { ThemeProvider } from "../../contexts/ThemeContext";
import { DEFAULT_DATA, saveData } from "../../lib/localData";
import { activateSessionKey } from "../../lib/crypto";
import { pushToServer } from "../../lib/syncService";

const SERVER_INCOME = 5000;
const ON = { syncChoice: { enabled: true, decidedAt: "2026-09-28T12:00:00.000Z" } };
const LOCAL = { ...DEFAULT_DATA, ...ON, income: 3000 } as LocalFinancials;      // this device's copy, as of its last sync
const SERVER = { ...DEFAULT_DATA, ...ON, income: SERVER_INCOME } as LocalFinancials; // the other device's, since
const T1 = "2026-10-08T09:00:00.000Z", T2 = "2026-10-09T09:00:00.000Z";
let server: { data: LocalFinancials; syncedAt: string };

beforeEach(async () => {
  localStorage.clear(); sessionStorage.clear(); failRestoreStore = false;
  sessionStorage.setItem("essa_st_v1", "tok");
  activateSessionKey(new Uint8Array(32).fill(7));
  await saveData(LOCAL, "u1");
  localStorage.setItem("essa_last_sync_u1", T1);
  server = { data: SERVER, syncedAt: T2 };
  let clock = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { data?: LocalFinancials; baseSyncedAt?: string };
    if (url === "/api/sync/pull") return new Response(JSON.stringify({ data: server.data, syncedAt: server.syncedAt, hasRecoveryCode: true }), { status: 200 });
    if (body.baseSyncedAt && new Date(body.baseSyncedAt) < new Date(server.syncedAt)) {
      return new Response(JSON.stringify({ code: "stale_push", error: "moved on" }), { status: 409 });
    }
    server = { data: body.data!, syncedAt: new Date(Date.UTC(2026, 9, 10, 9, ++clock)).toISOString() };
    return new Response(JSON.stringify({ syncedAt: server.syncedAt }), { status: 200 });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function restore() {
  render(<ThemeProvider><ProfilePage /></ThemeProvider>);
  fireEvent.click(await screen.findByRole("button", { name: /Restore from database/ }));
}

it("a restore whose store fails leaves this device's sync time as it was", async () => {
  failRestoreStore = true;
  await restore();
  expect(await screen.findByText(/Couldn't save the server's copy on this device/)).toBeTruthy();
  expect(localStorage.getItem("essa_last_sync_u1")).toBe(T1);
});

it("reproduced: after a restore whose store failed, this device's next push meets the conflict instead of overwriting the server's copy", async () => {
  failRestoreStore = true;
  await restore();
  await screen.findByText(/Couldn't save the server's copy on this device/);
  const next = await pushToServer(SESSION.email, LOCAL); // the dashboard's next upload of what this device holds
  expect(next).toMatchObject({ ok: false, conflict: true });
  expect(server.data.income).toBe(SERVER_INCOME);
});

it("a restore that is stored records its time", async () => {
  await restore();
  await waitFor(() => expect(localStorage.getItem("essa_last_sync_u1")).toBe(T2));
});
