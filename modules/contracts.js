/* =====================================================================
   CONTRACTS NEAR ENDING — feature module (kept separate so it can be removed cleanly)
   See docs/FEATURE-email-inbox.md

   The daily Salesforce report "contracts near ending" (Excel) is forwarded to the hub's Gmail
   (…+contracts-<TAG>@gmail.com). The hub reads it and keeps one line per contract:
     Contract Number · Account Name · Status · Business Unit · Start · End · Effective Departure · Record Type
   • Business Unit → flagship.  Key date = Effective Departure Date when there is one, else Contract End Date.
   • Contracts that drop out of the report are kept under "No longer in the report" (renewed, closed or moved).
   • Alerts to the flagship when a contract first appears, and 30 · 14 · 7 · 1 days before and on the key date.
   • The operations team writes a follow-up note per contract.
   • Key dates also show in the Operations Calendar.
   Tables : contracts_ending      Routes : /api/ops/contracts/*      Page : /tools/contracts
   ===================================================================== */
import { readSheet } from "./sheetread.js";

const err = (m, status = 400) => Object.assign(new Error(m), { status });
const clip = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
const addDays = (d, n) => { const t = new Date(d + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((new Date(b + "T12:00:00Z") - new Date(a + "T12:00:00Z")) / 864e5);
const REMIND = [30, 14, 7, 1, 0];

export async function contractsSchema(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS contracts_ending (contract_no TEXT PRIMARY KEY, site TEXT NOT NULL, account TEXT NOT NULL DEFAULT '', tenant TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '', bu TEXT NOT NULL DEFAULT '', start_day TEXT NOT NULL DEFAULT '', end_day TEXT NOT NULL DEFAULT '', departure_day TEXT NOT NULL DEFAULT '',
      rtype TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1, first_seen TEXT NOT NULL DEFAULT '', last_seen TEXT NOT NULL DEFAULT '', left_at TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '', note_by TEXT NOT NULL DEFAULT '', note_at TEXT NOT NULL DEFAULT '')`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS contracts_ending_site ON contracts_ending (site, active)`)
  ]);
}

