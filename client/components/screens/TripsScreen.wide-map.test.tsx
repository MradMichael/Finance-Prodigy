// Travel map design pass, 5 (owner, 2026-11-05): in Map view the map breaks out of Trips' 768 px column to
// the main area's width, capped at max-w-6xl (1,152 px); the header, the toggle and the New trip form keep
// the max-w-3xl column. jsdom has no layout: this pins the structure; the screenshots show the result.
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import TripsScreen from "./TripsScreen";
import { ThemeProvider } from "../../contexts/ThemeContext";
import { DEFAULT_DATA, type LocalFinancials } from "../../lib/localData";
import { forgetWorld } from "../../lib/worldMap";
import type { StoredTrip } from "../../lib/trips";

const geo = (f: string) => readFileSync(join(__dirname, "..", "..", "public", "geo", f), "utf8");
const TOPO = geo("countries-110m.json"), LIST = geo("countries.json");
afterEach(() => { cleanup(); vi.unstubAllGlobals(); forgetWorld(); });
const EUROPE: StoredTrip = { id: "eu", name: "Europe", startDate: "2025-06-01", endDate: "2025-06-20", budgetUSD: 0, stops: [{ id: "a", countryCode: "FR" }], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };

it("Map view: the map in a max-w-6xl block; the header and the New trip form in max-w-3xl ones", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(url.endsWith("countries-110m.json") ? TOPO : LIST)));
  render(<ThemeProvider><TripsScreen financials={{ ...DEFAULT_DATA, lbpRate: 89_500, lbpRateHistory: [], transactions: [], trips: [EUROPE] } as LocalFinancials} onChange={vi.fn()} /></ThemeProvider>);
  const show = await screen.findByRole("button", { name: "Show my countries" });
  const block = (el: Element) => el.closest(".max-w-6xl, .max-w-3xl")!;
  expect(block(show).className).toMatch(/\bmax-w-6xl\b/);
  expect(block(screen.getByRole("heading", { name: "Trips", level: 1 })).className).toMatch(/\bmax-w-3xl\b/);
  expect(block(screen.getByRole("form", { name: "New trip" })).className).toMatch(/\bmax-w-3xl\b/);
});
