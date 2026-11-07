/* =====================================================================
   MEMO (Nov 2026, Upcoming - Testing) — docs/FEATURE-memo.md
   Official memos from the operations team to tenants.
   • A memo = subject + text + one attachment (optional), numbered per flagship (VRM-2026-001).
   • Response asked: Acknowledge (one button) or Reply (text + a file).
   • Audience = open tenants (GLA) filtered by category, sub-category, mall level, CRM handheld, Direct Banking, or picked one by one.
     Each tenant (one per shop) gets its own email with a personal link (/memo/<token>, no account), sent to:
       – Tenants Directory contacts (by position) and
       – the Tenant Portal Database (portal users at Shop / Brand / Company / Group level of that shop).
   • Reminders: automatic every N days, up to M times (2 days × 3 by default, changeable per memo, or off) + "Remind now".
   • Board: acknowledged / replied / waiting / no email per flagship, the replies with their files, export.
   Routes: /api/ops/memo/* (hub) · /api/memo-ext/<token>[/file|/rfile|/answer] (tenant link)
   ===================================================================== */
import { portalAudience, PORTAL_LEVELS } from "./portal.js";

const err = (m, status = 400) => Object.assign(new Error(m), { status });
const clip = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
const txt = (v, n) => String(v == null ? "" : v).replace(/\r/g, "").trim().slice(0, n);
const escH = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const norm = s => String(s || "").toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, "");
const bare = s => String(s || "").replace(/(\s+(TA|OT|TS|kiosk|\d+))+\s*$/i, "");
const isDay = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));
const token = () => [...crypto.getRandomValues(new Uint8Array(18))].map(b => "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"[b % 57]).join("");
const cleanEmails = v => [...new Set(String(v || "").split(/[\s,;]+/).map(x => x.trim().toLowerCase()).filter(x => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)))].slice(0, 40).join(", ");
const longDay = d => d ? new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "";
const addDays = (d, n) => new Date(Date.parse(d + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const MAX_FILE = 8 * 1024 * 1024;
const TYPES = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
export const MEMO_CATS = ["Operations", "Security & Safety", "Marketing", "Finance", "Fit-out & Works", "Cleaning", "General"];

/* tenant category from the GLA sub-category (department) */
export function catOf(dept) {
  const d = String(dept || "").toLowerCase();
  if (!d) return "Other";
  if (/restau|food|f\s*&\s*b|cafe|café|coffee|bakery/.test(d)) return "Food & Beverage";
  if (/cosmetic|fragrance|beaut|perfum/.test(d)) return "Beauty & Cosmetics";
  if (/toy/.test(d)) return "Kids & Toys";
  if (/home|decor|furnit/.test(d)) return "Home";
  if (/electronic|gadget|mobile|phone/.test(d)) return "Electronics";
  if (/cinema|entertain|leisure|fitness|gym|game/.test(d)) return "Entertainment & Leisure";
  if (/bank|financ|atm|exchange/.test(d)) return "Banks & Finance";
  if (/service/.test(d)) return "Services";
  if (/wear|lingerie|underwear|fashion|shoe|leather|luggage|accessor|jewel|watch|optic|unisex|sport/.test(d)) return "Fashion & Accessories";
  if (/gift|various|book|stationer/.test(d)) return "Gifts & Various";
  return "Other";
}

export async function memoSchema(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS memo_memos (id INTEGER PRIMARY KEY AUTOINCREMENT, ref TEXT NOT NULL DEFAULT '', sites TEXT NOT NULL DEFAULT '[]',
      title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', cat TEXT NOT NULL DEFAULT '', mode TEXT NOT NULL DEFAULT 'ack', reply_by TEXT NOT NULL DEFAULT '',
      file_key TEXT NOT NULL DEFAULT '', file_name TEXT NOT NULL DEFAULT '', file_type TEXT NOT NULL DEFAULT '', filt TEXT NOT NULL DEFAULT '{}',
      auto INTEGER NOT NULL DEFAULT 1, every INTEGER NOT NULL DEFAULT 2, max_rem INTEGER NOT NULL DEFAULT 3,
      created_by TEXT NOT NULL DEFAULT '', created_email TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT '', sent_day TEXT NOT NULL DEFAULT '', closed_at TEXT NOT NULL DEFAULT '')`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS memo_targets (id INTEGER PRIMARY KEY AUTOINCREMENT, memo_id INTEGER NOT NULL, site TEXT NOT NULL, brand TEXT NOT NULL,
      units TEXT NOT NULL DEFAULT '', dept TEXT NOT NULL DEFAULT '', floors TEXT NOT NULL DEFAULT '', emails TEXT NOT NULL DEFAULT '', token TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT '', answered_at TEXT NOT NULL DEFAULT '', answered_by TEXT NOT NULL DEFAULT '', reply TEXT NOT NULL DEFAULT '',
      reply_key TEXT NOT NULL DEFAULT '', reply_name TEXT NOT NULL DEFAULT '', reply_type TEXT NOT NULL DEFAULT '',
      mails INTEGER NOT NULL DEFAULT 0, reminders INTEGER NOT NULL DEFAULT 0, last_mail TEXT NOT NULL DEFAULT '', opened_at TEXT NOT NULL DEFAULT '')`),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS memo_targets_token ON memo_targets (token)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS memo_targets_m ON memo_targets (memo_id, site)")
  ]);
}

