// Session 41 (owner, after the push incident): Vercel Deployment Protection put
// a login wall in front of every /api request, and Profile showed "✗ [object
// Object]". A response that isn't our server's (no ESSA JSON shape: an HTML
// page, a Vercel error object, a login page reached through a redirect) must
// never read as a refusal: never "Invalid sync credentials" or "Incorrect
// password", never the refused-credentials or locked flags (so it can't stop
// this device's syncing, and it never reaches the server's account limit), never
// the stale-device answer. It shows the approved "The server had a problem
// (error N). Try again in a minute." (sign-in wraps it in its own approved
// sentence). A login redirect the browser won't follow arrives as a network
// error: the approved "Couldn't reach the server…".
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  pushToServer, pullFromServer, mergeAndPush, fetchAndMerge, relinkSync, deleteFromServer, probeServerCopy,
  serverTrouble, UNREACHABLE,
} from "./syncService";
import { signUp, signIn, signOut } from "./auth";
import { isSyncRefused } from "./syncRefused";
import { DEFAULT_DATA, type LocalFinancials } from "./localData";

const DATA = { ...DEFAULT_DATA, income: 3150.75 } as LocalFinancials;
const EMAIL = "wall.test@example.invalid";

/** Vercel's 401 login wall: an HTML page. */
const WALL_HTML = () => new Response("<!doctype html><html><head><title>Login – Vercel</title></head><body>Authentication Required</body></html>", { status: 401, headers: { "Content-Type": "text/html" } });
/** Vercel's error-object JSON (what printed as [object Object]). */
const WALL_JSON = () => new Response(JSON.stringify({ error: { code: "401", message: "Authentication Required" } }), { status: 401, headers: { "Content-Type": "application/json" } });
/** A 401 with text in `error` but none of our server's markers. */
const WALL_TEXT = () => new Response(JSON.stringify({ error: "Authentication Required" }), { status: 401, headers: { "Content-Type": "application/json" } });
/** A login page reached through a redirect the browser followed. */
const LOGIN_PAGE_200 = () => new Response("<!doctype html><html><body>Log in to Vercel</body></html>", { status: 200, headers: { "Content-Type": "text/html" } });

function answer(make: () => Response) {
  vi.stubGlobal("fetch", vi.fn(async () => make()));
}
const blockedRedirect = () => vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));

/** Nothing in it reads as our server refusing this account. */
function notARefusal(r: Record<string, unknown>) {
  expect(JSON.stringify(r)).not.toMatch(/Invalid sync credentials|Incorrect password/);
  expect(r.credentialsRefused).toBeFalsy();
  expect(r.accountLocked).toBeFalsy();
  expect(r.staleDevice).toBeFalsy();
}

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  sessionStorage.setItem("essa_st_v1", "tok");
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

for (const [name, make] of [["Vercel's 401 login wall (HTML)", WALL_HTML], ["Vercel's error-object JSON", WALL_JSON], ["a 401 with text but none of our markers", WALL_TEXT]] as const) {
  const expected = name === "a 401 with text but none of our markers" ? undefined : serverTrouble(401);
  describe(name, () => {
    it("push, pull, merge, the fetch on opening, relink and delete: no refusal; the approved text", async () => {
      answer(make);
      const results = [
        await pushToServer(EMAIL, DATA), await pullFromServer(EMAIL), await mergeAndPush(EMAIL, DATA),
        await fetchAndMerge(EMAIL, () => DATA), await relinkSync(EMAIL, "tok", "rec"), await deleteFromServer(EMAIL, "tok"),
      ] as Record<string, unknown>[];
      for (const r of results) {
        notARefusal(r);
        expect(r.ok).toBe(false);
        if (expected) expect(r.error).toBe(expected);
      }
    });

    it("the recovery-code check reads it as unreachable, not a wrong password", async () => {
      answer(make);
      expect(await probeServerCopy(EMAIL)).toEqual({ kind: "unreachable" });
    });

    it("sign-in on a new device: not a wrong password; the approved text", async () => {
      answer(make);
      const r = await signIn(EMAIL, "a-password-1234") as Record<string, unknown>;
      notARefusal(r);
      expect(r.ok).toBe(false);
      if (expected) expect(r.error).toBe(`Couldn't verify your account right now. ${expected}`);
    });

    it("sign-in on this device with another password: no stale-device stop, the device not marked refused", async () => {
      const reg = await signUp(EMAIL, "Wall", "the-first-password-1");
      expect(reg.ok).toBe(true);
      const first = await signIn(EMAIL, "the-first-password-1");
      if (!first.ok) throw new Error(first.error);
      const userId = first.session.userId;
      signOut();
      localStorage.setItem(`essa_last_sync_${userId}`, "2026-11-03T19:10:00.000Z"); // this device has synced
      answer(make);
      const r = await signIn(EMAIL, "a-newer-password-2") as Record<string, unknown>;
      notARefusal(r);
      expect(r.ok).toBe(false);
      if (expected) expect(r.error).toBe(`Couldn't verify your account right now. ${expected}`);
      expect(isSyncRefused(userId)).toBe(false);
    });
  });
}

describe("the recovery-code check reads only our server's own answers", () => {
  it("a 404 with text that isn't ours isn't \"no copy on the server\"", async () => {
    answer(() => new Response(JSON.stringify({ error: "Not Found" }), { status: 404 }));
    expect(await probeServerCopy(EMAIL)).toEqual({ kind: "unreachable" });
  });

  it("our own answers still read as before: no copy, unregistered, wrong password", async () => {
    answer(() => new Response(JSON.stringify({ error: "No sync data found for this account." }), { status: 404 }));
    expect(await probeServerCopy(EMAIL)).toEqual({ kind: "none" });
    answer(() => new Response(JSON.stringify({ error: "This account has no sync credentials registered yet. Push from an updated client first." }), { status: 401 }));
    expect(await probeServerCopy(EMAIL)).toEqual({ kind: "unregistered" });
    answer(() => new Response(JSON.stringify({ error: "Invalid sync credentials for this account.", code: "credentials_refused" }), { status: 401 }));
    expect(await probeServerCopy(EMAIL)).toEqual({ kind: "wrong-password" });
  });
});

describe("a login page reached through a redirect (a 200 that isn't our reply)", () => {
  it("push and pull: the approved text, not a claim that it was malformed", async () => {
    answer(LOGIN_PAGE_200);
    for (const r of [await pushToServer(EMAIL, DATA), await pullFromServer(EMAIL)] as Record<string, unknown>[]) {
      notARefusal(r);
      expect(r).toMatchObject({ ok: false, error: serverTrouble(200) });
    }
  });
});

describe("a login redirect the browser won't follow (cross-site, outside the content policy)", () => {
  it("arrives as a network error: the approved \"Couldn't reach the server\"", async () => {
    blockedRedirect();
    const r = await pushToServer(EMAIL, DATA) as unknown as Record<string, unknown>;
    notARefusal(r);
    expect(r).toMatchObject({ ok: false, unreachable: true, error: UNREACHABLE });
  });
});
