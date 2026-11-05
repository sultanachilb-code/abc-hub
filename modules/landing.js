/* =====================================================================
   LANDING PAGES BY POSITION (Nov 2026) — docs/FEATURE-landing-pages.md
   • Admin Control → Landing pages: pick a position, drag objects into sections, size them, save.
     One page per position, the same for all flagships (each person sees his own flagship's figures).
   • Positions without a saved page keep what they had (Manager action brief, Advisor / Director / CDSO KPI brief,
     nothing for the operations team). Security Manager and Head of Security start with a ready page.
   • An object shows only if the position can open the tool behind it (Who sees what).
   Stored in meta 'landing:pos' = { KEY: { sections: [{ name, items: [{ w, size, app? }] }], at, by } }
   ===================================================================== */
import { managerBrief, kpiBrief, KPI_ITEMS, MGR_ITEMS, briefConfig } from "./rolebrief.js";
import { patrolDay } from "./patrol.js";

const err = (m, status = 400) => Object.assign(new Error(m), { status });
const one = async q => { try { return await q.first(); } catch { return null; } };

export const LP_POSITIONS = { MM: "Mall Manager", OM: "Operations Manager", SMS: "Senior Mall Supervisor", MS: "Mall Supervisor", MO: "Mall Officer",
  SEC: "Security staff", SECM: "Security Manager", HOS: "Head of Security", ADVISOR: "Property Advisor", DIRECTOR: "Mall Director", CDSO: "CDSO" };
/* a pretend account of each position — used to check what it may open (Admin preview, builder) */
export const LP_USER = { MM: { role: "MANAGER", position: "MM" }, OM: { role: "MANAGER", position: "OM" }, SMS: { role: "SUPERVISOR", position: "SMS" },
  MS: { role: "SUPERVISOR", position: "MS" }, MO: { role: "SUPERVISOR", position: "MO" }, SEC: { role: "SECURITY", position: "" }, SECM: { role: "SECURITY", position: "SM" },
  HOS: { role: "SECURITY", position: "HOS" }, ADVISOR: { role: "ADVISOR" }, DIRECTOR: { role: "DIRECTOR" }, CDSO: { role: "CDSO" } };
export const lpKeyOf = u => !u ? null : u.role === "MANAGER" ? (["OM", "DOM"].includes(u.position) ? "OM" : "MM")
  : u.role === "SUPERVISOR" ? (["SMS", "MS", "MO"].includes(u.position) ? u.position : null)
  : u.role === "SECURITY" ? (u.position === "SM" ? "SECM" : u.position === "HOS" ? "HOS" : "SEC")
  : ["ADVISOR", "DIRECTOR", "CDSO"].includes(u.role) ? u.role : null;
/* the old briefs, used when a position has no saved page */
export const LEGACY = { MM: "manager", OM: "manager", ADVISOR: "advisor", DIRECTOR: "director", CDSO: "cdso" };

