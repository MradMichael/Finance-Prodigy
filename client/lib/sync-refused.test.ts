// SEC-07 amended (owner, session 26, item 2; HELD): the client can tell a
// request refused for its credentials (the server's code
// "credentials_refused") from every other refusal, and passes it on from
// each automatic path: a push, a pull, the fetch-on-open and the conflict
// merge. The stop it triggers is kept per account (lib/syncRefused.ts).
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { pushToServer, pullFromServer, fetchAndMerge, mergeAndPush } from "./syncService";
import { isSyncRefused, markSyncRefused, clearSyncRefused } from "./syncRefused";
import { DEFAULT_DATA, type LocalFinancials } from "./localData";

const REFUSED = { error: "Invalid sync credentials for this account.", code: "credentials_refused" };
const DATA = { ...DEFAULT_DATA, income: 3000 } as LocalFinancials;
const respond = (status: number, body: unknown) => vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status })));

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); sessionStorage.setItem("essa_st_v1", "stale-token"); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("a push refused for its credentials says so", async () => {
  respond(401, REFUSED);
  expect(await pushToServer("vex-harbor@test.com", DATA)).toEqual({ ok: false, credentialsRefused: true, error: REFUSED.error });
});

it("a pull refused for its credentials says so", async () => {
  respond(401, REFUSED);
  expect(await pullFromServer("vex-harbor@test.com")).toEqual({ ok: false, credentialsRefused: true, error: REFUSED.error });
});

it("a 401 without the code (no credentials registered yet) isn't a credentials refusal", async () => {
  respond(401, { error: "This account has no sync credentials registered yet. Push from an updated client first." });
  const r = await pullFromServer("vex-harbor@test.com");
  expect(r.ok).toBe(false);
  expect("credentialsRefused" in r).toBe(false);
});

it("the fetch-on-open and the conflict merge pass it on", async () => {
  respond(401, REFUSED);
  expect(await fetchAndMerge("vex-harbor@test.com", () => DATA)).toMatchObject({ ok: false, credentialsRefused: true });
  expect(await mergeAndPush("vex-harbor@test.com", DATA)).toMatchObject({ ok: false, credentialsRefused: true });
});

it("the stop is kept per account until cleared", () => {
  expect(isSyncRefused("u1")).toBe(false);
  markSyncRefused("u1");
  expect(isSyncRefused("u1")).toBe(true);
  expect(isSyncRefused("u2")).toBe(false);
  expect(isSyncRefused(null)).toBe(false);
  clearSyncRefused("u1");
  expect(isSyncRefused("u1")).toBe(false);
});
