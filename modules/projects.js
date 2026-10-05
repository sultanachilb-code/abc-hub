/* =====================================================================
   PROJECTS — Operations Future Projects + Project Tracker (kept separate so it can be removed cleanly)
   See docs/FEATURE-projects.md

   One list per flagship, two views:
     • Future projects — ideas and plans: Idea → Planned → Approved
     • Project tracker — In progress / On hold / Completed, with milestones, progress, budget vs spent
   A project can be linked to its CAPEX line in Budget (CAPEX / OPEX), so the budget is read from there.
   Late alerts (once): project past its due date, milestone due today or overdue.
   Tables : projects
   Routes : /api/ops/proj/*      Page : /tools/projects
   ===================================================================== */

const err = (m, status = 400) => Object.assign(new Error(m), { status });
const clip = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
const isDay = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));
const num = v => { const n = Number(String(v ?? "").replace(/[, ]/g, "")); return Number.isFinite(n) && String(v ?? "").trim() !== "" ? Math.round(n * 100) / 100 : null; };
export const STAGES = ["Idea", "Planned", "Approved", "In progress", "On hold", "Completed", "Cancelled"];
const FUTURE = ["Idea", "Planned", "Approved"];
const CATS = ["CAPEX", "OPEX", "Maintenance", "Safety & compliance", "Customer experience", "Energy saving", "Tenant related", "Other"];
const PRIO = ["High", "Medium", "Low"];

