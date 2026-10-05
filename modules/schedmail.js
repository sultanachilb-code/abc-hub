/* =====================================================================
   WEEKLY SCHEDULE EMAIL — feature module (kept separate so it can be removed cleanly)
   See docs/FEATURE-schedule-email.md

   Every Sunday the flagship's operations schedule for the coming week (Monday → Sunday) is emailed:
     Subject : ABC Verdun: Operations Weekly Schedule October 5th till October 11th, 2026
     To      : the flagship's Mall Manager / Senior Mall Manager (People & roles)
     Cc      : the flagship's list (Hub administration → ABC Operations Groups → Weekly schedule Cc)
     From    : ABC Operations Hub, replies go to the person who sends it — signed with their name and position
   Reminders to the flagship's operations team: Wednesday 10:00 "finalize next week's schedule",
   Sunday 10:00 "send the weekly schedule", Sunday 18:00 again if it is still not sent.
   After sending, any change to that week turns the button into "Send update" (subject starts with "UPDATED:").
   Routes : /api/ops/schedmail/* · /api/admin/schedcc
   ===================================================================== */

const err = (m, status = 400) => Object.assign(new Error(m), { status });
const addDays = (d, n) => { const t = new Date(d + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const mondayOf = d => { const t = new Date(d + "T12:00:00Z"); return addDays(d, -((t.getUTCDay() + 6) % 7)); };
const isDay = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const FLAG = { VRM: "ABC Verdun", ACM: "ABC Achrafieh", DBS: "ABC Dbayeh", VRS: "ABC Verdun DS", ACS: "ABC Achrafieh DS" };
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const ord = n => n + (n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th");
const longDay = d => `${MONTHS[+d.slice(5, 7) - 1]} ${ord(+d.slice(8))}`;
export const DEFAULT_CC = {
  VRM: "ABC Verdun Operations <abcverdunoperations@abc.com.lb>; Reception Verdun <receptionverdun@abc.com.lb>; Charbel Farhat <cfarhat@abc.com.lb>; Liban Park Verdun <libanparkverdun@abc.com.lb>; CCTV Verdun <cctvverdunmall@abc.com.lb>; Call Center Agent <cca@ABCSALIT.onmicrosoft.com>; csvrd@abc.com.lb; Middle East Security Verdun <mesv@abc.com.lb>; Soft Operations <softoperations@bpm-services.com>; BPM Verdun <bpmverdun@abc.com.lb>"
};
const CALL_CENTER = "Call Center Agent <cca@ABCSALIT.onmicrosoft.com>";
/* "Name <a@b>; c@d" → [{name, email}] */
export function parseList(s) {
  return String(s || "").split(/[;,\n]+/).map(x => x.trim()).filter(Boolean).map(x => {
    const m = /^"?([^"<]*?)"?\s*<([^>]+)>$/.exec(x);
    return m ? { name: m[1].trim(), email: m[2].trim() } : { name: "", email: x.replace(/[<>]/g, "") };
  }).filter(x => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x.email));
}
const fmtList = L => L.map(x => x.name ? `${x.name} <${x.email}>` : x.email).join("; ");
export async function ccFor(env, site) {
  const r = await env.DB.prepare("SELECT v FROM meta WHERE k = 'schedcc'").first().catch(() => null);
  let g = {}; try { g = r ? JSON.parse(r.v) : {}; } catch {}
  let list = parseList(g[site] != null ? g[site] : DEFAULT_CC[site] || "");
  if (g[site] == null && !list.some(x => /cca@abcsalit/i.test(x.email))) list.push(...parseList(CALL_CENTER));   // call center: all flagships
  return list;
}