/* ---------- audience ---------- */
async function tenantsOf(env, site) {
  const units = (await env.DB.prepare("SELECT id, code, level, brand, dept, status FROM gla_units WHERE site = ? AND active = 1 AND section = 'Leasing' AND brand != '' ORDER BY seq, id").bind(site).all()).results || [];
  const crm = (await env.DB.prepare("SELECT unit_id, sheet_name FROM crm_rows WHERE site = ? AND cont = 0 AND (serial != '' OR model != '' OR sku != '')").bind(site).all().catch(() => ({ results: [] }))).results || [];
  const db = (await env.DB.prepare("SELECT tenant FROM dbank_machines WHERE site = ?").bind(site).all().catch(() => ({ results: [] }))).results || [];
  const crmU = new Set(crm.map(r => r.unit_id).filter(Boolean)), crmN = new Set(crm.map(r => norm(bare(r.sheet_name))).filter(Boolean)), dbN = new Set(db.map(r => norm(bare(r.tenant))).filter(Boolean));
  const by = new Map();
  for (const u of units) {
    if (/vacant/i.test(u.brand) || /vacant|termin/i.test(u.status) || /^vacant|warehouse/i.test(u.dept || "")) continue;
    const k = norm(u.brand);
    const t = by.get(k) || { site, brand: clip(u.brand, 100), dept: u.dept || "", units: [], ids: new Set(), floors: new Set() };
    t.units.push(u.code); t.ids.add(u.id); if (u.level) t.floors.add(u.level); by.set(k, t);
  }
  return [...by.values()].map(t => ({ ...t, cat: catOf(t.dept), crm: [...t.ids].some(i => crmU.has(i)) || crmN.has(norm(bare(t.brand))) || crmN.has(norm(t.brand)),
    dbank: dbN.has(norm(bare(t.brand))) || dbN.has(norm(t.brand)) }));
}
const pass = (t, f) => (!f.cats.length || f.cats.includes(t.cat)) && (!f.depts.length || f.depts.includes(t.dept)) && (!f.floors.length || [...t.floors].some(x => f.floors.includes(x)))
  && (!f.crm || (f.crm === "yes") === t.crm) && (!f.dbank || (f.dbank === "yes") === t.dbank)
  && (!f.contract || (f.contract === "crm" ? t.crm : f.contract === "dbank" ? t.dbank : t.crm && t.dbank));   // Contract Terms: CRM · Direct Banking · both
