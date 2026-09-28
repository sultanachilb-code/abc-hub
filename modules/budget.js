/* =====================================================================
   BUDGET (CAPEX / OPEX) — feature module (kept separate so it can be removed cleanly)
   See docs/FEATURE-budget.md

   Each flagship uploads two Excel sheets per year — CAPEX and OPEX — straight
   from JDE or edited. Only the known columns are kept, so every flagship ends
   up in the same format. Picking a line and pressing "Use" builds the
   JDE request table (Topic, Description, Cost allocation, Object / Subsidiary
   account, Budget, Remaining, CO1, CO3) ready to copy.

   Tables : budget_lines · budget_uses
   Routes : /api/ops/budget/*
   ===================================================================== */

const clip = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
const err = (m, status = 400) => Object.assign(new Error(m), { status });
const num = v => { const n = Number(String(v ?? "").replace(/[, ]/g, "")); return Number.isFinite(n) ? Math.round(n * 100) / 100 : null; };
const KINDS = ["capex", "opex"];

export async function budgetSchema(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS budget_lines (id INTEGER PRIMARY KEY AUTOINCREMENT, site TEXT NOT NULL, kind TEXT NOT NULL, year INTEGER NOT NULL,
      seq INTEGER NOT NULL DEFAULT 0, title TEXT NOT NULL DEFAULT '', bu TEXT NOT NULL DEFAULT '', obj TEXT NOT NULL DEFAULT '', sub TEXT NOT NULL DEFAULT '',
      co1 TEXT NOT NULL DEFAULT '', co3 TEXT NOT NULL DEFAULT '', co3_desc TEXT NOT NULL DEFAULT '', budget REAL, fct REAL, landing REAL, notes TEXT NOT NULL DEFAULT '')`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS budget_lines_site ON budget_lines (site, kind, year)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS budget_uses (id INTEGER PRIMARY KEY AUTOINCREMENT, site TEXT NOT NULL, kind TEXT NOT NULL, year INTEGER NOT NULL,
      line_key TEXT NOT NULL, topic TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', amount REAL, by_email TEXT, by_name TEXT, at TEXT)`)
  ]);
}
/* a line keeps its identity across re-uploads through its account codes (not its row id) */
const keyOf = l => [l.bu, l.obj, l.sub, l.co1, l.co3, l.title].map(x => String(x || "").trim().toLowerCase()).join("|");

function cleanLine(kind, r) {
  const o = { title: clip(r.title, 200), bu: clip(r.bu, 12), obj: clip(r.obj, 12), sub: clip(r.sub, 12), co1: clip(r.co1, 12), co3: clip(r.co3, 12),
    co3Desc: clip(r.co3Desc, 120), budget: num(r.budget), fct: num(r.fct), landing: num(r.landing), notes: clip(r.notes, 300) };
  if (kind === "capex" && !o.title) return null;              // the total row has no project name
  if (kind === "opex" && !o.obj) return null;
  return o;
}
const lineOut = (l, used) => ({ id: l.id, key: keyOf({ ...l, co3Desc: l.co3_desc }), title: l.title, bu: l.bu, obj: l.obj, sub: l.sub, co1: l.co1, co3: l.co3, co3Desc: l.co3_desc,
  budget: l.budget, fct: l.fct, landing: l.landing, notes: l.notes, used: used || 0 });

