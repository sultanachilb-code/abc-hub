/* =====================================================================
   LEADERSHIP DASHBOARDS — feature module (kept separate so it can be removed cleanly)
   See docs/FEATURE-leadership.md

   One page, three views, each person sees the flagships their account allows:
     Portfolio ......... Property Advisor (all 5 flagships)
     DS Operations ..... Chief Department Store Operations Officer (Dbayeh, Verdun DS, Achrafieh DS)
     Malls ............. Mall Director (Verdun Mall, Achrafieh Mall)
   Tabs: Overview (live status + month to date) · Soft services scorecards · Monthly management pack (PDF)

   Reads: gla_units, gla_events, form_runs, handovers, tenant_feedback, tm_announcements, emergencies, daily_stats,
          budget_lines, and the Restroom / Incident systems through the hub connectors.
   Routes : /api/ops/lead/*
   ===================================================================== */
import { accuracyOf } from "./accuracy.js";
import { complianceFor, fitoutFor } from "./tenants.js";

const err = (m, status = 400) => Object.assign(new Error(m), { status });
export const VIEWS = {
  portfolio: { name: "Portfolio", sub: "Property Advisor · all flagships", sites: ["VRM", "ACM", "DBS", "VRS", "ACS"] },
  ds: { name: "DS Operations", sub: "Dbayeh · Verdun DS · Achrafieh DS", sites: ["DBS", "VRS", "ACS"] },
  malls: { name: "Malls", sub: "Mall Director · Verdun Mall · Achrafieh Mall", sites: ["VRM", "ACM"] }
};
const DEFAULT_VIEW = { ADVISOR: "portfolio", CDSO: "ds", DIRECTOR: "malls", ADMIN: "portfolio" };
const monthBounds = m => { const [y, mo] = m.split("-").map(Number); return [`${m}-01`, new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10)]; };
const daysBetween = (a, b) => Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 864e5) + 1;
const addDays = (d, n) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const pct = (a, b) => b ? Math.round(a / b * 100) : null;

/* soft services: which checklist lines belong to which contractor */
const SERVICES = {
  cleaning: { name: "Cleaning", re: /clean|restroom|toilet|trash|bins?\b|hygien|floor|glass|wash|debris|dust/i },
  security: { name: "Security", re: /secur|guard|cctv|patrol|agent|access|entry point|emergency exit/i },
  parking: { name: "Parking · Liban Park", re: /park|barrier|ticket|valet|vehicle|car\b|drop-off/i }
};

async function monthRuns(env, site, from, to) {
  const { results } = await env.DB.prepare("SELECT form, day, status, items, answers, header FROM form_runs WHERE site = ? AND form IN ('am','pm') AND day BETWEEN ? AND ?").bind(site, from, to).all().catch(() => ({ results: [] }));
  return results || [];
}
function serviceScores(runs) {
  const out = {};
  for (const [k, s] of Object.entries(SERVICES)) out[k] = { name: s.name, pass: 0, fail: 0, findings: {} };
  for (const r of runs) {
    const items = JSON.parse(r.items || "[]"), ans = JSON.parse(r.answers || "{}");
    for (const it of items) {
      const a = ans[it.id]; if (!a || !a.v || a.v === "na") continue;
      const text = `${it.a || ""} ${it.t || ""}`;
      for (const [k, s] of Object.entries(SERVICES)) if (s.re.test(text)) {
        if (a.v === "y") out[k].pass++; else { out[k].fail++; const f = (it.t || it.a || "").slice(0, 120); out[k].findings[f] = (out[k].findings[f] || 0) + 1; }
      }
    }
  }
  for (const v of Object.values(out)) { v.rate = pct(v.pass, v.pass + v.fail); v.findings = Object.entries(v.findings).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t, n]) => ({ t, n })); }
  return out;
}

