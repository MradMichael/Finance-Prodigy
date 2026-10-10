// Plan H 5b: Profile → Restore from database replaces this device's data with
// the server's copy. Once that copy is stored it is this device's last sync,
// and is recorded as such; a restore that couldn't be stored records nothing.
// Session 10: its time too, once stored (recordRestoreStored).
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import type { LocalFinancials } from "../../lib/localData";

const SESSION = { userId: "u1", email: "u1@example.com", name: "U One" };
const ROUTER = { replace: vi.fn(), push: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => ROUTER }));
vi.mock("../../lib/auth", () => ({
  getSession: () => SESSION, hasValidSession: () => true, signOut: vi.fn(), updateProfile: vi.fn(),
  deleteAccount: vi.fn(), ensureFirstUserIsAdmin: vi.fn(), regenerateRecoveryCode: vi.fn(),
}));
let SERVER: LocalFinancials;
const timeRecorded = vi.fn((_u: string, _t: string) => true);
vi.mock("../../lib/syncService", () => ({
  pushToServer: vi.fn(), pullFromServer: vi.fn(async () => ({ ok: true, data: SERVER, syncedAt: "2026-10-08T09:00:00.000Z" })),
  recordRestoreStored: (u: string, t: string) => timeRecorded(u, t),
  getLastSyncTime: () => null, confirmOverwriteIfNeeded: vi.fn(async () => true), mergeAndPush: vi.fn(),
  buildMergeNoticeText: () => ({ text: "" }), applyBackupChoice: vi.fn(),
}));
vi.mock("../../lib/analytics", () => ({ isAnalyticsOptedIn: () => false, setAnalyticsOptIn: vi.fn() }));
const seenSaved = vi.fn(async (_u: string, _d: LocalFinancials) => {});
let hadRecord = false;
vi.mock("../../lib/syncSeen", () => ({ saveSeen: (u: string, d: LocalFinancials) => seenSaved(u, d), loadSeen: vi.fn(async () => (hadRecord ? { v: 1, kinds: {} } : null)) }));
const taken = vi.fn(async (..._a: unknown[]) => [] as unknown[]);
vi.mock("../../lib/clashNotice", () => ({ takeUnseenClashes: (...a: unknown[]) => taken(...a) }));
let failSave = false;
vi.mock("../../lib/localData", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/localData")>();
  return { ...actual, saveData: vi.fn(async (d: LocalFinancials, u: string) => { if (failSave) throw new Error("QuotaExceededError"); return actual.saveData(d, u); }) };
});

import ProfilePage from "./page";
import { ThemeProvider } from "../../contexts/ThemeContext";
import { DEFAULT_DATA, saveData } from "../../lib/localData";
import { activateSessionKey } from "../../lib/crypto";

beforeEach(async () => {
  localStorage.clear(); sessionStorage.clear();
  activateSessionKey(new Uint8Array(32).fill(7));
  SERVER = { ...DEFAULT_DATA, income: 3150.75 } as LocalFinancials;
  seenSaved.mockClear(); taken.mockClear(); timeRecorded.mockClear(); hadRecord = false;
  failSave = false;
  await saveData({ ...DEFAULT_DATA, income: 3000 } as LocalFinancials, "u1");
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function restore() {
  render(<ThemeProvider><ProfilePage /></ThemeProvider>);
  fireEvent.click(await screen.findByRole("button", { name: /Restore from database/ }));
}

it("stored, then recorded as this device's last sync", async () => {
  await restore();
  await waitFor(() => expect(seenSaved).toHaveBeenCalledWith("u1", SERVER));
  expect(vi.mocked(saveData).mock.invocationCallOrder.at(-1)!).toBeLessThan(seenSaved.mock.invocationCallOrder[0]);
  expect(timeRecorded).toHaveBeenCalledWith("u1", "2026-10-08T09:00:00.000Z");
  expect(vi.mocked(saveData).mock.invocationCallOrder.at(-1)!).toBeLessThan(timeRecorded.mock.invocationCallOrder[0]);
});

it("a restore that couldn't be stored records nothing", async () => {
  failSave = true;
  await restore();
  await screen.findByText(/Couldn't save the server's copy on this device/);
  expect(seenSaved).not.toHaveBeenCalled();
  expect(timeRecorded).not.toHaveBeenCalled();
});

// Session 7: a device with no record of a last sync takes the restored copy's
// clash records as shown; a device that has one leaves them for the dashboard.
it("a device with no record takes the restored copy's clash records as shown", async () => {
  await restore();
  await waitFor(() => expect(seenSaved).toHaveBeenCalledWith("u1", SERVER));
  expect(taken).toHaveBeenCalledWith("u1", SERVER, undefined, { firstSync: true });
});

it("a device with a record leaves them to be shown", async () => {
  hadRecord = true;
  await restore();
  await waitFor(() => expect(seenSaved).toHaveBeenCalledWith("u1", SERVER));
  expect(taken).not.toHaveBeenCalled();
});
