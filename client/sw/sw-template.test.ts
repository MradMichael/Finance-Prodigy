// Owner, session 34 (decision 26): the generated worker, run in a sandbox with fake caches, network and pages.
// Precache at install under the build's name; old ESSA caches deleted on activate; the build's files and pages
// from the cache; /api/*, other methods and other sites never touched; the PDF worker stored on first use; a new
// worker takes over only when Reload asks (SKIP_WAITING). The kill switch empties ESSA's caches and unregisters.
import { describe, it, expect, vi } from "vitest";
import path from "path";
import vm from "vm";
import { renderWorker } from "./build-sw.mjs";

const ORIGIN = "https://essa.test";
const templateDir = path.join(process.cwd(), "sw");
const MANIFEST = { build: "b1", pages: ["/", "/profile"], files: ["/_next/static/chunks/main.js", "/icon-192.png"] };

class FakeCache {
  store = new Map<string, Response>();
  async match(key: string | { url: string }) { const r = this.store.get(abs(key)); return r ? r.clone() : undefined; }
  async put(key: string | { url: string }, res: Response) { this.store.set(abs(key), res); }
}
const abs = (key: string | { url: string }) => new URL(typeof key === "string" ? key : key.url, ORIGIN).href;

function sandbox({ caches: existing = [] as string[], failing = [] as string[] } = {}) {
  const listeners: Record<string, ((e: unknown) => void)[]> = {};
  const cacheMap = new Map<string, FakeCache>(existing.map((n) => [n, new FakeCache()]));
  const caches = {
    open: vi.fn(async (n: string) => { if (!cacheMap.has(n)) cacheMap.set(n, new FakeCache()); return cacheMap.get(n)!; }),
    keys: vi.fn(async () => [...cacheMap.keys()]),
    delete: vi.fn(async (n: string) => cacheMap.delete(n)),
  };
  const fetched: string[] = [];
  const fetch = vi.fn(async (req: string | { url: string }) => {
    const url = abs(req);
    fetched.push(url);
    if (failing.some((f) => url.endsWith(f))) return new Response("nope", { status: 500 });
    return new Response(`body of ${new URL(url).pathname}`, { status: 200 });
  });
  const self = {
    location: { origin: ORIGIN, href: `${ORIGIN}/sw.js` },
    addEventListener: (t: string, fn: (e: unknown) => void) => { (listeners[t] ??= []).push(fn); },
    skipWaiting: vi.fn(async () => {}),
    clients: { claim: vi.fn(async () => {}) },
    registration: { unregister: vi.fn(async () => true) },
  };
  class Request { url: string; cache?: string; method = "GET"; mode = "cors"; constructor(u: string | URL, init?: { cache?: string }) { this.url = new URL(String(u), ORIGIN).href; this.cache = init?.cache; } }
  return { listeners, cacheMap, caches, fetch, fetched, self, Request };
}

function load(kill = false, opts?: Parameters<typeof sandbox>[0]) {
  const sb = sandbox(opts);
  const src = renderWorker({ manifest: kill ? null : MANIFEST, kill, templateDir });
  vm.runInNewContext(src, { self: sb.self, caches: sb.caches, fetch: sb.fetch, Request: sb.Request, Response, URL, Promise, console });
  const fire = async (type: string, extra: Record<string, unknown> = {}) => {
    let waited: Promise<unknown> | undefined; let responded: Promise<Response> | undefined;
    const e = { ...extra, waitUntil: (p: Promise<unknown>) => { waited = p; }, respondWith: (p: Promise<Response>) => { responded = p; } };
    for (const fn of sb.listeners[type] ?? []) fn(e);
    return { waited, responded };
  };
  const get = (pathname: string, mode = "cors", method = "GET", origin = ORIGIN) => fire("fetch", { request: { url: `${origin}${pathname}`, mode, method } });
  return { ...sb, fire, get };
}

describe("install", () => {
  it("stores every page and file under the build's cache, asking past the browser's own cache", async () => {
    const w = load();
    const { waited } = await w.fire("install");
    await waited;
    const cache = w.cacheMap.get("essa-static-b1")!;
    expect([...cache.store.keys()].sort()).toEqual([`${ORIGIN}/`, `${ORIGIN}/_next/static/chunks/main.js`, `${ORIGIN}/icon-192.png`, `${ORIGIN}/profile`]);
    expect(w.fetch.mock.calls.every(([r]) => (r as { cache?: string }).cache === "reload")).toBe(true);
  });

  it("fails whole if one file fails, so the old worker stays", async () => {
    const w = load(false, { failing: ["/icon-192.png"] });
    const { waited } = await w.fire("install");
    await expect(waited).rejects.toThrow();
  });
});

