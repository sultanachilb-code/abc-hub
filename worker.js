/* =====================================================================
   ABC Operations Hub — backend (Cloudflare Worker + D1)
   Handles: hub accounts & roles, announcements, the daily brief,
   live tile badges, and single sign-in into connected systems.
   Static files (index.html, apps.js, icons…) are served as assets.
   ===================================================================== */

const SITES = {
  VRM: "Verdun Mall",
  ACM: "Achrafieh Mall",
  DBS: "Dbayeh Department Store",
  ACS: "Achrafieh Department Store",
  VRS: "Verdun Department Store"
};
const ROLES = { ADMIN: "Admin", MANAGER: "Manager", SUPERVISOR: "Supervisor", SECURITY: "Security" };
const SESSION_HOURS = 12;
const ROUNDS = 100000;
const SSO_SECONDS = 60;
const BRIEF_CACHE_MS = 90 * 1000;

/* Systems connected to the hub. The key must match the system's id in apps.js.
   stats: the system answers GET /api?hubstats=1  (badges + daily brief)
   sso:   the system answers GET /api?sso=<token> (single sign-in)
   Systems on THIS Cloudflare account need a Service Binding instead of a URL
   (Cloudflare blocks workers.dev → workers.dev calls on the same account):
   add  binding: "INCIDENTS"  and declare it in wrangler.jsonc. */
const CONNECTORS = {
  snaglist: { base: "https://abc-snaglist.sultanalachi-work.workers.dev", stats: true, sso: true }
  // incidents: { base: "https://abc-incident-system.sultanachi-lb-61f.workers.dev", binding: "INCIDENTS", stats: true, sso: true },
};

/* ---------- helpers ---------- */
const enc = new TextEncoder();
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers }
});
const fail = (message, status = 400, extra) => Object.assign(new Error(message), { status, extra });
function b64url(bytes) {
  let s = ""; const a = new Uint8Array(bytes);
  for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64url(str) {
  const s = str.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}
async function hmac(secret, data) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}
async function derive(password, salt, rounds) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: enc.encode(salt), iterations: rounds, hash: "SHA-256" }, key, 256);
  return [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, "0")).join("");
}
function same(a, b) {
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
const randomId = (n = 16) => b64url(crypto.getRandomValues(new Uint8Array(n)));
const nowIso = () => new Date().toISOString();
/* Beirut wall-clock "YYYY-MM-DDTHH:MM" — announcements are entered in local time */
const nowLocal = () => new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Beirut", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false
}).format(new Date()).replace(" ", "T");
const validEmail = s => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);

