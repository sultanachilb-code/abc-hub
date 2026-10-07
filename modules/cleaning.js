/* =====================================================================
   CLEANING HEADCOUNT CONTROL — the cleaning provider's punching record (PDF from its time-attendance system)
   is read on the page and checked against the cleaning contract:
   the agreed headcount per day, the minimum on duty at any time during the cover hours (no fixed shifts), missing punches, long shifts.
   The page reads the PDF; the hub keeps the parsed punches per period and the plan per flagship.
   See docs/FEATURE-cleaning-control.md · Routes: /api/ops/cl/*
   ===================================================================== */
const err = (m, status = 400) => Object.assign(new Error(m), { status });
const clip = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
/* the contract: no fixed shifts — an agreed headcount per day and a minimum on duty during the cover hours (typed on the page) */
const DEFAULT = { provider: "BPM", headcount: 0, minOnDuty: 0, coverFrom: "10:00", coverTo: "22:00", maxHours: 13 };

export async function cleaningSchema(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS cl_settings (site TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT, updated_name TEXT)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS cl_reports (id INTEGER PRIMARY KEY AUTOINCREMENT, site TEXT NOT NULL, provider TEXT NOT NULL DEFAULT '',
      day_from TEXT NOT NULL, day_to TEXT NOT NULL, file_name TEXT NOT NULL DEFAULT '', rows TEXT NOT NULL, staff INTEGER NOT NULL DEFAULT 0,
      created_at TEXT, created_name TEXT)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS cl_reports_site ON cl_reports (site, day_to)`)
  ]);
  try { await env.DB.prepare("ALTER TABLE cl_reports ADD COLUMN printed TEXT NOT NULL DEFAULT ''").run(); } catch {}   // when the record was printed (shifts not started yet are not counted)
}
const settingsOf = async (env, site) => {
  const r = await env.DB.prepare("SELECT data, updated_at, updated_name FROM cl_settings WHERE site = ?").bind(site).first();
  try { return r ? { ...DEFAULT, ...JSON.parse(r.data), updatedAt: r.updated_at, updatedBy: r.updated_name } : { ...DEFAULT }; } catch { return { ...DEFAULT }; }
};

export async function cleaningRoute(env, p, method, b, url, d) {
  const { site, me, can, now, siteName } = d;
  const DB = env.DB, edit = !!(can.mom || can.handover), plan = !!(can.feedbackAdmin || can.mom);

  if (p === "cl/data" && method === "GET") {
    const { results } = await DB.prepare("SELECT id, provider, day_from, day_to, file_name, staff, created_at, created_name FROM cl_reports WHERE site = ? ORDER BY day_to DESC, id DESC LIMIT 60").bind(site).all();
    return { site, siteName: siteName(site), can: { edit, plan }, settings: await settingsOf(env, site),
      reports: (results || []).map(r => ({ id: r.id, provider: r.provider, from: r.day_from, to: r.day_to, file: r.file_name, staff: r.staff, at: r.created_at, by: r.created_name })) };
  }
  if (p === "cl/report" && method === "GET") {
    const r = await DB.prepare("SELECT * FROM cl_reports WHERE id = ? AND site = ?").bind(Number(url.searchParams.get("id")) || 0, site).first();
    if (!r) throw err("Report not found", 404);
    return { id: r.id, provider: r.provider, from: r.day_from, to: r.day_to, file: r.file_name, printed: r.printed || "", rows: JSON.parse(r.rows || "[]"), at: r.created_at, by: r.created_name };
  }
  if (method !== "POST") throw err("Unknown request", 404);

  if (p === "cl/settings") {
    if (!plan) throw err("Only the operations team can change the contract figures", 403);
    const n = (v, max) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)));
    const data = { provider: clip(b.provider, 60) || "Cleaning provider", headcount: n(b.headcount, 500), minOnDuty: n(b.minOnDuty, 500),
      coverFrom: HM.test(b.coverFrom) ? b.coverFrom : "10:00", coverTo: HM.test(b.coverTo) ? b.coverTo : "22:00", maxHours: n(b.maxHours, 24) || 13 };
    await DB.prepare(`INSERT INTO cl_settings (site, data, updated_at, updated_name) VALUES (?,?,?,?)
      ON CONFLICT(site) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, updated_name = excluded.updated_name`).bind(site, JSON.stringify(data), now(), me.full_name).run();
    return { settings: await settingsOf(env, site) };
  }
  if (!edit) throw err("Not allowed", 403);
  if (p === "cl/save") {
    const day = v => /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "";
    const from = day(b.from), to = day(b.to); if (!from || !to) throw err("The period of the punching record was not found");
    const rows = (Array.isArray(b.rows) ? b.rows : []).slice(0, 600).map(r => ({ no: clip(r.no, 12), name: clip(r.name, 60),
      days: (Array.isArray(r.days) ? r.days : []).slice(0, 62).map(x => ({ day: day(x.day), in: HM.test(x.in) ? x.in : "", out: HM.test(x.out) ? x.out : "", worked: clip(x.worked, 6) })) }))
      .filter(r => r.name && r.days.length);
    if (!rows.length) throw err("No employees were read from the file");
    const json = JSON.stringify(rows); if (json.length > 900000) throw err("This punching record is too large — upload one month at a time");
    /* the same period uploaded again replaces the previous upload */
    await DB.prepare("DELETE FROM cl_reports WHERE site = ? AND day_from = ? AND day_to = ?").bind(site, from, to).run();
    const printed = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(b.printed || "") ? b.printed : "";
    const r = await DB.prepare("INSERT INTO cl_reports (site, provider, day_from, day_to, file_name, rows, staff, created_at, created_name, printed) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .bind(site, clip(b.provider, 60), from, to, clip(b.file, 120), json, rows.length, now(), me.full_name, printed).run();
    return { id: r.meta.last_row_id };
  }
  if (p === "cl/delete") {
    if (!plan) throw err("Not allowed", 403);
    await DB.prepare("DELETE FROM cl_reports WHERE id = ? AND site = ?").bind(Number(b.id) || 0, site).run();
    return { ok: true };
  }
  throw err("Unknown request", 404);
}