/* ---------- the week ---------- */
const hm = t => { const [h, m] = String(t).split(":").map(Number); return h * 60 + (m || 0); };
const hoursOf = v => { if (!v || !v.includes("-")) return 0; const [a, b] = v.split("-").map(hm); let d = b - a; if (d <= 0) d += 1440; return d / 60; };
const isShift = v => /^\d{2}:\d{2}-\d{2}:\d{2}$/.test(v);
async function weekData(env, site, monday, d) {
  const sunday = addDays(monday, 6);
  const [cells, notes, staff] = await Promise.all([
    env.DB.prepare("SELECT day, email, val FROM sched_cells WHERE site = ? AND day BETWEEN ? AND ?").bind(site, monday, sunday).all(),
    env.DB.prepare("SELECT day, note FROM sched_notes WHERE site = ? AND day BETWEEN ? AND ?").bind(site, monday, sunday).all(),
    d.siteStaff(env, site)
  ]);
  const people = d.schedStaff ? await d.schedStaff(env, site) : staff.filter(s => s.atSite && d.POSITIONS[s.position]);   // same order and sections as the schedule page
  const map = Object.fromEntries((cells.results || []).map(c => [`${c.email}|${c.day}`, c.val]));
  const noteMap = Object.fromEntries((notes.results || []).map(n => [n.day, n.note]));
  const days = [...Array(7)].map((_, i) => addDays(monday, i));
  const sig = JSON.stringify([days.map(x => noteMap[x] || ""), people.map(p => [p.email, days.map(x => map[`${p.email}|${x}`] || "")])]);
  const managers = staff.filter(s => s.atSite && ["MM", "SMM"].includes(s.position));
  return { monday, sunday, days, people, map, noteMap, sig, managers, filled: (cells.results || []).length };
}
async function hashOf(s) { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].slice(0, 12).map(b => b.toString(16).padStart(2, "0")).join(""); }

/* ---------- the email (Outlook-safe table, inline styles) ---------- */
const F = "font-family:Calibri,Arial,sans-serif;";
const CODE_STYLE = { OFF: ["#E5484D", "#fff"], VAC: ["#FFC000", "#3B2A00"], SICK: ["#FFC000", "#3B2A00"], DEATH: ["#FFC000", "#3B2A00"], UL: ["#FFC000", "#3B2A00"],
  HOLI: ["#8E6BD8", "#fff"], TRAIN: ["#2F80ED", "#fff"], OTH: ["#1F9E8F", "#fff"] };
const shiftBg = v => { const s = hm(v.split("-")[0]) / 60; return s < 10 ? "#E3EEFF" : s < 14 ? "#E1F5EA" : "#ECE3F6"; };
export function scheduleHtml(W, { siteName, codes, greeting, sender, update }) {
  const B = "border:1px solid #D9D2E3;";
  const th = `${F}font-size:12px;background:#2A0F45;color:#fff;padding:8px 4px;border:1px solid #2A0F45`;
  const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const head = `<tr><th style="${th};text-align:left;padding-left:10px">Location &amp; name</th>${W.days.map((x, i) => `<th style="${th}">${DOW[i]}<br><span style="font-weight:normal;font-size:11px">${+x.slice(8)} ${MON[+x.slice(5, 7) - 1]}</span></th>`).join("")}<th style="${th}">T.hrs</th></tr>`;
  const notes = `<tr><td style="${F}font-size:12px;font-weight:bold;color:#6D6479;background:#D9E2F3;padding:6px 10px;${B}">Notes</td>${W.days.map(x => `<td style="${F}font-size:11px;text-align:center;background:#D9E2F3;padding:4px;${B}">${esc(W.noteMap[x] || "—")}</td>`).join("")}<td style="background:#D9E2F3;${B}"></td></tr>`;
  const cell = v => {
    const base = `${F}font-size:12px;text-align:center;padding:6px 4px;${B}`;
    if (isShift(v)) { const [a, b] = v.split("-"); return `<td style="${base}background:${shiftBg(v)};color:#221A2E"><b>${a}–${b}</b><br><span style="font-size:10px;color:#6D6479">${hoursOf(v)}h</span></td>`; }
    if (v) { const [bg, fg] = CODE_STYLE[v] || ["#eee", "#333"]; return `<td style="${base}background:${bg};color:${fg}"><b>${esc(v)}</b><br><span style="font-size:10px">${esc(((codes[v] || {}).label || "").replace(/\s*\(.*\)/, ""))}</span></td>`; }
    return `<td style="${base}color:#B9B0C6">—</td>`;
  };
  let rows = "", last = null;
  for (const p of W.people) {
    if (p.positionLabel !== last) { rows += `<tr><td colspan="9" style="${F}font-size:11px;font-weight:bold;letter-spacing:1px;color:#6D6479;background:#F3F0F7;padding:6px 10px;${B}">${esc(p.positionLabel.toUpperCase())}</td></tr>`; last = p.positionLabel; }
    const vals = W.days.map(x => W.map[`${p.email}|${x}`] || "");
    const tot = vals.reduce((a, v) => a + hoursOf(v), 0);
    rows += `<tr><td style="${F}font-size:13px;padding:6px 10px;white-space:nowrap;${B}"><b>${esc(p.name)}</b><br><span style="font-size:11px;color:#6D6479">${esc(p.title || p.positionLabel)}</span></td>${vals.map(cell).join("")}<td style="${F}font-size:13px;font-weight:bold;text-align:center;${B}">${tot || "—"}</td></tr>`;
  }
  const foot = `<tr><td style="${F}font-size:12px;font-weight:bold;background:#F3F0F7;padding:6px 10px;${B}">On duty</td>${W.days.map(x => {
    let am = 0, pm = 0;
    for (const p of W.people) { const v = W.map[`${p.email}|${x}`] || ""; if (!isShift(v)) continue; const [a, b] = v.split("-").map(hm); if (a < 720) am++; if (b >= 1200 || b <= a) pm++; }
    return `<td style="${F}font-size:11px;text-align:center;background:#F3F0F7;${B}"><b>${am}</b> AM · <b>${pm}</b> PM</td>`; }).join("")}<td style="background:#F3F0F7;${B}"></td></tr>`;
  const sw = c => `<span style="display:inline-block;width:10px;height:10px;background:${c};vertical-align:middle"></span>`;
  const used = [...new Set(Object.values(W.map).filter(v => v && !isShift(v)))];
  const legend = `${sw("#E3EEFF")} Morning start &nbsp; ${sw("#E1F5EA")} Midday start &nbsp; ${sw("#ECE3F6")} Evening / night start` + used.map(c => ` &nbsp; ${sw((CODE_STYLE[c] || ["#eee"])[0])} ${esc(c)} · ${esc(((codes[c] || {}).label || "").replace(/\s*\(.*\)/, ""))}`).join("");
  const range = `Monday ${+W.monday.slice(8)} ${MONTHS[+W.monday.slice(5, 7) - 1]} till Sunday ${+W.sunday.slice(8)} ${MONTHS[+W.sunday.slice(5, 7) - 1]} ${W.sunday.slice(0, 4)}`;
  return `<div style="${F}color:#221A2E">
<p style="${F}font-size:14px">${esc(greeting)},<br><br>${update ? "Please find below the <b>updated</b>" : "Please find below the"} ${esc(siteName)} operations schedule for the week of <b>${range}</b>.</p>
<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;max-width:980px">${head}${notes}${rows}${foot}</table>
<p style="${F}font-size:11px;color:#6D6479;margin-top:8px">${legend}</p>
<p style="${F}font-size:14px">For any change during the week, the updated schedule will be shared.<br><br>Best regards,<br><b>${esc(sender.name)}</b><br>${esc(sender.position)} · ${esc(FLAG_NAME(sender.site))}</p></div>`;
}
const FLAG_NAME = site => FLAG[site] || "ABC";

