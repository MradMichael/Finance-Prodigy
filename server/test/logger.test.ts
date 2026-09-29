// The logger owns three fields -- ts, level, event -- and caller-supplied
// data must never overwrite them (audit 2.4.163). The rule broke once already:
// events.ts passed { event } and every analytics line lost its
// `analytics_event` label, so the counts could not be selected on the host.
//
// Enforced HERE, in the one place every line is built, rather than by
// reviewing callers: 1 of the server's 20 logger calls collided when this was
// written, and nothing would have stopped the 21st. A colliding caller key is
// KEPT, renamed meta_<key> -- dropping it would trade one silent loss for
// another.
import { describe, it, expect, vi, afterEach } from "vitest";
import { logger } from "../src/lib/logger";

afterEach(() => vi.restoreAllMocks());

function lineOf(fn: () => void, stream: "stdout" | "stderr" = "stdout"): Record<string, unknown> {
  const chunks: string[] = [];
  const target = stream === "stdout" ? process.stdout : process.stderr;
  const spy = vi.spyOn(target, "write").mockImplementation(((c: unknown) => { chunks.push(String(c)); return true; }) as never);
  try { fn(); } finally { spy.mockRestore(); }
  expect(chunks).toHaveLength(1); // premise: exactly one line was written
  return JSON.parse(chunks[0]);
}

describe("caller data cannot overwrite a field the logger owns", () => {
  it("meta.event does not replace the event label; it survives as meta_event", () => {
    const line = lineOf(() => logger.info("analytics_event", { event: "onboarding_step_income" }));
    expect(line.event).toBe("analytics_event");
    expect(line.meta_event).toBe("onboarding_step_income");
  });

  it("meta.level cannot relabel a line's severity", () => {
    const line = lineOf(() => logger.warn("push_denied_stale", { level: "info" }));
    expect(line.level).toBe("warn");
    expect(line.meta_level).toBe("info");
  });

  it("meta.ts cannot forge the timestamp", () => {
    const line = lineOf(() => logger.info("x", { ts: "1999-01-01T00:00:00.000Z" }));
    expect(line.ts).not.toBe("1999-01-01T00:00:00.000Z");
    expect(Math.abs(Date.parse(String(line.ts)) - Date.now())).toBeLessThan(5_000);
    expect(line.meta_ts).toBe("1999-01-01T00:00:00.000Z");
  });

  it("the same holds on the error path, which also spreads the caught error's fields", () => {
    const line = lineOf(() => logger.error("boom", new Error("bad"), { event: "spoof" }), "stderr");
    expect(line.event).toBe("boom");
    expect(line.meta_event).toBe("spoof");
    expect(line.message).toBe("bad");
  });

  it("keys that do not collide pass through unchanged (the control)", () => {
    const line = lineOf(() => logger.info("push_denied_token_mismatch", { userAgent: "UA/1", lastSyncedAt: "t" }));
    expect(line).toMatchObject({ level: "info", event: "push_denied_token_mismatch", userAgent: "UA/1", lastSyncedAt: "t" });
    expect(Object.keys(line).some((k) => k.startsWith("meta_"))).toBe(false);
  });
});
