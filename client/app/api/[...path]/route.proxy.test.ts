// @vitest-environment node
// SEC-04 / R1 (owner, session 55; held): the site's own proxy for /api. The browser still calls /api on this
// site; this route forwards the call to the server (API_URL) and, when ESSA_PROXY_KEY is set, tells the server
// who is calling (the address Vercel saw) with the secret that proves the message is ours. The browser never
// sees either header, and can't plant them: anything it sends under those names is dropped.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET, POST, DELETE } from "./route";
import { forward } from "../../../lib/apiProxy";

const KEY = "proxy-test-key-".repeat(3); // a test value, not a secret
const env = { ...process.env };
let calls: { url: string; init: RequestInit & { headers: Headers } }[];
let answer: () => Promise<Response>;

beforeEach(() => {
  calls = [];
  answer = async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json", "ratelimit-remaining": "97", "x-powered-by": "Express", "set-cookie": "a=b" } });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => { calls.push({ url: String(url), init: { ...init, headers: new Headers(init.headers) } }); return answer(); }));
  process.env.API_URL = "https://api.example.test";
  process.env.ESSA_PROXY_KEY = KEY;
  process.env.VERCEL = "1";
});
afterEach(() => { vi.unstubAllGlobals(); process.env = { ...env }; });

const ctx = (...path: string[]) => ({ params: Promise.resolve({ path }) });
const browser = (path: string, init: RequestInit = {}) => new Request(`https://essa.example.test/api/${path}`, init);
const sent = () => calls[0].init.headers;

