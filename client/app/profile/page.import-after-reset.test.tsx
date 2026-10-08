// DI-13 follow-up (owner, session 3): Profile's "Import from file" goes
// through restoreFromExport. Before, it stored the file as is: this device's
// deletion records (a reset's) were dropped here and still held everywhere
// else, so the next merge removed what the file had just restored, while a
// device that hadn't synced the reset could bring back what the file didn't
// hold. lib/restore-after-reset.test.ts covers the rule; this covers the wiring.
import { it, expect, vi } from "vitest";
import { render, waitFor, fireEvent } from "@testing-library/react";
import type { LocalFinancials, StoredTransaction } from "../../lib/localData";

const SESSION = { userId: "u1", email: "u1@example.com", name: "U One" };
const ROUTER = { replace: vi.fn(), push: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => ROUTER }));
vi.mock("../../lib/auth", () => ({
  getSession: () => SESSION, hasValidSession: () => true, signOut: vi.fn(), updateProfile: vi.fn(),
  deleteAccount: vi.fn(), ensureFirstUserIsAdmin: vi.fn(), regenerateRecoveryCode: vi.fn(),
}));
vi.mock("../../lib/syncService", () => ({
  pushToServer: vi.fn(), pullFromServer: vi.fn(), getLastSyncTime: () => null,
  confirmOverwriteIfNeeded: vi.fn(async () => true), mergeAndPush: vi.fn(), buildMergeNoticeText: () => ({ text: "" }),
  applyBackupChoice: vi.fn(),
}));
vi.mock("../../lib/analytics", () => ({ isAnalyticsOptedIn: () => false, setAnalyticsOptIn: vi.fn() }));
let current: LocalFinancials;
const saved: LocalFinancials[] = [];
vi.mock("../../lib/localData", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/localData")>();
  return { ...actual, loadData: vi.fn(async () => current), saveData: vi.fn(async (d: LocalFinancials) => { saved.push(d); }) };
});

import ProfilePage from "./page";
import { ThemeProvider } from "../../contexts/ThemeContext";
import { DEFAULT_DATA, resetFinancials } from "../../lib/localData";

const tx = (id: string): StoredTransaction => ({ id, amount: 46.8, currency: "USD", bucket: "WANTS", description: id, date: "2026-10-01", updatedAt: "2026-10-01T12:00:00.000Z" } as StoredTransaction);
const EXPORT = { ...DEFAULT_DATA, income: 3150.75, transactions: [tx("t-bistro")] } as LocalFinancials;

it("an import after a reset revives every key the file holds and keeps the reset's records", async () => {
  current = resetFinancials({ ...EXPORT, transactions: [tx("t-bistro"), tx("t-later")] } as LocalFinancials, new Date("2026-10-07T18:00:00.000Z"));
  render(<ThemeProvider><ProfilePage /></ThemeProvider>);
  const input = await waitFor(() => {
    const el = document.querySelector('input[type="file"]');
    if (!el) throw new Error("no file input yet");
    return el;
  });
  fireEvent.change(input, { target: { files: [new File([JSON.stringify(EXPORT)], "essa-data.json", { type: "application/json" })] } });
  await waitFor(() => expect(saved).toHaveLength(1));
  expect(saved[0].transactions.map((t) => t.id)).toEqual(["t-bistro"]);
  expect(saved[0].revivedKeys?.transactions).toEqual({ "t-bistro": 1 });
  // The reset's record for what the file lacks is kept, and in force.
  expect(saved[0].deletedKeys?.transactions?.map((t) => t.key)).toEqual(["t-bistro", "t-later"]);
});
