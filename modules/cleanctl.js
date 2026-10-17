/* =====================================================================
   CLEANING CONTROL — the cleaning company's work against the schedule, with before / after photos (Oct 2026)
   • Each flagship builds its own schedule in the hub: daily tasks (times per weekday) and deep cleaning
     (weekly / monthly / every N days like the Canopy 26-day cycle / given dates). Verdun starts from the v3 schedule.
   • Cleaner app on its own link (worker abc-cleaning, folder cleaning-worker/): paired phones, up to 10 users each with a PIN,
     English / Arabic / Bangla. The supervisor picks the area → before photo → after photo → send.
     A "manager" phone shows the cleaning company's own view of the day.
   • Photos: made small on the phone (≈1024 px + a thumbnail), kept in Cloudflare R2 (bucket abc-cleaning-photos) for 90 days.
     The hub shows them through signed links served by the cleaning app (the hub itself has no R2 binding).
   • This file is shared: the hub (worker.js → /api/ops/cc/*) and the cleaning app (cleaning-worker/worker.js → /api/*) both import it.
   Tables: cc_tasks · cc_devices · cc_jobs · cc_special      See docs/FEATURE-cleaning-app.md
   ===================================================================== */
import { VRM_SEED } from "./cleanctl-seed.js";

export const CLEAN_URL = "https://abc-cleaning.sultanachi-lb-61f.workers.dev";
const err = (m, status = 400) => Object.assign(new Error(m), { status });
const clip = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const toMin = t => HM.test(t || "") ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3)) : -1;
const LATE_AFTER = 60;          // a timed task is "late" one hour after its time
export const KEEP_DAYS = 90;    // photos are deleted after 90 days
const MAX_USERS = 10;           // users per paired phone
const enc = new TextEncoder();
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
export const sha = async s => hex(await crypto.subtle.digest("SHA-256", enc.encode(String(s))));
const rand = n => hex(crypto.getRandomValues(new Uint8Array(n)));

