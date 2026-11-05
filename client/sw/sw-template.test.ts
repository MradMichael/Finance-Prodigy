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

function load(kill = false, opts?: Parameters<typeof sandbox>[0], manifest: object = MANIFEST) {
  const sb = sandbox(opts);
  const src = renderWorker({ manifest: kill ? null : (manifest as typeof MANIFEST), kill, templateDir });
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
    // Session 35: plus the build's list of hashes, kept for the next deploy.
    expect([...cache.store.keys()].sort()).toEqual([`${ORIGIN}/`, `${ORIGIN}/__essa/manifest`, `${ORIGIN}/_next/static/chunks/main.js`, `${ORIGIN}/icon-192.png`, `${ORIGIN}/profile`]);
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

  // Travel map plan, Phase 1b (D6).
  it("the city file is stored on its first use, then served from the cache", async () => {
    const w = await installed();
    const first = await w.get("/geo/cities15000.json");
    expect(await (await first.responded!).text()).toBe("body of /geo/cities15000.json");
    expect(w.fetched).toEqual([`${ORIGIN}/geo/cities15000.json`]);
    w.fetched.length = 0;
    const second = await w.get("/geo/cities15000.json");
    expect(await (await second.responded!).text()).toBe("body of /geo/cities15000.json");
    expect(w.fetched).toEqual([]);
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

// Session 35 (owner): across deploys, a file whose content hasn't changed is copied from the previous cache, not
// downloaded again; only changed files and the app shell (the pages) are fetched.
describe("reuse across deploys", () => {
  const NEXT = {
    build: "b2", pages: ["/"],
    files: ["/_next/static/chunks/main.js", "/icon-192.png", "/_next/static/chunks/new.js"],
    hashes: { "/_next/static/chunks/main.js": "1111111111111111", "/icon-192.png": "2222222222222222", "/_next/static/chunks/new.js": "3333333333333333" },
  };
  const previous = (w: ReturnType<typeof load>, hashes: Record<string, string>) => {
    const old = new FakeCache();
    old.store.set(`${ORIGIN}/_next/static/chunks/main.js`, new Response("main, as built last time"));
    old.store.set(`${ORIGIN}/icon-192.png`, new Response("the old icon"));
    old.store.set(`${ORIGIN}/__essa/manifest`, new Response(JSON.stringify(hashes)));
    w.cacheMap.set("essa-static-b1", old);
  };

  it("an unchanged file is copied, body and all; a changed one, a new one and the pages are fetched", async () => {
    const w = load(false, {}, NEXT);
    previous(w, { "/_next/static/chunks/main.js": "1111111111111111", "/icon-192.png": "9999999999999999" });
    await (await w.fire("install")).waited;
    expect(w.fetched.sort()).toEqual([`${ORIGIN}/`, `${ORIGIN}/_next/static/chunks/new.js`, `${ORIGIN}/icon-192.png`]);
    const cache = w.cacheMap.get("essa-static-b2")!;
    expect(await (await cache.match("/_next/static/chunks/main.js"))!.text()).toBe("main, as built last time");
    expect(await (await cache.match("/icon-192.png"))!.text()).toBe("body of /icon-192.png");
  });

  it("the new cache keeps its own list of hashes for the next deploy", async () => {
    const w = load(false, {}, NEXT);
    await (await w.fire("install")).waited;
    const meta = await w.cacheMap.get("essa-static-b2")!.match("/__essa/manifest");
    expect(JSON.parse(await meta!.text())).toEqual(NEXT.hashes);
  });

  it("with no previous cache, everything is fetched, as before", async () => {
    const w = load(false, {}, NEXT);
    await (await w.fire("install")).waited;
    expect(w.fetched.length).toBe(4);
  });

  it("a previous cache without a list of hashes is never trusted", async () => {
    const w = load(false, {}, NEXT);
    const old = new FakeCache();
    old.store.set(`${ORIGIN}/_next/static/chunks/main.js`, new Response("unknown provenance"));
    w.cacheMap.set("essa-static-b1", old);
    await (await w.fire("install")).waited;
    expect(w.fetched).toContain(`${ORIGIN}/_next/static/chunks/main.js`);
  });

  it("the list of hashes is never answered to a page", async () => {
    const w = load(false, {}, NEXT);
    await (await w.fire("install")).waited;
    expect((await w.get("/__essa/manifest")).responded).toBeUndefined();
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
