// Travel map design pass, 4 (owner-approved rule B, 2026-11-05): a country's
// shape in pieces. The largest piece is the MAINLAND; a piece within 650 km of
// the mainland, or of another home piece, is HOME (owner chose 650 over 500 so
// Peninsular Malaysia, 603 km from Borneo, is home); the rest are OVERSEAS.
// Measured on the 110m data: France's French Guiana (6,517 km), the US's Alaska
// (824 km) and Hawaii, and Norway's Svalbard (681 km) are overseas; Corsica,
// Japan's islands, Canada's Arctic islands, Indonesia's islands, Russia's
// Franz Josef Land (517 km) and Peninsular Malaysia are home.
// A point (a city) is located in the piece that holds it, with 50 km of slack
// because 110m coastlines are coarse. A territory with no shape of its own
// (French Guiana GF, Svalbard SJ) maps to the piece of another country's shape
// that holds its point. Classified per country on first use, then kept.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildWorld } from "./worldMap";

const read = (f: string) => JSON.parse(readFileSync(join(__dirname, "..", "public", "geo", f), "utf8"));
const world = buildWorld(read("countries-110m.json"), read("countries.json"));
const roleAt = (code: string, lon: number, lat: number) => {
  const i = world.locate(code, lon, lat);
  return i === null ? null : world.roles(code)[i];
};

describe("pieces", () => {
  it("one path per piece; each country's first piece is its mainland", () => {
    const fr = world.pieces.filter((p) => p.code === "FR");
    expect(fr).toHaveLength(3);
    expect(fr.map((p) => p.index)).toEqual([0, 1, 2]);
    expect(world.roles("FR")[0]).toBe("mainland");
    expect(world.pieces.every((p) => p.d.startsWith("M"))).toBe(true);
    expect(new Set(world.pieces.map((p) => p.code)).size).toBe(177); // every shape, the two without a code included (null)
  });

  it("France: Paris on the mainland, Corsica home, French Guiana overseas", () => {
    expect(roleAt("FR", 2.35, 48.85)).toBe("mainland");
    expect(roleAt("FR", 9.15, 42.15)).toBe("home"); // Corsica
    expect(roleAt("FR", -52.33, 4.94)).toBe("overseas"); // Cayenne
  });

  it("the US: Alaska and Hawaii overseas; Norway: Svalbard overseas", () => {
    expect(roleAt("US", -74, 40.71)).toBe("mainland");
    expect(roleAt("US", -149.9, 61.22)).toBe("overseas"); // Anchorage
    expect(roleAt("US", -157.86, 21.31)).toBe("overseas"); // Honolulu
    expect(roleAt("NO", 15.63, 78.22)).toBe("overseas"); // Longyearbyen
    expect(roleAt("NO", 10.75, 59.91)).toBe("mainland");
  });

  it("at 650 km Peninsular Malaysia is home; Japan, Canada, Indonesia and Russia have no overseas piece", () => {
    expect(roleAt("MY", 101.69, 3.14)).not.toBe("overseas"); // Kuala Lumpur
    for (const code of ["JP", "CA", "ID", "RU"]) expect(world.roles(code).includes("overseas"), code).toBe(false);
  });
});

describe("locating a point", () => {
  it("a coastal city just outside the coarse outline still counts (50 km of slack); open sea is no piece", () => {
    expect(roleAt("FR", 7.27, 43.7)).toBe("mainland"); // Nice
    expect(world.locate("FR", -30, 45)).toBeNull(); // the Atlantic
    expect(world.locate("ZZ", 2.35, 48.85)).toBeNull();
  });

  it("a territory with no shape of its own is the piece of its parent's shape that holds its point", () => {
    expect(world.territory("GF")).toEqual({ code: "FR", index: world.locate("FR", -52.33, 4.94) });
    expect(world.territory("SJ")).toEqual({ code: "NO", index: world.locate("NO", 15.63, 78.22) });
    expect(world.territory("FR")).toBeNull(); // has its own shape
    expect(world.territory("MT")).toBeNull(); // a dot, inside no other country's shape
  });
});
