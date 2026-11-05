// Travel map plan, Phase 1b (owner-approved): the countries and cities a trip
// form picks from. Countries are lib/countryCodes.ts, named by the browser
// (Intl.DisplayNames, English, as defaultTripName names them). Cities are the
// one bundled file (D6; public/geo/cities15000.json, GeoNames, CC BY 4.0),
// fetched once, when a form first needs it, from this app's own site by its
// path alone: nothing a person typed or picked is ever in a URL. Search ignores
// accents and case ("zahle" finds "Zahlé"). Units: coordinates WGS84 degrees.
import { COUNTRY_CODES } from "./countryCodes";

/** [name, country (ISO alpha-2), lat, lon], as the city file holds them. */
export type CityRow = [name: string, country: string, lat: number, lon: number];

export const CITIES_URL = "/geo/cities15000.json";

/** A name for comparing: no accents, lower case, spaces trimmed. */
export function foldName(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
}

let regionNames: Intl.DisplayNames | null = null;
/** A country's English name, from the browser. */
export function countryName(code: string): string {
  regionNames ??= new Intl.DisplayNames(["en"], { type: "region" });
  return regionNames.of(code) ?? code;
}

let countries: { code: string; name: string; folded: string }[] | null = null;
/** Matches first by a name starting with the text, then containing it; each group by name. */
function ranked<T>(items: T[], folded: (t: T) => string, name: (t: T) => string, query: string, limit: number): T[] {
  const q = foldName(query);
  if (!q) return [];
  const byName = (a: T, b: T) => name(a).localeCompare(name(b));
  const starts = items.filter((t) => folded(t).startsWith(q)).sort(byName);
  const within = items.filter((t) => !folded(t).startsWith(q) && folded(t).includes(q)).sort(byName);
  return [...starts, ...within].slice(0, limit);
}

/** Countries whose name matches the text (accents and case aside). */
export function searchCountries(query: string, limit = 8): { code: string; name: string }[] {
  countries ??= [...COUNTRY_CODES].map((code) => { const name = countryName(code); return { code, name, folded: foldName(name) }; });
  return ranked(countries, (c) => c.folded, (c) => c.name, query, limit).map(({ code, name }) => ({ code, name }));
}

/** Cities in one country whose name matches the text (accents and case aside). */
export function searchCities(rows: CityRow[], country: string, query: string, limit = 8): CityRow[] {
  return ranked(rows.filter((r) => r[1] === country), (r) => foldName(r[0]), (r) => r[0], query, limit);
}

/** The city in the list that a typed name is, accents and case aside; undefined when it isn't in the list. */
export function findCity(rows: CityRow[], country: string, name: string): CityRow | undefined {
  const q = foldName(name);
  return q ? rows.find((r) => r[1] === country && foldName(r[0]) === q) : undefined;
}

let pending: Promise<CityRow[]> | null = null;
/** The city file, fetched once. A failed load is forgotten, so the next call asks again. */
export function loadCities(): Promise<CityRow[]> {
  return (pending ??= fetch(CITIES_URL)
    .then(async (res) => {
      if (!res.ok) throw new Error(`city file: ${res.status}`);
      const file = (await res.json()) as { rows?: unknown };
      if (!Array.isArray(file.rows)) throw new Error("city file: no rows");
      return file.rows as CityRow[];
    })
    .catch((err) => { pending = null; throw err; }));
}

/** Tests only: forget a loaded file. */
export function forgetCities(): void {
  pending = null;
}
