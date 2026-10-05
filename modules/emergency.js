/* =====================================================================
   EMERGENCY ALERT — feature module (kept separate so it can be removed cleanly)
   See docs/FEATURE-emergency.md

   A Manager / SMS / Admin presses Emergency, picks the type and writes the
   location. The alert goes ONLY to people who are ON SHIFT at that flagship
   at that moment (from the Operations Schedule):
     · a shift "09:00-17:00" today that covers the current time → receives it
     · OFF, vacation, sick… or a shift that does not cover the time → does not
     · night shifts that run past midnight count from yesterday's cell
   Optionally the flagship's Managers who are not on the schedule that day
   ("on call"), unless the schedule marks them away.

   Every device of every recipient gets an urgent push that stays on screen,
   vibrates SOS and repeats every ~45 s until the person taps "I'm on it".
   Anyone with the hub open gets a full-screen red alert with a siren.
   The sender watches a live board and ends it with "All clear".
   Phone calls (optional): with a voice provider set up (Twilio secrets TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM),
   anyone who has not acknowledged after 60 s gets a real phone call that reads the alert out loud —
   it rings like a normal call, also when the phone is on silent for apps. Called again after 5 minutes (twice at most).
   Without the secrets: the board shows each person's mobile with a one-tap "Call" button.

   Tables : emergencies · emergency_recips
   Routes : /api/ops/emergency/*   Cron: emergencyRun(env, deps)
   ===================================================================== */

const clip = (v, n) => String(v == null ? "" : v).slice(0, n);
const err = (m, status = 400) => Object.assign(new Error(m), { status });
export const TYPES = ["Fire", "Evacuation", "Medical", "Security threat", "Fight / violence", "Lift entrapment", "Flood / water leak",
  "Power outage", "Gas leak", "Suspicious object", "Lost child", "Other"];
const REPEAT_S = 10;          // re-alert people who have not acknowledged — every 10 seconds
const REPEAT_FOR_MIN = 60;    // stop repeating after 60 minutes (the alert stays open until All clear)
const MAX_SENDS = 360;
const LOOP_MS = 10000;        // the pager (a Durable Object alarm) wakes every 10 s while an alert is open

/* worker.js hands over its push + bell helpers once, so the pager can use them */
let DEPS = null;
export function emergencyDeps(d) { DEPS = d; }

/* The pager: one Durable Object that keeps re-alerting every 10 s while any alert is open,
   even when nobody has the hub open. Free on Workers Free (SQLite-backed Durable Object). */
export class EmergencyPager {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }
  async fetch() {
    const at = await this.ctx.storage.getAlarm();
    if (!at) await this.ctx.storage.setAlarm(Date.now() + 1000);
    return new Response("ok");
  }
  async alarm() {
    const open = DEPS ? await emergencyRun(this.env, DEPS, true).catch(() => 1) : 0;
    if (open) await this.ctx.storage.setAlarm(Date.now() + LOOP_MS);
  }
}
export async function startPager(env) {
  if (!env.PAGER) return false;
  try { await env.PAGER.get(env.PAGER.idFromName("pager")).fetch("https://pager/start"); return true; } catch { return false; }
}

export async function emergencySchema(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS emergencies (id INTEGER PRIMARY KEY AUTOINCREMENT, site TEXT NOT NULL, type TEXT NOT NULL,
      location TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'active', managers INTEGER NOT NULL DEFAULT 1,
      created_by TEXT, created_name TEXT, created_at TEXT, closed_at TEXT NOT NULL DEFAULT '', closed_name TEXT NOT NULL DEFAULT '', close_note TEXT NOT NULL DEFAULT '')`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS emergency_recips (emergency_id INTEGER NOT NULL, email TEXT NOT NULL, name TEXT NOT NULL DEFAULT '',
      why TEXT NOT NULL DEFAULT '', devices INTEGER NOT NULL DEFAULT 0, sends INTEGER NOT NULL DEFAULT 0, delivered INTEGER NOT NULL DEFAULT 0,
      first_at TEXT, last_at TEXT, ack_at TEXT NOT NULL DEFAULT '', PRIMARY KEY (emergency_id, email))`)
  ]);
  for (const c of ["mobile TEXT NOT NULL DEFAULT ''", "calls INTEGER NOT NULL DEFAULT 0", "called_at TEXT NOT NULL DEFAULT ''", "call_error TEXT NOT NULL DEFAULT ''"])
    await env.DB.prepare(`ALTER TABLE emergency_recips ADD COLUMN ${c}`).run().catch(() => {});
}

