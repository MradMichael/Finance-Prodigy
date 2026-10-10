// A11Y-03 (blind-spot audit) on the dashboard: the merge notice and the sync
// status changed silently for a screen reader. The sync indicator is a
// coloured dot, with text only while the desktop sidebar is hovered.
//
// Now the merge notice sits in a polite live region that's on the page
// before a notice arrives, and the sync status is mirrored, in its existing
// long labels (SyncDot), into a visually hidden live region. No new wording.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
let fetched: unknown;
vi.mock("../lib/syncService", () => ({
  fetchAndMerge: vi.fn(async () => fetched),
  pullFromServer: vi.fn(async () => ({ ok: false, error: "none" })),
  pushToServer: vi.fn(async () => ({ ok: true })),
  mergeAndPush: vi.fn(async () => ({ ok: false })),
  buildMergeNoticeText: (added: number) => ({ text: added ? `Merged with your other device — ${added} new transaction added.` : "", showReviewLink: false }),
  hasAutoPulled: () => true, markAutoPulled: vi.fn(), serverCopyExists: vi.fn(async () => null), getLastSyncTime: () => null,
  checkEmailExists: vi.fn(async () => true), applyBackupChoice: vi.fn(),
}));

import Home from "./page";
import { DEFAULT_DATA, cycleStartDayOf } from "../lib/localData";
import { computeDashboard } from "../lib/computeDashboard";
import { currentCycleKey, calendarKeyForDate } from "../lib/period";

const ON = { enabled: true, decidedAt: "2026-09-28T12:00:00.000Z" };
/** Monthly snapshots already current, so the load-time snapshot write (which resets the indicator) doesn't run. */
function settled(): LocalFinancials {
  const base = { ...DEFAULT_DATA, income: 3000, syncChoice: ON } as LocalFinancials;
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
beforeEach(() => { seed = settled(); });

async function open() {
  render(<Home />);
  await screen.findByRole("button", { name: "Setup" }, { timeout: 10000 });
}

describe("A11Y-03: the dashboard announces what changed", () => {
  it("a merge notice appears inside a live region that was already there", async () => {
    fetched = { ok: true, mergedData: { ...seed, transactions: [] }, localChanged: false, serverBehind: false, addedFromServer: 1, conflictDetails: [], replacedCloses: [] };
    await open();
    const notice = await screen.findByText("Merged with your other device — 1 new transaction added.");
    expect(notice.closest('[role="status"]')).not.toBeNull();
  });

  it("a failed sync is announced in the indicator's own words", async () => {
    fetched = { ok: false, error: "Pull failed (HTTP 503)." };
    await open();
    await waitFor(() => expect(screen.getAllByRole("status").some((s) => s.textContent === "Couldn't reach backup")).toBe(true));
  });
});
