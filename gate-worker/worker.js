/* ABC Loading Gate — separate link for the loading-area phone.
   • Serves only the scanner page (public/): index.html (= tools/gate.html of the hub), common.js, tools.css, jsqr.min.js, icons
   • /api/{pair|me|lookup|decide|day} → the hub, through the private service binding, with GATE_KEY
   Nothing else of the hub can be reached from this link. */
const SEC = {
  "content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; object-src 'none'",
  "permissions-policy": "camera=(self), microphone=(), geolocation=(), payment=(), usb=()",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "x-robots-tag": "noindex, nofollow",
  "strict-transport-security": "max-age=31536000"
};
const withSec = (r, extra = {}) => { const h = new Headers(r.headers); for (const [k, v] of Object.entries({ ...SEC, ...extra })) h.set(k, v); return new Response(r.body, { status: r.status, headers: h }); };
const jsonErr = (msg, status) => withSec(new Response(JSON.stringify({ ok: false, error: msg }), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } }));
const ALLOWED = /^(pair|me|lookup|decide|day)$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      const p = url.pathname.slice(5).replace(/\/+$/, "");
      if (!ALLOWED.test(p)) return jsonErr("Not found", 404);
      if (!["GET", "POST"].includes(request.method)) return jsonErr("Not allowed", 405);
      if (request.method === "POST") {
        const o = request.headers.get("origin");
        if (o && o !== url.origin) return jsonErr("Request blocked", 403);
      }
      if (!env.GATE_KEY || !env.HUB) return jsonErr("The Loading Gate is not set up yet (GATE_KEY / HUB binding missing).", 503);
      const h = new Headers({ "content-type": "application/json", "x-gate-key": env.GATE_KEY, "x-gate-ip": request.headers.get("cf-connecting-ip") || "" });
      for (const k of ["authorization", "x-gate-agent"]) { const v = request.headers.get(k); if (v) h.set(k, v.slice(0, 300)); }
      const body = request.method === "POST" ? (await request.text()).slice(0, 20000) : undefined;
      try {
        const r = await env.HUB.fetch(new Request(`https://operations-hub.internal/api/gate-ext/${p}${url.search}`, { method: request.method, headers: h, body }));
        return withSec(new Response(r.body, { status: r.status, headers: { "content-type": "application/json", "cache-control": "no-store" } }));
      } catch (e) { return jsonErr("The hub cannot be reached right now", 502); }
    }
    if (url.pathname === "/index.html") return Response.redirect(new URL("/", url), 301);
    const r = await env.ASSETS.fetch(request);
    return withSec(r, url.pathname === "/" || url.pathname === "/sw.js" ? { "cache-control": "no-cache" } : {});
  }
};
