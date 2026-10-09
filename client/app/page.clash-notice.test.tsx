// Plan H 5d: a change both devices made reaches the notice, from every way a
// copy arrives on the dashboard: the conflict merge (a push the server
// refused, then mergeAndPush), and opening ESSA on data that already holds a
// record this device hasn't shown (after a restore, a sign-in, a reload).
// Each record is shown once per device (lib/clashNotice.ts, stood in for here
// by an in-memory set).
//
// The fixture's monthly snapshots are already current, so the load-time
// snapshot write doesn't happen.
import { it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { LocalFinancials } from "../lib/localData";
import type { ClashRecord } from "../lib/syncMerge";

const SESSION = { userId: "u1", email: "u1@example.com", name: "U One" };
vi.mock("next/navigation", () => ({ useRouter: () => ROUTER }));
const ROUTER = { replace: vi.fn(), push: vi.fn() };
vi.mock("../lib/auth", () => ({ getSession: () => SESSION, hasValidSession: () => true, signOut: vi.fn() }));
let seed: LocalFinancials;
vi.mock("../lib/localData", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/localData")>();
  return { ...actual, loadData: vi.fn(async () => seed), saveData: vi.fn(async () => {}) };
});
vi.mock("../lib/syncSeen", () => ({ saveSeen: vi.fn(async () => {}), loadSeen: vi.fn(async () => null) }));
const shown = new Set<string>();
vi.mock("../lib/clashNotice", () => ({
  takeUnseenClashes: vi.fn(async (_u: string, d: LocalFinancials, _now?: Date, opts?: { firstSync?: boolean }) => {
    const fresh = (d.clashRecords ?? []).filter((r) => !shown.has(r.id));
    fresh.forEach((r) => shown.add(r.id));
    return opts?.firstSync ? [] : fresh;
  }),
}));
let behind = false;
let mergedRecords: ClashRecord[] = [];
let mergedFirstSync = false;
vi.mock("../lib/syncService", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/syncService")>();
  return {
    fetchAndMerge: vi.fn(async () => ({
      ok: true, mergedData: seed, serverCopy: seed, localChanged: false, serverBehind: behind,
      addedFromServer: 0, conflictDetails: [], clashes: [], nonTransactionDivergence: [], replacedCloses: [], firstSync: false,
    })),
    pullFromServer: vi.fn(async () => ({ ok: false, error: "none" })),
    pushToServer: vi.fn(async () => ({ ok: false, conflict: true, error: "Server data has changed since your last sync." })),
    recordMergeStored: vi.fn(async () => {}), // DI-15
    mergeAndPush: vi.fn(async () => ({
      ok: true, syncedAt: "2026-10-08T09:01:00.000Z", addedFromServer: 0, conflictsResolved: 0, conflicts: [], conflictDetails: [],
      clashes: [], nonTransactionDivergence: [], replacedCloses: [], mergedData: { ...seed, clashRecords: mergedRecords }, firstSync: mergedFirstSync,
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

const INCOME: ClashRecord = { id: "r-income", at: new Date().toISOString(), key: "income", kind: "setting", setting: "income", kept: 3600, other: 3500 };
const SENTENCE = "Both devices changed your income — kept $3,600 (the other device had $3,500).";

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
beforeEach(() => { shown.clear(); behind = false; mergedRecords = []; mergedFirstSync = false; });

it("the conflict merge: the change it settled is shown", { timeout: 20000 }, async () => {
  seed = settled();
  behind = true; // the fetch finds the server behind, so the dashboard pushes, and the push meets the conflict merge
  mergedRecords = [INCOME];
  render(<Home />);
  expect(await screen.findByText(SENTENCE, undefined, { timeout: 10000 })).toBeTruthy();
});

it("the conflict merge on a device's first sync takes the copy's records as shown (session 7)", { timeout: 20000 }, async () => {
  seed = settled();
  behind = true;
  mergedRecords = [INCOME];
  mergedFirstSync = true;
  render(<Home />);
  await waitFor(() => expect(shown.has(INCOME.id)).toBe(true), { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 500));
  expect(screen.queryByText(SENTENCE)).toBeNull();
});

it("opening ESSA on data holding a record this device hasn't shown shows it", { timeout: 20000 }, async () => {
  seed = settled({ clashRecords: [INCOME] });
  render(<Home />);
  expect(await screen.findByText(SENTENCE, undefined, { timeout: 10000 })).toBeTruthy();
});

it("with backup off there is no fetch: the copy it opened with is checked, and the record shown", { timeout: 20000 }, async () => {
  seed = settled({ clashRecords: [INCOME], syncChoice: { enabled: false, decidedAt: "2026-09-28T12:00:00.000Z" } });
  render(<Home />);
  expect(await screen.findByText(SENTENCE, undefined, { timeout: 10000 })).toBeTruthy();
});

it("a record this device has shown is never shown again", { timeout: 20000 }, async () => {
  shown.add(INCOME.id);
  seed = settled({ clashRecords: [INCOME] });
  render(<Home />);
  await screen.findByRole("button", { name: "Setup" }, { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 800));
  expect(screen.queryByText(SENTENCE)).toBeNull();
});
