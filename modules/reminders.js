/* =====================================================================
   REMINDERS — feature module (kept separate so it can be removed cleanly)
   See docs/FEATURE-reminders.md

   A lead picks the reminders a flagship needs (time, repeat, days).
   Every 2 minutes the hub checks each reminder that is due:
     · the task is done      → nothing is sent
     · the task is pending   → bell + push to EVERYONE at that flagship
       (no link to the Schedule — shift or off day does not matter)

   Tables : reminders · reminder_runs · reminder_done
   Routes : /api/ops/reminders/*   (all require a hub sign-in)
   Cron   : remindersRun(env, deps) — called from scheduled() in worker.js
   ===================================================================== */

const clip = (v, n) => String(v == null ? "" : v).slice(0, n);
const err = (m, status = 400) => Object.assign(new Error(m), { status });
const isHM = v => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v || ""));
const toMin = hm => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
const toHM = m => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const GRACE_MIN = 20;          // a slot missed by a late cron run still fires within 20 minutes
const MAX_SLOTS = 48;

/* Restroom inspection windows (same as the Restroom system) */
const WINDOWS = {
  W1: { label: "Window 1", from: "10:00", to: "11:00" },
  W2: { label: "Window 2", from: "12:30", to: "13:30" },
  W3: { label: "Window 3", from: "14:30", to: "15:30" },
  W4: { label: "Window 4", from: "16:30", to: "17:30" },
  W5: { label: "Window 5", from: "18:30", to: "19:30" },
  W6: { label: "Window 6", from: "20:30", to: "21:30" }
};
/* Earlier window end times — saved restroom reminders still on those defaults move to the current windows */
const OLD_WINDOWS = [
  { W1: "11:00", W2: "13:00", W3: "15:00", W4: "17:00", W5: "19:00", W6: "21:00" },   // until 1 Oct 2026
  { W1: "11:30", W2: "13:30", W3: "15:30", W4: "17:30", W5: "19:30", W6: "22:00" }    // short-lived draft, 1 Oct 2026
];
const TEAMS = { both: "Operations & Soft services", ops: "Operations", usm: "Soft services" };
const SHIFTS = { AM: "AM", MID: "Mid", PM: "PM", NIGHT: "Night" };   // handover shifts (each flagship ticks its own in Shift Handover → Settings)
const FORM_NAMES = { am: "AM Checklist", pm: "PM Checklist", dbank: "Direct Banking Checklist", open: "Tenant Opening Checklist", close: "Tenant Closing Checklist" };

/* The checks the hub knows how to verify. `source` says where the answer comes from. */
export const KINDS = {
  restroom:  { label: "Restroom inspections", source: "Restroom system", hint: "Pending while any restroom has no inspection logged for the window." },
  handover:  { label: "Shift handover", source: "Shift Handover", hint: "Submitted: the handover for the shift is submitted. Received: the next shift acknowledged it." },
  mom:       { label: "Overdue MOM tasks", source: "Minutes of Meeting", hint: "Pending while any published meeting task at the flagship is past its deadline." },
  pir:       { label: "Post-incident reports", source: "Incident Report System", hint: "Pending while any Level 2/3 incident is waiting for its report (overdue only, or all)." },
  sitevisit: { label: "Site visit points", source: "Snaglist Manager", hint: "Pending while a site visit has open points for longer than the days you set." },
  form:      { label: "Checklist submitted", source: "Operations Forms", hint: "Pending until the checklist is submitted — today (AM / PM) or since Monday (weekly Direct Banking)." },
  custom:    { label: "Custom task", source: "Marked done in the hub", hint: "Anyone at the flagship taps Done in Reminders. Until then it counts as pending." }
};

