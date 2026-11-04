/* =====================================================================
   REPORT BUILDER (Nov 2026) — docs/FEATURE-reports.md
   • Admin Control → Reports: reports made of pages of blocks (KPI card, table, bar / line / pie chart, date badge, text, photos).
     Every block reads one data source of the hub, with a measure, groupings, filters and an optional comparison.
   • Explore: the same engine as a free table / chart (group by, then by, measure) — export to Excel, add it to a report.
   • Delivery: recipients in the builder (emails, positions, the flagships' operations group emails),
     a schedule (monthly / weekly / daily at a time, through Outlook, Excel attached) and/or hub subscriptions (Reports tile).
   • Every run is kept (rp_runs): view it in the hub, print to PDF, download Excel.
   ===================================================================== */
import { INC_NAME, RR_NAME } from "./rolebrief.js";
import { ffCfg, DUR_BUCKETS } from "./footfall.js";
import { lpKeyOf, LP_POSITIONS } from "./landing.js";

const err = (m, status = 400) => Object.assign(new Error(m), { status });
const all = async q => { try { return (await q.all()).results || []; } catch (e) { console.error("reports", e && e.message); return []; } };
const clip = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
const isDay = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
const addDays = (day, n) => new Date(Date.parse(day + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const dayB = iso => { try { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Beirut", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso)); } catch { return String(iso || "").slice(0, 10); } };
const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FROM = "salaachi@abc.com.lb";

export async function rpSchema(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS rp_reports (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, icon TEXT NOT NULL DEFAULT '📑', def TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL, created_by TEXT NOT NULL DEFAULT '', created_email TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '', updated_by TEXT NOT NULL DEFAULT '', deleted INTEGER NOT NULL DEFAULT 0)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS rp_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, report_id INTEGER NOT NULL, name TEXT NOT NULL, period TEXT NOT NULL, sites TEXT NOT NULL,
      at TEXT NOT NULL, by_name TEXT NOT NULL DEFAULT '', how TEXT NOT NULL DEFAULT 'run', sent_to TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT '', data TEXT NOT NULL DEFAULT '{}')`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS rp_runs_rep ON rp_runs (report_id, id)"),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS rp_subs (report_id INTEGER NOT NULL, email TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY (report_id, email))`)
  ]);
  /* the three starter reports, once */
  const c = await env.DB.prepare("INSERT OR IGNORE INTO meta (k, v) VALUES ('rp:seeded', ?)").bind(new Date().toISOString()).run().catch(() => null);
  if (c && c.meta && c.meta.changes === 1) {
    const at = new Date().toISOString();
    for (const t of STARTERS) await env.DB.prepare("INSERT INTO rp_reports (name, icon, def, created_at, created_by, updated_at, updated_by) VALUES (?,?,?,?,?,?,?)")
      .bind(t.name, t.icon, JSON.stringify(t.def), at, "Starter template", at, "Starter template").run();
  }
}

