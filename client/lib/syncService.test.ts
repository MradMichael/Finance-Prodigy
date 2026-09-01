import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  pushToServer, pullFromServer, relinkSync, deleteFromServer, checkEmailExists,
  getLastSyncTime, hasAutoPulled, markAutoPulled,
  hasAnyLocalData, hasRealLocalData, confirmOverwriteIfNeeded,
  mergeAndPush,
} from "./syncService";
import { getSyncToken } from "./crypto";
import { getRecoveryTokenForSync } from "./auth";
import { saveData, DEFAULT_DATA, type LocalFinancials, type StoredTransaction } from "./localData";

vi.mock("./crypto", async (importOriginal) => {
  // Only getSyncToken is mocked -- activateSessionKey/encryptJSON/decryptJSON
  // stay real (via importOriginal) so the 2.4.37 guard tests below can
  // exercise actual saveData/loadData round-trips through hasRealLocalData,
  // not just push/pull's own token-gated network calls this file originally
  // covered.
  const actual = await importOriginal<typeof import("./crypto")>();
  return { ...actual, getSyncToken: vi.fn() };
});
vi.mock("./auth", () => ({ getRecoveryTokenForSync: vi.fn() }));

function mockFetchOnce(status: number, body: unknown) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }));
}

// activateSessionKey needs a real key active for saveData/loadData (used by
// hasRealLocalData's tests below) to actually encrypt/decrypt -- these tests
// only care about presence/absence of a real financial payload, not what's
// in it, so a fixed dummy key is enough.
async function activateDummyKey() {
  const { activateSessionKey } = await import("./crypto");
  activateSessionKey(new Uint8Array(32).fill(7));
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
  vi.mocked(getSyncToken).mockReset().mockReturnValue("token-abc");
  vi.mocked(getRecoveryTokenForSync).mockReset().mockReturnValue(undefined);
});

describe("pushToServer", () => {
  it("refuses to push without a sync token, without ever calling fetch", async () => {
    vi.mocked(getSyncToken).mockReturnValue(null);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const result = await pushToServer("a@test.com", DEFAULT_DATA);
    expect(result).toEqual({ ok: false, error: "Not signed in. Sign in again to sync." });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sends the token and (when present) the recovery token in the request body", async () => {
    vi.mocked(getRecoveryTokenForSync).mockReturnValue("recovery-token-xyz");
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ syncedAt: "2026-01-01T00:00:00.000Z" }) });
    vi.stubGlobal("fetch", fetchSpy);
    await pushToServer("a@test.com", DEFAULT_DATA);
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/sync/push");
    const body = JSON.parse(opts.body);
    expect(body.token).toBe("token-abc");
    expect(body.recoveryToken).toBe("recovery-token-xyz");
    expect(body.email).toBe("a@test.com");
  });

  it("omits recoveryToken entirely (not even as undefined) when there isn't one locally yet", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ syncedAt: "2026-01-01T00:00:00.000Z" }) });
    vi.stubGlobal("fetch", fetchSpy);
    await pushToServer("a@test.com", DEFAULT_DATA);
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect("recoveryToken" in body).toBe(false);
  });

  it("succeeds and records the sync time on a valid 200 response", async () => {
    mockFetchOnce(200, { syncedAt: "2026-03-01T12:00:00.000Z" });
    const result = await pushToServer("a@test.com", DEFAULT_DATA);
    expect(result).toEqual({ ok: true, syncedAt: "2026-03-01T12:00:00.000Z" });
    expect(getLastSyncTime()).toBe("2026-03-01T12:00:00.000Z");
  });

  it("surfaces the server's own error message on a non-2xx response", async () => {
    mockFetchOnce(401, { error: "Invalid sync credentials for this account." });
    const result = await pushToServer("a@test.com", DEFAULT_DATA);
    expect(result).toEqual({ ok: false, error: "Invalid sync credentials for this account." });
  });

  it("reports a malformed 200 response distinctly, instead of crashing or claiming the server is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ notSyncedAt: true }) }));
    const result = await pushToServer("a@test.com", DEFAULT_DATA);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/malformed/i);
  });

  it("reports a network failure (fetch throws) as unreachable, not as a crash", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const result = await pushToServer("a@test.com", DEFAULT_DATA);
    expect(result).toEqual({ ok: false, error: "Could not reach server. Is it running?" });
  });

  it("BUG regression guard (2.4.38): sends baseSyncedAt from the last known sync time, and surfaces a stale-push conflict distinctly from a generic failure", async () => {
    // Prime getLastSyncTime() via a prior successful push, matching how a
    // real session would have one before this second push happens.
    mockFetchOnce(200, { syncedAt: "2026-01-01T00:00:00.000Z" });
    await pushToServer("a@test.com", DEFAULT_DATA);

    const fetchSpy = vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ code: "stale_push", error: "Server data has changed since your last sync." }) });
    vi.stubGlobal("fetch", fetchSpy);
    const result = await pushToServer("a@test.com", DEFAULT_DATA);
    expect(result.ok).toBe(false);
    expect(result.conflict).toBe(true);

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.baseSyncedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("omits baseSyncedAt entirely when this device has never successfully synced yet", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ syncedAt: "2026-01-01T00:00:00.000Z" }) });
    vi.stubGlobal("fetch", fetchSpy);
    await pushToServer("a@test.com", DEFAULT_DATA);
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect("baseSyncedAt" in body).toBe(false);
  });

  it("a plain 409 without the stale_push code (e.g. the pre-existing 'sync is busy' case) is NOT reported as a conflict", async () => {
    mockFetchOnce(409, { error: "Sync is busy. Please try again." });
    const result = await pushToServer("a@test.com", DEFAULT_DATA);
    expect(result.ok).toBe(false);
    expect(result.conflict).toBeFalsy();
  });
});

