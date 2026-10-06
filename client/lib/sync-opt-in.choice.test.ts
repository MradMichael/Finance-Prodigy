// Opt-in sync, part 2 (audit 2.4.153) -- recording the choice, and the one
// network consequence each choice has. applyBackupChoice is the only place
// the choice is written, so the switch and part 3's load-time prompt cannot
// disagree about what "off, delete" does.
//
// FB-1b2 (2026-10-05): an off choice also records what this device knows
// about a server copy -- kept, deleted, or confirmed never to have existed --
// because regenerating a recovery code asks the server only when a copy may
// exist. A delete counts as deleted only when the server said it was.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DEFAULT_DATA, syncAllowed, type LocalFinancials } from "./localData";
import { applyBackupChoice } from "./syncService";

const NOW = new Date("2026-09-28T11:42:05.000Z");
const data = { ...DEFAULT_DATA, income: 3000 } as LocalFinancials;

const fetchMock = vi.fn(async () => new Response(JSON.stringify({ syncedAt: NOW.toISOString() }), { status: 200 }));
// localStorage too: "on" pushes, and the push records a last-sync time
// that the off choices below now read.
beforeEach(() => { vi.stubGlobal("fetch", fetchMock); fetchMock.mockClear(); localStorage.clear(); sessionStorage.setItem("essa_st_v1", "tok"); });
afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear(); });

const call = (i = 0) => fetchMock.mock.calls[i] as unknown as [string, RequestInit];

describe("turning backup ON", () => {
  it("records the choice with its instant, and uploads immediately", async () => {
    const { data: next, result } = await applyBackupChoice("u1@example.com", data, "on", NOW);
    expect(next.syncChoice).toEqual({ enabled: true, decidedAt: "2026-09-28T11:42:05.000Z" });
    expect(syncAllowed(next)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(call()[0]).toBe("/api/sync/push");
    // The uploaded copy carries the choice, so another device pulling it
    // learns backup is on rather than meeting an undecided account.
    expect(JSON.parse(String(call()[1].body)).data.syncChoice.enabled).toBe(true);
    expect(result?.ok).toBe(true);
  });
});

describe("turning backup OFF", () => {
  it("off, keep: records off with the copy kept, and touches the network not at all", async () => {
    const { data: next, result } = await applyBackupChoice("u1@example.com", data, "off-keep", NOW);
    expect(next.syncChoice).toEqual({ enabled: false, decidedAt: "2026-09-28T11:42:05.000Z", serverCopy: "kept" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it("off, delete: records off and deletes the server copy -- never pushes first", async () => {
    const { data: next, result } = await applyBackupChoice("u1@example.com", data, "off-delete", NOW);
    expect(syncAllowed(next)).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(call()[0]).toBe("/api/sync");
    expect(call()[1].method).toBe("DELETE");
    expect(result?.ok).toBe(true);
    // With this browser's last-sync time at that moment: any push or pull
    // after it means a copy may exist again (serverCheckNeeded).
    expect(next.syncChoice).toEqual({ enabled: false, decidedAt: "2026-09-28T11:42:05.000Z", serverCopy: "deleted", lastSyncAtChoice: null });
  });

  it("off, delete, on a browser that has synced: records that last-sync time beside 'deleted'", async () => {
    localStorage.setItem("essa_last_sync", "2026-09-27T08:00:00.000Z");
    try {
      const { data: next } = await applyBackupChoice("u1@example.com", data, "off-delete", NOW);
      expect(next.syncChoice?.lastSyncAtChoice).toBe("2026-09-27T08:00:00.000Z");
    } finally { localStorage.removeItem("essa_last_sync"); }
  });

  it("a failed delete is reported, and the choice still stands as off", async () => {
    // The owner asked for no upload; a server that could not be reached
    // does not turn backup back on. The failure is surfaced, not swallowed.
    fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify({ error: "down" }), { status: 503 }));
    const { data: next, result } = await applyBackupChoice("u1@example.com", data, "off-delete", NOW);
    expect(syncAllowed(next)).toBe(false);
    expect(result?.ok).toBe(false);
    // The copy may still be there, so it is recorded as kept, not deleted.
    expect(next.syncChoice?.serverCopy).toBe("kept");
  });

  it("off with nothing to keep, confirmed by the server check: records none, and no network", async () => {
    const { data: next, result } = await applyBackupChoice("u1@example.com", data, "off-none", NOW, { noCopyConfirmed: true });
    expect(next.syncChoice).toEqual({ enabled: false, decidedAt: "2026-09-28T11:42:05.000Z", serverCopy: "none", lastSyncAtChoice: null });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it("off with nothing to keep, but the check couldn't confirm it: records nothing about a copy (fail closed)", async () => {
    // An offline check reads as "no copy", and one may exist, made by another device.
    const { data: next, result } = await applyBackupChoice("u1@example.com", data, "off-none", NOW);
    expect(next.syncChoice).toEqual({ enabled: false, decidedAt: "2026-09-28T11:42:05.000Z" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });
});

describe("the choice never touches anything but syncChoice", () => {
  it("every other field is returned unchanged", async () => {
    const { data: next } = await applyBackupChoice("u1@example.com", data, "off-keep", NOW);
    const { syncChoice: _, ...rest } = next;
    expect(rest).toEqual(data);
  });
});
