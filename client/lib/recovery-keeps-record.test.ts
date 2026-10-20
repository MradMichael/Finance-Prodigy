// Session 28, item 2 (owner): account recovery on a stale device. When this
// device's own recovery envelope doesn't open with the code typed (the
// account's code came from another device), recoverAccount falls back to
// recoverFromSync, which replaces this device's key envelopes and writes the
// server's copy over its record. Its changes that weren't backed up were lost.
// Now the record and its two old envelopes are kept first, in the same
// kept-copy storage as session 27's path 2, still openable with the old
// password; a recovery that stops without replacing anything leaves no copy;
// a copy that can't be written stops recovery before the server is touched.
import { it, expect, vi, beforeEach } from "vitest";
import { signUp, signIn, signOut, recoverAccount } from "./auth";
import { pullFromServer, relinkSync, confirmOverwriteIfNeeded } from "./syncService";
import { unwrapWithPassword, openWithDek } from "./crypto";
import { saveData, loadData, DEFAULT_DATA, type LocalFinancials } from "./localData";

vi.mock("./syncService", () => ({
  pullFromServer: vi.fn(), relinkSync: vi.fn(), getRecoveryTokenForSync: vi.fn(), confirmOverwriteIfNeeded: vi.fn(),
  deleteFromServer: vi.fn(), recordSyncTime: vi.fn(), recordRestoreStored: vi.fn(() => true),
}));
vi.mock("./syncSeen", () => ({ saveSeen: vi.fn(async () => {}), loadSeen: vi.fn(async () => null) }));
vi.mock("./clashNotice", () => ({ takeUnseenClashes: vi.fn(async () => []) }));

const EMAIL = "quartz@test.com", OLD = "old-password-123", NEW = "new-password-456";
const ACCOUNT_CODE = "K7QM-4XPZ-9RTL-2WJC"; // the account's code, issued on another device: not this device's own
const USERS = "essa_users_v1";
const B_DATA = { ...DEFAULT_DATA, income: 3000, userName: "Quartz Lantern", wishlist: [{ id: "w-b", name: "Copper kettle", price: 22.15, currency: "USD", createdAt: "2026-10-20T08:00:00.000Z" }] } as unknown as LocalFinancials;
const SERVER = { ...DEFAULT_DATA, income: 3150.75, userName: "Quartz Lantern", wishlist: [{ id: "w-a", name: "Amber stool", price: 30, currency: "USD", createdAt: "2026-10-19T08:00:00.000Z" }] } as unknown as LocalFinancials;
let id = "";

async function staleDevice() {
  expect((await signUp(EMAIL, "Quartz Lantern", OLD)).ok).toBe(true);
  const r = await signIn(EMAIL, OLD);
  if (!r.ok) throw new Error(r.error);
  id = r.session.userId;
  await saveData(B_DATA, id); // "Copper kettle" was never backed up
  signOut();
}
const snapshot = () => ({ users: localStorage.getItem(USERS), data: localStorage.getItem(`essa_data_${id}`) });
const kept = () => Object.keys(localStorage).filter((k) => k.startsWith(`essa_unreadable_${id}_`)).sort();

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); vi.restoreAllMocks();
  vi.mocked(relinkSync).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(pullFromServer).mockReset().mockResolvedValue({ ok: true, data: SERVER, syncedAt: "2026-10-20T09:00:00.000Z", hasRecoveryCode: true });
  vi.mocked(confirmOverwriteIfNeeded).mockReset().mockResolvedValue(true);
});

it("recovering a stale device keeps its record and its old envelopes, byte for byte, still openable with the old password", async () => {
  await staleDevice();
  const before = snapshot();
  const oldUser = JSON.parse(before.users!)[0];
  const r = await recoverAccount(EMAIL, ACCOUNT_CODE, NEW);
  if (!r.ok) throw new Error(r.error);
  const keys = kept();
  expect(keys).toHaveLength(2);
  const recordKey = keys.find((k) => !k.endsWith("_envelopes"))!;
  expect(localStorage.getItem(recordKey)).toBe(before.data);
  const envelopes = JSON.parse(localStorage.getItem(`${recordKey}_envelopes`)!);
  expect(envelopes).toEqual({ wrappedDekPassword: oldUser.wrappedDekPassword, wrappedDekRecovery: oldUser.wrappedDekRecovery });
  const oldDek = await unwrapWithPassword(OLD, id, envelopes.wrappedDekPassword);
  expect(JSON.parse((await openWithDek(oldDek!, localStorage.getItem(recordKey)!))!)).toMatchObject({ wishlist: [expect.objectContaining({ name: "Copper kettle" })] });
  expect(await loadData(id)).toMatchObject({ income: 3150.75 }); // the device now holds the server's copy, as before
  signOut();
  expect((await signIn(EMAIL, NEW)).ok).toBe(true);
});

it("a code the server refuses changes nothing and leaves no copy", async () => {
  await staleDevice();
  vi.mocked(relinkSync).mockResolvedValue({ ok: false, error: "Could not verify ownership of this account's sync data." });
  const before = snapshot();
  expect((await recoverAccount(EMAIL, ACCOUNT_CODE, NEW)).ok).toBe(false);
  expect(snapshot()).toEqual(before);
  expect(kept()).toEqual([]);
});

it("cancelling the confirm leaves no copy and nothing on this device changed", async () => {
  await staleDevice();
  vi.mocked(confirmOverwriteIfNeeded).mockResolvedValue(false);
  const before = snapshot();
  expect(await recoverAccount(EMAIL, ACCOUNT_CODE, NEW)).toEqual({ ok: false, error: "Cancelled — nothing on this device was changed." });
  expect(snapshot()).toEqual(before);
  expect(kept()).toEqual([]);
});

it("a copy that can't be written stops recovery before the server is touched", async () => {
  await staleDevice();
  const real = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k: string, v: string) {
    if (k.startsWith("essa_unreadable_")) throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    return real.call(this, k, v);
  });
  const before = snapshot();
  expect(await recoverAccount(EMAIL, ACCOUNT_CODE, NEW)).toEqual({ ok: false, error: "Your password wasn't reset. This browser has run out of storage space for ESSA." });
  expect(relinkSync).not.toHaveBeenCalled();
  expect(snapshot()).toEqual(before);
  expect(kept()).toEqual([]);
});
