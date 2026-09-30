/* =====================================================================
   TENANTS DIRECTORY — feature module (kept separate so it can be removed cleanly)
   See docs/FEATURE-directory.md

   One directory per flagship: every tenant's contacts (employee, position, mobile, email, landline).
   • Tenant name, category, location (level) and status come from the GLA — nothing to type twice.
   • Reception keeps it up to date through a private link (no hub account needed).
   • Operations see it in the hub with filters; anyone can find a tenant or employee from the home search.

   Tables : dir_contacts · dir_links
   Routes : /api/ops/dir/*  (signed in)  ·  /api/rx/<token>/*  (reception link)
   Page   : /tools/directory  ·  /reception/<token>
   ===================================================================== */

const err = (m, status = 400) => Object.assign(new Error(m), { status });
const clip = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
const norm = s => String(s || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9؀-ۿ]+/g, " ").trim();

export async function directorySchema(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS dir_contacts (id INTEGER PRIMARY KEY AUTOINCREMENT, site TEXT NOT NULL,
      tenant TEXT NOT NULL, unit_id INTEGER NOT NULL DEFAULT 0, employee TEXT NOT NULL DEFAULT '', position TEXT NOT NULL DEFAULT '',
      mobile TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', landline TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT '', updated_by TEXT NOT NULL DEFAULT '')`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS dir_contacts_site ON dir_contacts (site, tenant)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS dir_links (site TEXT PRIMARY KEY, token TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL DEFAULT '')`)
  ]);
}

/* GLA units of the flagship that carry a tenant (vacant units have no one to call) */
async function glaTenants(env, site) {
  const { results } = await env.DB.prepare("SELECT id, level, code, brand, status, dept FROM gla_units WHERE site = ? AND active = 1 AND brand != '' ORDER BY seq, id")
    .bind(site).all().catch(() => ({ results: [] }));
  return (results || []).filter(u => !/^vacant/i.test(u.brand) && !/vacant/i.test(u.status));
}
const statusOf = s => /fit/i.test(s) ? "Fit-out" : /termin/i.test(s) ? "Terminated" : /clos/i.test(s) ? "Closed" : /reserv/i.test(s) ? "Reserved" : s ? (/active|open/i.test(s) ? "Open" : s) : "";
const catOf = d => { const t = String(d || "").trim(); return t ? t.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()).replace(/\bF And B\b/, "F&B") : ""; };

function contactOut(c, units, byName) {
  const u = (c.unit_id && units.get(c.unit_id)) || byName.get(norm(c.tenant)) || null;
  return { id: c.id, tenant: c.tenant, unitId: u ? u.id : 0, employee: c.employee, position: c.position, mobile: c.mobile, email: c.email, landline: c.landline,
    category: u ? catOf(u.dept) : c.category, location: u ? u.level : c.location, unit: u ? u.code : "", status: u ? statusOf(u.status) : c.status,
    fromGla: !!u, updatedAt: c.updated_at, updatedBy: c.updated_by };
}
async function listFor(env, site) {
  const [{ results }, gla] = await Promise.all([
    env.DB.prepare("SELECT * FROM dir_contacts WHERE site = ? ORDER BY tenant COLLATE NOCASE, employee COLLATE NOCASE").bind(site).all(),
    glaTenants(env, site)]);
  const units = new Map(gla.map(u => [u.id, u])), byName = new Map();
  gla.forEach(u => { const k = norm(u.brand); if (!byName.has(k)) byName.set(k, u); });
  return { rows: (results || []).map(c => contactOut(c, units, byName)),
    tenants: gla.map(u => ({ id: u.id, name: u.brand, level: u.level, code: u.code, category: catOf(u.dept), status: statusOf(u.status) })) };
}

