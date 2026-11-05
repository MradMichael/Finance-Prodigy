// PWA P3 (owner-approved wording, 2026-11-05): the home screen's offline notice, wired to the page's own
// backup state. Backup on: sentence A (its promise is proven by page.offline-edit-retry.test.tsx). Backup off:
// sentence B. Online: neither. The harness is page.backup-retry.test.tsx's.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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




import { OFFLINE_BACKS_UP, OFFLINE_SAVED_HERE } from "../components/OfflineNotice";

let online = true;
beforeEach(() => { online = true; Object.defineProperty(navigator, "onLine", { configurable: true, get: () => online }); });
async function open() {
  render(<Home />);
  await screen.findByRole("button", { name: "Setup" }, { timeout: 10000 });
}

describe("the offline notice on the home screen", () => {
  it("backup on: says changes back up when you reconnect", async () => {
    online = false;
    await open();
    expect(await screen.findByText(OFFLINE_BACKS_UP)).toBeTruthy();
    expect(screen.queryByText(OFFLINE_SAVED_HERE)).toBeNull();
  });

  it("backup off: says only that changes are saved on this device", async () => {
    online = false;
    seed = { ...seed, syncChoice: { enabled: false, decidedAt: "2026-09-28T12:00:00.000Z" } } as LocalFinancials;
    await open();
    expect(await screen.findByText(OFFLINE_SAVED_HERE)).toBeTruthy();
    expect(screen.queryByText(OFFLINE_BACKS_UP)).toBeNull();
  });

  it("online: says neither", async () => {
    await open();
    expect(screen.queryByText(OFFLINE_BACKS_UP)).toBeNull();
    expect(screen.queryByText(OFFLINE_SAVED_HERE)).toBeNull();
  });
});
