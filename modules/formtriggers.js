/* =====================================================================
   CHECKLIST TRIGGERS (Oct 2026) — docs/FEATURE-checklist-triggers.md
   On chosen AM / PM checklist items, a ✗ starts actions automatically:
     • a Malfunction Record (category, priority; location, remark and photo from the checklist)
     • a notification (hub alert + push) to roles of the flagship and / or chosen people
     • a message in the flagship's Hub Chat "Team" group (with the photo)
     • an email to an address (e.g. the contractor), photo attached
     • a follow-up flag for the people notified (open until closed)
     • an escalation when the same item is ✗ several shifts in a row
   The person filling it can be asked for a photo and / or a remark, and chooses "Send now" or on submit.
   Set by administrators and the flagship's managers (⚡ next to the item). Fired once per item per day.

   Tables : form_triggers (site, form, item_id → data) · form_trig_log (one row per fired trigger)
   Photos : R2 FILES forms/<site>/<day>/<item>-<uuid>.jpg
   ===================================================================== */
import { MF_CATEGORIES, MF_PRIORITY } from "./malfunctions.js";

const clip = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
const err = (m, status = 400) => Object.assign(new Error(m), { status });
const SITES5 = ["VRM", "ACM", "DBS", "ACS", "VRS"];
export const TRIG_FORMS = ["am", "pm"];
export const GROUPS = { managers: "Flagship managers", ops: "Operations team", security: "Security", leadership: "Leadership of the flagship" };
const PHOTO_MAX = 600000;   // the page makes the photo smaller first (≈1280 px JPEG)

export async function trigSchema(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS form_triggers (site TEXT NOT NULL, form TEXT NOT NULL, item_id TEXT NOT NULL, data TEXT NOT NULL,
      updated_by TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '', PRIMARY KEY (site, form, item_id))`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS form_trig_log (id INTEGER PRIMARY KEY AUTOINCREMENT, site TEXT NOT NULL, form TEXT NOT NULL, day TEXT NOT NULL,
      item_id TEXT NOT NULL, item_text TEXT NOT NULL DEFAULT '', run_id INTEGER NOT NULL DEFAULT 0, by_email TEXT NOT NULL DEFAULT '', by_name TEXT NOT NULL DEFAULT '',
      remark TEXT NOT NULL DEFAULT '', photo_key TEXT NOT NULL DEFAULT '', result TEXT NOT NULL DEFAULT '{}', mf_id INTEGER NOT NULL DEFAULT 0, at TEXT NOT NULL,
      UNIQUE (site, form, day, item_id))`)
  ]);
}