describe("pullFromServer", () => {
  it("refuses to pull without a sync token", async () => {
    vi.mocked(getSyncToken).mockReturnValue(null);
    const result = await pullFromServer("a@test.com");
    expect(result).toEqual({ ok: false, error: "Not signed in. Sign in again to sync." });
  });

  it("sends the token as a Bearer header, not a query param", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ syncedAt: "2026-01-01T00:00:00.000Z", data: DEFAULT_DATA, hasRecoveryCode: true }) });
    vi.stubGlobal("fetch", fetchSpy);
    await pullFromServer("a@test.com");
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).not.toContain("token-abc"); // never in the URL
    expect(opts.headers.Authorization).toBe("Bearer token-abc");
  });

  it("passes through hasRecoveryCode from the server response (defaulting to false if absent, never crashing on an older/malformed response)", async () => {
    mockFetchOnce(200, { syncedAt: "2026-01-01T00:00:00.000Z", data: DEFAULT_DATA, hasRecoveryCode: true });
    const withFlag = await pullFromServer("a@test.com");
    expect(withFlag.ok && withFlag.hasRecoveryCode).toBe(true);

    mockFetchOnce(200, { syncedAt: "2026-01-01T00:00:00.000Z", data: DEFAULT_DATA });
    const withoutFlag = await pullFromServer("a@test.com");
    expect(withoutFlag.ok && withoutFlag.hasRecoveryCode).toBe(false);
  });

  it("gives a specific 'push first' message on 404, distinct from other failures", async () => {
    mockFetchOnce(404, { error: "ignored" });
    const result = await pullFromServer("a@test.com");
    expect(result).toEqual({ ok: false, error: "No data on server yet. Push first." });
  });

  // 2.4.22 -- a bare HTTP 404 status used to be trusted on its own as "no
  // account for this email," conflating the API's own genuine "no sync
  // data" response with any unrelated platform-level 404 (a routing
  // misconfiguration, a proxy error page, an unmigrated deploy) that
  // happens to also carry a 404 status but not the API's own JSON shape.
  it("does NOT treat a 404 with no parseable error body as 'no account' -- only the API's own shaped response counts", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false, status: 404, json: async () => { throw new Error("not JSON"); },
    }));
    const result = await pullFromServer("a@test.com");
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).not.toBe("No data on server yet. Push first.");
  });

  it("does NOT treat a 404 with a body missing the expected error field as 'no account'", async () => {
    mockFetchOnce(404, { unexpected: "shape" });
    const result = await pullFromServer("a@test.com");
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).not.toBe("No data on server yet. Push first.");
  });

  it("rejects a wrong-password pull with the server's own 401 message", async () => {
    mockFetchOnce(401, { error: "Invalid sync credentials for this account." });
    const result = await pullFromServer("a@test.com");
    expect(result).toEqual({ ok: false, error: "Invalid sync credentials for this account." });
  });
});

