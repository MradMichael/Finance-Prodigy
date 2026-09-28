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
import { render, screen } from "@testing-library/react";
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
vi.mock("../lib/syncService", () => ({
  pullFromServer: vi.fn(async () => ({ ok: false, error: "none" })),
  pushToServer: (...a: unknown[]) => push(...(a as [])),
  mergeAndPush: (...a: unknown[]) => merge(...(a as [])),
  buildMergeNoticeText: () => ({ text: "" }),
  hasAutoPulled: vi.fn(() => true),
  markAutoPulled: vi.fn(),
  getLastSyncTime: () => null,
}));

import Home from "./page";
import { DEFAULT_DATA } from "../lib/localData";

beforeEach(() => { localStorage.clear(); saved.length = 0; push.mockClear(); merge.mockClear(); });

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
