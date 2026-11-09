/* =====================================================================
   EMAIL CONTROL (Nov 2026) — docs/FEATURE-email-control.md
   Admin → Email Control: every email the hub sends, with an ON / OFF switch (whole hub), "Pause all automatic emails",
   and a send log (last sent, sent this month).
   • Every send carries a kind (m.kind). The central senders in worker.js (relay, sendMany, the outlookSend handed to modules)
     call mailGate() first: OFF (or paused, for automatic ones) → not sent, the caller gets { ok:false, off:true, error }.
     After a send, mailLog() counts it.
   • Sign-in codes are locked ON. Emails without a kind are not switchable (Outlook connection tests).
   Settings: meta "mail:ctl" = { off: { kind: 1 }, pause: false }. Log: table mail_log (kind, day, n, last_at, last_to).
   ===================================================================== */
export const MAILS = [
  { k: "morning", g: "Daily & weekly reports", n: "Morning brief", w: "Yesterday's figures and what's due", who: "Leadership & Mall Managers who opted in", when: "Every morning", t: "auto" },
  { k: "eod", g: "Daily & weekly reports", n: "End of Day Report", w: "The day per flagship", who: "End of Day recipients per flagship", when: "Every evening", t: "auto" },
  { k: "digest", g: "Daily & weekly reports", n: "Weekly digest · Your week", w: "Each person's open items", who: "Every user", when: "Monday morning", t: "auto" },
  { k: "snagweekly", g: "Daily & weekly reports", n: "Snaglist weekly", w: "Open / solved findings, all flagships", who: "Leadership", when: "Weekly", t: "auto" },
  { k: "reports", g: "Daily & weekly reports", n: "Report subscriptions", w: "Reports built in Reports", who: "Each report's subscribers", when: "As set per report", t: "auto" },
  { k: "cleaners", g: "Daily & weekly reports", n: "Cleaner entries · daily", w: "Cleaners in / out per flagship", who: "Cleaning recipients per flagship", when: "Every evening", t: "auto" },
  { k: "backup", g: "Daily & weekly reports", n: "Weekly backup", w: "Database backup file", who: "Admin", when: "Weekly", t: "auto" },
  { k: "formalert", g: "Reminders & alerts", n: "Form alerts · not OK", w: "A checklist item answered “not OK”", who: "Per form trigger", when: "When it happens", t: "auto" },
  { k: "patrol", g: "Reminders & alerts", n: "Security patrol", w: "Patrol done / missed", who: "Security recipients", when: "After each patrol", t: "auto" },
  { k: "admin", g: "Reminders & alerts", n: "Admin alerts", w: "Hierarchy not linked, secrets expiring, systems down…", who: "Admins", when: "When it happens", t: "auto" },
  { k: "footfall", g: "Reminders & alerts", n: "Footfall · Liban Park figures", w: "Link to fill yesterday's figures + reminders", who: "Liban Park per flagship", when: "Every morning", t: "auto" },
  { k: "cleanverify", g: "Reminders & alerts", n: "Cleaner monthly verification", w: "Tenants confirm their cleaners", who: "Tenants with cleaners", when: "1st of the month", t: "auto" },
  { k: "memo", g: "Tenants", n: "Memo + reminders", w: "The memo, then reminders to tenants who don't answer", who: "Tenants (Directory + Tenant Portal Database)", when: "On Share · reminders", t: "man" },
  { k: "marketing", g: "Tenants", n: "Marketing participation", w: "Invitation + daily reminders", who: "Tenants", when: "On launch · reminders", t: "man" },
  { k: "pm", g: "Tenants", n: "Preventive Maintenance", w: "Monthly PM request + reminders", who: "Tenants by category", when: "Monthly · reminders", t: "auto" },
  { k: "rroutbox", g: "Tenants", n: "Restroom system outbox", w: "Emails queued by the restroom inspection system", who: "Restroom recipients", when: "When queued", t: "auto" },
  { k: "training", g: "Team", n: "Hub training reminders", w: "Session reminders (Bcc)", who: "Session attendees", when: "Before each session", t: "auto" },
  { k: "schedule", g: "Team", n: "Weekly schedule", w: "Operations weekly schedule", who: "Schedule recipients", when: "When someone presses Send", t: "man" },
  { k: "handover", g: "Team", n: "Shift handover", w: "Handover email", who: "Handover recipients", when: "When someone presses Send", t: "man" },
  { k: "welcome", g: "Team", n: "Welcome email", w: "New account created", who: "The new user", when: "When an account is created", t: "man" },
  { k: "signin", g: "Security", n: "Sign-in code (2-step)", w: "6-digit code", who: "The user signing in", when: "On sign-in", t: "lock" }
];
const BY = Object.fromEntries(MAILS.map(m => [m.k, m]));
let CACHE = null, CACHE_AT = 0;
export async function mailCtlSchema(env) {
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS mail_log (kind TEXT NOT NULL, day TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, last_at TEXT NOT NULL DEFAULT '', last_to TEXT NOT NULL DEFAULT '', PRIMARY KEY (kind, day))").run();
}
async function settings(env, fresh) {
  if (!fresh && CACHE && Date.now() - CACHE_AT < 30000) return CACHE;
  const r = await env.DB.prepare("SELECT v FROM meta WHERE k = 'mail:ctl'").first().catch(() => null);
  let v = { off: {}, pause: false }; try { v = { off: {}, pause: false, ...JSON.parse(r ? r.v : "{}") }; } catch {}
  CACHE = v; CACHE_AT = Date.now(); return v;
}
/* may this email go out? */
export async function mailGate(env, kind) {
  const m = BY[kind]; if (!m || m.t === "lock") return { ok: true };
  const s = await settings(env).catch(() => ({ off: {}, pause: false }));
  if (s.off[kind]) return { ok: false, error: `“${m.n}” is turned off by the admin in Email Control` };
  if (s.pause && m.t === "auto") return { ok: false, error: "Automatic emails are paused by the admin in Email Control" };
  return { ok: true };
}
export async function mailLog(env, kind, to, n = 1, day) {
  if (!kind) return;
  const at = new Date().toISOString(), d = day || new Date(Date.now() + 2 * 36e5).toISOString().slice(0, 10);
  const first = Array.isArray(to) ? to[0] : to;
  await env.DB.prepare(`INSERT INTO mail_log (kind, day, n, last_at, last_to) VALUES (?,?,?,?,?)
    ON CONFLICT(kind, day) DO UPDATE SET n = n + excluded.n, last_at = excluded.last_at, last_to = excluded.last_to`).bind(kind, d, n, at, String(first || "").slice(0, 120)).run().catch(() => {});
}
export async function mailCtlRoute(env, p, method, b, d) {
  if (!d.isAdmin) throw Object.assign(new Error("Admins only"), { status: 403 });
  if (p === "mailctl/list") {
    const s = await settings(env, true), m0 = d.today().slice(0, 8) + "01";
    const rows = (await env.DB.prepare("SELECT kind, SUM(CASE WHEN day >= ? THEN n ELSE 0 END) AS month, MAX(last_at) AS last FROM mail_log GROUP BY kind").bind(m0).all().catch(() => ({ results: [] }))).results || [];
    const L = Object.fromEntries(rows.map(r => [r.kind, r]));
    const other = rows.filter(r => !BY[r.kind]).reduce((a, r) => a + (r.month || 0), 0);
    return { pause: !!s.pause, since: (await env.DB.prepare("SELECT MIN(day) AS d FROM mail_log").first().catch(() => null) || {}).d || "",
      list: MAILS.map(m => ({ ...m, on: m.t === "lock" || !s.off[m.k], month: (L[m.k] || {}).month || 0, last: (L[m.k] || {}).last || "" })), other };
  }
  if (method !== "POST") throw Object.assign(new Error("Unknown request"), { status: 404 });
  const s = await settings(env, true);
  if (p === "mailctl/set") {
    const m = BY[b.kind]; if (!m || m.t === "lock") throw Object.assign(new Error("This email cannot be turned off"), { status: 400 });
    if (b.on) delete s.off[m.k]; else s.off[m.k] = 1;
  } else if (p === "mailctl/pause") s.pause = !!b.pause;
  else throw Object.assign(new Error("Unknown request"), { status: 404 });
  await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('mail:ctl', ?)").bind(JSON.stringify(s)).run();
  CACHE = s; CACHE_AT = Date.now();
  if (d.audit) await d.audit(env, { me: d.me, site: "", tool: "admin", ref: "email-control", label: p === "mailctl/pause" ? (s.pause ? "Paused all automatic emails" : "Resumed automatic emails") : `${BY[b.kind].n} → ${b.on ? "ON" : "OFF"}`, action: "update", changes: [] }).catch(() => {});
  return { saved: true, pause: s.pause };
}
