// Plan H 5d: Profile → Merge says what both devices changed, in the same
// words as the dashboard's notice: the merge's own clash records this device
// hasn't shown (lib/clashNotice.ts, real here: a session key is active), and,
// on a device's first merge with no record of a last sync, 2.4.52's sentence.
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { LocalFinancials } from "../../lib/localData";
import type { ClashRecord } from "../../lib/syncMerge";

const SESSION = { userId: "u1", email: "u1@example.com", name: "U One" };
const ROUTER = { replace: vi.fn(), push: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => ROUTER }));
vi.mock("../../lib/auth", () => ({
  getSession: () => SESSION, hasValidSession: () => true, signOut: vi.fn(), updateProfile: vi.fn(),
  deleteAccount: vi.fn(), ensureFirstUserIsAdmin: vi.fn(), regenerateRecoveryCode: vi.fn(),
}));
let records: ClashRecord[] = [];
let divergence: string[] = [];
vi.mock("../../lib/syncService", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/syncService")>();
  const { DEFAULT_DATA } = await import("../../lib/localData");
  return {
    pushToServer: vi.fn(), pullFromServer: vi.fn(), getLastSyncTime: () => null, confirmOverwriteIfNeeded: vi.fn(async () => true),
    mergeAndPush: vi.fn(async () => ({
      ok: true, syncedAt: "2026-10-08T09:01:00.000Z", addedFromServer: 0, conflictsResolved: 0, conflicts: [], conflictDetails: [],
      clashes: [], nonTransactionDivergence: divergence, replacedCloses: [], mergedData: { ...DEFAULT_DATA, income: 3000, clashRecords: records },
    })),
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
  records = []; divergence = [];
  await saveData({ ...DEFAULT_DATA, income: 3000 } as LocalFinancials, "u1");
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function merge() {
  render(<ThemeProvider><ProfilePage /></ThemeProvider>);
  fireEvent.click(await screen.findByRole("button", { name: /Merge$/ }));
}

it("names a goal both devices changed", async () => {
  records = [{ id: "r-goal", at: new Date().toISOString(), key: "g1", kind: "goal", name: "Laptop", later: true }];
  await merge();
  expect(await screen.findByText('✓ Merged. Both devices changed the goal "Laptop" — kept the later change.')).toBeTruthy();
});

it("a first merge with no record says what may differ", async () => {
  divergence = ["goals"];
  await merge();
  expect(await screen.findByText("✓ Merged. Your goals may differ from your other device — this device's copy was kept. Check Goals if something looks off.")).toBeTruthy();
});
