// SEC-07 amended (owner, session 26, item 2; HELD): a sign-in on this device
// clears the stop a refused request set (lib/syncRefused.ts), so automatic
// backup resumes with the token that sign-in derived.
import { it, expect, vi, beforeEach } from "vitest";
import { signUp, signIn, signOut } from "./auth";
import { isSyncRefused, markSyncRefused } from "./syncRefused";

vi.mock("./syncService", () => ({
  pullFromServer: vi.fn(async () => ({ ok: false, error: "No data on server yet. Push first." })),
  relinkSync: vi.fn(), getRecoveryTokenForSync: vi.fn(), confirmOverwriteIfNeeded: vi.fn(async () => true),
  deleteFromServer: vi.fn(), recordSyncTime: vi.fn(), recordRestoreStored: vi.fn(() => true),
}));

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

it("signing in again on this device clears this account's stop, and only this account's", async () => {
  expect((await signUp("quartz@test.com", "Quartz Lantern", "password12345")).ok).toBe(true);
  const first = await signIn("quartz@test.com", "password12345");
  if (!first.ok) throw new Error(first.error);
  const id = first.session.userId;
  markSyncRefused(id);
  markSyncRefused("someone-else");
  signOut();
  expect(isSyncRefused(id)).toBe(true); // signing out doesn't clear it
  expect((await signIn("quartz@test.com", "password12345")).ok).toBe(true);
  expect(isSyncRefused(id)).toBe(false);
  expect(isSyncRefused("someone-else")).toBe(true);
});

it("a failed sign-in doesn't clear it", async () => {
  await signUp("quartz@test.com", "Quartz Lantern", "password12345");
  const first = await signIn("quartz@test.com", "password12345");
  if (!first.ok) throw new Error(first.error);
  markSyncRefused(first.session.userId);
  signOut();
  expect((await signIn("quartz@test.com", "wrong-password-1")).ok).toBe(false);
  expect(isSyncRefused(first.session.userId)).toBe(true);
});
