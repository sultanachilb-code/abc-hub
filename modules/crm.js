/* =====================================================================
   CRM handhelds (Operations Tools) — the CRM sheet in the hub (docs/FEATURE-crm.md)
   • One line per handheld, as in CRM_2026_Sheet.xlsx (a tenant with two devices has a second, "continued" line).
   • Tenant name: the real name from the hub's GLA (linked unit); the name from the sheet is kept and stays editable.
     Lines are linked automatically by name (and floor), or by hand with "Link".
   • Second tab: retrieved handhelds.
   Routes (/api/ops/crm/…): list · save · link · add · remove · rlist · rsave · radd · rremove · relink
   ===================================================================== */
import { CRM_SEED } from "./crm-seed.js";
const err = (m, status = 400) => Object.assign(new Error(m), { status });
const clip = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
const FIELDS = { floor: 10, sheet_name: 80, sku: 20, crm: 5, status: 20, delivery_date: 20, serial: 40, model: 30, connection: 20, crm_user: 40, crm_password: 60, stamp: 10 };
const RFIELDS = { tenant: 80, sku: 20, crm: 5, hh_status: 40, retrieved_date: 20, serial: 40, model: 30, connection: 20, given_to: 60 };
const FLOOR = { LG: "LGF" };   // the sheet's floor → the GLA's level

export async function crmSchema(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS crm_rows (id INTEGER PRIMARY KEY AUTOINCREMENT, site TEXT NOT NULL, seq REAL NOT NULL DEFAULT 0, cont INTEGER NOT NULL DEFAULT 0,
      floor TEXT NOT NULL DEFAULT '', sheet_name TEXT NOT NULL DEFAULT '', unit_id INTEGER NOT NULL DEFAULT 0, link TEXT NOT NULL DEFAULT '', sku TEXT NOT NULL DEFAULT '',
      crm TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT '', delivery_date TEXT NOT NULL DEFAULT '', serial TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '',
      connection TEXT NOT NULL DEFAULT '', crm_user TEXT NOT NULL DEFAULT '', crm_password TEXT NOT NULL DEFAULT '', stamp TEXT NOT NULL DEFAULT '',
      updated_by TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '')`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS crm_rows_site ON crm_rows (site, seq)"),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS crm_retrieved (id INTEGER PRIMARY KEY AUTOINCREMENT, site TEXT NOT NULL, seq REAL NOT NULL DEFAULT 0, tenant TEXT NOT NULL DEFAULT '',
      unit_id INTEGER NOT NULL DEFAULT 0, link TEXT NOT NULL DEFAULT '', sku TEXT NOT NULL DEFAULT '', crm TEXT NOT NULL DEFAULT '', hh_status TEXT NOT NULL DEFAULT '', retrieved_date TEXT NOT NULL DEFAULT '',
      serial TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '', connection TEXT NOT NULL DEFAULT '', given_to TEXT NOT NULL DEFAULT '',
      updated_by TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '')`)
  ]);
}

/* ---------- name matching: sheet name → GLA unit ---------- */
const norm = s => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
const bigrams = s => { const o = new Map(); for (let i = 0; i < s.length - 1; i++) { const b = s.slice(i, i + 2); o.set(b, (o.get(b) || 0) + 1); } return o; };
const dice = (a, b) => { if (a.length < 2 || b.length < 2) return a === b ? 1 : 0; const A = bigrams(a), B = bigrams(b); let n = 0; for (const [k, v] of A) n += Math.min(v, B.get(k) || 0); return 2 * n / (a.length + b.length - 2); };
function bestUnit(name, floor, units) {
  const k = norm(name); if (!k) return null;
  const lv = FLOOR[floor] || floor;
  let best = null, score = 0;
  for (const u of units) {
    const b = norm(u.brand); if (!b) continue;
    let s = b === k ? 1 : (b.length >= 3 && k.length >= 3 && (b.startsWith(k) || k.startsWith(b) || b.includes(k) || k.includes(b))) ? 0.86 : dice(k, b);
    if (u.level === lv) s += 0.05;   // same floor wins a tie
    if (s > score) { score = s; best = u; }
  }
  return score >= 0.8 ? best : null;
}
async function unitsOf(env, site) {
  return (await env.DB.prepare("SELECT id, level, code, brand, status FROM gla_units WHERE site = ? AND active = 1").bind(site).all().catch(() => ({ results: [] }))).results || [];
}
/* lines not linked yet (and not set by hand) are matched again — the GLA may have been filled in since */
async function autoLink(env, site, units) {
  if (!units.length) return;
  const open = (await env.DB.prepare("SELECT id, floor, sheet_name FROM crm_rows WHERE site = ? AND unit_id = 0 AND link = '' AND cont = 0 AND sheet_name <> ''").bind(site).all()).results || [];
  const ops = [];
  for (const r of open) { const u = bestUnit(r.sheet_name, r.floor, units); if (u) ops.push(env.DB.prepare("UPDATE crm_rows SET unit_id = ?, link = 'auto' WHERE id = ?").bind(u.id, r.id)); }
  const ro = (await env.DB.prepare("SELECT id, tenant FROM crm_retrieved WHERE site = ? AND unit_id = 0 AND link = '' AND tenant <> ''").bind(site).all()).results || [];
  for (const r of ro) { const u = bestUnit(r.tenant, "", units); if (u) ops.push(env.DB.prepare("UPDATE crm_retrieved SET unit_id = ?, link = 'auto' WHERE id = ?").bind(u.id, r.id)); }
  for (let i = 0; i < ops.length; i += 50) await env.DB.batch(ops.slice(i, i + 50));
}
async function seed(env, site, now) {
  const S = CRM_SEED[site]; if (!S) return;
  const k = `crm:seed:${site}`;
  if (await env.DB.prepare("SELECT v FROM meta WHERE k = ?").bind(k).first()) return;
  await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)").bind(k, now()).run();
  const ops = S.rows.map((r, i) => env.DB.prepare(`INSERT INTO crm_rows (site, seq, cont, floor, sheet_name, sku, crm, status, delivery_date, serial, model, connection, crm_user, crm_password, stamp, updated_by, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'CRM_2026_Sheet.xlsx',?)`).bind(site, i + 1, ...r, now()));
  S.retrieved.forEach((r, i) => ops.push(env.DB.prepare(`INSERT INTO crm_retrieved (site, seq, tenant, sku, crm, hh_status, retrieved_date, serial, model, connection, given_to, updated_by, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,'CRM_2026_Sheet.xlsx',?)`).bind(site, i + 1, ...r, now())));
  for (let i = 0; i < ops.length; i += 50) await env.DB.batch(ops.slice(i, i + 50));
}

