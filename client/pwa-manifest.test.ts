// PWA P1 (owner-approved, 2026-11-05): what the installed app is told about itself.
//
// `id` must stay "/": with no id, Chrome identifies an installed app by its start_url, which resolves to "/".
// Writing the same value down keeps every phone that already installed ESSA on the same app; any other value
// would make Chrome treat the next install as a different app. Splash and theme colours are Ledger ink
// (owner, Q2), the icon's own background.
import { it, expect } from "vitest";
import fs from "fs";
import path from "path";

const pub = path.join(process.cwd(), "public");
const manifest = JSON.parse(fs.readFileSync(path.join(pub, "manifest.webmanifest"), "utf8"));
type Icon = { src: string; sizes: string; type: string; purpose?: string };
const icons: Icon[] = manifest.icons;
const pngSize = (file: string) => { const b = fs.readFileSync(file); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };

it("names the app ESSA and opens it standalone at the root", () => {
  expect(manifest.short_name).toBe("ESSA");
  expect(manifest.name).toMatch(/^ESSA/);
  expect(manifest.start_url).toBe("/");
  expect(manifest.display).toBe("standalone");
});

it("keeps the identity installed phones already have, and the whole site in scope", () => {
  expect(manifest.id).toBe("/");
  expect(manifest.scope).toBe("/");
});

it("states its language and direction", () => {
  expect(manifest.lang).toBe("en");
  expect(manifest.dir).toBe("ltr");
});

it("uses Ledger ink for the splash and the theme", () => {
  expect(manifest.background_color).toBe("#0B1F1E");
  expect(manifest.theme_color).toBe("#0B1F1E");
});

it("every icon exists at the size it claims", () => {
  for (const icon of icons) {
    const [w, h] = icon.sizes.split("x").map(Number);
    expect(icon.type).toBe("image/png");
    expect(pngSize(path.join(pub, icon.src))).toEqual([w, h]);
  }
});

it("offers 192 and 512 for both purposes, never the same file for both", () => {
  const any = icons.filter((i) => (i.purpose ?? "any") === "any");
  const maskable = icons.filter((i) => i.purpose === "maskable");
  expect(any.map((i) => i.sizes).sort()).toEqual(["192x192", "512x512"]);
  expect(maskable.map((i) => i.sizes).sort()).toEqual(["192x192", "512x512"]);
  expect(maskable.map((i) => i.src).sort()).toEqual(["/icon-maskable-192.png", "/icon-maskable-512.png"]);
  for (const m of maskable) expect(any.map((i) => i.src)).not.toContain(m.src);
});