/* ctx = { me, sitesOf, SITES, siteName, pullDay, today, now, can } */
async function siteOverview(env, site, ctx, month) {
  const today = ctx.today(), [mFrom, mToFull] = monthBounds(month), mTo = mToFull < today ? mToFull : today;
  const q1 = (sql, ...b) => env.DB.prepare(sql).bind(...b).first().catch(() => null);
  const qa = (sql, ...b) => env.DB.prepare(sql).bind(...b).all().then(r => r.results || []).catch(() => []);
  const isCurrent = month === today.slice(0, 7);
  const [units, runsToday, runsMonth, firstRun, hos, emg, fbToday, stats, anns, events, capex, rr, inc, acc, comp] = await Promise.all([
    qa("SELECT status, section, area, brand FROM gla_units WHERE site = ? AND active = 1", site),
    isCurrent ? qa("SELECT form, status, done, total, issues FROM form_runs WHERE site = ? AND day = ? AND form IN ('am','pm')", site, today) : [],
    qa("SELECT form, day FROM form_runs WHERE site = ? AND status = 'submitted' AND form IN ('am','pm') AND day BETWEEN ? AND ?", site, mFrom, mTo),
    q1("SELECT MIN(day) AS d FROM form_runs WHERE site = ? AND form IN ('am','pm')", site),
    isCurrent ? qa("SELECT handoffs, status FROM handovers WHERE site = ? AND day = ?", site, today) : [],
    qa("SELECT id, type, location, created_at FROM emergencies WHERE site = ? AND status = 'active'", site),
    isCurrent ? q1("SELECT COUNT(*) AS n FROM tenant_feedback WHERE site = ? AND day = ?", site, today) : null,
    qa("SELECT day, data FROM daily_stats WHERE site = ? AND day BETWEEN ? AND ? ORDER BY day", site, addDays(mTo, -40), mTo),
    qa("SELECT type, brand, eff_date FROM tm_announcements WHERE site = ? AND eff_date BETWEEN ? AND ?", site, mFrom, mToFull),
    qa("SELECT e.kind, e.before, e.after, e.eff_date, u.brand AS cur FROM gla_events e LEFT JOIN gla_units u ON u.id = e.unit_id WHERE e.site = ? AND e.eff_date BETWEEN ? AND ?", site, mFrom, mToFull),
    qa("SELECT budget, landing FROM budget_lines WHERE site = ? AND kind = 'capex' AND year = ?", site, Number(month.slice(0, 4))),
    isCurrent ? ctx.pullDay(env, "restroom", site, today) : { error: "past" },
    isCurrent ? ctx.pullDay(env, "incidents", site, today) : { error: "past" },
    accuracyOf(env, site, Date.now()).catch(() => null),
    complianceFor(env, site, month).catch(() => null)
  ]);
  /* GLA */
  const leasing = units.filter(u => u.section === "Leasing"), sum = f => leasing.filter(f).reduce((a, u) => a + (u.area || 0), 0);
  const base = sum(() => true), vacant = sum(u => u.status === "Vacant" || u.status === "Terminated");
  const gla = { occupancy: base ? 1 - vacant / base : null, vacantArea: Math.round(vacant), vacantUnits: leasing.filter(u => u.status === "Vacant" || u.status === "Terminated").length,
    active: units.filter(u => u.status === "Open" && u.section !== "DS").length, fitout: units.filter(u => u.status === "Fit-out").length, reserved: units.filter(u => u.status === "Reserved").length };
  /* today */
  const ck = f => { const r = runsToday.find(x => x.form === f); return r ? { status: r.status, done: r.done, total: r.total, issues: r.issues } : null; };
  const offs = hos.flatMap(h => JSON.parse(h.handoffs || "[]"));
  const rrT = rr && !rr.error && rr.totals ? rr.totals : null;
  const todayBlock = isCurrent ? { am: ck("am"), pm: ck("pm"), handoffs: offs.length, received: offs.filter(x => x.receivedBy).length, pending: offs.length && !offs[offs.length - 1].receivedBy,
    restroom: rrT ? { done: rrT.done, missed: rrT.missed, expected: rrT.expectedDay } : null, incidents: inc && !inc.error ? inc.incidents.length : null,
    pirsOverdue: inc && !inc.error ? inc.pirs.filter(p => p.overdue).length : null, feedback: fbToday ? Number(fbToday.n) : 0 } : null;
  /* month to date */
  /* checklists are counted from the first day the flagship used the hub checklists (not before) */
  const ckFrom = firstRun && firstRun.d && firstRun.d > mFrom ? firstRun.d : mFrom;
  const days = firstRun && firstRun.d && firstRun.d <= mTo ? daysBetween(ckFrom, mTo) : 0;
  const amDays = new Set(runsMonth.filter(r => r.form === "am").map(r => r.day)).size, pmDays = new Set(runsMonth.filter(r => r.form === "pm").map(r => r.day)).size;
  const S = stats.map(s => ({ day: s.day, ...JSON.parse(s.data) }));
  const inMonth = S.filter(s => s.day >= mFrom && s.day <= mTo);
  const rrSum = inMonth.reduce((a, s) => { if (s.restroom) { a.done += s.restroom.done; a.exp += s.restroom.expected; } return a; }, { done: 0, exp: 0 });
  if (todayBlock && todayBlock.restroom && !inMonth.some(s => s.day === today)) { rrSum.done += todayBlock.restroom.done; rrSum.exp += todayBlock.restroom.done + todayBlock.restroom.missed; }
  const incMonth = inMonth.reduce((a, s) => a + (s.incidents ? s.incidents.count : 0), 0) + (todayBlock && todayBlock.incidents && !inMonth.some(s => s.day === today) ? todayBlock.incidents : 0);
  let opened = 0, closed = 0;
  for (const e of events) { const b = JSON.parse(e.before || "{}"), a = JSON.parse(e.after || "{}");
    if (e.kind === "add" && a.status === "Open") opened++;
    if (e.kind === "update" && a.status === "Open" && b.status && !["Open", "Closed"].includes(b.status)) opened++;
    if (e.kind === "update" && ["Vacant", "Terminated"].includes(a.status) && ["Open", "Closed"].includes(b.status)) closed++; }
  const cap = capex.reduce((a, c) => ({ budget: a.budget + (c.budget || 0), landing: a.landing + (c.landing || 0) }), { budget: 0, landing: 0 });
  const mtd = { days, checklistsSince: days ? ckFrom : "", checklists: days ? pct(amDays + pmDays, days * 2) : null, amDays, pmDays, restroom: pct(rrSum.done, rrSum.exp), restroomSince: inMonth.length ? inMonth[0].day : (todayBlock ? today : ""),
    incidents: incMonth, opened, closed, announcements: anns.length, compliance: comp ? comp.average : null, repeatOffenders: comp ? comp.repeatOffenders : 0,
    violations: comp ? comp.tenants.reduce((a, t) => a + t.violations, 0) : 0, capex: cap };
  /* 14-day trend */
  const trend = [];
  for (let i = 13; i >= 0; i--) { const d = addDays(mTo, -i), s = S.find(x => x.day === d);
    trend.push({ day: d, restroom: s && s.restroom && s.restroom.expected ? pct(s.restroom.done, s.restroom.expected) : (d === today && todayBlock && todayBlock.restroom ? pct(todayBlock.restroom.done, todayBlock.restroom.done + todayBlock.restroom.missed) : null),
      am: s ? !!(s.am && s.am.status === "submitted") : null, pm: s ? !!(s.pm && s.pm.status === "submitted") : null, incidents: s && s.incidents ? s.incidents.count : null }); }
  /* what needs attention */
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Beirut", hour: "2-digit", hour12: false }).format(new Date())) % 24;
  const attention = [];
  if (emg.length) attention.push({ tone: "alert", text: `${emg.length} emergency alert${emg.length === 1 ? "" : "s"} active — ${emg[0].type} at ${emg[0].location}` });
  if (todayBlock) {
    if (hour >= 12 && !(todayBlock.am && todayBlock.am.status === "submitted")) attention.push({ tone: "warn", text: "AM checklist not submitted" });
    if (hour >= 23 && !(todayBlock.pm && todayBlock.pm.status === "submitted")) attention.push({ tone: "warn", text: "PM checklist not submitted" });
    if (todayBlock.restroom && todayBlock.restroom.missed) attention.push({ tone: "warn", text: `${todayBlock.restroom.missed} restroom check${todayBlock.restroom.missed === 1 ? "" : "s"} missed today` });
    if (todayBlock.pending) attention.push({ tone: "warn", text: "Handover handed over but not received yet" });
    if (todayBlock.pirsOverdue) attention.push({ tone: "alert", text: `${todayBlock.pirsOverdue} post-incident report${todayBlock.pirsOverdue === 1 ? "" : "s"} overdue` });
  }
  if (mtd.repeatOffenders) attention.push({ tone: "warn", text: `${mtd.repeatOffenders} repeat offender${mtd.repeatOffenders === 1 ? "" : "s"} this month` });
  if (acc && acc.score < 60) attention.push({ tone: "warn", text: `Data accuracy ${acc.score}/100 — ${acc.items.filter(i => i.state !== "fresh").map(i => i.name).join(", ")}` });
  const light = attention.some(a => a.tone === "alert") || attention.length >= 3 ? "red" : attention.length ? "amber" : "green";
  return { site, siteName: ctx.siteName(site), light, attention, gla, today: todayBlock, mtd, trend, accuracy: acc ? { score: acc.score, items: acc.items.map(i => ({ name: i.name, state: i.state, at: i.at })) } : null,
    emergencies: emg.map(e => ({ type: e.type, location: e.location, at: e.created_at })) };
}

