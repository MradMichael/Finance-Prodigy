// Session 22, item 3 (wording drafts, HELD): ERR-03 on the dashboard. Past
// the server's 2 MB cap every backup fails, for good. The automatic backup
// showed ERR-02's notice ("... and ESSA will try again") and retried at 1, 5
// and 15 minutes, which can't succeed. Now it says why, and what to do, and
// doesn't retry; the next upload that succeeds (after the data shrinks)
// clears it.
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import type { LocalFinancials } from "../lib/localData";

const SESSION = { userId: "u1", email: "u1@example.com", name: "U One" };
vi.mock("next/navigation", () => ({ useRouter: () => ROUTER }));
const ROUTER = { replace: vi.fn(), push: vi.fn() };
vi.mock("../lib/auth", () => ({ getSession: () => SESSION, hasValidSession: () => true, signOut: vi.fn() }));
let seed: LocalFinancials;
vi.mock("../lib/localData", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/localData")>();
  return { ...actual, loadData: vi.fn(async () => seed), saveData: vi.fn(async () => {}) };
});
const push = vi.fn();
vi.mock("../lib/syncService", () => ({
  fetchAndMerge: vi.fn(async (_e: string, local: () => LocalFinancials) => ({ ok: true, mergedData: local(), localChanged: false, serverBehind: false, addedFromServer: 0, conflictDetails: [], replacedCloses: [] })),
  pullFromServer: vi.fn(async () => ({ ok: false, error: "none" })),
  pushToServer: (...a: unknown[]) => push(...a),
  mergeAndPush: vi.fn(async () => ({ ok: false })),
  buildMergeNoticeText: () => ({ text: "", showReviewLink: false }),
  hasAutoPulled: () => true, markAutoPulled: vi.fn(), getLastSyncTime: () => "2026-10-05T08:00:00.000Z",
  checkEmailExists: vi.fn(async () => true), applyBackupChoice: vi.fn(),
}));

import Home from "./page";
import { DEFAULT_DATA, cycleStartDayOf } from "../lib/localData";
import { computeDashboard } from "../lib/computeDashboard";
import { currentCycleKey, calendarKeyForDate } from "../lib/period";

const TOO_LARGE_NOTICE = "Your latest changes can't be backed up: your data is larger than the 2 MB the server can hold. They're safe on this device. Export a copy from Profile to keep one safe.";
const RETRY_NOTICE = "Your latest changes aren't backed up yet. They're safe on this device, and ESSA will try again.";
const TOO_LARGE = { ok: false, tooLarge: true, error: "This backup wasn't saved: your data is larger than the 2 MB the server can hold. Export a copy to keep one safe." };

function settled(): LocalFinancials {
  const base = { ...DEFAULT_DATA, income: 3000, syncChoice: { enabled: true, decidedAt: "2026-09-28T12:00:00.000Z" } } as LocalFinancials;
  const dash = computeDashboard(base);
  const now = new Date();
  const cycle = currentCycleKey(now, cycleStartDayOf(base));
  return {
    ...base,
    netWorthHistory: [{ ym: calendarKeyForDate(now), value: dash.netWorth.total }],
    incomeHistory: [{ ym: cycle, value: base.income }],
    lbpRateHistory: [{ ym: cycle, value: base.lbpRate }],
    budgetRuleHistory: [{ ym: cycle, ...dash.budgetTargetPct }],
  } as LocalFinancials;
}

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); seed = settled(); push.mockReset(); });
afterEach(() => { vi.useRealTimers(); });

async function editAndUpload() {
  render(<Home />);
  await screen.findByRole("button", { name: "Setup" }, { timeout: 10000 });
  fireEvent.click(screen.getByRole("button", { name: "Wishlist" }));
  fireEvent.change(document.getElementById("wish-name")!, { target: { value: "Amber stool" } });
  fireEvent.change(document.getElementById("wish-price")!, { target: { value: "22.15" } });
  fireEvent.click(screen.getByRole("button", { name: "+ Add to wishlist" }));
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
}

it("says why, and what to do, without \"will try again\" or a Try again button", async () => {
  push.mockResolvedValue(TOO_LARGE);
  await editAndUpload();
  expect(await screen.findByText(TOO_LARGE_NOTICE)).toBeTruthy();
  expect(screen.queryByText(RETRY_NOTICE)).toBeNull();
  expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  expect(screen.getByText(TOO_LARGE_NOTICE).closest("[role='status']")).not.toBeNull();
});

it("doesn't retry: nothing more is sent in the next 20 minutes", async () => {
  push.mockResolvedValue(TOO_LARGE);
  await editAndUpload();
  await act(async () => { await vi.advanceTimersByTimeAsync(20 * 60_000); });
  expect(push).toHaveBeenCalledTimes(1);
});