async function compose(env, site, monday, me, d, update) {
  const W = await weekData(env, site, monday, d);
  const to = W.managers.map(m => ({ name: m.name, email: m.email }));
  const cc = await ccFor(env, site);
  const first = to.length ? to.map(x => x.name.split(" ")[0]).join(" and ") : "All";
  const subject = `${update ? "UPDATED: " : ""}${FLAG[site] || "ABC " + d.siteName(site)}: Operations Weekly Schedule ${longDay(W.monday)} till ${longDay(W.sunday)}, ${W.sunday.slice(0, 4)}`;
  const html = scheduleHtml(W, { siteName: d.siteName(site), codes: d.SHIFT_CODES, greeting: `Dear ${first}`, update,
    sender: { name: me.full_name, position: d.posLabel(me.position) || d.ROLES[me.role] || "", site } });
  return { W, to, cc, subject, html };
}
async function sentOf(env, site, monday) {
  const r = await env.DB.prepare("SELECT v FROM meta WHERE k = ?").bind(`schedsent:${site}:${monday}`).first().catch(() => null);
  try { return r ? JSON.parse(r.v) : null; } catch { return null; }
}

/* ---------- routes ---------- */
export async function schedMailRoute(env, p, method, b, url, d) {
  const { site, me } = d;
  if (!d.canSite(me, site)) throw err("No access to this flagship", 403);
  const team = d.isFull(me) || me.role === "SUPERVISOR";
  const wk = url.searchParams.get("week") || b.week;
  const monday = isDay(wk) ? mondayOf(wk) : mondayOf(addDays(d.today(), 1));
  const sent = await sentOf(env, site, monday);
  if (p === "schedmail/status") {
    const W = await weekData(env, site, monday, d);
    const sig = await hashOf(W.sig);
    return { monday, sent, changed: !!(sent && sent.sig !== sig), filled: W.filled, people: W.people.length, flag: FLAG[site] || "ABC " + d.siteName(site), can: { send: team } };
  }
  if (p === "schedmail/preview") {
    const c = await compose(env, site, monday, me, d, !!sent);
    return { subject: c.subject, to: c.to, cc: c.cc, html: c.html, sent, filled: c.W.filled };
  }
  if (p === "schedmail/send" && method === "POST") {
    if (!team) throw err("Only the flagship's operations team can send the schedule", 403);
    const c = await compose(env, site, monday, me, d, !!sent);
    if (!c.W.filled) throw err("This week is empty — fill the schedule first");
    if (!c.to.length) throw err("No Mall Manager is set for this flagship in People & roles");
    const r = await d.relay(env, { to: c.to.map(x => x.email), cc: c.cc.map(x => x.email), replyTo: me.email, subject: c.subject, html: c.html });
    if (!r.ok) throw err("The email could not be sent: " + (r.error || "mail relay error"), 502);
    const rec = { at: d.now(), by: me.full_name, email: me.email, sig: await hashOf(c.W.sig), count: ((sent && sent.count) || 0) + 1, subject: c.subject };
    await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)").bind(`schedsent:${site}:${monday}`, JSON.stringify(rec)).run();
    await d.raiseEvent(env, { site, app: "schedule", tone: "info", title: `${sent ? "Updated schedule sent" : "Weekly schedule sent"} · ${longDay(c.W.monday)} – ${longDay(c.W.sunday)}`,
      body: `${d.siteName(site)} · by ${me.full_name} · to ${c.to.map(x => x.name).join(", ")} + ${c.cc.length} in Cc` });
    if (d.audit) await d.audit(env, { me, site, tool: "schedule", ref: monday, label: c.subject, action: "submit", changes: [] });
    return { sent: rec };
  }
  throw err("Unknown request", 404);
}
/* admin: the Cc list per flagship */
export async function schedCcAdmin(env, method, b, SITES) {
  const r = await env.DB.prepare("SELECT v FROM meta WHERE k = 'schedcc'").first().catch(() => null);
  let g = {}; try { g = r ? JSON.parse(r.v) : {}; } catch {}
  if (method === "POST") {
    const site = String(b.site || "").toUpperCase();
    if (!SITES[site]) throw err("Choose a flagship");
    const list = parseList(b.cc);
    const bad = String(b.cc || "").split(/[;,\n]+/).map(x => x.trim()).filter(Boolean).length - list.length;
    if (bad > 0) throw err(`${bad} address${bad === 1 ? " is" : "es are"} not valid — check the list`);
    g[site] = fmtList(list);
    await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('schedcc', ?)").bind(JSON.stringify(g)).run();
  }
  const out = {};
  for (const s of Object.keys(SITES)) out[s] = fmtList(await ccFor(env, s));
  return { cc: out };
}

