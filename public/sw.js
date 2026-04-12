// Self-unregistering service worker — pure network passthrough.
// If you ever see stale behavior, visit /unregister-sw to nuke caches.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", async (e) => {
  e.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", (e) => {
  e.respondWith(fetch(e.request, { cache: "no-store" }).catch(() => new Response("offline", { status: 503 })));
});
