// Self-clearing service worker. No caching. Preserves the original Request
// (including credentials mode) — bare fetch() below would strip cookies.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", async (e) => {
  e.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", (e) => {
  e.respondWith(fetch(e.request).catch(() => new Response("offline", { status: 503 })));
});
