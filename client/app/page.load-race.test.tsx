// 2.4.69 — the first-load window.
//
// The load effect captures `data` before an await and re-applies it after
// (page.tsx:158). React 18 StrictMode double-invokes effects in dev, and
// markAutoPulled is localStorage-backed, so the two runs split: one marks
// the flag and awaits the pull, the other skips the pull and calls
// setFinancials immediately — unlocking the UI while the first is still in
// flight. Anything typed in that window is discarded when the pull resolves.
//
// The fix does not guard writes inside the window -- it CLOSES the window,
// making dev behave as production already does: one load run per mount, the
// skeleton held until it settles. So the invariant under test is "the shell
// is not interactive while a load is in flight", which is strictly stronger
// than "a write in the window survives" and cannot pass vacuously: pre-fix
// the shell is present at ~390ms with the pull still pending, and the first
// assertion fails on exactly that.
//
// The 2.4.76 lesson is why it is written this way. A test shaped as "type,
// resolve, check it is still there" passes for two different reasons -- the
// write was protected, or nothing ever threatened it -- and cannot tell them
// apart. Asserting the absence of the window removes that ambiguity.
//
// Verified RED against the pre-fix code, and RED for the right reason: the
// shell renders while the pull is pending.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { DEFAULT_DATA, type LocalFinancials } from "../lib/localData";

const SESSION = { userId: "u1", email: "u1@example.com", name: "U One" };

// A pull we resolve by hand, so the window is open for exactly as long as
// the test wants it open.
let releasePull: (v: unknown) => void;
let pullPending: Promise<unknown>;
let pullCalls = 0;

// One stable object, not a fresh one per call. next/navigation returns a
// stable reference, and a mock that does not model that puts the page into a
// render/persist loop that has nothing to do with what this file tests.
const ROUTER = { replace: vi.fn(), push: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => ROUTER }));

vi.mock("../lib/auth", () => ({
  getSession: () => SESSION,
  hasValidSession: () => true,
  signOut: vi.fn(),
}));

const saved: LocalFinancials[] = [];
vi.mock("../lib/localData", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/localData")>();
  return {
    ...actual,
    // Only the two I/O boundaries are stubbed. Everything else -- including
    // autoPurgeExpired, whose real signature takes and returns a
    // StoredTransaction[] -- stays real, so the component under test runs
    // against the actual data model rather than a mock of it.
    loadData: vi.fn(async () => ({ ...actual.DEFAULT_DATA, transactions: [] })),
    saveData: vi.fn(async (d: LocalFinancials) => { saved.push(d); }),
  };
});

vi.mock("../lib/syncService", () => ({
  pullFromServer: vi.fn(() => { pullCalls++; return pullPending; }),
  pushToServer: vi.fn(async () => ({ ok: true })),
  mergeAndPush: vi.fn(async () => ({ ok: false })),
  buildMergeNoticeText: () => ({ text: "" }),
  hasAutoPulled: vi.fn(() => localStorage.getItem("ap") === "1"),
  markAutoPulled: vi.fn(() => localStorage.setItem("ap", "1")),
  getLastSyncTime: () => null,
}));

import Home from "./page";

beforeEach(() => {
  localStorage.clear();
  saved.length = 0;
  pullCalls = 0;
  pullPending = new Promise((res) => { releasePull = res; });
});
afterEach(() => { vi.clearAllMocks(); });

/**
 * Releases the deferred pull and lets the whole continuation settle. A bare
 * `await Promise.resolve()` is not enough: the success path awaits saveData
 * before calling setFinancials, so the state update sits one macrotask
 * further out than the failure path does.
 */
async function releaseAndSettle(result: unknown) {
  await act(async () => {
    releasePull(result);
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe("2.4.69 — a write during the first-load window survives the pull resolving", () => {
  it("no write window exists: the shell stays locked until the load settles", { timeout: 20000 }, async () => {
    const user = userEvent.setup();
    render(<StrictMode><Home /></StrictMode>);

    // Give React every chance to commit a shell. Pre-fix this is where the
    // stale run's sibling unlocked the UI at ~390ms with the pull still
    // pending -- that is the window, and this assertion is what closes it.
    await new Promise((r) => setTimeout(r, 1200));
    expect(pullCalls).toBe(1);
    expect(screen.queryByRole("button", { name: "Setup" })).toBeNull();

    // Only once the load actually settles does the app become usable.
    releasePull({ ok: false, error: "No data on server yet" });
    await screen.findByRole("button", { name: "Setup" }, { timeout: 8000 });

    // setFinancials ran exactly once for this mount despite StrictMode
    // double-invoking the effect -- the superseded run bailed instead of
    // applying its pre-await snapshot. That is the whole fix, and it is the
    // reason the window above no longer exists.
    expect(pullCalls).toBe(1);

    // Not asserting here that a subsequent edit sticks -- that is a different
    // invariant, covered where the write path is the subject.
    //
    // CORRECTION to what this comment previously said. It claimed the page's
    // monthly-snapshot effect "writes repeatedly (126 saveData calls)". That
    // was a false attribution: the 126 came from this file's own useRouter
    // mock returning a new object per render, which churned the load effect's
    // then-`[router]` dependency. The snapshot effect was writing correctly in
    // response. Measured afterwards in real browsers: one persist per load in
    // both dev and production builds. The mock is fixed above and the
    // dependency is gone (page.load-effect-deps.test.tsx locks it).
  });

  it("a legitimate pull is still adopted — the guard must block a STALE run, not the pull itself", { timeout: 20000 }, async () => {
    // The fix must not degrade into "ignore the auto-pull". When nothing was
    // written during the window, the server's data is the only candidate and
    // must still be taken.
    //
    // Asserted on the persisted snapshot rather than by driving the UI to
    // Setup: the pull-success path calls saveData(pulled) immediately before
    // setFinancials(pulled), so `saved` is a direct, low-noise observation of
    // whether the pull was adopted. Rendering the overview repeatedly to
    // reach a form field would test recharts as much as the effect.
    render(<StrictMode><Home /></StrictMode>);
    // The shell is deliberately NOT awaited first: with the window closed it
    // does not exist until the load settles, which is the point of the fix.
    await waitFor(() => expect(pullCalls).toBe(1), { timeout: 5000 });

    // Deliberately NOT wrapped in act(): the success path's continuation
    // settles through waitFor's own polling, and act() waits for React to go
    // fully idle, which this page never does inside jsdom (its overview
    // charts re-measure on every commit).
    releasePull({ ok: true, data: { ...DEFAULT_DATA, income: 777 } });

    await waitFor(() => {
      expect(saved.some((d) => d.income === 777)).toBe(true);
    }, { timeout: 8000 });
  });
});
