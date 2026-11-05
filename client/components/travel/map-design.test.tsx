// Travel map design pass (owner, 2026-11-05; docs/plans/travel.md). Each
// concern adds its tests here, failing first.
//   1. The map opens fitted to the visited countries (the "Show my countries"
//      view); the whole world only when nothing is visited.
//   2. Visited countries stand out: a strong brass fill (the theme's brass70,
//      brass at 0xB0) reaching 3:1 against unvisited land in every theme, with
//      a thin ink outline (a brass one would vanish on brass) so neighbouring
//      visited countries stay apart. City markers keep their ink halo, which is
//      what reaches 3:1 on the fill. Planned keeps its dashed brass on land.
//   3. Small-country dots (the countries the 110m shapes leave out) only for
//      visited or planned countries, not for every small country.
//   4. Overseas pieces (rule B, owner): per trip and country, the piece groups
//      holding its cities' points light; none of its stops there with a point:
//      the home group. Groups add up across trips. A territory with no shape of
//      its own (French Guiana, GF) lights its parent's piece, and tapping that
//      piece opens the territory. Planned lights, dashed, where nothing is visited.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import TravelMap from "./TravelMap";
import { fireEvent } from "@testing-library/react";
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

describe("3. dots only for visited or planned small countries", () => {
  it("Malta visited and Singapore planned have dots, with their tap areas; no other small country has one", () => {
    const SINGAPORE_PLANNED = trip("sg", "2027-01-10", [{ id: "s", countryCode: "SG" }]);
    const { container } = render(<ThemeProvider><TravelMap world={WORLD} trips={[EUROPE, SINGAPORE_PLANNED]} today={TODAY} /></ThemeProvider>);
    const dots = [...container.querySelectorAll("circle[data-dot]")].map((c) => [c.getAttribute("data-dot"), c.getAttribute("data-state")]);
    expect(dots.sort()).toEqual([["MT", "visited"], ["SG", "planned"]]);
    expect([...container.querySelectorAll("circle[data-hit]")].map((c) => c.getAttribute("data-hit")).sort()).toEqual(["MT", "SG"]);
  });

  it("no trips: no dots at all", () => {
    const { container } = render(<ThemeProvider><TravelMap world={WORLD} trips={[]} today={TODAY} /></ThemeProvider>);
    expect(container.querySelectorAll("circle[data-dot], circle[data-hit]")).toHaveLength(0);
  });
});

