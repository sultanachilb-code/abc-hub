/* =====================================================================
   EXECUTIVE REPORT — feature module (kept separate so it can be removed cleanly)
   See docs/FEATURE-exec-report.md

   One report per flagship per month. What the hub already knows is filled in
   automatically; what it does not know yet (sales, footfall, QC scores,
   commentary) is typed / pasted by the Manager and saved with the month.

   Automatic
     · Occupancy per floor and vacant units ....... GLA as it stood on the last day of the month
     · "Ex-" name of vacant units ................. GLA change history
     · Opened / closed year to date ............... GLA change history (Jan 1 → end of month)
     · Fit-out units + contract date .............. GLA (Fit-out / Reserved, contract start)
     · CAPEX projects and annual budget ........... Budget · CAPEX sheet of that year
   Manual (kept from month to month)
     · Footfall, QC results, highlights and commentary, CAPEX status / deadline / comment
   Sales — NEVER stored in the hub (local only)
     · The sales workbook is read in the browser, used for the report / PDF and gone when the page closes.
       The server strips every sales field on save and on read, and a one-time clean-up erased the sales saved before.
       Only the names of the retail groups to show ("salesGroups") are kept — no figures.

   Tables : exec_reports
   Routes : /api/ops/exec/*
   ===================================================================== */
import { EXEC_SEED } from "../data/exec-seed.js";