/* ---------- schema (created automatically on first request) ---------- */
let schemaReady = false;
async function ensureSchema(env) {
  if (schemaReady) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS users (
      email TEXT PRIMARY KEY, full_name TEXT NOT NULL, role TEXT NOT NULL, site_code TEXT,
      salt TEXT NOT NULL, hash TEXT NOT NULL, iterations INTEGER NOT NULL,
      must_change INTEGER NOT NULL DEFAULT 1, active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT, last_login_at TEXT)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS announcements (
      id INTEGER PRIMARY KEY AUTOINCREMENT, message TEXT NOT NULL, level TEXT NOT NULL DEFAULT 'info',
      site TEXT NOT NULL DEFAULT 'ALL', starts_at TEXT NOT NULL DEFAULT '', ends_at TEXT NOT NULL DEFAULT '',
      created_by TEXT, created_at TEXT)`)
  ]);
  schemaReady = true;
}

/* ---------- sessions ---------- */
const cookieFor = t => `hub_session=${t}; Path=/; Max-Age=${SESSION_HOURS * 3600}; HttpOnly; Secure; SameSite=Lax`;
const CLEAR = "hub_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax";
async function makeSession(env, email) {
  const body = b64url(enc.encode(JSON.stringify({ e: email, exp: Date.now() + SESSION_HOURS * 3600e3 })));
  return `${body}.${await hmac(env.SESSION_SECRET, body)}`;
}
async function readSession(request, env) {
  const m = (request.headers.get("cookie") || "").match(/(?:^|;\s*)hub_session=([^;]+)/);
  if (!m) return null;
  const [body, sig] = m[1].split(".");
  if (!body || !sig || !same(await hmac(env.SESSION_SECRET, body), sig)) return null;
  const p = JSON.parse(new TextDecoder().decode(unb64url(body)));
  if (!p.exp || p.exp < Date.now()) return null;
  /* Always re-read the account so role changes and switch-offs apply at once */
  const u = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(p.e).first();
  return u && u.active ? u : null;
}
const userOut = u => ({
  email: u.email, name: u.full_name, role: u.role, roleLabel: ROLES[u.role] || u.role,
  site: u.site_code || "", siteName: u.site_code ? SITES[u.site_code] || u.site_code : "",
  mustChange: !!u.must_change
});

/* ---------- entry ---------- */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      try { return await route(request, env, ctx, url); }
      catch (e) { return json({ ok: false, error: e.message || String(e), ...(e.extra || {}) }, e.status || 500); }
    }
    return env.ASSETS.fetch(request);
  }
};

async function route(request, env, ctx, url) {
  if (!env.DB) throw fail("The hub database is not connected (D1 binding DB is missing).", 500);
  if (!env.SESSION_SECRET) throw fail("SESSION_SECRET is not set on the hub.", 500);
  await ensureSchema(env);
  const path = url.pathname.replace(/^\/api\/?/, "").replace(/\/+$/, "");
  const method = request.method;
  if (method === "POST") {
    const origin = request.headers.get("origin");
    if (origin && origin !== url.origin) throw fail("Request blocked", 403);
  }
  const body = method === "POST" ? await request.json().catch(() => ({})) : {};

  /* ----- public routes ----- */
  if (path === "login" && method === "POST") return login(env, body);
  if (path === "logout" && method === "POST") return json({ ok: true, data: {} }, 200, { "set-cookie": CLEAR });
  if (path === "setup" && method === "POST") return setup(env, body);

  const me = await readSession(request, env);
  if (!me) {
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first();
    throw fail("Not signed in", 401, { needsSetup: Number(n.n) === 0 });
  }

  /* ----- signed-in routes ----- */
  if (path === "me") return ok({ user: userOut(me), sites: SITES, roles: ROLES });
  if (path === "password" && method === "POST") return ok(await changePassword(env, me, body));
  if (path === "announcements") return ok(await activeAnnouncements(env, me));
  if (path === "brief") return ok(await brief(env, me, url.searchParams.get("fresh") === "1"));
  if (path === "sso") return ok(await ssoLink(env, me, url.searchParams.get("app")));

  /* ----- admin ----- */
  if (path.startsWith("admin/")) {
    if (me.role !== "ADMIN") throw fail("Administrator access only", 403);
    const a = path.slice(6);
    if (a === "users" && method === "GET") return ok(await listUsers(env));
    if (a === "users" && method === "POST") return ok(await saveUser(env, me, body));
    if (a === "users/reset" && method === "POST") return ok(await resetUser(env, body));
    if (a === "users/active" && method === "POST") return ok(await setActive(env, me, body));
    if (a === "announcements" && method === "GET") return ok(await listAnnouncements(env));
    if (a === "announcements" && method === "POST") return ok(await saveAnnouncement(env, me, body));
    if (a === "announcements/delete" && method === "POST") {
      await env.DB.prepare("DELETE FROM announcements WHERE id = ?").bind(Number(body.id) || 0).run();
      return ok({ deleted: true });
    }
  }
  throw fail("Unknown endpoint", 404);
}
const ok = data => json({ ok: true, data });

/* ---------- accounts ---------- */
async function hashFor(password) {
  const salt = randomId(12);
  return { salt, hash: await derive(password, salt, ROUNDS), iterations: ROUNDS };
}
async function setup(env, b) {
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first();
  if (Number(n.n) > 0) throw fail("The hub is already set up. Sign in instead.", 409);
  const email = String(b.email || "").trim().toLowerCase();
  const name = String(b.name || "").trim();
  const password = String(b.password || "");
  if (!validEmail(email)) throw fail("Enter a valid email address");
  if (!name) throw fail("Enter your full name");
  if (password.length < 8) throw fail("Password must be at least 8 characters");
  const h = await hashFor(password);
  await env.DB.prepare(`INSERT INTO users (email, full_name, role, site_code, salt, hash, iterations, must_change, active, created_at)
    VALUES (?,?, 'ADMIN', NULL, ?,?,?, 0, 1, ?)`).bind(email, name, h.salt, h.hash, h.iterations, nowIso()).run();
  return json({ ok: true, data: { created: true } }, 200, { "set-cookie": cookieFor(await makeSession(env, email)) });
}
async function login(env, b) {
  const email = String(b.email || "").trim().toLowerCase();
  const password = String(b.password || "");
  if (!email || !password) throw fail("Enter your email and password");
  const u = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
  const attempt = u ? await derive(password, u.salt, u.iterations || ROUNDS) : "";
  if (!u || !same(attempt, u.hash)) throw fail("Email or password is incorrect", 401);
  if (!u.active) throw fail("This account is switched off. Contact your administrator.", 403);
  await env.DB.prepare("UPDATE users SET last_login_at = ? WHERE email = ?").bind(nowIso(), email).run();
  return json({ ok: true, data: { user: userOut(u) } }, 200, { "set-cookie": cookieFor(await makeSession(env, email)) });
}
async function changePassword(env, me, b) {
  const current = String(b.current || ""), next = String(b.next || "");
  if (next.length < 8) throw fail("New password must be at least 8 characters");
  if (next === current) throw fail("The new password must be different");
  if (!same(await derive(current, me.salt, me.iterations || ROUNDS), me.hash)) throw fail("Your current password is incorrect", 401);
  const h = await hashFor(next);
  await env.DB.prepare("UPDATE users SET salt=?, hash=?, iterations=?, must_change=0 WHERE email=?")
    .bind(h.salt, h.hash, h.iterations, me.email).run();
  return { changed: true };
}
async function listUsers(env) {
  const { results } = await env.DB.prepare(
    "SELECT email, full_name, role, site_code, active, must_change, last_login_at FROM users ORDER BY role, full_name").all();
  return {
    users: (results || []).map(u => ({ ...userOut(u), active: !!u.active, lastLoginAt: u.last_login_at || "" })),
    sites: SITES, roles: ROLES
  };
}
async function saveUser(env, me, b) {
  const email = String(b.email || "").trim().toLowerCase();
  const name = String(b.name || "").trim();
  const role = String(b.role || "").toUpperCase();
  let site = String(b.site || "").toUpperCase();
  if (!validEmail(email)) throw fail("Enter a valid email address");
  if (!name) throw fail("Enter the full name");
  if (!ROLES[role]) throw fail("Choose a role");
  if (role !== "ADMIN" && !SITES[site]) throw fail("Choose the flagship for this person");
  if (role === "ADMIN" && !SITES[site]) site = "";
  const exists = await env.DB.prepare("SELECT email FROM users WHERE email = ?").bind(email).first();
  if (exists) {
    if (b.isNew) throw fail("That email already has an account");
    if (email === me.email && role !== "ADMIN") throw fail("You cannot remove your own admin role");
    await env.DB.prepare("UPDATE users SET full_name=?, role=?, site_code=? WHERE email=?").bind(name, role, site || null, email).run();
    return { email, created: false };
  }
  const password = String(b.password || "");
  if (password.length < 8) throw fail("Set a temporary password of at least 8 characters");
  const h = await hashFor(password);
  await env.DB.prepare(`INSERT INTO users (email, full_name, role, site_code, salt, hash, iterations, must_change, active, created_at)
    VALUES (?,?,?,?,?,?,?,1,1,?)`).bind(email, name, role, site || null, h.salt, h.hash, h.iterations, nowIso()).run();
  return { email, created: true };
}
async function resetUser(env, b) {
  const email = String(b.email || "").trim().toLowerCase();
  const password = String(b.password || "");
  if (password.length < 8) throw fail("Set a temporary password of at least 8 characters");
  const h = await hashFor(password);
  const r = await env.DB.prepare("UPDATE users SET salt=?, hash=?, iterations=?, must_change=1 WHERE email=?")
    .bind(h.salt, h.hash, h.iterations, email).run();
  if (!r.meta || !r.meta.changes) throw fail("No such user", 404);
  return { email, reset: true };
}
async function setActive(env, me, b) {
  const email = String(b.email || "").trim().toLowerCase();
  if (email === me.email) throw fail("You cannot switch off your own account");
  await env.DB.prepare("UPDATE users SET active=? WHERE email=?").bind(b.active ? 1 : 0, email).run();
  return { email, active: !!b.active };
}

/* ---------- announcements ---------- */
const annOut = r => ({ id: r.id, message: r.message, level: r.level, site: r.site,
  siteName: r.site === "ALL" ? "All flagships" : SITES[r.site] || r.site,
  startsAt: r.starts_at, endsAt: r.ends_at, createdBy: r.created_by, createdAt: r.created_at });
async function activeAnnouncements(env, me) {
  const now = nowLocal();
  const siteSql = me.role === "ADMIN" && !me.site_code ? "" : " AND (site = 'ALL' OR site = ?)";
  const binds = siteSql ? [me.site_code || "ALL"] : [];
  const { results } = await env.DB.prepare(
    `SELECT * FROM announcements WHERE (starts_at = '' OR starts_at <= ?) AND (ends_at = '' OR ends_at >= ?)${siteSql}
     ORDER BY CASE level WHEN 'urgent' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, id DESC LIMIT 5`
  ).bind(now, now, ...binds).all();
  return { announcements: (results || []).map(annOut) };
}
async function listAnnouncements(env) {
  const { results } = await env.DB.prepare("SELECT * FROM announcements ORDER BY id DESC LIMIT 100").all();
  const now = nowLocal();
  return {
    now, sites: SITES,
    announcements: (results || []).map(r => ({ ...annOut(r),
      state: r.ends_at && r.ends_at < now ? "Ended" : r.starts_at && r.starts_at > now ? "Scheduled" : "Live" }))
  };
}
async function saveAnnouncement(env, me, b) {
  const message = String(b.message || "").trim().slice(0, 280);
  const level = ["info", "warning", "urgent"].includes(b.level) ? b.level : "info";
  const site = SITES[String(b.site || "").toUpperCase()] ? String(b.site).toUpperCase() : "ALL";
  const dt = v => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(v || "")) ? String(v) : "";
  const startsAt = dt(b.startsAt), endsAt = dt(b.endsAt);
  if (!message) throw fail("Write the announcement");
  if (startsAt && endsAt && endsAt < startsAt) throw fail("The end time is before the start time");
  if (b.id) {
    await env.DB.prepare("UPDATE announcements SET message=?, level=?, site=?, starts_at=?, ends_at=? WHERE id=?")
      .bind(message, level, site, startsAt, endsAt, Number(b.id)).run();
    return { id: Number(b.id), saved: true };
  }
  const r = await env.DB.prepare(`INSERT INTO announcements (message, level, site, starts_at, ends_at, created_by, created_at)
    VALUES (?,?,?,?,?,?,?)`).bind(message, level, site, startsAt, endsAt, me.full_name, nowIso()).run();
  return { id: r.meta && r.meta.last_row_id, saved: true };
}

/* ---------- daily brief + badges ---------- */
const briefCache = new Map();
async function brief(env, me, fresh) {
  const site = me.site_code || "ALL";
  const hit = briefCache.get(site);
  if (!fresh && hit && Date.now() - hit.at < BRIEF_CACHE_MS) return hit.data;
  const ids = Object.keys(CONNECTORS).filter(id => CONNECTORS[id].stats);
  const results = await Promise.all(ids.map(id => pull(env, id, CONNECTORS[id], site)));
  const data = {
    site, siteName: site === "ALL" ? "All flagships" : SITES[site] || site,
    generatedAt: nowIso(), keyMissing: !env.HUB_KEY,
    systems: Object.fromEntries(ids.map((id, i) => [id, results[i]]))
  };
  briefCache.set(site, { at: Date.now(), data });
  return data;
}
async function pull(env, id, c, site) {
  if (!env.HUB_KEY) return { ok: false, error: "HUB_KEY is not set on the hub" };
  const target = `${c.base}/api?hubstats=1&site=${encodeURIComponent(site)}`;
  const init = { headers: { "x-hub-key": env.HUB_KEY }, signal: AbortSignal.timeout(6000) };
  try {
    const r = c.binding && env[c.binding] ? await env[c.binding].fetch(target, init) : await fetch(target, init);
    const j = await r.json().catch(() => null);
    if (!j || !j.ok) throw new Error((j && j.error) || `HTTP ${r.status}`);
    return { ok: true, badge: j.data.badge || null, brief: Array.isArray(j.data.brief) ? j.data.brief.slice(0, 4) : [] };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

/* ---------- single sign-in ---------- */
async function ssoLink(env, me, appId) {
  const c = CONNECTORS[String(appId || "")];
  if (!c || !c.sso) throw fail("This system does not support hub sign-in yet", 404);
  if (!env.HUB_KEY) throw fail("HUB_KEY is not set on the hub", 500);
  const payload = { e: me.email, n: me.full_name, aud: appId, site: me.site_code || "", iat: Date.now(),
    exp: Date.now() + SSO_SECONDS * 1000, nonce: randomId(9) };
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const token = `${body}.${await hmac(env.HUB_KEY, body)}`;
  return { url: `${c.base}/api?sso=${encodeURIComponent(token)}` };
}
