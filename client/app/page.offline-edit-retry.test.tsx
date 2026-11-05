// PWA P3 (owner's gate, 2026-11-05): the offline notice may only say changes "back up when you reconnect"
// if that is what happens. This drives it with the device really offline (navigator.onLine false) and the
// upload failing the way an offline fetch does (pushToServer's unreachable result; lib/syncService.err03-05
// shows an offline fetch produces exactly that): two edits made offline, then the connection returns, and an
// upload must run again by itself carrying both edits. The harness is page.backup-retry.test.tsx's.
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


const UNREACHABLE = { ok: false, unreachable: true, error: "Couldn't reach the server. If you're online, it may be starting up: try again in a minute." };
let online = true;
beforeEach(() => { online = true; Object.defineProperty(navigator, "onLine", { configurable: true, get: () => online }); });
const wishNames = (call: unknown[]) => ((call[1] as LocalFinancials).wishlist ?? []).map((w) => w.name);

describe("an edit made offline is backed up when the connection returns", () => {
  it("fails as Offline while offline, then uploads the latest data, both offline edits in it, on reconnecting", async () => {
    online = false;
    push.mockResolvedValueOnce(UNREACHABLE).mockResolvedValueOnce(UNREACHABLE).mockResolvedValue(OK);
    await editAndUpload(); // first offline edit: its upload fails
    expect(wishNames(push.mock.calls[0])).toEqual(["Amber stool"]);
    expect(await screen.findByText(NOTICE)).toBeTruthy();

    // a second edit, still offline
    fireEvent.change(document.getElementById("wish-name")!, { target: { value: "Cedar shelf" } });
    fireEvent.change(document.getElementById("wish-price")!, { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Add to wishlist" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    await waitFor(() => expect(push).toHaveBeenCalledTimes(2));

    online = true;
    act(() => { window.dispatchEvent(new Event("online")); });
    await waitFor(() => expect(push).toHaveBeenCalledTimes(3));
    expect(wishNames(push.mock.calls[2]).sort()).toEqual(["Amber stool", "Cedar shelf"]);
    await waitFor(() => expect(screen.queryByText(NOTICE)).toBeNull());
  });
});
