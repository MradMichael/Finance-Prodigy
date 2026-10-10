// Opt-in sync, part 1 (audit 2.4.153): nothing uploads unless backup is ON.
//
// Before this, every signed-in session uploaded 2.5s after any write --
// including writes no user made. The monthly-snapshot effect writes on load
// whenever a snapshot is stale, and that write went through handleChange ->
// autoSync -> pushToServer, so merely OPENING the app uploaded. That is the
// path exercised here: render the page, let the snapshot effect write, wait
// past the debounce, and look at what reached the network layer.
//
// UNDECIDED MEANS PAUSED. An account with no syncChoice has not chosen, so it
// does not upload -- not "on" (that would silently keep an upload the owner
// never agreed to) and not "off plus delete" (that would silently destroy).
// Part 3 asks existing accounts on their next open; until then, paused.
//
// WHICH AXES THESE FIXTURES CANNOT REACH (2.4.116):
//   * the stale-push conflict branch (mergeAndPush). It is reached only after
//     a push that returned 409, and the gate returns before any push -- so
//     with backup off it is unreachable by construction, and asserted here
//     only as "never called".
//   * the transaction auto-purge effect. Same funnel (handleChange ->
//     autoSync), needs an expired soft-deleted transaction; the snapshot
//     effect already proves the funnel is gated.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { LocalFinancials } from "../lib/localData";

const SESSION = { userId: "u1", email: "u1@example.com", name: "U One" };
vi.mock("next/navigation", () => ({ useRouter: () => ROUTER }));
const ROUTER = { replace: vi.fn(), push: vi.fn() };
vi.mock("../lib/auth", () => ({ getSession: () => SESSION, hasValidSession: () => true, signOut: vi.fn() }));

let seed: LocalFinancials;
const saved: LocalFinancials[] = [];
vi.mock("../lib/localData", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/localData")>();
  return { ...actual, loadData: vi.fn(async () => seed), saveData: vi.fn(async (d: LocalFinancials) => { saved.push(d); }) };
});

const push = vi.fn(async () => ({ ok: true }));
const merge = vi.fn(async () => ({ ok: false }));
let serverHasCopy = false;
let lastSyncHere: string | null = null;
const applied: string[] = [];
const applyChoice = vi.fn(async (_e: string, d: LocalFinancials, c: string) => {
  applied.push(c);
  return { data: { ...d, syncChoice: { enabled: c === "on", decidedAt: "2026-09-28T12:00:00.000Z" } }, result: { ok: true } };
});
vi.mock("../lib/syncService", () => ({
  pullFromServer: vi.fn(async () => ({ ok: false, error: "none" })),
  // SYNC-1 step 3: backup on fetches on open. Inert here ("no copy" does
  // nothing); app/page.fetch-on-open.test.tsx covers it.
  fetchAndMerge: vi.fn(async () => ({ ok: false, error: "none", notFound: true })),
  pushToServer: (...a: unknown[]) => push(...(a as [])),
  mergeAndPush: (...a: unknown[]) => merge(...(a as [])),
  buildMergeNoticeText: () => ({ text: "" }),
  hasAutoPulled: vi.fn(() => true),
  markAutoPulled: vi.fn(),
  serverCopyExists: vi.fn(async () => null), getLastSyncTime: () => lastSyncHere,
  checkEmailExists: vi.fn(async () => serverHasCopy),
  applyBackupChoice: (...a: unknown[]) => applyChoice(...(a as [string, LocalFinancials, string])),
}));

import Home from "./page";
import { DEFAULT_DATA } from "../lib/localData";

beforeEach(() => {
  localStorage.clear(); saved.length = 0; push.mockClear(); merge.mockClear();
  serverHasCopy = false; lastSyncHere = null; applied.length = 0; applyChoice.mockClear();
});

/** Render, let the snapshot effect write, and wait past the 2.5s debounce. */
async function openAndWait() {
  render(<Home />);
  await screen.findByRole("button", { name: "Setup" }, { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 3200));
}

describe("opening the app uploads nothing unless backup is on", () => {
  it("UNDECIDED (no choice made): the load-time write does not upload", async () => {
    seed = { ...DEFAULT_DATA, income: 3000 } as LocalFinancials;
    await openAndWait();
    // Premise: the snapshot effect really wrote, so a missing push is the
    // gate and not an effect that never ran.
    expect(saved.length).toBeGreaterThan(0);
    expect(push).not.toHaveBeenCalled();
    expect(merge).not.toHaveBeenCalled();
  }, 15000);

  it("OFF: the load-time write does not upload", async () => {
    seed = { ...DEFAULT_DATA, income: 3000, syncChoice: { enabled: false, decidedAt: "2026-09-28T10:00:00.000Z" } } as LocalFinancials;
    await openAndWait();
    expect(saved.length).toBeGreaterThan(0);
    expect(push).not.toHaveBeenCalled();
  }, 15000);

  it("ON: the same write uploads, exactly as before (the control)", async () => {
    // Without this, the two tests above would pass against a page whose
    // autoSync had simply broken.
    seed = { ...DEFAULT_DATA, income: 3000, syncChoice: { enabled: true, decidedAt: "2026-09-28T10:00:00.000Z" } } as LocalFinancials;
    await openAndWait();
    expect(push).toHaveBeenCalledTimes(1);
  }, 15000);
});

// ───────── part 3: the load-time choice ─────────

describe("an undecided account is asked on open, and nothing uploads until it answers", () => {
  const open = async () => { render(<Home />); await screen.findByRole("button", { name: "Setup" }, { timeout: 10000 }); };

  it("an account WITH a server copy is told, and offered delete", async () => {
    serverHasCopy = true;
    seed = { ...DEFAULT_DATA, income: 3000 } as LocalFinancials;
    await open();
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("button", { name: /stop, and delete the copy/i })).toBeTruthy();
  }, 15000);

  it("a device that has synced before counts as having a copy, even if the server check says no", async () => {
    // An offline check reports "no copy"; withholding delete from someone
    // who has one is the worse error, so the local signal is enough.
    lastSyncHere = "2026-09-20T08:00:00.000Z";
    seed = { ...DEFAULT_DATA, income: 3000 } as LocalFinancials;
    await open();
    await screen.findByRole("dialog");
    expect(screen.getByRole("button", { name: /stop, and delete the copy/i })).toBeTruthy();
  }, 15000);

  it("an account with no copy anywhere gets the plain question, no delete", async () => {
    seed = { ...DEFAULT_DATA, income: 3000 } as LocalFinancials;
    await open();
    await screen.findByRole("dialog");
    expect(screen.getByRole("button", { name: /turn backup on/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
  }, 15000);

  it("an account that has already chosen is not asked", async () => {
    seed = { ...DEFAULT_DATA, income: 3000, syncChoice: { enabled: false, decidedAt: "2026-09-28T10:00:00.000Z" } } as LocalFinancials;
    await open();
    await new Promise((r) => setTimeout(r, 400));
    expect(screen.queryByRole("dialog")).toBeNull();
  }, 15000);

  it("answering records the choice, saves it, and closes the prompt", async () => {
    serverHasCopy = true;
    seed = { ...DEFAULT_DATA, income: 3000 } as LocalFinancials;
    await open();
    fireEvent.click(await screen.findByRole("button", { name: /keep backing up/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(applied).toEqual(["on"]);
    expect(saved[saved.length - 1].syncChoice?.enabled).toBe(true);
  }, 15000);
});
