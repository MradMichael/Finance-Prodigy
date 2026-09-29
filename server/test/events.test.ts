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
  it("an allowed event is logged as exactly { event } -- nothing else", async () => {
    const info = vi.spyOn(logger, "info");
    const res = await api().post("/api/events").send({ event: "onboarding_step_income" });
    expect(res.status).toBe(200);
    expect(info).toHaveBeenCalledWith("analytics_event", { event: "onboarding_step_income" });
  });

  it("identity and money sent WITH the event never reach the log", async () => {
    const info = vi.spyOn(logger, "info");
    const out = await captureStdout(() => api().post("/api/events").send({
      event: "onboarding_step_transaction",
      email: "tracked-person@example.com", userId: "u-8841", income: 3150.75, name: "Tracked Person",
    }));
    const call = info.mock.calls.find((c) => c[0] === "analytics_event")!;
    expect(Object.keys(call[1] ?? {})).toEqual(["event"]);
    // Premise: the capture really saw the event's line, so "not contained"
    // below is a check on a real log line and not on an empty string.
    expect(out).toContain('"event":"onboarding_step_transaction"');
    for (const leaked of ["tracked-person@example.com", "u-8841", "3150.75", "Tracked Person"]) {
      expect(out).not.toContain(leaked);
    }
  });

  it("no address of any kind is logged with the event", async () => {
    const out = await captureStdout(() => api().post("/api/events").send({ event: "onboarding_step_overview" }));
    const line = out.split("\n").find((l) => l.includes('"event":"onboarding_step_overview"'))!;
    // Found by the event NAME: the logger's own `analytics_event` label is
    // overwritten by meta.event (audit 2.4.163), so the line never contains it.
    expect(line).toBeTruthy();
    const parsed = JSON.parse(line);
    expect(Object.keys(parsed).sort()).toEqual(["event", "level", "ts"]);
    expect(line).not.toMatch(/127\.0\.0\.1|::1|::ffff|"ip"/);
  });

  it("an event outside the allow-list is refused (422) and not logged as analytics", async () => {
    const info = vi.spyOn(logger, "info");
    const res = await api().post("/api/events").send({ event: "page_view_with_email" });
    expect(res.status).toBe(422);
    expect(info.mock.calls.some((c) => c[0] === "analytics_event")).toBe(false);
  });
});

describe("PINNED (audit 2.4.163): the log line loses its analytics label", () => {
  it("CURRENT BEHAVIOUR: meta.event overwrites the logger's own event name", async () => {
    // logger.write builds { ts, level, event, ...meta }, so the handler's
    // logger.info("analytics_event", { event }) is written with `event` set to
    // the product action and the label gone. No identity is involved -- the
    // promise above holds -- but the counts cannot be selected by label on
    // the host. Pinned so the fix changes this test deliberately.
    const out = await captureStdout(() => api().post("/api/events").send({ event: "onboarding_step_income" }));
    expect(out).toContain('"event":"onboarding_step_income"');
    expect(out).not.toContain("analytics_event");
  });
});
