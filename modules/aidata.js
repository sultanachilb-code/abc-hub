/* =====================================================================
   ABCON data router (Oct 2026) — docs/FEATURE-ai.md · "Data router"
   ABCON reads ~11,000 characters per question on the free allowance, so it never gets "all the data".
   Instead this module reads the QUESTION (no AI call, no Neurons): which subjects, which flagships, which period,
   and fetches only those slices from the hub database and the linked systems (Incidents, Restroom, Snaglist, Loading Gate,
   Cleaning, Portal reports). Every slice follows the asker's hub access: the flagships on his account and the tiles
   his title may open (the same APP_ACCESS list as the hub). Names and positions of hub users are shared with everyone;
   phone numbers, emails, passwords and personal data of visitors are never given to the AI.
   ===================================================================== */
import { kpiFor, INC_NAME, RR_NAME } from "./rolebrief.js";

const clip = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
const rows = async q => { try { return (await q.all()).results || []; } catch (e) { console.error("aidata", e && e.message); return []; } };
const one = async q => { try { return await q.first(); } catch { return null; } };
const dayAdd = (day, n) => new Date(Date.parse(day + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const norm = s => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9؀-ۿ]+/g, " ").trim();
const pct = (a, b) => b ? Math.round(a / b * 100) : null;
const ph = n => Array(n).fill("?").join(",");
const count = (L, k) => { const o = {}; for (const x of L) { const v = (typeof k === "function" ? k(x) : x[k]) || "—"; o[v] = (o[v] || 0) + 1; } return Object.entries(o).sort((a, b) => b[1] - a[1]); };
const list = (pairs, n = 12) => pairs.slice(0, n).map(([k, v]) => `${k} ${v}`).join(", ");

/* ---------- 1. flagships named in the question ---------- */
const SITE_WORDS = [   // most specific first
  ["ACS", /achrafieh (ds|department)|ashrafieh (ds|department)|الأشرفية.*(ديبارتمنت|متجر)/], ["VRS", /verdun (ds|department)|فردان.*(ديبارتمنت|متجر)/],
  ["DBS", /dbayeh|dbaye|ضبية|ضبيه/], ["ACM", /achrafieh|ashrafieh|الأشرفية|الاشرفية/], ["VRM", /verdun|فردان/]];
function sitesIn(q, mine, current) {
  const t = norm(q), out = [];
  let rest = t;
  for (const [c, re] of SITE_WORDS) if (re.test(rest)) { out.push(c); rest = rest.replace(re, " "); }
  const all = /\b(all|every|each|compare|comparison|across|both|flagships|كل|جميع|قارن)\b/.test(t);
  const pick = out.length ? out : all && mine.length > 1 ? mine : [current];
  return [...new Set(pick)].filter(s => mine.includes(s)).slice(0, 5);
}

/* ---------- 2. the period ---------- */
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
export function periodIn(q, today) {
  const t = norm(q), y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  const mon = (yy, mm) => { const from = `${yy}-${String(mm).padStart(2, "0")}-01`, end = new Date(Date.UTC(yy, mm, 0)).toISOString().slice(0, 10); return { from, to: end < today ? end : today }; };
  if (/\b(today|now|اليوم)\b/.test(t)) return { from: today, to: today, label: "today" };
  if (/\byesterday|امبارح|البارحة\b/.test(t)) { const d = dayAdd(today, -1); return { from: d, to: d, label: "yesterday" }; }
  if (/\blast week|previous week|الأسبوع الماضي\b/.test(t)) return { from: dayAdd(today, -13), to: dayAdd(today, -7), label: "last week" };
  if (/\b(this week|past week|last 7 days|7 days|هالأسبوع|هذا الأسبوع)\b/.test(t)) return { from: dayAdd(today, -6), to: today, label: "last 7 days" };
  if (/\blast month|previous month|الشهر الماضي\b/.test(t)) { const r = m === 1 ? mon(y - 1, 12) : mon(y, m - 1); return { ...r, label: "last month" }; }
  if (/\b(this month|month to date|mtd|هالشهر|هذا الشهر)\b/.test(t)) return { from: today.slice(0, 8) + "01", to: today, label: "this month" };
  if (/\b(this year|ytd|year to date|هالسنة)\b/.test(t)) return { from: today.slice(0, 5) + "01-01", to: today, label: "this year" };
  const nd = /\b(last|past) (\d{1,3}) days\b/.exec(t); if (nd) return { from: dayAdd(today, -(Number(nd[2]) - 1)), to: today, label: `last ${nd[2]} days` };
  const mi = MONTHS.findIndex(x => x === "may" ? /\b(in|of|during|for|since) may\b|\bmay \d{4}\b/.test(t) : new RegExp(`\\b${x}|\\b${x.slice(0, 3)}[a-z]?\\b`).test(t));
  if (mi >= 0) { const yy = mi + 1 > m ? y - 1 : y; return { ...mon(yy, mi + 1), label: `${MONTHS[mi]} ${yy}` }; }
  return { from: dayAdd(today, -29), to: today, label: "last 30 days", dflt: true };
}

