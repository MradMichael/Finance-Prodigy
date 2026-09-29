// PRIORITY 6 -- RELINK. Security page:
//   "forgetting your password doesn't mean losing your data, as long as you
//    saved the code. With backup on, it works from any device, not just the
//    one you set it up on"
// Relink is how that works after a password reset: the new sync token is
// accepted only with proof of the PREVIOUS recovery token.
//
// Two current behaviours are pinned and cited, not endorsed:
//   * a row with neither hash is registered fresh by whoever relinks first --
//     the same registration class as 2.4.160, covered by that plan;
//   * a row with a sync token but no recovery token is refused even with a
//     correct code -- 2.2.16, deferred by owner decision.
import { describe, it, expect } from "vitest";
import { store } from "./support/fakePrisma";
import { api, hash, storedData } from "./support/http";

const A = "relinker-a@example.com";
const relink = (body: Record<string, unknown>) => api().post("/api/sync/relink").send(body);

describe("a relink needs proof of the previous recovery code", () => {
  const seedLinked = () => store.seedUserSync({
    email: A, authTokenHash: hash("old-sync"), recoveryTokenHash: hash("old-recovery"), dataJson: storedData(),
  });

  it("without the old recovery token: refused, and the hashes are unchanged", async () => {
    seedLinked();
    const res = await relink({ email: A, token: "new-sync", recoveryToken: "new-recovery" });
    expect(res.status).toBe(401);
    expect(store.userSync.get(A)!.authTokenHash).toBe(hash("old-sync"));
    expect(store.writes).toEqual([]);
  });

  it("with a WRONG old recovery token: refused, unchanged", async () => {
    seedLinked();
    const res = await relink({ email: A, token: "new-sync", recoveryToken: "new-recovery", oldRecoveryToken: "guessed" });
    expect(res.status).toBe(401);
    expect(store.userSync.get(A)!.recoveryTokenHash).toBe(hash("old-recovery"));
    expect(store.writes).toEqual([]);
  });

  it("with the right old recovery token: both hashes move, and the data is untouched", async () => {
    seedLinked();
    const res = await relink({ email: A, token: "new-sync", recoveryToken: "new-recovery", oldRecoveryToken: "old-recovery" });
    expect(res.status).toBe(200);
    const row = store.userSync.get(A)!;
    expect(row.authTokenHash).toBe(hash("new-sync"));
    expect(row.recoveryTokenHash).toBe(hash("new-recovery"));
    expect(row.dataJson).toBe(storedData());
  });
});

describe("PINNED, cited, not endorsed", () => {
  it("CURRENT BEHAVIOUR (2.4.160's class): a row with neither hash is registered by the first relink", async () => {
    store.seedUserSync({ email: A, authTokenHash: null, recoveryTokenHash: null });
    const res = await relink({ email: A, token: "first", recoveryToken: "first-recovery" });
    expect(res.status).toBe(200);
    expect(store.userSync.get(A)!.authTokenHash).toBe(hash("first"));
  });

  it("CURRENT BEHAVIOUR (2.2.16, deferred): sync token but no recovery token -- refused even with a code", async () => {
    store.seedUserSync({ email: A, authTokenHash: hash("old-sync"), recoveryTokenHash: null });
    const res = await relink({ email: A, token: "new-sync", recoveryToken: "new-recovery", oldRecoveryToken: "any" });
    expect(res.status).toBe(401);
  });
});
