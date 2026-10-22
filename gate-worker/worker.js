/* ABC Loading Gate — separate link for the loading-area phone.
   • Serves only the scanner page (public/): index.html (= tools/gate.html of the hub), common.js, tools.css, jsqr.min.js, icons
   • /api/{login|pair|me|lookup|decide|day} → the hub, through the private service binding, with GATE_KEY
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
const ALLOWED = /^(login|pair|me|lookup|decide|day)$/;
/* the sign-in is also kept in a cookie set by this link (HttpOnly, 90 days, renewed on use): iPhone keeps it even when
   the page's own storage is cleared, so the guards are not asked to sign in again */
const CK = "gate_t", CK_AGE = 90 * 86400;
const cookieOf = req => { const m = /(?:^|;\s*)gate_t=([0-9a-f]{64})/.exec(req.headers.get("cookie") || ""); return m ? m[1] : ""; };
const setCk = t => t ? `${CK}=${t}; Max-Age=${CK_AGE}; Path=/; HttpOnly; Secure; SameSite=Strict` : `${CK}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict`;

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
      const ag = request.headers.get("x-gate-agent"); if (ag) h.set("x-gate-agent", ag.slice(0, 300));
      const bearer = (/^Bearer\s+([0-9a-f]{64})$/i.exec(request.headers.get("authorization") || "") || [])[1] || "";
      const tok = bearer || cookieOf(request);
      if (tok && p !== "login" && p !== "pair") h.set("authorization", "Bearer " + tok);
      const body = request.method === "POST" ? (await request.text()).slice(0, 20000) : undefined;
      let r;
      try { r = await env.HUB.fetch(new Request(`https://operations-hub.internal/api/gate-ext/${p}${url.search}`, { method: request.method, headers: h, body })); }
      catch (e) { return jsonErr("The hub cannot be reached right now", 502); }
      const out = { "content-type": "application/json", "cache-control": "no-store" };
      let text = await r.text();
      if ((p === "login" || p === "pair") && r.ok) { try { const j = JSON.parse(text); if (j && j.ok && j.data && j.data.token) out["set-cookie"] = setCk(j.data.token); } catch {} }
      else if (r.status === 401 && tok) out["set-cookie"] = setCk("");            // the hub said clearly: signed out
      else if (p === "me" && r.ok && tok) out["set-cookie"] = setCk(tok);         // renew on use
      return withSec(new Response(text, { status: r.status, headers: out }));
    }
    if (url.pathname === "/index.html") return Response.redirect(new URL("/", url), 301);
    const r = await env.ASSETS.fetch(request);
    return withSec(r, url.pathname === "/" || url.pathname === "/sw.js" ? { "cache-control": "no-cache" } : {});
  }
};