describe("4. overseas pieces light by rule B", () => {
  const PARIS = { id: "p", countryCode: "FR", city: "Paris", lat: 48.85, lon: 2.35 };
  const CAYENNE = { id: "c", countryCode: "FR", city: "Cayenne", lat: 4.94, lon: -52.33 };
  const HONOLULU = { id: "h", countryCode: "US", city: "Honolulu", lat: 21.31, lon: -157.86 };
  function drawn(trips: StoredTrip[]) {
    const onCountry = vi.fn();
    const { container } = render(<ThemeProvider><TravelMap world={WORLD} trips={trips} today={TODAY} onCountry={onCountry} /></ThemeProvider>);
    const piece = (code: string, lon: number, lat: number) => container.querySelector(`path[data-code="${code}"][data-piece="${WORLD.locate(code, lon, lat)}"]`)!;
    const stateAt = (code: string, lon: number, lat: number) => piece(code, lon, lat).getAttribute("data-state");
    return { onCountry, piece, stateAt, container };
  }

  it("one path per piece", () => {
    expect(drawn([]).container.querySelectorAll("path[data-shape]")).toHaveLength(WORLD.pieces.length);
  });

  it("Paris: mainland France and Corsica, not French Guiana", () => {
    const { stateAt } = drawn([trip("t", "2025-01-01", [PARIS])]);
    expect(stateAt("FR", 2.35, 48.85)).toBe("visited");
    expect(stateAt("FR", 9.15, 42.15)).toBe("visited");
    expect(stateAt("FR", -52.33, 4.94)).toBe("none");
  });

  it("Cayenne only: French Guiana, not the mainland", () => {
    const { stateAt } = drawn([trip("t", "2025-01-01", [CAYENNE])]);
    expect(stateAt("FR", -52.33, 4.94)).toBe("visited");
    expect(stateAt("FR", 2.35, 48.85)).toBe("none");
  });

  it("France with no city point: the mainland (home group) only", () => {
    const { stateAt } = drawn([trip("t", "2025-01-01", [{ id: "x", countryCode: "FR", city: "Somewhere typed" }])]);
    expect(stateAt("FR", 2.35, 48.85)).toBe("visited");
    expect(stateAt("FR", -52.33, 4.94)).toBe("none");
  });

  it("Honolulu: every Hawaiian piece, not Alaska nor the mainland; with another US trip without points, the mainland too", () => {
    const one = drawn([trip("t", "2025-01-01", [HONOLULU])]);
    expect(one.stateAt("US", -157.86, 21.31)).toBe("visited");
    expect(one.stateAt("US", -155.09, 19.72)).toBe("visited"); // Hilo, another island
    expect(one.stateAt("US", -149.9, 61.22)).toBe("none");
    expect(one.stateAt("US", -74, 40.71)).toBe("none");
    cleanup();
    const two = drawn([trip("t", "2025-01-01", [HONOLULU]), trip("u", "2024-01-01", [{ id: "y", countryCode: "US" }])]);
    expect(two.stateAt("US", -74, 40.71)).toBe("visited");
    expect(two.stateAt("US", -157.86, 21.31)).toBe("visited");
  });

  it("French Guiana as its own country (GF): France's Guiana piece lights, and tapping it opens French Guiana", () => {
    const { stateAt, piece, onCountry } = drawn([trip("t", "2025-01-01", [{ id: "g", countryCode: "GF" }])]);
    expect(stateAt("FR", -52.33, 4.94)).toBe("visited");
    expect(stateAt("FR", 2.35, 48.85)).toBe("none");
    fireEvent.click(piece("FR", -52.33, 4.94));
    expect(onCountry).toHaveBeenCalledWith("GF");
  });

  it("planned lights dashed where nothing is visited: Paris planned, Cayenne visited", () => {
    const { stateAt, piece } = drawn([trip("v", "2025-01-01", [CAYENNE]), trip("p", "2027-01-01", [PARIS])]);
    expect(stateAt("FR", -52.33, 4.94)).toBe("visited");
    expect(stateAt("FR", 2.35, 48.85)).toBe("planned");
    expect(piece("FR", 2.35, 48.85).getAttribute("stroke-dasharray")).toBeTruthy();
  });

  it("tapping a piece that isn't lit still opens its country", () => {
    const { piece, onCountry } = drawn([trip("t", "2025-01-01", [PARIS])]);
    fireEvent.click(piece("FR", -52.33, 4.94));
    expect(onCountry).toHaveBeenCalledWith("FR");
  });
});

describe("4c. the views fit what lights", () => {
  it("a France trip to Cayenne only opens on French Guiana, not on Paris; \"Show my countries\" too", async () => {
    const svg = await panel([trip("t", "2025-01-01", [{ id: "c", countryCode: "FR", city: "Cayenne", lat: 4.94, lon: -52.33 }])]);
    const vb = viewBox(svg);
    expect(holds(vb, WORLD.project(-52.33, 4.94))).toBe(true);
    expect(holds(vb, WORLD.project(2.35, 48.85))).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Show my countries" }));
    expect(holds(viewBox(svg), WORLD.project(-52.33, 4.94))).toBe(true);
    expect(holds(viewBox(svg), WORLD.project(2.35, 48.85))).toBe(false);
  });

  it("a Paris trip still opens on France's mainland, without French Guiana", async () => {
    const vb = viewBox(await panel([trip("t", "2025-01-01", [{ id: "p", countryCode: "FR", city: "Paris", lat: 48.85, lon: 2.35 }])]));
    expect(holds(vb, WORLD.project(2.35, 48.85))).toBe(true);
    expect(holds(vb, WORLD.project(-52.33, 4.94))).toBe(false);
  });
});