describe("forwarding", () => {
  it("a push goes to the server's same path with its method, body and content type, and the answer comes back", async () => {
    const body = JSON.stringify({ email: "a@example.com", data: { income: 1 } });
    const res = await POST(browser("sync/push", { method: "POST", body, headers: { "content-type": "application/json", "x-vercel-forwarded-for": "203.0.113.5" } }), ctx("sync", "push"));
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.example.test/api/sync/push");
    expect(calls[0].init.method).toBe("POST");
    expect(new TextDecoder().decode(calls[0].init.body as ArrayBuffer)).toBe(body);
    expect(sent().get("content-type")).toBe("application/json");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("the Authorization header and the query string are forwarded; a GET has no body", async () => {
    await GET(browser("health?x=1&y=two", { headers: { authorization: "Bearer t0ken" } }), ctx("health"));
    expect(calls[0].url).toBe("https://api.example.test/api/health?x=1&y=two");
    expect(sent().get("authorization")).toBe("Bearer t0ken");
    expect(calls[0].init.body).toBeUndefined();
  });

  it("the server's status, body and rate-limit headers pass through; its other headers don't", async () => {
    answer = async () => new Response(JSON.stringify({ error: "Too many requests. Please wait a few minutes and try again." }), { status: 429, headers: { "content-type": "application/json", "ratelimit-remaining": "0", "ratelimit-reset": "600", "retry-after": "600", "x-powered-by": "Express", "set-cookie": "a=b" } });
    const res = await POST(browser("auth/check-email", { method: "POST", body: "{}" }), ctx("auth", "check-email"));
    expect(res.status).toBe(429);
    expect((await res.json()).error).toMatch(/^Too many requests/);
    expect(res.headers.get("ratelimit-remaining")).toBe("0");
    expect(res.headers.get("retry-after")).toBe("600");
    expect(res.headers.get("x-powered-by")).toBeNull();
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("a 204 with no body passes through (client error reports)", async () => {
    answer = async () => new Response(null, { status: 204 });
    const res = await POST(browser("client-errors", { method: "POST", body: "{}" }), ctx("client-errors"));
    expect(res.status).toBe(204);
  });

  it("DELETE carries its body (deleting the backup)", async () => {
    await DELETE(browser("sync", { method: "DELETE", body: JSON.stringify({ email: "a@example.com" }), headers: { "content-type": "application/json" } }), ctx("sync"));
    expect(calls[0].init.method).toBe("DELETE");
    expect(new TextDecoder().decode(calls[0].init.body as ArrayBuffer)).toContain("a@example.com");
  });

  it("a 2 MB push is forwarded whole", async () => {
    const body = JSON.stringify({ data: "x".repeat(2 * 1024 * 1024) });
    await POST(browser("sync/push", { method: "POST", body, headers: { "content-type": "application/json" } }), ctx("sync", "push"));
    expect((calls[0].init.body as ArrayBuffer).byteLength).toBe(new TextEncoder().encode(body).byteLength);
  });

  it("with API_URL unset or empty it forwards to the local server, never somewhere else", async () => {
    delete process.env.API_URL;
    await GET(browser("health"), ctx("health"));
    process.env.API_URL = "";
    await GET(browser("health"), ctx("health"));
    expect(calls.map((c) => c.url)).toEqual(["http://localhost:4000/api/health", "http://localhost:4000/api/health"]);
  });

  it("path parts are encoded, and a part that would climb out of /api is refused without calling the server", async () => {
    await GET(browser("x"), ctx("sync", "a b?c#d"));
    expect(calls[0].url).toBe("https://api.example.test/api/sync/a%20b%3Fc%23d");
    calls = [];
    for (const bad of [["..", "admin"], ["sync", ".."], ["."], ["sync", ""], ["a/b"], ["a\\b"]]) {
      const res = await GET(browser("x"), ctx(...bad));
      expect(res.status, JSON.stringify(bad)).toBe(404);
    }
    expect(calls).toHaveLength(0);
  });

  it("when the server can't be reached, the answer is a plain 502 that isn't ESSA's JSON (the app shows its server-trouble line)", async () => {
    answer = async () => { throw new TypeError("fetch failed"); };
    const res = await forward(browser("sync/pull", { method: "POST", body: "{}" }), ["sync", "pull"]);
    expect(res.status).toBe(502);
    expect(res.headers.get("content-type")).toMatch(/^text\/plain/);
    expect(await res.text()).not.toContain("{");
  });
});

describe("who is calling: the two headers", () => {
  it("with the secret set, on Vercel: the secret and the address Vercel saw are added", async () => {
    await POST(browser("sync/push", { method: "POST", body: "{}", headers: { "x-vercel-forwarded-for": "203.0.113.5" } }), ctx("sync", "push"));
    expect(sent().get("x-essa-proxy-key")).toBe(KEY);
    expect(sent().get("x-essa-client-ip")).toBe("203.0.113.5");
  });

  it("only the first address of a list is named", async () => {
    await GET(browser("health", { headers: { "x-vercel-forwarded-for": "203.0.113.5, 10.0.0.1" } }), ctx("health"));
    expect(sent().get("x-essa-client-ip")).toBe("203.0.113.5");
  });

  it("what the browser sends under those names is dropped, never forwarded", async () => {
    await GET(browser("health", { headers: { "x-essa-proxy-key": "planted", "x-essa-client-ip": "198.51.100.7", "x-vercel-forwarded-for": "203.0.113.5" } }), ctx("health"));
    expect(sent().get("x-essa-proxy-key")).toBe(KEY);
    expect(sent().get("x-essa-client-ip")).toBe("203.0.113.5");
    delete process.env.ESSA_PROXY_KEY;
    calls = [];
    await GET(browser("health", { headers: { "x-essa-proxy-key": "planted", "x-essa-client-ip": "198.51.100.7" } }), ctx("health"));
    expect(sent().get("x-essa-proxy-key")).toBeNull();
    expect(sent().get("x-essa-client-ip")).toBeNull();
  });

  it("with no secret, or one shorter than 32 characters, neither header is sent", async () => {
    for (const k of [undefined, "", "short-secret"]) {
      if (k === undefined) delete process.env.ESSA_PROXY_KEY; else process.env.ESSA_PROXY_KEY = k;
      calls = [];
      await GET(browser("health", { headers: { "x-vercel-forwarded-for": "203.0.113.5" } }), ctx("health"));
      expect(sent().get("x-essa-proxy-key"), String(k)).toBeNull();
      expect(sent().get("x-essa-client-ip"), String(k)).toBeNull();
    }
  });

  it("off Vercel (a local run), a browser could set x-vercel-forwarded-for itself, so no address is named", async () => {
    delete process.env.VERCEL;
    await GET(browser("health", { headers: { "x-vercel-forwarded-for": "203.0.113.5" } }), ctx("health"));
    expect(sent().get("x-essa-client-ip")).toBeNull();
    expect(sent().get("x-essa-proxy-key")).toBeNull();
  });

  it("with no address from Vercel, the secret isn't sent either (nothing to vouch for)", async () => {
    await GET(browser("health"), ctx("health"));
    expect(sent().get("x-essa-proxy-key")).toBeNull();
    expect(sent().get("x-essa-client-ip")).toBeNull();
  });

  it("Vercel's own headers, cookies and the forwarded-for chain aren't passed on", async () => {
    await GET(browser("health", { headers: { "x-vercel-forwarded-for": "203.0.113.5", "x-forwarded-for": "203.0.113.5", "x-real-ip": "203.0.113.5", cookie: "a=b", "x-vercel-id": "abc" } }), ctx("health"));
    for (const h of ["x-vercel-forwarded-for", "x-forwarded-for", "x-real-ip", "cookie", "x-vercel-id"]) expect(sent().get(h), h).toBeNull();
  });

  it("the secret is in no response header or body", async () => {
    const res = await GET(browser("health", { headers: { "x-vercel-forwarded-for": "203.0.113.5" } }), ctx("health"));
    const all = JSON.stringify([...res.headers.entries()]) + (await res.text());
    expect(all).not.toContain(KEY);
  });
});
