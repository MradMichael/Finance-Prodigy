// PRIORITY 2 -- PULL. Privacy page:
//   "It's protected instead by database access controls, TLS in transit, and
//    requiring your password-derived sync token to read it back"
//
// Every refusal is checked for the SENTINEL placed inside the stored data --
// a 401 that still carried the copy would pass a status-code test.
//
// 2.4.165 B: the address travels in the body of a POST. The old GET form,
// with the address in the URL, is gone (step 3); the last describe pins that.
//
// NOT REACHABLE WITH THE FAKE (2.4.116): database collation of the email
// lookup (the fake compares exact strings after emailSchema lowercases).
import { describe, it, expect } from "vitest";
import { store } from "./support/fakePrisma";
import { api, hash, storedData, SENTINEL } from "./support/http";

const A = "reader-a@example.com";
const pull = (email: string, token?: string) => {
  const r = api().post("/api/sync/pull").send({ email });
  return token === undefined ? r : r.set("Authorization", `Bearer ${token}`);
};
const leaks = (res: { text: string }) => res.text.includes(SENTINEL);

describe("reading a server copy requires the account's token", () => {
  it("no token at all: refused (422), and no data in the response", async () => {
    store.seedUserSync({ email: A, authTokenHash: hash("token-of-A"), dataJson: storedData() });
    const res = await pull(A);
    expect(res.status).toBe(422);
    expect(leaks(res)).toBe(false);
  });

  it("a wrong token: refused (401), and no data in the response", async () => {
    store.seedUserSync({ email: A, authTokenHash: hash("token-of-A"), dataJson: storedData() });
    const res = await pull(A, "token-of-someone-else");
    expect(res.status).toBe(401);
    expect(leaks(res)).toBe(false);
  });

  it("a row with no registered token: refused (401), not handed to whoever asks", async () => {
    store.seedUserSync({ email: A, authTokenHash: null, dataJson: storedData() });
    const res = await pull(A, "anything");
    expect(res.status).toBe(401);
    expect(leaks(res)).toBe(false);
  });

  it("no copy on the server: the API's own 404, with nothing to leak", async () => {
    const res = await pull("absent@example.com", "anything");
    expect(res.status).toBe(404);
    // The API's shaped body, which the client trusts as "no copy" (2.4.22) --
    // a missing route also answers 404, so the status alone would pass
    // against a route that isn't there.
    expect(res.body.error).toBe("No sync data found for this account.");
  });

  it("the right token returns the copy (the control, so the refusals are the check and not a broken route)", async () => {
    store.seedUserSync({ email: A, authTokenHash: hash("token-of-A"), dataJson: storedData() });
    const res = await pull(A, "token-of-A");
    expect(res.status).toBe(200);
    expect(res.body.data.note).toBe(SENTINEL);
  });

  it("reading never writes", async () => {
    store.seedUserSync({ email: A, authTokenHash: hash("token-of-A"), dataJson: storedData() });
    // Premise: both requests reached the route (a missing one writes nothing too).
    expect((await pull(A, "token-of-A")).status).toBe(200);
    expect((await pull(A, "wrong")).status).toBe(401);
    expect(store.writes).toEqual([]);
  });
});

describe("the address is read only from the body", () => {
  it("an address in a POST's URL alone is refused (422) -- a client that kept it there is not served", async () => {
    store.seedUserSync({ email: A, authTokenHash: hash("token-of-A"), dataJson: storedData() });
    const res = await api().post(`/api/sync/pull?email=${encodeURIComponent(A)}`).set("Authorization", "Bearer token-of-A").send({});
    expect(res.status).toBe(422);
    expect(leaks(res)).toBe(false);
  });

  it("the old GET form is gone: 404 with no API error body, and no data", async () => {
    store.seedUserSync({ email: A, authTokenHash: hash("token-of-A"), dataJson: storedData() });
    const res = await api().get("/api/sync/pull").query({ email: A }).set("Authorization", "Bearer token-of-A");
    expect(res.status).toBe(404);
    // No API-shaped body, so a tab still running the old client reads a
    // failure, not "no copy on the server" -- the client trusts only the
    // shaped 404 (2.4.22).
    expect(res.body?.error).toBeUndefined();
    expect(leaks(res)).toBe(false);
  });
});
