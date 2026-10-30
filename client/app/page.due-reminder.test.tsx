// The due-date reminder, wired into the app (session 31). Yes goes through the
// dashboard's own confirm, so it stores exactly what Renewing soon's Confirm
// stores; nothing shows behind the backup choice prompt or the one-time
// recurring-model notice.
import { it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
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

const rentTx = (): StoredTransaction => saved.flatMap((d) => d.transactions).find((t) => t.recurringId === "r-rent")!;
const comparable = ({ id: _i, createdAt: _c, updatedAt: _u, ...rest }: StoredTransaction) => rest;

it("the banner's Yes stores exactly what Renewing soon's Confirm stores", async () => {
  render(<Home />);
  const region = await screen.findByRole("region", { name: "Payment reminder" }, { timeout: 10000 });
  expect(region.textContent).toContain("Rent is due today ($500.00). Is it paid?");
  fireEvent.click(screen.getByRole("button", { name: "Yes, it's paid" }));
  await waitFor(() => expect(rentTx()).toBeTruthy());
  const fromBanner = comparable(rentTx());
  await waitFor(() => expect(screen.getByText("Logged Rent, $500.00.")).toBeTruthy());
  cleanup(); saved.length = 0;

  render(<Home />);
  fireEvent.click(await screen.findByTitle("Confirm this Rent payment", undefined, { timeout: 10000 }));
  await waitFor(() => expect(rentTx()).toBeTruthy());
  expect(fromBanner).toEqual(comparable(rentTx()));
  expect(fromBanner).toMatchObject({ recurringId: "r-rent", cycleDate: "2026-10-15", amount: 500 });
}, 20000);

it("Not yet hides it and stores nothing", async () => {
  render(<Home />);
  await screen.findByRole("region", { name: "Payment reminder" }, { timeout: 10000 });
  const before = saved.length;
  fireEvent.click(screen.getByRole("button", { name: "Not yet" }));
  expect(screen.queryByRole("region", { name: "Payment reminder" })).toBeNull();
  expect(saved.length).toBe(before);
}, 20000);

it("not behind the backup choice prompt", async () => {
  seed = { syncChoice: undefined }; // undecided: the prompt asks (check-email says a copy exists)
  render(<Home />);
  await screen.findByRole("button", { name: "Keep backing up" }, { timeout: 10000 });
  expect(screen.queryByRole("region", { name: "Payment reminder" })).toBeNull();
}, 20000);

it("not behind the one-time recurring-model notice", async () => {
  seed = {
    recurringModelNoticeSeen: false,
    recurring: [{ id: "r-rent", name: "Rent", emoji: "🏠", amount: 500, currency: "USD", frequency: "monthly", bucket: "NEEDS",
      startDate: "2026-10-15", endDate: null, totalAmount: null, createdAt: "2026-10-01T00:00:00.000Z", confirmCutoverDate: "2026-10-01" }],
  } as Partial<LocalFinancials>;
  render(<Home />);
  await screen.findByTitle("Confirm this Rent payment", undefined, { timeout: 10000 }); // the dashboard is up
  expect(screen.queryByRole("region", { name: "Payment reminder" })).toBeNull();
}, 20000);
