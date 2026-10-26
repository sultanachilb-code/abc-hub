/* =====================================================================
   TENANT PORTAL FOLLOW-UP — Breaches & Penalties · Violations · ABC Requests (Normal Requests)
   + (Oct 2026, Portal Dashboard v2) Marketing Requests (MKT-) · Contractor Permits (CP-) · Portal Users (Active Users report)
   The Salesforce (Tenant Connect / ABC Connect) reports arrive by email (…+portal-<TAG>@gmail.com,
   or uploaded by hand on the page) and are kept here as a snapshot per report and flagship:
   an item that is no longer in the next report is marked as left (resolved / filtered out).
   The dashboard shows the follow-ups still "Sent to Tenant", the figures per status / type / tenant,
   and a button that opens each item in the portal. See docs/FEATURE-portal-followup.md and docs/FEATURE-portal-v2.md
   • Contractor Permits have no Branch / Account column (yet): they are kept under site "*" (all flagships) until IT adds it.
   • The "Resolved / Unresolved Violations" report is a part of the Violations & Requests report: it only updates
     the items it has (description, status) and never marks the others as left.
   • Portal Users: one table for the whole portal (no Branch column yet), managers and leadership only.
   ===================================================================== */
import { readSheet } from "./sheetread.js";

const err = (m, status = 400) => Object.assign(new Error(m), { status });
const clip = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
const norm = s => String(s || "").toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, " ").trim();

/* the reports, told apart by the item number (BP-000096 · VR-000040 · NR-000242 · MKT-000112 · CP-000051) */
export const KINDS = {
  bp: { prefix: "BP", label: "Breaches & Penalties" },
  vr: { prefix: "VR", label: "Violations" },
  nr: { prefix: "NR", label: "ABC Requests" },
  mk: { prefix: "MKT", label: "Marketing Requests" },
  cp: { prefix: "CP", label: "Contractor Permits" }
};
const KIND_OF = { BP: "bp", VR: "vr", NR: "nr", MKT: "mk", CP: "cp" };
export const ALL_SITES = "*";   // a report without Branch / Account (Contractor Permits today): kept for every flagship
const PORTAL = env => String(env.PORTAL_URL || "https://abclebanon.my.site.com/abcemployee/s").replace(/\/+$/, "");

export async function portalSchema(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS portal_items (name TEXT PRIMARY KEY, kind TEXT NOT NULL, site TEXT NOT NULL, account TEXT NOT NULL DEFAULT '',
      tenant TEXT NOT NULL DEFAULT '', type TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT '', created_day TEXT NOT NULL DEFAULT '', days INTEGER,
      subject TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', link TEXT NOT NULL DEFAULT '', sf_id TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1, first_seen TEXT NOT NULL DEFAULT '', last_seen TEXT NOT NULL DEFAULT '', left_at TEXT NOT NULL DEFAULT '',
      status_since TEXT NOT NULL DEFAULT '')`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS portal_items_site ON portal_items (site, kind, active)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS portal_users (username TEXT PRIMARY KEY, first TEXT NOT NULL DEFAULT '', last TEXT NOT NULL DEFAULT '', title TEXT NOT NULL DEFAULT '',
      company TEXT NOT NULL DEFAULT '', account TEXT NOT NULL DEFAULT '', site TEXT NOT NULL DEFAULT '', profile TEXT NOT NULL DEFAULT '', last_login TEXT NOT NULL DEFAULT '',
      created TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1, first_seen TEXT NOT NULL DEFAULT '', last_seen TEXT NOT NULL DEFAULT '')`)
  ]);
  /* v2 columns: valid from / to (marketing, permits), contractor phone, work permit, ABC comments, and a fingerprint to skip unchanged rows */
  for (const c of ["valid_from TEXT NOT NULL DEFAULT ''", "valid_to TEXT NOT NULL DEFAULT ''", "phone TEXT NOT NULL DEFAULT ''", "permit TEXT NOT NULL DEFAULT ''",
    "abc_note TEXT NOT NULL DEFAULT ''", "fp TEXT NOT NULL DEFAULT ''"]) await env.DB.prepare(`ALTER TABLE portal_items ADD COLUMN ${c}`).run().catch(() => {});
}