/* ================= data sources ================= */
const STD = { flagship: "Flagship", day: "Day", week: "Week", month: "Month", weekday: "Weekday" };
const weekOf = day => { const d = new Date(day + "T12:00:00Z"), k = (d.getUTCDay() + 6) % 7; return addDays(day, -k); };
const M = (label, kind, field, cond) => ({ label, kind, field, cond });   // kind: count · sum · avg · avgday · max · pct · distinct
export const SOURCES = {
  footfall: { name: "Footfall · car entries", group: "Reports", dims: { ...STD },
    measures: { entries: M("Car entries", "sum", "entries"), noemp: M("Entries without employees", "sum", "noemp"), exits: M("Car exits", "sum", "exits"), employees: M("Employee cars", "sum", "employees"),
      free: M("Free tickets", "sum", "free"), avgday: M("Daily average", "avgday", "entries"), maxday: M("Busiest day", "max", "entries"), days: M("Days received", "count") },
    async load(env, sites, from, to) { const ph = sites.map(() => "?").join(",");
      return (await all(env.DB.prepare(`SELECT site, day, entries, entries_noemp AS noemp, exits, employees, free FROM ff_days WHERE site IN (${ph}) AND day BETWEEN ? AND ?`).bind(...sites, from, to))); } },
  ffgates: { name: "Footfall · by gate", group: "Reports", dims: { ...STD, gate: "Gate", dir: "Entry / exit" }, measures: { cars: M("Cars", "sum", "cars") },
    async load(env, sites, from, to) { const ph = sites.map(() => "?").join(","), cfg = await ffCfg(env), out = [];
      for (const r of await all(env.DB.prepare(`SELECT site, day, data FROM ff_days WHERE detail = 1 AND site IN (${ph}) AND day BETWEEN ? AND ?`).bind(...sites, from, to))) {
        const G = (cfg.sites[r.site] || {}).gates || [], g = (JSON.parse(r.data || "{}").g) || {};
        for (const gt of G) { const v = Object.values(g[gt.id] || {}).reduce((a, b) => a + (Number(b) || 0), 0); out.push({ site: r.site, day: r.day, gate: gt.name, dir: gt.dir === "out" ? "Exit" : "Entry", cars: v }); } }
      return out; } },
  parking: { name: "Parking duration", group: "Reports", dims: { flagship: "Flagship", month: "Month", bucket: "Duration" }, measures: { cars: M("Cars", "sum", "cars") },
    async load(env, sites, from, to) { const ph = sites.map(() => "?").join(","), out = [];
      for (const r of await all(env.DB.prepare(`SELECT site, month, data FROM ff_dur WHERE site IN (${ph}) AND month BETWEEN ? AND ?`).bind(...sites, from.slice(0, 7), to.slice(0, 7))))
        JSON.parse(r.data || "[]").forEach((v, i) => out.push({ site: r.site, day: r.month + "-01", bucket: DUR_BUCKETS[i] || String(i), _o: i, cars: Number(v) || 0 }));
      return out; } },
  incidents: { name: "Incidents", group: "Security", dims: { ...STD, category: "Category", type: "Type", severity: "Severity", status: "Status", pir: "PIR" },
    measures: { n: M("Incidents", "count"), pirok: M("PIR on time %", "pct", null, r => r.pir === "On time", r => r.pir !== "Not needed" && r.pir !== "Not due") },
    async load(env, sites, from, to) { if (!env.INC_DB) return []; const out = [], now = new Date().toISOString();
      for (const s of sites) { if (!INC_NAME[s]) continue;
        for (const r of await all(env.INC_DB.prepare("SELECT incident_date, category, type, severity, status, pir_due_at, pir_submitted_at FROM incidents WHERE flagship = ? AND incident_date BETWEEN ? AND ?").bind(INC_NAME[s], from, to)))
          out.push({ site: s, day: String(r.incident_date || "").slice(0, 10), category: r.category || "—", type: r.type || "—", severity: r.severity || "—", status: r.status || "—",
            pir: !r.pir_due_at ? "Not needed" : r.pir_submitted_at ? (r.pir_submitted_at <= r.pir_due_at ? "On time" : "Late") : (r.pir_due_at < now ? "Missing" : "Not due") }); }
      return out; } },
  malfunctions: { name: "Malfunctions", group: "Operations", dims: { ...STD, category: "Category", priority: "Priority", status: "Status", fixed48: "Fixed within 48 h" },
    measures: { n: M("Malfunctions", "count"), fix48: M("Fixed within 48 h %", "pct", null, r => r.fixed48 === "Yes"), hours: M("Average hours to fix", "avg", "hours") },
    async load(env, sites, from, to) { const ph = sites.map(() => "?").join(",");
      return (await all(env.DB.prepare(`SELECT site, found_at, fixed_at, category, priority, status FROM mf_records WHERE deleted = 0 AND site IN (${ph}) AND substr(found_at,1,10) BETWEEN ? AND ?`).bind(...sites, from, to)))
        .map(r => { const h = r.fixed_at ? (Date.parse(r.fixed_at) - Date.parse(r.found_at)) / 36e5 : null;
          return { site: r.site, day: dayB(r.found_at), category: r.category || "—", priority: r.priority || "—", status: r.status || "—", fixed48: h != null && h <= 48 ? "Yes" : "No", hours: h != null && h >= 0 ? Math.round(h * 10) / 10 : null }; }); } },
  tenantitems: { name: "Tenant portal items (breaches, violations, requests)", group: "Tenants", dims: { ...STD, kind: "Kind", tenant: "Tenant", type: "Type", status: "Status", open: "Still open" },
    measures: { n: M("Items", "count"), open: M("Still open", "count", null, r => r.open === "Yes") },
    async load(env, sites, from, to) { const ph = sites.map(() => "?").join(","), K = { bp: "Breaches & Penalties", vr: "Violations", nr: "ABC Requests", mk: "Marketing Requests" };
      return (await all(env.DB.prepare(`SELECT site, kind, tenant, type, status, created_day, active FROM portal_items WHERE site IN (${ph}) AND created_day BETWEEN ? AND ?`).bind(...sites, from, to)))
        .map(r => ({ site: r.site, day: r.created_day, kind: K[r.kind] || r.kind, tenant: r.tenant || "—", type: r.type || "—", status: r.status || "—", open: r.active && !/^(closed|confirmed|approved|rejected|resolved)/i.test(r.status || "") ? "Yes" : "No" })); } },
  feedback: { name: "Tenant feedback", group: "Tenants", dims: { ...STD, tenant: "Tenant", category: "Category", action: "Action" }, measures: { n: M("Feedback entries", "count"), tenants: M("Tenants", "distinct", "tenant") },
    async load(env, sites, from, to) { const ph = sites.map(() => "?").join(",");
      return (await all(env.DB.prepare(`SELECT site, day, tenant, category, action FROM tenant_feedback WHERE site IN (${ph}) AND day BETWEEN ? AND ?`).bind(...sites, from, to)))
        .map(r => ({ ...r, tenant: r.tenant || "—", category: r.category || "—", action: r.action || "—" })); } },
  pm: { name: "Preventive maintenance (tenant certificates)", group: "Tenants", dims: { ...STD, tenant: "Tenant", category: "Category", state: "Status" },
    measures: { n: M("Certificates asked", "count"), done: M("Completed %", "pct", null, r => r.state === "Completed"), breach: M("Breaches", "count", null, r => r.state === "Breach") },
    async load(env, sites, from, to) { const ph = sites.map(() => "?").join(",");
      return (await all(env.DB.prepare(`SELECT site, brand, category, deadline, completed_at, breach_at FROM pm_records WHERE site IN (${ph}) AND substr(deadline,1,10) BETWEEN ? AND ?`).bind(...sites, from, to)))
        .map(r => ({ site: r.site, day: String(r.deadline).slice(0, 10), tenant: r.brand || "—", category: r.category || "—", state: r.completed_at ? "Completed" : r.breach_at ? "Breach" : "Pending" })); } },
  checklists: { name: "Operations checklists", group: "Operations", dims: { ...STD, form: "Checklist", status: "Status" },
    measures: { n: M("Checklists", "count"), sub: M("Submitted %", "pct", null, r => r.status === "submitted"), issues: M("Issues found", "sum", "issues") },
    async load(env, sites, from, to) { const ph = sites.map(() => "?").join(",");
      return (await all(env.DB.prepare(`SELECT site, day, form, title, status, issues FROM form_runs WHERE site IN (${ph}) AND day BETWEEN ? AND ?`).bind(...sites, from, to)))
        .map(r => ({ site: r.site, day: r.day, form: r.title || r.form, status: r.status, issues: Number(r.issues) || 0 })); } },
  restroom: { name: "Restroom inspections", group: "Operations", dims: { ...STD, room: "Restroom", issues: "With issues" },
    measures: { n: M("Inspections", "count"), bad: M("With issues %", "pct", null, r => r.issues === "Yes") },
    async load(env, sites, from, to) { if (!env.RR_DB) return []; const out = [];
      for (const s of sites) { if (!RR_NAME[s]) continue;
        for (const r of await all(env.RR_DB.prepare("SELECT log_date, room_name, has_issues FROM inspection_logs WHERE flagship = ? AND log_date BETWEEN ? AND ?").bind(RR_NAME[s], from, to)))
          out.push({ site: s, day: r.log_date, room: r.room_name || "—", issues: r.has_issues ? "Yes" : "No" }); }
      return out; } },
  contractors: { name: "Contractors on site", group: "Security", dims: { ...STD, arrived: "Arrived" }, measures: { n: M("Visits booked", "count"), arrived: M("Visits arrived", "count", null, r => r.arrived === "Yes"), workers: M("Workers", "sum", "workers") },
    async load(env, sites, from, to) { const ph = sites.map(() => "?").join(",");
      return (await all(env.DB.prepare(`SELECT site, day, workers, in_at FROM contractor_checks WHERE site IN (${ph}) AND day BETWEEN ? AND ?`).bind(...sites, from, to)))
        .map(r => ({ site: r.site, day: r.day, workers: Number(r.workers) || 0, arrived: r.in_at ? "Yes" : "No" })); } },
  gate: { name: "Loading Gate scans", group: "Security", dims: { ...STD, decision: "Decision", tenant: "Tenant", contractor: "Contractor" }, measures: { n: M("Scans", "count"), rej: M("Rejected", "count", null, r => r.decision === "Rejected out") },
    async load(env, sites, from, to) { const ph = sites.map(() => "?").join(",");
      return (await all(env.DB.prepare(`SELECT site, day, decision, tenant, contractor FROM gate_scans WHERE site IN (${ph}) AND day BETWEEN ? AND ?`).bind(...sites, from, to)))
        .map(r => ({ site: r.site, day: r.day, decision: r.decision === "in" ? "Approved in" : "Rejected out", tenant: r.tenant || "—", contractor: r.contractor || "—" })); } },
  cleaners: { name: "Cleaner entries", group: "Security", dims: { ...STD, tenant: "Tenant", company: "Company" }, measures: { n: M("Entries", "count"), people: M("Cleaners", "distinct", "worker") },
    async load(env, sites, from, to) { const ph = sites.map(() => "?").join(",");
      return (await all(env.DB.prepare(`SELECT site, day, worker_id AS worker, tenant, company FROM cl_attendance WHERE site IN (${ph}) AND day BETWEEN ? AND ?`).bind(...sites, from, to)))
        .map(r => ({ ...r, tenant: r.tenant || "—", company: r.company || "—" })); } },
  patrol: { name: "Security patrol scans", group: "Security", dims: { ...STD, status: "Result" }, measures: { n: M("Checkpoint scans", "count"), issues: M("With issues", "count", null, r => r.status === "issue") },
    async load(env, sites, from, to) { const ph = sites.map(() => "?").join(",");
      return await all(env.DB.prepare(`SELECT site, day, status FROM patrol_scans WHERE site IN (${ph}) AND day BETWEEN ? AND ?`).bind(...sites, from, to)); } },
  keys: { name: "Key Box", group: "Security", dims: { ...STD, purpose: "Purpose", taker: "Taken by", late: "Returned late" }, measures: { n: M("Keys taken", "count"), late: M("Returned late", "count", null, r => r.late === "Yes") },
    async load(env, sites, from, to) { const ph = sites.map(() => "?").join(","), now = new Date().toISOString();
      return (await all(env.DB.prepare(`SELECT site, out_at, due_at, back_at, purpose, taker_kind FROM kb_moves WHERE site IN (${ph}) AND substr(out_at,1,10) BETWEEN ? AND ?`).bind(...sites, from, to)))
        .map(r => ({ site: r.site, day: dayB(r.out_at), purpose: r.purpose || "—", taker: r.taker_kind || "—", late: (r.back_at || now) > r.due_at ? "Yes" : "No" })); } },
  gla: { name: "GLA & occupancy (today)", group: "Tenants", dims: { flagship: "Flagship", level: "Level", section: "Section", status: "Status", dept: "Category" }, noDate: true,
    measures: { units: M("Units", "count"), area: M("Area (sqm)", "sum", "area"), occ: M("Occupancy % (by area)", "pctw", "area", r => r.status !== "Vacant") },
    async load(env, sites) { const ph = sites.map(() => "?").join(",");
      return (await all(env.DB.prepare(`SELECT site, level, section, status, dept, area FROM gla_units WHERE active = 1 AND site IN (${ph})`).bind(...sites))).map(r => ({ ...r, area: Number(r.area) || 0, dept: r.dept || "—" })); } }
};

