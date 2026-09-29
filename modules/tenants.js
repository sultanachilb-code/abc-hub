/* =====================================================================
   TENANT MANAGEMENT — feature module (kept separate so it can be removed cleanly)
   See docs/FEATURE-tenant-management.md

   • Announcements ... Tenant Opening / Closure / Relocation emails, one format per type, customised per flagship,
                       recipients filled from the directory (by position), photos attached. Can update the GLA at the same time.
   • Recipients ...... the directory: each position once, "all flagships" or "this flagship only" (Admins edit)
   • Compliance ...... repeat offenders (same violation in the month) and a monthly compliance score per tenant
   • Fit-out ......... milestones from Reserved to Open for every unit in fit-out

   Tables : tm_recipients · tm_announcements · fitout_tracks
   Routes : /api/ops/tm/*  ·  /api/ops/compliance  ·  /api/ops/fitout*
   ===================================================================== */

const err = (m, status = 400) => Object.assign(new Error(m), { status });
const clip = (v, n) => String(v == null ? "" : v).slice(0, n);
const isDay = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));
const SITES5 = ["VRM", "ACM", "DBS", "VRS", "ACS"];
export const FLAG_SHORT = { VRM: "ABC Verdun", ACM: "ABC Achrafieh", DBS: "ABC Dbayeh", VRS: "ABC Verdun DS", ACS: "ABC Achrafieh DS" };
const TYPES = { open: "Tenant Opening", close: "Tenant Closure", reloc: "Tenant Relocation" };

/* The directory, in the order the positions are listed in the Cc line.
   scope "all" = the same addresses for every flagship · "site" = each flagship has its own */
const POSITIONS = [
  ["to_cs", "Customer service (this flagship)", "to", "site"],
  ["to_cc", "Call center (all flagships)", "to", "all"],
  ["ceo", "Verdun Mall CEO", "cc", "all"],
  ["cctv", "CCTV (this flagship)", "cc", "site"],
  ["tech", "Technical team (this flagship)", "cc", "site"],
  ["ops_all", "Operations — all flagships (5)", "cc", "all"],
  ["ops_adv", "Operations advisor", "cc", "all"],
  ["mall_mgr", "Mall manager (this flagship)", "cc", "site"],
  ["concept", "Concept designs manager + team (2)", "cc", "all"],
  ["rdms", "RDMs (4)", "cc", "all"],
  ["cfo", "CFO", "cc", "all"],
  ["digital", "Head of digital transformation", "cc", "all"],
  ["prop_mgr", "Property managers (5)", "cc", "all"],
  ["cdso", "Chief Department Store Operations Officer", "cc", "all"],
  ["it", "Head of IT", "cc", "all"],
  ["dom", "Deputy operations managers / operations managers (3)", "cc", "all"],
  ["head_tech", "Head of technical", "cc", "all"],
  ["retailers", "ABC retailers (3 flagships)", "cc", "all"],
  ["logistics", "Logistics managers", "cc", "all"],
  ["sars", "SARs managers", "cc", "all"],
  ["marketing", "Marketing manager + marketing team + CMO", "cc", "all"],
  ["safety", "Safety team (this flagship)", "cc", "site"],
  ["soft", "Soft services — Liban Park, cleaning company, security (this flagship)", "cc", "site"],
  ["head_sec", "Head of security", "cc", "all"],
  ["architects", "Retail architects", "cc", "all"],
  ["hr", "HR ABC", "cc", "all"],
  ["head_hr", "Head of HR", "cc", "all"],
  ["advisors", "Advisors (3)", "cc", "all"]
];
const PHONES = { VRM: "81/221500", ACM: "81221400" };   // Operations on duty — editable in the directory

