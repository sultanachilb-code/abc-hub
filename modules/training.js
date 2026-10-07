/* =====================================================================
   TRAINING & INDUCTION TRACKER — who completed which training, when it expires, and who still needs it.
   Courses are shared by all flagships (name, category, validity in months, positions that must have it);
   records are per person at the flagship: hub users, or people outside the hub (security, cleaners…) by name.
   Expiring certificates show in the weekly digest. See docs/FEATURE-training.md · Routes: /api/ops/tr/*
   ===================================================================== */
const err = (m, status = 400) => Object.assign(new Error(m), { status });
const clip = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
const isDay = v => /^\d{4}-\d{2}-\d{2}$/.test(v || "");
/* position keys as in apps.js ACCESS */
export const TR_POS = { MM: "Mall Manager / Senior MM", OM: "Operations Manager / Deputy", SMS: "Senior Mall Supervisor", MS: "Mall Supervisor", MO: "Mall Officer", WH: "Warehouse", SEC: "Security" };
const SEED = [
  ["Health & Safety induction", "Induction", 0, "MM,OM,SMS,MS,MO,WH,SEC"],
  ["Fire warden", "Safety", 12, "SMS,MS,MO,SEC"],
  ["First aid", "Safety", 24, "SMS,MS,MO,SEC"],
  ["Evacuation drill", "Safety", 12, "MM,OM,SMS,MS,MO,WH,SEC"],
  ["ABC Connect portal", "Systems", 0, "MM,OM,SMS,MS,MO"],
  ["Customer service", "Service", 0, "MS,MO,SEC"]
];
export async function trainingSchema(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS tr_courses (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, category TEXT NOT NULL DEFAULT '',
      validity INTEGER NOT NULL DEFAULT 0, required TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1, seq INTEGER NOT NULL DEFAULT 0)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS tr_people (id INTEGER PRIMARY KEY AUTOINCREMENT, site TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL DEFAULT '',
      company TEXT NOT NULL DEFAULT '', pos TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS tr_records (id INTEGER PRIMARY KEY AUTOINCREMENT, site TEXT NOT NULL, person TEXT NOT NULL, course_id INTEGER NOT NULL,
      done_on TEXT NOT NULL, expires_on TEXT NOT NULL DEFAULT '', trainer TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
      created_at TEXT, created_name TEXT)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS tr_records_site ON tr_records (site, person, course_id)`)
  ]);
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM tr_courses").first();
  if (!n || !n.n) await env.DB.batch(SEED.map(([name, cat, v, req], i) => env.DB.prepare("INSERT INTO tr_courses (name, category, validity, required, seq) VALUES (?,?,?,?,?)").bind(name, cat, v, req, i)));
}
const addMonths = (d, m) => { const x = new Date(d + "T12:00:00Z"); x.setUTCMonth(x.getUTCMonth() + m); return x.toISOString().slice(0, 10); };
/* person key: "u:<email>" for hub users, "p:<id>" for people outside the hub */
export async function trainingStatus(env, site, staff, posKey, today) {
  const DB = env.DB;
  const courses = ((await DB.prepare("SELECT * FROM tr_courses WHERE active = 1 ORDER BY seq, name").all()).results) || [];
  const extra = ((await DB.prepare("SELECT * FROM tr_people WHERE site = ? AND active = 1 ORDER BY name").bind(site).all()).results) || [];
  const recs = ((await DB.prepare("SELECT * FROM tr_records WHERE site = ? ORDER BY done_on DESC").bind(site).all()).results) || [];
  const people = [
    ...staff.filter(s => s.atSite || ["MANAGER", "SUPERVISOR", "SECURITY"].includes(s.role)).map(s => ({ key: "u:" + s.email, name: s.name, label: s.positionLabel, pos: posKey(s), email: s.email, hub: true })),
    ...extra.map(p => ({ key: "p:" + p.id, id: p.id, name: p.name, label: [p.role, p.company].filter(Boolean).join(" · "), pos: p.pos, hub: false }))
  ];
  const soon = addMonths(today, 1);
  const cell = (p, c) => {
    const r = recs.find(x => x.person === p.key && x.course_id === c.id);
    const req = String(c.required || "").split(",").includes(p.pos);
    if (!r) return { st: req ? "missing" : "", req };
    const st = r.expires_on && r.expires_on < today ? "expired" : r.expires_on && r.expires_on <= soon ? "soon" : "ok";
    return { st, req, id: r.id, done: r.done_on, exp: r.expires_on, trainer: r.trainer, note: r.note };
  };
  const rows = people.map(p => ({ ...p, cells: Object.fromEntries(courses.map(c => [c.id, cell(p, c)])) }));
  let need = 0, have = 0, soonN = 0, expired = 0, missing = 0;
  for (const r of rows) for (const c of courses) { const x = r.cells[c.id]; if (x.req){ need++; if (x.st === "ok" || x.st === "soon") have++; } if (x.st === "soon") soonN++; if (x.st === "expired") expired++; if (x.st === "missing") missing++; }
  return { courses: courses.map(c => ({ id: c.id, name: c.name, category: c.category, validity: c.validity, required: String(c.required || "").split(",").filter(Boolean) })),
    rows, kpi: { compliance: need ? Math.round(have / need * 100) : 100, soon: soonN, expired, missing, people: rows.length } };
}

export async function trainingRoute(env, p, method, b, url, d) {
  const { site, me, can, now, today, siteName, staff, posKey } = d;
  const DB = env.DB, edit = !!(can.mom || can.handover), admin = !!(can.feedbackAdmin);
  if (p === "tr/data" && method === "GET") {
    return { site, siteName: siteName(site), today: today(), can: { edit, admin }, positions: TR_POS, ...(await trainingStatus(env, site, await staff(env, site), posKey, today())) };
  }
  if (method !== "POST") throw err("Unknown request", 404);
  if (p === "tr/course") {
    if (!admin) throw err("Only management and senior supervisors change the courses", 403);
    const name = clip(b.name, 80); if (!name) throw err("Type the course name");
    const req = (Array.isArray(b.required) ? b.required : []).filter(k => TR_POS[k]).join(",");
    const v = [name, clip(b.category, 40), Math.max(0, Math.min(120, Number(b.validity) || 0)), req, b.active === false ? 0 : 1];
    if (b.id) await DB.prepare("UPDATE tr_courses SET name = ?, category = ?, validity = ?, required = ?, active = ? WHERE id = ?").bind(...v, Number(b.id)).run();
    else await DB.prepare("INSERT INTO tr_courses (name, category, validity, required, active, seq) VALUES (?,?,?,?,?, (SELECT COALESCE(MAX(seq),0)+1 FROM tr_courses))").bind(...v).run();
    return { ok: true };
  }
  if (!edit) throw err("Not allowed", 403);
  if (p === "tr/person") {
    const name = clip(b.name, 80); if (!name) throw err("Type the person's name");
    const pos = TR_POS[b.pos] ? b.pos : "";
    if (b.id) await DB.prepare("UPDATE tr_people SET name = ?, role = ?, company = ?, pos = ?, active = ? WHERE id = ? AND site = ?").bind(name, clip(b.role, 60), clip(b.company, 60), pos, b.active === false ? 0 : 1, Number(b.id), site).run();
    else await DB.prepare("INSERT INTO tr_people (site, name, role, company, pos) VALUES (?,?,?,?,?)").bind(site, name, clip(b.role, 60), clip(b.company, 60), pos).run();
    return { ok: true };
  }
  if (p === "tr/record") {
    const c = await DB.prepare("SELECT * FROM tr_courses WHERE id = ?").bind(Number(b.courseId) || 0).first();
    if (!c) throw err("Choose the course");
    const person = clip(b.person, 140); if (!/^(u:.+@.+|p:\d+)$/.test(person)) throw err("Choose the person");
    if (!isDay(b.done)) throw err("Choose the date the training was done");
    const exp = isDay(b.expires) ? b.expires : c.validity ? addMonths(b.done, c.validity) : "";
    const people = Array.isArray(b.people) && b.people.length ? b.people.filter(x => /^(u:.+@.+|p:\d+)$/.test(x)).slice(0, 80) : [person];   // a whole group trained the same day
    for (const who of people) {
      await DB.prepare("DELETE FROM tr_records WHERE site = ? AND person = ? AND course_id = ? AND done_on = ?").bind(site, who, c.id, b.done).run();
      await DB.prepare("INSERT INTO tr_records (site, person, course_id, done_on, expires_on, trainer, note, created_at, created_name) VALUES (?,?,?,?,?,?,?,?,?)")
        .bind(site, who, c.id, b.done, exp, clip(b.trainer, 80), clip(b.note, 300), now(), me.full_name).run();
    }
    return { ok: true, n: people.length };
  }
  if (p === "tr/record/delete") {
    await DB.prepare("DELETE FROM tr_records WHERE id = ? AND site = ?").bind(Number(b.id) || 0, site).run();
    return { ok: true };
  }
  throw err("Unknown request", 404);
}
