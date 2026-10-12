// Foreign cash, model 2: the sheet's entries (`foreignEntries`) sync as trips
// do. Merged by key with tombstones before a device has a record of a last
// sync, and under the fingerprint rule after; a two-sided edit keeps the later
// one and is named ("the foreign cash entry": DRAFT noun). A reset clears
// them; a deleted one stays deleted. The list is written only when a copy has
// one. And the upgrade: a converted (v8) device merging a server copy still at
// v7 converts that copy first (session 18, item 1), so no pocket leg comes
// back; two devices converting the same copy agree, with nothing named.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
vi.mock("./auth", () => ({ getRecoveryTokenForSync: vi.fn(async () => undefined), getSession: () => ({ userId: "u1", email: "u1@example.com", name: "U One" }) }));
import { DEFAULT_DATA, migrateFinancials, recordDeletion, resetFinancials, type LocalFinancials, type StoredForeignEntry } from "./localData";
import { mergeFinancials, unknownFieldsOf } from "./syncMerge";
import { saveSeen, seenOf } from "./syncSeen";
import { clashSentence, fetchAndMerge } from "./syncService";
import { activateSessionKey } from "./crypto";

const T0 = new Date("2026-11-10T12:00:00.000Z");
const entry = (id: string, description: string, amount: number, updatedAt: string): StoredForeignEntry =>
  ({ id, kind: "spend", code: "EUR", amount, date: "2026-10-05", description, category: "dining", createdAt: "2026-10-05T20:00:00.000Z", updatedAt });
const d = (foreignEntries?: StoredForeignEntry[], extra: Partial<LocalFinancials> = {}) =>
  ({ ...DEFAULT_DATA, ...(foreignEntries ? { foreignEntries } : {}), ...extra }) as LocalFinancials;
const DINNER = entry("f1", "Dinner", 40, "2026-10-05T20:00:00.000Z");

describe("before a device has a record of a last sync", () => {
  it("both devices' entries are kept", () => {
    const merged = mergeFinancials(d([DINNER]), d([entry("f2", "Tram", 20, "2026-10-06T09:00:00.000Z")]), T0).data;
    expect((merged.foreignEntries ?? []).map((e) => e.description).sort()).toEqual(["Dinner", "Tram"]);
  });

  it("an entry deleted on one device stays deleted, though the other still holds it", () => {
    const here = d([], { deletedKeys: recordDeletion(d([DINNER]), "foreignEntries", "f1", new Date("2026-10-20T00:00:00.000Z")) });
    expect(mergeFinancials(here, d([DINNER]), T0).data.foreignEntries ?? []).toEqual([]);
    expect(mergeFinancials(d([DINNER]), here, T0).data.foreignEntries ?? []).toEqual([]);
  });
});

describe("under the fingerprint rule", () => {
  it("a change made on one device only is taken, whichever side, even with its clock behind", () => {
    const seen = seenOf(d([DINNER]));
    for (const changed of [{ ...DINNER, amount: 45, updatedAt: "2026-10-13T09:00:00.000Z" }, { ...DINNER, amount: 45, updatedAt: "2026-10-01T09:00:00.000Z" }]) {
      expect(mergeFinancials(d([changed]), d([DINNER]), T0, seen).data.foreignEntries).toEqual([changed]);
      expect(mergeFinancials(d([DINNER]), d([changed]), T0, seen).data.foreignEntries).toEqual([changed]);
    }
  });

  it("both devices changed it: the later edit is kept and named", () => {
    const seen = seenOf(d([DINNER]));
    const here = { ...DINNER, amount: 45, updatedAt: "2026-10-13T09:00:00.000Z" };
    const there = { ...DINNER, description: "Dinner at Ramiro", updatedAt: "2026-10-14T09:00:00.000Z" };
    const r = mergeFinancials(d([here]), d([there]), T0, seen);
    expect(r.data.foreignEntries).toEqual([there]);
    expect(r.clashes.map(clashSentence)).toEqual(['Both devices changed the foreign cash entry "Dinner at Ramiro" — kept the later change.']);
  });

  it("deleted on one device after the last sync: gone from the merge", () => {
    const seen = seenOf(d([DINNER]));
    const here = d([], { deletedKeys: recordDeletion(d([DINNER]), "foreignEntries", "f1", new Date("2026-10-20T00:00:00.000Z")) });
    expect(mergeFinancials(here, d([DINNER]), T0, seen).data.foreignEntries ?? []).toEqual([]);
  });
});

