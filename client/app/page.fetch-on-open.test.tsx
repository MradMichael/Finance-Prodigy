// SYNC-1 step 3 (DI-10, 2026-10-07): with backup on, the dashboard fetches
// the server's copy when it opens and when it comes back into view (focus or
// visibility), at most once a minute, and merges it in.
//
// Before this, a second device never picked up the first device's changes on
// open: an expense logged on the phone reached the laptop only with the
// laptop's own next edit (Stage 1 run, step 6).
//
// The fixture's monthly snapshots are already current, so the load-time
// snapshot write doesn't happen. Any request or upload seen here is the
// fetch's own.
//
// WHAT THESE FIXTURES CANNOT REACH: the merge itself (fetchAndMerge is mocked
// here; lib/syncService.fetch-merge.test.ts covers it against a mocked
// server), and Render's real wake-up time.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import type { LocalFinancials, StoredTransaction } from "../lib/localData";

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

type Fetched = Awaited<ReturnType<typeof import("../lib/syncService").fetchAndMerge>>;
let fetchImpl: (email: string, local: () => LocalFinancials | null) => Promise<Fetched>;
const fetchAndMerge = vi.fn((email: string, local: () => LocalFinancials | null) => fetchImpl(email, local));
const push = vi.fn(async (_e: string, _d: LocalFinancials) => ({ ok: true, syncedAt: "2026-10-07T09:00:00.000Z" }));
const notice = vi.fn((added: number, ..._rest: unknown[]) => ({ text: added ? `Merged with your other device — ${added} new transaction added.` : "", showReviewLink: false }));
let autoPulled = true;
const pull = vi.fn(async () => ({ ok: false, error: "none" }) as unknown);
vi.mock("../lib/syncService", () => ({
  fetchAndMerge: (e: string, l: () => LocalFinancials | null) => fetchAndMerge(e, l),
  pullFromServer: () => pull(),
  pushToServer: (e: string, d: LocalFinancials) => push(e, d),
  mergeAndPush: vi.fn(async () => ({ ok: false })),
  buildMergeNoticeText: (a: number, ...rest: unknown[]) => notice(a, ...rest),
  hasAutoPulled: () => autoPulled,
  markAutoPulled: vi.fn(),
  getLastSyncTime: () => "2026-10-05T08:00:00.000Z",
  checkEmailExists: vi.fn(async () => true),
  applyBackupChoice: vi.fn(),
}));

import Home from "./page";
import { DEFAULT_DATA, cycleStartDayOf } from "../lib/localData";
import { computeDashboard } from "../lib/computeDashboard";
import { currentCycleKey, calendarKeyForDate } from "../lib/period";

const ON = { enabled: true, decidedAt: "2026-09-28T12:00:00.000Z" };
const tx = (id: string, description: string, amount: number, date: string): StoredTransaction => ({
  id, description, amount, currency: "USD", bucket: "WANTS", category: "dining", date, updatedAt: `${date}T12:00:00.000Z`,
} as StoredTransaction);
const KETTLE = tx("t-kettle", "Cobalt kettle", 41.6, "2026-10-05");
const BISTRO = tx("t-bistro", "Bistro Margaux", 46.8, "2026-10-06");

/** Data whose monthly snapshots are already current, so opening writes nothing. */
function settled(extra: Partial<LocalFinancials>): LocalFinancials {
  const base = { ...DEFAULT_DATA, income: 3150.75, transactions: [KETTLE], ...extra } as LocalFinancials;
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

const merged = (d: LocalFinancials, over: Partial<Extract<Fetched, { mergedData: LocalFinancials }>> = {}): Fetched => ({
  ok: true, mergedData: d, localChanged: true, serverBehind: false, addedFromServer: 1, conflictDetails: [], replacedCloses: [], ...over,
});

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("essa_sidebar_pinned", "1"); // the status label shows only when the sidebar is open
  saved.length = 0; push.mockClear(); fetchAndMerge.mockClear(); notice.mockClear(); pull.mockClear();
  autoPulled = true;
  fetchImpl = async (_e, local) => merged({ ...local()!, transactions: [...local()!.transactions, BISTRO] });
});
afterEach(() => { vi.useRealTimers(); });

async function open() {
  render(<Home />);
  await screen.findByRole("button", { name: "Setup" }, { timeout: 10000 });
}
const settle = (ms = 300) => act(() => new Promise((r) => setTimeout(r, ms)));

