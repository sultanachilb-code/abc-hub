/* =====================================================================
   ADMIN CONTROL CENTER (Oct 2026) — docs/FEATURE-admin-cc.md
   /admin (tools/admin.html) for administrators only. The admin signs in on the normal login page with his own account.
   • Overview: alerts (red / amber) + today's cards (users, emails, Cloudflare, ABCON, systems, jobs, backup, security)
   • Users & access: everyone with last activity, two-step, lock; unlock, sign out everywhere, "View as" (read-only, logged)
   • Security: sign-in log (successes, wrong passwords, locks), sign everyone out
   • Allowances: Outlook / relay, D1 reads-writes-size, Worker requests, R2, ABCON
   • Systems & jobs: connected systems answering, settings (secret names only, never values), scheduled jobs + Run now
   • Tools control: switch a tool off, move it to another folder, choose who sees it (meta 'tools:cfg', applied in /me and roleAllows)
   • Data & backup: table sizes, clean-up of old notifications / logs
   Routes: /api/admin/cc/*   ·   /api/viewas-stop (public: just clears the View-as cookie)
   ===================================================================== */
const err = (m, status = 400) => Object.assign(new Error(m), { status });
const clip = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
const LOCK_AFTER = 5, LOCK_MIN = 15, ONLINE_MIN = 10;
export const VIEWAS_MIN = 30, ADMIN_UNLOCK_H = 2;

