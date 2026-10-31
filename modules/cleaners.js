/* =====================================================================
   CLEANER ACCESS (Oct 2026) — the Cleaner QR system moved into the hub — docs/FEATURE-cleaner-access.md
   Before: two pages on Cloudflare + Google Apps Script + the "ABC Verdun - Cleaner Control Sheet".
   • Each flagship sees only its own cleaners; Head of Security, Admin, Advisor see every flagship (Directors / CDSO: theirs).
   • Register / suspend / blacklist: operations team, flagship managers, Head of Security, Admin.
   • Check-in only from the Loading Gate app (gate account of that flagship). Any other phone: an information card, no buttons.
   • Photos and ID copies in R2 (cleaners/<id>/photo.jpg · idcopy.jpg).
   • Migration: copy from the sheet (Apps Script action hubExport, HUB key) → compare → switch (meta cl:mode = hub).
     The old scan link (abcv-loading-area-access) forwards here once switched; the sheet stays as a read-only backup.
   • Emails through Outlook: 21:00 daily entry report per flagship (To security supervisor, Cc operations group email);
     the last day of each month, one verification email per tenant (Cc the flagship's operations group email).
   ===================================================================== */

const CLEAN_STATUS = ["Active", "Suspended", "Blacklist"];
const MALL_OF = { VRM: ["verdun mall", "abc verdun", "verdun"], VRS: ["verdun department store", "verdun ds", "abc verdun ds"],
  ACM: ["achrafieh mall", "abc achrafieh", "achrafieh"], ACS: ["achrafieh department store", "achrafieh ds", "abc achrafieh ds"],
  DBS: ["dbayeh department store", "dbayeh", "abc dbayeh", "dbayeh mall"] };
const siteOfMall = m => { const k = String(m || "").trim().toLowerCase(); return Object.keys(MALL_OF).find(c => MALL_OF[c].includes(k)) || ""; };
const err = (m, s = 400) => Object.assign(new Error(m), { status: s });
const clip = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
const normName = s => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
const normPhone = s => String(s || "").replace(/\D/g, "");
const TOKEN_CH = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789abcdefghijkmnpqrstuvwxyz";
const newToken = () => { const b = crypto.getRandomValues(new Uint8Array(10)); return [...b].map(x => TOKEN_CH[x % TOKEN_CH.length]).join(""); };
const PHOTO_MAX = 1.6e6;

export async function cleanSchema(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS cl_workers (id TEXT PRIMARY KEY, token TEXT NOT NULL, name TEXT NOT NULL, nationality TEXT NOT NULL DEFAULT '',
      company TEXT NOT NULL DEFAULT '', company_phone TEXT NOT NULL DEFAULT '', tenant TEXT NOT NULL DEFAULT '', tenant_email TEXT NOT NULL DEFAULT '',
      site TEXT NOT NULL, position TEXT NOT NULL DEFAULT 'Cleaner', phone TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'Active', comment TEXT NOT NULL DEFAULT '',
      registered TEXT NOT NULL DEFAULT '', photo_key TEXT NOT NULL DEFAULT '', idcopy_key TEXT NOT NULL DEFAULT '', images_at TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'hub', created_by TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '', updated_by TEXT NOT NULL DEFAULT '')`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS cl_workers_site ON cl_workers (site, status)"),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS cl_attendance (id INTEGER PRIMARY KEY AUTOINCREMENT, day TEXT NOT NULL, time TEXT NOT NULL, worker_id TEXT NOT NULL,
      site TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', company TEXT NOT NULL DEFAULT '', tenant TEXT NOT NULL DEFAULT '', agent TEXT NOT NULL DEFAULT '',
      gate TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT 'gate', UNIQUE (day, worker_id))`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS cl_att_site_day ON cl_attendance (site, day)"),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS cl_verify_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, site TEXT NOT NULL, tenant TEXT NOT NULL,
      email TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, names TEXT NOT NULL DEFAULT '', via TEXT NOT NULL DEFAULT '')`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS cl_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, worker_id TEXT NOT NULL, site TEXT NOT NULL,
      what TEXT NOT NULL, by_name TEXT NOT NULL DEFAULT '')`)
  ]);
}

/* ---------- who may do what ---------- */
const isHOS = u => !!u && u.role === "SECURITY" && u.position === "HOS";
export const clCanEdit = (u, site, d) => !!u && d.canSite(u, site) && (u.role === "ADMIN" || u.role === "MANAGER" || isHOS(u) || (u.role === "SUPERVISOR" && u.position !== "WH"));
export async function clMode(env) {
  const r = await env.DB.prepare("SELECT v FROM meta WHERE k = 'cl:mode'").first().catch(() => null);
  return r && r.v === "hub" ? "hub" : "sheet";
}
async function metaJ(env, k) { const r = await env.DB.prepare("SELECT v FROM meta WHERE k = ?").bind(k).first().catch(() => null); try { return r ? JSON.parse(r.v) : null; } catch { return null; } }
const metaSet = (env, k, v) => env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)").bind(k, typeof v === "string" ? v : JSON.stringify(v)).run();
const daysSince = reg => { if (!/^\d{4}-\d{2}-\d{2}$/.test(reg || "")) return null; const n = Math.floor((Date.parse(new Date().toISOString().slice(0, 10)) - Date.parse(reg)) / 864e5); return n < 0 ? 0 : n; };
const out = (w, full) => ({ id: w.id, name: w.name, nationality: w.nationality, company: w.company, tenant: w.tenant, site: w.site, position: w.position,
  status: w.status, registered: w.registered, days: daysSince(w.registered), photo: !!w.photo_key, idcopy: !!w.idcopy_key,
  ...(full ? { token: w.token, companyPhone: w.company_phone, tenantEmail: w.tenant_email, phone: w.phone, comment: w.comment, updatedAt: w.updated_at, updatedBy: w.updated_by } : {}) });

