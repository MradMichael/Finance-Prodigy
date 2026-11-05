// Travel map plan, Phase 1b (owner-approved; wording APPROVED 2026-11-05): the
// trip list grouped by year, newest first (a trip is in the year it starts),
// each card with its countries and cities ("France · Paris, Lyon — Italy ·
// Rome"; a country with no city is its name alone) and its notes.
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import TripsScreen from "./TripsScreen";
import { ThemeProvider } from "../../contexts/ThemeContext";
import { DEFAULT_DATA, type LocalFinancials } from "../../lib/localData";
import type { StoredTrip, TripStop } from "../../lib/trips";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const trip = (id: string, name: string, startDate: string, endDate: string, stops?: TripStop[], notes?: string): StoredTrip =>
  ({ id, name, startDate, endDate, budgetUSD: 0, ...(stops ? { stops } : {}), ...(notes ? { notes } : {}), createdAt: "2026-11-05T09:00:00.000Z", updatedAt: "2026-11-05T09:00:00.000Z" });
const EUROPE = trip("eu", "Europe", "2025-06-01", "2025-06-20", [
  { id: "a", countryCode: "FR", city: "Paris", lat: 48.85, lon: 2.35 }, { id: "b", countryCode: "IT", city: "Rome" },
  { id: "c", countryCode: "FR", city: "Lyon" }, { id: "d", countryCode: "MT" },
], "Night trains between every city");
const NEW_YEAR = trip("ny", "New Year in Beirut", "2025-12-30", "2026-01-03", [{ id: "e", countryCode: "LB", city: "Beirut" }]);
const SPRING = trip("sp", "Spring", "2026-03-01", "2026-03-05");
const OLD = trip("old", "Paris 2023", "2023-04-10", "2023-04-15", [{ id: "f", countryCode: "FR", city: "Paris" }]);
const show = (trips: StoredTrip[]) =>
  render(<ThemeProvider><TripsScreen financials={{ ...DEFAULT_DATA, lbpRate: 89_500, lbpRateHistory: [], transactions: [], trips } as LocalFinancials} onChange={vi.fn()} /></ThemeProvider>);

it("years as headings, newest first, each trip under the year it starts in, newest first", () => {
  show([OLD, EUROPE, SPRING, NEW_YEAR]);
  const order = screen.getAllByRole("heading").filter((h) => ["H2", "H3"].includes(h.tagName)).map((h) => `${h.tagName}:${h.textContent}`);
  expect(order).toEqual(["H2:2026", "H3:Spring", "H2:2025", "H3:New Year in Beirut", "H3:Europe", "H2:2023", "H3:Paris 2023"]);
});

it("a card's countries and cities, grouped by country in the order first visited; a country with no city alone", () => {
  show([EUROPE]);
  expect(within(screen.getByRole("region", { name: "Europe" })).getByText("France · Paris, Lyon — Italy · Rome — Malta")).toBeTruthy();
});

it("a trip without countries has no countries line", () => {
  show([SPRING]);
  expect(within(screen.getByRole("region", { name: "Spring" })).queryByText(/ · |—/)).toBeNull();
});

it("a card shows its notes", () => {
  show([EUROPE]);
  expect(within(screen.getByRole("region", { name: "Europe" })).getByText("Night trains between every city")).toBeTruthy();
});

it("no trips: no year headings, and today's \"No trips yet.\"", () => {
  show([]);
  expect(screen.queryAllByRole("heading").filter((h) => h.tagName === "H2")).toEqual([]);
  expect(screen.getByText("No trips yet.")).toBeTruthy();
});
