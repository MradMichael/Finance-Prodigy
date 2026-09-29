// PRIORITY 3 -- DELETE. Privacy page:
//   "deleting your account also removes that backup copy (and anything
//    derived from it) from our server automatically"
// and
//   "Turning backup off lets you delete the server copy or keep it."
// Both rest on this one handler, including its call into
// deleteAllDataForEmail for the warehouse rows.
//
// DOCUMENTED EXCEPTION, owner decision 2026-09-28 (audit 2.4.156): an email
// with warehouse rows but no user_sync row (2.4.131's direction B) is left as
// it is -- test accounts, warehouse writes stopped, and no token exists to
// authenticate deleting them. Pinned below, not presented as the promise kept.
//
// NOT REACHABLE WITH THE FAKE (2.4.116): real foreign keys between warehouse
// tables; a crash between the user_sync delete and the warehouse delete.
import { describe, it, expect } from "vitest";
import { store } from "./support/fakePrisma";
import { api, hash, storedData } from "./support/http";

const A = "deleter-a@example.com";
const B = "bystander-b@example.com";
const del = (email: string, token: string) => api().delete("/api/sync").send({ email, token });

describe("deleting removes the copy and everything derived from it", () => {
  it("the right token removes the user_sync row, every warehouse row, and the warehouse user", async () => {
    store.seedUserSync({ email: A, authTokenHash: hash("token-of-A"), dataJson: storedData() });
    const uid = store.seedWarehouse(A, 3);
    expect(store.warehouseRowsFor(uid)).toBe(18); // premise: 6 tables x 3 rows
    const res = await del(A, "token-of-A");
    expect(res.status).toBe(200);
    expect(store.userSync.has(A)).toBe(false);
    expect(store.warehouseRowsFor(uid)).toBe(0);
    expect(store.users.has(A)).toBe(false);
  });

  it("only that account's rows go -- another account is untouched", async () => {
    store.seedUserSync({ email: A, authTokenHash: hash("token-of-A") });
    store.seedUserSync({ email: B, authTokenHash: hash("token-of-B"), dataJson: storedData() });
    store.seedWarehouse(A, 2);
    const uidB = store.seedWarehouse(B, 2);
    await del(A, "token-of-A");
    expect(store.userSync.has(B)).toBe(true);
    expect(store.warehouseRowsFor(uidB)).toBe(12);
  });
});

describe("nobody can delete an account they do not own", () => {
  it("a wrong token deletes NOTHING, in either store", async () => {
    store.seedUserSync({ email: A, authTokenHash: hash("token-of-A"), dataJson: storedData() });
    const uid = store.seedWarehouse(A, 3);
    const res = await del(A, "token-of-someone-else");
    expect(res.status).toBe(401);
    expect(store.userSync.has(A)).toBe(true);
    expect(store.warehouseRowsFor(uid)).toBe(18);
    expect(store.writes).toEqual([]);
  });

  it("a row with no registered token deletes nothing -- there is nothing to verify against", async () => {
    store.seedUserSync({ email: A, authTokenHash: null, dataJson: storedData() });
    const uid = store.seedWarehouse(A, 1);
    const res = await del(A, "anything");
    expect(res.status).toBe(401);
    expect(store.userSync.has(A)).toBe(true);
    expect(store.warehouseRowsFor(uid)).toBe(6);
  });
});

describe("DOCUMENTED (owner decision 2026-09-28): warehouse rows with no user_sync row", () => {
  it("returns ok and leaves them -- there is no token to authenticate their deletion", async () => {
    const uid = store.seedWarehouse("orphan-test-account@example.com", 2);
    const res = await del("orphan-test-account@example.com", "anything");
    expect(res.status).toBe(200);
    expect(store.warehouseRowsFor(uid)).toBe(12);
  });
});
