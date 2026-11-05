// Travel slice 2 (merged in session 19, 15d791f): trips sync like the wishlist. Merged by key with
// tombstones before a device has a record of a last sync, and under the
// fingerprint rule after: a one-sided change is taken, a two-sided one keeps
// the later edit and is named ("the trip": approved in session 17). A reset clears trips;
// a deleted trip stays deleted. Rows keep their tags through a merge.
// `trips` is now a field this code knows, so it's merged, not just carried
// over from the server (slice 0's rule 1 is for code that doesn't know it).
import { describe, it, expect } from "vitest";
import { DEFAULT_DATA, recordDeletion, resetFinancials, type LocalFinancials, type StoredTransaction } from "./localData";
import { mergeFinancials, restoreFromExport, unknownFieldsOf } from "./syncMerge";
import { seenOf } from "./syncSeen";
import { clashSentence } from "./syncService";
import { editTrip, type StoredTrip } from "./trips";

const T0 = new Date("2026-11-10T12:00:00.000Z");
const trip = (id: string, name: string, budgetUSD: number, updatedAt: string): StoredTrip =>
  ({ id, name, startDate: "2026-11-02", endDate: "2026-11-09", budgetUSD, createdAt: "2026-10-12T09:00:00.000Z", updatedAt });
const d = (trips: StoredTrip[], extra: Partial<LocalFinancials> = {}) => ({ ...DEFAULT_DATA, trips, ...extra }) as LocalFinancials;
const LISBON = trip("t1", "Lisbon", 1200, "2026-10-12T09:00:00.000Z");

// Travel map plan, Phase 0: a field inside a trip that this code doesn't know rides through
// both merge paths whole (pins what the engine already does; the trip is merged as one record).
describe("a trip's own fields this code doesn't know", () => {
  const newer = { ...trip("t1", "Lisbon", 1200, "2026-10-13T09:00:00.000Z"), stops: [{ id: "s1", countryCode: "PT" }], notes: "n" } as StoredTrip;
  it("survive a merge before a device has a record of a last sync, from either side", () => {
    expect(mergeFinancials(d([newer]), d([LISBON]), T0).data.trips).toEqual([newer]);
    expect(mergeFinancials(d([LISBON]), d([newer]), T0).data.trips).toEqual([newer]);
  });
  it("survive a merge under the fingerprint rule, when only the other device changed the trip", () => {
    const base = d([LISBON]);
    expect(mergeFinancials(base, d([newer]), T0, seenOf(base)).data.trips).toEqual([newer]);
  });
});

