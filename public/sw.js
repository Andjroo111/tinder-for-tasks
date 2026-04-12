self.addEventListener("install", (e) => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
// Network-first, no cache
self.addEventListener("fetch", (e) => {
  e.respondWith(fetch(e.request).catch(() => new Response("offline", { status: 503 })));
});
