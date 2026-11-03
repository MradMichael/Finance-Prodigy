// The /api rewrite: the browser calls /api on this site, and Next forwards it to
// the server named by API_URL. Production sets API_URL; a Vercel preview
// doesn't, so the fallback is the local server (.env.example's value), never
// the production one. Session 37 (owner): an EMPTY API_URL is treated like an
// unset one, so an empty value never rewrites /api onto itself.
import { describe, it, expect, afterEach } from "vitest";
import { createRequire } from "node:module";
import { join } from "node:path";

// Vitest runs from client/. Not import.meta.url: under jsdom it isn't a file: URL.
const req = createRequire(join(process.cwd(), "next.config.js"));
const original = process.env.API_URL;

type Rewrite = { source: string; destination: string };

async function apiRewrite(apiUrl: string | undefined): Promise<Rewrite> {
  if (apiUrl === undefined) delete process.env.API_URL;
  else process.env.API_URL = apiUrl;
  for (const m of ["./next.config.js", "./securityHeaders.js"]) delete req.cache[req.resolve(m)];
  const rewrites: Rewrite[] = await req("./next.config.js").rewrites();
  const rule = rewrites.find((r) => r.source === "/api/:path*");
  if (!rule) throw new Error("no /api rewrite");
  return rule;
}

afterEach(() => {
  if (original === undefined) delete process.env.API_URL;
  else process.env.API_URL = original;
});

describe("the /api rewrite", () => {
  it("forwards to API_URL when it's set", async () => {
    expect((await apiRewrite("https://api.example.test")).destination).toBe("https://api.example.test/api/:path*");
  });

  it("falls back to the local server when API_URL is unset (a preview), not the production one", async () => {
    expect((await apiRewrite(undefined)).destination).toBe("http://localhost:4000/api/:path*");
  });

  it("treats an empty API_URL like an unset one", async () => {
    expect((await apiRewrite("")).destination).toBe("http://localhost:4000/api/:path*");
  });

  it("never rewrites /api onto itself", async () => {
    for (const value of [undefined, "", "https://api.example.test"]) {
      const rule = await apiRewrite(value);
      expect(rule.destination).not.toBe(rule.source);
    }
  });
});
