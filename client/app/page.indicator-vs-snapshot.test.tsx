// Small fix (owner, 2026-10-07): the monthly-snapshot save on load cleared a
// fetch failure's indicator before it was ever shown. handleChange resets the
// indicator to idle on every save ("clear stale status while the user is
// typing"), and the snapshot and purge effects save through it on the first
// open of a cycle -- right as step 3's fetch reports its failure.
//
// Automatic saves (snapshot, purge) no longer touch the indicator; a user's
// edit still clears a stale one as before.
//
// The first fixture is deliberately NOT settled: the snapshot save runs on
// load. The others are settled, so the only save is the one under test.
import { it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { LocalFinancials, StoredTransaction, StoredRecurring } from "../lib/localData";

const SESSION = { userId: "u1", email: "u1@example.com", name: "U One" };
vi.mock("next/navigation", () => ({ useRouter: () => ROUTER }));
const ROUTER = { replace: vi.fn(), push: vi.fn() };
vi.mock("../lib/auth", () => ({ getSession: () => SESSION, hasValidSession: () => true, signOut: vi.fn() }));
let seed: LocalFinancials;
const saved: LocalFinancials[] = [];
vi.mock("../lib/localData", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/localData")>();
  return {
    ...actual,
    loadData: vi.fn(async () => seed),
    // A save that takes a moment, so it settles after the fetch's failure, as on a real device.
    saveData: vi.fn(async (d: LocalFinancials) => { await new Promise((r) => setTimeout(r, 50)); saved.push(d); }),
  };
});
vi.mock("../lib/syncService", () => ({
  fetchAndMerge: vi.fn(async () => ({ ok: false, error: "Pull failed (HTTP 503)." })),
  pullFromServer: vi.fn(async () => ({ ok: false, error: "none" })),
  pushToServer: vi.fn(async () => ({ ok: true })),
  mergeAndPush: vi.fn(async () => ({ ok: false })),
  buildMergeNoticeText: () => ({ text: "", showReviewLink: false }),
  hasAutoPulled: () => true, markAutoPulled: vi.fn(), getLastSyncTime: () => "2026-10-05T08:00:00.000Z",
  checkEmailExists: vi.fn(async () => true), applyBackupChoice: vi.fn(),
}));

import Home from "./page";
import { fetchAndMerge } from "../lib/syncService";
import { DEFAULT_DATA, cycleStartDayOf } from "../lib/localData";
import { computeDashboard } from "../lib/computeDashboard";
import { currentCycleKey, calendarKeyForDate } from "../lib/period";

const ON = { enabled: true, decidedAt: "2026-09-28T12:00:00.000Z" };
const FAILED = "Couldn't reach backup";
const showsFailure = () => screen.getAllByRole("status").some((s) => s.textContent === FAILED);

/** Data whose monthly snapshots are already current, so opening writes nothing. */
function settled(extra: Partial<LocalFinancials>): LocalFinancials {
  const base = { ...DEFAULT_DATA, income: 3000, syncChoice: ON, ...extra } as LocalFinancials;
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

async function openAndSettle() {
  saved.length = 0;
  vi.mocked(fetchAndMerge).mockClear();
  render(<Home />);
  await screen.findByRole("button", { name: "Setup" }, { timeout: 10000 });
}

it("a fetch failure on open is shown, even while the snapshot saves", async () => {
  seed = { ...DEFAULT_DATA, income: 3000, syncChoice: ON } as LocalFinancials;
  await openAndSettle();
  await waitFor(() => expect(saved.length).toBeGreaterThan(0)); // premise: the snapshot really saved
  expect(fetchAndMerge).toHaveBeenCalled(); // premise: the fetch on open really failed
  await new Promise((r) => setTimeout(r, 300));
  expect(showsFailure()).toBe(true);
});

it("a fetch failure on open is shown, even while the 30-day purge saves", async () => {
  const deletedAt = new Date(Date.now() - 40 * 86_400_000).toISOString();
  const gone = { id: "t-old", description: "Old receipt", amount: 12, currency: "USD", bucket: "WANTS", category: "dining",
    date: deletedAt.slice(0, 10), updatedAt: deletedAt, deletedAt } as StoredTransaction;
  seed = settled({ transactions: [gone] });
  await openAndSettle();
  await waitFor(() => expect(saved.some((d) => d.transactions[0]?.purgedAt)).toBe(true)); // premise: the purge really saved
  expect(saved).toHaveLength(1); // and nothing else did
  expect(fetchAndMerge).toHaveBeenCalled();
  await new Promise((r) => setTimeout(r, 300));
  expect(showsFailure()).toBe(true);
});

it("an edit by the user still clears a stale failure", async () => {
  const rent: StoredRecurring = {
    id: "r-rent", name: "Rent", emoji: "🏠", amount: 900, currency: "USD", frequency: "monthly", bucket: "NEEDS",
    startDate: "2027-06-01", endDate: null, totalAmount: null, createdAt: "2026-09-01T09:00:00.000Z", confirmCutoverDate: "2026-09-01",
  };
  seed = settled({ recurring: [rent] });
  await openAndSettle();
  await waitFor(() => expect(showsFailure()).toBe(true)); // premise: the failure is up
  expect(saved).toHaveLength(0); // premise: nothing automatic saved
  fireEvent.click(screen.getByRole("button", { name: "Got it" }));
  await waitFor(() => expect(saved).toHaveLength(1));
  await waitFor(() => expect(showsFailure()).toBe(false), { timeout: 1000 }); // well before the 4-second fade
});
