/* ABC Loading Gate — keeps the scanner page on the phone so it opens without signal (network first, never caches /api) */
const CACHE = "abc-gate-v1";
const SHELL = ["/", "/common.js", "/tools.css", "/jsqr.min.js", "/manifest.webmanifest", "/icons/abc-48.png", "/icons/abc-192.png"];
self.addEventListener("install", e => e.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting())));
self.addEventListener("activate", e => e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== CACHE).map(x => caches.delete(x)))).then(() => self.clients.claim())));
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); } return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match("/"))));
});