async function audience(env, d, sites, f) {
  const P = f.positions.map(x => x.toLowerCase()), PA = f.levels.length ? await portalAudience(env, d.SITES, d.today()).catch(() => null) : null;
  const out = [];
  for (const site of sites) {
    const contacts = (await env.DB.prepare("SELECT tenant, unit_id, position, email FROM dir_contacts WHERE site = ? AND email != ''").bind(site).all().catch(() => ({ results: [] }))).results || [];
    for (const t of (await tenantsOf(env, site)).filter(t => pass(t, f))) {
      const mine = contacts.filter(c => t.ids.has(c.unit_id) || norm(c.tenant) === norm(t.brand));
      const pick = P.length ? mine.filter(c => P.some(p => String(c.position || "").toLowerCase().includes(p))) : mine;
      const portal = PA ? PA(site, t.brand, f.levels) : [];
      out.push({ site, brand: t.brand, dept: t.dept, cat: t.cat, floors: [...t.floors].join(", "), units: t.units.join(", ").slice(0, 80), crm: t.crm, dbank: t.dbank,
        emails: cleanEmails([...pick.map(c => c.email), ...portal].join(",")), dir: pick.length, portal: portal.length });
    }
  }
  return out.sort((a, b) => a.site.localeCompare(b.site) || a.brand.localeCompare(b.brand));
}
async function filters(env, sites) {
  const all = []; for (const s of sites) all.push(...await tenantsOf(env, s));
  const count = (key, L = all) => { const m = new Map(); for (const t of L) for (const v of [].concat(key(t))) if (v) m.set(v, (m.get(v) || 0) + 1); return [...m].map(([name, n]) => ({ name, n })); };
  const q = sites.map(() => "?").join(",");
  const p = sites.length ? (await env.DB.prepare(`SELECT position, COUNT(*) AS n FROM dir_contacts WHERE site IN (${q}) AND email != '' AND position != '' GROUP BY position ORDER BY n DESC`).bind(...sites).all().catch(() => ({ results: [] }))).results || [] : [];
  return { tenants: all.length, cats: count(t => t.cat).sort((a, b) => b.n - a.n), depts: count(t => t.dept).map(x => ({ ...x, cat: catOf(x.name) })).sort((a, b) => a.name.localeCompare(b.name)),
    floors: count(t => [...t.floors]).sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true })), crm: all.filter(t => t.crm).length, dbank: all.filter(t => t.dbank).length, both: all.filter(t => t.crm && t.dbank).length,
    positions: p.map(x => ({ name: x.position, n: x.n })), levels: PORTAL_LEVELS };
}
const filtOf = b => {
  const a = (v, n = 60) => (Array.isArray(v) ? v : []).map(x => clip(x, n)).filter(Boolean).slice(0, 60);
  return { cats: a(b.cats), depts: a(b.depts), floors: a(b.floors, 20), crm: ["yes", "no"].includes(b.crm) ? b.crm : "", dbank: ["yes", "no"].includes(b.dbank) ? b.dbank : "",
    contract: ["crm", "dbank", "both"].includes(b.contract) ? b.contract : "",
    positions: a(b.positions), levels: Array.isArray(b.levels) ? a(b.levels).filter(x => PORTAL_LEVELS.includes(x)) : [...PORTAL_LEVELS] };   // Nov 2026: Directory + portal at all levels unless told otherwise
};

