// SEC-05 (owner, session 30, DECISIONS_PENDING entry 10 (a)): anyone could
// create unlimited 2 MB server copies under made-up addresses (100 pushes per
// 15 minutes from one client, each a new row: 200 MB). Creating a NEW copy is
// now limited per client address: two per 15 minutes; the third is refused
// with the existing sentence and writes nothing. Pushes to a copy that exists
// aren't counted, so a person's own backups never meet it. One app per test:
// the counts live on the app, as in production.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { store, prisma } from "./support/fakePrisma";
import { hash, storedData } from "./support/http";

const SENTENCE = "Too many requests. Please wait a few minutes and try again.";
const MIN = 60_000;
let app: ReturnType<typeof createApp>;
let clock: number;
const at = (ms: number) => { clock += ms; vi.setSystemTime(clock); };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  clock = Date.parse("2026-10-29T10:00:00.000Z"); vi.setSystemTime(clock);
  app = createApp();
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

const HOME = "203.0.113.5", ELSEWHERE = "198.51.100.7";
const push = (email: string, ip = HOME, token = `token-of-${email}`) =>
  request(app).post("/api/sync/push").set("X-Forwarded-For", ip).send({ email, token, data: { income: 1 } });

describe("SEC-05: new server copies per address", () => {
  it("two new copies from one address are created; the third is refused with the existing sentence and creates nothing", async () => {
    expect((await push("new-1@example.com")).status).toBe(200);
    expect((await push("new-2@example.com")).status).toBe(200);
    const third = await push("new-3@example.com");
    expect(third.status).toBe(429);
    expect(third.body.error).toBe(SENTENCE);
    expect(store.userSync.has("new-3@example.com")).toBe(false);
  });

  it("another address is unaffected", async () => {
    await push("new-1@example.com"); await push("new-2@example.com");
    expect((await push("new-3@example.com")).status).toBe(429);
    expect((await push("new-3@example.com", ELSEWHERE)).status).toBe(200);
  });

  it("pushes to a copy that exists aren't counted, however many", async () => {
    store.seedUserSync({ email: "owner@example.com", authTokenHash: hash("token-of-owner@example.com"), dataJson: storedData() });
    for (let i = 0; i < 6; i++) expect((await push("owner@example.com")).status).toBe(200);
    expect((await push("new-1@example.com")).status).toBe(200);
    expect((await push("new-2@example.com")).status).toBe(200);
  });

  it("a refused push doesn't count: neither a wrong token on an existing copy nor the third, refused, new one", async () => {
    store.seedUserSync({ email: "owner@example.com", authTokenHash: hash("token-of-owner@example.com"), dataJson: storedData() });
    expect((await push("owner@example.com", HOME, "wrong-token")).status).toBe(401);
    expect((await push("new-1@example.com")).status).toBe(200);
    at(5 * MIN);
    expect((await push("new-2@example.com")).status).toBe(200); // the 401 didn't count
    at(1 * MIN);
    expect((await push("new-3@example.com")).status).toBe(429);
    at(9 * MIN + 1000); // 15 minutes after new-1: new-2 still counts, the refused one mustn't
    expect((await push("new-3@example.com")).status).toBe(200);
  });

  it("15 minutes after the first, a new copy is allowed again", async () => {
    await push("new-1@example.com");
    at(5 * MIN);
    await push("new-2@example.com");
    expect((await push("new-3@example.com")).status).toBe(429);
    at(10 * MIN + 1000); // 15 minutes after the first
    expect((await push("new-3@example.com")).status).toBe(200);
    expect((await push("new-4@example.com")).status).toBe(429); // the second is still inside its window
  });

  it("a new copy whose write fails gives its place back", async () => {
    const upsert = vi.spyOn(prisma.userSync, "upsert").mockRejectedValueOnce(new Error("disk full"));
    vi.spyOn(process.stderr, "write").mockImplementation((() => true) as never); // the route's error line
    expect((await push("new-1@example.com")).status).not.toBe(200);
    upsert.mockRestore();
    expect(store.userSync.has("new-1@example.com")).toBe(false);
    expect((await push("new-2@example.com")).status).toBe(200);
    expect((await push("new-3@example.com")).status).toBe(200); // the failed one isn't counted
    expect((await push("new-4@example.com")).status).toBe(429);
  });

  it("a push that creates nothing because its body is invalid doesn't count", async () => {
    for (let i = 0; i < 3; i++) expect((await request(app).post("/api/sync/push").set("X-Forwarded-For", HOME).send({ email: `bad-${i}@example.com`, token: "t" })).status).not.toBe(200);
    expect((await push("new-1@example.com")).status).toBe(200);
    expect((await push("new-2@example.com")).status).toBe(200);
  });
});
