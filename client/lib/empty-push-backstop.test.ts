// COPY-11's backstop (owner, 2026-10-07): never push an EMPTY account over a
// server copy that has data without an explicit ask.
//
// The route that made this necessary: someone re-signs up on a new device with
// an address that already has synced data (sign-up only warns). If the
// first-load restore didn't happen (skipped, or unreachable), the account is
// empty, and "Keep backing up" -- or any later upload -- replaced the backup
// with nothing.
//
// pushToServer now looks before such a push: if this device's data is empty,
// it reads the server copy (without recording a sync) and, only if that copy
// has data, asks. Cancel keeps the backup and uploads nothing. "Reset all data"
// passes allowEmptyOverwrite: its own typed confirm already says the backup
// will be replaced.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { pushToServer, applyBackupChoice } from "./syncService";
import { DEFAULT_DATA, type LocalFinancials } from "./localData";

const EMPTY = { ...DEFAULT_DATA } as LocalFinancials;
const WITH_DATA = { ...DEFAULT_DATA, income: 3150.75 } as LocalFinancials;
let serverCopy: LocalFinancials | null;
let pushes: unknown[];
let confirmSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  sessionStorage.setItem("essa_st_v1", "tok");
  pushes = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    if (url === "/api/sync/pull") {
      return serverCopy
        ? new Response(JSON.stringify({ ok: true, data: serverCopy, syncedAt: "2026-10-06T19:02:11.000Z", hasRecoveryCode: true }), { status: 200 })
        : new Response(JSON.stringify({ error: "No data for this account." }), { status: 404 });
    }
    if (url === "/api/sync/push") {
      pushes.push(JSON.parse(init.body as string).data);
      return new Response(JSON.stringify({ ok: true, syncedAt: "2026-10-07T18:00:00.000Z" }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  }));
  confirmSpy = vi.spyOn(window, "confirm");
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("pushing an empty account", () => {
  it("over a backup that has data: asks, and Cancel uploads nothing", async () => {
    serverCopy = WITH_DATA;
    confirmSpy.mockReturnValue(false);
    const r = await pushToServer("u1@example.com", EMPTY);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy.mock.calls[0][0]).toBe("Your backup on our server has data, but this device has none. Replace the backup with this empty copy? Cancel keeps the backup as it is.");
    expect(pushes).toEqual([]);
    expect(r).toMatchObject({ ok: false, declined: true });
  });

  it("OK replaces it, as asked", async () => {
    serverCopy = WITH_DATA;
    confirmSpy.mockReturnValue(true);
    expect((await pushToServer("u1@example.com", EMPTY)).ok).toBe(true);
    expect(pushes).toHaveLength(1);
  });

  it("no copy on the server: uploads without asking", async () => {
    serverCopy = null;
    await pushToServer("u1@example.com", EMPTY);
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(pushes).toHaveLength(1);
  });

  it("an empty server copy: nothing to lose, no ask", async () => {
    serverCopy = EMPTY;
    await pushToServer("u1@example.com", EMPTY);
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(pushes).toHaveLength(1);
  });

  it("the reset's own push doesn't ask again", async () => {
    serverCopy = WITH_DATA;
    await pushToServer("u1@example.com", EMPTY, { allowEmptyOverwrite: true });
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(pushes).toHaveLength(1);
  });

  it("turning backup on with an empty account goes through the same ask", async () => {
    serverCopy = WITH_DATA;
    confirmSpy.mockReturnValue(false);
    const { result } = await applyBackupChoice("u1@example.com", EMPTY, "on");
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(pushes).toEqual([]);
    expect(result).toMatchObject({ ok: false, declined: true });
  });

  it("the read before asking doesn't record a sync", async () => {
    serverCopy = WITH_DATA;
    confirmSpy.mockReturnValue(false);
    await pushToServer("u1@example.com", EMPTY);
    expect(localStorage.getItem("essa_last_sync")).toBeNull();
  });
});

describe("pushing an account with data", () => {
  it("never reads the server first, never asks", async () => {
    serverCopy = WITH_DATA;
    await pushToServer("u1@example.com", WITH_DATA);
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(vi.mocked(fetch).mock.calls.map((c) => c[0])).toEqual(["/api/sync/push"]);
  });
});
