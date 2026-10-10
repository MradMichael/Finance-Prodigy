// Session 10, item 2: another device ran "Reset all data" with backup on. Its
// empty copy, with a deletion recorded for every item it cleared (DI-13), is
// now the server's. This device opens ESSA: its fetch merges that copy in.
// What does it show?
//
// Until this branch: it cleared everything and said nothing (session 10's
// proof). Now it says so, in the owner's wording (lib/resetNotice.ts; session 11).
//
// The real fetchAndMerge, pushToServer and buildMergeNoticeText run; the
// server answers through a stubbed fetch. This device last synced the copy
// it holds (its record is that copy's), so every change is the other
// device's, unless a test adds one here.
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { DEFAULT_DATA, resetFinancials, cycleStartDayOf, type LocalFinancials, type StoredTransaction } from "../lib/localData";
import { computeDashboard } from "../lib/computeDashboard";
import { currentCycleKey, calendarKeyForDate, dayLabel } from "../lib/period";

const SESSION = { userId: "u1", email: "u1@example.test", name: "U One" };
const ROUTER = { replace: vi.fn(), push: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => ROUTER }));
vi.mock("../lib/auth", () => ({ getSession: () => SESSION, hasValidSession: () => true, signOut: vi.fn(), getRecoveryTokenForSync: () => null }));
vi.mock("../lib/crypto", async (importOriginal) => ({ ...(await importOriginal<typeof import("../lib/crypto")>()), getSyncToken: () => "token" }));
let store: LocalFinancials;
vi.mock("../lib/localData", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/localData")>();
  return { ...actual, loadData: vi.fn(async () => store), saveData: vi.fn(async (d: LocalFinancials) => { store = d; }) };
});
let lastSynced: LocalFinancials;
vi.mock("../lib/syncSeen", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/syncSeen")>();
  return { ...real, loadSeen: vi.fn(async () => real.seenOf(lastSynced)), saveSeen: vi.fn(async () => {}) };
});
vi.mock("../lib/clashNotice", () => ({ takeUnseenClashes: vi.fn(async () => []) }));
vi.mock("../lib/syncService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/syncService")>()),
  checkEmailExists: vi.fn(async () => true),
}));

import Home from "./page";

const today = new Date();
const day = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const tx = (id: string): StoredTransaction => ({ id, amount: 46.8, currency: "USD", bucket: "WANTS", category: "dining", description: id, date: day(today), updatedAt: today.toISOString() } as StoredTransaction);

/** The account as both devices held it before the reset, its monthly snapshots current. */
function settled(): LocalFinancials {
  const base = {
    ...DEFAULT_DATA, income: 3150.75, syncChoice: { enabled: true, decidedAt: "2026-09-28T12:00:00.000Z" },
    transactions: [tx("Quartz bistro"), tx("Harbor kettle")],
    goals: [{ id: "g1", name: "Laptop", emoji: "💻", targetAmount: 1200, currentAmount: 300, currency: "USD", targetDate: "2027-03-01", createdAt: "2026-05-01T09:00:00.000Z" }],
    debts: [{ id: "d1", name: "Card", openingBalance: 2000, balance: 2000, apr: 18, minPayment: 50, currency: "USD", createdAt: "2026-01-01T00:00:00.000Z" }],
  } as unknown as LocalFinancials;
  const dash = computeDashboard(base);
  const cycle = currentCycleKey(today, cycleStartDayOf(base));
  return {
    ...base,
    netWorthHistory: [{ ym: calendarKeyForDate(today), value: dash.netWorth.total }],
    incomeHistory: [{ ym: cycle, value: base.income }],
    lbpRateHistory: [{ ym: cycle, value: base.lbpRate }],
    budgetRuleHistory: [{ ym: cycle, ...dash.budgetTargetPct }],
  } as LocalFinancials;
}

const RESET_AT = new Date(today.getTime() - 60 * 60 * 1000);
let serverCopy: LocalFinancials;
beforeEach(() => {
  localStorage.clear();
  store = settled(); lastSynced = store;
  serverCopy = resetFinancials(store, RESET_AT); // the other device's reset, uploaded
  vi.stubGlobal("fetch", vi.fn(async (url: string) => String(url).includes("/pull")
    ? new Response(JSON.stringify({ data: serverCopy, syncedAt: RESET_AT.toISOString(), hasRecoveryCode: false }), { status: 200 })
    : new Response(JSON.stringify({ syncedAt: new Date().toISOString() }), { status: 200 })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("this device takes the reset: everything it held is cleared", { timeout: 30000 }, async () => {
  render(<Home />);
  await waitFor(() => expect(store.transactions.filter((t) => !t.deletedAt)).toHaveLength(0), { timeout: 10000 });
  expect(store.goals).toHaveLength(0);
  expect(store.debts).toHaveLength(0);
  expect(store.income).toBe(0);
});

/** The merge notice's text (the page's second live region; its first span, without the Dismiss button). */
const noticeText = () => screen.getAllByRole("status")[1].querySelector("span")?.textContent ?? "";

it("and says so (R1)", { timeout: 30000 }, async () => {
  render(<Home />);
  await waitFor(() => expect(noticeText()).toBe(`Your other device reset all data on ${dayLabel(RESET_AT)}. This device now matches it.`), { timeout: 10000 });
});

it("something added here since the last sync is kept, and the notice says so (R2)", { timeout: 30000 }, async () => {
  store = { ...store, transactions: [...store.transactions, tx("Vex lantern")] }; // added here, not yet backed up
  render(<Home />);
  await waitFor(() => expect(noticeText()).toBe(`Your other device reset all data on ${dayLabel(RESET_AT)}. This device now matches it, except for changes made here that hadn't been backed up yet.`), { timeout: 10000 });
  expect(store.transactions.filter((t) => !t.deletedAt).map((t) => t.id)).toEqual(["Vex lantern"]);
});

it("a device that held only settings is told too, and takes them (R1; owner, session 11)", { timeout: 30000 }, async () => {
  const { transactions: _t, goals: _g, debts: _d, ...rest } = settled();
  store = { ...rest, transactions: [], goals: [], debts: [] } as LocalFinancials; lastSynced = store;
  serverCopy = resetFinancials(store, RESET_AT);
  render(<Home />);
  await waitFor(() => expect(noticeText()).toBe(`Your other device reset all data on ${dayLabel(RESET_AT)}. This device now matches it.`), { timeout: 10000 });
  expect(store.income).toBe(0);
});

it("the device that ran the reset is told nothing", { timeout: 30000 }, async () => {
  store = serverCopy; lastSynced = serverCopy;
  render(<Home />);
  await screen.findByRole("button", { name: "Setup" }, { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 800));
  expect(noticeText()).toBe("");
});
