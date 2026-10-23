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
function mail(d, c, t, kind) {
  const link = `${d.hubUrl}/mk/${t.token}`, sn = d.siteName(t.site), F = "font-family:Calibri,Arial,sans-serif;";
  const title = kind === "reminder" ? `Reminder: ${c.title} — please confirm your participation` : `${c.title} — participation memo`;
  const facts = [["Activity", escH(c.title)], c.act_from && ["Dates", escH(longDay(c.act_from)) + (c.act_to && c.act_to !== c.act_from ? " – " + escH(longDay(c.act_to)) : "")], ["Reply by", `<b>${escH(longDay(c.end_day))}</b>`]].filter(Boolean)
    .map(([k, v]) => `<tr><td style="${F}padding:3px 14px 3px 0;color:#6D6479">${k}</td><td style="${F}padding:3px 0">${v}</td></tr>`).join("");
  const btn = (a, label, bg, fg, bd) => `<a href="${link}?a=${a}" style="${F}display:inline-block;background:${bg};color:${fg};border:2px solid ${bd};text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:bold;font-size:15px;margin:4px">${label}</a>`;
  const html = `<div style="${F}max-width:620px;color:#22163A"><div style="background:#4A1F73;color:#fff;padding:16px 20px;border-radius:10px 10px 0 0"><span style="opacity:.8;font-size:12px;letter-spacing:1px">ABC ${escH(sn.toUpperCase())} · MARKETING ACTIVATION</span><br><b style="font-size:18px">${escH(title)}</b></div>
    <div style="border:1px solid #e4deec;border-top:0;padding:18px 20px;border-radius:0 0 10px 10px">
    <p>Dear <b>${escH(t.brand)}</b> team,</p>
    ${kind === "reminder" ? `<p>We have not yet received your answer for <b>${escH(c.title)}</b>. Please confirm below — it takes one tap.</p>` : ""}
    <div style="white-space:pre-line">${escH(c.message)}</div>
    <table style="border-collapse:collapse;margin:12px 0">${facts}</table>
    ${c.memo_key ? `<p><a href="${d.hubUrl}/api/mk-ext/${t.token}/memo" style="color:#4A1F73;font-weight:bold">📄 Open the memo (${escH(c.memo_name || "PDF")})</a></p>` : ""}
    <div style="background:#F7F4FA;border-radius:12px;padding:16px;text-align:center;margin:14px 0">
      <p style="margin:0 0 10px;font-weight:bold">Will ${escH(t.brand)} participate?</p>
      ${btn("yes", "✓ Participating", "#1E8A4C", "#ffffff", "#1E8A4C")} ${btn("no", "✗ Not participating", "#ffffff", "#B03A2E", "#B03A2E")}
      <p dir="rtl" style="margin:10px 0 0;color:#6D6479;font-size:13px">هل ستشاركون؟ اضغط على أحد الزرين</p></div>
    <p style="font-size:12px;color:#777">One tap records your answer and you can change it until ${escH(longDay(c.end_day))}. Daily reminders stop as soon as you answer. This link is personal to ${escH(t.brand)}.</p>
    <p>Kind regards,<br>ABC ${escH(sn)} — Operations Team, on behalf of Marketing</p></div></div>`;
  return { to: t.emails.split(/,\s*/), subject: `ABC ${sn} · ${title} · ${t.brand}`, html };
}
async function sendTo(env, d, c, list, kind) {
  const today = d.today(), go = list.filter(t => t.emails && !t.answer);
  if (!go.length) return 0;
  const msgs = go.map(t => mail(d, c, t, t.mails ? kind : "launch"));
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
