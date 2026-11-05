// A1 (app readiness, owner-approved 2026-11-05): on a touch screen, every control is at least 44 px to tap
// (CLAUDE_CODE_BRIEF.md section 5: "Touch targets are at least 44px"). globals.css already sets a 24 px floor
// everywhere (WCAG 2.2 SC 2.5.8, a11y-targets-dialogs.test.tsx); this raises it to 44 px for a coarse pointer
// only, so the desktop layout is unchanged. Same selectors as the 24 px floor: range inputs, checkboxes and
// radios keep their own sizes. The rendered boxes are measured live (a phone-sized Playwright sweep), not
// here: jsdom applies no stylesheet.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const css = fs.readFileSync(path.join(__dirname, "../app/globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** The body of the first `@media (pointer: coarse)` block, braces balanced. */
function coarseBlock(): string {
  const start = css.search(/@media\s*\(pointer:\s*coarse\)\s*\{/);
  if (start < 0) return "";
  let i = css.indexOf("{", start) + 1;
  const from = i;
  for (let depth = 1; depth > 0 && i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") depth--;
  }
  return css.slice(from, i - 1);
}

const FIELD = 'input:not([type="hidden"]):not([type="range"]):not([type="checkbox"]):not([type="radio"])';

describe("A1: 44 px targets on a touch screen", () => {
  it("the touch block sets min-height 44px on buttons, tabs, switches, selects and fields", () => {
    const rule = coarseBlock().match(/([^{}]+)\{\s*min-height:\s*44px;\s*\}/);
    expect(rule).not.toBeNull();
    for (const sel of ["button", '[role="button"]', '[role="tab"]', '[role="switch"]', "select", FIELD]) expect(rule![1]).toContain(sel);
  });

  it("the touch block sets min-width 44px on buttons, tabs and switches, never on fields", () => {
    const rule = coarseBlock().match(/([^{}]+)\{\s*min-width:\s*44px;\s*\}/);
    expect(rule).not.toBeNull();
    for (const sel of ["button", '[role="button"]', '[role="tab"]', '[role="switch"]']) expect(rule![1]).toContain(sel);
    expect(rule![1]).not.toContain("input");
    expect(rule![1]).not.toContain("select");
  });

  it("the 24 px floor for every pointer is still there, outside the touch block", () => {
    const outside = css.replace(coarseBlock(), "");
    expect(outside).toMatch(/min-height:\s*24px;/);
    expect(outside).toMatch(/min-width:\s*24px;/);
    expect(outside).not.toMatch(/min-(height|width):\s*44px/);
  });
});