/* ---------- who is on shift right now ---------- */
function beirutNow() {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Beirut", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date()).map(x => [x.type, x.value]));
  const day = `${p.year}-${p.month}-${p.day}`;
  const y = new Date(day + "T12:00:00Z"); y.setUTCDate(y.getUTCDate() - 1);
  return { day, yesterday: y.toISOString().slice(0, 10), minutes: (Number(p.hour) % 24) * 60 + Number(p.minute), hm: `${String(Number(p.hour) % 24).padStart(2, "0")}:${p.minute}` };
}
const toMin = t => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || "").trim()); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
function shiftOf(val) {
  const [a, b] = String(val || "").split("-").map(toMin);
  return a == null || b == null ? null : { a, b };
}
/* returns [{ email, name, why }] for the flagship at this moment */
export async function onShiftNow(env, site, withManagers) {
  const t = beirutNow();
  const [cells, users] = await Promise.all([
    env.DB.prepare("SELECT day, email, val FROM sched_cells WHERE site = ? AND day IN (?, ?)").bind(site, t.day, t.yesterday).all(),
    env.DB.prepare("SELECT email, full_name, role, site_code FROM users WHERE active = 1 AND (site_code = ? OR role = 'ADMIN')").bind(site).all()
  ]);
  const U = new Map((users.results || []).map(u => [u.email, u]));
  const today = new Map(), out = new Map();
  for (const c of cells.results || []) {
    const s = shiftOf(c.val), u = U.get(c.email);
    if (c.day === t.day) today.set(c.email, c.val);
    if (!s || !u) continue;
    const night = s.b <= s.a;                      // e.g. 22:00-07:00 runs past midnight
    const on = c.day === t.day ? (night ? t.minutes >= s.a : t.minutes >= s.a && t.minutes < s.b)
                               : (night && t.minutes < s.b);
    if (on) out.set(c.email, { email: c.email, name: u.full_name, why: `On shift ${c.val}${c.day === t.yesterday ? " (since yesterday)" : ""}` });
  }
  if (withManagers) for (const u of U.values()) {
    if (u.role !== "MANAGER" || u.site_code !== site || out.has(u.email)) continue;
    const v = today.get(u.email);
    if (v) continue;                                // on the schedule today: off / away, or a shift that does not cover now
    out.set(u.email, { email: u.email, name: u.full_name, why: "Flagship manager · on call" });
  }
  return { at: t.hm, list: [...out.values()].sort((a, b) => a.name.localeCompare(b.name)) };
}

