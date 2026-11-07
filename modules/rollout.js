/* =====================================================================
   HUB TRAINING & ROLLOUT (Nov 2026) — docs/FEATURE-rollout.md · Routes: /api/ro/*
   The rollout plan of the hub: 4 phases (Transition · Internal ABC systems · Advanced modules · Handover).
   Each phase: dates From–To, status, notes, its sessions (day, time, format, audience, link) and the modules it covers.
   Attendees are real hub accounts:
     · audience "champions"  → the champions the Admin picks (meta ro:champions)
     · audience "ops"        → every active operations account (MM, OM, SMS, MS, MO), new accounts join by themselves
     · audience "custom"     → only the people added by hand
   plus people added / removed per session (ro_att.state). "Account set up" = signed in and first password changed.
   Reminders (cron): email to the attendees the day before (same time) and 1 hour before; changing the date / time re-arms them.
   Admin edits everything; everyone else in the hub sees the plan (read only).
   ===================================================================== */
const err = (m, s = 400) => Object.assign(new Error(m), { status: s });
const clip = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
const isDay = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) && !isNaN(Date.parse(s));
const isTime = s => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s || ""));
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const FROM = "salaachi@abc.com.lb";
const STATUS = ["plan", "next", "live", "done"];
const FORMATS = ["Online", "On site", "Meeting"];
const AUDIENCES = { champions: "Hub Champions", ops: "Operations Team", custom: "Chosen people" };
const OPS_KEYS = ["MM", "OM", "SMS", "MS", "MO"];

/* the plan as sent to Sleiman (7 Nov 2026) — loaded once */
const SEED = [
  { name: "Phase 1", title: "Transition from current systems", icon: "🔁", color: "#4A1D6E", from: "2026-11-09", to: "2026-11-12", status: "next",
    sessions: [{ name: "Session 1 – Champions training & account setup", day: "2026-11-09", time: "10:00", fmt: "Online", audience: "champions" },
      { name: "Session 2 – Operations team training & account setup", day: "2026-11-12", time: "10:00", fmt: "Online", audience: "ops" }],
    mods: ["Restroom Inspections", "AM/PM Checklist", "Tenant Feedback", "Operations Schedule", "Tenant Announcement", "Direct Banking", "CRM & Handhelds", "Minutes of Meeting", "Malfunction Records", "Operations Timeline"] },
  { name: "Phase 2", title: "Internal ABC systems", icon: "🏢", color: "#2E6B5E", from: "2026-11-16", to: "2026-11-20", status: "plan",
    sessions: [{ name: "Internal ABC systems, property & tenant management", day: "2026-11-16", time: "10:00", fmt: "Online", audience: "ops" }],
    mods: ["ABC Connect", "JDE", "QR Code Access and Approval", "Loading Area HH system", "Cleaner QR Code", "Incident Report", "GLA management", "Property Overview", "Mall Layouts", "Key Box",
      "Budget CAPEX & OPEX", "Tenant 360", "Tenant Compliance Reports", "Fit-out tracker", "Contracts near Termination", "Tenant Works Forms", "Tenant List"] },
  { name: "Phase 3", title: "Advanced modules", icon: "🚀", color: "#9A5B13", from: "2026-11-23", to: "2026-11-27", status: "plan",
    sessions: [{ name: "Advanced modules", day: "2026-11-23", time: "10:00", fmt: "Online", audience: "ops" }],
    mods: ["Tenant reports", "Hub internal tools", "Marketing campaigns", "Preventive maintenance", "NEW Memos", "NEW Cleaner Schedule and Tracker"] },
  { name: "Final phase", title: "Handover", icon: "🤝", color: "#1F5A96", from: "2026-11-30", to: "2026-12-04", status: "plan",
    sessions: [{ name: "IT system handover", day: "2026-11-30", time: "10:00", fmt: "Meeting", audience: "custom" }],
    mods: ["IT system handover", "Completion of the user E-Book for all end users"] }
];

