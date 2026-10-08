// Plan H 5b: cases the first perturbation pass showed no test was pinning.
//   - a deletion under the rule: the wishlist (and categories, rules) filter
//     deletions themselves, where goals and the rest are filtered earlier;
//   - the kept setting carries its own edit time forward;
//   - a history entry with an edit time beats one written without (an older
//     client's), even where the content tie-break would pick the other;
//   - the conflict merge (mergeAndPush) really uses the record.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const SESSION = { userId: "u1", email: "u1@example.com", name: "U One" };
vi.mock("./auth", () => ({ getRecoveryTokenForSync: vi.fn(async () => undefined), getSession: () => SESSION }));

import { DEFAULT_DATA, recordDeletion, type LocalFinancials, type StoredGoal, type WishlistItem } from "./localData";
import { mergeFinancials } from "./syncMerge";
import { seenOf, saveSeen } from "./syncSeen";
import { mergeAndPush } from "./syncService";
import { activateSessionKey } from "./crypto";

const T0 = new Date("2026-10-08T12:00:00.000Z");
const base = (o: Partial<LocalFinancials> = {}) => ({ ...DEFAULT_DATA, income: 3000, ...o }) as LocalFinancials;

it("a wishlist item deleted here stays deleted, though the other device still holds it", () => {
  const lamp: WishlistItem = { id: "w1", name: "Quartz lamp", emoji: "✨", price: 64.2, currency: "USD", priority: "medium", createdAt: "2026-10-01T09:00:00.000Z", updatedAt: "2026-10-01T09:00:00.000Z" };
  const both = base({ wishlist: [lamp] });
  const deleted = base({ wishlist: [], deletedKeys: recordDeletion(both, "wishlist", "w1", T0) });
  for (const r of [mergeFinancials(deleted, both, T0, seenOf(both)), mergeFinancials(both, deleted, T0, seenOf(both))]) {
    expect(r.data.wishlist).toEqual([]);
  }
});

describe("a setting's edit time travels with the value kept", () => {
  const B = base();
  it("the other device's one-sided change brings its time", () => {
    const server = base({ income: 3400, settingsUpdatedAt: { income: "2026-09-01T00:00:00.000Z" } });
    expect(mergeFinancials(B, server, T0, seenOf(B)).data.settingsUpdatedAt).toEqual({ income: "2026-09-01T00:00:00.000Z" });
  });

  it("a kept value with no time drops the other copy's time, so a stale time can't win the next clash", () => {
    const local = base({ settingsUpdatedAt: { income: "2026-10-05T00:00:00.000Z" } }); // unchanged value, a stamp from an earlier edit
    const server = base({ income: 3400 }); // an older client changed it, no stamp
    const out = mergeFinancials(local, server, T0, seenOf(base({ settingsUpdatedAt: { income: "2026-10-05T00:00:00.000Z" } })));
    expect(out.data.income).toBe(3400);
    expect(out.data.settingsUpdatedAt?.income).toBeUndefined();
  });
});

it("a history entry with an edit time beats one written without, whatever the content tie-break would pick", () => {
  const b = base({ incomeHistory: [{ ym: "2026-08", value: 3000 }] } as Partial<LocalFinancials>);
  const old = { ...b, incomeHistory: [{ ym: "2026-08", value: 3200 }] } as LocalFinancials; // an older client: no `at`
  const stamped = { ...b, incomeHistory: [{ ym: "2026-08", value: 3100, at: "2026-09-02T00:00:00.000Z" }] } as LocalFinancials;
  for (const r of [mergeFinancials(old, stamped, T0, seenOf(b)), mergeFinancials(stamped, old, T0, seenOf(b))]) {
    expect(r.data.incomeHistory).toEqual([{ ym: "2026-08", value: 3100, at: "2026-09-02T00:00:00.000Z" }]);
  }
});

describe("the conflict merge uses this device's record", () => {
  const goal = (o: Partial<StoredGoal>): StoredGoal => ({ id: "g1", name: "Laptop", emoji: "💻", targetAmount: 1200, currentAmount: 0, openingAmount: 100, currency: "USD", targetDate: "2027-03-01", createdAt: "2026-05-01T09:00:00.000Z", updatedAt: "2026-10-01T09:00:00.000Z", ...o });
  let serverData: LocalFinancials;
  let pushed: LocalFinancials | undefined;
  beforeEach(() => {
    localStorage.clear(); sessionStorage.clear();
    sessionStorage.setItem("essa_st_v1", "tok");
    activateSessionKey(new Uint8Array(32).fill(7));
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      if (url === "/api/sync/pull") return new Response(JSON.stringify({ ok: true, data: serverData, syncedAt: "2026-10-08T09:00:00.000Z" }), { status: 200 });
      pushed = JSON.parse(String(init.body)).data;
      return new Response(JSON.stringify({ ok: true, syncedAt: "2026-10-08T09:01:00.000Z" }), { status: 200 });
    }));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("the other device's goal edit is pushed, though this device's copy carries the later time", async () => {
    // This device's copy is unchanged since its last sync; the other device's edit carries an earlier time (a slow clock there).
    const mine = base({ goals: [goal({ updatedAt: "2026-10-07T09:00:00.000Z" })] });
    await saveSeen("u1", mine);
    serverData = base({ goals: [goal({ name: "MacBook", updatedAt: "2026-10-02T09:00:00.000Z" })] });
    const r = await mergeAndPush("u1@example.com", mine);
    expect(r.ok).toBe(true);
    expect(pushed?.goals[0].name).toBe("MacBook");
  });
});