describe("activate", () => {
  it("deletes older ESSA caches only, then takes control of open pages", async () => {
    const w = load(false, { caches: ["essa-static-b0", "essa-runtime-b0", "essa-static-b1", "someone-else"] });
    const { waited } = await w.fire("activate");
    await waited;
    expect([...w.cacheMap.keys()].sort()).toEqual(["essa-static-b1", "someone-else"]);
    expect(w.self.clients.claim).toHaveBeenCalled();
  });
});

describe("fetch", () => {
  const installed = async () => { const w = load(); await (await w.fire("install")).waited; w.fetched.length = 0; return w; };

  it("the build's files come from the cache, without the network", async () => {
    const w = await installed();
    const { responded } = await w.get("/_next/static/chunks/main.js");
    expect(await (await responded!).text()).toBe("body of /_next/static/chunks/main.js");
    expect(w.fetched).toEqual([]);
  });

  it("a page navigation is answered from the cached page, so the app opens offline", async () => {
    const w = await installed();
    const { responded } = await w.get("/profile", "navigate");
    expect(await (await responded!).text()).toBe("body of /profile");
    expect(w.fetched).toEqual([]);
  });

  it("a page's address with a trailing slash finds the same cached page", async () => {
    const w = await installed();
    const { responded } = await w.get("/profile/", "navigate");
    expect(await (await responded!).text()).toBe("body of /profile");
  });

  it("a navigation to a page not cached goes to the network", async () => {
    const w = await installed();
    const { responded } = await w.get("/admin", "navigate");
    expect(responded).toBeUndefined();
  });

  it("never touches /api, a POST, or another site", async () => {
    const w = await installed();
    for (const [p, mode, method, origin] of [["/api/sync/pull", "cors", "GET", ORIGIN], ["/api", "cors", "GET", ORIGIN], ["/_next/static/chunks/main.js", "cors", "POST", ORIGIN], ["/_next/static/chunks/main.js", "cors", "GET", "https://elsewhere.test"]] as const) {
      expect((await w.get(p, mode, method, origin)).responded).toBeUndefined();
    }
  });

  it("a page's data request (not a navigation) isn't answered from the page cache", async () => {
    const w = await installed();
    expect((await w.get("/profile?_rsc=abc", "cors")).responded).toBeUndefined();
  });

  it("the PDF worker is stored on its first use, then served from the cache", async () => {
    const w = await installed();
    const first = await w.get("/pdf.worker.min.mjs");
    expect(await (await first.responded!).text()).toBe("body of /pdf.worker.min.mjs");
    expect(w.fetched).toEqual([`${ORIGIN}/pdf.worker.min.mjs`]);
    w.fetched.length = 0;
    const second = await w.get("/pdf.worker.min.mjs");
    expect(await (await second.responded!).text()).toBe("body of /pdf.worker.min.mjs");
    expect(w.fetched).toEqual([]);
    expect(w.cacheMap.has("essa-runtime-b1")).toBe(true);
  });
});

describe("taking over", () => {
  it("only when Reload asks (SKIP_WAITING), never on install", async () => {
    const w = load();
    await (await w.fire("install")).waited;
    expect(w.self.skipWaiting).not.toHaveBeenCalled();
    await w.fire("message", { data: { type: "SKIP_WAITING" } });
    expect(w.self.skipWaiting).toHaveBeenCalled();
  });
});

describe("the kill switch", () => {
  it("deletes every ESSA cache, leaves others, unregisters, and answers no request", async () => {
    const w = load(true, { caches: ["essa-static-b1", "essa-runtime-b1", "someone-else"] });
    await (await w.fire("install")).waited;
    await (await w.fire("activate")).waited;
    expect([...w.cacheMap.keys()]).toEqual(["someone-else"]);
    expect(w.self.registration.unregister).toHaveBeenCalled();
    expect((await w.get("/", "navigate")).responded).toBeUndefined();
  });
});