/* ---------- 3. subjects ---------- */
const TOPICS = {
  people: /\b(who|whom|manager|managers|supervisor|officer|director|cdso|advisor|team|staff|employee|people|position|title|in charge|responsible|on shift|shift|working today|off today|leave|مين|مدير|مشرف|فريق|موظف)\b/,
  portal: /(portal|violation|breach|penalt|marketing|mkt-|activation|photoshoot|oriflamme|podium|permit|\bcp-|\bvr-|\bbp-|\bnr-|abc request|normal request|portal user|log ?in|licen[cs]e|abc connect)/,
  malfunctions: /(malfunction|broken|repair|escalator|elevator|\blift|\bac\b|hvac|chiller|leak|pump|generator|maintenance|provider|out of order|عطل|اعطال|أعطال)/,
  incidents: /(incident|accident|injur|fire|theft|\bpir\b|security event|first aid|حادث|حوادث)/,
  restroom: /(restroom|toilet|\bwc\b|bathroom|washroom|حمام|حمامات)/,
  kpi: /(kpi|compliance|performance|score|on time|late|checklist|am check|pm check|handover|hand over|scorecard|percent|%)/,
  contractors: /(contractor|\breq-|gate|loading|quick pass|access pass|insurance|متعهد|مقاول)/,
  crm: /(\bcrm\b|handheld|hand held|pos device|areeba)/,
  projects: /(project|مشروع)/,
  budget: /(capex|opex|budget|spend|spent|\bcost|\bjde\b|ميزانية)/,
  calendar: /(event|calendar|activation|meeting|\bmom\b|minutes|action item|agenda|اجتماع)/,
  training: /(training|course|certificat|expired|expiry|expire|تدريب)/,
  cleaning: /(cleaning|cleaner|clean|janitor|تنظيف)/,
  fitout: /(fit ?out|works form|tenant works|renovation|opening|reopen|closing|closure|relocation)/,
  patrol: /(patrol|\brounds?\b|checkpoint|guard)/,
  feedback: /(feedback|complain|warning|smok|tenant issue|repeat offender|ملاحظ)/,
  snags: /(snag|سناغ)/,
  gla: /(\bgla\b|occupan|vacan|leasable|\bm2\b|sqm|\blease)/
};
export function topicsIn(q) { const t = String(q || "").toLowerCase(); return Object.keys(TOPICS).filter(k => TOPICS[k].test(t)); }

/* the hub tiles each subject needs (the asker's title must be allowed at least one) */
const TOPIC_APPS = { portal: ["portal"], malfunctions: ["malfunctions"], incidents: ["incidents"], restroom: ["restroom"], contractors: ["contractors", "contractor-access"],
  crm: ["crm"], projects: ["projects"], budget: ["budget"], calendar: ["calendar", "mom"], training: ["training"], cleaning: ["cleanctl", "cleaning"], fitout: ["fitout", "works"],
  patrol: ["patrol"], feedback: ["feedback"], snags: ["snaglist"], gla: ["gla"] };
const TOPIC_LABEL = { portal: "Portal Dashboard", malfunctions: "Malfunctions", incidents: "Incidents", restroom: "Restroom inspections", contractors: "Contractors",
  crm: "CRM", projects: "Projects", budget: "Budget (CAPEX / OPEX)", calendar: "Calendar / MOM", training: "Training", cleaning: "Cleaning", fitout: "Fit-out / Works", patrol: "Patrol",
  feedback: "Tenant feedback", snags: "Snaglist", gla: "GLA" };
/* named flagships the asker cannot open */
function deniedSites(q, mine) {
  const t = norm(q), out = []; let rest = t;
  for (const [c, re] of SITE_WORDS) if (re.test(rest)) { out.push(c); rest = rest.replace(re, " "); }
  return out.filter(c => !mine.includes(c));
}

