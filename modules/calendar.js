/* =====================================================================
   OPERATIONS CALENDAR — feature module (kept separate so it can be removed cleanly)
   See docs/FEATURE-calendar.md

   One monthly calendar per flagship:
     • Marketing events — with a plan (tasks, owner, due) — also fill the handover's "Marketing events"
     • Ops activities   — drills, PPM, deep cleaning, night works… (can repeat weekly / monthly / yearly)
     • MOM meetings     — read from Minutes of Meeting (nothing to type twice)
     • Objectives       — pinned at the top of a month
     • Expiry dates     — insurance papers, licences, certificates, contracts → reminders 30, 7 and 1 day before
   Tables : cal_items
   Routes : /api/ops/cal/*      Page : /tools/calendar
   ===================================================================== */

import { contractsInRange } from "./contracts.js";
const err = (m, status = 400) => Object.assign(new Error(m), { status });
const clip = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
const isDay = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));
const isHM = v => /^\d{2}:\d{2}$/.test(String(v || ""));
export const CAL_KINDS = {
  marketing: { label: "Marketing event", color: "#C2185B" },
  ops:       { label: "Ops activity",    color: "#2F6F7E" },
  mom:       { label: "MOM meeting",     color: "#8A5A1F" },
  objective: { label: "Objective",       color: "#4A1F73" },
  expiry:    { label: "Expiry date",     color: "#C0392B" },
  contract:  { label: "Contract end",    color: "#8A3B5A" }   // read from Contracts Near Ending (the email report)
};
export const DOC_TYPES = ["Insurance policy", "Contractor insurance", "Civil defence certificate", "Trade licence", "Elevator / escalator certificate",
  "Fire system certificate", "Maintenance contract", "Service contract", "Lease / agreement", "Permit", "Other"];
const ACT_TYPES = ["Fire drill", "Evacuation drill", "PPM / preventive maintenance", "Deep cleaning", "Pest control", "Night works", "Inspection", "Training", "Shutdown / outage", "Other"];
const REMIND_DAYS = [30, 7, 1, 0];