/* dates: Excel serial number, dd/mm/yyyy (Lebanon), yyyy-mm-dd */
export function toDay(v) {
  if (v == null || v === "") return "";
  if (typeof v === "number" && v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 864e5).toISOString().slice(0, 10);
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/.exec(s);
  if (m) { const y = m[3].length === 2 ? "20" + m[3] : m[3]; return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; }
  if (/^\d{5}(\.\d+)?$/.test(s)) return toDay(Number(s));
  return "";
}
const norm = s => String(s || "").toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, " ").trim();
function siteOf(bu, account, SITES) {
  const b = norm(bu);
  for (const [c, n] of Object.entries(SITES)) if (norm(n) === b) return c;
  for (const [c, n] of Object.entries(SITES)) if (b && (b.includes(norm(n)) || norm(n).includes(b))) return c;
  const a = norm(account);
  const hit = Object.entries(SITES).sort((x, y) => y[1].length - x[1].length).find(([, n]) => a.endsWith(norm(n)));
  return hit ? hit[0] : "";
}
const tenantOf = (account, siteName) => String(account || "").replace(new RegExp("\\s*" + siteName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*$", "i"), "").trim() || String(account || "").trim();
const cleanStatus = s => String(s || "").replace(/[^\p{L}\p{N}\s\-\/]/gu, "").replace(/\s+/g, " ").trim();

/* ---------- import (from the email inbox) ---------- */
export async function contractsImport(env, d, { files, from, fileNote }) {
  const want = /contract number/;
  let rows = null, used = "";
  for (const f of files) {
    try { const r = await readSheet(f.name, f.data); if (r.some(x => x.some(c => want.test(norm(c))))) { rows = r; used = f.name; break; } } catch (e) { if (!rows) used = e.message; }
  }
  if (!rows) throw err(used && /only|Excel/.test(used) ? used : "No contracts report found in the attachment (the “Contract Number” column is missing)");
  const hi = rows.findIndex(r => r.some(c => want.test(norm(c))));
  const H = rows[hi].map(norm);
  const col = re => H.findIndex(h => re.test(h));
  const C = { no: col(/contract number/), account: col(/account name/), status: col(/^status/), bu: col(/business unit/), start: col(/contract start/),
    end: col(/contract end/), dep: col(/departure/), type: col(/record type|contract type/) };
  if (C.end < 0) throw err("The “Contract End Date” column is missing");
  const today = d.today(), now = d.now();
  const prev = new Map(((await env.DB.prepare("SELECT contract_no, active FROM contracts_ending").all()).results || []).map(r => [r.contract_no, r.active]));
  const seen = new Set(), added = [], unknown = new Set(), ops = [];
  for (const r of rows.slice(hi + 1)) {
    const no = clip(r[C.no], 40).replace(/\.0$/, "");
    if (!no || !/\d/.test(no)) continue;
    const account = clip(r[C.account], 160), bu = clip(r[C.bu], 80);
    const site = siteOf(bu, account, d.SITES);
    if (!site) { unknown.add(bu || account); continue; }
    if (seen.has(no)) continue;
    seen.add(no);
    const v = { site, account, tenant: tenantOf(account, d.SITES[site]), status: cleanStatus(r[C.status]), bu, start: toDay(r[C.start]), end: toDay(r[C.end]),
      dep: C.dep >= 0 ? toDay(r[C.dep]) : "", type: clip(r[C.type], 40) };
    if (!prev.has(no) || prev.get(no) === 0) added.push({ no, ...v });
    ops.push(env.DB.prepare(`INSERT INTO contracts_ending (contract_no, site, account, tenant, status, bu, start_day, end_day, departure_day, rtype, active, first_seen, last_seen, left_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?,'') ON CONFLICT(contract_no) DO UPDATE SET site=excluded.site, account=excluded.account, tenant=excluded.tenant, status=excluded.status,
      bu=excluded.bu, start_day=excluded.start_day, end_day=excluded.end_day, departure_day=excluded.departure_day, rtype=excluded.rtype, active=1, last_seen=excluded.last_seen, left_at=''`)
      .bind(no, site, v.account, v.tenant, v.status, bu, v.start, v.end, v.dep, v.type, now, now));
  }
  if (!seen.size) throw err("The report has no contract rows");
  /* contracts no longer in today's report */
  const gone = [...prev.entries()].filter(([no, a]) => a === 1 && !seen.has(no)).map(([no]) => no);
  for (const no of gone) ops.push(env.DB.prepare("UPDATE contracts_ending SET active = 0, left_at = ? WHERE contract_no = ?").bind(now, no));
  for (let i = 0; i < ops.length; i += 80) await env.DB.batch(ops.slice(i, i + 80));
  await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('contracts:last', ?)").bind(JSON.stringify({ at: now, from, file: used, rows: seen.size, added: added.length, gone: gone.length, note: fileNote || "" })).run();
  /* new contracts in the report → one alert per flagship */
  const bySite = {};
  added.forEach(a => (bySite[a.site] = bySite[a.site] || []).push(a));
  for (const [site, L] of Object.entries(bySite)) {
    const key = c => c.dep || c.end;
    L.sort((a, b) => key(a).localeCompare(key(b)));
    const soon = L.filter(c => key(c) && daysBetween(today, key(c)) <= 30);
    await d.raiseEvent(env, { site, app: "contracts", tone: soon.length ? "warn" : "info",
      title: `${L.length} contract${L.length === 1 ? "" : "s"} near ending · ${d.SITES[site]}`,
      body: L.slice(0, 4).map(c => `${c.tenant} (${c.type || "contract"}) ${c.dep ? "departs" : "ends"} ${key(c)}`).join(" · ") + (L.length > 4 ? ` · +${L.length - 4} more` : "") });
  }
  return { rows: seen.size, added: added.length, gone: gone.length, unknown: [...unknown].slice(0, 5), file: used };
}

/* ---------- cron: 30 · 14 · 7 · 1 days before, and on the day ---------- */
export async function contractsRun(env, deps) {
  const today = deps.today();
  const { results } = await env.DB.prepare("SELECT * FROM contracts_ending WHERE active = 1").all().catch(() => ({ results: [] }));
  for (const r of results || []) {
    const day = r.departure_day || r.end_day; if (!day) continue;
    const left = daysBetween(today, day);
    if (!REMIND.includes(left)) continue;
    const claim = await env.DB.prepare("INSERT OR IGNORE INTO meta (k, v) VALUES (?, ?)").bind(`contract:rem:${r.contract_no}:${day}:${left}`, deps.now()).run();
    if (!claim.meta || claim.meta.changes !== 1) continue;
    const what = r.departure_day ? "departure" : "contract end";
    await deps.raiseEvent(env, { site: r.site, app: "contracts", tone: left <= 7 ? "alert" : "warn",
      title: left === 0 ? `${r.tenant} · ${what} today` : `${r.tenant} · ${what} in ${left} day${left === 1 ? "" : "s"}`,
      body: `Contract ${r.contract_no} · ${r.rtype || "contract"} · ${r.status || ""} · ${day}${r.note ? " · " + r.note : ""}` });
  }
}

/* ---------- for the Operations Calendar ---------- */
export async function contractsInRange(env, site, from, to) {
  const { results } = await env.DB.prepare(`SELECT * FROM contracts_ending WHERE site = ? AND active = 1 AND
    ((departure_day != '' AND departure_day BETWEEN ? AND ?) OR (departure_day = '' AND end_day BETWEEN ? AND ?))`).bind(site, from, to, from, to).all().catch(() => ({ results: [] }));
  return (results || []).map(r => ({ no: r.contract_no, tenant: r.tenant, day: r.departure_day || r.end_day, type: r.rtype, status: r.status, departure: !!r.departure_day }));
}

const out = (r, today) => { const key = r.departure_day || r.end_day;
  return { no: r.contract_no, site: r.site, account: r.account, tenant: r.tenant, status: r.status, bu: r.bu, start: r.start_day, end: r.end_day, departure: r.departure_day,
    type: r.rtype, active: !!r.active, firstSeen: r.first_seen, lastSeen: r.last_seen, leftAt: r.left_at, note: r.note, noteBy: r.note_by, noteAt: r.note_at,
    key, left: key ? daysBetween(today, key) : null }; };

export async function contractsRoute(env, p, method, b, url, d) {
  const { site, me } = d;
  if (!d.canSite(me, site)) throw err("No access to this flagship", 403);
  const team = d.full || me.role === "SUPERVISOR";
  const today = d.today();
  if (p === "contracts/list") {
    const [{ results }, last, units] = await Promise.all([
      env.DB.prepare("SELECT * FROM contracts_ending WHERE site = ? AND (active = 1 OR left_at >= ?) ORDER BY active DESC, CASE WHEN departure_day != '' THEN departure_day ELSE end_day END")
        .bind(site, addDays(today, -60)).all(),
      env.DB.prepare("SELECT v FROM meta WHERE k = 'contracts:last'").first().catch(() => null),
      env.DB.prepare("SELECT id, level, code, brand, status FROM gla_units WHERE site = ? AND active = 1 AND brand != ''").bind(site).all().catch(() => ({ results: [] }))
    ]);
    const U = (units.results || []).map(u => ({ ...u, n: norm(u.brand) }));
    const list = (results || []).map(r => { const o = out(r, today); const t = norm(o.tenant);
      const u = U.find(x => x.n === t) || U.find(x => t && (x.n.startsWith(t + " ") || t.startsWith(x.n + " ")));
      if (u) o.unit = { code: u.code, level: u.level, status: u.status };
      return o; });
    return { today, list, last: last ? JSON.parse(last.v) : null, can: { note: team } };
  }
  if (p === "contracts/note" && method === "POST") {
    if (!team) throw err("Only the operations team can write follow-up notes", 403);
    const r = await env.DB.prepare("SELECT * FROM contracts_ending WHERE contract_no = ? AND site = ?").bind(clip(b.no, 40), site).first();
    if (!r) throw err("Contract not found", 404);
    const note = clip(b.note, 500);
    await env.DB.prepare("UPDATE contracts_ending SET note = ?, note_by = ?, note_at = ? WHERE contract_no = ?").bind(note, me.full_name, d.now(), r.contract_no).run();
    if (d.audit) await d.audit(env, { site, tool: "contracts", ref: r.contract_no, label: `${r.tenant} · ${r.contract_no}`, action: "edit", before: { note: r.note }, after: { note } });
    return { ok: true };
  }
  throw err("Unknown request", 404);
}