async function scorecards(env, site, ctx, month) {
  const [from, to] = monthBounds(month), today = ctx.today(), end = to < today ? to : today;
  const [runs, stats, emg] = await Promise.all([
    monthRuns(env, site, from, end),
    env.DB.prepare("SELECT data FROM daily_stats WHERE site = ? AND day BETWEEN ? AND ?").bind(site, from, end).all().then(r => r.results || []).catch(() => []),
    env.DB.prepare(`SELECT e.created_at, MIN(r.ack_at) AS first_ack FROM emergencies e JOIN emergency_recips r ON r.emergency_id = e.id
      WHERE e.site = ? AND substr(e.created_at, 1, 10) BETWEEN ? AND ? AND r.ack_at != '' GROUP BY e.id`).bind(site, from, end).all().then(r => r.results || []).catch(() => [])
  ]);
  const sv = serviceScores(runs);
  const rr = stats.map(s => JSON.parse(s.data)).reduce((a, s) => { if (s.restroom) { a.done += s.restroom.done; a.exp += s.restroom.expected; a.days++; } return a; }, { done: 0, exp: 0, days: 0 });
  const rrRate = pct(rr.done, rr.exp);
  const ackMins = emg.map(e => (Date.parse(e.first_ack) - Date.parse(e.created_at)) / 60000).filter(n => n >= 0);
  const ackAvg = ackMins.length ? Math.round(ackMins.reduce((a, b) => a + b, 0) / ackMins.length * 10) / 10 : null;
  const ackScore = ackAvg === null ? null : ackAvg <= 2 ? 100 : ackAvg <= 5 ? 75 : ackAvg <= 10 ? 50 : 25;
  const mix = parts => { const p = parts.filter(([v]) => v !== null && v !== undefined); if (!p.length) return null; const w = p.reduce((a, [, w]) => a + w, 0); return Math.round(p.reduce((a, [v, w]) => a + v * w, 0) / w); };
  return {
    site, siteName: ctx.siteName(site), month, checklistsUsed: runs.length,
    cleaning: { score: mix([[rrRate, 60], [sv.cleaning.rate, 40]]), restroom: rrRate, restroomDays: rr.days, checklist: sv.cleaning.rate, checked: sv.cleaning.pass + sv.cleaning.fail, findings: sv.cleaning.findings },
    security: { score: mix([[sv.security.rate, 70], [ackScore, 30]]), checklist: sv.security.rate, checked: sv.security.pass + sv.security.fail, findings: sv.security.findings,
      emergencies: emg.length, ackAvg },
    parking: { score: mix([[sv.parking.rate, 100]]), checklist: sv.parking.rate, checked: sv.parking.pass + sv.parking.fail, findings: sv.parking.findings }
  };
}

