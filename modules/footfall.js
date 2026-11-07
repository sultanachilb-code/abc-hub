/* =====================================================================
   FOOTFALL (Nov 2026) — car footfall per flagship, inside the hub — docs/FEATURE-footfall.md
   Replaces the old Footfall Hub worker (switched off 2 Nov 2026).
   1. Daily import — Liban Park (parking operator) gets an email at 09:00 with a link per flagship (no hub account):
      they type yesterday's figures per gate. Reminders every hour 10:00 → 14:00 while not sent;
      at 15:00 a day still not sent is "Missing" and the operations team is told (hub notification).
      On the 1st of the month the same email also asks for last month's parking duration (dwell time).
   2. Monthly report — merges the daily imports; the month carries a badge with the dates it covers (from – to, n of N days).
   3. Analysis — added piece by piece (parking duration, weekday pattern, gates…).
   Settings (operations team): flagships ON/OFF, Liban Park To / CC per flagship, gate names, revenue ON/OFF (off = never stored).
   Views: operations team + Directors / Advisor / CDSO (their flagships). History: Excel import (Liban Park monthly workbook).
   ===================================================================== */

import { FF_HISTORY } from "../data/ff-history.js";   // Verdun monthly history from the Liban Park reports (no amounts)
export const FF_SITES = ["VRM", "ACM", "DBS"];
/* Nov 2026: the daily form also takes cars per hour, payments per machine (transactions, no amounts) and parking duration */
export const FF_HOURS = ["10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00", "20:00", "21:00", "22:00"];   // each = that hour → the next
const DEFAULT_MACH = { VRM: { apm: ["East", "Central", "Store"], hh: ["Unesco", "Mallat", "TL"] } };
export const DUR_BUCKETS = ["15 Minutes", "1 Hour", "2 Hours", "3 Hours", "4 Hours", "5 Hours", "6 Hours", "7 Hours", "8 Hours", "9 Hours", "10 Hours", "11 Hours", "12 Hours"];
const KINDS = { tce: ["t", "c", "e"], users: ["u"], passes: ["p"] };   // Tickets · Cards · Employees | Users | Passes
const DEFAULT_GATES = () => [
  { id: "g1", name: "Unesco", dir: "in", kind: "tce" }, { id: "g2", name: "Mallat", dir: "in", kind: "tce" }, { id: "g3", name: "TL", dir: "in", kind: "tce" }, { id: "g4", name: "Soffa", dir: "in", kind: "users" },
  { id: "g5", name: "Unesco", dir: "out", kind: "tce" }, { id: "g6", name: "Mallat", dir: "out", kind: "tce" }, { id: "g7", name: "TL", dir: "out", kind: "tce" },
  { id: "g8", name: "Manual Open", dir: "out", kind: "passes" }, { id: "g9", name: "Soffa", dir: "out", kind: "users" }];
const FROM = "salaachi@abc.com.lb";
const START_H = 9, LAST_H = 14;
const err = (m, s = 400) => Object.assign(new Error(m), { status: s });
const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
const TOKEN_CH = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
const newToken = () => [...crypto.getRandomValues(new Uint8Array(24))].map(x => TOKEN_CH[x % TOKEN_CH.length]).join("");
const int = v => { const n = Math.round(Number(String(v ?? "").replace(/[,\s]/g, ""))); return Number.isFinite(n) && n >= 0 ? Math.min(n, 9e14) : 0; };
const isDay = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) && !isNaN(Date.parse(s));
const isMonth = s => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(s || ""));
const addDays = (day, n) => new Date(Date.parse(day + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const prevMonth = m => { const [y, mo] = m.split("-").map(Number); return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`; };
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmtDay = day => new Date(day + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const fmtMonth = m => new Date(m + "-15T12:00:00Z").toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

export async function ffSchema(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS ff_days (site TEXT NOT NULL, day TEXT NOT NULL, data TEXT NOT NULL DEFAULT '{}',
      entries INTEGER NOT NULL DEFAULT 0, entries_noemp INTEGER NOT NULL DEFAULT 0, employees INTEGER NOT NULL DEFAULT 0, exits INTEGER NOT NULL DEFAULT 0,
      free INTEGER NOT NULL DEFAULT 0, membership INTEGER, balance INTEGER, detail INTEGER NOT NULL DEFAULT 1,
      source TEXT NOT NULL DEFAULT 'liban', by_name TEXT NOT NULL DEFAULT '', at TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', PRIMARY KEY (site, day))`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS ff_dur (site TEXT NOT NULL, month TEXT NOT NULL, data TEXT NOT NULL DEFAULT '[]', total INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'liban', by_name TEXT NOT NULL DEFAULT '', at TEXT NOT NULL, PRIMARY KEY (site, month))`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS ff_req (token TEXT PRIMARY KEY, site TEXT NOT NULL, kind TEXT NOT NULL, period TEXT NOT NULL,
      created_at TEXT NOT NULL, expires TEXT NOT NULL, sent_at TEXT NOT NULL DEFAULT '', reminders INTEGER NOT NULL DEFAULT 0, done_at TEXT NOT NULL DEFAULT '', UNIQUE (site, kind, period))`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS ff_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, site TEXT NOT NULL, period TEXT NOT NULL,
      what TEXT NOT NULL, by_name TEXT NOT NULL DEFAULT '')`),
    /* monthly figures from the Liban Park reports (history): kind ee {in,out} · adm {t,c,e,s} · soffa {in,out} · peak [13] · tx {apm:{name:n}, hh:{name:n}} */
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS ff_hist (site TEXT NOT NULL, month TEXT NOT NULL, kind TEXT NOT NULL, data TEXT NOT NULL, source TEXT NOT NULL DEFAULT '',
      at TEXT NOT NULL DEFAULT '', PRIMARY KEY (site, month, kind))`)
  ]);
}

