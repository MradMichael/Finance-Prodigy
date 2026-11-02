// Owner, session 34: "'No backup yet' 404: handled quietly, no console error." A browser logs every 404 as a
// console error, whatever the app does with it. A client that asks (quietMissing: true) gets "no copy" as 200
// with { ok: false, notFound: true }; without the flag the pull still answers 404, so an older client, or this
// client against an older server, behaves as before. The flag changes nothing else: tokens and locks as today.
import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { store } from "./support/fakePrisma";
import { api, hash, storedData, SENTINEL } from "./support/http";

const A = "quiet-a@example.com";
const pull = (email: string, token: string, quietMissing?: boolean) =>
  api().post("/api/sync/pull").send(quietMissing === undefined ? { email } : { email, quietMissing }).set("Authorization", `Bearer ${token}`);

describe("asking for a quiet answer when there's no copy", () => {
  it("no copy: 200, not found, and no data", async () => {
    const res = await pull("absent-quiet@example.com", "anything", true);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: false, notFound: true });
  });

  it("without the flag: the API's own 404, as before", async () => {
    const res = await pull("absent-quiet@example.com", "anything");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("No sync data found for this account.");
  });

  it("a copy with the wrong token: still refused (401), with no data", async () => {
    store.seedUserSync({ email: A, authTokenHash: hash("token-of-A"), dataJson: storedData() });
    const res = await pull(A, "someone-else", true);
    expect(res.status).toBe(401);
    expect(res.text.includes(SENTINEL)).toBe(false);
  });

  it("a copy with the right token: the copy, as before", async () => {
    store.seedUserSync({ email: A, authTokenHash: hash("token-of-A"), dataJson: storedData() });
    const res = await pull(A, "token-of-A", true);
    expect(res.status).toBe(200);
    expect(res.body.data.note).toBe(SENTINEL);
  });

  it("asking again and again for an address with no copy never locks it (as the 404 never did)", async () => {
    // One app for the whole test: the lock's counts live on the app (account-limit.test.ts), and api() makes a
    // new one per request.
    const app = createApp();
    const quiet = (token: string) => request(app).post("/api/sync/pull").send({ email: "nobody-quiet@example.com", quietMissing: true }).set("Authorization", `Bearer ${token}`);
    for (let i = 0; i < 8; i++) expect((await quiet("x")).status).toBe(200);
    store.seedUserSync({ email: "nobody-quiet@example.com", authTokenHash: hash("t"), dataJson: storedData() });
    const res = await quiet("t");
    expect(res.status).toBe(200);
    expect(res.body.data.note).toBe(SENTINEL);
  });
});
