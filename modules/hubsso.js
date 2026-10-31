/* =====================================================================
   ONE HUB ACCOUNT FOR EVERY SYSTEM (Oct 2026) — docs/FEATURE-hub-sign-in.md
   • From the hub: Snaglist, Incidents and Restroom open with no password (a one-minute pass signed with HUB_KEY).
     The pass carries the account the system should use (role, flagship…), so a missing account is created there.
   • On a system's own website: "Sign in with ABC Hub" → /sso?app=… → the hub's sign-in (with two-step) → back, signed in.
   • Hub sign-out ends it: the systems ask /api/sso/alive about every session opened through the hub.
   • Admin Control → Hub sign-in: per system "Hub sign-in only" (the system's own passwords stop working).
   • External accounts (role EXTERNAL): people outside operations; they only see and open the systems given to them.
   ===================================================================== */

export const SSO_APPS = {
  snaglist: { name: "Snaglist Manager" },
  incidents: { name: "Incident Report System" },
  restroom: { name: "Restroom Inspection Dashboard" }
};
export const SNAG_ROLES = { ADMIN: "Admin", FULL_ACCESS: "Full Access", MANAGER: "Manager", SUPERVISOR: "Supervisor", HEAD: "Head", AUDIT: "Audit", SITE_VISIT: "Site Visit" };
const SNAG_NEEDS_SITE = ["MANAGER", "SUPERVISOR", "AUDIT"];
export const INC_ROLES = ["Admin", "Property Advisor", "Security Manager", "Mall Director", "Mall Manager", "Supervisor"];
export const INC_POSITIONS = ["Security Manager", "Security Director", "Property Manager", "Mall Director", "Supervisor", "Customer Service", "CCTV Team", "Legal", "Internal Audit", "Property Advisor"];
const INC_SITE = { VRM: "Verdun Mall", ACM: "Achrafieh Mall", DBS: "Dbayeh Mall", ACS: "Achrafieh DS", VRS: "Verdun DS" };   // the Incident system's own flagship names
const INC_ALL = ["Admin", "Property Advisor", "Security Manager"];

const parse = s => { try { const v = JSON.parse(s || "{}"); return v && typeof v === "object" ? v : {}; } catch { return {}; } };
const codes = (list, SITES) => [...new Set((Array.isArray(list) ? list : []).map(x => String(x).toUpperCase()).filter(c => SITES[c]))];

export async function ssoSchema(env) {
  await env.DB.prepare("ALTER TABLE users ADD COLUMN sys TEXT NOT NULL DEFAULT ''").run().catch(() => {});
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS sso_ended (email TEXT NOT NULL, sid TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY (email, sid))").run();
}

/* ---------- which account a hub user gets in each system (the table agreed on 31 Oct 2026) ---------- */
function autoAccount(u, app, d) {
  const r = u.role, site = u.site_code || "", wh = r === "SUPERVISOR" && u.position === "WH";
  const mine = d.sitesOf(u);
  if (r === "EXTERNAL") return null;
  if (app === "snaglist") {
    if (r === "ADMIN") return { role: "ADMIN" };
    if (r === "ADVISOR") return { role: "FULL_ACCESS", sites: [] };   // every flagship
    if (r === "DIRECTOR" || r === "CDSO") return { role: "FULL_ACCESS", sites: mine };   // the flagships ticked on their hub account (CDSO: the department stores)
    if (r === "MANAGER" && site) return { role: "MANAGER", site };
    if (r === "SUPERVISOR" && site && !wh) return { role: "SUPERVISOR", site };
    return null;   // Warehouse, Security
  }
  if (app === "incidents") {
    if (r === "ADMIN") return { role: "Admin", scope: "ALL" };
    if (r === "ADVISOR") return { role: "Property Advisor", scope: "ALL" };
    if (r === "DIRECTOR" || r === "CDSO") return { role: "Mall Director", scope: mine.map(c => INC_SITE[c]).join(",") };
    if (r === "MANAGER" && site) return { role: "Mall Manager", scope: INC_SITE[site] };
    if ((r === "SUPERVISOR" && !wh || r === "SECURITY") && site) return { role: "Supervisor", scope: INC_SITE[site] };   // Security falls under operations
    return null;
  }
  if (app === "restroom") return wh ? null : { view: true };
  return null;
}
/* null = no access · { acct, force } — force: set by hand in the hub, so the system updates an existing account too */
export function sysAccess(u, app, d) {
  if (!u || !SSO_APPS[app]) return null;
  const c = parse(u.sys)[app] || {};
  if (c.m === "none") return null;
  if (c.m === "set") {
    if (app === "snaglist") { if (!SNAG_ROLES[c.role]) return null; return { acct: { role: c.role, site: c.site || "", sites: c.sites || [], position: c.position || "" }, force: true }; }
    if (app === "incidents") { if (!INC_ROLES.includes(c.role)) return null;
      const all = INC_ALL.includes(c.role) || (c.sites || []).includes("ALL");
      return { acct: { role: c.role, scope: all ? "ALL" : (c.sites || []).map(x => INC_SITE[x]).filter(Boolean).join(","), position: c.position || "" }, force: true }; }
    return { acct: { view: true }, force: true };
  }
  const a = autoAccount(u, app, d);
  if (a && app === "snaglist") a.position = d.posLabel(u.position) || "";
  return a ? { acct: a, force: false } : null;
}
export function sysSummary(u, d) {
  return Object.fromEntries(Object.keys(SSO_APPS).map(k => { const a = sysAccess(u, k, d); return [k, a ? { ...a.acct, force: a.force } : null]; }));
}

