// SYNC-1 step 2 (2026-10-06): the merge engine wired into the conflict merge,
// the v6 migration, and what the owner is told.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mergeAndPush, buildMergeNoticeText, detectNonTransactionDivergence, closeMomentLabel } from "./syncService";
import { DEFAULT_DATA, migrateFinancials, CURRENT_SCHEMA_VERSION, type LocalFinancials, type WishlistItem } from "./localData";

const wish = (id: string, name: string, price: number, updatedAt: string): WishlistItem => ({
  id, name, emoji: "✨", price, currency: "USD", priority: "medium", createdAt: updatedAt, updatedAt,
});

describe("the conflict merge uses the engine", () => {
  let pushed: LocalFinancials | null;
  beforeEach(() => {
    pushed = null;
    sessionStorage.setItem("essa_st_v1", "tok");
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      if (url === "/api/sync/pull") {
        const server = { ...DEFAULT_DATA, income: 3420.4, wishlist: [wish("w1", "Quartz lamp", 64.2, "2026-10-06T17:18:40.000Z"), wish("w2", "Velvet easel", 118.75, "2026-10-06T17:19:05.000Z")] };
        return new Response(JSON.stringify({ ok: true, data: server, syncedAt: "2026-10-06T17:19:06.000Z", hasRecoveryCode: true }), { status: 200 });
      }
      pushed = JSON.parse(String(init.body)).data;
      return new Response(JSON.stringify({ ok: true, syncedAt: "2026-10-06T17:19:52.000Z" }), { status: 200 });
    }));
  });
  afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear(); localStorage.clear(); });

  it("both devices' wishlist items reach the server; this device's settings are kept and named", async () => {
    const local = { ...DEFAULT_DATA, income: 3150.75, wishlist: [wish("w1", "Quartz lamp", 64.2, "2026-10-06T17:18:40.000Z"), wish("w3", "Cobalt kettle", 41.6, "2026-10-06T17:19:50.000Z")] } as LocalFinancials;
    const r = await mergeAndPush("a@test.com", local);
    if (!r.ok) throw new Error(r.error);
    expect((pushed?.wishlist ?? []).map((w) => w.name).sort()).toEqual(["Cobalt kettle", "Quartz lamp", "Velvet easel"]);
    expect(pushed?.income).toBe(3150.75);
    expect(r.nonTransactionDivergence).toContain("income");
    expect(r.replacedCloses).toEqual([]);
  });
});

describe("the divergence notice", () => {
  it("names settings that differ, and no longer tracked balances (they merge now)", () => {
    const local = { ...DEFAULT_DATA, income: 3150.75, lbpRate: 89_500, cycleStartDay: 27, emergencyFundTargetMonths: 6, trackedBalances: [] } as LocalFinancials;
    const server = { ...local, income: 3420.4, lbpRate: 89_700, cycleStartDay: 1, emergencyFundTargetMonths: 4, budgetRule: "70-20-10", trackedBalances: [{ id: "x" }] } as unknown as LocalFinancials;
    expect(detectNonTransactionDivergence(local, server)).toEqual(["income", "LBP rate", "budget split", "payday", "emergency fund target"]);
  });

  it("the sentence for settings points at the right screens (drafted wording)", () => {
    const { text } = buildMergeNoticeText(0, [], ["income", "LBP rate"]);
    expect(text).toBe("Your income, LBP rate may differ from your other device — this device's copy was kept automatically. Check those screens if something looks off.");
  });

  it("a replaced close is told plainly, and says the note is kept (drafted wording)", () => {
    const { text } = buildMergeNoticeText(0, [], [], [{ cycleLabel: "27 Aug – 26 Sep 2026", standingClosedAt: "2026-09-27T08:00:00.000Z" }]);
    expect(text).toBe(
      `Two devices closed 27 Aug – 26 Sep 2026. The earlier close, made on another device on ${closeMomentLabel("2026-09-27T08:00:00.000Z")}, stands; this device's close was undone, and any note you wrote on it is kept.`,
    );
  });
});

describe("schema v6", () => {
  it("stamps a wishlist item's edit time from what it already knows, and only when missing", () => {
    const v5 = {
      ...DEFAULT_DATA, schemaVersion: 5,
      wishlist: [
        { id: "w1", name: "Quartz lamp", emoji: "✨", price: 64.2, currency: "USD", priority: "medium", createdAt: "2026-10-01T09:00:00.000Z" },
        { id: "w2", name: "Velvet easel", emoji: "✨", price: 118.75, currency: "USD", priority: "low", createdAt: "2026-10-01T09:05:00.000Z", boughtAt: "2026-10-04T12:00:00.000Z" },
        { id: "w3", name: "Cobalt kettle", emoji: "✨", price: 41.6, currency: "USD", priority: "high", createdAt: "2026-10-01T09:10:00.000Z", updatedAt: "2026-10-05T08:00:00.000Z" },
      ],
    } as unknown as LocalFinancials;
    const out = migrateFinancials(v5);
    expect(CURRENT_SCHEMA_VERSION).toBe(6);
    expect(out.schemaVersion).toBe(6);
    expect(out.wishlist?.map((w) => w.updatedAt)).toEqual(["2026-10-01T09:00:00.000Z", "2026-10-04T12:00:00.000Z", "2026-10-05T08:00:00.000Z"]);
    expect(migrateFinancials(out)).toEqual(out); // idempotent
  });
});