/* ---------- the engine: rows → groups → measure ---------- */
function dimVal(r, dim, d) {
  if (dim === "flagship") return d.siteName(r.site);
  if (dim === "day") return r.day;
  if (dim === "week") return r.day ? weekOf(r.day) : "—";
  if (dim === "month") return r.day ? r.day.slice(0, 7) : "—";
  if (dim === "weekday") return r.day ? WEEKDAYS[(new Date(r.day + "T12:00:00Z").getUTCDay() + 6) % 7] : "—";
  return r[dim] == null || r[dim] === "" ? "—" : String(r[dim]);
}
const dimLabel = (dim, v) => dim === "month" && /^\d{4}-\d{2}$/.test(v) ? `${MONTHS[+v.slice(5) - 1]} ${v.slice(0, 4)}` : dim === "week" && isDay(v) ? `Week of ${+v.slice(8)} ${MONTHS[+v.slice(5, 7) - 1]}` : dim === "day" && isDay(v) ? `${+v.slice(8)} ${MONTHS[+v.slice(5, 7) - 1]}` : v;
const dimOrder = (dim, a, b, rows) => dim === "weekday" ? WEEKDAYS.indexOf(a) - WEEKDAYS.indexOf(b) : dim === "bucket" ? DUR_BUCKETS.indexOf(a) - DUR_BUCKETS.indexOf(b) : ["day", "week", "month"].includes(dim) ? (a < b ? -1 : a > b ? 1 : 0) : 0;
function measure(m, rows) {
  if (!rows.length) return m.kind === "count" ? 0 : null;
  const f = m.field, R = m.cond && m.kind === "count" ? rows.filter(m.cond) : rows;
  switch (m.kind) {
    case "count": return R.length;
    case "sum": return Math.round(rows.reduce((a, r) => a + (Number(r[f]) || 0), 0) * 100) / 100;
    case "avg": { const v = rows.map(r => r[f]).filter(x => x != null); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length * 10) / 10 : null; }
    case "avgday": { const days = new Set(rows.map(r => r.day)).size;   /* per calendar day (all the flagships of the block together) */ return days ? Math.round(rows.reduce((a, r) => a + (Number(r[f]) || 0), 0) / days) : null; }
    case "max": { const by = {}; for (const r of rows) by[r.site + r.day] = (by[r.site + r.day] || 0) + (Number(r[f]) || 0); return Math.max(...Object.values(by)); }
    case "distinct": return new Set(rows.map(r => r[f])).size;
    case "pct": { const base = m.base ? rows.filter(m.base) : rows; return base.length ? Math.round(base.filter(m.cond).length / base.length * 1000) / 10 : null; }
    case "pctw": { const t = rows.reduce((a, r) => a + (Number(r[f]) || 0), 0); return t ? Math.round(rows.filter(m.cond).reduce((a, r) => a + (Number(r[f]) || 0), 0) / t * 1000) / 10 : null; }
  }
  return null;
}
const srcOf = k => { const s = SOURCES[k]; if (!s) throw err("Unknown data source"); return s; };
const measOf = (s, k) => { const m = s.measures[k] || Object.values(s.measures)[0]; if (s === SOURCES.incidents && k === "pirok") m.base = r => r.pir !== "Not needed" && r.pir !== "Not due"; return m; };
const applyFilter = (rows, filter, d) => !filter ? rows : rows.filter(r => Object.entries(filter).every(([dim, vals]) => !Array.isArray(vals) || !vals.length || vals.includes(dimVal(r, dim, d))));
async function loadRows(env, cfg, sites, P, d) {
  const s = srcOf(cfg.source);
  return applyFilter(await s.load(env, sites, P.from, P.to, d), cfg.filter, d);
}
/* group rows by 0–2 dims → { cols, rows: [[label, value | values…]] } */
function group(cfg, rows, d) {
  const s = srcOf(cfg.source), m = measOf(s, cfg.measure), dims = (cfg.dims || []).filter(x => s.dims[x]).slice(0, 2);
  if (!dims.length) return { measure: m.label, value: measure(m, rows) };
  const [d1, d2] = dims, G = new Map();
  for (const r of rows) { const k = dimVal(r, d1, d); if (!G.has(k)) G.set(k, []); G.get(k).push(r); }
  let keys = [...G.keys()];
  const sortV = (a, b) => dimOrder(d1, a, b) || 0;
  if (!d2) {
    let out = keys.map(k => [k, measure(m, G.get(k))]);
    if (["day", "week", "month", "weekday"].includes(d1) || d1 === "bucket") out.sort((a, b) => sortV(a[0], b[0])); else out.sort((a, b) => (b[1] ?? -1) - (a[1] ?? -1));
    if (cfg.limit) out = out.slice(0, cfg.limit);
    return { measure: m.label, dims: [s.dims[d1]], d1, cols: [s.dims[d1], m.label], rows: out.map(([k, v]) => [dimLabel(d1, k), v, k]), total: measure(m, rows) };
  }
  const C = [...new Set(rows.map(r => dimVal(r, d2, d)))].sort((a, b) => dimOrder(d2, a, b) || String(a).localeCompare(String(b)));
  let out = keys.map(k => { const R = G.get(k); return [k, ...C.map(c => measure(m, R.filter(r => dimVal(r, d2, d) === c))), measure(m, R)]; });
  if (["day", "week", "month", "weekday", "bucket"].includes(d1)) out.sort((a, b) => sortV(a[0], b[0])); else out.sort((a, b) => (b[b.length - 1] ?? -1) - (a[a.length - 1] ?? -1));
  if (cfg.limit) out = out.slice(0, cfg.limit);
  return { measure: m.label, d1, d2, cols: [s.dims[d1], ...C.map(c => dimLabel(d2, c)), "Total"], rows: out.map(([k, ...v]) => [dimLabel(d1, k), ...v, k]), series: C.map(c => dimLabel(d2, c)), seriesRaw: C, total: measure(m, rows) };
}

