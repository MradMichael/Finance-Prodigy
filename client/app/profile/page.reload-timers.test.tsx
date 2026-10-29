// CI red on ec26fcf (session 30): a restore's "Reloading…" timer was still
// pending when page.restore-choice.test.tsx ended, and on a slow runner it
// fired after the test environment was gone ("window is not defined", an
// unhandled error, so the leg failed with every test passing). The page now
// clears its pending reload timers when it unmounts: nothing fires after it's
// gone. In real use the dashboard reads the stored data on its own mount,
// which is what the reload was for.
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { LocalFinancials } from "../../lib/localData";

const SESSION = { userId: "u1", email: "u1@example.test", name: "Quartz Lantern" };
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("../../lib/auth", () => ({
  getSession: () => SESSION, hasValidSession: () => true, signOut: vi.fn(), updateProfile: vi.fn(),
  deleteAccount: vi.fn(), ensureFirstUserIsAdmin: vi.fn(), regenerateRecoveryCode: vi.fn(),
}));
vi.mock("../../lib/syncService", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/syncService")>();
  return { ...real, pushToServer: vi.fn(), pullFromServer: vi.fn(), getLastSyncTime: () => null, confirmOverwriteIfNeeded: vi.fn(async () => true) };
});
vi.mock("../../lib/analytics", () => ({ isAnalyticsOptedIn: () => false, setAnalyticsOptIn: vi.fn() }));

import ProfilePage from "./page";
import { ThemeProvider } from "../../contexts/ThemeContext";
import { DEFAULT_DATA, saveData } from "../../lib/localData";
import { activateSessionKey } from "../../lib/crypto";

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); activateSessionKey(new Uint8Array(32).fill(7)); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("a restore from file, then the page unmounts: its reload timer is cleared, so nothing fires after it's gone", async () => {
  await saveData({ ...DEFAULT_DATA, income: 3000 } as LocalFinancials, "u1");
  // The reload is swapped for a stand-in when it's scheduled, so it can be seen to fire (or not) without navigating.
  const reloadRan = vi.fn();
  const realSetTimeout = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, ms?: number) =>
    realSetTimeout(String(fn).includes("location.href") ? reloadRan : fn, ms)) as typeof setTimeout);
  const { unmount } = render(<ThemeProvider><ProfilePage /></ThemeProvider>);
  await screen.findByRole("button", { name: /Download my data/ });
  const input = document.querySelector('input[type="file"][accept*="json"]')!;
  fireEvent.change(input, { target: { files: [new File([JSON.stringify({ ...DEFAULT_DATA, income: 3150.75 })], "essa-data.json", { type: "application/json" })] } });
  expect(await screen.findByText(/Data restored from file/)).toBeTruthy();
  unmount();
  await new Promise((r) => realSetTimeout(r, 900)); // past the restore's 700 ms
  expect(reloadRan).not.toHaveBeenCalled();
});

it("premise: left mounted, the same restore's reload does fire", async () => {
  await saveData({ ...DEFAULT_DATA, income: 3000 } as LocalFinancials, "u1");
  const reloadRan = vi.fn();
  const realSetTimeout = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, ms?: number) =>
    realSetTimeout(String(fn).includes("location.href") ? reloadRan : fn, ms)) as typeof setTimeout);
  render(<ThemeProvider><ProfilePage /></ThemeProvider>);
  await screen.findByRole("button", { name: /Download my data/ });
  const input = document.querySelector('input[type="file"][accept*="json"]')!;
  fireEvent.change(input, { target: { files: [new File([JSON.stringify({ ...DEFAULT_DATA, income: 3150.75 })], "essa-data.json", { type: "application/json" })] } });
  expect(await screen.findByText(/Data restored from file/)).toBeTruthy();
  await new Promise((r) => realSetTimeout(r, 900));
  expect(reloadRan).toHaveBeenCalledTimes(1);
});