/* ---------- settings ---------- */
async function metaJ(env, k) { const r = await env.DB.prepare("SELECT v FROM meta WHERE k = ?").bind(k).first().catch(() => null); try { return r ? JSON.parse(r.v) : null; } catch { return null; } }
const metaSet = (env, k, v) => env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)").bind(k, JSON.stringify(v)).run();
export async function ffCfg(env) {
  const c = (await metaJ(env, "ff:cfg")) || {};
  const sites = {};
  for (const s of FF_SITES) {
    const x = (c.sites || {})[s] || {};
    const dm = DEFAULT_MACH[s] || { apm: [], hh: [] };
    sites[s] = { on: x.on != null ? !!x.on : s !== "DBS", to: x.to || [], cc: x.cc || [], gates: Array.isArray(x.gates) && x.gates.length ? x.gates : DEFAULT_GATES(),
      apm: Array.isArray(x.apm) ? x.apm : dm.apm, hh: Array.isArray(x.hh) ? x.hh : dm.hh };
  }
  return { sites, revenue: !!c.revenue, updatedAt: c.updatedAt || "", updatedBy: c.updatedBy || "" };
}
const emails = v => { const l = [...new Set((Array.isArray(v) ? v : String(v || "").split(/[\s,;]+/)).map(e => String(e).trim().toLowerCase()).filter(Boolean))];
  const bad = l.find(e => !EMAIL_RE.test(e)); if (bad) throw err(`Not a valid email: ${bad}`); if (l.length > 8) throw err("Up to 8 emails"); return l; };
function cleanGates(list) {
  if (!Array.isArray(list) || !list.length) throw err("A flagship needs at least one gate");
  const seen = new Set(), out = [];
  for (const g of list.slice(0, 20)) {
    const name = String(g.name || "").replace(/\s+/g, " ").trim().slice(0, 30); if (!name) throw err("Every gate needs a name");
    const dir = g.dir === "out" ? "out" : "in", kind = KINDS[g.kind] ? g.kind : "tce";
    let id = /^g\d{1,3}$/.test(g.id || "") && !seen.has(g.id) ? g.id : ""; if (!id) { let n = 1; while (seen.has("g" + n) || list.some(x => x.id === "g" + n && x !== g)) n++; id = "g" + n; }
    seen.add(id); out.push({ id, name, dir, kind });
  }
  if (!out.some(g => g.dir === "in")) throw err("Add at least one entry gate");
  return out;
}

const cleanNames = (list, what) => { const out = [];
  for (const n of (Array.isArray(list) ? list : []).slice(0, 12)) { const v = String(n || "").replace(/\s+/g, " ").trim().slice(0, 30); if (v && !out.includes(v)) out.push(v); }
  return out; };
/* ---------- figures ---------- */
function computeDay(gates, raw, revenue, sc) {
  const data = { g: {} };
  /* Nov 2026 extras — kept only when something was typed */
  const arr = (v, n) => { const a = Array.from({ length: n }, (_, i) => int((Array.isArray(v) ? v : [])[i])); return a.some(Boolean) ? a : null; };
  const h = arr(raw.h, FF_HOURS.length); if (h) data.h = h;
  const du = arr(raw.dur, DUR_BUCKETS.length); if (du) data.dur = du;
  if (sc && raw.tx) { const pick = (names, v) => Object.fromEntries(names.map(n => [n, int((v || {})[n])])); const tx = { apm: pick(sc.apm || [], raw.tx.apm), hh: pick(sc.hh || [], raw.tx.hh) };
    if ([...Object.values(tx.apm), ...Object.values(tx.hh)].some(Boolean)) data.tx = tx; }
  let entries = 0, noemp = 0, employees = 0, exits = 0;
  for (const g of gates) {
    const v = (raw.g || {})[g.id] || {}, o = {};
    for (const k of KINDS[g.kind]) o[k] = int(v[k]);
    data.g[g.id] = o;
    const sum = Object.values(o).reduce((a, b) => a + b, 0);
    if (g.dir === "in") { entries += sum; noemp += sum - (o.e || 0); employees += o.e || 0; } else exits += sum;
  }
  return { data, entries, entries_noemp: noemp, employees, exits, free: int(raw.free),
    membership: revenue ? int(raw.membership) : null, balance: revenue ? int(raw.balance) : null };
}
const dayOut = (r, gates, revenue) => ({ day: r.day, site: r.site, entries: r.entries, noemp: r.entries_noemp, employees: r.employees, exits: r.exits, free: r.free,
  ...(revenue ? { membership: r.membership, balance: r.balance } : {}), detail: !!r.detail, g: r.detail ? (JSON.parse(r.data || "{}").g || {}) : {},
  ...(r.detail ? (({ h, tx, dur }) => ({ h: h || null, tx: tx || null, dur: dur || null }))(JSON.parse(r.data || "{}")) : {}),
  source: r.source, by: r.by_name, at: r.at, note: r.note });
