// FB-1c (SEC-03): the response headers every production page carries.
//
// Phase 1 ships the content policy as REPORT-ONLY, to be enforced after 7
// days AND once the report tab, a statement import and a service-worker load
// have each run in real use (owner, 2026-10-06). From the first deploy,
// though, a small policy is ENFORCED: framing, <base> and plugins, which
// nothing legitimate uses. So are nosniff and no-referrer.
//
// 'unsafe-inline' is in script-src, deliberately: Next.js puts 5 inline
// scripts on every page, with content that changes per page and per build,
// and nonces would make every page render on a server. Its limit, stated:
// an injected inline script RUNS. What the policy still does is limit
// where data can be sent (connect-src, img-src, form-action and the rest)
// and stop external scripts and eval. It can't stop a navigation carrying
// data. Nonces are a recorded later item.
import { describe, it, expect, vi, afterEach } from "vitest";
import { createRequire } from "node:module";
import { join } from "node:path";

// Vitest runs from client/. Not import.meta.url: under jsdom it isn't a file: URL.
const req = createRequire(join(process.cwd(), "next.config.js"));

type Header = { key: string; value: string };
type Rule = { source: string; headers: Header[] };

async function rules(env: Record<string, string>): Promise<Rule[]> {
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  for (const m of ["./next.config.js", "./securityHeaders.js"]) delete req.cache[req.resolve(m)];
  const config = req("./next.config.js");
  return config.headers();
}
const header = (rs: Rule[], source: string, key: string) =>
  rs.find((r) => r.source === source)?.headers.filter((h) => h.key === key).map((h) => h.value) ?? [];
const directives = (policy: string) =>
  Object.fromEntries(policy.split(";").map((d) => d.trim()).filter(Boolean).map((d) => {
    const [name, ...values] = d.split(/\s+/);
    return [name, values.join(" ")];
  }));

const FULL = {
  "default-src": "'self'",
  "script-src": "'self' 'unsafe-inline'",
  "style-src": "'self' 'unsafe-inline'",
  "img-src": "'self'",
  "font-src": "'self'",
  "connect-src": "'self'",
  "worker-src": "'self'",
  "manifest-src": "'self'",
  "frame-src": "'none'",
  "form-action": "'self'",
  "frame-ancestors": "'none'",
  "base-uri": "'none'",
  "object-src": "'none'",
  "report-uri": "/api/csp-report",
  "report-to": "csp",
};

afterEach(() => vi.unstubAllEnvs());

describe("production, phase 1 (report-only)", () => {
  it("enforces framing, <base> and plugins from the first deploy", async () => {
    const rs = await rules({ NODE_ENV: "production" });
    expect(header(rs, "/:path*", "Content-Security-Policy")).toEqual(["frame-ancestors 'none'; base-uri 'none'; object-src 'none'"]);
    expect(header(rs, "/:path*", "X-Frame-Options")).toEqual(["DENY"]);
  });

  it("reports, without blocking, against the full policy, every directive exactly", async () => {
    const rs = await rules({ NODE_ENV: "production" });
    const [ro] = header(rs, "/:path*", "Content-Security-Policy-Report-Only");
    expect(directives(ro)).toEqual(FULL);
    expect(header(rs, "/:path*", "Reporting-Endpoints")).toEqual(['csp="/api/csp-report"']);
  });

  it("sends nosniff and no referrer (owner, 2026-10-06)", async () => {
    const rs = await rules({ NODE_ENV: "production" });
    expect(header(rs, "/:path*", "X-Content-Type-Options")).toEqual(["nosniff"]);
    expect(header(rs, "/:path*", "Referrer-Policy")).toEqual(["no-referrer"]);
  });

  it("allows no other site, no eval, and no wildcard anywhere", async () => {
    const rs = await rules({ NODE_ENV: "production" });
    const all = rs.flatMap((r) => r.headers).filter((h) => h.key.startsWith("Content-Security-Policy")).map((h) => h.value).join(" ");
    expect(all).not.toMatch(/https?:|\*|unsafe-eval|data:|blob:|googleapis|gstatic/);
  });

  it("serves the self-hosted font files for a year, as immutable (their names carry the version)", async () => {
    const rs = await rules({ NODE_ENV: "production" });
    expect(header(rs, "/fonts/:file*", "Cache-Control")).toEqual(["public, max-age=31536000, immutable"]);
  });
});

describe("production, phase 2 (ESSA_CSP_ENFORCE=1)", () => {
  it("enforces the full policy as one header, with no report-only copy", async () => {
    const rs = await rules({ NODE_ENV: "production", ESSA_CSP_ENFORCE: "1" });
    const csp = header(rs, "/:path*", "Content-Security-Policy");
    expect(csp).toHaveLength(1);
    expect(directives(csp[0])).toEqual(FULL);
    expect(header(rs, "/:path*", "Content-Security-Policy-Report-Only")).toEqual([]);
  });
});

describe("development", () => {
  it("sends none of it: next dev needs eval for hot reload", async () => {
    expect(await rules({ NODE_ENV: "development" })).toEqual([]);
  });
});
