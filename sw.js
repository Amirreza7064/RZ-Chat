/* 🧹 RZ-Chat Service Worker — همیشه اول شبکه، کش فقط برای آفلاین */

const CACHE = "rz-chat-v10";

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

  // فقط فایل‌های خود سایت — بقیه (سوپابیس، jsdelivr و...) دست نزن
  if (url.origin !== location.origin) return;

  e.respondWith((async () => {
    try {
      // no-cache یعنی: همیشه از سرور بپرس عوض شده یا نه — دیگه CSS کهنه نداریم!
      const fresh = await fetch(req, { cache: "no-cache" });
      const cache = await caches.open(CACHE);
      cache.put(req, fresh.clone()).catch(() => {});
      return fresh;
    } catch (err) {
      const hit = await caches.match(req);
      if (hit) return hit;
      if (req.mode === "navigate") {
        const idx = await caches.match("./index.html");
        if (idx) return idx;
      }
      throw err;
    }
  })());
});