const err = (m, status = 400) => Object.assign(new Error(m), { status });
const MN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const isPeriod = v => /^20\d\d-(0[1-9]|1[0-2])$/.test(String(v || ""));
const monthEnd = p => { const [y, m] = p.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
const prevPeriod = p => { let [y, m] = p.split("-").map(Number); m--; if (!m) { m = 12; y--; } return `${y}-${String(m).padStart(2, "0")}`; };
const label = p => { const [y, m] = p.split("-").map(Number); return `${MN[m - 1]} ${y}`; };
const nk = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

export async function execSchema(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS exec_reports (site TEXT NOT NULL, period TEXT NOT NULL, data TEXT NOT NULL,
    updated_by TEXT, updated_at TEXT, PRIMARY KEY (site, period))`).run();
  /* one-time clean-up: erase the sales figures saved before sales became local-only */
  const done = await env.DB.prepare("SELECT v FROM meta WHERE k = 'exec:salesPurged'").first().catch(() => null);
  if (!done) {
    const { results } = await env.DB.prepare("SELECT site, period, data FROM exec_reports").all().catch(() => ({ results: [] }));
    for (const r of results || []) {
      let d; try { d = JSON.parse(r.data); } catch { continue; }
      await env.DB.prepare("UPDATE exec_reports SET data = ? WHERE site = ? AND period = ?").bind(JSON.stringify(clean(d)), r.site, r.period).run();
    }
    await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('exec:salesPurged', ?)").bind(new Date().toISOString()).run().catch(() => {});
  }
}

/* ---------- automatic part ---------- */
const STATUS_MAP = { Open: "Active", Closed: "Active", "Fit-out": "Fit out", Reserved: "Fit out", Terminated: "Terminated", Vacant: "Vacant" };
const TYPE_MAP = { Leasing: "Leasing GLA", "Pop-up": "Pop Up", DS: "DS", iPlay: "iPlay" };
const dmy = d => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d || "")); return m ? `${Number(m[3])}/${Number(m[2])}/${m[1]}` : ""; };

async function autoPart(env, site, period, deps) {
  const end = monthEnd(period), year = period.slice(0, 4);
  const [units, evs, capex] = await Promise.all([
    deps.glaAsOf(env, site, end),
    env.DB.prepare("SELECT * FROM gla_events WHERE site = ? AND eff_date <= ? ORDER BY eff_date, id").bind(site, end).all(),
    env.DB.prepare("SELECT title, budget, fct, landing, notes FROM budget_lines WHERE site = ? AND kind = 'capex' AND year = ? ORDER BY seq, id")
      .bind(site, Number(year)).all().catch(() => ({ results: [] }))
  ]);
  /* last brand each unit had before it went vacant → "Ex-<brand>" */
  const lastBrand = new Map(), opened = new Map(), closed = new Map();
  const byId = new Map(units.map(u => [u.id, u]));
  for (const e of evs.results || []) {
    const b = JSON.parse(e.before || "{}"), a = JSON.parse(e.after || "{}");
    if (b.brand) lastBrand.set(e.unit_id, b.brand);
    if (e.eff_date < `${year}-01-01`) continue;
    const sec = a.section || b.section || (byId.get(e.unit_id) || {}).section || "Leasing";
    if (sec === "DS" || sec === "Additional") continue;
    const cur = byId.get(e.unit_id) || {};
    if (e.kind === "add" && a.status === "Open" && a.brand) opened.set(nk(a.brand), a.brand);
    if (e.kind === "remove" && ["Open", "Closed"].includes(b.status) && b.brand) closed.set(nk(b.brand), b.brand);
    if (e.kind !== "update") continue;
    const wasOpen = b.status ? ["Open", "Closed"].includes(b.status) : ["Open", "Closed"].includes(cur.status);
    if (a.status === "Open" && b.status && !["Open", "Closed"].includes(b.status)) { const n = a.brand || cur.brand; if (n) opened.set(nk(n), n); }
    if (["Terminated", "Vacant"].includes(a.status) && wasOpen) { const n = b.brand || cur.brand; if (n) closed.set(nk(n), n); }
    if (a.brand && b.brand && nk(a.brand) !== nk(b.brand) && (a.status || cur.status) === "Open") { opened.set(nk(a.brand), a.brand); closed.set(nk(b.brand), b.brand); }
  }
  const out = units.filter(u => TYPE_MAP[u.section]).map(u => ({
    floor: u.level === "LGF" ? "LG" : u.level, code: u.code, brand: u.brand || (u.status === "Vacant" ? "VACANT" : ""), type: TYPE_MAP[u.section], dept: u.dept, sqm: u.area,
    status: STATUS_MAP[u.status] || "Active", hubStatus: u.status, unitId: u.id,
    note: u.status === "Vacant" && lastBrand.get(u.id) ? `Ex-${lastBrand.get(u.id)}` : "",
    contract: dmy(u.contractStart || u.contract_start)
  }));
  return {
    period, periodLabel: label(period), asOf: end, units: out,
    opened: [...opened.values()], closed: [...closed.values()],
    capex: (capex.results || []).map(c => ({ project: c.title, bgt: c.budget, fct: c.fct, landing: c.landing, notes: c.notes }))
  };
}

/* ---------- the saved (manual) part ---------- */
/* sales fields (salesTotal, salesLfl, declineBase, declineTitle, salesNote, decline, groups, newt, low and the
   sales columns of the footfall table) are deliberately absent: whatever is sent, they are never stored */
const TEXT_KEYS = ["prepared", "currency", "highlights", "occNote", "leaseNote", "capexNote",
  "qcPrevLabel", "qcPrev", "qcCurLabel", "qcCur", "qcNote", "salesGroups"];
const TABLE_KEYS = ["opened", "closed", "contracts", "footfall", "capex"];
const ROW_KEEP = { footfall: ["month", "ff25", "ff26"] };
function clean(d) {
  const o = {};
  for (const k of TEXT_KEYS) o[k] = String(d[k] ?? "").slice(0, k.endsWith("Note") || k === "highlights" ? 6000 : k === "salesGroups" ? 600 : 200);
  for (const k of TABLE_KEYS) o[k] = Array.isArray(d[k]) ? d[k].slice(0, 400).map(r => {
    const x = {}; for (const [kk, vv] of Object.entries(r || {})) if (/^[a-z0-9]{1,12}$/i.test(kk) && (!ROW_KEEP[k] || ROW_KEEP[k].includes(kk))) x[kk] = typeof vv === "number" ? vv : String(vv ?? "").slice(0, 300); return x;
  }) : [];
  for (const k of ["unitNotes", "fitout", "hideMoves"]) o[k] = d[k] && typeof d[k] === "object" && !Array.isArray(d[k]) ? JSON.parse(JSON.stringify(d[k]).slice(0, 60000)) : {};
  return o;
}
/* a month with nothing saved starts from the month before: QC current → previous, commentary cleared, tables kept */
function rollForward(prev, period) {
  const d = JSON.parse(JSON.stringify(prev));
  d.qcPrevLabel = d.qcCurLabel || ""; d.qcPrev = d.qcCur || ""; d.qcCurLabel = label(period); d.qcCur = "";
  for (const k of ["highlights", "occNote", "leaseNote", "capexNote", "qcNote"]) d[k] = "";
  if (period.endsWith("-01")) { d.opened = []; d.closed = []; d.footfall = []; d.hideMoves = {}; }   // a new year starts clean
  return d;
}

/* ctx = { site, can, me, now, siteName, sites, glaAsOf } — can.exec: see & edit */
export async function execRoute(env, p, method, b, url, ctx) {
  const { can, me, now } = ctx;
  if (!can.exec) throw err("The executive report is for flagship management and leadership", 403);
  const q = k => url.searchParams.get(k);

  if (p === "exec/get") {
    const site = ctx.site, period = isPeriod(q("period")) ? q("period") : null;
    if (!period) throw err("Choose the month");
    let row = await env.DB.prepare("SELECT * FROM exec_reports WHERE site = ? AND period = ?").bind(site, period).first();
    let data, source = "saved";
    if (row) data = clean(JSON.parse(row.data));
    else {
      const prev = await env.DB.prepare("SELECT * FROM exec_reports WHERE site = ? AND period < ? ORDER BY period DESC LIMIT 1").bind(site, period).first();
      const seed = EXEC_SEED[site];
      if (prev) { data = rollForward(clean(JSON.parse(prev.data)), period); source = `from ${label(prev.period)}`; }
      else if (seed && seed.period === period) { data = clean(seed.data); source = "the August report"; }
      else if (seed && seed.period < period) { data = rollForward(clean(seed.data), period); source = "the August report"; }
      else { data = clean({}); source = "new"; }
    }
    const auto = await autoPart(env, site, period, { glaAsOf: ctx.glaAsOf });
    const periods = ((await env.DB.prepare("SELECT period, updated_by, updated_at FROM exec_reports WHERE site = ? ORDER BY period DESC").bind(site).all()).results || []);
    return { site, siteName: ctx.siteName(site), period, periodLabel: label(period), data, source, savedAt: row ? row.updated_at : "", savedBy: row ? row.updated_by : "",
      auto, periods, sites: ctx.sites, can: { edit: true, all: Object.keys(ctx.sites || {}).length > 1 } };
  }
  if (p === "exec/save" && method === "POST") {
    if (!isPeriod(b.period)) throw err("Choose the month");
    const data = clean(b.data || {});
    const s = JSON.stringify(data);
    if (s.length > 800000) throw err("The report is too large to save");
    await env.DB.prepare(`INSERT INTO exec_reports (site, period, data, updated_by, updated_at) VALUES (?,?,?,?,?)
      ON CONFLICT(site, period) DO UPDATE SET data = excluded.data, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
      .bind(ctx.site, b.period, s, me.full_name, now()).run();
    return { saved: true, at: now() };
  }
  throw err("Unknown endpoint", 404);
}
