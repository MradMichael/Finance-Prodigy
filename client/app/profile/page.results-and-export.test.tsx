// A11Y-03 and TEST-03 (blind-spot audit), on Profile.
//
// A11Y-03: nothing a screen reader hears said whether a backup, restore or
// import succeeded or failed. Profile's results now sit in polite live
// regions (role="status") that are on the page BEFORE a result arrives, so
// the result is announced when it appears. No wording changes.
//
// TEST-03: nothing tested that "Download my data" leaves out deleted
// transactions; removing the filter failed nothing. With PRIV-02's decided
// copy ("everything except transactions you've deleted"), that filter is a
// promise, so it's pinned here against the real page and the file it builds.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

const SESSION = { userId: "u1", email: "u1@example.com", name: "U One" };
const ROUTER = { replace: vi.fn(), push: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => ROUTER }));
vi.mock("../../lib/auth", () => ({
  getSession: () => SESSION, hasValidSession: () => true, signOut: vi.fn(), updateProfile: vi.fn(),
  deleteAccount: vi.fn(), ensureFirstUserIsAdmin: vi.fn(), regenerateRecoveryCode: vi.fn(),
}));
const push = vi.fn();
vi.mock("../../lib/syncService", () => ({
  pushToServer: (...a: unknown[]) => push(...a), pullFromServer: vi.fn(), getLastSyncTime: () => null,
  confirmOverwriteIfNeeded: vi.fn(async () => true), mergeAndPush: vi.fn(), buildMergeNoticeText: () => ({ text: "" }),
  applyBackupChoice: vi.fn(),
}));
vi.mock("../../lib/analytics", () => ({ isAnalyticsOptedIn: () => false, setAnalyticsOptIn: vi.fn() }));

import ProfilePage from "./page";
import { ThemeProvider } from "../../contexts/ThemeContext";
import { DEFAULT_DATA, saveData, type LocalFinancials, type StoredTransaction } from "../../lib/localData";
import { activateSessionKey } from "../../lib/crypto";

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  activateSessionKey(new Uint8Array(32).fill(7));
  push.mockReset();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const tx = (id: string, extra: Partial<StoredTransaction> = {}): StoredTransaction => ({
  id, amount: 46.8, currency: "USD", bucket: "WANTS", category: "dining", description: id, date: "2026-09-20",
  updatedAt: "2026-09-20T12:00:00.000Z", ...extra,
} as StoredTransaction);

async function open(data: Partial<LocalFinancials> = {}) {
  await saveData({ ...DEFAULT_DATA, income: 3000, ...data } as LocalFinancials, "u1");
  render(<ThemeProvider><ProfilePage /></ThemeProvider>);
  await screen.findByRole("button", { name: /Download my data/ });
}
const inStatusRegion = (text: string | RegExp) => !!screen.getByText(text).closest('[role="status"]');

describe("A11Y-03: Profile's results are announced", () => {
  it("the live regions are there before any result arrives", async () => {
    await open();
    expect(screen.getAllByRole("status").length).toBeGreaterThanOrEqual(4);
  });

  it("an import that fails is announced", async () => {
    await open();
    const before = screen.getAllByRole("status").length;
    const input = document.querySelector('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [new File(["not json"], "x.json", { type: "application/json" })] } });
    expect(await screen.findByText("✗ That file isn't valid JSON.")).toBeTruthy();
    expect(inStatusRegion("✗ That file isn't valid JSON.")).toBe(true);
    expect(screen.getAllByRole("status").length).toBe(before); // the region was already there
  });

  it("a push that fails is announced", async () => {
    push.mockResolvedValue({ ok: false, error: "Could not reach server. Is it running?" });
    await open();
    fireEvent.click(screen.getByRole("button", { name: /Push to database/ }));
    const msg = await screen.findByText("✗ Could not reach server. Is it running?");
    expect(msg.closest('[role="status"]')).not.toBeNull();
  });
});

describe("TEST-03: the export leaves out deleted transactions", () => {
  it("only the active transaction is in the file", async () => {
    let blob: Blob | null = null;
    vi.spyOn(URL, "createObjectURL").mockImplementation((b) => { blob = b as Blob; return "blob:essa-test"; });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await open({
      transactions: [
        tx("t-active"),
        tx("t-deleted", { deletedAt: "2026-09-25T10:00:00.000Z" }),
        tx("t-purged", { deletedAt: "2026-08-01T10:00:00.000Z", purgedAt: "2026-09-01T10:00:00.000Z", description: "", amount: 0 }),
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: /Download my data/ }));
    await waitFor(() => expect(blob).not.toBeNull());
    const exported = JSON.parse(await blob!.text()) as LocalFinancials;
    expect(exported.transactions.map((t) => t.id)).toEqual(["t-active"]);
  });
});