export async function calendarSchema(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS cal_items (id INTEGER PRIMARY KEY AUTOINCREMENT, site TEXT NOT NULL, kind TEXT NOT NULL,
      title TEXT NOT NULL, start_day TEXT NOT NULL DEFAULT '', end_day TEXT NOT NULL DEFAULT '', time_from TEXT NOT NULL DEFAULT '', time_to TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT '', repeat TEXT NOT NULL DEFAULT '',
      month TEXT NOT NULL DEFAULT '', owner TEXT NOT NULL DEFAULT '', plan TEXT NOT NULL DEFAULT '[]', extra TEXT NOT NULL DEFAULT '{}',
      done INTEGER NOT NULL DEFAULT 0, created_by TEXT, created_name TEXT, created_at TEXT, updated_at TEXT, updated_name TEXT, deleted INTEGER NOT NULL DEFAULT 0)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS cal_items_site ON cal_items (site, deleted, start_day)`)
  ]);
}

/* ---------- helpers ---------- */
const addDays = (d, n) => { const t = new Date(d + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((new Date(b + "T12:00:00Z") - new Date(a + "T12:00:00Z")) / 864e5);
const monthEnd = m => { const t = new Date(m + "-01T12:00:00Z"); t.setUTCMonth(t.getUTCMonth() + 1); t.setUTCDate(0); return t.toISOString().slice(0, 10); };
function itemOut(r) {
  let plan = [], extra = {};
  try { plan = JSON.parse(r.plan || "[]"); } catch {}
  try { extra = JSON.parse(r.extra || "{}"); } catch {}
  return { id: r.id, kind: r.kind, title: r.title, start: r.start_day, end: r.end_day || r.start_day, from: r.time_from, to: r.time_to,
    location: r.location, notes: r.notes, category: r.category, repeat: r.repeat, month: r.month, owner: r.owner, plan, extra, done: !!r.done,
    createdName: r.created_name || "", updatedAt: r.updated_at || "", updatedName: r.updated_name || "" };
}
/* every date an item shows on between from..to (repeats expanded) */
function occurrences(it, from, to) {
  const len = Math.max(0, daysBetween(it.start, it.end || it.start));
  const out = [];
  const push = s => { const e = addDays(s, len); if (e >= from && s <= to) out.push({ start: s, end: e }); };
  if (!it.repeat) { push(it.start); return out; }
  let s = it.start, guard = 0;
  while (s <= to && guard++ < 800) {
    push(s);
    if (it.repeat === "weekly") s = addDays(s, 7);
    else if (it.repeat === "monthly") { const t = new Date(it.start + "T12:00:00Z"); t.setUTCMonth(t.getUTCMonth() + guard); if (t.getUTCDate() !== Number(it.start.slice(8))) t.setUTCDate(0); s = t.toISOString().slice(0, 10); }
    else if (it.repeat === "yearly") s = `${Number(it.start.slice(0, 4)) + guard}${it.start.slice(4)}`;
    else break;
  }
  return out;
}

function clean(b) {
  const kind = CAL_KINDS[b.kind] && b.kind !== "mom" && b.kind !== "contract" ? b.kind : "";
  if (!kind) throw err("Choose what you are adding");
  const title = clip(b.title, 160);
  if (!title) throw err("Give it a title");
  const r = { kind, title, start_day: "", end_day: "", time_from: isHM(b.from) ? b.from : "", time_to: isHM(b.to) ? b.to : "",
    location: clip(b.location, 160), notes: clip(b.notes, 2000), category: clip(b.category, 80), repeat: "", month: "", owner: clip(b.owner, 120),
    plan: "[]", extra: "{}", done: b.done ? 1 : 0 };
  if (kind === "objective") {
    if (!/^\d{4}-\d{2}$/.test(String(b.month || ""))) throw err("Choose the month of the objective");
    r.month = b.month; r.start_day = b.month + "-01"; r.end_day = monthEnd(b.month);
  } else {
    if (!isDay(b.start)) throw err(kind === "expiry" ? "Choose the expiry date" : "Choose the date");
    r.start_day = b.start;
    r.end_day = kind === "expiry" ? b.start : isDay(b.end) && b.end >= b.start ? b.end : b.start;
    if (kind === "ops" || kind === "expiry") r.repeat = ["weekly", "monthly", "yearly"].includes(b.repeat) ? b.repeat : "";
    if (r.repeat === "weekly" && daysBetween(r.start_day, r.end_day) > 6) throw err("A weekly activity cannot last more than a week");
  }
  if (kind === "marketing") {
    const plan = (Array.isArray(b.plan) ? b.plan : []).slice(0, 40).map(t => ({ text: clip(t.text, 200), owner: clip(t.owner, 80),
      due: isDay(t.due) ? t.due : "", done: !!t.done })).filter(t => t.text);
    r.plan = JSON.stringify(plan);
    const x = b.extra || {};
    r.extra = JSON.stringify({ setup: clip(x.setup, 120), dismantle: clip(x.dismantle, 120), organiser: clip(x.organiser, 120), status: ["Planned", "Confirmed", "Cancelled"].includes(x.status) ? x.status : "Planned" });
  }
  if (kind === "expiry") {
    const x = b.extra || {};
    r.extra = JSON.stringify({ ref: clip(x.ref, 120), provider: clip(x.provider, 160), renewed: !!x.renewed });
  }
  return r;
}

/* ---------- reminders for expiry dates (cron, once a day per item and step) ---------- */
export async function calendarRun(env, deps) {
  const today = deps.today();
  const { results } = await env.DB.prepare("SELECT * FROM cal_items WHERE kind = 'expiry' AND deleted = 0 AND done = 0").all().catch(() => ({ results: [] }));
  for (const r of results || []) {
    const it = itemOut(r);
    if (it.extra.renewed) continue;
    const occ = occurrences(it, today, addDays(today, 31));
    for (const o of occ) {
      const left = daysBetween(today, o.start);
      if (!REMIND_DAYS.includes(left)) continue;
      const key = `cal:rem:${r.id}:${o.start}:${left}`;
      const claim = await env.DB.prepare("INSERT OR IGNORE INTO meta (k, v) VALUES (?, ?)").bind(key, deps.now()).run();
      if (!claim.meta || claim.meta.changes !== 1) continue;
      await deps.raiseEvent(env, { site: r.site, app: "calendar", tone: left <= 1 ? "alert" : "warn",
        title: left === 0 ? `Expires today · ${it.title}` : `Expires in ${left} day${left === 1 ? "" : "s"} · ${it.title}`,
        body: `${it.category || "Document"}${it.extra.provider ? " · " + it.extra.provider : ""} · ${o.start}` });
    }
  }
}

/* ---------- marketing events of a day (the handover reads them) ---------- */
export async function calendarDayEvents(env, site, day) {
  const { results } = await env.DB.prepare("SELECT * FROM cal_items WHERE site = ? AND deleted = 0 AND kind = 'marketing' AND start_day <= ? AND end_day >= ?")
    .bind(site, day, day).all().catch(() => ({ results: [] }));
  return (results || []).map(itemOut).filter(e => e.extra.status !== "Cancelled")
    .map(e => ({ name: e.title, from: e.start, to: e.end, start: e.from, end: e.to, location: e.location }));
}

/* ---------- routes: /api/ops/cal/* ---------- */
export async function calendarRoute(env, p, method, b, url, d) {
  const { site, me } = d;
  const mine = d.canSite(me, site);
  const team = mine && (d.full || me.role === "SUPERVISOR");
  const one = async id => {
    const r = await env.DB.prepare("SELECT * FROM cal_items WHERE id = ? AND deleted = 0").bind(Number(id) || 0).first();
    if (!r || !d.canSite(me, r.site)) throw err("Not found", 404);
    return r;
  };

  if (p === "cal/month") {
    const m = /^\d{4}-\d{2}$/.test(url.searchParams.get("month") || "") ? url.searchParams.get("month") : d.today().slice(0, 7);
    /* the visible grid: Monday before the 1st → Sunday after the last day */
    const first = m + "-01", last = monthEnd(m);
    const from = addDays(first, -((new Date(first + "T12:00:00Z").getUTCDay() + 6) % 7));
    const to = addDays(last, (7 - new Date(last + "T12:00:00Z").getUTCDay()) % 7);
    const [items, moms] = await Promise.all([
      env.DB.prepare(`SELECT * FROM cal_items WHERE site = ? AND deleted = 0 AND (repeat != '' OR (start_day <= ? AND end_day >= ?) OR month = ?)`).bind(site, to, from, m).all(),
      env.DB.prepare("SELECT id, title, meet_date, location, status FROM mom_meetings WHERE site = ? AND meet_date >= ? AND meet_date <= ? ORDER BY meet_date").bind(site, from, to).all().catch(() => ({ results: [] }))
    ]);
    const entries = [], objectives = [];
    for (const r of items.results || []) {
      const it = itemOut(r);
      if (it.kind === "objective") { if (it.month === m) objectives.push(it); continue; }
      for (const o of occurrences(it, from, to)) entries.push({ ...it, start: o.start, end: o.end, occ: o.start !== it.start || !!it.repeat, baseStart: it.start });
    }
    for (const x of moms.results || []) entries.push({ id: "mom-" + x.id, momId: x.id, kind: "mom", title: x.title || "Meeting", start: x.meet_date, end: x.meet_date,
      location: x.location || "", notes: x.status === "published" ? "Minutes published" : "Draft minutes", readonly: true });
    for (const c of await contractsInRange(env, site, from, to)) entries.push({ id: "con-" + c.no, kind: "contract", title: `${c.tenant} · ${c.departure ? "departure" : "contract end"}`,
      start: c.day, end: c.day, location: "", notes: `Contract ${c.no} · ${c.type || ""} · ${c.status || ""}`, readonly: true, contractNo: c.no });
    entries.sort((a, b) => (a.start + (a.from || "")).localeCompare(b.start + (b.from || "")));
    /* expiries coming up in the next 60 days (any month) */
    const today = d.today();
    const { results: ex } = await env.DB.prepare("SELECT * FROM cal_items WHERE site = ? AND deleted = 0 AND kind = 'expiry'").bind(site).all();
    const soon = [];
    for (const r of ex || []) { const it = itemOut(r); if (it.extra.renewed) continue;
      for (const o of occurrences(it, addDays(today, -30), addDays(today, 60))) soon.push({ ...it, start: o.start, left: daysBetween(today, o.start) }); }
    soon.sort((a, b) => a.start.localeCompare(b.start));
    return { month: m, from, to, today, entries, objectives, expiries: soon.slice(0, 30), kinds: CAL_KINDS, docTypes: DOC_TYPES, actTypes: ACT_TYPES, can: { edit: team } };
  }
  if (p === "cal/get") return { item: itemOut(await one(url.searchParams.get("id"))), can: { edit: team } };

  if (method !== "POST") throw err("Unknown request", 404);
  if (!team) throw err("Only the operations team can change the calendar", 403);

  if (p === "cal/save") {
    const r = clean(b), now = d.now();
    if (b.id) {
      const cur = await one(b.id);
      await env.DB.prepare(`UPDATE cal_items SET kind=?, title=?, start_day=?, end_day=?, time_from=?, time_to=?, location=?, notes=?, category=?, repeat=?, month=?,
        owner=?, plan=?, extra=?, done=?, updated_at=?, updated_name=? WHERE id=?`).bind(r.kind, r.title, r.start_day, r.end_day, r.time_from, r.time_to, r.location,
        r.notes, r.category, r.repeat, r.month, r.owner, r.plan, r.extra, r.done, now, me.full_name, cur.id).run();
      if (d.audit) await d.audit(env, { site: cur.site, tool: "calendar", ref: cur.id, label: r.title, action: "edit", before: Object.fromEntries(Object.keys(r).map(k => [k, cur[k]])), after: { ...r } });
      return { item: itemOut(await one(cur.id)) };
    }
    const res = await env.DB.prepare(`INSERT INTO cal_items (site, kind, title, start_day, end_day, time_from, time_to, location, notes, category, repeat, month, owner,
      plan, extra, done, created_by, created_name, created_at, updated_at, updated_name) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(site, r.kind, r.title, r.start_day, r.end_day, r.time_from, r.time_to, r.location, r.notes, r.category, r.repeat, r.month, r.owner, r.plan, r.extra, r.done,
        me.email, me.full_name, now, now, me.full_name).run();
    if (d.audit) await d.audit(env, { site, tool: "calendar", ref: res.meta.last_row_id, label: r.title, action: "add", after: { ...r } });
    if (r.kind === "marketing") await d.raiseEvent(env, { site, app: "calendar", tone: "info", title: `Marketing event added · ${r.title}`,
      body: `${r.start_day}${r.end_day !== r.start_day ? " → " + r.end_day : ""}${r.location ? " · " + r.location : ""} · by ${me.full_name}` });
    return { item: itemOut(await one(res.meta.last_row_id)) };
  }
  if (p === "cal/delete") {
    const cur = await one(b.id);
    await env.DB.prepare("UPDATE cal_items SET deleted = 1, updated_at = ?, updated_name = ? WHERE id = ?").bind(d.now(), me.full_name, cur.id).run();
    if (d.audit) await d.audit(env, { site: cur.site, tool: "calendar", ref: cur.id, label: cur.title, action: "delete", before: itemOut(cur) });
    return { deleted: true };
  }
  throw err("Unknown request", 404);
}
