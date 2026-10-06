/* =====================================================================
   TENANT PORTAL FOLLOW-UP — Breaches & Penalties · Violations · ABC Requests (Normal Requests)
   The Salesforce (Tenant Connect / ABC Connect) reports arrive by email (…+portal-<TAG>@gmail.com,
   or uploaded by hand on the page) and are kept here as a snapshot per report and flagship:
   an item that is no longer in the next report is marked as left (resolved / filtered out).
   The dashboard shows the follow-ups still "Sent to Tenant", the figures per status / type / tenant,
   and a button that opens each item in the portal. See docs/FEATURE-portal-followup.md
   ===================================================================== */
import { readSheet } from "./sheetread.js";

const err = (m, status = 400) => Object.assign(new Error(m), { status });
const clip = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
const norm = s => String(s || "").toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, " ").trim();

/* the three reports, told apart by the item number (BP-000096 · VR-000040 · NR-000242) */
export const KINDS = {
  bp: { prefix: "BP", label: "Breaches & Penalties" },
  vr: { prefix: "VR", label: "Violations" },
  nr: { prefix: "NR", label: "ABC Requests" }
};
const KIND_OF = { BP: "bp", VR: "vr", NR: "nr" };
const PORTAL = env => String(env.PORTAL_URL || "https://abclebanon.my.site.com/abcemployee/s").replace(/\/+$/, "");