async function nextId(env) {
  const r = await env.DB.prepare("SELECT id FROM cl_workers").all();
  let max = 0; for (const x of r.results || []) { const m = /(\d+)\s*$/.exec(x.id); if (m) max = Math.max(max, Number(m[1])); }
  return "CLN-" + String(max + 1).padStart(4, "0");
}
async function putImage(env, id, kind, dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(String(dataUrl || ""));
  if (!m) return "";
  const bin = Uint8Array.from(atob(m[2]), c => c.charCodeAt(0));
  if (bin.byteLength > PHOTO_MAX) throw err("The picture is too large");
  const key = `cleaners/${id}/${kind}.jpg`;
  await env.FILES.put(key, bin, { httpMetadata: { contentType: m[1] } });
  return key;
}
async function imageData(env, key) {
  if (!key || !env.FILES) return "";
  const o = await env.FILES.get(key); if (!o) return "";
  const b = new Uint8Array(await o.arrayBuffer()); let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return `data:${(o.httpMetadata && o.httpMetadata.contentType) || "image/jpeg"};base64,${btoa(s)}`;
}
async function blacklistMatch(env, name, phone, exceptId) {
  const n = normName(name), p = normPhone(phone);
  const { results } = await env.DB.prepare("SELECT id, name, phone, tenant, site, comment FROM cl_workers WHERE status = 'Blacklist'").all();
  return (results || []).find(r => r.id !== exceptId && ((n && normName(r.name) === n) || (p && p.length >= 6 && normPhone(r.phone) === p))) || null;
}
const logW = (env, id, site, what, by) => env.DB.prepare("INSERT INTO cl_log (at, worker_id, site, what, by_name) VALUES (?,?,?,?,?)").bind(new Date().toISOString(), id, site, clip(what, 300), clip(by, 120)).run().catch(() => {});