async function saveDay(env, site, day, raw, cfg, who, source, note = "") {
  const c = computeDay(cfg.sites[site].gates, raw, cfg.revenue, cfg.sites[site]);
  if (!c.entries) throw err("The entries are all zero — please check the figures");
  const prev = await env.DB.prepare("SELECT entries FROM ff_days WHERE site = ? AND day = ?").bind(site, day).first();
  await env.DB.prepare(`INSERT OR REPLACE INTO ff_days (site, day, data, entries, entries_noemp, employees, exits, free, membership, balance, detail, source, by_name, at, note)
    VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?,?,?)`).bind(site, day, JSON.stringify(c.data), c.entries, c.entries_noemp, c.employees, c.exits, c.free, c.membership, c.balance,
    source, who, new Date().toISOString(), String(note).slice(0, 300)).run();
  await env.DB.prepare("UPDATE ff_req SET done_at = ? WHERE site = ? AND kind = 'day' AND period = ? AND done_at = ''").bind(new Date().toISOString(), site, day).run();
  await env.DB.prepare("INSERT INTO ff_log (at, site, period, what, by_name) VALUES (?,?,?,?,?)")
    .bind(new Date().toISOString(), site, day, prev ? `Corrected (${prev.entries} → ${c.entries} entries)${note ? " · " + String(note).slice(0, 200) : ""}` : `Received · ${c.entries} entries`, who).run();
  return c;
}
async function saveDur(env, site, month, list, who, source) {
  const data = DUR_BUCKETS.map((_, i) => int((list || [])[i])), total = data.reduce((a, b) => a + b, 0);
  if (!total) throw err("The parking duration is all zero — please check the figures");
  await env.DB.prepare("INSERT OR REPLACE INTO ff_dur (site, month, data, total, source, by_name, at) VALUES (?,?,?,?,?,?,?)")
    .bind(site, month, JSON.stringify(data), total, source, who, new Date().toISOString()).run();
  await env.DB.prepare("UPDATE ff_req SET done_at = ? WHERE site = ? AND kind = 'dur' AND period = ? AND done_at = ''").bind(new Date().toISOString(), site, month).run();
  await env.DB.prepare("INSERT INTO ff_log (at, site, period, what, by_name) VALUES (?,?,?,?,?)").bind(new Date().toISOString(), site, month, `Parking duration · ${total} cars`, who).run();
  return total;
}

/* ---------- Liban Park links ---------- */
async function request(env, site, kind, period, today) {
  const ex = await env.DB.prepare("SELECT * FROM ff_req WHERE site = ? AND kind = ? AND period = ?").bind(site, kind, period).first();
  if (ex) return ex;
  const r = { token: newToken(), site, kind, period, created_at: new Date().toISOString(), expires: addDays(today, 10) };
  await env.DB.prepare("INSERT OR IGNORE INTO ff_req (token, site, kind, period, created_at, expires) VALUES (?,?,?,?,?,?)").bind(r.token, site, kind, period, r.created_at, r.expires).run();
  return await env.DB.prepare("SELECT * FROM ff_req WHERE site = ? AND kind = ? AND period = ?").bind(site, kind, period).first();
}
async function isDone(env, site, kind, period) {
  return kind === "day" ? !!(await env.DB.prepare("SELECT 1 FROM ff_days WHERE site = ? AND day = ?").bind(site, period).first())
    : !!(await env.DB.prepare("SELECT 1 FROM ff_dur WHERE site = ? AND month = ?").bind(site, period).first());
}
const btn = (href, label) => `<a href="${esc(href)}" style="display:inline-block;background:#4A1F73;color:#fff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:10px;margin:6px 0">${esc(label)}</a>`;
const shell = (title, sub, body) => `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:640px;margin:0 auto;border:1px solid #E6E0EE;border-radius:12px;overflow:hidden;color:#221A2E">
  <div style="background:#2A0F45;padding:18px 22px"><div style="color:#fff;font-size:16px;font-weight:bold;letter-spacing:1px">${esc(title)}</div><div style="color:#E9CF8A;font-size:12px;letter-spacing:1px;margin-top:4px">${esc(sub)}</div></div>
  <div style="padding:20px 22px;font-size:14px;line-height:1.55">${body}</div></div>`;
