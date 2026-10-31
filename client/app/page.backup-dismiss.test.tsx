// U3 (owner, session 33): the failed-backup notice's Dismiss. The harness is page.backup-retry.test.tsx's.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

const NOTICE = "Your latest changes aren't backed up yet. They're safe on this device, and ESSA will try again.";
const FAIL = { ok: false, error: "Sync failed (HTTP 503)." };
const OK = { ok: true, syncedAt: "2026-10-07T19:00:00.000Z" };

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

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  seed = settled();
  push.mockReset();
});
afterEach(() => { vi.useRealTimers(); });

const minutes = (n: number) => act(async () => { await vi.advanceTimersByTimeAsync(n * 60_000); });

/** Open, make one edit, and let its upload run. */
async function editAndUpload() {
  render(<Home />);
  await screen.findByRole("button", { name: "Setup" }, { timeout: 10000 });
  fireEvent.click(screen.getByRole("button", { name: "Wishlist" }));
  fireEvent.change(document.getElementById("wish-name")!, { target: { value: "Amber stool" } });
  fireEvent.change(document.getElementById("wish-price")!, { target: { value: "22.15" } });
  fireEvent.click(screen.getByRole("button", { name: "+ Add to wishlist" }));
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); }); // the 2.5 s debounce
  await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
}

// U3 (owner, session 33, DECISIONS_PENDING 17 (a); the existing "Dismiss" label): the failed-backup
// notice can be dismissed. It stays away until a backup succeeds; the next failure shows it again.
describe("U3: dismissing the failed-backup notice", () => {
  it("Dismiss hides it while the backup is still failing", async () => {
    push.mockResolvedValue(FAIL);
    await editAndUpload();
    await screen.findByText(NOTICE);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText(NOTICE)).toBeNull();
    await minutes(1); // a failing retry doesn't bring it back
    await waitFor(() => expect(push).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(NOTICE)).toBeNull();
  });

  it("after a backup succeeds, the next failure shows it again", async () => {
    push.mockResolvedValueOnce(FAIL).mockResolvedValueOnce(OK).mockResolvedValue(FAIL);
    await editAndUpload();
    await screen.findByText(NOTICE);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await minutes(1); // the scheduled retry succeeds
    await waitFor(() => expect(push).toHaveBeenCalledTimes(2));
    // A new edit, whose upload fails.
    fireEvent.change(document.getElementById("wish-name")!, { target: { value: "Teal lamp" } });
    fireEvent.change(document.getElementById("wish-price")!, { target: { value: "31" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Add to wishlist" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    await waitFor(() => expect(push).toHaveBeenCalledTimes(3));
    expect(await screen.findByText(NOTICE)).toBeTruthy();
  });
});