/* ---------- settings ---------- */
function cleanCfg(c) {
  const a = c && c.actions || {};
  const groups = v => (Array.isArray(v) ? v : []).filter(g => GROUPS[g]);
  const emails = v => [...new Set((Array.isArray(v) ? v : String(v || "").split(/[,;\s]+/)).map(x => String(x).trim().toLowerCase()).filter(x => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)))].slice(0, 20);
  const out = { actions: {}, require: { photo: !!(c.require && c.require.photo), remark: c.require ? c.require.remark !== false : true } };
  if (a.mf && a.mf.on) out.actions.mf = { on: true, category: MF_CATEGORIES.includes(a.mf.category) ? a.mf.category : "Other", priority: MF_PRIORITY.includes(a.mf.priority) ? a.mf.priority : "Medium" };
  if (a.notify && (groups(a.notify.groups).length || emails(a.notify.people).length)) out.actions.notify = { groups: groups(a.notify.groups), people: emails(a.notify.people) };
  if (a.chat) out.actions.chat = true;
  if (a.email && emails(a.email.to).length) out.actions.email = { to: emails(a.email.to) };
  if (a.fu) out.actions.fu = true;
  const n = Math.round(Number(c.escalate && c.escalate.after) || 0);
  if (n >= 2 && n <= 14 && (groups(c.escalate.groups).length || emails(c.escalate.people).length)) out.escalate = { after: n, groups: groups(c.escalate.groups), people: emails(c.escalate.people) };
  if (!Object.keys(out.actions).length && !out.escalate) throw err("Choose at least one action");
  return out;
}
export async function triggersOf(env, site, form) {
  if (!TRIG_FORMS.includes(form)) return {};
  const { results } = await env.DB.prepare("SELECT item_id, data FROM form_triggers WHERE site = ? AND form = ?").bind(site, form).all().catch(() => ({ results: [] }));
  const o = {}; for (const r of results || []) { try { o[r.item_id] = JSON.parse(r.data); } catch {} }
  return o;
}
/* a short list of what will happen, shown to the person filling the checklist */
export function trigSummary(cfg) {
  const a = cfg.actions || {}, L = [];
  if (a.mf) L.push(`Malfunction record (${a.mf.category})`);
  if (a.notify) L.push(`Notify ${[...a.notify.groups.map(g => GROUPS[g]), ...(a.notify.people.length ? [`${a.notify.people.length} person${a.notify.people.length === 1 ? "" : "s"}`] : [])].join(", ")}`);
  if (a.chat) L.push("Team chat");
  if (a.email) L.push(`Email ${a.email.to.join(", ")}`);
  if (a.fu) L.push("Follow-up flag");
  return L;
}
/* for the sheet: { itemId: { list, photo, remark } } and what already fired for that day, plus the last malfunction of each item */
export async function trigForSheet(env, site, form, day) {
  const T = await triggersOf(env, site, form);
  if (!Object.keys(T).length) return { triggers: {}, fired: {}, last: {} };
  const triggers = Object.fromEntries(Object.entries(T).map(([k, c]) => [k, { list: trigSummary(c), photo: !!c.require.photo, remark: c.require.remark !== false, escalate: c.escalate ? c.escalate.after : 0 }]));
  const { results: f } = await env.DB.prepare("SELECT item_id, at, by_name, result, mf_id FROM form_trig_log WHERE site = ? AND form = ? AND day = ?").bind(site, form, day).all();
  const fired = Object.fromEntries((f || []).map(r => [r.item_id, { at: r.at, by: r.by_name, mfId: r.mf_id, result: JSON.parse(r.result || "{}") }]));
  const { results: l } = await env.DB.prepare(`SELECT g.item_id, g.day, g.mf_id, m.status, m.fixed_at FROM form_trig_log g LEFT JOIN mf_records m ON m.id = g.mf_id
    WHERE g.site = ? AND g.form = ? AND g.mf_id > 0 AND g.id IN (SELECT MAX(id) FROM form_trig_log WHERE site = ? AND form = ? AND mf_id > 0 GROUP BY item_id)`).bind(site, form, site, form).all().catch(() => ({ results: [] }));
  const last = Object.fromEntries((l || []).map(r => [r.item_id, { day: r.day, mfId: r.mf_id, status: r.status || "", fixedAt: r.fixed_at || "" }]));
  return { triggers, fired, last };
}

/* ---------- people ---------- */
async function resolve(env, site, groups, people) {
  const out = new Set(people || []);
  if (groups && groups.length) {
    const { results } = await env.DB.prepare("SELECT email, role, site_code, sites, position FROM users WHERE active = 1").all();
    for (const u of results || []) {
      const covers = u.role === "ADVISOR" || String(u.sites || "").split(",").includes(site);
      if (groups.includes("managers") && u.role === "MANAGER" && u.site_code === site) out.add(u.email);
      if (groups.includes("ops") && u.role === "SUPERVISOR" && u.site_code === site && u.position !== "WH") out.add(u.email);
      if (groups.includes("security") && u.role === "SECURITY" && u.site_code === site) out.add(u.email);
      if (groups.includes("leadership") && ["ADVISOR", "DIRECTOR", "CDSO"].includes(u.role) && covers) out.add(u.email);
    }
  }
  return [...out];
}