/* one email per flagship with every link still waiting (yesterday's day + on the 1st, last month's parking duration) */
async function mailLinks(env, d, site, reqs, n, o = {}) {
  const cfg = o.cfg || await ffCfg(env), sc = cfg.sites[site];
  const to = o.testTo ? [o.testTo] : sc.to, cc = o.testTo ? [] : sc.cc.filter(e => !to.includes(e));
  if (!to.length) return { sent: false, why: "No Liban Park email set for this flagship (Footfall → Settings)" };
  const name = d.SITES[site];
  const items = reqs.map(r => r.kind === "day"
    ? `<p style="margin:14px 0 2px"><b>Daily car count — ${esc(fmtDay(r.period))}</b></p>${btn(`${d.hubUrl}/ff/${r.token}`, "Enter the figures")}`
    : `<p style="margin:14px 0 2px"><b>Parking duration — ${esc(fmtMonth(r.period))}</b></p>${btn(`${d.hubUrl}/ff/${r.token}`, "Enter the parking duration")}`).join("");
  const html = shell("ABC " + String(name).replace(/^ABC\s+/i, "").toUpperCase(), n ? `FOOTFALL · REMINDER ${n}` : "FOOTFALL · DAILY FIGURES",
    `<p>Dear Liban Park team,</p><p>${n ? "This is a reminder — the figures below have not been received yet." : "Kindly enter the parking figures below for"} <b>${esc(name)}</b>.</p>${items}
     <p style="color:#6D6479;font-size:12px;margin-top:18px">Please send them by <b>2:00 PM</b>. The links open a short form — no account needed. Each link works for this flagship only.</p>
     <p>Thank you,<br><b>Mall Operations — ABC</b></p>`);
  const what = reqs.map(r => r.kind === "day" ? fmtDay(r.period) : "Parking duration " + fmtMonth(r.period)).join(" + ");
  const subject = `${o.testTo ? "[TEST] " : ""}${n ? `Reminder ${n} — ` : ""}ABC ${String(name).replace(/^ABC\s+/i, "")} — Parking figures — ${what}`;
  const s = await d.outlookSend(env, { from: FROM, to, cc, subject, html }).catch(e => ({ ok: false, error: e.message }));
  if (!(s && s.ok)) return { sent: false, why: (s && s.error) || "Outlook is not connected in the hub" };
  if (!o.testTo) for (const r of reqs) await env.DB.prepare("UPDATE ff_req SET sent_at = CASE WHEN sent_at = '' THEN ? ELSE sent_at END, reminders = ? WHERE token = ?").bind(new Date().toISOString(), n, r.token).run();
  return { sent: true, to, cc };
}
async function pending(env, site, today) {
  const yday = addDays(today, -1), list = [];
  if (!(await isDone(env, site, "day", yday))) list.push(await request(env, site, "day", yday, today));
  /* Nov 2026: parking duration comes with the daily figures — no monthly request on the 1st any more */
  return list;
}
/* cron (every 2 minutes) */
export async function ffRun(env, d) {
  const h = d.hour(); if (h < START_H || h > LAST_H + 1) return;
  const today = d.today(), cfg = await ffCfg(env);
  const claim = async k => { const r = await env.DB.prepare("INSERT OR IGNORE INTO meta (k, v) VALUES (?, '1')").bind(k).run().catch(() => null); return !!(r && r.meta && r.meta.changes === 1); };
  for (const site of FF_SITES) {
    const sc = cfg.sites[site]; if (!sc.on || !sc.to.length) continue;
    if (h <= LAST_H) {
      if (!(await claim(`ff:mail:${today}:${site}:${h}`))) continue;
      const list = await pending(env, site, today); if (!list.length) continue;
      await mailLinks(env, d, site, list, h - START_H, { cfg }).catch(e => console.error("ff mail", e && e.message));
    } else if (await claim(`ff:missing:${today}:${site}`)) {
      const yday = addDays(today, -1);
      if (!(await isDone(env, site, "day", yday))) await d.raiseEvent(env, { site, app: "ff-ops", tone: "warn", title: `Footfall · ${d.SITES[site]} — ${fmtDay(yday)} missing`,
        body: "Liban Park did not send the figures by 2:00 PM. Footfall → Daily import: send the link again or enter them." });
    }
  }
  if (h === LAST_H + 1 && await claim(`ff:clean:${today}`)) await env.DB.prepare("DELETE FROM meta WHERE k LIKE 'ff:mail:%' AND k < ?").bind(`ff:mail:${addDays(today, -7)}`).run().catch(() => {});
}

