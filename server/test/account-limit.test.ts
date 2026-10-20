// SEC-07 (owner, session 25, item 4b; merged in session 28): password guessing on one account
// was limited only per client (the sync limiter, per IP). A guesser spread
// over many addresses had no ceiling on one account. Now each account counts
// its own wrong credentials on pull, push, relink and delete: five are free, then
// each further failure locks that account's checks for 1, 2, 4, 8, then 15
// minutes. While locked, every request for it is refused before any
// comparison, the right password too, so a guess during a lock tells nothing.
// Push counts too (owner, session 26, reversing decision 47): a client refused
// for its credentials stops its automatic requests (client lib/syncRefused.ts),
// so a stale device fails once. One app per test: the counts live on the app,
// as in production.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { store } from "./support/fakePrisma";
import { hash, storedData, SENTINEL } from "./support/http";

const A = "guess-target@example.com";
const B = "bystander@example.com";
let app: ReturnType<typeof createApp>;
let clock: number;
const at = (ms: number) => { clock += ms; vi.setSystemTime(clock); };
const MIN = 60_000;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  clock = Date.parse("2026-10-19T10:00:00.000Z"); vi.setSystemTime(clock);
  app = createApp();
  store.seedUserSync({ email: A, authTokenHash: hash("token-of-A"), recoveryTokenHash: hash("recovery-of-A"), dataJson: storedData() });
  store.seedUserSync({ email: B, authTokenHash: hash("token-of-B"), dataJson: storedData() });
});
afterEach(() => { vi.useRealTimers(); });

const pull = (email: string, token: string) => request(app).post("/api/sync/pull").send({ email }).set("Authorization", `Bearer ${token}`);
const wrong = async (n: number, email = A) => { for (let i = 0; i < n; i++) expect((await pull(email, `guess-${i}`)).status).toBe(401); };
const relink = (oldRecoveryToken: string) => request(app).post("/api/sync/relink").send({ email: A, token: "new-token", recoveryToken: "new-recovery", oldRecoveryToken });
const del = (token: string) => request(app).delete("/api/sync").send({ email: A, token });
const push = (token: string) => request(app).post("/api/sync/push").send({ email: A, token, data: { income: 1 } });

describe("a lock after five free failures", () => {
  it("six wrong pulls lock the account: the right password is refused too (429, Retry-After, no data)", async () => {
    await wrong(6);
    const res = await pull(A, "token-of-A");
    expect(res.status).toBe(429);
    expect(res.headers["retry-after"]).toBe("60");
    expect(res.body.accountLocked).toBe(true);
    expect(res.text.includes(SENTINEL)).toBe(false);
  });

  it("five wrong pulls don't lock", async () => {
    await wrong(5);
    expect((await pull(A, "token-of-A")).status).toBe(200);
  });

  it("the lock ends on time, and a success then clears the count", async () => {
    await wrong(6);
    at(MIN + 1000);
    expect((await pull(A, "token-of-A")).status).toBe(200);
    await wrong(5);
    expect((await pull(A, "token-of-A")).status).toBe(200);
  });

  it("each later failure locks longer: 1, 2, 4, 8, then 15 minutes, and no longer", async () => {
    await wrong(5);
    for (const minutes of [1, 2, 4, 8, 15, 15]) {
      expect((await pull(A, "guess")).status).toBe(401);
      const locked = await pull(A, "token-of-A");
      expect(locked.status).toBe(429);
      expect(locked.headers["retry-after"]).toBe(String(minutes * 60));
      at(minutes * MIN + 1000);
    }
  });

  it("a request during the lock isn't compared or counted", async () => {
    await wrong(6);
    for (let i = 0; i < 10; i++) expect((await pull(A, `guess-locked-${i}`)).status).toBe(429);
    at(MIN + 1000);
    expect((await pull(A, "guess")).status).toBe(401); // the 7th failure: 2 minutes
    expect((await pull(A, "token-of-A")).headers["retry-after"]).toBe("120");
  });

  it("a count is forgotten 24 hours after its last failure", async () => {
    await wrong(5);
    at(24 * 60 * MIN + 1000);
    await wrong(1);
    expect((await pull(A, "token-of-A")).status).toBe(200);
  });
});