export async function roSchema(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS ro_phases (id INTEGER PRIMARY KEY AUTOINCREMENT, seq INTEGER NOT NULL DEFAULT 0, name TEXT NOT NULL, title TEXT NOT NULL DEFAULT '',
      icon TEXT NOT NULL DEFAULT '', color TEXT NOT NULL DEFAULT '', date_from TEXT NOT NULL DEFAULT '', date_to TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'plan',
      notes TEXT NOT NULL DEFAULT '', updated_by TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '')`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS ro_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, phase_id INTEGER NOT NULL, seq INTEGER NOT NULL DEFAULT 0, name TEXT NOT NULL,
      day TEXT NOT NULL DEFAULT '', time TEXT NOT NULL DEFAULT '', fmt TEXT NOT NULL DEFAULT 'Online', audience TEXT NOT NULL DEFAULT 'ops', link TEXT NOT NULL DEFAULT '',
      updated_by TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '')`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS ro_att (session_id INTEGER NOT NULL, email TEXT NOT NULL, state TEXT NOT NULL DEFAULT '', attended INTEGER NOT NULL DEFAULT 0,
      at TEXT NOT NULL DEFAULT '', by_name TEXT NOT NULL DEFAULT '', PRIMARY KEY (session_id, email))`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS ro_mods (id INTEGER PRIMARY KEY AUTOINCREMENT, phase_id INTEGER NOT NULL, seq INTEGER NOT NULL DEFAULT 0, name TEXT NOT NULL,
      done INTEGER NOT NULL DEFAULT 0, done_at TEXT NOT NULL DEFAULT '', done_by TEXT NOT NULL DEFAULT '')`)
  ]);
}
async function seedOnce(env) {
  const c = await env.DB.prepare("INSERT OR IGNORE INTO meta (k, v) VALUES ('ro:seeded', ?)").bind(new Date().toISOString()).run().catch(() => null);
  if (!c || !c.meta || c.meta.changes !== 1) return;
  if (await env.DB.prepare("SELECT 1 FROM ro_phases LIMIT 1").first()) return;
  const at = new Date().toISOString();
  for (let i = 0; i < SEED.length; i++) {
    const P = SEED[i];
    const r = await env.DB.prepare("INSERT INTO ro_phases (seq, name, title, icon, color, date_from, date_to, status, updated_by, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .bind(i, P.name, P.title, P.icon, P.color, P.from, P.to, P.status, "Rollout plan", at).run();
    const id = r.meta.last_row_id;
    await env.DB.batch([
      ...P.sessions.map((s, j) => env.DB.prepare("INSERT INTO ro_sessions (phase_id, seq, name, day, time, fmt, audience, updated_by, updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
        .bind(id, j, s.name, s.day, s.time, s.fmt, s.audience, "Rollout plan", at)),
      ...P.mods.map((m, j) => env.DB.prepare("INSERT INTO ro_mods (phase_id, seq, name) VALUES (?,?,?)").bind(id, j, m))]);
  }
}
async function metaJ(env, k, dflt) { const r = await env.DB.prepare("SELECT v FROM meta WHERE k = ?").bind(k).first().catch(() => null); try { return r ? JSON.parse(r.v) : dflt; } catch { return dflt; } }
const metaSet = (env, k, v) => env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)").bind(k, JSON.stringify(v)).run();
const cfgOf = async env => ({ remind: true, ...(await metaJ(env, "ro:cfg", {})) });

/* ---------- people ---------- */
async function people(env, d) {
  const r = await env.DB.prepare("SELECT email, full_name, role, position, site_code, must_change, last_login_at, active FROM users WHERE active = 1 ORDER BY full_name").all();
  return (r.results || []).filter(u => u.role !== "EXTERNAL").map(u => {
    const key = d.posKey(u);
    return { email: u.email, name: u.full_name, key, ops: OPS_KEYS.includes(key) && u.role !== "ADMIN", pos: d.posName(u), site: u.site_code || "", siteName: u.site_code ? d.siteName(u.site_code) : "",
      setup: !!u.last_login_at && !u.must_change, signedIn: !!u.last_login_at };
  });
}
function attendees(s, P, champs, att) {
  const mine = att.filter(a => a.session_id === s.id), st = new Map(mine.map(a => [a.email, a]));
  const base = s.audience === "ops" ? P.filter(p => p.ops).map(p => p.email) : s.audience === "champions" ? champs.filter(e => P.some(p => p.email === e)) : [];
  const set = new Set(base);
  for (const a of mine) { if (a.state === "add") set.add(a.email); if (a.state === "remove") set.delete(a.email); }
  const byEmail = new Map(P.map(p => [p.email, p]));
  return [...set].map(e => byEmail.get(e)).filter(Boolean).map(p => ({ ...p, attended: !!(st.get(p.email) || {}).attended, manual: (st.get(p.email) || {}).state === "add" }))
    .sort((a, b) => (a.siteName || "~").localeCompare(b.siteName || "~") || a.name.localeCompare(b.name));
}
async function plan(env, d) {
  await seedOnce(env);
  const [ph, se, mo, at, P, champs, cfg] = await Promise.all([
    env.DB.prepare("SELECT * FROM ro_phases ORDER BY seq, id").all(), env.DB.prepare("SELECT * FROM ro_sessions ORDER BY day, time, seq, id").all(),
    env.DB.prepare("SELECT * FROM ro_mods ORDER BY seq, id").all(), env.DB.prepare("SELECT * FROM ro_att").all(), people(env, d), metaJ(env, "ro:champions", []), cfgOf(env)]);
  const att = at.results || [];
  const phases = (ph.results || []).map(p => ({
    id: p.id, name: p.name, title: p.title, icon: p.icon, color: p.color, from: p.date_from, to: p.date_to, status: p.status, notes: p.notes, updatedBy: p.updated_by, updatedAt: p.updated_at,
    sessions: (se.results || []).filter(s => s.phase_id === p.id).map(s => ({ id: s.id, name: s.name, day: s.day, time: s.time, fmt: s.fmt, audience: s.audience, link: s.link, people: attendees(s, P, champs, att) })),
    mods: (mo.results || []).filter(m => m.phase_id === p.id).map(m => ({ id: m.id, name: m.name, done: !!m.done, doneAt: m.done_at, doneBy: m.done_by }))
  }));
  return { phases, cfg, champions: champs, audiences: AUDIENCES, formats: FORMATS, today: d.today() };
}

/* ---------- routes ---------- */
export async function roRoute(env, path, method, b, url, d) {
  const admin = d.isAdmin(d.me);
  if (path === "ro/get") {
    const out = await plan(env, d);
    out.canEdit = admin;
    if (admin) out.people = await people(env, d);
    else for (const p of out.phases) for (const s of p.sessions) s.people = s.people.map(x => ({ name: x.name, pos: x.pos, siteName: x.siteName, setup: x.setup, attended: x.attended, email: x.email }));
    return out;
  }
  if (method !== "POST") throw err("Unknown request", 404);
  if (!admin) throw err("Only the Admin changes the rollout plan", 403);
  const by = d.me.full_name || d.me.email, at = new Date().toISOString();
  if (path === "ro/phase") {
    const p = await env.DB.prepare("SELECT * FROM ro_phases WHERE id = ?").bind(Number(b.id) || 0).first(); if (!p) throw err("This phase does not exist", 404);
    const from = b.from != null ? String(b.from) : p.date_from, to = b.to != null ? String(b.to) : p.date_to;
    if ((from && !isDay(from)) || (to && !isDay(to))) throw err("Pick a valid date");
    if (from && to && to < from) throw err("The end date is before the start date");
    const status = b.status != null ? String(b.status) : p.status; if (!STATUS.includes(status)) throw err("Unknown status");
    await env.DB.prepare("UPDATE ro_phases SET date_from = ?, date_to = ?, status = ?, title = ?, notes = ?, updated_by = ?, updated_at = ? WHERE id = ?")
      .bind(from, to, status, b.title != null ? clip(b.title, 120) : p.title, b.notes != null ? clip(b.notes, 4000) : p.notes, by, at, p.id).run();
    return { saved: true };
  }
  if (path === "ro/session") {
    const name = clip(b.name, 160), day = String(b.day || ""), time = String(b.time || "");
    if (!name) throw err("Give the session a name");
    if (day && !isDay(day)) throw err("Pick a valid date");
    if (time && !isTime(time)) throw err("Pick a valid time");
    const fmt = FORMATS.includes(b.fmt) ? b.fmt : "Online", audience = AUDIENCES[b.audience] ? b.audience : "ops", link = clip(b.link, 500);
    if (b.id) {
      const s = await env.DB.prepare("SELECT id FROM ro_sessions WHERE id = ?").bind(Number(b.id)).first(); if (!s) throw err("This session does not exist", 404);
      await env.DB.prepare("UPDATE ro_sessions SET name = ?, day = ?, time = ?, fmt = ?, audience = ?, link = ?, updated_by = ?, updated_at = ? WHERE id = ?").bind(name, day, time, fmt, audience, link, by, at, s.id).run();
      return { saved: true, id: s.id };
    }
    const p = await env.DB.prepare("SELECT id FROM ro_phases WHERE id = ?").bind(Number(b.phase) || 0).first(); if (!p) throw err("This phase does not exist", 404);
    const r = await env.DB.prepare("INSERT INTO ro_sessions (phase_id, seq, name, day, time, fmt, audience, link, updated_by, updated_at) VALUES (?,99,?,?,?,?,?,?,?,?)").bind(p.id, name, day, time, fmt, audience, link, by, at).run();
    return { saved: true, id: r.meta.last_row_id };
  }
  if (path === "ro/session/delete") {
    const id = Number(b.id) || 0;
    await env.DB.batch([env.DB.prepare("DELETE FROM ro_sessions WHERE id = ?").bind(id), env.DB.prepare("DELETE FROM ro_att WHERE session_id = ?").bind(id)]);
    return { deleted: true };
  }
  if (path === "ro/att") {   // attended tick · add / remove a person for one session
    const sid = Number(b.session) || 0, email = String(b.email || "").toLowerCase();
    if (!(await env.DB.prepare("SELECT 1 FROM ro_sessions WHERE id = ?").bind(sid).first())) throw err("This session does not exist", 404);
    if (!(await env.DB.prepare("SELECT 1 FROM users WHERE email = ?").bind(email).first())) throw err("This account does not exist", 404);
    const cur = await env.DB.prepare("SELECT * FROM ro_att WHERE session_id = ? AND email = ?").bind(sid, email).first() || { state: "", attended: 0 };
    const state = b.op === "add" ? "add" : b.op === "remove" ? "remove" : cur.state, attended = b.attended != null ? (b.attended ? 1 : 0) : (b.op === "remove" ? 0 : cur.attended);
    await env.DB.prepare("INSERT OR REPLACE INTO ro_att (session_id, email, state, attended, at, by_name) VALUES (?,?,?,?,?,?)").bind(sid, email, state, attended, at, by).run();
    return { saved: true };
  }
  if (path === "ro/mod") {
    if (b.op === "add") {
      const name = clip(b.name, 120); if (!name) throw err("Write the module name");
      const p = await env.DB.prepare("SELECT id FROM ro_phases WHERE id = ?").bind(Number(b.phase) || 0).first(); if (!p) throw err("This phase does not exist", 404);
      await env.DB.prepare("INSERT INTO ro_mods (phase_id, seq, name) VALUES (?,99,?)").bind(p.id, name).run(); return { saved: true };
    }
    if (b.op === "delete") { await env.DB.prepare("DELETE FROM ro_mods WHERE id = ?").bind(Number(b.id) || 0).run(); return { deleted: true }; }
    const done = b.done ? 1 : 0;
    await env.DB.prepare("UPDATE ro_mods SET done = ?, done_at = ?, done_by = ? WHERE id = ?").bind(done, done ? at : "", done ? by : "", Number(b.id) || 0).run();
    return { saved: true };
  }
  if (path === "ro/champions") {
    const list = [...new Set((Array.isArray(b.emails) ? b.emails : []).map(e => String(e).toLowerCase()))].slice(0, 100);
    await metaSet(env, "ro:champions", list); return { saved: true, champions: list };
  }
  if (path === "ro/cfg") { const c = await cfgOf(env); c.remind = !!b.remind; await metaSet(env, "ro:cfg", c); return { saved: true, cfg: c }; }
  throw err("Unknown request", 404);
}

/* ---------- reminders (cron, every 2 minutes) ---------- */
const beirutParts = (t = new Date()) => { const f = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Beirut", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(t);
  const g = k => (f.find(x => x.type === k) || {}).value; return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`; };
const addMin = (local, m) => { const t = Date.parse(local + ":00Z") + m * 60000; return new Date(t).toISOString().slice(0, 16); };   // works on Beirut "wall time" strings
const fmtWhen = (day, time) => `${new Date(day + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })} at ${time}`;
export async function roRun(env, d) {
  const cfg = await cfgOf(env); if (!cfg.remind) return;
  if (!(await env.DB.prepare("SELECT 1 FROM ro_sessions LIMIT 1").first().catch(() => null))) return;
  const now = beirutParts();
  const S = (await env.DB.prepare("SELECT s.*, p.name AS pname, p.title AS ptitle FROM ro_sessions s JOIN ro_phases p ON p.id = s.phase_id WHERE s.day >= ? AND s.day <= ? AND s.time != ''")
    .bind(now.slice(0, 10), addMin(now, 26 * 60).slice(0, 10)).all()).results || [];
  if (!S.length) return;
  const P = await people(env, d), champs = await metaJ(env, "ro:champions", []), att = (await env.DB.prepare("SELECT * FROM ro_att").all()).results || [];
  for (const s of S) {
    const start = `${s.day}T${s.time}`; if (start <= now) continue;
    for (const [kind, before, label] of [["d1", 24 * 60, "tomorrow"], ["h1", 60, "in 1 hour"]]) {
      if (now < addMin(start, -before)) continue;
      if (kind === "d1" && now >= addMin(start, -60)) continue;   // too late for "tomorrow" — the 1-hour reminder will go
      const claim = await env.DB.prepare("INSERT OR IGNORE INTO meta (k, v) VALUES (?, ?)").bind(`ro:rem:${s.id}:${kind}:${start}`, new Date().toISOString()).run().catch(() => null);
      if (!claim || !claim.meta || claim.meta.changes !== 1) continue;
      const to = attendees(s, P, champs, att).map(p => p.email); if (!to.length) continue;
      const html = `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#1E1530;max-width:560px">
        <p style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#7B4FB0;font-weight:700;margin:0 0 6px">ABC Property Hub · Training ${label}</p>
        <h2 style="margin:0 0 4px;font-size:18px">${esc(s.name)}</h2><p style="margin:0 0 12px;color:#6B6478">${esc(s.pname)} – ${esc(s.ptitle)}</p>
        <table style="border-collapse:collapse;font-size:14px"><tr><td style="padding:4px 12px 4px 0;color:#6B6478">When</td><td><b>${esc(fmtWhen(s.day, s.time))}</b> (Beirut time)</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#6B6478">Format</td><td>${esc(s.fmt)}</td></tr>
        ${s.link ? `<tr><td style="padding:4px 12px 4px 0;color:#6B6478">${s.fmt === "Online" ? "Join" : "Where"}</td><td>${/^https?:\/\//.test(s.link) ? `<a href="${esc(s.link)}">${esc(s.link)}</a>` : esc(s.link)}</td></tr>` : ""}</table>
        <p style="margin:14px 0 0">Please have your hub account ready: <a href="${esc(d.hubUrl)}">${esc(d.hubUrl.replace(/^https:\/\//, "").replace(/\/$/, ""))}</a></p>
        <p style="margin:12px 0 0;color:#6B6478;font-size:12px">The full plan: Hub → Hub Applications → Hub Training &amp; Rollout.</p></div>`;
      await d.outlookSend(env, { from: FROM, to: [], bcc: to, subject: `Hub training ${label}: ${s.name} — ${fmtWhen(s.day, s.time)}`, html })
        .catch(e => console.error("rollout reminder", e && e.message));
    }
  }
}