/* ---------- the Liban Park page (/ff/<token>, no account) ---------- */
export async function ffPublic(env, token, method, b, d) {
  if (!/^[A-Za-z0-9]{24}$/.test(token || "")) throw err("This link is not valid", 404);
  const r = await env.DB.prepare("SELECT * FROM ff_req WHERE token = ?").bind(token).first();
  if (!r) throw err("This link is not valid", 404);
  if (r.expires < d.today()) throw err("This link has expired — please ask ABC Operations for a new one", 410);
  const cfg = await ffCfg(env), sc = cfg.sites[r.site];
  if (!sc.on) throw err("This flagship is not taking figures at the moment", 410);
  if (method === "POST") {
    if (r.kind === "day") { const c = await saveDay(env, r.site, r.period, b || {}, cfg, "Liban Park", "liban"); return { saved: true, entries: c.entries, exits: c.exits }; }
    return { saved: true, total: await saveDur(env, r.site, r.period, (b || {}).dur, "Liban Park", "liban") };
  }
  let cur = null;
  if (r.kind === "day") { const x = await env.DB.prepare("SELECT * FROM ff_days WHERE site = ? AND day = ?").bind(r.site, r.period).first(); if (x && x.detail) cur = dayOut(x, sc.gates, cfg.revenue); }
  else { const x = await env.DB.prepare("SELECT data FROM ff_dur WHERE site = ? AND month = ?").bind(r.site, r.period).first(); if (x) cur = { dur: JSON.parse(x.data) }; }
  return { kind: r.kind, period: r.period, site: r.site, siteName: d.SITES[r.site], gates: sc.gates, revenue: cfg.revenue, buckets: DUR_BUCKETS, hours: FF_HOURS, apm: sc.apm, hh: sc.hh, current: cur };
}

