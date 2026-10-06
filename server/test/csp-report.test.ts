// FB-1c (SEC-03): where browsers send content-policy violation reports.
//
// MINIMAL BY OWNER DECISION (2026-10-06): one log line per report, holding the
// ESSA page's path and what was blocked, reduced to its origin or a keyword.
// Nothing else from the report: not the directive, the policy text, source
// files, script samples, the referrer or the user agent. No request metadata
// either. The privacy page says exactly this.
//
// Both formats browsers use are accepted: `application/csp-report` (the
// report-uri directive; Firefox and others) and `application/reports+json`
// (the Reporting API; Chrome). Bodies are capped at 8 KB and requests are
// rate-limited, so the endpoint can't become a log-flooding sink.
import { describe, it, expect, vi, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { logger } from "../src/lib/logger";
import { api } from "./support/http";

afterEach(() => vi.restoreAllMocks());

const PATH = "/api/csp-report";
const legacy = (report: Record<string, unknown>) =>
  api().post(PATH).set("Content-Type", "application/csp-report").send(JSON.stringify({ "csp-report": report }));
const reporting = (bodies: Record<string, unknown>[]) =>
  api().post(PATH).set("Content-Type", "application/reports+json").send(JSON.stringify(
    bodies.map((body) => ({ type: "csp-violation", age: 1, url: "https://essa.example/x", user_agent: "UA-SENTINEL", body })),
  ));

/** Capture every stdout and stderr line written while `fn` runs. */
async function capture(fn: () => Promise<unknown>): Promise<string> {
  const lines: string[] = [];
  const grab = ((chunk: unknown) => { lines.push(String(chunk)); return true; }) as never;
  const out = vi.spyOn(process.stdout, "write").mockImplementation(grab);
  const err = vi.spyOn(process.stderr, "write").mockImplementation(grab);
  try { await fn(); } finally { out.mockRestore(); err.mockRestore(); }
  return lines.join("");
}

describe("a report is logged as exactly { page, blocked }", () => {
  it("report-uri format: the page's path, and the blocked origin, never a query or path beyond it", async () => {
    const info = vi.spyOn(logger, "info");
    const res = await legacy({
      "document-uri": "https://essa.example/profile?tab=secret#frag",
      "blocked-uri": "https://evil.example/steal?d=TOKEN-SENTINEL",
      "effective-directive": "connect-src",
    });
    expect(res.status).toBe(204);
    expect(res.text).toBe("");
    expect(info.mock.calls).toEqual([["csp_violation", { page: "/profile", blocked: "https://evil.example" }]]);
  });

  it("Reporting API format: each report in the batch becomes one line", async () => {
    const info = vi.spyOn(logger, "info");
    const res = await reporting([
      { documentURL: "https://essa.example/", blockedURL: "inline", effectiveDirective: "script-src-elem" },
      { documentURL: "https://essa.example/sign-in", blockedURL: "https://fonts.example/a.woff2" },
    ]);
    expect(res.status).toBe(204);
    expect(info.mock.calls).toEqual([
      ["csp_violation", { page: "/", blocked: "inline" }],
      ["csp_violation", { page: "/sign-in", blocked: "https://fonts.example" }],
    ]);
  });

  it.each([
    ["inline", "inline"],
    ["eval", "eval"],
    ["wasm-eval", "wasm-eval"],
    ["data:image/png;base64,SENTINEL", "data"],
    ["blob:https://essa.example/1f0c", "blob"],
    ["wss://sock.example/live?k=1", "wss://sock.example"],
    ["javascript:alert(1)", "other"],
    ["", "other"],
    [42, "other"],
  ])("blocked %j is logged as %j", async (blocked, expected) => {
    const info = vi.spyOn(logger, "info");
    await legacy({ "document-uri": "https://essa.example/profile", "blocked-uri": blocked });
    expect(info.mock.calls[0][1]).toEqual({ page: "/profile", blocked: expected });
  });

  it("the report tab (an about:blank document the app writes into) is named as such", async () => {
    const info = vi.spyOn(logger, "info");
    await legacy({ "document-uri": "about:blank", "blocked-uri": "inline" });
    expect(info.mock.calls[0][1]).toEqual({ page: "about:blank", blocked: "inline" });
  });

  it("a page address that isn't a web or about:blank URL is 'other'", async () => {
    const info = vi.spyOn(logger, "info");
    await legacy({ "document-uri": "not a url", "blocked-uri": "inline" });
    expect(info.mock.calls[0][1]).toEqual({ page: "other", blocked: "inline" });
  });
});

describe("nothing else from the report, or the request, reaches the log", () => {
  it("samples, source files, the policy, the referrer, the user agent and any address stay out", async () => {
    const out = await capture(() => legacy({
      "document-uri": "https://essa.example/profile?email=person@example.com",
      "blocked-uri": "https://evil.example/x",
      "script-sample": "SAMPLE-SENTINEL",
      "source-file": "https://essa.example/_next/app.js?SOURCE-SENTINEL",
      "original-policy": "POLICY-SENTINEL",
      "referrer": "https://ref.example/?REF-SENTINEL",
      "violated-directive": "DIRECTIVE-SENTINEL",
    }));
    for (const s of ["SAMPLE-SENTINEL", "SOURCE-SENTINEL", "POLICY-SENTINEL", "REF-SENTINEL", "DIRECTIVE-SENTINEL", "person@example.com", "email="]) {
      expect(out).not.toContain(s);
    }
    const line = JSON.parse(out.trim().split("\n").find((l) => l.includes("csp_violation"))!);
    expect(Object.keys(line).sort()).toEqual(["blocked", "event", "level", "page", "ts"]);
  });

  it("the Reporting API's user agent never reaches the log", async () => {
    const out = await capture(() => reporting([{ documentURL: "https://essa.example/", blockedURL: "eval" }]));
    expect(out).toContain("csp_violation"); // premise: the report was logged at all
    expect(out).not.toContain("UA-SENTINEL");
  });
});

describe("the endpoint can't be used as a sink", () => {
  it("a body over 8 KB is refused (413), and nothing is logged, not even an error", async () => {
    const out = await capture(async () => {
      const res = await legacy({ "document-uri": "https://essa.example/", "blocked-uri": "inline", pad: "x".repeat(9 * 1024) });
      expect(res.status).toBe(413);
    });
    expect(out).toBe("");
  });

  it("malformed JSON is refused (400), and nothing is logged", async () => {
    const out = await capture(async () => {
      const res = await api().post(PATH).set("Content-Type", "application/csp-report").send("{not json");
      expect(res.status).toBe(400);
    });
    expect(out).toBe("");
  });

  it("at most 10 reports are logged from one request", async () => {
    const info = vi.spyOn(logger, "info");
    await reporting(Array.from({ length: 25 }, () => ({ documentURL: "https://essa.example/", blockedURL: "inline" })));
    expect(info.mock.calls.filter((c) => c[0] === "csp_violation")).toHaveLength(10);
  });

  it("any other content type is accepted and ignored: 204, nothing logged", async () => {
    const info = vi.spyOn(logger, "info");
    const res = await api().post(PATH).set("Content-Type", "text/plain").send("inline");
    expect(res.status).toBe(204);
    expect(info).not.toHaveBeenCalled();
  });

  it("is rate-limited: the 61st report in 15 minutes from one client is refused", async () => {
    const app = createApp(); // one app, so one limiter bucket
    vi.spyOn(logger, "info").mockImplementation(() => {});
    const send = () => request(app).post(PATH).set("Content-Type", "application/csp-report")
      .send(JSON.stringify({ "csp-report": { "document-uri": "https://essa.example/", "blocked-uri": "inline" } }));
    for (let i = 0; i < 60; i++) expect((await send()).status).toBe(204);
    expect((await send()).status).toBe(429);
  });
});
