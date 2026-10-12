// Travel slice 0 (owner, session 14; FIX_PLANS.md "TRAVEL / FOREIGN CASH",
// "The trap"): two rules for code meeting data written by NEWER code.
//
// 1. Older code must not overwrite a top-level list it doesn't know. The
//    merge built its copy from this device's (`{ ...local, ... }`), so a field
//    this code doesn't know was this device's alone: absent here, it was
//    dropped from the merged copy, and that copy is what gets pushed. Now a
//    field this code doesn't know comes from the server's copy. This code
//    never edits such a field, so its own copy can only be an older one.
// 2. A backup from newer code (a higher schemaVersion) must not be treated
//    as current: never stamped with this code's version, never merged into,
//    never written over. Until its message is approved, this code just stops
//    syncing, quietly (nothing can write a higher version before travel's
//    slice 2).
//
// "Older code" here is this code, meeting fields and versions it doesn't know.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DEFAULT_DATA, CURRENT_SCHEMA_VERSION, migrateFinancials, loadData, saveData, type LocalFinancials, type StoredTransaction } from "./localData";
import { activateSessionKey, encryptJSON } from "./crypto";
import { mergeFinancials } from "./syncMerge";
import { fetchAndMerge, mergeAndPush, pushToServer } from "./syncService";

/** A list newer code might add, which this code doesn't know. */
const TRIPS = [{ id: "trip-1", name: "Lisbon", startDate: "2026-11-02", endDate: "2026-11-09", budgetUSD: 1200 }];
const NEWER = CURRENT_SCHEMA_VERSION + 1;
const base = (extra: Record<string, unknown> = {}) => ({ ...DEFAULT_DATA, income: 3000, syncChoice: { enabled: true, decidedAt: "2026-09-28T10:00:00.000Z" }, ...extra }) as LocalFinancials;
const field = (d: LocalFinancials, k: string) => (d as unknown as Record<string, unknown>)[k];

describe("rule 1: a top-level list this code doesn't know", () => {
  it("absent here, on the server: the server's is kept", () => {
    const merged = mergeFinancials(base(), base({ trips: TRIPS })).data;
    expect(field(merged, "trips")).toEqual(TRIPS);
  });

  it("an older copy here, a newer one on the server: the server's", () => {
    const stale = [{ ...TRIPS[0], budgetUSD: 900 }];
    expect(field(mergeFinancials(base({ trips: stale }), base({ trips: TRIPS })).data, "trips")).toEqual(TRIPS);
  });

  it("here, but not on the server (written by code older still): this device's is kept", () => {
    expect(field(mergeFinancials(base({ trips: TRIPS }), base()).data, "trips")).toEqual(TRIPS);
  });

  it("fields this code knows are merged exactly as before", () => {
    const merged = mergeFinancials(base({ userName: "Here", trips: TRIPS }), base({ userName: "There" })).data;
    expect(merged.userName).toBe("Here");
    expect(merged.income).toBe(3000);
  });

  it("a field inside a row this code doesn't know survives the merge", () => {
    const row = { id: "t1", amount: 43.48, currency: "USD", bucket: "WANTS", description: "Dinner", date: "2026-11-03", updatedAt: "2026-11-03T20:00:00.000Z", fx: { code: "EUR", amount: 40, kind: "spend", costPerUnitUSD: 1.087 } } as unknown as StoredTransaction;
    const merged = mergeFinancials(base(), base({ transactions: [row] })).data;
    expect(merged.transactions.find((t) => t.id === "t1")).toEqual(row);
  });
});

