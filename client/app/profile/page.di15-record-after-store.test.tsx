// DI-15 on Profile → Merge: the merge reaches the server, then Profile stores
// the merged copy. Only once that store succeeds does it record the sync;
// when the store fails, it leaves the previous record as it was (owner,
// session 8), and says what it already says: the merge reached the server but
// couldn't be saved here.
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import type { LocalFinancials } from "../../lib/localData";

const SESSION = { userId: "u1", email: "u1@example.com", name: "U One" };
const ROUTER = { replace: vi.fn(), push: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => ROUTER }));
vi.mock("../../lib/auth", () => ({
  getSession: () => SESSION, hasValidSession: () => true, signOut: vi.fn(), updateProfile: vi.fn(),
  deleteAccount: vi.fn(), ensureFirstUserIsAdmin: vi.fn(), regenerateRecoveryCode: vi.fn(),
}));
const log: string[] = [];
const MERGED_INCOME = 3700;
let storeFails = false;
vi.mock("../../lib/localData", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/localData")>();
  return {
    ...actual,
    saveData: vi.fn(async (d: LocalFinancials, u: string) => {
      if (d.income === MERGED_INCOME) {
        if (storeFails) { log.push("store failed"); throw new DOMException("The quota has been exceeded.", "QuotaExceededError"); }
        log.push("stored");
      }
      return actual.saveData(d, u);
    }),
  };
});
const recordMergeStored = vi.fn(async (_u: string, _r: unknown) => { log.push("recorded"); });
// The old drop (session 7). It must not be called: a failed store keeps the previous record (owner, session 8).
const mergeNotStored = vi.fn((_u: string) => { log.push("record dropped"); });
let mergeResult: Record<string, unknown>;
vi.mock("../../lib/syncService", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/syncService")>();
  return {
    pushToServer: vi.fn(), pullFromServer: vi.fn(), getLastSyncTime: () => null, confirmOverwriteIfNeeded: vi.fn(async () => true),
    mergeAndPush: vi.fn(async () => mergeResult),
    recordMergeStored: (u: string, r: unknown) => recordMergeStored(u, r),
    mergeNotStored: (u: string) => mergeNotStored(u),
    buildMergeNoticeText: real.buildMergeNoticeText, applyBackupChoice: vi.fn(),
  };
});
vi.mock("../../lib/analytics", () => ({ isAnalyticsOptedIn: () => false, setAnalyticsOptIn: vi.fn() }));

import ProfilePage from "./page";
import { ThemeProvider } from "../../contexts/ThemeContext";
import { DEFAULT_DATA, saveData } from "../../lib/localData";
import { activateSessionKey } from "../../lib/crypto";

beforeEach(async () => {
  localStorage.clear(); sessionStorage.clear();
  activateSessionKey(new Uint8Array(32).fill(7));
  storeFails = false;
  await saveData({ ...DEFAULT_DATA, income: 3000 } as LocalFinancials, "u1");
  log.length = 0;
  recordMergeStored.mockClear(); mergeNotStored.mockClear();
  mergeResult = {
    ok: true, syncedAt: "2026-10-08T09:01:00.000Z", addedFromServer: 0, conflictsResolved: 0, conflicts: [], conflictDetails: [],
    clashes: [], nonTransactionDivergence: [], replacedCloses: [], mergedData: { ...DEFAULT_DATA, income: MERGED_INCOME }, firstSync: false,
  };
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function merge() {
  render(<ThemeProvider><ProfilePage /></ThemeProvider>);
  fireEvent.click(await screen.findByRole("button", { name: /Merge$/ }));
}

it("records the sync only once the merged copy is stored", async () => {
  await merge();
  expect(await screen.findByText("✓ Merged. Nothing new from your other device.")).toBeTruthy();
  await waitFor(() => expect(log).toContain("recorded"));
  expect(log).toEqual(["stored", "recorded"]);
  expect(recordMergeStored).toHaveBeenCalledWith("u1", mergeResult);
  expect(mergeNotStored).not.toHaveBeenCalled();
});

it("a store that fails records nothing and leaves the previous record as it was", async () => {
  storeFails = true;
  await merge();
  expect(await screen.findByText(/The merge reached the server, but couldn't be saved on this device\./)).toBeTruthy();
  expect(log).toEqual(["store failed"]);
  expect(mergeNotStored).not.toHaveBeenCalled();
  expect(recordMergeStored).not.toHaveBeenCalled();
});
