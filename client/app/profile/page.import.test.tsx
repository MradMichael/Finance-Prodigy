// Import's failure message (DI-07 / ERR-01, 2026-10-01): every failed
// save on restore said "Couldn't restore that file." -- blaming the file even
// when the file was fine and this browser simply couldn't hold that much.
//
// The file here is a valid export, big enough that its encrypted copy passes
// jsdom's real 5,000,000-code-unit storage quota. Nothing about the failure is
// simulated: real migration, real encryption, real QuotaExceededError.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const SESSION = { userId: "u1", email: "u1@example.com", name: "U One" };
// One object for every call: the page's mount effect is keyed on the router,
// so a fresh object per render would re-run it forever.
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

import ProfilePage from "./page";
import { ThemeProvider } from "../../contexts/ThemeContext";
import { DEFAULT_DATA } from "../../lib/localData";
import { activateSessionKey } from "../../lib/crypto";

const DATA_KEY = "essa_data_u1";

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  activateSessionKey(new Uint8Array(32).fill(7));
});

function exportFile(transactionCount: number): File {
  const transactions = Array.from({ length: transactionCount }, (_, i) => ({
    id: `tx-${i}`, date: "2026-09-01", bucket: "NEEDS", category: "groceries", description: "Supermarket",
    amount: i % 3 ? 12.5 : 450_000, currency: i % 3 ? "USD" : "LBP", ...(i % 3 ? {} : { lbpRateAtEntry: 89_500 }),
    paymentMethod: "cash", createdAt: "2026-09-01T12:00:00.000Z", updatedAt: "2026-09-01T12:00:00.000Z",
  }));
  return new File([JSON.stringify({ ...DEFAULT_DATA, transactions })], "essa-data.json", { type: "application/json" });
}

async function importFile(file: File) {
  render(<ThemeProvider><ProfilePage /></ThemeProvider>);
  const input = await waitFor(() => {
    const el = document.querySelector('input[type="file"]');
    if (!el) throw new Error("no file input yet");
    return el;
  });
  fireEvent.change(input, { target: { files: [file] } });
}

describe("restoring a file this browser can't hold", () => {
  it("names the size, not the file, and leaves what was stored alone", async () => {
    const file = exportFile(18_000);
    // Premise: big enough that the encrypted copy (4/3 of the JSON) can't fit the quota.
    expect((file.size * 4) / 3).toBeGreaterThan(5_000_000);

    await importFile(file);

    expect(await screen.findByText(/too large to store in this browser/, undefined, { timeout: 20_000 })).toBeTruthy();
    expect(screen.queryByText(/Couldn.t restore that file/)).toBeNull();
    expect(localStorage.getItem(DATA_KEY)).toBeNull(); // nothing was stored before, and nothing is now
  }, 30_000);
});