/* ---------- the objects ---------- */
const M = (name, icon, group, app, extra = {}) => ({ name, icon, group, app, kind: "tile", ...extra });
export const WIDGETS = {
  incidents: M("Incidents · PIR", "🚨", "Security", "incidents"), patrol: M("Patrol rounds", "🛡", "Security", "patrol"), contractors: M("Contractors today", "👷", "Security", "contractor-access"),
  gate: M("Loading Gate today", "🚚", "Security", "gate"), cleaners: M("Cleaners entered", "🧹", "Security", "cleaner-qr"), latekeys: M("Late keys", "🔑", "Security", "keybox"),
  quickpass: M("Quick passes waiting", "🎫", "Security", "quickpass"), emergency: M("Emergency alerts", "📣", "Security", "emergency"),
  checklists: M("AM / PM checklists", "✅", "Operations", "forms"), handover: M("Shift handover", "🔁", "Operations", "handover"), malfunctions: M("Malfunctions", "🛠", "Operations", "malfunctions"),
  snaglist: M("Snaglist", "📋", "Operations", "snaglist"), restroom: M("Restroom inspection", "🚻", "Operations", "restroom"), cleaning: M("Cleaning", "🧽", "Operations", "cleanctl"),
  marketing: M("Marketing events", "🎉", "Operations", "calendar"),
  feedback: M("Tenant feedback", "💬", "Tenants", "feedback"), contracts: M("Contracts ending", "📄", "Tenants", "contracts"), portal: M("Portal items waiting", "🗂", "Tenants", "portal"),
  fitout: M("Fit-outs", "🏗", "Tenants", "fitout"), gla: M("GLA occupancy", "🏬", "Tenants", "gla"),
  footfall: M("Footfall · this month", "👣", "Reports", "footfall"),
  kpi: { name: "KPI table · flagships", icon: "📊", group: "Reports", kind: "kpi", app: "", size: 4 },
  worst: { name: "Weakest this period", icon: "⬇", group: "Reports", kind: "worst", app: "", size: 2 },
  todo: { name: "Your follow-ups", icon: "🚩", group: "Reports", kind: "todo", app: "", size: 2 },
  shortcut: { name: "Shortcut to a tool", icon: "⭐", group: "Other", kind: "shortcut", app: "", many: true }
};
const mgrKeys = () => Object.keys(MGR_ITEMS);   // computed by the Manager brief (read lazily: rolebrief.js and this file import each other)
const S = (name, ...items) => ({ name, items: items.map(w => typeof w === "string" ? { w } : w) });
/* ready pages: Security Manager and Head of Security use them until Admin saves their own; the others are suggestions in the builder */
export const STARTERS = {
  SECM: { sections: [S("Today", "incidents", "patrol", "contractors", "gate", "cleaners", "latekeys", "quickpass", "emergency"), S("Follow-ups", { w: "todo", size: 2 })] },
  HOS: { sections: [S("All flagships", { w: "kpi", size: 4 }), S("Today", "incidents", "patrol", "gate", "emergency", "latekeys", "cleaners"), S("Follow-ups", { w: "todo", size: 2 })] },
  MM: { sections: [S("Today", "incidents", "checklists", "handover", "malfunctions", "snaglist", "restroom", "feedback", "marketing", "cleaning", "contractors", "contracts", "portal"), S("Follow-ups", { w: "todo", size: 2 })] },
  ADVISOR: { sections: [S("KPIs", { w: "kpi", size: 4 }), S("Portfolio", "gla", "footfall", "contracts", "fitout")] },
  SMS: { sections: [S("Today", "checklists", "handover", "malfunctions", "restroom", "patrol", "contractors")] }
};
STARTERS.OM = STARTERS.MM; STARTERS.DIRECTOR = STARTERS.ADVISOR; STARTERS.CDSO = STARTERS.ADVISOR; STARTERS.MS = STARTERS.SMS; STARTERS.MO = STARTERS.SMS; STARTERS.SEC = { sections: [S("Today", "patrol", "contractors", "gate", "cleaners", "latekeys", "emergency")] };
const BUILT_IN = ["SECM", "HOS"];   // live before anything is saved