/* ---------- the email ---------- */
function mail(d, m, t, kind) {
  const link = `${d.hubUrl}/memo/${t.token}`, sn = d.siteName(t.site), F = "font-family:Calibri,Arial,sans-serif;";
  const ask = m.mode === "reply" ? "Reply to this memo" : "Acknowledge this memo";
  const head = kind === "reminder" ? `Reminder · ${m.ref}` : m.ref;
  const html = `<div style="${F}max-width:640px;color:#22163A"><div style="background:#4A1F73;color:#fff;padding:16px 20px;border-radius:10px 10px 0 0"><b style="font-size:18px">ABC ${escH(sn)}</b><br><span style="opacity:.85">Memo ${escH(m.ref)}${m.cat ? " · " + escH(m.cat) : ""}</span></div>
    <div style="border:1px solid #e4deec;border-top:0;padding:18px 20px;border-radius:0 0 10px 10px">
    ${kind === "reminder" ? `<p style="background:#FFF3DC;color:#8A6418;padding:8px 12px;border-radius:8px"><b>Reminder:</b> we have not received your ${m.mode === "reply" ? "reply" : "acknowledgement"} yet.</p>` : ""}
    <p>Dear ${escH(t.brand)} team,</p>
    <p style="font-size:16px"><b>${escH(m.title)}</b></p>
    <div style="white-space:pre-line;line-height:1.5">${escH(m.body)}</div>
    ${m.file_name ? `<p>📎 Attachment: <b>${escH(m.file_name)}</b> (open it from the memo page)</p>` : ""}
    ${m.reply_by ? `<p><b>${m.mode === "reply" ? "Reply" : "Acknowledge"} by ${escH(longDay(m.reply_by))}</b></p>` : ""}
    <p><a href="${link}" style="display:inline-block;background:#4A1F73;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:bold">${ask}</a></p>
    <p style="font-size:12px;color:#777">This link is personal to ${escH(t.brand)} (${escH(t.units)}) — no password needed.</p>
    <p>Kind regards,<br>ABC ${escH(sn)} — Operations Team</p></div></div>`;
  return { to: t.emails.split(/,\s*/), subject: `ABC ${sn} · ${head} · ${m.title}`, html };
}
async function sendTo(env, d, m, list, kind) {
  const today = d.today(), go = list.filter(t => t.emails && !t.state);
  if (!go.length) return 0;
  const msgs = go.map(t => mail(d, m, t, kind));
  for (let i = 0; i < go.length; i += 80) await env.DB.batch(go.slice(i, i + 80).map(t => env.DB.prepare(`UPDATE memo_targets SET mails = mails + 1, reminders = reminders + ?, last_mail = ? WHERE id = ?`).bind(kind === "reminder" ? 1 : 0, today, t.id)));
  if (d.sendMany) await d.sendMany(env, msgs);
  return go.length;
}

/* ---------- files (attachment / reply) ---------- */
async function putFile(env, f, prefix) {
  if (!f || !f.data) return null;
  const m = /^data:([^;]*);base64,(.+)$/.exec(String(f.data)); if (!m) throw err("The file could not be read");
  const name = clip(f.name, 120) || "file", ext = (name.split(".").pop() || "").toLowerCase(), type = TYPES[ext];
  if (!type) throw err("Attach a PDF, an image, a Word or an Excel file");
  const bin = Uint8Array.from(atob(m[2]), x => x.charCodeAt(0)); if (bin.byteLength > MAX_FILE) throw err("The file is larger than 8 MB");
  if (!env.FILES) throw err("File storage is not available right now", 503);
  const key = `${prefix}/${crypto.randomUUID()}.${ext}`;
  await env.FILES.put(key, bin, { httpMetadata: { contentType: type } });
  return { key, name, type };
}
async function fileResp(env, key, name, type) {
  if (!key || !env.FILES) throw err("No file", 404);
  const o = await env.FILES.get(key); if (!o) throw err("The file is missing", 404);
  return new Response(o.body, { headers: { "content-type": type || "application/octet-stream", "content-disposition": `inline; filename="${String(name || "file").replace(/"/g, "")}"`, "cache-control": "private, max-age=300" } });
}

