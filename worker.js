import { GLA } from "./data/gla-data.js";
import { layoutsSchema, layoutsRoute, layoutsImage } from "./modules/layouts.js";   // Mall Layouts feature — see docs/FEATURE-layouts.md
import { propertySchema, propertyRoute } from "./modules/property.js";   // Property Details feature — see docs/FEATURE-property-details.md
import { remindersSchema, remindersRoute, remindersRun, reminderDone } from "./modules/reminders.js";   // Reminders feature — see docs/FEATURE-reminders.md
import { formsSchema, formsRoute } from "./modules/forms.js";   // Operations Forms feature — see docs/FEATURE-forms.md
import { emergencySchema, emergencyRoute, emergencyRun, emergencyDeps } from "./modules/emergency.js";   // Emergency Alert feature — see docs/FEATURE-emergency.md
export { EmergencyPager } from "./modules/emergency.js";
import { budgetSchema, budgetRoute } from "./modules/budget.js";
import { accuracyRoute } from "./modules/accuracy.js";   // Data Accuracy Score feature — see docs/FEATURE-accuracy.md
import { tenantsSchema, tenantsRoute, repeatCheck, announcementsOn } from "./modules/tenants.js";
import { directorySchema, directoryRoute, directoryPublic } from "./modules/directory.js";
import { worksSchema, worksInbox, worksFile, worksRoute } from "./modules/works.js";   // Tenant Works Forms feature — see docs/FEATURE-tenant-works.md   // Tenants Directory feature — see docs/FEATURE-directory.md
import { profileSchema, profileRoute, coversAdmin } from "./modules/profile.js";
import { twofaSchema, twofaOn, twofaGate, twofaPublic, twofaRoute, twofaAdmin, twofaClean, requiredRoles } from "./modules/twofa.js";   // Two-step login feature — see docs/FEATURE-two-step.md   // Profile feature — see docs/FEATURE-profile.md
import { leadershipRoute } from "./modules/leadership.js";   // Leadership dashboards feature — see docs/FEATURE-leadership.md
import { automationSchema, automationRun, backupData, eodEmailHtml } from "./modules/automation.js";   // Automation feature (EOD email, daily snapshot, weekly backup) — see docs/FEATURE-automation.md   // Tenant Management feature — see docs/FEATURE-tenant-management.md
import { calendarSchema, calendarRoute, calendarRun, calendarDayEvents, CAL_KINDS, DOC_TYPES } from "./modules/calendar.js";   // Operations Calendar feature — see docs/FEATURE-calendar.md
import { historySchema, makeAudit, historyClean, historyList, historyOf } from "./modules/history.js";   // Change history feature — see docs/FEATURE-history.md
import { evacSchema, evacRoute } from "./modules/evac.js";   // Tenant Evacuation Plan feature — see docs/FEATURE-evacuation.md
import { projectsSchema, projectsRoute, projectsRun } from "./modules/projects.js";   // Projects feature — see docs/FEATURE-projects.md
import { addinSchema, addinPair, addinUser, addinAllowed, addinRoute } from "./modules/addin.js";   // Outlook add-in feature — see docs/FEATURE-outlook-addin.md
import { mailInbox } from "./modules/inbox.js";   // Email inbox: MOM, calendar and contracts report by email — see docs/FEATURE-email-inbox.md
import { contractsSchema, contractsRoute, contractsRun } from "./modules/contracts.js";
import { portalSchema, portalRoute } from "./modules/portal.js";   // Tenant portal follow-up — see docs/FEATURE-portal-followup.md
import { storageStatus, storageRun } from "./modules/storage.js";   // Cloudflare storage (R2 / D1) meter for the admin — see docs/FEATURE-storage-meter.md   // Contracts near ending — see docs/FEATURE-email-inbox.md
import { schedMailRoute, schedCcAdmin, schedMailRun } from "./modules/schedmail.js";   // Weekly schedule email — see docs/FEATURE-schedule-email.md
import { todayRoute } from "./modules/today.js";   // Day to Day Operations timeline — see docs/FEATURE-day-to-day.md
import { packRoute } from "./modules/pack.js";   // Monthly operations pack feature — see docs/FEATURE-ops-pack.md
import { contractorsSchema, contractorsRoute, contractorsRun } from "./modules/contractors.js";
import { gateSchema, gateRoute, gateDay, gatePublic } from "./modules/gate.js";   // Loading Gate QR scanner — see docs/FEATURE-gate.md
import { execSchema, execRoute } from "./modules/exec.js";   // Executive Report feature — see docs/FEATURE-exec-report.md   // Budget (CAPEX / OPEX) feature — see docs/FEATURE-budget.md   // Emergency Alert feature: the 10-second pager (Durable Object)
/* =====================================================================
   ABC Operations Hub — backend (Cloudflare Worker + D1)
   Handles: hub accounts & roles, announcements, the daily brief,
   live tile badges, and single sign-in into connected systems.
   Static files (index.html, apps.js, icons…) are served as assets.
   ===================================================================== */

const audit = makeAudit(() => new Date().toISOString());   // Change history feature
emergencyDeps({ raiseEvent: (...a) => raiseEvent(...a), sendPush: (...a) => sendPush(...a), now: () => new Date().toISOString(), siteName: s => siteName(s) });   // Emergency Alert feature

const SITES = {
  VRM: "Verdun Mall",
  ACM: "Achrafieh Mall",
  DBS: "Dbayeh Department Store",
  ACS: "Achrafieh Department Store",
  VRS: "Verdun Department Store"
};
/* ---------- account hierarchy ----------
   Per flagship : MANAGER    = flagship management (Mall Manager / Senior Mall Manager, Operations Manager / Deputy) — everything at their flagship
                  SUPERVISOR = operations team (Mall Officer, Mall Supervisor, Senior Mall Supervisor)
                  SECURITY   = security
   Across flagships : ADVISOR  = Property Advisor — every flagship, full access
                      DIRECTOR = Mall Director — the flagships ticked for them, full access
                      CDSO     = Chief Department Store Operations Officer — the flagships ticked for her, full access
   ADMIN runs the hub (Hub administration) and sees everything. */
const ROLES = {
  ADMIN: "Admin",
  ADVISOR: "Property Advisor",
  DIRECTOR: "Mall Director",
  CDSO: "Chief Department Store Operations Officer",
  MANAGER: "Flagship Management",
  SUPERVISOR: "Operations Team",
  SECURITY: "Security"
};
const FULL_ROLES = ["ADMIN", "ADVISOR", "DIRECTOR", "CDSO", "MANAGER"];   // full access at the flagships they can reach
const MULTI_ROLES = ["DIRECTOR", "CDSO"];                                 // flagships chosen with check boxes
const ALL_SITE_ROLES = ["ADMIN", "ADVISOR"];                              // every flagship
/* Operations team positions, highest first. They decide who appears on the schedule and in what order. */
const POSITIONS = {
  SMS: { label: "Senior Mall Supervisor", rank: 1 },
  MS:  { label: "Mall Supervisor", rank: 2 },
  MO:  { label: "Mall Officer", rank: 3 },
  WH:  { label: "Warehouse", rank: 4, viewOnly: true }   // linked to a flagship, sees its data, not on the schedule, changes nothing
};
const isWarehouse = u => !!u && u.role === "SUPERVISOR" && u.position === "WH";
/* Flagship management titles. Each flagship has one person per slot. */
const TITLES = {
  SMM: { label: "Senior Mall Manager", slot: "MM", rank: -4 },
  MM:  { label: "Mall Manager", slot: "MM", rank: -3 },
  OM:  { label: "Operations Manager", slot: "OM", rank: -2 },
  DOM: { label: "Deputy Operations Manager", slot: "OM", rank: -1 }
};
const SLOTS = { MM: "Mall Manager / Senior Mall Manager", OM: "Operations Manager / Deputy Operations Manager" };
const posLabel = p => (POSITIONS[p] || TITLES[p] || {}).label || "";
/* Which flagships an account can open */
function sitesOf(u) {
  if (!u) return [];
  if (ALL_SITE_ROLES.includes(u.role)) return Object.keys(SITES);
  if (MULTI_ROLES.includes(u.role)) {
    const list = String(u.sites || "").split(",").filter(c => SITES[c]);
    return list.length ? list : (SITES[u.site_code] ? [u.site_code] : []);
  }
  return SITES[u.site_code] ? [u.site_code] : [];
}
const canSite = (u, site) => sitesOf(u).includes(site);
const isFull = u => FULL_ROLES.includes(u.role);
const sitesMap = u => Object.fromEntries(sitesOf(u).map(c => [c, SITES[c]]));
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
    day: "/api?hubsv=1&site={site}&date={date}",
    sso: "/api?sso={token}"
  },
  incidents: {
    base: "https://abc-incident-system.sultanachi-lb-61f.workers.dev",
    binding: "INCIDENTS",
    stats: "/api/hubstats?site={site}",
    notify: "/api/hubnotify?site={site}&since={since}",
    day: "/api/hubday?site={site}&date={date}",
    sso: "/api/sso?token={token}"
  },
  restroom: {
    base: "https://abc-restroom-report.sultanachi-lb-61f.workers.dev",
    binding: "RESTROOM",
    stats: "/api/hubstats?site={site}",
    notify: "/api/hubnotify?site={site}&since={since}",
    day: "/api/hubday?site={site}&date={date}",
    sso: "/api/sso?token={token}", probe: true   // automatic sign-in once connectors/hub-sso-connector.js is added to that system
  },
  "cleaner-qr": { base: "https://abcv-admin-access.sultanachi-lb-61f.workers.dev", binding: "CLEANER", sso: "/api/sso?token={token}", probe: true },
  footfall: { base: "https://footfall-hub.sultanachi-lb-61f.workers.dev", binding: "FOOTFALL", sso: "/api/sso?token={token}", probe: true }
};
/* SSO probe: a system answers /api/sso?probe=1 with {"ok":true,"sso":true} once its connector is in place —
   until then the tile simply opens the system's own sign-in page. Cached 10 minutes. */
