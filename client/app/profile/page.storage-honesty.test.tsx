// Session 8, item 6 (HELD: wording awaits the owner): Profile → Push to
// database, when the server took the push but this device couldn't record its
// time. It used to say "✗ Could not reach server. Is it running?".
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { LocalFinancials } from "../../lib/localData";
import { PUSH_NOT_RECORDED, PULL_NOT_RECORDED } from "../../lib/storageNotices";

const SESSION = { userId: "u1", email: "u1@example.com", name: "U One" };
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("../../lib/auth", () => ({
  getSession: () => SESSION, hasValidSession: () => true, signOut: vi.fn(), updateProfile: vi.fn(),
  deleteAccount: vi.fn(), ensureFirstUserIsAdmin: vi.fn(), regenerateRecoveryCode: vi.fn(),
}));
let pushResult: Record<string, unknown>;
let pullResult: Record<string, unknown>;
vi.mock("../../lib/syncService", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/syncService")>();
  return {
    pushToServer: vi.fn(async () => pushResult), pullFromServer: vi.fn(async () => pullResult), getLastSyncTime: () => null, confirmOverwriteIfNeeded: vi.fn(async () => true),
    mergeAndPush: vi.fn(), recordMergeStored: vi.fn(), buildMergeNoticeText: real.buildMergeNoticeText, applyBackupChoice: vi.fn(),
  };
});
vi.mock("../../lib/analytics", () => ({ isAnalyticsOptedIn: () => false, setAnalyticsOptIn: vi.fn() }));

import ProfilePage from "./page";
import { ThemeProvider } from "../../contexts/ThemeContext";
import { DEFAULT_DATA, saveData } from "../../lib/localData";
import { activateSessionKey } from "../../lib/crypto";

beforeEach(async () => {
  localStorage.clear(); sessionStorage.clear();
  activateSessionKey(new Uint8Array(32).fill(7));
  await saveData({ ...DEFAULT_DATA, income: 3000 } as LocalFinancials, "u1");
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("a push the server took, whose time this device couldn't record: pushed, and storage named as the problem", async () => {
  pushResult = { ok: true, syncedAt: "2026-10-08T09:01:00.000Z", notRecorded: true };
  render(<ThemeProvider><ProfilePage /></ThemeProvider>);
  fireEvent.click(await screen.findByRole("button", { name: /Push to database/ }));
  expect(await screen.findByText("✓ Pushed to database. " + PUSH_NOT_RECORDED)).toBeTruthy();
  expect(screen.queryByText(/Could not reach server/)).toBeNull();
});

it("an ordinary push says what it said", async () => {
  pushResult = { ok: true, syncedAt: "2026-10-08T09:01:00.000Z" };
  render(<ThemeProvider><ProfilePage /></ThemeProvider>);
  fireEvent.click(await screen.findByRole("button", { name: /Push to database/ }));
  expect(await screen.findByText("✓ Pushed to database.")).toBeTruthy();
});

// Session 9 (owner): Profile → Pull, when the server answered but this device
// couldn't note when.
it("a pull the server answered, whose time this device couldn't note: restored, and it says so, not 'Could not reach server'", async () => {
  pullResult = { ok: true, data: { ...DEFAULT_DATA, income: 4000 }, syncedAt: "2026-10-08T09:02:00.000Z", hasRecoveryCode: true, notRecorded: true };
  render(<ThemeProvider><ProfilePage /></ThemeProvider>);
  fireEvent.click(await screen.findByRole("button", { name: /Restore from database/ }));
  expect(await screen.findByText("✓ Data restored from database. " + PULL_NOT_RECORDED + " Reloading…")).toBeTruthy();
  expect(screen.queryByText(/Could not reach server/)).toBeNull();
});

it("an ordinary pull says what it said", async () => {
  pullResult = { ok: true, data: { ...DEFAULT_DATA, income: 4000 }, syncedAt: "2026-10-08T09:02:00.000Z", hasRecoveryCode: true };
  render(<ThemeProvider><ProfilePage /></ThemeProvider>);
  fireEvent.click(await screen.findByRole("button", { name: /Restore from database/ }));
  expect(await screen.findByText("✓ Data restored from database. Reloading…")).toBeTruthy();
});
