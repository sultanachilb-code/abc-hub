/* =====================================================================
   EMAIL INBOX — Minutes of Meeting, Operations Calendar and the contracts report by email
   See docs/FEATURE-email-inbox.md

   Same Gmail as Tenant Works Forms (Apps Script "hub-inbox.gs" forwards to POST /api/inbox/mail with INBOX_KEY).
   Addresses (TAG = the secret word):
     …+mom-<flagship>-<TAG>@gmail.com        → a draft Minutes of Meeting (title, date, location, participants, points)
     …+cal-<flagship>-<TAG>@gmail.com        → an Operations Calendar entry (marketing event by default;
                                                subject starting "Ops:", "Expiry:" or "Objective:" picks the kind)
     …+contracts-<TAG>@gmail.com             → the daily "contracts near ending" Excel report (all flagships)
     …+portal-<TAG>@gmail.com                → the portal reports (Breaches & Penalties, Violations, ABC Requests — any flagship)
   A meeting invitation (.ics) gives the exact date, time, place and attendees; otherwise the first date in the
   subject or the email, else the day the email was sent. The sender must be a hub user of that flagship
   (operations team for MOM / calendar); nothing is ever replied — the flagship gets a hub notification.
   ===================================================================== */
import { contractsImport } from "./contracts.js";
import { portalImport } from "./portal.js";   // Tenant portal follow-up: Breaches & Penalties · Violations · ABC Requests reports

const err = (m, status = 400) => Object.assign(new Error(m), { status });
const clip = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
const isDay = v => /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v + "T12:00:00Z"));
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