/* ---------- the hub object: ops/cleaners/… ---------- */
export async function cleanRoute(env, p, method, b, url, d) {
  const { me } = d, q = k => url.searchParams.get(k);
  const mySites = d.sitesOf(me);
  const mode = await clMode(env);
  const pick = s => { const c = String(s || "").toUpperCase(); if (c === "ALL") return "ALL"; if (!mySites.includes(c)) throw err("You do not have this flagship", 403); return c; };
  const scope = s => s === "ALL" ? mySites : [s];
  const inS = list => list.map(() => "?").join(",") || "''";

  if (p === "cleaners/context") {
    return { mode, sites: Object.fromEntries(mySites.map(c => [c, d.SITES[c]])), all: mySites.length > 1, canEdit: Object.fromEntries(mySites.map(c => [c, clCanEdit(me, c, d)])),
      isAdmin: me.role === "ADMIN", today: d.today(), statuses: CLEAN_STATUS, migrate: me.role === "ADMIN" ? await metaJ(env, "cl:migrate") : null };
  }
  if (p === "cleaners/overview") {
    const s = pick(q("site") || mySites[0]), list = scope(s), day = /^\d{4}-\d{2}-\d{2}$/.test(q("day") || "") ? q("day") : d.today();
    const [w, a, rows] = await Promise.all([
      env.DB.prepare(`SELECT site, status, COUNT(*) AS n FROM cl_workers WHERE site IN (${inS(list)}) GROUP BY site, status`).bind(...list).all(),
      env.DB.prepare(`SELECT site, COUNT(*) AS n FROM cl_attendance WHERE day = ? AND site IN (${inS(list)}) GROUP BY site`).bind(day, ...list).all(),
      env.DB.prepare(`SELECT * FROM cl_attendance WHERE day = ? AND site IN (${inS(list)}) ORDER BY time DESC LIMIT 400`).bind(day, ...list).all()]);
    const per = Object.fromEntries(list.map(c => [c, { site: c, name: d.SITES[c], Active: 0, Suspended: 0, Blacklist: 0, today: 0 }]));
    for (const r of w.results || []) if (per[r.site]) per[r.site][CLEAN_STATUS.includes(r.status) ? r.status : "Active"] += r.n;
    for (const r of a.results || []) if (per[r.site]) per[r.site].today = r.n;
    return { day, sites: Object.values(per), entries: (rows.results || []).map(r => ({ time: r.time.slice(0, 5), id: r.worker_id, name: r.name, company: r.company, tenant: r.tenant, agent: r.agent, gate: r.gate, site: r.site })) };
  }
  if (p === "cleaners/list") {
    const s = pick(q("site") || mySites[0]), list = scope(s);
    const { results } = await env.DB.prepare(`SELECT * FROM cl_workers WHERE site IN (${inS(list)}) ORDER BY CAST(substr(id, 5) AS INTEGER) DESC`).bind(...list).all();
    return { workers: (results || []).map(w => out(w, clCanEdit(me, w.site, d))) };
  }
  if (p === "cleaners/get") {
    const w = await env.DB.prepare("SELECT * FROM cl_workers WHERE id = ?").bind(clip(q("id"), 20)).first();
    if (!w || !mySites.includes(w.site)) throw err("Not found", 404);
    const [hist, log] = await Promise.all([
      env.DB.prepare("SELECT day, time, agent, gate FROM cl_attendance WHERE worker_id = ? ORDER BY day DESC, time DESC LIMIT 60").bind(w.id).all(),
      env.DB.prepare("SELECT at, what, by_name FROM cl_log WHERE worker_id = ? ORDER BY id DESC LIMIT 30").bind(w.id).all()]);
    return { worker: { ...out(w, true), passUrl: `${d.hubUrl}/cp?id=${encodeURIComponent(w.id)}&t=${encodeURIComponent(w.token)}` },
      canEdit: clCanEdit(me, w.site, d), history: hist.results || [], log: log.results || [] };
  }
  if (p === "cleaners/img") {   // photo / ID copy for a signed-in hub user of that flagship
    const w = await env.DB.prepare("SELECT site, photo_key, idcopy_key FROM cl_workers WHERE id = ?").bind(clip(q("id"), 20)).first();
    if (!w || !mySites.includes(w.site)) throw err("Not found", 404);
    const key = q("kind") === "idcopy" ? w.idcopy_key : w.photo_key;
    const o = key && env.FILES ? await env.FILES.get(key) : null;
    if (!o) throw err("Not found", 404);
    return new Response(o.body, { headers: { "content-type": (o.httpMetadata && o.httpMetadata.contentType) || "image/jpeg", "cache-control": "private, max-age=600" } });
  }
  if (p === "cleaners/attendance") {
    const s = pick(q("site") || mySites[0]), list = scope(s);
    const from = /^\d{4}-\d{2}-\d{2}$/.test(q("from") || "") ? q("from") : d.today(), to = /^\d{4}-\d{2}-\d{2}$/.test(q("to") || "") ? q("to") : from;
    const { results } = await env.DB.prepare(`SELECT * FROM cl_attendance WHERE day BETWEEN ? AND ? AND site IN (${inS(list)}) ORDER BY day DESC, time DESC LIMIT 5000`).bind(from, to, ...list).all();
    return { from, to, rows: (results || []).map(r => ({ day: r.day, time: r.time.slice(0, 5), id: r.worker_id, name: r.name, company: r.company, tenant: r.tenant, agent: r.agent, gate: r.gate, site: r.site })) };
  }
  if (p === "cleaners/tenants") {
    const s = pick(q("site") || mySites[0]), list = scope(s);
    const [t, v] = await Promise.all([
      env.DB.prepare(`SELECT site, tenant, MAX(tenant_email) AS email, COUNT(*) AS n, SUM(CASE WHEN status = 'Active' THEN 1 ELSE 0 END) AS active FROM cl_workers
        WHERE site IN (${inS(list)}) GROUP BY site, tenant ORDER BY tenant`).bind(...list).all(),
      env.DB.prepare(`SELECT * FROM cl_verify_log WHERE site IN (${inS(list)}) ORDER BY id DESC LIMIT 200`).bind(...list).all()]);
    return { tenants: t.results || [], log: v.results || [] };
  }
  if (p === "cleaners/report-cfg" && method === "GET") {
    const s = pick(q("site") || mySites[0]); if (s === "ALL") throw err("Choose a flagship");
    const cfg = (await metaJ(env, "cl:report")) || {}, og = (await d.opsGroups(env))[s] || { emails: [] };
    const { results } = await env.DB.prepare("SELECT email, full_name, position FROM users WHERE active = 1 AND role = 'SECURITY' AND (site_code = ? OR position = 'HOS') ORDER BY full_name").bind(s).all();
    return { site: s, cfg: cfg[s] || { to: [], cc: [], empty: true }, opsGroup: og.emails, security: results || [], canEdit: clCanEdit(me, s, d) };
  }

  /* ----- changes ----- */
  if (method !== "POST") throw err("Unknown request", 404);
  if (p === "cleaners/report-cfg") {
    const s = pick(b.site); if (s === "ALL" || !clCanEdit(me, s, d)) throw err("Not allowed", 403);
    const list = v => [...new Set(String(v || "").split(/[\s,;]+/).map(e => e.trim().toLowerCase()).filter(Boolean))];
    const to = list(b.to), cc = list(b.cc), bad = [...to, ...cc].find(e => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
    if (bad) throw err("Not a valid email: " + bad);
    const cfg = (await metaJ(env, "cl:report")) || {}; cfg[s] = { to: to.slice(0, 5), cc: cc.slice(0, 8), empty: b.empty !== false };
    await metaSet(env, "cl:report", cfg);
    return { cfg: cfg[s] };
  }
  if (p === "cleaners/report-test") {
    const s = pick(b.site); if (s === "ALL") throw err("Choose a flagship");
    return dailyReport(env, d, s, d.today(), { testTo: me.email });
  }
  if (p === "cleaners/migrate") return migrateStep(env, d, b, me);
  if (p === "cleaners/mode") {
    if (me.role !== "ADMIN") throw err("Administrators only", 403);
    const to = b.mode === "hub" ? "hub" : "sheet";
    if (to === "hub") {
      const m = (await metaJ(env, "cl:migrate")) || {};
      if (!m.workersDone || !m.imagesDone || !m.attDone) throw err("Copy everything from the sheet first (step 1)");
    }
    await metaSet(env, "cl:mode", to);
    await d.audit(env, { me, site: "", tool: "cleaners", ref: "mode", label: to === "hub" ? "Cleaner Access switched to the hub" : "Cleaner Access switched back to the sheet", action: "mode", changes: [] }).catch(() => {});
    return { mode: to };
  }
  if (mode !== "hub") throw err("Until the switch, cleaners are registered in the old system — this is a copy", 409);
  if (p === "cleaners/save") {
    const isNew = !b.id;
    const old = isNew ? null : await env.DB.prepare("SELECT * FROM cl_workers WHERE id = ?").bind(clip(b.id, 20)).first();
    if (!isNew && !old) throw err("Not found", 404);
    const site = isNew ? pick(b.site) : old.site;
    if (site === "ALL" || !clCanEdit(me, site, d)) throw err("Not allowed", 403);
    const f = { name: clip(b.name, 120), nationality: clip(b.nationality, 60), company: clip(b.company, 120), company_phone: clip(b.companyPhone, 40),
      tenant: clip(b.tenant, 120), tenant_email: clip(b.tenantEmail, 120).toLowerCase(), position: clip(b.position, 60) || "Cleaner", phone: clip(b.phone, 40), comment: clip(b.comment, 300) };
    if (!f.name || !f.tenant) throw err("Name and tenant are needed");
    if (f.tenant_email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.tenant_email)) throw err("The tenant email is not valid");
    const black = await blacklistMatch(env, f.name, f.phone, old && old.id);
    if (black && (isNew || (old && old.status !== "Blacklist"))) throw err(`Blocked — this person is BLACKLISTED (${black.id} · ${black.tenant} · ${d.SITES[black.site] || black.site}). Reason: ${black.comment || "not given"}`, 409);
    const now = new Date().toISOString(), by = me.full_name || me.email;
    let id = old && old.id;
    if (isNew) {
      if (!b.photo) throw err("Take the cleaner's photo");
      id = await nextId(env);
      await env.DB.prepare(`INSERT INTO cl_workers (id, token, name, nationality, company, company_phone, tenant, tenant_email, site, position, phone, status, comment, registered, source, created_by, updated_at, updated_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,'Active',?,?, 'hub', ?, ?, ?)`).bind(id, newToken(), f.name, f.nationality, f.company, f.company_phone, f.tenant, f.tenant_email, site, f.position, f.phone, f.comment, d.today(), by, now, by).run();
    } else {
      await env.DB.prepare(`UPDATE cl_workers SET name=?, nationality=?, company=?, company_phone=?, tenant=?, tenant_email=?, position=?, phone=?, comment=?, updated_at=?, updated_by=? WHERE id=?`)
        .bind(f.name, f.nationality, f.company, f.company_phone, f.tenant, f.tenant_email, f.position, f.phone, f.comment, now, by, id).run();
    }
    if (b.photo) await env.DB.prepare("UPDATE cl_workers SET photo_key = ? WHERE id = ?").bind(await putImage(env, id, "photo", b.photo), id).run();
    if (b.idcopy) await env.DB.prepare("UPDATE cl_workers SET idcopy_key = ? WHERE id = ?").bind(await putImage(env, id, "idcopy", b.idcopy), id).run();
    if (b.tenantEmail !== undefined && f.tenant_email)   // one email per tenant at the flagship
      await env.DB.prepare("UPDATE cl_workers SET tenant_email = ? WHERE site = ? AND lower(tenant) = lower(?)").bind(f.tenant_email, site, f.tenant).run();
    await logW(env, id, site, isNew ? "Registered" : "Details changed", by);
    return { id };
  }
  if (p === "cleaners/status") {
    const w = await env.DB.prepare("SELECT * FROM cl_workers WHERE id = ?").bind(clip(b.id, 20)).first();
    if (!w) throw err("Not found", 404);
    if (!clCanEdit(me, w.site, d)) throw err("Not allowed", 403);
    const st = CLEAN_STATUS.includes(b.status) ? b.status : null; if (!st) throw err("Choose the status");
    const c = clip(b.comment, 300);
    if (st !== "Active" && !c) throw err("Write the reason");
    await env.DB.prepare("UPDATE cl_workers SET status = ?, comment = ?, updated_at = ?, updated_by = ? WHERE id = ?").bind(st, c, new Date().toISOString(), me.full_name, w.id).run();
    await logW(env, w.id, w.site, `${w.status} → ${st}${c ? " · " + c : ""}`, me.full_name);
    if (st === "Blacklist" && d.raiseEvent) await d.raiseEvent(env, { site: w.site, app: "cleaner-qr", tone: "alert", title: `Cleaner blacklisted · ${w.name}`, body: `${w.id} · ${w.tenant} · ${c}` }).catch(() => {});
    return { status: st };
  }
  if (p === "cleaners/tenant-email") {
    const s = pick(b.site); if (s === "ALL" || !clCanEdit(me, s, d)) throw err("Not allowed", 403);
    const e = clip(b.email, 120).toLowerCase(); if (e && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw err("Not a valid email");
    const r = await env.DB.prepare("UPDATE cl_workers SET tenant_email = ? WHERE site = ? AND tenant = ?").bind(e, s, clip(b.tenant, 120)).run();
    return { changed: r.meta.changes };
  }
  if (p === "cleaners/new-token") {   // a lost or copied badge: the old QR stops working
    const w = await env.DB.prepare("SELECT * FROM cl_workers WHERE id = ?").bind(clip(b.id, 20)).first();
    if (!w || !clCanEdit(me, w.site, d)) throw err("Not allowed", 403);
    await env.DB.prepare("UPDATE cl_workers SET token = ? WHERE id = ?").bind(newToken(), w.id).run();
    await logW(env, w.id, w.site, "New QR — the old badge no longer works", me.full_name);
    return { done: true };
  }
  throw err("Unknown request", 404);
}

/* ---------- the QR: who scanned it ---------- */
const findPass = (env, id, t) => env.DB.prepare("SELECT * FROM cl_workers WHERE id = ? AND token = ?").bind(clip(id, 20), clip(t, 20)).first();
/* any phone camera: an information card, nothing private, no actions */
export async function cleanPublic(env, url, d) {
  const w = await findPass(env, url.searchParams.get("id"), url.searchParams.get("t"));
  if (!w) return { valid: false };
  return { valid: true, name: w.name, id: w.id, position: w.position, status: w.status, tenant: w.tenant, company: w.company, siteName: d.SITES[w.site] || w.site,
    days: daysSince(w.registered), registered: w.registered, photo: w.status === "Blacklist" ? "" : await imageData(env, w.photo_key) };
}
/* the Loading Gate app of a flagship: full pass + check-in; another flagship's cleaner: who it is + "no access here" */
export async function cleanGate(env, p, method, b, url, d) {
  const site = d.site, agent = clip(d.agent, 60), gate = clip(d.device, 80);
  if ((await clMode(env)) !== "hub") throw err("Cleaner check-in moves to this app on the switch day — until then use the cleaner pass page", 409);
  const id = method === "POST" ? b.id : url.searchParams.get("id"), t = method === "POST" ? b.t : url.searchParams.get("t");
  const w = await findPass(env, id, t);
  if (!w) return { found: false };
  const today = d.today();
  const done = await env.DB.prepare("SELECT time, agent, gate FROM cl_attendance WHERE day = ? AND worker_id = ?").bind(today, w.id).first();
  const here = w.site === site;
  if (p === "cleaner") {
    if (!here) return { found: true, here: false, siteName: d.SITES[w.site] || w.site, gateSite: d.SITES[site] || site,
      worker: { id: w.id, name: w.name, tenant: w.tenant, company: w.company, position: w.position, status: w.status }, photo: await imageData(env, w.photo_key) };
    return { found: true, here: true, worker: { ...out(w, false), companyPhone: w.company_phone, comment: w.status === "Active" ? "" : w.comment },
      photo: await imageData(env, w.photo_key), idcopy: await imageData(env, w.idcopy_key), checkedIn: done ? { time: done.time.slice(0, 5), agent: done.agent } : null };
  }
  if (p === "cleaner-in" && method === "POST") {
    if (!here) throw err(`No access at ${d.SITES[site]} — registered at ${d.SITES[w.site]}`, 403);
    if (w.status === "Blacklist") throw err("ACCESS DENIED — this person is blacklisted. Do not allow entry.", 403);
    if (w.status !== "Active") throw err(`This pass is ${w.status}. No entry until it is renewed.`, 403);
    if (!agent) throw err("Write your name first");
    if (done) return { duplicate: true, time: done.time.slice(0, 5), agent: done.agent };
    const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Beirut", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date());
    await env.DB.prepare("INSERT OR IGNORE INTO cl_attendance (day, time, worker_id, site, name, company, tenant, agent, gate, source) VALUES (?,?,?,?,?,?,?,?,?, 'gate')")
      .bind(today, time, w.id, w.site, w.name, w.company, w.tenant, agent, gate).run();
    return { duplicate: false, time: time.slice(0, 5), agent };
  }
  throw err("Unknown request", 404);
}

/* ---------- End of Day report: the day's entries of a flagship (same shape as the Apps Script hubDay) ---------- */
export async function cleanDay(env, site, day) {
  const { results } = await env.DB.prepare("SELECT * FROM cl_attendance WHERE site = ? AND day = ? ORDER BY time").bind(site, day).all();
  const recs = results || [], byCompany = {}, byTenant = {}, label = {};
  const norm = s => { const t = String(s || "").trim() || "—", k = t.toLowerCase().replace(/\s+/g, " "); return label[k] || (label[k] = t); };
  for (const r of recs) { const co = norm(r.company), tn = norm(r.tenant); byCompany[co] = (byCompany[co] || 0) + 1; byTenant[tn] = (byTenant[tn] || 0) + 1; }
  return { date: day, site, count: new Set(recs.map(r => r.worker_id)).size, entries: recs.length, byCompany, byTenant,
    names: recs.map(r => r.name), list: recs.map(r => ({ time: r.time.slice(0, 5), name: r.name, company: r.company, tenant: r.tenant, agent: r.agent })) };
}

/* ---------- emails (Outlook) ---------- */
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmtDay = day => new Date(day + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const FROM = "salaachi@abc.com.lb";
const shell = (title, sub, body) => `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:760px;margin:0 auto;border:1px solid #E6E0EE;border-radius:12px;overflow:hidden;color:#221A2E">
  <div style="background:#2A0F45;padding:18px 22px"><div style="color:#fff;font-size:16px;font-weight:bold;letter-spacing:1px">${esc(title)}</div><div style="color:#E9CF8A;font-size:12px;letter-spacing:1px;margin-top:4px">${esc(sub)}</div></div>
  <div style="padding:20px 22px">${body}</div></div>`;
const stat = (n, l) => `<td style="padding:10px;border:1px solid #EEE8F4;border-top:3px solid #C8A24A;text-align:center"><div style="font-size:22px;font-weight:bold">${n}</div><div style="font-size:10px;letter-spacing:1px;color:#6D6479">${l}</div></td>`;
const th = t => `<th style="padding:7px 9px;text-align:left;font-size:11px;background:#2A0F45;color:#fff">${t}</th>`, td = t => `<td style="padding:7px 9px;border-bottom:1px solid #EEE8F4;font-size:13px">${esc(t || "—")}</td>`;

export async function dailyReport(env, d, site, day, o = {}) {
  const cfg = ((await metaJ(env, "cl:report")) || {})[site] || { to: [], cc: [], empty: true };
  const og = ((await d.opsGroups(env))[site] || { emails: [] }).emails || [];
  const to = o.testTo ? [o.testTo] : cfg.to, cc = o.testTo ? [] : [...new Set([...og, ...(cfg.cc || [])])].filter(e => !to.includes(e));
  if (!to.length) return { sent: false, why: "No security supervisor set for this flagship" };
  const r = await cleanDay(env, site, day);
  if (!r.entries && cfg.empty === false && !o.testTo) return { sent: false, why: "No entries" };
  const name = d.SITES[site], short = String(name).replace(/^ABC\s+/i, "");
  const rows = r.list.map((x, i) => `<tr style="background:${i % 2 ? "#FAF8FC" : "#fff"}">${td(x.time)}${td(x.name)}${td(x.company)}${td(x.tenant)}${td(x.agent)}</tr>`).join("")
    || `<tr><td colspan="5" style="padding:16px;text-align:center;color:#6D6479">No cleaner entries were recorded today.</td></tr>`;
  const html = shell("ABC " + short.toUpperCase(), "DAILY CLEANER ENTRY REPORT · " + fmtDay(day).toUpperCase(),
    `<table style="width:100%;border-collapse:collapse;margin-bottom:16px"><tr>${stat(r.count, "CLEANERS")}${stat(r.entries, "ENTRIES")}${stat(Object.keys(r.byTenant).length, "TENANTS")}${stat(Object.keys(r.byCompany).length, "COMPANIES")}</tr></table>
     <table style="width:100%;border-collapse:collapse"><tr>${th("Time")}${th("Name")}${th("Company")}${th("Tenant")}${th("Agent")}</tr>${rows}</table>
     <p style="color:#6D6479;font-size:11px;margin-top:16px">Automated report — Cleaner Access, ABC Operations Hub.</p>`);
  const subject = `${o.testTo ? "[TEST] " : ""}ABC ${short} — Cleaner entries — ${fmtDay(day)} (${r.count} cleaner${r.count === 1 ? "" : "s"})`;
  const s = await d.outlookSend(env, { from: FROM, to, cc, subject, html }).catch(e => ({ ok: false, error: e.message }));
  return s && s.ok ? { sent: true, to, cc } : { sent: false, why: (s && s.error) || "Outlook is not connected in the hub" };
}
async function monthlyVerification(env, d, site) {
  const og = ((await d.opsGroups(env))[site] || { emails: [] }).emails || [];
  const { results } = await env.DB.prepare("SELECT * FROM cl_workers WHERE site = ? AND status != 'Blacklist' AND tenant_email != '' ORDER BY tenant, name").bind(site).all();
  const groups = {};
  for (const w of results || []) { const k = w.tenant_email + "|" + w.tenant; (groups[k] = groups[k] || { email: w.tenant_email, tenant: w.tenant, list: [] }).list.push(w); }
  const name = d.SITES[site], short = String(name).replace(/^ABC\s+/i, "");
  let sent = 0;
  for (const g of Object.values(groups)) {
    const rows = g.list.map((w, i) => `<tr style="background:${i % 2 ? "#FAF8FC" : "#fff"}">${td(String(i + 1))}${td(w.id)}${td(w.name)}${td(w.company)}${td(w.status)}</tr>`).join("");
    const html = shell("ABC OPERATIONS", "MONTHLY CLEANER ACCESS VERIFICATION",
      `<p>Dear Valued Partner,</p><p>As part of our monthly access review at <b>${esc(name)}</b>, kindly verify that the cleaners listed below are still engaged by <b>${esc(g.tenant)}</b> and should keep their QR access passes:</p>
       <table style="width:100%;border-collapse:collapse;margin:14px 0"><tr>${th("#")}${th("Pass")}${th("Cleaner")}${th("Company")}${th("Status")}</tr>${rows}</table>
       <p>Please <b>reply to this email within 5 business days</b>, confirming the list or telling us of any change (removals, replacements or new staff).</p>
       <p style="background:#FBF7EC;border-left:3px solid #C8A24A;padding:10px 14px"><b>Please note:</b> without a reply in that period, the listed passes will be <b>suspended</b> until the verification is completed.</p>
       <p>Thank you for your cooperation.</p><p>Best regards,<br><b>Mall Operations — ABC ${esc(short)}</b></p>`);
    const s = await d.outlookSend(env, { from: FROM, to: [g.email], cc: og, subject: `ABC ${short} — ${g.tenant} Monthly Cleaner Verification`, html }).catch(() => null);
    await env.DB.prepare("INSERT INTO cl_verify_log (at, site, tenant, email, count, names, via) VALUES (?,?,?,?,?,?,?)")
      .bind(new Date().toISOString(), site, g.tenant, g.email, g.list.length, g.list.map(w => w.name).join(", ").slice(0, 2000), s && s.ok ? "outlook" : "not sent").run();
    if (s && s.ok) sent++;
  }
  return sent;
}
/* cron (every 2 minutes): 21:00 daily reports · the last day of the month at 10:00, the verification emails — only once switched to the hub */
export async function cleanRun(env, d) {
  if ((await clMode(env)) !== "hub") return;
  const day = d.today(), h = d.hour();
  const claim = async k => { const r = await env.DB.prepare("INSERT OR IGNORE INTO meta (k, v) VALUES (?, '1')").bind(k).run().catch(() => null); return !!(r && r.meta && r.meta.changes === 1); };
  if (h === 21) for (const s of Object.keys(d.SITES)) if (await claim(`cl:daily:${day}:${s}`)) await dailyReport(env, d, s, day).catch(e => console.error("cl daily", e && e.message));
  const tomorrow = new Date(Date.parse(day + "T12:00:00Z") + 864e5).toISOString().slice(0, 10);
  if (h === 10 && tomorrow.slice(8) === "01") for (const s of Object.keys(d.SITES)) if (await claim(`cl:verify:${day.slice(0, 7)}:${s}`)) await monthlyVerification(env, d, s).catch(e => console.error("cl verify", e && e.message));
}

/* ---------- migration from the Google Sheet (Apps Script action hubExport, protected by the HUB key) ---------- */
async function sheet(env, params) {
  if (!env.CLEANER_SHEET_URL) throw err("The Cleaner sheet is not connected (CLEANER_SHEET_URL)");
  const u = new URL(env.CLEANER_SHEET_URL);
  u.searchParams.set("action", "hubExport"); u.searchParams.set("key", env.CLEANER_SHEET_KEY || "");
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const r = await fetch(u.toString(), { redirect: "follow", signal: AbortSignal.timeout(25000) });
  const j = await r.json().catch(() => null);
  if (!j) throw err("The Apps Script did not answer — add the hubExport code and deploy a new version (see the steps)");
  if (!j.ok) throw err("Apps Script: " + (j.error || "error"));
  return j.data;
}
async function migrateStep(env, d, b, me) {
  if (me.role !== "ADMIN") throw err("Administrators only", 403);
  const st = (await metaJ(env, "cl:migrate")) || {};
  if (["workers", "images", "verifylog"].includes(b.step) && (await clMode(env)) === "hub") throw err("Already switched to the hub — the sheet is only a backup now");
  const save = () => metaSet(env, "cl:migrate", { ...st, at: new Date().toISOString(), by: me.full_name });
  if (b.step === "workers") {   // every row of the Workers tab (new ones added, existing ones updated)
    const rows = await sheet(env, { part: "workers" });
    const ops = [];
    for (const x of rows) {
      const id = clip(x.id, 20), site = siteOfMall(x.mall);
      if (!/^CLN-\d+$/.test(id) || !site) continue;
      const status = CLEAN_STATUS.find(s => s.toLowerCase() === String(x.status || "").toLowerCase()) || "Active";
      ops.push(env.DB.prepare(`INSERT INTO cl_workers (id, token, name, nationality, company, company_phone, tenant, tenant_email, site, position, phone, status, comment, registered, source, created_by, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'sheet', 'Cleaner sheet', ?)
        ON CONFLICT(id) DO UPDATE SET token = CASE WHEN cl_workers.source = 'sheet' THEN excluded.token ELSE cl_workers.token END, name = excluded.name, nationality = excluded.nationality,
          company = excluded.company, company_phone = excluded.company_phone, tenant = excluded.tenant, tenant_email = excluded.tenant_email, site = excluded.site,
          position = excluded.position, phone = excluded.phone, status = excluded.status, comment = excluded.comment, registered = excluded.registered
        WHERE cl_workers.source = 'sheet'`)
        .bind(id, clip(x.token, 20) || newToken(), clip(x.name, 120) || id, clip(x.nationality, 60), clip(x.company, 120), clip(x.companyPhone, 40), clip(x.tenant, 120),
          clip(x.tenantEmail, 120).toLowerCase(), site, clip(x.position, 60) || "Cleaner", clip(x.phone, 40), status, clip(x.comment, 300),
          /^\d{4}-\d{2}-\d{2}/.test(x.registered || "") ? String(x.registered).slice(0, 10) : "", new Date().toISOString()));
    }
    for (let i = 0; i < ops.length; i += 50) await env.DB.batch(ops.slice(i, i + 50));
    Object.assign(st, { workersDone: true, sheetWorkers: rows.length, skipped: rows.length - ops.length }); await save();
    return { workers: ops.length, skipped: rows.length - ops.length };
  }
  if (b.step === "images") {   // three cleaners per call (photos + ID copies → R2)
    const { results } = await env.DB.prepare("SELECT id FROM cl_workers WHERE source = 'sheet' AND images_at = '' ORDER BY id LIMIT 3").all();
    for (const r of results || []) {
      const img = await sheet(env, { part: "images", id: r.id });
      const pk = img.photo ? await putImage(env, r.id, "photo", img.photo).catch(() => "") : "", ik = img.idcopy ? await putImage(env, r.id, "idcopy", img.idcopy).catch(() => "") : "";
      await env.DB.prepare("UPDATE cl_workers SET photo_key = CASE WHEN ? != '' THEN ? ELSE photo_key END, idcopy_key = CASE WHEN ? != '' THEN ? ELSE idcopy_key END, images_at = ? WHERE id = ?")
        .bind(pk, pk, ik, ik, new Date().toISOString(), r.id).run();
    }
    const left = Number((await env.DB.prepare("SELECT COUNT(*) AS n FROM cl_workers WHERE source = 'sheet' AND images_at = ''").first()).n);
    if (!left) { st.imagesDone = true; await save(); }
    return { done: (results || []).length, left };
  }
  if (b.step === "attendance") {   // one week per call, from 9 Jul 2026 to today (already copied days are skipped by the database)
    const from = /^\d{4}-\d{2}-\d{2}$/.test(b.from || "") ? b.from : "2026-07-01";
    const to = new Date(Date.parse(from + "T12:00:00Z") + 6 * 864e5).toISOString().slice(0, 10);
    const rows = await sheet(env, { part: "attendance", from, to });
    const ops = rows.filter(x => /^CLN-\d+$/.test(String(x.id)) && siteOfMall(x.mall) && /^\d{4}-\d{2}-\d{2}$/.test(String(x.date))).map(x =>
      env.DB.prepare("INSERT OR IGNORE INTO cl_attendance (day, time, worker_id, site, name, company, tenant, agent, gate, source) VALUES (?,?,?,?,?,?,?,?, '', 'sheet')")
        .bind(x.date, String(x.time || "").padStart(8, "0").slice(0, 8), String(x.id), siteOfMall(x.mall), clip(x.name, 120), clip(x.company, 120), clip(x.tenant, 120), clip(x.agent, 60)));
    for (let i = 0; i < ops.length; i += 50) await env.DB.batch(ops.slice(i, i + 50));
    const next = new Date(Date.parse(to + "T12:00:00Z") + 864e5).toISOString().slice(0, 10), done = next > d.today();
    if (done) { st.attDone = true; st.attUntil = d.today(); await save(); }
    return { from, to, rows: ops.length, next: done ? null : next };
  }
  if (b.step === "verifylog") {
    const rows = await sheet(env, { part: "verifylog" });
    await env.DB.prepare("DELETE FROM cl_verify_log WHERE via = 'sheet'").run();
    const ops = rows.filter(x => siteOfMall(x.mall)).map(x => env.DB.prepare("INSERT INTO cl_verify_log (at, site, tenant, email, count, names, via) VALUES (?,?,?,?,?,?, 'sheet')")
      .bind(clip(x.at, 30), siteOfMall(x.mall), clip(x.tenant, 120), clip(x.email, 120), Number(x.count) || 0, clip(x.names, 2000)));
    for (let i = 0; i < ops.length; i += 50) await env.DB.batch(ops.slice(i, i + 50));
    st.logDone = true; await save();
    return { rows: ops.length };
  }
  if (b.step === "compare") {   // the hub's copy against the sheet, flagship by flagship
    const rows = await sheet(env, { part: "workers" });
    const sheetW = {}; for (const x of rows) { const s = siteOfMall(x.mall); if (s) sheetW[s] = (sheetW[s] || 0) + 1; }
    const att = await sheet(env, { part: "count" }).catch(() => null);
    const [hw, ha, hi] = await Promise.all([
      env.DB.prepare("SELECT site, COUNT(*) AS n FROM cl_workers GROUP BY site").all(),
      env.DB.prepare("SELECT site, COUNT(*) AS n FROM cl_attendance GROUP BY site").all(),
      env.DB.prepare("SELECT COUNT(*) AS n, SUM(CASE WHEN photo_key != '' THEN 1 ELSE 0 END) AS p, SUM(CASE WHEN idcopy_key != '' THEN 1 ELSE 0 END) AS i FROM cl_workers").first()]);
    const H = Object.fromEntries((hw.results || []).map(r => [r.site, r.n])), A = Object.fromEntries((ha.results || []).map(r => [r.site, r.n]));
    const sheetA = {}; if (att && att.byMall) for (const [m, n] of Object.entries(att.byMall)) { const s = siteOfMall(m); if (s) sheetA[s] = (sheetA[s] || 0) + n; }
    const sites = Object.keys(d.SITES).map(s => ({ site: s, name: d.SITES[s], sheetWorkers: sheetW[s] || 0, hubWorkers: H[s] || 0, sheetEntries: att ? sheetA[s] || 0 : null, hubEntries: A[s] || 0 }));
    const ok = sites.every(x => x.sheetWorkers === x.hubWorkers && (x.sheetEntries == null || x.sheetEntries <= x.hubEntries));
    st.compare = { at: new Date().toISOString(), ok }; await save();
    return { sites, ok, photos: hi.p || 0, idcopies: hi.i || 0, total: hi.n || 0 };
  }
  throw err("Unknown step");
}
