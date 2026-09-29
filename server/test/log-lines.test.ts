// Audit 2.4.165: every log line the sync routes write names the account by
// its keyed reference -- driven through the real routes, one case per event,
// so the check is on what actually reaches the host's logs.
//
// Each case asserts its event was written (the premise) before asserting
// what is absent from it: an absence check over zero lines passes vacuously
// (2.4.163's lesson). The last test reads the log events out of sync.ts
// itself, so a new event there fails this file until it has a case.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { store, type UserSyncRow } from "./support/fakePrisma";
import { api, hash } from "./support/http";

const KEY = "0123456789abcdef".repeat(4); // a test key, not a secret
const A = "logged-account@example.com";
const UA = "LogLineTest/1.0";
const expectedRef = createHmac("sha256", KEY).update(A).digest("hex").slice(0, 16);

const pull = (token: string) =>
  api().post("/api/sync/pull").set("User-Agent", UA).set("Authorization", `Bearer ${token}`).send({ email: A });
const push = (body: Record<string, unknown>) => api().post("/api/sync/push").set("User-Agent", UA).send({ email: A, ...body });
const relink = (body: Record<string, unknown>) => api().post("/api/sync/relink").set("User-Agent", UA).send({ email: A, ...body });
const del = (token: string) => api().delete("/api/sync").set("User-Agent", UA).send({ email: A, token });

const seed = (row: Partial<UserSyncRow>) => () => { store.seedUserSync({ ...row, email: A }); };

const CASES: { event: string; seed?: () => void; send: () => PromiseLike<unknown> }[] = [
  { event: "push_denied_token_mismatch", seed: seed({ authTokenHash: hash("right") }), send: () => push({ token: "wrong", data: {} }) },
  { event: "push_denied_stale", seed: seed({ authTokenHash: hash("right"), syncedAt: new Date("2026-09-25T10:00:00.000Z") }),
    send: () => push({ token: "right", baseSyncedAt: "2026-09-01T00:00:00.000Z", data: {} }) },
  { event: "pull_denied_no_record", send: () => pull("any") },
  { event: "pull_denied_no_token_registered", seed: seed({ authTokenHash: null }), send: () => pull("any") },
  { event: "pull_denied_token_mismatch", seed: seed({ authTokenHash: hash("right") }), send: () => pull("wrong") },
  { event: "relink_registered_fresh", send: () => relink({ token: "t", recoveryToken: "r" }) },
  { event: "relink_denied_no_recovery_token_registered", seed: seed({ authTokenHash: hash("s"), recoveryTokenHash: null }),
    send: () => relink({ token: "t", recoveryToken: "r", oldRecoveryToken: "any" }) },
  { event: "relink_denied_old_recovery_token_mismatch", seed: seed({ authTokenHash: hash("s"), recoveryTokenHash: hash("old") }),
    send: () => relink({ token: "t", recoveryToken: "r", oldRecoveryToken: "guess" }) },
  { event: "relink_succeeded", seed: seed({ authTokenHash: hash("s"), recoveryTokenHash: hash("old") }),
    send: () => relink({ token: "t", recoveryToken: "r", oldRecoveryToken: "old" }) },
  { event: "delete_denied_no_token_registered", seed: seed({ authTokenHash: null }), send: () => del("any") },
  { event: "delete_denied_token_mismatch", seed: seed({ authTokenHash: hash("right") }), send: () => del("wrong") },
];

/** Everything the process writes to stdout/stderr while `send` runs. */
async function capture(send: () => PromiseLike<unknown>): Promise<{ raw: string; lines: Record<string, unknown>[] }> {
  const chunks: string[] = [];
  const sink = ((c: unknown) => { chunks.push(String(c)); return true; }) as never;
  vi.spyOn(process.stdout, "write").mockImplementation(sink);
  vi.spyOn(process.stderr, "write").mockImplementation(sink);
  try { await send(); } finally { vi.restoreAllMocks(); }
  const raw = chunks.join("");
  const lines = raw.split("\n").filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
  return { raw, lines };
}

let saved: string | undefined;
beforeEach(() => { saved = process.env.LOG_EMAIL_KEY; process.env.LOG_EMAIL_KEY = KEY; });
afterEach(() => { if (saved === undefined) delete process.env.LOG_EMAIL_KEY; else process.env.LOG_EMAIL_KEY = saved; });

describe("with the key set: each event names the account by its keyed reference", () => {
  it.each(CASES.map((c) => [c.event, c] as const))("%s", async (event, c) => {
    c.seed?.();
    const { raw, lines } = await capture(c.send);
    const mine = lines.filter((l) => l.event === event);
    expect(mine).toHaveLength(1); // premise: the event was written
    expect(mine[0].emailRef).toBe(expectedRef);
    expect(mine[0]).not.toHaveProperty("email");
    expect(raw.toLowerCase()).not.toContain("logged-account"); // not the address, nor its local part
    expect(raw).not.toContain(KEY);
    expect(mine[0].userAgent).toBe(UA); // kept, and disclosed
  });
});

describe("with no key: nothing identifying, and no hash of any kind", () => {
  it.each(CASES.map((c) => [c.event, c] as const))("%s", async (event, c) => {
    delete process.env.LOG_EMAIL_KEY;
    c.seed?.();
    const { raw, lines } = await capture(c.send);
    const mine = lines.filter((l) => l.event === event);
    expect(mine).toHaveLength(1); // premise
    expect(mine[0].emailRef).toBe("unkeyed");
    expect(raw.toLowerCase()).not.toContain("logged-account");
    expect(raw).not.toContain(expectedRef);
  });
});

describe("coverage", () => {
  it("every log event in routes/sync.ts has a case above", () => {
    const source = readFileSync(new URL("../src/routes/sync.ts", import.meta.url), "utf8");
    const events = [...source.matchAll(/logger\.(?:info|warn|error)\("([a-z_]+)"/g)].map((m) => m[1]);
    expect(events.length).toBeGreaterThan(0); // premise: the pattern still finds them
    expect([...new Set(events)].sort()).toEqual(CASES.map((c) => c.event).sort());
  });
});
