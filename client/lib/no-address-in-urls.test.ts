// 2.4.165: no request the client makes may carry an email address in its URL.
// A URL is written into the hosts' request logs (Vercel's rewrite logs record
// its search params, Render's request logs the whole URL); a request body is
// not. The two requests that did -- pull and check-email -- now POST the
// address. This scans the client's own source, so a new one fails here.
//
// It catches the literal `?email=` / `&email=` form, which is how both were
// written. It would not catch an address added through URLSearchParams; the
// per-request tests in syncService.test.ts check the two routes directly.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// Vitest runs from client/ (locally and in CI). Not import.meta.url: under
// jsdom it is not a file: URL.
const ROOT = process.cwd();

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("no request carries an email address in its URL", () => {
  it("no client source builds a URL with an email query parameter", () => {
    const files = ["lib", "app", "components"].flatMap((d) => sources(join(ROOT, d)));
    expect(files.length).toBeGreaterThan(20); // premise: the scan found the source
    const offenders = files.filter((f) => /[?&]email=/.test(readFileSync(f, "utf8"))).map((f) => relative(ROOT, f));
    expect(offenders).toEqual([]);
  });
});
