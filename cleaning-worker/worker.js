/* ABC Cleaning — separate link for the cleaning company's phones (cleaner supervisors and the company manager).
   • Serves only the cleaner app (public/)
   • /api/{pair|me|login|today|job|photo} → modules/cleanctl.js (shared with the hub), D1 = the hub database
   • /photo/<key>?e=&s= → a before / after photo from R2, only with a link signed by the hub
   Nothing else of the hub can be reached from this link.   See docs/FEATURE-cleaning-app.md */
import { ccSchema, ccAppRoute, ccPhoto, ccPurge } from "../modules/cleanctl.js";

const SEC = {
  "content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; object-src 'none'",
  "permissions-policy": "camera=(self), microphone=(), geolocation=(), payment=(), usb=()",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "x-robots-tag": "noindex, nofollow",
  "strict-transport-security": "max-age=31536000"
};
const withSec = (r, extra = {}) => { const h = new Headers(r.headers); for (const [k, v] of Object.entries({ ...SEC, ...extra })) h.set(k, v); return new Response(r.body, { status: r.status, headers: h }); };
const json = (o, status = 200) => withSec(new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } }));
let ready = false;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/photo/")) {   // signed link from the hub (6 hours)
      if (!env.DB) return new Response("Not found", { status: 404 });
      const obj = await ccPhoto(env, env.PHOTOS, decodeURIComponent(url.pathname.slice(7)), url).catch(() => null);
      if (!obj) return new Response("Not found", { status: 404 });
      return new Response(obj.body, { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=21600", "access-control-allow-origin": "*", "x-content-type-options": "nosniff" } });
    }
    if (url.pathname.startsWith("/api/")) {
      const p = url.pathname.slice(5).replace(/\/+$/, "");
      if (!/^(pair|me|login|today|job|photo)$/.test(p)) return json({ ok: false, error: "Not found" }, 404);
      if (!["GET", "POST", "PUT"].includes(request.method)) return json({ ok: false, error: "Not allowed" }, 405);
      if (request.method !== "GET") { const o = request.headers.get("origin"); if (o && o !== url.origin) return json({ ok: false, error: "Request blocked" }, 403); }
      if (!env.DB) return json({ ok: false, error: "The cleaning app is not connected to the hub database yet." }, 503);
      try {
        if (!ready) { await ccSchema(env); ready = true; }
        return json({ ok: true, data: await ccAppRoute(env, request, p, { R2: env.PHOTOS }) });
      } catch (e) { return json({ ok: false, error: String(e && e.message || e) }, e && e.status || 500); }
    }
    if (url.pathname === "/index.html") return Response.redirect(new URL("/", url), 301);
    const r = await env.ASSETS.fetch(request);
    return withSec(r, url.pathname === "/" || url.pathname === "/sw.js" ? { "cache-control": "no-cache" } : {});
  },
  async scheduled(event, env, ctx) {   // every night: photos older than 90 days are deleted
    ctx.waitUntil((async () => { if (env.DB) { await ccSchema(env); await ccPurge(env, env.PHOTOS); } })());
  }
};
