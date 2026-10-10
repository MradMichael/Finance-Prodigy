// Session 11, item 5 (owner): signing in or recovering onto a new device
// pulls the server's copy, stores it, then records the pulled sync time. When
// storage refuses that time, the account and its data are already stored:
// sign-in and recovery go on, without throwing, and the time simply isn't
// recorded (the next push then merges: FIRST_PUSH_BASE). They used to throw
// the QuotaExceededError out of signIn/recoverAccount (auth.ts 263, 529).
//
// The real recording runs against a real localStorage whose sync time write
// throws; the server's side is stubbed as in auth.sync-record.test.ts.
import { it, expect, beforeEach, afterEach, vi } from "vitest";
import { signIn, recoverAccount, getSession } from "./auth";
import { pullFromServer, relinkSync, confirmOverwriteIfNeeded } from "./syncService";
import { DEFAULT_DATA, loadData, type LocalFinancials } from "./localData";

vi.mock("./syncService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./syncService")>()),
  pullFromServer: vi.fn(),
  relinkSync: vi.fn(),
  confirmOverwriteIfNeeded: vi.fn(),
  deleteFromServer: vi.fn(),
}));

const SERVER = { ...DEFAULT_DATA, userName: "Remote Name", income: 5000 } as LocalFinancials;
const realSetItem = Storage.prototype.setItem;

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  vi.mocked(pullFromServer).mockReset().mockResolvedValue({ ok: true, syncedAt: "2026-10-08T09:00:00.000Z", data: SERVER, hasRecoveryCode: true });
  vi.mocked(relinkSync).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(confirmOverwriteIfNeeded).mockReset().mockResolvedValue(true);
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k: string, v: string) {
    if (k.startsWith("essa_last_sync_")) throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    return realSetItem.call(this, k, v);
  });
});
afterEach(() => { vi.restoreAllMocks(); });

const syncTimes = () => Object.keys(localStorage).filter((k) => k.startsWith("essa_last_sync"));

it("signing in on a new device: signed in, the data stored, no time recorded, nothing thrown", async () => {
  const r = await signIn("u1@example.test", "password12345");
  if (!r.ok) throw new Error(r.error);
  expect(getSession()?.userId).toBe(r.session.userId);
  expect((await loadData(r.session.userId)).income).toBe(5000);
  expect(syncTimes()).toEqual([]);
});

it("recovering onto a new device: the same", async () => {
  const r = await recoverAccount("u1@example.test", "SOME-REAL-CODE-0000", "brandnewpassword1");
  if (!r.ok) throw new Error(r.error);
  expect(getSession()?.userId).toBe(r.session.userId);
  expect((await loadData(r.session.userId)).income).toBe(5000);
  expect(syncTimes()).toEqual([]);
});
