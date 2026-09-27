/* =====================================================================
   PROPERTY DETAILS — feature module (kept separate so it can be removed cleanly)
   See docs/FEATURE-property-details.md

   Tables : property_rows · property_log
   Routes : /api/ops/property/*   (all require a hub sign-in)
   ===================================================================== */
import { PROPERTY } from "../data/property-details.js";

const SITES5 = ["VRM", "ACM", "DBS", "ACS", "VRS"];
const clip = (v, n) => String(v == null ? "" : v).slice(0, n);
const err = (m, status = 400) => Object.assign(new Error(m), { status });

export async function propertySchema(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS property_rows (id INTEGER PRIMARY KEY AUTOINCREMENT, site TEXT NOT NULL, seq INTEGER NOT NULL DEFAULT 0,
      category TEXT NOT NULL, sub TEXT NOT NULL DEFAULT '', item TEXT NOT NULL, value TEXT NOT NULL DEFAULT '', is_total INTEGER NOT NULL DEFAULT 0,
      note TEXT NOT NULL DEFAULT '', updated_by TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '')`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS property_rows_site ON property_rows (site, seq)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS property_log (id INTEGER PRIMARY KEY AUTOINCREMENT, site TEXT NOT NULL, row_id INTEGER NOT NULL,
      item TEXT NOT NULL DEFAULT '', field TEXT NOT NULL DEFAULT 'value', before TEXT NOT NULL DEFAULT '', after TEXT NOT NULL DEFAULT '',
      by_name TEXT, at TEXT)`)
  ]);
}

/* First visit for a flagship: load its column from the snapshot (empty values for flagships not in it) */
async function seed(env, site, now) {
  const has = await env.DB.prepare("SELECT 1 AS x FROM property_rows WHERE site = ? LIMIT 1").bind(site).first();
  if (has) return;
  const claim = await env.DB.prepare("INSERT OR IGNORE INTO meta (k, v) VALUES (?, ?)").bind("propseed:" + site, now()).run();
  if (!claim.meta || claim.meta.changes !== 1) return;
  const ops = PROPERTY.rows.map((r, i) => env.DB.prepare(
    "INSERT INTO property_rows (site, seq, category, sub, item, value, is_total, note, updated_by, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .bind(site, (i + 1) * 10, r.category, r.sub || "", r.item, (r.values || {})[site] || "", r.total ? 1 : 0, r.note || "", "Comparison snapshot", now()));
  for (let i = 0; i < ops.length; i += 90) await env.DB.batch(ops.slice(i, i + 90));
}
const rowOut = (r, withNote) => ({ id: r.id, seq: r.seq, category: r.category, sub: r.sub, item: r.item, value: r.value, total: !!r.is_total,
  updatedBy: r.updated_by, updatedAt: r.updated_at, ...(withNote ? { note: r.note } : {}) });

/* ctx = { site, can, me, now, siteName, isAdmin } — can.property decides who edits values */
export async function propertyRoute(env, p, method, b, url, ctx) {
  const { site, can, me, now, isAdmin } = ctx;

  if (p === "property/get") {
    await seed(env, site, now);
    const { results } = await env.DB.prepare("SELECT * FROM property_rows WHERE site = ? ORDER BY seq, id").bind(site).all();
    const last = await env.DB.prepare("SELECT MAX(at) AS at FROM property_log WHERE site = ?").bind(site).first();
    return { site, can: { edit: !!can.property, admin: isAdmin }, source: PROPERTY.source, lastChange: last && last.at || "",
      rows: (results || []).map(r => rowOut(r, isAdmin)) };
  }
  /* Administrators: every flagship side by side */
  if (p === "property/compare") {
    if (!isAdmin) throw err("Only administrators can compare flagships", 403);
    for (const s of SITES5) await seed(env, s, now);
    const { results } = await env.DB.prepare("SELECT * FROM property_rows ORDER BY seq, id").all();
    return { sites: SITES5, rows: (results || []).map(r => ({ ...rowOut(r, true), site: r.site })) };
  }
  if (p === "property/log") {
    const { results } = await env.DB.prepare("SELECT * FROM property_log WHERE site = ? ORDER BY at DESC, id DESC LIMIT 200").bind(site).all();
    return { log: (results || []).map(l => ({ item: l.item, field: l.field, before: l.before, after: l.after, by: l.by_name, at: l.at })) };
  }

  if (p === "property/save" && method === "POST") {
    if (!can.property) throw err("Only the flagship's Manager or Senior Mall Supervisor can update the property details", 403);
    const row = await env.DB.prepare("SELECT * FROM property_rows WHERE id = ? AND site = ?").bind(Number(b.id) || 0, site).first();
    if (!row) throw err("Item not found", 404);
    const field = b.field === "note" ? "note" : b.field === "item" ? "item" : "value";
    if (field !== "value" && !isAdmin) throw err("Only administrators can change item names and notes", 403);
    const val = clip(b[field] ?? b.value, field === "note" ? 500 : 300).trim();
    if (field === "item" && !val) throw err("The item needs a name");
    if (String(row[field]) === val) return { id: row.id, changed: false };
    await env.DB.batch([
      env.DB.prepare(`UPDATE property_rows SET ${field} = ?, updated_by = ?, updated_at = ? WHERE id = ?`).bind(val, me.full_name, now(), row.id),
      env.DB.prepare("INSERT INTO property_log (site, row_id, item, field, before, after, by_name, at) VALUES (?,?,?,?,?,?,?,?)")
        .bind(site, row.id, row.item, field, String(row[field]), val, me.full_name, now())
    ]);
    return { id: row.id, changed: true };
  }
  if (p === "property/add" && method === "POST") {
    if (!isAdmin) throw err("Only administrators can add items", 403);
    const category = clip(b.category, 80).trim(), sub = clip(b.sub, 80).trim(), item = clip(b.item, 160).trim();
    if (!category || !item) throw err("Category and item are required");
    const after = await env.DB.prepare("SELECT MAX(seq) AS s FROM property_rows WHERE site = ? AND category = ? AND sub = ?").bind(site, category, sub).first();
    const seq = (after && after.s ? after.s : (await env.DB.prepare("SELECT COALESCE(MAX(seq),0) AS s FROM property_rows WHERE site = ?").bind(site).first()).s) + 1;
    const targets = b.allFlagships ? SITES5 : [site];
    for (const s of targets) {
      await seed(env, s, now);
      await env.DB.prepare("INSERT INTO property_rows (site, seq, category, sub, item, value, updated_by, updated_at) VALUES (?,?,?,?,?,?,?,?)")
        .bind(s, seq, category, sub, item, s === site ? clip(b.value, 300) : "", me.full_name, now()).run();
    }
    return { added: targets.length };
  }
  if (p === "property/delete" && method === "POST") {
    if (!isAdmin) throw err("Only administrators can remove items", 403);
    const row = await env.DB.prepare("SELECT * FROM property_rows WHERE id = ? AND site = ?").bind(Number(b.id) || 0, site).first();
    if (!row) throw err("Item not found", 404);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM property_rows WHERE id = ?").bind(row.id),
      env.DB.prepare("INSERT INTO property_log (site, row_id, item, field, before, after, by_name, at) VALUES (?,?,?,?,?,?,?,?)")
        .bind(site, row.id, row.item, "removed", row.value, "", me.full_name, now())
    ]);
    return { deleted: true };
  }
  throw err("Unknown endpoint", 404);
}
