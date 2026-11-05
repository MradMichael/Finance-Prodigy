// Travel map plan, Phase 1b (owner-approved, D6): the ONE bundled city file.
// public/geo/cities15000.json is GeoNames' cities15000 (every place of 15,000
// people or more; CC BY 4.0, credited on the About page), as rows of
// [name, country, lat, lon]: the name as GeoNames writes it (accents kept),
// the country as lib/countryCodes.ts lists it, coordinates in WGS84 degrees to
// 2 decimals. Written by scripts/build-geo.mjs; loaded only when a trip form
// first needs it (lib/cities.ts), never precached (sw/build-sw.mjs).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { COUNTRY_CODES } from "./countryCodes";

type Row = [name: string, country: string, lat: number, lon: number];
const file = JSON.parse(readFileSync(join(__dirname, "..", "public", "geo", "cities15000.json"), "utf8")) as { fields: string[]; source: string; rows: Row[] };

describe("the city file", () => {
  it("names its fields and its source, and holds every row of the GeoNames file it was made from", () => {
    expect(file.fields).toEqual(["name", "country", "lat", "lon"]);
    expect(file.source).toMatch(/^GeoNames cities15000, \d{4}-\d{2}-\d{2}, CC BY 4\.0$/);
    expect(file.rows).toHaveLength(34_197);
  });

  it("every row: a name, a country this app knows, coordinates in range to 2 decimals", () => {
    for (const [name, country, lat, lon] of file.rows) {
      expect(typeof name === "string" && name.trim() === name && name.length > 0, JSON.stringify(name)).toBe(true);
      expect(COUNTRY_CODES.has(country), country).toBe(true);
      for (const [v, max] of [[lat, 90], [lon, 180]] as const) {
        expect(Number.isFinite(v) && Math.abs(v) <= max && Math.round(v * 100) / 100 === v, `${name} ${v}`).toBe(true);
      }
    }
  });

  it("keeps names as GeoNames writes them, accents included; sorted by country, then name", () => {
    const lb = file.rows.filter((r) => r[1] === "LB").map((r) => r[0]);
    expect(lb).toContain("Zahlé");
    expect(lb).toContain("Beirut");
    expect(lb).toHaveLength(18);
    const keys = file.rows.map((r) => `${r[1]}\u0000${r[0]}`);
    expect(keys).toEqual([...keys].sort());
  });
});
