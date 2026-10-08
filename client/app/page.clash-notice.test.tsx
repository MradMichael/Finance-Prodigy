// Plan H 5d: a change both devices made reaches the notice from the
// dashboard's conflict merge (a push the server refused, then
// mergeAndPush), not only from the fetch on open.
//
// The fixture's monthly snapshots are already current, so the load-time
// snapshot write doesn't happen. The fetch on open finds the server behind,
// so the dashboard pushes; the push meets a conflict; the merge names what
// both devices changed.
import { it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
vi.mock("../lib/syncSeen", () => ({ saveSeen: vi.fn(async () => {}) }));
vi.mock("../lib/syncService", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/syncService")>();
  return {
    fetchAndMerge: vi.fn(async () => ({
      ok: true, mergedData: seed, serverCopy: seed, localChanged: false, serverBehind: true,
      addedFromServer: 0, conflictDetails: [], clashes: [], replacedCloses: [],
    })),
    pullFromServer: vi.fn(async () => ({ ok: false, error: "none" })),
    pushToServer: vi.fn(async () => ({ ok: false, conflict: true, error: "Server data has changed since your last sync." })),
    mergeAndPush: vi.fn(async () => ({
      ok: true, syncedAt: "2026-10-08T09:01:00.000Z", addedFromServer: 0, conflictsResolved: 0, conflicts: [], conflictDetails: [],
      clashes: [{ kind: "setting", setting: "income", kept: 3400, other: 3200 }], replacedCloses: [], mergedData: seed,
    })),
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
  const base = { ...DEFAULT_DATA, income: 3400, syncChoice: { enabled: true, decidedAt: "2026-09-28T12:00:00.000Z" } } as LocalFinancials;
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

it("the conflict merge's named change is shown", { timeout: 20000 }, async () => {
  seed = settled();
  render(<Home />);
  expect(await screen.findByText("Both devices changed your income — kept $3,400 (the other device had $3,200).", undefined, { timeout: 10000 })).toBeTruthy();
});