/* ---------- storage ---------- */
let CACHE = null, CACHE_AT = 0;
export async function lpAll(env) {
  if (CACHE && Date.now() - CACHE_AT < 60000) return CACHE;
  let v = {}; try { v = JSON.parse(((await one(env.DB.prepare("SELECT v FROM meta WHERE k = 'landing:pos'"))) || {}).v || "{}"); } catch {}
  /* Nov 2026: Brief settings moved into Landing pages — once, the old briefs become saved pages, exactly as they were */
  const claim = await env.DB.prepare("INSERT OR IGNORE INTO meta (k, v) VALUES ('landing:migrated', ?)").bind(new Date().toISOString()).run().catch(() => null);
  if (claim && claim.meta && claim.meta.changes === 1) {
    const c = await briefConfig(env).catch(() => null);
    if (c) {
      const at = new Date().toISOString(), by = "Brief settings (moved)";
      const mgr = { sections: [S("Today", ...Object.keys(MGR_ITEMS).filter(k => c.manager[k])), S("Follow-ups", { w: "todo", size: 2 })], at, by };
      for (const k of ["MM", "OM"]) if (!v[k]) v[k] = mgr;
      for (const [k, a] of [["ADVISOR", "advisor"], ["DIRECTOR", "director"], ["CDSO", "cdso"]]) if (!v[k])
        v[k] = { sections: [S("Operations KPIs", { w: "kpi", size: 4, opts: { rows: Object.keys(KPI_ITEMS).filter(x => c[a][x]), period: "month" } }), S("Weakest this period", { w: "worst", size: 2 })], at, by };
      await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('landing:pos', ?)").bind(JSON.stringify(v)).run().catch(() => {});
    }
  }
  CACHE = v; CACHE_AT = Date.now(); return v;
}
export async function layoutFor(env, key) {
  if (!key) return null;
  const all = await lpAll(env);
  return all[key] || (BUILT_IN.includes(key) ? STARTERS[key] : null);
}
export const hasLanding = async (env, u) => !!(await layoutFor(env, lpKeyOf(u)));
function clean(layout, apps) {
  const secs = (Array.isArray(layout && layout.sections) ? layout.sections : []).slice(0, 12).map(s => ({
    name: String(s.name || "").replace(/\s+/g, " ").trim().slice(0, 40) || "Section",
    items: (Array.isArray(s.items) ? s.items : []).slice(0, 24).filter(i => WIDGETS[i.w] && (i.w !== "shortcut" || /^[a-z0-9-]{2,40}$/.test(String(i.app || ""))))
      .map(i => ({ w: i.w, size: [1, 2, 4].includes(Number(i.size)) ? Number(i.size) : (WIDGETS[i.w].size || 1), ...(i.w === "shortcut" ? { app: i.app } : {}),
        ...(i.w === "kpi" && i.opts ? { opts: { rows: (Array.isArray(i.opts.rows) ? i.opts.rows : Object.keys(KPI_ITEMS)).filter(k => KPI_ITEMS[k]), period: ["today", "7d", "month"].includes(i.opts.period) ? i.opts.period : "month" } } : {}) }))
  }));
  const seen = new Set();
  for (const s of secs) s.items = s.items.filter(i => i.w === "shortcut" || (seen.has(i.w) ? false : (seen.add(i.w), true)));
  return { sections: secs };
}
/* ---------- Home layout by position (Nov 2026): order of the home sections, each ON / OFF, and the Day to Day timeline lanes ---------- */
export const HOME_SECTIONS = { brief: "Morning brief", moment: "Message of the moment", d2d: "Day to Day timeline", fu: "Action needed · follow-ups", tools: "All tools" };
export const HOME_LANES = { shift: "Team on shift", deadlines: "Checklist & handover deadlines", handover: "Handover pins", restroom: "Restroom windows", patrol: "Security patrol rounds",
  malfunctions: "Malfunctions", quickpass: "Quick passes", contractors: "Contractors attended", gate: "Refused at the gate", closing: "Tenant closing",
  events: "Meetings & events", off: "Off / leave line", tiles: "Tool tiles under the timeline" };