export async function projectsSchema(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS projects (id INTEGER PRIMARY KEY AUTOINCREMENT, site TEXT NOT NULL, title TEXT NOT NULL, stage TEXT NOT NULL DEFAULT 'Idea',
      category TEXT NOT NULL DEFAULT '', priority TEXT NOT NULL DEFAULT 'Medium', owner TEXT NOT NULL DEFAULT '', contractor TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '',
      start_day TEXT NOT NULL DEFAULT '', due_day TEXT NOT NULL DEFAULT '', done_day TEXT NOT NULL DEFAULT '', budget REAL, spent REAL, currency TEXT NOT NULL DEFAULT 'USD',
      budget_year INTEGER NOT NULL DEFAULT 0, budget_key TEXT NOT NULL DEFAULT '', progress INTEGER NOT NULL DEFAULT 0, descr TEXT NOT NULL DEFAULT '',
      milestones TEXT NOT NULL DEFAULT '[]', updates TEXT NOT NULL DEFAULT '[]', seq INTEGER NOT NULL DEFAULT 0,
      created_at TEXT, created_name TEXT, updated_at TEXT, updated_name TEXT, deleted INTEGER NOT NULL DEFAULT 0)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS projects_site ON projects (site, deleted)`)
  ]);
}

const J = (s, d) => { try { return JSON.parse(s || ""); } catch { return d; } };
function out(r, today, lines) {
  const ms = J(r.milestones, []), up = J(r.updates, []);
  const doneMs = ms.filter(m => m.done).length;
  const progress = ms.length ? Math.round(doneMs / ms.length * 100) : r.progress;
  const active = !["Completed", "Cancelled"].includes(r.stage);
  const late = active && r.due_day && r.due_day < today;
  const msLate = active ? ms.filter(m => !m.done && m.due && m.due < today).length : 0;
  const line = r.budget_key && lines ? lines.get(r.budget_year + "|" + r.budget_key) : null;
  const rag = !active ? "" : late || msLate > 1 ? "red" : msLate || (r.budget != null && r.spent != null && r.spent > r.budget) ? "amber" : "green";
  return { id: r.id, title: r.title, stage: r.stage, category: r.category, priority: r.priority, owner: r.owner, contractor: r.contractor, location: r.location,
    start: r.start_day, due: r.due_day, doneDay: r.done_day, budget: r.budget, spent: r.spent, currency: r.currency, budgetYear: r.budget_year, budgetKey: r.budget_key,
    budgetLine: line ? { title: line.title, budget: line.budget, landing: line.landing, co3: line.co3 } : null,
    progress, autoProgress: ms.length > 0, desc: r.descr, milestones: ms, updates: up.slice(-30).reverse(), late, msLate, rag, future: FUTURE.includes(r.stage),
    updatedName: r.updated_name || "", updatedAt: r.updated_at || "", createdName: r.created_name || "" };
}
async function capexLines(env, site) {
  const { results } = await env.DB.prepare("SELECT year, title, bu, obj, sub, co1, co3, budget, landing FROM budget_lines WHERE site = ? AND kind = 'capex' ORDER BY year DESC, seq").bind(site).all().catch(() => ({ results: [] }));
  const key = l => [l.bu, l.obj, l.sub, l.co1, l.co3, l.title].map(x => String(x || "").trim().toLowerCase()).join("|");   // same identity as Budget
  const m = new Map();
  for (const l of results || []) m.set(l.year + "|" + key(l), { year: l.year, key: key(l), title: l.title, budget: l.budget, landing: l.landing, co3: l.co3 });
  return m;
}

export async function projectsRun(env, deps) {
  const today = deps.today();
  const { results } = await env.DB.prepare("SELECT * FROM projects WHERE deleted = 0 AND stage IN ('Approved','In progress','On hold')").all().catch(() => ({ results: [] }));
  for (const r of results || []) {
    const fire = async (key, title, body, tone) => {
      const claim = await env.DB.prepare("INSERT OR IGNORE INTO meta (k, v) VALUES (?, ?)").bind(key, deps.now()).run();
      if (claim.meta && claim.meta.changes === 1) await deps.raiseEvent(env, { site: r.site, app: "projects", tone, title, body });
    };
    if (r.due_day && r.due_day < today) await fire(`proj:late:${r.id}:${r.due_day}`, `Project overdue · ${r.title}`, `Due ${r.due_day}${r.owner ? " · " + r.owner : ""} — update the due date or close it.`, "warn");
    for (const m of J(r.milestones, [])) {
      if (m.done || !m.due) continue;
      if (m.due === today) await fire(`proj:ms:${r.id}:${m.due}:${m.text}`.slice(0, 200), `Milestone due today · ${r.title}`, m.text, "info");
      else if (m.due < today) await fire(`proj:msl:${r.id}:${m.due}:${m.text}`.slice(0, 200), `Milestone overdue · ${r.title}`, `${m.text} — due ${m.due}`, "warn");
    }
  }
}

function clean(b, me, now, cur) {
  const title = clip(b.title, 160);
  if (!title) throw err("Name the project");
  const stage = STAGES.includes(b.stage) ? b.stage : "Idea";
  const ms = (Array.isArray(b.milestones) ? b.milestones : []).slice(0, 40).map(m => ({ text: clip(m.text, 200), due: isDay(m.due) ? m.due : "", done: !!m.done,
    doneAt: m.done ? (m.doneAt || now.slice(0, 10)) : "" })).filter(m => m.text);
  const r = { title, stage, category: CATS.includes(b.category) ? b.category : "", priority: PRIO.includes(b.priority) ? b.priority : "Medium",
    owner: clip(b.owner, 120), contractor: clip(b.contractor, 160), location: clip(b.location, 160),
    start_day: isDay(b.start) ? b.start : "", due_day: isDay(b.due) ? b.due : "", budget: num(b.budget), spent: num(b.spent), currency: b.currency === "LBP" ? "LBP" : "USD",
    budget_year: Number(b.budgetYear) || 0, budget_key: clip(b.budgetKey, 400), progress: Math.max(0, Math.min(100, Math.round(Number(b.progress) || 0))), descr: clip(b.desc, 3000),
    milestones: JSON.stringify(ms) };
  if (r.due_day && r.start_day && r.due_day < r.start_day) throw err("The due date is before the start date");
  r.done_day = stage === "Completed" ? (cur && cur.done_day) || now.slice(0, 10) : "";
  if (stage === "Completed") r.progress = 100;
  return r;
}

export async function projectsRoute(env, p, method, b, url, d) {
  const { site, me } = d;
  if (!d.canSite(me, site)) throw err("No access to this flagship", 403);
  const team = d.full || (me.role === "SUPERVISOR" && me.position !== "WH");
  const today = d.today();
  const one = async id => { const r = await env.DB.prepare("SELECT * FROM projects WHERE id = ? AND site = ? AND deleted = 0").bind(Number(id) || 0, site).first(); if (!r) throw err("Not found", 404); return r; };

  if (p === "proj/list") {
    const [{ results }, lines] = await Promise.all([env.DB.prepare("SELECT * FROM projects WHERE site = ? AND deleted = 0 ORDER BY seq, id").bind(site).all(), capexLines(env, site)]);
    const list = (results || []).map(r => out(r, today, lines));
    return { list, today, stages: STAGES, future: FUTURE, cats: CATS, prio: PRIO, budgetLines: [...lines.values()].map(l => ({ year: l.year, key: l.key, title: l.title, budget: l.budget, co3: l.co3 })), can: { edit: team } };
  }

  if (method !== "POST") throw err("Unknown request", 404);
  if (!team) throw err("Only the operations team can change projects", 403);
  const now = d.now();

  if (p === "proj/save") {
    const cur = b.id ? await one(b.id) : null;
    const r = clean(b, me, now, cur);
    const cols = Object.keys(r);
    if (cur) {
      if (cur.stage !== r.stage) {   // keep a line in the updates log when the stage changes
        const up = J(cur.updates, []); up.push({ at: now, by: me.full_name, text: `Stage: ${cur.stage} → ${r.stage}` }); r.updates = JSON.stringify(up.slice(-200));
      }
      const c2 = Object.keys(r);
      await env.DB.prepare(`UPDATE projects SET ${c2.map(c => c + " = ?").join(", ")}, updated_at = ?, updated_name = ? WHERE id = ?`).bind(...c2.map(c => r[c]), now, me.full_name, cur.id).run();
      if (d.audit) await d.audit(env, { site, tool: "projects", ref: cur.id, label: r.title, action: "edit", before: Object.fromEntries(cols.map(k => [k, cur[k]])), after: Object.fromEntries(cols.map(k => [k, r[k]])) });
      return { id: cur.id };
    }
    const res = await env.DB.prepare(`INSERT INTO projects (site, ${cols.join(", ")}, seq, created_at, created_name, updated_at, updated_name) VALUES (?, ${cols.map(() => "?").join(", ")}, ?, ?, ?, ?, ?)`)
      .bind(site, ...cols.map(c => r[c]), Date.now() % 1e9, now, me.full_name, now, me.full_name).run();
    if (d.audit) await d.audit(env, { site, tool: "projects", ref: res.meta.last_row_id, label: r.title, action: "add", after: { title: r.title, stage: r.stage, due: r.due_day, budget: r.budget } });
    if (r.stage === "Approved" || r.stage === "In progress") await d.raiseEvent(env, { site, app: "projects", tone: "info", title: `New project · ${r.title}`, body: `${r.stage}${r.due_day ? " · due " + r.due_day : ""} · by ${me.full_name}` });
    return { id: res.meta.last_row_id };
  }
  if (p === "proj/note") {   // a progress update (and optional progress % / spent)
    const cur = await one(b.id);
    const text = clip(b.text, 1000);
    if (!text) throw err("Write the update");
    const up = J(cur.updates, []); up.push({ at: now, by: me.full_name, text });
    const spent = num(b.spent), prog = b.progress === undefined || b.progress === "" ? cur.progress : Math.max(0, Math.min(100, Math.round(Number(b.progress) || 0)));
    await env.DB.prepare("UPDATE projects SET updates = ?, progress = ?, spent = COALESCE(?, spent), updated_at = ?, updated_name = ? WHERE id = ?")
      .bind(JSON.stringify(up.slice(-200)), prog, spent, now, me.full_name, cur.id).run();
    return { ok: true };
  }
  if (p === "proj/milestone") {   // tick a milestone from the tracker
    const cur = await one(b.id);
    const ms = J(cur.milestones, []); const m = ms[Number(b.index)];
    if (!m) throw err("Not found", 404);
    m.done = !!b.done; m.doneAt = m.done ? today : "";
    const up = J(cur.updates, []); up.push({ at: now, by: me.full_name, text: `${m.done ? "✓" : "↺"} ${m.text}` });
    await env.DB.prepare("UPDATE projects SET milestones = ?, updates = ?, updated_at = ?, updated_name = ? WHERE id = ?").bind(JSON.stringify(ms), JSON.stringify(up.slice(-200)), now, me.full_name, cur.id).run();
    return { ok: true };
  }
  if (p === "proj/stage") {   // drag on the board / quick move
    const cur = await one(b.id);
    if (!STAGES.includes(b.stage)) throw err("Unknown stage");
    const up = J(cur.updates, []); up.push({ at: now, by: me.full_name, text: `Stage: ${cur.stage} → ${b.stage}` });
    await env.DB.prepare("UPDATE projects SET stage = ?, done_day = ?, progress = CASE WHEN ? = 'Completed' THEN 100 ELSE progress END, updates = ?, updated_at = ?, updated_name = ? WHERE id = ?")
      .bind(b.stage, b.stage === "Completed" ? today : "", b.stage, JSON.stringify(up.slice(-200)), now, me.full_name, cur.id).run();
    if (d.audit) await d.audit(env, { site, tool: "projects", ref: cur.id, label: cur.title, action: "edit", before: { stage: cur.stage }, after: { stage: b.stage } });
    return { ok: true };
  }
  if (p === "proj/delete") {
    const cur = await one(b.id);
    await env.DB.prepare("UPDATE projects SET deleted = 1, updated_at = ?, updated_name = ? WHERE id = ?").bind(now, me.full_name, cur.id).run();
    if (d.audit) await d.audit(env, { site, tool: "projects", ref: cur.id, label: cur.title, action: "delete", before: { title: cur.title, stage: cur.stage } });
    return { deleted: true };
  }
  throw err("Unknown request", 404);
}