describe("backup on: opening ESSA fetches and merges", () => {
  it("fetches once on open; the other device's expense is stored, and nothing is pushed", async () => {
    seed = settled({ syncChoice: ON });
    await open();
    await waitFor(() => expect(fetchAndMerge).toHaveBeenCalledTimes(1));
    expect(fetchAndMerge.mock.calls[0][0]).toBe("u1@example.com");
    await waitFor(() => expect(saved.at(-1)?.transactions.map((t) => t.id)).toEqual(["t-kettle", "t-bistro"]));
    await settle(3200);
    expect(push).not.toHaveBeenCalled();
  });

  it("something only this device had: the merged copy is pushed straight away", async () => {
    seed = settled({ syncChoice: ON });
    fetchImpl = async (_e, local) => merged({ ...local()!, transactions: [...local()!.transactions, BISTRO] }, { serverBehind: true });
    await open();
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    expect(push.mock.calls[0][1].transactions.map((t) => t.id)).toEqual(["t-kettle", "t-bistro"]);
  });

  it("nothing changed either side: nothing stored, nothing pushed", async () => {
    seed = settled({ syncChoice: ON });
    fetchImpl = async (_e, local) => merged(local()!, { localChanged: false, addedFromServer: 0 });
    await open();
    await waitFor(() => expect(fetchAndMerge).toHaveBeenCalledTimes(1));
    await settle(3200);
    expect(saved).toEqual([]);
    expect(push).not.toHaveBeenCalled();
  });

  it("the notice says what arrived; the 'may differ' sentence is left to the next push's merge", async () => {
    seed = settled({ syncChoice: ON });
    const real = await vi.importActual<typeof import("../lib/syncService")>("../lib/syncService");
    notice.mockImplementation(((...args: Parameters<typeof real.buildMergeNoticeText>) => real.buildMergeNoticeText(...args)) as never);
    await open();
    expect(await screen.findByText("Merged with your other device — 1 new transaction added.")).toBeTruthy();
    expect(notice.mock.calls[0]).toEqual([1, [], [], []]);
  });

  // Owner, 2026-10-07: "Offline" only when the device is actually offline.
  // A server error, or the 45 s wait running out, is "Couldn't reach backup".
  // The browser's navigator.onLine is the only signal that tells them apart:
  // false means offline; true can't prove the server was reachable, so every
  // failure with it true reads "Couldn't reach backup".
  it("the server can't be reached while the device is online: 'Couldn't reach backup', data kept", async () => {
    seed = settled({ syncChoice: ON });
    fetchImpl = async () => ({ ok: false, error: "Pull failed (HTTP 503)." });
    await open();
    expect(await screen.findByText("Couldn't reach backup")).toBeTruthy();
    expect(screen.queryByText("Offline")).toBeNull();
    expect(saved).toEqual([]);
  });

  it("the device is offline: 'Offline', data kept", async () => {
    seed = settled({ syncChoice: ON });
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    fetchImpl = async () => ({ ok: false, error: "Could not reach server. Is it running?" });
    try {
      await open();
      expect(await screen.findByText("Offline")).toBeTruthy();
      expect(screen.queryByText("Couldn't reach backup")).toBeNull();
      expect(saved).toEqual([]);
    } finally {
      online.mockRestore();
    }
  });

  it("no server copy: no indicator, nothing stored", async () => {
    seed = settled({ syncChoice: ON });
    fetchImpl = async () => ({ ok: false, error: "No data on server yet. Push first.", notFound: true });
    await open();
    await waitFor(() => expect(fetchAndMerge).toHaveBeenCalledTimes(1));
    await settle(500);
    expect(screen.queryByText("Offline")).toBeNull();
    expect(screen.queryByText("Couldn't reach backup")).toBeNull();
    expect(saved).toEqual([]);
  });

  it("an edit made while the server was waking is kept, and the stale copy is never pushed", async () => {
    seed = settled({ syncChoice: ON });
    let release!: () => void;
    const landed = new Promise<void>((r) => { release = r; });
    fetchImpl = async (_e, local) => {
      await landed;
      const now = local()!;
      return merged({ ...now, transactions: [...now.transactions, BISTRO] }, { serverBehind: true });
    };
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Wishlist" }));
    fireEvent.change(document.getElementById("wish-name")!, { target: { value: "Amber stool" } });
    fireEvent.change(document.getElementById("wish-price")!, { target: { value: "22.15" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Add to wishlist" }));
    await waitFor(() => expect(saved.at(-1)?.wishlist?.map((w) => w.name)).toEqual(["Amber stool"]));
    await act(async () => { release(); });
    await waitFor(() => expect(saved.at(-1)?.transactions.map((t) => t.id)).toEqual(["t-kettle", "t-bistro"]));
    expect(saved.at(-1)?.wishlist?.map((w) => w.name)).toEqual(["Amber stool"]);
    await settle(3200);
    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0][1].wishlist?.map((w) => w.name)).toEqual(["Amber stool"]);
    expect(push.mock.calls[0][1].transactions.map((t) => t.id)).toEqual(["t-kettle", "t-bistro"]);
  });

  // The edit's own upload is still waiting out its 2.5 s when the fetch lands,
  // holding the copy from before the merge. Nothing here is new to the server
  // in the fields that merge, but that waiting upload would still replace the
  // server's copy with one missing what just arrived. It goes now, merged.
  it("an upload still pending when the fetch lands is sent with the merged copy", async () => {
    seed = settled({ syncChoice: ON });
    let release!: () => void;
    const landed = new Promise<void>((r) => { release = r; });
    fetchImpl = async (_e, local) => {
      await landed;
      const now = local()!;
      return merged({ ...now, transactions: [...now.transactions, BISTRO] }, { serverBehind: false });
    };
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Wishlist" }));
    fireEvent.change(document.getElementById("wish-name")!, { target: { value: "Amber stool" } });
    fireEvent.change(document.getElementById("wish-price")!, { target: { value: "22.15" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Add to wishlist" }));
    await waitFor(() => expect(saved.at(-1)?.wishlist?.length).toBe(1));
    await act(async () => { release(); });
    await settle(3200);
    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0][1].transactions.map((t) => t.id)).toEqual(["t-kettle", "t-bistro"]);
  });

  it("an upload that already went doesn't make a later fetch push again", async () => {
    seed = settled({ syncChoice: ON });
    fetchImpl = async (_e, local) => merged(local()!, { localChanged: false, addedFromServer: 0 });
    await open();
    await waitFor(() => expect(fetchAndMerge).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Wishlist" }));
    fireEvent.change(document.getElementById("wish-name")!, { target: { value: "Amber stool" } });
    fireEvent.change(document.getElementById("wish-price")!, { target: { value: "22.15" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Add to wishlist" }));
    await settle(3200);
    expect(push).toHaveBeenCalledTimes(1); // the edit's own upload
    fetchImpl = async (_e, local) => merged({ ...local()!, transactions: [...local()!.transactions, BISTRO] }, { serverBehind: false });
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 61_000 });
    act(() => { window.dispatchEvent(new Event("focus")); });
    await waitFor(() => expect(saved.at(-1)?.transactions.map((t) => t.id)).toEqual(["t-kettle", "t-bistro"]));
    await settle(500);
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("a first-load restore counts as the open's fetch", async () => {
    seed = { ...DEFAULT_DATA } as LocalFinancials;
    autoPulled = false;
    pull.mockResolvedValueOnce({ ok: true, data: settled({ syncChoice: ON, transactions: [KETTLE, BISTRO] }), syncedAt: "2026-10-06T19:02:11.000Z", hasRecoveryCode: true });
    await open();
    await waitFor(() => expect(saved.at(-1)?.transactions.length).toBe(2));
    await settle(500);
    expect(fetchAndMerge).not.toHaveBeenCalled();
  });
});

describe("returning to ESSA", () => {
  it("at most once a minute, on focus or on becoming visible", async () => {
    seed = settled({ syncChoice: ON });
    fetchImpl = async (_e, local) => merged(local()!, { localChanged: false, addedFromServer: 0 });
    await open();
    await waitFor(() => expect(fetchAndMerge).toHaveBeenCalledTimes(1));
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() });
    act(() => { window.dispatchEvent(new Event("focus")); });
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    await settle();
    expect(fetchAndMerge).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 61_000);
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    await waitFor(() => expect(fetchAndMerge).toHaveBeenCalledTimes(2));
    vi.setSystemTime(Date.now() + 61_000);
    act(() => { window.dispatchEvent(new Event("focus")); });
    await waitFor(() => expect(fetchAndMerge).toHaveBeenCalledTimes(3));
  });

  it("a hidden tab doesn't fetch", async () => {
    seed = settled({ syncChoice: ON });
    fetchImpl = async (_e, local) => merged(local()!, { localChanged: false, addedFromServer: 0 });
    await open();
    await waitFor(() => expect(fetchAndMerge).toHaveBeenCalledTimes(1));
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 61_000 });
    const vis = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    await settle();
    vis.mockRestore();
    expect(fetchAndMerge).toHaveBeenCalledTimes(1);
  });
});

// The same rule for an upload's failure: the label is shared, so "Offline"
// means offline wherever it shows.
describe("an upload that fails", () => {
  async function editAndFail() {
    seed = settled({ syncChoice: ON });
    fetchImpl = async (_e, local) => merged(local()!, { localChanged: false, addedFromServer: 0 });
    push.mockResolvedValueOnce({ ok: false, error: "Sync failed (HTTP 500)." } as never);
    await open();
    await waitFor(() => expect(fetchAndMerge).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Wishlist" }));
    fireEvent.change(document.getElementById("wish-name")!, { target: { value: "Amber stool" } });
    fireEvent.change(document.getElementById("wish-price")!, { target: { value: "22.15" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Add to wishlist" }));
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1), { timeout: 5000 });
  }

  it("while online: 'Couldn't reach backup'", async () => {
    await editAndFail();
    expect(await screen.findByText("Couldn't reach backup")).toBeTruthy();
    expect(screen.queryByText("Offline")).toBeNull();
  });

  it("while offline: 'Offline'", async () => {
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    try {
      await editAndFail();
      expect(await screen.findByText("Offline")).toBeTruthy();
      expect(screen.queryByText("Couldn't reach backup")).toBeNull();
    } finally {
      online.mockRestore();
    }
  });
});

describe("backup not on: no request at all", () => {
  it.each([
    ["undecided", undefined],
    ["off", { enabled: false, decidedAt: "2026-09-28T12:00:00.000Z" }],
  ])("%s: nothing on open, nothing on return", async (_label, choice) => {
    seed = settled({ syncChoice: choice as LocalFinancials["syncChoice"] });
    await open();
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 61_000 });
    act(() => { window.dispatchEvent(new Event("focus")); });
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    await settle(500);
    expect(fetchAndMerge).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });
});
