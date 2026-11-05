// ESSA's service worker (owner, session 34, decision 26). GENERATED: sw/build-sw.mjs writes public/sw.js from
// this file at build time, putting this build's ID and file list in place of the MANIFEST placeholder below.
//
// It precaches the app shell and every file the build wrote, in a cache named for the build, so the app and
// every screen open offline. It never caches /api/* or any response holding data: only the build's own files
// and its static pages, which are prerendered and filled in on the device. A new build's worker waits until
// the page's "Reload" asks it to take over (SKIP_WAITING), so a page never mixes two builds.
//
// Across deploys (session 35): every listed file carries a hash of its bytes. At install, a file whose path and
// hash match the previous build's cache is copied from there instead of downloaded; only changed files and the
// pages (the app shell) are fetched. Each cache keeps its build's hashes under a reserved key, never answered.
const MANIFEST = __ESSA_MANIFEST__;
const STATIC_CACHE = "essa-static-" + MANIFEST.build;
const RUNTIME_CACHE = "essa-runtime-" + MANIFEST.build;
const PAGES = new Set(MANIFEST.pages);
const FILES = new Set(MANIFEST.files);
const ON_FIRST_USE = new Set(["/pdf.worker.min.mjs"]);
const keyOf = (pathname) => new URL(pathname, self.location.origin).href;
const HASHES = MANIFEST.hashes || {};
const HASHES_KEY = "/__essa/manifest";

// A page answered with a redirect can't be replayed for a navigation, so a redirected page is stored as a plain
// copy of where it ended up.
function storable(res) {
  return res.redirected ? res.blob().then((body) => new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers })) : res;
}

function fetchInto(cache, p) {
  return fetch(new Request(keyOf(p), { cache: "reload" })).then((res) => {
    if (!res.ok) throw new Error("precache failed: " + p + " (" + res.status + ")");
    return Promise.resolve(storable(res)).then((r) => cache.put(keyOf(p), r));
  });
}

// For each file this build lists, an older ESSA cache holding it with the same hash (from that cache's own list).
// A cache without a list is never trusted.
async function reusable() {
  const found = new Map();
  const names = (await caches.keys()).filter((n) => n.startsWith("essa-static-") && n !== STATIC_CACHE);
  for (const n of names) {
    const old = await caches.open(n);
    const list = await old.match(keyOf(HASHES_KEY));
    if (!list) continue;
    let hashes;
    try { hashes = await list.json(); } catch (e) { continue; }
    for (const p of MANIFEST.files) if (HASHES[p] && hashes[p] === HASHES[p] && !found.has(p)) found.set(p, old);
  }
  return found;
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    const reuse = await reusable();
    await Promise.all([
      ...MANIFEST.pages.map((p) => fetchInto(cache, p)),
      ...MANIFEST.files.map(async (p) => {
        const from = reuse.get(p);
        const copy = from ? await from.match(keyOf(p)) : undefined;
        if (copy) return cache.put(keyOf(p), copy);
        return fetchInto(cache, p);
      }),
    ]);
    await cache.put(keyOf(HASHES_KEY), new Response(JSON.stringify(HASHES), { headers: { "Content-Type": "application/json" } }));
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys()
    .then((names) => Promise.all(names.filter((n) => n.startsWith("essa-") && n !== STATIC_CACHE && n !== RUNTIME_CACHE).map((n) => caches.delete(n))))
    .then(() => self.clients.claim()));
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
  // PWA P5 (owner-approved, 2026-11-05): Profile's version line asks which build (and commit) this worker is.
  if (event.data && event.data.type === "VERSION" && event.ports && event.ports[0]) {
    event.ports[0].postMessage({ build: MANIFEST.build, commit: MANIFEST.commit || null });
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return; // data: never cached, never answered here
  if (url.pathname === HASHES_KEY) return; // the reserved list of hashes: the worker's own, never a page's

  if (req.mode === "navigate") {
    const page = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : url.pathname;
    if (!PAGES.has(page)) return;
    event.respondWith(caches.open(STATIC_CACHE).then((cache) => cache.match(keyOf(page))).then((hit) => hit || fetch(req)));
    return;
  }

  if (FILES.has(url.pathname) || url.pathname.startsWith("/_next/static/")) {
    // Content-hashed (or listed for this build): safe to keep, so a miss is stored too.
    event.respondWith(caches.open(STATIC_CACHE).then((cache) => cache.match(keyOf(url.pathname)).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) cache.put(keyOf(url.pathname), res.clone());
      return res;
    }))));
    return;
  }

  if (ON_FIRST_USE.has(url.pathname)) {
    event.respondWith(caches.open(RUNTIME_CACHE).then((cache) => cache.match(keyOf(url.pathname)).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) cache.put(keyOf(url.pathname), res.clone());
      return res;
    }))));
  }
});
