// Sultan's Head Office board — online read-only copy (worker abc-head-office)
// Opens only with ?key=<HO_KEY> (then remembered by a cookie for 30 days).
// public/data.enc holds the board data gzipped + AES-256-GCM encrypted (key = SHA-256 of HO_KEY),
// because this repo is public. The worker decrypts it and puts it straight into the page (and /data.json).
// HO_KEY is a Worker secret, set by .github/workflows/head-office.yml from the GitHub secret HO_KEY.

const enc = new TextEncoder();
const NO_STORE = { "cache-control": "no-store", "x-robots-tag": "noindex, nofollow", "referrer-policy": "no-referrer" };
const TEXT = { ...NO_STORE, "content-type": "text/plain; charset=utf-8" };

// tolerate stray spaces, line breaks, quotes or backticks around a pasted key
const clean = (s) => String(s || "").trim().replace(/^[`'"]+|[`'"]+$/g, "").trim();
async function sha256(s) { return new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s))); }
const hex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, "0")).join("");
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function same(a, b) { // constant-time compare of two strings (via their hashes)
  const [x, y] = await Promise.all([sha256(String(a)), sha256(String(b))]);
  return crypto.subtle.timingSafeEqual(x, y);
}

async function decrypt(env, req, KEY) {
  const r = await env.ASSETS.fetch(new Request(new URL("/data.enc", req.url)));
  if (!r.ok) throw new Error("data.enc missing");
  const { v, iv, ct } = await r.json();
  const key = await crypto.subtle.importKey("raw", await sha256(KEY), "AES-GCM", false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(iv) }, key, b64(ct));
  if (v !== 2) return new Uint8Array(plain); // v1 = not compressed
  return new Uint8Array(await new Response(new Blob([plain]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
}

// the page with the board data already inside, so it shows even if the browser blocks the cookie
async function page(env, req, KEY, extra = {}) {
  const r = await env.ASSETS.fetch(new Request(new URL("/index.html", req.url)));
  let html = await r.text(), inject;
  try {
    const json = new TextDecoder().decode(await decrypt(env, req, KEY));
    JSON.parse(json);
    inject = `<script>try{bootLive(${json.replace(/</g, "\\u003c")},true)}catch(e){}</script>`;
  } catch (e) {
    inject = `<script>exampleTag.hidden=false;exampleTag.textContent="BOARD DATA COULD NOT BE OPENED \u00b7 HO_KEY DOES NOT MATCH THE KEY THE DATA WAS LOCKED WITH";</script>`;
  }
  html = html.includes("</body>") ? html.replace("</body>", inject + "</body>") : html + inject;
  return new Response(html, { headers: { ...NO_STORE, ...extra, "content-type": "text/html; charset=utf-8" } });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const KEY = clean(env.HO_KEY);
    if (!KEY) return new Response("Head Office is not configured yet (HO_KEY secret missing).", { status: 503, headers: TEXT });

    const token = hex(await sha256(KEY + ":view"));
    const qkRaw = url.searchParams.get("key");
    const ck = (req.headers.get("cookie") || "").match(/(?:^|;\s*)ho=([0-9a-f]{64})/);
    const cookie = `ho=${token}; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax`;

    let ok = false, setCookie = false;
    if (qkRaw !== null) {
      const qk = clean(qkRaw);
      if (!(await same(qk, KEY)))
        return new Response(`Locked: wrong key (the link has ${qk.length} characters, the site expects ${KEY.length}).`, { status: 401, headers: TEXT });
      ok = true; setCookie = true;
    } else if (ck && (await same(ck[1], token))) ok = true;
    if (!ok) return new Response("Locked: open the link that includes ?key=", { status: 401, headers: TEXT });

    const extra = setCookie ? { "set-cookie": cookie } : {};
    if (url.pathname === "/data.json") {
      try {
        return new Response(await decrypt(env, req, KEY), { headers: { ...NO_STORE, ...extra, "content-type": "application/json; charset=utf-8" } });
      } catch (e) {
        return new Response(JSON.stringify({ error: "Board data could not be read" }), { status: 500, headers: { ...NO_STORE, "content-type": "application/json" } });
      }
    }
    if (url.pathname === "/" || url.pathname === "/index.html") return page(env, req, KEY, extra);
    return new Response("Not found", { status: 404, headers: TEXT });
  },
};