/* ---------- cron reminders (Beirut time) ---------- */
export async function schedMailRun(env, deps) {
  const today = deps.today();
  const dow = new Date(today + "T12:00:00Z").getUTCDay();   // 0 Sunday … 3 Wednesday
  const hour = deps.hour();
  if (!((dow === 3 && hour >= 10) || (dow === 0 && hour >= 10))) return;
  const next = mondayOf(addDays(today, dow === 0 ? 1 : 7 - 2));   // the coming week
  for (const site of Object.keys(deps.SITES)) {
    let step = "wed";
    if (dow === 0) {
      if (await sentOf(env, site, next)) continue;
      const had = await env.DB.prepare("SELECT 1 AS x FROM meta WHERE k = ?").bind(`schedrem:${site}:${next}:sun`).first();
      step = !had ? "sun" : hour >= 18 ? "sun2" : "";
      if (!step) continue;
    }
    const claim = await env.DB.prepare("INSERT OR IGNORE INTO meta (k, v) VALUES (?, ?)").bind(`schedrem:${site}:${next}:${step}`, deps.now()).run();
    if (!claim.meta || claim.meta.changes !== 1) continue;
    const range = `${longDay(next)} – ${longDay(addDays(next, 6))}`;
    await deps.raiseEvent(env, { site, app: "schedule", tone: step === "wed" ? "info" : "warn",
      title: step === "wed" ? `Finalize next week's schedule · ${range}` : step === "sun" ? `Send the weekly schedule today · ${range}` : `Weekly schedule still not sent · ${range}`,
      body: step === "wed" ? "Complete the Operations Schedule before Sunday — it is emailed to the Mall Manager and the flagship's teams."
        : "Open the Operations Schedule and press “Submit & send”." });
  }
}