/* ---------- 4. the slices ---------- */
const S = {};
S.people = async (env, x) => {
  const P = await x.d.people(x.sites);   // [{ name, email, role, pos, sites:[codes] }] — active hub users
  const L = [];
  for (const s of x.sites) {
    const here = P.filter(p => p.sites.includes(s));
    const shifts = await rows(env.DB.prepare("SELECT email, val FROM sched_cells WHERE site = ? AND day = ?").bind(s, x.today));
    const sh = new Map(shifts.map(r => [r.email, r.val]));
    L.push(`People at ${x.name(s)} (hub accounts): ${here.map(p => `${p.name} — ${p.pos}${sh.get(p.email) ? ` [today: ${clip(sh.get(p.email), 20)}]` : ""}`).join("; ") || "none"}.`);
  }
  const lead = P.filter(p => ["ADVISOR", "DIRECTOR", "CDSO"].includes(p.role));
  if (lead.length) L.push(`Leadership: ${lead.map(p => `${p.name} — ${p.pos} (${p.sites.map(x.name).join(", ")})`).join("; ")}.`);
  return L.join("\n");
};
S.portal = async (env, x) => {
  if (!x.can("portal")) return "";
  const I = await rows(env.DB.prepare(`SELECT name, kind, site, tenant, type, status, created_day, valid_from, valid_to, subject FROM portal_items WHERE active = 1 AND (site IN (${ph(x.sites.length)}) OR site = '*')`).bind(...x.sites));
  const L = [];
  for (const s of x.sites) {
    const H = I.filter(i => i.site === s), k = kk => H.filter(i => i.kind === kk);
    if (!H.length) continue;
    const vr = k("vr"), wait = H.filter(i => /^sent to tenant/i.test(i.status)), old = wait.filter(i => i.created_day && i.created_day < dayAdd(x.today, -30));
    const mk = k("mk"), mkR = mk.filter(i => /^(submitted|created)/i.test(i.status));
    const per = H.filter(i => i.created_day >= x.p.from && i.created_day <= x.p.to);
    L.push(`Portal (ABC Connect) · ${x.name(s)}: waiting on tenants ${wait.length} (${old.length} over 30 days); violations ${vr.length} (${pct(vr.filter(i => /^(closed|confirmed)/i.test(i.status)).length, vr.length)}% closed or resolved), by status ${list(count(vr, "status"))}; breaches ${list(count(k("bp"), "status"))}; ABC requests ${list(count(k("nr"), "status"))}; marketing to review ${mkR.length}, by type ${list(count(mk, "type"), 8)}. New in ${x.p.label}: ${list(count(per, i => ({ vr: "violations", bp: "breaches", nr: "requests", mk: "marketing" })[i.kind] || i.kind))}.`);
    const T = count(H.filter(i => ["vr", "bp"].includes(i.kind) && /^(sent to tenant|created|in review)/i.test(i.status)), "tenant");
    if (T.length) L.push(`Portal · ${x.name(s)} · tenants with the most open violations / breaches: ${list(T, 10)}.`);
    if (old.length) L.push(`Portal · ${x.name(s)} · oldest waiting: ${old.sort((a, b) => a.created_day < b.created_day ? -1 : 1).slice(0, 8).map(i => `${i.name} ${i.tenant} (${i.type || i.subject}, since ${i.created_day})`).join("; ")}.`);
    if (mkR.length) L.push(`Portal · ${x.name(s)} · marketing waiting for review: ${mkR.sort((a, b) => a.created_day < b.created_day ? -1 : 1).slice(0, 8).map(i => `${i.name} ${i.tenant} (${i.type}, since ${i.created_day})`).join("; ")}.`);
  }
  const now = x.nowLocal, cp = I.filter(i => i.kind === "cp"), live = cp.filter(i => /^approved/i.test(i.status) && i.valid_from <= now && i.valid_to >= now);
  if (cp.length) L.push(`Contractor permits (portal${cp.some(i => i.site === "*") ? ", not split per flagship" : ""}): live now ${live.length}: ${live.slice(0, 12).map(i => `${i.name} ${i.subject} until ${i.valid_to.slice(0, 16).replace("T", " ")}`).join("; ")}; waiting approval ${cp.filter(i => /^submitted/i.test(i.status)).length}.`);
  if (x.can("portal") && x.full && /portal user|log ?in|licen/i.test(x.q)) {
    const u = await rows(env.DB.prepare("SELECT last_login FROM portal_users WHERE active = 1"));
    const ago = l => l ? Math.round((Date.parse(x.today) - Date.parse(l.slice(0, 10))) / 864e5) : null;
    if (u.length) L.push(`Portal users: ${u.length} active; logged in last 7 days ${u.filter(r => ago(r.last_login) != null && ago(r.last_login) <= 7).length}, last 30 days ${u.filter(r => ago(r.last_login) != null && ago(r.last_login) <= 30).length}, never ${u.filter(r => !r.last_login).length}.`);
  }
  return L.join("\n");
};
S.malfunctions = async (env, x) => {
  if (!x.can("malfunctions")) return "";
  const L = [];
  for (const s of x.sites) {
    const r = await rows(env.DB.prepare(`SELECT r.category, r.location, r.asset, r.priority, r.status, r.found_at, r.fixed_at, r.closed_at, p.name AS provider FROM mf_records r LEFT JOIN mf_providers p ON p.id = r.provider_id
      WHERE r.site = ? AND r.deleted = 0 AND substr(r.found_at,1,10) BETWEEN ? AND ?`).bind(s, x.p.from, x.p.to));
    if (!r.length) { L.push(`Malfunctions · ${x.name(s)} · ${x.p.label}: none recorded.`); continue; }
    const fx = r.map(m => { const e = m.fixed_at || m.closed_at; return e ? (Date.parse(e) - Date.parse(m.found_at)) / 36e5 : null; }).filter(v => v != null);
    L.push(`Malfunctions · ${x.name(s)} · ${x.p.label} (${x.p.from} to ${x.p.to}): ${r.length} recorded; by category ${list(count(r, "category"))}; by status ${list(count(r, "status"))}; by priority ${list(count(r, "priority"))}; top places ${list(count(r, m => m.asset || m.location), 8)}; by provider ${list(count(r, "provider"), 6)}${fx.length ? `; average time to fix ${Math.round(fx.reduce((a, v) => a + v, 0) / fx.length)} h` : ""}.`);
  }
  return L.join("\n");
};
S.incidents = async (env, x) => {
  if (!x.can("incidents") || !env.INC_DB) return "";
  const L = [];
  for (const s of x.sites) {
    const f = INC_NAME[s]; if (!f) continue;
    const r = await rows(env.INC_DB.prepare("SELECT ref, incident_date, category, type, severity, status, pir_due_at, pir_submitted_at, escalation_required FROM incidents WHERE flagship = ? AND incident_date BETWEEN ? AND ? ORDER BY incident_date DESC").bind(f, x.p.from, x.p.to));
    L.push(`Incidents · ${x.name(s)} · ${x.p.label}: ${r.length}${r.length ? `; by type ${list(count(r, "type"))}; by severity ${list(count(r, "severity"))}; by status ${list(count(r, "status"))}; escalated ${r.filter(i => String(i.escalation_required) === "1" || i.escalation_required === true).length}; PIR submitted ${r.filter(i => i.pir_submitted_at).length} of ${r.filter(i => i.pir_due_at).length} due. Latest: ${r.slice(0, 8).map(i => `${i.ref} ${i.incident_date} ${i.type} (${i.severity}, ${i.status})`).join("; ")}` : ""}.`);
  }
  return L.join("\n");
};
S.restroom = async (env, x) => {
  if (!x.can("restroom") || !env.RR_DB) return "";
  const L = [];
  for (const s of x.sites) {
    const f = RR_NAME[s]; if (!f) continue;
    const k = await kpiFor(env, s, x.p.from, x.p.to, x.today).catch(() => ({}));
    const iss = await rows(env.RR_DB.prepare("SELECT room_name, COUNT(*) AS n FROM inspection_logs WHERE flagship = ? AND log_date BETWEEN ? AND ? AND has_issues = 1 GROUP BY room_name ORDER BY n DESC LIMIT 8").bind(f, x.p.from, x.p.to));
    const t = await one(env.RR_DB.prepare("SELECT COUNT(*) AS n, SUM(has_issues) AS bad FROM inspection_logs WHERE flagship = ? AND log_date BETWEEN ? AND ?").bind(f, x.p.from, x.p.to));
    L.push(`Restroom inspections · ${x.name(s)} · ${x.p.label}: ${(t && t.n) || 0} inspections, ${(t && t.bad) || 0} with issues; compliance ${k.restroom == null ? "no data" : k.restroom + "%"}${iss.length ? `; rooms with most issues ${iss.map(r => `${r.room_name} ×${r.n}`).join(", ")}` : ""}.`);
  }
  return L.join("\n");
};
S.kpi = async (env, x) => {
  const L = [];
  for (const s of x.sites) {
    const k = await kpiFor(env, s, x.p.from, x.p.to, x.today).catch(() => null); if (!k) continue;
    const f = (lab, v, unit = "%") => `${lab} ${v == null ? "no data" : v + unit}`;
    L.push(`KPIs · ${x.name(s)} · ${x.p.label} (${x.p.from} to ${x.p.to}): ${[f("AM checklist on time", k.amcheck), f("PM checklist on time", k.pmcheck), f("handover on time", k.handover), f("restroom compliance", k.restroom), f("incident PIR on time", k.pir), f("malfunctions fixed within 48 h", k.mf48), f("portal violations resolved (older than 7 days)", k.vrres), f("marketing answered (older than 7 days)", k.mk7), f("contractor entries", k.contractors, "")].join("; ")}. (Green ≥ 90 %, amber 75–89 %, red < 75 %.)`);
  }
  return L.join("\n");
};
S.contractors = async (env, x) => {
  if (!x.can("contractors") && !x.can("contractor-access")) return "";
  const L = [];
  for (const s of x.sites) {
    const [v, g, qp] = await Promise.all([
      rows(env.DB.prepare("SELECT company, tenant, work, day_from, day_to FROM contractor_visits WHERE site = ? AND deleted = 0 AND day_from <= ? AND day_to >= ?").bind(s, x.p.to, x.p.from)),
      rows(env.DB.prepare("SELECT decision, contractor, tenant, reason, day FROM gate_scans WHERE site = ? AND day BETWEEN ? AND ?").bind(s, x.p.from, x.p.to)),
      rows(env.DB.prepare("SELECT company, status FROM quick_passes WHERE site = ? AND day BETWEEN ? AND ?").bind(s, x.p.from, x.p.to))]);
    const ref = g.filter(r => /reject|refus|out/i.test(r.decision || ""));
    L.push(`Contractors · ${x.name(s)} · ${x.p.label}: ${v.length} visits booked; top companies ${list(count(v, "company"), 8)}; top tenants ${list(count(v, "tenant"), 8)}; loading gate scans ${g.length} (${ref.length} refused${ref.length ? ": " + ref.slice(0, 6).map(r => `${r.contractor || r.tenant} ${r.day} (${clip(r.reason, 40)})`).join("; ") : ""}); quick passes ${qp.length} (${list(count(qp, "status"), 4)}).`);
    const ins = await rows(env.DB.prepare("SELECT company, ins_expiry FROM contractors WHERE site = ? AND deleted = 0 AND ins_expiry <> '' AND ins_expiry <= ? ORDER BY ins_expiry LIMIT 10").bind(s, dayAdd(x.today, 30)));
    if (ins.length) L.push(`Contractors · ${x.name(s)} · insurance expired or expiring within 30 days: ${ins.map(r => `${r.company} ${r.ins_expiry}`).join("; ")}.`);
  }
  return L.join("\n");
};
S.crm = async (env, x) => {
  if (!x.can("crm")) return "";
  const L = [];
  for (const s of x.sites) {
    const r = await rows(env.DB.prepare("SELECT c.floor, c.sheet_name, c.status, c.model, c.connection, c.crm, g.brand FROM crm_rows c LEFT JOIN gla_units g ON g.id = c.unit_id WHERE c.site = ?").bind(s));   // never the CRM user / password
    if (r.length) L.push(`CRM handhelds · ${x.name(s)}: ${r.length} lines; by status ${list(count(r, "status"))}; by model ${list(count(r, "model"), 6)}; by connection ${list(count(r, "connection"), 4)}.${/\b(open|pending|missing|not)\b/i.test(x.q) ? ` Not delivered / open: ${r.filter(c => !/deliver|active|done/i.test(c.status || "")).slice(0, 15).map(c => `${c.brand || c.sheet_name} (${c.floor}, ${c.status || "—"})`).join("; ")}.` : ""}`);
  }
  return L.join("\n");
};
S.projects = async (env, x) => {
  const L = [];
  for (const s of x.sites) {
    if (x.can("projects")) {
      const p = await rows(env.DB.prepare("SELECT title, stage, priority, owner, due_day, progress, budget, spent, currency FROM projects WHERE site = ? AND deleted = 0 ORDER BY due_day").bind(s));
      if (p.length) L.push(`Projects · ${x.name(s)}: ${p.length}; by stage ${list(count(p, "stage"))}. ${p.filter(r => !/done|closed|complete/i.test(r.stage || "")).slice(0, 12).map(r => `${clip(r.title, 50)} — ${r.stage}${r.owner ? ", " + r.owner : ""}${r.due_day ? ", due " + r.due_day : ""}${r.progress ? ", " + r.progress + "%" : ""}`).join("; ")}.`);
    }
  }
  return L.join("\n");
};
S.budget = async (env, x) => {
  const L = [];
  for (const s of x.sites) {
    if (x.can("budget")) {
      const y = x.today.slice(0, 4);
      const b = await rows(env.DB.prepare("SELECT kind, SUM(budget) AS budget, SUM(fct) AS fct, SUM(landing) AS landing, COUNT(*) AS n FROM budget_lines WHERE site = ? AND year = ? GROUP BY kind").bind(s, y));
      const u = await rows(env.DB.prepare("SELECT kind, SUM(amount) AS used FROM budget_uses WHERE site = ? AND year = ? GROUP BY kind").bind(s, y));
      if (b.length) L.push(`Budget ${y} · ${x.name(s)}: ${b.map(r => `${r.kind}: ${r.n} lines, budget ${Math.round(r.budget || 0).toLocaleString("en-US")}, forecast ${Math.round(r.fct || 0).toLocaleString("en-US")}, landing ${Math.round(r.landing || 0).toLocaleString("en-US")}, used ${Math.round((u.find(z => z.kind === r.kind) || {}).used || 0).toLocaleString("en-US")}`).join(" · ")} (USD).`);
    }
  }
  return L.join("\n");
};
S.calendar = async (env, x) => {
  const L = [];
  const to = x.p.dflt ? dayAdd(x.today, 30) : x.p.to, from = x.p.dflt ? x.today : x.p.from;
  for (const s of x.sites) {
    if (x.can("calendar")) {
      const c = await rows(env.DB.prepare("SELECT kind, title, start_day, end_day, time_from, location, done FROM cal_items WHERE site = ? AND deleted = 0 AND start_day <= ? AND COALESCE(NULLIF(end_day,''), start_day) >= ? ORDER BY start_day LIMIT 40").bind(s, to, from));
      if (c.length) L.push(`Calendar · ${x.name(s)} · ${from} to ${to}: ${c.map(e => `${e.start_day}${e.time_from ? " " + e.time_from : ""} ${clip(e.title, 50)} (${e.kind}${e.location ? ", " + clip(e.location, 30) : ""})`).join("; ")}.`);
    }
    if (x.can("mom")) {
      const m = await rows(env.DB.prepare("SELECT title, meet_date, status FROM mom_meetings WHERE site = ? AND meet_date BETWEEN ? AND ? ORDER BY meet_date DESC LIMIT 10").bind(s, x.p.from, to));
      const a = await rows(env.DB.prepare("SELECT a.text, a.owner_name, a.due, a.status FROM mom_actions a JOIN mom_meetings mm ON mm.id = a.meeting_id WHERE a.site = ? AND mm.status = 'published' AND a.status <> 'done' ORDER BY a.due LIMIT 20").bind(s));
      if (m.length || a.length) L.push(`Meetings (MOM) · ${x.name(s)}: ${m.map(r => `${r.meet_date} ${clip(r.title, 40)} (${r.status})`).join("; ") || "none in the period"}. Open actions: ${a.map(r => `${clip(r.text, 60)} — ${r.owner_name || "?"}${r.due ? ", due " + r.due : ""}`).join("; ") || "none"}.`);
    }
  }
  return L.join("\n");
};
S.training = async (env, x) => {
  if (!x.can("training")) return "";
  const L = [];
  for (const s of x.sites) {
    const r = await rows(env.DB.prepare(`SELECT p.name, c.name AS course, r.expires_on FROM tr_records r JOIN tr_people p ON p.id = r.person JOIN tr_courses c ON c.id = r.course_id WHERE r.site = ? AND p.active = 1 AND r.expires_on <> '' AND r.expires_on <= ? ORDER BY r.expires_on LIMIT 25`).bind(s, dayAdd(x.today, 60)));
    const n = await one(env.DB.prepare("SELECT COUNT(*) AS n FROM tr_people WHERE site = ? AND active = 1").bind(s));
    L.push(`Training · ${x.name(s)}: ${(n && n.n) || 0} people tracked; expired or expiring within 60 days: ${r.map(t => `${t.name} — ${t.course} ${t.expires_on < x.today ? "EXPIRED " : ""}${t.expires_on}`).join("; ") || "none"}.`);
  }
  return L.join("\n");
};
S.cleaning = async (env, x) => {
  if (!x.can("cleanctl") && !x.can("cleaning")) return "";
  const L = [];
  for (const s of x.sites) {
    const j = await rows(env.DB.prepare("SELECT day, floor, area, user_name, after_at FROM cc_jobs WHERE site = ? AND day BETWEEN ? AND ?").bind(s, x.p.from, x.p.to));
    const rep = await rows(env.DB.prepare("SELECT provider, day_from, day_to, rows, staff FROM cl_reports WHERE site = ? AND day_to >= ? AND day_from <= ? ORDER BY day_from DESC LIMIT 5").bind(s, x.p.from, x.p.to));
    if (j.length || rep.length) L.push(`Cleaning · ${x.name(s)} · ${x.p.label}: cleaner-app jobs ${j.length} (with after photo ${j.filter(r => r.after_at).length}); by floor ${list(count(j, "floor"), 8)}; by cleaner ${list(count(j, "user_name"), 8)}${rep.length ? `; schedule reports: ${rep.map(r => `${r.provider} ${r.day_from}–${r.day_to} (${r.staff} staff)`).join("; ")}` : ""}.`);
  }
  return L.join("\n");
};
S.fitout = async (env, x) => {
  const L = [];
  for (const s of x.sites) {
    if (x.can("fitout")) {
      const f = await rows(env.DB.prepare("SELECT brand, target FROM fitout_tracks WHERE site = ? ORDER BY target").bind(s));
      if (f.length) L.push(`Fit-out tracker · ${x.name(s)}: ${f.slice(0, 15).map(r => `${r.brand}${r.target ? " (target opening " + r.target + ")" : ""}`).join("; ")}.`);
    }
    if (x.can("works")) {
      const w = await rows(env.DB.prepare("SELECT type, tenant, unit, status, received_at FROM works_forms WHERE site = ? AND deleted = 0 AND substr(received_at,1,10) BETWEEN ? AND ? ORDER BY received_at DESC LIMIT 25").bind(s, x.p.from, x.p.to));
      if (w.length) L.push(`Tenant works forms · ${x.name(s)} · ${x.p.label}: ${w.length}; by status ${list(count(w, "status"))}. ${w.slice(0, 10).map(r => `${r.tenant} ${r.unit} — ${r.type}, ${r.status}`).join("; ")}.`);
    }
  }
  return L.join("\n");
};
S.patrol = async (env, x) => {
  if (!x.can("patrol")) return "";
  const L = [];
  for (const s of x.sites) {
    const r = await rows(env.DB.prepare("SELECT day, round, status, issues, guard FROM patrol_scans WHERE site = ? AND day BETWEEN ? AND ?").bind(s, x.p.from, x.p.to));
    if (r.length) L.push(`Security patrol · ${x.name(s)} · ${x.p.label}: ${r.length} checkpoint scans over ${new Set(r.map(z => z.day + z.round)).size} rounds; with issues ${r.filter(z => Number(z.issues) > 0 || /issue/i.test(z.status || "")).length}; by guard ${list(count(r, "guard"), 8)}.`);
  }
  return L.join("\n");
};
S.feedback = async (env, x) => {
  if (!x.can("feedback")) return "";
  const L = [];
  for (const s of x.sites) {
    const r = await rows(env.DB.prepare("SELECT tenant, category, action FROM tenant_feedback WHERE site = ? AND day BETWEEN ? AND ?").bind(s, x.p.from, x.p.to));
    L.push(`Tenant feedback / violations · ${x.name(s)} · ${x.p.label}: ${r.length}; by category ${list(count(r, "category"), 8)}; tenants with most ${list(count(r, "tenant"), 10)}; actions ${list(count(r, "action"), 5)}.`);
  }
  return L.join("\n");
};
S.snags = async (env, x) => {
  if (!x.can("snaglist") || !x.d.snagReport) return "";
  const r = await x.d.snagReport(x.p.from, x.p.to).catch(() => null);
  if (!r || !r.sites) return "";
  return r.sites.filter(z => x.sites.includes(z.site)).map(z => `Snaglist · ${x.name(z.site)} · ${x.p.label}: findings open now ${z.openTotal}, added ${z.added}, solved ${z.solved}; visits posted ${(z.visits || {}).posted || 0}, closed ${(z.visits || {}).closed || 0}, open now ${(z.visits || {}).openNow || 0}, late ${(z.visits || {}).late || 0}.`).join("\n");
};
S.gla = async (env, x) => {
  if (!x.can("gla")) return "";
  const L = [];
  for (const s of x.sites) {
    const g = await rows(env.DB.prepare("SELECT level, status, section, area FROM gla_units WHERE site = ? AND active = 1").bind(s));
    const lease = g.filter(u => !u.section || /leas/i.test(u.section)), a = L2 => L2.reduce((t, u) => t + (Number(u.area) || 0), 0);
    if (!lease.length) continue;
    const vac = lease.filter(u => ["Vacant", "Terminated"].includes(u.status));
    L.push(`GLA · ${x.name(s)}: ${lease.length} leasing units, ${Math.round(a(lease))} m²; occupancy ${Math.round((a(lease) - a(vac)) / (a(lease) || 1) * 1000) / 10}% by area; by status ${list(count(lease, "status"))}; vacant per level ${list(count(vac, "level"))}.`);
  }
  return L.join("\n");
};
/* a tenant named in the question → its page (unit, contract, portal items, feedback, CRM, works) */
async function tenantSlice(env, x) {
  if (!x.can("gla") && !x.can("tenant360") && !x.can("portal")) return "";
  const t = " " + norm(x.q) + " ";
  const U = await rows(env.DB.prepare(`SELECT id, site, level, code, brand, status, area FROM gla_units WHERE active = 1 AND brand <> '' AND site IN (${ph(x.mine.length)})`).bind(...x.mine));
  const hits = U.filter(u => { const b = norm(u.brand); return b.length >= 3 && t.includes(" " + b + " "); }).slice(0, 3);
  const L = [];
  for (const u of hits) {
    const [ce, pi, fb, crm, wf] = await Promise.all([
      one(env.DB.prepare("SELECT end_day, departure_day, status FROM contracts_ending WHERE site = ? AND active = 1 AND lower(tenant) LIKE ? LIMIT 1").bind(u.site, `%${u.brand.toLowerCase()}%`)),
      x.can("portal") ? rows(env.DB.prepare("SELECT name, kind, type, status, created_day FROM portal_items WHERE site = ? AND active = 1 AND lower(tenant) = ? ORDER BY created_day DESC").bind(u.site, u.brand.toLowerCase())) : [],
      x.can("feedback") ? rows(env.DB.prepare("SELECT day, category, description FROM tenant_feedback WHERE site = ? AND lower(tenant) = ? ORDER BY day DESC LIMIT 6").bind(u.site, u.brand.toLowerCase())) : [],
      x.can("crm") ? rows(env.DB.prepare("SELECT status, model FROM crm_rows WHERE site = ? AND unit_id = ?").bind(u.site, u.id)) : [],
      x.can("works") ? rows(env.DB.prepare("SELECT type, status, received_at FROM works_forms WHERE site = ? AND deleted = 0 AND unit_id = ? ORDER BY received_at DESC LIMIT 4").bind(u.site, u.id)) : []]);
    const open = pi.filter(i => /^(sent to tenant|created|in review|submitted)/i.test(i.status));
    L.push(`Tenant ${u.brand} · ${x.name(u.site)}: unit ${u.code || "?"} on ${u.level}, ${u.status}${u.area ? ", " + u.area + " m²" : ""}${ce ? `; contract ends ${ce.departure_day || ce.end_day}` : ""}; portal items ${pi.length} (${open.length} open: ${open.slice(0, 6).map(i => `${i.name} ${i.type || i.kind} ${i.status} since ${i.created_day}`).join("; ") || "none"}); feedback/violations recorded ${fb.length}${fb.length ? ` (latest: ${fb.slice(0, 3).map(f => `${f.day} ${f.category} — ${clip(f.description, 60)}`).join("; ")})` : ""}${crm.length ? `; CRM handhelds ${crm.map(c => `${c.model || "?"} ${c.status || ""}`).join(", ")}` : ""}${wf.length ? `; works forms ${wf.map(w => `${w.type} ${w.status}`).join(", ")}` : ""}.`);
  }
  return L.join("\n");
}