const ssoProbeCache = new Map();
async function ssoReady(env, id, c) {
  if (!c.probe) return true;
  const hit = ssoProbeCache.get(id);
  if (hit && Date.now() - hit.at < 600e3) return hit.ok;
  let okk = false;
  try {
    const target = c.base + "/api/sso?probe=1";
    const r = c.binding && env[c.binding] ? await env[c.binding].fetch(target) : await fetch(target);
    const j = await r.json().catch(() => null);
    okk = !!(r.ok && j && j.ok && j.sso);
  } catch {}
  ssoProbeCache.set(id, { at: Date.now(), ok: okk });
  return okk;
}

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
const APP_ROLES = { restroom: ["MANAGER", "SUPERVISOR"], exec: ["MANAGER"] };

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
  if (!has("sites")) await env.DB.prepare("ALTER TABLE users ADD COLUMN sites TEXT NOT NULL DEFAULT ''").run();   // Mall Director / CDSO flagships
  await layoutsSchema(env);   // Mall Layouts feature
  await propertySchema(env);  // Property Details feature
  await remindersSchema(env); // Reminders feature
  await formsSchema(env);     // Operations Forms feature
  await emergencySchema(env); // Emergency Alert feature
  await budgetSchema(env);    // Budget (CAPEX / OPEX) feature
  await execSchema(env);      // Executive Report feature
  await tenantsSchema(env);   // Tenant Management feature
  await directorySchema(env);   // Tenants Directory feature
  await worksSchema(env);   // Tenant Works Forms feature
  await calendarSchema(env);   // Operations Calendar feature
  await historySchema(env);   // Change history feature
  await evacSchema(env);   // Tenant Evacuation Plan feature
  await contractorsSchema(env);   // Contractors feature
  await gateSchema(env);   // Loading Gate feature (after Contractors: adds sf_id to contractor_visits)
  await projectsSchema(env);   // Projects feature
  await addinSchema(env);   // Outlook add-in feature
  await contractsSchema(env);   // Contracts near ending
  await portalSchema(env);   // Tenant portal follow-up
  await profileSchema(env);     // Profile feature
  await twofaSchema(env);       // Two-step login feature
  await automationSchema(env); // Automation feature
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
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS gla_units (id INTEGER PRIMARY KEY AUTOINCREMENT, site TEXT NOT NULL, level TEXT NOT NULL,
      code TEXT NOT NULL, brand TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'Open', section TEXT NOT NULL DEFAULT 'Leasing',
      dept TEXT NOT NULL DEFAULT '', area REAL NOT NULL DEFAULT 0, seq INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT, updated_by TEXT)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS gla_units_site ON gla_units (site, active)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS gla_events (id INTEGER PRIMARY KEY AUTOINCREMENT, site TEXT NOT NULL, unit_id INTEGER NOT NULL,
      kind TEXT NOT NULL, eff_date TEXT NOT NULL, before TEXT NOT NULL DEFAULT '{}', after TEXT NOT NULL DEFAULT '{}', note TEXT NOT NULL DEFAULT '',
      by_name TEXT, by_email TEXT, created_at TEXT, date_edited_at TEXT NOT NULL DEFAULT '', date_edited_by TEXT NOT NULL DEFAULT '')`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS gla_events_site ON gla_events (site, eff_date)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS tenant_feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, site TEXT NOT NULL,
      tenant TEXT NOT NULL, day TEXT NOT NULL, time TEXT NOT NULL DEFAULT '', category TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      action TEXT NOT NULL DEFAULT '', action_desc TEXT NOT NULL DEFAULT '', created_by TEXT, created_name TEXT, created_at TEXT, updated_at TEXT)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS tf_site_day ON tenant_feedback (site, day)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS ops_settings (site TEXT NOT NULL, k TEXT NOT NULL, v TEXT NOT NULL, PRIMARY KEY (site, k))`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS handovers (id INTEGER PRIMARY KEY AUTOINCREMENT, site TEXT NOT NULL, day TEXT NOT NULL,
      shift TEXT NOT NULL DEFAULT 'AM', doc TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft',
      created_by TEXT, created_name TEXT, created_at TEXT, updated_at TEXT,
      submitted_at TEXT NOT NULL DEFAULT '', received_by TEXT NOT NULL DEFAULT '', received_at TEXT NOT NULL DEFAULT '')`)
  ]);
  const hcols = (await env.DB.prepare("PRAGMA table_info(handovers)").all()).results || [];   // one shared handover per day
  if (hcols.length && !hcols.some(c => c.name === "handoffs")) await env.DB.prepare("ALTER TABLE handovers ADD COLUMN handoffs TEXT NOT NULL DEFAULT '[]'").run();
  if (hcols.length && !hcols.some(c => c.name === "updated_name")) await env.DB.prepare("ALTER TABLE handovers ADD COLUMN updated_name TEXT NOT NULL DEFAULT ''").run();
  const mcols = await env.DB.prepare("PRAGMA table_info(mom_meetings)").all();   // MOM meeting type (for reports)
  if ((mcols.results || []).length && !(mcols.results || []).some(c => c.name === "meeting_type"))
    await env.DB.prepare("ALTER TABLE mom_meetings ADD COLUMN meeting_type TEXT NOT NULL DEFAULT ''").run();
  const gcols = await env.DB.prepare("PRAGMA table_info(gla_units)").all();
  if ((gcols.results || []).length && !(gcols.results || []).some(c => c.name === "contract_start"))
    await env.DB.prepare("ALTER TABLE gla_units ADD COLUMN contract_start TEXT NOT NULL DEFAULT ''").run();
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
const userOut = u => {
  const list = sitesOf(u);
  return {
    email: u.email, name: u.full_name, role: u.role, roleLabel: ROLES[u.role] || u.role,
    site: u.site_code || "", siteName: u.site_code ? SITES[u.site_code] || u.site_code
      : ALL_SITE_ROLES.includes(u.role) ? "All flagships" : "",
    sites: list, sitesLabel: list.length === Object.keys(SITES).length ? "All flagships" : list.map(c => SITES[c]).join(", "),
    full: isFull(u), mustChange: !!u.must_change,
    position: u.position || "", positionLabel: posLabel(u.position), photoAt: u.photo_at || ""
  };
};

/* ---------- entry ---------- */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      try { return await route(request, env, ctx, url); }
      catch (e) { return json({ ok: false, error: e.message || String(e), ...(e.extra || {}) }, e.status || 500); }
    }
    /* Tenants Directory feature: the reception link opens the directory page (no hub account) */
    if (/^\/reception\/[\w-]{16,40}\/?$/.test(url.pathname)) {
      const r = await env.ASSETS.fetch(new Request(new URL("/tools/directory", url), request));
      const h = new Headers(r.headers); h.set("x-robots-tag", "noindex"); h.set("referrer-policy", "no-referrer"); h.set("cache-control", "no-store");
      return new Response(r.body, { status: r.status, headers: h });
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
      await remindersRun(env, { raiseEvent, pullDay, now: nowIso }).catch(e => console.error("reminders", e && e.message));   // Reminders feature
      await emergencyRun(env, { raiseEvent, sendPush, now: nowIso, siteName }).catch(e => console.error("emergency", e && e.message));   // Emergency Alert feature
      await automationRun(env, { SITES, eodReport, relay, hubUrl: HUB_URL, canSite, isFull }).catch(e => console.error("automation", e && e.message));   // Automation feature
      await calendarRun(env, { today: beirutToday, now: nowIso, raiseEvent }).catch(e => console.error("calendar", e && e.message));   // Operations Calendar feature
      await schedMailRun(env, { today: beirutToday, hour: beirutHour, now: nowIso, raiseEvent, SITES }).catch(e => console.error("schedmail", e && e.message));   // Weekly schedule email reminders
      await contractsRun(env, { today: beirutToday, now: nowIso, raiseEvent }).catch(e => console.error("contracts", e && e.message));   // Contracts near ending
      await contractorsRun(env, { today: beirutToday, now: nowIso, raiseEvent }).catch(e => console.error("contractors", e && e.message));   // Contractors feature
      await storageRun(env, { today: beirutToday, hour: beirutHour, now: nowIso, raiseEvent }).catch(e => console.error("storage", e && e.message));   // Cloudflare storage meter
      if (beirutHour() >= 8) await projectsRun(env, { today: beirutToday, now: nowIso, raiseEvent }).catch(e => console.error("projects", e && e.message));   // Projects feature
      await pushRun(env).catch(e => console.error("push", e && e.message));
      if (beirutHour() === 3) await historyClean(env);   // Change history feature
      await twofaClean(env).catch(() => {});   // Two-step login feature
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
  if (path === "login" && method === "POST") return login(env, body, request);
  if (path.startsWith("login/2fa/")) { const r = await twofaPublic(env, twofaDeps, path, method, body, request); return r instanceof Response ? r : json(r); }   // Two-step login feature
  if (path === "logout" && method === "POST") return json({ ok: true, data: {} }, 200, { "set-cookie": CLEAR });
  if (path === "setup" && method === "POST") return setup(env, body);
  if (path === "inbox/mail" && method === "POST") return ok(await mailInbox(env, request, body, { SITES, canSite, isFull, now: nowIso, today: beirutToday, raiseEvent, audit }));   // Email inbox: MOM · calendar · contracts report
  if (path === "inbox/works" && method === "POST") return ok(await worksInbox(env, request, body, { SITES, canSite, now: nowIso, raiseEvent }));   // Tenant Works Forms feature: Gmail inbox script
  if (path.startsWith("gate-ext/")) return ok(await gatePublic(env, request, path.slice(9), method, body, url,   // Loading Gate app (separate link): service binding + GATE_KEY + paired phone
    { siteName, now: nowIso, today: beirutToday, raiseEvent, markHandover: gateMarkHandover }));
  if (path.startsWith("rx/")) return ok(await directoryPublic(env, path, method, body, url, { siteName, now: nowIso }));   // Tenants Directory feature: reception link

  if (path === "addin/pair" && method === "POST") return ok(await addinPair(env, body, request));   // Outlook add-in: email + 6-digit code → token
  let me = await readSession(request, env);
  if (!me) {   // Outlook add-in: the panel signs in with its own token (limited to /me, /ops/* and /addin/*)
    me = await addinUser(env, request);
    if (me && !addinAllowed(path)) throw fail("This is not available from Outlook — open the hub", 403);
  }
  if (!me) {
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first();
    throw fail("Not signed in", 401, { needsSetup: Number(n.n) === 0 });
  }

  /* ----- signed-in routes ----- */
  if (path === "me") {
    const [roles, on] = await Promise.all([requiredRoles(env), twofaOn(env, me.email).catch(() => false)]);
    return ok({ user: { ...userOut(me), twofa: { on, required: roles.includes(me.role), setupNeeded: roles.includes(me.role) && !on } }, sites: SITES, roles: ROLES });
  }
  if (path.startsWith("addin/")) {   // Outlook add-in feature
    const r = await addinRoute(env, path, method, body, request, me, { context: u => ({ user: userOut(u), sites: sitesMap(u), today: beirutToday(),
      feedback: { categories: FEEDBACK.categories, actions: FEEDBACK.actions }, calKinds: CAL_KINDS, docTypes: DOC_TYPES,
      can: Object.fromEntries(sitesOf(u).map(c => [c, rights(u, c)])) }) });
    if (r) return ok(r);
  }
  if (path.startsWith("2fa/")) { const r = await twofaRoute(env, twofaDeps, path, method, body, url, request, me); if (r) return ok(r); }   // Two-step login feature
  if (path === "profile" || path.startsWith("profile/")) {   // Profile feature
    const r = await profileRoute(env, path, method, body, url, { me, SITES, sitesOf, userOut, now: nowIso });
    if (r instanceof Response) return r;
    if (r) return ok(r);
  }
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
  if (path === "ops/layouts/image") return layoutsImage(env, opsSite(me, url.searchParams.get("site")), url);   // Mall Layouts feature
  if (path === "ops/works/file") return worksFile(env, me, url, { canSite });   // Tenant Works Forms feature: the PDF
  if (path.startsWith("ops/")) {
    const out = await opsRoute(env, me, path.slice(4), method, body, url);
    if (method === "POST") await auditOps(env, me, path.slice(4), body || {}, out).catch(() => {});   // Change history feature
    return ok(out);
  }

  /* ----- admin ----- */
  if (path.startsWith("admin/")) {
    if (me.role !== "ADMIN") throw fail("Administrator access only", 403);
    const a = path.slice(6);
    if (a === "users" && method === "GET") return ok(await listUsers(env));
    if (a === "users" && method === "POST") {   // Change history: people & roles
      const before = await env.DB.prepare("SELECT email, full_name AS name, role, site_code AS site, position FROM users WHERE email = ?").bind(String(body.email || "").trim().toLowerCase()).first().catch(() => null);
      const r = await saveUser(env, me, body);
      const after = await env.DB.prepare("SELECT email, full_name AS name, role, site_code AS site, position FROM users WHERE email = ?").bind(String(body.email || "").trim().toLowerCase()).first().catch(() => null);
      await audit(env, { me, site: (after && after.site) || "", tool: "people", ref: (after || before || {}).email || "", label: (after || before || {}).name || "", action: before ? "edit" : "add", before, after });
      return ok(r);
    }
    if (a === "users/reset" && method === "POST") { const r = await resetUser(env, body); await audit(env, { me, tool: "people", ref: String(body.email || ""), label: String(body.email || ""), action: "edit", changes: [{ field: "password", from: "", to: "reset" }] }); return ok(r); }
    if (a === "users/active" && method === "POST") { const r = await setActive(env, me, body); await audit(env, { me, tool: "people", ref: String(body.email || ""), label: String(body.email || ""), action: "edit", changes: [{ field: "active", from: "", to: String(!!body.active) }] }); return ok(r); }
    if (a === "usage" && method === "GET") return ok(await usageReport(env, Number(url.searchParams.get("days")) || 30));
    if (a === "control" && method === "GET") return ok(await listControl(env));
    if (a === "control" && method === "POST") return ok(await saveControl(env, body));
    if (a === "control/delete" && method === "POST") {
      await env.DB.prepare("DELETE FROM control_sheet WHERE id = ?").bind(Number(body.id) || 0).run();
      return ok({ deleted: true });
    }
    if (a === "morning-test" && method === "POST") return ok(await morningTest(env, me));
    if (a === "morning-status" && method === "GET") return ok(await morningStatus(env));
    if (a === "mail-quota" && method === "GET") return ok(await mailQuota(env));   // Mail quota feature
    if (a === "storage" && method === "GET") return ok(await storageStatus(env, url.searchParams.get("fresh") === "1"));   // Cloudflare storage meter (R2 / D1)
    if (a === "schedcc") return ok(await schedCcAdmin(env, method, body, SITES));   // Weekly schedule email: Cc per flagship
    if (a === "history" && method === "GET") return ok(await historyList(env, url));   // Change history feature
    /* Automation feature: backup download, backup status, End of Day email test */
    if (a === "covers") return ok(await coversAdmin(env, method, body, { me, SITES, now: nowIso }));
    if (a.startsWith("2fa/")) { const r = await twofaAdmin(env, a, method, body); if (r) return ok(r); }   // Two-step login feature   // Profile feature: flagship covers
    if (a === "backup" && method === "GET") {
      const data = await backupData(env);
      return new Response(JSON.stringify(data), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store",
        "content-disposition": `attachment; filename="abc-hub-backup-${beirutDate()}.json"` } });
    }
    if (a === "backup-status" && method === "GET") {
      const r = await env.DB.prepare("SELECT v FROM meta WHERE k = 'backup:last'").first();
      const counts = Object.fromEntries(await Promise.all(["users", "gla_units", "handovers", "form_runs", "tenant_feedback", "mom_meetings", "tm_announcements"].map(async t =>
        [t, Number((await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first().catch(() => ({ n: 0 }))).n || 0)])));
      return ok({ last: r ? JSON.parse(r.v) : null, relay: !!env.MAIL_RELAY_URL, counts });
    }
    if (a === "opsgroups" && method === "POST") return ok(await saveOpsGroup(env, body));   // ABC Operations Groups
    if (a === "eod-test" && method === "POST") {
      const site = SITES[String(body.site || "").toUpperCase()] ? String(body.site).toUpperCase() : (me.site_code || "VRM");
      if (!env.MAIL_RELAY_URL) throw fail("Mail relay not set up — add MAIL_RELAY_URL and MAIL_RELAY_KEY to the hub");
      const R = await eodReport(env, me, site, beirutDate());
      const r = await relay(env, { to: [me.email], subject: `End of Day Report — ABC ${SITES[site]} — ${beirutDate()} (test)`, html: eodEmailHtml(R, HUB_URL) });
      if (!r.ok) throw fail(r.error || "The email could not be sent");
      return ok({ to: me.email });
    }
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
/* Two-step login feature: what the module needs from the hub */
const twofaDeps = {
  hmac, cookieFor: t => cookieFor(t), makeSession: (env, e) => makeSession(env, e), userOut: u => userOut(u),
  sendPush: (env, sub, msg) => sendPush(env, sub, msg),
  relay: (env, m) => relay(env, m),   // email sign-in codes
  checkPassword: async (me, p) => !!p && same(await derive(p, me.salt, me.iterations || ROUNDS), me.hash),
  alertAdmins: async (env, title, body) => {
    const { results } = await env.DB.prepare("SELECT p.* FROM push_subs p JOIN users u ON u.email = p.email WHERE u.role = 'ADMIN' AND u.active = 1").all();
    await Promise.all((results || []).map(sub => sendPush(env, sub, { title, body, url: "/#/admin", tone: "alert", tag: "twofa-denied" })));
  }
};
async function login(env, b, request) {
  const email = String(b.email || "").trim().toLowerCase();
  const password = String(b.password || "");
  if (!email || !password) throw fail("Enter your email and password");
  const u = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
  const attempt = u ? await derive(password, u.salt, u.iterations || ROUNDS) : "";
  if (!u || !same(attempt, u.hash)) throw fail("Email or password is incorrect", 401);
  if (!u.active) throw fail("This account is switched off. Contact your administrator.", 403);
  if (request) { const gate = await twofaGate(env, twofaDeps, request, u, b); if (gate) return gate; }   // Two-step login feature: second step needed
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
    "SELECT email, full_name, role, site_code, sites, active, must_change, last_login_at, morning_email, position FROM users ORDER BY role, full_name").all();
  return {
    users: (results || []).map(u => ({ ...userOut(u), active: !!u.active, lastLoginAt: u.last_login_at || "",
      morningEmail: !!u.morning_email, morningEligible: isFull(u) })),
    sites: SITES, roles: ROLES,
    positions: Object.fromEntries(Object.entries(POSITIONS).map(([k, v]) => [k, v.label])),
    titles: Object.fromEntries(Object.entries(TITLES).map(([k, v]) => [k, { label: v.label, slot: v.slot }])),
    slots: SLOTS, multiRoles: MULTI_ROLES, allSiteRoles: ALL_SITE_ROLES, opsGroups: await opsGroups(env)
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
  const pos = String(b.position || "").toUpperCase();
  let position = "", sites = "";
  if (role === "ADMIN") { if (!SITES[site]) site = ""; }
  else if (role === "ADVISOR") { site = ""; }
  else if (MULTI_ROLES.includes(role)) {
    const list = [...new Set((Array.isArray(b.sites) ? b.sites : []).map(x => String(x).toUpperCase()).filter(c => SITES[c]))];
    if (!list.length) throw fail(`Tick the flagships the ${ROLES[role]} looks after`);
    list.sort((a, c) => Object.keys(SITES).indexOf(a) - Object.keys(SITES).indexOf(c));
    sites = list.join(","); site = SITES[site] && list.includes(site) ? site : list[0];
  } else {
    if (!SITES[site]) throw fail("Choose the flagship for this person");
    if (role === "MANAGER") {
      if (!TITLES[pos]) throw fail("Choose the position: Mall Manager, Senior Mall Manager, Operations Manager or Deputy Operations Manager");
      position = pos;
    } else if (role === "SUPERVISOR") {
      if (!POSITIONS[pos]) throw fail("Choose the position: Mall Officer, Mall Supervisor, Senior Mall Supervisor or Warehouse");
      position = pos;
    }
  }
  /* one person per management slot at each flagship */
  if (role === "MANAGER") {
    const slot = TITLES[position].slot;
    const { results } = await env.DB.prepare("SELECT email, full_name, position FROM users WHERE active = 1 AND role = 'MANAGER' AND site_code = ? AND email != ?")
      .bind(site, email).all();
    const taken = (results || []).find(u => TITLES[u.position] && TITLES[u.position].slot === slot);
    if (taken) throw fail(`${SITES[site]} already has a ${SLOTS[slot]}: ${taken.full_name}. Change their position or switch them off first.`);
  }
  const exists = await env.DB.prepare("SELECT email FROM users WHERE email = ?").bind(email).first();
  const morning = b.morningEmail === false ? 0 : 1;
  if (exists) {
    if (b.isNew) throw fail("That email already has an account");
    if (email === me.email && role !== "ADMIN") throw fail("You cannot remove your own admin role");
    await env.DB.prepare("UPDATE users SET full_name=?, role=?, site_code=?, sites=?, morning_email=?, position=? WHERE email=?")
      .bind(name, role, site || null, sites, morning, position, email).run();
    return { email, created: false };
  }
  const password = String(b.password || "");
  if (password.length < 8) throw fail("Set a temporary password of at least 8 characters");
  const h = await hashFor(password);
  await env.DB.prepare(`INSERT INTO users (email, full_name, role, site_code, sites, salt, hash, iterations, must_change, active, created_at, morning_email, position)
    VALUES (?,?,?,?,?,?,?,?,1,1,?,?,?)`).bind(email, name, role, site || null, sites, h.salt, h.hash, h.iterations, nowIso(), morning, position).run();
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
  if (b.active) {
    const u = await env.DB.prepare("SELECT role, site_code, position FROM users WHERE email = ?").bind(email).first();
    if (u && u.role === "MANAGER" && TITLES[u.position]) {
      const { results } = await env.DB.prepare("SELECT full_name, position FROM users WHERE active = 1 AND role = 'MANAGER' AND site_code = ? AND email != ?").bind(u.site_code, email).all();
      const slot = TITLES[u.position].slot, taken = (results || []).find(x => TITLES[x.position] && TITLES[x.position].slot === slot);
      if (taken) throw fail(`${SITES[u.site_code]} already has a ${SLOTS[slot]}: ${taken.full_name}. Switch them off first.`);
    }
  }
  await env.DB.prepare("UPDATE users SET active=? WHERE email=?").bind(b.active ? 1 : 0, email).run();
  return { email, active: !!b.active };
}

/* ---------- announcements ---------- */
const annOut = r => ({ id: r.id, message: r.message, level: r.level, site: r.site,
  siteName: r.site === "ALL" ? "All flagships" : SITES[r.site] || r.site,
  startsAt: r.starts_at, endsAt: r.ends_at, createdBy: r.created_by, createdAt: r.created_at });
async function activeAnnouncements(env, me) {
  const now = nowLocal();
  const list = me.email ? sitesOf(me) : (me.site_code ? [me.site_code] : Object.keys(SITES));
  const every = list.length === Object.keys(SITES).length && !(me.role === "MANAGER" && me.site_code);
  const siteSql = every ? "" : ` AND (site = 'ALL' OR site IN (${list.map(() => "?").join(",") || "''"}))`;
  const binds = every ? [] : list;
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
const homeSite = me => (ALL_SITE_ROLES.includes(me.role) && !me.site_code) ? "ALL" : (me.site_code || sitesOf(me)[0] || "ALL");
async function brief(env, me, fresh) {
  const site = homeSite(me);
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
  if (!(await ssoReady(env, String(appId), c))) throw fail("This system does not accept hub sign-in yet — opening its own sign-in page", 404);
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

/* Mail quota feature — how many email recipients the relay (Google Apps Script) can still send today.
   Asks the relay live (its /exec page answers {remainingToday}); falls back to the figure saved after the last send. */
async function mailQuota(env) {
  if (!env.MAIL_RELAY_URL) return { relay: false };
  let live = null, error = null;
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000);
    const r = await fetch(env.MAIL_RELAY_URL, { redirect: "follow", signal: ctl.signal });
    clearTimeout(t);
    const j = JSON.parse(await r.text());
    if (j && j.ok && Number.isFinite(Number(j.remainingToday))) live = { remaining: Number(j.remainingToday), account: j.account || null, at: nowIso() };
    else error = (j && j.error) || "Unexpected answer from the relay";
  } catch (e) { error = e.name === "AbortError" ? "The relay did not answer in time" : "The relay could not be reached"; }
  if (live) await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('mail:quota', ?)").bind(JSON.stringify(live)).run().catch(() => {});
  const row = live ? null : await env.DB.prepare("SELECT v FROM meta WHERE k = 'mail:quota'").first().catch(() => null);
  const q = live || (row ? JSON.parse(row.v) : null);
  return { relay: true, key: !!env.MAIL_RELAY_KEY, live: !!live, error, remaining: q ? q.remaining : null, account: q && q.account || null, at: q ? q.at : null,
    limit: q && q.remaining > 100 ? 1500 : 100 };
}
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
      "SELECT * FROM users WHERE active = 1 AND morning_email = 1 AND role IN ('ADMIN','ADVISOR','DIRECTOR','CDSO','MANAGER')").all();
    people = results || [];
  }
  const bySite = new Map();
  for (const u of people) { const k = homeSite(u); if (!bySite.has(k)) bySite.set(k, []); bySite.get(k).push(u); }

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
/* ABC Operations Groups — each flagship's operations group email (Admin → People & roles).
   The handover is emailed automatically when it is handed over: To = the group, Cc = the flagship's
   Mall Manager / Senior Mall Manager and Operations Manager / Deputy Operations Manager. */
const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
async function opsGroups(env) {
  const r = await env.DB.prepare("SELECT v FROM meta WHERE k = 'opsgroups'").first().catch(() => null);
  let g = {}; try { g = r ? JSON.parse(r.v) : {}; } catch {}
  return Object.fromEntries(Object.keys(SITES).map(c => [c, { emails: (g[c] && g[c].emails) || [], auto: g[c] ? g[c].auto !== false : true }]));
}
async function saveOpsGroup(env, b) {
  const site = String(b.site || "").toUpperCase();
  if (!SITES[site]) throw fail("Choose the flagship");
  const emails = [...new Set(String(b.emails || "").split(/[\s,;]+/).map(e => e.trim().toLowerCase()).filter(Boolean))];
  const bad = emails.find(e => !EMAIL_RE.test(e));
  if (bad) throw fail(`Not a valid email: ${bad}`);
  if (emails.length > 5) throw fail("Up to 5 group emails per flagship");
  const g = await opsGroups(env);
  g[site] = { emails, auto: !!b.auto };
  await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('opsgroups', ?)").bind(JSON.stringify(g)).run();
  return { opsGroups: g };
}
async function handoverRecipients(env, site) {
  const g = (await opsGroups(env))[site];
  const { results } = await env.DB.prepare("SELECT email, full_name, position FROM users WHERE active = 1 AND role = 'MANAGER' AND site_code = ?").bind(site).all();
  const mgrs = (results || []).filter(u => TITLES[u.position]).sort((a, b) => TITLES[a.position].rank - TITLES[b.position].rank);
  const to = g.emails.slice(), cc = mgrs.map(u => u.email.toLowerCase()).filter(e => !to.includes(e));
  return { auto: g.auto, relay: !!(env.MAIL_RELAY_URL && env.MAIL_RELAY_KEY), to: to.length ? to : cc.slice(0, 1), cc: to.length ? cc : cc.slice(1),
    names: mgrs.map(u => ({ email: u.email, name: u.full_name, title: TITLES[u.position].label })), group: g.emails };
}

async function relay(env, { to, cc = [], replyTo = "", subject, html, attachment = null }) {
  try {
    const r = await fetch(env.MAIL_RELAY_URL, {
      method: "POST", redirect: "follow",
      body: JSON.stringify({ key: env.MAIL_RELAY_KEY, to, cc, replyTo, subject, html, fromName: "ABC Operations Hub", attachment })
    });
    const text = await r.text();
    let j = null; try { j = JSON.parse(text); } catch {}
    if (j && j.ok && Number.isFinite(Number(j.remaining)))   // Mail quota feature: remember what the relay reports after each send
      await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('mail:quota', ?)").bind(JSON.stringify({ remaining: Number(j.remaining), at: nowIso() })).run().catch(() => {});
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
  const multi = MULTI_ROLES.includes(me.role);
  const site = multi ? "ALL" : homeSite(me);
  const hit = notifyCache.get(site);
  let events;
  if (hit && Date.now() - hit.at < NOTIFY_CACHE_MS) events = hit.events;
  else {
    events = (await gatherNotify(env, site, new Date(Date.now() - NOTIFY_DAYS * 864e5).toISOString())).slice(0, 120);
    notifyCache.set(site, { at: Date.now(), events });
  }
  const mySites = sitesOf(me);
  events = events.filter(e => (!e.to || e.to === me.email) && (!multi || !e.site || mySites.includes(e.site))).slice(0, 80);
  return { events, readAt: me.notif_read_at || "" };
}
const roleAllows = (role, app) => FULL_ROLES.includes(role) || !APP_ROLES[app] || APP_ROLES[app].includes(role);

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
        TTL: String(msg.ttl || 3600), Urgency: msg.tone === "alert" ? "high" : "normal"
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
    "SELECT s.*, u.site_code, u.role, u.sites FROM push_subs s JOIN users u ON u.email = s.email WHERE u.active = 1").all();
  const subs = subsQ.results || [];
  const wmRow = await env.DB.prepare("SELECT v FROM meta WHERE k = 'push:wm'").first();
  if (!wmRow) { await ensureWatermark(env); return; }
  const wm = wmRow.v;
  if (!subs.length) { await env.DB.prepare("UPDATE meta SET v = ? WHERE k = 'push:wm'").bind(nowIso()).run(); return; }
  const events = (await gatherNotify(env, "ALL", wm)).filter(e => e.at > wm && e.at <= nowIso());
  if (!events.length) return;
  const newest = events.reduce((m, e) => (e.at > m ? e.at : m), wm);
  await env.DB.prepare("UPDATE meta SET v = ? WHERE k = 'push:wm'").bind(newest).run();
  const names = { snaglist: "Snaglist", incidents: "Incidents", restroom: "Restroom", schedule: "Schedule", mom: "MOM", handover: "Handover", feedback: "Tenant Feedback", gla: "GLA", reminders: "Reminder", forms: "Checklist", emergency: "Emergency", tenants: "Tenants", works: "Tenant Works", calendar: "Calendar", evacuation: "Evacuation", contractors: "Contractors", gate: "Loading Gate", projects: "Projects", contracts: "Contracts" };
  for (const sub of subs) {
    const mine = events.filter(e =>
      (!e.to || e.to === sub.email) &&
      (e.to === sub.email || !e.site || (MULTI_ROLES.includes(sub.role) ? sitesOf(sub).includes(e.site) : (!sub.site_code || e.site === sub.site_code))) &&
      roleAllows(sub.role, e.app) && e.app !== "emergency" &&   /* Emergency Alert feature pushes its own alerts */
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
  const list = sitesOf(me);
  if (!list.length) throw fail("Your account has no flagship. Ask the administrator to set one.", 403);
  if (list.includes(want)) return want;
  return list.includes(me.site_code) ? me.site_code : list[0];
}
const rankOf = p => (POSITIONS[p] ? POSITIONS[p].rank : TITLES[p] ? TITLES[p].rank : 9);
/* Operations Schedule rows: the flagship's operations team in the order (and section) chosen on the schedule ("Arrange") */
async function schedStaff(env, site) {
  const staff = (await siteStaff(env, site)).filter(s => s.atSite && POSITIONS[s.position] && !POSITIONS[s.position].viewOnly);   // Warehouse is not on the schedule
  const r = await env.DB.prepare("SELECT v FROM meta WHERE k = ?").bind("schedorder:" + site).first().catch(() => null);
  let order = []; try { order = r ? JSON.parse(r.v) : []; } catch {}
  const pos = new Map(order.map((o, i) => [o.email, { i, group: POSITIONS[o.group] && !POSITIONS[o.group].viewOnly ? o.group : "" }]));
  const rank = s => { const o = pos.get(s.email); return o ? o.i : 1000 + (POSITIONS[s.position].rank || 9) * 100; };
  return staff.map(s => { const o = pos.get(s.email); const g = o && o.group ? o.group : s.position;
      return { ...s, title: s.positionLabel, position: g, positionLabel: POSITIONS[g].label }; })
    .sort((a, b) => (POSITIONS[a.position].rank - POSITIONS[b.position].rank) || (rank(a) - rank(b)) || a.name.localeCompare(b.name));
}
async function siteStaff(env, site) {
  const { results } = await env.DB.prepare(
    "SELECT email, full_name, role, position, site_code, sites FROM users WHERE active = 1").all();
  return (results || []).filter(u => u.site_code === site || canSite(u, site)).map(u => ({
    email: u.email, name: u.full_name, role: u.role, position: u.position || "",
    positionLabel: posLabel(u.position) || ROLES[u.role] || u.role,
    atSite: u.site_code === site && !MULTI_ROLES.includes(u.role)
  })).sort((a, b) => rankOf(a.position) - rankOf(b.position) || a.name.localeCompare(b.name));
}
/* What each person may do at a flagship.
   full    = Admin, Property Advisor, Mall Director, CDSO, flagship management — everything
   opsLead = full, or the Senior Mall Supervisor — runs the operations tools (schedule, forms, alerts…)
   Operations team: everything in Operations Tools and Property Overview & Info, except
   changing reminders, uploading the budget, changing property details and the Executive Report. */
function rights(me, site) {
  const mine = canSite(me, site);
  const full = mine && isFull(me);
  const opsLead = full || (mine && me.role === "SUPERVISOR" && me.position === "SMS");
  const wh = isWarehouse(me);   // Warehouse: sees the flagship's data, changes nothing
  const team = full || (mine && me.role === "SUPERVISOR" && !wh);
  return {
    schedule: opsLead,
    mom: team,
    handover: mine && me.role !== "SECURITY" && !wh,
    feedback: mine && !wh,                 // anyone at the flagship can log tenant feedback
    feedbackAdmin: opsLead,         // edit anyone's entries, import history
    gla: team,                      // keep the GLA up to date
    layouts: opsLead,               // Mall Layouts feature: upload plans, adjust pins
    property: full,                 // Property Details feature: update the values
    reminders: full,                // Reminders feature: choose which reminders run
    formsFill: mine && me.role !== "SECURITY" && !wh,   // Operations Forms feature: fill the checklists
    formsLead: opsLead,             // Operations Forms feature: reopen, delete, upload the Areeba list
    emergency: opsLead,             // Emergency Alert feature: send an alert, end it with All clear
    budget: team,                   // Budget feature: see the CAPEX / OPEX lines and prepare JDE requests
    budgetLead: full,               // Budget feature: upload the sheets
    exec: full,                     // Executive Report feature: see and edit the monthly report
    accuracy: mine                  // Data Accuracy Score: everyone at the flagship can see it
  };
}

/* Tenant feedback lists — the categories, their descriptions and the actions */
const FEEDBACK = {
  categories: {
    "Covid-19 Violation": ["Mask Violation", "Capacity Limit Violation", "Social Distancing Violation", "Mask & Capacity Limit Violation",
      "Mask & Social Distancing Violation", "Capacity Limit & Social Distancing Violation", "Sick Employees not reported"],
    "Operations Violation": ["Early Closing", "Late Opening", "Closed - Didn't Open", "Closed - Legal / Leasing Issues", "Closed - Covid-19 Measures", "Other"],
    "Safety Violation": ["Smoking", "Patio Heaters", "Blocking emergency exits / corridor", "Preventive Maintenance", "Other"],
    "Customer Feedback": ["Positive", "Negative"],
    "Incident": []
  },
  actions: ["Verbal Warning", "Written Warning", "Legal Warning", "Closed Temporarily", "Employee Banned From Entry", "None", "Others"],
  serious: ["Written Warning", "Legal Warning", "Closed Temporarily", "Employee Banned From Entry"]
};
const fbOut = r => ({ id: r.id, site: r.site, tenant: r.tenant, day: r.day, time: r.time, category: r.category, description: r.description,
  action: r.action, actionDesc: r.action_desc, createdBy: r.created_by, createdName: r.created_name, createdAt: r.created_at });
function cleanFeedback(e) {
  const cat = FEEDBACK.categories[e.category] ? e.category : "";
  if (!cat) throw fail("Choose the feedback type");
  const tenant = String(e.tenant || "").trim().slice(0, 120);
  if (!tenant) throw fail("Enter the tenant");
  if (!isDay(e.day)) throw fail("Choose the date");
  const list = FEEDBACK.categories[cat];
  const description = String(e.description || "").trim().slice(0, 200);
  if (list.length && description && !list.includes(description)) throw fail("Choose a description from the list");
  const action = FEEDBACK.actions.includes(e.action) ? e.action : "None";
  return { tenant, day: e.day, time: /^\d{2}:\d{2}$/.test(String(e.time || "")) ? e.time : "", category: cat, description,
    action, actionDesc: String(e.actionDesc || "").trim().slice(0, 500) };
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

/* ----- Change history feature: one line per change in the tools that do not log their own details -----
   Values are summarised from the request (short text fields only). Executive Report figures are never logged. */
const AUDIT_OPS = {
  "handover/save": b => b.submit ? ["handover", "submit", `${b.day || ""}${b.shift ? " · " + b.shift : ""}`] : null,
  "handover/receive": b => ["handover", "edit", "Received"], "handover/delete": b => ["handover", "delete", "Handover"],
  "mom/save": b => ["mom", b.id ? "edit" : "add", b.title || b.meetDate || "Meeting"], "mom/delete": b => ["mom", "delete", "Meeting"],
  "feedback/save": b => ["feedback", b.id ? "edit" : "add", b.tenant || "Feedback"], "feedback/delete": b => ["feedback", "delete", "Feedback"], "feedback/import": b => ["feedback", "import", "Excel import"],
  "budget/upload": b => ["budget", "import", `${String(b.kind || "").toUpperCase()} ${b.year || ""}`], "budget/use": b => ["budget", "add", b.topic || "Budget use"], "budget/uses/remove": b => ["budget", "delete", "Budget use"],
  "property/save": b => ["property", "edit", b.section || b.key || "Property details"], "property/add": b => ["property", "add", b.label || b.name || "Property item"], "property/delete": b => ["property", "delete", "Property item"],
  "reminders/save": b => ["reminders", b.id ? "edit" : "add", b.title || "Reminder"], "reminders/remove": b => ["reminders", "delete", "Reminder"],
  "layouts/level": b => ["layouts", "edit", b.level || "Layout"], "layouts/pin": b => ["layouts", "edit", "Pin"], "layouts/delete": b => ["layouts", "delete", "Layout"],
  "dir/save": b => ["directory", b.id ? "edit" : "add", b.tenant || b.employee || "Contact"], "dir/delete": b => ["directory", "delete", "Contact"], "dir/import": b => ["directory", "import", "Excel import"],
  "tm/save": b => ["tenants", b.id ? "edit" : "add", b.tenant || b.kind || "Announcement"], "tm/recipients/save": b => ["tenants", "edit", "Recipients"], "fitout/save": b => ["fitout", "edit", b.tenant || "Fit-out"],
  "forms/template/save": b => ["forms", "edit", `Template ${b.form || ""}`], "forms/remove": b => ["forms", "delete", b.form || "Checklist"], "forms/reopen": b => ["forms", "edit", "Reopened"],
  "works/setup": b => ["works", "edit", "Setup"], "works/delete": b => ["works", "delete", "Form"], "works/sign": b => ["works", "sign", b.role || "Signature"],
  "exec/save": b => ["exec", "edit", "Executive Report"], "handover/append": b => ["handover", "add", "Line from Outlook"], "handover/shifts": b => ["handover", "edit", "Shifts"]
};
const AUDIT_SKIP_KEYS = new Set(["site", "id", "submit", "doc", "rows", "points", "items", "data", "html", "image", "photo", "file", "base64", "signature", "sig", "password"]);
async function auditOps(env, me, p, b, out) {
  const f = AUDIT_OPS[p]; if (!f) return;
  const r = f(b); if (!r) return;
  const [tool, action, label] = r;
  const changes = tool === "exec" ? [] : Object.entries(b).filter(([k, v]) => !AUDIT_SKIP_KEYS.has(k) && v != null && v !== "" && ["string", "number", "boolean"].includes(typeof v) && String(v).length <= 160)
    .slice(0, 12).map(([k, v]) => ({ field: k, from: "", to: String(v) }));
  const site = SITES[String(b.site || "").toUpperCase()] ? String(b.site).toUpperCase() : (me.site_code || "");
  await audit(env, { me, site, tool, ref: String(b.id || (out && out.id) || ""), label: String(label).slice(0, 200), action, changes });
}

async function opsRoute(env, me, p, method, b, url) {
  const q = k => url.searchParams.get(k);
  const site = opsSite(me, method === "GET" ? q("site") : b.site);
  const can = rights(me, site);

  if (p === "summary") {
    const [tasks, latest] = await Promise.all([
      env.DB.prepare(`SELECT COUNT(*) AS n, SUM(CASE WHEN a.due != '' AND a.due < ? THEN 1 ELSE 0 END) AS late
        FROM mom_actions a JOIN mom_meetings m ON m.id = a.meeting_id
        WHERE m.status = 'published' AND a.status = 'Open' AND a.owner_email = ?`).bind(beirutToday(), me.email).first(),
      env.DB.prepare("SELECT id, day, status, received_by, created_by, handoffs FROM handovers WHERE site = ? ORDER BY day DESC, id DESC LIMIT 1").bind(site).first()
    ]);
    /* one handover per day: only the newest one can be waiting. Older ones never received
       (e.g. the retired AM / PM files) are closed so they stop showing as "to receive". */
    if (latest) await env.DB.prepare("UPDATE handovers SET received_by = 'Auto-closed', received_at = ? WHERE site = ? AND status = 'submitted' AND received_by = '' AND id != ?")
      .bind(nowIso(), site, latest.id).run().catch(() => {});
    let waiting = 0;
    if (latest && latest.status === "submitted" && !latest.received_by && latest.day >= new Date(Date.now() - 864e5).toISOString().slice(0, 10)) {
      const L = JSON.parse(latest.handoffs || "[]");
      if ((L.length ? L[L.length - 1].email : latest.created_by) !== me.email) waiting = 1;
    }
    return { mom: { count: Number(tasks.n || 0), late: Number(tasks.late || 0), label: "open tasks" },
             handover: { count: waiting, label: "to receive", id: waiting ? latest.id : 0 } };
  }
  if (p === "context") {
    return { me: { ...userOut(me) }, site, siteName: siteName(site), feedback: FEEDBACK,
      canPickSite: sitesOf(me).length > 1, can, staff: await siteStaff(env, site), sites: sitesMap(me),
      positions: Object.fromEntries(Object.entries(POSITIONS).map(([k, v]) => [k, v.label])), codes: SHIFT_CODES, today: beirutToday() };
  }

  /* ----- GLA & occupancy — live unit records, every change logged with an effective date ----- */
  if (p === "gla/get") {
    await glaSeed(env, site);
    const [units, last, count, base] = await Promise.all([
      env.DB.prepare("SELECT * FROM gla_units WHERE site = ? AND active = 1 ORDER BY seq, id").bind(site).all(),
      env.DB.prepare("SELECT MAX(eff_date) AS d FROM gla_events WHERE site = ?").bind(site).first(),
      env.DB.prepare("SELECT COUNT(*) AS n FROM gla_events WHERE site = ?").bind(site).first(),
      env.DB.prepare("SELECT v FROM ops_settings WHERE site = ? AND k = 'gla_baseline'").bind(site).first()
    ]);
    if (!units.results.length) return { site, can, report: null };
    const baseline = base ? JSON.parse(base.v) : {};
    return { site, can, statuses: GLA_STATUS, sections: GLA_SECTIONS, report: { siteName: siteName(site), baseline,
      lastChange: last && last.d || "", changes: Number(count.n || 0), levels: glaLevels(units.results), units: units.results.map(glaUnitOut) } };
  }
  if (p === "gla/save" && method === "POST") {
    if (!can.gla) throw fail("Only the flagship's Manager, Senior Mall Supervisor or Supervisors can update the GLA", 403);
    await glaSeed(env, site);
    const eff = isDay(b.effDate) ? b.effDate : beirutToday();
    const note = s(b.note, 300);
    const u = b.unit || {};
    const next = { level: s(u.level, 20).trim(), code: s(u.code, 30).trim(), brand: s(u.brand, 120).trim(), status: GLA_STATUS.includes(u.status) ? u.status : "",
      section: GLA_SECTIONS.includes(u.section) ? u.section : "Leasing", dept: s(u.dept, 60).trim(), area: Math.max(0, Math.round(Number(u.area) * 100) / 100 || 0),
      contract_start: isDay(u.contractStart) ? u.contractStart : "" };
    if (next.status === "Reserved" && !next.contract_start) throw fail("Enter the contract start date for a reserved unit");
    if (!next.level || !next.code) throw fail("Level and unit code are required");
    if (!next.status) throw fail("Choose the status");
    if (next.status === "Vacant") next.brand = next.brand && !/^vacant$/i.test(next.brand) ? next.brand : "";
    else if (!next.brand) throw fail("Enter the brand for this unit");
    const id = Number(u.id) || 0, at = nowIso();
    if (id) {
      const cur = await env.DB.prepare("SELECT * FROM gla_units WHERE id = ? AND site = ? AND active = 1").bind(id, site).first();
      if (!cur) throw fail("Unit not found", 404);
      const before = {}, after = {};
      for (const k of ["level", "code", "brand", "status", "section", "dept", "area", "contract_start"]) if (String(cur[k] ?? "") !== String(next[k] ?? "")) { before[k] = cur[k]; after[k] = next[k]; }
      if (!Object.keys(after).length) return { id, changed: false };
      await env.DB.batch([
        env.DB.prepare("UPDATE gla_units SET level=?, code=?, brand=?, status=?, section=?, dept=?, area=?, contract_start=?, updated_at=?, updated_by=? WHERE id=?")
          .bind(next.level, next.code, next.brand, next.status, next.section, next.dept, next.area, next.contract_start, at, me.full_name, id),
        env.DB.prepare(`INSERT INTO gla_events (site, unit_id, kind, eff_date, before, after, note, by_name, by_email, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
          .bind(site, id, "update", eff, JSON.stringify(before), JSON.stringify(after), note, me.full_name, me.email, at)
      ]);
      await audit(env, { me, site, tool: "gla", ref: id, label: `${next.code} · ${next.brand || cur.brand}`, action: "edit", before, after });   // Change history feature
      if (after.status && ["Terminated", "Closed", "Open", "Reserved"].includes(after.status)) await raiseEvent(env, { site, app: "gla", tone: after.status === "Terminated" ? "warn" : "info",
        title: `${next.brand || cur.brand || next.code} · ${after.status}`, body: `${siteName(site)} · ${next.level} ${next.code} · effective ${fmtDay(eff)} · by ${me.full_name}` });
      return { id, changed: true };
    }
    const dup = await env.DB.prepare("SELECT id FROM gla_units WHERE site = ? AND level = ? AND code = ? AND active = 1").bind(site, next.level, next.code).first();
    if (dup) throw fail(`Unit ${next.code} already exists on ${next.level}`);
    const seq = await env.DB.prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM gla_units WHERE site = ?").bind(site).first();
    const r = await env.DB.prepare(`INSERT INTO gla_units (site, level, code, brand, status, section, dept, area, contract_start, seq, updated_at, updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(site, next.level, next.code, next.brand, next.status, next.section, next.dept, next.area, next.contract_start, seq.n, at, me.full_name).run();
    await env.DB.prepare(`INSERT INTO gla_events (site, unit_id, kind, eff_date, before, after, note, by_name, by_email, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .bind(site, r.meta.last_row_id, "add", eff, "{}", JSON.stringify(next), note, me.full_name, me.email, at).run();
    await audit(env, { me, site, tool: "gla", ref: r.meta.last_row_id, label: `${next.code} · ${next.brand}`, action: "add", after: next });   // Change history feature
    return { id: r.meta.last_row_id, added: true };
  }
  if (p === "gla/remove" && method === "POST") {
    if (!can.gla) throw fail("Not allowed", 403);
    const cur = await env.DB.prepare("SELECT * FROM gla_units WHERE id = ? AND site = ? AND active = 1").bind(Number(b.id) || 0, site).first();
    if (!cur) throw fail("Unit not found", 404);
    const eff = isDay(b.effDate) ? b.effDate : beirutToday(), at = nowIso();
    await env.DB.batch([
      env.DB.prepare("UPDATE gla_units SET active = 0, updated_at = ?, updated_by = ? WHERE id = ?").bind(at, me.full_name, cur.id),
      env.DB.prepare(`INSERT INTO gla_events (site, unit_id, kind, eff_date, before, after, note, by_name, by_email, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .bind(site, cur.id, "remove", eff, JSON.stringify(glaUnitOut(cur)), "{}", s(b.note, 300), me.full_name, me.email, at)
    ]);
    await audit(env, { me, site, tool: "gla", ref: cur.id, label: `${cur.code} · ${cur.brand}`, action: "delete", before: { level: cur.level, code: cur.code, brand: cur.brand, status: cur.status } });   // Change history feature
    return { removed: true };
  }
  if (p === "gla/history") {
    const from = isDay(q("from")) ? q("from") : "0000-00-00", to = isDay(q("to")) ? q("to") : "9999-12-31";
    const { results } = await env.DB.prepare(
      `SELECT e.*, u.level AS u_level, u.code AS u_code, u.brand AS u_brand FROM gla_events e LEFT JOIN gla_units u ON u.id = e.unit_id
        WHERE e.site = ? AND e.eff_date BETWEEN ? AND ? ORDER BY e.eff_date DESC, e.id DESC LIMIT 500`).bind(site, from, to).all();
    return { can, events: (results || []).map(e => ({ id: e.id, unitId: e.unit_id, kind: e.kind, effDate: e.eff_date,
      before: JSON.parse(e.before || "{}"), after: JSON.parse(e.after || "{}"), note: e.note, by: e.by_name, createdAt: e.created_at,
      dateEditedAt: e.date_edited_at, dateEditedBy: e.date_edited_by, unit: { level: e.u_level, code: e.u_code, brand: e.u_brand } })) };
  }
  if (p === "gla/eventdate" && method === "POST") {
    if (!can.gla) throw fail("Not allowed", 403);
    if (!isDay(b.effDate)) throw fail("Choose a date");
    const r = await env.DB.prepare("UPDATE gla_events SET eff_date = ?, date_edited_at = ?, date_edited_by = ? WHERE id = ? AND site = ?")
      .bind(b.effDate, nowIso(), me.full_name, Number(b.id) || 0, site).run();
    if (!r.meta.changes) throw fail("Change not found", 404);
    return { saved: true };
  }
  /* The GLA as it stood on a given date — for the executive report */
  if (p === "gla/asof") {
    const day = isDay(q("date")) ? q("date") : beirutToday();
    return { site, date: day, units: await glaAsOf(env, site, day) };
  }

  /* ----- End of Day report ----- */
  if (p === "eod") return eodReport(env, me, site, isDay(q("date")) ? q("date") : beirutToday());

  /* ----- Mall Layouts feature (modules/layouts.js) ----- */
  if (p.startsWith("layouts/")) return layoutsRoute(env, p, method, b, url, { site, can, me, now: nowIso });

  /* ----- Property Details feature (modules/property.js) ----- */
  if (p.startsWith("property/")) return propertyRoute(env, p, method, b, url, { site, can, me, now: nowIso, isAdmin: me.role === "ADMIN" || me.role === "ADVISOR" });

  /* ----- Reminders feature (modules/reminders.js) ----- */
  if (p.startsWith("reminders/")) return remindersRoute(env, p, method, b, url, { site, can, me, now: nowIso, raiseEvent, pullDay });

  /* ----- Executive Report feature (modules/exec.js) ----- */
  if (p.startsWith("exec/")) return execRoute(env, p, method, b, url, { site, can, me, now: nowIso, siteName, glaAsOf,
    sites: sitesMap(me) });

  if (p.startsWith("lead/")) return leadershipRoute(env, p, method, b, url, { me, sitesOf, siteName, pullDay, today: beirutToday });   // Leadership dashboards feature
  /* ----- Tenant Management feature (modules/tenants.js) ----- */
  if (p.startsWith("tm/") || p === "compliance" || p.startsWith("fitout")) return tenantsRoute(env, p, method, b, url, { site, can, me, now: nowIso,
    isAdmin: me.role === "ADMIN", siteName, raiseEvent, today: beirutToday, sites: sitesMap(me), position: posLabel(me.position) || ROLES[me.role] });

  /* ----- Data Accuracy Score feature (modules/accuracy.js) ----- */
  /* ----- Tenants Directory feature (modules/directory.js) ----- */
  /* ----- Tenant Works Forms feature (modules/works.js) ----- */
  /* ----- Operations Calendar · Evacuation Plan · Change history (modules/calendar.js, evac.js, history.js) ----- */
  const auditMe = (e, x) => audit(e, { me, ...x });
  if (p.startsWith("cal/")) return calendarRoute(env, p, method, b, url, { site, me, full: isFull(me), canSite, now: nowIso, today: beirutToday, raiseEvent, audit: auditMe });
  if (p.startsWith("evac/")) return evacRoute(env, p, method, b, url, { site, me, full: isFull(me), canSite, now: nowIso, audit: auditMe });
  if (p.startsWith("schedmail/")) return schedMailRoute(env, p, method, b, url, { site, me, canSite, isFull, siteStaff, schedStaff, POSITIONS, SHIFT_CODES, posLabel, ROLES, siteName,
    relay, raiseEvent, now: nowIso, today: beirutToday, audit: auditMe });   // Weekly schedule email
  if (p.startsWith("portal/")) return portalRoute(env, p, method, b, url, { me, SITES, canSite, sitesOf, full: isFull, now: nowIso, today: beirutToday, audit: auditMe });   // Tenant portal follow-up
  if (p.startsWith("contracts/")) return contractsRoute(env, p, method, b, url, { site, me, full: isFull(me), canSite, now: nowIso, today: beirutToday, audit: auditMe });   // Contracts near ending
  if (p.startsWith("gate/")) return gateRoute(env, p, method, b, url, { site, me, full: isFull(me), canSite, now: nowIso, today: beirutToday, raiseEvent, markHandover: gateMarkHandover });   // Loading Gate feature
  if (p.startsWith("con/")) return contractorsRoute(env, p, method, b, url, { site, me, full: isFull(me), canSite, now: nowIso, today: beirutToday, raiseEvent, audit: auditMe });   // Contractors feature
  if (p.startsWith("proj/")) return projectsRoute(env, p, method, b, url, { site, me, full: isFull(me), canSite, now: nowIso, today: beirutToday, raiseEvent, audit: auditMe });   // Projects feature
  if (p === "today") return todayRoute(env, { site, me, canSite, isFull, schedStaff, siteName, pullDay, sites: sitesMap(me), today: beirutToday,
    hm: () => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Beirut", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date()).replace(/^24/, "00") });   // Day to Day Operations
  if (p === "pack") return packRoute(env, p, method, b, url, { site, me, canSite, siteName, pullDay, today: beirutToday, now: nowIso });   // Monthly operations pack
  if (p === "history") {
    if (!canSite(me, site)) throw fail("No access to this flagship", 403);
    return historyOf(env, String(q("tool")), String(q("ref")), site);
  }
  if (p.startsWith("works/")) return worksRoute(env, p, method, b, url, { site, me, full: isFull(me), canSite, now: nowIso, raiseEvent, SITES });
  if (p.startsWith("dir/")) return directoryRoute(env, p, method, b, url, { site, me, full: canSite(me, site) && isFull(me), sites: sitesOf(me),
    now: nowIso, siteName, origin: url.origin });

  if (p === "accuracy") return { ...(await accuracyRoute(env, p, method, b, url, { site, sites: sitesMap(me) })), can };

  /* ----- Budget (CAPEX / OPEX) feature (modules/budget.js) ----- */
  if (p.startsWith("budget/")) return budgetRoute(env, p, method, b, url, { site, can, me, now: nowIso });

  /* ----- Emergency Alert feature (modules/emergency.js) ----- */
  if (p.startsWith("emergency/")) return emergencyRoute(env, p, method, b, url, { site, can, me, now: nowIso, raiseEvent, sendPush, canSite: s => canSite(me, s), sites: sitesOf(me) });

  /* ----- Operations Forms feature (modules/forms.js) ----- */
  if (p.startsWith("forms/")) return formsRoute(env, p, method, b, url, { site, can, me, now: nowIso, today: beirutToday, raiseEvent });

  /* ----- tenant feedback ----- */
  if (p === "feedback/list") {
    const from = isDay(q("from")) ? q("from") : "0000-00-00", to = isDay(q("to")) ? q("to") : "9999-12-31";
    const { results } = await env.DB.prepare("SELECT * FROM tenant_feedback WHERE site = ? AND day BETWEEN ? AND ? ORDER BY day DESC, time DESC, id DESC LIMIT 2000")
      .bind(site, from, to).all();
    return { site, can, entries: (results || []).map(fbOut) };
  }
  if (p === "feedback/tenants") {
    const names = new Set();
    await glaSeed(env, site);
    const live = await env.DB.prepare("SELECT brand FROM gla_units WHERE site = ? AND active = 1 AND status IN ('Open','Closed','Fit-out') AND section != 'DS'").bind(site).all();
    for (const u of live.results || []) {
      const b = String(u.brand || "").trim();
      if (b && !/vacant|w\.?h\.?$|warehouse/i.test(b)) names.add(b);
    }
    const { results } = await env.DB.prepare("SELECT DISTINCT tenant FROM tenant_feedback WHERE site = ? ORDER BY tenant LIMIT 500").bind(site).all();
    (results || []).forEach(r => names.add(r.tenant));
    return { tenants: [...names].sort((a, b) => a.localeCompare(b)) };
  }
  if (p === "feedback/save" && method === "POST") {
    if (!can.feedback) throw fail("Not allowed", 403);
    const e = cleanFeedback(b.entry || {});
    const id = Number((b.entry || {}).id) || 0, at = nowIso();
    if (id) {
      const ex = await env.DB.prepare("SELECT * FROM tenant_feedback WHERE id = ? AND site = ?").bind(id, site).first();
      if (!ex) throw fail("Entry not found", 404);
      if (ex.created_by !== me.email && !can.feedbackAdmin) throw fail("Only the person who logged this entry or the flagship leads can change it", 403);
      await env.DB.prepare("UPDATE tenant_feedback SET tenant=?, day=?, time=?, category=?, description=?, action=?, action_desc=?, updated_at=? WHERE id=?")
        .bind(e.tenant, e.day, e.time, e.category, e.description, e.action, e.actionDesc, at, id).run();
      return { id };
    }
    const r = await env.DB.prepare(`INSERT INTO tenant_feedback (site, tenant, day, time, category, description, action, action_desc, created_by, created_name, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(site, e.tenant, e.day, e.time, e.category, e.description, e.action, e.actionDesc, me.email, me.full_name, at, at).run();
    if (FEEDBACK.serious.includes(e.action)) await raiseEvent(env, { site, app: "feedback", tone: "warn",
      title: `${e.action} · ${e.tenant}`, body: `${siteName(site)} · ${e.category}${e.description ? " — " + e.description : ""}` });
    const repeat = await repeatCheck(env, site, e, raiseEvent, siteName).catch(() => null);   // Tenant Management: repeat offenders
    return { id: r.meta.last_row_id, repeat };
  }
  if (p === "feedback/delete" && method === "POST") {
    const ex = await env.DB.prepare("SELECT * FROM tenant_feedback WHERE id = ? AND site = ?").bind(Number(b.id) || 0, site).first();
    if (!ex) throw fail("Entry not found", 404);
    if (ex.created_by !== me.email && !can.feedbackAdmin) throw fail("Only the person who logged this entry or the flagship leads can delete it", 403);
    await env.DB.prepare("DELETE FROM tenant_feedback WHERE id = ?").bind(ex.id).run();
    return { deleted: true };
  }
  if (p === "feedback/import" && method === "POST") {
    if (!can.feedbackAdmin) throw fail("Only the flagship's Manager or Senior Mall Supervisor can import history", 403);
    const rows = (Array.isArray(b.entries) ? b.entries : []).slice(0, 3000);
    const existing = await env.DB.prepare("SELECT day, time, tenant, category, description FROM tenant_feedback WHERE site = ?").bind(site).all();
    const seen = new Set((existing.results || []).map(r => [r.day, r.time, r.tenant.toLowerCase(), r.category, r.description].join("|")));
    const at = nowIso(), ops = [], skipped = [];
    for (const raw of rows) {
      let e; try { e = cleanFeedback({ ...raw, description: FEEDBACK.categories[raw.category] && FEEDBACK.categories[raw.category].length && !FEEDBACK.categories[raw.category].includes(raw.description) ? "" : raw.description }); }
      catch (er) { skipped.push(er.message); continue; }
      const k = [e.day, e.time, e.tenant.toLowerCase(), e.category, e.description].join("|");
      if (seen.has(k)) continue; seen.add(k);
      ops.push(env.DB.prepare(`INSERT INTO tenant_feedback (site, tenant, day, time, category, description, action, action_desc, created_by, created_name, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(site, e.tenant, e.day, e.time, e.category, e.description, e.action, e.actionDesc, me.email, `${me.full_name} (import)`, at, at));
    }
    for (let i = 0; i < ops.length; i += 90) await env.DB.batch(ops.slice(i, i + 90));
    return { imported: ops.length, skipped: skipped.length, reasons: [...new Set(skipped)].slice(0, 5) };
  }

  /* ----- schedule ----- */
  if (p === "schedule" && method === "GET") {
    const from = q("from"), to = q("to");
    if (!isDay(from) || !isDay(to)) throw fail("Choose a week");
    const [cells, notes] = await Promise.all([
      env.DB.prepare("SELECT day, email, val FROM sched_cells WHERE site = ? AND day BETWEEN ? AND ?").bind(site, from, to).all(),
      env.DB.prepare("SELECT day, note FROM sched_notes WHERE site = ? AND day BETWEEN ? AND ?").bind(site, from, to).all()
    ]);
    const staff = await schedStaff(env, site);   // order and sections set with "Arrange"
    return { site, staff, cells: cells.results || [], notes: notes.results || [], can, groups: Object.fromEntries(Object.entries(POSITIONS).filter(([, v]) => !v.viewOnly).map(([k, v]) => [k, v.label])) };
  }
  if (p === "schedule/order" && method === "POST") {   // Arrange: row order and section of each person (schedule only — the position in People & roles does not change)
    if (!can.schedule) throw fail("Only the flagship's Manager or Senior Mall Supervisor can arrange the schedule", 403);
    const ok = new Set((await siteStaff(env, site)).filter(s => s.atSite).map(s => s.email));
    const list = (Array.isArray(b.order) ? b.order : []).filter(o => ok.has(o.email)).slice(0, 200).map(o => ({ email: o.email, group: POSITIONS[o.group] && !POSITIONS[o.group].viewOnly ? o.group : "" }));
    await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)").bind("schedorder:" + site, JSON.stringify(list)).run();
    return { staff: await schedStaff(env, site) };
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
      `SELECT m.id, m.title, m.meet_date, m.status, m.participants, m.meeting_type,
              (SELECT COUNT(*) FROM mom_actions a WHERE a.meeting_id = m.id) AS actions,
              (SELECT COUNT(*) FROM mom_actions a WHERE a.meeting_id = m.id AND a.status = 'Open') AS open
         FROM mom_meetings m WHERE m.site = ? ORDER BY m.meet_date DESC, m.id DESC LIMIT 60`).bind(site).all();
    return { site, can, types: MEETING_TYPES, meetings: (results || []).map(r => ({ id: r.id, title: r.title, date: r.meet_date, status: r.status, type: r.meeting_type || "",
      attended: JSON.parse(r.participants || "[]").filter(x => x.attended).length, actions: r.actions, open: r.open })) };
  }
  if (p === "mom/new") {
    const last = await env.DB.prepare("SELECT id, meet_date FROM mom_meetings WHERE site = ? AND status = 'published' ORDER BY meet_date DESC LIMIT 1").bind(site).first();
    const carry = await env.DB.prepare("SELECT * FROM mom_actions WHERE site = ? AND status = 'Open' ORDER BY due = '', due, id").bind(site).all();
    const staff = await siteStaff(env, site);
    const today = beirutToday();
    return {
      types: MEETING_TYPES,
      meeting: { id: 0, site, type: MEETING_TYPES.includes(q("type")) ? q("type") : "", title: `ABC ${siteName(site)} - Minutes of Meeting`, date: today, weekNo: String(isoWeek(today)),
        location: `ABC ${siteName(site)} - Conference Room`, nextDate: "", lastDate: last ? last.meet_date : "",
        participants: staff.filter(s => s.atSite).map(s => ({ email: s.email, name: s.name, position: s.positionLabel, attended: false })),
        points: await getSetting(env, site, "agenda", []), preparedBy: me.full_name, preparedEmail: me.email, status: "draft" },
      actions: [], carried: (carry.results || []).map(actionOut), staff, can
    };
  }
  if (p === "mom/get") {
    const m = await env.DB.prepare("SELECT * FROM mom_meetings WHERE id = ?").bind(Number(q("id")) || 0).first();
    if (!m || !canSite(me, m.site)) throw fail("Meeting not found", 404);
    const [acts, carry] = await Promise.all([
      env.DB.prepare("SELECT * FROM mom_actions WHERE meeting_id = ? ORDER BY seq, id").bind(m.id).all(),
      env.DB.prepare("SELECT * FROM mom_actions WHERE site = ? AND status = 'Open' AND meeting_id != ? AND meeting_id IN (SELECT id FROM mom_meetings WHERE meet_date <= ?) ORDER BY due = '', due, id").bind(m.site, m.id, m.meet_date).all()
    ]);
    return { types: MEETING_TYPES, meeting: meetingOut(m), actions: (acts.results || []).map(actionOut), carried: (carry.results || []).map(actionOut),
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
  /* ----- shift handover — ONE shared handover per flagship per day; each shift hands it over to the next ----- */
  if (p === "handover/list") {
    const { results } = await env.DB.prepare(
      `SELECT id, day, shift, status, created_name, updated_name, submitted_at, received_by, received_at, updated_at, handoffs FROM handovers
       WHERE site = ? AND day >= ? AND day <= ? ORDER BY day DESC, id DESC LIMIT 400`).bind(site, isDay(q("from")) ? q("from") : "0000-00-00", isDay(q("to")) ? q("to") : "9999-12-31").all();
    return { site, can, handovers: (results || []).map(h => ({ ...h, handoffs: JSON.parse(h.handoffs || "[]") })) };
  }
  if (p === "handover/new") {
    const day = isDay(q("day")) ? q("day") : beirutToday();
    const same = await env.DB.prepare("SELECT * FROM handovers WHERE site = ? AND day = ? ORDER BY id DESC LIMIT 1").bind(site, day).first();
    const shiftInfo = { shifts: await handoverShifts(env, site), shiftNames: HO_SHIFTS, admin: me.role === "ADMIN" };
    if (same) return { handover: handoverOut(same), can, existing: true, ...shiftInfo };
    const last = await env.DB.prepare("SELECT * FROM handovers WHERE site = ? AND day < ? ORDER BY day DESC, id DESC LIMIT 1").bind(site, day).first()
      || await env.DB.prepare("SELECT * FROM handovers WHERE site = ? ORDER BY day DESC, id DESC LIMIT 1").bind(site).first();
    return { handover: { id: 0, site, day, shift: "DAY", status: "draft", handoffs: [],
      doc: carryHandover(last ? JSON.parse(last.doc) : null, day), createdName: me.full_name, from: last ? { day: last.day } : null }, can, ...shiftInfo };
  }
  /* Outlook add-in: add one line to the day's handover (creates the day's handover when there is none yet) */
  if (p === "handover/append" && method === "POST") {
    if (!can.handover) throw fail("Not allowed", 403);
    const day = isDay(b.day) ? b.day : beirutToday();
    const sec = ["today", "tomorrow", "ongoing", "upcoming"].includes(b.section) ? b.section : "today";
    const text = s(b.text, 500).trim();
    if (!text) throw fail("Write the handover line");
    let h = await env.DB.prepare("SELECT * FROM handovers WHERE site = ? AND day = ? ORDER BY id DESC LIMIT 1").bind(site, day).first();
    const at = nowIso();
    const item = { text, cctv: !!b.cctv, done: false, date: sec === "upcoming" && isDay(b.date) ? b.date : "", src: "", req: "" };
    if (h) {
      const d = cleanHandover(JSON.parse(h.doc)); d[sec].push(item);
      await env.DB.prepare("UPDATE handovers SET doc = ?, updated_at = ?, updated_name = ? WHERE id = ?").bind(JSON.stringify(cleanHandover(d)), at, me.full_name, h.id).run();
    } else {
      const last = await env.DB.prepare("SELECT * FROM handovers WHERE site = ? AND day < ? ORDER BY day DESC, id DESC LIMIT 1").bind(site, day).first();
      const d = cleanHandover(carryHandover(last ? JSON.parse(last.doc) : null, day)); d[sec].push(item);
      const r = await env.DB.prepare(`INSERT INTO handovers (site, day, shift, doc, status, created_by, created_name, created_at, updated_at, updated_name, handoffs)
        VALUES (?,?,'DAY',?,'draft',?,?,?,?,?,'[]')`).bind(site, day, JSON.stringify(d), me.email, me.full_name, at, at, me.full_name).run();
      h = { id: r.meta.last_row_id };
    }
    return { id: h.id, day, section: sec };
  }
  if (p === "handover/get") {
    const h = await env.DB.prepare("SELECT * FROM handovers WHERE id = ?").bind(Number(q("id")) || 0).first();
    if (!h || !canSite(me, h.site)) throw fail("Handover not found", 404);
    return { handover: handoverOut(h), can: rights(me, h.site), shifts: await handoverShifts(env, h.site), shiftNames: HO_SHIFTS, admin: me.role === "ADMIN" };
  }
  if (p === "handover/shifts" && method === "POST") {   // administrators choose the flagship's handover shifts
    if (me.role !== "ADMIN") throw fail("Only an administrator can change the handover shifts", 403);
    const list = Object.keys(HO_SHIFTS).filter(c => (b.shifts || []).includes(c));
    if (!list.length) throw fail("Tick at least one shift");
    const r = await env.DB.prepare("SELECT v FROM meta WHERE k = 'hoshifts'").first();
    let g = {}; try { g = r ? JSON.parse(r.v) : {}; } catch {}
    g[site] = list;
    await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('hoshifts', ?)").bind(JSON.stringify(g)).run();
    return { shifts: list };
  }
  /* live rows for the Daily operations checklist tracker: AM / PM checklists and restroom inspections (OPS and S.S) */
  if (p === "handover/mailto") return handoverRecipients(env, site);   // who receives the handover email
  if (p === "handover/live") {
    const day = isDay(q("day")) ? q("day") : beirutToday();
    const [runs, rr, inc, fb] = await Promise.all([
      env.DB.prepare("SELECT form, status, done, total, issues, submitted_name, submitted_at, created_name, updated_at FROM form_runs WHERE site = ? AND day = ? AND form IN ('am','pm') ORDER BY id").bind(site, day).all().catch(() => ({ results: [] })),
      pullDay(env, "restroom", site, day), pullDay(env, "incidents", site, day),
      env.DB.prepare("SELECT tenant, time, category, description, action, action_desc, created_name FROM tenant_feedback WHERE site = ? AND day = ? ORDER BY time, id").bind(site, day).all().catch(() => ({ results: [] }))
    ]);
    /* the day's incident reports (no names — the handover is emailed to the whole group) and tenant feedback */
    const incidents = inc.error ? { error: inc.error } : { list: (inc.incidents || []).map(i => ({ ref: i.ref || "", time: i.time || "", type: i.type || "",
      severity: i.severity || "", status: i.status || "", location: i.location || i.where || "" })) };
    const feedback = (fb.results || []).map(f => ({ tenant: f.tenant, time: f.time, category: f.category, description: f.description,
      action: f.action, actionDesc: f.action_desc, by: f.created_name || "" }));
    const ck = f => { const r = (runs.results || []).find(x => x.form === f); return r ? { status: r.status, done: r.done, total: r.total, issues: r.issues,
      by: r.submitted_name || r.created_name, at: r.submitted_at || r.updated_at } : null; };
    let restroom = { error: rr.error || "" };
    if (!rr.error && rr.windows) {
      const rooms = rr.rooms || [];
      restroom = { rooms: rooms.length, windows: rr.windows.map(w => {
        let ops = 0, ss = 0; const by = { ops: new Set(), ss: new Set() };
        for (const r of rooms) { const c = (rr.grid || {})[`${r.id}|${w.id}`] || {}; if (c.ops) { ops++; c.ops.by && by.ops.add(c.ops.by); } if (c.usm) { ss++; c.usm.by && by.ss.add(c.usm.by); } }
        return { label: w.label, time: w.display || "", state: w.state, ops, ss, opsBy: [...by.ops], ssBy: [...by.ss] }; }),
        totals: rr.totals || null };
    }
    const calendar = await calendarDayEvents(env, site, day).catch(() => []);   // Operations Calendar feature: the day's marketing events
    const gate = await gateDay(env, site, day).catch(() => null);   // Loading Gate feature: approved in / rejected out at the loading area
    const hd = await env.DB.prepare("SELECT doc FROM handovers WHERE site = ? AND day = ? ORDER BY id DESC LIMIT 1").bind(site, day).first().catch(() => null);
    let gateMarks = {}; try { gateMarks = hd ? gateMarksOf(JSON.parse(hd.doc || "{}")) : {}; } catch {}   // the open page shows new gate marks without reloading
    return { day, am: ck("am"), pm: ck("pm"), restroom, incidents, feedback, calendar, gate, gateMarks };
  }
  if (p === "handover/save" && method === "POST") {
    if (!can.handover) throw fail("Not allowed", 403);
    if (!isDay(b.day)) throw fail("Choose the handover date");
    let id = Number(b.id) || 0, merged = false;
    let incoming = cleanHandover(b.doc || {});
    if (id) {
      const cur = await env.DB.prepare("SELECT doc, updated_at FROM handovers WHERE id = ? AND site = ?").bind(id, site).first().catch(() => null);
      if (cur) {
        const C = cleanHandover(JSON.parse(cur.doc || "{}"));
        /* Live handover: someone else (or the loading gate) saved since this page loaded it → merge line by line instead of overwriting */
        if (b.base && b.baseDoc && cur.updated_at !== b.base) { incoming = mergeHandover(cleanHandover(b.baseDoc), C, incoming); merged = true; }
        keepGateMarks(C, incoming);   // Loading Gate feature: a page opened before a scan must not wipe the gate's "✓ Attended / ✕ Refused" marks
      }
    }
    const doc = JSON.stringify(incoming);
    if (doc.length > 60000) throw fail("This handover is too long — remove finished items");
    const at = nowIso();
    const other = await env.DB.prepare("SELECT id FROM handovers WHERE site = ? AND day = ? AND id != ? LIMIT 1").bind(site, b.day, id).first();
    if (other) throw fail("There is already a handover for this day — open it from the list and continue there", 409, { id: other.id });
    if (id) {
      const h = await env.DB.prepare("SELECT site FROM handovers WHERE id = ?").bind(id).first();
      if (!h || h.site !== site) throw fail("Handover not found", 404);
      await env.DB.prepare("UPDATE handovers SET day = ?, shift = 'DAY', doc = ?, updated_at = ?, updated_name = ? WHERE id = ?").bind(b.day, doc, at, me.full_name, id).run();
    } else {
      const r = await env.DB.prepare(`INSERT INTO handovers (site, day, shift, doc, status, created_by, created_name, created_at, updated_at, updated_name, handoffs)
        VALUES (?,?,'DAY',?,'draft',?,?,?,?,?,'[]')`).bind(site, b.day, doc, me.email, me.full_name, at, at, me.full_name).run();
      id = r.meta.last_row_id;
    }
    if (b.submit) {
      const cur = await env.DB.prepare("SELECT handoffs FROM handovers WHERE id = ?").bind(id).first();
      const shifts = await handoverShifts(env, site);
      const shift = shifts.includes(b.shift) ? b.shift : "";
      const L = JSON.parse(cur.handoffs || "[]"); L.push({ by: me.full_name, email: me.email, at, shift, receivedBy: "", receivedAt: "" });
      await env.DB.prepare("UPDATE handovers SET status = 'submitted', submitted_at = ?, received_by = '', received_at = '', handoffs = ? WHERE id = ?")
        .bind(at, JSON.stringify(L.slice(-12)), id).run();
      const d = JSON.parse(doc);
      const cctv = [...d.ongoing, ...d.today, ...d.tomorrow].filter(x => x.cctv && !x.done).length;
      await raiseEvent(env, { site, app: "handover", tone: cctv ? "warn" : "info",
        title: `${shift ? HO_SHIFTS[shift] + " handover" : "Handover"} ready to receive · ${b.day}`,
        body: `${siteName(site)} · handed over by ${me.full_name} · ${d.today.length} today, ${d.ongoing.filter(x => !x.done).length} ongoing${cctv ? ` · ${cctv} ATT CCTV` : ""}` });
      /* the "handover submitted" reminders for this shift are done */
      if (shift && b.day === beirutToday()) await reminderDone(env, site, "handover", p => p.shift === shift && p.stage !== "received", `${HO_SHIFTS[shift]} handover submitted by ${me.full_name}`, at);
      /* ABC Operations Groups: email the handover to the flagship group + its managers */
      let mail = null;
      if (b.mail && b.mail.html) {
        const R = await handoverRecipients(env, site);
        if (!R.auto) mail = { sent: false, skipped: true };
        else if (!R.relay) mail = { sent: false, error: "Mail relay not set up" };
        else if (!R.to.length) mail = { sent: false, error: "No group email or manager for this flagship" };
        else {
          const html = String(b.mail.html).slice(0, 250000), subject = String(b.mail.subject || `ABC ${siteName(site)} | Handover ${b.day}`).slice(0, 200);
          const r = await relay(env, { to: R.to, cc: R.cc, replyTo: me.email, subject, html });
          mail = r.ok ? { sent: true, to: R.to, cc: R.cc, at: nowIso() } : { sent: false, error: r.error };
        }
        const L2 = JSON.parse((await env.DB.prepare("SELECT handoffs FROM handovers WHERE id = ?").bind(id).first()).handoffs || "[]");
        if (L2.length) { L2[L2.length - 1].mail = mail; await env.DB.prepare("UPDATE handovers SET handoffs = ? WHERE id = ?").bind(JSON.stringify(L2), id).run(); }
      }
      return { id, saved: true, mail, updatedAt: at, merged, doc: JSON.parse(doc) };
    }
    return { id, saved: true, updatedAt: at, merged, doc: JSON.parse(doc) };   // the page takes the merged copy as its new base
  }
  /* Live handover: the open page asks every 15 s whether anything changed (cheap: no document unless it did) */
  if (p === "handover/poll") {
    const h = await env.DB.prepare("SELECT * FROM handovers WHERE id = ?").bind(Number(q("id")) || 0).first();
    if (!h || !canSite(me, h.site)) throw fail("Handover not found", 404);
    if (h.updated_at === q("since") && String(h.handoffs || "").length === Number(q("hl") || -1)) return { changed: false };
    return { changed: true, handover: handoverOut(h), hl: String(h.handoffs || "").length };
  }
  if (p === "handover/receive" && method === "POST") {
    const h = await env.DB.prepare("SELECT * FROM handovers WHERE id = ?").bind(Number(b.id) || 0).first();
    if (!h || !canSite(me, h.site)) throw fail("Handover not found", 404);
    if (h.status !== "submitted") throw fail("This handover has not been handed over yet");
    const at = nowIso(), L = JSON.parse(h.handoffs || "[]"), lastH = L[L.length - 1];
    if (lastH) { lastH.receivedBy = me.full_name; lastH.receivedAt = at; }
    await env.DB.prepare("UPDATE handovers SET received_by = ?, received_at = ?, handoffs = ? WHERE id = ?").bind(me.full_name, at, JSON.stringify(L), h.id).run();
    const to = lastH ? lastH.email : h.created_by;
    if (to && to !== me.email) await raiseEvent(env, { site: h.site, app: "handover", email: to, tone: "ok",
      title: "Your handover was received", body: `${h.day} · received by ${me.full_name}` });
    if (lastH && lastH.shift && h.day === beirutToday())
      await reminderDone(env, h.site, "handover", p => p.shift === lastH.shift && p.stage === "received", `${HO_SHIFTS[lastH.shift]} handover received by ${me.full_name}`, at);
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
/* MOM meeting types — asked when a meeting is created, kept for reports */
const MEETING_TYPES = ["Internal ABC Department", "Internal Operations Meeting", "Tenant Meeting", "Soft Services Meeting", "External Meeting"];
const meetingOut = m => ({ id: m.id, site: m.site, title: m.title, date: m.meet_date, weekNo: m.week_no, location: m.location, type: m.meeting_type || "",
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
    String(m.preparedBy || me.full_name).slice(0, 80), MEETING_TYPES.includes(m.type) ? m.type : ""];
  const at = nowIso();
  let id = Number(m.id) || 0;
  if (id) {
    const ex = await env.DB.prepare("SELECT site FROM mom_meetings WHERE id = ?").bind(id).first();
    if (!ex || ex.site !== site) throw fail("Meeting not found", 404);
    await env.DB.prepare(`UPDATE mom_meetings SET title=?, meet_date=?, week_no=?, location=?, next_date=?, last_date=?, participants=?, points=?, prepared_by=?, meeting_type=?, updated_at=? WHERE id=?`)
      .bind(...vals, at, id).run();
  } else {
    const r = await env.DB.prepare(`INSERT INTO mom_meetings (title, meet_date, week_no, location, next_date, last_date, participants, points, prepared_by, meeting_type, site, status, created_by, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,'draft',?,?,?)`).bind(...vals, site, me.email, at, at).run();
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
/* Loading Gate feature: write the gate decision on the handover line of the same REQ
   ("… (REQ-009004) — ✓ Attended 23:58 · 3 workers"). Only the day's handover; a newer mark replaces the old one. */
const GATE_MARK = /\s+— (✓ Attended|✕ Refused at gate|→ Left)[^\n]*$/;
async function gateMarkHandover(env, site, day, req, mark) {
  const dg = String(req || "").replace(/\D/g, "");
  if (!dg || !mark) return false;
  const h = await env.DB.prepare("SELECT id, doc FROM handovers WHERE site = ? AND day = ? ORDER BY id DESC LIMIT 1").bind(site, day).first();
  if (!h) return false;
  const d = cleanHandover(JSON.parse(h.doc || "{}"));
  let hit = 0;
  for (const k of ["today", "ongoing", "tomorrow"]) for (const x of d[k]) {
    const own = String(x.req || "").replace(/\D/g, "") === dg || new RegExp(`\\bREQ-?0*${dg.replace(/^0+/, "")}\\b`, "i").test(x.text);
    if (!own) continue;
    const base = x.text.replace(GATE_MARK, "");
    const keep = mark.startsWith("→ Left") ? (x.text.match(GATE_MARK) || [""])[0].replace(/ → left.*$/, "") : "";   // leaving keeps the "Attended" part
    x.text = (keep ? base + keep + " → left " + mark.replace(/^→ Left\s*/, "") : base + " — " + mark).slice(0, 500);
    hit++;
  }
  if (!hit) return false;
  await env.DB.prepare("UPDATE handovers SET doc = ?, updated_at = ?, updated_name = ? WHERE id = ?").bind(JSON.stringify(cleanHandover(d)), nowIso(), "Loading Gate", h.id).run();
  return true;
}
/* a handover line's REQ number: the imported REQ, or "REQ-008935" written in a line the team typed */
const reqKeyOf = x => { const d = String(x.req || "").replace(/\D/g, "") || ((String(x.text || "").match(/\bREQ-?(\d{3,})\b/i) || [])[1] || ""); return d.replace(/^0+/, ""); };
function gateMarksOf(doc) {   // { "8935": " — ✓ Attended 20:04 · 1 worker" } from a saved handover
  const marks = {};
  for (const k of ["today", "ongoing", "tomorrow"]) for (const x of (doc && doc[k]) || []) { const m = x.text && x.text.match(GATE_MARK), r = reqKeyOf(x); if (m && r) marks[r] = m[0]; }
  return marks;
}
function keepGateMarks(saved, incoming) {   // a page opened before a scan must not wipe the gate's marks (imported and typed lines)
  const marks = gateMarksOf(saved);
  if (!Object.keys(marks).length) return;
  for (const k of ["today", "ongoing", "tomorrow"]) for (const x of incoming[k] || []) {
    const m = marks[reqKeyOf(x)];
    if (m && !GATE_MARK.test(x.text)) x.text = (x.text + m).slice(0, 500);
  }
}
/* Live handover: every line has an id so two people editing at once are merged line by line (see mergeHandover).
   Lines saved before ids existed get a stable id from their text, so every reader computes the same one. */
const hoHash = t => { let h = 2166136261; for (const c of String(t)) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
const hoId = v => /^[\w-]{1,24}$/.test(String(v || "")) ? String(v) : "";
function withIds(list, keyOf) {
  const seen = new Map();
  for (const x of list) {
    if (x.id) continue;
    const k = keyOf(x), n = (seen.get(k) || 0) + 1; seen.set(k, n);
    x.id = "h" + hoHash(k) + (n > 1 ? "-" + n : "");
  }
  const used = new Set();   // two lines must never share an id
  for (const x of list) { let id = x.id, i = 2; while (used.has(id)) id = x.id + "-" + i++; x.id = id; used.add(id); }
  return list;
}
/* Three-way merge: base = what this page last loaded, cur = what is saved now (other people, the loading gate, the Outlook add-in),
   mine = this page. Lines this page added, changed or removed win; everything else others did since is kept. */
function mergeHandover(base, cur, mine) {
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const out = cleanHandover(cur);
  for (const k of ["ongoing", "today", "tomorrow", "upcoming", "events", "docs"]) {
    const B = new Map(base[k].map(x => [x.id, x])), M = new Map(mine[k].map(x => [x.id, x]));
    let L = out[k].filter(x => !(B.has(x.id) && !M.has(x.id)));                       // removed here
    L = L.map(x => { const m = M.get(x.id); return m && !same(m, B.get(x.id)) ? m : x; });   // changed here
    const have = new Set(L.map(x => x.id));
    for (const m of mine[k]) if (!B.has(m.id) && !have.has(m.id)) L.push(m);            // added here
    out[k] = L;
  }
  const C = new Map(base.checklists.map(c => [c.name, c]));                              // checklists: by name, each field
  for (const m of mine.checklists) {
    const b0 = C.get(m.name) || {}, o = out.checklists.find(c => c.name === m.name);
    if (!o) { if (!C.has(m.name)) out.checklists.push(m); continue; }
    for (const f of ["am", "pm", "note"]) if (m[f] !== b0[f]) o[f] = m[f];
  }
  out.checklists = out.checklists.filter(c => !(C.has(c.name) && !mine.checklists.some(m => m.name === c.name)));
  if (mine.notes !== base.notes) out.notes = mine.notes;
  return cleanHandover(out);
}
function cleanHandover(d) {
  const item = x => ({ id: hoId(x.id), text: s(x.text, 500), cctv: !!x.cctv, done: !!x.done, date: isDay(x.date) ? x.date : "",
    src: x.src === "portal" ? "portal" : "", req: /^REQ-?\d+$/i.test(x.req || "") ? String(x.req).toUpperCase() : "",
    ...(x.manual ? { manual: true } : {}), ...(isDay(x.until) ? { until: x.until } : {}),
    ...(x.cols && typeof x.cols === "object" ? { cols: { tenant: s(x.cols.tenant, 160), req: s(x.cols.req, 40), task: s(x.cols.task, 300), contractor: s(x.cols.contractor, 160), time: s(x.cols.time, 40), m: s(x.cols.m, 60) } } : {}) });   // Portal Handover table columns (import) and the team's own cells (m)   // src: portal = imported from Tenant Connect (black), else typed by the team (red)
  const out = blankHandover();
  for (const k of ["ongoing", "today", "tomorrow", "upcoming"]) out[k] = withIds((Array.isArray(d[k]) ? d[k] : []).slice(0, 80).map(item).filter(x => x.text.trim()), x => k + "|" + x.text.replace(GATE_MARK, ""));
  out.events = withIds((Array.isArray(d.events) ? d.events : []).slice(0, 40).map(e => ({ id: hoId(e.id), from: isDay(e.from) ? e.from : "", to: isDay(e.to) ? e.to : "",
    name: s(e.name, 160), start: s(e.start, 5), end: s(e.end, 5) })).filter(e => e.name.trim()), e => "ev|" + e.name + "|" + e.from);
  out.checklists = (Array.isArray(d.checklists) ? d.checklists : []).slice(0, 30).map(c => ({ name: s(c.name, 120),
    am: ["Done", "Not done", "N/A", ""].includes(c.am) ? c.am : "", pm: ["Done", "Not done", "N/A", ""].includes(c.pm) ? c.pm : "", note: s(c.note, 200) })).filter(c => c.name.trim());
  out.docs = withIds((Array.isArray(d.docs) ? d.docs : []).slice(0, 40).map(x => ({ id: hoId(x.id), label: s(x.label, 160), url: s(x.url, 400), task: s(x.task, 80),
    updated: isDay(x.updated) ? x.updated : "", comment: s(x.comment, 200) })).filter(x => x.label.trim() || x.url.trim()), x => "doc|" + x.label + "|" + x.url);
  out.notes = s(d.notes, 4000);
  return out;
}
/* A new handover starts from the last one: unfinished follow-ups stay, yesterday's "tomorrow"
   becomes today, dated items arrive on their day (and the day before, under "Tomorrow"), finished events drop off, checklists reset. */
function carryHandover(prev, day) {
  if (!prev) return blankHandover();
  const d = cleanHandover(prev);
  const next = (() => { const t = new Date(day + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + 1); return t.toISOString().slice(0, 10); })();
  const due = d.upcoming.filter(x => x.date && x.date <= day);
  const dueTomorrow = d.upcoming.filter(x => x.date === next);   // "Coming up" dated tomorrow → Tomorrow
  /* Portal Handover lines (Tenant Connect requests) stay in Today only while their permit runs: yesterday's finished
     requests leave at midnight even if nobody ticked Done. Typed lines (Operations Handover) carry on until Done. */
  const lastDay = x => x.until || (String(x.text || "").match(/\b\d{2}\/\d{2}\/\d{4}\b/g) || []).map(t => `${t.slice(6)}-${t.slice(3, 5)}-${t.slice(0, 2)}`).sort().pop() || "";
  const stays = x => !x.done && (x.src !== "portal" || x.manual || lastDay(x) >= day);   // rows typed by hand have no permit dates: kept until Done
  return {
    ongoing: d.ongoing.filter(x => !x.done).map(x => ({ ...x })),
    today: [...d.today.filter(stays), ...d.tomorrow, ...due].map(x => ({ ...x, done: false, date: "" })),
    tomorrow: dueTomorrow.map(x => ({ ...x, done: false })),
    upcoming: d.upcoming.filter(x => !x.date || x.date > next),
    events: d.events.filter(e => !e.to || e.to >= day),
    checklists: [],   // manual checklist table retired — the live AM/PM + restroom rows replace it
    docs: d.docs, notes: ""
  };
}
/* Handover shifts per flagship — Settings in Shift Handover (administrators tick them). */
const HO_SHIFTS = { AM: "AM", MID: "Mid", PM: "PM", NIGHT: "Night" };
async function handoverShifts(env, site) {
  const r = await env.DB.prepare("SELECT v FROM meta WHERE k = 'hoshifts'").first().catch(() => null);
  let g = {}; try { g = r ? JSON.parse(r.v) : {}; } catch {}
  const list = (g[site] || []).filter(c => HO_SHIFTS[c]);
  return list.length ? list : ["AM", "PM"];
}
const handoverOut = h => ({ id: h.id, site: h.site, day: h.day, shift: h.shift, status: h.status, doc: cleanHandover(JSON.parse(h.doc)),
  createdName: h.created_name, createdBy: h.created_by, submittedAt: h.submitted_at, receivedBy: h.received_by, receivedAt: h.received_at, updatedAt: h.updated_at,
  updatedName: h.updated_name || "", handoffs: JSON.parse(h.handoffs || "[]"), hl: String(h.handoffs || "").length });   // hl: live handover poll

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

/* =====================================================================
   GLA — statuses, seeding from the built-in workbook data, history
   ===================================================================== */
const GLA_STATUS = ["Open", "Closed", "Fit-out", "Reserved", "Terminated", "Vacant"];
const GLA_SECTIONS = ["Leasing", "Pop-up", "Additional", "DS", "iPlay"];
const glaUnitOut = u => ({ id: u.id, level: u.level, code: u.code, brand: u.brand, status: u.status, section: u.section, dept: u.dept,
  area: u.area, contractStart: u.contract_start || "", updatedAt: u.updated_at, updatedBy: u.updated_by });
function glaLevels(units) { const out = []; for (const u of units) if (!out.includes(u.level)) out.push(u.level); return out; }
/* First use at a flagship: load its GLA from the built-in data (data/gla-data.js) as the starting point */
async function glaSeed(env, site) {
  const has = await env.DB.prepare("SELECT 1 AS x FROM gla_units WHERE site = ? LIMIT 1").bind(site).first();
  if (has || !GLA[site]) return;
  const claim = await env.DB.prepare("INSERT OR IGNORE INTO meta (k, v) VALUES (?, ?)").bind("glaseed:" + site, nowIso()).run();
  if (!claim.meta || claim.meta.changes !== 1) return;
  const g = GLA[site], at = nowIso();
  const status = u => /vacant/i.test(u.status) || /^vacant/i.test(u.brand) ? "Vacant" : /fit/i.test(u.status) ? "Fit-out" : /close/i.test(u.status) ? "Closed" : "Open";
  const section = u => /^ds$/i.test(u.type) ? "DS" : /iplay/i.test(u.type) ? "iPlay" : /pop/i.test(u.type) ? "Pop-up" : u.level === "B6" ? "Additional" : "Leasing";
  const ops = g.units.map((u, i) => env.DB.prepare(`INSERT INTO gla_units (site, level, code, brand, status, section, dept, area, seq, updated_at, updated_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(site, u.level, u.code, status(u) === "Vacant" ? "" : u.brand, status(u), section(u), u.dept || "", Number(u.area) || 0, i + 1, at, "GLA workbook"));
  for (let i = 0; i < ops.length; i += 90) await env.DB.batch(ops.slice(i, i + 90));
  await putSetting(env, site, "gla_baseline", { month: g.month, date: `${g.month}-01`, source: `GLA workbook ${g.month}`, official: g.official || {} });
}
/* Rebuild the GLA on any date: start from today and undo every change dated after it (latest first) */
async function glaAsOf(env, site, day) {
  await glaSeed(env, site);
  const [units, evs] = await Promise.all([
    env.DB.prepare("SELECT * FROM gla_units WHERE site = ?").bind(site).all(),
    env.DB.prepare("SELECT * FROM gla_events WHERE site = ? AND eff_date > ? ORDER BY eff_date DESC, id DESC").bind(site, day).all()
  ]);
  const map = new Map((units.results || []).map(u => [u.id, { ...glaUnitOut(u), active: !!u.active }]));
  for (const e of evs.results || []) {
    const u = map.get(e.unit_id); if (!u) continue;
    if (e.kind === "add") u.active = false;
    else if (e.kind === "remove") u.active = true;
    else Object.assign(u, JSON.parse(e.before || "{}"));
  }
  return [...map.values()].filter(u => u.active).map(({ active, ...u }) => u);
}

/* =====================================================================
   END OF DAY REPORT — everything that happened at one flagship on one day
   ===================================================================== */
async function pullDay(env, id, site, day) {
  const c = CONNECTORS[id];
  if (!c || !c.day || !env.HUB_KEY) return { error: "Not connected" };
  const target = c.base + c.day.replace("{site}", encodeURIComponent(site)).replace("{date}", day);
  const init = { headers: { "x-hub-key": env.HUB_KEY }, signal: AbortSignal.timeout(8000) };
  try {
    const r = c.binding && env[c.binding] ? await env[c.binding].fetch(target, init) : await fetch(target, init);
    const j = await r.json().catch(() => null);
    if (!j || !j.ok) return { error: (j && j.error) || `HTTP ${r.status}` };
    return j.data;
  } catch (e) { return { error: "Not reachable" }; }
}
/* Cleaner QR access lives in a Google Sheet: an Apps Script web app returns the day's entries */
async function cleanerDay(env, site, day) {
  if (!env.CLEANER_SHEET_URL) return { error: "Not connected yet" };
  try {
    const u = new URL(env.CLEANER_SHEET_URL);
    u.searchParams.set("action", "hubDay"); u.searchParams.set("key", env.CLEANER_SHEET_KEY || ""); u.searchParams.set("site", site); u.searchParams.set("date", day);
    const r = await fetch(u.toString(), { redirect: "follow", signal: AbortSignal.timeout(10000) });
    const j = await r.json().catch(() => null);
    if (!j || !j.ok) return { error: (j && j.error) || `HTTP ${r.status}` };
    return j.data;
  } catch (e) { return { error: "Not reachable" }; }
}
async function eodReport(env, me, site, day) {
  const sensitive = isFull(me) || me.role === "SECURITY" || me.position === "SMS";
  await glaSeed(env, site);
  const [restroom, incidents, snag, cleaner, moms, fb, hos, sched, notes, units, staff] = await Promise.all([
    pullDay(env, "restroom", site, day), pullDay(env, "incidents", site, day), pullDay(env, "snaglist", site, day), cleanerDay(env, site, day),
    env.DB.prepare(`SELECT m.*, (SELECT COUNT(*) FROM mom_actions a WHERE a.meeting_id = m.id) AS n_actions FROM mom_meetings m
      WHERE m.site = ? AND (m.meet_date = ? OR substr(m.published_at, 1, 10) = ?) ORDER BY m.id`).bind(site, day, day).all(),
    env.DB.prepare("SELECT * FROM tenant_feedback WHERE site = ? AND day = ? ORDER BY time, id").bind(site, day).all(),
    env.DB.prepare("SELECT * FROM handovers WHERE site = ? AND day = ? ORDER BY shift, id").bind(site, day).all(),
    env.DB.prepare("SELECT email, val FROM sched_cells WHERE site = ? AND day = ?").bind(site, day).all(),
    env.DB.prepare("SELECT note FROM sched_notes WHERE site = ? AND day = ?").bind(site, day).first(),
    env.DB.prepare("SELECT * FROM gla_units WHERE site = ? AND active = 1").bind(site).all(),
    siteStaff(env, site)
  ]);
  const ago = n => { const d = new Date(day + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
  const [runs, lastBank, glaEv, recentHo] = await Promise.all([
    env.DB.prepare("SELECT * FROM form_runs WHERE site = ? AND day = ? ORDER BY form, id").bind(site, day).all().catch(() => ({ results: [] })),
    env.DB.prepare("SELECT day, status, issues, submitted_name, created_name FROM form_runs WHERE site = ? AND form = 'dbank' AND day <= ? ORDER BY day DESC, id DESC LIMIT 1").bind(site, day).first().catch(() => null),
    env.DB.prepare("SELECT e.*, u.brand AS cur_brand, u.code AS cur_code, u.level AS cur_level, u.status AS cur_status FROM gla_events e LEFT JOIN gla_units u ON u.id = e.unit_id WHERE e.site = ? AND e.eff_date = ? ORDER BY e.id").bind(site, day).all(),
    env.DB.prepare("SELECT day, shift, doc, created_name FROM handovers WHERE site = ? AND day >= ? AND day < ? ORDER BY day, shift").bind(site, ago(60), day).all()
  ]);

  /* Operations Forms: AM / PM checklists, tenant opening / closing, direct banking tour */
  const formRun = r => {
    const items = JSON.parse(r.items || "[]"), ans = JSON.parse(r.answers || "{}"), head = JSON.parse(r.header || "{}");
    const flags = head.flags || {};
    const findings = items.filter(it => !(it.c && flags[it.c] === false)).map(it => ({ it, a: ans[it.id] || {} }))
      .filter(x => x.a.v === "n" || (x.it.k === "training" && x.a.tr === "no"))
      .map(x => ({ section: x.it.s || "", area: x.it.a || "", task: x.it.t || "", ids: x.it.ids || "", remark: x.a.r || "",
        training: x.it.k === "training" ? (x.a.day ? "Training day " + x.a.day : "Training not done") : "" }));
    const remarks = items.map(it => ({ it, a: ans[it.id] || {} })).filter(x => x.a.r && x.a.v !== "n").map(x => ({ area: x.it.a || "", task: x.it.t || "", remark: x.a.r }));
    return { id: r.id, form: r.form, day: r.day, title: r.title, status: r.status, done: r.done, total: r.total, issues: r.issues,
      by: r.submitted_name || r.created_name, submittedAt: r.submitted_at, updatedAt: r.updated_at, comments: r.comments || "",
      unit: head.unit || head.code || "", findings, remarks };
  };
  const R2 = (runs.results || []).map(formRun);
  const checklists = { am: R2.find(r => r.form === "am") || null, pm: R2.find(r => r.form === "pm") || null };
  const dbank = { today: R2.filter(r => r.form === "dbank"), last: lastBank ? { day: lastBank.day, status: lastBank.status, issues: lastBank.issues, by: lastBank.submitted_name || lastBank.created_name } : null };
  /* tenants that opened / closed on this day — the opening / closing checklists and the GLA changes with this effective date */
  const opened = [], closedT = [];
  for (const e of glaEv.results || []) {
    const b = JSON.parse(e.before || "{}"), a = JSON.parse(e.after || "{}");
    const brandA = a.brand || e.cur_brand || "", brandB = b.brand || e.cur_brand || "";
    const unit = { code: e.cur_code || a.code || b.code || "", level: e.cur_level || a.level || b.level || "", note: e.note || "", by: e.by_name || "" };
    const wasOpen = s2 => ["Open", "Closed"].includes(s2);
    if (e.kind === "add" && a.status === "Open" && brandA) opened.push({ brand: brandA, ...unit, how: "New unit added as Open" });
    else if (e.kind === "remove" && wasOpen(b.status) && brandB) closedT.push({ brand: brandB, ...unit, how: "Unit removed" });
    else if (e.kind === "update") {
      if (a.status === "Open" && b.status && !wasOpen(b.status)) opened.push({ brand: brandA, ...unit, how: `${b.status} → Open` });
      if (["Terminated", "Vacant"].includes(a.status) && b.status && wasOpen(b.status)) closedT.push({ brand: brandB, ...unit, how: `${b.status} → ${a.status}` });
      if (a.brand && b.brand && a.brand !== b.brand && (a.status || e.cur_status) === "Open") { closedT.push({ brand: b.brand, ...unit, how: `Replaced by ${a.brand}` }); opened.push({ brand: a.brand, ...unit, how: `Replaced ${b.brand}` }); }
    }
  }
  const tenants = { opening: R2.filter(r => r.form === "open"), closing: R2.filter(r => r.form === "close"), opened, closed: closedT,
    announcements: await announcementsOn(env, site, day) };
  /* shift handover tasks that belong to this date */
  const tasks = [], seen = new Set();
  const addTask = (x, from, kind) => { const k = x.text.trim().toLowerCase(); if (seen.has(k)) { const t = tasks.find(t => t.key === k); if (t && x.done) t.done = true; return; } seen.add(k);
    tasks.push({ key: k, text: x.text, cctv: !!x.cctv, done: !!x.done, from, kind }); };
  for (const h of hos.results || []) { const d = cleanHandover(JSON.parse(h.doc)); for (const x of d.today) addTask(x, `${h.shift === "AM" ? "Morning handover" : h.shift === "PM" ? "Evening handover" : "Handover"} · ${h.created_name || ""}`, "today"); }
  for (const h of recentHo.results || []) {
    const d = cleanHandover(JSON.parse(h.doc));
    if (h.day === ago(1)) for (const x of d.tomorrow) addTask({ ...x, done: false }, `"Tomorrow" in the handover of ${h.day}`, "tomorrow");
    for (const x of d.upcoming) if (x.date === day) addTask({ ...x, done: false }, `Scheduled in the handover of ${h.day}`, "dated");
  }

  /* minutes of meeting */
  const momOut = [];
  for (const m of moms.results || []) {
    const acts = await env.DB.prepare("SELECT text, owner_name, due, status FROM mom_actions WHERE meeting_id = ? ORDER BY seq").bind(m.id).all();
    momOut.push({ id: m.id, title: m.title, type: m.meeting_type || "", date: m.meet_date, status: m.status, preparedBy: m.prepared_by,
      attended: JSON.parse(m.participants || "[]").filter(x => x.attended).map(x => x.name), actions: acts.results || [] });
  }
  /* handovers: the items written for the day */
  const hoOut = (hos.results || []).map(h => { const d = cleanHandover(JSON.parse(h.doc));
    return { id: h.id, shift: h.shift, status: h.status, by: h.created_name, receivedBy: h.received_by, submittedAt: h.submitted_at,
      handoffs: JSON.parse(h.handoffs || "[]"), updatedName: h.updated_name || "",
      today: d.today, tomorrow: d.tomorrow, ongoing: d.ongoing.filter(x => !x.done), upcoming: d.upcoming, events: d.events.filter(e => (!e.from || e.from <= day) && (!e.to || e.to >= day)),
      checklists: d.checklists, notes: d.notes }; });
  /* schedule: who is on today */
  const who = Object.fromEntries(staff.map(s => [s.email, s]));
  const hm = t => { const [a, b] = t.split(":").map(Number); return a + b / 60; };
  const shifts = [], away = [];
  for (const c of sched.results || []) {
    const p = who[c.email]; if (!p) continue;
    if (c.val.includes("-")) { const [a, b] = c.val.split("-"); shifts.push({ name: p.name, position: p.positionLabel, start: a, end: b, hours: ((hm(b) - hm(a)) + 24) % 24 || 24 }); }
    else away.push({ name: p.name, position: p.positionLabel, code: c.val, label: (SHIFT_CODES[c.val] || {}).label || c.val });
  }
  shifts.sort((a, b) => a.start.localeCompare(b.start) || a.name.localeCompare(b.name));
  /* GLA */
  const U = units.results || [];
  const sum = f => U.filter(f).reduce((a, u) => a + (u.area || 0), 0);
  const base = sum(u => u.section === "Leasing"), vacant = sum(u => u.section === "Leasing" && (u.status === "Vacant" || u.status === "Terminated"));
  const unitRow = u => ({ level: u.level, code: u.code, brand: u.brand, area: u.area, dept: u.dept, contractStart: u.contract_start || "", updatedAt: u.updated_at });
  const gla = { occupancy: base ? 1 - vacant / base : 0, leasingArea: base, vacantArea: vacant,
    active: U.filter(u => u.status === "Open" && u.section !== "DS").length,
    closed: U.filter(u => u.status === "Closed").map(unitRow),
    fitout: U.filter(u => u.status === "Fit-out").map(unitRow),
    reserved: U.filter(u => u.status === "Reserved").map(unitRow).sort((a, b) => a.contractStart.localeCompare(b.contractStart)),
    vacantUnits: U.filter(u => u.section === "Leasing" && (u.status === "Vacant" || u.status === "Terminated")).length };

  /* incidents — case details and names only for those who handle them */
  let inc = incidents;
  if (!inc.error && !sensitive) inc = { date: inc.date, restricted: true,
    incidents: inc.incidents.map(i => ({ ref: i.ref, time: i.time, type: i.type, severity: i.severity, status: i.status })),
    pirs: inc.pirs.map(p => ({ ref: p.ref, severity: p.severity, hoursWaiting: p.hoursWaiting, overdue: p.overdue })),
    blacklist: [], blacklistCount: inc.blacklist.length };

  return { site, siteName: siteName(site), date: day, today: beirutToday(), generatedAt: nowIso(), sensitive,
    restroom, incidents: inc, snaglist: snag, cleaner,
    mom: momOut,
    feedback: (fb.results || []).map(fbOut),
    handovers: hoOut,
    handoverTasks: tasks.map(({ key, ...t }) => t),
    checklists, dbank, tenants,
    schedule: { shifts, away, note: notes ? notes.note : "", headcount: shifts.length },
    gla };
}
