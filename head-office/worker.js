// Sultan's Head Office board — online read-only copy (worker abc-head-office)
// Opens only with ?key=<HO_KEY> (then remembered by a cookie for 30 days).
// public/data.enc holds the board data AES-256-GCM encrypted (key = SHA-256 of HO_KEY),
// because this repo is public. The worker decrypts it and serves it as /data.json.
// HO_KEY is a Worker secret, set by .github/workflows/head-office.yml from the GitHub secret HO_KEY.

const enc = new TextEncoder();
const NO_STORE = { "cache-control": "no-store", "x-robots-tag": "noindex, nofollow", "referrer-policy": "no-referrer" };

async function sha256(s) { return new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s))); }
const hex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, "0")).join("");
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function same(a, b) { // constant-time compare of two strings (via their hashes)
  const [x, y] = await Promise.all([sha256(String(a)), sha256(String(b))]);
  return crypto.subtle.timingSafeEqual(x, y);
}

async function decrypt(env, req) {
  const r = await env.ASSETS.fetch(new Request(new URL("/data.enc", req.url)));
  if (!r.ok) throw new Error("data.enc missing");
  const { v, iv, ct } = await r.json();
  const key = await crypto.subtle.importKey("raw", await sha256(env.HO_KEY), "AES-GCM", false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(iv) }, key, b64(ct));
  if (v !== 2) return new Uint8Array(plain); // v1 = not compressed
  return new Uint8Array(await new Response(new Blob([plain]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!env.HO_KEY) return new Response("Head Office is not configured yet (HO_KEY secret missing).", { status: 503, headers: NO_STORE });

    const token = hex(await sha256(env.HO_KEY + ":view"));
    const qk = url.searchParams.get("key");
    const ck = (req.headers.get("cookie") || "").match(/(?:^|;\s*)ho=([0-9a-f]{64})/);

    if (qk) {
      if (!(await same(qk, env.HO_KEY))) return new Response("Locked.", { status: 401, headers: NO_STORE });
      url.searchParams.delete("key");
      return new Response(null, { status: 302, headers: { ...NO_STORE, location: url.pathname + url.search,
        "set-cookie": `ho=${token}; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax` } });
    }
    if (!ck || !(await same(ck[1], token))) return new Response("Locked. Open the link with your key.", { status: 401, headers: NO_STORE });

    if (url.pathname === "/data.json") {
      try {
        return new Response(await decrypt(env, req), { headers: { ...NO_STORE, "content-type": "application/json; charset=utf-8" } });
      } catch (e) {
        return new Response(JSON.stringify({ error: "Board data could not be read" }), { status: 500, headers: { ...NO_STORE, "content-type": "application/json" } });
      }
    }
    if (url.pathname === "/" || url.pathname === "/index.html") {
      const r = await env.ASSETS.fetch(new Request(new URL("/index.html", req.url)));
      return new Response(r.body, { status: r.status, headers: { ...Object.fromEntries(r.headers), ...NO_STORE, "content-type": "text/html; charset=utf-8" } });
    }
    return new Response("Not found", { status: 404, headers: NO_STORE });
  },
};
