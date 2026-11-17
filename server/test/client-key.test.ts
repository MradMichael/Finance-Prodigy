// SEC-04 / R1 (owner, session 55; held): what the limiters key on. The app's requests reach this server
// through the site's own proxy, so the address Express sees (req.ip, the right-most X-Forwarded-For entry
// under trust proxy 1) is the proxy's, and every person would share one allowance. The site's proxy route
// now names the person's address in a header, and this server believes it ONLY when the request also proves
// it came from that route, with a secret both sides hold (ESSA_PROXY_KEY). Anyone calling this server
// directly can't prove that, so they are keyed on the address that connected, as before.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import type { Request } from "express";
import { createApp } from "../src/app";
import { clientAddress } from "../src/lib/clientKey";

const KEY = "proxy-test-key-".repeat(3); // 45 characters: a test value, not a secret
const PROXY = "76.76.21.21"; // the address that connected (the site's proxy, or a direct caller)
const ALICE = "203.0.113.5", BOB = "198.51.100.7";
const original = process.env.ESSA_PROXY_KEY;

const fake = (headers: Record<string, string>, ip: string | undefined = PROXY) =>
  ({ ip, get: (name: string) => headers[name.toLowerCase()] }) as unknown as Request;

beforeEach(() => { process.env.ESSA_PROXY_KEY = KEY; });
afterEach(() => { if (original === undefined) delete process.env.ESSA_PROXY_KEY; else process.env.ESSA_PROXY_KEY = original; vi.restoreAllMocks(); });

describe("clientAddress: whose allowance a request counts against", () => {
  it("the right key and a client address: that address", () => {
    expect(clientAddress(fake({ "x-essa-proxy-key": KEY, "x-essa-client-ip": ALICE }))).toBe(ALICE);
  });

  it("an IPv6 client address is believed too", () => {
    expect(clientAddress(fake({ "x-essa-proxy-key": KEY, "x-essa-client-ip": "2001:db8::1234" }))).toBe("2001:db8::1234");
  });

  it("no key: the address that connected, whatever the header claims (a direct caller)", () => {
    expect(clientAddress(fake({ "x-essa-client-ip": ALICE }))).toBe(PROXY);
  });

  it("a wrong key, a key that only starts right, and a longer key: the address that connected", () => {
    for (const bad of ["wrong", KEY.slice(0, -1), KEY.slice(0, 10), KEY + "x", KEY.toUpperCase(), ""]) {
      expect(clientAddress(fake({ "x-essa-proxy-key": bad, "x-essa-client-ip": ALICE })), JSON.stringify(bad)).toBe(PROXY);
    }
  });

  it("the right key with a missing or malformed address: the address that connected", () => {
    for (const bad of [undefined, "", "not-an-address", "203.0.113.5, 10.0.0.1", "203.0.113.999", "203.0.113.5:8080", " 203.0.113.5 x"]) {
      const headers: Record<string, string> = { "x-essa-proxy-key": KEY };
      if (bad !== undefined) headers["x-essa-client-ip"] = bad;
      expect(clientAddress(fake(headers)), JSON.stringify(bad)).toBe(PROXY);
    }
  });

  it("spaces around a good address are trimmed", () => {
    expect(clientAddress(fake({ "x-essa-proxy-key": KEY, "x-essa-client-ip": "  203.0.113.5 " }))).toBe(ALICE);
  });

  it("with no secret set on the server, the header is never believed, even with a matching empty key", () => {
    delete process.env.ESSA_PROXY_KEY;
    expect(clientAddress(fake({ "x-essa-proxy-key": KEY, "x-essa-client-ip": ALICE }))).toBe(PROXY);
    expect(clientAddress(fake({ "x-essa-proxy-key": "", "x-essa-client-ip": ALICE }))).toBe(PROXY);
    process.env.ESSA_PROXY_KEY = "";
    expect(clientAddress(fake({ "x-essa-proxy-key": "", "x-essa-client-ip": ALICE }))).toBe(PROXY);
  });

  it("a secret shorter than 32 characters is not used at all (too easy to guess)", () => {
    process.env.ESSA_PROXY_KEY = "short-secret";
    expect(clientAddress(fake({ "x-essa-proxy-key": "short-secret", "x-essa-client-ip": ALICE }))).toBe(PROXY);
  });

  it("with no address at all, an empty key rather than a crash", () => {
    expect(clientAddress({ ip: undefined, get: () => undefined } as unknown as Request)).toBe("");
  });
});

