// PWA P2 (owner-approved, 2026-11-05): an installed ESSA draws to the screen's edges (viewport-fit=cover), so
// anything pinned to the top or bottom of the phone screen must clear the notch, status bar and home indicator.
// Scans every component: a fixed element placed with a mobile (unprefixed) top-/bottom- class carries the
// matching env(safe-area-inset-*) once for each such class (a ternary carries two). md: and wider classes
// are the desktop layout and are left alone. Full-screen overlays (inset-0) need nothing.
import { it, expect } from "vitest";
import fs from "fs";
import path from "path";

const root = process.cwd();
function tsxFiles(dir: string): string[] {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" ? [] : tsxFiles(p);
    return p.endsWith(".tsx") && !p.includes(".test.") ? [p] : [];
  });
}

const pinned = tsxFiles("app").concat(tsxFiles("components")).flatMap((file) =>
  fs.readFileSync(path.join(root, file), "utf8").split("\n").map((line, i) => ({ where: `${file}:${i + 1}`, line }))
    .filter(({ line }) => /\bfixed\b/.test(line) && /(^|[\s"'`])(top|bottom)-/.test(line) && !/\binset-0\b/.test(line)));

const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

// Session 53 (owner): 9 until the save error and the backup notices went into the page's flow below md. In the
// flow they sit under the top bar, which carries the inset itself, so they need none and are no longer scanned.
it("finds the pinned elements it is meant to check", () => {
  expect(pinned.length).toBeGreaterThanOrEqual(7);
});

it("the save error and the backup notices are not pinned below md (they sit in the flow, under the top bar)", () => {
  const page = fs.readFileSync(path.join(root, "app", "page.tsx"), "utf8");
  const save = page.match(/\{saveError && \(\s*<div\s+role="alert"\s+className="([^"]+)"/);
  const place = page.match(/const backupNoticePlace = `([^`]+)`/);
  expect(save).not.toBeNull();
  expect(place).not.toBeNull();
  for (const cls of [save![1], place![1]]) expect(cls).not.toMatch(/(^|[\s"'`])(fixed|top-|bottom-)/);
});

it("every element pinned to the bottom of a phone screen clears the home indicator", () => {
  const short = pinned
    .filter(({ line }) => count(line, /(^|[\s"'`])bottom-/g) > count(line, /env\(safe-area-inset-bottom\)/g))
    .map(({ where }) => where);
  expect(short).toEqual([]);
});

it("every element pinned to the top of a phone screen clears the status bar and notch", () => {
  const short = pinned
    .filter(({ line }) => count(line, /(^|[\s"'`])top-/g) > count(line, /env\(safe-area-inset-top\)/g))
    .map(({ where }) => where);
  expect(short).toEqual([]);
});
