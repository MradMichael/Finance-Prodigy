// Travel map plan, Phase 1c (owner-approved; wording APPROVED 2026-11-05): the
// map itself (TravelMap) and the panel that loads it (MapPanel).
//   - Visited countries: since the design pass, a strong brass fill (brass70)
//     and a thin ink outline (map-design.test.tsx has its tests and contrast).
//     Planned-only (D12): a DASHED brass border and no brass fill. A country
//     with both is visited. The border and its dash carry the meaning, never
//     colour alone; each reaches 3:1 (WCAG 1.4.11) in every theme.
//   - Countries the 110m shapes leave out are dots; a dot's tap area is 44 px.
//   - City markers: jade with an ink halo; planned ones hollow and dashed.
//   - Zoom "+" / "−" (read "Zoom in" / "Zoom out"), drag, "Show my countries".
//   - The image is hidden from screen readers; the country list is their route.
//   - MapPanel: nothing fetched while no trip has a country (the empty state);
//     a placeholder while loading, "Still loading the map…" after 10 seconds,
//     and on failure the approved line with "Try again".
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import TravelMap from "./TravelMap";
import MapPanel from "./MapPanel";
import { ThemeProvider } from "../../contexts/ThemeContext";
import { THEMES, type ThemeKey } from "../../lib/theme";
import { buildWorld, forgetWorld } from "../../lib/worldMap";
import type { StoredTrip, TripStop } from "../../lib/trips";

const read = (f: string) => JSON.parse(readFileSync(join(__dirname, "..", "..", "public", "geo", f), "utf8"));
const TOPO = read("countries-110m.json"), LIST = read("countries.json");
const WORLD = buildWorld(TOPO, LIST);
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); forgetWorld(); });