/* "Sent to Tenant 💬" → "Sent to Tenant" · "Confirmed & Resolved 🟢" → "Confirmed & Resolved" */
export function cleanStatus(s) {
  const t = String(s || "").replace(/[^\p{L}\p{N}\s&\-\/]/gu, "").replace(/\s+/g, " ").trim();
  return /^sent to tenant$/i.test(t) ? "Sent to Tenant" : t;
}
export const isFollowUp = s => /^sent to tenant/i.test(s);
const cleanType = s => String(s || "").replace(/[^\p{L}\p{N}\s&\-\/()',.]/gu, "").replace(/\s+/g, " ").trim();
export function toDay(v) {
  if (v == null || v === "") return "";
  if (typeof v === "number" && v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 864e5).toISOString().slice(0, 10);
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/.exec(s);
  if (m) { const y = m[3].length === 2 ? "20" + m[3] : m[3]; return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; }
  if (/^\d{5}(\.\d+)?$/.test(s)) return toDay(Number(s));
  return "";
}
/* "17/05/2026, 09:30" → "2026-05-17T09:30" (Beirut time, as the report shows it) */
export function toDT(v) {
  const day = toDay(v); if (!day) return "";
  const m = /(\d{1,2}):(\d{2})/.exec(String(v).replace(/^\S+/, ""));
  return m ? `${day}T${m[1].padStart(2, "0")}:${m[2]}` : day;
}
/* "Achrafieh DS L1", "Achrafieh Department Store", "… Verdun Mall" → the flagship; DS = Department Store */
const dsN = t => norm(t).replace(/\bdepartment store\b/g, "ds");
export function siteOf(branch, account, SITES) {
  const b = norm(branch);
  for (const [c, n] of Object.entries(SITES)) if (b && norm(n) === b) return c;
  for (const [c, n] of Object.entries(SITES)) if (b && (b.includes(norm(n)) || norm(n).includes(b))) return c;
  const a = dsN(account), bySize = Object.entries(SITES).sort((x, y) => dsN(y[1]).length - dsN(x[1]).length);
  const hit = bySize.find(([, n]) => a.endsWith(dsN(n))) || bySize.find(([, n]) => new RegExp(`(^|\\s)${dsN(n)}(\\s+(gf|lg|lgf|ug|mz|b\\d|l\\d|level \\d|\\d))*$`).test(a));
  return hit ? hit[0] : "";
}
/* the account without its flagship ("TAVOLINA Verdun Mall" → "TAVOLINA", "SOCKS Achrafieh DS L1" → "SOCKS") */
const tenantOf = (account, siteName) => {
  const raw = String(account || "").replace(/''/g, "'").replace(/\s+/g, " ").trim();
  const alts = [siteName, siteName.replace(/Department Store/i, "DS")].map(x => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  for (const x of alts) { const m = new RegExp(`^(.*?)\\s+${x}(\\s+\\S{1,6})*$`, "i").exec(raw); if (m && m[1].trim()) return m[1].trim(); }
  return raw;
};

/* ---------- read one Salesforce report (grouped or not) into items ---------- */
export function parseReport(rows) {
  const isNo = v => /^(BP|VR|NR|MKT|CP)-\d{3,}$/i.test(String(v || "").trim());
  /* the item-number column: the one where most cells are BP-/VR-/NR- numbers */
  let nameCol = -1, best = 0;
  const width = Math.max(0, ...rows.map(r => r.length));
  for (let c = 0; c < width; c++) { const n = rows.reduce((t, r) => t + (isNo(r[c]) ? 1 : 0), 0); if (n > best) { best = n; nameCol = c; } }
  if (nameCol < 0) return null;
  const first = rows.findIndex(r => isNo(r[nameCol]));
  const hi = (() => { for (let i = first - 1; i >= 0; i--) if (rows[i].filter(x => String(x || "").trim()).length >= 3) return i; return -1; })();
  const H = hi >= 0 ? rows[hi].map(h => norm(h)) : [];
  const col = (...res) => { for (const re of res) { const i = H.findIndex(h => re.test(h)); if (i >= 0) return i; } return -1; };
  const C = { status: col(/^status/), account: col(/^account/, /^tenant$/, /tenant name/), type: col(/type of violation/, /record type/, /^type/, /category/), created: col(/created date/, /^date$/),
    desc: col(/description/, /details/, /^body$/, /tenant comments/), subject: col(/subject/, /contractor name/), branch: col(/branch/, /business unit/, /flagship/), days: col(/days since/, /^age$/),
    link: col(/link/, /url/), id: col(/record id/, /^id$/, /18 digit/, /15 digit/),
    from: col(/valid from/, /date from/, /start/), to: col(/valid to/, /date to/, /^end/), phone: col(/mobile/, /phone/), permit: col(/work permit/), abc: col(/abc comments/) };
  const out = [];
  let status = "";
  for (const r of rows.slice(first)) {
    if (C.status >= 0 && String(r[C.status] || "").trim() && !/^total$/i.test(String(r[C.status]).trim())) status = String(r[C.status]);   // grouped reports: the status is only on the first row of each group
    const no = String(r[nameCol] || "").trim().toUpperCase();
    if (!isNo(no)) continue;
    const linkV = C.link >= 0 ? String(r[C.link] || "").trim() : (r.find(x => /^https:\/\//i.test(String(x || ""))) || "");
    const idV = C.id >= 0 ? String(r[C.id] || "").trim() : "";
    const cell = k => C[k] >= 0 ? r[C[k]] : "";
    out.push({ name: no, kind: KIND_OF[no.split("-")[0]], status: cleanStatus(status), account: clip(r[C.account], 160), type: cleanType(C.type >= 0 ? r[C.type] : ""),
      created: C.created >= 0 ? toDay(r[C.created]) : "", desc: clip(C.desc >= 0 ? r[C.desc] : "", 600), subject: clip(C.subject >= 0 ? r[C.subject] : "", 200),
      branch: clip(C.branch >= 0 ? r[C.branch] : "", 80), days: C.days >= 0 && r[C.days] !== "" && r[C.days] != null ? Math.round(Number(r[C.days])) || 0 : null,
      link: /^https:\/\/[\w.-]+\.(my\.site\.com|force\.com|salesforce\.com)\//i.test(linkV) ? clip(linkV, 400) : "",
      sfId: /^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$/.test(idV) ? idV : "",
      from: toDT(cell("from")), to: toDT(cell("to")), phone: clip(cell("phone"), 30), permit: clip(cell("permit"), 10), abc: clip(cell("abc"), 400) });
  }
  return out.length ? out : null;
}

/* ---------- the Active Users report (portal users): Username + Last Login columns ---------- */
export function parseUsers(rows) {
  const hi = rows.findIndex(r => r.some(h => /^username$/i.test(String(h || "").trim())) && r.some(h => /last login/i.test(String(h || ""))));
  if (hi < 0) return null;
  const H = rows[hi].map(h => norm(h)), col = (...res) => { for (const re of res) { const i = H.findIndex(h => re.test(h)); if (i >= 0) return i; } return -1; };
  const C = { user: col(/^username$/), first: col(/first name/), last: col(/last name/), title: col(/^title$/), company: col(/company/), account: col(/^account/), branch: col(/branch/),
    profile: col(/^profile$/), login: col(/last login/), created: col(/created date/), active: col(/^active$/) };
  const v = (r, k) => C[k] >= 0 ? r[C[k]] : "";
  const out = [];
  for (const r of rows.slice(hi + 1)) {
    const u = clip(v(r, "user"), 120).toLowerCase(); if (!/@/.test(u)) continue;
    if (C.active >= 0 && /^(0|false|no)$/i.test(String(v(r, "active")).trim())) continue;
    out.push({ username: u, first: clip(v(r, "first"), 60), last: clip(v(r, "last"), 60), title: clip(v(r, "title"), 80), company: clip(v(r, "company"), 120),
      account: clip(v(r, "account"), 160), branch: clip(v(r, "branch"), 80), profile: clip(v(r, "profile"), 80), login: toDT(v(r, "login")), created: toDT(v(r, "created")) });
  }
  return out.length ? out : null;
}
async function importUsers(env, d, users, now) {
  const prev = new Map(((await env.DB.prepare("SELECT username, active FROM portal_users").all()).results || []).map(r => [r.username, r]));
  const ops = [], seen = new Set(); let added = 0;
  for (const u of users) {
    if (seen.has(u.username)) continue; seen.add(u.username);
    const p = prev.get(u.username); if (!p || !p.active) added++;
    const site = u.branch || u.account ? siteOf(u.branch, u.account, d.SITES) : "";
    ops.push(env.DB.prepare(`INSERT INTO portal_users (username, first, last, title, company, account, site, profile, last_login, created, active, first_seen, last_seen) VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?)
      ON CONFLICT(username) DO UPDATE SET first=excluded.first, last=excluded.last, title=excluded.title, company=excluded.company, account=excluded.account, site=excluded.site,
      profile=excluded.profile, last_login=excluded.last_login, created=excluded.created, active=1, last_seen=excluded.last_seen`)
      .bind(u.username, u.first, u.last, u.title, u.company, site ? tenantOf(u.account, d.SITES[site]) : u.account, site, u.profile, u.login, u.created, now, now));
  }
  const gone = [...prev.values()].filter(p => p.active && !seen.has(p.username));
  for (const g of gone) ops.push(env.DB.prepare("UPDATE portal_users SET active = 0, last_seen = ? WHERE username = ?").bind(now, g.username));
  for (let i = 0; i < ops.length; i += 150) await env.DB.batch(ops.slice(i, i + 150));
  return { added, gone: gone.length, rows: seen.size };
}

/* ---------- import: one or more report files (email attachments or uploaded on the page) ---------- */
const FP = x => [x.status, x.account, x.type, x.created, x.days, x.subject, x.desc, x.link, x.sfId, x.from, x.to, x.phone, x.permit, x.abc, x.site].join("\u0001");
export async function portalImport(env, d, { files, from }) {
  const res = [], now = d.now();
  for (const f of files.slice(0, 10)) {
    let rows; try { rows = await readSheet(f.name, f.data); } catch (e) { res.push({ file: f.name, error: e.message }); continue; }
    const users = parseUsers(rows);
    if (users) {
      const u = await importUsers(env, d, users, now);
      await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)").bind("portal:last:users", JSON.stringify({ at: now, from, file: f.name, rows: u.rows })).run();
      res.push({ file: f.name, kinds: ["Portal Users"], rows: u.rows, added: u.added, changed: 0, gone: u.gone, unknown: [] });
      continue;
    }
    const items = parseReport(rows);
    if (!items) { res.push({ file: f.name, error: "No Breach (BP-), Violation (VR-), Request (NR-), Marketing (MKT-) or Permit (CP-) numbers, and not the Active Users report" }); continue; }
    const unknown = new Set(), seen = new Map();
    /* no Branch and no flagship in the account name ("SOCKS"): the GLA decides when the brand is at one flagship only */
    let gla = null;
    const byBrand = async acc => {
      if (!gla) { gla = new Map(); for (const u of ((await env.DB.prepare("SELECT site, brand FROM gla_units WHERE active = 1 AND brand <> ''").all().catch(() => ({ results: [] }))).results || [])) { const k = norm(u.brand); gla.set(k, (gla.get(k) || new Set()).add(u.site)); } }
      const g = gla.get(norm(acc)); return g && g.size === 1 ? [...g][0] : "";
    };
    for (const it of items) {
      let site = siteOf(it.branch, it.account, d.SITES);
      if (!site && !it.branch && it.account) site = await byBrand(it.account);
      if (!site && it.kind === "cp" && !it.branch && !it.account) site = ALL_SITES;   // the permits report has no flagship column yet
      if (!site) { unknown.add(it.branch || it.account || it.name); continue; }
      seen.set(it.name, { ...it, site, tenant: site === ALL_SITES ? "" : tenantOf(it.account, d.SITES[site]) });
    }
    const kinds = new Set([...seen.values()].map(x => x.kind)), sites = new Set([...seen.values()].map(x => x.site));
    const prev = new Map();
    const inScope = new Set([...sites, ALL_SITES]);   // one read per report type (few queries per email: D1 limits)
    for (const k of kinds) {
      const { results } = await env.DB.prepare("SELECT name, site, status, active, fp FROM portal_items WHERE kind = ?").bind(k).all();
      for (const r of results || []) if (inScope.has(r.site) || seen.has(r.name)) prev.set(r.name, r);
    }
    /* "Resolved / Unresolved Violations" is a part of the full Violations & Requests report: update its items, don't drop the others */
    const vrSt = new Set([...seen.values()].filter(x => x.kind === "vr").map(x => x.status));
    const partial = kinds.has("vr") && (/resolved.?unresolved/i.test(f.name) || (![...vrSt].some(t => /^(closed|created)/i.test(t)) && [...prev.values()].some(p => p.active && /^closed/i.test(p.status))));
    const ops = []; let added = 0, changed = 0;
    for (const x of seen.values()) {
      const p = prev.get(x.name), fp = FP(x);
      if (!p || !p.active) added++; else if (p.status !== x.status) changed++;
      if (p && p.active && p.fp === fp) continue;   // nothing changed: only last_seen (below, in one statement)
      const since = !p || p.status !== x.status || !p.active ? now : null;
      ops.push(env.DB.prepare(`INSERT INTO portal_items (name, kind, site, account, tenant, type, status, created_day, days, subject, description, link, sf_id, active, first_seen, last_seen, left_at, status_since,
          valid_from, valid_to, phone, permit, abc_note, fp)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,'',?,?,?,?,?,?,?) ON CONFLICT(name) DO UPDATE SET kind=excluded.kind, site=excluded.site, account=excluded.account, tenant=excluded.tenant,
        type=excluded.type, status=excluded.status, created_day=CASE WHEN excluded.created_day != '' THEN excluded.created_day ELSE portal_items.created_day END, days=excluded.days,
        subject=CASE WHEN excluded.subject != '' THEN excluded.subject ELSE portal_items.subject END, description=CASE WHEN excluded.description != '' THEN excluded.description ELSE portal_items.description END,
        link=CASE WHEN excluded.link != '' THEN excluded.link ELSE portal_items.link END, sf_id=CASE WHEN excluded.sf_id != '' THEN excluded.sf_id ELSE portal_items.sf_id END,
        valid_from=excluded.valid_from, valid_to=excluded.valid_to, phone=excluded.phone, permit=excluded.permit, abc_note=excluded.abc_note, fp=excluded.fp,
        active=1, last_seen=excluded.last_seen, left_at='', status_since=COALESCE(?, portal_items.status_since)`)
        .bind(x.name, x.kind, x.site, x.account, x.tenant, x.type, x.status, x.created, x.days, x.subject, x.desc, x.link, x.sfId, now, now, since || now, x.from, x.to, x.phone, x.permit, x.abc, fp, since));
    }
    /* items of this report and flagship that are no longer in it (a partial report never removes) */
    const gone = partial ? [] : [...prev.values()].filter(p => p.active && !seen.has(p.name)).map(p => p.name);
    for (const n of gone) ops.push(env.DB.prepare("UPDATE portal_items SET active = 0, left_at = ? WHERE name = ?").bind(now, n));
    for (const k of kinds) for (const s of sites) ops.push(env.DB.prepare("UPDATE portal_items SET last_seen = ? WHERE kind = ? AND site = ? AND active = 1").bind(now, k, s));
    if (!partial) for (const k of kinds) ops.push(env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)").bind("portal:last:" + k,
      JSON.stringify({ at: now, from, file: f.name, rows: [...seen.values()].filter(x => x.kind === k).length, sites: [...sites] })));
    for (let i = 0; i < ops.length; i += 150) await env.DB.batch(ops.slice(i, i + 150));
    res.push({ file: f.name, kinds: [...kinds].map(k => KINDS[k].label + (partial ? " (details only)" : "")), rows: seen.size, added, changed, gone: gone.length, unknown: [...unknown].slice(0, 5), partial });
  }
  if (!res.some(r => r.rows)) throw err(res.map(r => `${r.file}: ${r.error}`).join(" · ") || "No report found in the attachment");
  return { files: res };
}

/* the button: the record link from the report when IT adds it, else the portal search for the number */
/* record pages of the ABC Connect employee portal (from real links, Oct 2026):
     …/s/breach-penalties/a08a3000003aZ2OAAU/bp000030 · …/s/violations-requests/<id>/vr000390 · …/s/normal-requests/<id>/nr000242 */
const RECORD_PATH = { bp: "breach-penalties", vr: "violations-requests", nr: "normal-requests" };
const slugOf = name => String(name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
export const linkOf = (env, r) => r.link || (r.sf_id && RECORD_PATH[r.kind] ? `${PORTAL(env)}/${RECORD_PATH[r.kind]}/${r.sf_id}/${slugOf(r.name)}`
  : `${PORTAL(env)}/global-search/${encodeURIComponent(r.name)}`);
const amountOf = t => { const m = String(t || "").match(/\$\s?(\d[\d,]*(?:\.\d+)?)|(\d[\d,]*(?:\.\d+)?)\s?(?:\$|usd\b|dollars?\b)/i); return m ? Number((m[1] || m[2]).replace(/,/g, "")) || null : null; };

/* ---------- routes: /api/ops/portal/* ---------- */
export async function portalRoute(env, p, method, b, url, d) {
  const { me } = d;
  const team = s => d.canSite(me, s) && (d.full(me) || (me.role === "SUPERVISOR" && me.position !== "WH") || me.role === "MANAGER");
  if (p === "portal/data") {
    const want = String(url.searchParams.get("site") || "").toUpperCase();
    const sites = d.sitesOf(me).filter(s => d.canSite(me, s));
    const list = want === "ALL" && sites.length > 1 ? sites : [sites.includes(want) ? want : (sites.includes(me.site_code) ? me.site_code : sites[0])].filter(Boolean);
    if (!list.length) throw err("No flagship", 403);
    const qs = list.map(() => "?").join(",");
    const [{ results }, gone] = await Promise.all([
      env.DB.prepare(`SELECT * FROM portal_items WHERE active = 1 AND (site IN (${qs}) OR site = '*') ORDER BY kind, name`).bind(...list).all(),
      env.DB.prepare(`SELECT name, kind, site, tenant, status, left_at FROM portal_items WHERE active = 0 AND site IN (${qs}) AND left_at >= ? ORDER BY left_at DESC LIMIT 40`)
        .bind(...list, new Date(Date.now() - 14 * 864e5).toISOString()).all()
    ]);
    const today = d.today();
    const age = r => r.created_day ? Math.max(0, Math.round((Date.parse(today) - Date.parse(r.created_day)) / 864e5)) : r.days != null ? r.days
      : r.first_seen ? Math.max(0, Math.round((Date.now() - Date.parse(r.first_seen)) / 864e5)) : null;
    const last = {};
    for (const k of [...Object.keys(KINDS), "users"]) { const r = await env.DB.prepare("SELECT v FROM meta WHERE k = ?").bind("portal:last:" + k).first(); last[k] = r ? JSON.parse(r.v) : null; }
    return { sites: list, all: want === "ALL" && list.length > 1, siteNames: Object.fromEntries(list.map(s => [s, d.SITES[s]])), kinds: KINDS, last, today,
      can: { import: list.some(team), users: d.full(me) }, linked: (results || []).some(r => r.link || r.sf_id),
      items: (results || []).map(r => ({ name: r.name, kind: r.kind, site: r.site, tenant: r.tenant, account: r.account, type: r.type, status: r.status, created: r.created_day,
        age: age(r), subject: r.subject, desc: r.description, amount: r.kind === "bp" ? amountOf(r.description) : null, followUp: isFollowUp(r.status),
        statusSince: r.status_since, firstSeen: r.first_seen, url: linkOf(env, r), direct: !!(r.link || r.sf_id),
        from: r.valid_from || "", to: r.valid_to || "", phone: r.phone || "", permit: r.permit || "", abc: r.abc_note || "", allSites: r.site === ALL_SITES })),
      left: (gone.results || []).map(r => ({ name: r.name, kind: r.kind, site: r.site, tenant: r.tenant, status: r.status, at: r.left_at })) };
  }
  /* Portal Users — managers and leadership only (names and emails) */
  if (p === "portal/users") {
    if (!d.full(me)) throw err("Portal users are for managers and leadership", 403);
    const { results } = await env.DB.prepare("SELECT username, first, last, title, company, account, site, last_login, created FROM portal_users WHERE active = 1 ORDER BY last_login DESC").all();
    const r = await env.DB.prepare("SELECT v FROM meta WHERE k = 'portal:last:users'").first();
    return { today: d.today(), last: r ? JSON.parse(r.v) : null, siteNames: d.SITES,
      users: (results || []).map(u => ({ user: u.username, name: [u.first, u.last].filter(Boolean).join(" "), title: u.title, company: u.company || u.account, site: u.site, login: u.last_login, created: u.created })) };
  }
  if (p === "portal/import" && method === "POST") {
    const site = d.sitesOf(me).find(team);
    if (!site) throw err("Only the flagship team can import portal reports", 403);
    const files = (Array.isArray(b.files) ? b.files : []).filter(f => f && f.name && f.data).slice(0, 10);
    if (!files.length) throw err("Choose the report file(s)");
    const r = await portalImport(env, d, { files, from: me.full_name });
    if (d.audit) await d.audit(env, { tool: "portal", ref: "import", label: files.map(f => f.name).join(", ").slice(0, 200), action: "import", changes: [] }).catch(() => {});
    return r;
  }
  throw err("Unknown request", 404);
}
