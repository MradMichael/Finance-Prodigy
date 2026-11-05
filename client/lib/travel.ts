// Travel map plan, Phase 1a (owner-approved): what the map and the country
// sheet read from trips (lib/trips.ts). Read-only: nothing here writes a
// trip. Given the trips held (a deleted trip isn't one), every trip counts,
// whatever its dates. Units: country codes are ISO 3166-1 alpha-2;
// coordinates WGS84 degrees, as stored on a stop.
import type { StoredTrip } from "./trips";

/** Every country a trip's stops name, each once, sorted by code. A trip without stops adds none. */
export function visitedCountries(trips: StoredTrip[]): string[] {
  return [...new Set(trips.flatMap((t) => (t.stops ?? []).map((s) => s.countryCode)))].sort();
}

/**
 * The trips through a country, newest first (start, then the later end, then
 * id, so the order never wobbles), each with its cities there in route order
 * (a stop naming the country alone adds none).
 */
export function tripsInCountry(trips: StoredTrip[], countryCode: string): { trip: StoredTrip; cities: string[] }[] {
  return trips
    .filter((t) => (t.stops ?? []).some((s) => s.countryCode === countryCode))
    .sort((a, b) => b.startDate.localeCompare(a.startDate) || b.endDate.localeCompare(a.endDate) || a.id.localeCompare(b.id))
    .map((trip) => ({ trip, cities: (trip.stops ?? []).filter((s) => s.countryCode === countryCode && s.city).map((s) => s.city!) }));
}

export interface CityMarker { countryCode: string; city?: string; lat: number; lon: number; tripIds: string[] }

/**
 * One marker per place with coordinates (same country, city and point),
 * naming each trip there once, in the order the trips were given. Sorted by
 * country, then city. A stop without coordinates has no marker.
 */
export function cityMarkers(trips: StoredTrip[]): CityMarker[] {
  const by = new Map<string, CityMarker>();
  for (const t of trips) {
    for (const s of t.stops ?? []) {
      if (s.lat === undefined || s.lon === undefined) continue;
      const key = `${s.countryCode}|${s.city ?? ""}|${s.lat}|${s.lon}`;
      const m = by.get(key) ?? { countryCode: s.countryCode, ...(s.city ? { city: s.city } : {}), lat: s.lat, lon: s.lon, tripIds: [] };
      if (!m.tripIds.includes(t.id)) m.tripIds.push(t.id);
      by.set(key, m);
    }
  }
  return [...by.values()].sort((a, b) => a.countryCode.localeCompare(b.countryCode) || (a.city ?? "").localeCompare(b.city ?? ""));
}
