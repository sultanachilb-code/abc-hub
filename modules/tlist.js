/* =====================================================================
   TENANT LIST (Oct 2026, Upcoming - Testing) — docs/FEATURE-tenant-list.md
   One shared list per flagship: the tenants (GLA) with their SKU (CRM sheet), YES / NO for each.
   • Set the list first: only opened tenants (GLA status Open) and the categories (GLA departments).
   • The operations team fills it together; YES % = YES ÷ the tenants selected by the filter.
   • New list = the answers are cleared (the old one can be downloaded to Excel first).
   Routes: /api/ops/tl/get · setup · answer · reset
   ===================================================================== */
import { crmReady } from "./crm.js";
const err = (m, status = 400) => Object.assign(new Error(m), { status });
const clip = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
const norm = s => String(s || "").toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, "");
const STOP = /\b(s\s?a\s?r?\s?l|sarl|sal|co|company|ltd|llc|the|holding|international|intl|lebanon|leb)\b/g;
const gkey = s => String(s || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9؀-ۿ ]+/g, " ").replace(STOP, " ").replace(/\s+/g, "");
const isOpen = s => /^open/i.test(String(s || "").trim());

export async function tlSchema(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS tl_cfg (site TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', open_only INTEGER NOT NULL DEFAULT 1, depts TEXT NOT NULL DEFAULT '[]',
      started_at TEXT NOT NULL DEFAULT '', started_by TEXT NOT NULL DEFAULT '')`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS tl_answers (site TEXT NOT NULL, brand TEXT NOT NULL, answer TEXT NOT NULL, by_name TEXT NOT NULL DEFAULT '', at TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (site, brand))`),
    /* parent group of each tenant (Leasing Sales Performance file → "Parent Group"), shared by every flagship; a hand edit wins over the file */
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS tl_groups (bkey TEXT PRIMARY KEY, brand TEXT NOT NULL, grp TEXT NOT NULL, src TEXT NOT NULL DEFAULT 'file',
      by_name TEXT NOT NULL DEFAULT '', at TEXT NOT NULL DEFAULT '')`)
  ]);
}

/* every tenant of the flagship: GLA units grouped by brand, with the SKU from the CRM sheet (by linked unit, else by name) */
async function tenantsOf(env, site) {
  const units = (await env.DB.prepare("SELECT id, code, brand, dept, status FROM gla_units WHERE site = ? AND active = 1 AND section = 'Leasing' AND brand != '' ORDER BY seq, id").bind(site).all()).results || [];
  const crm = (await env.DB.prepare("SELECT unit_id, sheet_name, sku FROM crm_rows WHERE site = ? AND sku != ''").bind(site).all().catch(() => ({ results: [] }))).results || [];
  const skuByUnit = new Map(), skuByName = new Map();
  for (const c of crm) { if (c.unit_id) { const L = skuByUnit.get(c.unit_id) || []; L.push(c.sku); skuByUnit.set(c.unit_id, L); } const k = norm(c.sheet_name); if (k) { const L = skuByName.get(k) || []; L.push(c.sku); skuByName.set(k, L); } }
  const by = new Map();
  for (const u of units) {
    if (/vacant/i.test(u.brand) || /vacant/i.test(u.status) || /^vacant|warehouse/i.test(u.dept || "")) continue;
    const k = norm(u.brand), t = by.get(k) || { brand: clip(u.brand, 100), dept: u.dept || "", units: [], open: false, skus: new Set() };
    t.units.push(u.code); if (isOpen(u.status)) t.open = true; if (!t.dept && u.dept) t.dept = u.dept;
    for (const s of skuByUnit.get(u.id) || []) t.skus.add(s);
    by.set(k, t);
  }
  for (const [k, t] of by) if (!t.skus.size) for (const s of skuByName.get(k) || []) t.skus.add(s);
  return [...by.values()].map(t => ({ brand: t.brand, dept: t.dept, units: t.units.join(", "), open: t.open, sku: [...t.skus].join(", ") }))
    .sort((a, b) => a.brand.localeCompare(b.brand));
}
async function cfgOf(env, site) {
  const c = await env.DB.prepare("SELECT * FROM tl_cfg WHERE site = ?").bind(site).first();
  return c ? { name: c.name, openOnly: !!c.open_only, depts: JSON.parse(c.depts || "[]"), startedAt: c.started_at, startedBy: c.started_by, set: true } : { name: "", openOnly: true, depts: [], startedAt: "", startedBy: "", set: false };
}

export async function tlRoute(env, p, method, b, url, d) {
  const { site, me } = d;
  if (!d.canSite(me, site)) throw err("No access to this flagship", 403);
  const edit = d.isOps(me);
  if (p === "tl/get") {
    await crmReady(env, site, d.now).catch(() => {});
    const [all, cfg] = await Promise.all([tenantsOf(env, site), cfgOf(env, site)]);
    const pool = all.filter(t => !cfg.openOnly || t.open);
    const depts = {}; for (const t of all) { const k = t.dept || "(no category)"; depts[k] = depts[k] || { name: k, all: 0, open: 0 }; depts[k].all++; if (t.open) depts[k].open++; }
    const D = new Set(cfg.depts), list = cfg.set ? pool.filter(t => !D.size || D.has(t.dept || "(no category)")) : [];
    const G = new Map(((await env.DB.prepare("SELECT bkey, grp FROM tl_groups").all()).results || []).map(r => [r.bkey, r.grp]));
    for (const t of all) t.group = G.get(gkey(t.brand)) || "";
    const ans = new Map(((await env.DB.prepare("SELECT brand, answer, by_name, at FROM tl_answers WHERE site = ?").bind(site).all()).results || []).map(r => [norm(r.brand), r]));
    const rows = list.map(t => { const a = ans.get(norm(t.brand)); return { ...t, answer: a ? a.answer : "", by: a ? a.by_name : "", at: a ? a.at : "" }; });
    const yes = rows.filter(r => r.answer === "y").length, no = rows.filter(r => r.answer === "n").length;
    const groups = {}; for (const r of rows) if (r.group) groups[r.group] = (groups[r.group] || 0) + 1;
    return { site, siteName: d.siteName(site), edit, cfg, groups: Object.entries(groups).map(([name, n]) => ({ name, n })).sort((x, y) => y.n - x.n || x.name.localeCompare(y.name)),
      allGroups: [...new Set(G.values())].sort(), noGroup: all.filter(t => !t.group).length, depts: Object.values(depts).sort((x, y) => x.name.localeCompare(y.name)), rows,
      stats: { total: rows.length, yes, no, wait: rows.length - yes - no, pct: rows.length ? Math.round(yes / rows.length * 1000) / 10 : 0 }, at: d.now() };
  }
  if (method !== "POST") throw err("Unknown request", 404);
  if (!edit) throw err("Only the operations team fills the tenant list", 403);
  if (p === "tl/setup") {   // the filter: only opened tenants + categories (answers of tenants still in the list are kept)
    const depts = (Array.isArray(b.depts) ? b.depts : []).map(x => clip(x, 60)).filter(Boolean).slice(0, 60);
    const cur = await cfgOf(env, site);
    await env.DB.prepare(`INSERT INTO tl_cfg (site, name, open_only, depts, started_at, started_by) VALUES (?,?,?,?,?,?)
      ON CONFLICT(site) DO UPDATE SET name = excluded.name, open_only = excluded.open_only, depts = excluded.depts, started_at = CASE WHEN tl_cfg.started_at = '' THEN excluded.started_at ELSE tl_cfg.started_at END,
        started_by = CASE WHEN tl_cfg.started_by = '' THEN excluded.started_by ELSE tl_cfg.started_by END`)
      .bind(site, clip(b.name, 80), b.openOnly === false ? 0 : 1, JSON.stringify(depts), cur.startedAt || d.now(), cur.startedBy || me.full_name).run();
    return { saved: true };
  }
  if (p === "tl/answer") {
    const brand = clip(b.brand, 100); if (!brand) throw err("Choose the tenant");
    const a = b.answer === "y" || b.answer === "n" ? b.answer : "";
    if (a) await env.DB.prepare("INSERT OR REPLACE INTO tl_answers (site, brand, answer, by_name, at) VALUES (?,?,?,?,?)").bind(site, brand, a, me.full_name, d.now()).run();
    else await env.DB.prepare("DELETE FROM tl_answers WHERE site = ? AND brand = ?").bind(site, brand).run();
    return { saved: true };
  }
  if (p === "tl/group") {   // set by hand (empty = back to no group)
    const brand = clip(b.brand, 100), k = gkey(brand), g = clip(b.group, 60).toUpperCase(); if (!k) throw err("Choose the tenant");
    if (g) await env.DB.prepare("INSERT OR REPLACE INTO tl_groups (bkey, brand, grp, src, by_name, at) VALUES (?,?,?,'hand',?,?)").bind(k, brand, g, me.full_name, d.now()).run();
    else await env.DB.prepare("DELETE FROM tl_groups WHERE bkey = ?").bind(k).run();
    return { saved: true };
  }
  if (p === "tl/groups/import") {   // rows read in the browser from "Sales Data Conso": [{ tenant, group }]
    const rows = (Array.isArray(b.rows) ? b.rows : []).slice(0, 20000).map(r => ({ t: clip(r.tenant, 100), g: clip(r.group, 60).toUpperCase() })).filter(r => r.t && r.g);
    if (!rows.length) throw err("No Parent Tenant / Parent Group found in the file");
    const fileMap = new Map(); for (const r of rows) { const k = gkey(r.t); if (k && !fileMap.has(k)) fileMap.set(k, r); }
    const G = ((await env.DB.prepare("SELECT DISTINCT site, brand FROM gla_units WHERE active = 1 AND section = 'Leasing' AND brand != ''").all()).results || []).filter(x => !/vacant/i.test(x.brand));
    const here = new Set(G.filter(x => x.site === site).map(x => gkey(x.brand))), brands = G.map(x => x.brand);
    const hand = new Set(((await env.DB.prepare("SELECT bkey FROM tl_groups WHERE src = 'hand'").all()).results || []).map(r => r.bkey));
    const fileKeys = [...fileMap.keys()], used = new Set(), ops = [], unmatched = [], seen = new Set();
    for (const brand of brands) {
      const k = gkey(brand); if (!k || seen.has(k)) continue; seen.add(k);
      let hit = fileMap.get(k);
      if (!hit && k.length >= 4) {   // "PAUL" ↔ "PAUL BAKERY": one name starts the other, and only one candidate
        const c = fileKeys.filter(f => f.length >= 4 && (f.startsWith(k) || k.startsWith(f)));
        if (c.length === 1) hit = fileMap.get(c[0]);
      }
      if (!hit) { if (here.has(k)) unmatched.push(clip(brand, 100)); continue; }   // listed for this flagship only
      used.add(gkey(hit.t));
      if (hand.has(k)) continue;
      ops.push(env.DB.prepare("INSERT OR REPLACE INTO tl_groups (bkey, brand, grp, src, by_name, at) VALUES (?,?,?,'file',?,?)").bind(k, clip(brand, 100), hit.g, me.full_name, d.now()));
    }
    for (let i = 0; i < ops.length; i += 50) await env.DB.batch(ops.slice(i, i + 50));
    return { matched: ops.length, keptByHand: hand.size, unmatched: unmatched.sort(), groups: new Set(rows.map(r => r.g)).size, fileTenants: fileMap.size };
  }
  if (p === "tl/reset") {   // a new list: clear the answers (the name and filter stay, to be changed if needed)
    await env.DB.prepare("DELETE FROM tl_answers WHERE site = ?").bind(site).run();
    await env.DB.prepare("UPDATE tl_cfg SET started_at = ?, started_by = ?, name = ? WHERE site = ?").bind(d.now(), me.full_name, clip(b.name, 80), site).run();
    return { reset: true };
  }
  throw err("Unknown request", 404);
}