/* ctx = { site, can, me, now } — can.budget: see; can.budgetLead: upload */
export async function budgetRoute(env, p, method, b, url, ctx) {
  const { site, can, me, now } = ctx;
  const q = k => url.searchParams.get(k);
  if (!can.budget) throw err("The budget is visible to managers and supervisors", 403);
  const kindOf = v => { if (!KINDS.includes(v)) throw err("Choose CAPEX or OPEX"); return v; };
  const yearOf = v => { const y = Number(v); if (!(y >= 2020 && y <= 2100)) throw err("Choose the year"); return y; };

  if (p === "budget/get") {
    const kind = kindOf(q("kind")), year = yearOf(q("year"));
    const [lines, uses, info, years] = await Promise.all([
      env.DB.prepare("SELECT * FROM budget_lines WHERE site = ? AND kind = ? AND year = ? ORDER BY seq, id").bind(site, kind, year).all(),
      env.DB.prepare("SELECT line_key, SUM(COALESCE(amount, 0)) AS s FROM budget_uses WHERE site = ? AND kind = ? AND year = ? GROUP BY line_key").bind(site, kind, year).all(),
      env.DB.prepare("SELECT v FROM ops_settings WHERE site = ? AND k = ?").bind(site, `budget_upload_${kind}_${year}`).first(),
      env.DB.prepare("SELECT DISTINCT year FROM budget_lines WHERE site = ? ORDER BY year DESC").bind(site).all()
    ]);
    const used = new Map((uses.results || []).map(u => [u.line_key, u.s]));
    return { kind, year, can: { upload: !!can.budgetLead, use: !!can.budget }, upload: info ? JSON.parse(info.v) : null,
      years: (years.results || []).map(y => y.year), lines: (lines.results || []).map(l => { const o = lineOut(l); o.used = used.get(o.key) || 0; return o; }) };
  }
  if (p === "budget/upload" && method === "POST") {
    if (!can.budgetLead) throw err("Only flagship management and leadership can upload the budget", 403);
    const kind = kindOf(b.kind), year = yearOf(b.year);
    const rows = (Array.isArray(b.lines) ? b.lines : []).map(r => cleanLine(kind, r)).filter(Boolean);
    if (!rows.length) throw err("No budget lines were found in the sheet");
    if (rows.length > 3000) throw err("The sheet has too many rows");
    const ops = [env.DB.prepare("DELETE FROM budget_lines WHERE site = ? AND kind = ? AND year = ?").bind(site, kind, year),
      ...rows.map((r, i) => env.DB.prepare(`INSERT INTO budget_lines (site, kind, year, seq, title, bu, obj, sub, co1, co3, co3_desc, budget, fct, landing, notes)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(site, kind, year, (i + 1) * 10, r.title, r.bu, r.obj, r.sub, r.co1, r.co3, r.co3Desc, r.budget, r.fct, r.landing, r.notes))];
    for (let i = 0; i < ops.length; i += 90) await env.DB.batch(ops.slice(i, i + 90));
    const info = { fileName: clip(b.fileName, 120), by: me.full_name, at: now(), count: rows.length,
      total: rows.reduce((s, r) => s + (r.budget || 0), 0) };
    await env.DB.prepare("INSERT INTO ops_settings (site, k, v) VALUES (?,?,?) ON CONFLICT(site, k) DO UPDATE SET v = excluded.v")
      .bind(site, `budget_upload_${kind}_${year}`, JSON.stringify(info)).run();
    return info;
  }
  /* "Use" → keep a record of the request (and its amount, for the remaining OPEX budget) */
  if (p === "budget/use" && method === "POST") {
    const kind = kindOf(b.kind), year = yearOf(b.year);
    const l = await env.DB.prepare("SELECT * FROM budget_lines WHERE id = ? AND site = ?").bind(Number(b.id), site).first();
    if (!l) throw err("This budget line no longer exists — the sheet was re-uploaded", 404);
    const topic = clip(b.topic, 200);
    if (!topic) throw err("Write the topic / title");
    const amount = num(b.amount);
    const r = await env.DB.prepare(`INSERT INTO budget_uses (site, kind, year, line_key, topic, description, amount, by_email, by_name, at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .bind(site, kind, year, keyOf({ ...l, co3Desc: l.co3_desc }), topic, clip(b.description, 2000), amount && amount > 0 ? amount : null, me.email, me.full_name, now()).run();
    return { id: r.meta && r.meta.last_row_id, saved: true };
  }
  if (p === "budget/uses") {
    const kind = kindOf(q("kind")), year = yearOf(q("year"));
    const { results } = await env.DB.prepare("SELECT * FROM budget_uses WHERE site = ? AND kind = ? AND year = ? ORDER BY at DESC LIMIT 300").bind(site, kind, year).all();
    return { uses: (results || []).map(u => ({ id: u.id, key: u.line_key, topic: u.topic, description: u.description, amount: u.amount, by: u.by_name, byEmail: u.by_email, at: u.at })) };
  }
  if (p === "budget/uses/remove" && method === "POST") {
    const u = await env.DB.prepare("SELECT * FROM budget_uses WHERE id = ? AND site = ?").bind(Number(b.id), site).first();
    if (!u) throw err("Already removed", 404);
    if (u.by_email !== me.email && !can.budgetLead) throw err("Only the person who made the request, or a manager, can remove it", 403);
    await env.DB.prepare("DELETE FROM budget_uses WHERE id = ?").bind(u.id).run();
    return { removed: true };
  }
  throw err("Unknown endpoint", 404);
}
