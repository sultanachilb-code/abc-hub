/* =====================================================================
   DATA ACCURACY SCORE — feature module (kept separate so it can be removed cleanly)
   See docs/FEATURE-accuracy.md

   For each flagship: when each property reference was last updated, by whom,
   and a score that falls as the data gets older.

     GLA & Occupancy ...... last unit change or GLA event        fresh ≤ 30 days · due ≤ 60 · stale after
     Property Details ..... last value changed                   fresh ≤ 90 days · due ≤ 180 · stale after
     Executive Report ..... last month saved                     last month saved · 1 month behind · older
     Budget CAPEX & OPEX .. this year's sheets uploaded           both · one of the two · none this year

   Scores: fresh 100 · due 60 · stale 20 · never updated 0. The flagship score is the average.
   Tables : none (reads gla_units, gla_events, property_log, exec_reports, ops_settings)
   Routes : /api/ops/accuracy
   ===================================================================== */

const DAY = 864e5;
const MN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const later = (a, b) => (!a ? b : !b ? a : (a.at >= b.at ? a : b));
const ageDays = (at, now) => at ? Math.max(0, Math.floor((now - Date.parse(at)) / DAY)) : null;
const band = (days, fresh, due) => days === null ? "never" : days <= fresh ? "fresh" : days <= due ? "due" : "stale";
const POINTS = { fresh: 100, due: 60, stale: 20, never: 0 };

export async function accuracyOf(env, site, nowMs) { return one(env, site, nowMs); }
async function one(env, site, nowMs) {
  const q = (sql, ...b) => env.DB.prepare(sql).bind(...b).first().catch(() => null);
  const all = (sql, ...b) => env.DB.prepare(sql).bind(...b).all().then(r => r.results || []).catch(() => []);
  const [gu, ge, pl, ex, bu] = await Promise.all([
    q("SELECT updated_at AS at, updated_by AS by FROM gla_units WHERE site = ? AND updated_at IS NOT NULL AND updated_at != '' ORDER BY updated_at DESC LIMIT 1", site),
    q("SELECT COALESCE(NULLIF(date_edited_at, ''), created_at) AS at, by_name AS by FROM gla_events WHERE site = ? ORDER BY COALESCE(NULLIF(date_edited_at, ''), created_at) DESC LIMIT 1", site),
    q("SELECT at, by_name AS by FROM property_log WHERE site = ? ORDER BY at DESC LIMIT 1", site),
    q("SELECT updated_at AS at, updated_by AS by, period FROM exec_reports WHERE site = ? ORDER BY updated_at DESC LIMIT 1", site),
    all("SELECT k, v FROM ops_settings WHERE site = ? AND k LIKE 'budget_upload_%'", site)
  ]);
  const now = new Date(nowMs);
  const year = Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Beirut", year: "numeric" }).format(now));
  const month = Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Beirut", month: "numeric" }).format(now));

  /* GLA — a seeded GLA with no change yet has no date */
  const g = later(gu && gu.at ? gu : null, ge && ge.at ? ge : null);
  const gDays = ageDays(g && g.at, nowMs);
  const gla = { key: "gla", name: "GLA & Occupancy", app: "gla", at: g ? g.at : "", by: g ? g.by || "" : "", state: band(gDays, 30, 60),
    rule: "Update when a unit changes. Fresh for 30 days." };

  const pDays = ageDays(pl && pl.at, nowMs);
  const property = { key: "property", name: "Property Details", app: "property", at: pl ? pl.at : "", by: pl ? pl.by || "" : "", state: band(pDays, 90, 180),
    rule: "Review the values every quarter. Fresh for 90 days." };

  /* Executive report — last month should be saved by now */
  let ym = year * 12 + month - 1 - 1;                  // last month, as a month number
  const want = `${Math.floor(ym / 12)}-${String(ym % 12 + 1).padStart(2, "0")}`;
  let exState = "never", exNote = "";
  if (ex && ex.period) {
    const [py, pm] = ex.period.split("-").map(Number);
    const behind = ym - (py * 12 + pm - 1);
    exState = behind <= 0 ? "fresh" : behind === 1 ? "due" : "stale";
    exNote = `Latest month: ${MN[pm - 1]} ${py}`;
  }
  const execRep = { key: "exec", name: "Executive Report", app: "exec", at: ex ? ex.at : "", by: ex ? ex.by || "" : "", state: exState, note: exNote,
    rule: `Save each month's report. ${MN[Number(want.slice(5)) - 1]} ${want.slice(0, 4)} is expected now.` };

  /* Budget — this year's CAPEX and OPEX sheets */
  let last = null; const kinds = new Set(); let anyYear = false;
  for (const r of bu) {
    const m = /^budget_upload_(capex|opex)_(\d{4})$/.exec(r.k); if (!m) continue;
    let v = {}; try { v = JSON.parse(r.v); } catch {}
    anyYear = true;
    if (Number(m[2]) === year) kinds.add(m[1]);
    if (v.at && (!last || v.at > last.at)) last = { at: v.at, by: v.by || "", kind: m[1].toUpperCase(), year: m[2] };
  }
  const bState = kinds.size === 2 ? "fresh" : kinds.size === 1 ? "due" : anyYear ? "stale" : "never";
  const budget = { key: "budget", name: "Budget CAPEX & OPEX", app: "budget", at: last ? last.at : "", by: last ? last.by : "", state: bState,
    note: last ? `Last upload: ${last.kind} ${last.year}` + (kinds.size === 1 ? ` · ${kinds.has("capex") ? "OPEX" : "CAPEX"} ${year} missing` : "") : "",
    rule: `Upload both ${year} sheets, CAPEX and OPEX.` };

  const items = [gla, property, execRep, budget].map(x => ({ ...x, points: POINTS[x.state] }));
  const score = Math.round(items.reduce((s, x) => s + x.points, 0) / items.length);
  return { site, score, items };
}

/* ctx = { site, sites: {code: name}, now } */
export async function accuracyRoute(env, p, method, b, url, ctx) {
  if (p !== "accuracy") throw Object.assign(new Error("Unknown endpoint"), { status: 404 });
  const nowMs = Date.now();
  const codes = Object.keys(ctx.sites);
  const rows = await Promise.all(codes.map(c => one(env, c, nowMs)));
  return { site: ctx.site, generatedAt: new Date(nowMs).toISOString(), points: POINTS,
    flagships: rows.map(r => ({ ...r, siteName: ctx.sites[r.site] })) };
}