/* ---------- firing ---------- */
const fmtDay = d => new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
export async function fireTrigger(env, d, { site, form, day, item, cfg, remark, photoKey, runId, me, FORMS }) {
  const now = d.now(), formName = FORMS[form].name;
  const claim = await env.DB.prepare(`INSERT OR IGNORE INTO form_trig_log (site, form, day, item_id, item_text, run_id, by_email, by_name, remark, photo_key, at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(site, form, day, item.id, clip(item.t, 300), runId || 0, me.email, me.full_name || me.email, clip(remark, 300), clip(photoKey, 200), now).run();
  if (!claim.meta || claim.meta.changes !== 1) return { already: true };
  const logId = claim.meta.last_row_id, a = cfg.actions || {}, res = {}, where = `${d.siteName(site)} · ${item.a || item.s || ""}`.replace(/ · $/, "");
  const head = `${formName} ✗ · ${item.t}`, text = remark ? `${remark}` : "No remark";
  let photo = null;
  if (photoKey && env.FILES) {
    const o = await env.FILES.get(photoKey).catch(() => null);
    if (o) { const buf = new Uint8Array(await o.arrayBuffer()); let s = ""; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      photo = { key: photoKey, type: (o.httpMetadata && o.httpMetadata.contentType) || "image/jpeg", size: buf.length, b64: btoa(s) }; }
  }
  /* 1. malfunction record */
  if (a.mf) {
    try {
      const r = await env.DB.prepare(`INSERT INTO mf_records (site, category, location, description, priority, status, found_at, notes, created_by, created_name, updated_at, updated_name)
        VALUES (?,?,?,?,?,'Open',?,?,?,?,?,?)`).bind(site, a.mf.category, clip(item.a || item.s || "", 120), clip(`${item.t} — ${text}`, 1000), a.mf.priority, now,
        JSON.stringify([{ at: now, by: me.full_name, t: `Opened automatically from the ${formName} of ${fmtDay(day)} (⚡ checklist trigger)` }]), me.email, me.full_name, now, me.full_name).run();
      res.mfId = r.meta.last_row_id;
      if (photo && photo.size < 900000) await env.DB.prepare("INSERT INTO mf_photos (record_id, data, at, by_name) VALUES (?,?,?,?)").bind(res.mfId, `data:${photo.type};base64,${photo.b64}`, now, me.full_name).run().catch(() => {});
    } catch (e) { res.mfError = e.message; }
  }
  /* 2. notify (hub alert + push) and 5. follow-up flags */
  let notified = [];
  if (a.notify) {
    notified = (await resolve(env, site, a.notify.groups, a.notify.people)).filter(e => e !== me.email);
    for (const e of notified) await d.raiseEvent(env, { site, app: res.mfId ? "malfunctions" : "forms", tone: "warn", email: e,
      title: `⚡ ${head}`.slice(0, 140), body: `${where} · ${text}${res.mfId ? ` · malfunction #${res.mfId}` : ""} · by ${me.full_name}` }).catch(() => {});
    res.notified = notified.length;
  }
  if (a.fu) {
    const who = notified.length ? notified : [me.email];
    const ops = who.map(e => env.DB.prepare(`INSERT INTO followups (email, site, subject, sender, due, priority, status, created_at) VALUES (?,?,?,?,?,'high','open',?)`)
      .bind(e, site, clip(`⚡ ${head} — ${text}`, 300), me.full_name || me.email, day, now));
    try { for (let i = 0; i < ops.length; i += 50) await env.DB.batch(ops.slice(i, i + 50)); res.followups = ops.length; } catch (e) { res.fuError = e.message; }
  }
  /* 3. team chat */
  if (a.chat && d.chatPostTeam) {
    const r = await d.chatPostTeam(env, site, me, `⚡ ${head}\n${text}${res.mfId ? `\nMalfunction #${res.mfId} opened` : ""}`, photo ? { key: photo.key, type: photo.type, size: photo.size, name: "checklist-photo.jpg" } : null).catch(e => ({ ok: false, error: e.message }));
    res.chat = !!(r && r.ok); if (r && !r.ok) res.chatError = r.error;
  }
  /* 4. email */
  if (a.email && d.relay) {
    const esc = s => String(s || "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const html = `<div style="font-family:Calibri,Arial,sans-serif;font-size:14px;color:#221A2E"><p>Dear team,</p>
      <p>During today's <b>${esc(formName)}</b> at <b>${esc(d.siteName(site))}</b> the following item was found <b style="color:#C0392B">not OK</b>:</p>
      <table style="border-collapse:collapse;font-size:14px"><tr><td style="padding:4px 10px 4px 0;color:#6D6479">Item</td><td><b>${esc(item.t)}</b></td></tr>
      <tr><td style="padding:4px 10px 4px 0;color:#6D6479">Area</td><td>${esc(item.a || item.s || "—")}</td></tr>
      <tr><td style="padding:4px 10px 4px 0;color:#6D6479">Remark</td><td>${esc(text)}</td></tr>
      <tr><td style="padding:4px 10px 4px 0;color:#6D6479">Date</td><td>${esc(fmtDay(day))}</td></tr>
      ${res.mfId ? `<tr><td style="padding:4px 10px 4px 0;color:#6D6479">Reference</td><td>Malfunction #${res.mfId}</td></tr>` : ""}</table>
      <p>Kindly attend to it at your earliest convenience${photo ? " (photo attached)" : ""}.</p><p>Regards,<br>${esc(me.full_name)}<br>ABC Operations · ${esc(d.siteName(site))}</p></div>`;
    const r = await d.relay(env, { to: a.email.to, subject: `${d.siteName(site)} · ${item.t} — not OK (${formName}, ${fmtDay(day)})`.slice(0, 200), html, from: me.email,
      attachment: photo ? { base64: photo.b64, fileName: "photo.jpg", mimeType: photo.type } : null }).catch(e => ({ ok: false, error: e.message }));
    res.email = !!(r && r.ok); if (r && !r.ok) res.emailError = String(r.error || "").slice(0, 200);
  }
  /* 6. escalation: the same item ✗ in the last N records of this checklist (shift after shift) */
  if (cfg.escalate) {
    const { results } = await env.DB.prepare("SELECT day, answers FROM form_runs WHERE site = ? AND form = ? AND day <= ? ORDER BY day DESC LIMIT ?").bind(site, form, day, cfg.escalate.after).all();
    const rows = results || [], streak = rows.filter(r => { try { return (JSON.parse(r.answers)[item.id] || {}).v === "n"; } catch { return false; } }).length;
    const thisOne = rows.length && rows[0].day === day ? 0 : 1;   // the record being submitted may not be saved yet
    if (streak + thisOne >= cfg.escalate.after) {
      const to = await resolve(env, site, cfg.escalate.groups, cfg.escalate.people);
      for (const e of to) await d.raiseEvent(env, { site, app: "forms", tone: "alert", email: e, title: `⏫ ${item.t} — ✗ ${cfg.escalate.after} times in a row`.slice(0, 140),
        body: `${d.siteName(site)} · ${formName} · latest ${fmtDay(day)}: ${text}${res.mfId ? ` · malfunction #${res.mfId}` : ""}` }).catch(() => {});
      res.escalated = to.length;
    }
  }
  await env.DB.prepare("UPDATE form_trig_log SET result = ?, mf_id = ? WHERE id = ?").bind(JSON.stringify(res), res.mfId || 0, logId).run();
  return res;
}

/* ---------- routes (called from formsRoute) ---------- */
export async function trigRoute(env, p, method, b, url, ctx, FORMS, template) {
  const { site, me, now } = ctx, q = k => url.searchParams.get(k);
  const canSet = me.role === "ADMIN" || me.role === "MANAGER";
  const formOf = v => { if (!TRIG_FORMS.includes(v)) throw err("Triggers are for the AM and PM checklists"); return v; };
  if (p === "forms/trig/list") {
    const form = formOf(q("form"));
    const [T, { results: users }] = await Promise.all([triggersOf(env, site, form),
      env.DB.prepare("SELECT email, full_name, role, position, site_code FROM users WHERE active = 1 ORDER BY full_name").all()]);
    return { triggers: T, canSet, groups: GROUPS, categories: MF_CATEGORIES, priorities: MF_PRIORITY,
      people: (users || []).map(u => ({ email: u.email, name: u.full_name, site: u.site_code || "" })) };
  }
  if (p === "forms/trig/save" && method === "POST") {
    if (!canSet) throw err("Administrators and the flagship's managers set the triggers", 403);
    const form = formOf(b.form), itemId = clip(b.itemId, 20);
    const items = (await template(env, site, form)).items;
    if (!items.some(i => i.id === itemId)) throw err("This item is not in the checklist any more");
    const targets = b.allSites && me.role === "ADMIN" ? SITES5 : [site];
    if (b.remove) { await env.DB.batch(targets.map(s => env.DB.prepare("DELETE FROM form_triggers WHERE site = ? AND form = ? AND item_id = ?").bind(s, form, itemId))); return { removed: true }; }
    const cfg = cleanCfg(b.cfg || {});
    await env.DB.batch(targets.map(s => env.DB.prepare(`INSERT INTO form_triggers (site, form, item_id, data, updated_by, updated_at) VALUES (?,?,?,?,?,?)
      ON CONFLICT(site, form, item_id) DO UPDATE SET data = excluded.data, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
      .bind(s, form, itemId, JSON.stringify(cfg), me.full_name, now())));
    return { saved: true, cfg, sites: targets.length };
  }
  if (p === "forms/trig/photo" && method === "POST") {
    if (!ctx.can.formsFill) throw err("Not allowed", 403);
    if (!env.FILES) throw err("Photo storage is not available right now", 503);
    const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(String(b.data || ""));
    if (!m) throw err("Send a photo");
    const bin = Uint8Array.from(atob(m[2]), c => c.charCodeAt(0));
    if (bin.byteLength > PHOTO_MAX) throw err("The photo is too large");
    const day = /^\d{4}-\d{2}-\d{2}$/.test(b.day || "") ? b.day : ctx.today();
    const key = `forms/${site}/${day}/${clip(b.itemId, 20).replace(/[^\w-]/g, "")}-${crypto.randomUUID().slice(0, 8)}.jpg`;
    await env.FILES.put(key, bin, { httpMetadata: { contentType: m[1] } });
    return { key };
  }
  if (p === "forms/trig/img" && method === "GET") {   // the checklist photo (shown on the sheet)
    const key = String(q("k") || "");
    if (!key.startsWith(`forms/${site}/`) || !env.FILES) throw err("Not found", 404);
    const o = await env.FILES.get(key); if (!o) throw err("Not found", 404);
    return new Response(o.body, { headers: { "content-type": (o.httpMetadata && o.httpMetadata.contentType) || "image/jpeg", "cache-control": "private, max-age=86400" } });
  }
  if (p === "forms/trig/fire" && method === "POST") {   // "Send now" from the sheet
    if (!ctx.can.formsFill) throw err("Not allowed", 403);
    const form = formOf(b.form), day = /^\d{4}-\d{2}-\d{2}$/.test(b.day || "") ? b.day : ctx.today(), itemId = clip(b.itemId, 20);
    const cfg = (await triggersOf(env, site, form))[itemId]; if (!cfg) throw err("This item has no trigger");
    const run = b.runId ? await env.DB.prepare("SELECT id, items FROM form_runs WHERE id = ? AND site = ?").bind(Number(b.runId), site).first() : null;
    const items = run ? JSON.parse(run.items) : (await template(env, site, form)).items;
    const item = items.find(i => i.id === itemId); if (!item) throw err("Item not found");
    if (cfg.require.remark !== false && !clip(b.remark, 300)) throw err("Write what is wrong first");
    if (cfg.require.photo && !b.photo) throw err("Add a photo first");
    const r = await fireTrigger(env, ctx, { site, form, day, item, cfg, remark: b.remark, photoKey: b.photo, runId: run ? run.id : 0, me, FORMS });
    return { ...r, fired: true };
  }
  return null;
}
