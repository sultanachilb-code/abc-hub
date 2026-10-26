/* =====================================================================
   MARKETING PARTICIPATION (Oct 2026, Upcoming - Testing) — docs/FEATURE-mkt.md
   The operations team sends a marketing activation memo to tenants on behalf of Marketing:
   • Audience = open tenants of the chosen flagships (GLA), filtered by sub-category (GLA department),
     emailed to their Tenants Directory contacts filtered by position (e.g. CRM, Marketing, Store Manager).
   • The email carries two buttons — Participating / Not participating — each a personal link (/mk/<token>?a=yes|no, no account).
     The tap records the answer; the tenant can add the offer + contact, or a reason, and change it until the reply-by date.
   • From the start date to the reply-by date: a reminder EVERY DAY to tenants who have not answered, plus a manual
     "Remind" button (all / one flagship / one tenant).
   • Live dashboard: participating / not / no reply per flagship, % participating (÷ tenants invited), export.
   Routes: /api/ops/mk/* (hub) · /api/mk-ext/<token>[/answer|/memo] (tenant link)
   ===================================================================== */
const err = (m, status = 400) => Object.assign(new Error(m), { status });
const clip = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
const txt = (v, n) => String(v == null ? "" : v).replace(/\r/g, "").trim().slice(0, n);
const escH = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const norm = s => String(s || "").toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, "");
const isDay = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));
const token = () => [...crypto.getRandomValues(new Uint8Array(18))].map(b => "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"[b % 57]).join("");
const cleanEmails = v => [...new Set(String(v || "").split(/[\s,;]+/).map(x => x.trim().toLowerCase()).filter(x => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)))].slice(0, 8).join(", ");
const longDay = d => d ? new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "";
export const MK_OFFERS = ["Up to 30%", "Up to 50%", "Up to 70%", "Buy 1 get 1", "Gift with purchase", "Other"];
export const MK_REASONS = ["Brand policy / head office decision", "Stock not available", "Already running a promotion", "Under renovation / closing", "Budget", "Other"];
const MAX_MEMO = 8 * 1024 * 1024;