export async function tenantsSchema(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS tm_recipients (k TEXT PRIMARY KEY, label TEXT NOT NULL, field TEXT NOT NULL DEFAULT 'cc',
      scope TEXT NOT NULL DEFAULT 'all', emails TEXT NOT NULL DEFAULT '{}', seq INTEGER NOT NULL DEFAULT 0, updated_by TEXT, updated_at TEXT)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS tm_announcements (id INTEGER PRIMARY KEY AUTOINCREMENT, site TEXT NOT NULL, type TEXT NOT NULL,
      brand TEXT NOT NULL, unit_id INTEGER, unit TEXT NOT NULL DEFAULT '', level TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT '',
      eff_date TEXT NOT NULL, data TEXT NOT NULL DEFAULT '{}', thumbs TEXT NOT NULL DEFAULT '[]', subject TEXT NOT NULL DEFAULT '',
      gla TEXT NOT NULL DEFAULT '', created_by TEXT, created_name TEXT, created_at TEXT)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS tm_ann_site ON tm_announcements (site, eff_date)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS fitout_tracks (site TEXT NOT NULL, unit_id INTEGER NOT NULL, brand TEXT NOT NULL DEFAULT '',
      target TEXT NOT NULL DEFAULT '', ms TEXT NOT NULL DEFAULT '{}', updated_by TEXT, updated_at TEXT, PRIMARY KEY (site, unit_id))`)
  ]);
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM tm_recipients").first();
  if (!Number(n.n)) await env.DB.batch([
    ...POSITIONS.map(([k, label, field, scope], i) => env.DB.prepare("INSERT OR IGNORE INTO tm_recipients (k, label, field, scope, emails, seq) VALUES (?,?,?,?,?,?)")
      .bind(k, label, field, scope, "{}", (i + 1) * 10)),
    env.DB.prepare("INSERT OR IGNORE INTO tm_recipients (k, label, field, scope, emails, seq) VALUES ('_phone', 'Operations on duty — phone in the email', 'phone', 'site', ?, 0)")
      .bind(JSON.stringify(PHONES))
  ]);
}

const splitMails = s => String(s || "").split(/[\s,;]+/).map(x => x.trim()).filter(x => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(x));
async function directory(env) {
  const { results } = await env.DB.prepare("SELECT * FROM tm_recipients ORDER BY seq, k").all();
  return (results || []).map(r => ({ k: r.k, label: r.label, field: r.field, scope: r.scope, emails: JSON.parse(r.emails || "{}"), seq: r.seq }));
}
/* To / Cc for one flagship, in directory order, no duplicates */
function resolve(dir, site) {
  const to = [], cc = [], missing = [], seen = new Set();
  let phone = "";
  for (const r of dir) {
    const raw = r.scope === "site" ? r.emails[site] : r.emails.ALL;
    if (r.field === "phone") { phone = String(raw || "").trim(); continue; }
    const list = splitMails(raw).filter(e => !seen.has(e.toLowerCase()));
    list.forEach(e => seen.add(e.toLowerCase()));
    if (!list.length) missing.push(r.label);
    (r.field === "to" ? to : cc).push(...list);
  }
  return { to, cc, missing, phone };
}

/* ---------- GLA change made by an announcement (same record keeping as GLA & Occupancy) ---------- */
async function glaChange(env, site, unitId, patch, eff, note, me, now, raiseEvent) {
  const cur = await env.DB.prepare("SELECT * FROM gla_units WHERE id = ? AND site = ? AND active = 1").bind(Number(unitId) || 0, site).first();
  if (!cur) return null;
  const next = { ...cur, ...patch };
  const before = {}, after = {};
  for (const k of ["brand", "status", "dept"]) if (String(cur[k] ?? "") !== String(next[k] ?? "")) { before[k] = cur[k]; after[k] = next[k]; }
  if (!Object.keys(after).length) return { unit: cur.code, changed: false };
  const at = now();
  await env.DB.batch([
    env.DB.prepare("UPDATE gla_units SET brand = ?, status = ?, dept = ?, updated_at = ?, updated_by = ? WHERE id = ?").bind(next.brand, next.status, next.dept, at, me.full_name, cur.id),
    env.DB.prepare(`INSERT INTO gla_events (site, unit_id, kind, eff_date, before, after, note, by_name, by_email, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .bind(site, cur.id, "update", eff, JSON.stringify(before), JSON.stringify(after), note, me.full_name, me.email, at)
  ]);
  if (raiseEvent && after.status) await raiseEvent(env, { site, app: "gla", tone: "info", title: `${next.brand || cur.brand || cur.code} · ${after.status}`,
    body: `${cur.level} ${cur.code} · effective ${eff} · from a tenant announcement by ${me.full_name}` });
  return { unit: cur.code, level: cur.level, changed: true, before, after };
}

