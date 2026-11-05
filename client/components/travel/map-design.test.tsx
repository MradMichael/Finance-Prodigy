// Travel map design pass (owner, 2026-11-05; docs/plans/travel.md). Each
// concern adds its tests here, failing first.
//   1. The map opens fitted to the visited countries (the "Show my countries"
//      view); the whole world only when nothing is visited.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
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
