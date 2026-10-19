// Session 24, item 1 (owner): Erase all data overwrote only the active record,
// so a copy kept of a record that couldn't be opened (session 23, item 4:
// essa_unreadable_<id>_<time>) survived "This permanently erases…" and "Erase
// everything". Erase now removes this account's kept copies too, once the
// empty record is saved; a failed save removes nothing. Another account's
// copies are left alone.
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { LocalFinancials } from "../../lib/localData";

const SESSION = { userId: "u1", email: "u1@example.test", name: "U One" };
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("../../lib/auth", () => ({
  getSession: () => SESSION, hasValidSession: () => true, signOut: vi.fn(), updateProfile: vi.fn(),
  deleteAccount: vi.fn(), ensureFirstUserIsAdmin: vi.fn(), regenerateRecoveryCode: vi.fn(),
}));
vi.mock("../../lib/syncService", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/syncService")>();
  return { ...real, pushToServer: vi.fn(async () => ({ ok: true, syncedAt: "2026-10-19T08:00:00.000Z" })), getLastSyncTime: () => null, applyBackupChoice: vi.fn() };
});
vi.mock("../../lib/analytics", () => ({ isAnalyticsOptedIn: () => false, setAnalyticsOptIn: vi.fn() }));
let failSave = false;
vi.mock("../../lib/localData", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/localData")>();
  return { ...real, saveData: vi.fn(async (d: LocalFinancials, id: string) => { if (failSave) throw new DOMException("The quota has been exceeded.", "QuotaExceededError"); return real.saveData(d, id); }) };
});

import ProfilePage from "./page";
import { ThemeProvider } from "../../contexts/ThemeContext";
import { DEFAULT_DATA, saveData, loadData, type StoredTransaction } from "../../lib/localData";
import { activateSessionKey } from "../../lib/crypto";

const MINE = ["essa_unreadable_u1_2026-10-15T09:00:00.000Z", "essa_unreadable_u1_2026-10-16T09:00:00.000Z"];
const THEIRS = "essa_unreadable_u2_2026-10-15T09:00:00.000Z";
const tx = { id: "t1", amount: 12, currency: "USD", bucket: "WANTS", category: "dining", description: "Lunch", date: "2026-10-18" } as StoredTransaction;

beforeEach(async () => {
  localStorage.clear(); sessionStorage.clear(); failSave = false;
  activateSessionKey(new Uint8Array(32).fill(7));
  await saveData({ ...DEFAULT_DATA, income: 3000, transactions: [tx] } as LocalFinancials, "u1");
  for (const k of [...MINE, THEIRS]) localStorage.setItem(k, "an encrypted blob");
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function erase() {
  render(<ThemeProvider><ProfilePage /></ThemeProvider>);
  fireEvent.click(await screen.findByRole("button", { name: "Reset all data" }));
  fireEvent.change(document.getElementById("reset-confirm")!, { target: { value: "reset" } });
  fireEvent.click(screen.getByRole("button", { name: "Erase everything" }));
}

it("Erase removes this account's kept copies, and leaves another account's", async () => {
  await erase();
  expect(await screen.findByText("✓ All data erased on this device.")).toBeTruthy();
  for (const k of MINE) expect(localStorage.getItem(k)).toBeNull();
  expect(localStorage.getItem(THEIRS)).toBe("an encrypted blob");
  expect((await loadData("u1")).transactions.filter((t) => !t.deletedAt)).toEqual([]);
});

it("a failed erase removes nothing", async () => {
  failSave = true;
  await erase();
  expect(await screen.findByText(/^✗ Couldn't erase your data on this device\./)).toBeTruthy();
  for (const k of MINE) expect(localStorage.getItem(k)).toBe("an encrypted blob");
});

it("Profile's confirmation names the kept copy when this account has one, and only then (item 3a, session 25)", async () => {
  const SENTENCE = "This also removes a saved copy of data this browser couldn't open.";
  render(<ThemeProvider><ProfilePage /></ThemeProvider>);
  fireEvent.click(await screen.findByRole("button", { name: "Reset all data" }));
  expect(screen.getByText(SENTENCE)).toBeTruthy();
  cleanup();
  for (const k of MINE) localStorage.removeItem(k); // another account's copy alone doesn't count
  render(<ThemeProvider><ProfilePage /></ThemeProvider>);
  fireEvent.click(await screen.findByRole("button", { name: "Reset all data" }));
  expect(screen.queryByText(SENTENCE)).toBeNull();
});
