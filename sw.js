/* ABC Operations Hub — service worker
   Caches the hub shell only. Never touches /api (live, signed-in data)
   or the embedded systems. Network-first so every deploy shows up at once. */
const CACHE = "abc-hub-v3";
const SHELL = ["./", "./index.html", "./apps.js", "./manifest.webmanifest",
  "./icons/abc-192.png", "./icons/abc-512.png", "./icons/abc-180.png", "./icons/abc-48.png", "./icons/abc-logo-white.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api")) return;
  e.respondWith(
    fetch(e.request, { cache: "no-cache" }).then(res => {
      if (res.ok){ const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request).then(r => r || caches.match("./index.html")))
  );
});
