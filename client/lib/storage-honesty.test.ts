// Session 8, item 6 (HELD: its wording awaits the owner): a push the server
// took, whose sync time this device then couldn't write (storage full), was
// reported as "Could not reach server": the record step sat inside the
// network try, so its throw read as a network failure. The push succeeded;
// it now says so, flagged notRecorded, and the caller says storage is the
// problem (lib/storageNotices.ts, drafts).
import { it, expect, vi, beforeEach, afterEach } from "vitest";

const SESSION = { userId: "u1", email: "u1@example.com", name: "U One" };
vi.mock("./auth", () => ({ getRecoveryTokenForSync: vi.fn(async () => undefined), getSession: () => SESSION }));

import { pushToServer, pullFromServer } from "./syncService";
import { activateSessionKey } from "./crypto";
import { DEFAULT_DATA, type LocalFinancials } from "./localData";

let full = false;
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  sessionStorage.setItem("essa_st_v1", "tok");
  activateSessionKey(new Uint8Array(32).fill(7));
  full = false;
  const setItem = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k: string, v: string) {
    if (full && k.startsWith("essa_last_sync")) throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    return setItem.call(this, k, v);
  });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, syncedAt: "2026-10-08T09:01:00.000Z" }), { status: 200 })));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const data = { ...DEFAULT_DATA, income: 3000, syncChoice: { enabled: true, decidedAt: "2026-09-28T12:00:00.000Z" } } as LocalFinancials;

it("a push the server took is a success even when this device can't record its time: not 'Could not reach server'", async () => {
  full = true;
  const r = await pushToServer("u1@example.com", data);
  expect(r.ok).toBe(true);
  expect(r.syncedAt).toBe("2026-10-08T09:01:00.000Z");
  expect(r.notRecorded).toBe(true);
  expect(r.error).toBeUndefined();
});

it("an ordinary push isn't flagged", async () => {
  const r = await pushToServer("u1@example.com", data);
  expect(r.ok).toBe(true);
  expect(r.notRecorded).toBeUndefined();
});

it("a network failure still says so", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
  const r = await pushToServer("u1@example.com", data);
  expect(r.ok).toBe(false);
  expect(r.error).toBe("Could not reach server. Is it running?");
});

// Session 9 (owner): pulls too. A pull the server answered, whose time this
// device then couldn't write, read as "Could not reach server", and the
// automatic first-load restore skipped a copy it had in hand.
it("a pull the server answered is a success even when this device can't record its time, with the data", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, data, syncedAt: "2026-10-08T09:02:00.000Z" }), { status: 200 })));
  full = true;
  const r = await pullFromServer("u1@example.com");
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error(r.error);
  expect(r.data.income).toBe(3000);
  expect(r.notRecorded).toBe(true);
});

it("an ordinary pull isn't flagged, and a network failure still says so", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, data, syncedAt: "2026-10-08T09:02:00.000Z" }), { status: 200 })));
  const r = await pullFromServer("u1@example.com");
  expect(r.ok && r.notRecorded).toBeFalsy();
  vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
  const down = await pullFromServer("u1@example.com");
  expect(down).toEqual({ ok: false, error: "Could not reach server. Is it running?" });
});