// Travel map plan, Phase 1a: a trip's countries and cities sync inside the trip, through the
// trip merge unchanged. Conflicts are settled per whole trip, not per field.
describe("a trip's countries and cities", () => {
  const P = { name: "Lisbon", startDate: "2026-11-02", endDate: "2026-11-09", budgetUSD: 1200 };
  const at = (iso: string) => new Date(iso);
  const edit = (from: LocalFinancials, p: Partial<Parameters<typeof editTrip>[2]>, when: string) => {
    const r = editTrip(from, "t1", { ...P, ...p }, at(when));
    if (!r.ok) throw new Error(r.reason);
    return r.data;
  };
  const before = d([LISBON]);

  it("change what the merge records as last seen, with nothing else changed", () => {
    const withStops = { ...LISBON, stops: [{ id: "s1", countryCode: "PT", city: "Lisbon" }] } as StoredTrip; // same edit time
    expect(seenOf(d([withStops])).kinds.trips!.t1).not.toBe(seenOf(before).kinds.trips!.t1);
  });

  it("an edit that sends them stores them (the merge carries what editTrip wrote)", () => {
    const after = edit(before, { stops: [{ countryCode: "PT", city: "Lisbon" }] }, "2026-10-13T09:00:00.000Z");
    expect(after.trips![0].stops?.map((s) => s.city)).toEqual(["Lisbon"]);
  });

  it("edited on one device only are taken, whichever side", () => {
    const after = edit(before, { stops: [{ countryCode: "PT", city: "Lisbon" }, { countryCode: "PT", city: "Porto" }] }, "2026-10-13T09:00:00.000Z");
    for (const [here, there] of [[after, before], [before, after]]) {
      const m = mergeFinancials(here, there, T0, seenOf(before));
      expect(m.data.trips).toEqual(after.trips);
      expect(m.clashes).toEqual([]);
    }
  });

  it("edited on both devices: the later edit's whole trip is kept, and the trip is named", () => {
    const here = edit(before, { stops: [{ countryCode: "PT", city: "Porto" }] }, "2026-10-13T09:00:00.000Z");
    const there = edit(before, { notes: "Fado" }, "2026-10-14T09:00:00.000Z");
    const r = mergeFinancials(here, there, T0, seenOf(before));
    expect(r.data.trips).toEqual(there.trips); // the stops edited here are not kept: one record, one winner
    expect(r.clashes.map(clashSentence)).toEqual(['Both devices changed the trip "Lisbon" — kept the later change.']);
  });

  it("go with a deleted trip, on both devices", () => {
    const withStops = edit(before, { stops: [{ countryCode: "PT", city: "Lisbon" }] }, "2026-10-13T09:00:00.000Z");
    const gone = d([], { deletedKeys: recordDeletion(withStops, "trips", "t1", at("2026-10-20T00:00:00.000Z")) });
    expect(mergeFinancials(gone, withStops, T0).data.trips ?? []).toEqual([]);
    expect(mergeFinancials(withStops, gone, T0, seenOf(withStops)).data.trips ?? []).toEqual([]);
  });

  it("are cleared by a reset, and come back with a restore from a file", () => {
    const withStops = edit(before, { stops: [{ countryCode: "PT", city: "Lisbon", lat: 38.72, lon: -9.14 }] }, "2026-10-13T09:00:00.000Z");
    const reset = resetFinancials(withStops, at("2026-11-01T00:00:00.000Z"));
    expect(mergeFinancials(withStops, reset, T0, seenOf(withStops)).data.trips ?? []).toEqual([]);
    expect(restoreFromExport(reset, withStops).trips).toEqual(withStops.trips);
  });

  // The server refuses a copy over 2,000,000 bytes (server/src/routes/sync.ts:77).
  it("300 trips of 10 cities each, with notes, stay well under the backup's size limit", () => {
    const trips: StoredTrip[] = Array.from({ length: 300 }, (_, i) => ({
      ...trip(`trip-${i}`, `Trip number ${i} through several countries`, 1500, "2026-10-12T09:00:00.000Z"),
      stops: Array.from({ length: 10 }, (_, j) => ({ id: `stop-${i}-${j}-xxxxxxxxxxxx`, countryCode: "FR", city: `Saint-Rémy-de-Provence ${j}`, lat: -43.12, lon: -170.45 })),
      notes: "n".repeat(200),
    }));
    expect(Buffer.byteLength(JSON.stringify(trips), "utf8")).toBeLessThan(1_000_000);
  });
});

describe("before a device has a record of a last sync", () => {
  it("both devices' trips are kept", () => {
    const merged = mergeFinancials(d([LISBON]), d([trip("t2", "Rome", 800, "2026-10-12T10:00:00.000Z")]), T0).data;
    expect((merged.trips ?? []).map((t) => t.name).sort()).toEqual(["Lisbon", "Rome"]);
  });

  it("a trip deleted on one device stays deleted, though the other still holds it", () => {
    const here = d([], { deletedKeys: recordDeletion(d([LISBON]), "trips", "t1", new Date("2026-10-20T00:00:00.000Z")) });
    expect(mergeFinancials(here, d([LISBON]), T0).data.trips ?? []).toEqual([]);
    expect(mergeFinancials(d([LISBON]), here, T0).data.trips ?? []).toEqual([]);
  });
});

