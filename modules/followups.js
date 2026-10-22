/* =====================================================================
   FOLLOW-UPS — the personal flag from Outlook (Oct 2026) — docs/FEATURE-followups.md
   Each person flags emails from the Outlook add-in (subject, due date, priority High / Medium / Low) — or keeps a Note (no due date, no reminder).
   Personal only: everyone sees and is reminded of their own follow-ups.
   • Reminders (hub notification + push): the day before (from 09:00 Beirut) and on the due day (from 09:00).
   • Hub home page: "Action needed" — open follow-ups due today (and overdue) and tomorrow, High first.
   Routes /api/fu/* (hub session or the Outlook add-in token).
   ===================================================================== */
const err = (m, status = 400) => Object.assign(new Error(m), { status });
const clip = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
const PRI = { high: 1, medium: 2, low: 3 };
const isDay = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ""));
const addDays = (d, n) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

export async function followupSchema(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS followups (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL, site TEXT NOT NULL DEFAULT '',
      msg_id TEXT NOT NULL DEFAULT '', subject TEXT NOT NULL, sender TEXT NOT NULL DEFAULT '', link TEXT NOT NULL DEFAULT '',
      due TEXT NOT NULL, priority TEXT NOT NULL DEFAULT 'medium', status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL, done_at TEXT NOT NULL DEFAULT '', rem_before INTEGER NOT NULL DEFAULT 0, rem_day INTEGER NOT NULL DEFAULT 0)`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS followups_mine ON followups (email, status, due)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS followups_due ON followups (status, due)")
  ]);
}
const out = r => ({ id: r.id, site: r.site, msgId: r.msg_id, subject: r.subject, sender: r.sender, link: r.link, due: r.due, priority: r.priority,
  status: r.status, createdAt: r.created_at, doneAt: r.done_at });

export async function followupRoute(env, p, method, b, me, d) {
  const email = me.email.toLowerCase(), today = d.today();
  const mine = async id => { const r = await env.DB.prepare("SELECT * FROM followups WHERE id = ? AND email = ?").bind(Number(id) || 0, email).first(); if (!r) throw err("This follow-up does not exist", 404); return r; };

  /* the home page: overdue + today + tomorrow (open only) */
  if (p === "fu/list") {
    const { results } = await env.DB.prepare("SELECT * FROM followups WHERE email = ? AND status = 'open' AND (due = '' OR due <= ?) ORDER BY due, id LIMIT 200").bind(email, addDays(today, 1)).all();
    const all = (results || []).map(out);
    const L = all.filter(x => x.due).sort((a, c) => (a.due > today ? 1 : 0) - (c.due > today ? 1 : 0) || PRI[a.priority] - PRI[c.priority] || a.due.localeCompare(c.due));
    const notes = all.filter(x => !x.due).sort((a, c) => PRI[a.priority] - PRI[c.priority] || c.id - a.id);   // notes: follow-ups without a due date
    return { today, tomorrow: addDays(today, 1), list: L, notes };
  }
  /* the add-in: all my open follow-ups (dated by date, then Notes) */
  if (p === "fu/all") {
    const { results } = await env.DB.prepare("SELECT * FROM followups WHERE email = ? AND status = 'open' ORDER BY due, id LIMIT 300").bind(email).all();
    const all = (results || []).map(out);
    return { today, tomorrow: addDays(today, 1), list: all.filter(x => x.due).sort((a, c) => a.due.localeCompare(c.due) || PRI[a.priority] - PRI[c.priority]),
      notes: all.filter(x => !x.due).sort((a, c) => PRI[a.priority] - PRI[c.priority] || c.id - a.id) };
  }
  /* the add-in: is this email already flagged? */
  if (p === "fu/item") {
    const id = clip(b.msgId, 400);
    const r = id ? await env.DB.prepare("SELECT * FROM followups WHERE email = ? AND msg_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1").bind(email, id).first() : null;
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM followups WHERE email = ? AND status = 'open' AND due != '' AND due <= ?").bind(email, today).first();
    return { item: r ? out(r) : null, dueToday: Number(n.n) || 0, today };
  }
  if (method !== "POST") throw err("Unknown request", 404);
  if (p === "fu/save") {
    const subject = clip(b.subject, 250) || "(no subject)", note = !!b.note, due = note ? "" : isDay(b.due) ? b.due : "";   // note = no due date, no reminder
    if (!note && !due) throw err("Choose the due date");
    if (due && due < today) throw err("The due date is in the past");
    const priority = PRI[b.priority] ? b.priority : "medium", msgId = clip(b.msgId, 400);
    const ex = b.id ? await mine(b.id) : msgId ? await env.DB.prepare("SELECT * FROM followups WHERE email = ? AND msg_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1").bind(email, msgId).first() : null;
    if (ex) {   // same email flagged again → change it (reminders start over when the date changes)
      await env.DB.prepare(`UPDATE followups SET due = ?, priority = ?, rem_before = CASE WHEN due = ? THEN rem_before ELSE 0 END, rem_day = CASE WHEN due = ? THEN rem_day ELSE 0 END WHERE id = ?`)
        .bind(due, priority, due, due, ex.id).run();
      return { item: out(await mine(ex.id)) };
    }
    const r = await env.DB.prepare(`INSERT INTO followups (email, site, msg_id, subject, sender, link, due, priority, created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
      .bind(email, clip(b.site, 8), msgId, subject, clip(b.sender, 120), /^https:\/\//.test(String(b.link || "")) ? String(b.link).slice(0, 1500) : "", due, priority, d.now()).run();
    return { item: out(await mine(r.meta.last_row_id)) };
  }
  if (p === "fu/done") { const r = await mine(b.id); await env.DB.prepare("UPDATE followups SET status = 'done', done_at = ? WHERE id = ?").bind(d.now(), r.id).run(); return { done: true }; }
  if (p === "fu/later") {   // +1 day (from the later of today and the due date)
    const r = await mine(b.id), nd = addDays(r.due < today ? today : r.due, Math.max(1, Math.min(30, Number(b.days) || 1)));
    await env.DB.prepare("UPDATE followups SET due = ?, rem_before = 0, rem_day = 0 WHERE id = ?").bind(nd, r.id).run();
    return { item: out(await mine(r.id)) };
  }
  if (p === "fu/remove") { const r = await mine(b.id); await env.DB.prepare("DELETE FROM followups WHERE id = ?").bind(r.id).run(); return { removed: true }; }
  throw err("Unknown request", 404);
}

/* cron: reminders from 09:00 Beirut — the day before, then on the due day. Checked once an hour. */
export async function followupRun(env, d) {
  const hour = d.hour(); if (hour < 9 || hour > 21) return;
  const today = d.today(), key = `${today}-${hour}`;
  const g = await env.DB.prepare("SELECT v FROM meta WHERE k = 'fu:run'").first().catch(() => null);
  if (g && g.v === key) return;
  await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('fu:run', ?)").bind(key).run();
  const tomorrow = addDays(today, 1);
  const { results } = await env.DB.prepare("SELECT * FROM followups WHERE status = 'open' AND due != '' AND due <= ? AND ((due = ? AND rem_before = 0) OR (due <= ? AND rem_day = 0)) LIMIT 300")
    .bind(tomorrow, tomorrow, today).all();
  const tag = { high: "🔴 High", medium: "🟠 Medium", low: "🟡 Low" };
  for (const r of results || []) {
    const isDayOf = r.due <= today;
    await d.raiseEvent(env, { app: "followup", email: r.email, site: r.site || "", tone: r.priority === "high" ? "alert" : r.priority === "medium" ? "warn" : "info",
      title: `${isDayOf ? (r.due < today ? "Overdue" : "Due today") : "Due tomorrow"} · ${r.subject}`.slice(0, 140),
      body: `${tag[r.priority] || ""} follow-up${r.sender ? " · " + r.sender : ""} — open the hub home page (Action needed)` }).catch(() => {});
    await env.DB.prepare(isDayOf ? "UPDATE followups SET rem_day = 1, rem_before = 1 WHERE id = ?" : "UPDATE followups SET rem_before = 1 WHERE id = ?").bind(r.id).run();
  }
  if (hour === 9) await env.DB.prepare("DELETE FROM followups WHERE status = 'done' AND done_at < ?").bind(new Date(Date.now() - 90 * 864e5).toISOString()).run().catch(() => {});
}