/* ---------- the tenant's link ---------- */
export async function memoPublic(env, path, method, b, d) {
  const [tk, act] = path.split("/");
  if (!/^[A-Za-z0-9]{18}$/.test(tk)) throw err("This link is not valid", 404);
  const t = await env.DB.prepare("SELECT * FROM memo_targets WHERE token = ?").bind(tk).first();
  if (!t) throw err("This link is not valid", 404);
  const m = await env.DB.prepare("SELECT * FROM memo_memos WHERE id = ?").bind(t.memo_id).first();
  if (act === "file") return fileResp(env, m.file_key, m.file_name, m.file_type);
  if (act === "rfile") return fileResp(env, t.reply_key, t.reply_name, t.reply_type);
  if (!t.opened_at) await env.DB.prepare("UPDATE memo_targets SET opened_at = ? WHERE id = ?").bind(d.now(), t.id).run().catch(() => {});
  const open = !m.closed_at;
  if (act === "answer" && method === "POST") {
    if (!open) throw err("This memo is closed — contact the mall operations team");
    const by = clip(b.name, 80); if (!by) throw err("Write your name");
    if (m.mode === "reply") {
      const reply = txt(b.reply, 3000); if (!reply && !(b.file && b.file.data)) throw err("Write your reply or attach a file");
      const f = await putFile(env, b.file, "memo-r");
      await env.DB.prepare(`UPDATE memo_targets SET state = 'reply', answered_at = ?, answered_by = ?, reply = ?,
          reply_key = CASE WHEN ? != '' THEN ? ELSE reply_key END, reply_name = CASE WHEN ? != '' THEN ? ELSE reply_name END, reply_type = CASE WHEN ? != '' THEN ? ELSE reply_type END WHERE id = ?`)
        .bind(d.now(), by, reply, f ? f.key : "", f ? f.key : "", f ? f.name : "", f ? f.name : "", f ? f.type : "", f ? f.type : "", t.id).run();
    } else await env.DB.prepare("UPDATE memo_targets SET state = 'ack', answered_at = ?, answered_by = ?, reply = ? WHERE id = ?").bind(d.now(), by, txt(b.reply, 600), t.id).run();
    return { saved: true };
  }
  if (method !== "GET") throw err("Unknown request", 404);
  return { ref: m.ref, title: m.title, body: m.body, cat: m.cat, mode: m.mode, replyBy: m.reply_by, sent: m.sent_day, brand: t.brand, units: t.units, site: t.site, siteName: d.siteName(t.site),
    file: m.file_name ? { name: m.file_name, type: m.file_type } : null, open, state: t.state, at: t.answered_at, by: t.answered_by, reply: t.reply, replyFile: t.reply_name || "" };
}

/* ---------- hub routes ---------- */
function statsOf(rows) {
  const s = { invited: rows.length, ack: 0, reply: 0, wait: 0, noEmail: 0, opened: 0 };
  for (const r of rows) { if (r.state === "ack") s.ack++; else if (r.state === "reply") s.reply++; else { s.wait++; if (!r.emails) s.noEmail++; } if (r.opened_at) s.opened++; }
  s.done = s.ack + s.reply; s.pct = s.invited ? Math.round(s.done / s.invited * 100) : 0;
  return s;
}
const memoOut = m => ({ id: m.id, ref: m.ref, title: m.title, body: m.body, cat: m.cat, mode: m.mode, replyBy: m.reply_by, sites: JSON.parse(m.sites), filt: JSON.parse(m.filt || "{}"),
  file: m.file_name ? { name: m.file_name, type: m.file_type } : null, auto: !!m.auto, every: m.every, max: m.max_rem, by: m.created_by, at: m.created_at, sent: m.sent_day, closed: !!m.closed_at });
