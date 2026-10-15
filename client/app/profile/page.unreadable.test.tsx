// Session 23, item 4 (owner): ERR-04's approved screen sends someone whose
// stored record won't decrypt to Profile, to restore an exported file or sign
// out. There, Profile's load (loadData, no catch) threw DECRYPT_FAILED
// unhandled, and "Restore from database" did nothing: its overwrite check
// read the record and threw. Now Profile says what ERR-04 says, in its approved
// words, and stays usable; Restore from database asks first, as it does for
// any data on this device, then replaces the unreadable record with the
// server's copy. Push and Merge, which need this device's data, say they
// can't open it. No new wording.
//
// The owner's addition: before a restore (from the database, or from a file)
// replaces the unreadable record, the stored encrypted value is kept as it is,
// byte for byte, under its own key (essa_unreadable_<id>_<time>). Only the
// active record is overwritten.
//
// The record is made unreadable the way it happens: saved under one key, read
// under another.
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import type { LocalFinancials } from "../../lib/localData";

const SESSION = { userId: "u1", email: "u1@example.test", name: "U One" };
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("../../lib/auth", () => ({
  getSession: () => SESSION, hasValidSession: () => true, signOut: vi.fn(), updateProfile: vi.fn(),
  deleteAccount: vi.fn(), ensureFirstUserIsAdmin: vi.fn(), regenerateRecoveryCode: vi.fn(),
}));
const pull = vi.fn();
const push = vi.fn();
vi.mock("../../lib/syncService", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/syncService")>();
  return { ...real, pullFromServer: (...a: unknown[]) => pull(...a), pushToServer: (...a: unknown[]) => push(...a), getLastSyncTime: () => null, mergeAndPush: vi.fn(), applyBackupChoice: vi.fn() };
});
vi.mock("../../lib/analytics", () => ({ isAnalyticsOptedIn: () => false, setAnalyticsOptIn: vi.fn() }));

import ProfilePage from "./page";
import { ThemeProvider } from "../../contexts/ThemeContext";
import { DEFAULT_DATA, saveData, loadData } from "../../lib/localData";
import { activateSessionKey } from "../../lib/crypto";

const FIRST = "ESSA couldn't open the data saved in this browser.";
const kept = () => Object.keys(localStorage).filter((k) => k.startsWith("essa_unreadable_u1_")).map((k) => localStorage.getItem(k));
const SECOND = "Nothing has been deleted. If reloading doesn't help, you can restore an exported file or sign out from Profile.";

beforeEach(async () => {
  localStorage.clear(); sessionStorage.clear();
  pull.mockReset(); push.mockReset();
  activateSessionKey(new Uint8Array(32).fill(7));
  await saveData({ ...DEFAULT_DATA, income: 3000 } as LocalFinancials, "u1");
  activateSessionKey(new Uint8Array(32).fill(9)); // the stored record no longer decrypts
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("Profile says what ERR-04 says, in an alert, and stays usable", async () => {
  render(<ThemeProvider><ProfilePage /></ThemeProvider>);
  const alert = await screen.findByRole("alert");
  expect(within(alert).getByText(FIRST)).toBeTruthy();
  expect(within(alert).getByText(SECOND)).toBeTruthy();
  expect(screen.getByRole("button", { name: /Restore from database/ })).toBeTruthy();
  expect(screen.getByRole("button", { name: /Sign out/ })).toBeTruthy();
});

it("Restore from database asks first, then replaces the unreadable record with the server's copy", async () => {
  const ask = vi.spyOn(window, "confirm").mockReturnValue(true);
  pull.mockResolvedValue({ ok: true, data: { ...DEFAULT_DATA, income: 4200 }, syncedAt: "2026-10-15T08:00:00.000Z", hasRecoveryCode: false });
  const before = localStorage.getItem("essa_data_u1");
  render(<ThemeProvider><ProfilePage /></ThemeProvider>);
  fireEvent.click(await screen.findByRole("button", { name: /Restore from database/ }));
  expect(await screen.findByText("✓ Data restored from database. Reloading…")).toBeTruthy();
  expect(ask).toHaveBeenCalledTimes(1);
  expect((await loadData("u1")).income).toBe(4200);
  expect(before).not.toBeNull();
  expect(kept()).toEqual([before]); // the unreadable record, byte for byte
  expect(localStorage.getItem("essa_data_u1")).not.toBe(before);
});

it("Import from file keeps the unreadable record the same way before replacing it", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const before = localStorage.getItem("essa_data_u1");
  render(<ThemeProvider><ProfilePage /></ThemeProvider>);
  await screen.findByRole("alert");
  const file = new File([JSON.stringify({ ...DEFAULT_DATA, income: 5100 })], "essa-export.json", { type: "application/json" });
  fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [file] } });
  expect(await screen.findByText("✓ Data restored from file. Reloading…")).toBeTruthy();
  expect((await loadData("u1")).income).toBe(5100);
  expect(kept()).toEqual([before]);
});

it("declining the ask leaves the record as it is", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(false);
  render(<ThemeProvider><ProfilePage /></ThemeProvider>);
  fireEvent.click(await screen.findByRole("button", { name: /Restore from database/ }));
  await screen.findByRole("alert");
  expect(pull).not.toHaveBeenCalled();
  await expect(loadData("u1")).rejects.toThrow("DECRYPT_FAILED");
  expect(kept()).toEqual([]); // nothing copied when nothing is replaced
});

it("Push and Merge, which need this device's data, say they can't open it", async () => {
  render(<ThemeProvider><ProfilePage /></ThemeProvider>);
  fireEvent.click(await screen.findByRole("button", { name: /Push to database/ }));
  expect(await screen.findByText("✗ " + FIRST)).toBeTruthy();
  expect(push).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /Merge/ }));
  expect((await screen.findAllByText("✗ " + FIRST)).length).toBeGreaterThan(0);
});
