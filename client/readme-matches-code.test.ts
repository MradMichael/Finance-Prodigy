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

  // SEC-04 / R1 (owner, session 56): ESSA_PROXY_KEY was documented in both .env.example files but not in the
  // README's table. Every variable an example file sets has a row naming the file it goes in.
  it("the environment table has a row for every variable the .env.example files set, in the right file", () => {
    const rows = new Map<string, string>();
    for (const m of README.matchAll(/^\| `([A-Z0-9_]+)` \| ([^|]+) \|/gm)) rows.set(m[1], m[2]);
    for (const side of ["server", "client"]) {
      // Item 6 (session 57): commented example lines ("# NAME=…", a variable left unset by default, or one a platform
      // sets) need a row too; the uncommented ones, set by hand, name the file they go in.
      const lines = read("..", side, ".env.example").split("\n");
      const set = lines.map((l) => /^([A-Z0-9_]+)=/.exec(l)?.[1]).filter(Boolean) as string[];
      const commented = lines.map((l) => /^#\s*([A-Z0-9_]+)=/.exec(l)?.[1]).filter(Boolean) as string[];
      expect(set.length, side).toBeGreaterThan(0);
      for (const name of [...set, ...commented]) expect(rows.has(name), `${name} (${side}/.env.example) has no README row`).toBe(true);
      for (const name of set) expect(rows.get(name), name).toContain(`\`${side}/.env\``);
    }
  });

  // Item 6 (owner, session 57): next.config.js reads ESSA_CSP_REPORT_ONLY at build time ("1" puts the content policy
  // back to report-only, the rollback); it was in neither .env.example nor the README.
  it("ESSA_CSP_REPORT_ONLY, which next.config.js reads, is in client/.env.example (so the table above needs its row)", () => {
    expect(read("next.config.js")).toMatch(/process\.env\.ESSA_CSP_REPORT_ONLY/); // premise
    expect(read(".env.example")).toMatch(/^#?\s*ESSA_CSP_REPORT_ONLY=/m);
  });

  it("says the site's /api route forwards to the server, and next.config.js only as its fallback", () => {
    expect(read("app", "api", "[...path]", "route.ts")).toMatch(/forward/); // premise: the route exists
    expect(flat(README)).not.toMatch(/next\.config\.js[^|]*Proxies \/api/);
    expect(flat(README)).not.toMatch(/Where `next\.config\.js` proxies/);
    expect(flat(README)).toMatch(/app\/api\/\[\.\.\.path\]\/route\.ts/);
  });

  it("gives the Security page's reason the backup copy isn't encrypted", () => {
    const reason = "generates its own independent key";
    expect(flat(read("app", "security", "page.tsx"))).toContain(reason); // premise: the page's wording
    expect(flat(README)).toContain(reason);
    expect(flat(README)).not.toMatch(/because the analytics decomposition/);
  });
});
