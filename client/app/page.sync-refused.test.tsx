// SEC-07 amended (owner, session 26, item 2; HELD for its sentence): a stale
// device. Its password was changed on another device, so the server refuses
// its token, and every refused request now counts toward the account's lock
// (six lock it). The dashboard used to show ERR-02's notice and retry at 1, 5
// and 15 minutes, and fetch on every open. Now one refused request stops all
// automatic server requests until a sign-in on this device: it says why,
// sets no retries, fetches nothing, uploads nothing, and stays stopped across
// a reload. So the device fails once and can never lock the account.
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act, cleanup } from "@testing-library/react";
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
const fetchMerge = vi.fn();
vi.mock("../lib/syncService", () => ({
  fetchAndMerge: (...a: unknown[]) => fetchMerge(...a),
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
import { SYNC_REFUSED_MESSAGE, isSyncRefused, clearSyncRefused } from "../lib/syncRefused";

const RETRY_NOTICE = "Your latest changes aren't backed up yet. They're safe on this device, and ESSA will try again.";
const REFUSED = { ok: false, credentialsRefused: true, error: "Invalid sync credentials for this account." };
const FETCH_OK = (_e: string, local: () => LocalFinancials) => ({ ok: true, mergedData: local(), localChanged: false, serverBehind: false, addedFromServer: 0, conflictDetails: [], replacedCloses: [], serverCopy: local() });

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
  localStorage.clear(); seed = settled();
  push.mockReset(); fetchMerge.mockReset().mockImplementation(async (e: string, l: () => LocalFinancials) => FETCH_OK(e, l));
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

const requests = () => push.mock.calls.length + fetchMerge.mock.calls.length;

async function open() {
  render(<Home />);
  await screen.findByRole("button", { name: "Setup" }, { timeout: 10000 });
}
async function addWish(name: string) {
  fireEvent.click(screen.getByRole("button", { name: "Wishlist" }));
  fireEvent.change(document.getElementById("wish-name")!, { target: { value: name } });
  fireEvent.change(document.getElementById("wish-price")!, { target: { value: "22.15" } });
  fireEvent.click(screen.getByRole("button", { name: "+ Add to wishlist" }));
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
}
async function nudge() {
  // Everything that would otherwise reach the server: focus and visibility (the fetch-on-open), going online (ERR-02's retry), and time (its timers).
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(20 * 60_000);
  });
}

it("a stale device fails one push, says why, and stops: no retries, no fetches, nothing more", async () => {
  push.mockResolvedValue(REFUSED);
  await open();
  await addWish("Amber stool");
  await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
  expect(await screen.findByText(SYNC_REFUSED_MESSAGE)).toBeTruthy();
  expect(screen.queryByText(RETRY_NOTICE)).toBeNull();
  expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  const after = requests();
  await addWish("Brass lamp");
  await nudge();
  expect(requests()).toBe(after);
  expect(push).toHaveBeenCalledTimes(1); // one refused request: far from the six a lock needs
  expect(isSyncRefused("u1")).toBe(true);
});

it("it stays stopped after a reload: nothing is sent, and it still says why", async () => {
  push.mockResolvedValue(REFUSED);
  await open();
  await addWish("Amber stool");
  await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
  cleanup();
  push.mockClear(); fetchMerge.mockClear();
  await open();
  expect(await screen.findByText(SYNC_REFUSED_MESSAGE)).toBeTruthy();
  await addWish("Brass lamp");
  await nudge();
  expect(requests()).toBe(0);
});

it("a refused fetch-on-open stops it too, before any upload", async () => {
  fetchMerge.mockResolvedValue(REFUSED);
  push.mockResolvedValue({ ok: true, syncedAt: "2026-10-20T08:00:00.000Z" });
  await open();
  await waitFor(() => expect(fetchMerge).toHaveBeenCalledTimes(1));
  expect(await screen.findByText(SYNC_REFUSED_MESSAGE)).toBeTruthy();
  await addWish("Amber stool");
  await nudge();
  expect(push).not.toHaveBeenCalled();
  expect(fetchMerge).toHaveBeenCalledTimes(1);
});

it("after a sign-in clears the stop, backup resumes", async () => {
  push.mockResolvedValue(REFUSED);
  await open();
  await addWish("Amber stool");
  await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
  cleanup();
  clearSyncRefused("u1"); // what a sign-in on this device does (lib/auth.ts)
  push.mockReset().mockResolvedValue({ ok: true, syncedAt: "2026-10-20T08:00:00.000Z" });
  await open();
  expect(screen.queryByText(SYNC_REFUSED_MESSAGE)).toBeNull();
  await addWish("Brass lamp");
  await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
});
