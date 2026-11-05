// A1 (app readiness, owner-approved 2026-11-05): on a touch screen, every typing field and select is
// at least 16 px. iOS Safari zooms the page in when a focused field's text is smaller than that, and
// a 375 px sweep found 30 distinct fields at 14 px across 11 screens (FocusInput's text-sm and others).
// Set once in globals.css for a coarse pointer, so the desktop layout keeps its smaller text. It needs
// !important: Tailwind's text-sm is a class, which outranks a plain element selector. The rendered size
// is measured live (a phone-sized Playwright sweep), not here: jsdom applies no stylesheet.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const css = fs.readFileSync(path.join(__dirname, "../app/globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** The body of the first `@media (pointer: coarse)` block, braces balanced. */
function coarseBlock(): string | null {
  const start = css.search(/@media\s*\(pointer:\s*coarse\)\s*\{/);
  if (start < 0) return null;
  let i = css.indexOf("{", start) + 1;
  const from = i;
  for (let depth = 1; depth > 0 && i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") depth--;
  }
  return css.slice(from, i - 1);
}

describe("A1: 16 px fields on a touch screen", () => {
  it("globals.css has a block for a coarse pointer", () => {
    expect(coarseBlock()).not.toBeNull();
  });

  it("that block sets every typing field, select and textarea to 16 px, overriding size classes", () => {
    const rule = coarseBlock()!.match(/([^{}]+)\{\s*font-size:\s*16px\s*!important;\s*\}/);
    expect(rule).not.toBeNull();
    for (const sel of ["select", "textarea", 'input:not([type="hidden"]):not([type="range"]):not([type="checkbox"]):not([type="radio"])']) {
      expect(rule![1]).toContain(sel);
    }
  });

  it("the 16 px rule lives only in the touch block: nothing outside it sets field text to 16 px", () => {
    const outside = css.replace(coarseBlock() ?? "", "");
    expect(outside).not.toMatch(/font-size:\s*16px/);
  });
});
