// Travel map plan, Phase 1b (owner-approved): the countries and cities a trip
// form picks from (lib/places.ts). Countries come from lib/countryCodes.ts,
// named by the browser (Intl.DisplayNames); cities from the one bundled file,
// fetched once from this app's own site with nothing in the URL but its path
// (D6), and searched without accents ("zahle" finds "Zahlé").
import { describe, it, expect, vi, afterEach } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { countryName, searchCountries, searchCities, findCity, foldName, loadCities, forgetCities, CITIES_URL, type CityRow } from "./places";

afterEach(() => { forgetCities(); vi.unstubAllGlobals(); });

const ROWS: CityRow[] = [
  ["Beirut", "LB", 33.89, 35.49], ["Jounieh", "LB", 33.98, 35.62], ["Zahlé", "LB", 33.85, 35.9],
  ["Lyon", "FR", 45.75, 4.85], ["Paris", "FR", 48.85, 2.35], ["Saint-Paul", "FR", 43.7, 7.12], ["Villeparisis", "FR", 48.94, 2.61],
];

describe("countries", () => {
  it("named in English by the browser, Kosovo included", () => {
    expect(countryName("FR")).toBe("France");
    expect(countryName("XK")).toBe("Kosovo");
  });

  it("searched by name without accents or case, names starting with the text first, then containing it", () => {
    expect(searchCountries("leb").map((c) => c.code)).toEqual(["LB"]);
    expect(searchCountries("CURACAO").map((c) => c.code)).toEqual(["CW"]); // "Curaçao"
    const ire = searchCountries("ire").map((c) => c.name);
    expect(ire[0]).toBe("Ireland");
    expect(searchCountries("")).toEqual([]);
    expect(searchCountries("zzzz")).toEqual([]);
  });
});

describe("cities", () => {
  it("folds a name: no accents, lower case, spaces trimmed", () => {
    expect(foldName("  Zahlé ")).toBe("zahle");
    expect(foldName("ZAHLE")).toBe(foldName("zahlé"));
  });

  it("searched within one country, without accents; starting with the text first, then containing it; at most `limit`", () => {
    expect(searchCities(ROWS, "LB", "zahle").map((r) => r[0])).toEqual(["Zahlé"]);
    expect(searchCities(ROWS, "FR", "par").map((r) => r[0])).toEqual(["Paris", "Villeparisis"]);
    expect(searchCities(ROWS, "LB", "par")).toEqual([]); // Paris is in France
    expect(searchCities(ROWS, "FR", "a", 2)).toHaveLength(2);
    expect(searchCities(ROWS, "FR", " ")).toEqual([]);
  });

  it("finds a typed name in the list, accents and case aside; a name not in the list is none", () => {
    expect(findCity(ROWS, "LB", "zahle")).toEqual(["Zahlé", "LB", 33.85, 35.9]);
    expect(findCity(ROWS, "LB", "Batroun")).toBeUndefined();
    expect(findCity(ROWS, "LB", "Paris")).toBeUndefined();
  });
});

describe("loading the city file", () => {
  const file = { fields: ["name", "country", "lat", "lon"], source: "GeoNames cities15000, 2026-11-04, CC BY 4.0", rows: ROWS };

  it("fetched once, from this app's own site, by its path alone", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(file)));
    vi.stubGlobal("fetch", fetch);
    expect(await loadCities()).toEqual(ROWS);
    expect(await loadCities()).toEqual(ROWS);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("/geo/cities15000.json");
    expect(CITIES_URL).toBe("/geo/cities15000.json");
  });

  it("a failed load is forgotten, so the next asks again", async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError("offline")).mockResolvedValueOnce(new Response(JSON.stringify(file)));
    vi.stubGlobal("fetch", fetch);
    await expect(loadCities()).rejects.toThrow();
    expect(await loadCities()).toEqual(ROWS);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("a reply that isn't the file (an error page) is a failure, not an empty list", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Not found", { status: 404 })));
    await expect(loadCities()).rejects.toThrow();
  });
});

// Like 2.4.165's email rule (lib/no-address-in-urls.test.ts): a URL lands in the host's request logs.
describe("no place a person went is ever put in a URL", () => {
  const ROOT = join(__dirname, ".."); // client/, wherever the run was started from
  const sources = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });

  it("no client source builds a URL with a city, country or coordinate query parameter", () => {
    const files = ["lib", "app", "components"].flatMap((d) => sources(join(ROOT, d)));
    expect(files.length).toBeGreaterThan(20);
    const offenders = files.filter((f) => /[?&](city|cities|country|countryCode|lat|lon|lng|place|stop)=/i.test(readFileSync(f, "utf8"))).map((f) => relative(ROOT, f));
    expect(offenders).toEqual([]);
  });
});
