import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  pushToServer, pullFromServer, relinkSync, deleteFromServer, checkEmailExists,
  getLastSyncTime, hasAutoPulled, markAutoPulled,
} from "./syncService";
import { getSyncToken } from "./crypto";
import { getRecoveryTokenForSync } from "./auth";
import { DEFAULT_DATA } from "./localData";

vi.mock("./crypto", () => ({ getSyncToken: vi.fn() }));
vi.mock("./auth", () => ({ getRecoveryTokenForSync: vi.fn() }));

function mockFetchOnce(status: number, body: unknown) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }));
}

beforeEach(() => {
  localStorage.clear();
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

  it("rejects a wrong-password pull with the server's own 401 message", async () => {
    mockFetchOnce(401, { error: "Invalid sync credentials for this account." });
    const result = await pullFromServer("a@test.com");
    expect(result).toEqual({ ok: false, error: "Invalid sync credentials for this account." });
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
