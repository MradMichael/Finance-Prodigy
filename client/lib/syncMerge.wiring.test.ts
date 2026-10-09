// SYNC-1 step 2 (2026-10-06): the merge engine wired into the conflict merge,
// the v6 migration, and what the owner is told.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mergeAndPush, buildMergeNoticeText, detectNonTransactionDivergence, closeMomentLabel } from "./syncService";
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

  // Owner's wording, 2026-10-06. The settings live on Setup (income, payday,
  // emergency fund target, the custom split's figures), Budget (the split)
  // and Currency (the LBP rate), so the sentence names those three screens.
  // Owner, 2026-10-07: items joined properly, "income and LBP rate"; and both
  // sentences end "this device's copy was kept.", without "automatically".
  it("the sentence for settings names the screens they live on, items joined properly (owner's wording)", () => {
    expect(buildMergeNoticeText(0, [], ["income", "LBP rate"]).text).toBe(
      "Your income and LBP rate may differ from your other device — this device's copy was kept. Check Setup, Budget and Currency if something looks off.",
    );
    expect(buildMergeNoticeText(0, [], ["income", "LBP rate", "payday"]).text).toBe(
      "Your income, LBP rate and payday may differ from your other device — this device's copy was kept. Check Setup, Budget and Currency if something looks off.",
    );
  });

  // Owner's wording, 2026-10-07, for the five lists, which live on none of
  // the settings' screens: goals on Goals, debts on Debts, recurring items on
  // Recurring, assets and cards on My Finances. With all five differing it
  // reads exactly as the owner wrote it.
  it("the sentence for the lists, all five differing, is the owner's sentence", () => {
    const { text } = buildMergeNoticeText(0, [], ["goals", "debts", "recurring items", "assets", "cards"]);
    expect(text).toBe(
      "Your goals, debts, recurring items, assets or cards may differ from your other device — this device's copy was kept. Check Goals, Debts, Recurring and My Finances if something looks off.",
    );
  });

  // Fewer lists: the same sentence, naming only those lists and the screens
  // that show them (assets and cards share My Finances, named once).
  it("the lists sentence names only the lists that differ, and their screens", () => {
    expect(buildMergeNoticeText(0, [], ["cards"]).text).toBe(
      "Your cards may differ from your other device — this device's copy was kept. Check My Finances if something looks off.",
    );
    expect(buildMergeNoticeText(0, [], ["assets", "cards"]).text).toBe(
      "Your assets or cards may differ from your other device — this device's copy was kept. Check My Finances if something looks off.",
    );
  });

  it("detection calls the assets list 'assets'", () => {
    const local = { ...DEFAULT_DATA, assets: [] } as LocalFinancials;
    const server = { ...local, assets: [{ id: "a1", name: "Gold coin", value: 640.25, currency: "USD" }] } as unknown as LocalFinancials;
    expect(detectNonTransactionDivergence(local, server)).toEqual(["assets"]);
  });

  it("lists and settings that both differ get a sentence each, lists first", () => {
    const { text } = buildMergeNoticeText(0, [], ["goals", "cards", "payday"]);
    expect(text).toBe(
      "Your goals or cards may differ from your other device — this device's copy was kept. Check Goals and My Finances if something looks off. "
      + "Your payday may differ from your other device — this device's copy was kept. Check Setup, Budget and Currency if something looks off.",
    );
  });

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