/* ---------- 5. put it together: at most MAX characters ---------- */
const MAX = 7000;
export async function routedFacts(env, q, me, d, site) {
  const mine = Object.keys(d.sites || {}).filter(s => d.canSite(me, s));
  const topics = topicsIn(q);
  const sites = sitesIn(q, mine, site);
  const today = d.today(), p = periodIn(q, today);
  const nowLocal = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Beirut" }).replace(" ", "T").slice(0, 16);
  const x = { q, me, d, mine, sites, today, p, nowLocal, full: !!d.full, can: app => d.roleAllows(me, app), name: s => d.siteName(s) };
  const tasks = [tenantSlice(env, x), ...topics.filter(t => S[t]).map(t => S[t](env, x).catch(e => { console.error("aidata " + t, e && e.message); return ""; }))];
  const parts = (await Promise.all(tasks)).filter(Boolean);
  const noApp = topics.filter(t => TOPIC_APPS[t] && !TOPIC_APPS[t].some(a => x.can(a))).map(t => TOPIC_LABEL[t]);
  const noSite = deniedSites(q, mine).map(x.name);
  if (noApp.length || noSite.length) parts.push(`ACCESS: the person asking cannot see ${[noApp.length ? noApp.join(", ") : "", noSite.length ? "the flagship(s) " + noSite.join(", ") : ""].filter(Boolean).join(" or ")} in the hub — say so politely and do not guess those figures.`);
  if (!parts.length) return { text: "", topics, sites, period: p };
  /* share the room fairly: each slice gets an equal part of MAX, unused room goes to the longer ones */
  let room = MAX, out = [];
  const sorted = parts.map((t, i) => ({ t, i })).sort((a, b) => a.t.length - b.t.length);
  sorted.forEach((s, k) => { const share = Math.floor(room / (sorted.length - k)); const t = s.t.length > share ? s.t.slice(0, share - 1) + "…" : s.t; room -= t.length; out[s.i] = t; });
  const head = `Data fetched for this question — flagships: ${sites.map(x.name).join(", ")}; period: ${p.label} (${p.from} to ${p.to}).`;
  return { text: head + "\n" + out.filter(Boolean).join("\n"), topics, sites, period: p };
}