export const beirut = () => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Beirut", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date()).map(x => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour}:${p.minute}`, min: Number(p.hour) * 60 + Number(p.minute) };
};
const dowOf = day => { const d = new Date(day + "T12:00:00Z").getUTCDay(); return d === 0 ? 7 : d; };   // 1 = Monday … 7 = Sunday
const daysBetween = (a, b) => Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 864e5);
const hmOf = iso => { try { return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Beirut", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso)); } catch { return ""; } };

/* ---------- tables ---------- */
export async function ccSchema(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS cc_tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, site TEXT NOT NULL, floor TEXT NOT NULL DEFAULT '', name TEXT NOT NULL,
      icon TEXT NOT NULL DEFAULT '', tool TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL DEFAULT 'daily', freq TEXT NOT NULL DEFAULT 'daily',
      times TEXT NOT NULL DEFAULT '{}', rule TEXT NOT NULL DEFAULT '{}', time TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT, updated_name TEXT)`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS cc_tasks_site ON cc_tasks (site, active)"),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS cc_devices (id INTEGER PRIMARY KEY AUTOINCREMENT, site TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'cleaner',
      token_hash TEXT NOT NULL DEFAULT '', pair_code TEXT NOT NULL DEFAULT '', pair_exp TEXT NOT NULL DEFAULT '', users TEXT NOT NULL DEFAULT '[]',
      last_seen TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1, created_at TEXT, created_name TEXT)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS cc_jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, client_id TEXT NOT NULL UNIQUE, site TEXT NOT NULL, day TEXT NOT NULL,
      task_id INTEGER NOT NULL DEFAULT 0, special_id INTEGER NOT NULL DEFAULT 0, floor TEXT NOT NULL DEFAULT '', area TEXT NOT NULL DEFAULT '',
      user_name TEXT NOT NULL DEFAULT '', device_id INTEGER NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT '',
      before_at TEXT NOT NULL DEFAULT '', after_at TEXT NOT NULL DEFAULT '',
      b_key TEXT NOT NULL DEFAULT '', bt_key TEXT NOT NULL DEFAULT '', a_key TEXT NOT NULL DEFAULT '', at_key TEXT NOT NULL DEFAULT '',
      purged INTEGER NOT NULL DEFAULT 0, created_at TEXT)`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS cc_jobs_day ON cc_jobs (site, day)"),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS cc_special (id INTEGER PRIMARY KEY AUTOINCREMENT, site TEXT NOT NULL, title TEXT NOT NULL, details TEXT NOT NULL DEFAULT '',
      area TEXT NOT NULL DEFAULT '', due TEXT NOT NULL DEFAULT '', due_time TEXT NOT NULL DEFAULT '', priority TEXT NOT NULL DEFAULT 'medium', photo TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open', done_at TEXT NOT NULL DEFAULT '', done_by TEXT NOT NULL DEFAULT '', job_id INTEGER NOT NULL DEFAULT 0,
      created_at TEXT, created_name TEXT)`)
  ]);
}

/* ---------- Verdun starts from the v3 schedule (once) ---------- */
async function ensureSeed(env, site) {
  if (site !== "VRM") return;
  const done = await env.DB.prepare("SELECT v FROM meta WHERE k = 'cc:seed:VRM'").first().catch(() => null);
  if (done) return;
  const have = await env.DB.prepare("SELECT COUNT(*) AS n FROM cc_tasks WHERE site = 'VRM'").first();
  await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('cc:seed:VRM', ?)").bind(new Date().toISOString()).run();
  if (Number(have.n)) return;
  const at = new Date().toISOString(), ops = [];
  let wk = 0, mo = 0;
  VRM_SEED.rows.forEach(([floor, name, freq, icon, time, tool], i) => {
    let kind = "daily", f = "daily", times = {}, rule = {};
    if (freq === "daily") { for (let d = 1; d <= 7; d++) times[d] = [time || ""]; }
    else if (freq === "weekly") { kind = "deep"; f = "weekly"; rule = { dow: [(wk++ % 6) + 1] }; }
    else { kind = "deep"; f = "monthly"; rule = { dom: [(mo++ % 27) + 1] }; }
    ops.push(env.DB.prepare(`INSERT INTO cc_tasks (site, floor, name, icon, tool, kind, freq, times, rule, time, sort, updated_at, updated_name) VALUES ('VRM',?,?,?,?,?,?,?,?,?,?,?,'v3 schedule')`)
      .bind(floor, name, icon, tool, kind, f, JSON.stringify(times), JSON.stringify(rule), kind === "deep" ? time : "", i, at));
  });
  VRM_SEED.can.forEach(([name, from, len], i) => ops.push(env.DB.prepare(`INSERT INTO cc_tasks (site, floor, name, icon, tool, kind, freq, times, rule, time, sort, updated_at, updated_name)
    VALUES ('VRM','Canopies',?,'⛱️','Canopy cleaning','deep','cycle','{}',?, '07:00', ?, ?, 'v3 schedule')`).bind(name, JSON.stringify({ every: 26, start: "2026-10-01", from, len }), 500 + i, at)));
  for (let i = 0; i < ops.length; i += 50) await env.DB.batch(ops.slice(i, i + 50));
}

/* ---------- does a task run on a day, and at what times ---------- */
export function slotsOf(t, day) {
  let times = {}, rule = {};
  try { times = JSON.parse(t.times || "{}"); } catch {}
  try { rule = JSON.parse(t.rule || "{}"); } catch {}
  if (t.kind === "daily") { const L = times[dowOf(day)] || []; return L.map(x => HM.test(x) ? x : ""); }
  let on = false;
  if (t.freq === "weekly") on = (rule.dow || []).includes(dowOf(day));
  else if (t.freq === "monthly") { const dm = Number(day.slice(8)), last = new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7), 0)).getUTCDate();
    on = (rule.dom || []).some(x => Math.min(Number(x), last) === dm); }
  else if (t.freq === "cycle" && DAY.test(rule.start || "") && rule.every > 0) { const k = daysBetween(rule.start, day);
    if (k >= 0) { const pos = (k % rule.every) + 1; on = pos >= (rule.from || 1) && pos < (rule.from || 1) + (rule.len || 1); } }
  else if (t.freq === "dates") on = (rule.dates || []).includes(day);
  return on ? [HM.test(t.time || "") ? t.time : ""] : [];
}

/* ---------- photo links the hub can show: signed, served by the cleaning app ---------- */
export async function signSecret(env) {
  const r = await env.DB.prepare("SELECT v FROM meta WHERE k = 'cc:sign'").first().catch(() => null);
  if (r) return r.v;
  const v = rand(24);
  await env.DB.prepare("INSERT OR IGNORE INTO meta (k, v) VALUES ('cc:sign', ?)").bind(v).run();
  return (await env.DB.prepare("SELECT v FROM meta WHERE k = 'cc:sign'").first()).v;
}
export async function photoSig(secret, key, exp) { return (await sha(`${secret}|${key}|${exp}`)).slice(0, 32); }
async function photoLinker(env, rel) {   // rel: links for the cleaning app itself (same address)
  const secret = await signSecret(env), exp = Math.floor(Date.now() / 1000) + 6 * 3600, base = rel ? "" : (env.CLEAN_URL || CLEAN_URL);
  return async key => key ? `${base}/photo/${key}?e=${exp}&s=${await photoSig(secret, key, exp)}` : "";
}

/* ---------- the day: every scheduled slot with its status ---------- */
export async function ccDay(env, site, day, opt = {}) {
  await ensureSeed(env, site);
  const now = beirut(), isToday = day === now.day, past = day < now.day;
  const [tq, jq, sq] = await Promise.all([
    env.DB.prepare("SELECT * FROM cc_tasks WHERE site = ? AND active = 1 ORDER BY sort, id").bind(site).all(),
    env.DB.prepare("SELECT * FROM cc_jobs WHERE site = ? AND day = ? ORDER BY before_at, id").bind(site, day).all(),
    env.DB.prepare("SELECT * FROM cc_special WHERE site = ? AND (status = 'open' OR due = ? OR substr(done_at,1,10) = ?) ORDER BY due, id").bind(site, day, day).all()
  ]);
  const link = opt.photos ? await photoLinker(env, opt.rel) : null;
  const jobsBy = new Map();
  for (const j of jq.results || []) if (j.task_id) (jobsBy.get(j.task_id) || jobsBy.set(j.task_id, []).get(j.task_id)).push(j);
  const jobOut = async j => j && { id: j.id, user: j.user_name, before: hmOf(j.before_at), after: j.after_at ? hmOf(j.after_at) : "", note: j.note,
    ...(link ? { b: await link(j.b_key), bt: await link(j.bt_key || j.b_key), a: await link(j.a_key), at: await link(j.at_key || j.a_key) } : {}), purged: !!j.purged };
  const items = [];
  for (const t of tq.results || []) {
    const slots = slotsOf(t, day).sort((a, b) => (a || "99") .localeCompare(b || "99"));
    const js = jobsBy.get(t.id) || [];
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i], j = js[i] || null, m = toMin(s);
      let st = j && j.after_at ? "done" : j ? "progress" : past ? "missed" : !isToday ? "upcoming"
        : m < 0 ? "due" : now.min > m + LATE_AFTER ? "late" : now.min >= m ? "due" : "upcoming";
      items.push({ key: `${t.id}|${i}`, taskId: t.id, floor: t.floor, name: t.name, icon: t.icon, tool: t.tool, kind: t.kind, freq: t.freq, time: s, status: st, job: await jobOut(j) });
    }
    for (let i = slots.length; i < js.length; i++) items.push({ key: `${t.id}|x${i}`, taskId: t.id, floor: t.floor, name: t.name, icon: t.icon, tool: t.tool, kind: t.kind, freq: t.freq, time: "", status: js[i].after_at ? "done" : "progress", extra: true, job: await jobOut(js[i]) });
  }
  const specials = [];
  for (const x of sq.results || []) {
    const j = x.job_id ? (jq.results || []).find(y => y.id === x.job_id) : null;
    specials.push({ id: x.id, title: x.title, details: x.details, area: x.area, due: x.due, dueTime: x.due_time, priority: x.priority, status: x.status,
      doneAt: x.done_at ? hmOf(x.done_at) : "", doneBy: x.done_by, photo: opt.specialPhoto ? x.photo : !!x.photo, by: x.created_name,
      overdue: x.status === "open" && x.due && (x.due < now.day || (x.due === now.day && x.due_time && now.hm > x.due_time)), job: j ? await jobOut(j) : null });
  }
  const sched = items.filter(x => !x.extra);
  const dueSoFar = sched.filter(x => past || (isToday && (toMin(x.time) < 0 || toMin(x.time) <= now.min)));
  const done = sched.filter(x => x.status === "done").length;
  const floors = {};
  for (const x of sched) { const f = floors[x.floor] || (floors[x.floor] = { floor: x.floor, total: 0, done: 0, late: 0 }); f.total++; if (x.status === "done") f.done++; if (x.status === "late" || x.status === "missed") f.late++; }
  const byUser = {};
  for (const j of jq.results || []) { const u = byUser[j.user_name || "—"] || (byUser[j.user_name || "—"] = { user: j.user_name || "—", done: 0, progress: 0 }); j.after_at ? u.done++ : u.progress++; }
  return { site, day, now: now.hm, isToday, items, specials,
    summary: { total: sched.length, done, dueSoFar: dueSoFar.length, late: sched.filter(x => x.status === "late" || x.status === "missed").length,
      progress: sched.filter(x => x.status === "progress").length, compliance: dueSoFar.length ? Math.round(done / dueSoFar.length * 100) : null,
      dayCompliance: sched.length ? Math.round(done / sched.length * 100) : null, extra: items.filter(x => x.extra).length },
    floors: Object.values(floors), byUser: Object.values(byUser) };
}

/* ---------- headcount from Cleaning Headcount (modules/cleaning.js): the contract and the day's punches ---------- */
async function headcountOf(env, site, day, nowMin) {
  const s = await env.DB.prepare("SELECT data FROM cl_settings WHERE site = ?").bind(site).first().catch(() => null);
  let plan = {}; try { plan = s ? JSON.parse(s.data || "{}") : {}; } catch {}
  const r = await env.DB.prepare("SELECT rows FROM cl_reports WHERE site = ? AND day_from <= ? AND day_to >= ? ORDER BY id DESC LIMIT 1").bind(site, day, day).first().catch(() => null);
  let present = null, onNow = null;
  if (r) { let rows = []; try { rows = JSON.parse(r.rows || "[]"); } catch {}
    const L = rows.map(x => (x.days || []).find(d => d.day === day)).filter(d => d && d.in);
    present = L.length; onNow = nowMin == null ? null : L.filter(d => toMin(d.in) <= nowMin && (!d.out || toMin(d.out) > nowMin)).length; }
  return { contract: Number(plan.headcount) || 0, minOnDuty: Number(plan.minOnDuty) || 0, provider: plan.provider || "", present, onNow };
}

/* ---------- cleaning the hub's input ---------- */
function cleanTask(b) {
  const name = clip(b.name, 80); if (!name) throw err("Give the area / task a name");
  const kind = b.kind === "deep" ? "deep" : "daily";
  const out = { floor: clip(b.floor, 40), name, icon: clip(b.icon, 8), tool: clip(b.tool, 60), kind, freq: "daily", times: "{}", rule: "{}", time: "" };
  if (kind === "daily") {
    const t = {}; for (let d = 1; d <= 7; d++) t[d] = [...new Set((Array.isArray((b.times || {})[d]) ? b.times[d] : []).map(x => HM.test(x) ? x : x === "" ? "" : null).filter(x => x !== null))].sort().slice(0, 12);
    out.times = JSON.stringify(t);
  } else {
    const f = ["weekly", "monthly", "cycle", "dates"].includes(b.freq) ? b.freq : "weekly", r = b.rule || {};
    let rule = {};
    if (f === "weekly") rule = { dow: [...new Set((r.dow || []).map(Number).filter(x => x >= 1 && x <= 7))].sort() };
    if (f === "monthly") rule = { dom: [...new Set((r.dom || []).map(Number).filter(x => x >= 1 && x <= 31))].sort((a, c) => a - c) };
    if (f === "cycle") { if (!DAY.test(r.start || "")) throw err("Choose the first day of the cycle"); rule = { every: Math.max(2, Math.min(366, Number(r.every) || 26)), start: r.start, from: Math.max(1, Number(r.from) || 1), len: Math.max(1, Math.min(31, Number(r.len) || 1)) }; }
    if (f === "dates") rule = { dates: [...new Set((r.dates || []).filter(x => DAY.test(x)))].sort().slice(0, 120) };
    if ((f === "weekly" && !rule.dow.length) || (f === "monthly" && !rule.dom.length) || (f === "dates" && !rule.dates.length)) throw err("Choose at least one day");
    out.freq = f; out.rule = JSON.stringify(rule); out.time = HM.test(b.time || "") ? b.time : "";
  }
  return out;
}
const taskOut = t => ({ id: t.id, floor: t.floor, name: t.name, icon: t.icon, tool: t.tool, kind: t.kind, freq: t.freq, times: JSON.parse(t.times || "{}"), rule: JSON.parse(t.rule || "{}"), time: t.time, active: !!t.active, sort: t.sort });
const devOut = d => ({ id: d.id, name: d.name, kind: d.kind, paired: !!d.token_hash, pairing: d.pair_code && d.pair_exp > new Date().toISOString() ? d.pair_code : "", pairExp: d.pair_exp,
  users: JSON.parse(d.users || "[]").map(u => ({ id: u.id, name: u.name, lang: u.lang || "en", hasPin: !!u.pin })), lastSeen: d.last_seen, active: !!d.active });

/* =====================================================================
   HUB routes  /api/ops/cc/*      ctx = { site, me, can, now, raiseEvent, canManage }
   ===================================================================== */
export async function ccHubRoute(env, p, method, b, url, ctx) {
  const { site, me, now } = ctx, q = k => url.searchParams.get(k) || "";
  const need = () => { if (!ctx.canManage) throw err("Only operations can change Cleaning Control", 403); };
  if (p === "cc/day") {
    const day = DAY.test(q("day")) ? q("day") : beirut().day;
    const d = await ccDay(env, site, day, { photos: true, specialPhoto: false });
    d.headcount = await headcountOf(env, site, day, day === beirut().day ? beirut().min : null).catch(() => null);
    d.cleanUrl = env.CLEAN_URL || CLEAN_URL; d.can = { manage: !!ctx.canManage };
    return d;
  }
  if (p === "cc/tasks") { await ensureSeed(env, site);
    const { results } = await env.DB.prepare("SELECT * FROM cc_tasks WHERE site = ? AND active = 1 ORDER BY sort, id").bind(site).all();
    return { tasks: (results || []).map(taskOut), can: { manage: !!ctx.canManage } }; }
  if (p === "cc/task/save" && method === "POST") {
    need(); const c = cleanTask(b);
    if (b.id) {
      const r = await env.DB.prepare("UPDATE cc_tasks SET floor=?, name=?, icon=?, tool=?, kind=?, freq=?, times=?, rule=?, time=?, updated_at=?, updated_name=? WHERE id=? AND site=?")
        .bind(c.floor, c.name, c.icon, c.tool, c.kind, c.freq, c.times, c.rule, c.time, now(), me.full_name, Number(b.id), site).run();
      if (!r.meta.changes) throw err("This task no longer exists", 404);
      return { id: Number(b.id) };
    }
    const mx = await env.DB.prepare("SELECT MAX(sort) AS m FROM cc_tasks WHERE site = ?").bind(site).first();
    const r = await env.DB.prepare("INSERT INTO cc_tasks (site, floor, name, icon, tool, kind, freq, times, rule, time, sort, updated_at, updated_name) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(site, c.floor, c.name, c.icon, c.tool, c.kind, c.freq, c.times, c.rule, c.time, (Number(mx && mx.m) || 0) + 1, now(), me.full_name).run();
    return { id: r.meta.last_row_id };
  }
  if (p === "cc/task/remove" && method === "POST") { need();
    await env.DB.prepare("UPDATE cc_tasks SET active = 0, updated_at = ?, updated_name = ? WHERE id = ? AND site = ?").bind(now(), me.full_name, Number(b.id), site).run();
    return { removed: true }; }

  /* phones and their users */
  if (p === "cc/devices") { const { results } = await env.DB.prepare("SELECT * FROM cc_devices WHERE site = ? AND active = 1 ORDER BY kind DESC, id").bind(site).all();
    return { devices: (results || []).map(devOut), cleanUrl: CLEAN_URL, maxUsers: MAX_USERS }; }
  if (p === "cc/device/save" && method === "POST") {
    need();
    const name = clip(b.name, 60); if (!name) throw err("Give the phone a name, e.g. “BPM supervisor · L2”");
    const kind = b.kind === "manager" ? "manager" : "cleaner";
    let cur = null;
    if (b.id) { cur = await env.DB.prepare("SELECT * FROM cc_devices WHERE id = ? AND site = ? AND active = 1").bind(Number(b.id), site).first(); if (!cur) throw err("This phone no longer exists", 404); }
    const old = cur ? JSON.parse(cur.users || "[]") : [];
    const L = (Array.isArray(b.users) ? b.users : []).slice(0, MAX_USERS + 1);
    if (L.length > MAX_USERS) throw err(`Up to ${MAX_USERS} users on one phone`);
    const users = [];
    for (const u of L) {
      const nm = clip(u.name, 40); if (!nm) continue;
      const id = clip(u.id, 12) || rand(4), prev = old.find(x => x.id === id);
      let pin = prev ? prev.pin : "";
      if (u.pin) { if (!/^\d{4}$/.test(String(u.pin))) throw err(`The PIN of ${nm} must be 4 digits`); pin = await sha(`cc|${id}|${u.pin}`); }
      if (!pin) throw err(`Set a 4-digit PIN for ${nm}`);
      users.push({ id, name: nm, lang: ["en", "ar", "bn"].includes(u.lang) ? u.lang : "en", pin });
    }
    if (!users.length) throw err("Add at least one user with a PIN");
    if (cur) { await env.DB.prepare("UPDATE cc_devices SET name = ?, kind = ?, users = ? WHERE id = ?").bind(name, kind, JSON.stringify(users), cur.id).run(); return { id: cur.id }; }
    const r = await env.DB.prepare("INSERT INTO cc_devices (site, name, kind, users, created_at, created_name) VALUES (?,?,?,?,?,?)").bind(site, name, kind, JSON.stringify(users), now(), me.full_name).run();
    return { id: r.meta.last_row_id };
  }
  if (p === "cc/device/pair" && method === "POST") {
    need();
    const d = await env.DB.prepare("SELECT id FROM cc_devices WHERE id = ? AND site = ? AND active = 1").bind(Number(b.id), site).first(); if (!d) throw err("This phone no longer exists", 404);
    const code = Array.from(crypto.getRandomValues(new Uint8Array(6)), x => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[x % 32]).join("");
    const exp = new Date(Date.now() + 30 * 60000).toISOString();
    await env.DB.prepare("UPDATE cc_devices SET pair_code = ?, pair_exp = ?, token_hash = '' WHERE id = ?").bind(code, exp, d.id).run();   // a new pairing cuts off the old phone
    return { code, exp, link: `${CLEAN_URL}/?pair=${code}` };
  }
  if (p === "cc/device/remove" && method === "POST") { need();
    await env.DB.prepare("UPDATE cc_devices SET active = 0, token_hash = '', pair_code = '' WHERE id = ? AND site = ?").bind(Number(b.id), site).run(); return { removed: true }; }

  /* special tasks */
  if (p === "cc/specials") {
    const { results } = await env.DB.prepare("SELECT * FROM cc_special WHERE site = ? ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, due DESC, id DESC LIMIT 200").bind(site).all();
    return { specials: (results || []).map(x => ({ id: x.id, title: x.title, details: x.details, area: x.area, due: x.due, dueTime: x.due_time, priority: x.priority, status: x.status,
      photo: x.photo, doneAt: x.done_at, doneBy: x.done_by, by: x.created_name, at: x.created_at })) };
  }
  if (p === "cc/special/save" && method === "POST") {
    need();
    const title = clip(b.title, 120); if (!title) throw err("Give the task a title");
    const photo = /^data:image\/jpeg;base64,/.test(b.photo || "") && String(b.photo).length < 260000 ? b.photo : "";
    const v = [title, clip(b.details, 800), clip(b.area, 80), DAY.test(b.due || "") ? b.due : beirut().day, HM.test(b.dueTime || "") ? b.dueTime : "",
      ["high", "medium", "low"].includes(b.priority) ? b.priority : "medium"];
    if (b.id) { await env.DB.prepare("UPDATE cc_special SET title=?, details=?, area=?, due=?, due_time=?, priority=?" + (photo || b.photo === "" ? ", photo=?" : "") + " WHERE id=? AND site=?")
      .bind(...v, ...(photo || b.photo === "" ? [photo] : []), Number(b.id), site).run(); return { id: Number(b.id) }; }
    const r = await env.DB.prepare("INSERT INTO cc_special (site, title, details, area, due, due_time, priority, photo, created_at, created_name) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .bind(site, ...v, photo, now(), me.full_name).run();
    return { id: r.meta.last_row_id };
  }
  if (p === "cc/special/remove" && method === "POST") { need(); await env.DB.prepare("DELETE FROM cc_special WHERE id = ? AND site = ?").bind(Number(b.id), site).run(); return { removed: true }; }
  if (p === "cc/special/close" && method === "POST") { need();
    await env.DB.prepare("UPDATE cc_special SET status = ?, done_at = CASE WHEN ? = 'done' THEN ? ELSE '' END, done_by = CASE WHEN ? = 'done' THEN ? ELSE '' END WHERE id = ? AND site = ?")
      .bind(b.reopen ? "open" : "done", b.reopen ? "" : "done", now(), b.reopen ? "" : "done", me.full_name, Number(b.id), site).run(); return { ok: true }; }

  /* analysis over a period */
  if (p === "cc/analysis") {
    const to = DAY.test(q("to")) ? q("to") : beirut().day; let from =DAY.test(q("from")) ? q("from") : new Date(Date.parse(to + "T12:00:00Z") - 29 * 864e5).toISOString().slice(0, 10);
    if (daysBetween(from, to) > 92 || daysBetween(from, to) < 0) throw err("Choose up to 3 months");
    /* the count starts the day the cleaner app went live here (first phone or first job) — days before are not "missed" */
    const live = await env.DB.prepare(`SELECT MIN(d) AS d FROM (SELECT MIN(substr(created_at,1,10)) AS d FROM cc_devices WHERE site = ? AND created_at IS NOT NULL AND created_at <> ''
      UNION ALL SELECT MIN(day) FROM cc_jobs WHERE site = ?)`).bind(site, site).first().catch(() => null);
    const liveSince = live && DAY.test(live.d || "") ? live.d : null;
    if (!liveSince) return { from, to, liveSince: null, days: [], compliance: null, done: 0, scheduled: 0, floors: [], worst: [], users: [] };
    if (liveSince > from) from = liveSince > to ? to : liveSince;
    const days = [], byTask = new Map(), byFloor = new Map(), byUser = new Map();
    for (let d = from; d <= to; d = new Date(Date.parse(d + "T12:00:00Z") + 864e5).toISOString().slice(0, 10)) {
      const x = await ccDay(env, site, d);
      const hc = await headcountOf(env, site, d, null).catch(() => null);
      days.push({ day: d, total: x.summary.total, done: x.summary.done, due: x.summary.dueSoFar, pct: x.isToday ? x.summary.compliance : x.summary.dayCompliance, present: hc && hc.present, contract: hc && hc.contract });
      for (const it of x.items) { if (it.extra) continue;
        const t = byTask.get(it.taskId) || byTask.set(it.taskId, { name: it.name, floor: it.floor, total: 0, done: 0 }).get(it.taskId);
        const f = byFloor.get(it.floor) || byFloor.set(it.floor, { floor: it.floor, total: 0, done: 0 }).get(it.floor);
        if (x.isToday && it.status === "upcoming") continue;
        t.total++; f.total++; if (it.status === "done") { t.done++; f.done++; } }
      for (const u of x.byUser) { const v = byUser.get(u.user) || byUser.set(u.user, { user: u.user, done: 0, days: 0 }).get(u.user); v.done += u.done; v.days++; }
    }
    const pct = o => o.total ? Math.round(o.done / o.total * 100) : null;
    const tot = days.reduce((a, d) => ({ total: a.total + (d.due || 0), done: a.done + d.done }), { total: 0, done: 0 });
    return { from, to, liveSince, days, compliance: pct(tot), done: tot.done, scheduled: tot.total,
      floors: [...byFloor.values()].map(f => ({ ...f, pct: pct(f) })).sort((a, c) => (a.pct ?? 101) - (c.pct ?? 101)),
      worst: [...byTask.values()].map(t => ({ ...t, pct: pct(t) })).filter(t => t.total).sort((a, c) => a.pct - c.pct || c.total - a.total).slice(0, 15),
      users: [...byUser.values()].sort((a, c) => c.done - a.done) };
  }
  if (p === "cc/packlist") {   // Downloads: the months that have cleaning jobs (newest first)
    const { results } = await env.DB.prepare("SELECT substr(day,1,7) AS m, COUNT(*) AS n FROM cc_jobs WHERE site = ? GROUP BY m ORDER BY m DESC LIMIT 4").bind(site).all();
    return { months: (results || []).map(r => ({ month: r.m, jobs: r.n })) };
  }
  /* monthly cleaning pack (also in Downloads): every day of the month with its photos */
  if (p === "cc/pack") {
    const m = /^\d{4}-\d{2}$/.test(q("month")) ? q("month") : beirut().day.slice(0, 7);
    const last = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate(), out = [];
    for (let i = 1; i <= last; i++) { const d = `${m}-${String(i).padStart(2, "0")}`; if (d > beirut().day) break;
      const x = await ccDay(env, site, d, { photos: true });
      out.push({ day: d, summary: x.summary, done: x.items.filter(it => it.job && it.job.after).map(it => ({ floor: it.floor, name: it.name, time: it.time, job: it.job })),
        missed: x.items.filter(it => !it.extra && it.status !== "done").map(it => ({ floor: it.floor, name: it.name, time: it.time })),
        specials: x.specials.filter(s => s.status === "done" || s.due === d) }); }
    return { month: m, days: out };
  }
  throw err("Unknown request", 404);
}

/* the Cleaning section of the Shift Handover (live) */
export async function ccHandover(env, site, day) {
  const x = await ccDay(env, site, day);
  if (!x.items.length && !x.specials.length) return null;
  const hc = await headcountOf(env, site, day, day === beirut().day ? beirut().min : null).catch(() => null);
  const group = L => { const g = {}; for (const i of L) (g[i.floor] = g[i.floor] || []).push(i); return Object.entries(g).map(([floor, A]) => ({ floor, n: A.length, names: A.map(i => i.name + (i.time ? " " + i.time : "")) })); };
  const late = x.items.filter(i => i.status === "late" || i.status === "missed"), next = x.items.filter(i => i.status === "upcoming" || i.status === "due");
  return { summary: x.summary, now: x.now, headcount: hc,
    missing: group(late),   // one line per floor: what is late / not done
    progress: x.items.filter(i => i.status === "progress").map(i => ({ floor: i.floor, name: i.name, by: i.job && i.job.user, since: i.job && i.job.before })),
    next: group(next),
    specials: x.specials.map(s => ({ title: s.title, area: s.area, due: s.due, dueTime: s.dueTime, status: s.status, overdue: s.overdue, doneBy: s.job ? s.job.user : s.doneBy })) };
}


/* =====================================================================
   CLEANING APP routes (cleaning-worker)   deps = { R2 }
   Phone: Authorization: Bearer <device token>  ·  user: x-cc-ses (after the PIN)
   ===================================================================== */
async function deviceOf(env, request) {
  const tok = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!/^[0-9a-f]{48}$/.test(tok)) throw err("This phone is not paired — ask operations for a pairing code", 401);
  const d = await env.DB.prepare("SELECT * FROM cc_devices WHERE token_hash = ? AND active = 1").bind(await sha(tok)).first();
  if (!d) throw err("This phone was removed — ask operations to pair it again", 401);
  const t = new Date().toISOString();
  if (!d.last_seen || Date.parse(t) - Date.parse(d.last_seen) > 5 * 60000) await env.DB.prepare("UPDATE cc_devices SET last_seen = ? WHERE id = ?").bind(t, d.id).run().catch(() => {});
  return d;
}
async function userOf(env, request, d) {
  const s = String(request.headers.get("x-cc-ses") || ""), [uid, exp, sig] = s.split(".");
  if (!uid || !exp || !sig || Number(exp) < Date.now() / 1000) throw err("Enter your PIN again", 401);
  const secret = await signSecret(env);
  if (sig !== (await sha(`ses|${secret}|${d.id}|${uid}|${exp}`)).slice(0, 32)) throw err("Enter your PIN again", 401);
  const u = JSON.parse(d.users || "[]").find(x => x.id === uid); if (!u) throw err("This user was removed", 401);
  return u;
}
const siteName = s => ({ VRM: "Verdun Mall", ACM: "Achrafieh Mall", DBS: "Dbayeh Department Store", ACS: "Achrafieh Department Store", VRS: "Verdun Department Store" })[s] || s;

export async function ccAppRoute(env, request, p, deps) {
  const url = new URL(request.url), method = request.method;
  const body = async () => { try { return await request.json(); } catch { return {}; } };
  if (p === "pair" && method === "POST") {
    const b = await body(), code = clip(b.code, 12).toUpperCase();
    if (!code) throw err("Type the pairing code");
    const d = await env.DB.prepare("SELECT * FROM cc_devices WHERE pair_code = ? AND active = 1").bind(code).first();
    if (!d || d.pair_exp < new Date().toISOString()) throw err("This pairing code is wrong or has expired — ask operations for a new one", 400);
    const tok = rand(24);
    await env.DB.prepare("UPDATE cc_devices SET token_hash = ?, pair_code = '', pair_exp = '', last_seen = ? WHERE id = ?").bind(await sha(tok), new Date().toISOString(), d.id).run();
    return { token: tok };
  }
  const d = await deviceOf(env, request);
  if (p === "me") return { device: d.name, kind: d.kind, site: d.site, siteName: siteName(d.site), users: JSON.parse(d.users || "[]").map(u => ({ id: u.id, name: u.name, lang: u.lang })) };
  if (p === "login" && method === "POST") {
    const b = await body(), u = JSON.parse(d.users || "[]").find(x => x.id === b.user);
    if (!u || !/^\d{4}$/.test(String(b.pin || "")) || (await sha(`cc|${u.id}|${b.pin}`)) !== u.pin) throw err("Wrong PIN", 401);
    const exp = Math.floor(Date.now() / 1000) + 14 * 3600, secret = await signSecret(env);
    return { ses: `${u.id}.${exp}.${(await sha(`ses|${secret}|${d.id}|${u.id}|${exp}`)).slice(0, 32)}`, name: u.name, lang: u.lang || "en", kind: d.kind };
  }
  const u = await userOf(env, request, d);
  const today = beirut().day;
  if (p === "today") {
    const x = await ccDay(env, d.site, DAY.test(url.searchParams.get("day") || "") && d.kind === "manager" ? url.searchParams.get("day") : today, { photos: d.kind === "manager", rel: true, specialPhoto: true });
    if (d.kind === "manager") x.headcount = await headcountOf(env, d.site, x.day, x.isToday ? beirut().min : null).catch(() => null);
    return x;
  }
  /* a job: created when the before photo is taken, finished with the after photo (sent again safely when back online) */
  if (p === "job" && method === "POST") {
    if (d.kind !== "cleaner") throw err("This is a manager phone", 403);
    const b = await body(), c = clip(b.c, 40); if (!/^[\w-]{8,40}$/.test(c)) throw err("Bad request");
    const at = v => { const t = Date.parse(v || ""); return Number.isFinite(t) && t < Date.now() + 5 * 60000 && t > Date.now() - 3 * 864e5 ? new Date(t).toISOString() : ""; };
    const cur = await env.DB.prepare("SELECT * FROM cc_jobs WHERE client_id = ?").bind(c).first();
    if (cur && cur.device_id !== d.id) throw err("Bad request");
    let task = null, sp = null;
    const day = DAY.test(b.day || "") && b.day <= today ? b.day : today;
    if (Number(b.taskId)) task = await env.DB.prepare("SELECT id, floor, name FROM cc_tasks WHERE id = ? AND site = ?").bind(Number(b.taskId), d.site).first();
    if (Number(b.specialId)) sp = await env.DB.prepare("SELECT id, area, title FROM cc_special WHERE id = ? AND site = ?").bind(Number(b.specialId), d.site).first();
    if (!task && !sp) throw err("Choose the area");
    const beforeAt = at(b.beforeAt), afterAt = at(b.afterAt);
    if (!cur) {
      await env.DB.prepare(`INSERT INTO cc_jobs (client_id, site, day, task_id, special_id, floor, area, user_name, device_id, note, before_at, after_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(c, d.site, day, task ? task.id : 0, sp ? sp.id : 0, task ? task.floor : clip(sp.area, 40), task ? task.name : clip(sp.title, 80), u.name, d.id, clip(b.note, 300), beforeAt || new Date().toISOString(), afterAt, new Date().toISOString()).run();
    } else {
      await env.DB.prepare("UPDATE cc_jobs SET after_at = CASE WHEN ? != '' THEN ? ELSE after_at END, note = CASE WHEN ? != '' THEN ? ELSE note END WHERE id = ?")
        .bind(afterAt, afterAt, clip(b.note, 300), clip(b.note, 300), cur.id).run();
    }
    const j = await env.DB.prepare("SELECT id, special_id, after_at FROM cc_jobs WHERE client_id = ?").bind(c).first();
    if (j.special_id && j.after_at) await env.DB.prepare("UPDATE cc_special SET status = 'done', done_at = ?, done_by = ?, job_id = ? WHERE id = ? AND status = 'open'").bind(j.after_at, u.name, j.id, j.special_id).run();
    return { id: j.id };
  }
  /* a photo (already made small on the phone): k = b (before) · bt (before thumbnail) · a (after) · at (after thumbnail) */
  if (p === "photo" && method === "PUT") {
    if (!deps.R2) throw err("Photo storage is not set up yet (R2)", 503);
    const c = clip(url.searchParams.get("c"), 40), k = url.searchParams.get("k");
    if (!["b", "bt", "a", "at"].includes(k)) throw err("Bad request");
    const j = await env.DB.prepare("SELECT id, site, day, device_id FROM cc_jobs WHERE client_id = ?").bind(c).first();
    if (!j || j.device_id !== d.id) throw err("Send the job first", 409);
    const buf = await request.arrayBuffer();
    if (!buf.byteLength || buf.byteLength > 700000) throw err("The photo is too large", 413);
    const key = `${j.site}/${j.day}/${c}-${k}.jpg`;
    await deps.R2.put(key, buf, { httpMetadata: { contentType: "image/jpeg" } });
    await env.DB.prepare(`UPDATE cc_jobs SET ${k === "b" ? "b_key" : k === "bt" ? "bt_key" : k === "a" ? "a_key" : "at_key"} = ? WHERE id = ?`).bind(key, j.id).run();
    return { key };
  }
  throw err("Not found", 404);
}