export async function leadershipRoute(env, p, method, b, url, ctx) {
  const q = k => url.searchParams.get(k);
  const mine = ctx.sitesOf(ctx.me);
  const allowed = Object.entries(VIEWS).filter(([, v]) => v.sites.some(s => mine.includes(s))).map(([k]) => k);
  const isLead = ["ADMIN", "ADVISOR", "DIRECTOR", "CDSO"].includes(ctx.me.role);
  if (!isLead) throw err("The leadership dashboards are for the Property Advisor, Mall Directors, the Chief Department Store Operations Officer and administrators", 403);
  const want = q("view"), def = DEFAULT_VIEW[ctx.me.role] || "portfolio";
  const view = allowed.includes(want) ? want : allowed.includes(def) ? def : allowed[0];
  if (!view) throw err("Your account has no flagship. Ask the administrator to tick your flagships.", 403);
  const sites = VIEWS[view].sites.filter(s => mine.includes(s));
  const month = /^\d{4}-\d{2}$/.test(q("month") || "") ? q("month") : ctx.today().slice(0, 7);
  const head = { view, views: allowed.map(k => ({ key: k, name: VIEWS[k].name, sub: VIEWS[k].sub })), month, today: ctx.today(), sites: sites.map(s => ({ code: s, name: ctx.siteName(s) })), generatedAt: new Date().toISOString() };

  if (p === "lead/overview") return { ...head, flagships: await Promise.all(sites.map(s => siteOverview(env, s, ctx, month))) };
  if (p === "lead/scorecards") return { ...head, flagships: await Promise.all(sites.map(s => scorecards(env, s, ctx, month))) };
  if (p === "lead/pack") {
    const rows = await Promise.all(sites.map(async s => {
      const [ov, sc, comp, fit, anns] = await Promise.all([siteOverview(env, s, ctx, month), scorecards(env, s, ctx, month), complianceFor(env, s, month).catch(() => null), fitoutFor(env, s).catch(() => []),
        env.DB.prepare("SELECT type, brand, unit, level, eff_date FROM tm_announcements WHERE site = ? AND eff_date BETWEEN ? AND ? ORDER BY eff_date").bind(s, ...monthBounds(month)).all().then(r => r.results || []).catch(() => [])]);
      return { ...ov, scores: sc, offenders: comp ? comp.tenants.filter(t => t.violations).slice(0, 6).map(t => ({ tenant: t.tenant, score: t.score, violations: t.violations, repeats: t.repeats })) : [],
        fitout: fit.filter(f => f.status !== "Open").map(f => ({ brand: f.brand, unit: `${f.level} ${f.code}`, done: f.done, total: f.total, target: f.target })), announcements: anns };
    }));
    return { ...head, flagships: rows };
  }
  throw err("Unknown endpoint", 404);
}
