// Travel map plan, Phase 1c: the map at 375 px, no sideways scroll (brief §5:
// "Design at 375px first ... No horizontal scrolling"). jsdom has no layout, so
// this pins the classes and styles that keep it inside the screen, as
// components/phone-layout.test.tsx does: the map is the screen's width and
// clips to its box; the country lists and the sheet's lines wrap; the phone's
// sheet spans the screen edge to edge; and nothing new sets a width a phone
// can't hold. A pin: it passes on today's code. The real check is the owner's
// live check on a phone (docs/plans/travel.md).
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import MapPanel from "./MapPanel";
import { ThemeProvider } from "../../contexts/ThemeContext";
import { forgetWorld } from "../../lib/worldMap";
import type { StoredTrip } from "../../lib/trips";

const geo = (f: string) => readFileSync(join(__dirname, "..", "..", "public", "geo", f), "utf8");
const TOPO = geo("countries-110m.json"), LIST = geo("countries.json");
afterEach(() => { cleanup(); vi.unstubAllGlobals(); forgetWorld(); });
const EUROPE: StoredTrip = { id: "eu", name: "A long trip name that a phone has to wrap across lines", startDate: "2025-06-01", endDate: "2025-06-20", budgetUSD: 0,
  stops: ["FR", "IT", "MT", "DE", "ES", "PT", "NL", "BE", "CH", "AT", "GR", "HR"].map((c, i) => ({ id: `s${i}`, countryCode: c, city: `A city with a long name ${i}` })),
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };

it("at 375 px the map, its lists and a country's sheet stay inside the screen", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(url.endsWith("countries-110m.json") ? TOPO : LIST)));
  const { container } = render(<ThemeProvider><MapPanel trips={[EUROPE]} today="2026-11-05" onAddTrip={vi.fn()} onShowTrip={vi.fn()} /></ThemeProvider>);
  await screen.findByRole("button", { name: "Show my countries" });
  const box = container.querySelector("svg")!.parentElement!;
  expect(box.className).toMatch(/\bw-full\b/);
  expect(box.className).toMatch(/\boverflow-hidden\b/);
  const visited = screen.getByRole("heading", { name: "Countries visited (12)" }).nextElementSibling!;
  expect(visited.className).toMatch(/\bflex-wrap\b/);
  fireEvent.click(within(visited as HTMLElement).getByRole("button", { name: "France" }));
  const sheet = screen.getByRole("dialog", { name: "France" });
  expect(sheet.className).toMatch(/\bfixed\b/);
  expect(sheet.className).toMatch(/\binset-x-0\b/); // the phone sheet is the screen's width, never wider
  expect(sheet.className).toMatch(/\boverflow-y-auto\b/);
  for (const el of [container, sheet].flatMap((r) => [r, ...r.querySelectorAll<HTMLElement>("*")])) {
    const w = parseFloat(el.style?.width || el.style?.minWidth || "0");
    expect(w <= 375 || el.style.width.endsWith("%"), `${el.tagName} width ${el.style.width || el.style.minWidth}`).toBe(true);
    expect(el.getAttribute("class") ?? "", el.tagName).not.toMatch(/\b(w|min-w)-\[(3[8-9]\d|[4-9]\d\d|\d{4,})px\]/);
  }
});
