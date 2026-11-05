// Travel map plan, Phase 1a (owner-approved): what the map and the country
// sheet read from trips. Read-only; nothing here writes a trip. A deleted
// trip isn't in the list these are given, so it counts nowhere.
import { describe, it, expect } from "vitest";
import { visitedCountries, tripsInCountry, cityMarkers } from "./travel";
import type { StoredTrip, TripStop } from "./trips";

const trip = (id: string, startDate: string, stops?: TripStop[]): StoredTrip =>
  ({ id, name: id, startDate, endDate: startDate, budgetUSD: 0, ...(stops ? { stops } : {}), createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
const stop = (id: string, countryCode: string, city?: string, lat?: number, lon?: number): TripStop =>
  ({ id, countryCode, ...(city ? { city } : {}), ...(lat !== undefined ? { lat, lon } : {}) });

const EUROPE = trip("europe", "2025-06-01", [stop("a", "FR", "Paris", 48.85, 2.35), stop("b", "IT", "Rome", 41.89, 12.48), stop("c", "FR", "Lyon"), stop("d", "MT")]);
const PARIS = trip("paris", "2023-04-10", [stop("e", "FR", "Paris", 48.85, 2.35)]);
const BEIRUT = trip("beirut", "2026-02-01", [stop("f", "LB", "Batroun", 34.25, 35.66)]);
const NONE = trip("lisbon-budget-only", "2026-03-01");

describe("countries visited", () => {
  it("each country once, sorted by code, from every trip's stops; a trip without stops adds none", () => {
    expect(visitedCountries([EUROPE, PARIS, BEIRUT, NONE])).toEqual(["FR", "IT", "LB", "MT"]);
    expect(visitedCountries([])).toEqual([]);
    expect(visitedCountries([NONE])).toEqual([]);
  });
});

describe("the trips in a country", () => {
  it("newest first; a trip through several countries is under each", () => {
    expect(tripsInCountry([PARIS, BEIRUT, EUROPE, NONE], "FR").map((t) => t.trip.id)).toEqual(["europe", "paris"]);
    expect(tripsInCountry([PARIS, BEIRUT, EUROPE], "IT").map((t) => t.trip.id)).toEqual(["europe"]);
    expect(tripsInCountry([PARIS, BEIRUT, EUROPE], "DE")).toEqual([]);
  });

  it("each with its cities in that country, in route order; none for a country named without a city", () => {
    const fr = tripsInCountry([EUROPE], "FR")[0];
    expect(fr.cities).toEqual(["Paris", "Lyon"]);
    expect(tripsInCountry([EUROPE], "MT")[0].cities).toEqual([]);
  });

  it("two trips starting the same day: the later end first, then by id, so the order never wobbles", () => {
    const a = { ...trip("a", "2025-01-01"), endDate: "2025-01-05", stops: [stop("x", "FR")] };
    const b = { ...trip("b", "2025-01-01"), endDate: "2025-01-09", stops: [stop("y", "FR")] };
    const c = { ...trip("c", "2025-01-01"), endDate: "2025-01-09", stops: [stop("z", "FR")] };
    expect(tripsInCountry([a, c, b], "FR").map((t) => t.trip.id)).toEqual(["b", "c", "a"]);
  });
});

describe("city markers", () => {
  it("one per place with coordinates, naming every trip there; a stop without coordinates has none", () => {
    expect(cityMarkers([EUROPE, PARIS, BEIRUT, NONE])).toEqual([
      { countryCode: "FR", city: "Paris", lat: 48.85, lon: 2.35, tripIds: ["europe", "paris"] },
      { countryCode: "IT", city: "Rome", lat: 41.89, lon: 12.48, tripIds: ["europe"] },
      { countryCode: "LB", city: "Batroun", lat: 34.25, lon: 35.66, tripIds: ["beirut"] },
    ]);
  });

  it("a trip that stops twice at one place is named once there", () => {
    const twice = trip("twice", "2024-01-01", [stop("p1", "FR", "Paris", 48.85, 2.35), stop("l", "FR", "Lyon", 45.76, 4.84), stop("p2", "FR", "Paris", 48.85, 2.35)]);
    expect(cityMarkers([twice]).find((m) => m.city === "Paris")!.tripIds).toEqual(["twice"]);
  });
});
