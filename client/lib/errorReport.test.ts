// INF-02 (owner, session 30): errors on someone's device reach the owner, by a
// short report to our own server, with nothing of the person's in it.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { scrubMessage, framesOf, buildReport, reportError, installErrorReporting, resetForTests, REPORT_PATH, MAX_PER_LOAD } from "./errorReport";

const ORIGIN = window.location.origin;

describe("scrubMessage: nothing of the person's", () => {
  it("every number goes, amounts and dates included", () => {
    expect(scrubMessage("Amount 1,234.56 over cap 1000 on 2026-09-05")).toBe("Amount # over cap # on #-#-#");
  });
  it("email addresses go", () => {
    expect(scrubMessage("No account for someone.name+tag@example.co.uk here")).toBe("No account for <email> here");
  });
  it("quoted text goes, unless it's a code name", () => {
    expect(scrubMessage(`Unexpected token 'P', "Pharmacy L"... is not valid JSON`)).toBe(`Unexpected token 'P', "…"... is not valid JSON`);
    expect(scrubMessage("Cannot read properties of undefined (reading 'amount')")).toBe("Cannot read properties of undefined (reading 'amount')");
    expect(scrubMessage("Bad value 'Groceries at Spinneys'")).toBe("Bad value '…'");
  });
  it("a URL keeps only its path", () => {
    expect(scrubMessage("Failed to fetch https://finance-prodigy.onrender.com/api/sync/pull?email=x")).toBe("Failed to fetch /api/sync/pull");
  });
  it("at most 200 characters", () => {
    expect(scrubMessage("x".repeat(500))).toHaveLength(200);
  });
});

describe("framesOf: ESSA's own frames only", () => {
  const stack = [
    "TypeError: boom",
    `    at save (${ORIGIN}/_next/static/chunks/app/page-abc123.js?v=1:12:345)`,
    "    at chrome-extension://abcdef/content.js:1:2",
    "    at https://other.example/x.js:3:4",
    `    at ${ORIGIN}/_next/static/chunks/main-def.js:9:8`,
  ].join("\n");
  it("file:line:column, no host or query, extensions and other sites left out", () => {
    expect(framesOf(stack, ORIGIN)).toEqual(["/_next/static/chunks/app/page-abc123.js:12:345", "/_next/static/chunks/main-def.js:9:8"]);
  });
  it("at most six", () => {
    const many = Array.from({ length: 10 }, (_, i) => `    at ${ORIGIN}/_next/static/chunks/c${i}.js:1:1`).join("\n");
    expect(framesOf(many, ORIGIN)).toHaveLength(6);
  });
});

describe("buildReport", () => {
  it("an Error: its kind, scrubbed message, frames and the page's path without query or fragment", () => {
    const e = new RangeError("Maximum call stack size exceeded at 1200");
    e.stack = `RangeError: x\n    at f (${ORIGIN}/_next/static/chunks/x.js:1:2)`;
    expect(buildReport(e, "/profile?tab=1#danger", ORIGIN)).toEqual({ kind: "RangeError", message: "Maximum call stack size exceeded at #", where: ["/_next/static/chunks/x.js:1:2"], page: "/profile" });
  });
  it("a rejection with no Error", () => {
    expect(buildReport({ secret: "Pharmacy" }, "/", ORIGIN, true)).toEqual({ kind: "UnhandledRejection", message: "", where: [], page: "/" });
  });
  it("the report has exactly these four fields", () => {
    expect(Object.keys(buildReport(new Error("x"), "/", ORIGIN)).sort()).toEqual(["kind", "message", "page", "where"]);
  });
});

describe("sending", () => {
  let beacon: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    resetForTests();
    beacon = vi.fn(() => true);
    Object.defineProperty(navigator, "sendBeacon", { value: beacon, configurable: true });
  });
  afterEach(() => { Object.defineProperty(navigator, "sendBeacon", { value: undefined, configurable: true }); vi.restoreAllMocks(); });

  it("sends one report by beacon to our own server", async () => {
    reportError(new TypeError("boom 42"));
    expect(beacon).toHaveBeenCalledTimes(1);
    expect(beacon.mock.calls[0][0]).toBe(REPORT_PATH);
    const body = JSON.parse(await (beacon.mock.calls[0][1] as Blob).text());
    expect(body).toMatchObject({ kind: "TypeError", message: "boom #" });
  });

  it("the same error once; at most five per page load", () => {
    reportError(new TypeError("same")); reportError(new TypeError("same"));
    expect(beacon).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 10; i++) reportError(new Error(`distinct ${"x".repeat(i)}`));
    expect(beacon).toHaveBeenCalledTimes(MAX_PER_LOAD);
  });

  it("without sendBeacon it falls back to fetch with keepalive", () => {
    Object.defineProperty(navigator, "sendBeacon", { value: undefined, configurable: true });
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    reportError(new Error("x"));
    expect(f).toHaveBeenCalledWith(REPORT_PATH, expect.objectContaining({ method: "POST", keepalive: true }));
  });

  it("never throws, even when sending does", () => {
    beacon.mockImplementation(() => { throw new Error("blocked"); });
    expect(() => reportError(new Error("x"))).not.toThrow();
  });

  it("the window handlers send an uncaught error and an unhandled rejection", () => {
    installErrorReporting();
    window.dispatchEvent(new ErrorEvent("error", { error: new TypeError("uncaught") }));
    const rej = new Event("unhandledrejection") as Event & { reason?: unknown };
    rej.reason = new Error("rejected");
    window.dispatchEvent(rej);
    expect(beacon).toHaveBeenCalledTimes(2);
  });
});
