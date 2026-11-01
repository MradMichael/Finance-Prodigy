// Owner, session 34 (decision 26): how the worker is built and served. `npm run build` writes it after
// `next build`; it's generated, so it stays out of git; the browser re-checks /sw.js rather than keeping it;
// the layout still registers it and shows the update notice.
import { it, expect, vi, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { createRequire } from "node:module";

const root = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
afterEach(() => vi.unstubAllEnvs());

it("npm run build writes the worker after next build", () => {
  expect(JSON.parse(read("package.json")).scripts.build).toBe("next build && node sw/build-sw.mjs");
});

it("the generated worker isn't kept in git", () => {
  expect(read(".gitignore").split(/\r?\n/)).toContain("public/sw.js");
});

it("the browser re-checks /sw.js instead of keeping a copy", async () => {
  vi.stubEnv("NODE_ENV", "production");
  const req = createRequire(path.join(root, "next.config.js"));
  for (const m of ["./next.config.js", "./securityHeaders.js"]) delete req.cache[req.resolve(m)];
  const rules: { source: string; headers: { key: string; value: string }[] }[] = await req("./next.config.js").headers();
  expect(rules.find((r) => r.source === "/sw.js")?.headers).toEqual([{ key: "Cache-Control", value: "no-cache" }]);
});

it("the layout registers /sw.js and shows the update notice", () => {
  const layout = read("app/layout.tsx");
  expect(layout).toMatch(/navigator\.serviceWorker\.register\('\/sw\.js'\)/);
  expect(layout).toMatch(/import UpdateNotice from "\.\.\/components\/UpdateNotice";/);
  expect(layout).toMatch(/<UpdateNotice \/>/);
});