async function nextRef(env, sites, today) {
  const pre = `${sites.length === 1 ? sites[0] : "ABC"}-${today.slice(0, 4)}`, k = `memo:seq:${pre}`;
  const r = await env.DB.prepare("SELECT v FROM meta WHERE k = ?").bind(k).first().catch(() => null);
  const n = (Number(r && r.v) || 0) + 1;
  await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)").bind(k, String(n)).run();
  return `${pre}-${String(n).padStart(3, "0")}`;
}
export async function memoRoute(env, p, method, b, url, d) {
  const { me } = d, q = n => url.searchParams.get(n) || b[n] || "";
  const today = d.today(), ops = d.isOps(me);
  const mySites = Object.keys(d.SITES).filter(s => d.canSite(me, s));
  const pickSites = v => (Array.isArray(v) ? v : String(v || "").split(",")).filter(s => mySites.includes(s));
  const memo = async id => { const m = await env.DB.prepare("SELECT * FROM memo_memos WHERE id = ?").bind(Number(id)).first(); if (!m) throw err("Not found", 404);
    if (!JSON.parse(m.sites).some(s => mySites.includes(s))) throw err("No access to this memo", 403); return m; };
  if (p === "memo/groups") {   // the opening page: one group per flagship
    const ms = (await env.DB.prepare("SELECT sites, sent_day FROM memo_memos ORDER BY id DESC").all()).results || [];
    const out = [];
    for (const s of mySites) { const mine = ms.filter(m => JSON.parse(m.sites).includes(s));
      out.push({ site: s, name: d.siteName(s), tenants: (await tenantsOf(env, s).catch(() => [])).length, memos: mine.length, last: mine[0] ? mine[0].sent_day : "" }); }
    return { groups: out, ops };
  }
  if (p === "memo/list") {
    const only = q("site");
    const ms = ((await env.DB.prepare("SELECT * FROM memo_memos ORDER BY id DESC LIMIT 200").all()).results || []).filter(m => JSON.parse(m.sites).some(s => mySites.includes(s) && (!only || s === only)));
    const out = [];
    for (const m of ms) { const rows = (await env.DB.prepare("SELECT site, state, emails, opened_at FROM memo_targets WHERE memo_id = ?").bind(m.id).all()).results || [];
      out.push({ ...memoOut(m), stats: statsOf(rows.filter(r => mySites.includes(r.site) && (!only || r.site === only))) }); }
    return { list: out, ops, sites: Object.fromEntries(mySites.map(s => [s, d.siteName(s)])), cats: MEMO_CATS, today };
  }
  if (p === "memo/one") {
    const m = await memo(q("id"));
    const rows = ((await env.DB.prepare("SELECT * FROM memo_targets WHERE memo_id = ? ORDER BY site, brand").bind(m.id).all()).results || []).filter(r => mySites.includes(r.site));
    const sites = JSON.parse(m.sites).filter(s => mySites.includes(s)).map(s => ({ site: s, name: d.siteName(s), ...statsOf(rows.filter(r => r.site === s)) }));
    return { memo: memoOut(m), total: statsOf(rows), sites, ops, today,
      targets: rows.map(r => ({ id: r.id, site: r.site, brand: r.brand, units: r.units, dept: r.dept, floors: r.floors, emails: r.emails, state: r.state, at: r.answered_at, by: r.answered_by,
        reply: r.reply, replyFile: r.reply_name, mails: r.mails, reminders: r.reminders, lastMail: r.last_mail, opened: !!r.opened_at, link: ops ? `${d.hubUrl}/memo/${r.token}` : "" })) };
  }
  if (p === "memo/file") { const m = await memo(q("id")); return fileResp(env, m.file_key, m.file_name, m.file_type); }
  if (p === "memo/rfile") {
    const t = await env.DB.prepare("SELECT * FROM memo_targets WHERE id = ?").bind(Number(q("target"))).first(); if (!t || !mySites.includes(t.site)) throw err("Not found", 404);
    return fileResp(env, t.reply_key, t.reply_name, t.reply_type);
  }
  if (p === "memo/filters") return filters(env, pickSites(q("sites")));
  if (p === "memo/audience") {
    const sites = pickSites(b.sites || q("sites")); if (!sites.length) throw err("Choose at least one flagship");
    return { list: await audience(env, d, sites, filtOf(b)) };
  }
  if (method !== "POST") throw err("Unknown request", 404);
  if (!ops) throw err("Only the operations team sends memos", 403);
  if (p === "memo/create") {
    const title = clip(b.title, 160); if (!title) throw err("Give the memo a subject");
    const body = txt(b.body, 6000); if (!body) throw err("Write the memo");
    const sites = pickSites(b.sites); if (!sites.length) throw err("Choose at least one flagship");
    const f = filtOf(b), mode = b.mode === "reply" ? "reply" : "ack", replyBy = isDay(b.replyBy) && b.replyBy >= today ? b.replyBy : "";
    const every = Math.min(30, Math.max(1, Number(b.every) || 2)), max = Math.min(10, Math.max(0, Number.isFinite(Number(b.max)) ? Number(b.max) : 3)), auto = b.auto === false ? 0 : 1;
    let list = await audience(env, d, sites, f);
    if (Array.isArray(b.only)) { const keep = new Set(b.only.map(String)); list = list.filter(t => keep.has(`${t.site}|${t.brand}`)); }
    const extra = b.extraEmails && typeof b.extraEmails === "object" ? b.extraEmails : {};
    for (const t of list) { const x = extra[`${t.site}|${t.brand}`]; if (x != null) t.emails = cleanEmails(x); }
    if (!list.length) throw err("No tenant matches these filters");
    const file = await putFile(env, b.file, "memo");
    const ref = await nextRef(env, sites, today), now = d.now();
    const r = await env.DB.prepare(`INSERT INTO memo_memos (ref, sites, title, body, cat, mode, reply_by, file_key, file_name, file_type, filt, auto, every, max_rem, created_by, created_email, created_at, sent_day)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(ref, JSON.stringify(sites), title, body, MEMO_CATS.includes(b.cat) ? b.cat : "", mode, replyBy,
      file ? file.key : "", file ? file.name : "", file ? file.type : "", JSON.stringify(f), auto, every, max, me.full_name || me.email, me.email, now, today).run();
    const id = r.meta.last_row_id;
    for (let i = 0; i < list.length; i += 80) await env.DB.batch(list.slice(i, i + 80).map(t => env.DB.prepare(`INSERT INTO memo_targets (memo_id, site, brand, units, dept, floors, emails, token) VALUES (?,?,?,?,?,?,?,?)`)
      .bind(id, t.site, t.brand, t.units, t.dept, t.floors, t.emails, token())));
    const rows = (await env.DB.prepare("SELECT * FROM memo_targets WHERE memo_id = ?").bind(id).all()).results || [];
    const m = await env.DB.prepare("SELECT * FROM memo_memos WHERE id = ?").bind(id).first();
    const mailed = await sendTo(env, d, m, rows, "memo");
    return { id, ref, tenants: list.length, mailed };
  }
  if (p === "memo/test") {   // the email to me first
    const sites = pickSites(b.sites); if (!sites.length) throw err("Choose at least one flagship");
    const m = { ref: "SAMPLE", title: clip(b.title, 160) || "(subject)", body: txt(b.body, 6000) || "(text)", cat: MEMO_CATS.includes(b.cat) ? b.cat : "", mode: b.mode === "reply" ? "reply" : "ack",
      reply_by: isDay(b.replyBy) ? b.replyBy : "", file_name: b.file && b.file.name ? clip(b.file.name, 120) : "" };
    await d.sendMany(env, [mail(d, m, { site: sites[0], brand: "SAMPLE TENANT", units: "L1-000", token: "SAMPLE", emails: me.email }, "memo")]);
    return { sent: me.email };
  }
  const m = await memo(b.id);
  if (p === "memo/remind") {
    if (m.closed_at) throw err("This memo is closed");
    let rows = ((await env.DB.prepare("SELECT * FROM memo_targets WHERE memo_id = ? AND state = ''").bind(m.id).all()).results || []).filter(r => mySites.includes(r.site));
    if (b.site) rows = rows.filter(r => r.site === b.site);
    if (b.target) rows = rows.filter(r => r.id === Number(b.target));
    const n = await sendTo(env, d, m, rows, "reminder");
    if (!n) throw err(rows.length ? "These tenants have no email — add one first" : "Everyone has answered ✓");
    return { sent: n };
  }
  if (p === "memo/target") {   // edit emails or record an answer given in person / by phone
    const t = await env.DB.prepare("SELECT * FROM memo_targets WHERE id = ? AND memo_id = ?").bind(Number(b.target), m.id).first();
    if (!t || !mySites.includes(t.site)) throw err("Not found", 404);
    if ("emails" in b) await env.DB.prepare("UPDATE memo_targets SET emails = ? WHERE id = ?").bind(cleanEmails(b.emails), t.id).run();
    if ("state" in b) {
      const s = ["ack", "reply", ""].includes(b.state) ? b.state : t.state;
      await env.DB.prepare("UPDATE memo_targets SET state = ?, answered_at = ?, answered_by = ?, reply = ? WHERE id = ?")
        .bind(s, s ? d.now() : "", s ? `${me.full_name || me.email} (hub)` : "", s ? txt(b.reply, 3000) : "", t.id).run();
    }
    return { saved: true };
  }
  if (p === "memo/settings") {   // reminders: on / off, every N days, up to M times · reply-by
    const every = Math.min(30, Math.max(1, Number(b.every) || m.every)), max = Math.min(10, Math.max(0, Number.isFinite(Number(b.max)) ? Number(b.max) : m.max_rem));
    const replyBy = b.replyBy === "" ? "" : isDay(b.replyBy) ? b.replyBy : m.reply_by;
    await env.DB.prepare("UPDATE memo_memos SET auto = ?, every = ?, max_rem = ?, reply_by = ? WHERE id = ?").bind(b.auto === false ? 0 : 1, every, max, replyBy, m.id).run();
    return { saved: true };
  }
  if (p === "memo/close") { await env.DB.prepare("UPDATE memo_memos SET closed_at = CASE WHEN closed_at = '' THEN ? ELSE '' END WHERE id = ?").bind(d.now(), m.id).run(); return { closed: !m.closed_at }; }
  throw err("Unknown request", 404);
}

/* ---------- cron: automatic reminders (once a day from 09:00) ---------- */
export async function memoRun(env, d) {
  if (d.hour() < 9) return;
  const today = d.today();
  const g = await env.DB.prepare("SELECT v FROM meta WHERE k = 'memo:run'").first().catch(() => null);
  if (g && g.v === today) return;
  await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('memo:run', ?)").bind(today).run();
  const ms = (await env.DB.prepare("SELECT * FROM memo_memos WHERE closed_at = '' AND auto = 1 AND max_rem > 0").all().catch(() => ({ results: [] }))).results || [];
  for (const m of ms) {
    try {
      if (m.reply_by && today > m.reply_by) continue;
      const rows = ((await env.DB.prepare("SELECT * FROM memo_targets WHERE memo_id = ? AND state = '' AND emails != '' AND reminders < ?").bind(m.id, m.max_rem).all()).results || [])
        .filter(r => !r.last_mail || r.last_mail <= addDays(today, -m.every));
      const n = await sendTo(env, d, m, rows, "reminder");
      if (n && d.raiseEvent) for (const s of JSON.parse(m.sites)) { const k = rows.filter(r => r.site === s).length; if (k) await d.raiseEvent(env, { site: s, app: "memo", tone: "info", title: `Memo ${m.ref} · reminder sent`, body: `${k} tenants have not answered "${m.title}" yet` }).catch(() => {}); }
    } catch (e) { console.error("memo", m.id, e && e.message); }
  }
}
