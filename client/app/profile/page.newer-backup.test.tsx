// Travel slice 0's message (owner-approved, session 15), Profile's half: Push
// and Merge refuse a backup written by newer code (and a copy of this
// device's that came from it), and say so in the owner's words.
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

const SESSION = { userId: "u1", email: "u1@example.test", name: "U One" };
const ROUTER = { replace: vi.fn(), push: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => ROUTER }));
vi.mock("../../lib/auth", () => ({
  getSession: () => SESSION, hasValidSession: () => true, signOut: vi.fn(), updateProfile: vi.fn(),
  deleteAccount: vi.fn(), ensureFirstUserIsAdmin: vi.fn(), regenerateRecoveryCode: vi.fn(),
}));
const push = vi.fn();
const merge = vi.fn();
vi.mock("../../lib/syncService", async (o) => ({
  ...(await o<typeof import("../../lib/syncService")>()),
  pushToServer: (...a: unknown[]) => push(...a), mergeAndPush: (...a: unknown[]) => merge(...a),
  pullFromServer: vi.fn(), getLastSyncTime: () => null, applyBackupChoice: vi.fn(),
}));
vi.mock("../../lib/analytics", () => ({ isAnalyticsOptedIn: () => false, setAnalyticsOptIn: vi.fn() }));

import ProfilePage from "./page";
import { ThemeProvider } from "../../contexts/ThemeContext";
import { activateSessionKey } from "../../lib/crypto";

const MESSAGE = "Your backup was saved by a newer version of ESSA, so this device has stopped syncing. Reload ESSA to update it. Until then, changes stay on this device.";

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  activateSessionKey(new Uint8Array(32).fill(7));
  push.mockReset(); merge.mockReset();
});
afterEach(cleanup);

it("Push: a copy from newer code isn't uploaded, and the owner's message says why", async () => {
  push.mockResolvedValue({ ok: false, newerVersion: true });
  render(<ThemeProvider><ProfilePage /></ThemeProvider>);
  fireEvent.click(await screen.findByRole("button", { name: /Push to database/ }));
  expect(await screen.findByText(MESSAGE)).toBeTruthy();
});

it("Merge: a backup from newer code isn't merged into, and the owner's message says why", async () => {
  merge.mockResolvedValue({ ok: false, newerVersion: true });
  render(<ThemeProvider><ProfilePage /></ThemeProvider>);
  fireEvent.click(await screen.findByRole("button", { name: /Merge/ }));
  expect(await screen.findByText(MESSAGE)).toBeTruthy();
});