/* ---------- compliance ---------- */
const PENALTY = { "Operations Violation": 10, "Safety Violation": 15, "Covid-19 Violation": 10, "Incident": 10 };
const ACTION_PENALTY = { "Written Warning": 5, "Legal Warning": 10, "Closed Temporarily": 15, "Employee Banned From Entry": 5 };
const LADDER = n => n >= 4 ? "Legal warning" : n === 3 ? "Written warning" : n === 2 ? "Verbal reminder" : "";
const monthBounds = m => { const [y, mo] = m.split("-").map(Number); const end = new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10); return [`${m}-01`, end]; };
const prevMonth = m => { let [y, mo] = m.split("-").map(Number); mo--; if (!mo) { mo = 12; y--; } return `${y}-${String(mo).padStart(2, "0")}`; };
const norm = s => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");

export async function complianceFor(env, site, month) {
  const [from, to] = monthBounds(month);
  const [cur, prev, active] = await Promise.all([
    env.DB.prepare("SELECT * FROM tenant_feedback WHERE site = ? AND day BETWEEN ? AND ? ORDER BY day, time").bind(site, from, to).all(),
    env.DB.prepare("SELECT tenant, category, description, action FROM tenant_feedback WHERE site = ? AND day BETWEEN ? AND ?").bind(site, ...monthBounds(prevMonth(month))).all(),
    env.DB.prepare("SELECT COUNT(DISTINCT brand) AS n FROM gla_units WHERE site = ? AND active = 1 AND status IN ('Open','Closed') AND section != 'DS' AND brand != ''").bind(site).first()
  ]);
  const score = rows => {
    const by = new Map();
    for (const e of rows) {
      const k = norm(e.tenant); if (!k) continue;
      const t = by.get(k) || { tenant: e.tenant, score: 100, violations: 0, positive: 0, negative: 0, entries: [], repeats: {} };
      if (e.category === "Customer Feedback") { if (e.description === "Positive") t.positive++; else { t.negative++; t.score -= 5; } }
      else { t.violations++; t.score -= PENALTY[e.category] || 10; const d = e.description || e.category; t.repeats[d] = (t.repeats[d] || 0) + 1; }
      t.score -= ACTION_PENALTY[e.action] || 0;
      t.entries.push({ day: e.day, time: e.time, category: e.category, description: e.description, action: e.action, by: e.created_name });
      by.set(k, t);
    }
    for (const t of by.values()) t.score = Math.max(0, t.score);
    return by;
  };
  const now = score(cur.results || []), before = score(prev.results || []);
  const tenants = [...now.values()].map(t => {
    const rep = Object.entries(t.repeats).filter(([, n]) => n >= 2).map(([what, n]) => ({ what, n, suggest: LADDER(n) }));
    const p = before.get(norm(t.tenant));
    return { tenant: t.tenant, score: t.score, prevScore: p ? p.score : 100, violations: t.violations, positive: t.positive, negative: t.negative,
      repeats: rep, entries: t.entries };
  }).sort((a, b) => a.score - b.score || b.violations - a.violations);
  const total = Math.max(Number(active && active.n || 0), tenants.length);
  const avg = total ? Math.round((tenants.reduce((s, t) => s + t.score, 0) + (total - tenants.length) * 100) / total) : 100;
  return { month, tenants, activeTenants: total, clean: total - tenants.filter(t => t.violations || t.negative).length, average: avg,
    repeatOffenders: tenants.filter(t => t.repeats.some(r => r.n >= 3)).length };
}
/* after a feedback entry is logged: the 3rd (and 5th) time the same violation happens in the month → alert the flagship */
export async function repeatCheck(env, site, e, raiseEvent, siteName) {
  if (!e || e.category === "Customer Feedback") return null;
  const [from, to] = monthBounds(e.day.slice(0, 7));
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM tenant_feedback WHERE site = ? AND LOWER(TRIM(tenant)) = ? AND category = ? AND description = ? AND day BETWEEN ? AND ?")
    .bind(site, norm(e.tenant), e.category, e.description || "", from, to).first();
  const n = Number(r && r.n || 0);
  if (n === 3 || n === 5) await raiseEvent(env, { site, app: "feedback", tone: "warn",
    title: `Repeat offender · ${e.tenant}`, body: `${siteName(site)} · ${n}${n === 3 ? "rd" : "th"} ${e.description || e.category} this month → consider a ${LADDER(Math.min(n, 4)).toLowerCase()}` });
  return n;
}

