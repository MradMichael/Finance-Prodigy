// SYNC-1 step 1 (DI-09, 2026-10-06): the first-load pull and the "nothing to
// lose" check.
//
// The dashboard pulls once, on a device's first load, only when that device
// has nothing (page.tsx's load effect), and adopts what it pulls only when the
// server's copy has something. Both decisions use isEmptyFinancials, which
// ignored the wishlist, custom categories, category rules and period closes.
// So a device holding only wishlist items was treated as empty and pulled, and
// a server copy holding only wishlist items was treated as empty and ignored.
//
// Harness as in page.load-race.test.tsx: only the I/O boundaries are stubbed.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { DEFAULT_DATA, type LocalFinancials } from "../lib/localData";

const SESSION = { userId: "u1", email: "u1@example.com", name: "U One" };
const KETTLE = {
  id: "w1", name: "Cobalt kettle", emoji: "🫖", price: 41.6, currency: "USD" as const,
  priority: "medium" as const, createdAt: "2026-10-06T17:40:12.000Z",
};

let seed: LocalFinancials;
let pullAnswer: unknown;
let pullCalls = 0;
const saved: LocalFinancials[] = [];

const ROUTER = { replace: vi.fn(), push: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => ROUTER }));
vi.mock("../lib/auth", () => ({ getSession: () => SESSION, hasValidSession: () => true, signOut: vi.fn() }));
vi.mock("../lib/localData", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/localData")>();
  return { ...actual, loadData: vi.fn(async () => seed), saveData: vi.fn(async (d: LocalFinancials) => { saved.push(d); }) };
});
vi.mock("../lib/syncService", () => ({
  pullFromServer: vi.fn(async () => { pullCalls++; return pullAnswer; }),
  recordRestoreStored: vi.fn(() => true),
  pushToServer: vi.fn(async () => ({ ok: true })),
  mergeAndPush: vi.fn(async () => ({ ok: false })),
  buildMergeNoticeText: () => ({ text: "" }),
  hasAutoPulled: vi.fn(() => localStorage.getItem("ap") === "1"),
  markAutoPulled: vi.fn(() => localStorage.setItem("ap", "1")),
  getLastSyncTime: () => null,
  checkEmailExists: vi.fn(async () => false),
  applyBackupChoice: vi.fn(async (_e: string, d: unknown) => ({ data: d, result: null })),
}));

import Home from "./page";

beforeEach(() => { localStorage.clear(); saved.length = 0; pullCalls = 0; });
afterEach(() => { vi.clearAllMocks(); });

describe("the first-load pull counts the wishlist", () => {
  it("a server copy holding only a wishlist item is adopted, not ignored as empty", { timeout: 20000 }, async () => {
    seed = { ...DEFAULT_DATA, transactions: [] } as LocalFinancials;
    pullAnswer = { ok: true, data: { ...DEFAULT_DATA, wishlist: [KETTLE] } };
    render(<Home />);
    await waitFor(() => expect(pullCalls).toBe(1), { timeout: 5000 });
    await waitFor(() => expect(saved.some((d) => d.wishlist?.some((w) => w.name === "Cobalt kettle"))).toBe(true), { timeout: 8000 });
  });

  it("a device holding only a wishlist item has something to lose, so it doesn't auto-pull", { timeout: 20000 }, async () => {
    seed = { ...DEFAULT_DATA, wishlist: [KETTLE] } as LocalFinancials;
    pullAnswer = { ok: true, data: { ...DEFAULT_DATA, income: 3150.75 } };
    render(<Home />);
    // The shell appears once the load has settled; by then any pull would have been made.
    await screen.findByRole("button", { name: "Setup" }, { timeout: 10000 });
    expect(pullCalls).toBe(0);
    expect(saved.some((d) => d.income === 3150.75)).toBe(false);
  });
});
