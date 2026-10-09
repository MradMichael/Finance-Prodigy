// Plan H 5b: a device that joins by pulling (signing in on a new device, or
// recovering onto one) stores the server's copy as its own data, so that copy
// is its last sync. Recorded there, the device's first merge already knows
// which side changed what; unrecorded, it would fall back to today's merge.
import { it, expect, beforeEach, vi } from "vitest";
import { signIn, recoverAccount } from "./auth";
import { pullFromServer, relinkSync, confirmOverwriteIfNeeded } from "./syncService";
import { loadSeen, seenOf } from "./syncSeen";
import { DEFAULT_DATA, type LocalFinancials } from "./localData";

vi.mock("./syncService", () => ({
  pullFromServer: vi.fn(),
  relinkSync: vi.fn(),
  getRecoveryTokenForSync: vi.fn(),
  confirmOverwriteIfNeeded: vi.fn(),
  deleteFromServer: vi.fn(),
}));

const SERVER = { ...DEFAULT_DATA, userName: "Remote Name", income: 5000, goals: [{ id: "g1", name: "Laptop", emoji: "💻", targetAmount: 1200, currentAmount: 0, openingAmount: 100, currency: "USD", targetDate: "2027-03-01", createdAt: "2026-05-01T09:00:00.000Z" }] } as LocalFinancials;

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  vi.mocked(pullFromServer).mockReset().mockResolvedValue({ ok: true, syncedAt: "2026-10-08T09:00:00.000Z", data: SERVER, hasRecoveryCode: true });
  vi.mocked(relinkSync).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(confirmOverwriteIfNeeded).mockReset().mockResolvedValue(true);
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
