// A11Y-05 on the screens (owner, session 8): the dashboard's main scrolling
// area holds Statistics' charts and nothing focusable, so a keyboard user
// couldn't scroll it (axe scrollable-region-focusable). With useScrollFocus it
// is a Tab stop there, and not on a screen whose controls Tab already
// reaches. Statistics' own wide table, which scrolls sideways, is one too.
//
// jsdom has no layout: here every element reports more content than it shows.
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import type { LocalFinancials, StoredTransaction } from "../lib/localData";

const SESSION = { userId: "u1", email: "u1@example.com", name: "U One" };
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("../lib/auth", () => ({ getSession: () => SESSION, hasValidSession: () => true, signOut: vi.fn() }));
let seed: LocalFinancials;
vi.mock("../lib/localData", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/localData")>();
  return { ...actual, loadData: vi.fn(async () => seed), saveData: vi.fn(async () => {}) };
});
vi.mock("../lib/syncSeen", () => ({ saveSeen: vi.fn(async () => {}), loadSeen: vi.fn(async () => null) }));
vi.mock("../lib/clashNotice", () => ({ takeUnseenClashes: vi.fn(async () => []) }));
vi.mock("../lib/syncService", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/syncService")>();
  return {
    fetchAndMerge: vi.fn(async () => ({ ok: true, skipped: true })),
    pullFromServer: vi.fn(async () => ({ ok: false, error: "none" })),
    pushToServer: vi.fn(async () => ({ ok: true, syncedAt: "2026-10-08T09:01:00.000Z" })),
    mergeAndPush: vi.fn(), recordMergeStored: vi.fn(), buildMergeNoticeText: real.buildMergeNoticeText,
    hasAutoPulled: () => true, markAutoPulled: vi.fn(), getLastSyncTime: () => "2026-10-05T08:00:00.000Z",
    checkEmailExists: vi.fn(async () => true), applyBackupChoice: vi.fn(),
  };
});

import Home from "./page";
import StatisticsScreen from "../components/screens/StatisticsScreen";
import { ThemeProvider } from "../contexts/ThemeContext";
import { DEFAULT_DATA, cycleStartDayOf } from "../lib/localData";
import { computeDashboard } from "../lib/computeDashboard";
import { currentCycleKey, calendarKeyForDate } from "../lib/period";

const props = ["scrollHeight", "clientHeight", "scrollWidth", "clientWidth"] as const;
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, get: () => 900 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 100 });
  Object.defineProperty(HTMLElement.prototype, "scrollWidth", { configurable: true, get: () => 900 });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 100 });
});
afterEach(() => { cleanup(); for (const p of props) delete (HTMLElement.prototype as unknown as Record<string, unknown>)[p]; });

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
const scrollArea = (inside: HTMLElement) => inside.closest<HTMLElement>('[style*="overflow-y: auto"]')!;

/** axe's scrollable-region-focusable, for every scrolling area: it is a Tab stop, or something in it is. */
const TAB_STOPS = 'a[href], button, input:not([type="hidden"]), select, textarea, [tabindex]';
function reachable(area: HTMLElement): boolean {
  if (area.getAttribute("tabindex") === "0") return true;
  return Array.from(area.querySelectorAll<HTMLElement>(TAB_STOPS)).some((e) => e.tabIndex >= 0 && !(e as HTMLButtonElement).disabled);
}
const scrollingAreas = () => Array.from(document.querySelectorAll<HTMLElement>('[style*="overflow-y: auto"], .overflow-x-auto, .overflow-y-auto'));

it("every scrolling area on Statistics can be reached from the keyboard; Overview's main area, full of controls, isn't made a Tab stop", { timeout: 20000 }, async () => {
  seed = settled();
  render(<Home />);
  const nav = await screen.findAllByRole("button", { name: "Statistics" }, { timeout: 10000 });
  const overviewArea = scrollingAreas().find((el) => el.style.overflowY === "auto" && el.querySelector("button"))!;
  expect(overviewArea.hasAttribute("tabindex")).toBe(false);
  fireEvent.click(nav[0]);
  const heading = await screen.findByText("Monthly book (USD)");
  const main = scrollArea(heading);
  await waitFor(() => expect(scrollingAreas().filter((a) => main.contains(a)).every(reachable)).toBe(true));
});

it("Statistics with nothing to tabulate: its main area, holding nothing focusable, is itself the Tab stop", { timeout: 20000 }, async () => {
  seed = { ...DEFAULT_DATA, income: 0, syncChoice: { enabled: true, decidedAt: "2026-09-28T12:00:00.000Z" } } as LocalFinancials;
  render(<Home />);
  const nav = await screen.findAllByRole("button", { name: "Statistics" }, { timeout: 10000 });
  fireEvent.click(nav[0]);
  const heading = await screen.findByText("Monthly book (USD)");
  const main = scrollArea(heading);
  expect(document.querySelector("table")).toBeNull();
  expect(Array.from(main.querySelectorAll<HTMLElement>(TAB_STOPS)).filter((el) => el !== main && el.tabIndex >= 0)).toEqual([]);
  await waitFor(() => expect(main.getAttribute("tabindex")).toBe("0"));
});

it("Statistics' wide table, which scrolls sideways with nothing focusable in it, is a Tab stop", () => {
  const tx = (id: string, bucket: StoredTransaction["bucket"], amount: number, date: string) => ({ id, amount, currency: "USD", bucket, description: id, date }) as StoredTransaction;
  const data = { ...DEFAULT_DATA, income: 3000, transactions: [tx("i", "INCOME", 3000, "2026-09-05"), tx("n", "NEEDS", 900, "2026-09-10")] } as LocalFinancials;
  render(<ThemeProvider><StatisticsScreen financials={data} dashData={computeDashboard(data)} /></ThemeProvider>);
  const table = document.querySelector("table")!;
  const wrapper = table.parentElement!;
  expect(wrapper.className).toContain("overflow-x-auto");
  expect(wrapper.getAttribute("tabindex")).toBe("0");
});
