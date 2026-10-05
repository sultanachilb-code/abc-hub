/* =====================================================================
   CHANGE HISTORY — feature module (kept separate so it can be removed cleanly)
   See docs/FEATURE-history.md

   Who changed what, when — before → after — for the tools that hold reference data:
   GLA, Tenants Directory, budget, property details, handover, reminders, people & roles,
   calendar, evacuation plan, contractors, projects.
   Table  : change_log (kept 12 months)
   Routes : /api/admin/history (administrators) · /api/ops/history?tool=&ref= (one record, for people who can see the flagship)
   ===================================================================== */

const clip = (v, n) => String(v == null ? "" : v).slice(0, n);

export async function historySchema(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS change_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, site TEXT NOT NULL DEFAULT '',
      tool TEXT NOT NULL, ref TEXT NOT NULL DEFAULT '', label TEXT NOT NULL DEFAULT '', action TEXT NOT NULL DEFAULT 'edit',
      changes TEXT NOT NULL DEFAULT '[]', by_email TEXT NOT NULL DEFAULT '', by_name TEXT NOT NULL DEFAULT '')`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS change_log_at ON change_log (at)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS change_log_ref ON change_log (tool, ref)`)
  ]);
}

/* field-by-field differences between two plain objects (nested values compared as text) */
const SKIP = new Set(["id", "updated_at", "updatedAt", "updated_name", "updatedName", "updated_by", "created_at", "createdAt", "password_hash", "salt", "pass"]);
function diff(before = {}, after = {}) {
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  const out = [];
  for (const k of keys) {
    if (SKIP.has(k)) continue;
    const a = before ? before[k] : undefined, b = after ? after[k] : undefined;
    const sa = a == null ? "" : typeof a === "object" ? JSON.stringify(a) : String(a);
    const sb = b == null ? "" : typeof b === "object" ? JSON.stringify(b) : String(b);
    if (sa !== sb) out.push({ field: k, from: clip(sa, 300), to: clip(sb, 300) });
  }
  return out.slice(0, 40);
}

/* the logger every tool calls: audit(env, { me, site, tool, ref, label, action, before, after }) */
export function makeAudit(nowIso) {
  return async (env, { me, site = "", tool, ref = "", label = "", action = "edit", before = null, after = null, changes = null }) => {
    try {
      const ch = changes || (action === "add" ? diff({}, after) : action === "delete" ? diff(before, {}) : diff(before, after));
      if (action === "edit" && !ch.length && !changes) return;   // an explicit list (even empty) is always logged
      await env.DB.prepare("INSERT INTO change_log (at, site, tool, ref, label, action, changes, by_email, by_name) VALUES (?,?,?,?,?,?,?,?,?)")
        .bind(nowIso(), site || "", tool, String(ref), clip(label, 200), action, JSON.stringify(ch), me ? me.email : "", me ? me.full_name : "").run();
    } catch (e) { /* history must never block a save */ }
  };
}

export async function historyClean(env) {
  await env.DB.prepare("DELETE FROM change_log WHERE at < ?").bind(new Date(Date.now() - 366 * 864e5).toISOString()).run().catch(() => {});
}

const out = r => ({ id: r.id, at: r.at, site: r.site, tool: r.tool, ref: r.ref, label: r.label, action: r.action,
  changes: (() => { try { return JSON.parse(r.changes || "[]"); } catch { return []; } })(), byName: r.by_name, byEmail: r.by_email });

/* Admin → History (filters: tool, site, person, from, to, text) */
export async function historyList(env, url) {
  const q = k => (url.searchParams.get(k) || "").trim();
  const where = [], args = [];
  if (q("tool")) { where.push("tool = ?"); args.push(q("tool")); }
  if (q("site")) { where.push("site = ?"); args.push(q("site").toUpperCase()); }
  if (q("who")) { where.push("(by_email = ? OR by_name LIKE ?)"); args.push(q("who").toLowerCase(), "%" + q("who") + "%"); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(q("from"))) { where.push("at >= ?"); args.push(q("from")); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(q("to"))) { where.push("at < ?"); args.push(q("to") + "T99"); }
  if (q("q")) { where.push("(label LIKE ? OR changes LIKE ?)"); args.push("%" + q("q") + "%", "%" + q("q") + "%"); }
  const { results } = await env.DB.prepare(`SELECT * FROM change_log ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY at DESC LIMIT 300`).bind(...args).all();
  const tools = await env.DB.prepare("SELECT tool, COUNT(*) AS n FROM change_log GROUP BY tool ORDER BY tool").all();
  return { rows: (results || []).map(out), tools: (tools.results || []).map(t => ({ tool: t.tool, n: t.n })) };
}
/* one record's history (shown under "History" in a tool) */
export async function historyOf(env, tool, ref, site) {
  const { results } = await env.DB.prepare("SELECT * FROM change_log WHERE tool = ? AND ref = ? AND site = ? ORDER BY at DESC LIMIT 100").bind(tool, String(ref), site).all();
  return { rows: (results || []).map(out) };
}
