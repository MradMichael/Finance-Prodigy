// TODO 124 (owner, session 64, item 3): "Already logged" on the other Confirm buttons, wired into the app. Rent is due
// on 15 October (in 2 days: on the Overview's chips and Recurring's due line, not yet on the reminder) and was logged
// by hand on the 13th. On each of the three surfaces, Already logged links that row to the cycle through the page
// (handleChange), so nothing new is logged. The harness is page.already-logged.test.tsx's.
import { it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import type { LocalFinancials, StoredTransaction } from "../lib/localData";

const SESSION = { userId: "u1", email: "u1@example.com", name: "U One" };
const ROUTER = { replace: vi.fn(), push: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => ROUTER }));
vi.mock("../lib/auth", () => ({ getSession: () => SESSION, hasValidSession: () => true, signOut: vi.fn() }));
const saved: LocalFinancials[] = [];
const HAND: StoredTransaction = { id: "hand", amount: 500, currency: "USD", bucket: "NEEDS", description: "rent", date: "2026-10-13", paymentMethod: "cash", createdAt: "2026-10-13T09:00:00.000Z" };
vi.mock("../lib/localData", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/localData")>();
  return {
    ...actual,
    loadData: vi.fn(async () => ({
      ...actual.DEFAULT_DATA, income: 3000, syncChoice: { enabled: false, decidedAt: "2026-10-01T08:00:00.000Z" },
      recurring: [{ id: "r-rent", name: "Rent", emoji: "🏠", amount: 500, currency: "USD", frequency: "monthly", bucket: "NEEDS",
        startDate: "2026-10-15", endDate: null, totalAmount: null, createdAt: "2026-10-01T00:00:00.000Z" }],
      transactions: [HAND],
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

beforeEach(() => { saved.length = 0; vi.useFakeTimers({ now: new Date(2026, 9, 13, 10, 0), toFake: ["Date"] }); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

const last = () => saved[saved.length - 1];
const wait = { timeout: 5000 };
const NOTICE = "Rent: your entry of 13/10/2026 now counts as this payment. Nothing new was logged.";

async function opened() {
  render(<Home />);
  await screen.findByText("Renewing soon", undefined, { timeout: 10000 });
  // The load-time snapshot's save first, so the last save read below is the link's (or the snapshot on top of it).
  await waitFor(() => expect(saved.some((d) => (d.netWorthHistory ?? []).length > 0)).toBe(true), wait);
  expect(screen.queryByRole("region", { name: "Payment reminder" })).toBeNull(); // premise: due in 2 days, not asked yet
}
async function linkedOnce() {
  await waitFor(() => expect(last()?.transactions.find((t) => t.id === "hand")?.recurringId).toBe("r-rent"), wait);
  expect(last().transactions).toHaveLength(1); // nothing new was logged
  expect(last().transactions[0]).toMatchObject({ id: "hand", amount: 500, date: "2026-10-13", recurringId: "r-rent", cycleDate: "2026-10-15" });
  expect(await screen.findByText(NOTICE, undefined, wait)).toBeTruthy();
}

it("Overview: a Renewing soon chip's Already logged links the row logged by hand", async () => {
  await opened();
  fireEvent.click(screen.getByRole("button", { name: "Already logged" }));
  await linkedOnce();
}, 20000);

it("Recurring: the due line's Already logged links the row logged by hand", async () => {
  await opened();
  fireEvent.click(screen.getAllByRole("button", { name: "Recurring" })[0]);
  fireEvent.click(await screen.findByRole("button", { name: "Already logged" }, wait));
  await linkedOnce();
}, 20000);

it("My Finances: the row's Confirm payment form's Already logged links the row logged by hand", async () => {
  await opened();
  fireEvent.click(screen.getAllByRole("button", { name: "My Finances" })[0]);
  fireEvent.click(await screen.findByRole("button", { name: /Manage/ }, wait));
  fireEvent.click(await screen.findByRole("button", { name: /Recurring Payments/ }, wait));
  fireEvent.click(await screen.findByRole("button", { name: "Confirm this Rent payment" }, wait));
  fireEvent.click(await screen.findByRole("button", { name: "Already logged" }, wait));
  await linkedOnce();
}, 20000);
