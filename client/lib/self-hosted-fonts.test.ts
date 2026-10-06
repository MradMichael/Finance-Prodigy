// PRIV-01 (FB-1c): every page load used to fetch Spectral from Google's CDN,
// telling Google each visitor's IP, browser and current page, while the
// privacy and security pages said nothing is shared with third parties. The
// font is now served from ESSA's own site.
//
// Re-derived before the change: the link asked for weights 400, 600 and 700.
// The app renders 400 (unweighted, and font-medium, which falls back to 400)
// and 600 (font-semibold). 700 was never used and isn't shipped. The two files
// are the latin subset Google served, so rendering is unchanged. SIL OFL 1.1
// permits redistributing them, and its text ships beside them.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

// Vitest runs from client/ (locally and in CI).
const ROOT = process.cwd();

function files(dir: string, ext: RegExp): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path, ext);
    return ext.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("no page loads anything from Google", () => {
  it("no client source, stylesheet or public file names a Google font host", () => {
    const all = [
      ...["app", "components", "lib", "contexts"].flatMap((d) => files(join(ROOT, d), /\.(tsx?|css)$/)),
      ...files(join(ROOT, "public"), /\.(js|mjs|json|webmanifest|html|css)$/),
    ];
    expect(all.length).toBeGreaterThan(20); // premise: the scan found the source
    const offenders = all.filter((f) => /googleapis|gstatic/.test(readFileSync(f, "utf8"))).map((f) => relative(ROOT, f));
    expect(offenders).toEqual([]);
  });
});

describe("Spectral is self-hosted", () => {
  const css = readFileSync(join(ROOT, "app", "globals.css"), "utf8");
  const faces = css.match(/@font-face\s*{[^}]*}/g) ?? [];

  it.each([
    [400, "/fonts/spectral-400-latin-v15.woff2"],
    [600, "/fonts/spectral-600-latin-v15.woff2"],
  ])("weight %i is declared from %s, under the family name the app already uses", (weight, url) => {
    const face = faces.find((f) => new RegExp(`font-weight:\\s*${weight}\\b`).test(f));
    expect(face).toBeTruthy();
    expect(face).toMatch(/font-family:\s*["']Spectral["']/);
    expect(face).toContain(`url("${url}") format("woff2")`);
    expect(face).toMatch(/font-display:\s*swap/);
    // The file really is a woff2 font, not an error page saved by mistake.
    const bytes = readFileSync(join(ROOT, "public", url));
    expect(bytes.subarray(0, 4).toString("latin1")).toBe("wOF2");
    expect(bytes.length).toBeGreaterThan(10_000);
  });

  it("exactly those two weights: 700 was never used", () => {
    expect(faces.filter((f) => /Spectral/.test(f))).toHaveLength(2);
  });

  it("ships with its licence (SIL OFL 1.1)", () => {
    const ofl = join(ROOT, "public", "fonts", "OFL.txt");
    expect(existsSync(ofl)).toBe(true);
    expect(readFileSync(ofl, "utf8")).toContain("SIL Open Font License, Version 1.1");
  });
});