/* Recommended set — offered as a pick list the first time (and any time later) */
export const PRESETS = [
  ...Object.entries(WINDOWS).map(([w, x]) => ({ key: `rr-${w}`, kind: "restroom", title: `Restroom inspections — ${x.label}`,
    params: { window: w, team: "both" }, at: toHM(toMin(x.to) - 15), every: 5, until: x.to })),
  { key: "ho-am", kind: "handover", title: "Morning handover submitted", params: { shift: "AM", stage: "submitted" }, at: "15:30", every: 15, until: "16:30" },
  { key: "ho-am-r", kind: "handover", title: "Morning handover received", params: { shift: "AM", stage: "received" }, at: "16:30", every: 15, until: "17:30" },
  { key: "ho-pm", kind: "handover", title: "Evening handover submitted", params: { shift: "PM", stage: "submitted" }, at: "22:00", every: 15, until: "23:00" },
  { key: "mom", kind: "mom", title: "Overdue meeting tasks", params: {}, at: "10:00", every: 0, until: "" },
  { key: "pir", kind: "pir", title: "Post-incident reports overdue", params: { overdueOnly: true }, at: "11:00", every: 0, until: "" },
  { key: "sv", kind: "sitevisit", title: "Site visit points open over 2 days", params: { days: 2 }, at: "12:00", every: 0, until: "" },
  { key: "f-am", kind: "form", title: "AM Checklist submitted", params: { form: "am", period: "day" }, at: "11:30", every: 15, until: "12:30" },
  { key: "f-pm", kind: "form", title: "PM Checklist submitted", params: { form: "pm", period: "day" }, at: "23:00", every: 15, until: "23:45" },
  { key: "f-db", kind: "form", title: "Weekly Direct Banking inspection", params: { form: "dbank", period: "week" }, at: "18:00", every: 60, until: "21:00", days: "6" },
  { key: "open-round", kind: "custom", title: "Opening round — tenants open on time", params: {}, at: "10:15", every: 15, until: "11:00" },
  { key: "close-round", kind: "custom", title: "Closing round — tenants closed on time", params: {}, at: "22:15", every: 15, until: "23:00" }
];

export async function remindersSchema(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS reminders (id INTEGER PRIMARY KEY AUTOINCREMENT, site TEXT NOT NULL, kind TEXT NOT NULL,
      title TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', at_time TEXT NOT NULL, every_min INTEGER NOT NULL DEFAULT 0,
      until_time TEXT NOT NULL DEFAULT '', days TEXT NOT NULL DEFAULT '1234567', params TEXT NOT NULL DEFAULT '{}',
      preset TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1, created_by TEXT, created_name TEXT, created_at TEXT, updated_at TEXT)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS reminder_runs (reminder_id INTEGER NOT NULL, site TEXT NOT NULL, day TEXT NOT NULL, slot TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'checking', detail TEXT NOT NULL DEFAULT '', pushed INTEGER NOT NULL DEFAULT 0, at TEXT,
      PRIMARY KEY (reminder_id, day, slot))`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS reminder_done (reminder_id INTEGER NOT NULL, day TEXT NOT NULL, by_email TEXT, by_name TEXT, at TEXT,
      PRIMARY KEY (reminder_id, day))`)
  ]);
  /* restroom windows changed (Oct 2026): move reminders that still use the old default times; edited ones are left alone */
  await env.DB.batch(OLD_WINDOWS.flatMap(set => Object.entries(set)).filter(([w, to]) => WINDOWS[w] && WINDOWS[w].to !== to).map(([w, to]) => env.DB.prepare(
    "UPDATE reminders SET at_time = ?, until_time = ? WHERE kind = 'restroom' AND preset = ? AND at_time = ? AND until_time = ?")
    .bind(toHM(toMin(WINDOWS[w].to) - 15), WINDOWS[w].to, `rr-${w}`, toHM(toMin(to) - 15), to))).catch(() => {});
}

/* ---------- Beirut clock ---------- */
function beirutNow() {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Beirut", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false }).formatToParts(new Date()).map(x => [x.type, x.value]));
  const dow = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[p.weekday] || 1;
  return { day: `${p.year}-${p.month}-${p.day}`, minutes: (Number(p.hour) % 24) * 60 + Number(p.minute), dow };
}
function slotsOf(r) {
  const start = toMin(r.at_time), out = [r.at_time];
  if (r.every_min > 0 && isHM(r.until_time)) {
    const end = toMin(r.until_time);
    for (let m = start + r.every_min; m <= end && out.length < MAX_SLOTS; m += r.every_min) out.push(toHM(m));
  }
  return out;
}