describe("mergeAndPush (Phase 2.7 sub-phase 2 -- wires mergeTransactions into the pull-merge-push flow, tests-first)", () => {
  function makeTx(overrides: Partial<StoredTransaction> = {}): StoredTransaction {
    return { id: "t1", amount: 10, currency: "USD", bucket: "NEEDS", description: "Test", date: "2026-08-01", ...overrides };
  }

  it("pulls the server's current data, merges transactions, and pushes the merged result -- both new-elsewhere transactions survive", async () => {
    const local: LocalFinancials = { ...DEFAULT_DATA, income: 3000, transactions: [makeTx({ id: "local-only" })] };
    const serverData: LocalFinancials = { ...DEFAULT_DATA, transactions: [makeTx({ id: "server-only" })] };
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ syncedAt: "2026-08-01T00:00:00.000Z", data: serverData, hasRecoveryCode: false }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ syncedAt: "2026-08-02T00:00:00.000Z" }) });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await mergeAndPush("a@test.com", local);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.addedFromServer).toBe(1);
    expect(result.conflictsResolved).toBe(0);

    // The SECOND fetch call is the push -- confirm it actually sent the
    // merged transaction list, not just local's original one.
    const pushBody = JSON.parse(fetchSpy.mock.calls[1][1].body);
    const pushedIds = pushBody.data.transactions.map((t: StoredTransaction) => t.id).sort();
    expect(pushedIds).toEqual(["local-only", "server-only"]);
  });

  it("preserves local's own non-transaction fields in the pushed payload -- this phase merges transactions only; everything else keeps today's pick-a-side (local wins, since local is the side initiating the merge)", async () => {
    const local: LocalFinancials = { ...DEFAULT_DATA, income: 3000, transactions: [] };
    const serverData: LocalFinancials = { ...DEFAULT_DATA, income: 9999, transactions: [] };
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ syncedAt: "2026-08-01T00:00:00.000Z", data: serverData, hasRecoveryCode: false }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ syncedAt: "2026-08-02T00:00:00.000Z" }) });
    vi.stubGlobal("fetch", fetchSpy);

    await mergeAndPush("a@test.com", local);
    const pushBody = JSON.parse(fetchSpy.mock.calls[1][1].body);
    expect(pushBody.data.income).toBe(3000); // local's, not server's 9999
  });

  it("surfaces conflictsResolved AND the conflicts array (not just a count) -- what the eventual toast (sub-phase 3) needs to name what changed, not just that something did", async () => {
    const olderLocal = makeTx({ id: "shared", amount: 50, description: "Groceries", updatedAt: "2026-08-01T00:00:00.000Z" });
    const newerServer = makeTx({ id: "shared", amount: 75, description: "Groceries (corrected)", updatedAt: "2026-08-10T00:00:00.000Z" });
    const local: LocalFinancials = { ...DEFAULT_DATA, transactions: [olderLocal] };
    const serverData: LocalFinancials = { ...DEFAULT_DATA, transactions: [newerServer] };
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ syncedAt: "2026-08-01T00:00:00.000Z", data: serverData, hasRecoveryCode: false }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ syncedAt: "2026-08-02T00:00:00.000Z" }) });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await mergeAndPush("a@test.com", local);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.conflictsResolved).toBe(1);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].amount).toBe(75);
    expect(result.conflicts[0].description).toBe("Groceries (corrected)");
  });

  it("propagates a pull failure without ever attempting a push", async () => {
    const fetchSpy = vi.fn().mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ error: "Invalid sync credentials for this account." }) });
    vi.stubGlobal("fetch", fetchSpy);
    const result = await mergeAndPush("a@test.com", { ...DEFAULT_DATA, transactions: [] });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toBe("Invalid sync credentials for this account.");
    expect(fetchSpy).toHaveBeenCalledTimes(1); // pull only -- push never attempted
  });

  it("propagates a push failure (e.g. the server moved on again between pull and push -- a genuine race) as a real error, not silently swallowed", async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ syncedAt: "2026-08-01T00:00:00.000Z", data: DEFAULT_DATA, hasRecoveryCode: false }) })
      .mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ code: "stale_push", error: "Server data has changed since your last sync." }) });
    vi.stubGlobal("fetch", fetchSpy);
    const result = await mergeAndPush("a@test.com", { ...DEFAULT_DATA, transactions: [] });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.conflict).toBe(true);
  });

  it("uses the exact same /api/sync/pull and /api/sync/push endpoints as the manual flow -- no server-side change required", async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ syncedAt: "2026-08-01T00:00:00.000Z", data: DEFAULT_DATA, hasRecoveryCode: false }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ syncedAt: "2026-08-02T00:00:00.000Z" }) });
    vi.stubGlobal("fetch", fetchSpy);
    await mergeAndPush("a@test.com", { ...DEFAULT_DATA, transactions: [] });
    expect(fetchSpy.mock.calls[0][0]).toContain("/api/sync/pull");
    expect(fetchSpy.mock.calls[1][0]).toBe("/api/sync/push");
  });
});

describe("relinkSync", () => {
  it("succeeds on a 200 and sends both the new and previous recovery token", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchSpy);
    const result = await relinkSync("a@test.com", "new-token", "new-recovery", "old-recovery");
    expect(result).toEqual({ ok: true });
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body).toMatchObject({ email: "a@test.com", token: "new-token", recoveryToken: "new-recovery", oldRecoveryToken: "old-recovery" });
  });

  it("surfaces a denial (e.g. old recovery token mismatch) as a clear error", async () => {
    mockFetchOnce(401, { error: "Could not verify ownership of this account's sync data." });
    const result = await relinkSync("a@test.com", "new-token", "new-recovery");
    expect(result.ok).toBe(false);
  });
});

