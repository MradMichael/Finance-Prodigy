// SYNC-1 step 2 (2026-10-06): the merge engine wired into the conflict merge,
// the v6 migration, and what the owner is told.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mergeAndPush, buildMergeNoticeText, closeMomentLabel } from "./syncService";
import { DEFAULT_DATA, migrateFinancials, CURRENT_SCHEMA_VERSION, type LocalFinancials, type WishlistItem } from "./localData";

/** HH:MM of an instant in this run's zone (the suite runs in UTC and Asia/Beirut). */
const localHM = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

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

  // Plan H 5d: with no record of a last sync (this test sets none), settings
  // are this device's copy as before, and nothing is named: 2.4.52's "may
  // differ" sentence retired (owner, session 5).
  it("both devices' wishlist items reach the server; with no record, this device's settings are kept, and nothing is named", async () => {
    const local = { ...DEFAULT_DATA, income: 3150.75, wishlist: [wish("w1", "Quartz lamp", 64.2, "2026-10-06T17:18:40.000Z"), wish("w3", "Cobalt kettle", 41.6, "2026-10-06T17:19:50.000Z")] } as LocalFinancials;
    const r = await mergeAndPush("a@test.com", local);
    if (!r.ok) throw new Error(r.error);
    expect((pushed?.wishlist ?? []).map((w) => w.name).sort()).toEqual(["Cobalt kettle", "Quartz lamp", "Velvet easel"]);
    expect(pushed?.income).toBe(3150.75);
    expect(r.clashes).toEqual([]);
    expect(r.replacedCloses).toEqual([]);
  });
});

describe("the notice", () => {
  // Owner, 2026-10-06: "Don't claim something the user can't find." The
  // undone close's note shows on no screen afterwards: Balance Check shows a
  // note only while it explains the account's current gap, and skips a
  // superseded close. It stays in the cycle's record, the close itself.
  it("a replaced close is told plainly, and says where the note is kept (owner's wording)", () => {
    const { text } = buildMergeNoticeText(0, [], [], [{ cycleLabel: "27 Aug – 26 Sep 2026", standingClosedAt: "2026-09-27T08:00:00.000Z" }]);
    expect(text).toBe(
      `Two devices closed 27 Aug – 26 Sep 2026. The earlier close, made on another device on 27 Sep 2026, ${localHM("2026-09-27T08:00:00.000Z")}, stands; this device's close was undone, and any note you wrote on it stays visible under Close history on Balance Check.`,
    );
  });

  // The cycle label spells months from period.ts's own list ("Sep"); the
  // runtime's en-GB says "Sept" on current ICU, so one sentence would carry
  // both spellings. The moment uses the cycle label's months, in local time.
  it("the close's moment uses the cycle label's month names, in local time", () => {
    expect(closeMomentLabel("2026-09-27T08:00:00.000Z")).toBe(`27 Sep 2026, ${localHM("2026-09-27T08:00:00.000Z")}`);
    expect(closeMomentLabel("2026-06-05T21:07:00.000Z")).toMatch(/^[56] Jun 2026, \d\d:07$/);
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
    // v7 (plan H 5a) runs after v6 now; the v6 step this test is about still ran.
    expect(CURRENT_SCHEMA_VERSION).toBe(7);
    expect(out.schemaVersion).toBe(7);
    expect(out.wishlist?.map((w) => w.updatedAt)).toEqual(["2026-10-01T09:00:00.000Z", "2026-10-04T12:00:00.000Z", "2026-10-05T08:00:00.000Z"]);
    expect(migrateFinancials(out)).toEqual(out); // idempotent
  });
});