/* ---------- cleaning what a lead saves ---------- */
function cleanParams(kind, p = {}) {
  if (kind === "restroom") {
    if (!WINDOWS[p.window]) throw err("Choose the inspection window");
    return { window: p.window, team: TEAMS[p.team] ? p.team : "both" };
  }
  if (kind === "handover") return { shift: SHIFTS[p.shift] ? p.shift : "AM", stage: p.stage === "received" ? "received" : "submitted" };
  if (kind === "pir") return { overdueOnly: p.overdueOnly !== false };
  if (kind === "form") return { form: ["am", "pm", "dbank"].includes(p.form) ? p.form : "am", period: p.period === "week" ? "week" : "day" };
  if (kind === "sitevisit") return { days: Math.max(0, Math.min(60, Math.round(Number(p.days) || 0))) };
  return {};
}
function cleanReminder(b) {
  const kind = KINDS[b.kind] ? b.kind : "";
  if (!kind) throw err("Choose what the reminder checks");
  const title = clip(String(b.title || "").trim(), 120);
  if (!title) throw err("Give the reminder a name");
  if (!isHM(b.at)) throw err("Set the time of the first reminder");
  const every = [0, 5, 10, 15, 20, 30, 45, 60, 90, 120].includes(Number(b.every)) ? Number(b.every) : 0;
  const until = every && isHM(b.until) ? b.until : "";
  if (every && !until) throw err("Set the time the repeats stop");
  if (every && toMin(until) <= toMin(b.at)) throw err("The repeats must stop after the first reminder");
  const days = [...new Set(String(b.days || "").split("").filter(c => "1234567".includes(c)))].sort().join("");
  if (!days) throw err("Choose at least one day");
  return { kind, title, note: clip(String(b.note || "").trim(), 300), at: b.at, every, until, days, params: cleanParams(kind, b.params || {}) };
}

