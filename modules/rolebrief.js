/* =====================================================================
   BRIEF BY ROLE (Oct 2026) — docs/FEATURE-brief-by-role.md
   • Operations team (Mall Officer, Mall Supervisor, Senior Mall Supervisor, Warehouse, Security): no brief.
   • Managers (Mall Manager / Senior Mall Manager, Operations Manager / Deputy): ACTION brief for their flagship, today —
     tiles (red / amber / green) + "Your follow-ups".
   • Advisor: KPI brief across all flagships · Mall Director: Verdun Mall and Achrafieh Mall only ·
     CDSO: the department stores only (Achrafieh DS, Verdun DS, Dbayeh DS). Month to date by default; Today / 7 days / Month. Green ≥ 90 %, amber 75–89 %, red < 75 %.
   • Admin: "Preview as…" any of them, and "Brief settings": which items each audience sees (meta 'brief:cfg').
   Route: GET /api/brief/role?as=&site=&period=today|7d|month · POST /api/brief/settings (admin)
   ===================================================================== */
import { DEADLINES } from "./today.js";
const err = (m, status = 400) => Object.assign(new Error(m), { status });
const rows = async q => { try { return (await q.all()).results || []; } catch (e) { console.error("rolebrief", e && e.message); return []; } };
const one = async q => { try { return await q.first(); } catch { return null; } };
const clip = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
const dayAdd = (day, n) => new Date(Date.parse(day + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const hmB = iso => { try { return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Beirut", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso)).replace(/^24/, "00"); } catch { return ""; } };
const dayB = iso => { try { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Beirut", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso)); } catch { return ""; } };
const nowHM = () => hmB(new Date().toISOString());
const pct = (a, b) => b ? Math.round(a / b * 100) : null;
export const DS_SITES = ["ACS", "VRS", "DBS"];   // department stores — what the CDSO sees
export const MALL_SITES = ["VRM", "ACM"];        // the malls — what the Mall Director sees
/* the brief follows the position structure: Advisor all flagships · Mall Director the malls · CDSO the department stores */
const POS_SITES = { director: MALL_SITES, cdso: DS_SITES };
const INC = { VRM: "Verdun Mall", ACM: "Achrafieh Mall", DBS: "Dbayeh Mall", VRS: "Verdun DS", ACS: "Achrafieh DS" };
const RR = { VRM: "verdun_mall", ACM: "achrafieh_mall", DBS: "dbayeh", VRS: "verdun_ds", ACS: "achrafieh_ds" };

/* ---------- what each audience sees (Admin can change it) ---------- */
export const MGR_ITEMS = { incidents: "Incidents · PIR", checklists: "AM / PM checklists", handover: "Shift handover", malfunctions: "Malfunctions", snaglist: "Snaglist",
  restroom: "Restroom inspection", feedback: "Tenant feedback", marketing: "Marketing events", cleaning: "Cleaning", contractors: "Contractors", contracts: "Contracts ending", portal: "Portal items waiting" };
export const KPI_ITEMS = { restroom: "Restroom inspection compliance", pir: "Incident PIR on time", amcheck: "AM checklist on time", pmcheck: "PM checklist on time",
  handover: "Handover on time", cleaning: "Cleaning compliance", mf48: "Malfunctions fixed within 48 h", snags: "Snags solved", gla: "GLA occupancy (by area)",
  contractors: "Contractor entries", contracts: "Contracts ending (next 60 days)", vrres: "Portal violations resolved (older than 7 days)", mk7: "Marketing requests answered (older than 7 days)" };
export const AUDIENCES = { manager: "Mall / Operations Manager", advisor: "Property Advisor", director: "Mall Director", cdso: "CDSO" };
const allOn = o => Object.fromEntries(Object.keys(o).map(k => [k, true]));
export async function briefConfig(env) {
  let c = {}; try { c = JSON.parse(((await one(env.DB.prepare("SELECT v FROM meta WHERE k = 'brief:cfg'"))) || {}).v || "{}"); } catch {}
  const out = {};
  for (const a of Object.keys(AUDIENCES)) { const base = allOn(a === "manager" ? MGR_ITEMS : KPI_ITEMS); out[a] = { ...base, ...(c[a] || {}) }; }
  return out;
}
const audienceOf = me => me.role === "MANAGER" ? "manager" : me.role === "ADVISOR" ? "advisor" : me.role === "DIRECTOR" ? "director" : me.role === "CDSO" ? "cdso" : me.role === "ADMIN" ? "admin" : "none";

/* ================= MANAGER: action brief for one flagship, today ================= */
async function managerBrief(env, site, d, cfg) {
  const day = d.today(), now = nowHM(), tiles = [], todo = [];
  const T = (key, t) => { if (cfg[key]) tiles.push({ key, app: t.app || key, ...t }); };
  const since30 = new Date(Date.now() - 30 * 864e5).toISOString();
  /* incidents */
  if (cfg.incidents && env.INC_DB && INC[site]) {
    const f = INC[site];
    const [open, pir] = await Promise.all([
      rows(env.INC_DB.prepare("SELECT ref, type, severity FROM incidents WHERE flagship = ? AND status NOT IN ('Closed','Resolved') ORDER BY incident_date DESC LIMIT 20").bind(f)),
      rows(env.INC_DB.prepare("SELECT ref, pir_due_at FROM incidents WHERE flagship = ? AND pir_due_at IS NOT NULL AND pir_due_at <> '' AND (pir_submitted_at IS NULL OR pir_submitted_at = '') AND pir_due_at < ? ORDER BY pir_due_at").bind(f, new Date().toISOString()))]);
    const today = await one(env.INC_DB.prepare("SELECT COUNT(*) AS n FROM incidents WHERE flagship = ? AND incident_date = ?").bind(f, day));
    T("incidents", { app: "incidents", title: "Incidents", value: `${open.length} open`, tone: pir.length ? "r" : open.length ? "a" : "g",
      note: [today && today.n ? `${today.n} today` : "", pir.length ? `${pir.length} PIR overdue (${pir.slice(0, 2).map(x => x.ref).join(", ")})` : ""].filter(Boolean).join(" · ") || "Nothing open" });
    for (const p of pir.slice(0, 3)) todo.push({ tone: "r", app: "incidents", text: `Post-incident report ${p.ref} is overdue`, sub: `was due ${dayB(p.pir_due_at)} ${hmB(p.pir_due_at)}` });
  }
  /* AM / PM checklists */
  if (cfg.checklists) {
    const runs = await rows(env.DB.prepare("SELECT form, status, submitted_at FROM form_runs WHERE site = ? AND day = ? AND form IN ('am','pm')").bind(site, day));
    const st = (form, due) => { const r = runs.find(x => x.form === form && x.status === "submitted" && x.submitted_at);
      if (r) { const at = hmB(r.submitted_at); return { done: true, late: at > due, text: `${form.toUpperCase()} ${at}${at > due ? " (late)" : ""}` }; }
      return { done: false, over: now > due, text: `${form.toUpperCase()} ${now > due ? "overdue" : "due " + due}` }; };
    const a = st("am", DEADLINES.amCheck), p = st("pm", DEADLINES.pmCheck);
    T("checklists", { app: "forms", title: "AM / PM checklists", value: a.over || p.over ? "Overdue" : a.late || p.late ? "Late" : a.done && p.done ? "Done" : "On track",
      tone: a.over || p.over ? "r" : a.late || p.late ? "a" : "g", note: `${a.text} · ${p.text}` });
    if (a.over) todo.push({ tone: "r", app: "forms", text: "AM checklist not submitted", sub: `due ${DEADLINES.amCheck}` });
    if (p.over) todo.push({ tone: "r", app: "forms", text: "PM checklist not submitted", sub: `due ${DEADLINES.pmCheck}` });
  }
  /* shift handover */
  if (cfg.handover) {
    const h = await one(env.DB.prepare("SELECT handoffs FROM handovers WHERE site = ? AND day = ? ORDER BY id DESC LIMIT 1").bind(site, day));
    let L = []; try { L = JSON.parse((h && h.handoffs) || "[]"); } catch {}
    const ts = L.map(x => hmB(x.at)), am = ts.find(t => t >= "11:00" && t < "18:00"), pm = ts.find(t => t >= "18:00");
    const amOver = !am && now > DEADLINES.amHandover, pmOver = !pm && now > DEADLINES.pmHandover;
    T("handover", { title: "Shift handover", value: amOver || pmOver ? "Overdue" : am && pm ? "Done" : am ? "AM done" : "Pending", tone: amOver || pmOver ? "r" : (am && am > DEADLINES.amHandover) ? "a" : "g",
      note: `AM ${am || (amOver ? "not done" : "by " + DEADLINES.amHandover)} · PM ${pm || "by " + DEADLINES.pmHandover}` });
    if (amOver) todo.push({ tone: "a", app: "handover", text: "AM handover not done yet", sub: `due ${DEADLINES.amHandover}` });
  }
  /* malfunctions */
  if (cfg.malfunctions) {
    const [open, rep] = await Promise.all([
      rows(env.DB.prepare("SELECT asset, category, location, priority, found_at FROM mf_records WHERE site = ? AND deleted = 0 AND status NOT IN ('Fixed','Closed') ORDER BY found_at").bind(site)),
      rows(env.DB.prepare("SELECT COALESCE(NULLIF(asset,''), category) AS a, location, COUNT(*) AS n FROM mf_records WHERE site = ? AND deleted = 0 AND found_at >= ? GROUP BY a, location HAVING n >= 3 ORDER BY n DESC LIMIT 3").bind(site, since30))]);
    const high = open.filter(r => /high|urgent|critical/i.test(r.priority || ""));
    T("malfunctions", { title: "Malfunctions", value: `${open.length} open`, tone: high.length ? "r" : open.length ? "a" : "g",
      note: [high.length ? `${high.length} high priority` : "", rep.length ? `${rep[0].a} ×${rep[0].n} this month` : ""].filter(Boolean).join(" · ") || "All fixed" });
    for (const r of rep.slice(0, 2)) todo.push({ tone: "r", app: "malfunctions", text: `${r.a}${r.location ? " at " + r.location : ""} broke ${r.n} times in 30 days`, sub: "consider escalating to the provider" });
    for (const r of high.slice(0, 2)) todo.push({ tone: "a", app: "malfunctions", text: `High priority: ${r.asset || r.category}${r.location ? " · " + r.location : ""}`, sub: `open since ${dayB(r.found_at)}` });
  }
  /* snaglist — the figures the Snaglist system sends to the hub */
  if (cfg.snaglist && d.system) {
    const S = await d.system("snaglist", site).catch(() => null);
    if (S && S.ok && S.brief && S.brief.length) {
      const bad = S.brief.find(x => x.tone === "alert") || S.brief.find(x => x.tone === "warn") || S.brief[0];
      T("snaglist", { title: "Snaglist", value: `${bad.value}`, tone: S.brief.some(x => x.tone === "alert" && Number(x.value)) ? "r" : S.brief.some(x => x.tone === "warn" && Number(x.value)) ? "a" : "g", note: S.brief.slice(0, 3).map(x => `${x.value} ${x.label}`).join(" · ") });
    } else T("snaglist", { title: "Snaglist", value: "—", tone: "", note: "Figures unavailable right now" });
  }
  /* restroom inspection today */
  if (cfg.restroom && env.RR_DB && RR[site]) {
    const r = await rrDay(env, site, day);
    T("restroom", { title: "Restroom inspection", value: r.pct == null ? "—" : `${r.pct}%`, tone: tone(r.pct), note: r.expected ? `${r.done} / ${r.expected} rounds so far${r.issues ? " · " + r.issues + " with issues" : ""}` : "No rounds due yet" });
  }
  /* tenant feedback */
  if (cfg.feedback) {
    const [td, rep] = await Promise.all([
      one(env.DB.prepare("SELECT COUNT(*) AS n FROM tenant_feedback WHERE site = ? AND day = ?").bind(site, day)),
      rows(env.DB.prepare("SELECT tenant, COUNT(*) AS n FROM tenant_feedback WHERE site = ? AND day >= ? GROUP BY tenant HAVING n >= 2 ORDER BY n DESC LIMIT 3").bind(site, dayAdd(day, -6)))]);
    T("feedback", { title: "Tenant feedback", value: `${(td && td.n) || 0} today`, tone: rep.length ? "a" : "g", note: rep.length ? rep.map(r => `${r.tenant} ×${r.n} this week`).join(" · ") : "No repeated tenant this week" });
    for (const r of rep.slice(0, 2)) todo.push({ tone: "a", app: "feedback", text: `${r.tenant} — ${r.n} feedback / violations this week`, sub: "warning letter?" });
  }
  /* marketing events */
  if (cfg.marketing) {
    const ev = await rows(env.DB.prepare(`SELECT title, start_day, time_from, time_to, location FROM cal_items WHERE site = ? AND deleted = 0 AND kind = 'marketing' AND start_day <= ? AND (CASE WHEN end_day = '' THEN start_day ELSE end_day END) >= ? ORDER BY start_day, time_from LIMIT 5`).bind(site, dayAdd(day, 1), day));
    const tdy = ev.filter(e => e.start_day <= day);
    T("marketing", { app: "calendar", title: "Marketing events", value: `${tdy.length} today`, tone: "g", note: ev.length ? ev.slice(0, 2).map(e => `${clip(e.title, 30)}${e.time_from ? " " + e.time_from : ""}${e.start_day > day ? " (tomorrow)" : ""}`).join(" · ") : "Nothing today or tomorrow" });
  }
  /* cleaning (Cleaning Control) */
  if (cfg.cleaning && d.ccDay) {
    const c = await d.ccDay(site, day).catch(() => null);
    if (c && c.summary && c.summary.total) T("cleaning", { app: "cleanctl", title: "Cleaning", value: c.summary.compliance == null ? "—" : `${c.summary.compliance}%`, tone: tone(c.summary.compliance), note: `${c.summary.done} / ${c.summary.dueSoFar} due so far${c.summary.late ? " · " + c.summary.late + " late" : ""}` });
  }
  /* contractors today */
  if (cfg.contractors && d.dayList) {
    const L = await d.dayList(site, day).catch(() => []);
    const att = L.filter(v => v.inAt || v.in_at).length;
    T("contractors", { app: "contractor-access", title: "Contractors", value: `${L.length} booked`, tone: "g", note: `${att} arrived${L.length - att ? " · " + (L.length - att) + " not yet" : ""}` });
  }
  /* contracts ending */
  if (cfg.contracts) {
    const ce = await rows(env.DB.prepare("SELECT tenant, COALESCE(NULLIF(departure_day,''), end_day) AS d FROM contracts_ending WHERE site = ? AND active = 1 AND COALESCE(NULLIF(departure_day,''), end_day) BETWEEN ? AND ? ORDER BY d").bind(site, day, dayAdd(day, 60)));
    const soon = ce.filter(c => c.d <= dayAdd(day, 7));
    T("contracts", { title: "Contracts ending", value: `${ce.length}`, tone: soon.length ? "a" : "g", note: ce.length ? `next 60 days · first: ${clip(ce[0].tenant, 24)} ${ce[0].d}` : "None in the next 60 days" });
    for (const c of soon.slice(0, 2)) todo.push({ tone: "a", app: "contracts", text: `${c.tenant} — contract ends ${c.d}`, sub: "handover of the unit, CRM handheld, deposits" });
  }
  /* ABC Connect portal: items waiting on tenants + marketing requests to review (Portal Dashboard) */
  if (cfg.portal) {
    const P = await rows(env.DB.prepare("SELECT kind, status, created_day FROM portal_items WHERE site = ? AND active = 1 AND kind IN ('bp','vr','nr','mk')").bind(site));
    const wait = P.filter(x => x.kind !== "mk" && /^sent to tenant/i.test(x.status)), d30 = dayAdd(day, -30), old = wait.filter(x => x.created_day && x.created_day < d30);
    const mk = P.filter(x => x.kind === "mk" && /^(submitted|created)/i.test(x.status)), mkOld = mk.filter(x => x.created_day && x.created_day < dayAdd(day, -7));
    if (P.length) {
      T("portal", { app: "portal", title: "Portal items waiting", value: `${wait.length}`, tone: old.length >= 10 ? "r" : old.length || mkOld.length ? "a" : "g",
        note: [`${old.length} over 30 days`, mk.length ? `${mk.length} marketing to review` : ""].filter(Boolean).join(" · ") });
      if (old.length) todo.push({ tone: old.length >= 10 ? "r" : "a", app: "portal", text: `${old.length} portal item${old.length === 1 ? "" : "s"} waiting on tenants over 30 days`, sub: "breaches, violations and ABC requests — Portal Dashboard" });
      if (mkOld.length) todo.push({ tone: "a", app: "portal", text: `${mkOld.length} marketing request${mkOld.length === 1 ? "" : "s"} in review over 7 days`, sub: "Portal Dashboard → Marketing" });
    }
  }
  const rank = { r: 0, a: 1, g: 2, "": 3 };
  todo.sort((a, b) => rank[a.tone] - rank[b.tone]);
  return { kind: "manager", site, siteName: d.siteName(site), tiles, todo: todo.slice(0, 6), need: tiles.filter(t => t.tone === "r").length };
}
const tone = p => p == null ? "" : p >= 90 ? "g" : p >= 75 ? "a" : "r";

/* restroom rounds of one day (operations inspections): done vs expected (rooms × windows already finished) */
const RR_W = [["W1", "11:00"], ["W2", "13:30"], ["W3", "15:30"], ["W4", "17:30"], ["W5", "19:30"], ["W6", "21:30"]];
async function rrRooms(env, f) { const r = await one(env.RR_DB.prepare("SELECT COUNT(DISTINCT room_id) AS n FROM inspection_logs WHERE flagship = ? AND log_date >= ?").bind(f, dayAdd(new Date().toISOString().slice(0, 10), -30))); return (r && r.n) || 0; }
async function rrDay(env, site, day) {
  const f = RR[site], rooms = await rrRooms(env, f), today = new Date().toISOString().slice(0, 10), now = nowHM();
  const ended = day < dayB(new Date().toISOString()) ? RR_W.length : RR_W.filter(([, end]) => end <= now).length;
  const r = await one(env.RR_DB.prepare("SELECT COUNT(DISTINCT room_id || '|' || window_id) AS n, SUM(has_issues) AS bad FROM inspection_logs WHERE flagship = ? AND log_date = ?").bind(f, day));
  const done = (r && r.n) || 0, expected = rooms * ended;
  return { done: Math.min(done, expected || done), expected, pct: expected ? Math.min(100, pct(done, expected)) : null, issues: (r && r.bad) || 0, today };
}

/* ================= KPI brief: several flagships, a period ================= */
function rangeOf(period, day) {
  if (period === "today") return { from: day, to: day, label: "Today" };
  if (period === "7d") return { from: dayAdd(day, -6), to: day, label: "Last 7 days" };
  return { from: day.slice(0, 8) + "01", to: day, label: "Month to date" };
}
function prevRange(r) { const n = Math.round((Date.parse(r.to) - Date.parse(r.from)) / 864e5) + 1; return { from: dayAdd(r.from, -n), to: dayAdd(r.from, -1) }; }
const daysIn = (from, to) => { const o = []; for (let x = from; x <= to; x = dayAdd(x, 1)) o.push(x); return o; };

async function checklistOnTime(env, site, from, to, form, due, today) {
  const runs = await rows(env.DB.prepare("SELECT day, submitted_at FROM form_runs WHERE site = ? AND form = ? AND status = 'submitted' AND day BETWEEN ? AND ?").bind(site, form, from, to));
  if (!runs.length) return null;   // this flagship does not use the hub checklists in this period
  const days = daysIn(from, to).filter(x => x < today || nowHM() > due);   // today counts only once the deadline has passed
  if (!days.length) return null;
  const by = new Map(runs.map(r => [r.day, hmB(r.submitted_at)]));
  return pct(days.filter(x => by.has(x) && by.get(x) <= due).length, days.length);
}
async function handoverOnTime(env, site, from, to, today) {
  const hs = await rows(env.DB.prepare("SELECT day, handoffs FROM handovers WHERE site = ? AND day BETWEEN ? AND ?").bind(site, from, to));
  if (!hs.length) return null;
  const by = new Map(); for (const h of hs) { let L = []; try { L = JSON.parse(h.handoffs || "[]"); } catch {} by.set(h.day, [...(by.get(h.day) || []), ...L.map(x => hmB(x.at))]); }
  let ok = 0, n = 0, now = nowHM();
  for (const x of daysIn(from, to)) {
    const t = by.get(x) || [];
    if (x < today || now > DEADLINES.amHandover) { n++; if (t.some(v => v >= "11:00" && v <= DEADLINES.amHandover)) ok++; }
    if (x < today || now > DEADLINES.pmHandover) { n++; if (t.some(v => v >= "18:00" && v <= DEADLINES.pmHandover)) ok++; }
  }
  return n ? pct(ok, n) : null;
}
async function pirOnTime(env, site, from, to) {
  if (!env.INC_DB || !INC[site]) return null;
  const now = new Date().toISOString();
  const r = await rows(env.INC_DB.prepare("SELECT pir_due_at, pir_submitted_at FROM incidents WHERE flagship = ? AND pir_due_at IS NOT NULL AND pir_due_at <> '' AND substr(pir_due_at,1,10) BETWEEN ? AND ?").bind(INC[site], from, to));
  let ok = 0, n = 0;
  for (const x of r) { if (x.pir_submitted_at) { n++; if (x.pir_submitted_at <= x.pir_due_at) ok++; } else if (x.pir_due_at < now) n++; }
  return n ? pct(ok, n) : null;
}
async function restroomPct(env, site, from, to, today) {
  if (!env.RR_DB || !RR[site]) return null;
  const f = RR[site], rooms = await rrRooms(env, f); if (!rooms) return null;
  const r = await one(env.RR_DB.prepare("SELECT COUNT(DISTINCT log_date || '|' || room_id || '|' || window_id) AS n FROM inspection_logs WHERE flagship = ? AND log_date BETWEEN ? AND ?").bind(f, from, to));
  const now = nowHM(), expected = daysIn(from, to).reduce((a, x) => a + rooms * (x < today ? RR_W.length : RR_W.filter(([, end]) => end <= now).length), 0);
  return expected ? Math.min(100, pct((r && r.n) || 0, expected)) : null;
}
async function mf48(env, site, from, to) {
  const r = await rows(env.DB.prepare("SELECT found_at, COALESCE(NULLIF(fixed_at,''), NULLIF(closed_at,'')) AS end FROM mf_records WHERE site = ? AND deleted = 0 AND substr(found_at,1,10) BETWEEN ? AND ?").bind(site, from, to));
  let ok = 0, n = 0; const now = Date.now();
  for (const x of r) { const f = Date.parse(x.found_at), e = x.end ? Date.parse(x.end) : null;
    if (e != null) { n++; if (e - f <= 48 * 3600e3) ok++; } else if (now - f > 48 * 3600e3) n++; }
  return n ? pct(ok, n) : null;
}
async function cleaningPct(env, site, from, to, d) {
  if (!d.ccDay) return null;
  const has = await one(env.DB.prepare("SELECT COUNT(*) AS n FROM cc_jobs WHERE site = ? AND day BETWEEN ? AND ?").bind(site, from, to));
  if (!has || !has.n) return null;   // the cleaner app is not used at this flagship in this period
  let done = 0, due = 0;
  for (const x of daysIn(from, to)) { const c = await d.ccDay(site, x).catch(() => null); if (c && c.summary) { done += c.summary.done || 0; due += c.summary.dueSoFar || 0; } }
  return due ? Math.min(100, pct(done, due)) : null;
}
/* ABC Connect portal (imported reports): violations created in the period and at least 7 days old — share closed or resolved
   (a violation sent yesterday can't be resolved yet: the newest week is left out, so Today / 7 days show "—") */
async function portalVrPct(env, site, from, to, day) {
  const upto = to < dayAdd(day, -7) ? to : dayAdd(day, -7);
  if (upto < from) return null;
  const r = await one(env.DB.prepare("SELECT COUNT(*) AS n, SUM(CASE WHEN status LIKE 'Closed%' OR status LIKE 'Confirmed%' THEN 1 ELSE 0 END) AS ok FROM portal_items WHERE site = ? AND kind = 'vr' AND active = 1 AND created_day BETWEEN ? AND ?").bind(site, from, upto));
  return r && r.n ? pct(r.ok || 0, r.n) : null;
}
/* marketing requests created in the period and at least 7 days old: share already approved or rejected */
async function portalMkPct(env, site, from, to, day) {
  const upto = to < dayAdd(day, -7) ? to : dayAdd(day, -7);
  if (upto < from) return null;
  const r = await one(env.DB.prepare("SELECT COUNT(*) AS n, SUM(CASE WHEN status LIKE 'Approved%' OR status LIKE 'Rejected%' THEN 1 ELSE 0 END) AS ok FROM portal_items WHERE site = ? AND kind = 'mk' AND active = 1 AND created_day BETWEEN ? AND ?").bind(site, from, upto));
  return r && r.n ? pct(r.ok || 0, r.n) : null;
}
async function glaPct(env, site) {
  const g = await rows(env.DB.prepare("SELECT status, section, area FROM gla_units WHERE site = ? AND active = 1").bind(site));
  const lease = g.filter(u => !u.section || /leas/i.test(u.section)), total = lease.reduce((a, u) => a + (Number(u.area) || 0), 0);
  const vac = lease.filter(u => ["Vacant", "Terminated"].includes(u.status)).reduce((a, u) => a + (Number(u.area) || 0), 0);
  return total ? Math.round((total - vac) / total * 1000) / 10 : null;
}
async function contractorEntries(env, site, from, to) {
  const r = await one(env.DB.prepare("SELECT COUNT(*) AS n FROM contractor_checks WHERE site = ? AND in_at <> '' AND day BETWEEN ? AND ?").bind(site, from, to)); return (r && r.n) || 0;
}
async function contractsEnding(env, site, day) {
  const r = await one(env.DB.prepare("SELECT COUNT(*) AS n FROM contracts_ending WHERE site = ? AND active = 1 AND COALESCE(NULLIF(departure_day,''), end_day) BETWEEN ? AND ?").bind(site, day, dayAdd(day, 60))); return (r && r.n) || 0;
}

async function kpiBrief(env, sites, period, d, cfg) {
  const day = d.today(), R = rangeOf(period, day), P = prevRange(R);
  const ck = `brief:kpi:${sites.join(",")}:${period}:${day}:${Object.keys(cfg).filter(k => cfg[k]).join(",")}`;
  try { const c = JSON.parse(((await one(env.DB.prepare("SELECT v FROM meta WHERE k = ?").bind(ck))) || {}).v || "null"); if (c && Date.now() - c.t < 10 * 60e3) return c.data; } catch {}
  const snag = cfg.snags && d.snagReport ? await d.snagReport(R.from, R.to).catch(() => null) : null;
  const S = new Map(((snag && snag.sites) || []).map(s => [s.site, s]));
  const calc = async (site, k, r, prev) => {
    switch (k) {
      case "restroom": return restroomPct(env, site, r.from, r.to, day);
      case "pir": return pirOnTime(env, site, r.from, r.to);
      case "amcheck": return checklistOnTime(env, site, r.from, r.to, "am", DEADLINES.amCheck, day);
      case "pmcheck": return checklistOnTime(env, site, r.from, r.to, "pm", DEADLINES.pmCheck, day);
      case "handover": return handoverOnTime(env, site, r.from, r.to, day);
      case "cleaning": return prev ? null : cleaningPct(env, site, r.from, r.to, d);
      case "mf48": return mf48(env, site, r.from, r.to);
      case "snags": return prev ? null : S.has(site) ? S.get(site).solved : null;
      case "gla": return prev ? null : glaPct(env, site);
      case "contractors": return prev ? null : contractorEntries(env, site, r.from, r.to);
      case "contracts": return prev ? null : contractsEnding(env, site, day);
      case "vrres": return portalVrPct(env, site, r.from, r.to, day);
      case "mk7": return portalMkPct(env, site, r.from, r.to, day);
    }
    return null;
  };
  const PCT = new Set(["restroom", "pir", "amcheck", "pmcheck", "handover", "cleaning", "mf48", "gla", "vrres", "mk7"]);
  const keys = Object.keys(KPI_ITEMS).filter(k => cfg[k]);
  const out = [];
  for (const k of keys) {
    const cells = await Promise.all(sites.map(async s => {
      const v = await calc(s, k, R, false), pv = PCT.has(k) && !["cleaning", "gla"].includes(k) ? await calc(s, k, P, true) : null;
      return { site: s, v, pct: PCT.has(k), tone: PCT.has(k) && k !== "gla" ? tone(v) : "", delta: v != null && pv != null ? Math.round(v - pv) : null,
        sub: k === "snags" && S.has(s) ? `${S.get(s).openTotal} open` : "" };
    }));
    out.push({ key: k, label: KPI_ITEMS[k], cells });
  }
  const worst = [];
  for (const row of out) for (const c of row.cells) if (c.tone === "r" || c.tone === "a") worst.push({ site: c.site, siteName: d.siteName(c.site), label: row.label, v: c.v, tone: c.tone, delta: c.delta });
  worst.sort((a, b) => a.v - b.v);
  const data = { kind: "kpi", period, range: R, sites: sites.map(s => ({ code: s, name: d.siteName(s) })), rows: out, worst: worst.slice(0, 3) };
  await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)").bind(ck, JSON.stringify({ t: Date.now(), data })).run().catch(() => {});
  env.DB.prepare("DELETE FROM meta WHERE k LIKE 'brief:kpi:%' AND k NOT LIKE ?").bind(`%:${day}:%`).run().catch(() => {});
  return data;
}

export async function roleBriefRoute(env, p, method, b, url, d) {
  const { me } = d, cfgAll = await briefConfig(env);
  if (p === "brief/settings") {
    if (me.role !== "ADMIN") throw err("Admin only", 403);
    if (method === "POST") {
      const c = {}; for (const a of Object.keys(AUDIENCES)) { const items = a === "manager" ? MGR_ITEMS : KPI_ITEMS; c[a] = Object.fromEntries(Object.keys(items).map(k => [k, !!(b[a] || {})[k]])); }
      await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('brief:cfg', ?)").bind(JSON.stringify(c)).run();
      return { saved: true, cfg: await briefConfig(env) };
    }
    return { cfg: cfgAll, audiences: AUDIENCES, mgrItems: MGR_ITEMS, kpiItems: KPI_ITEMS };
  }
  if (p !== "brief/role") throw err("Unknown request", 404);
  let aud = audienceOf(me);
  const q = k => url.searchParams.get(k) || "";
  if (aud === "admin") aud = AUDIENCES[q("as")] ? q("as") : "advisor";   // Admin: preview as…
  if (aud === "none") return { kind: "none" };
  const mine = d.sitesOf(me);
  if (aud === "manager") {
    const site = me.role === "ADMIN" ? (mine.includes(q("site")) ? q("site") : mine[0]) : (mine.includes(q("site")) ? q("site") : (me.site_code && mine.includes(me.site_code) ? me.site_code : mine[0]));
    return { audience: aud, ...(await managerBrief(env, site, d, cfgAll.manager)), sites: me.role === "ADMIN" || mine.length > 1 ? mine : [] };
  }
  const sites = aud === "advisor" ? mine : POS_SITES[aud];
  if (!sites.length) return { kind: "none" };
  const period = ["today", "7d", "month"].includes(q("period")) ? q("period") : "month";
  return { audience: aud, ...(await kpiBrief(env, sites, period, d, cfgAll[aud])) };
}
