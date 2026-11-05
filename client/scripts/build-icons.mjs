// PWA P1 (owner-approved, 2026-11-05): writes the maskable icons, public/icon-maskable-{192,512}.png, from
// public/icon-512.png. Android crops a maskable icon to its own shape and only promises the central circle of
// 80% of the width; icon-512.png's brass tile reaches 14% from each edge, so it is drawn at 85% on an ink square
// (its farthest tile corner then sits about 36% from the centre). Built from the PNG, not app/icon.svg, so the
// "E" stays the same glyph as every other icon (the SVG names Georgia, which a build machine may not have).
// Run by hand when icon-512.png changes, and commit the output (pwa-icons.test.ts checks it):
//   node client/scripts/build-icons.mjs
// Uses the Playwright that is already installed on the machine running it; nothing is added to the app.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const INK = "#0B1F1E";
export const SCALE = 0.85;
export const SIZES = [192, 512];

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "public", "icon-512.png")).toString("base64");
const { chromium } = createRequire(import.meta.url)("playwright");

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  for (const size of SIZES) {
    const dataUrl = await page.evaluate(async ({ src, size, scale, ink }) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = c.height = size;
      const g = c.getContext("2d");
      g.fillStyle = ink;
      g.fillRect(0, 0, size, size);
      g.imageSmoothingQuality = "high";
      const d = size * scale, o = (size - d) / 2;
      g.drawImage(img, o, o, d, d);
      return c.toDataURL("image/png");
    }, { src: `data:image/png;base64,${source}`, size, scale: SCALE, ink: INK });
    const out = path.join(root, "public", `icon-maskable-${size}.png`);
    fs.writeFileSync(out, Buffer.from(dataUrl.split(",")[1], "base64"));
    console.log(`wrote ${path.relative(root, out)}`);
  }
} finally {
  await browser.close();
}
