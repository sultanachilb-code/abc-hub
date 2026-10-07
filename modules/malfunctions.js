/* =====================================================================
   MALFUNCTION RECORDS — soft services and operations log every malfunction handled by a service provider
   (Chip, Soffa, … — providers are added on the page). Each record follows the provider:
   Open → Reported to provider → In progress → Fixed → Closed, with the times of each step, photos and notes.
   High / Critical malfunctions raise a hub alert. See docs/FEATURE-malfunctions.md
   Routes: /api/ops/mf/*
   ===================================================================== */
const err = (m, status = 400) => Object.assign(new Error(m), { status });
const clip = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
export const MF_STATUS = ["Open", "Reported to provider", "In progress", "Fixed", "Closed"];
export const MF_PRIORITY = ["Low", "Medium", "High", "Critical"];
export const MF_CATEGORIES = ["HVAC", "Electrical", "Plumbing", "Lifts & escalators", "Doors & gates", "Lighting", "Fire & safety", "Cleaning equipment",
  "Restrooms", "Parking", "Civil / structure", "IT & AV", "Other"];
const PHOTO_MAX = 220000;   // one compressed photo (data URL) — the page shrinks it before sending

export async function malfunctionsSchema(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS mf_providers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, service TEXT NOT NULL DEFAULT '',
      contact TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', sites TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1, created_at TEXT, created_name TEXT)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS mf_records (id INTEGER PRIMARY KEY AUTOINCREMENT, site TEXT NOT NULL, provider_id INTEGER NOT NULL DEFAULT 0,
      category TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '', asset TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
      priority TEXT NOT NULL DEFAULT 'Medium', status TEXT NOT NULL DEFAULT 'Open', provider_ref TEXT NOT NULL DEFAULT '',
      found_at TEXT NOT NULL, reported_at TEXT NOT NULL DEFAULT '', attended_at TEXT NOT NULL DEFAULT '', fixed_at TEXT NOT NULL DEFAULT '', closed_at TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '[]', created_by TEXT, created_name TEXT, updated_at TEXT, updated_name TEXT, deleted INTEGER NOT NULL DEFAULT 0)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS mf_records_site ON mf_records (site, status, deleted)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS mf_photos (id INTEGER PRIMARY KEY AUTOINCREMENT, record_id INTEGER NOT NULL, data TEXT NOT NULL, at TEXT, by_name TEXT)`)
  ]);
  /* the two providers named when the feature was asked for */
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM mf_providers").first();
  if (!n || !n.n) await env.DB.batch(["Chip", "Soffa"].map(p => env.DB.prepare("INSERT INTO mf_providers (name, created_at, created_name) VALUES (?, ?, 'Hub')").bind(p, new Date().toISOString())));
}

const hours = (a, b) => a && b ? Math.max(0, (Date.parse(b) - Date.parse(a)) / 36e5) : null;
const out = (r, P, photos) => ({
  id: r.id, site: r.site, providerId: r.provider_id, provider: (P.get(r.provider_id) || {}).name || "", category: r.category, location: r.location, asset: r.asset,
  description: r.description, priority: r.priority, status: r.status, providerRef: r.provider_ref,
  foundAt: r.found_at, reportedAt: r.reported_at, attendedAt: r.attended_at, fixedAt: r.fixed_at, closedAt: r.closed_at,
  notes: (() => { try { return JSON.parse(r.notes || "[]"); } catch { return []; } })(),
  by: r.created_name, updatedAt: r.updated_at, updatedBy: r.updated_name,
  open: !["Fixed", "Closed"].includes(r.status),
  ageH: hours(r.found_at, r.fixed_at || new Date().toISOString()), fixH: hours(r.reported_at || r.found_at, r.fixed_at),
  photos: photos || []
});

export async function malfunctionsRoute(env, p, method, b, url, d) {
  const { site, me, can, now, raiseEvent, siteName } = d;
  const DB = env.DB;
  const edit = !!(can.mom || can.handover);            // operations team, soft services (handover rights) and management
  const provAdmin = !!(can.feedbackAdmin || can.mom);   // add / edit service providers
  const providers = async () => (await DB.prepare("SELECT * FROM mf_providers ORDER BY active DESC, name").all()).results || [];

  if (p === "mf/list" && method === "GET") {
    const all = url.searchParams.get("all") === "1";
    const from = url.searchParams.get("from") || new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
    const P = await providers(), PM = new Map(P.map(x => [x.id, x]));
    const { results } = await DB.prepare(`SELECT * FROM mf_records WHERE site = ? AND deleted = 0 AND (status NOT IN ('Fixed','Closed') OR ${all ? "1" : "found_at >= ?"})
      ORDER BY CASE WHEN status IN ('Fixed','Closed') THEN 1 ELSE 0 END, CASE priority WHEN 'Critical' THEN 0 WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 ELSE 3 END, found_at DESC LIMIT 800`).bind(...(all ? [site] : [site, from])).all();
    const counts = await DB.prepare("SELECT record_id, COUNT(*) AS n FROM mf_photos WHERE record_id IN (SELECT id FROM mf_records WHERE site = ?) GROUP BY record_id").bind(site).all();
    const pc = new Map((counts.results || []).map(x => [x.record_id, x.n]));
    const list = (results || []).map(r => ({ ...out(r, PM), photoCount: pc.get(r.id) || 0 }));
    /* provider scorecard for the period shown */
    const score = P.map(pv => { const L = list.filter(x => x.providerId === pv.id); const fx = L.filter(x => x.fixH != null);
      return { id: pv.id, name: pv.name, open: L.filter(x => x.open).length, total: L.length, avgFixH: fx.length ? fx.reduce((s, x) => s + x.fixH, 0) / fx.length : null }; })
      .filter(s => s.total);
    return { site, siteName: siteName(site), can: { edit, provAdmin }, statuses: MF_STATUS, priorities: MF_PRIORITY, categories: MF_CATEGORIES,
      providers: P.filter(x => !x.sites || x.sites.split(",").includes(site)).map(x => ({ id: x.id, name: x.name, service: x.service, contact: x.contact, phone: x.phone, email: x.email, active: !!x.active })),
      list, score, from };
  }
  if (p === "mf/get" && method === "GET") {
    const id = Number(url.searchParams.get("id")) || 0;
    const r = await DB.prepare("SELECT * FROM mf_records WHERE id = ? AND site = ? AND deleted = 0").bind(id, site).first();
    if (!r) throw err("Record not found", 404);
    const P = new Map((await providers()).map(x => [x.id, x]));
    const ph = (await DB.prepare("SELECT id, data, at, by_name FROM mf_photos WHERE record_id = ? ORDER BY id").bind(id).all()).results || [];
    return { record: out(r, P, ph.map(x => ({ id: x.id, data: x.data, at: x.at, by: x.by_name }))) };
  }
  if (method !== "POST") throw err("Unknown request", 404);

  if (p === "mf/provider/save") {
    if (!provAdmin) throw err("Only management and senior supervisors add service providers", 403);
    const name = clip(b.name, 80); if (!name) throw err("Type the provider's name");
    const v = [name, clip(b.service, 80), clip(b.contact, 80), clip(b.phone, 40), clip(b.email, 120), b.active === false ? 0 : 1];
    if (b.id) await DB.prepare("UPDATE mf_providers SET name = ?, service = ?, contact = ?, phone = ?, email = ?, active = ? WHERE id = ?").bind(...v, Number(b.id)).run();
    else await DB.prepare("INSERT INTO mf_providers (name, service, contact, phone, email, active, created_at, created_name) VALUES (?,?,?,?,?,?,?,?)").bind(...v, now(), me.full_name).run();
    return { ok: true };
  }
  if (!edit) throw err("Not allowed", 403);

  if (p === "mf/save") {
    const id = Number(b.id) || 0, at = now();
    const status = MF_STATUS.includes(b.status) ? b.status : "Open";
    const pr = MF_PRIORITY.includes(b.priority) ? b.priority : "Medium";
    const desc = clip(b.description, 1500); if (!desc) throw err("Describe the malfunction");
    const cur = id ? await DB.prepare("SELECT * FROM mf_records WHERE id = ? AND site = ? AND deleted = 0").bind(id, site).first() : null;
    if (id && !cur) throw err("Record not found", 404);
    /* the time of each step is set when the status first reaches it (or typed on the page) */
    const iso = v => { const t = String(v || ""); return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(t) ? new Date(t).toISOString() : ""; };
    const step = (field, reached) => iso(b[field]) || (cur && cur[{ reportedAt: "reported_at", attendedAt: "attended_at", fixedAt: "fixed_at", closedAt: "closed_at" }[field]]) || (reached ? at : "");
    const idx = MF_STATUS.indexOf(status);
    const f = {
      provider_id: Number(b.providerId) || 0, category: clip(b.category, 40), location: clip(b.location, 120), asset: clip(b.asset, 120), description: desc,
      priority: pr, status, provider_ref: clip(b.providerRef, 60), found_at: iso(b.foundAt) || (cur && cur.found_at) || at,
      reported_at: step("reportedAt", idx >= 1), attended_at: step("attendedAt", idx >= 2), fixed_at: step("fixedAt", idx >= 3), closed_at: step("closedAt", idx >= 4)
    };
    let notes = cur ? JSON.parse(cur.notes || "[]") : [];
    if (clip(b.note, 600)) notes.push({ at, by: me.full_name, t: clip(b.note, 600) });
    if (cur && cur.status !== status) notes.push({ at, by: me.full_name, t: `Status: ${cur.status} → ${status}` });
    notes = notes.slice(-60);
    let rid = id;
    if (id) await DB.prepare(`UPDATE mf_records SET provider_id=?, category=?, location=?, asset=?, description=?, priority=?, status=?, provider_ref=?, found_at=?, reported_at=?, attended_at=?, fixed_at=?, closed_at=?,
        notes=?, updated_at=?, updated_name=? WHERE id = ?`).bind(...Object.values(f), JSON.stringify(notes), at, me.full_name, id).run();
    else {
      const r = await DB.prepare(`INSERT INTO mf_records (site, provider_id, category, location, asset, description, priority, status, provider_ref, found_at, reported_at, attended_at, fixed_at, closed_at,
        notes, created_by, created_name, updated_at, updated_name) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(site, ...Object.values(f), JSON.stringify(notes), me.email, me.full_name, at, me.full_name).run();
      rid = r.meta.last_row_id;
    }
    for (const ph of (Array.isArray(b.photos) ? b.photos : []).slice(0, 4)) {
      if (typeof ph === "string" && /^data:image\/(jpeg|png|webp);base64,/.test(ph) && ph.length <= PHOTO_MAX)
        await DB.prepare("INSERT INTO mf_photos (record_id, data, at, by_name) VALUES (?,?,?,?)").bind(rid, ph, at, me.full_name).run();
    }
    const urgent = ["High", "Critical"].includes(pr);
    if (raiseEvent && (!id ? urgent : (cur.priority !== pr && urgent) || (cur.status !== status && status === "Fixed" && urgent))) {
      const P = (await providers()).find(x => x.id === f.provider_id);
      await raiseEvent(env, { site, app: "malfunctions", tone: status === "Fixed" ? "info" : pr === "Critical" ? "alert" : "warn",
        title: `${status === "Fixed" ? "Fixed" : pr + " malfunction"} · ${f.category || "Malfunction"}${f.location ? " · " + f.location : ""}`,
        body: `${desc.slice(0, 140)}${P ? " · " + P.name : ""} · ${me.full_name}` }).catch(() => {});
    }
    return { id: rid };
  }
  if (p === "mf/delete") {
    const r = await DB.prepare("SELECT created_by FROM mf_records WHERE id = ? AND site = ?").bind(Number(b.id) || 0, site).first();
    if (!r) throw err("Record not found", 404);
    if (r.created_by !== me.email && !provAdmin) throw err("Only the person who logged it or a senior supervisor can delete it", 403);
    await DB.prepare("UPDATE mf_records SET deleted = 1, updated_at = ?, updated_name = ? WHERE id = ?").bind(now(), me.full_name, Number(b.id)).run();
    return { ok: true };
  }
  if (p === "mf/photo/delete") {
    await DB.prepare("DELETE FROM mf_photos WHERE id = ? AND record_id IN (SELECT id FROM mf_records WHERE site = ?)").bind(Number(b.id) || 0, site).run();
    return { ok: true };
  }
  throw err("Unknown request", 404);
}

/* open malfunctions for the Day to Day timeline and the shift-end check */
export async function mfOpen(env, site) {
  try {
    const { results } = await env.DB.prepare(`SELECT r.id, r.category, r.location, r.priority, r.status, r.found_at, p.name AS provider FROM mf_records r
      LEFT JOIN mf_providers p ON p.id = r.provider_id WHERE r.site = ? AND r.deleted = 0 AND r.status NOT IN ('Fixed','Closed') ORDER BY r.found_at`).bind(site).all();
    return results || [];
  } catch { return []; }
}