export const HOME_KEYS = { ADMIN: "Administrator", ...LP_POSITIONS };
export const homeKeyOf = u => !u ? null : u.role === "ADMIN" ? "ADMIN" : lpKeyOf(u);
let HCACHE = null, HCACHE_AT = 0;
export async function homeAll(env) {
  if (HCACHE && Date.now() - HCACHE_AT < 60000) return HCACHE;
  let v = {}; try { v = JSON.parse(((await one(env.DB.prepare("SELECT v FROM meta WHERE k = 'home:pos'"))) || {}).v || "{}"); } catch {}
  HCACHE = v; HCACHE_AT = Date.now(); return v;
}
export const homeFor = async (env, u) => { const k = homeKeyOf(u); return k ? ((await homeAll(env))[k] || null) : null; };
function cleanHome(h) {
  const ids = Object.keys(HOME_SECTIONS), order = [...new Set((Array.isArray(h && h.order) ? h.order : []).filter(x => ids.includes(x)))];
  ids.forEach(x => { if (!order.includes(x)) order.push(x); });
  const off = [...new Set((Array.isArray(h && h.off) ? h.off : []).filter(x => ids.includes(x)))];
  const lanesOff = [...new Set((Array.isArray(h && h.lanesOff) ? h.lanesOff : []).filter(x => HOME_LANES[x]))];
  return { order, off, lanesOff };
}
export async function homeAdmin(env, method, b, me) {
  if (method === "POST") {
    const key = String(b.key || "").toUpperCase(); if (!HOME_KEYS[key]) throw err("Choose a position");
    const raw = await one(env.DB.prepare("SELECT v FROM meta WHERE k = 'home:pos'"));
    let all = {}; try { all = JSON.parse((raw && raw.v) || "{}"); } catch {}
    if (b.home === null) delete all[key];
    else all[key] = { ...cleanHome(b.home), at: new Date().toISOString(), by: me.full_name || me.email };
    await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('home:pos', ?)").bind(JSON.stringify(all)).run();
    HCACHE = null;
    return { saved: true, homes: all };
  }
  return { positions: HOME_KEYS, sections: HOME_SECTIONS, lanes: HOME_LANES, homes: await homeAll(env) };
}

/* Admin Control → Landing pages */
export async function lpAdmin(env, method, b, me, d) {
  if (method === "POST") {
    const key = String(b.key || "").toUpperCase(); if (!LP_POSITIONS[key]) throw err("Choose a position");
    const raw = await one(env.DB.prepare("SELECT v FROM meta WHERE k = 'landing:pos'"));
    let all = {}; try { all = JSON.parse((raw && raw.v) || "{}"); } catch {}
    if (b.layout === null) delete all[key];
    else all[key] = { ...clean(b.layout, d.appIds), at: new Date().toISOString(), by: me.full_name || me.email };
    await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('landing:pos', ?)").bind(JSON.stringify(all)).run();
    CACHE = null;
    return { saved: true, layouts: all };
  }
  const allows = Object.fromEntries(Object.keys(LP_POSITIONS).map(k => [k, Object.fromEntries(Object.entries(WIDGETS).map(([w, x]) => [w, !x.app || d.allows(LP_USER[k], x.app)]))]));
  return { positions: LP_POSITIONS, widgets: WIDGETS, layouts: await lpAll(env), starters: STARTERS, builtIn: BUILT_IN, legacy: LEGACY, allows, kpiItems: KPI_ITEMS };
}

