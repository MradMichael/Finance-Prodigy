// Deliberately does NOT cache anything. Its only job is to exist with a
// fetch handler, which is what Chrome/Android's "installable" criteria
// check for — real offline caching is a real correctness risk for a
// finance app (a user could see stale data or a stale build after a
// deploy and not know it), so that's a conscious non-goal here, not an
// oversight. Every request just passes straight through to the network.
self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});