/* ---------- hub routes (ops/ff/...) ---------- */
export async function ffRoute(env, p, method, b, url, d) {
  const me = d.me, q = url.searchParams, cfg = await ffCfg(env);
  const isOps = u => u.role === "ADMIN" || u.role === "MANAGER" || (u.role === "SUPERVISOR" && u.position !== "WH");
  const mine = d.sitesOf(me).filter(s => FF_SITES.includes(s));
  const canEdit = s => isOps(me) && mine.includes(s);
  const view = mine.filter(s => cfg.sites[s].on || canEdit(s));
  const need = s => { s = String(s || "").toUpperCase(); if (!view.includes(s)) throw err("Not allowed", 403); return s; };
  const needEdit = s => { s = need(s); if (!canEdit(s)) throw err("Only the operations team can do this", 403); return s; };
  const who = me.full_name || me.email;

  if (p === "ff/context") return { sites: Object.fromEntries(view.map(s => [s, d.SITES[s]])), on: Object.fromEntries(view.map(s => [s, cfg.sites[s].on])),
    canEdit: Object.fromEntries(view.map(s => [s, canEdit(s)])), gates: Object.fromEntries(view.map(s => [s, cfg.sites[s].gates])), revenue: cfg.revenue,
    mach: Object.fromEntries(view.map(s => [s, { apm: cfg.sites[s].apm, hh: cfg.sites[s].hh }])), hours: FF_HOURS,
    buckets: DUR_BUCKETS, today: d.today(), hour: d.hour(), schedule: { start: START_H, last: LAST_H }, settings: view.some(canEdit) };

  if (p === "ff/status") {   // Daily import: the last 14 days per flagship
    const today = d.today(), from = addDays(today, -14), out = {};
    for (const s of view) {
      const { results: days } = await env.DB.prepare("SELECT day, entries, exits, source, by_name, at FROM ff_days WHERE site = ? AND day >= ? ORDER BY day DESC").bind(s, from).all();
      const { results: reqs } = await env.DB.prepare("SELECT kind, period, sent_at, reminders, done_at FROM ff_req WHERE site = ? AND created_at >= ?").bind(s, from + "T00:00").all();
      const dm = Object.fromEntries((days || []).map(x => [x.day, x])), rm = Object.fromEntries((reqs || []).filter(x => x.kind === "day").map(x => [x.period, x]));
      const list = [];
      for (let i = 1; i <= 14; i++) {
        const day = addDays(today, -i), x = dm[day], r = rm[day];
        const st = x ? "in" : (i === 1 && d.hour() <= LAST_H) ? "wait" : "miss";
        list.push({ day, status: st, entries: x ? x.entries : null, exits: x ? x.exits : null, source: x ? x.source : "", by: x ? x.by_name : "", at: x ? x.at : "",
          sentAt: r ? r.sent_at : "", reminders: r ? r.reminders : 0 });
      }
      const dur = await env.DB.prepare("SELECT month FROM ff_dur WHERE site = ? AND month = ?").bind(s, prevMonth(today.slice(0, 7))).first();
      out[s] = { on: cfg.sites[s].on, contacts: cfg.sites[s].to.length > 0, list, durLast: { month: prevMonth(today.slice(0, 7)), done: !!dur } };
    }
    return { today, hour: d.hour(), sites: out };
  }

  if (p === "ff/days" && method === "GET") {   // rows for the report / analysis
    const s = need(q.get("site")), from = q.get("from"), to = q.get("to");
    if (!isDay(from) || !isDay(to) || to < from || Date.parse(to) - Date.parse(from) > 800 * 864e5) throw err("Choose the dates");
    const { results } = await env.DB.prepare("SELECT * FROM ff_days WHERE site = ? AND day BETWEEN ? AND ? ORDER BY day").bind(s, from, to).all();
    return { site: s, gates: cfg.sites[s].gates, revenue: cfg.revenue, days: (results || []).map(r => dayOut(r, cfg.sites[s].gates, cfg.revenue)) };
  }
  if (p === "ff/dur" && method === "GET") {
    const s = need(q.get("site")), from = q.get("from"), to = q.get("to");
    if (!isMonth(from) || !isMonth(to)) throw err("Choose the months");
    const { results } = await env.DB.prepare("SELECT month, data, total, source, by_name, at FROM ff_dur WHERE site = ? AND month BETWEEN ? AND ? ORDER BY month").bind(s, from, to).all();
    return { site: s, buckets: DUR_BUCKETS, months: (results || []).map(r => ({ month: r.month, data: JSON.parse(r.data), total: r.total, source: r.source, by: r.by_name, at: r.at })) };
  }
  if (p === "ff/monthly" && method === "GET") {   // the 7 monthly reports: Liban Park history where it exists, otherwise the sum of the daily figures
    const s = need(q.get("site")), from = q.get("from"), to = q.get("to");
    if (!isMonth(from) || !isMonth(to) || to < from) throw err("Choose the months");
    await histSeed(env, s);
    return { site: s, hours: FF_HOURS, buckets: DUR_BUCKETS, apm: cfg.sites[s].apm, hh: cfg.sites[s].hh, months: await monthly(env, s, from, to, cfg.sites[s].gates) };
  }
  if (p === "ff/day" && method === "GET") {
    const s = need(q.get("site")), day = q.get("day"); if (!isDay(day)) throw err("Choose the day");
    const x = await env.DB.prepare("SELECT * FROM ff_days WHERE site = ? AND day = ?").bind(s, day).first();
    const { results: log } = await env.DB.prepare("SELECT at, what, by_name FROM ff_log WHERE site = ? AND period = ? ORDER BY id DESC LIMIT 20").bind(s, day).all();
    const r = await env.DB.prepare("SELECT token, sent_at, reminders FROM ff_req WHERE site = ? AND kind = 'day' AND period = ?").bind(s, day).first();
    return { day: x ? dayOut(x, cfg.sites[s].gates, cfg.revenue) : null, gates: cfg.sites[s].gates, revenue: cfg.revenue, log: log || [],
      link: r && canEdit(s) ? `${d.hubUrl}/ff/${r.token}` : "", sentAt: r ? r.sent_at : "", reminders: r ? r.reminders : 0 };
  }
  if (p === "ff/day" && method === "POST") {   // the operations team enters or corrects a day
    const s = needEdit(b.site), day = b.day; if (!isDay(day) || day > d.today()) throw err("Choose the day");
    const ex = await env.DB.prepare("SELECT 1 FROM ff_days WHERE site = ? AND day = ?").bind(s, day).first();
    if (ex && !String(b.note || "").trim()) throw err("Write the reason for the correction");
    const c = await saveDay(env, s, day, b, cfg, who, "hub", b.note || "");
    await d.audit(env, { me, site: s, tool: "footfall", ref: day, label: `Footfall ${day}: ${c.entries} entries${ex ? " (corrected)" : ""}`, action: ex ? "edit" : "add", changes: [] }).catch(() => {});
    return { saved: true };
  }
  if (p === "ff/dur" && method === "POST") {
    const s = needEdit(b.site); if (!isMonth(b.month)) throw err("Choose the month");
    return { saved: true, total: await saveDur(env, s, b.month, b.dur, who, "hub") };
  }
  if (p === "ff/send" && method === "POST") {   // send the Liban Park link now (a missing day / a month's parking duration)
    const s = needEdit(b.site), kind = b.kind === "dur" ? "dur" : "day", period = String(b.period || "");
    if (kind === "day" ? !isDay(period) || period >= d.today() : !isMonth(period) || period >= d.today().slice(0, 7)) throw err("Choose a past day / month");
    if (await isDone(env, s, kind, period) && !b.again) throw err("Already received — open the day to correct it");
    const r = await request(env, s, kind, period, d.today());
    if (r.expires < d.today()) await env.DB.prepare("UPDATE ff_req SET expires = ? WHERE token = ?").bind(addDays(d.today(), 10), r.token).run();
    const m = await mailLinks(env, d, s, [r], 0, { cfg, testTo: b.testTo ? me.email : "" });
    if (!m.sent) throw err(m.why);
    return { sent: true, to: m.to, cc: m.cc, link: `${d.hubUrl}/ff/${r.token}` };
  }
  if (p === "ff/settings" && method === "GET") {
    if (!view.some(canEdit)) throw err("Only the operations team can open the settings", 403);
    const sites = Object.fromEntries(FF_SITES.filter(canEdit).map(s => [s, { name: d.SITES[s], ...cfg.sites[s] }]));
    return { sites, revenue: cfg.revenue, updatedAt: cfg.updatedAt, updatedBy: cfg.updatedBy, schedule: { start: START_H, last: LAST_H } };
  }
  if (p === "ff/settings" && method === "POST") {
    const cur = (await metaJ(env, "ff:cfg")) || {}, sites = { ...(cur.sites || {}) };
    for (const [s, x] of Object.entries(b.sites || {})) {
      if (!FF_SITES.includes(s)) continue;
      if (!canEdit(s)) throw err(`Not allowed for ${d.SITES[s]}`, 403);
      sites[s] = { on: !!x.on, to: emails(x.to), cc: emails(x.cc), gates: cleanGates(x.gates), apm: cleanNames(x.apm), hh: cleanNames(x.hh) };
      if (sites[s].on && !sites[s].to.length) throw err(`${d.SITES[s]}: add the Liban Park email (To) or switch the flagship off`);
    }
    const revenue = "revenue" in b ? !!b.revenue : !!cur.revenue;
    if (revenue !== !!cur.revenue && !(me.role === "ADMIN" || me.role === "MANAGER")) throw err("Only managers and administrators switch revenue on or off", 403);
    await metaSet(env, "ff:cfg", { sites, revenue, updatedAt: new Date().toISOString(), updatedBy: who });
    if (!revenue && cur.revenue) await env.DB.prepare("UPDATE ff_days SET membership = NULL, balance = NULL").run();   // revenue off: nothing kept
    await d.audit(env, { me, site: "", tool: "footfall", ref: "settings", label: `Footfall settings saved (revenue ${revenue ? "on" : "off"})`, action: "edit", changes: [] }).catch(() => {});
    return { saved: true };
  }
  if (p === "ff/import" && method === "POST") {   // history from the Liban Park monthly workbook (read in the browser)
    const s = needEdit(b.site), gates = cfg.sites[s].gates, rows = Array.isArray(b.rows) ? b.rows.slice(0, 1000) : [];
    if (b.kind === "dur") {
      let n = 0; for (const r of (Array.isArray(b.months) ? b.months : []).slice(0, 120)) { if (!isMonth(r.month)) continue;
        if (!b.overwrite && await isDone(env, s, "dur", r.month)) continue; await saveDur(env, s, r.month, r.data, who, "import").then(() => n++).catch(() => {}); }
      return { imported: n };
    }
    const { results: have } = await env.DB.prepare("SELECT day FROM ff_days WHERE site = ?").bind(s).all();
    const got = new Set((have || []).map(x => x.day)), ops = [];
    let skipped = 0;
    for (const r of rows) {
      if (!isDay(r.day) || r.day >= d.today()) { skipped++; continue; }
      if (got.has(r.day) && !b.overwrite) { skipped++; continue; }
      if (r.total != null) {   // only the day's total (e.g. "ABC Achrafieh — Total Entries")
        const t = int(r.total); if (!t) { skipped++; continue; }
        ops.push(env.DB.prepare(`INSERT OR REPLACE INTO ff_days (site, day, data, entries, entries_noemp, employees, exits, free, membership, balance, detail, source, by_name, at, note)
          VALUES (?,?,'{}',?,?,0,0,0,NULL,NULL,0,'import',?,?,'')`).bind(s, r.day, t, t, who, new Date().toISOString()));
      } else {
        const c = computeDay(gates, r, cfg.revenue); if (!c.entries) { skipped++; continue; }
        ops.push(env.DB.prepare(`INSERT OR REPLACE INTO ff_days (site, day, data, entries, entries_noemp, employees, exits, free, membership, balance, detail, source, by_name, at, note)
          VALUES (?,?,?,?,?,?,?,?,?,?,1,'import',?,?,'')`).bind(s, r.day, JSON.stringify(c.data), c.entries, c.entries_noemp, c.employees, c.exits, c.free, c.membership, c.balance, who, new Date().toISOString()));
      }
    }
    for (let i = 0; i < ops.length; i += 50) await env.DB.batch(ops.slice(i, i + 50));
    if (ops.length) await env.DB.prepare("INSERT INTO ff_log (at, site, period, what, by_name) VALUES (?,?,?,?,?)").bind(new Date().toISOString(), s, "import", `History imported · ${ops.length} days`, who).run();
    return { imported: ops.length, skipped };
  }
  throw err("Not found", 404);
}