describe("rule 2: a copy written by newer code", () => {
  it("migrating it keeps its version and every field, and runs no step of this code's", () => {
    const newer = { ...base({ trips: TRIPS }), schemaVersion: NEWER };
    const out = migrateFinancials(newer);
    expect(out.schemaVersion).toBe(NEWER);
    expect(field(out, "trips")).toEqual(TRIPS);
  });

  it("an older copy is still migrated and stamped with this code's version", () => {
    expect(migrateFinancials({ ...base(), schemaVersion: CURRENT_SCHEMA_VERSION - 1 }).schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it("loading a newer copy from this device's storage writes nothing back; an older one is still written back", async () => {
    localStorage.clear();
    activateSessionKey(new Uint8Array(32).fill(9));
    await saveData({ ...base({ trips: TRIPS }), schemaVersion: NEWER }, "u-newer");
    const stored = localStorage.getItem("essa_data_u-newer");
    const loaded = await loadData("u-newer");
    expect(loaded.schemaVersion).toBe(NEWER);
    expect(field(loaded, "trips")).toEqual(TRIPS);
    expect(localStorage.getItem("essa_data_u-newer")).toBe(stored);

    // Stored raw: saveData itself migrates, so it never stores an older copy.
    localStorage.setItem("essa_data_u-older", await encryptJSON(JSON.stringify({ ...base(), schemaVersion: CURRENT_SCHEMA_VERSION - 1 })));
    const olderStored = localStorage.getItem("essa_data_u-older");
    await loadData("u-older");
    expect(localStorage.getItem("essa_data_u-older")).not.toBe(olderStored);
  });
});

describe("rule 2, while syncing: a newer backup is never merged into or written over", () => {
  let calls: { url: string; body: Record<string, unknown> }[];
  let server: LocalFinancials;
  beforeEach(() => {
    localStorage.clear(); sessionStorage.clear(); calls = [];
    sessionStorage.setItem("essa_st_v1", "tok");
    server = { ...base({ trips: TRIPS }), schemaVersion: NEWER };
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), body: init.body ? JSON.parse(String(init.body)) : {} });
      if (String(url).includes("/pull")) return new Response(JSON.stringify({ ok: true, data: server, syncedAt: "2026-11-03T20:00:00.000Z", hasRecoveryCode: true }), { status: 200 });
      return new Response(JSON.stringify({ ok: true, syncedAt: "2026-11-03T20:00:01.000Z" }), { status: 200 });
    }));
  });
  afterEach(() => { vi.unstubAllGlobals(); });
  const pushes = () => calls.filter((c) => c.url.includes("/push"));

  it("the fetch: refused, quietly (flagged, not a failure), nothing merged", async () => {
    const r = await fetchAndMerge("u1@example.test", () => base());
    expect(r).toMatchObject({ ok: false, newerVersion: true });
    expect(pushes()).toHaveLength(0);
  });

  it("the conflict merge: refused, and nothing is pushed", async () => {
    expect(await mergeAndPush("u1@example.test", base())).toMatchObject({ ok: false, newerVersion: true });
    expect(pushes()).toHaveLength(0);
  });

  it("an empty account never replaces it, and nobody is asked whether it should", async () => {
    const asked = vi.spyOn(window, "confirm").mockReturnValue(true); // even a yes wouldn't do it
    const r = await pushToServer("u1@example.test", { ...DEFAULT_DATA, syncChoice: { enabled: true, decidedAt: "2026-09-28T10:00:00.000Z" } } as LocalFinancials);
    expect(r.ok).toBe(false);
    expect(pushes()).toHaveLength(0);
    expect(asked).not.toHaveBeenCalled();
    asked.mockRestore();
  });

  it("this device holding a newer copy (read from it) doesn't push it", async () => {
    const r = await pushToServer("u1@example.test", { ...base({ trips: TRIPS }), schemaVersion: NEWER });
    expect(r).toMatchObject({ ok: false, newerVersion: true });
    expect(calls).toHaveLength(0);
  });

  it("a backup at this code's version still merges and pushes as before", async () => {
    server = base({ trips: TRIPS });
    const r = await mergeAndPush("u1@example.test", base());
    expect(r.ok).toBe(true);
    expect(pushes()).toHaveLength(1);
    expect(pushes()[0].body.data).toMatchObject({ trips: TRIPS });
  });

  it("the fetch takes an unknown list into this device's copy (so it's stored)", async () => {
    server = base({ trips: TRIPS });
    const r = await fetchAndMerge("u1@example.test", () => base());
    if (!r.ok || r.skipped) throw new Error("expected a merge");
    expect(r.localChanged).toBe(true);
    expect(field(r.mergedData, "trips")).toEqual(TRIPS);
  });
});
