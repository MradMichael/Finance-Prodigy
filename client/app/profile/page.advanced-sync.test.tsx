// U9 (owner, session 33, DECISIONS_PENDING 24; heading approved): Profile's Merge, Push and Restore sit in a
// collapsed section, "Advanced: replace one copy with the other". The harness is page.storage-honesty's.
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { LocalFinancials } from "../../lib/localData";

const SESSION = { userId: "u1", email: "u1@example.com", name: "U One" };
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("../../lib/auth", () => ({
  getSession: () => SESSION, hasValidSession: () => true, signOut: vi.fn(), updateProfile: vi.fn(),
  deleteAccount: vi.fn(), ensureFirstUserIsAdmin: vi.fn(), regenerateRecoveryCode: vi.fn(),
}));
vi.mock("../../lib/syncService", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/syncService")>();
  return {
    pushToServer: vi.fn(), pullFromServer: vi.fn(), getLastSyncTime: () => null, confirmOverwriteIfNeeded: vi.fn(async () => true),
    recordRestoreStored: real.recordRestoreStored,
    mergeAndPush: vi.fn(), recordMergeStored: vi.fn(), buildMergeNoticeText: real.buildMergeNoticeText, applyBackupChoice: vi.fn(),
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
  await saveData({ ...DEFAULT_DATA, income: 3000 } as LocalFinancials, "u1");
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("Merge, Push and Restore sit in a collapsed section, opened by its heading", async () => {
  render(<ThemeProvider><ProfilePage /></ThemeProvider>);
  const toggle = await screen.findByRole("button", { name: "Advanced: replace one copy with the other" });
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  const region = document.getElementById(toggle.getAttribute("aria-controls")!)!;
  expect(region.className.split(/\s+/)).toContain("hidden");
  for (const name of [/⇄ Merge/, /Push to database/, /Restore from database/]) expect(region.contains(screen.getByRole("button", { name }))).toBe(true);
  fireEvent.click(toggle);
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(region.className.split(/\s+/)).not.toContain("hidden");
});