/* ---------- monthly reports (Nov 2026) ---------- */
async function histSeed(env, site) {
  const H = FF_HISTORY[site]; if (!H) return;
  const c = await env.DB.prepare("INSERT OR IGNORE INTO meta (k, v) VALUES (?, ?)").bind("ff:hist:" + site, new Date().toISOString()).run().catch(() => null);
  if (!c || !c.meta || c.meta.changes !== 1) return;
  const at = new Date().toISOString(), ops = [];
  for (const [m, kinds] of Object.entries(H.months)) for (const [k, v] of Object.entries(kinds))
    ops.push(env.DB.prepare("INSERT OR IGNORE INTO ff_hist (site, month, kind, data, source, at) VALUES (?,?,?,?,'liban-report',?)").bind(site, m, k, JSON.stringify(v), at));
  for (const [m, a] of Object.entries(H.dur || {}))
    ops.push(env.DB.prepare("INSERT OR IGNORE INTO ff_dur (site, month, data, total, source, by_name, at) VALUES (?,?,?,?,'import','Liban Park reports',?)").bind(site, m, JSON.stringify(a), a.reduce((x, y) => x + y, 0), at));
  for (let i = 0; i < ops.length; i += 80) await env.DB.batch(ops.slice(i, i + 80));
  await env.DB.prepare("INSERT INTO ff_log (at, site, period, what, by_name) VALUES (?,?,?,?,?)").bind(at, site, "import", `History loaded from the Liban Park reports · ${Object.keys(H.months).length} months`, "Hub").run().catch(() => {});
}
const monthDays = m => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate();
const addArr = (a, b) => a.map((x, i) => x + (b[i] || 0));
async function monthly(env, site, from, to, gates) {
  const [days, hist, dur] = await Promise.all([
    env.DB.prepare("SELECT day, data, entries, exits, detail FROM ff_days WHERE site = ? AND day BETWEEN ? AND ?").bind(site, from + "-01", to + "-31").all(),
    env.DB.prepare("SELECT month, kind, data FROM ff_hist WHERE site = ? AND month BETWEEN ? AND ?").bind(site, from, to).all(),
    env.DB.prepare("SELECT month, data FROM ff_dur WHERE site = ? AND month BETWEEN ? AND ?").bind(site, from, to).all()]);
  const G = Object.fromEntries(gates.map(g => [g.id, g])), M = {};
  const mo = m => M[m] = M[m] || { month: m, mdays: monthDays(m), days: 0, ee: { in: 0, out: 0 }, adm: { t: 0, c: 0, e: 0, s: 0 }, soffa: { in: 0, out: 0 },
    peak: FF_HOURS.map(() => 0), tx: { apm: {}, hh: {} }, dur: DUR_BUCKETS.map(() => 0), has: {}, src: {} };
  for (const r of days.results || []) {
    const x = mo(r.day.slice(0, 7)); x.days++; x.ee.in += r.entries; x.ee.out += r.exits; x.has.ee = 1;
    if (!r.detail) continue;
    const dt = JSON.parse(r.data || "{}");
    for (const [gid, v] of Object.entries(dt.g || {})) { const g = G[gid]; if (!g) continue;
      if (g.kind === "users") { x.soffa[g.dir] += v.u || 0; x.has.soffa = 1; if (g.dir === "in") x.adm.s += v.u || 0; }
      else if (g.kind === "tce" && g.dir === "in") { x.adm.t += v.t || 0; x.adm.c += v.c || 0; x.adm.e += v.e || 0; x.has.adm = 1; } }
    if (dt.h) { x.peak = addArr(x.peak, dt.h); x.has.peak = 1; }
    if (dt.dur) { x.dur = addArr(x.dur, dt.dur); x.has.dur = 1; }
    if (dt.tx) { for (const k of ["apm", "hh"]) for (const [n, v] of Object.entries(dt.tx[k] || {})) x.tx[k][n] = (x.tx[k][n] || 0) + v; x.has.tx = 1; }
  }
  for (const k of ["ee", "adm", "soffa", "peak", "dur", "tx"]) for (const x of Object.values(M)) if (x.has[k]) x.src[k] = "daily";
  for (const r of hist.results || []) { const x = mo(r.month); x[r.kind] = JSON.parse(r.data); x.src[r.kind] = "report"; }   // Liban Park's own monthly report wins for that month
  for (const r of dur.results || []) { const x = mo(r.month); x.dur = JSON.parse(r.data); x.src.dur = "report"; }
  return Object.values(M).map(({ has, ...x }) => x).sort((a, b) => a.month.localeCompare(b.month));
}
