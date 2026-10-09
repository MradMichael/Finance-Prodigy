// DI-15 on the dashboard: autoSync's conflict merge reaches the server, then
// the dashboard stores the merged copy. Only once that store succeeds does it
// record the sync (the time and the sync record); when the store fails, it
// drops the record, so the next merge is a first merge that says what may
// differ, never one that silently reverts the other device's changes
// (lib/di15-record-after-store.test.ts has the merge itself).
//
// The fixture's monthly snapshots are already current, so the load-time
// snapshot write doesn't happen.
import { it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import type { LocalFinancials } from "../lib/localData";

const SESSION = { userId: "u1", email: "u1@example.com", name: "U One" };
vi.mock("next/navigation", () => ({ useRouter: () => ROUTER }));
const ROUTER = { replace: vi.fn(), push: vi.fn() };
vi.mock("../lib/auth", () => ({ getSession: () => SESSION, hasValidSession: () => true, signOut: vi.fn() }));
let seed: LocalFinancials;
let storeFails = false;
const log: string[] = [];
const MERGED_INCOME = 3700;
vi.mock("../lib/localData", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/localData")>();
  return {
    ...actual, loadData: vi.fn(async () => seed),
    saveData: vi.fn(async (d: LocalFinancials) => {
      if (d.income !== MERGED_INCOME) return;
      if (storeFails) { log.push("store failed"); throw new DOMException("The quota has been exceeded.", "QuotaExceededError"); }
      log.push("stored");
    }),
  };
});
vi.mock("../lib/syncSeen", () => ({ saveSeen: vi.fn(async () => {}), loadSeen: vi.fn(async () => null) }));
vi.mock("../lib/clashNotice", () => ({ takeUnseenClashes: vi.fn(async () => []) }));
const recordMergeStored = vi.fn(async (_u: string, _r: unknown) => { log.push("recorded"); });
const mergeNotStored = vi.fn((_u: string) => { log.push("record dropped"); });
let mergeResult: Record<string, unknown>;
vi.mock("../lib/syncService", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/syncService")>();
  return {
    fetchAndMerge: vi.fn(async () => ({
      ok: true, mergedData: seed, serverCopy: seed, localChanged: false, serverBehind: true,
      addedFromServer: 0, conflictDetails: [], clashes: [], nonTransactionDivergence: [], replacedCloses: [], firstSync: false,
    })),
    pullFromServer: vi.fn(async () => ({ ok: false, error: "none" })),
    pushToServer: vi.fn(async () => ({ ok: false, conflict: true, error: "Server data has changed since your last sync." })),
    mergeAndPush: vi.fn(async () => mergeResult),
    recordMergeStored: (u: string, r: unknown) => recordMergeStored(u, r),
    mergeNotStored: (u: string) => mergeNotStored(u),
    buildMergeNoticeText: real.buildMergeNoticeText,
    hasAutoPulled: () => true, markAutoPulled: vi.fn(), getLastSyncTime: () => "2026-10-05T08:00:00.000Z",
    checkEmailExists: vi.fn(async () => true), applyBackupChoice: vi.fn(),
  };
});

import Home from "./page";
import { DEFAULT_DATA, cycleStartDayOf } from "../lib/localData";
import { computeDashboard } from "../lib/computeDashboard";
import { currentCycleKey, calendarKeyForDate } from "../lib/period";

function settled(extra: Partial<LocalFinancials> = {}): LocalFinancials {
  const base = { ...DEFAULT_DATA, income: 3600, syncChoice: { enabled: true, decidedAt: "2026-09-28T12:00:00.000Z" }, ...extra } as LocalFinancials;
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
  seed = settled();
  storeFails = false;
  log.length = 0;
  recordMergeStored.mockClear(); mergeNotStored.mockClear();
  mergeResult = {
    ok: true, syncedAt: "2026-10-08T09:01:00.000Z", addedFromServer: 0, conflictsResolved: 0, conflicts: [], conflictDetails: [],
    clashes: [], nonTransactionDivergence: [], replacedCloses: [], mergedData: { ...seed, income: MERGED_INCOME }, firstSync: false,
  };
});

it("records the sync only once the merged copy is stored", { timeout: 20000 }, async () => {
  render(<Home />);
  await waitFor(() => expect(log).toContain("recorded"), { timeout: 10000 });
  // (The mocked server answers every push with a conflict, so the merge can repeat.)
  expect(log.slice(0, 2)).toEqual(["stored", "recorded"]);
  expect(recordMergeStored).toHaveBeenCalledWith("u1", mergeResult);
  expect(mergeNotStored).not.toHaveBeenCalled();
});

it("a store that fails records nothing and drops the record", { timeout: 20000 }, async () => {
  storeFails = true;
  render(<Home />);
  await waitFor(() => expect(log).toContain("record dropped"), { timeout: 10000 });
  expect(log.slice(0, 2)).toEqual(["store failed", "record dropped"]);
  expect(mergeNotStored).toHaveBeenCalledWith("u1");
  expect(recordMergeStored).not.toHaveBeenCalled();
  expect(log).not.toContain("stored");
});