/* ---------- is the task done? ---------- */
/* Returns { state: 'done' | 'pending' | 'error', detail } — never throws. */
async function evaluate(env, r, day, deps, cache) {
  const p = JSON.parse(r.params || "{}");
  const pull = (id) => {
    const k = `${id}|${r.site}|${day}`;
    if (!cache.has(k)) cache.set(k, deps.pullDay(env, id, r.site, day).catch(e => ({ error: String(e && e.message || e) })));
    return cache.get(k);
  };
  try {
    if (r.kind === "custom") {
      const d = await env.DB.prepare("SELECT by_name, at FROM reminder_done WHERE reminder_id = ? AND day = ?").bind(r.id, day).first();
      return d ? { state: "done", detail: `Marked done by ${d.by_name || "a colleague"}` } : { state: "pending", detail: "Not marked done yet" };
    }
    if (r.kind === "restroom") {
      const d = await pull("restroom");
      if (!d || d.error) return { state: "error", detail: `Restroom system: ${(d && d.error) || "no answer"}` };
      const roles = p.team === "both" ? ["ops", "usm"] : [p.team];
      const missing = [];
      for (const room of d.rooms || []) {
        const cell = (d.grid || {})[`${room.id}|${p.window}`] || {};
        const gaps = roles.filter(x => !cell[x]);
        if (gaps.length) missing.push(room.name + (roles.length > 1 && gaps.length === 1 ? ` (${gaps[0] === "ops" ? "Ops" : "Soft services"})` : ""));
      }
      if (!(d.rooms || []).length) return { state: "error", detail: "No restrooms are set up for this flagship" };
      return missing.length
        ? { state: "pending", detail: `${missing.length} of ${d.rooms.length} not inspected: ${missing.join(", ")}` }
        : { state: "done", detail: `All ${d.rooms.length} restrooms inspected` };
    }
    if (r.kind === "handover") {
      /* one shared handover per day: each hand-off is logged; morning = handed over before 17:00 Beirut, evening = after */
      const { results } = await env.DB.prepare("SELECT status, received_by, created_name, submitted_at, shift, handoffs FROM handovers WHERE site = ? AND day = ?")
        .bind(r.site, day).all();
      const bh = at => Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Beirut", hour: "2-digit", hour12: false }).format(new Date(at))) % 24;
      const offs = [];
      for (const h of results || []) {
        const L = JSON.parse(h.handoffs || "[]");
        if (L.length) L.forEach(x => offs.push({ ...x, shift: x.shift || (bh(x.at) >= 5 && bh(x.at) < 17 ? "AM" : "PM") }));   // older hand-offs: by the clock
        else if (h.status === "submitted") offs.push({ by: h.created_name, at: h.submitted_at, receivedBy: h.received_by, shift: h.shift === "PM" ? "PM" : "AM" });
      }
      const sub = offs.filter(x => x.shift === p.shift);
      const name = `${SHIFTS[p.shift]} handover`;
      if (!sub.length) return { state: "pending", detail: (results || []).length ? `${name} not handed over yet` : `Today's handover not started` };
      if (p.stage === "submitted") return { state: "done", detail: `Handed over by ${sub[sub.length - 1].by || "—"}` };
      const got = sub.find(x => x.receivedBy);
      return got ? { state: "done", detail: `Received by ${got.receivedBy}` } : { state: "pending", detail: `${name} handed over but not received yet` };
    }
    if (r.kind === "form") {
      let since = day;
      if (p.period === "week") { const d = new Date(day + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); since = d.toISOString().slice(0, 10); }
      const f = await env.DB.prepare(`SELECT submitted_name, issues FROM form_runs WHERE site = ? AND form = ? AND status = 'submitted' AND day >= ? AND day <= ?
        ORDER BY submitted_at DESC LIMIT 1`).bind(r.site, p.form, since, day).first();
      const name = FORM_NAMES[p.form] || "Checklist";
      if (f) return { state: "done", detail: `${name} submitted by ${f.submitted_name}${f.issues ? ` · ${f.issues} issue${f.issues === 1 ? "" : "s"}` : ""}` };
      const draft = await env.DB.prepare("SELECT done, total FROM form_runs WHERE site = ? AND form = ? AND day >= ? AND day <= ? ORDER BY id DESC LIMIT 1")
        .bind(r.site, p.form, since, day).first();
      return { state: "pending", detail: draft ? `${name} started, not submitted (${draft.done}/${draft.total})` : `${name} not started${p.period === "week" ? " this week" : ""}` };
    }
    if (r.kind === "mom") {
      const { results } = await env.DB.prepare(`SELECT a.text, a.owner_name, a.due FROM mom_actions a JOIN mom_meetings m ON m.id = a.meeting_id
        WHERE m.site = ? AND m.status = 'published' AND a.status = 'Open' AND a.due != '' AND a.due < ? ORDER BY a.due LIMIT 50`).bind(r.site, day).all();
      const list = results || [];
      return list.length
        ? { state: "pending", detail: `${list.length} overdue: ${list.slice(0, 3).map(a => `${clip(a.text, 50)}${a.owner_name ? ` (${a.owner_name})` : ""}`).join("; ")}${list.length > 3 ? "…" : ""}` }
        : { state: "done", detail: "No overdue tasks" };
    }
    if (r.kind === "pir") {
      const d = await pull("incidents");
      if (!d || d.error) return { state: "error", detail: `Incident system: ${(d && d.error) || "no answer"}` };
      const list = (d.pirs || []).filter(x => !p.overdueOnly || x.overdue);
      return list.length
        ? { state: "pending", detail: `${list.length} waiting: ${list.slice(0, 4).map(x => `${x.ref}${x.owner ? ` (${x.owner})` : ""}`).join(", ")}${list.length > 4 ? "…" : ""}` }
        : { state: "done", detail: p.overdueOnly ? "No overdue reports" : "No reports waiting" };
    }
    if (r.kind === "sitevisit") {
      const d = await pull("snaglist");
      if (!d || d.error) return { state: "error", detail: `Snaglist: ${(d && d.error) || "no answer"}` };
      const list = (d.visits || []).filter(v => (v.items || []).length && Number(v.daysOpen || 0) >= (p.days || 0));
      const pts = list.reduce((n, v) => n + (v.items || []).length, 0);
      return list.length
        ? { state: "pending", detail: `${list.length} visit${list.length === 1 ? "" : "s"}, ${pts} open point${pts === 1 ? "" : "s"}: ${list.slice(0, 3).map(v => `${clip(v.name, 40)} (${v.daysOpen}d)`).join(", ")}` }
        : { state: "done", detail: "No site visits past the limit" };
    }
    return { state: "error", detail: "Unknown reminder type" };
  } catch (e) {
    return { state: "error", detail: clip(String(e && e.message || e), 200) };
  }
}