/* ---------- .ics (meeting invitation) ---------- */
export function parseIcs(text) {
  const lines = String(text || "").replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  const ev = {}; let inEv = false; const att = [];
  for (const l of lines) {
    if (/^BEGIN:VEVENT/.test(l)) { inEv = true; continue; }
    if (/^END:VEVENT/.test(l)) break;
    if (!inEv) continue;
    const i = l.indexOf(":"); if (i < 0) continue;
    const head = l.slice(0, i), val = l.slice(i + 1).replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");
    const [name, ...params] = head.split(";");
    const P = Object.fromEntries(params.map(p => p.split("=")).map(([k, v]) => [k.toUpperCase(), (v || "").replace(/^"|"$/g, "")]));
    if (name === "ATTENDEE" || name === "ORGANIZER") att.push({ name: P.CN || "", email: val.replace(/^mailto:/i, "").toLowerCase(), organizer: name === "ORGANIZER" });
    else ev[name] = { val, P };
  }
  if (!ev.DTSTART) return null;
  const when = x => {
    if (!x) return null;
    const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})\d{0,2}(Z)?)?/.exec(x.val); if (!m) return null;
    if (!m[4]) return { day: `${m[1]}-${m[2]}-${m[3]}`, time: "" };
    let t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
    if (!m[6]) { /* local time with TZID — Beirut-style zones taken as written */ return { day: `${m[1]}-${m[2]}-${m[3]}`, time: `${m[4]}:${m[5]}` }; }
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Beirut", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
      .formatToParts(new Date(t)).map(x => [x.type, x.value]));
    return { day: `${p.year}-${p.month}-${p.day}`, time: `${String(Number(p.hour) % 24).padStart(2, "0")}:${p.minute}` };
  };
  return { title: ev.SUMMARY ? ev.SUMMARY.val : "", location: ev.LOCATION ? ev.LOCATION.val : "", desc: ev.DESCRIPTION ? ev.DESCRIPTION.val : "",
    start: when(ev.DTSTART), end: when(ev.DTEND), attendees: att };
}
/* dates written in a text, in order: 12/10/2026 · 12-10-26 · 12 Oct 2026 · October 12 · 2026-10-12 */
const DATE_RES = [
  [/\b(\d{4})-(\d{2})-(\d{2})\b/g, (m, y) => `${m[1]}-${m[2]}-${m[3]}`],
  [/\b(\d{1,2})[\/.](\d{1,2})[\/.](\d{2,4})\b/g, m => +m[2] <= 12 && +m[1] <= 31 ? `${m[3].length === 2 ? "20" + m[3] : m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : ""],
  [/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?,?(?:\s+(\d{4}))?\b/gi, (m, y) => `${m[3] || y}-${String(MON[m[2].toLowerCase()]).padStart(2, "0")}-${m[1].padStart(2, "0")}`],
  [/\b(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?(?:\s+(\d{4}))?\b/gi, (m, y) => `${m[3] || y}-${String(MON[m[1].toLowerCase()]).padStart(2, "0")}-${m[2].padStart(2, "0")}`]
];
export function findDates(text, fallbackYear) {
  const s = String(text || ""), hits = [];
  for (const [re, f] of DATE_RES) for (const m of s.matchAll(re)) { const d = f(m, fallbackYear); if (d && isDay(d) && !hits.some(h => m.index < h.i + h.len && h.i < m.index + m[0].length)) hits.push({ day: d, i: m.index, len: m[0].length, text: m[0] }); }
  return hits.sort((a, b) => a.i - b.i);
}
export const findDate = (text, y) => (findDates(text, y)[0] || {}).day || "";
/* the email text without the forwarded header block, quoted replies and signature */
function cleanBody(body) {
  const L = String(body || "").replace(/\r/g, "").split("\n");
  const out = [];
  for (const l of L) {
    const t = l.trim();
    if (/^(-{2,}|_{5,}).*(forwarded|original) message/i.test(t)) continue;
    if (/^(from|sent|to|cc|subject|date|من|إلى|الموضوع):\s/i.test(t)) continue;
    if (/^(regards|best regards|kind regards|thanks|thank you|br,|مع التحية)/i.test(t)) break;
    if (/^>/.test(t)) continue;
    out.push(l);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
/* bullet / numbered lines → points; otherwise the paragraphs */
function pointsOf(text) {
  const L = text.split("\n").map(x => x.trim()).filter(Boolean);
  const bullets = L.filter(x => /^([-•*▪●◦]|\d{1,2}[.)-]|[a-z][.)])\s+/i.test(x)).map(x => x.replace(/^([-•*▪●◦]|\d{1,2}[.)-]|[a-z][.)])\s+/i, ""));
  const pts = bullets.length >= 2 ? bullets : L.filter(x => x.length > 3 && !/^(dear|hi|hello|good (morning|afternoon|evening))\b/i.test(x));
  return pts.map(x => x.slice(0, 400)).slice(0, 40);
}
const userBy = (env, email) => env.DB.prepare("SELECT * FROM users WHERE lower(email) = ? AND active = 1").bind(String(email || "").toLowerCase()).first();
const addrList = s => String(s || "").split(/[,;]/).map(x => { const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>/.exec(x); return m ? { name: m[1].trim(), email: m[2].trim().toLowerCase() } : { name: "", email: x.trim().toLowerCase() }; })
  .filter(x => /@/.test(x.email));

export async function mailInbox(env, request, body, d) {
  if (!env.INBOX_KEY) throw err("The hub inbox is not set up (INBOX_KEY secret is missing)", 503);
  const key = request.headers.get("x-inbox-key") || "";
  if (key.length !== env.INBOX_KEY.length || key !== env.INBOX_KEY) throw err("Wrong inbox key", 403);
  const kind = ["mom", "cal", "contracts", "portal"].includes(body.kind) ? body.kind : "";
  if (!kind) throw err("Unknown kind");
  const from = clip(body.from, 160).toLowerCase();
  let u = await userBy(env, from);
  /* the report emails (contracts near ending, portal reports) usually come from IT or a Salesforce subscription, not a hub user:
     accepted from any company address (REPORT_DOMAINS, default abc.com.lb) or from a sender listed in REPORT_SENDERS / PORTAL_SENDERS.
     The secret tag in the address already keeps strangers out. */
  if (!u && (kind === "contracts" || kind === "portal")) {
    const list = `${env.REPORT_SENDERS || ""},${env.PORTAL_SENDERS || ""}`.toLowerCase().split(/[\s,;]+/).filter(Boolean);
    const doms = String(env.REPORT_DOMAINS || "abc.com.lb").toLowerCase().split(/[\s,;]+/).filter(Boolean);
    if (list.includes(from) || doms.some(dm => from.endsWith("@" + dm) || from.endsWith("." + dm))) u = { full_name: from, email: from };
  }
  if (!u) return { accepted: false, reason: `${from || "The sender"} is not a hub user — ignored` };
  const msgId = clip(body.msgId, 200);
  if (msgId) {
    const claim = await env.DB.prepare("INSERT OR IGNORE INTO meta (k, v) VALUES (?, ?)").bind(`inbox:${kind}:${msgId}`, d.now()).run();
    if (!claim.meta || claim.meta.changes !== 1) return { accepted: true, duplicate: true, reason: "Already added" };
  }
  try {
    if (kind === "portal") {
      const files = (Array.isArray(body.files) ? body.files : []).slice(0, 6);
      if (!files.length) return { accepted: false, reason: "No report attached" };
      const r = await portalImport(env, d, { files, from: u.full_name });
      return { accepted: true, ...r, reason: r.files.map(f => f.error ? `${f.file}: ${f.error}` : `${f.kinds.join(", ")}: ${f.rows} items · ${f.added} new · ${f.changed} status changes · ${f.gone} no longer in the report`).join(" | ") };
    }
    if (kind === "contracts") {
      const files = (Array.isArray(body.files) ? body.files : []).slice(0, 5);
      if (!files.length) return { accepted: false, reason: "No Excel attached" };
      const r = await contractsImport(env, d, { files, from: u.full_name });
      return { accepted: true, ...r, reason: `${r.rows} contracts read · ${r.added} new · ${r.gone} no longer in the report` };
    }
    const site = String(body.site || "").toUpperCase();
    if (!d.SITES[site]) return { accepted: false, reason: "Unknown flagship in the address" };
    if (!d.canSite(u, site) || !(d.isFull(u) || (u.role === "SUPERVISOR" && u.position !== "WH"))) return { accepted: false, reason: `${u.full_name} cannot add to ${d.SITES[site]} — ignored` };
    const today = d.today(), sent = isDay(String(body.date || "").slice(0, 10)) ? String(body.date).slice(0, 10) : today;
    const ics = (Array.isArray(body.ics) ? body.ics : []).map(parseIcs).find(Boolean) || null;
    const subject = clip(body.subject, 300).replace(/^\s*((re|fw|fwd|tr|إعادة توجيه)\s*:\s*)+/i, "");
    const text = cleanBody(body.text);
    const year = sent.slice(0, 4);
    if (kind === "mom") return await addMom(env, d, { site, u, subject, text, ics, sent, year, to: body.to, cc: body.cc });
    return await addCal(env, d, { site, u, subject, text, ics, sent, year });
  } catch (e) {
    if (msgId) await env.DB.prepare("DELETE FROM meta WHERE k = ?").bind(`inbox:${kind}:${msgId}`).run().catch(() => {});   // let a fixed email be sent again
    throw e;
  }
}

async function addMom(env, d, { site, u, subject, text, ics, sent, year, to, cc }) {
  const date = (ics && ics.start && ics.start.day) || findDate(subject, year) || findDate(text, year) || sent;
  const title = clip((ics && ics.title) || subject, 160) || `ABC ${d.SITES[site]} - Minutes of Meeting`;
  /* participants: invitation attendees, else the email's To / Cc (the hub's own address left out) */
  const people = (ics && ics.attendees.length ? ics.attendees : [...addrList(to), ...addrList(cc)]).filter(p => !/abcoperationshub|\+(mom|cal|works|contracts|portal)-/i.test(p.email));
  const seen = new Set(), parts = [];
  for (const p of people) {
    if (seen.has(p.email)) continue; seen.add(p.email);
    const hu = await userBy(env, p.email);
    parts.push({ email: p.email, name: (hu && hu.full_name) || p.name || p.email.split("@")[0], position: "", attended: false });
  }
  const type = /tenant/i.test(title) ? "Tenant Meeting" : /soft|cleaning|security|parking/i.test(title) ? "Soft Services Meeting" : /operation|ops/i.test(title) ? "Internal Operations Meeting" : "";
  const points = pointsOf((ics && ics.desc ? cleanBody(ics.desc) + "\n" : "") + text);
  const at = d.now();
  const r = await env.DB.prepare(`INSERT INTO mom_meetings (title, meet_date, week_no, location, next_date, last_date, participants, points, prepared_by, meeting_type, site, status, created_by, created_at, updated_at)
    VALUES (?,?,'',?, '', '', ?,?,?,?,?,'draft',?,?,?)`).bind(title, date, clip(ics && ics.location, 160), JSON.stringify(parts.slice(0, 80)), JSON.stringify(points), u.full_name, type, site, u.email, at, at).run();
  await d.raiseEvent(env, { site, app: "mom", tone: "info", title: `Minutes of Meeting from email · ${title}`, body: `${date}${ics && ics.start && ics.start.time ? " " + ics.start.time : ""} · ${parts.length} participants · ${points.length} points · draft by ${u.full_name}` });
  if (d.audit) await d.audit(env, { me: u, site, tool: "mom", ref: r.meta.last_row_id, label: title, action: "add", after: { title, date, from: "email" } });
  return { accepted: true, id: r.meta.last_row_id, reason: `Draft MOM “${title}” on ${date} added to ${d.SITES[site]}` };
}

async function addCal(env, d, { site, u, subject, text, ics, sent, year }) {
  let s = subject, kind = "marketing";
  const pre = /^\s*\[?(ops|operations|activity|expiry|expires|expiring|objective|event|marketing)\]?\s*[:\-–]\s*/i.exec(s);
  if (pre) { const k = pre[1].toLowerCase(); kind = /^(ops|operations|activity)$/.test(k) ? "ops" : /^expir/.test(k) ? "expiry" : k === "objective" ? "objective" : "marketing"; s = s.slice(pre[0].length); }
  else if (/\b(expir|insurance|licen[cs]e|certificate|renewal due)/i.test(s)) kind = "expiry";
  else if (/\b(fire drill|evacuation drill|ppm|maintenance|deep cleaning|pest control|shutdown|night works?)\b/i.test(s)) kind = "ops";
  const inSubj = findDates(s, year), inText = findDates(text, year);
  const D0 = inSubj.length ? inSubj : inText;
  /* the date in the subject is taken out of the title ("Civil defence certificate 20/11/2026" → "Civil defence certificate") */
  let t2 = s; for (const h of inSubj) t2 = t2.replace(h.text, " ");
  t2 = t2.replace(/\s+(on|from|to|until|till|-|–|·)\s*$/i, "").replace(/\s{2,}/g, " ").replace(/[\s\-–·,:]+$/, "").trim();
  const title = clip((ics && ics.title && !pre ? ics.title : t2 || s) || "From email", 160);
  const start = (ics && ics.start && ics.start.day) || (D0[0] && D0[0].day) || sent;
  const rangeEnd = !ics && D0[1] && D0[1].day > start && daysApart(start, D0[1].day) <= 90 ? D0[1].day : "";
  const end = (ics && ics.end && ics.end.day && ics.end.day >= start ? (ics.end.time === "" && ics.end.day > start ? addDay(ics.end.day, -1) : ics.end.day) : "") || rangeEnd || start;
  const notes = clip(`${text}`, 2000);
  const now = d.now();
  const row = { kind, title, start_day: kind === "objective" ? start.slice(0, 7) + "-01" : start, end_day: kind === "expiry" ? start : kind === "objective" ? monthEnd(start.slice(0, 7)) : end,
    time_from: ics && ics.start ? ics.start.time : "", time_to: ics && ics.end ? ics.end.time : "", location: clip(ics && ics.location, 160), notes, category: kind === "expiry" ? "Other" : "",
    month: kind === "objective" ? start.slice(0, 7) : "", extra: kind === "marketing" ? JSON.stringify({ status: "Planned", organiser: "", setup: "", dismantle: "" }) : kind === "expiry" ? JSON.stringify({ provider: "", ref: "", renewed: false }) : "{}" };
  const r = await env.DB.prepare(`INSERT INTO cal_items (site, kind, title, start_day, end_day, time_from, time_to, location, notes, category, repeat, month, owner, plan, extra, done,
    created_by, created_name, created_at, updated_at, updated_name) VALUES (?,?,?,?,?,?,?,?,?,?,'',?,'','[]',?,0,?,?,?,?,?)`)
    .bind(site, row.kind, row.title, row.start_day, row.end_day, row.time_from, row.time_to, row.location, row.notes, row.category, row.month, row.extra, u.email, u.full_name, now, now, u.full_name).run();
  const label = { marketing: "Marketing event", ops: "Ops activity", expiry: "Expiry date", objective: "Objective" }[kind];
  await d.raiseEvent(env, { site, app: "calendar", tone: "info", title: `${label} added from email · ${title}`, body: `${row.start_day}${row.end_day !== row.start_day && kind !== "objective" ? " → " + row.end_day : ""}${row.time_from ? " " + row.time_from : ""} · by ${u.full_name} — check the date in the calendar` });
  if (d.audit) await d.audit(env, { me: u, site, tool: "calendar", ref: r.meta.last_row_id, label: title, action: "add", after: { kind, start: row.start_day, from: "email" } });
  return { accepted: true, id: r.meta.last_row_id, reason: `${label} “${title}” on ${row.start_day} added to ${d.SITES[site]}` };
}
const daysApart = (a, b) => Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 864e5);
const addDay = (d, n) => { const t = new Date(d + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const monthEnd = m => { const t = new Date(m + "-01T12:00:00Z"); t.setUTCMonth(t.getUTCMonth() + 1); t.setUTCDate(0); return t.toISOString().slice(0, 10); };
