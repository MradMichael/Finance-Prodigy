// Item 3b (owner, session 25): Profile's two restores keep this device's
// backup choice. lib/restore-backup-choice.test.ts covers the rule; this
// covers the wiring of "Import from file" and "Restore from database", against
// the real stored record.
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import type { LocalFinancials } from "../../lib/localData";

const SESSION = { userId: "u1", email: "u1@example.test", name: "Quartz Lantern" };
const ROUTER = { replace: vi.fn(), push: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => ROUTER }));
vi.mock("../../lib/auth", () => ({
  getSession: () => SESSION, hasValidSession: () => true, signOut: vi.fn(), updateProfile: vi.fn(),
  deleteAccount: vi.fn(), ensureFirstUserIsAdmin: vi.fn(), regenerateRecoveryCode: vi.fn(),
}));
const pullFromServer = vi.fn();
vi.mock("../../lib/syncService", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/syncService")>();
  return { ...real, pushToServer: vi.fn(), pullFromServer: (...a: unknown[]) => pullFromServer(...a), getLastSyncTime: () => null, confirmOverwriteIfNeeded: vi.fn(async () => true) };
});
vi.mock("../../lib/analytics", () => ({ isAnalyticsOptedIn: () => false, setAnalyticsOptIn: vi.fn() }));

import ProfilePage from "./page";
import { ThemeProvider } from "../../contexts/ThemeContext";
import { DEFAULT_DATA, saveData, loadData } from "../../lib/localData";
import { activateSessionKey } from "../../lib/crypto";

type Choice = NonNullable<LocalFinancials["syncChoice"]>;
const ON: Choice = { enabled: true, decidedAt: "2026-10-01T08:00:00.000Z" };
const OFF: Choice = { enabled: false, decidedAt: "2026-10-12T08:00:00.000Z" };
const record = (syncChoice?: Choice, income = 3000) => ({ ...DEFAULT_DATA, income, ...(syncChoice ? { syncChoice } : {}) }) as LocalFinancials;

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); pullFromServer.mockReset();
  activateSessionKey(new Uint8Array(32).fill(7));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const open = async () => { render(<ThemeProvider><ProfilePage /></ThemeProvider>); await screen.findByRole("button", { name: /Download my data/ }); };
const importFile = (d: LocalFinancials) => {
  const input = document.querySelector('input[type="file"][accept*="json"]')!;
  fireEvent.change(input, { target: { files: [new File([JSON.stringify(d)], "essa-data.json", { type: "application/json" })] } });
};

it("Import from file: a file with no choice over a device that turned backup on keeps it on", async () => {
  await saveData(record(ON), "u1");
  await open();
  importFile(record(undefined, 3150.75));
  expect(await screen.findByText(/Data restored from file/)).toBeTruthy();
  const stored = await loadData("u1");
  expect(stored.income).toBe(3150.75);
  expect(stored.syncChoice).toEqual(ON);
});

it("Import from file: a file saved with backup on over a device that turned it off keeps it off", async () => {
  await saveData(record(OFF), "u1");
  await open();
  importFile(record(ON, 3150.75));
  expect(await screen.findByText(/Data restored from file/)).toBeTruthy();
  const stored = await loadData("u1");
  expect(stored.income).toBe(3150.75);
  expect(stored.syncChoice).toEqual(OFF);
});

it("Restore from database: the server's copy (backup on) over a device that turned it off keeps it off", async () => {
  await saveData(record(OFF), "u1");
  pullFromServer.mockResolvedValue({ ok: true, data: record(ON, 3150.75), syncedAt: "2026-10-19T08:00:00.000Z" });
  await open();
  fireEvent.click(screen.getByRole("button", { name: /Restore from database/ }));
  expect(await screen.findByText(/Data restored from database/)).toBeTruthy();
  await waitFor(async () => expect((await loadData("u1")).income).toBe(3150.75));
  expect((await loadData("u1")).syncChoice).toEqual(OFF);
});

it("over a record this browser can't open: neither restore takes the copy's choice (the prompt asks)", async () => {
  await saveData(record(OFF), "u1");
  activateSessionKey(new Uint8Array(32).fill(9)); // the stored record no longer decrypts
  await open();
  importFile(record(ON, 3150.75));
  expect(await screen.findByText(/Data restored from file/)).toBeTruthy();
  let stored = await loadData("u1");
  expect(stored.income).toBe(3150.75);
  expect("syncChoice" in stored).toBe(false);
  cleanup();
  localStorage.clear();
  await saveData(record(OFF), "u1");
  activateSessionKey(new Uint8Array(32).fill(11));
  pullFromServer.mockResolvedValue({ ok: true, data: record(ON, 2900), syncedAt: "2026-10-19T08:00:00.000Z" });
  render(<ThemeProvider><ProfilePage /></ThemeProvider>);
  fireEvent.click(await screen.findByRole("button", { name: /Restore from database/ }));
  expect(await screen.findByText(/Data restored from database/)).toBeTruthy();
  stored = await loadData("u1");
  expect(stored.income).toBe(2900);
  expect("syncChoice" in stored).toBe(false);
});
