// Travel map plan, Phase 1a (owner-approved): the bundled country list.
// public/geo/countries.json holds every ISO 3166-1 country (and Kosovo, XK)
// with its numeric code (null for XK: it has none) and a centroid in WGS84
// degrees, for the map's dots and the picker. lib/countryCodes.ts is the codes
// alone, for checking a trip's countries without loading the file. Both come
// from scripts/build-geo.mjs; this test is what keeps them in step.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { COUNTRY_CODES } from "./countryCodes";

type Row = [code: string, numeric: string | null, lat: number, lon: number];
const file = JSON.parse(readFileSync(new URL("../public/geo/countries.json", import.meta.url), "utf8")) as { fields: string[]; rows: Row[] };
const byCode = new Map(file.rows.map((r) => [r[0], r]));

describe("the country list", () => {
  it("names its fields, and holds 250 countries, each once, Kosovo as XK", () => {
    expect(file.fields).toEqual(["code", "numeric", "lat", "lon"]);
    expect(file.rows).toHaveLength(250);
    expect(byCode.size).toBe(250);
    for (const [code, numeric] of file.rows) {
      expect(code).toMatch(/^[A-Z]{2}$/);
      if (code === "XK") expect(numeric).toBeNull();
      else expect(numeric).toMatch(/^\d{3}$/);
    }
    expect(byCode.has("XK")).toBe(true);
  });

  it("gives every country a centroid in range", () => {
    for (const [code, , lat, lon] of file.rows) {
      expect(Number.isFinite(lat) && lat >= -90 && lat <= 90, `${code} lat ${lat}`).toBe(true);
      expect(Number.isFinite(lon) && lon >= -180 && lon <= 180, `${code} lon ${lon}`).toBe(true);
    }
  });

  // A centroid on the country's largest piece of land: France's isn't pulled toward French
  // Guiana, nor the United States' toward Alaska and Hawaii. The small countries the 110m
  // map leaves out (drawn as dots) sit where they are.
  it("puts each centroid on the country's main land", () => {
    const at = (code: string) => { const r = byCode.get(code)!; return { lat: r[2], lon: r[3] }; };
    const inBox = (code: string, lat: [number, number], lon: [number, number]) => {
      const c = at(code);
      expect(c.lat >= lat[0] && c.lat <= lat[1] && c.lon >= lon[0] && c.lon <= lon[1], `${code} at ${c.lat},${c.lon}`).toBe(true);
    };
    inBox("FR", [42, 51], [-5, 8]);
    inBox("US", [25, 49], [-125, -67]);
    inBox("LB", [33, 34.7], [35, 36.7]);
    inBox("MT", [35.7, 36.1], [14.1, 14.6]);
    inBox("SG", [1.1, 1.5], [103.6, 104.1]);
    inBox("BH", [25.7, 26.4], [50.3, 50.8]);
    inBox("XK", [41.8, 43.3], [20, 21.8]);
  });

  it("names every country in English, Kosovo included", () => {
    const names = new Intl.DisplayNames(["en"], { type: "region" });
    for (const [code] of file.rows) {
      const name = names.of(code);
      expect(name && name !== code && name !== "Unknown Region", `${code} -> ${name}`).toBe(true);
    }
  });

  it("lib/countryCodes.ts holds exactly the file's codes, sorted", () => {
    expect([...COUNTRY_CODES]).toEqual(file.rows.map((r) => r[0]).sort());
  });
});