describe("under the fingerprint rule", () => {
  it("a change made on one device only is taken, whichever side", () => {
    const seen = seenOf(d([LISBON]));
    const edited = { ...LISBON, budgetUSD: 1500, updatedAt: "2026-10-13T09:00:00.000Z" };
    expect(mergeFinancials(d([edited]), d([LISBON]), T0, seen).data.trips).toEqual([edited]);
    expect(mergeFinancials(d([LISBON]), d([edited]), T0, seen).data.trips).toEqual([edited]);
  });

  it("a change made on one device only is taken even when its clock is behind (the rule, not the edit time)", () => {
    const seen = seenOf(d([LISBON]));
    const slowClock = { ...LISBON, budgetUSD: 1500, updatedAt: "2026-10-01T09:00:00.000Z" }; // earlier than the copy it changed
    expect(mergeFinancials(d([slowClock]), d([LISBON]), T0, seen).data.trips).toEqual([slowClock]);
    expect(mergeFinancials(d([LISBON]), d([slowClock]), T0, seen).data.trips).toEqual([slowClock]);
  });

  it("both devices changed it: the later edit is kept and named", () => {
    const seen = seenOf(d([LISBON]));
    const here = { ...LISBON, budgetUSD: 1500, updatedAt: "2026-10-13T09:00:00.000Z" };
    const there = { ...LISBON, name: "Lisbon and Porto", updatedAt: "2026-10-14T09:00:00.000Z" };
    const r = mergeFinancials(d([here]), d([there]), T0, seen);
    expect(r.data.trips).toEqual([there]);
    expect(r.clashes.map(clashSentence)).toEqual(['Both devices changed the trip "Lisbon and Porto" — kept the later change.']);
  });
});

// Session 17, item 2: an edit is an ordinary change under the rule.
it("an edited trip (dates and budget) is taken from whichever device edited it, and its rows keep their tags", () => {
  const tagged = { id: "r1", amount: 30, currency: "USD", bucket: "WANTS", description: "Taxi", date: "2026-11-03", tripId: "t1", updatedAt: "2026-11-03T10:00:00.000Z" } as StoredTransaction;
  const before = d([LISBON], { transactions: [tagged] });
  const seen = seenOf(before);
  const r = editTrip(before, "t1", { name: "Lisbon", startDate: "2026-11-01", endDate: "2026-11-12", budgetUSD: 1500 }, new Date("2026-10-13T09:00:00.000Z"));
  if (!r.ok) throw new Error("refused");
  for (const [here, there] of [[r.data, before], [before, r.data]]) {
    const m = mergeFinancials(here, there, T0, seen);
    expect(m.data.trips).toEqual(r.data.trips);
    expect(m.data.transactions).toEqual([tagged]);
    expect(m.clashes).toEqual([]);
  }
});

it("a reset clears trips on the other device too", () => {
  const before = d([LISBON]);
  const reset = resetFinancials(before, new Date("2026-11-01T00:00:00.000Z"));
  const merged = mergeFinancials(before, reset, T0, seenOf(before)).data;
  expect(merged.trips ?? []).toEqual([]);
});

it("rows keep their trip tags through a merge", () => {
  const tagged = { id: "r1", amount: 30, currency: "USD", bucket: "WANTS", description: "Taxi", date: "2026-11-03", tripId: "t1", updatedAt: "2026-11-03T10:00:00.000Z" } as StoredTransaction;
  expect(mergeFinancials(d([LISBON]), d([LISBON], { transactions: [tagged] }), T0).data.transactions).toEqual([tagged]);
});

it("trips is a field this code knows: merged by key, not carried over from the server", () => {
  expect(unknownFieldsOf(d([LISBON]))).not.toHaveProperty("trips");
  // Each side holds a different trip: merged, both are kept. (Carried over
  // from the server as a field this code didn't know, this device's would go.)
  const rome = trip("t2", "Rome", 800, "2026-10-12T10:00:00.000Z");
  expect((mergeFinancials(d([LISBON]), d([rome]), T0, seenOf(d([]))).data.trips ?? []).map((t) => t.id).sort()).toEqual(["t1", "t2"]);
});
