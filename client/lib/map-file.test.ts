// Travel map plan, Phase 1c (owner-approved, D5): the map's country shapes.
// public/geo/countries-110m.json is world-atlas@2.0.2's countries-110m
// (Natural Earth, public domain; credited on the About page), copied as is by
// scripts/build-geo.mjs. Its shapes carry ISO 3166-1 NUMERIC ids; the map
// reads them through public/geo/countries.json's numeric column. Three shapes
// have no id: Kosovo, matched by name as XK, and N. Cyprus and Somaliland,
// which no trip can name. It's precached like every public file (sw/build-sw.mjs).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (f: string) => JSON.parse(readFileSync(join(__dirname, "..", "public", "geo", f), "utf8"));
const topo = read("countries-110m.json") as { type: string; objects: { countries: { geometries: { id?: string; properties: { name: string } }[] } } };
const countries = read("countries.json") as { rows: [string, string | null, number, number][] };
const numerics = new Set(countries.rows.map((r) => r[1]).filter(Boolean));

describe("the map's country shapes", () => {
  it("are world-atlas's 110m topology: 177 shapes", () => {
    expect(topo.type).toBe("Topology");
    expect(topo.objects.countries.geometries).toHaveLength(177);
  });

  it("every shape with an id is a country in the country list; the three without are Kosovo, N. Cyprus and Somaliland", () => {
    const g = topo.objects.countries.geometries;
    for (const s of g.filter((x) => x.id != null)) expect(numerics.has(s.id!), `${s.properties.name} ${s.id}`).toBe(true);
    expect(g.filter((x) => x.id == null).map((x) => x.properties.name).sort()).toEqual(["Kosovo", "N. Cyprus", "Somaliland"]);
  });

  it("leaves out small countries the list still has, which the map draws as dots: Malta, Singapore, Bahrain", () => {
    const drawn = new Set(topo.objects.countries.geometries.map((x) => x.id));
    for (const code of ["MT", "SG", "BH"]) {
      const row = countries.rows.find((r) => r[0] === code)!;
      expect(drawn.has(row[1]!), code).toBe(false);
    }
  });
});