export async function portalSchema(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS portal_items (name TEXT PRIMARY KEY, kind TEXT NOT NULL, site TEXT NOT NULL, account TEXT NOT NULL DEFAULT '',
      tenant TEXT NOT NULL DEFAULT '', type TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT '', created_day TEXT NOT NULL DEFAULT '', days INTEGER,
      subject TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', link TEXT NOT NULL DEFAULT '', sf_id TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1, first_seen TEXT NOT NULL DEFAULT '', last_seen TEXT NOT NULL DEFAULT '', left_at TEXT NOT NULL DEFAULT '',
      status_since TEXT NOT NULL DEFAULT '')`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS portal_items_site ON portal_items (site, kind, active)`)
  ]);
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
function siteOf(branch, account, SITES) {
  const b = norm(branch);
  for (const [c, n] of Object.entries(SITES)) if (b && norm(n) === b) return c;
  for (const [c, n] of Object.entries(SITES)) if (b && (b.includes(norm(n)) || norm(n).includes(b))) return c;
  const a = norm(account);
  const hit = Object.entries(SITES).sort((x, y) => y[1].length - x[1].length).find(([, n]) => a.endsWith(norm(n)));
  return hit ? hit[0] : "";
}
const tenantOf = (account, siteName) => (String(account || "").replace(new RegExp("\\s*" + siteName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*$", "i"), "")
  .replace(/''/g, "'").replace(/\s+/g, " ").trim()) || String(account || "").trim();

/* ---------- read one Salesforce report (grouped or not) into items ---------- */
export function parseReport(rows) {
  const isNo = v => /^(BP|VR|NR)-\d{3,}$/i.test(String(v || "").trim());
  /* the item-number column: the one where most cells are BP-/VR-/NR- numbers */
  let nameCol = -1, best = 0;
  const width = Math.max(0, ...rows.map(r => r.length));
  for (let c = 0; c < width; c++) { const n = rows.reduce((t, r) => t + (isNo(r[c]) ? 1 : 0), 0); if (n > best) { best = n; nameCol = c; } }
  if (nameCol < 0) return null;
  const first = rows.findIndex(r => isNo(r[nameCol]));
  const hi = (() => { for (let i = first - 1; i >= 0; i--) if (rows[i].filter(x => String(x || "").trim()).length >= 3) return i; return -1; })();
  const H = hi >= 0 ? rows[hi].map(h => norm(h)) : [];
  const col = (...res) => { for (const re of res) { const i = H.findIndex(h => re.test(h)); if (i >= 0) return i; } return -1; };
  const C = { status: col(/^status/), account: col(/^account/, /tenant/), type: col(/type of violation/, /^type/, /category/), created: col(/created date/, /^date$/, /date/),
    desc: col(/description/, /details/), subject: col(/subject/), branch: col(/branch/, /business unit/, /flagship/), days: col(/days since/, /age/),
    link: col(/link/, /url/), id: col(/record id/, /^id$/, /18 digit/, /15 digit/) };
  const out = [];
  let status = "";
  for (const r of rows.slice(first)) {
    if (C.status >= 0 && String(r[C.status] || "").trim() && !/^total$/i.test(String(r[C.status]).trim())) status = String(r[C.status]);   // grouped reports: the status is only on the first row of each group
    const no = String(r[nameCol] || "").trim().toUpperCase();
    if (!isNo(no)) continue;
    const linkV = C.link >= 0 ? String(r[C.link] || "").trim() : (r.find(x => /^https:\/\//i.test(String(x || ""))) || "");
    const idV = C.id >= 0 ? String(r[C.id] || "").trim() : "";
    out.push({ name: no, kind: KIND_OF[no.slice(0, 2)], status: cleanStatus(status), account: clip(r[C.account], 160), type: cleanType(C.type >= 0 ? r[C.type] : ""),
      created: C.created >= 0 ? toDay(r[C.created]) : "", desc: clip(C.desc >= 0 ? r[C.desc] : "", 600), subject: clip(C.subject >= 0 ? r[C.subject] : "", 200),
      branch: clip(C.branch >= 0 ? r[C.branch] : "", 80), days: C.days >= 0 && r[C.days] !== "" && r[C.days] != null ? Math.round(Number(r[C.days])) || 0 : null,
      link: /^https:\/\/[\w.-]+\.(my\.site\.com|force\.com|salesforce\.com)\//i.test(linkV) ? clip(linkV, 400) : "",
      sfId: /^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$/.test(idV) ? idV : "" });
  }
  return out.length ? out : null;
}

/* ---------- import: one or more report files (email attachments or uploaded on the page) ---------- */
export async function portalImport(env, d, { files, from }) {
  const res = [], now = d.now();
  for (const f of files.slice(0, 6)) {
    let rows; try { rows = await readSheet(f.name, f.data); } catch (e) { res.push({ file: f.name, error: e.message }); continue; }
    const items = parseReport(rows);
    if (!items) { res.push({ file: f.name, error: "No Breach (BP-), Violation (VR-) or Request (NR-) numbers found" }); continue; }
    const unknown = new Set(), seen = new Map();
    for (const it of items) {
      const site = siteOf(it.branch, it.account, d.SITES);
      if (!site) { unknown.add(it.branch || it.account); continue; }
      seen.set(it.name, { ...it, site, tenant: tenantOf(it.account, d.SITES[site]) });
    }
    const kinds = new Set([...seen.values()].map(x => x.kind)), sites = new Set([...seen.values()].map(x => x.site));
    const prev = new Map();
    for (const k of kinds) for (const s of sites) {
      const { results } = await env.DB.prepare("SELECT name, status, active FROM portal_items WHERE kind = ? AND site = ?").bind(k, s).all();
      for (const r of results || []) prev.set(r.name, r);
    }
    const ops = []; let added = 0, changed = 0;
    for (const x of seen.values()) {
      const p = prev.get(x.name);
      if (!p || !p.active) added++; else if (p.status !== x.status) changed++;
      const since = !p || p.status !== x.status || !p.active ? now : null;
      ops.push(env.DB.prepare(`INSERT INTO portal_items (name, kind, site, account, tenant, type, status, created_day, days, subject, description, link, sf_id, active, first_seen, last_seen, left_at, status_since)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,'',?) ON CONFLICT(name) DO UPDATE SET kind=excluded.kind, site=excluded.site, account=excluded.account, tenant=excluded.tenant,
        type=excluded.type, status=excluded.status, created_day=CASE WHEN excluded.created_day != '' THEN excluded.created_day ELSE portal_items.created_day END, days=excluded.days,
        subject=CASE WHEN excluded.subject != '' THEN excluded.subject ELSE portal_items.subject END, description=CASE WHEN excluded.description != '' THEN excluded.description ELSE portal_items.description END,
        link=CASE WHEN excluded.link != '' THEN excluded.link ELSE portal_items.link END, sf_id=CASE WHEN excluded.sf_id != '' THEN excluded.sf_id ELSE portal_items.sf_id END,
        active=1, last_seen=excluded.last_seen, left_at='', status_since=COALESCE(?, portal_items.status_since)`)
        .bind(x.name, x.kind, x.site, x.account, x.tenant, x.type, x.status, x.created, x.days, x.subject, x.desc, x.link, x.sfId, now, now, since || now, since));
    }
    /* items of this report and flagship that are no longer in it */
    const gone = [...prev.values()].filter(p => p.active && !seen.has(p.name)).map(p => p.name);
    for (const n of gone) ops.push(env.DB.prepare("UPDATE portal_items SET active = 0, left_at = ? WHERE name = ?").bind(now, n));
    for (let i = 0; i < ops.length; i += 80) await env.DB.batch(ops.slice(i, i + 80));
    for (const k of kinds) await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)").bind("portal:last:" + k,
      JSON.stringify({ at: now, from, file: f.name, rows: [...seen.values()].filter(x => x.kind === k).length, sites: [...sites] })).run();
    res.push({ file: f.name, kinds: [...kinds].map(k => KINDS[k].label), rows: seen.size, added, changed, gone: gone.length, unknown: [...unknown].slice(0, 5) });
  }
  if (!res.some(r => r.rows)) throw err(res.map(r => `${r.file}: ${r.error}`).join(" · ") || "No report found in the attachment");
  return { files: res };
}

/* the button: the record link from the report when IT adds it, else the portal search for the number */
const linkOf = (env, r) => r.link || (r.sf_id ? `${PORTAL(env)}/detail/${r.sf_id}` : `${PORTAL(env)}/global-search/${encodeURIComponent(r.name)}`);
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
      env.DB.prepare(`SELECT * FROM portal_items WHERE active = 1 AND site IN (${qs}) ORDER BY kind, name`).bind(...list).all(),
      env.DB.prepare(`SELECT name, kind, site, tenant, status, left_at FROM portal_items WHERE active = 0 AND site IN (${qs}) AND left_at >= ? ORDER BY left_at DESC LIMIT 40`)
        .bind(...list, new Date(Date.now() - 14 * 864e5).toISOString()).all()
    ]);
    const today = d.today();
    const age = r => r.created_day ? Math.max(0, Math.round((Date.parse(today) - Date.parse(r.created_day)) / 864e5)) : r.days != null ? r.days
      : r.first_seen ? Math.max(0, Math.round((Date.now() - Date.parse(r.first_seen)) / 864e5)) : null;
    const last = {};
    for (const k of Object.keys(KINDS)) { const r = await env.DB.prepare("SELECT v FROM meta WHERE k = ?").bind("portal:last:" + k).first(); last[k] = r ? JSON.parse(r.v) : null; }
    return { sites: list, all: want === "ALL" && list.length > 1, siteNames: Object.fromEntries(list.map(s => [s, d.SITES[s]])), kinds: KINDS, last, today,
      can: { import: list.some(team) }, linked: (results || []).some(r => r.link || r.sf_id),
      items: (results || []).map(r => ({ name: r.name, kind: r.kind, site: r.site, tenant: r.tenant, account: r.account, type: r.type, status: r.status, created: r.created_day,
        age: age(r), subject: r.subject, desc: r.description, amount: r.kind === "bp" ? amountOf(r.description) : null, followUp: isFollowUp(r.status),
        statusSince: r.status_since, firstSeen: r.first_seen, url: linkOf(env, r), direct: !!(r.link || r.sf_id) })),
      left: (gone.results || []).map(r => ({ name: r.name, kind: r.kind, site: r.site, tenant: r.tenant, status: r.status, at: r.left_at })) };
  }
  if (p === "portal/import" && method === "POST") {
    const site = d.sitesOf(me).find(team);
    if (!site) throw err("Only the flagship team can import portal reports", 403);
    const files = (Array.isArray(b.files) ? b.files : []).filter(f => f && f.name && f.data).slice(0, 6);
    if (!files.length) throw err("Choose the report file(s)");
    const r = await portalImport(env, d, { files, from: me.full_name });
    if (d.audit) await d.audit(env, { tool: "portal", ref: "import", label: files.map(f => f.name).join(", ").slice(0, 200), action: "import", changes: [] }).catch(() => {});
    return r;
  }
  throw err("Unknown request", 404);
}
