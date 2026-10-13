// Session 20, item 2: the report tab's date range on Profile (the browser's own
// date inputs, shown with "Detailed PDF"). Measured live at 390px, the two
// inputs and "to" didn't fit their row and the second input was cut off at
// the right edge. The row now wraps, so on a phone the second input moves
// under the first instead of being cut.
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

const SESSION = { userId: "u1", email: "u1@example.com", name: "U One" };
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
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
import { DEFAULT_DATA, saveData, type LocalFinancials } from "../../lib/localData";
import { activateSessionKey } from "../../lib/crypto";

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); activateSessionKey(new Uint8Array(32).fill(7)); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("the Detailed report's date range wraps on a narrow screen instead of cutting off its second input", async () => {
  await saveData({ ...DEFAULT_DATA, income: 3000 } as LocalFinancials, "u1");
  render(<ThemeProvider><ProfilePage /></ThemeProvider>);
  fireEvent.click(await screen.findByRole("button", { name: "Detailed PDF" }));
  const inputs = [...document.querySelectorAll('input[type="date"]')];
  expect(inputs).toHaveLength(2);
  const row = inputs[0].parentElement!;
  expect(row).toBe(inputs[1].parentElement);
  expect(row.classList.contains("flex-wrap")).toBe(true);
});
