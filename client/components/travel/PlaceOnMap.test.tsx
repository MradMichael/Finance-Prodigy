// Travel map plan, Phase 1c (owner-approved, D14; wording APPROVED): "Place on
// map" for a typed city the list doesn't hold.
//   - Such a row reads the 1c line: "Not in the list. It'll be saved as you
//     typed it. Use Place on map to show it on the map." and has "Place on map".
//   - It opens the map fitted to the row's country, "Tap the map where
//     <city> is." and "Cancel". A tap is the city's point (WGS84, 2 decimals),
//     checked by buildTrip as any point is.
//   - A city picked from the list has its point already: no button.
//   - The picker's map is a dynamic import: StopFields never imports it.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import TripsScreen from "../screens/TripsScreen";
import { ThemeProvider } from "../../contexts/ThemeContext";
import { DEFAULT_DATA, type LocalFinancials } from "../../lib/localData";
import { forgetCities, type CityRow } from "../../lib/places";
import { forgetWorld } from "../../lib/worldMap";

const geo = (f: string) => readFileSync(join(__dirname, "..", "..", "public", "geo", f), "utf8");
const TOPO = geo("countries-110m.json"), LIST = geo("countries.json");
const ROWS: CityRow[] = [["Beirut", "LB", 33.89, 35.49], ["Zahlé", "LB", 33.85, 35.9]];
const CITIES = JSON.stringify({ fields: ["name", "country", "lat", "lon"], source: "GeoNames cities15000, 2026-11-04, CC BY 4.0", rows: ROWS });
function serve({ cities = true } = {}) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => (url.endsWith("cities15000.json") ? (cities ? new Response(CITIES) : new Response("x", { status: 503 })) : new Response(url.endsWith("countries-110m.json") ? TOPO : LIST))));
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); forgetCities(); forgetWorld(); });

const form = () => within(screen.getByRole("form", { name: "New trip" }));
function start() {
  const onChange = vi.fn();
  render(<ThemeProvider><TripsScreen financials={{ ...DEFAULT_DATA, lbpRate: 89_500, lbpRateHistory: [], transactions: [], trips: [] } as LocalFinancials} onChange={onChange} /></ThemeProvider>);
  const f = form();
  for (const [id, v] of [["trip-start", "2025-06-01"], ["trip-end", "2025-06-05"]]) fireEvent.change(f.getByTestId(id).querySelector('input[type="date"]')!, { target: { value: v } });
  fireEvent.click(f.getByRole("button", { name: "Add a country" }));
  fireEvent.change(f.getByLabelText("Country"), { target: { value: "leb" } });
  fireEvent.click(f.getByRole("button", { name: "Lebanon" }));
  fireEvent.click(f.getByRole("button", { name: "Add a city" }));
  return { onChange, written: () => onChange.mock.calls.at(-1)![0] as LocalFinancials };
}
const type = (name: string) => fireEvent.change(form().getByLabelText("City"), { target: { value: name } });
const save = () => fireEvent.click(form().getByRole("button", { name: "Save trip" }));
/** A tap in the middle of the drawn map (mocked to 480 × 234 px). */
async function tapMiddle() {
  vi.spyOn(SVGSVGElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 480, height: 234, right: 480, bottom: 234, x: 0, y: 0, toJSON: () => ({}) });
  const svg = await screen.findByTestId("place-map").then((el) => el.querySelector("svg")!);
  fireEvent.click(svg, { clientX: 240, clientY: 117 });
}

describe("Place on map", () => {
  it("a typed city not in the list: the 1c line, and \"Place on map\"", async () => {
    serve();
    start();
    type("Batroun");
    expect(await form().findByText("Not in the list. It'll be saved as you typed it. Use Place on map to show it on the map.")).toBeTruthy();
    expect(form().getByRole("button", { name: "Place on map" })).toBeTruthy();
    expect(form().queryByText(/but won't appear on the map/)).toBeNull();
  });

  it("opens the map on the country, \"Tap the map where Batroun is.\"; a tap there is the city's point, saved", async () => {
    serve();
    const { written } = start();
    type("Batroun");
    fireEvent.click(await form().findByRole("button", { name: "Place on map" }));
    expect(form().getByText("Tap the map where Batroun is.")).toBeTruthy();
    expect(form().getByRole("button", { name: "Cancel" })).toBeTruthy();
    await tapMiddle();
    expect(form().queryByText("Tap the map where Batroun is.")).toBeNull(); // the picker closes
    expect(form().queryByText(/^Not in the list/)).toBeNull(); // it will be on the map now
    save();
    const s = written().trips![0].stops![0];
    expect(s).toMatchObject({ countryCode: "LB", city: "Batroun" });
    expect(s.lat! > 33 && s.lat! < 34.8 && s.lon! > 35 && s.lon! < 36.8, `${s.lat},${s.lon}`).toBe(true); // in Lebanon: the map opened on it
    expect(Math.round(s.lat! * 100) / 100).toBe(s.lat);
    expect(Math.round(s.lon! * 100) / 100).toBe(s.lon);
  });

  it("a placed city keeps its point when its name is corrected, and can be placed again", async () => {
    serve();
    const { written } = start();
    type("Batrun");
    fireEvent.click(await form().findByRole("button", { name: "Place on map" }));
    await tapMiddle();
    type("Batroun");
    expect(form().getByRole("button", { name: "Place on map" })).toBeTruthy();
    save();
    expect(written().trips![0].stops![0]).toMatchObject({ city: "Batroun", lat: expect.any(Number), lon: expect.any(Number) });
  });

  it("\"Cancel\" closes it and leaves no point", async () => {
    serve();
    const { written } = start();
    type("Batroun");
    fireEvent.click(await form().findByRole("button", { name: "Place on map" }));
    fireEvent.click(form().getByRole("button", { name: "Cancel" }));
    expect(form().queryByText("Tap the map where Batroun is.")).toBeNull();
    save();
    expect(written().trips![0].stops![0]).toEqual({ id: expect.any(String), countryCode: "LB", city: "Batroun" });
  });

  it("a city from the list has its point: no button", async () => {
    serve();
    start();
    type("zahle");
    await form().findByRole("button", { name: "Zahlé" });
    expect(form().queryByRole("button", { name: "Place on map" })).toBeNull();
  });

  it("with no city list (it couldn't load), a typed city can still be placed", async () => {
    serve({ cities: false });
    start();
    await form().findByText("The city list couldn't load. You can still type a city.");
    type("Batroun");
    expect(form().getByRole("button", { name: "Place on map" })).toBeTruthy();
  });
});

it("StopFields loads the picker's map only by a dynamic import", () => {
  const src = readFileSync(join(__dirname, "StopFields.tsx"), "utf8");
  const statics = [...src.matchAll(/^import[^;]*from\s+"([^"]+)"/gm)].map((m) => m[1]);
  expect(statics.filter((p) => /TravelMap|PlacePicker|MapPanel|worldMap|d3-geo|topojson/.test(p))).toEqual([]);
  expect(src).toContain('import("./PlacePicker")');
});