describe("deleteFromServer", () => {
  it("succeeds on a 200", async () => {
    mockFetchOnce(200, { ok: true });
    const result = await deleteFromServer("a@test.com", "token-abc");
    expect(result).toEqual({ ok: true });
  });

  it("surfaces a denial as an error rather than silently succeeding", async () => {
    mockFetchOnce(401, { error: "Invalid sync credentials for this account." });
    const result = await deleteFromServer("a@test.com", "wrong-token");
    expect(result.ok).toBe(false);
  });
});

describe("checkEmailExists", () => {
  it("returns true/false straight from the server's json", async () => {
    mockFetchOnce(200, { exists: true });
    expect(await checkEmailExists("a@test.com")).toBe(true);
    mockFetchOnce(200, { exists: false });
    expect(await checkEmailExists("b@test.com")).toBe(false);
  });

  it("fails open to false on a network error or non-2xx -- never blocks sign-up on a server hiccup", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    expect(await checkEmailExists("a@test.com")).toBe(false);
    mockFetchOnce(500, { error: "server error" });
    expect(await checkEmailExists("a@test.com")).toBe(false);
  });
});

describe("local sync bookkeeping", () => {
  it("getLastSyncTime is null until a push/pull records one", () => {
    expect(getLastSyncTime()).toBeNull();
  });

  it("hasAutoPulled/markAutoPulled are scoped per userId, not global", () => {
    expect(hasAutoPulled("user-1")).toBe(false);
    markAutoPulled("user-1");
    expect(hasAutoPulled("user-1")).toBe(true);
    expect(hasAutoPulled("user-2")).toBe(false); // a different account's flag is untouched
  });
});

describe("hasAnyLocalData (2.4.37)", () => {
  it("is false when no essa_data_* key exists in localStorage", () => {
    expect(hasAnyLocalData()).toBe(false);
  });

  it("is true when ANY essa_data_* key exists, regardless of which account", () => {
    localStorage.setItem("essa_data_some-other-user-id", "{}");
    expect(hasAnyLocalData()).toBe(true);
  });

  it("ignores unrelated localStorage keys", () => {
    localStorage.setItem("essa_users_v1", "[]");
    localStorage.setItem("essa_session_v1", "{}");
    expect(hasAnyLocalData()).toBe(false);
  });
});

describe("hasRealLocalData (2.4.37)", () => {
  it("is false for a userId with no stored data at all", async () => {
    expect(await hasRealLocalData("nobody")).toBe(false);
  });

  it("is false for a userId whose stored data is the empty default", async () => {
    await activateDummyKey();
    await saveData(DEFAULT_DATA, "u1");
    expect(await hasRealLocalData("u1")).toBe(false);
  });

  it("is true for a userId with real, non-empty financial data", async () => {
    await activateDummyKey();
    const real: LocalFinancials = { ...DEFAULT_DATA, income: 1000, transactions: [
      { id: "t1", amount: 10, currency: "USD", bucket: "NEEDS", description: "Coffee", date: "2026-01-01" },
    ] };
    await saveData(real, "u2");
    expect(await hasRealLocalData("u2")).toBe(true);
  });
});

describe("confirmOverwriteIfNeeded (2.4.37)", () => {
  it("proceeds silently, without prompting, when the coarse check (no userId) finds no local data at all", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    const result = await confirmOverwriteIfNeeded(undefined, "the server");
    expect(result).toBe(true);
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("proceeds silently, without prompting, when the precise check (known userId) finds no real local data", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    const result = await confirmOverwriteIfNeeded("empty-user", "the server");
    expect(result).toBe(true);
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("prompts, and returns false, when real local data exists (known userId) and the user declines", async () => {
    await activateDummyKey();
    await saveData({ ...DEFAULT_DATA, income: 5000 }, "u3");
    vi.spyOn(window, "confirm").mockReturnValue(false);
    expect(await confirmOverwriteIfNeeded("u3", "the server")).toBe(false);
  });

  it("prompts, and returns true, when real local data exists (known userId) and the user accepts", async () => {
    await activateDummyKey();
    await saveData({ ...DEFAULT_DATA, income: 5000 }, "u4");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    expect(await confirmOverwriteIfNeeded("u4", "the server")).toBe(true);
  });

  it("prompts using the coarse check when no userId is known and SOME account's data exists in this browser", async () => {
    localStorage.setItem("essa_data_someone-else", "{}");
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    expect(await confirmOverwriteIfNeeded(undefined, "the server")).toBe(true);
    expect(confirmSpy).toHaveBeenCalled();
  });
});
