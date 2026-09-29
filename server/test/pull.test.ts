// PRIORITY 2 -- PULL. Privacy page:
//   "It's protected instead by database access controls, TLS in transit, and
//    requiring your password-derived sync token to read it back"
//
// Every refusal is checked for the SENTINEL placed inside the stored data --
// a 401 that still carried the copy would pass a status-code test.
//
// NOT REACHABLE WITH THE FAKE (2.4.116): database collation of the email
// lookup (the fake compares exact strings after emailSchema lowercases).
import { describe, it, expect } from "vitest";
import { store } from "./support/fakePrisma";
import { api, hash, storedData, SENTINEL } from "./support/http";

const A = "reader-a@example.com";
const pull = (email: string, token?: string) => {
  const r = api().get("/api/sync/pull").query({ email });
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

  it("no copy on the server: 404, with nothing to leak", async () => {
    const res = await pull("absent@example.com", "anything");
    expect(res.status).toBe(404);
  });

  it("the right token returns the copy (the control, so the refusals are the check and not a broken route)", async () => {
    store.seedUserSync({ email: A, authTokenHash: hash("token-of-A"), dataJson: storedData() });
    const res = await pull(A, "token-of-A");
    expect(res.status).toBe(200);
    expect(res.body.data.note).toBe(SENTINEL);
  });

  it("reading never writes", async () => {
    store.seedUserSync({ email: A, authTokenHash: hash("token-of-A"), dataJson: storedData() });
    await pull(A, "token-of-A");
    await pull(A, "wrong");
    expect(store.writes).toEqual([]);
  });
});