const TODAY = "2026-11-05";
const trip = (id: string, startDate: string, stops: TripStop[]): StoredTrip =>
  ({ id, name: id, startDate, endDate: startDate, budgetUSD: 0, stops, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
const EUROPE = trip("europe", "2025-06-01", [
  { id: "a", countryCode: "FR", city: "Paris", lat: 48.85, lon: 2.35 }, { id: "b", countryCode: "IT", city: "Rome", lat: 41.89, lon: 12.48 }, { id: "c", countryCode: "MT" },
]);
const JAPAN = trip("japan", "2027-04-01", [{ id: "d", countryCode: "JP", city: "Kyoto", lat: 35.01, lon: 135.77 }]);
const FRANCE_AGAIN = trip("france-again", "2026-12-20", [{ id: "e", countryCode: "FR" }]);

function draw(trips: StoredTrip[], props: Partial<Parameters<typeof TravelMap>[0]> = {}) {
  const onCountry = vi.fn();
  const r = render(<ThemeProvider><TravelMap world={WORLD} trips={trips} today={TODAY} onCountry={onCountry} {...props} /></ThemeProvider>);
  const svg = r.container.querySelector("svg")!;
  return { onCountry, svg, shape: (code: string) => svg.querySelector(`path[data-code="${code}"]`) as SVGPathElement | null, dot: (code: string) => svg.querySelector(`circle[data-dot="${code}"]`) as SVGCircleElement | null };
}
const viewBox = (svg: SVGSVGElement) => svg.getAttribute("viewBox")!.split(" ").map(Number);

describe("the map", () => {
  it("draws every shape; visited ones are filled with an ink outline, planned-only ones have a dashed brass one; the rest none", () => {
    const { svg, shape } = draw([EUROPE, JAPAN, FRANCE_AGAIN]);
    expect(svg.querySelectorAll("path[data-shape]")).toHaveLength(177);
    const brass = THEMES.ivory.brass.toLowerCase();
    for (const code of ["FR", "IT"]) { // France: a past trip and a planned one, so visited
      expect(shape(code)!.getAttribute("data-state"), code).toBe("visited");
      expect(shape(code)!.getAttribute("fill")).toBe(THEMES.ivory.brass70); // the design pass's strong fill
      expect(shape(code)!.getAttribute("stroke")).toBe(THEMES.ivory.ink);
      expect(shape(code)!.getAttribute("stroke-dasharray")).toBeNull();
    }
    expect(shape("JP")!.getAttribute("data-state")).toBe("planned");
    expect(shape("JP")!.getAttribute("stroke")!.toLowerCase()).toBe(brass);
    expect(shape("JP")!.getAttribute("stroke-dasharray")).toBeTruthy();
    expect(shape("JP")!.getAttribute("fill")).toBe(THEMES.ivory.panelSoft); // no brass fill
    expect(shape("DE")!.getAttribute("data-state")).toBe("none");
  });

  it("a visited small country is a brass dot; the image is hidden from screen readers", () => {
    const { svg, dot } = draw([EUROPE]);
    expect(dot("MT")!.getAttribute("data-state")).toBe("visited");
    expect(dot("SG")!.getAttribute("data-state")).toBe("none");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
  });

  it("a city marker per place with a point: jade with an ink halo; a planned one hollow and dashed", () => {
    const { svg } = draw([EUROPE, JAPAN]);
    const paris = svg.querySelector('circle[data-city="Paris"]')!, kyoto = svg.querySelector('circle[data-city="Kyoto"]')!;
    expect(paris.getAttribute("fill")).toBe(THEMES.ivory.jade);
    expect(paris.getAttribute("stroke")).toBe(THEMES.ivory.ink);
    expect(kyoto.getAttribute("fill")).toBe("none");
    expect(kyoto.getAttribute("stroke")).toBe(THEMES.ivory.jade);
    expect(kyoto.getAttribute("stroke-dasharray")).toBeTruthy();
  });

  it("tapping a country, or a small country's tap area, names it; shapes no trip can name do nothing", () => {
    const { svg, shape, onCountry } = draw([EUROPE]);
    fireEvent.click(shape("FR")!);
    fireEvent.click(svg.querySelector('circle[data-hit="MT"]')!);
    for (const p of svg.querySelectorAll("path[data-shape]:not([data-code])")) fireEvent.click(p);
    expect(onCountry.mock.calls).toEqual([["FR"], ["MT"]]);
  });

  it("a small country's tap area is 44 px across at the map's drawn width", () => {
    vi.spyOn(SVGSVGElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 480, height: 233, right: 480, bottom: 233, x: 0, y: 0, toJSON: () => ({}) });
    const { svg } = draw([EUROPE]);
    const r = Number(svg.querySelector('circle[data-hit="MT"]')!.getAttribute("r"));
    expect(r * 2 * (480 / viewBox(svg)[2])).toBeCloseTo(44, 0);
  });

  it("zooms in and out with \"+\" and \"−\" (read \"Zoom in\" / \"Zoom out\"), never past the whole world", () => {
    const { svg } = draw([EUROPE]);
    const whole = viewBox(svg);
    expect(whole).toEqual([0, 0, WORLD.width, WORLD.height]);
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(viewBox(svg)[2]).toBeCloseTo(WORLD.width / 2);
    expect(screen.getByRole("button", { name: "Zoom in" }).textContent).toBe("+");
    expect(screen.getByRole("button", { name: "Zoom out" }).textContent).toBe("−");
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(viewBox(svg)).toEqual(whole);
  });

  it("\"Show my countries\" fits the view to the visited and planned countries, keeping the map's shape", () => {
    const { svg } = draw([EUROPE]);
    fireEvent.click(screen.getByRole("button", { name: "Show my countries" }));
    const [x, y, w, h] = viewBox(svg);
    const [px, py] = WORLD.project(2.35, 48.85), [vx, vy] = WORLD.project(14.51, 35.9);
    for (const [a, b] of [[px, py], [vx, vy]]) expect(a >= x && a <= x + w && b >= y && b <= y + h).toBe(true);
    expect(w).toBeLessThan(WORLD.width * 0.2);
    expect(w / h).toBeCloseTo(WORLD.width / WORLD.height, 2);
  });

  it("drags to move the view, and a drag isn't a tap", () => {
    vi.spyOn(SVGSVGElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 480, height: 233, right: 480, bottom: 233, x: 0, y: 0, toJSON: () => ({}) });
    const { svg, shape, onCountry } = draw([EUROPE]);
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    const before = viewBox(svg);
    fireEvent.pointerDown(shape("FR")!, { clientX: 200, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(svg, { clientX: 260, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(svg, { clientX: 260, clientY: 100, pointerId: 1 });
    fireEvent.click(shape("FR")!);
    expect(viewBox(svg)[0]).toBeCloseTo(before[0] - 60 * (before[2] / 480));
    expect(onCountry).not.toHaveBeenCalled();
  });
});

// WCAG 1.4.11: what carries the meaning reaches 3:1 against what's next to it. Since the design pass the
// visited fill is strong (brass70) and carries meaning itself; its contrast is in map-design.test.tsx.
// Here: the planned dashed brass outline on land and on the sea, and the jade markers on unvisited land.
describe.each(Object.keys(THEMES) as ThemeKey[])("map contrast, %s", (key) => {
  const t = THEMES[key];
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const ch = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  const lum = ([r, g, b]: number[]) => 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
  const ratio = (a: number[], b: number[]) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const over = (fg: number[], a: number, bg: number[]) => fg.map((c, i) => Math.round(c * a + bg[i] * (1 - a)));
  const land = rgb(t.panelSoft), sea = rgb(t.ink), fill = over(rgb(t.brass), 0xb0 / 255, land);
  it("the planned brass outline on land and on the sea; the jade markers on unvisited land; the ink outline on the visited fill", () => {
    const pairs: [string, number][] = [
      ["brass on land", ratio(rgb(t.brass), land)], ["brass on sea", ratio(rgb(t.brass), sea)],
      ["jade on land", ratio(rgb(t.jade), land)], ["ink on the visited fill", ratio(rgb(t.ink), fill)],
    ];
    expect(pairs.filter(([, r]) => r < 3).map(([p, r]) => `${p} ${r.toFixed(2)}`)).toEqual([]);
  });
});

describe("the panel that loads the map", () => {
  const serve = (ok = true) => {
    const fetch = vi.fn(async (url: string) => (ok ? new Response(JSON.stringify(url.endsWith("countries-110m.json") ? TOPO : LIST)) : new Response("down", { status: 503 })));
    vi.stubGlobal("fetch", fetch);
    return fetch;
  };
  const panel = (trips: StoredTrip[], onAddTrip = vi.fn()) =>
    render(<ThemeProvider><MapPanel trips={trips} today={TODAY} onAddTrip={onAddTrip} onShowTrip={vi.fn()} /></ThemeProvider>);

  it("no trip has a country: the approved empty state, \"Add a trip\", and nothing fetched", () => {
    const fetch = serve();
    const onAddTrip = vi.fn();
    panel([trip("budget-only", "2026-01-01", [])], onAddTrip);
    expect(screen.getByText("Your travel map. Add a trip with the countries and cities you visited and they'll appear here. The map is drawn on your device; your places aren't sent to any map service.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add a trip" }));
    expect(onAddTrip).toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("draws the map once its files arrive", async () => {
    serve();
    const { container } = panel([EUROPE]);
    expect(container.querySelector("[data-map-placeholder]")).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Show my countries" })).toBeTruthy();
    expect(container.querySelectorAll("path[data-shape]")).toHaveLength(177);
  });

  it("past 10 seconds, says it's still loading", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    panel([EUROPE]);
    expect(screen.queryByText("Still loading the map…")).toBeNull();
    await act(async () => { vi.advanceTimersByTime(10_000); });
    expect(screen.getByText("Still loading the map…")).toBeTruthy();
  });

  it("failing, says so in the approved words, and \"Try again\" asks again", async () => {
    const fetch = serve(false);
    panel([EUROPE]);
    expect(await screen.findByText("Couldn't load the map. Your trips are safe. They're all in the list.")).toBeTruthy();
    serve(true);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: "Show my countries" })).toBeTruthy();
    expect(fetch).toHaveBeenCalled();
    expect(within(document.body).queryByText(/Couldn't load the map/)).toBeNull();
  });
});
