const CACHE = "rz-chat-v9";

self.addEventListener("install", (e) => {
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  const h = url.hostname;

  if (h.includes("supabase") || h.includes("googleapis") ||
      h.includes("gstatic") || h.includes("firebaseio") ||
      h.includes("jsdelivr")) return;

  e.respondWith((async () => {
    try {
      const fresh = await fetch(req);
      const cache = await caches.open(CACHE);
      cache.put(req, fresh.clone()).catch(() => {});
      return fresh;
    } catch (err) {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      if (req.mode === "navigate") {
        const idx = await cache.match("./index.html");
        if (idx) return idx;
      }
      throw err;
    }
  })());
});
