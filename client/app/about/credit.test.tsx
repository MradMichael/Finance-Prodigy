// Travel map plan, Phase 1b (wording APPROVED, owner 2026-11-05): the About
// page credits the map and place data. GeoNames' licence (CC BY 4.0) requires
// the credit; Natural Earth is public domain, credited as a courtesy. Two
// links, as the owner asked: "geonames.org" to the site, "Creative Commons
// Attribution 4.0" to the licence. Underlined, not told apart by colour alone
// (A11Y-08), and sending no referrer.
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }) }));
import AboutPage from "./page";
import { ThemeProvider } from "../../contexts/ThemeContext";

afterEach(cleanup);
const section = () => {
  render(<ThemeProvider><AboutPage /></ThemeProvider>);
  return within(screen.getByRole("heading", { name: "Map and place data" }).closest("section")!);
};

it("credits the map and place data in the approved words", () => {
  const s = section();
  expect(s.getByText((_, el) => el?.tagName === "P" && el.textContent ===
    "Country shapes: Natural Earth (public domain), via world-atlas. City names and locations: GeoNames (geonames.org), licensed under Creative Commons Attribution 4.0.")).toBeTruthy();
});

it("links geonames.org to the site and the licence to its page, underlined, with no referrer", () => {
  const s = section();
  const site = s.getByRole("link", { name: "geonames.org" });
  const licence = s.getByRole("link", { name: "Creative Commons Attribution 4.0" });
  expect(site.getAttribute("href")).toBe("https://www.geonames.org/");
  expect(licence.getAttribute("href")).toBe("https://creativecommons.org/licenses/by/4.0/");
  for (const a of [site, licence]) {
    expect(a.className).toContain("underline");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
  }
});
