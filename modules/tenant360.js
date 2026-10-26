/* =====================================================================
   TENANT 360 — one page per unit: everything the hub knows about the tenant in it.
   GLA unit · contract end · portal breaches / violations / requests · tenant feedback & compliance ·
   fit-out · works forms · announcements · contacts · contractors & loading gate · evacuation.
   Nothing is stored here: it reads the other features' tables for the flagship.
   Links by unit where the source keeps the unit (works, fit-out, contacts, announcements, evacuation),
   otherwise by the tenant / brand name. See docs/FEATURE-tenant-360.md
   Routes: /api/ops/t360/list?site= · /api/ops/t360/unit?site=&id=
   ===================================================================== */
import { complianceFor, MILESTONES } from "./tenants.js";
import { isFollowUp, cleanStatus, linkOf } from "./portal.js";

const err = (m, status = 400) => Object.assign(new Error(m), { status });
/* "ZARA s.a.l." → "zara" — company suffixes and punctuation do not count when matching names */
const STOP = /\b(s\s?a\s?r?\s?l|sarl|sal|co|company|ltd|llc|group|the|holding|international|intl|lebanon|leb)\b/g;
const key = s => String(s || "").toLowerCase().replace(/[^a-z0-9؀-ۿ ]+/g, " ").replace(STOP, " ").replace(/\s+/g, "");
const same = (brand, text) => {
  const b = key(brand), t = key(text);
  if (b.length < 3 || !t) return false;
  return t === b || t.includes(b) || (t.length >= 4 && b.includes(t));
};
const rows = async q => { try { return (await q.all()).results || []; } catch { return []; } };   // a feature not used yet at this flagship has no table
const one = async q => { try { return await q.first(); } catch { return null; } };
/* the Tenant List's parent-group key (modules/tlist.js) */
const gkey = s => String(s || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9؀-ۿ ]+/g, " ").replace(/\b(s\s?a\s?r?\s?l|sarl|sal|co|company|ltd|llc|the|holding|international|intl|lebanon|leb)\b/g, " ").replace(/\s+/g, "");
const dayAgo = (today, n) => new Date(Date.parse(today + "T00:00:00Z") - n * 864e5).toISOString().slice(0, 10);
const daysTo = (today, d) => d ? Math.round((Date.parse(d + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 864e5) : null;
const PKIND = { bp: "Breach & Penalty", vr: "Violation", nr: "ABC Request", mk: "Marketing Request", cp: "Contractor Permit" };

async function siteData(env, site, today) {
  const DB = env.DB, since = dayAgo(today, 365);
  const [units, contracts, portal, feedback, fit, works, contacts, anns] = await Promise.all([
    rows(DB.prepare("SELECT * FROM gla_units WHERE site = ? AND active = 1 ORDER BY level, seq, code").bind(site)),
    rows(DB.prepare("SELECT * FROM contracts_ending WHERE site = ?").bind(site)),
    rows(DB.prepare("SELECT * FROM portal_items WHERE site = ? AND active = 1").bind(site)),
    rows(DB.prepare("SELECT * FROM tenant_feedback WHERE site = ? AND day >= ? ORDER BY day DESC, time DESC").bind(site, since)),
    rows(DB.prepare("SELECT * FROM fitout_tracks WHERE site = ?").bind(site)),
    rows(DB.prepare("SELECT id, type, unit_id, tenant, unit, status, subject, received_at, completed_at FROM works_forms WHERE site = ? AND deleted = 0 ORDER BY received_at DESC").bind(site)),
    rows(DB.prepare("SELECT * FROM dir_contacts WHERE site = ?").bind(site)),
    rows(DB.prepare("SELECT id, type, brand, unit_id, unit, eff_date, subject, created_name, created_at FROM tm_announcements WHERE site = ? ORDER BY eff_date DESC").bind(site))
  ]);
  return { units, contracts, portal, feedback, fit, works, contacts, anns };
}

/* everything that belongs to one unit */
function forUnit(u, D, today) {
  const brand = u.brand || "";
  const byName = x => brand && same(brand, x);
  const contracts = D.contracts.filter(c => byName(c.tenant) || byName(c.account));
  const portal = D.portal.filter(x => byName(x.tenant) || byName(x.account));
  const feedback = D.feedback.filter(f => byName(f.tenant));
  const works = D.works.filter(w => w.unit_id === u.id || (!w.unit_id && byName(w.tenant)));
  const contacts = D.contacts.filter(c => c.unit_id === u.id || (!c.unit_id && byName(c.tenant)));
  const anns = D.anns.filter(a => a.unit_id === u.id || (!a.unit_id && byName(a.brand)));
  const fit = D.fit.find(f => f.unit_id === u.id) || null;
  return { contracts, portal, feedback, works, contacts, anns, fit };
}
const prevMonthOf = m => { let [y, mo] = m.split("-").map(Number); mo--; if (!mo) { mo = 12; y--; } return `${y}-${String(mo).padStart(2, "0")}`; };
/* every unit of the flagship with its flags (the Tenants list and the dashboard) */
function listOf(D, T) {
  const since90 = dayAgo(T, 90); D.contractOf = new Map();
  return D.units.map(u => {
    const R = forUnit(u, D, T), c = contractEnd(R.contracts);
    const follow = R.portal.filter(x => isFollowUp(cleanStatus(x.status))).length;
    const viol = R.feedback.filter(f => f.day >= since90 && f.category !== "Customer Feedback").length;
    const end = c ? (c.departure_day || c.end_day) : "";
    const flags = [];
    if (follow) flags.push({ t: `${follow} portal follow-up${follow === 1 ? "" : "s"}`, tone: "al" });
    if (viol) flags.push({ t: `${viol} violation${viol === 1 ? "" : "s"} · 90 days`, tone: viol >= 3 ? "al" : "warn" });
    const dt = daysTo(T, end);
    if (end) D.contractOf.set(u.id, { end, days: dt, no: c.contract_no });
    if (end && dt != null && dt <= 120) flags.push({ t: dt < 0 ? `Contract ended ${end}` : `Contract ends in ${dt} d`, tone: dt <= 30 ? "al" : "warn" });
    if (R.fit) { const ms = JSON.parse(R.fit.ms || "{}"); const n = MILESTONES.filter(([k]) => ms[k] && ms[k].done).length; if (n < MILESTONES.length && u.status !== "Open") flags.push({ t: `Fit-out ${n}/${MILESTONES.length}`, tone: "info" }); }
    return { id: u.id, code: u.code, level: u.level, brand: u.brand, status: u.status, section: u.section, dept: u.dept, area: u.area, flags,
      attention: follow * 3 + viol * 2 + (dt != null && dt <= 30 ? 3 : 0) };
  });
}
const contractEnd = L => {
  const act = L.filter(c => c.active).sort((a, b) => String(a.end_day).localeCompare(String(b.end_day)));
  return act[0] || L.sort((a, b) => String(b.last_seen).localeCompare(String(a.last_seen)))[0] || null;
};

export async function t360Route(env, p, method, b, url, d) {
  const { site, siteName, today } = d;
  if (!site || site === "ALL") throw err("Choose a flagship");

  if (p === "t360/list") {
    const T = today(), D = await siteData(env, site, T);
    return { site, siteName: siteName(site), today: T, units: listOf(D, T) };
  }

  /* the Tenant 360 dashboard (Oct 2026): one call for the Overview tab */
  if (p === "t360/overview") {
    const T = today(), D = await siteData(env, site, T), L = listOf(D, T), month = T.slice(0, 7);
    const [C, CP, G] = await Promise.all([complianceFor(env, site, month).catch(() => null), complianceFor(env, site, prevMonthOf(month)).catch(() => null),
      rows(env.DB.prepare("SELECT bkey, grp FROM tl_groups"))]);
    const GM = new Map(G.map(g => [g.bkey, g.grp]));
    const scoreOf = brand => { if (!C || !brand || /vacant/i.test(brand)) return null; return C.tenants.find(x => same(brand, x.tenant)) || { score: 100, prevScore: 100, repeats: [] }; };   // nothing recorded = 100
    const leasing = L.filter(u => u.section !== "DS" && u.brand && !/vacant/i.test(u.brand));
    const open = leasing.filter(u => /^open/i.test(u.status || "")).length;
    const vacant = L.filter(u => !u.brand || /vacant/i.test(u.brand) || /vacant/i.test(u.status || "")).length;
    const fit = L.filter(u => u.flags.some(f => /^Fit-out/.test(f.t))).length;
    const att = L.map(u => { const c = scoreOf(u.brand), flags = u.flags.slice(); let a = u.attention;
        if (c) { if (c.score < 60) { a += 3; flags.unshift({ t: `Compliance ${c.score}`, tone: "al" }); } else if (c.prevScore - c.score >= 15) { a += 2; flags.unshift({ t: `Score drop −${c.prevScore - c.score}`, tone: "warn" }); }
          if (c.repeats.some(r => r.n >= 3)) { a += 3; flags.unshift({ t: "Repeat offender", tone: "al" }); } }
        return { ...u, flags, attention: a, score: c ? c.score : null }; })
      .filter(u => u.attention > 0 || u.flags.length).sort((x, y) => y.attention - x.attention);
    /* compliance bands (tenants with nothing this month score 100) */
    const bands = [0, 0, 0, 0], issues = {};
    if (C) { for (const t of C.tenants) { bands[t.score < 60 ? 0 : t.score < 75 ? 1 : t.score < 90 ? 2 : 3]++;
        for (const e of t.entries) if (e.category !== "Customer Feedback") { const k = e.description || e.category; issues[k] = (issues[k] || 0) + 1; } }
      bands[3] += Math.max(0, C.activeTenants - C.tenants.length); }
    const ending = L.map(u => ({ id: u.id, code: u.code, brand: u.brand, ...(D.contractOf.get(u.id) || {}) })).filter(x => x.end && x.days != null && x.days <= 120)
      .sort((a, b) => a.days - b.days);
    return { site, siteName: siteName(site), today: T, month, canSales: !!d.canSales,
      kpi: { open, vacant, fit, attention: att.filter(u => u.attention > 0).length, compliance: C ? C.average : null, compliancePrev: CP ? CP.average : null,
        repeat: C ? C.repeatOffenders : 0, ending: ending.length, ending30: ending.filter(x => x.days <= 30).length },
      attention: att.slice(0, 40).map(u => ({ ...u, group: GM.get(gkey(u.brand)) || "" })), bands, issues: Object.entries(issues).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([what, n]) => ({ what, n })),
      ending: ending.slice(0, 12), units: L.map(u => ({ id: u.id, code: u.code, level: u.level, brand: u.brand, dept: u.dept, area: u.area, status: u.status, section: u.section, flags: u.flags,
        attention: (att.find(x => x.id === u.id) || {}).attention || 0, score: (scoreOf(u.brand) || {}).score ?? null, group: GM.get(gkey(u.brand)) || "" })) };
  }
  if (p === "t360/unit") {
    const id = Number(url.searchParams.get("id")) || 0;
    const T = today(), D = await siteData(env, site, T);
    const u = D.units.find(x => x.id === id) || await one(env.DB.prepare("SELECT * FROM gla_units WHERE id = ? AND site = ?").bind(id, site));
    if (!u) throw err("Unit not found", 404);
    const R = forUnit(u, D, T), DB = env.DB, brand = u.brand || "";
    const since30 = dayAgo(T, 30);
    /* compliance this month (the same score as the Tenant Compliance page) */
    let comp = null;
    try { const C = await complianceFor(env, site, T.slice(0, 7)); comp = brand ? (C.tenants.find(t => same(brand, t.tenant)) || { score: 100, violations: 0, repeats: [], clean: true }) : null; } catch {}
    /* contractors & loading gate — last 30 days and what is booked ahead */
    const [visits, scans, history, evac] = await Promise.all([
      rows(DB.prepare("SELECT id, company, tenant, work, req, day_from, day_to, time_from, time_to FROM contractor_visits WHERE site = ? AND deleted = 0 AND day_to >= ? ORDER BY day_from DESC LIMIT 400").bind(site, since30)),
      rows(DB.prepare("SELECT day, at, decision, reason, req, tenant, contractor, workers FROM gate_scans WHERE site = ? AND day >= ? ORDER BY id DESC LIMIT 400").bind(site, since30)),
      rows(DB.prepare("SELECT kind, eff_date, before, after, note, by_name FROM gla_events WHERE site = ? AND unit_id = ? ORDER BY eff_date DESC, id DESC LIMIT 12").bind(site, u.id)),
      one(DB.prepare(`SELECT a.note, c.name AS corridor, s.name AS assembly FROM evac_assign a LEFT JOIN evac_routes c ON c.id = a.corridor_id
        LEFT JOIN evac_routes s ON s.id = a.assembly_id WHERE a.site = ? AND a.unit_id = ?`).bind(site, u.id))
    ]);
    const mine = x => brand && same(brand, x);
    /* Tenant 360 v2: compliance trend (6 months), SKU / handheld (CRM sheet), parent group (Tenant List), PM and marketing */
    const months = []; { let m = T.slice(0, 7); for (let i = 0; i < 6; i++) { months.unshift(m); m = prevMonthOf(m); } }
    const trend = brand ? await Promise.all(months.map(async m => { try { const C = await complianceFor(env, site, m); const t = C.tenants.find(x => same(brand, x.tenant)); return { month: m, score: t ? t.score : 100 }; } catch { return { month: m, score: null }; } })) : [];
    const [crm, grp, pm, mk] = await Promise.all([
      rows(DB.prepare("SELECT sku, serial, model, connection, status, crm, sheet_name, unit_id FROM crm_rows WHERE site = ? AND cont = 0").bind(site)),
      rows(DB.prepare("SELECT bkey, grp FROM tl_groups")),
      rows(DB.prepare(`SELECT r.id, r.brand, r.completed_at, r.deadline, c.month, (SELECT COUNT(*) FROM pm_certs x WHERE x.record_id = r.id) AS n,
        (SELECT COUNT(*) FROM pm_certs x WHERE x.record_id = r.id AND x.status = 'approved') AS ok,
        (SELECT group_concat(x.cert || ':' || x.status, '|') FROM pm_certs x WHERE x.record_id = r.id) AS certs
        FROM pm_records r JOIN pm_cycles c ON c.id = r.cycle_id WHERE r.site = ? ORDER BY c.month DESC LIMIT 400`).bind(site)),
      rows(DB.prepare(`SELECT t.brand, t.answer, t.offer, t.reason, t.answered_at, m.title, m.start_day, m.end_day, m.act_from, m.act_to
        FROM mk_targets t JOIN mk_campaigns m ON m.id = t.campaign_id WHERE t.site = ? ORDER BY m.id DESC LIMIT 600`).bind(site))]);
    const crmMine = crm.filter(r => r.unit_id === u.id || (!r.unit_id && mine(r.sheet_name)));
    const gk = gkey(brand);
    const group = (grp.find(g => g.bkey === gk) || {}).grp || "";
    const pmMine = pm.filter(r => mine(r.brand)).slice(0, 3).map(r => ({ month: r.month, done: !!r.completed_at, n: r.n, ok: r.ok, deadline: r.deadline,
      certs: String(r.certs || "").split("|").filter(Boolean).map(x => { const i = x.lastIndexOf(":"); return { cert: x.slice(0, i), status: x.slice(i + 1) }; }) }));
    const mkMine = mk.filter(r => mine(r.brand)).slice(0, 3).map(r => ({ title: r.title, answer: r.answer, offer: r.offer, reason: r.reason, at: r.answered_at, from: r.act_from || r.start_day, to: r.act_to || r.end_day }));
    const fitMs = R.fit ? JSON.parse(R.fit.ms || "{}") : null;
    const c = contractEnd(R.contracts);
    return {
      site, siteName: siteName(site), today: T,
      unit: { id: u.id, code: u.code, level: u.level, brand, status: u.status, section: u.section, dept: u.dept, area: u.area, contractStart: u.contract_start || "" },
      contract: c ? { no: c.contract_no, status: c.status, type: c.rtype, start: c.start_day, end: c.end_day, departure: c.departure_day, note: c.note,
        active: !!c.active, daysLeft: daysTo(T, c.departure_day || c.end_day) } : null,
      portal: R.portal.map(x => ({ name: x.name, kind: x.kind, kindLabel: PKIND[x.kind] || x.kind, status: cleanStatus(x.status), type: x.type, day: x.created_day,
        subject: x.subject, desc: String(x.description || "").slice(0, 300), link: linkOf(env, x), followUp: isFollowUp(cleanStatus(x.status)) }))
        .sort((a, b) => (b.followUp - a.followUp) || String(b.day).localeCompare(String(a.day))),
      compliance: comp ? { score: comp.score, violations: comp.violations || 0, repeats: comp.repeats || [] } : null,
      feedback: R.feedback.slice(0, 40).map(f => ({ day: f.day, time: f.time, category: f.category, description: f.description, action: f.action, actionDesc: f.action_desc, by: f.created_name })),
      fitout: fitMs ? { target: R.fit.target, milestones: MILESTONES.map(([k, label]) => ({ k, label, done: !!(fitMs[k] && fitMs[k].done), date: fitMs[k] && fitMs[k].date || "" })) } : null,
      works: R.works.slice(0, 20).map(w => ({ id: w.id, type: w.type, status: w.status, subject: w.subject, received: w.received_at, completed: w.completed_at })),
      announcements: R.anns.slice(0, 10).map(a => ({ id: a.id, type: a.type, date: a.eff_date, subject: a.subject, by: a.created_name })),
      contacts: R.contacts.map(x => ({ name: x.employee, position: x.position, mobile: x.mobile, email: x.email, landline: x.landline, category: x.category })),
      contractors: visits.filter(v => mine(v.tenant)).slice(0, 20).map(v => ({ company: v.company, work: v.work, req: v.req, from: v.day_from, to: v.day_to, time: [v.time_from, v.time_to].filter(Boolean).join("–") })),
      gate: scans.filter(s => mine(s.tenant)).slice(0, 20).map(s => ({ day: s.day, at: s.at, decision: s.decision, reason: s.reason, req: s.req, contractor: s.contractor, workers: s.workers })),
      history: history.map(h => ({ kind: h.kind, date: h.eff_date, note: h.note, by: h.by_name, before: safe(h.before), after: safe(h.after) })),
      trend, group, sku: [...new Set(crmMine.map(r => r.sku).filter(Boolean))].join(", "),
      handhelds: crmMine.filter(r => r.serial || r.model).map(r => ({ serial: r.serial, model: r.model, connection: r.connection, status: r.status, crm: r.crm })),
      pm: pmMine, marketing: mkMine, canSales: !!d.canSales,
      evacuation: evac && (evac.corridor || evac.assembly) ? { corridor: evac.corridor || "", assembly: evac.assembly || "", note: evac.note || "" } : null
    };
  }
  throw err("Unknown request", 404);
}
const safe = s => { try { return JSON.parse(s || "{}"); } catch { return {}; } };
