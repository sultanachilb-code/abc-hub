/* =====================================================================
   DATA EXPLORER (Nov 2026) — Admin Control → 🔎 Data explorer · administrators only (Admin Control unlocked)
   READ-ONLY: only one SELECT / WITH query is accepted; anything that could change data is refused.
   Sources: Hub (DB) · Restroom (RR_DB) · Incidents (INC_DB) — bound here (same Cloudflare account)
            Snaglist · ABC Audit — other Cloudflare accounts: their own read-only endpoint (POST /hubquery),
            signed with HMAC (Snaglist: HUB_KEY · ABC Audit: AUDIT_KEY = their HUB_QC_KEY).
   Passwords, two-step secrets and sign-in tokens are always shown as "hidden". Every run is written to the change history.
   Saved queries are shared by all administrators (dbx_saved).
   ===================================================================== */
const err = (m, status = 400) => Object.assign(new Error(m), { status });
export const DBX_SOURCES = {
  hub: { name: "Hub", icon: "🏠", color: "#4A1F73", bind: "DB" },
  restroom: { name: "Restroom", icon: "🚻", color: "#0E7C86", bind: "RR_DB" },
  incidents: { name: "Incidents", icon: "🚨", color: "#C0392B", bind: "INC_DB" },
  snaglist: { name: "Snaglist", icon: "📋", color: "#B06A00", remote: "https://abc-snaglist.sultanalachi-work.workers.dev", key: "HUB_KEY" },
  audit: { name: "ABC Audit", icon: "✓", color: "#1F5A96", remote: "audit:url", key: "AUDIT_KEY" }
};
const MAX_SHOW = 5000, MAX_EXPORT = 50000;
/* columns never shown */
export const SECRET_COL = /pass(word)?(_?hash)?$|^pw_?hash$|^pwd|totp|secret|token|^otp|_otp$|api_?key|^pin_?hash|refresh|^hash$|^salt$|session_?id|^sid$|cookie|private_?key|credential|backup|cred_key|chal$|email_code|pair_(code|hash)|^p256dh$|^auth$/i;
const BAD = /\b(insert|update|delete|drop|alter|create|replace|attach|detach|pragma|vacuum|reindex|analyze|begin|commit|rollback|savepoint|release|upsert|truncate|grant|load_extension)\b/i;

/* one read-only statement: comments and string literals are ignored when checking */
export function guardSql(sql) {
  let s = String(sql || "").trim();
  if (!s) throw err("Write a query");
  if (s.length > 20000) throw err("The query is too long");
  const bare = s.replace(/'(?:[^']|'')*'/g, "''").replace(/"(?:[^"]|"")*"/g, '""').replace(/--[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ").trim().replace(/;\s*$/, "");
  if (bare.includes(";")) throw err("One query at a time");
  if (!/^(select|with)\b/i.test(bare)) throw err("Read-only: start with SELECT or WITH");
  const m = BAD.exec(bare); if (m) throw err(`Read-only: “${m[1].toUpperCase()}” is not allowed here`);
  return s.replace(/;\s*$/, "");
}
const mask = (cols, rows) => { const hid = cols.map(c => SECRET_COL.test(c)); return rows.map(r => r.map((v, i) => hid[i] && v != null && v !== "" ? "•••• hidden" : v)); };

/* a local D1 database: schema and query */
async function localSchema(db) {
  const T = (await db.prepare("SELECT name, type, sql FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%' ORDER BY name").all()).results || [];
  const I = (await db.prepare("SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL").all()).results || [];
  const out = [];
  for (let i = 0; i < T.length; i += 40) {
    const part = T.slice(i, i + 40);
    const q = t => `"${t.name.replace(/"/g, '""')}"`;
    let res;
    try { res = await db.batch(part.flatMap(t => [db.prepare("SELECT name, type, pk, \"notnull\" AS nn FROM pragma_table_info(?)").bind(t.name), db.prepare(`SELECT COUNT(*) AS n FROM ${q(t)}`)])); }
    catch {   // no pragma_table_info here: column names from an empty SELECT, types from the CREATE statement
      res = [];
      for (const t of part) {
        const names = ((await db.prepare(`SELECT * FROM ${q(t)} LIMIT 0`).raw({ columnNames: true }).catch(() => [[]]))[0] || []);
        const typ = n => { const re = new RegExp("[\"`]?" + n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[\"`]?\\s+(\\w+)", "i"); const m = re.exec(t.sql || ""); return m ? m[1] : ""; };
        res.push({ results: names.map(n => ({ name: n, type: typ(n), pk: 0, nn: 0 })) }, await db.prepare(`SELECT COUNT(*) AS n FROM ${q(t)}`).all().catch(() => ({ results: [] })));
      }
    }
    part.forEach((t, k) => out.push({ name: t.name, view: t.type === "view", rows: Number(((res[k * 2 + 1].results || [])[0] || {}).n) || 0,
      cols: (res[k * 2].results || []).map(c => ({ name: c.name, type: c.type || "", pk: !!c.pk, nn: !!c.nn, hidden: SECRET_COL.test(c.name) })),
      idx: I.filter(x => x.tbl_name === t.name).map(x => ({ name: x.name, on: ((/\((.*)\)\s*(where.*)?$/is.exec(x.sql) || [])[1] || "").replace(/\s+/g, " ") })) }));
  }
  return out;
}
async function localQuery(db, sql, limit) {
  const t0 = Date.now();
  const r = await db.prepare(`SELECT * FROM (${sql}) LIMIT ${limit + 1}`).raw({ columnNames: true });
  const cols = (r.shift() || []).map(String);
  return { cols, rows: r.slice(0, limit), more: r.length > limit, ms: Date.now() - t0 };
}
/* remote systems: signed request to their /hubquery */
async function remote(env, src, payload) {
  const S = DBX_SOURCES[src];
  let base = S.remote; if (base === "audit:url") { const m = await env.DB.prepare("SELECT v FROM meta WHERE k = 'audit:url'").first().catch(() => null); base = m && m.v; }
  if (!base) throw err(`${S.name}: address not set (Admin → Systems & jobs)`, 503);
  const key = env[S.key]; if (!key) throw err(`${S.name}: the hub key ${S.key} is not set`, 503);
  const body = JSON.stringify({ ...payload, ts: Date.now() });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = [...new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(body)))].map(b => b.toString(16).padStart(2, "0")).join("");
  let r;
  try { r = await fetch(base.replace(/\/+$/, "") + "/hubquery", { method: "POST", headers: { "content-type": "application/json", "x-hub-sig": sig }, body, signal: AbortSignal.timeout(25000) }); }
  catch (e) { throw err(`${S.name} is not answering right now — try again in a minute`, 502); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw err(`${S.name}: ${j.error || "HTTP " + r.status}${r.status === 404 ? " — the system is not updated yet" : ""}`, 502);
  return j.data;
}
const dbOf = (env, src) => { const S = DBX_SOURCES[src]; if (!S) throw err("Unknown system"); return S.bind ? env[S.bind] : null; };

