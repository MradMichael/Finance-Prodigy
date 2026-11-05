// PWA P2 (owner-approved, 2026-11-05): the phone's own bars follow the theme. The installed app's status bar
// (Android) is coloured by <meta name="theme-color">, which the layout sets to Ledger ink for the splash
// (owner, Q2); once a theme is known the page sets it to that theme's ink. The body takes the same ink, so the
// strips a landscape notch leaves at the sides (globals.css) and an overscroll show the theme, not white.
import { it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { ThemeProvider, useThemeControl } from "./ThemeContext";
import { THEMES } from "../lib/theme";

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.body.style.background = "";
  document.head.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove());
});

const rgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;
const themeColor = () => Array.from(document.head.querySelectorAll('meta[name="theme-color"]')).map((m) => m.getAttribute("content"));
function Switch() {
  const { setTheme } = useThemeControl();
  return <button onClick={() => setTheme("ivory")}>Ivory</button>;
}

it("updates the layout's theme-color tag to the stored theme's ink, and follows a change", async () => {
  const meta = document.createElement("meta");
  meta.name = "theme-color";
  meta.content = "#0B1F1E";
  document.head.appendChild(meta);
  localStorage.setItem("essa_theme", "midnight");
  render(<ThemeProvider><Switch /></ThemeProvider>);
  await waitFor(() => expect(themeColor()).toEqual([THEMES.midnight.ink]));
  fireEvent.click(screen.getByRole("button", { name: "Ivory" }));
  await waitFor(() => expect(themeColor()).toEqual([THEMES.ivory.ink]));
});

it("adds the tag if the page has none", async () => {
  localStorage.setItem("essa_theme", "ember");
  render(<ThemeProvider><Switch /></ThemeProvider>);
  await waitFor(() => expect(themeColor()).toEqual([THEMES.ember.ink]));
});

// Found in the browser check (production build, 375 px): moving from /sign-up to / client-side, Next re-applied
// the layout's metadata and the tag read Ledger ink again under the Ivory theme. The theme's ink must win back.
it("puts the theme's ink back when Next resets the tag's content on a page change", async () => {
  localStorage.setItem("essa_theme", "midnight");
  render(<ThemeProvider><Switch /></ThemeProvider>);
  await waitFor(() => expect(themeColor()).toEqual([THEMES.midnight.ink]));
  document.head.querySelector('meta[name="theme-color"]')!.setAttribute("content", "#0B1F1E");
  await waitFor(() => expect(themeColor()).toEqual([THEMES.midnight.ink]));
});

it("puts the theme's ink back when Next replaces the tag with a new one", async () => {
  localStorage.setItem("essa_theme", "midnight");
  render(<ThemeProvider><Switch /></ThemeProvider>);
  await waitFor(() => expect(themeColor()).toEqual([THEMES.midnight.ink]));
  document.head.querySelector('meta[name="theme-color"]')!.remove();
  const fresh = document.createElement("meta");
  fresh.name = "theme-color";
  fresh.content = "#0B1F1E";
  document.head.appendChild(fresh);
  await waitFor(() => expect(themeColor()).toEqual([THEMES.midnight.ink]));
});

it("gives the page body the theme's ink", async () => {
  localStorage.setItem("essa_theme", "obsidian");
  render(<ThemeProvider><Switch /></ThemeProvider>);
  await waitFor(() => expect(document.body.style.background).toBe(rgb(THEMES.obsidian.ink)));
  fireEvent.click(screen.getByRole("button", { name: "Ivory" }));
  await waitFor(() => expect(document.body.style.background).toBe(rgb(THEMES.ivory.ink)));
});
