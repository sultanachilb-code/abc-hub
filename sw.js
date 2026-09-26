/* ABC Operations Hub — service worker
   • Caches the hub shell only (never /api or the embedded systems), network-first.
   • Shows push alerts on the laptop / phone lock screen and opens the right system on tap. */
const CACHE = "abc-hub-v4";
const SHELL = ["./", "./index.html", "./apps.js", "./manifest.webmanifest",
  "./icons/abc-192.png", "./icons/abc-512.png", "./icons/abc-180.png", "./icons/abc-48.png", "./icons/abc-logo-white.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
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

/* ---------- push alerts ---------- */
self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || "ABC Operations Hub", {
    body: d.body || "",
    icon: "/icons/abc-192.png",
    badge: "/icons/abc-48.png",
    tag: d.tag || undefined,
    renotify: !!d.tag,
    requireInteraction: d.tone === "alert",
    data: { url: d.url || "/" }
  }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const target = new URL((e.notification.data && e.notification.data.url) || "/", self.location.origin).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins){
      if (w.url.startsWith(self.location.origin)){
        await w.focus();
        try { await w.navigate(target); } catch {}
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});