export async function admSchema(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS admin_signins (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, email TEXT NOT NULL,
      ok INTEGER NOT NULL DEFAULT 0, what TEXT NOT NULL DEFAULT '', ua TEXT NOT NULL DEFAULT '', ip TEXT NOT NULL DEFAULT '')`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS admin_signins_at ON admin_signins (at)")
  ]);
  const cols = ((await env.DB.prepare("PRAGMA table_info(users)").all()).results || []).map(c => c.name);
  for (const [c, t] of [["last_seen_at", "TEXT NOT NULL DEFAULT ''"], ["signout_at", "INTEGER NOT NULL DEFAULT 0"], ["fail_count", "INTEGER NOT NULL DEFAULT 0"], ["locked_until", "TEXT NOT NULL DEFAULT ''"], ["is_admin", "INTEGER NOT NULL DEFAULT 0"]])
    if (!cols.includes(c)) await env.DB.prepare(`ALTER TABLE users ADD COLUMN ${c} ${t}`).run();
  /* Oct 2026: administrator access becomes a flag next to the person's real role (Sultan: Admin + Mall Supervisor at ABC Verdun Mall) */
  const mig = await env.DB.prepare("INSERT OR IGNORE INTO meta (k, v) VALUES ('mig:admin-split', ?)").bind(new Date().toISOString()).run().catch(() => null);
  if (mig && mig.meta && mig.meta.changes === 1) {
    await env.DB.prepare("UPDATE users SET is_admin = 1 WHERE role = 'ADMIN'").run();
    await env.DB.prepare("UPDATE users SET role = 'SUPERVISOR', position = 'MS', site_code = 'VRM', sites = '' WHERE email = 'salaachi@abc.com.lb' AND role = 'ADMIN'").run();
  }
}

/* ---------- sign-in protection (called from login) ---------- */
const device = ua => { ua = String(ua || ""); const os = /iPhone|iPad/.test(ua) ? "iPhone" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "Mac" : "Other";
  const br = /Edg\//.test(ua) ? "Edge" : /CriOS|Chrome\//.test(ua) ? "Chrome" : /Firefox|FxiOS/.test(ua) ? "Firefox" : /Safari/.test(ua) ? "Safari" : "Browser"; return `${os} · ${br}`; };
export async function logSignin(env, request, email, ok, what) {
  const ua = request ? request.headers.get("user-agent") || "" : "", ip = request ? request.headers.get("cf-connecting-ip") || "" : "";
  await env.DB.prepare("INSERT INTO admin_signins (at, email, ok, what, ua, ip) VALUES (?,?,?,?,?,?)").bind(new Date().toISOString(), clip(email, 120), ok ? 1 : 0, clip(what, 80), device(ua), clip(ip, 45)).run().catch(() => {});
}
export function lockedMsg(u) {
  if (!u || !u.locked_until || u.locked_until <= new Date().toISOString()) return "";
  const m = Math.max(1, Math.ceil((Date.parse(u.locked_until) - Date.now()) / 60000));
  return `Too many wrong passwords — this account is locked for ${m} more minute${m === 1 ? "" : "s"}. Your administrator can unlock it.`;
}
export async function passwordFailed(env, u, notifyAdmins) {
  const n = (Number(u.fail_count) || 0) + 1;
  if (n >= LOCK_AFTER) {
    await env.DB.prepare("UPDATE users SET fail_count = 0, locked_until = ? WHERE email = ?").bind(new Date(Date.now() + LOCK_MIN * 60000).toISOString(), u.email).run();
    if (notifyAdmins) await notifyAdmins(env, `Account locked · ${u.full_name}`, `${LOCK_AFTER} wrong passwords in a row — locked for ${LOCK_MIN} minutes (Admin Control → Users to unlock).`, "warn").catch(() => {});
    return true;
  }
  await env.DB.prepare("UPDATE users SET fail_count = ? WHERE email = ?").bind(n, u.email).run();
  return false;
}
export async function passwordOk(env, u) { if (u.fail_count || u.locked_until) await env.DB.prepare("UPDATE users SET fail_count = 0, locked_until = '' WHERE email = ?").bind(u.email).run(); }
/* "online now": last activity, written at most every 10 minutes per person */
export async function touchSeen(env, u) {
  const now = Date.now(); if (u.last_seen_at && now - Date.parse(u.last_seen_at) < ONLINE_MIN * 60000) return;
  await env.DB.prepare("UPDATE users SET last_seen_at = ? WHERE email = ?").bind(new Date(now).toISOString(), u.email).run().catch(() => {});
}

/* ---------- tools control (folders, on/off, who sees it) ---------- */
let TCFG = null, TCFG_AT = 0;
export async function toolsCfg(env) {
  if (TCFG && Date.now() - TCFG_AT < 60000) return TCFG;
  const r = await env.DB.prepare("SELECT v FROM meta WHERE k = 'tools:cfg'").first().catch(() => null);
  try { TCFG = r ? JSON.parse(r.v) : {}; } catch { TCFG = {}; } TCFG_AT = Date.now(); return TCFG;
}
export const toolsCfgNow = () => TCFG || {};   // for the synchronous access check (loaded at the start of each signed-in request)
export const ACCESS_KEYS = { MM: "Mall Manager", OM: "Operations Manager", SMS: "Senior Mall Supervisor", MS: "Mall Supervisor", MO: "Mall Officer", WH: "Warehouse", SEC: "Security", LEAD: "Leadership (Advisor, Director, CDSO)" };

/* ---------- helpers ---------- */
const metaGet = async (env, k) => { const r = await env.DB.prepare("SELECT v FROM meta WHERE k = ?").bind(k).first().catch(() => null); return r ? r.v : null; };
const metaJson = async (env, k) => { const v = await metaGet(env, k); try { return v ? JSON.parse(v) : null; } catch { return null; } };
const tone = (pct, warn = 70, bad = 90) => pct == null ? "mut" : pct >= bad ? "bad" : pct >= warn ? "warn" : "ok";
const utcDay = () => new Date().toISOString().slice(0, 10);

async function workerRequests(env, gql) {
  const c = await metaJson(env, "cc:wreq"); if (c && Date.now() - Date.parse(c.at) < 15 * 60000) return c;
  if (!gql || !(env.CF_API_TOKEN || env.CF_ANALYTICS_TOKEN)) return { setup: false };
  try {
    const d = await gql(env, `query($acc: String!, $f: Time!, $t: Time!) { viewer { accounts(filter: { accountTag: $acc }) {
      workersInvocationsAdaptive(limit: 100, filter: { datetime_geq: $f, datetime_leq: $t }) { sum { requests errors } dimensions { scriptName } } } } }`,
      { f: utcDay() + "T00:00:00Z", t: new Date().toISOString() });
    const G = d.workersInvocationsAdaptive || [], by = {};
    for (const g of G) { const n = g.dimensions.scriptName; by[n] = by[n] || { name: n, requests: 0, errors: 0 }; by[n].requests += g.sum.requests || 0; by[n].errors += g.sum.errors || 0; }
    const list = Object.values(by).sort((a, b) => b.requests - a.requests), total = list.reduce((s, x) => s + x.requests, 0), limit = Number(env.WORKERS_FREE_REQUESTS) || 100000;
    const out = { setup: true, at: new Date().toISOString(), total, limit, pct: Math.round(total / limit * 1000) / 10, errors: list.reduce((s, x) => s + x.errors, 0), list };
    await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('cc:wreq', ?)").bind(JSON.stringify(out)).run().catch(() => {});
    return out;
  } catch (e) { return { setup: true, error: String(e.message || e) }; }
}

/* connected systems: does each one answer? (kept 20 minutes; "Test all" asks again) */
async function systems(env, d, fresh) {
  if (!fresh) { const c = await metaJson(env, "cc:sys"); if (c && Date.now() - Date.parse(c.at) < 20 * 60000) return c; }
  /* the same small requests the hub already uses every day (hub stats / sign-in probe), not the system's home page */
  const prev = new Map(((await metaJson(env, "cc:sys")) || { list: [] }).list.map(s => [s.id, s]));
  const ping = async (id, name, c) => {
    const t0 = Date.now(), path = c.ping || (c.stats ? c.stats.replace("{site}", "VRM") : "/api/sso?probe=1");
    let res;
    try {
      const init = { headers: env.HUB_KEY ? { "x-hub-key": env.HUB_KEY } : {}, signal: AbortSignal.timeout(10000) };
      const r = c.binding && env[c.binding] ? await env[c.binding].fetch(c.base + path, init) : await fetch(c.base + path, init);
      res = { id, name, ok: r.status < 500, ms: Date.now() - t0, note: r.status < 500 ? "" : `HTTP ${r.status}` };
    } catch (e) { res = { id, name, ok: false, ms: Date.now() - t0, note: e.name === "TimeoutError" ? "No answer in 10 s" : "Not answering" }; }
    const p = prev.get(id); res.streak = res.ok ? 0 : ((p && !p.ok ? Number(p.streak) || 1 : 0) + 1);   // failed checks in a row
    return res;
  };
  const C = d.CONNECTORS, names = { snaglist: "Snaglist", incidents: "Incidents", restroom: "Restroom", "cleaner-qr": "Cleaning app", footfall: "Footfall" };
  const list = await Promise.all([
    ...Object.entries(names).filter(([k]) => C[k]).map(([k, n]) => ping(k, n, C[k])),
    ping("gate", "Loading Gate", { base: env.GATE_URL || "https://abc-loading-gate.sultanachi-lb-61f.workers.dev" })
  ]);
  const q = await metaJson(env, "mail:quota");
  list.push({ id: "relay", name: "Mail relay (Gmail)", ok: !!env.MAIL_RELAY_URL && !!env.MAIL_RELAY_KEY, note: !env.MAIL_RELAY_URL ? "Not set" : q ? `${q.remaining} left today` : "" });
  const exp = await metaGet(env, "ms:secret_exp"), auto = await metaGet(env, "ms:auto");
  const msDays = exp ? Math.round((Date.parse(exp + "T12:00:00Z") - Date.now()) / 864e5) : null;
  list.push({ id: "microsoft", name: "Microsoft / Outlook", ok: !!(env.MS_CLIENT_ID && env.MS_CLIENT_SECRET) && (msDays == null || msDays > 30), warn: !auto || msDays == null,
    note: !(env.MS_CLIENT_ID && env.MS_CLIENT_SECRET) ? "Not set up" : `${auto ? "Automatic sender " + auto : "No automatic sender chosen"}${exp ? " · secret expires " + exp : " · set the secret expiry date"}` });
  list.push({ id: "salesforce", name: "Salesforce", ok: true, warn: !(env.SF_CLIENT_ID && env.SF_CLIENT_SECRET), note: env.SF_CLIENT_ID ? "Configured" : "Not connected yet" });
  list.push({ id: "ai", name: "ABCON (Workers AI)", ok: !!env.AI, note: env.AI ? "Free daily allowance" : "AI binding missing" });
  const out = { at: new Date().toISOString(), list };
  await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('cc:sys', ?)").bind(JSON.stringify(out)).run().catch(() => {});
  return out;
}
const SECRETS = [["SESSION_SECRET", "Sign-in (required)", true], ["HUB_KEY", "Connected systems (Snaglist, Incidents…)", true], ["MAIL_RELAY_KEY", "Mail relay (Gmail)", true],
  ["INBOX_KEY", "Hub Gmail inbox + Drive backup", false], ["GATE_KEY", "Loading Gate", false], ["MS_TENANT_ID", "Microsoft (Outlook)", false], ["MS_CLIENT_ID", "Microsoft (Outlook)", false],
  ["MS_CLIENT_SECRET", "Microsoft (Outlook)", false], ["CF_API_TOKEN", "Usage meters (Cloudflare)", false], ["CF_ACCOUNT_ID", "Usage meters (Cloudflare)", false],
  ["SF_CLIENT_ID", "Salesforce", false], ["SF_CLIENT_SECRET", "Salesforce", false], ["TWILIO_SID", "Emergency calls / SMS", false], ["TWILIO_TOKEN", "Emergency calls / SMS", false]];

async function jobs(env, d) {
  const today = d.today(), hub = d.hour();
  const beat = await metaGet(env, "cron:beat"), mail = await metaJson(env, "mail:last"), bk = await metaJson(env, "backup:last"), st = await metaJson(env, "storage:last");
  const day = async k => await metaGet(env, k);
  const eod = await env.DB.prepare("SELECT k, v FROM meta WHERE k >= ? AND k < ? ORDER BY k DESC LIMIT 10").bind("eod:", "eod;").all().catch(() => ({ results: [] }));
  const lastEod = (eod.results || [])[0];
  const q = await env.DB.prepare("SELECT SUM(CASE WHEN status = 'wait' THEN 1 ELSE 0 END) AS wait, SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed FROM ms_queue").first().catch(() => null);
  const beatAge = beat ? Math.round((Date.now() - Date.parse(beat)) / 60000) : null;
  const L = [
    { id: "cron", name: "Scheduler (every 2 minutes)", when: "every 2 min", last: beat || "", ok: beatAge != null && beatAge <= 15, note: beatAge == null ? "No run seen yet" : `${beatAge} min ago` },
    { id: "morning", name: "Morning brief email", when: `${d.MAIL_HOUR}:00 daily`, last: mail && mail.at || (await day("mail:" + today)) || "", ok: !!(await day("mail:" + today)) || hub < d.MAIL_HOUR + 1, run: "morning-test", runLabel: "Send me a test" },
    { id: "eod", name: "End of Day email", when: "23:30 daily", last: lastEod ? lastEod.v : "", note: lastEod ? lastEod.k.replace(/^eod:/, "").replace(":", " · ") : "", ok: true, run: "eod-test", runLabel: "Send me a test" },
    { id: "pm", name: "Preventive Maintenance (launch · reminders · breaches)", when: "09:00 daily", last: (await day("pm:run")) || "", ok: (await day("pm:run")) === today || hub < 10, run: "pm" },
    { id: "mk", name: "Marketing Participation reminders", when: "09:00 daily", last: (await day("mk:run")) || "", ok: (await day("mk:run")) === today || hub < 10, run: "mk" },
    { id: "fu", name: "Follow-up reminders", when: "daily", last: (await day("fu:run")) || "", ok: true },
    { id: "outlook", name: "Outlook send queue", when: "every 2 min", last: beat || "", ok: !(q && Number(q.failed)), note: q ? `${Number(q.wait) || 0} waiting · ${Number(q.failed) || 0} failed` : "", run: "outlook" },
    { id: "storage", name: "Allowance check (alerts at 80 % / 95 %)", when: "daily + hourly D1", last: st && st.at || "", ok: true, run: "storage" },
    { id: "backup", name: "Backup", when: "Sunday email + monthly Google Drive", last: bk && bk.at || "", ok: !!(bk && bk.ok !== false && Date.now() - Date.parse(bk.at) < 40 * 864e5), note: bk ? (bk.ok === false ? "Last one failed: " + (bk.error || "") : `${bk.bytes ? Math.round(bk.bytes / 1024) + " KB" : ""}`) : "No backup recorded yet", run: "backup", runLabel: "Download now" }
  ];
  return L;
}

async function overview(env, d) {
  const now = Date.now(), todayB = d.today(), online = new Date(now - ONLINE_MIN * 60000).toISOString(), dayStart = new Date(now - 24 * 3600e3).toISOString();
  const u = await env.DB.prepare(`SELECT COUNT(*) AS n, SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) AS active, SUM(CASE WHEN active = 0 THEN 1 ELSE 0 END) AS off,
      SUM(CASE WHEN active = 1 AND last_seen_at >= ? THEN 1 ELSE 0 END) AS online, SUM(CASE WHEN active = 1 AND (last_login_at >= ? OR last_seen_at >= ?) THEN 1 ELSE 0 END) AS today,
      SUM(CASE WHEN locked_until > ? THEN 1 ELSE 0 END) AS locked, SUM(CASE WHEN active = 1 AND (last_login_at IS NULL OR last_login_at = '') THEN 1 ELSE 0 END) AS never FROM users`)
    .bind(online, dayStart, dayStart, new Date().toISOString()).first();
  const tf = await twofaMissing(env, d);
  const fails = await env.DB.prepare("SELECT COUNT(*) AS n FROM admin_signins WHERE ok = 0 AND at >= ?").bind(dayStart).first();
  const okIns = await env.DB.prepare("SELECT COUNT(*) AS n FROM admin_signins WHERE ok = 1 AND at >= ?").bind(dayStart).first();
  const sent = await env.DB.prepare("SELECT COUNT(*) AS n FROM ms_queue WHERE status = 'sent' AND sent_at >= ?").bind(utcDay()).first().catch(() => ({ n: 0 }));
  const msPeople = await env.DB.prepare("SELECT COUNT(*) AS n FROM ms_tokens WHERE refresh != ''").first().catch(() => ({ n: 0 }));
  const q = await metaJson(env, "mail:quota"), auto = await metaGet(env, "ms:auto"), exp = await metaGet(env, "ms:secret_exp");
  const [d1, st, wr, sys, J] = await Promise.all([d.d1Traffic(env).catch(() => null), d.storageStatus(env).catch(() => null), workerRequests(env, d.gql), systems(env, d), jobs(env, d)]);
  const ai = Number(await metaGet(env, `ai:neu:${utcDay()}`)) || 0, aiFree = Math.max(500, Number(env.AI_DAILY_NEURONS) || 10000), aiPct = Math.round(ai / aiFree * 100);
  const bk = await metaJson(env, "backup:last");
  const missing = SECRETS.filter(s => s[2] && !env[s[0]]);
  const sysDown = sys.list.filter(s => !s.ok), jobsBad = J.filter(j => !j.ok);
  const A = [];
  for (const s of sysDown) A.push({ tone: s.streak >= 2 || s.streak == null ? "bad" : "warn", title: `${s.name} — ${s.note || "not answering"}`, sub: s.streak >= 2 ? `${s.streak} checks in a row` : "One check failed — checked again next hour", where: "sys", key: "sys:" + s.id });
  for (const j of jobsBad) A.push({ tone: j.id === "cron" ? "bad" : "warn", title: `${j.name} — ${j.note || "did not run on time"}`, where: "sys", key: "job:" + j.id });
  for (const m of missing) A.push({ tone: "bad", title: `Setting ${m[0]} is missing — ${m[1]}`, where: "sys", key: "sec:" + m[0] });
  if (d1 && d1.pct) { const p = Math.max(d1.pct.reads || 0, d1.pct.writes || 0); if (p >= 70) A.push({ tone: p >= 90 ? "bad" : "warn", title: `Database at ${Math.round(p)} % of today's free allowance`, sub: `${fmtN(d1.reads)} of ${fmtN(d1.limits.reads)} rows read · resets 03:00`, where: "al", key: "d1" }); }
  if (wr && wr.pct >= 70) A.push({ tone: wr.pct >= 90 ? "bad" : "warn", title: `Worker requests at ${Math.round(wr.pct)} % of today's free allowance`, where: "al", key: "wreq" });
  if (st && st.pct) for (const [k, n] of [["r2", "File storage"], ["d1", "Database size"], ["classA", "File writes"], ["classB", "File reads"]]) if (st.pct[k] >= 80) A.push({ tone: st.pct[k] >= 95 ? "bad" : "warn", title: `${n} at ${st.pct[k]} % of the free allowance`, where: "al", key: "st:" + k });
  if (aiPct >= 70) A.push({ tone: aiPct >= 80 ? "bad" : "warn", title: `ABCON used ${aiPct} % of today's free AI`, sub: "It closes at 80 % until 03:00", where: "al", key: "ai" });
  if (q && q.remaining != null && q.remaining < 20 && !auto) A.push({ tone: "warn", title: `Mail relay: only ${q.remaining} emails left today`, sub: "Choose an Outlook automatic sender to remove the limit", where: "al", key: "relay" });
  if (tf.n) A.push({ tone: "warn", title: `${tf.n} ${tf.n === 1 ? "person has" : "people have"} not set up two-step login`, sub: "Required for their role", where: "us", key: "2fa" });
  if (Number(u.locked)) A.push({ tone: "warn", title: `${u.locked} account${Number(u.locked) === 1 ? "" : "s"} locked after wrong passwords`, where: "us", key: "locked" });
  return { at: new Date().toISOString(), alerts: A,
    users: { total: Number(u.n), active: Number(u.active), off: Number(u.off), online: Number(u.online), today: Number(u.today), locked: Number(u.locked), never: Number(u.never), twofaMissing: tf.n },
    email: { outlookSent: Number(sent.n) || 0, outlookPeople: Number(msPeople.n) || 0, auto: auto || "", secretExp: exp || "", relayLeft: q ? q.remaining : null, relayLimit: q && q.remaining > 100 ? 1500 : 100, relaySet: !!env.MAIL_RELAY_URL },
    cloud: { d1, storage: st, workers: wr }, ai: { used: Math.round(ai), free: aiFree, pct: aiPct },
    systems: { ok: sys.list.filter(s => s.ok).length, total: sys.list.length, down: sysDown.map(s => s.name), at: sys.at },
    jobs: { ok: J.filter(j => j.ok).length, total: J.length, bad: jobsBad.map(j => j.name) },
    backup: bk, security: { failed: Number(fails.n) || 0, signins: Number(okIns.n) || 0, twofaMissing: tf.n } };
}
/* landing layout: { sections: [{ id, name, icon, size: card|small, closed, items: [page or shortcut ids] }], hidden: [ids], shortcuts: [{ id, name, icon, kind: tool|link, ref }] } */
function cleanLanding(x) {
  const idOk = v => /^[\w-]{1,40}$/.test(String(v || ""));
  const seen = new Set();
  const shortcuts = (Array.isArray(x.shortcuts) ? x.shortcuts : []).slice(0, 40).map(c => {
    const kind = c && c.kind === "link" ? "link" : "tool", ref = clip(c && c.ref, 300);
    if (!c || !/^x[\w-]{1,30}$/.test(String(c.id || "")) || !ref) return null;
    if (kind === "link" && !/^https:\/\/[^\s"<>]+$/i.test(ref)) return null;
    if (kind === "tool" && !idOk(ref)) return null;
    return { id: c.id, name: clip(c.name, 50) || ref, icon: clip(c.icon, 12) || "🔗", kind, ref };
  }).filter(Boolean);
  const sections = (Array.isArray(x.sections) ? x.sections : []).slice(0, 30).map(sc => {
    if (!sc || !/^s[\w-]{1,30}$/.test(String(sc.id || ""))) return null;
    const items = (Array.isArray(sc.items) ? sc.items : []).filter(i => idOk(i) && !seen.has(i) && seen.add(i)).slice(0, 80);
    return { id: sc.id, name: clip(sc.name, 40) || "Section", icon: clip(sc.icon, 12), size: sc.size === "small" ? "small" : "card", closed: !!sc.closed, items };
  }).filter(Boolean);
  return { sections, hidden: (Array.isArray(x.hidden) ? x.hidden : []).filter(idOk).slice(0, 80), shortcuts };
}
const fmtN = n => n == null ? "—" : n >= 1e6 ? (n / 1e6).toFixed(1) + " M" : n >= 1e3 ? Math.round(n / 1e3) + " k" : String(n);
async function twofaMissing(env, d) {
  const roles = await d.requiredRoles(env).catch(() => []); if (!roles.length) return { n: 0, emails: [] };
  const q = roles.map(() => "?").join(",");
  const { results } = await env.DB.prepare(`SELECT u.email FROM users u WHERE u.active = 1 AND u.role IN (${q})
      AND NOT EXISTS (SELECT 1 FROM user_2fa t WHERE t.email = u.email AND (t.totp_on = 1 OR t.approve_on = 1 OR t.email_on = 1))
      AND NOT EXISTS (SELECT 1 FROM user_passkeys p WHERE p.email = u.email)`).bind(...roles).all().catch(() => ({ results: [] }));
  return { n: (results || []).length, emails: (results || []).map(r => r.email) };
}

/* ---------- routes ---------- */
export async function admRoute(env, a, method, b, url, d) {
  const { me } = d;
  if (a === "cc/overview") return overview(env, d);
  if (a === "cc/users" && method === "GET") {
    const L = await d.listUsers(env);
    const extra = new Map(((await env.DB.prepare("SELECT email, last_seen_at, locked_until, fail_count, signout_at FROM users").all()).results || []).map(r => [r.email, r]));
    const tf = new Map(((await env.DB.prepare("SELECT email, totp_on, approve_on, email_on FROM user_2fa").all().catch(() => ({ results: [] }))).results || []).map(r => [r.email, r]));
    const pk = new Map(((await env.DB.prepare("SELECT email, COUNT(*) AS n FROM user_passkeys GROUP BY email").all().catch(() => ({ results: [] }))).results || []).map(r => [r.email, Number(r.n)]));
    const roles = await d.requiredRoles(env).catch(() => []), now = new Date().toISOString(), on = new Date(Date.now() - ONLINE_MIN * 60000).toISOString();
    const ms = new Set(((await env.DB.prepare("SELECT email FROM ms_tokens WHERE refresh != ''").all().catch(() => ({ results: [] }))).results || []).map(r => r.email));
    return { ...L, users: L.users.map(u => { const x = extra.get(u.email) || {}, t = tf.get(u.email) || {}, ways = [pk.get(u.email) && "Passkey", t.approve_on && "Approve on phone", t.totp_on && "Authenticator", t.email_on && "Email code"].filter(Boolean);
      return { ...u, lastSeen: x.last_seen_at || "", online: !!(x.last_seen_at && x.last_seen_at >= on), locked: !!(x.locked_until && x.locked_until > now), lockedUntil: x.locked_until || "", fails: Number(x.fail_count) || 0,
        twofa: ways, twofaRequired: roles.includes(u.role), outlook: ms.has(u.email) }; }), me: me.email };
  }
  if (a === "cc/security") {
    const since = new Date(Date.now() - 30 * 864e5).toISOString();
    const log = (await env.DB.prepare("SELECT s.*, u.full_name FROM admin_signins s LEFT JOIN users u ON u.email = s.email WHERE s.at >= ? ORDER BY s.id DESC LIMIT 300").bind(since).all()).results || [];
    const adm = (await env.DB.prepare("SELECT at, by_name, action, label, tool FROM change_log WHERE tool IN ('people', 'admin') ORDER BY id DESC LIMIT 60").all().catch(() => ({ results: [] }))).results || [];
    const locked = (await env.DB.prepare("SELECT email, full_name, locked_until FROM users WHERE locked_until > ?").bind(new Date().toISOString()).all()).results || [];
    const day = new Date(Date.now() - 864e5).toISOString();
    return { log: log.map(r => ({ at: r.at, email: r.email, name: r.full_name || "", ok: !!r.ok, what: r.what, device: r.ua, ip: r.ip })), admin: adm, locked,
      today: { ok: log.filter(r => r.ok && r.at >= day).length, failed: log.filter(r => !r.ok && r.at >= day).length }, twofa: await twofaMissing(env, d) };
  }
  if (a === "cc/allowances") {
    const fresh = url.searchParams.get("fresh") === "1";
    const [d1, st, wr, mq] = await Promise.all([d.d1Traffic(env, fresh).catch(e => ({ error: e.message })), d.storageStatus(env, fresh).catch(e => ({ error: e.message })), workerRequests(env, d.gql), fresh ? d.mailQuota(env).catch(() => null) : metaJson(env, "mail:quota")]);
    const sent = await env.DB.prepare("SELECT COUNT(*) AS n FROM ms_queue WHERE status = 'sent' AND sent_at >= ?").bind(utcDay()).first().catch(() => ({ n: 0 }));
    const wait = await env.DB.prepare("SELECT COUNT(*) AS n FROM ms_queue WHERE status = 'wait'").first().catch(() => ({ n: 0 }));
    const people = (await env.DB.prepare("SELECT t.email, u.full_name, t.sent, t.last_used, t.last_error FROM ms_tokens t LEFT JOIN users u ON u.email = t.email WHERE t.refresh != '' ORDER BY t.sent DESC").all().catch(() => ({ results: [] }))).results || [];
    const ai = Number(await metaGet(env, `ai:neu:${utcDay()}`)) || 0, aiFree = Math.max(500, Number(env.AI_DAILY_NEURONS) || 10000);
    const aiDays = [];
    for (let i = 6; i >= 0; i--) { const k = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10); aiDays.push({ day: k, used: Math.round(Number(await metaGet(env, `ai:neu:${k}`)) || 0) }); }
    return { d1, storage: st, workers: wr, mail: { relay: mq, relaySet: !!env.MAIL_RELAY_URL, outlookSent: Number(sent.n) || 0, waiting: Number(wait.n) || 0, auto: (await metaGet(env, "ms:auto")) || "", secretExp: (await metaGet(env, "ms:secret_exp")) || "", people },
      ai: { used: Math.round(ai), free: aiFree, closeAt: Math.round(aiFree * .8), days: aiDays }, sms: { set: !!(env.TWILIO_SID && env.TWILIO_TOKEN) } };
  }
  if (a === "cc/systems") {
    const sys = await systems(env, d, url.searchParams.get("fresh") === "1");
    return { ...sys, secrets: SECRETS.map(([k, use, req]) => ({ name: k, use, required: req, set: !!env[k] })), jobs: await jobs(env, d) };
  }
  /* Landing page of the Admin Control Center: one arrangement shared by every administrator (Oct 2026) */
  if (a === "cc/landing" && method === "GET") return { layout: await metaJson(env, "admin:landing") };
  if (a === "cc/tools" && method === "GET") {
    const cfg = await toolsCfg(env), since = new Date(Date.now() - 7 * 864e5).toISOString();
    const use = ((await env.DB.prepare("SELECT app, COUNT(*) AS n, COUNT(DISTINCT email) AS people FROM usage_log WHERE at >= ? GROUP BY app").bind(since).all()).results || []);
    return { cfg, usage: Object.fromEntries(use.map(r => [r.app, { n: r.n, people: r.people }])), keys: ACCESS_KEYS };
  }
  if (a === "cc/data" && method === "GET") {
    const fresh = url.searchParams.get("fresh") === "1";
    let sizes = await metaJson(env, "cc:tables");
    if (fresh || !sizes) {
      const T = ((await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").all()).results || []).map(r => r.name);
      const out = [];
      for (const t of T) { const r = await env.DB.prepare(`SELECT COUNT(*) AS n FROM "${t.replace(/"/g, "")}"`).first().catch(() => null); out.push({ name: t, rows: r ? Number(r.n) : null }); }
      sizes = { at: new Date().toISOString(), tables: out.sort((x, y) => (y.rows || 0) - (x.rows || 0)) };
      await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('cc:tables', ?)").bind(JSON.stringify(sizes)).run().catch(() => {});
    }
    const old = new Date(Date.now() - 90 * 864e5).toISOString(), year = new Date(Date.now() - 365 * 864e5).toISOString();
    const clean = { events: Number((await env.DB.prepare("SELECT COUNT(*) AS n FROM hub_events WHERE at < ?").bind(old).first()).n) || 0,
      usage: Number((await env.DB.prepare("SELECT COUNT(*) AS n FROM usage_log WHERE at < ?").bind(year).first()).n) || 0,
      signins: Number((await env.DB.prepare("SELECT COUNT(*) AS n FROM admin_signins WHERE at < ?").bind(old).first()).n) || 0,
      queue: Number((await env.DB.prepare("SELECT COUNT(*) AS n FROM ms_queue WHERE status = 'sent' AND sent_at < ?").bind(old.slice(0, 10)).first().catch(() => ({ n: 0 }))).n) || 0 };
    return { sizes, clean, backup: await metaJson(env, "backup:last"), storage: await d.storageStatus(env).catch(() => null) };
  }
  if (method !== "POST") throw err("Unknown request", 404);
  /* ---------- actions ---------- */
  const target = async () => { const e = String(b.email || "").trim().toLowerCase(); const u = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(e).first(); if (!u) throw err("No such user", 404); return u; };
  const log = (action, label, ref = "") => d.audit(env, { me, site: "", tool: "admin", ref, label, action, changes: [] }).catch(() => {});
  if (a === "cc/unlock") { const u = await target(); await env.DB.prepare("UPDATE users SET fail_count = 0, locked_until = '' WHERE email = ?").bind(u.email).run(); await log("unlock", `Unlocked ${u.full_name}`, u.email); return { done: true }; }
  if (a === "cc/signout") { const u = await target(); await env.DB.prepare("UPDATE users SET signout_at = ? WHERE email = ?").bind(Date.now(), u.email).run(); await log("sign out", `Signed ${u.full_name} out of every device`, u.email); return { done: true, self: u.email === me.email }; }
  if (a === "cc/signout-all") {
    await env.DB.prepare("UPDATE users SET signout_at = ? WHERE email != ?").bind(Date.now(), me.email).run();
    await log("sign out", "Signed everyone out (except the admin who did it)"); return { done: true };
  }
  if (a === "cc/viewas") {
    const u = await target(); if (!u.active) throw err("This account is switched off");
    if (u.email === me.email) throw err("That is you");
    await log("view as", `Viewed the hub as ${u.full_name}`, u.email);
    return { cookie: await d.viewAsCookie(env, me.email, u.email), name: u.full_name };
  }
  if (a === "cc/landing") {
    if (b.reset) { await env.DB.prepare("DELETE FROM meta WHERE k = 'admin:landing'").run(); await log("landing", "Admin Control landing page reset to the standard arrangement"); return { layout: null }; }
    const L = cleanLanding(b.layout || {});
    L.at = new Date().toISOString(); L.by = me.full_name || me.email;
    await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('admin:landing', ?)").bind(JSON.stringify(L)).run();
    await log("landing", `Admin Control landing page arranged · ${L.sections.length} sections${L.shortcuts.length ? ` · ${L.shortcuts.length} shortcuts` : ""}`);
    return { layout: L };
  }
  if (a === "cc/tools") {
    const id = clip(b.id, 40); if (!/^[\w-]+$/.test(id)) throw err("Choose a tool");
    const cfg = { ...(await toolsCfg(env)) }, c = { ...(cfg[id] || {}) };
    if ("off" in b) c.off = !!b.off;
    if ("group" in b) { const g = clip(b.group, 60); if (g) c.group = g; else delete c.group; }
    if ("access" in b) { const L = Array.isArray(b.access) ? b.access.filter(k => ACCESS_KEYS[k]) : null; if (L) c.access = L; else delete c.access; }
    if ("name" in b) { const n = clip(b.name, 60); if (n) c.name = n; else delete c.name; }
    if (!c.off) delete c.off;
    if (Object.keys(c).length) cfg[id] = c; else delete cfg[id];
    await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('tools:cfg', ?)").bind(JSON.stringify(cfg)).run();
    TCFG = cfg; TCFG_AT = Date.now();
    await log("tools", `Tool ${id}: ${c.off ? "switched off" : "on"}${c.group ? " · folder " + c.group : ""}${c.access ? " · seen by " + c.access.join(", ") : ""}`, id);
    return { cfg };
  }
  if (a === "cc/run") {
    const j = String(b.job || "");
    const D = { ...d.jobDeps };
    if (j === "pm") { await env.DB.prepare("DELETE FROM meta WHERE k = 'pm:run'").run(); await d.pmRun(env, D); await log("run", "Ran Preventive Maintenance job"); return { done: "Preventive Maintenance job ran" }; }
    if (j === "mk") { await env.DB.prepare("DELETE FROM meta WHERE k = 'mk:run'").run(); await d.mkRun(env, D); await log("run", "Ran Marketing reminders job"); return { done: "Marketing reminders job ran" }; }
    if (j === "outlook") { await d.outlookRun(env); return { done: "Outlook queue processed" }; }
    if (j === "storage") { await d.d1Traffic(env, true).catch(() => {}); await d.storageStatus(env, true).catch(() => {}); await env.DB.prepare("DELETE FROM meta WHERE k = 'cc:wreq'").run(); return { done: "Usage read again" }; }
    throw err("Unknown job");
  }
  if (a === "cc/clean") {
    const old = new Date(Date.now() - 90 * 864e5).toISOString(), year = new Date(Date.now() - 365 * 864e5).toISOString(), w = String(b.what || "");
    const q = { events: ["DELETE FROM hub_events WHERE at < ?", old], usage: ["DELETE FROM usage_log WHERE at < ?", year], signins: ["DELETE FROM admin_signins WHERE at < ?", old], queue: ["DELETE FROM ms_queue WHERE status = 'sent' AND sent_at < ?", old.slice(0, 10)] }[w];
    if (!q) throw err("Choose what to clean");
    const r = await env.DB.prepare(q[0]).bind(q[1]).run();
    await env.DB.prepare("DELETE FROM meta WHERE k = 'cc:tables'").run();
    await log("clean", `Cleaned ${w} (${r.meta && r.meta.changes || 0} rows)`);
    return { removed: r.meta && r.meta.changes || 0 };
  }
  throw err("Unknown request", 404);
}

/* ---------- cron: heartbeat, hourly health check, red alerts to the administrators (once a day per problem) ---------- */
export async function admRun(env, d) {
  const beat = await metaGet(env, "cron:beat");
  if (!beat || Date.now() - Date.parse(beat) > 8 * 60000) await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('cron:beat', ?)").bind(new Date().toISOString()).run();
  const hk = "cc:check:" + new Date().toISOString().slice(0, 13);
  const c = await env.DB.prepare("INSERT OR IGNORE INTO meta (k, v) VALUES (?, ?)").bind(hk, "1").run().catch(() => null);
  if (!c || !c.meta || c.meta.changes !== 1) return;
  await env.DB.prepare("DELETE FROM meta WHERE k >= 'cc:check:' AND k < 'cc:check;' AND k < ?").bind("cc:check:" + new Date(Date.now() - 864e5).toISOString().slice(0, 13)).run().catch(() => {});
  const hour = d.hour(); if (hour < 7 || hour > 22) return;   // no alerts at night
  await systems(env, d, true);
  const o = await overview(env, d);
  const day = d.today(), admins = ((await env.DB.prepare("SELECT email FROM users WHERE (role = 'ADMIN' OR is_admin = 1) AND active = 1").all()).results || []).map(r => r.email);
  for (const a of o.alerts.filter(x => x.tone === "bad")) {
    const k = `cc:alerted:${day}:${a.key}`;
    const r = await env.DB.prepare("INSERT OR IGNORE INTO meta (k, v) VALUES (?, ?)").bind(k, "1").run().catch(() => null);
    if (r && r.meta && r.meta.changes === 1) for (const ad of admins) await d.raiseEvent(env, { app: "admin", email: ad, tone: "warn", title: `⚠ ${a.title}`, body: (a.sub ? a.sub + " · " : "") + "Admin Control Center" }).catch(() => {});
  }
  if (!(await metaGet(env, "cc:clean:" + day))) {
    await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES (?, '1')").bind("cc:clean:" + day).run().catch(() => {});
    await env.DB.prepare("DELETE FROM meta WHERE k >= 'cc:alerted:' AND k < ?").bind("cc:alerted:" + day).run().catch(() => {});
    await env.DB.prepare("DELETE FROM meta WHERE k >= 'cc:clean:' AND k < ?").bind("cc:clean:" + day).run().catch(() => {});
    await env.DB.prepare("DELETE FROM admin_signins WHERE at < ?").bind(new Date(Date.now() - 180 * 864e5).toISOString()).run().catch(() => {});
  }
}
