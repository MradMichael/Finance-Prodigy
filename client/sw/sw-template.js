// ESSA's service worker (owner, session 34, decision 26). GENERATED: sw/build-sw.mjs writes public/sw.js from
// this file at build time, putting this build's ID and file list in place of the MANIFEST placeholder below.
//
// It precaches the app shell and every file the build wrote, in a cache named for the build, so the app and
// every screen open offline. It never caches /api/* or any response holding data: only the build's own files
// and its static pages, which are prerendered and filled in on the device. A new build's worker waits until
// the page's "Reload" asks it to take over (SKIP_WAITING), so a page never mixes two builds.
const MANIFEST = __ESSA_MANIFEST__;
const STATIC_CACHE = "essa-static-" + MANIFEST.build;
const RUNTIME_CACHE = "essa-runtime-" + MANIFEST.build;
const PAGES = new Set(MANIFEST.pages);
const FILES = new Set(MANIFEST.files);
const ON_FIRST_USE = new Set(["/pdf.worker.min.mjs"]);
const keyOf = (pathname) => new URL(pathname, self.location.origin).href;

// A page answered with a redirect can't be replayed for a navigation, so a redirected page is stored as a plain
// copy of where it ended up.
function storable(res) {
  return res.redirected ? res.blob().then((body) => new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers })) : res;
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => Promise.all([...MANIFEST.pages, ...MANIFEST.files].map((p) =>
    fetch(new Request(keyOf(p), { cache: "reload" })).then((res) => {
      if (!res.ok) throw new Error("precache failed: " + p + " (" + res.status + ")");
      return Promise.resolve(storable(res)).then((r) => cache.put(keyOf(p), r));
    }),
  ))));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys()
    .then((names) => Promise.all(names.filter((n) => n.startsWith("essa-") && n !== STATIC_CACHE && n !== RUNTIME_CACHE).map((n) => caches.delete(n))))
    .then(() => self.clients.claim()));
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return; // data: never cached, never answered here

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