/* ---------- fit-out ---------- */
export const MILESTONES = [
  ["handover", "Unit handed over"], ["hoarding", "Hoarding installed"], ["works", "Fit-out works started"],
  ["inspection", "Final inspection"], ["checklist", "Opening checklist"], ["announcement", "Opening announced"], ["open", "Open"]
];
export async function fitoutFor(env, site) {
  const since = new Date(Date.now() - 45 * 864e5).toISOString().slice(0, 10);
  const [units, tracks, opened, forms, anns] = await Promise.all([
    env.DB.prepare("SELECT * FROM gla_units WHERE site = ? AND active = 1 AND status IN ('Reserved','Fit-out') ORDER BY status DESC, contract_start, level, code").bind(site).all(),
    env.DB.prepare("SELECT * FROM fitout_tracks WHERE site = ?").bind(site).all(),
    env.DB.prepare(`SELECT u.*, e.eff_date AS opened_on FROM gla_events e JOIN gla_units u ON u.id = e.unit_id
      WHERE e.site = ? AND e.eff_date >= ? AND u.status = 'Open' AND e.after LIKE '%"status":"Open"%' ORDER BY e.eff_date DESC`).bind(site, since).all(),
    env.DB.prepare("SELECT title, status, day FROM form_runs WHERE site = ? AND form = 'open'").bind(site).all().catch(() => ({ results: [] })),
    env.DB.prepare("SELECT brand, eff_date FROM tm_announcements WHERE site = ? AND type = 'open'").bind(site).all()
  ]);
  const T = new Map((tracks.results || []).map(t => [t.unit_id, t]));
  const seen = new Set(), list = [];
  const add = (u, openedOn) => {
    if (seen.has(u.id)) return; seen.add(u.id);
    const t = T.get(u.id), ms = t ? JSON.parse(t.ms || "{}") : {};
    const b = norm(u.brand);
    const ck = (forms.results || []).find(f => norm(f.title) === b);
    const an = (anns.results || []).find(a => norm(a.brand) === b);
    const auto = {
      checklist: ck ? { done: ck.status === "submitted", date: ck.day, auto: true, note: ck.status === "submitted" ? "Submitted" : "Started" } : null,
      announcement: an ? { done: true, date: an.eff_date, auto: true } : null,
      open: u.status === "Open" ? { done: true, date: openedOn || "", auto: true } : null
    };
    const m = {};
    for (const [k] of MILESTONES) m[k] = auto[k] || ms[k] || { done: false, date: "", note: "" };
    const done = MILESTONES.filter(([k]) => m[k].done).length;
    list.push({ unitId: u.id, brand: u.brand, level: u.level, code: u.code, area: u.area, dept: u.dept, status: u.status, contractStart: u.contract_start || "",
      target: t ? t.target : "", milestones: m, done, total: MILESTONES.length, openedOn: openedOn || "" });
  };
  (units.results || []).forEach(u => add(u));
  (opened.results || []).forEach(u => add(u, u.opened_on));
  return list;
}

