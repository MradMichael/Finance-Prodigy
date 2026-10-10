// Session 4 item 7: Overview's Confirm confirms the cycle as of TODAY's
// calendar day. The case where the day decides: a weekly item whose cycles
// before the 1 Oct cutover are grandfathered. On 1 Oct, the cycle due
// yesterday (30 Sep) is neither overdue nor confirmed, so asking as of
// yesterday would confirm it; as of today the target is 7 Oct, the one
// Overview lists.
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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
      ...actual.DEFAULT_DATA, income: 3000,
      recurring: [{ id: "r-gym", name: "Gym", emoji: "🏋", amount: 20, currency: "USD", frequency: "weekly", bucket: "WANTS",
        startDate: "2026-09-02", endDate: null, totalAmount: null, createdAt: "2026-09-01T00:00:00.000Z", confirmCutoverDate: "2026-10-01" }],
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

afterEach(() => { vi.useRealTimers(); });

it("Confirm on Overview confirms the cycle Overview shows, as of today", async () => {
  vi.useFakeTimers({ now: new Date(2026, 9, 1, 10, 0), toFake: ["Date"] }); // 1 Oct, local morning
  render(<Home />);
  const confirm = await screen.findByTitle("Confirm this Gym payment", undefined, { timeout: 10000 });
  fireEvent.click(confirm);
  await waitFor(() => expect(saved.some((d) => d.transactions.some((t) => t.recurringId === "r-gym"))).toBe(true));
  const tx = saved.flatMap((d) => d.transactions).find((t) => t.recurringId === "r-gym")!;
  expect(tx.cycleDate).toBe("2026-10-07");
});
