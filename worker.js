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
/* Operations positions, highest first. They decide the order people appear in the schedule. */
const POSITIONS = {
  SMS: { label: "Senior Mall Supervisor", rank: 1 },
  MS:  { label: "Mall Supervisor", rank: 2 },
  MO:  { label: "Mall Officer", rank: 3 }
};
const SESSION_HOURS = 12;
const ROUNDS = 100000;
const SSO_SECONDS = 60;
const BRIEF_CACHE_MS = 90 * 1000;

/* Systems connected to the hub. The key must match the system's id in apps.js.
   stats: path that returns badge + brief figures   ({site} is filled in)
   sso:   path that signs the person in              ({token} is filled in)
   binding: systems on THIS Cloudflare account must be reached through a
   Service Binding (declared in wrangler.jsonc) — Cloudflare blocks direct
   workers.dev → workers.dev calls between Workers on the same account. */
const CONNECTORS = {
  snaglist: {
    base: "https://abc-snaglist.sultanalachi-work.workers.dev",
    stats: "/api?hubstats=1&site={site}",
    notify: "/api?hubnotify=1&site={site}&since={since}",
    sso: "/api?sso={token}"
  },
  incidents: {
    base: "https://abc-incident-system.sultanachi-lb-61f.workers.dev",
    binding: "INCIDENTS",
    stats: "/api/hubstats?site={site}",
    notify: "/api/hubnotify?site={site}&since={since}",
    sso: "/api/sso?token={token}"
  },
  restroom: {
    base: "https://abc-restroom-report.sultanachi-lb-61f.workers.dev",
    binding: "RESTROOM",
    stats: "/api/hubstats?site={site}",
    notify: "/api/hubnotify?site={site}&since={since}"
  }
};

/* Systems the hub checks for the health dots (id = apps.js id).
   internal: true → on the office network, which the cloud cannot reach,
   so the hub reports "unknown" (grey) instead of a false "down". */
const HEALTH = {
  snaglist:       { name: "Snaglist Manager", url: "https://abc-snaglist.sultanalachi-work.workers.dev/api?health=1" },
  restroom:       { name: "Restroom Inspection Dashboard", url: "https://abc-restroom-report.sultanachi-lb-61f.workers.dev/", binding: "RESTROOM" },
  incidents:      { name: "Incident Report System", url: "https://abc-incident-system.sultanachi-lb-61f.workers.dev/", binding: "INCIDENTS" },
  "cleaner-qr":   { name: "Cleaner QR Access", url: "https://abcv-admin-access.sultanachi-lb-61f.workers.dev/", binding: "CLEANER" },
  footfall:       { name: "Footfall Hub", url: "https://footfall-hub.sultanachi-lb-61f.workers.dev/", binding: "FOOTFALL" },
  "abc-connect":  { name: "ABC Connect", url: "https://abclebanon.my.site.com/abcemployee/s/" },
  successfactors: { name: "SAP SuccessFactors", url: "https://performancemanager8.successfactors.com/login" },
  jde:            { name: "JD Edwards", internal: true },
  archibus:       { name: "Archibus", internal: true }
};
const HEALTH_CACHE_MS = 60 * 1000;

/* Notifications & push */
const NOTIFY_DAYS = 7;
const NOTIFY_CACHE_MS = 60 * 1000;
const VAPID_SUBJECT = "mailto:salaachi@abc.com.lb";
/* Who may receive each system's events — keep in line with "roles" in apps.js
   (systems not listed go to everyone; Admins always receive everything). */
const APP_ROLES = { restroom: ["MANAGER", "SUPERVISOR"] };