/* ---------- periods ---------- */
const monthEnd = m => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).toISOString().slice(0, 10);
const prevMonth = m => { const [y, x] = m.split("-").map(Number); return x === 1 ? `${y - 1}-12` : `${y}-${String(x - 1).padStart(2, "0")}`; };
export const PERIODS = { last_month: "Last month", this_month: "This month (so far)", last_7: "Last 7 days", last_30: "Last 30 days", last_quarter: "Last quarter", this_quarter: "This quarter", ytd: "Year to date", last_year: "Last year", custom: "Custom dates" };
export function periodOf(p, today) {
  const kind = PERIODS[p && p.kind] ? p.kind : "last_month", y = today.slice(0, 4), m = today.slice(0, 7), q = Math.floor((+m.slice(5) - 1) / 3);
  const qs = (yy, qq) => `${yy}-${String(qq * 3 + 1).padStart(2, "0")}-01`, qe = (yy, qq) => monthEnd(`${yy}-${String(qq * 3 + 3).padStart(2, "0")}`);
  let from, to;
  if (kind === "last_month") { const pm = prevMonth(m); from = pm + "-01"; to = monthEnd(pm); }
  else if (kind === "this_month") { from = m + "-01"; to = addDays(today, -1) < from ? today : addDays(today, -1); }
  else if (kind === "last_7") { from = addDays(today, -7); to = addDays(today, -1); }
  else if (kind === "last_30") { from = addDays(today, -30); to = addDays(today, -1); }
  else if (kind === "last_quarter") { const yy = q ? +y : +y - 1, qq = q ? q - 1 : 3; from = qs(yy, qq); to = qe(yy, qq); }
  else if (kind === "this_quarter") { from = qs(+y, q); to = addDays(today, -1) < from ? today : addDays(today, -1); }
  else if (kind === "ytd") { from = y + "-01-01"; to = addDays(today, -1) < from ? today : addDays(today, -1); }
  else if (kind === "last_year") { from = `${+y - 1}-01-01`; to = `${+y - 1}-12-31`; }
  else { from = isDay(p.from) ? p.from : m + "-01"; to = isDay(p.to) && p.to >= from ? p.to : today; }
  const n = Math.round((Date.parse(to) - Date.parse(from)) / 864e5) + 1;
  const label = kind === "last_month" ? `${MONTHS[+from.slice(5, 7) - 1]} ${from.slice(0, 4)}` : `${+from.slice(8)} ${MONTHS[+from.slice(5, 7) - 1]} ${from.slice(0, 4)} – ${+to.slice(8)} ${MONTHS[+to.slice(5, 7) - 1]} ${to.slice(0, 4)}`;
  return { kind, from, to, days: n, label };
}
/* previous period: whole months → the months before (Oct → Sep, a quarter → the quarter before); otherwise the same number of days before */
const shiftPrev = P => {
  if (P.from.slice(8) === "01" && P.to === monthEnd(P.to.slice(0, 7))) {
    const n = (+P.to.slice(0, 4) - +P.from.slice(0, 4)) * 12 + (+P.to.slice(5, 7) - +P.from.slice(5, 7)) + 1;
    let m = P.from.slice(0, 7); for (let i = 0; i < n; i++) m = prevMonth(m);
    const to = addDays(P.from, -1); return { from: m + "-01", to, days: Math.round((Date.parse(to) - Date.parse(m + "-01")) / 864e5) + 1 };
  }
  const n = P.days; return { from: addDays(P.from, -n), to: addDays(P.from, -1), days: n }; };
const shiftYear = P => ({ from: `${+P.from.slice(0, 4) - 1}${P.from.slice(4)}`, to: `${+P.to.slice(0, 4) - 1}${P.to.slice(4)}`, days: P.days });

/* ================= blocks ================= */
export const BLOCKS = { kpi: "KPI card", table: "Table", bar: "Bar chart", line: "Line chart", pie: "Pie chart", badge: "Date badge (footfall)", text: "Text / comment", photos: "Photos (patrol issues)" };
async function blockData(env, b, sites, P, d) {
  const c = b.cfg || {};
  if (b.type === "text") return { text: clip(c.text, 4000) };
  if (b.type === "badge") {
    const out = [];
    for (const s of sites) {
      const R = await all(env.DB.prepare("SELECT day FROM ff_days WHERE site = ? AND day BETWEEN ? AND ? ORDER BY day").bind(s, P.from, P.to));
      const have = new Set(R.map(r => r.day)), miss = []; for (let x = P.from; x <= P.to; x = addDays(x, 1)) if (!have.has(x)) miss.push(x);
      out.push({ site: s, name: d.siteName(s), from: R.length ? R[0].day : "", to: R.length ? R[R.length - 1].day : "", n: R.length, of: P.days, missing: miss.slice(0, 31) });
    }
    return { badges: out };
  }
  if (b.type === "photos") {
    const ph = sites.map(() => "?").join(",");
    const R = await all(env.DB.prepare(`SELECT s.id, s.site, s.day, s.note, s.issues, p.data FROM patrol_scans s JOIN patrol_photos p ON p.scan_id = s.id WHERE s.site IN (${ph}) AND s.day BETWEEN ? AND ? AND s.status = 'issue' ORDER BY s.id DESC LIMIT ?`).bind(...sites, P.from, P.to, Math.min(12, Number(c.limit) || 6)));
    return { photos: R.map(r => ({ site: d.siteName(r.site), day: r.day, note: clip(r.note, 140), issues: JSON.parse(r.issues || "[]").join(", "), src: String(r.data || "").slice(0, 400000) })) };
  }
  const s = srcOf(c.source);
  const rows = await loadRows(env, c, sites, P, d);
  if (b.type === "kpi") {
    const m = measOf(s, c.measure), v = measure(m, rows);
    let pv = null;
    if (!s.noDate && c.compare && c.compare !== "none") pv = measure(m, await loadRows(env, c, sites, c.compare === "year" ? shiftYear(P) : shiftPrev(P), d));
    return { value: v, prev: pv, compare: c.compare || "none", measure: m.label, pct: ["pct", "pctw"].includes(m.kind), good: c.good || "up" };
  }
  const cfg = { ...c, dims: (c.dims || []).filter(Boolean), limit: Number(c.limit) || (b.type === "table" ? 50 : 40) };
  if (!cfg.dims.length) cfg.dims = [b.type === "line" ? "day" : "flagship"];
  const g = group(cfg, rows, d);
  return { ...g, pct: ["pct", "pctw"].includes(measOf(s, c.measure).kind) };
}
/* a whole report for given sites and period */
export async function runReport(env, def, sitesIn, P, d) {
  const sites = sitesIn.filter(x => d.SITES[x]);
  const pages = [];
  for (const pg of (def.pages || []).slice(0, 20)) {
    const groups = pg.perSite ? sites.map(s => [s]) : [sites];
    for (const ss of groups) {
      const blocks = [];
      for (const b of (pg.blocks || []).slice(0, 30)) {
        let data; try { data = await blockData(env, b, ss, P, d); } catch (e) { data = { error: e.message }; }
        blocks.push({ type: b.type, size: [1, 2, 4].includes(+b.size) ? +b.size : (["kpi"].includes(b.type) ? 1 : 4), title: clip((b.cfg || {}).title, 80) || BLOCKS[b.type], data });
      }
      pages.push({ title: clip(pg.title, 80) + (pg.perSite ? ` · ${d.siteName(ss[0])}` : ""), blocks });
    }
  }
  return { period: P, sites: sites.map(s => ({ code: s, name: d.siteName(s) })), pages };
}

