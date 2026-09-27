/* ABC Operations Hub — service worker
   • Caches the hub shell only (never /api or the embedded systems), network-first.
   • Shows push alerts on the laptop / phone lock screen and opens the right system on tap. */
const CACHE = "abc-hub-v7";
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
  const opts = {
    body: d.body || "",
    icon: "/icons/abc-192.png",
    badge: "/icons/abc-48.png",
    tag: d.tag || undefined,
    renotify: !!d.tag,
    requireInteraction: d.tone === "alert",
    data: { url: d.url || "/" }
  };
  /* Emergency Alert feature: stays on screen, vibrates SOS, "I'm on it" button, and wakes any open hub window */
  if (d.emergency) Object.assign(opts, {
    requireInteraction: true, renotify: true, silent: false, vibrate: d.emergency.vibrate || [500, 200, 500, 200, 500],
    actions: [{ action: "ack", title: "I'm on it" }, { action: "open", title: "Open" }],
    data: { url: d.url || "/", emergency: d.emergency.id }
  });
  e.waitUntil((async () => {
    await self.registration.showNotification(d.title || "ABC Operations Hub", opts);
    if (d.emergency || d.allClear) {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      wins.forEach(w => w.postMessage({ type: d.emergency ? "emergency" : "allclear", id: (d.emergency || d.allClear).id }));
    }
  })());
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const data = e.notification.data || {};
  if (e.action === "ack" && data.emergency) {
    e.waitUntil(fetch("/api/ops/emergency/ack", { method: "POST", credentials: "include", headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: data.emergency }) })
      .then(r => self.registration.showNotification(r.ok ? "Acknowledged — thank you" : "Could not acknowledge — open the hub",
        { body: r.ok ? "The manager can see you are on it." : "Tap to open the alert.", icon: "/icons/abc-192.png", badge: "/icons/abc-48.png",
          tag: "emg-ack", data: { url: data.url } }))
      .catch(() => {}));
    return;
  }
  const target = new URL(data.url || "/", self.location.origin).href;
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