/* Morning email */
const HUB_URL = "https://operations-hub.sultanachi-lb-61f.workers.dev";
const MAIL_HOUR = 8;   // Beirut time
const SYSTEM_NAMES = { snaglist: "Snaglist Manager", incidents: "Incident Report System", restroom: "Restroom Inspections" };

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
      created_by TEXT, created_at TEXT)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS control_sheet (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'Systems',
      live_url TEXT NOT NULL DEFAULT '', github_url TEXT NOT NULL DEFAULT '', cloudflare_url TEXT NOT NULL DEFAULT '',
      app_id TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', sort INTEGER NOT NULL DEFAULT 0)`)
  ]);
  await seedControlSheet(env);
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS push_subs (
      endpoint TEXT PRIMARY KEY, email TEXT NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL,
      level TEXT NOT NULL DEFAULT 'important', device TEXT, created_at TEXT, last_ok_at TEXT)`).run();
  const cols = await env.DB.prepare("PRAGMA table_info(users)").all();
  const has = n => (cols.results || []).some(c => c.name === n);
  if (!has("morning_email")) await env.DB.prepare("ALTER TABLE users ADD COLUMN morning_email INTEGER NOT NULL DEFAULT 1").run();
  if (!has("notif_read_at")) await env.DB.prepare("ALTER TABLE users ADD COLUMN notif_read_at TEXT NOT NULL DEFAULT ''").run();
  if (!has("position")) await env.DB.prepare("ALTER TABLE users ADD COLUMN position TEXT NOT NULL DEFAULT ''").run();
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS hub_events (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL,
      site TEXT NOT NULL DEFAULT '', app TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '',
      tone TEXT NOT NULL DEFAULT 'info', email TEXT NOT NULL DEFAULT '')`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS usage_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL,
      email TEXT NOT NULL, site TEXT NOT NULL DEFAULT '', role TEXT NOT NULL DEFAULT '', app TEXT NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS sched_cells (site TEXT NOT NULL, day TEXT NOT NULL, email TEXT NOT NULL,
      val TEXT NOT NULL, updated_by TEXT, updated_at TEXT, PRIMARY KEY (site, day, email))`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS sched_notes (site TEXT NOT NULL, day TEXT NOT NULL, note TEXT NOT NULL, PRIMARY KEY (site, day))`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS mom_meetings (id INTEGER PRIMARY KEY AUTOINCREMENT, site TEXT NOT NULL,
      title TEXT NOT NULL, meet_date TEXT NOT NULL, week_no TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '',
      next_date TEXT NOT NULL DEFAULT '', last_date TEXT NOT NULL DEFAULT '', participants TEXT NOT NULL DEFAULT '[]',
      points TEXT NOT NULL DEFAULT '[]', prepared_by TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'draft',
      created_by TEXT, created_at TEXT, updated_at TEXT, published_at TEXT NOT NULL DEFAULT '')`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS mom_actions (id INTEGER PRIMARY KEY AUTOINCREMENT, meeting_id INTEGER NOT NULL,
      site TEXT NOT NULL, seq INTEGER NOT NULL DEFAULT 0, text TEXT NOT NULL, owner_email TEXT NOT NULL DEFAULT '',
      owner_name TEXT NOT NULL DEFAULT '', due TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'Open',
      done_at TEXT NOT NULL DEFAULT '', notified_at TEXT NOT NULL DEFAULT '', created_at TEXT)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS ops_settings (site TEXT NOT NULL, k TEXT NOT NULL, v TEXT NOT NULL, PRIMARY KEY (site, k))`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS handovers (id INTEGER PRIMARY KEY AUTOINCREMENT, site TEXT NOT NULL, day TEXT NOT NULL,
      shift TEXT NOT NULL DEFAULT 'AM', doc TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft',
      created_by TEXT, created_name TEXT, created_at TEXT, updated_at TEXT,
      submitted_at TEXT NOT NULL DEFAULT '', received_by TEXT NOT NULL DEFAULT '', received_at TEXT NOT NULL DEFAULT '')`)
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
  mustChange: !!u.must_change,
  position: u.position || "", positionLabel: POSITIONS[u.position] ? POSITIONS[u.position].label : ""
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
  },
  /* One cron trigger, every 2 minutes (free plan allows 5 per account):
     • pushes new events to subscribed phones and laptops
     • sends the morning email once, in the 08:00 Beirut hour (safe through summer/winter time) */
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      if (!env.DB) return;
      await ensureSchema(env);
      await taskReminders(env).catch(e => console.error("tasks", e && e.message));
      await pushRun(env).catch(e => console.error("push", e && e.message));
      if (beirutHour() === MAIL_HOUR) await morningRun(env, { force: false }).catch(e => console.error("mail", e && e.message));
    })());
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
  if (path === "health") return ok(await health(env));
  if (path === "notifications") return ok(await notificationsFor(env, me));
  if (path === "notifications/read" && method === "POST") {
    await env.DB.prepare("UPDATE users SET notif_read_at = ? WHERE email = ?").bind(nowIso(), me.email).run();
    return ok({ read: true });
  }
  if (path === "push/key") return ok({ key: (await vapidKeys(env)).pub });
  if (path === "push/status") return ok(await pushStatus(env, me, url.searchParams.get("endpoint")));
  if (path === "push/subscribe" && method === "POST") return ok(await pushSubscribe(env, me, body, request));
  if (path === "push/unsubscribe" && method === "POST") {
    await env.DB.prepare("DELETE FROM push_subs WHERE endpoint = ? AND email = ?").bind(String(body.endpoint || ""), me.email).run();
    return ok({ removed: true });
  }
  if (path === "push/test" && method === "POST") return ok(await pushTest(env, me, body));
  if (path === "usage" && method === "POST") { await logUsage(env, me, String(body.app || "").slice(0, 40)); return ok({ logged: true }); }
  if (path.startsWith("ops/")) return ok(await opsRoute(env, me, path.slice(4), method, body, url));

  /* ----- admin ----- */
  if (path.startsWith("admin/")) {
    if (me.role !== "ADMIN") throw fail("Administrator access only", 403);
    const a = path.slice(6);
    if (a === "users" && method === "GET") return ok(await listUsers(env));
    if (a === "users" && method === "POST") return ok(await saveUser(env, me, body));
    if (a === "users/reset" && method === "POST") return ok(await resetUser(env, body));
    if (a === "users/active" && method === "POST") return ok(await setActive(env, me, body));
    if (a === "usage" && method === "GET") return ok(await usageReport(env, Number(url.searchParams.get("days")) || 30));
    if (a === "control" && method === "GET") return ok(await listControl(env));
    if (a === "control" && method === "POST") return ok(await saveControl(env, body));
    if (a === "control/delete" && method === "POST") {
      await env.DB.prepare("DELETE FROM control_sheet WHERE id = ?").bind(Number(body.id) || 0).run();
      return ok({ deleted: true });
    }
    if (a === "morning-test" && method === "POST") return ok(await morningTest(env, me));
    if (a === "morning-status" && method === "GET") return ok(await morningStatus(env));
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
  await logUsage(env, u, "signin").catch(() => {});
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
    "SELECT email, full_name, role, site_code, active, must_change, last_login_at, morning_email, position FROM users ORDER BY role, full_name").all();
  return {
    users: (results || []).map(u => ({ ...userOut(u), active: !!u.active, lastLoginAt: u.last_login_at || "",
      morningEmail: !!u.morning_email, morningEligible: u.role === "ADMIN" || u.role === "MANAGER" })),
    sites: SITES, roles: ROLES, positions: Object.fromEntries(Object.entries(POSITIONS).map(([k, v]) => [k, v.label]))
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
  const position = POSITIONS[String(b.position || "").toUpperCase()] ? String(b.position).toUpperCase() : "";
  const exists = await env.DB.prepare("SELECT email FROM users WHERE email = ?").bind(email).first();
  if (exists) {
    if (b.isNew) throw fail("That email already has an account");
    if (email === me.email && role !== "ADMIN") throw fail("You cannot remove your own admin role");
    await env.DB.prepare("UPDATE users SET full_name=?, role=?, site_code=?, morning_email=?, position=? WHERE email=?")
      .bind(name, role, site || null, b.morningEmail === false ? 0 : 1, position, email).run();
    return { email, created: false };
  }
  const password = String(b.password || "");
  if (password.length < 8) throw fail("Set a temporary password of at least 8 characters");
  const h = await hashFor(password);
  await env.DB.prepare(`INSERT INTO users (email, full_name, role, site_code, salt, hash, iterations, must_change, active, created_at, morning_email, position)
    VALUES (?,?,?,?,?,?,?,1,1,?,?,?)`).bind(email, name, role, site || null, h.salt, h.hash, h.iterations, nowIso(), b.morningEmail === false ? 0 : 1, position).run();
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
async function pull(env, id, c, site, extra = "") {
  if (!env.HUB_KEY) return { ok: false, error: "HUB_KEY is not set on the hub" };
  const target = c.base + c.stats.replace("{site}", encodeURIComponent(site)) + extra;
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
  return { url: c.base + c.sso.replace("{token}", encodeURIComponent(token)) };
}

/* ---------- health dots ---------- */
let healthCache = null;
async function health(env) {
  if (healthCache && Date.now() - healthCache.at < HEALTH_CACHE_MS) return healthCache.data;
  const ids = Object.keys(HEALTH);
  const results = await Promise.all(ids.map(id => probe(env, HEALTH[id])));
  const data = { checkedAt: nowIso(), systems: Object.fromEntries(ids.map((id, i) => [id, results[i]])) };
  healthCache = { at: Date.now(), data };
  return data;
}
async function probe(env, t) {
  if (t.internal) return { state: "unknown", note: "Office network — not checked from the cloud" };
  const started = Date.now();
  try {
    const init = { method: "GET", redirect: "manual", signal: AbortSignal.timeout(8000), headers: { "user-agent": "ABC-Operations-Hub-Health/1.0" } };
    const r = t.binding && env[t.binding] ? await env[t.binding].fetch(t.url, init) : await fetch(t.url, init);
    try { await r.body?.cancel(); } catch {}
    const ms = Date.now() - started;
    /* Anything below 500 means the system answered (a login page or redirect is "up") */
    return r.status < 500 ? { state: "up", ms, status: r.status } : { state: "down", ms, status: r.status };
  } catch (e) {
    return { state: "down", ms: Date.now() - started, error: String(e && e.name === "TimeoutError" ? "No response in 8 seconds" : (e && e.message) || e) };
  }
}

/* ---------- morning email ---------- */
function beirutParts(d = new Date()) {
  return Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Beirut", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false
  }).formatToParts(d).map(p => [p.type, p.value]));
}
const beirutHour = () => Number(beirutParts().hour) % 24;
const beirutDate = () => { const p = beirutParts(); return `${p.year}-${p.month}-${p.day}`; };

async function morningStatus(env) {
  const row = await env.DB.prepare("SELECT v FROM meta WHERE k = ?").bind("mail:last").first();
  return { last: row ? JSON.parse(row.v) : null, relay: !!(env.MAIL_RELAY_URL && env.MAIL_RELAY_KEY), hour: MAIL_HOUR };
}
async function morningTest(env, me) {
  const res = await morningRun(env, { only: me });
  if (!res.sent) throw fail(res.errors[0] || "The test email could not be sent", 502);
  return { sent: res.sent, to: me.email };
}

async function morningRun(env, { only = null, force = false } = {}) {
  if (!env.MAIL_RELAY_URL || !env.MAIL_RELAY_KEY) return { sent: 0, errors: ["MAIL_RELAY_URL / MAIL_RELAY_KEY are not set on the hub"] };
  const today = beirutDate();
  if (!only && !force) {
    const claim = await env.DB.prepare("INSERT OR IGNORE INTO meta (k, v) VALUES (?, ?)").bind("mail:" + today, nowIso()).run();
    if (!claim.meta || claim.meta.changes !== 1) return { sent: 0, errors: ["Already sent today"] };
  }
  let people;
  if (only) people = [only];
  else {
    const { results } = await env.DB.prepare(
      "SELECT * FROM users WHERE active = 1 AND morning_email = 1 AND role IN ('ADMIN','MANAGER')").all();
    people = results || [];
  }
  const bySite = new Map();
  for (const u of people) { const k = u.site_code || "ALL"; if (!bySite.has(k)) bySite.set(k, []); bySite.get(k).push(u); }

  const hs = await health(env).catch(() => null);
  const down = hs ? Object.entries(hs.systems).filter(([, v]) => v.state === "down").map(([id]) => (HEALTH[id] && HEALTH[id].name) || id) : [];
  let sent = 0; const errors = [];
  for (const [site, list] of bySite) {
    const ids = Object.keys(CONNECTORS).filter(id => CONNECTORS[id].stats);
    const figures = await Promise.all(ids.map(id => pull(env, id, CONNECTORS[id], site, "&day=yesterday")));
    const anns = await activeAnnouncements(env, { role: site === "ALL" ? "ADMIN" : "MANAGER", site_code: site === "ALL" ? null : site });
    for (const u of list) {
      const html = morningHtml({ user: u, site, ids, figures, down, anns: anns.announcements });
      const subject = `Morning brief — ${site === "ALL" ? "All flagships" : SITES[site] || site} — ${new Date().toLocaleDateString("en-GB", { timeZone: "Asia/Beirut", weekday: "short", day: "numeric", month: "short" })}`;
      const r = await relay(env, { to: [u.email], subject, html });
      r.ok ? sent++ : errors.push(`${u.email}: ${r.error}`);
    }
  }
  const summary = { date: today, at: nowIso(), sent, failed: errors.length, test: !!only, errors: errors.slice(0, 5) };
  if (!only) await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('mail:last', ?)").bind(JSON.stringify(summary)).run();
  return { sent, errors };
}
async function relay(env, { to, subject, html }) {
  try {
    const r = await fetch(env.MAIL_RELAY_URL, {
      method: "POST", redirect: "follow",
      body: JSON.stringify({ key: env.MAIL_RELAY_KEY, to, cc: [], subject, html, fromName: "ABC Operations Hub", attachment: null })
    });
    const text = await r.text();
    let j = null; try { j = JSON.parse(text); } catch {}
    return j && j.ok ? { ok: true } : { ok: false, error: (j && j.error) || text.slice(0, 200) };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
}
const escH = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const TONE = { ok: "#1E7A4F", warn: "#B7791F", alert: "#C0392B" };
function morningHtml({ user, site, ids, figures, down, anns }) {
  const first = String(user.full_name || "").split(" ")[0];
  const scope = site === "ALL" ? "All flagships" : SITES[site] || site;
  const dateLabel = new Date().toLocaleDateString("en-GB", { timeZone: "Asia/Beirut", weekday: "long", day: "numeric", month: "long" });
  const block = (id, f) => {
    const name = SYSTEM_NAMES[id] || id;
    const body = f.ok
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${f.brief.map(x => `
          <td style="padding:6px 8px 6px 0;vertical-align:top;width:${Math.floor(100 / Math.max(1, f.brief.length))}%">
            <div style="font:700 22px Arial,sans-serif;color:${TONE[x.tone] || "#2A0F45"}">${escH(x.value)}</div>
            <div style="font:12px Arial,sans-serif;color:#6D6479;margin-top:2px">${escH(x.label)}</div></td>`).join("")}</tr></table>`
      : `<div style="font:13px Arial,sans-serif;color:#6D6479">Figures unavailable this morning.</div>`;
    return `<tr><td style="padding:14px 16px;border:1px solid #E3DCEC;border-radius:12px;background:#FAF8FC">
      <div style="font:700 14px Arial,sans-serif;color:#2A0F45;margin-bottom:8px">${escH(name)}</div>${body}</td></tr>
      <tr><td style="height:10px"></td></tr>`;
  };
  const downHtml = down.length ? `<tr><td style="padding:12px 16px;border-radius:12px;background:#FDECEA;font:13px Arial,sans-serif;color:#C0392B">
      <b>Not responding when this was sent:</b> ${down.map(escH).join(", ")}</td></tr><tr><td style="height:10px"></td></tr>` : "";
  const annHtml = anns.length ? `<tr><td style="padding:12px 16px;border-radius:12px;background:#F1EAF8;font:13px Arial,sans-serif;color:#2A0F45">
      <b>Announcements</b>${anns.map(a => `<div style="margin-top:6px">• ${escH(a.message)}</div>`).join("")}</td></tr><tr><td style="height:10px"></td></tr>` : "";
  return `<!doctype html><html><body style="margin:0;background:#F6F4F9">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F4F9;padding:20px 0"><tr><td align="center">
  <table role="presentation" width="620" cellpadding="0" cellspacing="0" style="width:620px;max-width:94%;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #E3DCEC">
    <tr><td style="background:#2A0F45;padding:22px 24px">
      <div style="font:700 11px Arial,sans-serif;letter-spacing:2px;color:#C8A24A;text-transform:uppercase">ABC Operations Hub</div>
      <div style="font:800 22px Arial,sans-serif;color:#fff;margin-top:6px">Good morning, ${escH(first)}</div>
      <div style="font:13px Arial,sans-serif;color:#CDBFE0;margin-top:4px">${escH(dateLabel)} · ${escH(scope)}</div></td></tr>
    <tr><td style="padding:20px 24px 6px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        ${downHtml}${annHtml}${ids.map((id, i) => block(id, figures[i])).join("")}
      </table>
      <div style="font:12px Arial,sans-serif;color:#6D6479;margin:4px 0 18px">Restroom figures are for yesterday's full day. Snaglist and Incident figures are as of 08:00.</div>
      <a href="${HUB_URL}" style="display:inline-block;background:#4A1F73;color:#fff;text-decoration:none;font:700 14px Arial,sans-serif;padding:12px 20px;border-radius:10px">Open the hub</a>
    </td></tr>
    <tr><td style="padding:18px 24px;font:11px Arial,sans-serif;color:#6D6479">Automated morning brief · ABC Operations. Your administrator can switch this off in People &amp; roles.</td></tr>
  </table></td></tr></table></body></html>`;
}