export async function mkSchema(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS mk_campaigns (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, message TEXT NOT NULL DEFAULT '',
      act_from TEXT NOT NULL DEFAULT '', act_to TEXT NOT NULL DEFAULT '', start_day TEXT NOT NULL, end_day TEXT NOT NULL,
      sites TEXT NOT NULL DEFAULT '[]', depts TEXT NOT NULL DEFAULT '[]', positions TEXT NOT NULL DEFAULT '[]',
      memo_key TEXT NOT NULL DEFAULT '', memo_name TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL DEFAULT '', created_email TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT '', launched_at TEXT NOT NULL DEFAULT '', closed_at TEXT NOT NULL DEFAULT '', summary_done INTEGER NOT NULL DEFAULT 0)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS mk_targets (id INTEGER PRIMARY KEY AUTOINCREMENT, campaign_id INTEGER NOT NULL, site TEXT NOT NULL, brand TEXT NOT NULL,
      units TEXT NOT NULL DEFAULT '', dept TEXT NOT NULL DEFAULT '', emails TEXT NOT NULL DEFAULT '', token TEXT NOT NULL,
      answer TEXT NOT NULL DEFAULT '', answered_at TEXT NOT NULL DEFAULT '', answered_by TEXT NOT NULL DEFAULT '',
      offer TEXT NOT NULL DEFAULT '', details TEXT NOT NULL DEFAULT '', contact TEXT NOT NULL DEFAULT '', reason TEXT NOT NULL DEFAULT '', comment TEXT NOT NULL DEFAULT '',
      mails INTEGER NOT NULL DEFAULT 0, last_mail TEXT NOT NULL DEFAULT '', opened_at TEXT NOT NULL DEFAULT '')`),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS mk_targets_token ON mk_targets (token)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS mk_targets_c ON mk_targets (campaign_id, site)")
  ]);
}

/* ---------- audience: GLA open tenants × sub-category, Directory contacts × position ---------- */
async function audience(env, sites, depts, positions) {
  const D = new Set(depts.map(x => x.toLowerCase())), P = positions.map(x => x.toLowerCase());
  const out = [];
  for (const site of sites) {
    const units = (await env.DB.prepare("SELECT id, code, brand, dept, status FROM gla_units WHERE site = ? AND active = 1 AND section = 'Leasing' AND brand != '' ORDER BY seq, id").bind(site).all()).results || [];
    const contacts = (await env.DB.prepare("SELECT tenant, unit_id, position, email FROM dir_contacts WHERE site = ? AND email != ''").bind(site).all().catch(() => ({ results: [] }))).results || [];
    const byBrand = new Map();
    for (const u of units) {
      if (/vacant/i.test(u.brand) || /vacant|termin/i.test(u.status) || /^vacant|warehouse/i.test(u.dept || "")) continue;
      if (D.size && !D.has(String(u.dept || "").toLowerCase())) continue;
      const k = norm(u.brand); const t = byBrand.get(k) || { site, brand: clip(u.brand, 100), dept: u.dept || "", units: [], ids: new Set() };
      t.units.push(u.code); t.ids.add(u.id); byBrand.set(k, t);
    }
    for (const t of byBrand.values()) {
      const mine = contacts.filter(c => t.ids.has(c.unit_id) || norm(c.tenant) === norm(t.brand));
      const pick = P.length ? mine.filter(c => P.some(p => String(c.position || "").toLowerCase().includes(p))) : mine;
      out.push({ site, brand: t.brand, dept: t.dept, units: t.units.join(", ").slice(0, 80), emails: cleanEmails(pick.map(c => c.email).join(",")), contacts: mine.length });
    }
  }
  return out.sort((a, b) => a.site.localeCompare(b.site) || a.brand.localeCompare(b.brand));
}
async function filters(env, sites) {
  if (!sites.length) return { depts: [], positions: [] };
  const q = sites.map(() => "?").join(",");
  const d = (await env.DB.prepare(`SELECT dept, COUNT(DISTINCT brand) AS n FROM gla_units WHERE site IN (${q}) AND active = 1 AND section = 'Leasing' AND brand != '' AND dept != '' GROUP BY dept ORDER BY dept`).bind(...sites).all()).results || [];
  const p = (await env.DB.prepare(`SELECT position, COUNT(*) AS n FROM dir_contacts WHERE site IN (${q}) AND email != '' AND position != '' GROUP BY position ORDER BY n DESC`).bind(...sites).all().catch(() => ({ results: [] }))).results || [];
  return { depts: d.filter(x => !/^vacant|warehouse/i.test(x.dept)).map(x => ({ name: x.dept, n: x.n })), positions: p.map(x => ({ name: x.position, n: x.n })) };
}

/* ---------- the email ---------- */
/* the tenant email — three designs, chosen in Admin Control → Tenant pages & emails (meta ext:cfg.emailStyle):
   A classic memo · B branded card (default) · C executive minimal. Buttons are Outlook-safe (table cells). */
export const EMAIL_STYLES = { A: "Classic memo", B: "Branded card", C: "Executive minimal" };
export async function extCfg(env) {
  const r = await env.DB.prepare("SELECT v FROM meta WHERE k = 'ext:cfg'").first().catch(() => null);
  let c = {}; try { c = r ? JSON.parse(r.v) : {}; } catch {}
  return { theme: ["light", "dark", "auto"].includes(c.theme) ? c.theme : "light", emailStyle: EMAIL_STYLES[c.emailStyle] ? c.emailStyle : "B", arabic: c.arabic !== false };
}
const shortDay = d => d ? new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "";
const weekDay = d => d ? new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "";
export function mail(d, c, t, kind, style = "B", arabic = true) {
  const link = `${d.hubUrl}/mk/${t.token}`, sn = d.siteName(t.site), F = "font-family:Calibri,Arial,sans-serif;", rem = kind === "reminder";
  const dates = c.act_from ? escH(longDay(c.act_from)) + (c.act_to && c.act_to !== c.act_from ? " – " + escH(longDay(c.act_to)) : "") : "";
  const memo = c.memo_key ? `${d.hubUrl}/api/mk-ext/${t.token}/memo` : "";
  const msg = escH(c.message).replace(/\n/g, "<br>");
  const remLine = rem ? `<p style="${F}margin:0 0 12px;padding:10px 12px;background:#FFF6E5;border-left:3px solid #C98A12;font-size:13px;color:#5A4300">We have not yet received your reply. Kindly confirm by <b>${escH(weekDay(c.end_day))}</b>.</p>` : "";
  const ar = arabic ? `<span dir="rtl">يرجى تأكيد المشاركة قبل ${escH(shortDay(c.end_day))}</span>` : "";
  const btn = (a, label, solid, w) => solid
    ? `<td bgcolor="#4A1F73" style="border-radius:5px"${w ? ` width="${w}" align="center"` : ""}><a href="${link}?a=${a}" style="${F}display:${w ? "block" : "inline-block"};padding:12px 24px;font-size:14px;font-weight:bold;color:#ffffff;text-decoration:none">${label}</a></td>`
    : `<td bgcolor="#ffffff" style="border:1px solid #C9C0D6;border-radius:5px"${w ? ` width="${w}" align="center"` : ""}><a href="${link}?a=${a}" style="${F}display:${w ? "block" : "inline-block"};padding:11px 22px;font-size:14px;color:#4A1F73;text-decoration:none">${label}</a></td>`;
  const sign = `Kind regards,<br><b>Mall Operations</b><br><span style="color:#777">ABC ${escH(sn)} · on behalf of Marketing</span>`;
  const foot = `One click records your answer; you may change it until ${escH(shortDay(c.end_day))}. Reminders stop once you reply. This link is personal to ${escH(t.brand)}.`;
  const wrap = inner => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1EEF4"><tr><td align="center" style="padding:18px 10px">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;${F}color:#222;border:1px solid #DCD6E4">${inner}</table></td></tr></table>`;
  let html, subject;
  if (style === "A") {
    subject = `ABC ${sn} | Marketing Activation: ${c.title} | ${rem ? "Reminder — " : ""}Participation confirmation required by ${shortDay(c.end_day)}`;
    html = wrap(`<tr><td style="height:4px;background:#4A1F73;font-size:0;line-height:0">&nbsp;</td></tr>
      <tr><td style="padding:22px 32px 6px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="${F}font-size:20px;font-weight:bold;color:#4A1F73">ABC</td>
        <td align="right" style="${F}font-size:11px;color:#777;letter-spacing:1px;text-transform:uppercase">${escH(sn)} · Mall Operations</td></tr></table></td></tr>
      <tr><td style="padding:10px 32px 0"><div style="border-top:1px solid #E6E1EC"></div></td></tr>
      <tr><td style="${F}padding:18px 32px 4px;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#8A7FA0">${rem ? "Reminder · " : ""}Memo · Marketing Activation</td></tr>
      <tr><td style="${F}padding:0 32px 14px;font-size:22px;font-weight:bold;color:#1E1530">${escH(c.title)} — Participation</td></tr>
      <tr><td style="padding:0 32px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="${F}font-size:14px;border:1px solid #E6E1EC">
        ${[["To", `<b>${escH(t.brand)}</b>${t.units ? " · " + escH(t.units) : ""}`], ["From", "Mall Operations, on behalf of Marketing"], dates && ["Activity dates", dates], ["Reply by", `<b style="color:#B03A2E">${escH(weekDay(c.end_day))}</b>`]].filter(Boolean)
          .map(([k, v], i, L) => `<tr><td style="padding:9px 12px;background:#F7F5FA;color:#6D6479;width:130px;${i < L.length - 1 ? "border-bottom:1px solid #E6E1EC" : ""}">${k}</td><td style="padding:9px 12px;${i < L.length - 1 ? "border-bottom:1px solid #E6E1EC" : ""}">${v}</td></tr>`).join("")}
      </table></td></tr>
      <tr><td style="${F}padding:20px 32px 6px;font-size:14px;line-height:1.6">${remLine}Dear ${escH(t.brand)} Management,<br><br>${msg}</td></tr>
      ${memo ? `<tr><td style="${F}padding:4px 32px 0;font-size:14px"><a href="${memo}" style="color:#4A1F73;font-weight:bold;text-decoration:none">&#128206; ${escH(c.memo_name || "Memo (PDF)")}</a></td></tr>` : ""}
      <tr><td style="padding:22px 32px 6px"><table role="presentation" cellpadding="0" cellspacing="0"><tr>${btn("yes", "Confirm participation", true)}<td width="12">&nbsp;</td>${btn("no", "Decline", false)}</tr></table></td></tr>
      <tr><td style="${F}padding:8px 32px 0;font-size:12px;color:#777;line-height:1.5">${foot} ${ar}</td></tr>
      <tr><td style="${F}padding:22px 32px 26px;font-size:14px;line-height:1.6">${sign}</td></tr>`);
  } else if (style === "C") {
    subject = `${rem ? "Reminder: " : ""}${c.title} — participation · ${t.brand}`;
    html = wrap(`<tr><td style="${F}padding:30px 34px 0;font-size:15px;line-height:1.65">${remLine}Dear ${escH(t.brand)} Management,<br><br>${msg}
        ${dates ? `<br><br>Activity dates: <b>${dates}</b>` : ""}<br><br>We would appreciate your confirmation by <b>${escH(weekDay(c.end_day))}</b>.</td></tr>
      <tr><td style="padding:22px 34px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-left:3px solid #4A1F73;background:#FAF8FC"><tr><td style="padding:16px 18px">
        <div style="${F}font-size:12px;color:#6D6479;margin-bottom:10px">Your response</div>
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>${btn("yes", "Participate", true)}<td width="10">&nbsp;</td>${btn("no", "Not participating", false)}</tr></table>
        ${memo ? `<div style="${F}font-size:12px;color:#8A7FA0;margin-top:10px">Memo: <a href="${memo}" style="color:#4A1F73">${escH(c.memo_name || "PDF")}</a></div>` : ""}
        ${ar ? `<div style="${F}font-size:12px;color:#8A7FA0;margin-top:6px">${ar}</div>` : ""}</td></tr></table></td></tr>
      <tr><td style="${F}padding:26px 34px 30px;font-size:15px;line-height:1.6">${sign}</td></tr>
      <tr><td style="${F}padding:12px 34px;border-top:1px solid #EEE9F3;font-size:11px;color:#9A90AC">${foot}</td></tr>`);
  } else {
    subject = `${rem ? "Reminder: " : ""}${c.title} · Please confirm ${t.brand}'s participation · ABC ${sn}`;
    html = wrap(`<tr><td bgcolor="#2A0F45" style="background:#2A0F45;padding:20px 28px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td width="58"><img src="${d.hubUrl}/icons/abc-logo-white.png" width="46" alt="ABC" style="display:block;border:0"></td>
        <td style="${F}color:#ffffff;font-size:12px;letter-spacing:1.5px;text-transform:uppercase">ABC ${escH(sn)}<br><span style="font-size:18px;letter-spacing:0;text-transform:none;font-weight:bold">Marketing Activation</span></td></tr></table></td></tr>
      <tr><td style="height:3px;background:#C9A962;font-size:0;line-height:0">&nbsp;</td></tr>
      <tr><td style="${F}padding:24px 28px 6px;font-size:21px;font-weight:bold;color:#1E1530">${escH(c.title)}</td></tr>
      <tr><td style="${F}padding:0 28px 16px;font-size:14px;line-height:1.6;color:#444">${remLine}Dear ${escH(t.brand)} team,<br>${msg}</td></tr>
      <tr><td style="padding:0 28px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F3FA;${F}font-size:13px"><tr>
        ${dates ? `<td style="padding:14px 16px"><span style="color:#8A7FA0;font-size:11px;text-transform:uppercase;letter-spacing:1px">Activity</span><br><b>${dates}</b></td>` : ""}
        <td style="padding:14px 16px;${dates ? "border-left:1px solid #E3DCEC" : ""}"><span style="color:#8A7FA0;font-size:11px;text-transform:uppercase;letter-spacing:1px">Reply by</span><br><b style="color:#B03A2E">${escH(shortDay(c.end_day))}</b></td>
        ${memo ? `<td style="padding:14px 16px;border-left:1px solid #E3DCEC"><span style="color:#8A7FA0;font-size:11px;text-transform:uppercase;letter-spacing:1px">Memo</span><br><a href="${memo}" style="color:#4A1F73;font-weight:bold;text-decoration:none">View PDF ›</a></td>` : ""}
      </tr></table></td></tr>
      <tr><td align="center" style="${F}padding:24px 28px 4px;font-size:14px;font-weight:bold;color:#1E1530">Will ${escH(t.brand)} participate?</td></tr>
      <tr><td align="center" style="padding:10px 28px 4px"><table role="presentation" cellpadding="0" cellspacing="0"><tr>${btn("yes", "Yes, we participate", true, 200)}<td width="12">&nbsp;</td>${btn("no", "No, not this time", false, 200)}</tr></table></td></tr>
      ${ar ? `<tr><td align="center" style="${F}padding:10px 28px 0;font-size:12px;color:#8A7FA0">${ar}</td></tr>` : ""}
      <tr><td style="${F}padding:24px 28px 22px;font-size:13px;line-height:1.6;color:#444">${sign}</td></tr>
      <tr><td style="${F}padding:14px 28px;background:#F6F3FA;font-size:11px;color:#8A7FA0;line-height:1.5">${foot}</td></tr>`);
  }
  return { to: t.emails.split(/,\s*/), subject, html };
}
/* a sample for the admin preview */
export function mailPreview(d, style, kind = "launch", arabic = true) {
  const c = { title: "Black Friday 2026", message: "ABC will run Black Friday from 27 to 30 November, supported by a mall-wide digital and on-site campaign.\nKindly confirm whether your store will participate. The full terms are in the memo.",
    act_from: "2026-11-27", act_to: "2026-11-30", end_day: "2026-11-05", memo_key: "x", memo_name: "Black-Friday-2026-Memo.pdf" };
  return mail(d, c, { token: "SAMPLE", site: "VRM", brand: "CARPISA", units: "L1-014", emails: "store@example.com" }, kind, style, arabic);
}
async function sendTo(env, d, c, list, kind) {
  const today = d.today(), go = list.filter(t => t.emails && !t.answer);
  if (!go.length) return 0;
  const X = await extCfg(env), msgs = go.map(t => mail(d, c, t, t.mails ? kind : "launch", X.emailStyle, X.arabic));
  for (let i = 0; i < go.length; i += 80) await env.DB.batch(go.slice(i, i + 80).map(t => env.DB.prepare("UPDATE mk_targets SET mails = mails + 1, last_mail = ? WHERE id = ?").bind(today, t.id)));
  if (d.sendMany) await d.sendMany(env, msgs);
  return go.length;
}
const stateOf = (c, today) => c.closed_at ? "closed" : today < c.start_day ? "scheduled" : today > c.end_day ? "closed" : "open";

/* ---------- the tenant's link ---------- */
export async function mkPublic(env, path, method, b, d) {
  const [tk, act] = path.split("/");
  if (!/^[A-Za-z0-9]{18}$/.test(tk)) throw err("This link is not valid", 404);
  const t = await env.DB.prepare("SELECT * FROM mk_targets WHERE token = ?").bind(tk).first();
  if (!t) throw err("This link is not valid", 404);
  const c = await env.DB.prepare("SELECT * FROM mk_campaigns WHERE id = ?").bind(t.campaign_id).first();
  const open = stateOf(c, d.today()) !== "closed";
  if (act === "memo") {
    if (!c.memo_key || !env.FILES) throw err("No memo attached", 404);
    const o = await env.FILES.get(c.memo_key); if (!o) throw err("The memo is missing", 404);
    return new Response(o.body, { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${(c.memo_name || "memo.pdf").replace(/"/g, "")}"`, "cache-control": "private, max-age=300" } });
  }
  if (!t.opened_at) await env.DB.prepare("UPDATE mk_targets SET opened_at = ? WHERE id = ?").bind(d.now(), t.id).run().catch(() => {});
  if (act === "answer" && method === "POST") {
    if (!open) throw err("The reply period has ended — contact the mall operations team");
    const a = b.answer === "yes" || b.answer === "no" ? b.answer : ""; if (!a) throw err("Choose Participating or Not participating");
    const changed = a !== t.answer;
    await env.DB.prepare(`UPDATE mk_targets SET answer = ?, answered_at = CASE WHEN ? THEN ? ELSE answered_at END, answered_by = 'tenant',
        offer = ?, details = ?, contact = ?, reason = ?, comment = ? WHERE id = ?`)
      .bind(a, changed || !t.answered_at ? 1 : 0, d.now(), a === "yes" ? clip(b.offer, 60) : "", a === "yes" ? txt(b.details, 400) : "", a === "yes" ? clip(b.contact, 120) : "",
        a === "no" ? clip(b.reason, 80) : "", a === "no" ? txt(b.comment, 400) : "", t.id).run();
    return { saved: true, answer: a };
  }
  if (method !== "GET") throw err("Unknown request", 404);
  return { brand: t.brand, site: t.site, siteName: d.siteName(t.site), title: c.title, message: c.message, actFrom: c.act_from, actTo: c.act_to, replyBy: c.end_day,
    memo: !!c.memo_key, memoName: c.memo_name, open, answer: t.answer, offer: t.offer, details: t.details, contact: t.contact, reason: t.reason, comment: t.comment,
    offers: MK_OFFERS, reasons: MK_REASONS };
}

/* ---------- hub routes ---------- */
function statsOf(rows) {
  const s = { invited: rows.length, yes: 0, no: 0, wait: 0, noEmail: 0 };
  for (const r of rows) { if (r.answer === "yes") s.yes++; else if (r.answer === "no") s.no++; else { s.wait++; if (!r.emails) s.noEmail++; } }
  s.pct = s.invited ? Math.round(s.yes / s.invited * 100) : 0; s.answered = s.invited ? Math.round((s.yes + s.no) / s.invited * 100) : 0;
  return s;
}
const campOut = (c, today) => ({ id: c.id, title: c.title, message: c.message, actFrom: c.act_from, actTo: c.act_to, start: c.start_day, end: c.end_day,
  sites: JSON.parse(c.sites), depts: JSON.parse(c.depts), positions: JSON.parse(c.positions), memo: !!c.memo_key, memoName: c.memo_name,
  by: c.created_by, at: c.created_at, launchedAt: c.launched_at, state: stateOf(c, today) });

export async function mkRoute(env, p, method, b, url, d) {
  const { me } = d, q = n => url.searchParams.get(n) || b[n] || "";
  const today = d.today(), ops = d.isOps(me);
  const mySites = Object.keys(d.SITES).filter(s => d.canSite(me, s));
  const campaign = async id => { const c = await env.DB.prepare("SELECT * FROM mk_campaigns WHERE id = ?").bind(Number(id)).first(); if (!c) throw err("Not found", 404);
    if (!JSON.parse(c.sites).some(s => mySites.includes(s))) throw err("No access to this activation", 403); return c; };
  if (p === "mk/list") {
    const cs = (await env.DB.prepare("SELECT * FROM mk_campaigns ORDER BY id DESC LIMIT 60").all()).results || [];
    const vis = cs.filter(c => JSON.parse(c.sites).some(s => mySites.includes(s)));
    const out = [];
    for (const c of vis) {
      const rows = (await env.DB.prepare("SELECT site, answer, emails FROM mk_targets WHERE campaign_id = ?").bind(c.id).all()).results || [];
      out.push({ ...campOut(c, today), stats: statsOf(rows.filter(r => mySites.includes(r.site))) });
    }
    return { list: out, ops, sites: Object.fromEntries(mySites.map(s => [s, d.siteName(s)])), today };
  }
  if (p === "mk/campaign") {
    const c = await campaign(q("id"));
    const rows = ((await env.DB.prepare("SELECT * FROM mk_targets WHERE campaign_id = ? ORDER BY site, brand").bind(c.id).all()).results || []).filter(r => mySites.includes(r.site));
    const sites = JSON.parse(c.sites).filter(s => mySites.includes(s)).map(s => ({ site: s, name: d.siteName(s), ...statsOf(rows.filter(r => r.site === s)) }));
    return { campaign: campOut(c, today), total: statsOf(rows), sites, ops,
      targets: rows.map(r => ({ id: r.id, site: r.site, brand: r.brand, units: r.units, dept: r.dept, emails: r.emails, answer: r.answer, at: r.answered_at, by: r.answered_by,
        offer: r.offer, details: r.details, contact: r.contact, reason: r.reason, comment: r.comment, mails: r.mails, lastMail: r.last_mail, opened: !!r.opened_at,
        link: ops ? `${d.hubUrl}/mk/${r.token}` : "" })) };
  }
  if (p === "mk/memo") {
    const c = await campaign(q("id"));
    if (!c.memo_key || !env.FILES) throw err("No memo", 404);
    const o = await env.FILES.get(c.memo_key); if (!o) throw err("The memo is missing", 404);
    return new Response(o.body, { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${(c.memo_name || "memo.pdf").replace(/"/g, "")}"` } });
  }
  const pickSites = v => (Array.isArray(v) ? v : String(v || "").split(",")).filter(s => mySites.includes(s));
  const arr = v => (Array.isArray(v) ? v : String(v || "").split("|")).map(x => clip(x, 60)).filter(Boolean).slice(0, 40);
  if (p === "mk/filters") return filters(env, pickSites(q("sites")));
  if (p === "mk/audience") {
    const sites = pickSites(b.sites || q("sites")); if (!sites.length) throw err("Choose at least one flagship");
    return { list: await audience(env, sites, arr(b.depts || q("depts")), arr(b.positions || q("positions"))) };
  }
  if (method !== "POST") throw err("Unknown request", 404);
  if (!ops) throw err("Only the operations team sends marketing activations", 403);
  if (p === "mk/create") {
    const title = clip(b.title, 120); if (!title) throw err("Give the activation a title");
    const sites = pickSites(b.sites); if (!sites.length) throw err("Choose at least one flagship");
    const start = isDay(b.start) ? b.start : today, end = isDay(b.end) ? b.end : "";
    if (!end) throw err("Set the reply-by date"); if (end < start) throw err("The reply-by date is before the start date"); if (end < today) throw err("The reply-by date has passed");
    const depts = arr(b.depts), positions = arr(b.positions);
    let list = await audience(env, sites, depts, positions);
    if (Array.isArray(b.only)) { const keep = new Set(b.only.map(String)); list = list.filter(t => keep.has(`${t.site}|${t.brand}`)); }
    const extra = b.extraEmails && typeof b.extraEmails === "object" ? b.extraEmails : {};
    for (const t of list) { const x = extra[`${t.site}|${t.brand}`]; if (x) t.emails = cleanEmails(x); }
    if (!list.length) throw err("No tenant matches these filters");
    let memoKey = "", memoName = "";
    if (b.memo && b.memo.data) {
      const m = /^data:application\/pdf;base64,(.+)$/.exec(String(b.memo.data)); if (!m) throw err("The memo must be a PDF");
      const bin = Uint8Array.from(atob(m[1]), x => x.charCodeAt(0)); if (bin.byteLength > MAX_MEMO) throw err("The memo is larger than 8 MB");
      if (!env.FILES) throw err("File storage is not available right now", 503);
      memoKey = `mk/${crypto.randomUUID()}.pdf`; memoName = clip(b.memo.name, 100) || "memo.pdf";
      await env.FILES.put(memoKey, bin, { httpMetadata: { contentType: "application/pdf" } });
    }
    const now = d.now();
    const r = await env.DB.prepare(`INSERT INTO mk_campaigns (title, message, act_from, act_to, start_day, end_day, sites, depts, positions, memo_key, memo_name, created_by, created_email, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(title, txt(b.message, 3000), isDay(b.actFrom) ? b.actFrom : "", isDay(b.actTo) ? b.actTo : "", start, end,
      JSON.stringify(sites), JSON.stringify(depts), JSON.stringify(positions), memoKey, memoName, me.full_name || me.email, me.email, now).run();
    const id = r.meta.last_row_id;
    for (let i = 0; i < list.length; i += 80) await env.DB.batch(list.slice(i, i + 80).map(t => env.DB.prepare(`INSERT INTO mk_targets (campaign_id, site, brand, units, dept, emails, token) VALUES (?,?,?,?,?,?,?)`)
      .bind(id, t.site, t.brand, t.units, t.dept, t.emails, token())));
    let mailed = 0;
    if (start <= today) mailed = await launch(env, d, id);
    return { id, tenants: list.length, mailed, scheduled: start > today };
  }
  const c = await campaign(b.id);
  if (p === "mk/remind") {
    if (stateOf(c, today) !== "open") throw err(stateOf(c, today) === "scheduled" ? "This activation has not started yet" : "This activation is closed");
    let rows = ((await env.DB.prepare("SELECT * FROM mk_targets WHERE campaign_id = ? AND answer = ''").bind(c.id).all()).results || []).filter(r => mySites.includes(r.site));
    if (b.site) rows = rows.filter(r => r.site === b.site);
    if (b.target) rows = rows.filter(r => r.id === Number(b.target));
    if (!c.launched_at) await env.DB.prepare("UPDATE mk_campaigns SET launched_at = ? WHERE id = ?").bind(d.now(), c.id).run();
    const n = await sendTo(env, d, c, rows, "reminder");
    if (!n) throw err(rows.length ? "These tenants have no email — add one first" : "Everyone has answered ✓");
    return { sent: n };
  }
  if (p === "mk/target") {   // edit emails or record an answer given by phone / in person
    const t = await env.DB.prepare("SELECT * FROM mk_targets WHERE id = ? AND campaign_id = ?").bind(Number(b.target), c.id).first();
    if (!t || !mySites.includes(t.site)) throw err("Not found", 404);
    if ("emails" in b) await env.DB.prepare("UPDATE mk_targets SET emails = ? WHERE id = ?").bind(cleanEmails(b.emails), t.id).run();
    if ("answer" in b) {
      const a = ["yes", "no", ""].includes(b.answer) ? b.answer : t.answer;
      await env.DB.prepare("UPDATE mk_targets SET answer = ?, answered_at = ?, answered_by = ?, reason = CASE WHEN ? = 'no' THEN ? ELSE '' END, comment = ? WHERE id = ?")
        .bind(a, a ? d.now() : "", a ? (me.full_name || me.email) : "", a, clip(b.reason, 80), txt(b.comment, 400), t.id).run();
    }
    return { saved: true };
  }
  if (p === "mk/close") { await env.DB.prepare("UPDATE mk_campaigns SET closed_at = ? WHERE id = ?").bind(d.now(), c.id).run(); return { closed: true }; }
  if (p === "mk/edit") {   // extend the reply-by date
    const end = isDay(b.end) ? b.end : ""; if (!end || end < today) throw err("Choose a reply-by date from today");
    await env.DB.prepare("UPDATE mk_campaigns SET end_day = ?, closed_at = '', summary_done = 0 WHERE id = ?").bind(end, c.id).run(); return { saved: true };
  }
  throw err("Unknown request", 404);
}
async function launch(env, d, id) {
  const c = await env.DB.prepare("SELECT * FROM mk_campaigns WHERE id = ?").bind(id).first();
  await env.DB.prepare("UPDATE mk_campaigns SET launched_at = ? WHERE id = ?").bind(d.now(), id).run();
  const rows = (await env.DB.prepare("SELECT * FROM mk_targets WHERE campaign_id = ?").bind(id).all()).results || [];
  return sendTo(env, d, c, rows, "launch");
}

/* ---------- cron: send on the start day, remind every day to the reply-by date, summary after it ---------- */
export async function mkRun(env, d) {
  if (d.hour() < 9) return;
  const today = d.today();
  const g = await env.DB.prepare("SELECT v FROM meta WHERE k = 'mk:run'").first().catch(() => null);
  if (g && g.v === today) return;
  await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('mk:run', ?)").bind(today).run();
  const cs = (await env.DB.prepare("SELECT * FROM mk_campaigns WHERE closed_at = '' AND summary_done = 0").all()).results || [];
  for (const c of cs) {
    try {
      if (today < c.start_day) continue;
      if (today <= c.end_day) {
        if (!c.launched_at) { await launch(env, d, c.id); continue; }
        const rows = (await env.DB.prepare("SELECT * FROM mk_targets WHERE campaign_id = ? AND answer = '' AND emails != '' AND last_mail < ?").bind(c.id, today).all()).results || [];
        await sendTo(env, d, c, rows, "reminder");
        continue;
      }
      /* the reply-by date has passed: one summary per flagship to the operations team */
      const rows = (await env.DB.prepare("SELECT site, answer, emails FROM mk_targets WHERE campaign_id = ?").bind(c.id).all()).results || [];
      for (const s of JSON.parse(c.sites)) {
        const st = statsOf(rows.filter(r => r.site === s)); if (!st.invited) continue;
        if (d.raiseEvent) await d.raiseEvent(env, { site: s, app: "mkt-ops", tone: "info", title: `${c.title} · ${st.pct}% participating`,
          body: `${st.yes} participating · ${st.no} not · ${st.wait} no reply (of ${st.invited})` }).catch(() => {});
      }
      await env.DB.prepare("UPDATE mk_campaigns SET summary_done = 1 WHERE id = ?").bind(c.id).run();
    } catch (e) { console.error("mk", c.id, e && e.message); }
  }
}
