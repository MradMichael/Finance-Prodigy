// Session 27, item 1 (owner; merged in session 28 with SEC-07): a stale device signs in with
// the NEW password. Device B's data is locked under B's own data key, which
// only B's previous password unwraps; after a reset on another device the new
// password unlocks nothing here, and the old one derives a token the server
// refuses. Now:
// - the typed password, refused locally, is checked against the server (when
//   this device has synced before, or was stopped for its credentials);
// - accepted, the page asks for the previous password: with it, only the
//   password side of B's key is rewrapped, and B's data record isn't touched
//   (path 1); without it, B's record and its old key envelopes are kept byte
//   for byte and B starts from the server copy (path 2);
// - every failure writes nothing, and the stop (lib/syncRefused.ts) clears
//   only when the server accepted, never on a local sign-in.
import { it, expect, vi, beforeEach } from "vitest";
import { signUp, signIn, signOut, getSession, updateDevicePassword, restartDeviceFromServer } from "./auth";
import { pullFromServer } from "./syncService";
import { initSyncToken, getSyncToken, clearSyncToken, unwrapWithPassword, openWithDek } from "./crypto";
import { saveData, loadData, DEFAULT_DATA, type LocalFinancials } from "./localData";
import { isSyncRefused, markSyncRefused } from "./syncRefused";

vi.mock("./syncService", () => ({
  pullFromServer: vi.fn(),
  relinkSync: vi.fn(), getRecoveryTokenForSync: vi.fn(), confirmOverwriteIfNeeded: vi.fn(async () => true),
  deleteFromServer: vi.fn(), recordSyncTime: vi.fn(), recordRestoreStored: vi.fn(() => true),
}));
vi.mock("./syncSeen", () => ({ saveSeen: vi.fn(async () => {}), loadSeen: vi.fn(async () => null) }));
vi.mock("./clashNotice", () => ({ takeUnseenClashes: vi.fn(async () => []) }));

const EMAIL = "quartz@test.com", OLD = "old-password-123", NEW = "new-password-456";
const USERS = "essa_users_v1";
const B_DATA = { ...DEFAULT_DATA, income: 3000, userName: "Quartz Lantern", wishlist: [{ id: "w-b", name: "Copper kettle", price: 22.15, currency: "USD", createdAt: "2026-10-20T08:00:00.000Z" }] } as unknown as LocalFinancials;
const SERVER = { ...DEFAULT_DATA, income: 3150.75, userName: "Quartz Lantern", wishlist: [{ id: "w-a", name: "Amber stool", price: 30, currency: "USD", createdAt: "2026-10-19T08:00:00.000Z" }] } as unknown as LocalFinancials;
const REFUSED = { ok: false as const, credentialsRefused: true as const, error: "Invalid sync credentials for this account." };
let NEW_TOKEN = "";
let id = "";

/** Device B: an account made with the old password, its data saved, synced before; then signed out. */
async function staleDevice(opts: { synced?: boolean } = {}) {
  expect((await signUp(EMAIL, "Quartz Lantern", OLD)).ok).toBe(true);
  const r = await signIn(EMAIL, OLD);
  if (!r.ok) throw new Error(r.error);
  id = r.session.userId;
  await saveData(B_DATA, id);
  if (opts.synced !== false) localStorage.setItem(`essa_last_sync_${id}`, "2026-10-19T08:00:00.000Z");
  signOut();
}
const snapshot = () => ({ users: localStorage.getItem(USERS), data: localStorage.getItem(`essa_data_${id}`) });
const kept = () => Object.keys(localStorage).filter((k) => k.startsWith(`essa_unreadable_${id}_`)).sort();

beforeEach(async () => {
  localStorage.clear(); sessionStorage.clear();
  NEW_TOKEN = await initSyncToken(NEW, EMAIL); clearSyncToken();
  // The server accepts only the new password's token.
  vi.mocked(pullFromServer).mockReset().mockImplementation(async () => (getSyncToken() === NEW_TOKEN
    ? { ok: true as const, data: SERVER, syncedAt: "2026-10-20T09:00:00.000Z", hasRecoveryCode: true }
    : REFUSED));
});

it("the new password, accepted by the server, asks for the previous one; nothing is written yet", async () => {
  await staleDevice();
  const before = snapshot();
  const r = await signIn(EMAIL, NEW);
  expect(r).toMatchObject({ ok: false, staleDevice: true });
  expect(snapshot()).toEqual(before);
  expect(getSession()).toBeNull();
  expect(pullFromServer).toHaveBeenCalledTimes(1);
});

it("a password the server refuses too: \"Incorrect password.\", nothing written, and no token kept", async () => {
  await staleDevice();
  const before = snapshot();
  expect(await signIn(EMAIL, "neither-of-them-9")).toEqual({ ok: false, error: "Incorrect password." });
  expect(snapshot()).toEqual(before);
  expect(getSyncToken()).toBeNull();
});

it("the server out of reach: the existing sentence, nothing written", async () => {
  await staleDevice();
  vi.mocked(pullFromServer).mockResolvedValue({ ok: false, unreachable: true, error: "Couldn't reach the server." });
  const before = snapshot();
  expect(await signIn(EMAIL, NEW)).toEqual({ ok: false, error: "Couldn't verify your account: the server couldn't be reached. If you're online, it may be starting up: try again in a minute." });
  expect(snapshot()).toEqual(before);
});

