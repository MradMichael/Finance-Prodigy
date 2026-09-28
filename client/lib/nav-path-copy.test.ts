// Copy that names a navigation path has to match the nav.
//
// Four sentences described a layout the app no longer has. The Budget
// screen's "My Finances → Setup" was written on 2026-07-05 in the same
// commit (75551b4) that split Setup out into its own screen — the copy moved
// with the component and kept describing where it used to be. Nothing checks
// copy against the nav, so it stayed wrong for twelve weeks.
//
// This fence reads the nav from `NAV` itself, so a future rename or split is
// checked against the real list rather than against a copy of it here.
//
// WHAT IT CATCHES: one nav screen written as if it lived inside another
// ("My Finances → Setup", "Profile → …" is not a nav screen and is fine),
// and monthly income placed anywhere but Setup.
// WHAT IT CANNOT CATCH (2.4.116): a path into a screen's own tabs or
// sections ("Manage → Transfer", "Profile → Danger zone"). Those are checked
// by hand in audit 2.4.149, because the tab and section names live in JSX
// labels, not in one list a test can read.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { NAV } from "../components/screens/shared";

const ROOTS = ["components", "app"].map((r) => join(__dirname, "..", r));
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });
}
const FILES = ROOTS.flatMap(sources);
const labels = NAV.map((n) => n.label);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

describe("copy that names a navigation path", () => {
  it("the premise: the scan actually reads the app's source", () => {
    expect(FILES.length).toBeGreaterThan(40);
    expect(labels).toContain("Setup");
    expect(labels).toContain("My Finances");
  });

  it("never writes one nav screen as nested inside another", () => {
    const pair = new RegExp(`(${labels.map(esc).join("|")})\\s*(?:→|&rarr;)\\s*(${labels.map(esc).join("|")})\\b`, "g");
    const hits = FILES.flatMap((f) =>
      [...readFileSync(f, "utf-8").matchAll(pair)].map((m) => `${f.split(/[\\/]client[\\/]/)[1]}: ${m[0]}`));
    expect(hits).toEqual([]);
  });

  it("places monthly income in Setup, where it is actually edited", () => {
    const wrong = /monthly income in (?!<strong[^>]*>Setup|Setup)/i;
    const hits = FILES.filter((f) => wrong.test(readFileSync(f, "utf-8")));
    expect(hits).toEqual([]);
  });
});