/* ---------- phone calls (optional voice provider) ---------- */
const CALL_AFTER_S = 60, CALL_AGAIN_S = 300, MAX_CALLS = 2;
export const callsReady = env => !!(env.TWILIO_SID && env.TWILIO_TOKEN && env.TWILIO_FROM);
/* Lebanese numbers: 03 123 456 · 71-123456 · 00961… · +961… → +9613123456 */
export function e164(m) {
  let d = String(m || "").replace(/[^\d+]/g, "");
  if (!d) return "";
  if (d.startsWith("+")) return /^\+\d{8,15}$/.test(d) ? d : "";
  if (d.startsWith("00")) return "+" + d.slice(2);
  if (d.startsWith("961")) return "+" + d;
  if (d.startsWith("0")) d = d.slice(1);
  return d.length >= 7 && d.length <= 8 ? "+961" + d : "";
}
const xml = s => String(s).replace(/[<>&"']/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c]));
async function placeCall(env, to, e, siteName) {
  const say = `Emergency at ${siteName || e.site}. ${e.type}. ${e.location}. ${e.note || ""} Open the ABC Operations Hub and tap I am on it.`;
  const twiml = `<Response><Pause length="1"/><Say voice="alice" language="en-GB" loop="3">${xml(say)}</Say></Response>`;
  const body = new URLSearchParams({ To: to, From: env.TWILIO_FROM, Twiml: twiml, Timeout: "40" });
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_SID}/Calls.json`, { method: "POST", body,
    headers: { authorization: "Basic " + btoa(`${env.TWILIO_SID}:${env.TWILIO_TOKEN}`), "content-type": "application/x-www-form-urlencoded" } });
  if (r.ok) return { ok: true };
  let j = {}; try { j = await r.json(); } catch {}
  return { ok: false, error: String(j.message || r.status).slice(0, 200) };
}
async function callRound(env, deps, e) {
  if (!callsReady(env)) return;
  const now = Date.now();
  if (now - new Date(e.created_at).getTime() > REPEAT_FOR_MIN * 60e3) return;   // same window as the repeating alarm
  const { results } = await env.DB.prepare("SELECT * FROM emergency_recips WHERE emergency_id = ? AND ack_at = '' AND mobile != '' AND calls < ?").bind(e.id, MAX_CALLS).all();
  for (const r of results || []) {
    if (now - new Date(r.first_at).getTime() < CALL_AFTER_S * 1000) continue;
    if (r.called_at && now - new Date(r.called_at).getTime() < CALL_AGAIN_S * 1000) continue;
    const to = e164(r.mobile); if (!to) continue;
    /* claim first, so two pager runs never call twice */
    const claim = await env.DB.prepare("UPDATE emergency_recips SET calls = calls + 1, called_at = ? WHERE emergency_id = ? AND email = ? AND calls = ?").bind(deps.now(), e.id, r.email, r.calls).run();
    if (!claim.meta || claim.meta.changes !== 1) continue;
    const res = await placeCall(env, to, e, deps.siteName ? deps.siteName(e.site) : "").catch(x => ({ ok: false, error: String(x.message || x) }));
    if (!res.ok) await env.DB.prepare("UPDATE emergency_recips SET call_error = ? WHERE emergency_id = ? AND email = ?").bind(res.error, e.id, r.email).run();
  }
}

/* ---------- sending ---------- */
const SOS = [300, 120, 300, 120, 300, 360, 700, 160, 700, 160, 700, 360, 300, 120, 300, 120, 300];
function payload(e, repeat) {
  /* a new tag each time = a brand-new notification, so the phone sounds and vibrates again (the old one is replaced by the service worker) */
  return { title: `🚨 EMERGENCY · ${e.type}${repeat ? ` · ${repeat + 1}` : ""}`, body: `${e.location}${e.note ? ` — ${e.note}` : ""}\nTap “I'm on it” to stop the alarm.`,
    tone: "alert", tag: `emg-${e.id}-${repeat}`, url: `/tools/emergency?id=${e.id}`, ttl: 60, emergency: { id: e.id, type: e.type, location: e.location, vibrate: SOS, seq: repeat } };
}
async function pushTo(env, deps, email, msg) {
  const { results } = await env.DB.prepare("SELECT * FROM push_subs WHERE email = ?").bind(email).all();
  let ok = 0;
  for (const s of results || []) { const r = await deps.sendPush(env, s, msg); if (r && r.ok) ok++; }
  return { devices: (results || []).length, ok };
}
/* alert everyone due: new people now on shift, and anyone not yet acknowledged whose last alert is older than REPEAT_S */
async function alertRound(env, deps, e, force) {
  const now = Date.now(), iso = deps.now();
  const { list } = await onShiftNow(env, e.site, !!e.managers);
  const { results } = await env.DB.prepare("SELECT * FROM emergency_recips WHERE emergency_id = ?").bind(e.id).all();
  const have = new Map((results || []).map(r => [r.email, r]));
  const repeating = now - new Date(e.created_at).getTime() < REPEAT_FOR_MIN * 60e3;
  let sent = 0;
  for (const p of list) {
    if (p.email === e.created_by) continue;
    const r = have.get(p.email);
    if (!r) {
      const res = await pushTo(env, deps, p.email, payload(e, 0));
      const mob = await env.DB.prepare("SELECT mobile FROM users WHERE email = ?").bind(p.email).first().catch(() => null);
      await env.DB.prepare(`INSERT OR IGNORE INTO emergency_recips (emergency_id, email, name, why, devices, sends, delivered, first_at, last_at, mobile) VALUES (?,?,?,?,?,1,?,?,?,?)`)
        .bind(e.id, p.email, p.name, p.why, res.devices, res.ok, iso, iso, (mob && mob.mobile) || "").run();
      await deps.raiseEvent(env, { site: e.site, app: "emergency", email: p.email, tone: "alert", title: `EMERGENCY · ${e.type}`, body: `${e.location} · sent by ${e.created_name}` });
      sent++;
    }
  }
  for (const r of results || []) {
    if (r.ack_at || r.sends >= MAX_SENDS) continue;
    if (!list.some(p => p.email === r.email)) continue;     // their shift ended — stop calling them
    if (!force && (!repeating || now - new Date(r.last_at).getTime() < REPEAT_S * 1000)) continue;
    const res = await pushTo(env, deps, r.email, payload(e, r.sends));
    await env.DB.prepare("UPDATE emergency_recips SET sends = sends + 1, delivered = delivered + ?, devices = ?, last_at = ? WHERE emergency_id = ? AND email = ?")
      .bind(res.ok, res.devices, iso, e.id, r.email).run();
    sent++;
  }
  return sent;
}

