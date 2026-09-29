// PRIORITY 1 -- PUSH: the password-derived token stops one account
// overwriting another's copy.
//
// THE PROMISE IS UNWRITTEN (audit 2.4.156). No sentence on the privacy or
// security page states it. The nearest is the privacy page's
//   "requiring your password-derived sync token to read it back"
// which is about READING. The overwrite protection below is real and
// enforced; whether the page should say so is the owner's call.
//
// ONE EXCEPTION IS PINNED, NOT ACCEPTED (audit 2.4.160): a row with no
// registered token hash, or no row at all, is claimed by whoever pushes
// first. Those tests assert CURRENT behaviour so the fix -- which needs its
// own plan, carrying 2.2.16's account-takeover analysis -- has to change
// them on purpose.
//
// NOT REACHABLE WITH THE FAKE (2.4.116): Serializable conflicts (P2034),
// the P2028 retry, two pushes racing on one email.
import { describe, it, expect } from "vitest";
import { store } from "./support/fakePrisma";
import { api, hash, storedData } from "./support/http";

const A = "owner-a@example.com";
const push = (body: Record<string, unknown>) => api().post("/api/sync/push").send(body);

describe("a registered account cannot be overwritten without its token", () => {
  it("a wrong token is refused, the row is byte-identical afterwards, and nothing is written", async () => {
    store.seedUserSync({ email: A, authTokenHash: hash("token-of-A"), dataJson: storedData() });
    const before = JSON.stringify(store.userSync.get(A));
    const res = await push({ email: A, token: "token-of-B", data: { income: 1 } });
    expect(res.status).toBe(401);
    expect(JSON.stringify(store.userSync.get(A))).toBe(before);
    expect(store.writes).toEqual([]);
  });

  it("the right token updates the copy (the control)", async () => {
    store.seedUserSync({ email: A, authTokenHash: hash("token-of-A"), dataJson: storedData() });
    const res = await push({ email: A, token: "token-of-A", data: { income: 4210.5 } });
    expect(res.status).toBe(200);
    expect(JSON.parse(store.userSync.get(A)!.dataJson)).toEqual({ income: 4210.5 });
    expect(store.writes).toEqual([{ op: "upsert:update", table: "userSync", key: A }]);
  });

  it("the token is checked BEFORE staleness, so a wrong token cannot learn the server moved on", async () => {
    store.seedUserSync({ email: A, authTokenHash: hash("token-of-A"), syncedAt: new Date("2026-09-25T10:00:00.000Z") });
    const res = await push({ email: A, token: "token-of-B", baseSyncedAt: "2026-09-01T00:00:00.000Z", data: {} });
    // 401, not 409: a 409 here would confirm to a stranger that this account
    // has newer data on the server.
    expect(res.status).toBe(401);
  });

  it("a stale push with the right token is refused (409) and changes nothing", async () => {
    store.seedUserSync({ email: A, authTokenHash: hash("token-of-A"), dataJson: storedData(), syncedAt: new Date("2026-09-25T10:00:00.000Z") });
    const before = JSON.stringify(store.userSync.get(A));
    const res = await push({ email: A, token: "token-of-A", baseSyncedAt: "2026-09-01T00:00:00.000Z", data: { income: 1 } });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("stale_push");
    expect(JSON.stringify(store.userSync.get(A))).toBe(before);
    expect(store.writes).toEqual([]);
  });

  it("a push response never carries the stored data back", async () => {
    store.seedUserSync({ email: A, authTokenHash: hash("token-of-A"), dataJson: storedData() });
    const res = await push({ email: A, token: "token-of-A", data: { income: 2 } });
    expect(Object.keys(res.body).sort()).toEqual(["ok", "syncedAt"]);
  });
});

describe("PINNED, NOT ACCEPTED (audit 2.4.160): first-push registration", () => {
  it("CURRENT BEHAVIOUR: a row with no registered token hash is claimed by ANY token", async () => {
    store.seedUserSync({ email: A, authTokenHash: null, dataJson: storedData() });
    const res = await push({ email: A, token: "anyone-at-all", data: { income: 9 } });
    expect(res.status).toBe(200);
    expect(store.userSync.get(A)!.authTokenHash).toBe(hash("anyone-at-all"));
  });

  it("CURRENT BEHAVIOUR: an email with no row is registered by whoever pushes first", async () => {
    const res = await push({ email: "never-pushed@example.com", token: "first-comer", data: {} });
    expect(res.status).toBe(200);
    expect(store.userSync.get("never-pushed@example.com")!.authTokenHash).toBe(hash("first-comer"));
    // ...and the real owner's later push is then refused: squatting.
    const owner = await push({ email: "never-pushed@example.com", token: "real-owner", data: {} });
    expect(owner.status).toBe(401);
  });
});