/* ---------- the figures ---------- */
const hmNow = () => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Beirut", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date()).replace(/^24/, "00");
const mins = t => { const [h, m] = String(t || "0:0").split(":").map(Number); return h * 60 + (m || 0); };
async function extraTile(env, w, site, day, d, todo) {
  const n = async (sql, ...a) => Number(((await one(env.DB.prepare(sql).bind(...a))) || {}).n || 0);
  const now = new Date().toISOString();
  switch (w) {
    case "patrol": {
      const P = await patrolDay(env, site, day).catch(() => null);
      if (!P || !P.points.length) return { value: "—", tone: "", note: "No checkpoints set" };
      const t = mins(hmNow()), started = P.rounds.filter(r => mins(r.from) <= t), ended = started.filter(r => mins(r.to) < t);
      const done = started.reduce((a, r) => a + r.done, 0), total = started.reduce((a, r) => a + r.total, 0), missed = ended.filter(r => r.done < r.total);
      const issues = P.rounds.reduce((a, r) => a + r.issues, 0);
      if (missed.length) todo.push({ tone: "a", app: "patrol", text: `${missed.length} patrol round${missed.length === 1 ? "" : "s"} not complete`, sub: missed.map(r => `${r.name}: ${r.done} / ${r.total}`).join(" · ") });
      return { value: total ? `${done} / ${total}` : "—", tone: missed.length ? "r" : total && done < total ? "a" : total ? "g" : "", note: !started.length ? `first round ${P.rounds[0] ? P.rounds[0].from : ""}` : `${started.length} round${started.length === 1 ? "" : "s"} started${issues ? ` · ${issues} issue${issues === 1 ? "" : "s"}` : ""}` };
    }
    case "gate": {
      const r = await one(env.DB.prepare("SELECT SUM(CASE WHEN decision = 'in' THEN 1 ELSE 0 END) AS i, SUM(CASE WHEN decision = 'out' THEN 1 ELSE 0 END) AS o FROM gate_scans WHERE site = ? AND day = ?").bind(site, day));
      const i = Number((r || {}).i || 0), o = Number((r || {}).o || 0);
      return { value: `${i} in`, tone: o ? "a" : "g", note: o ? `${o} rejected` : "none rejected" };
    }
    case "cleaners": {
      const c = d.cleanersCount ? await d.cleanersCount(env, site, day).catch(() => null) : null;
      return { value: c ? String(c.count) : "—", tone: "g", note: c ? "entered the mall today" : "not available" };
    }
    case "latekeys": {
      const late = await n("SELECT COUNT(*) AS n FROM kb_moves WHERE site = ? AND back_at = '' AND due_at < ?", site, now).catch(() => 0);
      const out = await n("SELECT COUNT(*) AS n FROM kb_moves WHERE site = ? AND back_at = ''", site).catch(() => 0);
      if (late) todo.push({ tone: "r", app: "keybox", text: `${late} key${late === 1 ? "" : "s"} not returned on time`, sub: "Key Box" });
      return { value: String(late), tone: late ? "r" : "g", note: `${out} key${out === 1 ? "" : "s"} out` };
    }
    case "quickpass": {
      const q = await n("SELECT COUNT(*) AS n FROM quick_passes WHERE site = ? AND status = 'requested' AND req_at >= ?", site, new Date(Date.now() - 864e5).toISOString()).catch(() => 0);
      if (q) todo.push({ tone: "a", app: "quickpass", text: `${q} quick pass${q === 1 ? "" : "es"} to approve`, sub: "Quick Access Pass" });
      return { value: String(q), tone: q ? "a" : "g", note: "waiting for approval" };
    }
    case "emergency": {
      const act = await n("SELECT COUNT(*) AS n FROM emergencies WHERE site = ? AND status = 'active'", site).catch(() => 0);
      const wk = await n("SELECT COUNT(*) AS n FROM emergencies WHERE site = ? AND created_at >= ?", site, new Date(Date.now() - 7 * 864e5).toISOString()).catch(() => 0);
      if (act) todo.push({ tone: "r", app: "emergency", text: `${act} emergency alert${act === 1 ? "" : "s"} still active`, sub: "Emergency Alert" });
      return { value: act ? `${act} active` : String(wk), tone: act ? "r" : "g", note: act ? "not closed yet" : "last 7 days" };
    }
    case "fitout": {
      const f = await n("SELECT COUNT(*) AS n FROM gla_units WHERE site = ? AND active = 1 AND status = 'Fit-out'", site).catch(() => 0);
      const r = await n("SELECT COUNT(*) AS n FROM gla_units WHERE site = ? AND active = 1 AND status = 'Reserved'", site).catch(() => 0);
      return { value: String(f), tone: "", note: r ? `${r} reserved` : "units in fit-out" };
    }
    case "gla": {
      const r = await one(env.DB.prepare("SELECT SUM(area) AS t, SUM(CASE WHEN status = 'Vacant' THEN area ELSE 0 END) AS v FROM gla_units WHERE site = ? AND active = 1 AND section = 'Leasing'").bind(site));
      const t = Number((r || {}).t || 0), v = Number((r || {}).v || 0), p = t ? Math.round((1 - v / t) * 1000) / 10 : null;
      return { value: p == null ? "—" : `${p}%`, tone: p == null ? "" : p >= 90 ? "g" : p >= 75 ? "a" : "r", note: t ? `${Math.round(v).toLocaleString("en-US")} sqm vacant` : "no GLA" };
    }
    case "footfall": {
      const m = day.slice(0, 7);
      const r = await one(env.DB.prepare("SELECT SUM(entries) AS e, COUNT(*) AS n, MIN(day) AS f, MAX(day) AS t FROM ff_days WHERE site = ? AND day LIKE ?").bind(site, m + "%"));
      const e = Number((r || {}).e || 0);
      return { value: e ? e.toLocaleString("en-US") : "—", tone: "", note: e ? `${Number(r.f.slice(8))} – ${Number(r.t.slice(8))} ${new Date(day + "T12:00:00Z").toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" })} · ${r.n} days` : "no figures this month" };
    }
  }
  return null;
}