/* the Tenant List reads the SKUs: make sure the sheet is seeded and linked to the GLA first */
export async function crmReady(env, site, now) { await seed(env, site, now); await autoLink(env, site, await unitsOf(env, site)); }
export async function crmRoute(env, p, method, b, url, { site, me, now, canEdit, glaSeed }) {
  if (glaSeed) await glaSeed(site).catch(() => {});
  await seed(env, site, now);
  const units = await unitsOf(env, site);
  if (p === "crm/list") {
    await autoLink(env, site, units);
    const [rows, ret] = await Promise.all([
      env.DB.prepare("SELECT * FROM crm_rows WHERE site = ? ORDER BY seq, id").bind(site).all(),
      env.DB.prepare("SELECT * FROM crm_retrieved WHERE site = ? ORDER BY seq, id").bind(site).all()]);
    return { rows: rows.results || [], retrieved: ret.results || [], units: units.map(u => ({ id: u.id, level: u.level, code: u.code, brand: u.brand, status: u.status })), canEdit };
  }
  if (!canEdit) throw err("Only the operations team and management change the CRM sheet", 403);
  const T = p.startsWith("crm/r") && p !== "crm/remove" ? "crm_retrieved" : "crm_rows", F = T === "crm_rows" ? FIELDS : RFIELDS;
  const own = async id => { const r = await env.DB.prepare(`SELECT * FROM ${T} WHERE id = ? AND site = ?`).bind(Number(id), site).first(); if (!r) throw err("Line not found", 404); return r; };
  if ((p === "crm/save" || p === "crm/rsave") && method === "POST") {   // one cell
    const r = await own(b.id), f = String(b.field || "");
    if (!F[f]) throw err("This column cannot be changed");
    const v = clip(b.value, F[f]);
    await env.DB.prepare(`UPDATE ${T} SET ${f} = ?, updated_by = ?, updated_at = ? WHERE id = ?`).bind(v, me.full_name, now(), r.id).run();
    /* the name in the sheet changed and the line was linked automatically: match again */
    if ((f === "sheet_name" || f === "tenant") && r.link !== "manual") {
      const u = bestUnit(v, r.floor || "", units);
      await env.DB.prepare(`UPDATE ${T} SET unit_id = ?, link = ? WHERE id = ?`).bind(u ? u.id : 0, u ? "auto" : "", r.id).run();
      return { saved: true, unit_id: u ? u.id : 0, link: u ? "auto" : "" };
    }
    return { saved: true };
  }
  if ((p === "crm/link" || p === "crm/relink") && method === "POST") {   // link by hand (0 = no hub tenant)
    const r = await own(b.id), uid = Number(b.unit_id) || 0;
    if (uid && !units.find(u => u.id === uid)) throw err("Choose a tenant of this flagship");
    await env.DB.prepare(`UPDATE ${T} SET unit_id = ?, link = 'manual', updated_by = ?, updated_at = ? WHERE id = ?`).bind(uid, me.full_name, now(), r.id).run();
    return { linked: true };
  }
  if ((p === "crm/add" || p === "crm/radd") && method === "POST") {   // a new line (after a line, or at the end)
    const after = b.after ? await own(b.after) : null;
    const next = after ? await env.DB.prepare(`SELECT MIN(seq) AS s FROM ${T} WHERE site = ? AND seq > ?`).bind(site, after.seq).first() : null;
    const seq = after ? (next && next.s != null ? (after.seq + next.s) / 2 : after.seq + 1) : (((await env.DB.prepare(`SELECT MAX(seq) AS s FROM ${T} WHERE site = ?`).bind(site).first()) || {}).s || 0) + 1;
    const cont = T === "crm_rows" && b.cont ? 1 : 0;
    const r = await env.DB.prepare(T === "crm_rows" ? `INSERT INTO crm_rows (site, seq, cont, floor, status, updated_by, updated_at) VALUES (?,?,?,?,?,?,?)` : `INSERT INTO crm_retrieved (site, seq, updated_by, updated_at) VALUES (?,?,?,?)`)
      .bind(...(T === "crm_rows" ? [site, seq, cont, cont && after ? after.floor : "", "Open", me.full_name, now()] : [site, seq, me.full_name, now()])).run();
    return { id: r.meta.last_row_id };
  }
  if ((p === "crm/remove" || p === "crm/rremove") && method === "POST") { const r = await own(b.id); await env.DB.prepare(`DELETE FROM ${T} WHERE id = ?`).bind(r.id).run(); return { removed: true }; }
  throw err("Unknown request", 404);
}
