// DI-15's second part: the sync record itself can't be saved (storage full,
// a private window's quota). saveSeen swallowed the failure, so the device
// had no record, and every merge was a "first merge": the "may differ"
// sentence came back at every sync. Now a record that can't be written is
// still this device's record for as long as the page is open, and a stale
// stored one is dropped rather than read in its place.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const SESSION = { userId: "u1", email: "u1@example.com", name: "U One" };
vi.mock("./auth", () => ({ getRecoveryTokenForSync: vi.fn(async () => undefined), getSession: () => SESSION }));

import { loadSeen, saveSeen, clearSeen, seenOf } from "./syncSeen";
import { mergeAndPush } from "./syncService";
import { activateSessionKey } from "./crypto";
import { DEFAULT_DATA, type LocalFinancials, type StoredGoal } from "./localData";

const SEEN = "essa_seen_u1";
const goal = (o: Partial<StoredGoal> = {}): StoredGoal => ({
  id: "g1", name: "Laptop", emoji: "💻", targetAmount: 1200, currentAmount: 0, openingAmount: 100, currency: "USD", targetDate: "2027-03-01",
  createdAt: "2026-05-01T09:00:00.000Z", updatedAt: "2026-10-01T09:00:00.000Z", ...o,
});
const on = { syncChoice: { enabled: true, decidedAt: "2026-09-28T12:00:00.000Z" } };
const data = (o: Partial<LocalFinancials> = {}) => ({ ...DEFAULT_DATA, ...on, income: 3150.75, goals: [goal()], ...o }) as LocalFinancials;

let full = false;
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  sessionStorage.setItem("essa_st_v1", "tok");
  activateSessionKey(new Uint8Array(32).fill(7));
  clearSeen("u1");
  full = false;
  const setItem = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k: string, v: string) {
    if (full && k.startsWith("essa_seen_")) throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    return setItem.call(this, k, v);
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("a record that can't be written", () => {
  it("is still this device's record while the page is open", async () => {
    full = true;
    await saveSeen("u1", data({ income: 3300 }));
    expect(localStorage.getItem(SEEN)).toBeNull();
    expect(await loadSeen("u1")).toEqual(seenOf(data({ income: 3300 })));
  });

  it("replaces a stale stored record, which is dropped rather than read in its place", async () => {
    await saveSeen("u1", data());
    expect(localStorage.getItem(SEEN)).not.toBeNull();
    full = true;
    await saveSeen("u1", data({ income: 3300 }));
    expect(localStorage.getItem(SEEN)).toBeNull();
    expect(await loadSeen("u1")).toEqual(seenOf(data({ income: 3300 })));
  });

  it("gives way to the next record that is written, and to one another tab writes", async () => {
    full = true;
    await saveSeen("u1", data({ income: 3300 }));
    full = false;
    await saveSeen("u1", data({ income: 3400 }));
    expect(await loadSeen("u1")).toEqual(seenOf(data({ income: 3400 })));
    // Another tab's record lands in storage; this tab holds no record of its own now.
    const { encryptJSON } = await import("./crypto");
    localStorage.setItem(SEEN, await encryptJSON(JSON.stringify(seenOf(data({ income: 3500 })))));
    expect(await loadSeen("u1")).toEqual(seenOf(data({ income: 3500 })));
  });

  it("is cleared with the rest: clearSeen leaves no record", async () => {
    full = true;
    await saveSeen("u1", data({ income: 3300 }));
    clearSeen("u1");
    expect(await loadSeen("u1")).toBeNull();
  });
});

describe("the 'may differ' sentence isn't repeated at every sync", () => {
  it("after a first merge whose record couldn't be saved, the next merge is not a first merge again", async () => {
    let server: LocalFinancials = data({ goals: [goal({ name: "MacBook", updatedAt: "2026-10-07T09:00:00.000Z" })] });
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      if (url === "/api/sync/pull") return new Response(JSON.stringify({ ok: true, data: server, syncedAt: new Date(Date.UTC(2026, 9, 8, 9, n)).toISOString() }), { status: 200 });
      server = (JSON.parse(String(init.body)) as { data: LocalFinancials }).data;
      return new Response(JSON.stringify({ ok: true, syncedAt: new Date(Date.UTC(2026, 9, 8, 9, ++n)).toISOString() }), { status: 200 });
    }));
    full = true;
    const first = await mergeAndPush("u1@example.com", data());
    if (!first.ok) throw new Error("expected a merge");
    expect(first.nonTransactionDivergence).toContain("goals"); // said once
    await saveSeen("u1", first.mergedData); // the merged copy was stored; recording it fails
    // The other device changes the income; this device merges again.
    server = { ...server, income: 3600 };
    const second = await mergeAndPush("u1@example.com", first.mergedData);
    if (!second.ok) throw new Error("expected a merge");
    expect(second.firstSync).toBe(false);
    expect(second.nonTransactionDivergence).toEqual([]);
    expect(second.mergedData.income).toBe(3600); // a one-sided change, taken
  });
});