/* a signed photo link (from the hub) */
export async function ccPhoto(env, R2, key, url) {
  const exp = Number(url.searchParams.get("e")), s = url.searchParams.get("s") || "";
  if (!/^[A-Z]{3}\/\d{4}-\d{2}-\d{2}\/[\w-]+\.jpg$/.test(key) || !(exp > Date.now() / 1000)) return null;
  if (s !== await photoSig(await signSecret(env), key, exp)) return null;
  return R2 ? R2.get(key) : null;
}

/* every night: photos older than 90 days are deleted (the record stays, marked "photos deleted") */
export async function ccPurge(env, R2) {
  if (!R2) return 0;
  const before = new Date(Date.now() - KEEP_DAYS * 864e5).toISOString().slice(0, 10);
  const { results } = await env.DB.prepare("SELECT id, b_key, bt_key, a_key, at_key FROM cc_jobs WHERE purged = 0 AND day < ? LIMIT 400").bind(before).all();
  for (const j of results || []) {
    const keys = [j.b_key, j.bt_key, j.a_key, j.at_key].filter(Boolean);
    if (keys.length) await R2.delete(keys).catch(() => {});
    await env.DB.prepare("UPDATE cc_jobs SET purged = 1 WHERE id = ?").bind(j.id).run();
  }
  return (results || []).length;
}