import { LIBRARY, LIB_VER, LIB_BY } from "./dbx-lib.js";

/* adds the ready-made queries once per library version (modules/dbx-lib.js) */
async function seedLib(env) {
  const cur = await env.DB.prepare("SELECT v FROM meta WHERE k = 'dbx:lib'").first().catch(() => null);
  if (cur && Number(cur.v) >= LIB_VER) return;
  const have = new Map(((await env.DB.prepare("SELECT id, name, by_name FROM dbx_saved").all()).results || []).map(x => [x.name, x]));
  const at = new Date().toISOString(), st = [];
  for (const [src, name, sql] of LIBRARY) {
    const h = have.get(name);
    if (!h) st.push(env.DB.prepare("INSERT INTO dbx_saved (name, source, sql, by_name, at) VALUES (?,?,?,?,?)").bind(name, src, sql, LIB_BY, at));
    else if (h.by_name === LIB_BY) st.push(env.DB.prepare("UPDATE dbx_saved SET source = ?, sql = ? WHERE id = ?").bind(src, sql, h.id));
  }
  st.push(env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('dbx:lib', ?)").bind(String(LIB_VER)));
  for (let i = 0; i < st.length; i += 50) await env.DB.batch(st.slice(i, i + 50));
}

export async function dbxSchema(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS dbx_saved (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, source TEXT NOT NULL, sql TEXT NOT NULL,
    by_name TEXT NOT NULL DEFAULT '', at TEXT NOT NULL)`).run();
}

/* /api/admin/cc/dbx/<p> — the caller already checked: administrator, Admin Control unlocked */
export async function dbxRoute(env, p, method, b, url, d) {
  const { me } = d;
  await dbxSchema(env);
  if (p === "sources" || p === "saved") await seedLib(env);
  if (p === "sources") {
    const saved = (await env.DB.prepare("SELECT COUNT(*) AS n FROM dbx_saved").first()).n;
    return { sources: Object.entries(DBX_SOURCES).map(([k, s]) => ({ k, name: s.name, icon: s.icon, color: s.color, local: !!s.bind, ready: s.bind ? !!env[s.bind] : !!env[s.key] })), saved };
  }
  if (p === "schema") {
    const src = String(url.searchParams.get("src") || "");
    const db = dbOf(env, src);
    return { src, tables: db ? await localSchema(db) : (await remote(env, src, { op: "schema" })).tables };
  }
  if (p === "run" && method === "POST") {
    const src = String(b.src || ""); dbOf(env, src);
    const sql = guardSql(b.sql), limit = b.export ? MAX_EXPORT : MAX_SHOW;
    const db = dbOf(env, src);
    let r;
    try { r = db ? await localQuery(db, sql, limit) : await remote(env, src, { op: "query", sql, limit }); }
    catch (e) { throw err(String(e && e.message || e).replace(/^D1_ERROR:\s*/, "").slice(0, 400)); }
    r.rows = mask(r.cols, r.rows);
    await d.audit(env, { me, site: "", tool: "admin", ref: "data-explorer", label: `Data explorer · ${DBX_SOURCES[src].name}${b.export ? " · export" : ""} · ${r.rows.length} rows · ${sql.replace(/\s+/g, " ").slice(0, 300)}`, action: "view", changes: [] }).catch(() => {});
    return { src, ...r, max: limit };
  }
  if (p === "saved") {
    if (method === "POST") {
      if (b.del) { await env.DB.prepare("DELETE FROM dbx_saved WHERE id = ?").bind(Number(b.del) || 0).run(); return { deleted: true }; }
      const src = String(b.src || ""); dbOf(env, src); const sql = guardSql(b.sql), name = String(b.name || "").trim().slice(0, 80);
      if (!name) throw err("Give the query a name");
      await env.DB.prepare("INSERT INTO dbx_saved (name, source, sql, by_name, at) VALUES (?,?,?,?,?)").bind(name, src, sql, me.full_name || me.email, new Date().toISOString()).run();
      return { saved: true };
    }
    const { results } = await env.DB.prepare("SELECT * FROM dbx_saved ORDER BY id DESC LIMIT 500").all();
    return { saved: (results || []).map(x => ({ id: x.id, name: x.name, src: x.source, srcName: (DBX_SOURCES[x.source] || {}).name || x.source, sql: x.sql, by: x.by_name, at: x.at })) };
  }
  throw err("Unknown endpoint", 404);
}
