// Opt-in sync, part 2 (audit 2.4.153) -- recording the choice, and the one
// network consequence each choice has. applyBackupChoice is the only place
// the choice is written, so the switch and part 3's load-time prompt cannot
// disagree about what "off, delete" does.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DEFAULT_DATA, syncAllowed, type LocalFinancials } from "./localData";
import { applyBackupChoice } from "./syncService";

const NOW = new Date("2026-09-28T11:42:05.000Z");
const data = { ...DEFAULT_DATA, income: 3000 } as LocalFinancials;

const fetchMock = vi.fn(async () => new Response(JSON.stringify({ syncedAt: NOW.toISOString() }), { status: 200 }));
beforeEach(() => { vi.stubGlobal("fetch", fetchMock); fetchMock.mockClear(); sessionStorage.setItem("essa_st_v1", "tok"); });
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
  it("off, keep: records off and touches the network not at all", async () => {
    const { data: next, result } = await applyBackupChoice("u1@example.com", data, "off-keep", NOW);
    expect(next.syncChoice).toEqual({ enabled: false, decidedAt: "2026-09-28T11:42:05.000Z" });
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
  });

  it("a failed delete is reported, and the choice still stands as off", async () => {
    // The owner asked for no upload; a server that could not be reached
    // does not turn backup back on. The failure is surfaced, not swallowed.
    fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify({ error: "down" }), { status: 503 }));
    const { data: next, result } = await applyBackupChoice("u1@example.com", data, "off-delete", NOW);
    expect(syncAllowed(next)).toBe(false);
    expect(result?.ok).toBe(false);
  });
});

describe("the choice never touches anything but syncChoice", () => {
  it("every other field is returned unchanged", async () => {
    const { data: next } = await applyBackupChoice("u1@example.com", data, "off-keep", NOW);
    const { syncChoice: _, ...rest } = next;
    expect(rest).toEqual(data);
  });
});
