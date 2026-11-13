// R6 (session 51 review): the date field stood 66 px tall on a touch screen beside the 44 px Amount field
// (46 px beside 42 on a desktop). Its three boxes and calendar button each take the tap-size floor (44 px on
// touch, 24 px elsewhere, globals.css), and the field's own padding and border went on top. Now the boxes keep
// their floor and overlap the padding: on touch the field drops its vertical padding and the boxes reach 1 px
// into the border, so each still takes a 44 px tap; elsewhere they reach 2 px into the padding. As with
// touch-screen-targets.test.ts, jsdom applies no stylesheet: the rules are read here and the boxes measured live.
import { it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { render, cleanup } from "@testing-library/react";
import { DateFieldDMY } from "./form/Primitives";

afterEach(cleanup);

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

/** The declarations of the rule whose selector list holds every one of `selectors`, in `scope`. */
function declarations(scope: string, selectors: string[]): string | null {
  for (const m of scope.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const list = m[1].split(",").map((s) => s.trim());
    if (selectors.every((s) => list.includes(s))) return m[2];
  }
  return null;
}

const BOXES = [".dmy-field > input", ".dmy-field > button"];

it("on every pointer, the boxes reach 2 px into the field's padding", () => {
  const outside = css.replace(coarseBlock(), "");
  const d = declarations(outside, BOXES);
  expect(d).not.toBeNull();
  expect(d).toMatch(/margin-top:\s*-2px;/);
  expect(d).toMatch(/margin-bottom:\s*-2px;/);
});

it("on a touch screen, the field has no vertical padding and the boxes reach 1 px into its border", () => {
  const field = declarations(coarseBlock(), [".dmy-field"]);
  expect(field).not.toBeNull();
  expect(field).toMatch(/padding-top:\s*0;/);
  expect(field).toMatch(/padding-bottom:\s*0;/);
  const boxes = declarations(coarseBlock(), BOXES);
  expect(boxes).not.toBeNull();
  expect(boxes).toMatch(/margin-top:\s*-1px;/);
  expect(boxes).toMatch(/margin-bottom:\s*-1px;/);
});

it("the field carries the class, with its three boxes and the calendar button as direct children", () => {
  const { container } = render(<DateFieldDMY value="2026-11-13" onChange={() => {}} />);
  const field = container.querySelector(".dmy-field");
  expect(field).not.toBeNull();
  const kids = Array.from(field!.children);
  expect(kids.filter((k) => k.matches('input[type="text"]'))).toHaveLength(3);
  expect(kids.some((k) => k.matches('button[aria-label="Pick date from calendar"]'))).toBe(true);
});
