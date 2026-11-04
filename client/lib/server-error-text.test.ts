// Session 40 (owner, urgent): Profile's Push and Merge showed "✗ [object
// Object]". They print the call's `error`, and syncService took the response's
// `error` field unchecked. Our server only ever sends a string there, but a
// platform answering in its place (Vercel's proxy when it can't reach the
// server, or the host with no service running) can send an object. A sync
// call's `error` is now the server's own text only when it is text; anything
// else is the approved fallback the call already had.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { pushToServer, pullFromServer, mergeAndPush, relinkSync, deleteFromServer, serverTrouble } from "./syncService";
import { DEFAULT_DATA, type LocalFinancials } from "./localData";

const DATA = { ...DEFAULT_DATA, income: 3150.75 } as LocalFinancials;
const PLATFORM = { error: { code: "ROUTER_EXTERNAL_TARGET_ERROR", message: "An error occurred with this application." } };

/** Every request answered with this status and JSON body. */
function answer(status: number, body: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status })));
}

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  sessionStorage.setItem("essa_st_v1", "tok");
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("a failed response whose error is an object: the approved fallback, never [object Object]", () => {
  it("push", async () => {
    answer(502, PLATFORM);
    const r = await pushToServer("u1@example.com", DATA);
    expect(r).toMatchObject({ ok: false, error: serverTrouble(502) });
  });

  it("pull", async () => {
    answer(502, PLATFORM);
    expect(await pullFromServer("u1@example.com")).toMatchObject({ ok: false, error: serverTrouble(502) });
  });

  it("merge (its pull fails)", async () => {
    answer(504, PLATFORM);
    expect(await mergeAndPush("u1@example.com", DATA)).toMatchObject({ ok: false, error: serverTrouble(504) });
  });

  it("relink", async () => {
    answer(502, PLATFORM);
    expect(await relinkSync("u1@example.com", "tok", "rec")).toMatchObject({ ok: false, error: serverTrouble(502) });
  });

  it("delete", async () => {
    answer(502, PLATFORM);
    expect(await deleteFromServer("u1@example.com", "tok")).toMatchObject({ ok: false, serverStatus: 502, error: serverTrouble(502) });
  });

  it("the stale-push refusal keeps its own sentence", async () => {
    answer(409, { code: "stale_push", error: { detail: "x" } });
    expect(await pushToServer("u1@example.com", DATA)).toMatchObject({ ok: false, conflict: true, error: "Server data has changed since your last sync." });
  });

  it("the refused-credentials answer keeps its own sentence", async () => {
    answer(401, { code: "credentials_refused", error: { detail: "x" } });
    expect(await pushToServer("u1@example.com", DATA)).toMatchObject({ ok: false, credentialsRefused: true, error: "Invalid sync credentials for this account." });
  });

  it("an empty string is no message either", async () => {
    answer(500, { error: "" });
    expect(await pushToServer("u1@example.com", DATA)).toMatchObject({ ok: false, error: serverTrouble(500) });
  });
});

describe("the server's own text is still shown as it is", () => {
  it("push and pull", async () => {
    answer(500, { error: "Something went wrong on our side. Your data is safe." });
    expect(await pushToServer("u1@example.com", DATA)).toMatchObject({ ok: false, error: "Something went wrong on our side. Your data is safe." });
    expect(await pullFromServer("u1@example.com")).toMatchObject({ ok: false, error: "Something went wrong on our side. Your data is safe." });
  });

  it("delete", async () => {
    answer(500, { error: "Something went wrong on our side. Your data is safe." });
    expect(await deleteFromServer("u1@example.com", "tok")).toMatchObject({ ok: false, error: "Something went wrong on our side. Your data is safe." });
  });
});
