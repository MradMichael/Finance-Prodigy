// Plan H 5b: the first-load restore (an empty device adopting the server's
// copy) stores that copy as the device's data, so it becomes the device's
// last sync -- once stored, and only then.
//
// Harness as in page.nothing-to-lose.test.tsx: only the I/O boundaries are stubbed.
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { DEFAULT_DATA, type LocalFinancials } from "../lib/localData";

const SESSION = { userId: "u1", email: "u1@example.com", name: "U One" };
const SERVER = { ...DEFAULT_DATA, income: 3150.75, transactions: [] } as LocalFinancials;

let seed: LocalFinancials;
let failSave = false;
const saved: LocalFinancials[] = [];
const seenSaved = vi.fn(async (_u: string, _d: LocalFinancials) => {});

const ROUTER = { replace: vi.fn(), push: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => ROUTER }));
vi.mock("../lib/auth", () => ({ getSession: () => SESSION, hasValidSession: () => true, signOut: vi.fn() }));
vi.mock("../lib/localData", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/localData")>();
  return { ...actual, loadData: vi.fn(async () => seed), saveData: vi.fn(async (d: LocalFinancials) => { if (failSave) throw new Error("QuotaExceededError"); saved.push(d); }) };
});
vi.mock("../lib/syncSeen", () => ({ saveSeen: (u: string, d: LocalFinancials) => seenSaved(u, d) }));
vi.mock("../lib/syncService", () => ({
  pullFromServer: vi.fn(async () => ({ ok: true, data: SERVER, syncedAt: "2026-10-08T09:00:00.000Z" })),
  pushToServer: vi.fn(async () => ({ ok: true })),
  mergeAndPush: vi.fn(async () => ({ ok: false })),
  buildMergeNoticeText: () => ({ text: "" }),
  hasAutoPulled: vi.fn(() => false),
  markAutoPulled: vi.fn(),
  getLastSyncTime: () => null,
  checkEmailExists: vi.fn(async () => false),
  applyBackupChoice: vi.fn(async (_e: string, d: unknown) => ({ data: d, result: null })),
}));

import Home from "./page";

beforeEach(() => { localStorage.clear(); saved.length = 0; seenSaved.mockClear(); failSave = false; });
afterEach(() => { vi.clearAllMocks(); });

it("the restored copy is stored, then recorded as this device's last sync", { timeout: 20000 }, async () => {
  seed = { ...DEFAULT_DATA, transactions: [] } as LocalFinancials;
  render(<Home />);
  await waitFor(() => expect(seenSaved).toHaveBeenCalledWith("u1", SERVER), { timeout: 8000 });
  expect(saved.some((d) => d.income === 3150.75)).toBe(true);
});

it("a restore that couldn't be stored records nothing", { timeout: 20000 }, async () => {
  seed = { ...DEFAULT_DATA, transactions: [] } as LocalFinancials;
  failSave = true;
  render(<Home />);
  await screen.findByRole("button", { name: "Setup" }, { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 500));
  expect(seenSaved).not.toHaveBeenCalled();
});
