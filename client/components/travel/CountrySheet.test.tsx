// Travel map plan, Phase 1c (owner-approved; wording APPROVED 2026-11-05):
// under the map, the keyboard and screen-reader route to it.
//   - "Countries visited (N)": N counts visited countries only (owner).
//   - "Planned (N)": below it, the countries with only planned trips, by name
//     (owner); a country with a past and a planned trip is under visited only.
//   - Tapping a country, on the map or in a list, opens its sheet: the
//     country's name, its trips newest first, each with its dates
//     (DD/MM/YYYY – DD/MM/YYYY), its cities there, and "Planned" for a planned
//     trip. Tapping a trip shows its card in the List. "✕" (read "Close") or
//     Escape closes it.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import MapPanel from "./MapPanel";
import { ThemeProvider } from "../../contexts/ThemeContext";
import { forgetWorld } from "../../lib/worldMap";
import type { StoredTrip, TripStop } from "../../lib/trips";

const read = (f: string) => readFileSync(join(__dirname, "..", "..", "public", "geo", f), "utf8");
const TOPO = read("countries-110m.json"), LIST = read("countries.json");
afterEach(() => { cleanup(); vi.unstubAllGlobals(); forgetWorld(); });

const TODAY = "2026-11-05";
const trip = (id: string, name: string, startDate: string, endDate: string, stops: TripStop[]): StoredTrip =>
  ({ id, name, startDate, endDate, budgetUSD: 0, stops, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
const EUROPE = trip("europe", "Europe", "2025-06-01", "2025-06-20", [
  { id: "a", countryCode: "FR", city: "Paris", lat: 48.85, lon: 2.35 }, { id: "b", countryCode: "IT", city: "Rome" }, { id: "c", countryCode: "FR", city: "Lyon" }, { id: "d", countryCode: "MT" },
]);
const WINTER = trip("winter", "Winter in Paris", "2026-12-20", "2026-12-28", [{ id: "e", countryCode: "FR", city: "Paris", lat: 48.85, lon: 2.35 }]);
const JAPAN = trip("japan", "Japan", "2027-04-01", "2027-04-14", [{ id: "f", countryCode: "JP", city: "Kyoto" }]);

async function open(trips: StoredTrip[]) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(url.endsWith("countries-110m.json") ? TOPO : LIST)));
  const onShowTrip = vi.fn();
  const r = render(<ThemeProvider><MapPanel trips={trips} today={TODAY} onAddTrip={vi.fn()} onShowTrip={onShowTrip} /></ThemeProvider>);
  await screen.findByRole("button", { name: "Show my countries" });
  return { onShowTrip, container: r.container };
}
const listUnder = (heading: string) => within(screen.getByRole("heading", { name: heading }).nextElementSibling as HTMLElement);
const sheet = (country: string) => within(screen.getByRole("dialog", { name: country }));

describe("the country lists under the map", () => {
  it("\"Countries visited (N)\" counts visited countries; \"Planned (N)\" lists the planned-only ones by name", async () => {
    await open([EUROPE, WINTER, JAPAN]);
    expect(listUnder("Countries visited (3)").getAllByRole("button").map((b) => b.textContent)).toEqual(["France", "Italy", "Malta"]);
    expect(listUnder("Planned (1)").getAllByRole("button").map((b) => b.textContent)).toEqual(["Japan"]);
  });

  it("no planned-only country: no \"Planned\" heading", async () => {
    await open([EUROPE, WINTER]);
    expect(screen.getByRole("heading", { name: "Countries visited (3)" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /^Planned/ })).toBeNull();
  });

  // Design pass, 6 (owner): "Countries visited (0)" is hidden.
  it("only planned trips: no \"Countries visited\" heading, and the countries under \"Planned\"", async () => {
    await open([JAPAN]);
    expect(screen.queryByRole("heading", { name: /^Countries visited/ })).toBeNull();
    expect(listUnder("Planned (1)").getByRole("button", { name: "Japan" })).toBeTruthy();
  });
});

describe("a country's sheet", () => {
  it("opens from the list: the country's trips newest first, dates, cities there, and \"Planned\" on a planned trip", async () => {
    await open([EUROPE, WINTER, JAPAN]);
    fireEvent.click(listUnder("Countries visited (3)").getByRole("button", { name: "France" }));
    const s = sheet("France");
    expect(s.getByRole("heading", { name: "France" })).toBeTruthy();
    const items = s.getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toEqual([
      "Winter in Paris20/12/2026 – 28/12/2026PlannedParis",
      "Europe01/06/2025 – 20/06/2025Paris, Lyon",
    ]);
  });

  it("opens from the map too, the same sheet", async () => {
    const { container } = await open([EUROPE]);
    fireEvent.click(container.querySelector('path[data-code="IT"]')!);
    expect(sheet("Italy").getByText("Rome")).toBeTruthy();
  });

  it("a small country from its dot: Malta, with no cities", async () => {
    const { container } = await open([EUROPE]);
    fireEvent.click(container.querySelector('circle[data-hit="MT"]')!);
    expect(sheet("Malta").getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Europe01/06/2025 – 20/06/2025"]);
  });

  it("tapping a trip shows its card in the List", async () => {
    const { onShowTrip } = await open([EUROPE]);
    fireEvent.click(listUnder("Countries visited (3)").getByRole("button", { name: "Italy" }));
    fireEvent.click(sheet("Italy").getByRole("button", { name: "Europe" }));
    expect(onShowTrip).toHaveBeenCalledWith("europe");
  });

  it("\"✕\" (read \"Close\") closes it, and so does Escape; its heading takes focus when it opens", async () => {
    await open([EUROPE]);
    fireEvent.click(listUnder("Countries visited (3)").getByRole("button", { name: "France" }));
    expect(document.activeElement?.textContent).toBe("France");
    const close = sheet("France").getByRole("button", { name: "Close" });
    expect(close.textContent).toBe("✕");
    fireEvent.click(close);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(listUnder("Countries visited (3)").getByRole("button", { name: "Malta" }));
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Malta" }), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