/* ================= email + Excel ================= */
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const num = (v, pct) => v == null ? "—" : pct ? `${v}%` : Number(v).toLocaleString("en-US");
const delta = (v, pv) => v == null || pv == null || !pv ? "" : Math.round((v - pv) / Math.abs(pv) * 1000) / 10;
export function reportHtml(name, R, link) {
  const th = (t, i) => `<th style="padding:6px 8px;text-align:${i ? "right" : "left"};font-size:11px;background:#2A0F45;color:#fff">${esc(t)}</th>`, td = (t, r) => `<td style="padding:6px 8px;border-bottom:1px solid #EEE8F4;font-size:12px;${r ? "text-align:right" : ""}">${t}</td>`;
  const blk = b => {
    const D = b.data || {}, h = `<div style="font-size:12px;font-weight:bold;color:#4A1F73;margin:14px 0 6px;letter-spacing:.5px">${esc(b.title)}</div>`;
    if (D.error) return h + `<div style="color:#B0283C;font-size:12px">${esc(D.error)}</div>`;
    if (b.type === "text") return `<div style="font-size:13px;line-height:1.55;margin:10px 0;white-space:pre-wrap">${esc(D.text)}</div>`;
    if (b.type === "badge") return h + D.badges.map(x => `<div style="display:inline-block;background:#FBF4E2;border:1px solid #E5CF94;color:#7A5A12;border-radius:8px;padding:5px 10px;font-size:12px;font-weight:bold;margin:0 6px 6px 0">${esc(x.name)} · ${x.n ? `${+x.from.slice(8)} – ${+x.to.slice(8)} ${MONTHS[+x.to.slice(5, 7) - 1]} · ${x.n} of ${x.of} days` : "no figures"}${x.missing.length && x.n ? ` · ${x.missing.length} missing` : ""}</div>`).join("");
    if (b.type === "photos") return h + (D.photos.length ? `<div style="font-size:12px;color:#6D6479">${D.photos.length} patrol issue photo(s) — open the report in the hub to see them.</div>` : `<div style="font-size:12px;color:#6D6479">No patrol issue with a photo.</div>`);
    if (b.type === "kpi") { const dl = delta(D.value, D.prev), good = dl === "" ? "" : (dl >= 0) === (D.good !== "down");
      return `<table style="border-collapse:collapse;display:inline-table;margin:4px 6px 4px 0"><tr><td style="padding:10px 14px;border:1px solid #EEE8F4;border-top:3px solid #C8A24A;min-width:150px"><div style="font-size:10px;letter-spacing:1px;color:#6D6479">${esc(b.title).toUpperCase()}</div><div style="font-size:22px;font-weight:bold">${num(D.value, D.pct)}</div>${dl !== "" ? `<div style="font-size:11px;font-weight:bold;color:${good ? "#1E8A4C" : "#B0283C"}">${dl >= 0 ? "▲" : "▼"} ${Math.abs(dl)}% vs ${D.compare === "year" ? "last year" : "previous period"}</div>` : ""}</td></tr></table>`; }
    if (!D.rows) return h + `<div style="font-size:12px">${num(D.value, D.pct)}</div>`;
    if (!D.rows.length) return h + `<div style="font-size:12px;color:#6D6479">No data in this period.</div>`;
    if (b.type === "table" || D.series) return h + `<table style="width:100%;border-collapse:collapse">${`<tr>${D.cols.map((c, i) => th(c, i)).join("")}</tr>`}${D.rows.map(r => `<tr>${td(esc(r[0]))}${r.slice(1, D.cols.length).map(v => td(num(v, D.pct), 1)).join("")}</tr>`).join("")}</table>`;
    const mx = Math.max(1, ...D.rows.map(r => Number(r[1]) || 0));   /* bar / line / pie in an email: horizontal bars (Outlook has no charts) */
    return h + `<table style="width:100%;border-collapse:collapse">${D.rows.slice(0, 31).map(r => `<tr><td style="padding:3px 8px 3px 0;font-size:11px;white-space:nowrap;width:130px">${esc(r[0])}</td><td style="padding:3px 0"><div style="background:#4A1F73;height:12px;border-radius:3px;width:${Math.max(1, Math.round((Number(r[1]) || 0) / mx * 100))}%"></div></td><td style="padding:3px 0 3px 8px;font-size:11px;text-align:right;width:70px">${num(r[1], D.pct)}</td></tr>`).join("")}</table>`;
  };
  return `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:860px;margin:0 auto;border:1px solid #E6E0EE;border-radius:12px;overflow:hidden;color:#221A2E">
    <div style="background:#2A0F45;padding:18px 22px"><div style="color:#fff;font-size:15px;font-weight:bold;letter-spacing:1px">ABC OPERATIONS</div><div style="color:#E9CF8A;font-size:12px;letter-spacing:1px;margin-top:3px">${esc(name).toUpperCase()}</div>
      <div style="color:#fff;font-size:18px;font-weight:bold;margin-top:8px">${esc(R.period.label)}</div><div style="color:#D8CCE6;font-size:12px;margin-top:2px">${esc(R.sites.map(s => s.name).join(" · "))}</div></div>
    <div style="padding:6px 22px 20px">${R.pages.map(p => `<div style="font-size:14px;font-weight:bold;color:#2A0F45;border-bottom:2px solid #C8A24A;padding:14px 0 4px;margin-bottom:4px">${esc(p.title)}</div>${p.blocks.map(blk).join("")}`).join("")}
    ${link ? `<p style="margin-top:18px"><a href="${esc(link)}" style="background:#4A1F73;color:#fff;text-decoration:none;font-weight:bold;padding:10px 18px;border-radius:9px;font-size:13px">Open in the hub · PDF · Excel</a></p>` : ""}
    <p style="color:#6D6479;font-size:11px;margin-top:16px">Automated report — ABC Operations Hub.</p></div></div>`;
}
/* Excel 2003 XML (opens in Excel with every table / chart block as a sheet) */
export function reportXls(name, R) {
  const x = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const used = new Set(), sheetName = t => { let n = String(t).replace(/[\\/?*[\]:]/g, " ").slice(0, 28) || "Sheet"; let k = n, i = 2; while (used.has(k)) k = n.slice(0, 25) + " " + i++; used.add(k); return k; };
  const cell = v => typeof v === "number" ? `<Cell><Data ss:Type="Number">${v}</Data></Cell>` : `<Cell><Data ss:Type="String">${x(v ?? "")}</Data></Cell>`;
  const sheets = [`<Worksheet ss:Name="${sheetName("Summary")}"><Table><Row>${cell(name)}</Row><Row>${cell(R.period.label)}</Row><Row>${cell(R.sites.map(s => s.name).join(", "))}</Row>${R.pages.flatMap(p => p.blocks.filter(b => b.type === "kpi").map(b => `<Row>${cell(p.title)}${cell(b.title)}${cell(b.data.value)}${b.data.prev != null ? cell(b.data.prev) : ""}</Row>`)).join("")}</Table></Worksheet>`];
  for (const p of R.pages) for (const b of p.blocks) if (b.data && b.data.rows) sheets.push(`<Worksheet ss:Name="${sheetName(b.title)}"><Table><Row>${b.data.cols.map(cell).join("")}</Row>${b.data.rows.map(r => `<Row>${r.slice(0, b.data.cols.length).map(cell).join("")}</Row>`).join("")}</Table></Worksheet>`);
  return `<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">${sheets.join("")}</Workbook>`;
}
const b64 = s => { const u = new TextEncoder().encode(s); let o = ""; for (let i = 0; i < u.length; i += 0x8000) o += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(o); };

/* ================= recipients ================= */
/* entries: an email · "pos:KEY" (every active person of that position at the report's flagships) · "ops" (the flagships' operations group emails) · "subs" */
async function resolve(env, list, sites, d) {
  const out = new Set();
  const users = (await all(env.DB.prepare("SELECT email, role, position, site_code, sites FROM users WHERE active = 1"))) || [];
  for (const e of list || []) {
    if (EMAIL_RE.test(e)) out.add(String(e).toLowerCase());
    else if (e === "ops") { const g = await d.opsGroups(env); for (const s of sites) for (const m of (g[s] || {}).emails || []) out.add(m); }
    else if (/^pos:/.test(e)) { const k = e.slice(4); for (const u of users) if (lpKeyOf(u) === k && d.sitesOf(u).some(s => sites.includes(s))) out.add(u.email); }
  }
  return [...out];
}

/* ================= run · send ================= */
const cleanDef = (raw) => {
  const r = raw && typeof raw === "object" ? raw : {};
  const pages = (Array.isArray(r.pages) ? r.pages : []).slice(0, 20).map(p => ({ title: clip(p.title, 80) || "Page", perSite: !!p.perSite,
    blocks: (Array.isArray(p.blocks) ? p.blocks : []).slice(0, 30).filter(b => BLOCKS[b.type]).map(b => {
      const c = b.cfg || {}, cfg = { title: clip(c.title, 80) };
      if (b.type === "text") cfg.text = clip(c.text, 4000);
      else if (b.type === "photos") cfg.limit = Math.min(12, Number(c.limit) || 6);
      else if (b.type !== "badge") { if (!SOURCES[c.source]) throw err(`Choose the data of “${cfg.title || BLOCKS[b.type]}”`);
        const S = SOURCES[c.source]; cfg.source = c.source; cfg.measure = S.measures[c.measure] ? c.measure : Object.keys(S.measures)[0];
        cfg.dims = (Array.isArray(c.dims) ? c.dims : []).filter(x => S.dims[x]).slice(0, 2);
        cfg.filter = Object.fromEntries(Object.entries(c.filter || {}).filter(([k, v]) => S.dims[k] && Array.isArray(v)).map(([k, v]) => [k, v.slice(0, 40).map(x => clip(x, 80))]));
        if (b.type === "kpi") { cfg.compare = ["prev", "year", "none"].includes(c.compare) ? c.compare : "prev"; cfg.good = c.good === "down" ? "down" : "up"; }
        else cfg.limit = Math.min(200, Number(c.limit) || 0) || undefined; }
      return { type: b.type, size: [1, 2, 4].includes(+b.size) ? +b.size : (b.type === "kpi" ? 1 : 4), cfg };
    }) }));
  const list = v => [...new Set((Array.isArray(v) ? v : String(v || "").split(/[\s,;]+/)).map(x => String(x).trim()).filter(x => x && (EMAIL_RE.test(x) || x === "ops" || /^pos:[A-Z]+$/.test(x))))].slice(0, 40);
  const sc = r.schedule || {};
  return { pages, period: { kind: PERIODS[(r.period || {}).kind] ? r.period.kind : "last_month", from: (r.period || {}).from || "", to: (r.period || {}).to || "" },
    sites: Array.isArray(r.sites) ? r.sites.filter(x => /^[A-Z]{3}$/.test(x)) : "ALL", to: list(r.to), cc: list(r.cc), excel: r.excel !== false,
    schedule: { on: !!sc.on, freq: ["monthly", "weekly", "daily"].includes(sc.freq) ? sc.freq : "monthly", dom: Math.min(28, Math.max(1, Number(sc.dom) || 1)), dow: Math.min(6, Math.max(0, Number(sc.dow) || 0)), time: /^([01]\d|2[0-3]):[0-5]\d$/.test(sc.time) ? sc.time : "09:00" },
    subs: { on: !!(r.subs && r.subs.on), positions: (r.subs && Array.isArray(r.subs.positions) ? r.subs.positions : []).filter(k => LP_POSITIONS[k]) } };
};
/* the kept copy of a run: photos are dropped when it gets too big for the database */
const keep = R => { let s = JSON.stringify(R); if (s.length > 900000) { const c = JSON.parse(s); for (const pg of c.pages) for (const b of pg.blocks) if (b.data && b.data.photos) b.data.photos = b.data.photos.map(x => ({ ...x, src: "" })); s = JSON.stringify(c); }
  return s.length > 950000 ? JSON.stringify({ ...R, pages: [], tooBig: true }) : s; };
async function doRun(env, rep, d, o = {}) {
  const def = JSON.parse(rep.def || "{}"), P = o.period ? periodOf(o.period, d.today()) : periodOf(def.period, d.today());
  const sites = (o.sites && o.sites.length ? o.sites : Array.isArray(def.sites) && def.sites.length ? def.sites : Object.keys(d.SITES)).filter(s => d.SITES[s]);
  const R = await runReport(env, def, sites, P, d);
  let sent = [], status = "viewed";
  if (o.send) {
    const subs = def.subs && def.subs.on ? (await all(env.DB.prepare("SELECT email FROM rp_subs WHERE report_id = ?").bind(rep.id))).map(r => r.email) : [];
    const to = o.testTo ? [o.testTo] : [...new Set([...(await resolve(env, def.to, sites, d)), ...subs])], cc = o.testTo ? [] : (await resolve(env, def.cc, sites, d)).filter(e => !to.includes(e));
    if (!to.length && !cc.length) throw err("This report has no recipient — add them in the builder (Recipients) or let people subscribe");
    const ins = await env.DB.prepare("INSERT INTO rp_runs (report_id, name, period, sites, at, by_name, how, sent_to, status, data) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .bind(rep.id, rep.name, JSON.stringify(P), sites.join(","), new Date().toISOString(), o.by || "Schedule", o.how || "sent", [...to, ...cc].join(", ").slice(0, 2000), "sending", keep(R)).run();
    const runId = ins.meta.last_row_id, link = `${d.hubUrl}/tools/reports?run=${runId}`;
    const m = { from: o.from || rep.created_email || FROM, to, cc, subject: `${o.testTo ? "[TEST] " : ""}ABC Operations — ${rep.name} — ${P.label}`, html: reportHtml(rep.name, R, link) };
    if (def.excel !== false) m.attachment = { fileName: `${rep.name.replace(/[^\w\- ]+/g, "")} ${P.label.replace(/[^\w\- ]+/g, " ")}.xls`.replace(/\s+/g, " "), mimeType: "application/vnd.ms-excel", base64: b64(reportXls(rep.name, R)) };
    const s = await d.outlookSend(env, m).catch(e => ({ ok: false, error: e.message }));
    status = s && s.ok ? "sent" : "not sent: " + ((s && s.error) || "Outlook is not connected in the hub");
    await env.DB.prepare("UPDATE rp_runs SET status = ? WHERE id = ?").bind(status, runId).run();
    if (!(s && s.ok)) throw err(status);
    sent = [...to, ...cc];
    return { runId, sent, status, result: R };
  }
  if (!rep.id) return { result: R };   // preview of a report not saved yet
  const ins = await env.DB.prepare("INSERT INTO rp_runs (report_id, name, period, sites, at, by_name, how, sent_to, status, data) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .bind(rep.id, rep.name, JSON.stringify(P), sites.join(","), new Date().toISOString(), o.by || "", "run", "", status, keep(R)).run();
  await env.DB.prepare("DELETE FROM rp_runs WHERE report_id = ? AND how = 'run' AND id NOT IN (SELECT id FROM rp_runs WHERE report_id = ? AND how = 'run' ORDER BY id DESC LIMIT 10)").bind(rep.id, rep.id).run().catch(() => {});
  return { runId: ins.meta.last_row_id, result: R };
}
/* cron (every 2 minutes): scheduled reports */
export async function rpRun(env, d) {
  const today = d.today(), hm = d.hm(), dow = (new Date(today + "T12:00:00Z").getUTCDay() + 6) % 7;
  for (const rep of await all(env.DB.prepare("SELECT * FROM rp_reports WHERE deleted = 0"))) {
    let def; try { def = JSON.parse(rep.def || "{}"); } catch { continue; }
    const s = def.schedule || {}; if (!s.on || hm < (s.time || "09:00")) continue;
    if (s.freq === "monthly" && +today.slice(8) !== (s.dom || 1)) continue;
    if (s.freq === "weekly" && dow !== (s.dow || 0)) continue;
    const c = await env.DB.prepare("INSERT OR IGNORE INTO meta (k, v) VALUES (?, ?)").bind(`rp:sent:${rep.id}:${today}`, new Date().toISOString()).run().catch(() => null);
    if (!(c && c.meta && c.meta.changes === 1)) continue;
    await doRun(env, rep, d, { send: true, how: "scheduled", by: "Schedule" }).catch(e => console.error("report", rep.id, e && e.message));
  }
}

/* ================= routes ================= */
const repOut = (r, subs, mine) => { const def = JSON.parse(r.def || "{}");
  return { id: r.id, name: r.name, icon: r.icon, def, updatedAt: r.updated_at, updatedBy: r.updated_by, subs: subs || 0, subscribed: !!mine }; };
export async function rpRoute(env, p, method, b, url, d) {
  const me = d.me, admin = d.isAdmin(me), q = k => url.searchParams.get(k) || "";
  const getRep = async id => { const r = await env.DB.prepare("SELECT * FROM rp_reports WHERE id = ? AND deleted = 0").bind(Number(id) || 0).first(); if (!r) throw err("Report not found", 404); return r; };
  const canSee = (rep) => { if (admin) return true; const def = JSON.parse(rep.def || "{}"); return !!(def.subs && def.subs.on && def.subs.positions.includes(lpKeyOf(me))); };
  if (p === "rp/meta") return { sources: Object.fromEntries(Object.entries(SOURCES).map(([k, s]) => [k, { name: s.name, group: s.group, dims: s.dims, noDate: !!s.noDate, measures: Object.fromEntries(Object.entries(s.measures).map(([mk, m]) => [mk, m.label])) }])),
    blocks: BLOCKS, periods: PERIODS, positions: LP_POSITIONS, sites: d.SITES, admin, me: { email: me.email, name: me.full_name } };
  if (p === "rp/list") {
    const reps = await all(env.DB.prepare("SELECT * FROM rp_reports WHERE deleted = 0 ORDER BY name"));
    const cnt = Object.fromEntries((await all(env.DB.prepare("SELECT report_id, COUNT(*) AS n FROM rp_subs GROUP BY report_id"))).map(r => [r.report_id, r.n]));
    const mine = new Set((await all(env.DB.prepare("SELECT report_id FROM rp_subs WHERE email = ?").bind(me.email))).map(r => r.report_id));
    const runs = await all(env.DB.prepare("SELECT id, report_id, name, period, sites, at, by_name, how, sent_to, status FROM rp_runs ORDER BY id DESC LIMIT 40"));
    const vis = reps.filter(canSee), ids = new Set(vis.map(r => r.id));
    return { reports: vis.map(r => repOut(r, cnt[r.id], mine.has(r.id))).map(x => admin ? x : { ...x, def: { subs: x.def.subs, schedule: x.def.schedule, period: x.def.period, sites: x.def.sites } }),
      runs: runs.filter(r => ids.has(r.report_id)).map(r => ({ ...r, period: JSON.parse(r.period || "{}"), sent_to: admin ? r.sent_to : "" })) };
  }
  if (p === "rp/run-get") {   // one kept run (view / PDF / Excel)
    const r = await env.DB.prepare("SELECT * FROM rp_runs WHERE id = ?").bind(Number(q("id")) || 0).first(); if (!r) throw err("Report not found", 404);
    const rep = await env.DB.prepare("SELECT * FROM rp_reports WHERE id = ?").bind(r.report_id).first();
    const sub = await env.DB.prepare("SELECT 1 FROM rp_subs WHERE report_id = ? AND email = ?").bind(r.report_id, me.email).first();
    const inList = String(r.sent_to || "").toLowerCase().split(/,\s*/).includes(me.email);
    if (!admin && !(rep && canSee(rep)) && !sub && !inList) throw err("Not allowed", 403);
    return { id: r.id, name: r.name, at: r.at, how: r.how, result: JSON.parse(r.data || "{}") };
  }
  if (p === "rp/subscribe" && method === "POST") {
    const rep = await getRep(b.id); if (!canSee(rep) || !(JSON.parse(rep.def || "{}").subs || {}).on) throw err("This report is not open for subscription", 403);
    if (b.on) await env.DB.prepare("INSERT OR IGNORE INTO rp_subs (report_id, email, at) VALUES (?,?,?)").bind(rep.id, me.email, new Date().toISOString()).run();
    else await env.DB.prepare("DELETE FROM rp_subs WHERE report_id = ? AND email = ?").bind(rep.id, me.email).run();
    return { subscribed: !!b.on };
  }
  if (!admin) throw err("Administrators only", 403);
  if (p === "rp/get") { const r = await getRep(q("id")); const subs = await all(env.DB.prepare("SELECT s.email, s.at, u.full_name FROM rp_subs s LEFT JOIN users u ON u.email = s.email WHERE s.report_id = ? ORDER BY s.at").bind(r.id)); return { report: repOut(r), subscribers: subs }; }
  if (p === "rp/save" && method === "POST") {
    const name = clip(b.name, 80); if (!name) throw err("Name the report");
    const def = cleanDef(b.def), at = new Date().toISOString(), icon = clip(b.icon, 4) || "📑";
    if (b.id) { await getRep(b.id); await env.DB.prepare("UPDATE rp_reports SET name = ?, icon = ?, def = ?, updated_at = ?, updated_by = ? WHERE id = ?").bind(name, icon, JSON.stringify(def), at, me.full_name, Number(b.id)).run(); return { id: Number(b.id) }; }
    const r = await env.DB.prepare("INSERT INTO rp_reports (name, icon, def, created_at, created_by, created_email, updated_at, updated_by) VALUES (?,?,?,?,?,?,?,?)").bind(name, icon, JSON.stringify(def), at, me.full_name, me.email, at, me.full_name).run();
    return { id: r.meta.last_row_id };
  }
  if (p === "rp/delete" && method === "POST") { await getRep(b.id); await env.DB.prepare("UPDATE rp_reports SET deleted = 1 WHERE id = ?").bind(Number(b.id)).run(); return { deleted: true }; }
  if (p === "rp/run" && method === "POST") {   // preview / run now / send now / test to me
    const rep = b.id ? await getRep(b.id) : { id: 0, name: clip(b.name, 80) || "Report", def: JSON.stringify(cleanDef(b.def)), created_email: me.email };
    if (b.def && b.id) rep.def = JSON.stringify(cleanDef(b.def));   // unsaved changes in the builder
    if (!rep.id && b.send) throw err("Save the report first");
    return await doRun(env, rep, d, { period: b.period, sites: Array.isArray(b.sites) ? b.sites : null, send: !!b.send, testTo: b.test ? me.email : "", by: me.full_name, how: b.test ? "test" : b.send ? "sent" : "run", from: me.email });
  }
  if (p === "rp/explore" && method === "POST") {   // C: free table / chart
    const S = srcOf(b.source), P = periodOf(b.period || { kind: "last_month" }, d.today()), sites = (Array.isArray(b.sites) && b.sites.length ? b.sites : Object.keys(d.SITES)).filter(s => d.SITES[s]);
    const cfg = { source: b.source, measure: b.measure, dims: (b.dims || []).filter(x => S.dims[x]).slice(0, 2), filter: b.filter || {}, limit: Math.min(500, Number(b.limit) || 200) };
    const rows = await loadRows(env, cfg, sites, P, d);
    if (b.drill) {   // the records behind one cell
      const [d1, v1, d2, v2] = b.drill;
      const R = rows.filter(r => (!d1 || dimVal(r, d1, d) === v1) && (!d2 || dimVal(r, d2, d) === v2)).slice(0, 300);
      return { records: R.map(r => ({ ...Object.fromEntries(Object.keys(S.dims).map(k => [S.dims[k], dimLabel(k, dimVal(r, k, d))])) })) };
    }
    return { period: P, sites, rowsRead: rows.length, ...(cfg.dims.length ? group(cfg, rows, d) : { measure: measOf(S, cfg.measure).label, value: measure(measOf(S, cfg.measure), rows) }) };
  }
  if (p === "rp/values" && method === "POST") {   // the values of one grouping (for filters)
    const S = srcOf(b.source), P = periodOf(b.period || { kind: "last_month" }, d.today()), sites = (Array.isArray(b.sites) && b.sites.length ? b.sites : Object.keys(d.SITES)).filter(s => d.SITES[s]);
    if (!S.dims[b.dim]) throw err("Choose the grouping");
    const rows = await S.load(env, sites, P.from, P.to, d);
    return { values: [...new Set(rows.map(r => dimVal(r, b.dim, d)))].sort().slice(0, 200) };
  }
  throw err("Unknown request", 404);
}

/* ================= starter reports ================= */
const K = (title, source, measure, o = {}) => ({ type: "kpi", size: 1, cfg: { title, source, measure, compare: "prev", ...o } });
const T = (type, title, source, measure, dims, o = {}) => ({ type, size: o.size || 4, cfg: { title, source, measure, dims, ...o.cfg } });
const STARTERS = [
  { name: "Footfall · Monthly", icon: "👣", def: { period: { kind: "last_month" }, sites: ["VRM", "ACM"], to: ["pos:DIRECTOR"], cc: ["ops"], excel: true,
    schedule: { on: false, freq: "monthly", dom: 1, time: "09:00" }, subs: { on: true, positions: ["MM", "OM", "ADVISOR", "DIRECTOR", "CDSO"] },
    pages: [{ title: "Summary", blocks: [{ type: "badge", size: 4, cfg: { title: "Dates covered" } }, K("Car entries", "footfall", "entries"), K("Without employees", "footfall", "noemp"), K("Daily average", "footfall", "avgday"), K("Car entries vs last year", "footfall", "entries", { compare: "year" }),
      T("bar", "Car entries by day", "footfall", "entries", ["day", "flagship"]), T("table", "By flagship", "footfall", "entries", ["flagship"], { size: 2 }), T("table", "Entries by gate", "ffgates", "cars", ["gate", "flagship"], { size: 2, cfg: { filter: { dir: ["Entry"] } } }),
      T("bar", "Average by weekday", "footfall", "avgday", ["weekday", "flagship"], { size: 2 }), T("pie", "Parking duration", "parking", "cars", ["bucket"], { size: 2 }),
      { type: "text", size: 4, cfg: { title: "Comment", text: "" } }] }] } },
  { name: "Tenant Compliance · Monthly", icon: "⚖️", def: { period: { kind: "last_month" }, sites: "ALL", to: [], cc: [], excel: true,
    schedule: { on: false, freq: "monthly", dom: 2, time: "10:00" }, subs: { on: true, positions: ["MM", "OM", "SMS", "ADVISOR", "DIRECTOR", "CDSO"] },
    pages: [{ title: "Tenant compliance", perSite: true, blocks: [K("Portal items", "tenantitems", "n"), K("Still open", "tenantitems", "open", { good: "down" }), K("Tenant feedback", "feedback", "n", { good: "down" }), K("PM certificates completed", "pm", "done", { compare: "none" }),
      T("table", "Items by tenant and kind", "tenantitems", "n", ["tenant", "kind"], { cfg: { limit: 25 } }), T("table", "Repeat feedback by tenant", "feedback", "n", ["tenant", "category"], { size: 2, cfg: { limit: 15 } }),
      T("pie", "Items by kind", "tenantitems", "n", ["kind"], { size: 2 }), T("table", "PM certificates by status", "pm", "n", ["tenant", "state"], { size: 4, cfg: { limit: 25 } })] }] } },
  { name: "Monthly Operations Pack", icon: "📦", def: { period: { kind: "last_month" }, sites: "ALL", to: ["pos:ADVISOR", "pos:DIRECTOR", "pos:CDSO"], cc: [], excel: true,
    schedule: { on: false, freq: "monthly", dom: 2, time: "10:00" }, subs: { on: true, positions: ["MM", "OM", "ADVISOR", "DIRECTOR", "CDSO"] },
    pages: [{ title: "Operations", perSite: true, blocks: [K("Incidents", "incidents", "n", { good: "down" }), K("PIR on time", "incidents", "pirok"), K("Malfunctions", "malfunctions", "n", { good: "down" }), K("Fixed within 48 h", "malfunctions", "fix48"),
      K("Checklists submitted", "checklists", "sub"), K("Restroom inspections", "restroom", "n"), K("Contractor visits", "contractors", "arrived"), K("Car entries", "footfall", "entries"),
      T("table", "Incidents by type", "incidents", "n", ["type", "severity"], { size: 2, cfg: { limit: 12 } }), T("table", "Malfunctions by category", "malfunctions", "n", ["category", "status"], { size: 2, cfg: { limit: 12 } }),
      T("bar", "Tenant portal items by kind", "tenantitems", "n", ["kind"], { size: 2 }), T("table", "GLA by section", "gla", "occ", ["section"], { size: 2 }),
      T("line", "Car entries by day", "footfall", "entries", ["day"])] }] } }
];
