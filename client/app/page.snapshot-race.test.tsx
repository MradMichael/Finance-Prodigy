// AUDIT 2.4.170 (owner, session 64, item 1): an edit stored before the load-time monthly snapshot save was
// overwritten by it. The snapshot effect built its copy from the render it belonged to, so an edit that landed after
// that render committed and before its effects ran was replaced, on screen and in storage. The click here is fired
// from a MutationObserver the moment the button appears: right after React's commit, before that render's passive
// effects run (session 63's experiment, `zz-race-yes`). The harness is page.due-reminder.test.tsx's.
import { it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import type { LocalFinancials } from "../lib/localData";

const SESSION = { userId: "u1", email: "u1@example.com", name: "U One" };
const ROUTER = { replace: vi.fn(), push: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => ROUTER }));
vi.mock("../lib/auth", () => ({ getSession: () => SESSION, hasValidSession: () => true, signOut: vi.fn() }));
const saved: LocalFinancials[] = [];
vi.mock("../lib/localData", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/localData")>();
  return {
    ...actual,
    loadData: vi.fn(async () => ({
      ...actual.DEFAULT_DATA, income: 3000, syncChoice: { enabled: false, decidedAt: "2026-10-01T08:00:00.000Z" },
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

beforeEach(() => { saved.length = 0; vi.useFakeTimers({ now: new Date(2026, 9, 15, 10, 0), toFake: ["Date"] }); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

const last = () => saved[saved.length - 1];
const confirmRows = (d: LocalFinancials | undefined) => (d?.transactions ?? []).filter((t) => t.recurringId === "r-rent");
const settle = () => new Promise((r) => setTimeout(r, 300));

it("an edit made right after the account's first render, before its effects run, is kept, and the snapshot is saved on top of it", async () => {
  let clicked = false;
  const mo = new MutationObserver(() => {
    if (clicked) return;
    const yes = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Yes, it's paid");
    if (yes) { clicked = true; mo.disconnect(); fireEvent.click(yes); }
  });
  mo.observe(document.body, { childList: true, subtree: true });
  render(<Home />);
  await waitFor(() => expect(clicked).toBe(true), { timeout: 10000 });
  await waitFor(() => expect(last()?.netWorthHistory?.length).toBe(1), { timeout: 5000 });
  await settle();
  // Before the fix, the snapshot's save came last and held no confirmation: the payment was gone.
  expect(confirmRows(last())).toHaveLength(1);
  expect(confirmRows(last())[0].cycleDate).toBe("2026-10-15");
  expect(last().netWorthHistory).toHaveLength(1);
  // And the screen shows the kept payment: the reminder no longer asks about Rent.
  await waitFor(() => expect(screen.queryByText("Rent is due today ($500.00). Is it paid?")).toBeNull());
}, 20000);

it("with no edit, the snapshot is saved once at load", async () => {
  render(<Home />);
  await screen.findByRole("region", { name: "Payment reminder" }, { timeout: 10000 });
  await waitFor(() => expect(saved.length).toBeGreaterThan(0), { timeout: 5000 });
  await settle();
  expect(saved).toHaveLength(1);
  expect(last().netWorthHistory).toHaveLength(1);
  expect(confirmRows(last())).toHaveLength(0);
}, 20000);