/* cron (every 2 minutes) — keeps repeating even if the sender closed the board */
export async function emergencyRun(env, deps, fromPager) {
  const { results } = await env.DB.prepare("SELECT * FROM emergencies WHERE status = 'active'").all();
  for (const e of results || []) { await alertRound(env, deps, e, false); await callRound(env, deps, e).catch(() => {}); }
  if ((results || []).length && !fromPager) await startPager(env);   // the cron also restarts the pager if it ever stopped
  return (results || []).length;
}

async function board(env, e) {
  const { results } = await env.DB.prepare("SELECT * FROM emergency_recips WHERE emergency_id = ? ORDER BY (ack_at = '') DESC, name").bind(e.id).all();
  return { emergency: out(e), recipients: (results || []).map(r => ({ email: r.email, name: r.name, why: r.why, devices: r.devices,
    sends: r.sends, delivered: r.delivered, firstAt: r.first_at, lastAt: r.last_at, ackAt: r.ack_at, mobile: r.mobile || "", tel: e164(r.mobile),
    calls: r.calls || 0, calledAt: r.called_at || "", callError: r.call_error || "" })), phoneCalls: callsReady(env) };
}
const out = e => ({ id: e.id, site: e.site, type: e.type, location: e.location, note: e.note, status: e.status, managers: !!e.managers,
  createdBy: e.created_by, createdName: e.created_name, createdAt: e.created_at, closedAt: e.closed_at, closedName: e.closed_name, closeNote: e.close_note });