/* ---------- routes ---------- */
/* ctx = { site, can, me, now, isAdmin, siteName, raiseEvent, today } */
export async function tenantsRoute(env, p, method, b, url, ctx) {
  const { site, can, me, now } = ctx;
  const q = k => url.searchParams.get(k);

  if (p === "tm/meta") {
    const dir = await directory(env);
    const { results } = await env.DB.prepare("SELECT id, level, code, brand, status, dept, area, section FROM gla_units WHERE site = ? AND active = 1 ORDER BY level, code").bind(site).all();
    return { site, siteName: ctx.siteName(site), flag: FLAG_SHORT[site] || `ABC ${ctx.siteName(site)}`, types: TYPES, recipients: resolve(dir, site),
      units: (results || []).filter(u => u.section !== "DS"), can: { send: !!can.gla, applyGla: !!can.gla, editDirectory: !!ctx.isAdmin }, me: { name: me.full_name, position: ctx.position || "" } };
  }
  if (p === "tm/recipients") {
    return { rows: await directory(env), sites: ctx.sites, can: { edit: !!ctx.isAdmin } };
  }
  if (p === "tm/recipients/save" && method === "POST") {
    if (!ctx.isAdmin) throw err("Only administrators can change the recipients", 403);
    const rows = Array.isArray(b.rows) ? b.rows.slice(0, 80) : [];
    const at = now(), ops = [];
    for (const [i, r] of rows.entries()) {
      const k = clip(r.k, 40).replace(/[^\w-]/g, "") || `pos_${Date.now().toString(36)}_${i}`;
      const field = ["to", "cc", "phone"].includes(r.field) ? r.field : "cc";
      const scope = r.scope === "site" ? "site" : "all";
      const emails = {};
      for (const [s, v] of Object.entries(r.emails || {})) if (s === "ALL" || SITES5.includes(s)) emails[s] = clip(v, 1500);
      const label = clip(r.label, 120).trim(); if (!label) continue;
      ops.push(env.DB.prepare(`INSERT INTO tm_recipients (k, label, field, scope, emails, seq, updated_by, updated_at) VALUES (?,?,?,?,?,?,?,?)
        ON CONFLICT(k) DO UPDATE SET label = excluded.label, field = excluded.field, scope = excluded.scope, emails = excluded.emails, seq = excluded.seq,
        updated_by = excluded.updated_by, updated_at = excluded.updated_at`).bind(k, label, field, scope, JSON.stringify(emails), field === "phone" ? 0 : (i + 1) * 10, me.full_name, at));
    }
    const keep = new Set(rows.map(r => r.k).filter(Boolean));
    const cur = await directory(env);
    for (const r of cur) if (!keep.has(r.k) && r.field !== "phone") ops.push(env.DB.prepare("DELETE FROM tm_recipients WHERE k = ?").bind(r.k));
    if (ops.length) await env.DB.batch(ops);
    return { saved: true };
  }
  if (p === "tm/list") {
    const { results } = await env.DB.prepare("SELECT id, type, brand, unit, level, category, eff_date, subject, gla, created_name, created_at, thumbs FROM tm_announcements WHERE site = ? ORDER BY eff_date DESC, id DESC LIMIT 200").bind(site).all();
    return { rows: (results || []).map(r => ({ ...r, thumbs: JSON.parse(r.thumbs || "[]").slice(0, 3), gla: r.gla ? JSON.parse(r.gla) : null })) };
  }
  if (p === "tm/get") {
    const r = await env.DB.prepare("SELECT * FROM tm_announcements WHERE id = ? AND site = ?").bind(Number(q("id")) || 0, site).first();
    if (!r) throw err("Announcement not found", 404);
    return { row: { ...r, data: JSON.parse(r.data || "{}"), thumbs: JSON.parse(r.thumbs || "[]"), gla: r.gla ? JSON.parse(r.gla) : null } };
  }
  if (p === "tm/save" && method === "POST") {
    if (!can.gla) throw err("Only flagship management and the operations team can send tenant announcements", 403);
    const type = TYPES[b.type] ? b.type : "";
    if (!type) throw err("Choose opening, closure or relocation");
    const brand = clip(b.brand, 120).trim(); if (!brand) throw err("Enter the tenant");
    if (!isDay(b.effDate)) throw err("Choose the effective date");
    const d = b.data || {};
    const data = { tagline: clip(d.tagline, 300), instagram: clip(d.instagram, 80), hours: clip(d.hours, 80), note: clip(d.note, 600),
      newUnitId: Number(d.newUnitId) || 0, newUnit: clip(d.newUnit, 40), newLevel: clip(d.newLevel, 20), landmark: clip(d.landmark, 120), photos: Number(d.photos) || 0 };
    const thumbs = (Array.isArray(b.thumbs) ? b.thumbs : []).filter(t => /^data:image\/jpeg;base64,/.test(t) && t.length < 60000).slice(0, 8);
    let gla = null;
    if (b.applyGla) {
      const note = `${TYPES[type]} announcement`;
      if (type === "open" && b.unitId) gla = { changes: [await glaChange(env, site, b.unitId, { brand, status: "Open", ...(b.category ? { dept: clip(b.category, 60) } : {}) }, b.effDate, note, me, now, ctx.raiseEvent)] };
      if (type === "close" && b.unitId) gla = { changes: [await glaChange(env, site, b.unitId, { status: "Vacant", brand: "" }, b.effDate, note, me, now, ctx.raiseEvent)] };
      if (type === "reloc") {
        const old = b.unitId ? await env.DB.prepare("SELECT dept FROM gla_units WHERE id = ? AND site = ?").bind(Number(b.unitId), site).first() : null;
        gla = { changes: [
          b.unitId ? await glaChange(env, site, b.unitId, { status: "Vacant", brand: "" }, b.effDate, `${note} — moved out`, me, now, ctx.raiseEvent) : null,
          data.newUnitId ? await glaChange(env, site, data.newUnitId, { brand, status: "Open", ...(old && old.dept ? { dept: old.dept } : {}) }, b.effDate, `${note} — moved in`, me, now, ctx.raiseEvent) : null
        ].filter(Boolean) };
      }
    }
    const r = await env.DB.prepare(`INSERT INTO tm_announcements (site, type, brand, unit_id, unit, level, category, eff_date, data, thumbs, subject, gla, created_by, created_name, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(site, type, brand, Number(b.unitId) || null, clip(b.unit, 40), clip(b.level, 20), clip(b.category, 60), b.effDate,
      JSON.stringify(data), JSON.stringify(thumbs), clip(b.subject, 200), gla ? JSON.stringify(gla) : "", me.email, me.full_name, now()).run();
    await ctx.raiseEvent(env, { site, app: "tenants", tone: "info", title: `${TYPES[type]} · ${brand}`, body: `${ctx.siteName(site)} · effective ${b.effDate} · by ${me.full_name}` });
    return { id: r.meta.last_row_id, gla };
  }
  if (p === "compliance") {
    const month = /^\d{4}-\d{2}$/.test(q("month") || "") ? q("month") : ctx.today().slice(0, 7);
    return { site, can, ...(await complianceFor(env, site, month)) };
  }
  if (p === "fitout") return { site, can: { edit: !!can.gla }, milestones: MILESTONES, units: await fitoutFor(env, site) };
  if (p === "fitout/save" && method === "POST") {
    if (!can.gla) throw err("Only flagship management and the operations team can update the fit-out tracker", 403);
    const u = await env.DB.prepare("SELECT id, brand FROM gla_units WHERE id = ? AND site = ?").bind(Number(b.unitId) || 0, site).first();
    if (!u) throw err("Unit not found", 404);
    const ms = {};
    for (const [k] of MILESTONES) { const m = (b.milestones || {})[k]; if (m && !m.auto) ms[k] = { done: !!m.done, date: isDay(m.date) ? m.date : "", note: clip(m.note, 200) }; }
    await env.DB.prepare(`INSERT INTO fitout_tracks (site, unit_id, brand, target, ms, updated_by, updated_at) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(site, unit_id) DO UPDATE SET brand = excluded.brand, target = excluded.target, ms = excluded.ms, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
      .bind(site, u.id, u.brand, isDay(b.target) ? b.target : "", JSON.stringify(ms), me.full_name, now()).run();
    return { saved: true };
  }
  throw err("Unknown endpoint", 404);
}

/* for the End of Day report */
export async function announcementsOn(env, site, day) {
  const { results } = await env.DB.prepare("SELECT type, brand, unit, level, eff_date, created_name, created_at FROM tm_announcements WHERE site = ? AND (eff_date = ? OR substr(created_at, 1, 10) = ?) ORDER BY id")
    .bind(site, day, day).all().catch(() => ({ results: [] }));
  return (results || []).map(r => ({ ...r, typeName: TYPES[r.type] }));
}
