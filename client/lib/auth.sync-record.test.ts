// Plan H 5b: a device that joins by pulling (signing in on a new device, or
// recovering onto one) stores the server's copy as its own data, so that copy
// is its last sync. Recorded there, the device's first merge already knows
// which side changed what; unrecorded, it would fall back to today's merge.
import { it, expect, beforeEach, vi } from "vitest";
import { signIn, recoverAccount } from "./auth";
import { pullFromServer, relinkSync, confirmOverwriteIfNeeded, recordSyncTime } from "./syncService";
import { loadSeen, seenOf } from "./syncSeen";
import { DEFAULT_DATA, type LocalFinancials } from "./localData";

vi.mock("./syncService", () => ({
  pullFromServer: vi.fn(),
  relinkSync: vi.fn(),
  getRecoveryTokenForSync: vi.fn(),
  confirmOverwriteIfNeeded: vi.fn(),
  deleteFromServer: vi.fn(),
  recordSyncTime: vi.fn(), // DI-16
}));

const SERVER = { ...DEFAULT_DATA, userName: "Remote Name", income: 5000, goals: [{ id: "g1", name: "Laptop", emoji: "💻", targetAmount: 1200, currentAmount: 0, openingAmount: 100, currency: "USD", targetDate: "2027-03-01", createdAt: "2026-05-01T09:00:00.000Z" }] } as LocalFinancials;

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  vi.mocked(pullFromServer).mockReset().mockResolvedValue({ ok: true, syncedAt: "2026-10-08T09:00:00.000Z", data: SERVER, hasRecoveryCode: true });
  vi.mocked(relinkSync).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(confirmOverwriteIfNeeded).mockReset().mockResolvedValue(true);
  vi.mocked(recordSyncTime).mockReset();
});

it("signing in on a new device records the pulled copy as its last sync", async () => {
  const r = await signIn("vex-harbor@test.com", "password12345");
  if (!r.ok) throw new Error(r.error);
  expect(await loadSeen(r.session.userId)).toEqual(seenOf(SERVER));
});

it("recovering onto a new device does too", async () => {
  const r = await recoverAccount("vex-harbor@test.com", "SOME-REAL-CODE-0000", "brandnewpassword1");
  if (!r.ok) throw new Error(r.error);
  expect(await loadSeen(r.session.userId)).toEqual(seenOf(SERVER));
});

// Session 7 (owner): a device joining an account treats the clash records
// already in the copy it pulls as shown. They are other devices' news from
// before it joined, not its own overridden changes.
it("a device that joins shows none of the clash records already in the copy", async () => {
  const { takeUnseenClashes } = await import("./clashNotice");
  const rec = { id: "r-old", at: new Date(Date.now() - 2 * 86_400_000).toISOString(), key: "income", kind: "setting" as const, setting: "income" as const, kept: 3600, other: 3500 };
  const withRecord = { ...SERVER, clashRecords: [rec] } as LocalFinancials;
  vi.mocked(pullFromServer).mockResolvedValue({ ok: true, syncedAt: "2026-10-08T09:00:00.000Z", data: withRecord, hasRecoveryCode: true });
  const signedIn = await signIn("vex-harbor@test.com", "password12345");
  if (!signedIn.ok) throw new Error(signedIn.error);
  expect(await takeUnseenClashes(signedIn.session.userId, withRecord)).toEqual([]);
  localStorage.clear(); sessionStorage.clear();
  const recovered = await recoverAccount("vex-harbor@test.com", "SOME-REAL-CODE-0000", "brandnewpassword1");
  if (!recovered.ok) throw new Error(recovered.error);
  expect(await takeUnseenClashes(recovered.session.userId, withRecord)).toEqual([]);
});

// DI-16 (session 8): the sync time is per account. The pull runs before the
// account exists on this device, so it records nothing itself; once the
// account exists, sign-in and recovery record the pulled time for it.
it("signing in or recovering on a new device records the pulled time for that account", async () => {
  const signedIn = await signIn("vex-harbor@test.com", "password12345");
  if (!signedIn.ok) throw new Error(signedIn.error);
  expect(recordSyncTime).toHaveBeenCalledWith(signedIn.session.userId, "2026-10-08T09:00:00.000Z");
  localStorage.clear(); sessionStorage.clear(); vi.mocked(recordSyncTime).mockClear();
  const recovered = await recoverAccount("vex-harbor@test.com", "SOME-REAL-CODE-0000", "brandnewpassword1");
  if (!recovered.ok) throw new Error(recovered.error);
  expect(recordSyncTime).toHaveBeenCalledWith(recovered.session.userId, "2026-10-08T09:00:00.000Z");
});
