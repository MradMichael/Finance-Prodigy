// Owner, session 34: "'No backup yet' 404: handled quietly, no console error." The pull asks the server for a
// quiet answer (quietMissing: true); a 200 { ok: false, notFound: true } reads as "no copy", exactly as the
// API's own 404 does (which an older server still sends).
import { it, expect, vi, beforeEach, afterEach } from "vitest";
vi.mock("./auth", () => ({ getRecoveryTokenForSync: vi.fn(async () => undefined), getSession: () => ({ userId: "u1", email: "u1@example.com", name: "U One" }) }));
import { pullFromServer } from "./syncService";

let respond: () => Response;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  sessionStorage.setItem("essa_st_v1", "tok");
  fetchMock = vi.fn(async () => respond());
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); sessionStorage.clear(); });

it("the pull asks for the quiet answer", async () => {
  respond = () => new Response(JSON.stringify({ ok: false, notFound: true }), { status: 200 });
  await pullFromServer("u1@example.com");
  const init = fetchMock.mock.calls[0][1] as RequestInit;
  expect(JSON.parse(String(init.body))).toEqual({ email: "u1@example.com", quietMissing: true });
});

it("the quiet answer reads as no copy", async () => {
  respond = () => new Response(JSON.stringify({ ok: false, notFound: true }), { status: 200 });
  expect(await pullFromServer("u1@example.com")).toMatchObject({ ok: false, notFound: true });
});

it("an older server's 404 still reads as no copy", async () => {
  respond = () => new Response(JSON.stringify({ error: "No sync data found for this account." }), { status: 404 });
  expect(await pullFromServer("u1@example.com")).toMatchObject({ ok: false, notFound: true });
});

it("a 200 without a copy or the not-found mark is still a failure, not \"no copy\"", async () => {
  respond = () => new Response(JSON.stringify({ ok: false }), { status: 200 });
  const r = await pullFromServer("u1@example.com");
  expect(r.ok).toBe(false);
  expect(r).not.toHaveProperty("notFound");
});
