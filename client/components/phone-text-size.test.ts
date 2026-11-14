// Session 52 (owner, R13; phones only): the smallest text on a touch screen is 10 px, and notes are 11 px.
// The review found 9 px labels, badges and chips (56 on Budget, 54 on My Finances) and explanatory lines at 9
// and 10 px. In the touch block of globals.css: anything at 9 px becomes 10 px, and a note becomes 11 px. A
// note is a sentence line: a <p> at 9 or 10 px that isn't an uppercase label. The desktop layout keeps its sizes.
// As touch-screen-targets.test.ts: jsdom applies no stylesheet, so the rules are read here and the screens are
// measured live.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const css = fs.readFileSync(path.join(__dirname, "../app/globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

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
function declarations(scope: string, selectors: string[]): string | null {
  for (const m of scope.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const list = m[1].split(",").map((s) => s.trim());
    if (list.length === selectors.length && selectors.every((s) => list.includes(s))) return m[2];
  }
  return null;
}

const NINE = [".text-\\[9px\\]"];
const NOTES = ["p.text-\\[9px\\]:not(.uppercase)", "p.text-\\[10px\\]:not(.uppercase)"];

describe("text size on a touch screen", () => {
  it("9 px text becomes 10 px", () => {
    expect(declarations(coarseBlock(), NINE)).toMatch(/font-size:\s*10px;/);
  });

  it("a note (a sentence line at 9 or 10 px, not an uppercase label) becomes 11 px", () => {
    expect(declarations(coarseBlock(), NOTES)).toMatch(/font-size:\s*11px;/);
  });

  it("the note rule comes after the 10 px floor, so a 9 px note ends at 11", () => {
    const block = coarseBlock();
    expect(block.indexOf(NOTES[0])).toBeGreaterThan(block.indexOf(NINE[0] + " {"));
  });

  it("only on a touch screen: nothing outside the touch block resizes them", () => {
    const outside = css.replace(coarseBlock(), "");
    expect(outside).not.toContain(".text-\\[9px\\]");
    expect(outside).not.toContain(".text-\\[10px\\]");
  });
});