/* ---------- admin control sheet ---------- */
const CF_ACCOUNT = "61f649b35159d4a26df7dde3c09a91dd";          // sultanachi-lb-61f account
const GH_OWNER = "https://github.com/sultanachilb-code/";
const cfWorker = name => `https://dash.cloudflare.com/${CF_ACCOUNT}/workers/services/view/${name}/production`;
const wd = name => `https://${name}.sultanachi-lb-61f.workers.dev`;
const SEED = [
  ["Operations Hub", "Hub", wd("operations-hub"), GH_OWNER + "abc-hub", cfWorker("operations-hub"), "", "This app"],
  ["Hub database (D1)", "Hub", "", "", `https://dash.cloudflare.com/${CF_ACCOUNT}/workers/d1/databases/e7ae150f-de70-4376-a15b-65390159f65c`, "", "hub-db"],
  ["Snaglist Manager", "Systems", "https://abc-snaglist.sultanalachi-work.workers.dev", "", "", "snaglist", "Cloudflare account: sultanalachi-work — add its links"],
  ["Incident Report System", "Systems", wd("abc-incident-system"), GH_OWNER + "abc-incident-system", cfWorker("abc-incident-system"), "incidents", ""],
  ["Restroom Inspection Dashboard", "Systems", wd("abc-restroom-report"), GH_OWNER + "abc-restroom-inspection", cfWorker("abc-restroom-report"), "restroom", "Deployed as env: report"],
  ["Cleaner QR Access", "Systems", wd("abcv-admin-access"), "", cfWorker("abcv-admin-access"), "cleaner-qr", ""],
  ["Footfall Hub", "Systems", wd("footfall-hub"), "", cfWorker("footfall-hub"), "footfall", ""],
  ["Restroom QR · Verdun Mall", "Restroom QR apps", wd("abcv-digital-restroom-inspection"), GH_OWNER + "abc-restroom-inspection", cfWorker("abcv-digital-restroom-inspection"), "", "env: verdun_mall"],
  ["Restroom QR · Verdun DS", "Restroom QR apps", wd("abc-vds-digital-restroom-inspection"), GH_OWNER + "abc-restroom-inspection", cfWorker("abc-vds-digital-restroom-inspection"), "", "env: verdun_ds"],
  ["Restroom QR · Achrafieh Mall", "Restroom QR apps", wd("abc-ach-mall-restroom-inspection"), GH_OWNER + "abc-restroom-inspection", cfWorker("abc-ach-mall-restroom-inspection"), "", "env: achrafieh_mall"],
  ["Restroom QR · Achrafieh DS", "Restroom QR apps", wd("abc-achds-digital-restroom-inspection"), GH_OWNER + "abc-restroom-inspection", cfWorker("abc-achds-digital-restroom-inspection"), "", "env: achrafieh_ds"],
  ["Restroom QR · Dbayeh", "Restroom QR apps", wd("abc-restroom-inspection-dbayeh"), GH_OWNER + "abc-restroom-inspection", cfWorker("abc-restroom-inspection-dbayeh"), "", "env: dbayeh"],
  ["Restroom scheduler", "Restroom QR apps", "", GH_OWNER + "abc-restroom-inspection", cfWorker("abc-restroom-scheduler"), "", "env: scheduler — reminders"]
];
async function seedControlSheet(env) {
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM control_sheet").first();
  if (Number(n.n) > 0) return;
  const done = await env.DB.prepare("SELECT v FROM meta WHERE k = 'control:seeded'").first();
  if (done) return;                                     // admin emptied it on purpose
  await env.DB.batch([
    ...SEED.map((r, i) => env.DB.prepare(
      "INSERT INTO control_sheet (name, category, live_url, github_url, cloudflare_url, app_id, notes, sort) VALUES (?,?,?,?,?,?,?,?)"
    ).bind(r[0], r[1], r[2], r[3], r[4], r[5], r[6], i)),
    env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('control:seeded', ?)").bind(nowIso())
  ]);
}
async function listControl(env) {
  const { results } = await env.DB.prepare("SELECT * FROM control_sheet ORDER BY sort, id").all();
  return { rows: (results || []).map(r => ({ id: r.id, name: r.name, category: r.category, liveUrl: r.live_url,
    githubUrl: r.github_url, cloudflareUrl: r.cloudflare_url, appId: r.app_id, notes: r.notes })) };
}
async function saveControl(env, b) {
  const clean = v => String(v || "").trim().slice(0, 500);
  const url = v => { const u = clean(v); if (u && !/^https?:\/\//i.test(u)) throw fail("Links must start with https://"); return u; };
  const name = clean(b.name);
  if (!name) throw fail("Enter a name");
  const vals = [name, clean(b.category) || "Systems", url(b.liveUrl), url(b.githubUrl), url(b.cloudflareUrl), clean(b.appId), clean(b.notes)];
  if (b.id) {
    await env.DB.prepare("UPDATE control_sheet SET name=?, category=?, live_url=?, github_url=?, cloudflare_url=?, app_id=?, notes=? WHERE id=?")
      .bind(...vals, Number(b.id)).run();
    return { id: Number(b.id) };
  }
  const max = await env.DB.prepare("SELECT COALESCE(MAX(sort),0) AS m FROM control_sheet").first();
  const r = await env.DB.prepare("INSERT INTO control_sheet (name, category, live_url, github_url, cloudflare_url, app_id, notes, sort) VALUES (?,?,?,?,?,?,?,?)")
    .bind(...vals, Number(max.m) + 1).run();
  return { id: r.meta && r.meta.last_row_id };
}

/* ---------- notifications (bell) ---------- */
const notifyCache = new Map();
async function gatherNotify(env, site, since) {
  const ids = Object.keys(CONNECTORS).filter(id => CONNECTORS[id].notify);
  const lists = await Promise.all(ids.map(async id => {
    const c = CONNECTORS[id];
    if (!env.HUB_KEY) return [];
    const target = c.base + c.notify.replace("{site}", encodeURIComponent(site)).replace("{since}", encodeURIComponent(since));
    const init = { headers: { "x-hub-key": env.HUB_KEY }, signal: AbortSignal.timeout(6000) };
    try {
      const r = c.binding && env[c.binding] ? await env[c.binding].fetch(target, init) : await fetch(target, init);
      const j = await r.json().catch(() => null);
      if (!j || !j.ok || !j.data || !Array.isArray(j.data.events)) return [];
      return j.data.events.slice(0, 100).map(e => ({
        id: `${id}:${e.id}`, app: id, at: String(e.at || ""), site: e.site || "",
        title: String(e.title || "").slice(0, 140), body: String(e.body || "").slice(0, 240),
        tone: ["alert", "warn", "ok", "info"].includes(e.tone) ? e.tone : "info"
      }));
    } catch { return []; }
  }));
  lists.push(await localEvents(env, site, since));
  return lists.flat().filter(e => e.at).sort((a, b) => (a.at < b.at ? 1 : -1));
}
/* Events raised by the hub's own tools (schedule, MOM tasks, handovers).
   email = '' → everyone at the flagship; otherwise only that person. */
async function localEvents(env, site, since) {
  const scoped = site && site !== "ALL";
  const { results } = await env.DB.prepare(
    `SELECT * FROM hub_events WHERE at > ?${scoped ? " AND (site = ? OR site = '')" : ""} ORDER BY at DESC LIMIT 150`)
    .bind(since, ...(scoped ? [site] : [])).all();
  return (results || []).map(r => ({ id: `${r.app}:h${r.id}`, app: r.app, at: r.at, site: r.site, title: r.title, body: r.body, tone: r.tone, to: r.email || "" }));
}
async function raiseEvent(env, { site = "", app, title, body = "", tone = "info", email = "" }) {
  await env.DB.prepare("INSERT INTO hub_events (at, site, app, title, body, tone, email) VALUES (?,?,?,?,?,?,?)")
    .bind(nowIso(), site, app, String(title).slice(0, 140), String(body).slice(0, 240), tone, email).run();
  notifyCache.clear();
}
async function notificationsFor(env, me) {
  const site = me.site_code || "ALL";
  const hit = notifyCache.get(site);
  let events;
  if (hit && Date.now() - hit.at < NOTIFY_CACHE_MS) events = hit.events;
  else {
    events = (await gatherNotify(env, site, new Date(Date.now() - NOTIFY_DAYS * 864e5).toISOString())).slice(0, 120);
    notifyCache.set(site, { at: Date.now(), events });
  }
  events = events.filter(e => !e.to || e.to === me.email).slice(0, 80);
  return { events, readAt: me.notif_read_at || "" };
}
const roleAllows = (role, app) => role === "ADMIN" || !APP_ROLES[app] || APP_ROLES[app].includes(role);

/* ---------- web push (standard VAPID + aes128gcm, no outside service) ---------- */
async function vapidKeys(env) {
  const row = await env.DB.prepare("SELECT v FROM meta WHERE k = 'vapid'").first();
  if (row) return JSON.parse(row.v);
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const v = { jwk: await crypto.subtle.exportKey("jwk", kp.privateKey), pub: b64url(await crypto.subtle.exportKey("raw", kp.publicKey)) };
  await env.DB.prepare("INSERT OR IGNORE INTO meta (k, v) VALUES ('vapid', ?)").bind(JSON.stringify(v)).run();
  return JSON.parse((await env.DB.prepare("SELECT v FROM meta WHERE k = 'vapid'").first()).v);
}
async function vapidHeader(env, endpoint) {
  const { jwk, pub } = await vapidKeys(env);
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const h = b64url(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const p = b64url(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: VAPID_SUBJECT })));
  const sig = b64url(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${h}.${p}`)));
  return `vapid t=${h}.${p}.${sig}, k=${pub}`;
}
const cat = (...parts) => { const out = new Uint8Array(parts.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of parts) { out.set(x, i); i += x.length; } return out; };
async function hkdf(salt, ikm, info, len) {
  const k = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, k, len * 8));
}
async function encryptPush(sub, text) {
  const uaPub = unb64url(sub.p256dh), authSecret = unb64url(sub.auth);
  const as = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPub = new Uint8Array(await crypto.subtle.exportKey("raw", as.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, as.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, cat(enc.encode("WebPush: info\0"), uaPub, asPub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, cat(enc.encode(text), new Uint8Array([2]))));
  const head = new Uint8Array(21); head.set(salt, 0); new DataView(head.buffer).setUint32(16, 4096); head[20] = 65;
  return cat(head, asPub, ct);
}
async function sendPush(env, sub, msg) {
  try {
    const r = await fetch(sub.endpoint, {
      method: "POST",
      headers: {
        Authorization: await vapidHeader(env, sub.endpoint),
        "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream",
        TTL: "3600", Urgency: msg.tone === "alert" ? "high" : "normal"
      },
      body: await encryptPush(sub, JSON.stringify(msg))
    });
    if (r.status === 404 || r.status === 410) {
      await env.DB.prepare("DELETE FROM push_subs WHERE endpoint = ?").bind(sub.endpoint).run();
      return { ok: false, gone: true, status: r.status };
    }
    if (r.status >= 200 && r.status < 300) {
      await env.DB.prepare("UPDATE push_subs SET last_ok_at = ? WHERE endpoint = ?").bind(nowIso(), sub.endpoint).run();
      return { ok: true };
    }
    return { ok: false, status: r.status, error: (await r.text()).slice(0, 200) };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
}
async function pushSubscribe(env, me, b, request) {
  const s = b.subscription || {};
  const endpoint = String(s.endpoint || ""), keys = s.keys || {};
  if (!/^https:\/\//.test(endpoint) || !keys.p256dh || !keys.auth) throw fail("This device did not return a valid push subscription");
  const level = b.level === "all" ? "all" : "important";
  const device = String(request.headers.get("user-agent") || "").slice(0, 160);
  await env.DB.prepare(`INSERT INTO push_subs (endpoint, email, p256dh, auth, level, device, created_at) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(endpoint) DO UPDATE SET email=excluded.email, p256dh=excluded.p256dh, auth=excluded.auth, level=excluded.level, device=excluded.device`)
    .bind(endpoint, me.email, keys.p256dh, keys.auth, level, device, nowIso()).run();
  await ensureWatermark(env);
  return { subscribed: true, level };
}
async function pushStatus(env, me, endpoint) {
  const row = endpoint ? await env.DB.prepare("SELECT level FROM push_subs WHERE endpoint = ? AND email = ?").bind(endpoint, me.email).first() : null;
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM push_subs WHERE email = ?").bind(me.email).first();
  return { subscribed: !!row, level: row ? row.level : "important", devices: Number(n.n || 0) };
}
async function pushTest(env, me, b) {
  const row = await env.DB.prepare("SELECT * FROM push_subs WHERE endpoint = ? AND email = ?").bind(String(b.endpoint || ""), me.email).first();
  if (!row) throw fail("Notifications are not turned on for this device");
  const r = await sendPush(env, row, { title: "ABC Operations Hub", body: "Test notification — this device will receive hub alerts.", tone: "info", url: "/", tag: "hub-test" });
  if (!r.ok) throw fail(r.gone ? "This device's subscription has expired — turn notifications on again" : `The push service refused the message (${r.status || r.error})`, 502);
  return { sent: true };
}
async function ensureWatermark(env) {
  await env.DB.prepare("INSERT OR IGNORE INTO meta (k, v) VALUES ('push:wm', ?)").bind(nowIso()).run();
}

/* Runs every 2 minutes from the cron: finds events newer than the last run
   and pushes them to each subscribed device the person is allowed to see. */
async function pushRun(env) {
  const subsQ = await env.DB.prepare(
    "SELECT s.*, u.site_code, u.role FROM push_subs s JOIN users u ON u.email = s.email WHERE u.active = 1").all();
  const subs = subsQ.results || [];
  const wmRow = await env.DB.prepare("SELECT v FROM meta WHERE k = 'push:wm'").first();
  if (!wmRow) { await ensureWatermark(env); return; }
  const wm = wmRow.v;
  if (!subs.length) { await env.DB.prepare("UPDATE meta SET v = ? WHERE k = 'push:wm'").bind(nowIso()).run(); return; }
  const events = (await gatherNotify(env, "ALL", wm)).filter(e => e.at > wm && e.at <= nowIso());
  if (!events.length) return;
  const newest = events.reduce((m, e) => (e.at > m ? e.at : m), wm);
  await env.DB.prepare("UPDATE meta SET v = ? WHERE k = 'push:wm'").bind(newest).run();
  const names = { snaglist: "Snaglist", incidents: "Incidents", restroom: "Restroom", schedule: "Schedule", mom: "MOM", handover: "Handover" };
  for (const sub of subs) {
    const mine = events.filter(e =>
      (!e.to || e.to === sub.email) &&
      (e.to === sub.email || !sub.site_code || !e.site || e.site === sub.site_code) &&
      roleAllows(sub.role, e.app) &&
      (sub.level === "all" || e.tone === "alert" || e.tone === "warn"));
    if (!mine.length) continue;
    if (mine.length <= 3) {
      for (const e of mine.reverse()) {
        await sendPush(env, sub, { title: `${names[e.app] || e.app} · ${e.title}`, body: e.body, tone: e.tone, url: `/#/app/${e.app}`, tag: e.id });
      }
    } else {
      const alerts = mine.filter(e => e.tone === "alert").length;
      await sendPush(env, sub, {
        title: `${mine.length} new alerts in the hub`,
        body: `${alerts ? alerts + " urgent · " : ""}${[...new Set(mine.map(e => names[e.app] || e.app))].join(", ")}`,
        tone: alerts ? "alert" : "warn", url: "/#/", tag: "hub-summary"
      });
    }
  }
}

