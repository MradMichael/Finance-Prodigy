// Travel map plan (owner-approved): what the map and the country sheet read
// from trips. Read-only; nothing here writes a trip. A deleted trip isn't in
// the list these are given, so it counts nowhere.
// Phase 1c (D12): a trip is VISITED when it starts today or earlier (the
// device's local calendar day, YYYY-MM-DD), PLANNED when it starts later. A
// country with both kinds of trip is visited; "planned" lists only countries
// with nothing but planned trips.
import { describe, it, expect } from "vitest";
import { visitedCountries, tripsInCountry, cityMarkers, isPlanned } from "./travel";
import { todayCalendarDay } from "./calendarDay";
import type { StoredTrip, TripStop } from "./trips";

const trip = (id: string, startDate: string, stops?: TripStop[], endDate = startDate): StoredTrip =>
  ({ id, name: id, startDate, endDate, budgetUSD: 0, ...(stops ? { stops } : {}), createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
const stop = (id: string, countryCode: string, city?: string, lat?: number, lon?: number): TripStop =>
  ({ id, countryCode, ...(city ? { city } : {}), ...(lat !== undefined ? { lat, lon } : {}) });

const TODAY = "2026-11-05";
const EUROPE = trip("europe", "2025-06-01", [stop("a", "FR", "Paris", 48.85, 2.35), stop("b", "IT", "Rome", 41.89, 12.48), stop("c", "FR", "Lyon"), stop("d", "MT")]);
const PARIS = trip("paris", "2023-04-10", [stop("e", "FR", "Paris", 48.85, 2.35)]);
const BEIRUT = trip("beirut", "2026-02-01", [stop("f", "LB", "Batroun", 34.25, 35.66)]);
const NONE = trip("lisbon-budget-only", "2026-03-01");
const JAPAN = trip("japan", "2027-04-01", [stop("g", "JP", "Kyoto", 35.01, 135.77)]);
const PARIS_AGAIN = trip("paris-again", "2026-12-20", [stop("h", "FR", "Paris", 48.85, 2.35)]);

describe("visited or planned", () => {
  it("visited when it starts today or earlier; planned when it starts later", () => {
    expect(isPlanned(trip("t", "2026-11-05"), TODAY)).toBe(false);
    expect(isPlanned(trip("t", "2026-11-06"), TODAY)).toBe(true);
    expect(isPlanned(trip("t", "2026-11-04", [], "2026-11-12"), TODAY)).toBe(false); // started yesterday, ends next week
  });

  // The device's local day decides (todayCalendarDay), never the UTC day. Runs on the Beirut leg.
  it.runIf(process.env.TZ === "Asia/Beirut")("in Beirut, 00:30 on 6 November is the 6th: a trip starting that day is visited", () => {
    const today = todayCalendarDay(new Date("2026-11-05T22:30:00.000Z")); // 00:30 in Beirut (UTC+2), still the 5th in UTC
    expect(today).toBe("2026-11-06");
    expect(isPlanned(trip("t", "2026-11-06"), today)).toBe(false);
  });
});

describe("countries visited, and planned", () => {
  it("each country once, sorted by code; a trip without stops adds none", () => {
    expect(visitedCountries([EUROPE, PARIS, BEIRUT, NONE], TODAY)).toEqual({ visited: ["FR", "IT", "LB", "MT"], planned: [] });
    expect(visitedCountries([], TODAY)).toEqual({ visited: [], planned: [] });
  });

  it("a country with only planned trips is planned; one with a past trip too is visited only", () => {
    expect(visitedCountries([EUROPE, JAPAN, PARIS_AGAIN], TODAY)).toEqual({ visited: ["FR", "IT", "MT"], planned: ["JP"] });
  });

  it("once a planned trip's start comes, its countries are visited, with nothing changed but the day", () => {
    expect(visitedCountries([JAPAN], "2027-03-31").planned).toEqual(["JP"]);
    expect(visitedCountries([JAPAN], "2027-04-01")).toEqual({ visited: ["JP"], planned: [] });
  });
});

describe("the trips in a country", () => {
  it("newest first, each marked planned or not; a trip through several countries is under each", () => {
    expect(tripsInCountry([PARIS, BEIRUT, EUROPE, NONE, PARIS_AGAIN], "FR", TODAY).map((t) => [t.trip.id, t.planned])).toEqual([
      ["paris-again", true], ["europe", false], ["paris", false],
    ]);
    expect(tripsInCountry([PARIS, BEIRUT, EUROPE], "IT", TODAY).map((t) => t.trip.id)).toEqual(["europe"]);
    expect(tripsInCountry([PARIS, BEIRUT, EUROPE], "DE", TODAY)).toEqual([]);
  });

  it("each with its cities in that country, in route order; none for a country named without a city", () => {
    expect(tripsInCountry([EUROPE], "FR", TODAY)[0].cities).toEqual(["Paris", "Lyon"]);
    expect(tripsInCountry([EUROPE], "MT", TODAY)[0].cities).toEqual([]);
  });

  it("two trips starting the same day: the later end first, then by id, so the order never wobbles", () => {
    const a = { ...trip("a", "2025-01-01"), endDate: "2025-01-05", stops: [stop("x", "FR")] };
    const b = { ...trip("b", "2025-01-01"), endDate: "2025-01-09", stops: [stop("y", "FR")] };
    const c = { ...trip("c", "2025-01-01"), endDate: "2025-01-09", stops: [stop("z", "FR")] };
    expect(tripsInCountry([a, c, b], "FR", TODAY).map((t) => t.trip.id)).toEqual(["b", "c", "a"]);
  });
});

describe("city markers", () => {
  it("one per place with coordinates, naming every trip there; a stop without coordinates has none", () => {
    expect(cityMarkers([EUROPE, PARIS, BEIRUT, NONE], TODAY)).toEqual([
      { countryCode: "FR", city: "Paris", lat: 48.85, lon: 2.35, tripIds: ["europe", "paris"], planned: false },
      { countryCode: "IT", city: "Rome", lat: 41.89, lon: 12.48, tripIds: ["europe"], planned: false },
      { countryCode: "LB", city: "Batroun", lat: 34.25, lon: 35.66, tripIds: ["beirut"], planned: false },
    ]);
  });

  it("a place is planned only when every trip there is planned", () => {
    const m = cityMarkers([JAPAN, PARIS, PARIS_AGAIN], TODAY);
    expect(m.find((x) => x.city === "Kyoto")!.planned).toBe(true);
    expect(m.find((x) => x.city === "Paris")).toMatchObject({ tripIds: ["paris", "paris-again"], planned: false });
  });

  it("a trip that stops twice at one place is named once there", () => {
    const twice = trip("twice", "2024-01-01", [stop("p1", "FR", "Paris", 48.85, 2.35), stop("l", "FR", "Lyon", 45.76, 4.84), stop("p2", "FR", "Paris", 48.85, 2.35)]);
    expect(cityMarkers([twice], TODAY).find((m) => m.city === "Paris")!.tripIds).toEqual(["twice"]);
  });
});