/* ctx = { site, can, me, now, raiseEvent, sendPush, siteName } — can.emergency = may send */
export async function emergencyRoute(env, p, method, b, url, ctx) {
  const { site, can, me, now } = ctx;
  const q = k => url.searchParams.get(k);
  const deps = { now, raiseEvent: ctx.raiseEvent, sendPush: ctx.sendPush };
  const byId = async id => {
    const e = await env.DB.prepare("SELECT * FROM emergencies WHERE id = ?").bind(Number(id)).first();
    if (!e) throw err("This alert no longer exists", 404);
    if (!(ctx.canSite ? ctx.canSite(e.site) : me.role === "ADMIN" || me.site_code === e.site)) {
      const mine = await env.DB.prepare("SELECT 1 AS x FROM emergency_recips WHERE emergency_id = ? AND email = ?").bind(e.id, me.email).first();
      if (!mine) throw err("This alert is for another flagship", 403);
    }
    return e;
  };

  /* for the hub shell: an alert I still have to acknowledge, and (for leads) the flagship's open alerts */
  if (p === "emergency/active") {
    const [mine, open] = await Promise.all([
      env.DB.prepare(`SELECT e.* FROM emergencies e JOIN emergency_recips r ON r.emergency_id = e.id
        WHERE e.status = 'active' AND r.email = ? AND r.ack_at = '' ORDER BY e.id DESC LIMIT 3`).bind(me.email).all(),
      can.emergency && (ctx.sites || []).length ? env.DB.prepare(`SELECT * FROM emergencies WHERE status = 'active' AND site IN (${ctx.sites.map(() => "?").join(",")}) ORDER BY id DESC LIMIT 5`)
        .bind(...ctx.sites).all() : { results: [] }
    ]);
    return { alerts: (mine.results || []).map(out), open: (open.results || []).map(out) };
  }
  if (p === "emergency/meta") {
    return { types: TYPES, can: { send: !!can.emergency }, site, phoneCalls: callsReady(env) };
  }
  if (p === "emergency/preview") {
    if (!can.emergency) throw err("Only managers, the senior mall supervisor and administrators can send an emergency alert", 403);
    const r = await onShiftNow(env, site, q("managers") !== "0");
    const list = r.list.filter(x => x.email !== me.email);
    const devs = list.length ? await env.DB.prepare(`SELECT email, COUNT(*) AS n FROM push_subs WHERE email IN (${list.map(() => "?").join(",")}) GROUP BY email`)
      .bind(...list.map(x => x.email)).all() : { results: [] };
    const dm = new Map((devs.results || []).map(d => [d.email, d.n]));
    return { at: r.at, recipients: list.map(x => ({ ...x, devices: Number(dm.get(x.email) || 0) })) };
  }
  if (p === "emergency/send" && method === "POST") {
    if (!can.emergency) throw err("Only managers, the senior mall supervisor and administrators can send an emergency alert", 403);
    const type = TYPES.includes(b.type) ? b.type : "";
    const location = clip(String(b.location || "").trim(), 160);
    if (!type) throw err("Choose the type of emergency");
    if (!location) throw err("Write the location");
    const r = await env.DB.prepare(`INSERT INTO emergencies (site, type, location, note, status, managers, created_by, created_name, created_at)
      VALUES (?,?,?,?, 'active', ?,?,?,?)`).bind(site, type, location, clip(String(b.note || "").trim(), 300), b.managers === false ? 0 : 1, me.email, me.full_name, now()).run();
    const e = await env.DB.prepare("SELECT * FROM emergencies WHERE id = ?").bind(r.meta.last_row_id).first();
    await alertRound(env, deps, e, false);
    await startPager(env);
    return board(env, e);
  }
  if (p === "emergency/get") return board(env, await byId(q("id")));
  if (p === "emergency/list") {
    const { results } = await env.DB.prepare(`SELECT e.*, (SELECT COUNT(*) FROM emergency_recips r WHERE r.emergency_id = e.id) AS n,
      (SELECT COUNT(*) FROM emergency_recips r WHERE r.emergency_id = e.id AND r.ack_at != '') AS acked FROM emergencies e WHERE site = ? ORDER BY id DESC LIMIT 60`).bind(site).all();
    return { list: (results || []).map(e => ({ ...out(e), recipients: e.n, acked: e.acked })) };
  }
  /* the board polls this every 20 s while it is open — re-alerts anyone who has not acknowledged */
  if (p === "emergency/tick" && method === "POST") {
    const e = await byId(b.id);
    if (e.status === "active") await alertRound(env, deps, e, false);
    return board(env, e);
  }
  if (p === "emergency/realert" && method === "POST") {
    if (!can.emergency) throw err("Only the sender's team can re-alert", 403);
    const e = await byId(b.id);
    if (e.status !== "active") throw err("This alert is closed");
    await alertRound(env, deps, e, true);
    return board(env, e);
  }
  if (p === "emergency/ack" && method === "POST") {
    const e = await byId(b.id);
    const at = now();
    const r = await env.DB.prepare("UPDATE emergency_recips SET ack_at = ? WHERE emergency_id = ? AND email = ? AND ack_at = ''").bind(at, e.id, me.email).run();
    if (!r.meta || !r.meta.changes) {
      await env.DB.prepare(`INSERT OR IGNORE INTO emergency_recips (emergency_id, email, name, why, first_at, last_at, ack_at) VALUES (?,?,?,?,?,?,?)`)
        .bind(e.id, me.email, me.full_name, "Joined from the hub", at, at, at).run();
    }
    return { acknowledged: true, at };
  }
  if (p === "emergency/close" && method === "POST") {
    if (!can.emergency) throw err("Only managers, the senior mall supervisor and administrators can end an alert", 403);
    const e = await byId(b.id);
    if (e.status !== "active") return board(env, e);
    const note = clip(String(b.note || "").trim(), 300);
    await env.DB.prepare("UPDATE emergencies SET status = 'closed', closed_at = ?, closed_name = ?, close_note = ? WHERE id = ?").bind(now(), me.full_name, note, e.id).run();
    const { results } = await env.DB.prepare("SELECT email FROM emergency_recips WHERE emergency_id = ?").bind(e.id).all();
    for (const r of results || []) {
      await pushTo(env, deps, r.email, { title: `✅ ALL CLEAR · ${e.type}`, body: `${e.location}${note ? ` — ${note}` : ""} · ${me.full_name}`, tone: "ok", tag: `emg-${e.id}-clear`, url: `/tools/emergency?id=${e.id}`, ttl: 3600, allClear: { id: e.id } });
      await deps.raiseEvent(env, { site: e.site, app: "emergency", email: r.email, tone: "ok", title: `All clear · ${e.type}`, body: `${e.location} · ${me.full_name}` });
    }
    return board(env, await env.DB.prepare("SELECT * FROM emergencies WHERE id = ?").bind(e.id).first());
  }
  throw err("Unknown endpoint", 404);
}