/* =====================================================================
   OPERATIONS TOOLS — Schedule · Minutes of Meeting · Handover
   ===================================================================== */
const SHIFT_CODES = {
  OFF:   { label: "Off day" },
  VAC:   { label: "Vacation (annual leave)" },
  UL:    { label: "Unpaid leave" },
  SICK:  { label: "Sick leave" },
  DEATH: { label: "Bereavement" },
  HOLI:  { label: "Public holiday" },
  TRAIN: { label: "Training / First aid" },
  OTH:   { label: "Other flagship" }
};
const isDay = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));
const isShift = v => /^([01]\d|2[0-4]):[03]0-([01]\d|2[0-4]):[03]0$/.test(String(v || ""));
const siteName = c => SITES[c] || c;

function opsSite(me, requested) {
  const want = String(requested || "").toUpperCase();
  if (me.role === "ADMIN") return SITES[want] ? want : (me.site_code || "VRM");
  if (!me.site_code) throw fail("Your account has no flagship. Ask the administrator to set one.", 403);
  return me.site_code;
}
const rankOf = p => (POSITIONS[p] ? POSITIONS[p].rank : 9);
async function siteStaff(env, site) {
  const { results } = await env.DB.prepare(
    "SELECT email, full_name, role, position, site_code FROM users WHERE active = 1 AND (site_code = ? OR role = 'ADMIN')").bind(site).all();
  return (results || []).map(u => ({
    email: u.email, name: u.full_name, role: u.role, position: u.position || "",
    positionLabel: POSITIONS[u.position] ? POSITIONS[u.position].label : (ROLES[u.role] || u.role),
    atSite: u.site_code === site
  })).sort((a, b) => rankOf(a.position) - rankOf(b.position) || a.name.localeCompare(b.name));
}
function rights(me, site) {
  const mine = me.role === "ADMIN" || me.site_code === site;
  const lead = me.role === "ADMIN" || me.role === "MANAGER" || me.position === "SMS";
  return {
    schedule: mine && lead,
    mom: mine && (lead || me.role === "SUPERVISOR"),
    handover: mine && me.role !== "SECURITY"
  };
}
async function getSetting(env, site, k, dflt) {
  const r = await env.DB.prepare("SELECT v FROM ops_settings WHERE site = ? AND k = ?").bind(site, k).first();
  return r ? JSON.parse(r.v) : dflt;
}
async function putSetting(env, site, k, v) {
  await env.DB.prepare("INSERT INTO ops_settings (site, k, v) VALUES (?,?,?) ON CONFLICT(site, k) DO UPDATE SET v = excluded.v")
    .bind(site, k, JSON.stringify(v)).run();
}
const beirutToday = () => beirutDate();