/* the "Systems" part of the user window → what is stored on the account */
export function cleanSys(raw, role, SITES) {
  const x = raw && typeof raw === "object" ? raw : {}, out = {};
  for (const k of Object.keys(SSO_APPS)) {
    const c = x[k] || {}, m = ["set", "none"].includes(c.m) ? c.m : "auto";
    if (m === "auto") { if (role === "EXTERNAL") out[k] = { m: "none" }; continue; }
    if (m === "none") { out[k] = { m }; continue; }
    if (k === "snaglist") {
      const r = String(c.role || "").toUpperCase(); if (!SNAG_ROLES[r]) throw Object.assign(new Error("Choose the Snaglist role"), { status: 400 });
      const site = SITES[String(c.site || "").toUpperCase()] ? String(c.site).toUpperCase() : "";
      if (SNAG_NEEDS_SITE.includes(r) && !site) throw Object.assign(new Error(`Snaglist ${SNAG_ROLES[r]} needs a flagship`), { status: 400 });
      out[k] = { m, role: r, site: SNAG_NEEDS_SITE.includes(r) ? site : "", sites: r === "FULL_ACCESS" ? codes(c.sites, SITES) : [], position: String(c.position || "").slice(0, 80) };
    } else if (k === "incidents") {
      if (!INC_ROLES.includes(c.role)) throw Object.assign(new Error("Choose the Incidents role"), { status: 400 });
      const all = INC_ALL.includes(c.role) || (Array.isArray(c.sites) && c.sites.includes("ALL"));
      const list = all ? ["ALL"] : codes(c.sites, SITES);
      if (!list.length) throw Object.assign(new Error("Tick the flagships for Incidents"), { status: 400 });
      out[k] = { m, role: c.role, sites: list, position: INC_POSITIONS.includes(c.position) ? c.position : "" };
    } else out[k] = { m };
  }
  if (role === "EXTERNAL" && !Object.values(out).some(v => v.m === "set")) throw Object.assign(new Error("Give the external account at least one system"), { status: 400 });
  return JSON.stringify(out);
}

/* ---------- sign-in policy (Admin Control) ---------- */
export async function ssoPolicy(env) {
  const r = await env.DB.prepare("SELECT v FROM meta WHERE k = 'sso:policy'").first().catch(() => null);
  return parse(r && r.v);
}
export async function ssoPolicySet(env, app, hubOnly) {
  if (!SSO_APPS[app]) throw Object.assign(new Error("Unknown system"), { status: 400 });
  const p = await ssoPolicy(env); p[app] = { hubOnly: !!hubOnly, at: new Date().toISOString() };
  await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('sso:policy', ?)").bind(JSON.stringify(p)).run();
  return p;
}

/* ---------- server-to-server, x-hub-key: is this hub session still signed in? what is the policy? ---------- */
export async function ssoServer(env, path, url, d) {
  const k = url.searchParams;
  if (path === "sso/policy") { const p = await ssoPolicy(env); const a = k.get("app"); return { hubOnly: !!(p[a] && p[a].hubOnly) }; }
  if (path === "sso/alive") {
    const email = String(k.get("e") || "").toLowerCase(), sid = String(k.get("sid") || ""), app = String(k.get("app") || "");
    if (!email || !sid) return { alive: false };
    const u = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
    if (!u || !u.active) return { alive: false, why: "account" };
    if (u.signout_at && Number(sid) < Number(u.signout_at)) return { alive: false, why: "signed out everywhere" };
    if (Number(sid) + d.sessionMs < Date.now()) return { alive: false, why: "expired" };
    if (await env.DB.prepare("SELECT 1 FROM sso_ended WHERE email = ? AND sid = ?").bind(email, sid).first()) return { alive: false, why: "signed out" };
    if (app && SSO_APPS[app] && !sysAccess(u, app, d)) return { alive: false, why: "no access" };
    return { alive: true };
  }
  return null;
}
/* the hub's sign-out: every system session opened from this hub session ends */
export async function ssoEnd(env, email, sid) {
  if (!email || !sid) return;
  await env.DB.prepare("INSERT OR IGNORE INTO sso_ended (email, sid, at) VALUES (?,?,?)").bind(email, String(sid), new Date().toISOString()).run().catch(() => {});
  await env.DB.prepare("DELETE FROM sso_ended WHERE at < ?").bind(new Date(Date.now() - 40 * 864e5).toISOString()).run().catch(() => {});
}

/* External accounts reach only these hub requests */
export const extAllowed = p => ["me", "logout", "password", "sso", "announcements"].includes(p) || p.startsWith("2fa/") || p === "profile" || p.startsWith("profile/");
