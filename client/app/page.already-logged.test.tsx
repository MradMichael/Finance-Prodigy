// TODO 121 (owner, session 63, item 2; option b; approved in full, session 64): "Already logged", wired into the app. Rent
// (due 15 Oct) was logged by hand on 13 Oct; the reminder names that row, and Already logged links it to the cycle
// through the page (handleChange), so nothing new is logged; Undo takes the link off again. The harness is
// page.due-reminder.test.tsx's.
import { it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import type { LocalFinancials, StoredTransaction } from "../lib/localData";

const SESSION = { userId: "u1", email: "u1@example.com", name: "U One" };
const ROUTER = { replace: vi.fn(), push: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => ROUTER }));
vi.mock("../lib/auth", () => ({ getSession: () => SESSION, hasValidSession: () => true, signOut: vi.fn() }));
const saved: LocalFinancials[] = [];
let seed: Partial<LocalFinancials> = {};
vi.mock("../lib/localData", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/localData")>();
  return {
    ...actual,
    loadData: vi.fn(async () => ({
      ...actual.DEFAULT_DATA, income: 3000, syncChoice: { enabled: false, decidedAt: "2026-10-01T08:00:00.000Z" },
      recurring: [{ id: "r-rent", name: "Rent", emoji: "🏠", amount: 500, currency: "USD", frequency: "monthly", bucket: "NEEDS",
        startDate: "2026-10-15", endDate: null, totalAmount: null, createdAt: "2026-10-01T00:00:00.000Z" }],
      ...seed,
    })),
    saveData: vi.fn(async (d: LocalFinancials) => { saved.push(d); }),
  };
});
const serverCopyExists = vi.fn(async (): Promise<boolean | null> => null);
vi.mock("../lib/syncService", () => ({
  fetchAndMerge: vi.fn(async () => ({ ok: false, error: "none", notFound: true })),
  pullFromServer: vi.fn(async () => ({ ok: false, error: "none" })),
  pushToServer: vi.fn(async () => ({ ok: true })),
  mergeAndPush: vi.fn(async () => ({ ok: false })),
  buildMergeNoticeText: () => ({ text: "", showReviewLink: false }),
  hasAutoPulled: () => true, markAutoPulled: vi.fn(), serverCopyExists: (...a: unknown[]) => serverCopyExists(...(a as [])), getLastSyncTime: () => null,
  checkEmailExists: vi.fn(async () => true), applyBackupChoice: vi.fn(),
}));

import Home from "./page";

beforeEach(() => { saved.length = 0; seed = {}; serverCopyExists.mockReset(); serverCopyExists.mockResolvedValue(null); vi.useFakeTimers({ now: new Date(2026, 9, 15, 10, 0), toFake: ["Date"] }); });
afterEach(() => { cleanup(); vi.useRealTimers(); });


const HAND: StoredTransaction = { id: "hand", amount: 500, currency: "USD", bucket: "NEEDS", description: "rent", date: "2026-10-13", paymentMethod: "cash", createdAt: "2026-10-13T09:00:00.000Z" };
const last = () => saved[saved.length - 1];

it("names the row logged by hand; Already logged links it (no new row), and Undo takes the link off", async () => {
  seed = { transactions: [HAND] };
  render(<Home />);
  const region = await screen.findByRole("region", { name: "Payment reminder" }, { timeout: 10000 });
  expect(region.textContent).toContain("Rent is due today ($500.00). Is it paid?");
  expect(region.textContent).toContain("You logged rent on 13/10/2026 ($500.00).");
  // Each step waits for what it checks (5 s, as the page's other tests allow for a loaded machine): a save is seen
  // in `saved` before React has necessarily shown it.
  const wait = { timeout: 5000 };
  const reminder = () => screen.getByRole("region", { name: "Payment reminder" });
  // The page stores its monthly snapshot on load. Until session 64 an edit that landed before that effect ran was
  // overwritten by it (AUDIT 2.4.170, fixed in PR #10). The click still waits for that save, so the last save read
  // below is the link's (or the snapshot's on top of it), as page.due-reminder.test.tsx's "Not yet" does.
  await waitFor(() => expect(saved.some((d) => (d.netWorthHistory ?? []).length > 0)).toBe(true), wait);
  // The reminder's Already logged (TODO 124 put one on the item's Renewing soon chip too).
  fireEvent.click(within(reminder()).getByRole("button", { name: "Already logged" }));
  await waitFor(() => expect(last()?.transactions.find((t) => t.id === "hand")?.recurringId).toBe("r-rent"), wait);
  expect(last().transactions).toHaveLength(1);
  expect(last().transactions[0]).toMatchObject({ id: "hand", amount: 500, date: "2026-10-13", recurringId: "r-rent", cycleDate: "2026-10-15" });
  await waitFor(() => expect(within(reminder()).getByRole("status").textContent).toBe("Rent: your entry of 13/10/2026 now counts as this payment. Nothing new was logged."), wait);
  await waitFor(() => expect(screen.queryByRole("button", { name: "Yes, it's paid" })).toBeNull(), wait); // the cycle is paid: nothing left to ask
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  await waitFor(() => expect(last().transactions.find((t) => t.id === "hand")?.recurringId).toBeUndefined(), wait);
  expect(last().transactions).toHaveLength(1);
  expect(last().transactions[0].cycleDate).toBeUndefined();
  await waitFor(() => expect(reminder().textContent).toContain("Rent is due today ($500.00). Is it paid?"), wait);
  expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
}, 20000);

it("nothing logged by hand: no line and no Already logged (the reminder as before)", async () => {
  render(<Home />);
  const region = await screen.findByRole("region", { name: "Payment reminder" }, { timeout: 10000 });
  expect(region.textContent).not.toContain("You logged");
  expect(screen.queryByRole("button", { name: "Already logged" })).toBeNull();
}, 20000);
