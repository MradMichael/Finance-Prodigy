// Travel map design pass (owner, 2026-11-05; docs/plans/travel.md). Each
// concern adds its tests here, failing first.
//   1. The map opens fitted to the visited countries (the "Show my countries"
//      view); the whole world only when nothing is visited.
//   2. Visited countries stand out: a strong brass fill (the theme's brass70,
//      brass at 0xB0) reaching 3:1 against unvisited land in every theme, with
//      a thin ink outline (a brass one would vanish on brass) so neighbouring
//      visited countries stay apart. City markers keep their ink halo, which is
//      what reaches 3:1 on the fill. Planned keeps its dashed brass on land.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import TravelMap from "./TravelMap";
import { THEMES, type ThemeKey } from "../../lib/theme";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import MapPanel from "./MapPanel";
import { ThemeProvider } from "../../contexts/ThemeContext";
import { buildWorld, forgetWorld } from "../../lib/worldMap";
import type { StoredTrip, TripStop } from "../../lib/trips";

const geo = (f: string) => readFileSync(join(__dirname, "..", "..", "public", "geo", f), "utf8");
const TOPO = geo("countries-110m.json"), LIST = geo("countries.json");
const WORLD = buildWorld(JSON.parse(TOPO), JSON.parse(LIST));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); forgetWorld(); });

const TODAY = "2026-11-05";
const trip = (id: string, startDate: string, stops: TripStop[]): StoredTrip =>
  ({ id, name: id, startDate, endDate: startDate, budgetUSD: 0, stops, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
const EUROPE = trip("europe", "2025-06-01", [
  { id: "a", countryCode: "FR", city: "Paris", lat: 48.85, lon: 2.35 }, { id: "b", countryCode: "IT", city: "Rome", lat: 41.89, lon: 12.48 }, { id: "c", countryCode: "MT" },
]);
const JAPAN_PLANNED = trip("japan", "2027-04-01", [{ id: "d", countryCode: "JP", city: "Kyoto", lat: 35.01, lon: 135.77 }]);

async function panel(trips: StoredTrip[]) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(url.endsWith("countries-110m.json") ? TOPO : LIST)));
  const r = render(<ThemeProvider><MapPanel trips={trips} today={TODAY} onAddTrip={vi.fn()} onShowTrip={vi.fn()} /></ThemeProvider>);
  await screen.findByRole("button", { name: "Show my countries" });
  return r.container.querySelector("svg")!;
}
const viewBox = (svg: SVGSVGElement) => svg.getAttribute("viewBox")!.split(" ").map(Number);
const holds = ([x, y, w, h]: number[], [px, py]: [number, number]) => px >= x && px <= x + w && py >= y && py <= y + h;

describe("1. opens fitted to the visited countries", () => {
  it("with visited countries: the view holds them, a small part of the world, at the map's shape", async () => {
    const vb = viewBox(await panel([EUROPE, JAPAN_PLANNED]));
    expect(holds(vb, WORLD.project(2.35, 48.85))).toBe(true);
    expect(holds(vb, WORLD.project(14.51, 35.9))).toBe(true);
    expect(holds(vb, WORLD.project(135.77, 35.01))).toBe(false); // planned only: not part of the opening view
    expect(vb[2]).toBeLessThan(WORLD.width * 0.2);
    expect(vb[2] / vb[3]).toBeCloseTo(WORLD.width / WORLD.height, 2);
  });

  it("nothing visited (only planned trips): the whole world", async () => {
    expect(viewBox(await panel([JAPAN_PLANNED]))).toEqual([0, 0, WORLD.width, WORLD.height]);
  });
});

describe("2. visited countries stand out", () => {
  it("visited: the strong brass fill and an ink outline; planned: the dashed brass outline on plain land", () => {
    const t = THEMES.ivory;
    const { container } = render(<ThemeProvider><TravelMap world={WORLD} trips={[EUROPE, JAPAN_PLANNED]} today={TODAY} /></ThemeProvider>);
    const fr = container.querySelector('path[data-code="FR"]')!, jp = container.querySelector('path[data-code="JP"]')!;
    expect(fr.getAttribute("fill")).toBe(t.brass70);
    expect(fr.getAttribute("stroke")).toBe(t.ink);
    expect(jp.getAttribute("fill")).toBe(t.panelSoft);
    expect(jp.getAttribute("stroke")).toBe(t.brass);
    expect(jp.getAttribute("stroke-dasharray")).toBeTruthy();
    expect(t.brass70).toBe(t.brass + "B0");
  });

  describe.each(Object.keys(THEMES) as ThemeKey[])("contrast, %s", (key) => {
    const t = THEMES[key];
    const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const ch = (c: number) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const lum = ([r, g, b]: number[]) => 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
    const ratio = (a: number[], b: number[]) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    const over = (fg: number[], a: number, bg: number[]) => fg.map((c, i) => Math.round(c * a + bg[i] * (1 - a)));
    it("the fill on land, the ink outline and the markers' ink halo on the fill, the markers' jade on their halo, planned brass on land: all 3:1", () => {
      const land = rgb(t.panelSoft), fill = over(rgb(t.brass), 0xb0 / 255, land);
      const pairs: [string, number][] = [
        ["visited fill on land", ratio(fill, land)], ["ink outline on the fill", ratio(rgb(t.ink), fill)],
        ["marker halo (ink) on the fill", ratio(rgb(t.ink), fill)], ["marker jade on its ink halo", ratio(rgb(t.jade), rgb(t.ink))],
        ["planned brass on land", ratio(rgb(t.brass), land)], ["marker jade on unvisited land", ratio(rgb(t.jade), land)],
      ];
      expect(pairs.filter(([, r]) => r < 3).map(([p, r]) => `${p} ${r.toFixed(2)}`)).toEqual([]);
    });
  });
});