describe("the limiters count per person behind the site's proxy", () => {
  const SENTENCE = "Too many requests. Please wait a few minutes and try again.";
  let app: ReturnType<typeof createApp>;
  beforeEach(() => { app = createApp(); });
  /** A request as the site's proxy sends it: one connecting address for everyone, the person named in the header. */
  const viaProxy = (person: string, key: string | null = KEY) => {
    const r = request(app).post("/api/auth/check-email").set("X-Forwarded-For", PROXY).set("x-essa-client-ip", person);
    return (key === null ? r : r.set("x-essa-proxy-key", key)).send({ email: "nobody@example.com" });
  };

  it("two people through the proxy have separate allowances (30 checks each per 15 minutes)", async () => {
    for (let i = 0; i < 30; i++) expect((await viaProxy(ALICE)).status).not.toBe(429);
    const blocked = await viaProxy(ALICE);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toBe(SENTENCE);
    expect((await viaProxy(BOB)).status).not.toBe(429);
  });

  it("a direct caller can't pick a fresh allowance by changing the header: without the key they share the connecting address's", async () => {
    for (let i = 0; i < 30; i++) expect((await viaProxy(`203.0.113.${i + 1}`, null)).status).not.toBe(429);
    expect((await viaProxy("203.0.113.200", null)).status).toBe(429);
    expect((await viaProxy("203.0.113.201", "a-guess")).status).toBe(429);
  });

  it("the remaining count the server reports is the person's own", async () => {
    await viaProxy(ALICE); await viaProxy(ALICE); await viaProxy(ALICE);
    const bob = await viaProxy(BOB);
    expect(bob.headers["ratelimit-remaining"]).toBe("29");
    const alice = await viaProxy(ALICE);
    expect(alice.headers["ratelimit-remaining"]).toBe("26");
  });

  it("SEC-05's new-copy limit counts per person too: two new backups each", async () => {
    const push = (email: string, person: string) => request(app).post("/api/sync/push").set("X-Forwarded-For", PROXY)
      .set("x-essa-proxy-key", KEY).set("x-essa-client-ip", person).send({ email, token: `token-of-${email}`, data: { income: 1 } });
    expect((await push("a1@example.com", ALICE)).status).toBe(200);
    expect((await push("a2@example.com", ALICE)).status).toBe(200);
    expect((await push("a3@example.com", ALICE)).status).toBe(429);
    expect((await push("b1@example.com", BOB)).status).toBe(200);
  });

  it("neither header is echoed back in any response", async () => {
    const res = await viaProxy(ALICE);
    const all = JSON.stringify(res.headers) + JSON.stringify(res.body);
    expect(all).not.toContain(KEY);
    expect(all.toLowerCase()).not.toContain("x-essa-proxy-key");
  });
});

describe("the secret and the named address never reach the log", () => {
  it("a client error report and a refused push, sent through the proxy, log neither header's value", async () => {
    const chunks: string[] = [];
    const sink = ((c: unknown) => { chunks.push(String(c)); return true; }) as never;
    vi.spyOn(process.stdout, "write").mockImplementation(sink);
    vi.spyOn(process.stderr, "write").mockImplementation(sink);
    const app = createApp();
    const via = (r: request.Test) => r.set("X-Forwarded-For", PROXY).set("x-essa-proxy-key", KEY).set("x-essa-client-ip", ALICE);
    try {
      await via(request(app).post("/api/client-errors")).send({ kind: "TypeError", message: "boom", where: "page.tsx:1", page: "/" });
      await via(request(app).post("/api/sync/pull").set("Authorization", "Bearer wrong")).send({ email: "nobody@example.com" });
      await via(request(app).post("/api/sync/push")).send({ email: "p1@example.com", token: "t-of-p1-0123456789", data: { income: 1 } });
    } finally { vi.restoreAllMocks(); }
    const raw = chunks.join("");
    expect(raw.length).toBeGreaterThan(0); // the premise: something was logged
    expect(raw).not.toContain(KEY);
    expect(raw).not.toContain(ALICE);
  });
});
