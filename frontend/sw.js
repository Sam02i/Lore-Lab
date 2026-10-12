/* Lore Lab service worker.
   - Precaches the offline page so it can be shown when there is no network.
   - Page loads: network first; if the network fails, show offline.html.
   - Never touches /api/ requests or non-GET requests (looks and scorecards must always be live).
   Bump VERSION whenever offline.html or PRECACHE changes. */
const VERSION = "lore-offline-v1";
const OFFLINE_URL = "offline.html";
const PRECACHE = [OFFLINE_URL];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname.startsWith("/api/")) return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() => caches.match(OFFLINE_URL))
    );
  }
});
