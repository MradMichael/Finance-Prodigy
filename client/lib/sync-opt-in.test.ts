// Opt-in sync, part 1 (audit 2.4.153) -- the decision function, and the one
// upload site outside autoSync: Profile's recovery-code regenerate, which
// used to push as a side effect of an unrelated action.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { syncAllowed, DEFAULT_DATA, type LocalFinancials } from "./localData";
import { pushRecoveryUpdate } from "./syncService";

const at = "2026-09-28T10:00:00.000Z";

describe("syncAllowed -- the single decision", () => {
  it("undecided is NOT allowed: paused, not on", () => {
    expect(syncAllowed({})).toBe(false);
  });
  it("off is not allowed", () => {
    expect(syncAllowed({ syncChoice: { enabled: false, decidedAt: at } })).toBe(false);
  });
  it("on is allowed", () => {
    expect(syncAllowed({ syncChoice: { enabled: true, decidedAt: at } })).toBe(true);
  });
  it("a new account starts undecided -- DEFAULT_DATA carries no choice", () => {
    expect(DEFAULT_DATA.syncChoice).toBeUndefined();
    expect(syncAllowed(DEFAULT_DATA)).toBe(false);
  });
});

describe("pushRecoveryUpdate -- the regenerate side effect is gated too", () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ syncedAt: at }), { status: 200 }));
  beforeEach(() => { vi.stubGlobal("fetch", fetchMock); fetchMock.mockClear(); sessionStorage.setItem("essa_st_v1", "tok"); });
  afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear(); });

  it("backup off: nothing reaches the network", async () => {
    const r = await pushRecoveryUpdate("u1@example.com", { ...DEFAULT_DATA } as LocalFinancials);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(r).toEqual({ ok: false, skipped: true });
  });

  it("backup on: it pushes, as it did before", async () => {
    const data = { ...DEFAULT_DATA, syncChoice: { enabled: true, decidedAt: at } } as LocalFinancials;
    await pushRecoveryUpdate("u1@example.com", data);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe("/api/sync/push");
  });
});
