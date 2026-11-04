// Session 40 (owner, urgent): "the server accepts what the client sends; the
// client never breaks an older server." The copy is opaque to the server
// (`data` is any record, size-checked only), so every field the client writes
// is kept, a field from a newer client included, and a request field this
// server doesn't know is ignored rather than refused. Pinned here, so a future
// server can't start refusing what a client already sends.
import { describe, it, expect } from "vitest";
import { store } from "./support/fakePrisma";
import { api, hash } from "./support/http";

const A = "contract-a@example.com";
const push = (body: Record<string, unknown>) => api().post("/api/sync/push").send(body);

/** A copy with every collection and record list today's client writes, plus one from a newer client. */
const COPY = {
  schemaVersion: 9, income: 3000, transactions: [{ id: "t1", amount: 12.5, currency: "USD", date: "2026-11-04" }],
  trackedBalances: [{ id: "tb1", name: "Wallet", startingBalance: 200, startingDate: "2026-11-01", currency: "USD" }],
  periodCloses: [], wishlist: [], customCategories: [], categoryRules: [], trips: [], foreignEntries: [], lbpRateLog: [],
  deletedKeys: { wishlist: [{ key: "w1", deletedAt: "2026-11-04T09:00:00.000Z" }] }, revivedKeys: { goals: { g1: 1 } },
  clashRecords: [{ id: "c1", at: "2026-11-04T09:00:00.000Z", key: "g1", kind: "goal", name: "Laptop", later: true }],
  transactionClashRecords: [],
  // Session 39 (fix A): tracked balances' clash records, in their own field.
  balanceClashRecords: [{ id: "b1", at: "2026-11-04T09:00:00.000Z", key: "tb1", kind: "trackedBalance", name: "Wallet", later: true }],
  // A field from a client newer than this server: kept, not refused.
  someFieldFromANewerClient: { anything: [1, "two"] },
};

describe("the server accepts what the client sends", () => {
  it("every field today's client writes, and one from a newer client, is stored as sent", async () => {
    store.seedUserSync({ email: A, authTokenHash: hash("token-of-A") });
    const res = await push({ email: A, token: "token-of-A", data: COPY });
    expect(res.status).toBe(200);
    expect(JSON.parse(store.userSync.get(A)!.dataJson)).toEqual(COPY);
  });

  it("a request field this server doesn't know is ignored, not refused", async () => {
    store.seedUserSync({ email: A, authTokenHash: hash("token-of-A") });
    const res = await push({ email: A, token: "token-of-A", data: { income: 1 }, aFieldFromANewerClient: "x" });
    expect(res.status).toBe(200);
  });

  it("every refusal's error is text, so a client can show it", async () => {
    store.seedUserSync({ email: A, authTokenHash: hash("token-of-A") });
    for (const body of [{ email: A }, { email: A, token: "wrong", data: {} }, { email: "not-an-address", token: "t", data: {} }]) {
      const res = await push(body);
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(typeof res.body.error).toBe("string");
    }
  });
});
