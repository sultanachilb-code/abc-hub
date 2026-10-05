/* =====================================================================
   MONTHLY OPERATIONS PACK — per flagship (kept separate so it can be removed cleanly)
   See docs/FEATURE-ops-pack.md

   One A4 page per flagship and month, view and print only (no email):
   occupancy, checklists, restrooms, incidents, tenant feedback, compliance, soft-services scores,
   handovers, MOM actions, Tenant Works Forms, contractors, projects, calendar, evacuation plan —
   each with last month next to it.
   Reads the Leadership dashboards' numbers (modules/leadership.js) plus the newer tools.
   Routes : /api/ops/pack?site=&month=      Page : /tools/pack
   ===================================================================== */
import { siteOverview, scorecards } from "./leadership.js";

const monthBounds = m => { const [y, mo] = m.split("-").map(Number); return [`${m}-01`, new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10)]; };
const prevMonth = m => { const t = new Date(m + "-01T12:00:00Z"); t.setUTCMonth(t.getUTCMonth() - 1); return t.toISOString().slice(0, 7); };

async function extras(env, site, month, today) {
  const [from, to0] = monthBounds(month), to = to0 < today ? to0 : today;
  const n = (sql, ...b) => env.DB.prepare(sql).bind(...b).first().then(r => (r && Number(r.n)) || 0).catch(() => 0);
  const [fb, hoSub, hoAll, momMeet, momOpen, momDone, wkIn, wkDone, conVisits, conWorkers, conCompanies, projDone, projActive, projLate, calMkt, calOps, emg] = await Promise.all([
    n("SELECT COUNT(*) n FROM tenant_feedback WHERE site = ? AND day BETWEEN ? AND ?", site, from, to),
    n("SELECT COUNT(*) n FROM handovers WHERE site = ? AND day BETWEEN ? AND ? AND status = 'submitted'", site, from, to),
    n("SELECT COUNT(DISTINCT day) n FROM handovers WHERE site = ? AND day BETWEEN ? AND ?", site, from, to),
    n("SELECT COUNT(*) n FROM mom_meetings WHERE site = ? AND meet_date BETWEEN ? AND ?", site, from, to),
    n("SELECT COUNT(*) n FROM mom_actions WHERE site = ? AND status = 'Open' AND due != '' AND due <= ?", site, to),
    n("SELECT COUNT(*) n FROM mom_actions a JOIN mom_meetings m ON m.id = a.meeting_id WHERE a.site = ? AND a.status != 'Open' AND m.meet_date BETWEEN ? AND ?", site, from, to),
    n("SELECT COUNT(*) n FROM works_forms WHERE site = ? AND deleted = 0 AND substr(received_at, 1, 10) BETWEEN ? AND ?", site, from, to),
    n("SELECT COUNT(*) n FROM works_forms WHERE site = ? AND deleted = 0 AND substr(completed_at, 1, 10) BETWEEN ? AND ?", site, from, to),
    n("SELECT COUNT(*) n FROM contractor_checks WHERE site = ? AND day BETWEEN ? AND ? AND in_at != ''", site, from, to),
    n("SELECT COALESCE(SUM(workers), 0) n FROM contractor_checks WHERE site = ? AND day BETWEEN ? AND ? AND in_at != ''", site, from, to),
    n("SELECT COUNT(DISTINCT v.contractor_id) n FROM contractor_checks c JOIN contractor_visits v ON v.id = c.visit_id WHERE c.site = ? AND c.day BETWEEN ? AND ? AND c.in_at != ''", site, from, to),
    n("SELECT COUNT(*) n FROM projects WHERE site = ? AND deleted = 0 AND done_day BETWEEN ? AND ?", site, from, to),
    n("SELECT COUNT(*) n FROM projects WHERE site = ? AND deleted = 0 AND stage IN ('In progress','On hold')", site),
    n("SELECT COUNT(*) n FROM projects WHERE site = ? AND deleted = 0 AND stage IN ('In progress','On hold','Approved') AND due_day != '' AND due_day < ?", site, today),
    n("SELECT COUNT(*) n FROM cal_items WHERE site = ? AND deleted = 0 AND kind = 'marketing' AND start_day <= ? AND end_day >= ?", site, to0, from),
    n("SELECT COUNT(*) n FROM cal_items WHERE site = ? AND deleted = 0 AND kind = 'ops' AND start_day <= ? AND end_day >= ?", site, to0, from),
    n("SELECT COUNT(*) n FROM emergencies WHERE site = ? AND substr(created_at, 1, 10) BETWEEN ? AND ?", site, from, to)
  ]);
  return { feedback: fb, handovers: { submitted: hoSub, days: hoAll }, mom: { meetings: momMeet, overdue: momOpen, closed: momDone }, works: { received: wkIn, completed: wkDone },
    contractors: { visits: conVisits, workerDays: conWorkers, companies: conCompanies }, projects: { completed: projDone, active: projActive, late: projLate },
    calendar: { marketing: calMkt, ops: calOps }, emergencies: emg };
}
async function evacState(env, site) {
  const n = (sql, ...b) => env.DB.prepare(sql).bind(...b).first().then(r => (r && Number(r.n)) || 0).catch(() => 0);
  const [tenants, done] = await Promise.all([
    n("SELECT COUNT(*) n FROM gla_units WHERE site = ? AND active = 1 AND brand != '' AND status IN ('Open','Fit-out','Active','FIT OUT')", site),
    n(`SELECT COUNT(*) n FROM evac_assign a JOIN gla_units u ON u.id = a.unit_id WHERE a.site = ? AND u.active = 1 AND u.status IN ('Open','Fit-out','Active','FIT OUT') AND a.corridor_id > 0 AND a.assembly_id > 0`, site)
  ]);
  return { tenants, done, pct: tenants ? Math.round(done / tenants * 100) : null };
}

export async function packRoute(env, p, method, b, url, d) {
  const site = d.site;
  if (!d.canSite(d.me, site)) throw Object.assign(new Error("No access to this flagship"), { status: 403 });
  const today = d.today();
  const q = url.searchParams.get("month");
  const month = /^\d{4}-\d{2}$/.test(q || "") && q <= today.slice(0, 7) ? q : today.slice(0, 7);
  const prev = prevMonth(month);
  const ctx = { me: d.me, siteName: d.siteName, pullDay: d.pullDay, today: d.today };
  const [ov, ovP, sc, scP, ex, exP, evac] = await Promise.all([
    siteOverview(env, site, ctx, month), siteOverview(env, site, ctx, prev), scorecards(env, site, ctx, month), scorecards(env, site, ctx, prev),
    extras(env, site, month, today), extras(env, site, prev, today), evacState(env, site)
  ]);
  const strip = o => ({ gla: o.gla, mtd: o.mtd, light: o.light, attention: o.attention });
  return { site, siteName: d.siteName(site), month, prev, today, partial: month === today.slice(0, 7), generatedAt: d.now(), by: d.me.full_name,
    now: { ...strip(ov), scores: sc, ...ex }, before: { ...strip(ovP), scores: scP, ...exP }, evac, trend: ov.trend };
}