it("a reset clears the entries on the other device too", () => {
  const before = d([DINNER]);
  const reset = resetFinancials(before, new Date("2026-11-01T00:00:00.000Z"));
  expect(mergeFinancials(before, reset, T0, seenOf(before)).data.foreignEntries ?? []).toEqual([]);
});

it("foreignEntries is a field this code knows, and no empty list is written when neither copy has one", () => {
  expect(unknownFieldsOf(d([DINNER]))).not.toHaveProperty("foreignEntries");
  expect(mergeFinancials(d(), d(), T0).data).not.toHaveProperty("foreignEntries");
  expect(mergeFinancials(d(), d(), T0, seenOf(d())).data).not.toHaveProperty("foreignEntries");
});

// ── the upgrade ──
const T = (day: string) => `${day}T09:00:00.000Z`;
const SRC = { id: "s1", amount: -500, currency: "USD", bucket: "TRANSFER", description: "Exchange to EUR", date: "2026-10-03", paymentMethod: "cash", linkedPaymentId: "L1", createdAt: T("2026-10-03"), updatedAt: T("2026-10-03") };
const LEG = { id: "p1", amount: 500, currency: "USD", bucket: "TRANSFER", description: "Exchange to EUR", date: "2026-10-03", linkedPaymentId: "L1", createdAt: T("2026-10-03"), updatedAt: T("2026-10-03"), fx: { code: "EUR", amount: 460, kind: "in" } };
const SPEND = { id: "sp1", amount: 43.48, currency: "USD", bucket: "WANTS", category: "dining", description: "Dinner", date: "2026-10-05", createdAt: T("2026-10-05"), updatedAt: T("2026-10-05"), fx: { code: "EUR", amount: 40, kind: "spend", costPerUnitUSD: 500 / 460 } };
const on = { syncChoice: { enabled: true, decidedAt: "2026-09-28T12:00:00.000Z" } };
const V7 = () => ({ ...DEFAULT_DATA, ...on, schemaVersion: 7, transactions: [SRC, LEG, SPEND] }) as unknown as LocalFinancials;

it("two devices converting the same copy agree: nothing named, nothing doubled", () => {
  const seen = seenOf(V7());
  const r = mergeFinancials(migrateFinancials(V7()), migrateFinancials(V7()), T0, seen);
  expect(r.clashes).toEqual([]);
  expect(r.data.transactions.map((t) => t.id)).toEqual(["s1"]);
  expect((r.data.foreignEntries ?? []).map((e) => e.id)).toEqual(["sp1"]);
});

describe("a converted device fetches a server copy still at v7", () => {
  let serverData: LocalFinancials;
  beforeEach(() => {
    localStorage.clear(); sessionStorage.clear();
    sessionStorage.setItem("essa_st_v1", "tok");
    activateSessionKey(new Uint8Array(32).fill(7));
    serverData = V7();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, data: serverData, syncedAt: "2026-10-11T09:00:00.000Z", hasRecoveryCode: true }), { status: 200 })));
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  for (const [label, record] of [["with no record of a last sync", false], ["with a record taken from the v7 copy", true]] as const) {
    it(`${label}: the server copy is converted first, so no pocket leg comes back`, async () => {
      if (record) { await saveSeen("u1", V7()); localStorage.setItem("essa_last_sync_u1", "2026-10-10T09:00:00.000Z"); }
      const r = await fetchAndMerge("u1@example.com", () => migrateFinancials(V7()));
      if (!r.ok || r.skipped) throw new Error("expected a merge");
      expect(r.mergedData.transactions.map((t) => [t.id, t.bucket, t.fx?.kind])).toEqual([["s1", "WANTS", "exchange"]]);
      expect((r.mergedData.foreignEntries ?? []).map((e) => e.id)).toEqual(["sp1"]);
      expect(r.clashes).toEqual([]);
    });
  }
});
