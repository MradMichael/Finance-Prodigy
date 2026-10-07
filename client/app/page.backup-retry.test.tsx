// ERR-02 (owner, 2026-10-07): a failed backup showed for 4 seconds, then
// disappeared, and nothing retried until the next edit. Now a failed upload:
//   * keeps a notice on screen, with a "Try again" button, until the next
//     successful upload (the indicator stays failed too);
//   * retries automatically 1, 5 and 15 minutes after the failure, and when
//     the browser comes back online; a retry that fails doesn't start a new
//     series (the next edit does).
// A failed FETCH isn't a failed backup: its brief flash is unchanged.
// COPY-11's declined upload (held on its own branch) isn't a failure either;
// when both branches merge, its early return must stay ahead of this path.
// The notice's wording is a DRAFT for the owner (held branch).
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

describe("ERR-02: a failed backup", () => {
  it("stays on screen, with Try again, instead of fading after 4 seconds", async () => {
    push.mockResolvedValue(FAIL);
    await editAndUpload();
    const notice = await screen.findByText(NOTICE);
    expect(notice.closest('[role="status"]')).not.toBeNull(); // announced (A11Y-03)
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(screen.getByText(NOTICE)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("retries 1, 5 and 15 minutes after the failure, then stops", async () => {
    push.mockResolvedValue(FAIL);
    await editAndUpload();
    await minutes(1);
    await waitFor(() => expect(push).toHaveBeenCalledTimes(2));
    await minutes(3.9);
    expect(push).toHaveBeenCalledTimes(2);
    await minutes(0.2);
    await waitFor(() => expect(push).toHaveBeenCalledTimes(3));
    await minutes(10);
    await waitFor(() => expect(push).toHaveBeenCalledTimes(4));
    await minutes(45);
    expect(push).toHaveBeenCalledTimes(4);
    expect(screen.getByText(NOTICE)).toBeTruthy();
  });

  it("a retry that succeeds clears the notice and the remaining retries", async () => {
    push.mockResolvedValueOnce(FAIL).mockResolvedValue(OK);
    await editAndUpload();
    await screen.findByText(NOTICE);
    await minutes(1);
    await waitFor(() => expect(screen.queryByText(NOTICE)).toBeNull());
    await minutes(20);
    expect(push).toHaveBeenCalledTimes(2);
  });

  it("coming back online retries at once", async () => {
    push.mockResolvedValueOnce(FAIL).mockResolvedValue(OK);
    await editAndUpload();
    await screen.findByText(NOTICE);
    act(() => { window.dispatchEvent(new Event("online")); });
    await waitFor(() => expect(push).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText(NOTICE)).toBeNull());
  });

  it("Try again retries at once", async () => {
    push.mockResolvedValueOnce(FAIL).mockResolvedValue(OK);
    await editAndUpload();
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    await waitFor(() => expect(push).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText(NOTICE)).toBeNull());
  });

});