function cleanRow(b) {
  const r = { tenant: clip(b.tenant, 120), unit_id: Number(b.unitId) || 0, employee: clip(b.employee, 120), position: clip(b.position, 80),
    mobile: clip(b.mobile, 60), email: clip(b.email, 160).toLowerCase(), landline: clip(b.landline, 60),
    category: clip(b.category, 60), location: clip(b.location, 20), status: clip(b.status, 30) };
  if (!r.tenant) throw err("Choose the tenant");
  if (!r.employee && !r.mobile && !r.email && !r.landline) throw err("Add at least a name, a number or an email");
  if (r.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email)) throw err("That email address does not look right");
  return r;
}
async function saveRow(env, site, b, by, now) {
  const r = cleanRow(b), id = Number(b.id) || 0;
  if (id) {
    const cur = await env.DB.prepare("SELECT site FROM dir_contacts WHERE id = ?").bind(id).first();
    if (!cur || cur.site !== site) throw err("Contact not found", 404);
    await env.DB.prepare(`UPDATE dir_contacts SET tenant = ?, unit_id = ?, employee = ?, position = ?, mobile = ?, email = ?, landline = ?,
      category = ?, location = ?, status = ?, updated_at = ?, updated_by = ? WHERE id = ?`)
      .bind(r.tenant, r.unit_id, r.employee, r.position, r.mobile, r.email, r.landline, r.category, r.location, r.status, now, by, id).run();
    return id;
  }
  const x = await env.DB.prepare(`INSERT INTO dir_contacts (site, tenant, unit_id, employee, position, mobile, email, landline, category, location, status, updated_at, updated_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(site, r.tenant, r.unit_id, r.employee, r.position, r.mobile, r.email, r.landline, r.category, r.location, r.status, now, by).run();
  return x.meta.last_row_id;
}

/* Excel import: one row per contact. Tenant + employee already in the directory → updated, otherwise added.
   The page sends the sheet in chunks of up to 40 rows (Cloudflare's free plan allows 50 database calls per request):
   2 reads + one batch of writes per chunk. Rows flagged "dup" (same person twice in the sheet) are always added. */
async function importRows(env, site, rows, by, now, offset = 0) {
  if (!Array.isArray(rows) || !rows.length) throw err("The sheet has no rows");
  if (rows.length > 40) throw err("Send the sheet in chunks of 40 rows");
  const gla = await glaTenants(env, site), byName = new Map();
  gla.forEach(u => { const k = norm(u.brand); if (!byName.has(k)) byName.set(k, u); });
  const { results } = await env.DB.prepare("SELECT id, tenant, employee, mobile FROM dir_contacts WHERE site = ?").bind(site).all();
  const have = new Map((results || []).map(c => [norm(c.tenant) + "|" + norm(c.employee || c.mobile), c.id]));
  let added = 0, updated = 0, linked = 0; const skipped = [], stmts = [];
  for (const [i, raw] of rows.entries()) {
    let r; try { r = cleanRow(raw); } catch (e) { skipped.push({ row: offset + i + 2, why: e.message }); continue; }
    const u = byName.get(norm(r.tenant)); if (u) { r.unit_id = u.id; r.tenant = u.brand; linked++; }
    const id = raw.dup ? 0 : have.get(norm(r.tenant) + "|" + norm(r.employee || r.mobile)) || 0;
    stmts.push(id
      ? env.DB.prepare(`UPDATE dir_contacts SET tenant = ?, unit_id = ?, employee = ?, position = ?, mobile = ?, email = ?, landline = ?,
          category = ?, location = ?, status = ?, updated_at = ?, updated_by = ? WHERE id = ? AND site = ?`)
          .bind(r.tenant, r.unit_id, r.employee, r.position, r.mobile, r.email, r.landline, r.category, r.location, r.status, now, by, id, site)
      : env.DB.prepare(`INSERT INTO dir_contacts (site, tenant, unit_id, employee, position, mobile, email, landline, category, location, status, updated_at, updated_by)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(site, r.tenant, r.unit_id, r.employee, r.position, r.mobile, r.email, r.landline, r.category, r.location, r.status, now, by));
    id ? updated++ : added++;
  }
  if (stmts.length) await env.DB.batch(stmts);
  return { added, updated, linked, skipped, skippedCount: skipped.length };
}

/* shared by the hub page and the reception link */
async function core(env, p, method, b, url, { site, canEdit, by, now }) {
  if (p === "list") return { ...(await listFor(env, site)), canEdit };
  if (!canEdit) throw err("Only reception and the flagship's management can change the directory", 403);
  if (p === "save" && method === "POST") return { id: await saveRow(env, site, b, by, now()) };
  if (p === "delete" && method === "POST") {
    const r = await env.DB.prepare("DELETE FROM dir_contacts WHERE id = ? AND site = ?").bind(Number(b.id) || 0, site).run();
    if (!r.meta.changes) throw err("Contact not found", 404);
    return { deleted: true };
  }
  if (p === "import" && method === "POST") return importRows(env, site, b.rows, by, now(), Number(b.offset) || 0);
  throw err("Unknown endpoint", 404);
}

/* ----- signed in: /api/ops/dir/* ----- */
export async function directoryRoute(env, p, method, b, url, ctx) {
  const { site, me, full, sites, now, siteName, origin } = ctx;
  if (p === "dir/search") {
    const q = norm(url.searchParams.get("q")); if (q.length < 2) return { results: [] };
    const out = [];
    for (const s of sites) {
      const { rows } = await listFor(env, s);
      for (const r of rows) if (norm(`${r.tenant} ${r.employee}`).includes(q)) out.push({ ...r, site: s, siteName: siteName(s) });
      if (out.length >= 40) break;
    }
    out.sort((a, b) => (norm(a.employee).startsWith(q) || norm(a.tenant).startsWith(q) ? 0 : 1) - (norm(b.employee).startsWith(q) || norm(b.tenant).startsWith(q) ? 0 : 1));
    return { results: out.slice(0, 8), more: out.length > 8 };
  }
  if (p === "dir/link") {
    if (!full) throw err("Only the flagship's management can manage the reception link", 403);
    if (method === "POST") {
      if (b.action === "off") await env.DB.prepare("UPDATE dir_links SET active = 0 WHERE site = ?").bind(site).run();
      else {
        const a = new Uint8Array(18); crypto.getRandomValues(a);
        const token = btoa(String.fromCharCode(...a)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
        await env.DB.prepare(`INSERT INTO dir_links (site, token, active, created_at, created_by) VALUES (?,?,1,?,?)
          ON CONFLICT(site) DO UPDATE SET token = excluded.token, active = 1, created_at = excluded.created_at, created_by = excluded.created_by`)
          .bind(site, token, now(), me.full_name).run();
      }
    }
    const l = await env.DB.prepare("SELECT * FROM dir_links WHERE site = ?").bind(site).first();
    return l && l.active ? { url: `${origin}/reception/${l.token}`, createdAt: l.created_at, createdBy: l.created_by } : { url: "" };
  }
  return core(env, p.slice(4), method, b, url, { site, canEdit: full, by: me.full_name, now });
}

/* ----- reception link: /api/rx/<token>/* (no hub account) ----- */
export async function directoryPublic(env, path, method, b, url, { siteName, now }) {
  const [, token, ...rest] = path.split("/");
  const l = token && /^[\w-]{16,40}$/.test(token) ? await env.DB.prepare("SELECT site FROM dir_links WHERE token = ? AND active = 1").bind(token).first() : null;
  if (!l) throw err("This reception link is no longer active. Ask Operations for the new link.", 404);
  const p = rest.join("/");
  if (p === "context") return { site: l.site, siteName: siteName(l.site), reception: true };
  return core(env, p, method, b, url, { site: l.site, canEdit: true, by: "Reception", now });
}