it("a device that never synced and was never stopped doesn't ask the server", async () => {
  await staleDevice({ synced: false });
  expect(await signIn(EMAIL, NEW)).toEqual({ ok: false, error: "Incorrect password." });
  expect(pullFromServer).not.toHaveBeenCalled();
});

it("a device that was stopped for its credentials asks the server even without a sync time", async () => {
  await staleDevice({ synced: false });
  markSyncRefused(id);
  expect(await signIn(EMAIL, NEW)).toMatchObject({ ok: false, staleDevice: true });
});

it("path 1, the previous password: the data record isn't touched and opens under the new password; the stop clears", async () => {
  await staleDevice();
  markSyncRefused(id);
  const recoveryBefore = JSON.parse(localStorage.getItem(USERS)!)[0].wrappedDekRecovery;
  const dataBefore = localStorage.getItem(`essa_data_${id}`);
  const r = await updateDevicePassword(EMAIL, NEW, OLD);
  if (!r.ok) throw new Error(r.error);
  expect(localStorage.getItem(`essa_data_${id}`)).toBe(dataBefore); // byte for byte
  expect(await loadData(id)).toMatchObject({ income: 3000, wishlist: [expect.objectContaining({ name: "Copper kettle" })] });
  expect(JSON.parse(localStorage.getItem(USERS)!)[0].wrappedDekRecovery).toEqual(recoveryBefore);
  expect(getSession()?.userId).toBe(id);
  expect(getSyncToken()).toBe(NEW_TOKEN);
  expect(isSyncRefused(id)).toBe(false);
  expect(kept()).toEqual([]);
  signOut();
  expect((await signIn(EMAIL, NEW)).ok).toBe(true); // locally now
  signOut();
  expect(await signIn(EMAIL, OLD)).toEqual({ ok: false, error: "Incorrect password." });
});

it("path 1 with the wrong previous password writes nothing", async () => {
  await staleDevice();
  markSyncRefused(id);
  const before = snapshot();
  expect(await updateDevicePassword(EMAIL, NEW, "not-the-old-one-1")).toEqual({ ok: false, error: "That isn't the password this device used before." });
  expect(snapshot()).toEqual(before);
  expect(isSyncRefused(id)).toBe(true);
  expect(getSession()).toBeNull();
});

it("path 1 when the server no longer accepts the new password writes nothing", async () => {
  await staleDevice();
  vi.mocked(pullFromServer).mockResolvedValue(REFUSED);
  const before = snapshot();
  expect(await updateDevicePassword(EMAIL, NEW, OLD)).toEqual({ ok: false, error: "Incorrect password." });
  expect(snapshot()).toEqual(before);
});

it("path 2, no previous password: the record and its old envelopes kept byte for byte and still open with the old password; the device starts from the server copy", async () => {
  await staleDevice();
  markSyncRefused(id);
  const before = snapshot();
  const oldUser = JSON.parse(before.users!)[0];
  const r = await restartDeviceFromServer(EMAIL, NEW);
  if (!r.ok) throw new Error(r.error);
  const keys = kept();
  expect(keys).toHaveLength(2);
  const recordKey = keys.find((k) => !k.endsWith("_envelopes"))!;
  expect(localStorage.getItem(recordKey)).toBe(before.data); // byte for byte
  const envelopes = JSON.parse(localStorage.getItem(`${recordKey}_envelopes`)!);
  expect(envelopes).toEqual({ wrappedDekPassword: oldUser.wrappedDekPassword, wrappedDekRecovery: oldUser.wrappedDekRecovery });
  const oldDek = await unwrapWithPassword(OLD, id, envelopes.wrappedDekPassword);
  expect(oldDek).not.toBeNull();
  expect(JSON.parse((await openWithDek(oldDek!, localStorage.getItem(recordKey)!))!)).toMatchObject({ income: 3000, wishlist: [expect.objectContaining({ name: "Copper kettle" })] });
  expect(await loadData(id)).toMatchObject({ income: 3150.75, wishlist: [expect.objectContaining({ name: "Amber stool" })] });
  expect(isSyncRefused(id)).toBe(false);
  signOut();
  expect((await signIn(EMAIL, NEW)).ok).toBe(true);
});

it("path 2 when the server no longer accepts writes nothing", async () => {
  await staleDevice();
  vi.mocked(pullFromServer).mockResolvedValue(REFUSED);
  const before = snapshot();
  expect(await restartDeviceFromServer(EMAIL, NEW)).toEqual({ ok: false, error: "Incorrect password." });
  expect(snapshot()).toEqual(before);
  expect(kept()).toEqual([]);
});

it("the stop clears only when the server accepted: six sign-ins with the old password send nothing and leave it set", async () => {
  await staleDevice();
  markSyncRefused(id);
  for (let i = 0; i < 6; i++) {
    expect((await signIn(EMAIL, OLD)).ok).toBe(true);
    signOut();
  }
  expect(pullFromServer).not.toHaveBeenCalled(); // nothing reached the server, so nothing counted toward a lock
  expect(isSyncRefused(id)).toBe(true);
});
