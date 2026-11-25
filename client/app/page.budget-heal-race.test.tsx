// AUDIT 2.4.174 (owner, session 65, item 1): Budget's one-time split heal wrote the copy of the render it belonged to,
// so an edit stored after that render committed and before its effect ran was replaced, on screen and in storage
// (2.4.170's window, closed for the monthly snapshot by PR #10). The window opens when Budget's first render is
// scheduled rather than the answer to a tap: in production, when its code arrives on a first visit before the idle
// preload has fetched it (screens.lazy.tsx). So this file uses the real lazy screens, not the test alias
// (vitest.config.ts), and holds the idle preload off. The click is fired from a MutationObserver the moment Budget's
// first render is on the page, before that render's effects run. The split is stored at 85/15 (Savings 0%), which the
// heal floors to 85/10.
import { it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import type { LocalFinancials } from "../lib/localData";

const SESSION = { userId: "u1", email: "u1@example.com", name: "U One" };
const ROUTER = { replace: vi.fn(), push: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => ROUTER }));
vi.mock("../lib/auth", () => ({ getSession: () => SESSION, hasValidSession: () => true, signOut: vi.fn() }));
// The page's own import ("./screens.lazy") is aliased to the plain screens under vitest; this hands it the real ones.
vi.mock("./screens.lazy", async () => await vi.importActual<typeof import("../app/screens.lazy")>("../app/screens.lazy"));
const saved: LocalFinancials[] = [];
vi.mock("../lib/localData", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/localData")>();
  return {
    ...actual,
    loadData: vi.fn(async () => ({
      ...actual.DEFAULT_DATA, income: 3000, syncChoice: { enabled: false, decidedAt: "2026-10-01T08:00:00.000Z" },
      budgetRule: "custom", budgetCustomNeeds: 85, budgetCustomWants: 15,
      recurring: [{ id: "r-rent", name: "Rent", emoji: "🏠", amount: 500, currency: "USD", frequency: "monthly", bucket: "NEEDS",
        startDate: "2026-10-15", endDate: null, totalAmount: null, createdAt: "2026-10-01T00:00:00.000Z" }],
    })),
    saveData: vi.fn(async (d: LocalFinancials) => { saved.push(d); }),
  };
});
vi.mock("../lib/syncService", () => ({
  fetchAndMerge: vi.fn(async () => ({ ok: false, error: "none", notFound: true })),
  pullFromServer: vi.fn(async () => ({ ok: false, error: "none" })),
  pushToServer: vi.fn(async () => ({ ok: true })),
  mergeAndPush: vi.fn(async () => ({ ok: false })),
  buildMergeNoticeText: () => ({ text: "", showReviewLink: false }),
  hasAutoPulled: () => true, markAutoPulled: vi.fn(), serverCopyExists: vi.fn(async () => null), getLastSyncTime: () => null,
  checkEmailExists: vi.fn(async () => true), applyBackupChoice: vi.fn(),
}));

import Home from "./page";

beforeEach(() => {
  saved.length = 0;
  vi.useFakeTimers({ now: new Date(2026, 9, 15, 10, 0), toFake: ["Date"] });
  // The idle preload never comes, so Budget's code is fetched only when Budget opens (a first visit). jsdom has no
  // requestIdleCallback of its own (the page falls back to a 2-second timer without it).
  Object.assign(window, { requestIdleCallback: () => 0, cancelIdleCallback: () => {} });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Reflect.deleteProperty(window, "requestIdleCallback");
  Reflect.deleteProperty(window, "cancelIdleCallback");
});

const last = () => saved[saved.length - 1];
const confirmRows = (d: LocalFinancials | undefined) => (d?.transactions ?? []).filter((t) => t.recurringId === "r-rent");
const healed = (d: LocalFinancials | undefined) => d?.budgetCustomNeeds === 85 && d?.budgetCustomWants === 10 && !!d?.budgetSplitHealedAt;
const settle = () => new Promise((r) => setTimeout(r, 300));
const budgetShown = () => Array.from(document.querySelectorAll("h2")).some((h) => h.textContent === "Budget model");

async function openedAccount() {
  render(<Home />);
  await screen.findByRole("region", { name: "Payment reminder" }, { timeout: 10000 });
  // The load-time snapshot is saved first, so it can't stand in for the edit (page.due-reminder.test.tsx's wait).
  await waitFor(() => expect(last()?.netWorthHistory?.length).toBe(1), { timeout: 5000 });
  await settle();
  expect(budgetShown()).toBe(false);
}

it("an edit made right after Budget's first render, before its effect runs, is kept, and the heal is saved on top of it", async () => {
  await openedAccount();
  const before = saved.length;
  let clicked = false;
  const mo = new MutationObserver(() => {
    if (clicked || !budgetShown()) return;
    clicked = true; mo.disconnect();
    fireEvent.click(within(screen.getByRole("region", { name: "Payment reminder" })).getByRole("button", { name: "Yes, it's paid" }));
  });
  mo.observe(document.body, { childList: true, subtree: true });
  fireEvent.click(screen.getAllByRole("button", { name: "Budget" })[0]);
  await waitFor(() => expect(clicked).toBe(true), { timeout: 10000 });
  await waitFor(() => expect(healed(last())).toBe(true), { timeout: 5000 });
  await settle();
  expect(saved.length).toBeGreaterThan(before);
  // Before the fix, the heal's save came last and held no confirmation: the payment was gone.
  expect(confirmRows(last())).toHaveLength(1);
  expect(confirmRows(last())[0].cycleDate).toBe("2026-10-15");
  expect(healed(last())).toBe(true);
  expect(last().budgetSplitHealedFrom).toEqual({ needs: 85, wants: 15 });
  await waitFor(() => expect(screen.queryByText("Rent is due today ($500.00). Is it paid?")).toBeNull());
}, 20000);

it("with no edit, opening Budget saves the heal once, on the stored copy", async () => {
  await openedAccount();
  const before = saved.length;
  fireEvent.click(screen.getAllByRole("button", { name: "Budget" })[0]);
  await waitFor(() => expect(budgetShown()).toBe(true), { timeout: 10000 });
  await waitFor(() => expect(healed(last())).toBe(true), { timeout: 5000 });
  await settle();
  expect(saved.length - before).toBe(1);
  expect(last().budgetSplitHealedFrom).toEqual({ needs: 85, wants: 15 });
  expect(last().netWorthHistory).toHaveLength(1);
  expect(confirmRows(last())).toHaveLength(0);
}, 20000);