/* A task was just done in the hub (handover submitted, checklist submitted): mark the matching reminders
   done for today straight away, so no reminder goes out for it. test(params) picks the reminders. */
export async function reminderDone(env, site, kind, test, detail, now) {
  try {
    const t = beirutNow();
    const { results } = await env.DB.prepare("SELECT id, params FROM reminders WHERE site = ? AND kind = ? AND active = 1").bind(site, kind).all();
    const hit = (results || []).filter(r => { try { return test(JSON.parse(r.params || "{}")); } catch { return false; } });
    if (!hit.length) return 0;
    await env.DB.batch(hit.map(r => env.DB.prepare(
      "INSERT OR REPLACE INTO reminder_runs (reminder_id, site, day, slot, state, detail, pushed, at) VALUES (?,?,?,'zz-done','done',?,0,?)")
      .bind(r.id, site, t.day, clip(detail, 400), now)));
    return hit.length;
  } catch { return 0; }
}

/* ---------- the cron: every 2 minutes ---------- */
/* deps = { raiseEvent, pullDay, now } from worker.js */
export async function remindersRun(env, deps) {
  const t = beirutNow();
  const { results } = await env.DB.prepare("SELECT * FROM reminders WHERE active = 1 AND instr(days, ?) > 0").bind(String(t.dow)).all();
  if (!(results || []).length) return;
  const cache = new Map();
  for (const r of results) {
    /* the latest slot that is due now (within the grace period) */
    const due = slotsOf(r).filter(s => toMin(s) <= t.minutes && t.minutes - toMin(s) <= GRACE_MIN).pop();
    if (!due) continue;
    const today = await env.DB.prepare("SELECT slot, state FROM reminder_runs WHERE reminder_id = ? AND day = ?").bind(r.id, t.day).all();
    const runs = today.results || [];
    if (runs.some(x => x.state === "done")) continue;               // done earlier today — stop repeating
    if (runs.some(x => x.slot >= due)) continue;                    // this slot (or a later one) already handled
    const claim = await env.DB.prepare("INSERT OR IGNORE INTO reminder_runs (reminder_id, site, day, slot, state, at) VALUES (?,?,?,?, 'checking', ?)")
      .bind(r.id, r.site, t.day, due, deps.now()).run();
    if (!claim.meta || claim.meta.changes !== 1) continue;
    const res = await evaluate(env, r, t.day, deps, cache);
    let pushed = 0;
    if (res.state === "pending") {
      const repeat = runs.filter(x => x.state === "pending").length;
      await deps.raiseEvent(env, { site: r.site, app: "reminders", email: "", tone: repeat ? "alert" : "warn",
        title: `${repeat ? `Still pending (${repeat + 1}) · ` : ""}${r.title}`, body: res.detail });
      pushed = 1;
    }
    await env.DB.prepare("UPDATE reminder_runs SET state = ?, detail = ?, pushed = ?, at = ? WHERE reminder_id = ? AND day = ? AND slot = ?")
      .bind(res.state, clip(res.detail, 400), pushed, deps.now(), r.id, t.day, due).run();
  }
  /* keep 90 days of history */
  if (t.minutes < 4) await env.DB.prepare("DELETE FROM reminder_runs WHERE day < ?")
    .bind(new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10)).run();
}