async function opsRoute(env, me, p, method, b, url) {
  const q = k => url.searchParams.get(k);
  const site = opsSite(me, method === "GET" ? q("site") : b.site);
  const can = rights(me, site);

  if (p === "context") {
    return { me: { ...userOut(me) }, site, siteName: siteName(site), sites: SITES,
      canPickSite: me.role === "ADMIN", can, staff: await siteStaff(env, site),
      positions: Object.fromEntries(Object.entries(POSITIONS).map(([k, v]) => [k, v.label])), codes: SHIFT_CODES, today: beirutToday() };
  }

  /* ----- schedule ----- */
  if (p === "schedule" && method === "GET") {
    const from = q("from"), to = q("to");
    if (!isDay(from) || !isDay(to)) throw fail("Choose a week");
    const [cells, notes] = await Promise.all([
      env.DB.prepare("SELECT day, email, val FROM sched_cells WHERE site = ? AND day BETWEEN ? AND ?").bind(site, from, to).all(),
      env.DB.prepare("SELECT day, note FROM sched_notes WHERE site = ? AND day BETWEEN ? AND ?").bind(site, from, to).all()
    ]);
    const staff = (await siteStaff(env, site)).filter(s => s.atSite && POSITIONS[s.position]);
    return { site, staff, cells: cells.results || [], notes: notes.results || [], can };
  }
  if (p === "schedule" && method === "POST") {
    if (!can.schedule) throw fail("Only the flagship's Manager or Senior Mall Supervisor can edit the schedule", 403);
    const staff = new Set((await siteStaff(env, site)).filter(s => s.atSite).map(s => s.email));
    const ops = [];
    for (const c of (Array.isArray(b.cells) ? b.cells : []).slice(0, 800)) {
      if (!isDay(c.day) || !staff.has(c.email)) continue;
      const v = String(c.val || "");
      if (!v) ops.push(env.DB.prepare("DELETE FROM sched_cells WHERE site = ? AND day = ? AND email = ?").bind(site, c.day, c.email));
      else if (isShift(v) || SHIFT_CODES[v]) ops.push(env.DB.prepare(
        `INSERT INTO sched_cells (site, day, email, val, updated_by, updated_at) VALUES (?,?,?,?,?,?)
         ON CONFLICT(site, day, email) DO UPDATE SET val = excluded.val, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
        .bind(site, c.day, c.email, v, me.email, nowIso()));
    }
    for (const n of (Array.isArray(b.notes) ? b.notes : []).slice(0, 60)) {
      if (!isDay(n.day)) continue;
      const t = String(n.note || "").trim().slice(0, 120);
      ops.push(t ? env.DB.prepare("INSERT INTO sched_notes (site, day, note) VALUES (?,?,?) ON CONFLICT(site, day) DO UPDATE SET note = excluded.note").bind(site, n.day, t)
                 : env.DB.prepare("DELETE FROM sched_notes WHERE site = ? AND day = ?").bind(site, n.day));
    }
    for (let i = 0; i < ops.length; i += 90) await env.DB.batch(ops.slice(i, i + 90));
    if (b.announce) await raiseEvent(env, { site, app: "schedule", tone: "info",
      title: `Schedule updated · ${siteName(site)}`, body: `${b.announce} · by ${me.full_name}` });
    return { saved: ops.length };
  }

  /* ----- minutes of meeting ----- */
  if (p === "mom/list") {
    const { results } = await env.DB.prepare(
      `SELECT m.id, m.title, m.meet_date, m.status, m.participants,
              (SELECT COUNT(*) FROM mom_actions a WHERE a.meeting_id = m.id) AS actions,
              (SELECT COUNT(*) FROM mom_actions a WHERE a.meeting_id = m.id AND a.status = 'Open') AS open
         FROM mom_meetings m WHERE m.site = ? ORDER BY m.meet_date DESC, m.id DESC LIMIT 60`).bind(site).all();
    return { site, can, meetings: (results || []).map(r => ({ id: r.id, title: r.title, date: r.meet_date, status: r.status,
      attended: JSON.parse(r.participants || "[]").filter(x => x.attended).length, actions: r.actions, open: r.open })) };
  }
  if (p === "mom/new") {
    const last = await env.DB.prepare("SELECT id, meet_date FROM mom_meetings WHERE site = ? AND status = 'published' ORDER BY meet_date DESC LIMIT 1").bind(site).first();
    const carry = await env.DB.prepare("SELECT * FROM mom_actions WHERE site = ? AND status = 'Open' ORDER BY due = '', due, id").bind(site).all();
    const staff = await siteStaff(env, site);
    const today = beirutToday();
    return {
      meeting: { id: 0, site, title: `ABC ${siteName(site)} - Minutes of Meeting`, date: today, weekNo: String(isoWeek(today)),
        location: `ABC ${siteName(site)} - Conference Room`, nextDate: "", lastDate: last ? last.meet_date : "",
        participants: staff.filter(s => s.atSite).map(s => ({ email: s.email, name: s.name, position: s.positionLabel, attended: false })),
        points: await getSetting(env, site, "agenda", []), preparedBy: me.full_name, preparedEmail: me.email, status: "draft" },
      actions: [], carried: (carry.results || []).map(actionOut), staff, can
    };
  }
  if (p === "mom/get") {
    const m = await env.DB.prepare("SELECT * FROM mom_meetings WHERE id = ?").bind(Number(q("id")) || 0).first();
    if (!m || (me.role !== "ADMIN" && m.site !== me.site_code)) throw fail("Meeting not found", 404);
    const [acts, carry] = await Promise.all([
      env.DB.prepare("SELECT * FROM mom_actions WHERE meeting_id = ? ORDER BY seq, id").bind(m.id).all(),
      env.DB.prepare("SELECT * FROM mom_actions WHERE site = ? AND status = 'Open' AND meeting_id != ? AND meeting_id IN (SELECT id FROM mom_meetings WHERE meet_date <= ?) ORDER BY due = '', due, id").bind(m.site, m.id, m.meet_date).all()
    ]);
    return { meeting: meetingOut(m), actions: (acts.results || []).map(actionOut), carried: (carry.results || []).map(actionOut),
      staff: await siteStaff(env, m.site), can: rights(me, m.site) };
  }
  if (p === "mom/save" && method === "POST") return saveMeeting(env, me, site, can, b);
  if (p === "mom/agenda" && method === "POST") {
    if (!can.mom) throw fail("Not allowed", 403);
    const items = (Array.isArray(b.points) ? b.points : []).map(x => String(x || "").trim().slice(0, 300)).filter(Boolean).slice(0, 40);
    await putSetting(env, site, "agenda", items);
    return { saved: items.length };
  }
  if (p === "mom/delete" && method === "POST") {
    if (!can.mom) throw fail("Not allowed", 403);
    const m = await env.DB.prepare("SELECT status FROM mom_meetings WHERE id = ? AND site = ?").bind(Number(b.id) || 0, site).first();
    if (!m) throw fail("Meeting not found", 404);
    if (m.status === "published" && me.role !== "ADMIN") throw fail("Published minutes can only be deleted by an administrator", 403);
    await env.DB.batch([env.DB.prepare("DELETE FROM mom_actions WHERE meeting_id = ?").bind(Number(b.id)),
                        env.DB.prepare("DELETE FROM mom_meetings WHERE id = ?").bind(Number(b.id))]);
    return { deleted: true };
  }
  if (p === "tasks") {
    const mine = q("mine") === "1";
    const { results } = await env.DB.prepare(
      `SELECT a.*, m.title AS meeting_title, m.meet_date FROM mom_actions a JOIN mom_meetings m ON m.id = a.meeting_id
        WHERE m.status = 'published' AND ${mine ? "a.owner_email = ?" : "a.site = ?"}
        ORDER BY a.status = 'Done', a.due = '', a.due, a.id LIMIT 300`).bind(mine ? me.email : site).all();
    return { tasks: (results || []).map(r => ({ ...actionOut(r), meetingTitle: r.meeting_title, meetingDate: r.meet_date })), can };
  }
  if (p === "tasks/status" && method === "POST") {
    const a = await env.DB.prepare("SELECT * FROM mom_actions WHERE id = ?").bind(Number(b.id) || 0).first();
    if (!a) throw fail("Task not found", 404);
    const r = rights(me, a.site);
    if (a.owner_email !== me.email && !r.mom) throw fail("Only the person responsible or the meeting organisers can update this task", 403);
    const done = b.status === "Done";
    await env.DB.prepare("UPDATE mom_actions SET status = ?, done_at = ? WHERE id = ?").bind(done ? "Done" : "Open", done ? nowIso() : "", a.id).run();
    return { id: a.id, status: done ? "Done" : "Open" };
  }

  /* ----- handover ----- */
  if (p === "handover/list") {
    const { results } = await env.DB.prepare(
      "SELECT id, day, shift, status, created_name, submitted_at, received_by, received_at, updated_at FROM handovers WHERE site = ? ORDER BY day DESC, shift DESC, id DESC LIMIT 60").bind(site).all();
    return { site, can, handovers: results || [] };
  }
  if (p === "handover/new") {
    const last = await env.DB.prepare("SELECT * FROM handovers WHERE site = ? ORDER BY day DESC, shift DESC, id DESC LIMIT 1").bind(site).first();
    const day = isDay(q("day")) ? q("day") : beirutToday();
    return { handover: { id: 0, site, day, shift: q("shift") === "PM" ? "PM" : "AM", status: "draft",
      doc: carryHandover(last ? JSON.parse(last.doc) : null, day), createdName: me.full_name, from: last ? { day: last.day, shift: last.shift } : null }, can };
  }
  if (p === "handover/get") {
    const h = await env.DB.prepare("SELECT * FROM handovers WHERE id = ?").bind(Number(q("id")) || 0).first();
    if (!h || (me.role !== "ADMIN" && h.site !== me.site_code)) throw fail("Handover not found", 404);
    return { handover: handoverOut(h), can: rights(me, h.site) };
  }
  if (p === "handover/save" && method === "POST") {
    if (!can.handover) throw fail("Not allowed", 403);
    if (!isDay(b.day)) throw fail("Choose the handover date");
    const shift = b.shift === "PM" ? "PM" : "AM";
    const doc = JSON.stringify(cleanHandover(b.doc || {}));
    if (doc.length > 60000) throw fail("This handover is too long — move older items to Additional notes or remove finished ones");
    let id = Number(b.id) || 0;
    const at = nowIso();
    if (id) {
      const h = await env.DB.prepare("SELECT site FROM handovers WHERE id = ?").bind(id).first();
      if (!h || h.site !== site) throw fail("Handover not found", 404);
      await env.DB.prepare("UPDATE handovers SET day = ?, shift = ?, doc = ?, updated_at = ? WHERE id = ?").bind(b.day, shift, doc, at, id).run();
    } else {
      const r = await env.DB.prepare(`INSERT INTO handovers (site, day, shift, doc, status, created_by, created_name, created_at, updated_at)
        VALUES (?,?,?,?,'draft',?,?,?,?)`).bind(site, b.day, shift, doc, me.email, me.full_name, at, at).run();
      id = r.meta.last_row_id;
    }
    if (b.submit) {
      await env.DB.prepare("UPDATE handovers SET status = 'submitted', submitted_at = ? WHERE id = ?").bind(at, id).run();
      const d = JSON.parse(doc);
      const cctv = [...d.ongoing, ...d.today, ...d.tomorrow].filter(x => x.cctv && !x.done).length;
      await raiseEvent(env, { site, app: "handover", tone: cctv ? "warn" : "info",
        title: `Handover submitted · ${shift === "AM" ? "Morning" : "Evening"} ${b.day}`,
        body: `${siteName(site)} · by ${me.full_name} · ${d.today.length} today, ${d.ongoing.filter(x => !x.done).length} ongoing${cctv ? ` · ${cctv} ATT CCTV` : ""}` });
    }
    return { id, saved: true };
  }
  if (p === "handover/receive" && method === "POST") {
    const h = await env.DB.prepare("SELECT * FROM handovers WHERE id = ?").bind(Number(b.id) || 0).first();
    if (!h || (me.role !== "ADMIN" && h.site !== me.site_code)) throw fail("Handover not found", 404);
    if (h.status !== "submitted") throw fail("This handover has not been submitted yet");
    await env.DB.prepare("UPDATE handovers SET received_by = ?, received_at = ? WHERE id = ?").bind(me.full_name, nowIso(), h.id).run();
    if (h.created_by && h.created_by !== me.email) await raiseEvent(env, { site: h.site, app: "handover", email: h.created_by, tone: "ok",
      title: "Your handover was received", body: `${h.day} ${h.shift === "AM" ? "Morning" : "Evening"} · received by ${me.full_name}` });
    return { received: true };
  }
  if (p === "handover/delete" && method === "POST") {
    const h = await env.DB.prepare("SELECT * FROM handovers WHERE id = ?").bind(Number(b.id) || 0).first();
    if (!h || h.site !== site) throw fail("Handover not found", 404);
    if (h.status !== "draft" && me.role !== "ADMIN") throw fail("Only drafts can be deleted", 403);
    await env.DB.prepare("DELETE FROM handovers WHERE id = ?").bind(h.id).run();
    return { deleted: true };
  }
  throw fail("Unknown endpoint", 404);
}

function isoWeek(day) {
  const d = new Date(day + "T12:00:00Z");
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  return Math.ceil(((t - new Date(Date.UTC(t.getUTCFullYear(), 0, 1))) / 864e5 + 1) / 7);
}
const meetingOut = m => ({ id: m.id, site: m.site, title: m.title, date: m.meet_date, weekNo: m.week_no, location: m.location,
  nextDate: m.next_date, lastDate: m.last_date, participants: JSON.parse(m.participants || "[]"), points: JSON.parse(m.points || "[]"),
  preparedBy: m.prepared_by, status: m.status, publishedAt: m.published_at, createdBy: m.created_by });
const actionOut = a => ({ id: a.id, meetingId: a.meeting_id, seq: a.seq, text: a.text, ownerEmail: a.owner_email,
  ownerName: a.owner_name, due: a.due, status: a.status, doneAt: a.done_at });

async function saveMeeting(env, me, site, can, b) {
  if (!can.mom) throw fail("Only the flagship's Manager, Senior Mall Supervisor or Supervisors can write minutes", 403);
  const m = b.meeting || {};
  if (!isDay(m.date)) throw fail("Choose the meeting date");
  const title = String(m.title || "").trim().slice(0, 160) || `ABC ${siteName(site)} - Minutes of Meeting`;
  const parts = (Array.isArray(m.participants) ? m.participants : []).slice(0, 80).map(x => ({
    email: String(x.email || "").slice(0, 120), name: String(x.name || "").trim().slice(0, 80),
    position: String(x.position || "").slice(0, 60), attended: !!x.attended })).filter(x => x.name);
  const points = (Array.isArray(m.points) ? m.points : []).map(x => String(x || "").trim().slice(0, 400)).filter(Boolean).slice(0, 60);
  const vals = [title, m.date, String(m.weekNo || "").slice(0, 10), String(m.location || "").slice(0, 160),
    isDay(m.nextDate) ? m.nextDate : "", isDay(m.lastDate) ? m.lastDate : "", JSON.stringify(parts), JSON.stringify(points),
    String(m.preparedBy || me.full_name).slice(0, 80)];
  const at = nowIso();
  let id = Number(m.id) || 0;
  if (id) {
    const ex = await env.DB.prepare("SELECT site FROM mom_meetings WHERE id = ?").bind(id).first();
    if (!ex || ex.site !== site) throw fail("Meeting not found", 404);
    await env.DB.prepare(`UPDATE mom_meetings SET title=?, meet_date=?, week_no=?, location=?, next_date=?, last_date=?, participants=?, points=?, prepared_by=?, updated_at=? WHERE id=?`)
      .bind(...vals, at, id).run();
  } else {
    const r = await env.DB.prepare(`INSERT INTO mom_meetings (title, meet_date, week_no, location, next_date, last_date, participants, points, prepared_by, site, status, created_by, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,'draft',?,?,?)`).bind(...vals, site, me.email, at, at).run();
    id = r.meta.last_row_id;
  }
  /* actions: replace this meeting's list, keeping ids so notifications are not repeated */
  const incoming = (Array.isArray(b.actions) ? b.actions : []).slice(0, 80)
    .map((a, i) => ({ id: Number(a.id) || 0, seq: i + 1, text: String(a.text || "").trim().slice(0, 400),
      ownerEmail: String(a.ownerEmail || "").slice(0, 120), ownerName: String(a.ownerName || "").trim().slice(0, 80),
      due: isDay(a.due) ? a.due : "", status: a.status === "Done" ? "Done" : "Open" })).filter(a => a.text);
  const existing = await env.DB.prepare("SELECT id FROM mom_actions WHERE meeting_id = ?").bind(id).all();
  const keep = new Set(incoming.filter(a => a.id).map(a => a.id));
  const ops = (existing.results || []).filter(r => !keep.has(r.id)).map(r => env.DB.prepare("DELETE FROM mom_actions WHERE id = ?").bind(r.id));
  for (const a of incoming) {
    if (a.id) ops.push(env.DB.prepare(`UPDATE mom_actions SET seq=?, text=?, owner_email=?, owner_name=?, due=?, status=?,
        done_at = CASE WHEN ? = 'Done' AND done_at = '' THEN ? WHEN ? = 'Open' THEN '' ELSE done_at END,
        notified_at = CASE WHEN owner_email != ? OR due != ? THEN '' ELSE notified_at END WHERE id=? AND meeting_id=?`)
      .bind(a.seq, a.text, a.ownerEmail, a.ownerName, a.due, a.status, a.status, at, a.status, a.ownerEmail, a.due, a.id, id));
    else ops.push(env.DB.prepare(`INSERT INTO mom_actions (meeting_id, site, seq, text, owner_email, owner_name, due, status, done_at, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(id, site, a.seq, a.text, a.ownerEmail, a.ownerName, a.due, a.status, a.status === "Done" ? at : "", at));
  }
  /* carried-forward items from earlier meetings: status only */
  for (const c of (Array.isArray(b.carried) ? b.carried : []).slice(0, 100)) {
    ops.push(env.DB.prepare("UPDATE mom_actions SET status = ?, done_at = CASE WHEN ? = 'Done' AND done_at = '' THEN ? ELSE done_at END WHERE id = ? AND site = ?")
      .bind(c.status === "Done" ? "Done" : "Open", c.status === "Done" ? "Done" : "Open", at, Number(c.id) || 0, site));
  }
  if (ops.length) await env.DB.batch(ops);

  let notified = 0;
  const publish = !!b.publish;
  const cur = await env.DB.prepare("SELECT status FROM mom_meetings WHERE id = ?").bind(id).first();
  if (publish && cur.status !== "published") {
    await env.DB.prepare("UPDATE mom_meetings SET status = 'published', published_at = ? WHERE id = ?").bind(at, id).run();
  }
  if (publish || cur.status === "published") {
    /* tell each responsible person once about each task (again if owner or deadline changes) */
    const { results } = await env.DB.prepare("SELECT * FROM mom_actions WHERE meeting_id = ? AND owner_email != '' AND notified_at = '' AND status = 'Open'").bind(id).all();
    for (const a of results || []) {
      await raiseEvent(env, { site, app: "mom", email: a.owner_email, tone: "warn",
        title: `New task from the meeting of ${fmtDay(m.date)}`,
        body: `${a.text}${a.due ? ` · due ${fmtDay(a.due)}` : ""}` });
      await env.DB.prepare("UPDATE mom_actions SET notified_at = ? WHERE id = ?").bind(at, a.id).run();
      notified++;
    }
    if (publish && !b.republish) await raiseEvent(env, { site, app: "mom", tone: "info",
      title: `Minutes published · ${fmtDay(m.date)}`, body: `${title} · ${incoming.length} action${incoming.length === 1 ? "" : "s"} · by ${me.full_name}` });
  }
  return { id, notified, status: publish ? "published" : cur.status };
}
const fmtDay = d => { try { return new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short" }); } catch { return d; } };

/* Once a day at 09:00 Beirut: reminders for MOM tasks due tomorrow, today, or overdue */
async function taskReminders(env) {
  if (beirutHour() !== 9) return;
  const today = beirutToday();
  const claim = await env.DB.prepare("INSERT OR IGNORE INTO meta (k, v) VALUES (?, ?)").bind("tasks:" + today, nowIso()).run();
  if (!claim.meta || claim.meta.changes !== 1) return;
  const tomorrow = new Date(new Date(today + "T12:00:00Z").getTime() + 864e5).toISOString().slice(0, 10);
  const { results } = await env.DB.prepare(
    `SELECT a.* FROM mom_actions a JOIN mom_meetings m ON m.id = a.meeting_id
      WHERE m.status = 'published' AND a.status = 'Open' AND a.owner_email != '' AND a.due != '' AND a.due <= ?`).bind(tomorrow).all();
  for (const a of results || []) {
    const late = a.due < today;
    await raiseEvent(env, { site: a.site, app: "mom", email: a.owner_email, tone: late || a.due === today ? "alert" : "warn",
      title: late ? `Task overdue since ${fmtDay(a.due)}` : a.due === today ? "Task due today" : "Task due tomorrow",
      body: a.text });
  }
  await env.DB.prepare("DELETE FROM usage_log WHERE at < ?").bind(new Date(Date.now() - 400 * 864e5).toISOString()).run();
  await env.DB.prepare("DELETE FROM hub_events WHERE at < ?").bind(new Date(Date.now() - 60 * 864e5).toISOString()).run();
}

/* ----- handover document ----- */
const HANDOVER_SECTIONS = ["ongoing", "today", "tomorrow", "upcoming", "events", "checklists", "docs"];
function blankHandover() {
  return { ongoing: [], today: [], tomorrow: [], upcoming: [], events: [],
    checklists: [{ name: "Mall Opening and Closing Checklist", am: "", pm: "", note: "" }, { name: "Restrooms Checklist", am: "", pm: "", note: "" }],
    docs: [], notes: "" };
}
const s = (v, n) => String(v == null ? "" : v).slice(0, n);
function cleanHandover(d) {
  const item = x => ({ text: s(x.text, 500), cctv: !!x.cctv, done: !!x.done, date: isDay(x.date) ? x.date : "" });
  const out = blankHandover();
  for (const k of ["ongoing", "today", "tomorrow", "upcoming"]) out[k] = (Array.isArray(d[k]) ? d[k] : []).slice(0, 80).map(item).filter(x => x.text.trim());
  out.events = (Array.isArray(d.events) ? d.events : []).slice(0, 40).map(e => ({ from: isDay(e.from) ? e.from : "", to: isDay(e.to) ? e.to : "",
    name: s(e.name, 160), start: s(e.start, 5), end: s(e.end, 5) })).filter(e => e.name.trim());
  out.checklists = (Array.isArray(d.checklists) ? d.checklists : []).slice(0, 30).map(c => ({ name: s(c.name, 120),
    am: ["Done", "Not done", "N/A", ""].includes(c.am) ? c.am : "", pm: ["Done", "Not done", "N/A", ""].includes(c.pm) ? c.pm : "", note: s(c.note, 200) })).filter(c => c.name.trim());
  out.docs = (Array.isArray(d.docs) ? d.docs : []).slice(0, 40).map(x => ({ label: s(x.label, 160), url: s(x.url, 400), task: s(x.task, 80),
    updated: isDay(x.updated) ? x.updated : "", comment: s(x.comment, 200) })).filter(x => x.label.trim() || x.url.trim());
  out.notes = s(d.notes, 4000);
  return out;
}
/* A new handover starts from the last one: unfinished follow-ups stay, yesterday's "tomorrow"
   becomes today, dated items arrive on their day, finished events drop off, checklists reset. */
function carryHandover(prev, day) {
  if (!prev) return blankHandover();
  const d = cleanHandover(prev);
  const due = d.upcoming.filter(x => x.date && x.date <= day);
  return {
    ongoing: d.ongoing.filter(x => !x.done).map(x => ({ ...x })),
    today: [...d.today.filter(x => !x.done), ...d.tomorrow, ...due].map(x => ({ ...x, done: false, date: "" })),
    tomorrow: [],
    upcoming: d.upcoming.filter(x => !x.date || x.date > day),
    events: d.events.filter(e => !e.to || e.to >= day),
    checklists: d.checklists.map(c => ({ name: c.name, am: "", pm: "", note: "" })),
    docs: d.docs, notes: ""
  };
}
const handoverOut = h => ({ id: h.id, site: h.site, day: h.day, shift: h.shift, status: h.status, doc: cleanHandover(JSON.parse(h.doc)),
  createdName: h.created_name, createdBy: h.created_by, submittedAt: h.submitted_at, receivedBy: h.received_by, receivedAt: h.received_at, updatedAt: h.updated_at });

/* =====================================================================
   USAGE ANALYTICS (admin)
   ===================================================================== */
async function logUsage(env, u, app) {
  if (!app) return;
  await env.DB.prepare("INSERT INTO usage_log (at, email, site, role, app) VALUES (?,?,?,?,?)")
    .bind(nowIso(), u.email, u.site_code || "", u.role || "", app).run();
}
async function usageReport(env, days) {
  days = Math.min(365, Math.max(1, days));
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const [bySys, bySite, byDay, byUser, users] = await Promise.all([
    env.DB.prepare("SELECT app, COUNT(*) AS n, COUNT(DISTINCT email) AS people FROM usage_log WHERE at > ? AND app != 'signin' GROUP BY app ORDER BY n DESC").bind(since).all(),
    env.DB.prepare("SELECT site, app, COUNT(*) AS n FROM usage_log WHERE at > ? AND app != 'signin' GROUP BY site, app").bind(since).all(),
    env.DB.prepare("SELECT substr(at, 1, 10) AS d, COUNT(*) AS n, COUNT(DISTINCT email) AS people FROM usage_log WHERE at > ? GROUP BY d ORDER BY d").bind(since).all(),
    env.DB.prepare(`SELECT email, COUNT(*) AS n, MAX(at) AS last,
        SUM(CASE WHEN app = 'signin' THEN 1 ELSE 0 END) AS signins FROM usage_log WHERE at > ? GROUP BY email`).bind(since).all(),
    env.DB.prepare("SELECT email, full_name, role, site_code, position, active, last_login_at FROM users").all()
  ]);
  const topApp = {};
  const perUserApp = await env.DB.prepare("SELECT email, app, COUNT(*) AS n FROM usage_log WHERE at > ? AND app != 'signin' GROUP BY email, app").bind(since).all();
  for (const r of perUserApp.results || []) if (!topApp[r.email] || r.n > topApp[r.email].n) topApp[r.email] = r;
  const ub = Object.fromEntries((byUser.results || []).map(r => [r.email, r]));
  const people = (users.results || []).map(u => ({
    email: u.email, name: u.full_name, role: ROLES[u.role] || u.role, site: u.site_code || "", siteName: u.site_code ? siteName(u.site_code) : "All",
    position: POSITIONS[u.position] ? POSITIONS[u.position].label : "", active: !!u.active,
    opens: ub[u.email] ? ub[u.email].n - ub[u.email].signins : 0, signins: ub[u.email] ? ub[u.email].signins : 0,
    last: ub[u.email] ? ub[u.email].last : (u.last_login_at || ""), top: topApp[u.email] ? topApp[u.email].app : ""
  })).sort((a, b) => b.opens - a.opens || (b.last > a.last ? 1 : -1));
  const activeIds = new Set((byUser.results || []).map(r => r.email));
  const week = new Date(Date.now() - 7 * 864e5).toISOString();
  return {
    days, sites: SITES, generatedAt: nowIso(),
    totals: {
      opens: (bySys.results || []).reduce((a, r) => a + r.n, 0),
      activeUsers: activeIds.size,
      activeWeek: people.filter(p => p.last > week).length,
      accounts: people.filter(p => p.active).length,
      neverUsed: people.filter(p => p.active && !p.last).length
    },
    bySystem: bySys.results || [], bySite: bySite.results || [], byDay: byDay.results || [], people
  };
}
