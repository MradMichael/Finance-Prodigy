// Travel map plan, Phase 1a (owner-approved): what the map and the country
// sheet read from trips (lib/trips.ts). Read-only: nothing here writes a
// trip. Given the trips held (a deleted trip isn't one). Units: country codes
// are ISO 3166-1 alpha-2; coordinates WGS84 degrees, as stored on a stop.
// Phase 1c (owner, D12): a trip is VISITED when it starts today or earlier and
// PLANNED when it starts later. `today` is the device's local calendar day
// (todayCalendarDay), "YYYY-MM-DD", so a plain string compare decides.
import type { StoredTrip } from "./trips";

/** A trip that starts after today. */
export function isPlanned(trip: StoredTrip, today: string): boolean {
  return trip.startDate > today;
}

/**
 * The countries trips' stops name, each once, sorted by code: `visited` where
 * any trip there has started; `planned` where every trip there is planned. A
 * trip without stops adds none.
 */
export function visitedCountries(trips: StoredTrip[], today: string): { visited: string[]; planned: string[] } {
  const visited = new Set<string>(), any = new Set<string>();
  for (const t of trips) for (const s of t.stops ?? []) {
    any.add(s.countryCode);
    if (!isPlanned(t, today)) visited.add(s.countryCode);
  }
  return { visited: [...visited].sort(), planned: [...any].filter((c) => !visited.has(c)).sort() };
}

/**
 * The trips through a country, newest first (start, then the later end, then
 * id, so the order never wobbles), each with its cities there in route order
 * (a stop naming the country alone adds none) and whether it's planned.
 */
export function tripsInCountry(trips: StoredTrip[], countryCode: string, today: string): { trip: StoredTrip; cities: string[]; planned: boolean }[] {
  return trips
    .filter((t) => (t.stops ?? []).some((s) => s.countryCode === countryCode))
    .sort((a, b) => b.startDate.localeCompare(a.startDate) || b.endDate.localeCompare(a.endDate) || a.id.localeCompare(b.id))
    .map((trip) => ({ trip, cities: (trip.stops ?? []).filter((s) => s.countryCode === countryCode && s.city).map((s) => s.city!), planned: isPlanned(trip, today) }));
}

export interface CityMarker { countryCode: string; city?: string; lat: number; lon: number; tripIds: string[]; planned: boolean }

/**
 * One marker per place with coordinates (same country, city and point),
 * naming each trip there once, in the order the trips were given; planned
 * only when every trip there is. Sorted by country, then city. A stop without
 * coordinates has no marker.
 */
export function cityMarkers(trips: StoredTrip[], today: string): CityMarker[] {
  const by = new Map<string, CityMarker>();
  for (const t of trips) {
    for (const s of t.stops ?? []) {
      if (s.lat === undefined || s.lon === undefined) continue;
      const key = `${s.countryCode}|${s.city ?? ""}|${s.lat}|${s.lon}`;
      const m = by.get(key) ?? { countryCode: s.countryCode, ...(s.city ? { city: s.city } : {}), lat: s.lat, lon: s.lon, tripIds: [], planned: true };
      if (!m.tripIds.includes(t.id)) m.tripIds.push(t.id);
      if (!isPlanned(t, today)) m.planned = false;
      by.set(key, m);
    }
  }
  return [...by.values()].sort((a, b) => a.countryCode.localeCompare(b.countryCode) || (a.city ?? "").localeCompare(b.city ?? ""));
}
