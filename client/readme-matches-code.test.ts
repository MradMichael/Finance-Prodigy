// Review fix 4 (owner, 2026-11-10): three README statements had drifted from
// the code. Each is checked against the file that decides it, so the next
// drift fails here (as lib/comments-match-code.test.ts does for comments):
//   1. The Next.js version is client/package.json's.
//   2. The analytics warehouse: server/src/routes/sync.ts no longer writes it
//      (2.4.132), so the README must not say every push fills it.
//   3. Why the backup copy isn't encrypted: the README gives the reason the
//      Security page gives (a second device has its own key), not the old one
//      (the analytics decomposition reading field values).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (...p: string[]) => readFileSync(join(__dirname, ...p), "utf8");
const README = read("..", "README.md");
const flat = (s: string) => s.replace(/\s+/g, " ");

describe("the README matches the code", () => {
  it("names the Next.js version the client depends on", () => {
    const major = /(\d+)\./.exec(JSON.parse(read("package.json")).dependencies.next)![1];
    const named = [...README.matchAll(/Next\.js (\d+)/g)].map((m) => m[1]);
    expect(named.length).toBeGreaterThan(0);
    expect([...new Set(named)]).toEqual([major]);
  });

  it("doesn't say sync pushes fill the analytics warehouse, since the server no longer writes it", () => {
    const sync = read("..", "server", "src", "routes", "sync.ts");
    const calls = sync.split("\n").filter((l) => /normalizeToTables\(/.test(l) && !/^\s*(\/\/|\*)/.test(l));
    expect(calls).toEqual([]); // premise: the push handler doesn't call it (2.4.132)
    expect(flat(README)).not.toMatch(/every push also|fires-and-forgets|on every push/);
    expect(flat(README)).toMatch(/no longer written/);
  });

  it("gives the Security page's reason the backup copy isn't encrypted", () => {
    const reason = "generates its own independent key";
    expect(flat(read("app", "security", "page.tsx"))).toContain(reason); // premise: the page's wording
    expect(flat(README)).toContain(reason);
    expect(flat(README)).not.toMatch(/because the analytics decomposition/);
  });
});
