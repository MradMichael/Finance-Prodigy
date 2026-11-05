// Travel map plan, Phase 1c (owner-approved; wording APPROVED 2026-11-05):
// the Trips screen's "Map" | "List" toggle.
//   - Opens on Map once any trip has a country; otherwise on List, as Trips
//     always has (owner, 2026-11-05), with the Map view's empty state a tap away.
//   - The New trip form stays at the bottom in both views.
//   - "Add a trip" (the empty state) puts you in the New trip form's Name.
//   - A trip's name in a country's sheet shows its card: List, focused.
//   - The map's code is loaded only by a dynamic import, when Map opens: the
//     Trips screen's own module never imports it (preloadScreens fetches every
//     screen, so a static import would load the map for everyone).
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import TripsScreen from "./TripsScreen";
import { ThemeProvider } from "../../contexts/ThemeContext";
import { DEFAULT_DATA, type LocalFinancials } from "../../lib/localData";
import { forgetWorld } from "../../lib/worldMap";
import type { StoredTrip } from "../../lib/trips";

const geo = (f: string) => readFileSync(join(__dirname, "..", "..", "public", "geo", f), "utf8");
const TOPO = geo("countries-110m.json"), LIST = geo("countries.json");
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); forgetWorld(); });

const trip = (id: string, name: string, extra: Partial<StoredTrip> = {}): StoredTrip =>
  ({ id, name, startDate: "2025-06-01", endDate: "2025-06-20", budgetUSD: 0, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", ...extra });
const EUROPE = trip("europe", "Europe", { stops: [{ id: "a", countryCode: "FR", city: "Paris", lat: 48.85, lon: 2.35 }, { id: "b", countryCode: "IT" }] });
const BUDGET_ONLY = trip("lisbon", "Lisbon");
function show(trips: StoredTrip[]) {
  const fetch = vi.fn(async (url: string) => new Response(url.endsWith("countries-110m.json") ? TOPO : LIST));
  vi.stubGlobal("fetch", fetch);
  render(<ThemeProvider><TripsScreen financials={{ ...DEFAULT_DATA, lbpRate: 89_500, lbpRateHistory: [], transactions: [], trips } as LocalFinancials} onChange={vi.fn()} /></ThemeProvider>);
  return { fetch };
}
const pressed = (name: string) => screen.getByRole("button", { name }).getAttribute("aria-pressed");

describe("Map or List", () => {
  it("no trip has a country: opens on List, the trips as today; Map shows the empty state", async () => {
    const { fetch } = show([BUDGET_ONLY]);
    expect(pressed("List")).toBe("true");
    expect(pressed("Map")).toBe("false");
    expect(screen.getByRole("region", { name: "Lisbon" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Map" }));
    expect(await screen.findByText(/^Your travel map\./)).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Lisbon" })).toBeNull();
    expect(fetch).not.toHaveBeenCalled(); // no country, so no map files
  });

  it("a trip has a country: opens on Map; List shows the cards", async () => {
    show([EUROPE, BUDGET_ONLY]);
    expect(pressed("Map")).toBe("true");
    expect(await screen.findByRole("heading", { name: "Countries visited (2)" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Europe" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "List" }));
    expect(screen.getByRole("region", { name: "Europe" })).toBeTruthy();
    expect(pressed("List")).toBe("true");
  });

  it("the New trip form is there in both views", async () => {
    show([EUROPE]);
    expect(screen.getByRole("form", { name: "New trip" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "List" }));
    expect(screen.getByRole("form", { name: "New trip" })).toBeTruthy();
  });

  it("\"Add a trip\" puts you in the New trip form's Name", async () => {
    show([]);
    fireEvent.click(screen.getByRole("button", { name: "Map" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add a trip" }));
    expect(document.activeElement).toBe(within(screen.getByRole("form", { name: "New trip" })).getByLabelText("Name"));
  });

  it("a trip's name in a country's sheet shows its card in the List, focused", async () => {
    show([EUROPE]);
    const visited = await screen.findByRole("heading", { name: "Countries visited (2)" });
    fireEvent.click(within(visited.nextElementSibling as HTMLElement).getByRole("button", { name: "France" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "France" })).getByRole("button", { name: "Europe" }));
    expect(pressed("List")).toBe("true");
    const card = screen.getByRole("region", { name: "Europe" });
    expect(card.contains(document.activeElement)).toBe(true);
  });
});

describe("the map's code stays out of the Trips screen's module", () => {
  const src = readFileSync(join(__dirname, "TripsScreen.tsx"), "utf8");
  it("no static import of the map, its geometry or its libraries; one dynamic import of the panel", () => {
    const statics = [...src.matchAll(/^import[^;]*from\s+"([^"]+)"/gm)].map((m) => m[1]);
    expect(statics.filter((p) => /travel\/(MapPanel|TravelMap|CountrySheet)|worldMap|d3-geo|topojson/.test(p))).toEqual([]);
    expect(src).toContain('import("../travel/MapPanel")');
  });
});