/* ---------- screens ---------- */
const out = (r, extra = {}) => ({ id: r.id, kind: r.kind, title: r.title, note: r.note, at: r.at_time, every: r.every_min, until: r.until_time,
  days: r.days, params: JSON.parse(r.params || "{}"), preset: r.preset, active: !!r.active, createdName: r.created_name, updatedAt: r.updated_at, ...extra });

/* ctx = { site, can, me, now, raiseEvent, pullDay } — can.reminders decides who sets reminders up */
export async function remindersRoute(env, p, method, b, url, ctx) {
  const { site, can, me, now } = ctx;
  const manage = !!can.reminders;
  const need = () => { if (!manage) throw err("Only managers and the senior mall supervisor can change reminders", 403); };
  const t = beirutNow();

  if (p === "reminders/get") {
    const [list, runs, done, staff] = await Promise.all([
      env.DB.prepare("SELECT * FROM reminders WHERE site = ? ORDER BY at_time, id").bind(site).all(),
      env.DB.prepare("SELECT * FROM reminder_runs WHERE site = ? AND day = ? ORDER BY slot").bind(site, t.day).all(),
      env.DB.prepare("SELECT d.* FROM reminder_done d JOIN reminders r ON r.id = d.reminder_id WHERE r.site = ? AND d.day = ?").bind(site, t.day).all(),
      env.DB.prepare(`SELECT COUNT(*) AS people, SUM(CASE WHEN EXISTS (SELECT 1 FROM push_subs s WHERE s.email = u.email) THEN 1 ELSE 0 END) AS devices
        FROM users u WHERE u.active = 1 AND u.site_code = ?`).bind(site).first()
    ]);
    const runsBy = new Map(), doneBy = new Map((done.results || []).map(d => [d.reminder_id, d]));
    for (const x of runs.results || []) (runsBy.get(x.reminder_id) || runsBy.set(x.reminder_id, []).get(x.reminder_id)).push(x);
    const reminders = (list.results || []).map(r => {
      const rs = runsBy.get(r.id) || [], last = rs[rs.length - 1] || null, slots = slotsOf(r);
      const today = r.days.includes(String(t.dow));
      const next = today ? slots.find(s => toMin(s) > t.minutes && !rs.some(x => x.state === "done")) || "" : "";
      const d = doneBy.get(r.id);
      return out(r, { today, slots, next, pushes: rs.filter(x => x.pushed).length,
        last: last ? { slot: last.slot, state: last.state, detail: last.detail, at: last.at } : null,
        done: d ? { by: d.by_name, at: d.at, email: d.by_email } : null });
    });
    return { site, day: t.day, now: toHM(t.minutes), dow: t.dow, can: { manage }, kinds: KINDS, windows: WINDOWS, teams: TEAMS, presets: PRESETS,
      reach: { people: Number(staff && staff.people || 0), devices: Number(staff && staff.devices || 0) }, reminders };
  }

  if (p === "reminders/save" && method === "POST") {
    need();
    const c = cleanReminder(b);
    if (b.id) {
      const cur = await env.DB.prepare("SELECT id FROM reminders WHERE id = ? AND site = ?").bind(Number(b.id), site).first();
      if (!cur) throw err("This reminder no longer exists", 404);
      await env.DB.prepare(`UPDATE reminders SET kind=?, title=?, note=?, at_time=?, every_min=?, until_time=?, days=?, params=?, updated_at=? WHERE id=?`)
        .bind(c.kind, c.title, c.note, c.at, c.every, c.until, c.days, JSON.stringify(c.params), now(), cur.id).run();
      return { id: cur.id, saved: true };
    }
    const r = await env.DB.prepare(`INSERT INTO reminders (site, kind, title, note, at_time, every_min, until_time, days, params, preset, active, created_by, created_name, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?,?,?)`).bind(site, c.kind, c.title, c.note, c.at, c.every, c.until, c.days, JSON.stringify(c.params),
      clip(b.preset || "", 40), me.email, me.full_name, now(), now()).run();
    return { id: r.meta && r.meta.last_row_id, saved: true };
  }

  /* add several recommended reminders at once */
  if (p === "reminders/presets" && method === "POST") {
    need();
    const keys = new Set(Array.isArray(b.keys) ? b.keys : []);
    const have = new Set(((await env.DB.prepare("SELECT preset FROM reminders WHERE site = ? AND preset != ''").bind(site).all()).results || []).map(x => x.preset));
    const pick = PRESETS.filter(x => keys.has(x.key) && !have.has(x.key));
    const ops = pick.map(x => env.DB.prepare(`INSERT INTO reminders (site, kind, title, note, at_time, every_min, until_time, days, params, preset, active, created_by, created_name, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?,?,?)`).bind(site, x.kind, x.title, "", x.at, x.every, x.until, x.days || "1234567", JSON.stringify(x.params), x.key,
      me.email, me.full_name, now(), now()));
    if (ops.length) await env.DB.batch(ops);
    return { added: ops.length };
  }

  const one = async () => {
    const r = await env.DB.prepare("SELECT * FROM reminders WHERE id = ? AND site = ?").bind(Number(b.id || url.searchParams.get("id")), site).first();
    if (!r) throw err("This reminder no longer exists", 404);
    return r;
  };

  if (p === "reminders/active" && method === "POST") {
    need(); const r = await one();
    await env.DB.prepare("UPDATE reminders SET active = ?, updated_at = ? WHERE id = ?").bind(b.active ? 1 : 0, now(), r.id).run();
    return { id: r.id, active: !!b.active };
  }
  if (p === "reminders/remove" && method === "POST") {
    need(); const r = await one();
    await env.DB.batch([
      env.DB.prepare("DELETE FROM reminders WHERE id = ?").bind(r.id),
      env.DB.prepare("DELETE FROM reminder_runs WHERE reminder_id = ?").bind(r.id),
      env.DB.prepare("DELETE FROM reminder_done WHERE reminder_id = ?").bind(r.id)
    ]);
    return { removed: true };
  }
  /* check a reminder right now — shows the answer, sends nothing */
  if (p === "reminders/check" && method === "POST") {
    const r = await one();
    return { id: r.id, ...(await evaluate(env, r, t.day, ctx, new Map())), at: toHM(t.minutes) };
  }
  /* custom tasks: anyone at the flagship marks them done for today (and can undo their own) */
  if (p === "reminders/done" && method === "POST") {
    const r = await one();
    if (r.kind !== "custom") throw err("This reminder is checked automatically from its system");
    if (b.undo) {
      const d = await env.DB.prepare("SELECT by_email FROM reminder_done WHERE reminder_id = ? AND day = ?").bind(r.id, t.day).first();
      if (d && d.by_email !== me.email && !manage) throw err("Only the person who marked it done, or a manager, can undo it", 403);
      await env.DB.prepare("DELETE FROM reminder_done WHERE reminder_id = ? AND day = ?").bind(r.id, t.day).run();
      return { done: false };
    }
    await env.DB.prepare("INSERT OR REPLACE INTO reminder_done (reminder_id, day, by_email, by_name, at) VALUES (?,?,?,?,?)")
      .bind(r.id, t.day, me.email, me.full_name, now()).run();
    return { done: true, by: me.full_name };
  }
  if (p === "reminders/history") {
    const from = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);
    const { results } = await env.DB.prepare(`SELECT x.*, r.title, r.kind FROM reminder_runs x JOIN reminders r ON r.id = x.reminder_id
      WHERE x.site = ? AND x.day >= ? ORDER BY x.day DESC, x.slot DESC LIMIT 400`).bind(site, from).all();
    return { runs: (results || []).map(x => ({ day: x.day, slot: x.slot, title: x.title, kind: x.kind, state: x.state, detail: x.detail, pushed: !!x.pushed })) };
  }
  throw err("Unknown endpoint", 404);
}
