// PWA P1 (owner-approved, 2026-11-05): what an iPhone reads when ESSA is added to the home screen.
// title: the name under the icon (Safari would otherwise offer the page title, "ESSA: Earn Spend Save Achieve").
// statusBarStyle "default": the status bar keeps its own background, so its text stays readable on every theme;
// "black-translucent" would draw white text over the page, unreadable on Ivory, the default theme.
import { it, expect } from "vitest";
import { metadata } from "./layout";

it("tells an iPhone the app's home-screen name and a status bar readable on every theme", () => {
  expect(metadata.appleWebApp).toEqual({ capable: true, title: "ESSA", statusBarStyle: "default" });
});

it("keeps the manifest and the apple-touch icon", () => {
  expect(metadata.manifest).toBe("/manifest.webmanifest");
  expect(metadata.icons).toMatchObject({ apple: "/apple-touch-icon.png" });
});
