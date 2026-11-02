// ESSA's service-worker kill switch (owner, session 34, decision 26). Written to public/sw.js instead of the
// caching worker when the build runs with ESSA_SW_KILL=1. It replaces any installed worker at once, deletes
// every ESSA cache (other sites' caches are left alone) and unregisters itself. It answers no request, so
// everything goes to the network, as before caching. This is how caching is reversed: reverting the code alone
// would leave installed workers and their caches behind.
self.addEventListener("install", () => { self.skipWaiting(); });

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys()
    .then((names) => Promise.all(names.filter((n) => n.startsWith("essa-")).map((n) => caches.delete(n))))
    .then(() => self.registration.unregister()));
});
