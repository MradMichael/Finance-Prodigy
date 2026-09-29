// PRIORITY 4 -- EVENTS. Privacy page:
//   "sends anonymous counts for a handful of named product actions (like
//    completing an onboarding step) to our own server, no third-party
//    analytics SDK, no identity attached, never your financial data."
//
// Checked at the one place identity could leak: what actually reaches the
// log. Both the logger call and the raw stdout line are inspected, so a
// change that bypassed the logger would still be caught.
//
// NOT REACHABLE HERE (2.4.116): the deployed proxy's real client IP. The
// test asserts no address of any kind is written, whatever `req.ip` is.
import { describe, it, expect, vi, afterEach } from "vitest";
import { logger } from "../src/lib/logger";
import { api } from "./support/http";

afterEach(() => vi.restoreAllMocks());

/** Capture every stdout line written while `fn` runs. */
async function captureStdout(fn: () => Promise<unknown>): Promise<string> {
  const lines: string[] = [];
  const spy = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => { lines.push(String(chunk)); return true; }) as never);
  try { await fn(); } finally { spy.mockRestore(); }
  return lines.join("");
}

describe("an analytics event carries no identity and no financial data", () => {
  it("an allowed event is logged as exactly { action } -- nothing else", async () => {
    const info = vi.spyOn(logger, "info");
    const res = await api().post("/api/events").send({ event: "onboarding_step_income" });
    expect(res.status).toBe(200);
    expect(info).toHaveBeenCalledWith("analytics_event", { action: "onboarding_step_income" });
  });

  it("identity and money sent WITH the event never reach the log", async () => {
    const info = vi.spyOn(logger, "info");
    const out = await captureStdout(() => api().post("/api/events").send({
      event: "onboarding_step_transaction",
      email: "tracked-person@example.com", userId: "u-8841", income: 3150.75, name: "Tracked Person",
    }));
    const call = info.mock.calls.find((c) => c[0] === "analytics_event")!;
    expect(Object.keys(call[1] ?? {})).toEqual(["action"]);
    // Premise: the capture really saw the event's line, so "not contained"
    // below is a check on a real log line and not on an empty string.
    expect(out).toContain('"action":"onboarding_step_transaction"');
    for (const leaked of ["tracked-person@example.com", "u-8841", "3150.75", "Tracked Person"]) {
      expect(out).not.toContain(leaked);
    }
  });

  it("no address of any kind is logged with the event", async () => {
    const out = await captureStdout(() => api().post("/api/events").send({ event: "onboarding_step_overview" }));
    const line = out.split("\n").find((l) => l.includes('"event":"analytics_event"'))!;
    expect(line).toBeTruthy();
    const parsed = JSON.parse(line);
    expect(Object.keys(parsed).sort()).toEqual(["action", "event", "level", "ts"]);
    expect(line).not.toMatch(/127\.0\.0\.1|::1|::ffff|"ip"/);
  });

  it("an event outside the allow-list is refused (422) and not logged as analytics", async () => {
    const info = vi.spyOn(logger, "info");
    const res = await api().post("/api/events").send({ event: "page_view_with_email" });
    expect(res.status).toBe(422);
    expect(info.mock.calls.some((c) => c[0] === "analytics_event")).toBe(false);
  });
});

describe("FIXED (audit 2.4.163): the log line keeps its analytics label", () => {
  it("the line carries event: analytics_event AND the product action, in separate fields", async () => {
    // Was: logger.info("analytics_event", { event }) -- meta.event overwrote the
    // label, so no line on the host ever said analytics_event. Now the action
    // has its own field, and the logger refuses such overwrites regardless
    // (test/logger.test.ts).
    const out = await captureStdout(() => api().post("/api/events").send({ event: "onboarding_step_income" }));
    const line = JSON.parse(out.split(String.fromCharCode(10)).find((l) => l.includes("analytics_event"))!);
    expect(line.event).toBe("analytics_event");
    expect(line.action).toBe("onboarding_step_income");
  });
});