describe("what counts, and for whom", () => {
  it("another account isn't affected by A's lock", async () => {
    await wrong(6);
    expect((await pull(B, "token-of-B")).status).toBe(200);
  });

  it("wrong relinks (the old recovery code) and wrong deletes count with wrong pulls", async () => {
    await wrong(2);
    expect((await relink("recovery-guess-1")).status).toBe(401);
    expect((await relink("recovery-guess-2")).status).toBe(401);
    expect((await del("delete-guess-1")).status).toBe(401);
    expect((await del("delete-guess-2")).status).toBe(401);
    expect((await pull(A, "token-of-A")).status).toBe(429);
    expect(store.userSync.has(A)).toBe(true);
  });

  it("wrong pushes count with wrong pulls (owner, session 26)", async () => {
    for (let i = 0; i < 3; i++) expect((await push(`stale-${i}`)).status).toBe(401);
    await wrong(3);
    expect((await pull(A, "token-of-A")).status).toBe(429);
  });

  it("a guessing loop through push hits the limit: from the 7th, refused before any comparison, the right token too", async () => {
    for (let i = 0; i < 6; i++) expect((await push(`guess-${i}`)).status).toBe(401);
    const locked = await push("token-of-A");
    expect(locked.status).toBe(429);
    expect(locked.headers["retry-after"]).toBe("60");
    expect(locked.body.accountLocked).toBe(true);
    expect(store.userSync.get(A)?.dataJson).toBe(storedData()); // nothing written
  });

  it("a successful push clears the count", async () => {
    for (let i = 0; i < 5; i++) expect((await push(`guess-${i}`)).status).toBe(401);
    expect((await push("token-of-A")).status).toBe(200);
    for (let i = 0; i < 5; i++) expect((await push(`guess-again-${i}`)).status).toBe(401);
    expect((await pull(A, "token-of-A")).status).toBe(200);
  });

  it("a wrong token on push or pull is refused with the code the client stops on", async () => {
    expect((await push("stale")).body).toEqual({ error: "Invalid sync credentials for this account.", code: "credentials_refused" });
    expect((await pull(A, "stale")).body).toEqual({ error: "Invalid sync credentials for this account.", code: "credentials_refused" });
  });

  it("a pull for an address with no copy (404) doesn't count", async () => {
    for (let i = 0; i < 8; i++) expect((await pull("nobody@example.com", "x")).status).toBe(404);
    store.seedUserSync({ email: "nobody@example.com", authTokenHash: hash("t"), dataJson: storedData() });
    expect((await pull("nobody@example.com", "t")).status).toBe(200);
  });

  it("the counts don't hold the address itself", async () => {
    await wrong(3);
    const held = JSON.stringify([...(app.locals.accountLimit as { keys(): Iterable<string> }).keys()]);
    expect(held.includes("guess-target")).toBe(false);
    expect(held.includes("@")).toBe(false);
  });
});

describe("the sentence (approved by the owner, session 26)", () => {
  it("names the wait in minutes, rounded up", async () => {
    await wrong(6);
    at(20_000); // 40 seconds left
    expect((await pull(A, "token-of-A")).body.error).toBe("Too many failed attempts for this account. Try again in 1 minute.");
    at(41_000);
    await wrong(1); // 2 minutes
    expect((await pull(A, "token-of-A")).body.error).toBe("Too many failed attempts for this account. Try again in 2 minutes.");
    at(50_000); // 70 seconds left: still "2 minutes", never fewer than the wait
    expect((await pull(A, "token-of-A")).body.error).toBe("Too many failed attempts for this account. Try again in 2 minutes.");
  });
});
