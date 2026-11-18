// Item 8b (owner, session 56): an edit made while a conflict merge is in flight. autoSync merges the copy it
// started with (pull, merge, push: three network waits, up to ~30 s while the server wakes). An edit made in
// that time was stored and shown, and then the merge, built from the older copy, was stored and shown over it:
// the edit vanished from the screen and from this device until its own sync merged it back (and for good if the
// tab closed first). Now a merge built from a copy the person has since changed is neither stored nor shown; the
// server has it (the merge pushed it), and the newer edit's own sync merges against it.
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { LocalFinancials } from "../lib/localData";

const SESSION = { userId: "u1", email: "u1@example.com", name: "U One" };
vi.mock("next/navigation", () => ({ useRouter: () => ROUTER }));
const ROUTER = { replace: vi.fn(), push: vi.fn() };
vi.mock("../lib/auth", () => ({ getSession: () => SESSION, hasValidSession: () => true, signOut: vi.fn() }));
let seed: LocalFinancials;
const writes: LocalFinancials[] = [];
vi.mock("../lib/localData", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/localData")>();
  return { ...actual, loadData: vi.fn(async () => seed), saveData: vi.fn(async (d: LocalFinancials) => { writes.push(d); }) };
});
vi.mock("../lib/syncSeen", () => ({ saveSeen: vi.fn(async () => {}), loadSeen: vi.fn(async () => null) }));
vi.mock("../lib/clashNotice", () => ({ takeUnseenClashes: vi.fn(async () => []) }));
const SERVER_INCOME = 3700; // what the other device changed: the merge brings it in
let releaseFirst: (() => void) | null = null;
const mergeCalls: LocalFinancials[] = [];
const result = (local: LocalFinancials) => ({
  ok: true, syncedAt: "2026-10-08T09:01:00.000Z", addedFromServer: 0, conflictsResolved: 0, conflicts: [], conflictDetails: [],
  clashes: [], nonTransactionDivergence: [], replacedCloses: [], mergedData: { ...local, income: SERVER_INCOME }, firstSync: false,
});
vi.mock("../lib/syncService", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/syncService")>();
  return {
    fetchAndMerge: vi.fn(async (_e: string, local: () => LocalFinancials) => ({
      ok: true, mergedData: local(), serverCopy: local(), localChanged: false, serverBehind: true,
      addedFromServer: 0, conflictDetails: [], clashes: [], nonTransactionDivergence: [], replacedCloses: [], firstSync: false,
    })),
    pullFromServer: vi.fn(async () => ({ ok: false, error: "none" })),
    pushToServer: vi.fn(async () => ({ ok: false, conflict: true, error: "Server data has changed since your last sync." })),
    mergeAndPush: vi.fn(async (_e: string, local: LocalFinancials) => {
      mergeCalls.push(local);
      // The first merge is held open (the server waking up) until the test lets it go.
      if (mergeCalls.length === 1) await new Promise<void>((r) => { releaseFirst = r; });
      return result(local);
    }),
    recordMergeStored: vi.fn(async () => {}),
    mergeNotStored: vi.fn(),
    buildMergeNoticeText: real.buildMergeNoticeText,
    hasAutoPulled: () => true, markAutoPulled: vi.fn(), getLastSyncTime: () => "2026-10-05T08:00:00.000Z",
    checkEmailExists: vi.fn(async () => true), applyBackupChoice: vi.fn(),
  };
});

import Home from "./page";
import { DEFAULT_DATA, cycleStartDayOf } from "../lib/localData";
import { computeDashboard } from "../lib/computeDashboard";
import { currentCycleKey, calendarKeyForDate } from "../lib/period";

function settled(): LocalFinancials {
  const base = { ...DEFAULT_DATA, income: 3600, syncChoice: { enabled: true, decidedAt: "2026-09-28T12:00:00.000Z" } } as LocalFinancials;
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
const hasStool = (d: LocalFinancials | undefined) => !!d?.wishlist?.some((w) => w.name === "Amber stool");

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  seed = settled();
  writes.length = 0; mergeCalls.length = 0; releaseFirst = null;
});
afterEach(() => { vi.useRealTimers(); });

it("an edit made while a conflict merge is in flight is still on screen and on this device after the merge lands", { timeout: 30000 }, async () => {
  render(<Home />);
  await waitFor(() => expect(releaseFirst).not.toBeNull(), { timeout: 10000 }); // the open's fetch, a push refused as a conflict, the merge held
  expect(hasStool(mergeCalls[0])).toBe(false);

  fireEvent.click(screen.getByRole("button", { name: "Wishlist" }));
  fireEvent.change(document.getElementById("wish-name")!, { target: { value: "Amber stool" } });
  fireEvent.change(document.getElementById("wish-price")!, { target: { value: "22.15" } });
  fireEvent.click(screen.getByRole("button", { name: "+ Add to wishlist" }));
  await waitFor(() => expect(hasStool(writes.at(-1))).toBe(true));

  releaseFirst!(); // the merge built from the copy without the stool lands now
  await vi.advanceTimersByTimeAsync(100);
  expect(screen.getByText("Amber stool")).toBeTruthy(); // still on screen
  expect(hasStool(writes.at(-1))).toBe(true); // and still the copy on this device

  // The edit's own sync merges it with the server's copy (which holds the first merge).
  await vi.advanceTimersByTimeAsync(3000);
  await waitFor(() => expect(mergeCalls.length).toBeGreaterThanOrEqual(2));
  expect(hasStool(mergeCalls.at(-1))).toBe(true);
  await waitFor(() => expect(writes.at(-1)?.income).toBe(SERVER_INCOME));
  expect(hasStool(writes.at(-1))).toBe(true);
});

it("with no edit in the meantime, the merge is stored and shown as before", { timeout: 30000 }, async () => {
  render(<Home />);
  await waitFor(() => expect(releaseFirst).not.toBeNull(), { timeout: 10000 });
  releaseFirst!();
  await waitFor(() => expect(writes.at(-1)?.income).toBe(SERVER_INCOME));
  expect(mergeCalls).toHaveLength(1);
});
