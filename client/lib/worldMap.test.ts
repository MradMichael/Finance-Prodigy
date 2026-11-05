// Travel map plan, Phase 1c (owner-approved, D5): the map's geometry. Pure
// functions over the two bundled files (public/geo/countries-110m.json and
// countries.json), so the map component only draws. Equal Earth projection,
// in an SVG coordinate space 960 units wide. Units: lon/lat WGS84 degrees in,
// SVG units out; invert goes back. Both files are fetched from this app's own
// site by their paths alone, once (loadWorld).
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildWorld, loadWorld, forgetWorld, WORLD_URLS, type World } from "./worldMap";

const read = (f: string) => JSON.parse(readFileSync(join(__dirname, "..", "public", "geo", f), "utf8"));
const TOPO = read("countries-110m.json");
const LIST = read("countries.json");
const world: World = buildWorld(TOPO, LIST);
afterEach(() => { forgetWorld(); vi.unstubAllGlobals(); });

const within = (box: { x: number; y: number; width: number; height: number }, [x, y]: [number, number]) =>
  x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;

describe("dots", () => {
  it("every listed country without a shape is a dot at its centroid: Malta, Singapore, Bahrain among them", () => {
    const shaped = new Set(world.pieces.map((p) => p.code));
    expect(world.dots.map((d) => d.code).sort()).toEqual(LIST.rows.map((r: [string]) => r[0]).filter((c: string) => !shaped.has(c)).sort());
    for (const code of ["MT", "SG", "BH"]) expect(world.dots.some((d) => d.code === code), code).toBe(true);
    const mt = world.dots.find((d) => d.code === "MT")!;
    const [x, y] = world.project(14.44, 35.89);
    expect(Math.abs(mt.x - x) < 0.01 && Math.abs(mt.y - y) < 0.01).toBe(true);
  });

  it("is 960 units wide, its height the projection's", () => {
    expect(world.width).toBe(960);
    expect(world.height).toBeGreaterThan(400);
    expect(world.height).toBeLessThan(500);
  });
});

describe("projection", () => {
  it("a tap's point goes back to where it is on Earth, to well under a hundredth of a degree", () => {
    for (const [lon, lat] of [[35.66, 34.25], [2.35, 48.85], [-157.86, 21.31], [151.21, -33.87]]) {
      const [x, y] = world.project(lon, lat);
      const back = world.invert(x, y)!;
      expect(Math.abs(back[0] - lon) < 0.001 && Math.abs(back[1] - lat) < 0.001, `${lon},${lat}`).toBe(true);
    }
  });

  it("a point off the Earth's outline is no place", () => {
    expect(world.invert(-50, -50)).toBeNull();
  });
});

describe("fitting the view to countries", () => {
  it("France, Italy and Malta: a box holding Paris and Valletta, a small part of the world", () => {
    const box = world.bounds(["FR", "IT", "MT"]);
    expect(within(box, world.project(2.35, 48.85))).toBe(true);
    expect(within(box, world.project(14.51, 35.9))).toBe(true);
    expect(box.width).toBeLessThan(world.width * 0.15);
  });

  it("France is fitted on its main land: French Guiana is outside the box", () => {
    expect(within(world.bounds(["FR"]), world.project(-53, 4))).toBe(false);
  });

  it("no countries, or none it knows: the whole world", () => {
    for (const codes of [[], ["ZZ"]]) expect(world.bounds(codes)).toEqual({ x: 0, y: 0, width: world.width, height: world.height });
  });
});

describe("loading the map files", () => {
  it("fetched once, from this app's own site, by their paths alone", async () => {
    const fetch = vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith("countries-110m.json") ? TOPO : LIST)));
    vi.stubGlobal("fetch", fetch);
    const a = await loadWorld();
    await loadWorld();
    expect(a.pieces).toHaveLength(world.pieces.length);
    expect(fetch.mock.calls.map((c) => c[0]).sort()).toEqual(["/geo/countries-110m.json", "/geo/countries.json"]);
    expect([...WORLD_URLS].sort()).toEqual(["/geo/countries-110m.json", "/geo/countries.json"]);
  });

  it("a failed load is forgotten, so the next asks again; an error page is a failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Not found", { status: 404 })));
    await expect(loadWorld()).rejects.toThrow();
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith("countries-110m.json") ? TOPO : LIST))));
    expect((await loadWorld()).pieces).toHaveLength(world.pieces.length);
  });
});
