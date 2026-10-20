// SEC-07 (owner, session 25, item 4b; HELD): the client side of the
// per-account lock. The server refuses a locked account with 429,
// `accountLocked: true` and its sentence (DRAFT) with the wait filled in.
// pullFromServer passes the flag on, and sign-in shows the sentence as it is,
// not behind "Couldn't verify your account right now.", the way "Incorrect
// password for this email." is shown.
import { it, expect, vi, beforeEach, afterEach } from "vitest";

const SENTENCE = "Too many failed attempts for this account. Try again in 2 minutes.";

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); sessionStorage.setItem("essa_st_v1", "tok"); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules(); });

it("pullFromServer: a locked account's 429 comes back with its sentence and the flag", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: SENTENCE, accountLocked: true, retryAfterSeconds: 120 }), { status: 429, headers: { "Retry-After": "120" } })));
  const { pullFromServer } = await import("./syncService");
  expect(await pullFromServer("vex-harbor@test.com")).toEqual({ ok: false, error: SENTENCE, accountLocked: true });
});

it("pullFromServer: the per-client limiter's 429 is unchanged (no flag)", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Too many sync requests. Please wait a few minutes and try again." }), { status: 429 })));
  const { pullFromServer } = await import("./syncService");
  expect(await pullFromServer("vex-harbor@test.com")).toEqual({ ok: false, error: "Too many sync requests. Please wait a few minutes and try again." });
});

it("signing in on a new device while the account is locked: the sentence as it is", async () => {
  vi.doMock("./syncService", () => ({
    pullFromServer: vi.fn(async () => ({ ok: false, error: SENTENCE, accountLocked: true })),
    relinkSync: vi.fn(), getRecoveryTokenForSync: vi.fn(), confirmOverwriteIfNeeded: vi.fn(async () => true), deleteFromServer: vi.fn(), recordRestoreStored: vi.fn(() => true),
  }));
  const { signIn } = await import("./auth");
  expect(await signIn("vex-harbor@test.com", "password12345")).toEqual({ ok: false, error: SENTENCE });
});