/* the landing page of one person (or Admin's preview of a position) */
export async function landingData(env, layout, { key, site, sites, period, d, allows }) {   // period: chosen on the page (empty = the KPI table's own default)
  const items = layout.sections.flatMap(s => s.items).filter(i => !WIDGETS[i.w].app || allows(WIDGETS[i.w].app) || i.w === "shortcut");
  const want = new Set(items.map(i => i.w));
  const todo = [], tiles = {};
  const MGR_KEYS = mgrKeys(), mk = MGR_KEYS.filter(k => want.has(k));
  if (mk.length || want.has("todo")) {
    const cfg = Object.fromEntries(MGR_KEYS.map(k => [k, mk.includes(k) || want.has("todo")]));
    const B = await managerBrief(env, site, d, cfg).catch(e => { console.error("landing mgr", e && e.message); return { tiles: [], todo: [] }; });
    for (const t of B.tiles) tiles[t.key] = t;
    if (want.has("todo")) todo.push(...B.todo.filter(x => !x.app || allows(x.app)));
  }
  for (const w of want) if (!tiles[w] && WIDGETS[w].kind === "tile") {
    const t = await extraTile(env, w, site, d.today(), d, want.has("todo") ? todo : []).catch(e => { console.error("landing", w, e && e.message); return null; });
    if (t) tiles[w] = { key: w, app: WIDGETS[w].app, title: WIDGETS[w].name.replace(/ · this month$/, ""), ...t };
  }
  let kpi = null;
  const ko = (items.find(i => i.w === "kpi") || {}).opts || {};
  const per = period || ko.period || "month", rowsOn = Array.isArray(ko.rows) && ko.rows.length ? ko.rows : Object.keys(KPI_ITEMS);
  if ((want.has("kpi") || want.has("worst")) && sites.length) kpi = await kpiBrief(env, sites, per, d, Object.fromEntries(Object.keys(KPI_ITEMS).map(k => [k, rowsOn.includes(k)]))).catch(e => { console.error("landing kpi", e && e.message); return null; });
  period = per;
  const rank = { r: 0, a: 1, g: 2, "": 3 };
  todo.sort((a, b) => rank[a.tone] - rank[b.tone]);
  const sections = layout.sections.map(s => ({ name: s.name, items: s.items.filter(i => items.includes(i)).map(i => ({ ...i, ...(tiles[i.w] || {}), kind: WIDGETS[i.w].kind, icon: WIDGETS[i.w].icon, name: WIDGETS[i.w].name })) })).filter(s => s.items.length);
  return { kind: "landing", key, position: LP_POSITIONS[key], site, siteName: d.siteName(site), sections, todo: todo.slice(0, 8), kpi, period,
    need: Object.values(tiles).filter(t => t.tone === "r" && items.some(i => i.w === t.key)).length };
}
