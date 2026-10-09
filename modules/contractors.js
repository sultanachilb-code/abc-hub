/* =====================================================================
   CONTRACTORS — feature module (kept separate so it can be removed cleanly)
   See docs/FEATURE-contractors.md

   • Register   — every contractor company working at the flagship: trade, contact, insurance (expiry → reminders)
   • On site    — the day's expected contractors, from the Tenant Connect "Handover Report" import (approved requests)
                  or added by hand; the operations team checks them in and out, with the number of workers.
   • History    — who was on site, when, for which tenant.
   Overdue: still checked in 30 minutes after the permit end → one alert to the flagship.
   Tables : contractors · contractor_visits · contractor_checks (one row per visit and day)
   Routes : /api/ops/con/*      Page : /tools/contractors
   ===================================================================== */

const err = (m, status = 400) => Object.assign(new Error(m), { status });
const clip = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
const isDay = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));
const isHM = v => /^\d{2}:\d{2}$/.test(String(v || ""));
const addDays = (d, n) => { const t = new Date(d + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((new Date(b + "T12:00:00Z") - new Date(a + "T12:00:00Z")) / 864e5);
const norm = s => String(s || "").toLowerCase().replace(/\b(s\.?a\.?r\.?l|sal|s\.a\.l|co|company|ltd|llc|est)\b\.?/g, "").replace(/[^a-z0-9؀-ۿ]+/g, " ").trim();
export const TRADES = ["Civil", "Electrical", "Mechanical / HVAC", "Plumbing", "Fire fighting", "Carpentry / joinery", "Painting", "Gypsum / ceiling", "Flooring", "Signage", "IT / low current", "Cleaning", "Pest control", "Shopfitting (general)", "Other"];

export async function contractorsSchema(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS contractors (id INTEGER PRIMARY KEY AUTOINCREMENT, site TEXT NOT NULL, company TEXT NOT NULL, trade TEXT NOT NULL DEFAULT '',
      contact TEXT NOT NULL DEFAULT '', mobile TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', ins_expiry TEXT NOT NULL DEFAULT '', ins_ref TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'Active', created_at TEXT, updated_at TEXT, updated_name TEXT, deleted INTEGER NOT NULL DEFAULT 0)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS contractor_visits (id INTEGER PRIMARY KEY AUTOINCREMENT, site TEXT NOT NULL, contractor_id INTEGER NOT NULL DEFAULT 0,
      company TEXT NOT NULL DEFAULT '', tenant TEXT NOT NULL DEFAULT '', work TEXT NOT NULL DEFAULT '', descr TEXT NOT NULL DEFAULT '', req TEXT NOT NULL DEFAULT '',
      src TEXT NOT NULL DEFAULT 'manual', day_from TEXT NOT NULL, day_to TEXT NOT NULL, time_from TEXT NOT NULL DEFAULT '', time_to TEXT NOT NULL DEFAULT '',
      created_at TEXT, created_name TEXT, deleted INTEGER NOT NULL DEFAULT 0)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS contractor_visits_day ON contractor_visits (site, deleted, day_from, day_to)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS contractor_checks (visit_id INTEGER NOT NULL, day TEXT NOT NULL, site TEXT NOT NULL, workers INTEGER NOT NULL DEFAULT 0,
      in_at TEXT NOT NULL DEFAULT '', in_name TEXT NOT NULL DEFAULT '', out_at TEXT NOT NULL DEFAULT '', out_name TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (visit_id, day))`)
  ]);
}

/* Beirut clock: "HH:MM" now */
const beirutHM = () => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Beirut", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date()).replace(/^24/, "00");
const hmMin = t => { const [a, b] = String(t || "0:0").split(":").map(Number); return a * 60 + (b || 0); };
const insState = (exp, today) => !exp ? "none" : exp < today ? "expired" : daysBetween(today, exp) <= 30 ? "soon" : "ok";

function conOut(r, today) {
  return { id: r.id, company: r.company, trade: r.trade, contact: r.contact, mobile: r.mobile, email: r.email, insExpiry: r.ins_expiry, insRef: r.ins_ref,
    notes: r.notes, status: r.status, ins: insState(r.ins_expiry, today), updatedName: r.updated_name || "", updatedAt: r.updated_at || "" };
}
function visitOut(v, c, day, today, now) {
  const lastDay = v.day_to === day;
  const state = !c || !c.in_at ? "expected" : c.out_at ? "left" : "onsite";
  const overdue = state === "onsite" && day === today && lastDay && v.time_to && hmMin(now) > hmMin(v.time_to) + 30;
  const late = state === "expected" && day === today && v.time_from && hmMin(now) > hmMin(v.time_from) + 60;
  return { id: v.id, contractorId: v.contractor_id, company: v.company, tenant: v.tenant, work: v.work, desc: v.descr, req: v.req, src: v.src,
    from: v.day_from, to: v.day_to, timeFrom: v.time_from, timeTo: v.time_to, state, overdue, late, multi: v.day_from !== v.day_to,
    workers: c ? c.workers : 0, inAt: c ? c.in_at : "", inName: c ? c.in_name : "", outAt: c ? c.out_at : "", outName: c ? c.out_name : "", note: c ? c.note : "" };
}

export async function dayList(env, site, day, today) {   // also read by the Day to Day timeline (modules/today.js)
  const [vs, cs, reg] = await Promise.all([
    env.DB.prepare("SELECT * FROM contractor_visits WHERE site = ? AND deleted = 0 AND day_from <= ? AND day_to >= ? ORDER BY time_from, company").bind(site, day, day).all(),
    env.DB.prepare("SELECT * FROM contractor_checks WHERE site = ? AND day = ?").bind(site, day).all(),
    env.DB.prepare("SELECT id, ins_expiry, status FROM contractors WHERE site = ? AND deleted = 0").bind(site).all()
  ]);
  const C = new Map((cs.results || []).map(c => [c.visit_id, c]));
  const R = new Map((reg.results || []).map(r => [r.id, r]));
  const now = beirutHM();
  return (vs.results || []).map(v => {
    const o = visitOut(v, C.get(v.id), day, today, now);
    const r = R.get(v.contractor_id);
    o.ins = r ? insState(r.ins_expiry, today) : "unknown"; o.blocked = !!(r && r.status === "Blocked");
    return o;
  });
}

/* match (or create) the register entry for a company name */
async function contractorFor(env, site, company, trade, now, name) {
  const n = norm(company);
  if (!n) return 0;
  const { results } = await env.DB.prepare("SELECT id, company FROM contractors WHERE site = ? AND deleted = 0").bind(site).all();
  const hit = (results || []).find(r => norm(r.company) === n);
  if (hit) return hit.id;
  const res = await env.DB.prepare("INSERT INTO contractors (site, company, trade, notes, created_at, updated_at, updated_name) VALUES (?,?,?,?,?,?,?)")
    .bind(site, clip(company, 160), clip(trade, 80), "Added from the Tenant Connect import", now, now, name).run();
  return res.meta.last_row_id;
}

export async function contractorsRun(env, deps) {
  const today = deps.today(), now = beirutHM();
  /* overdue: still on site 30 min after the permit end — switched off (Oct 2026): contractor access is information only, no reminders.
     Set CON_OVERDUE_ALERTS = "1" on the hub to bring the alert back. */
  const { results } = env.CON_OVERDUE_ALERTS !== "1" ? { results: [] } : await env.DB.prepare(`SELECT v.*, c.in_at, c.out_at FROM contractor_visits v JOIN contractor_checks c ON c.visit_id = v.id AND c.day = ?
    WHERE v.deleted = 0 AND v.day_to = ? AND v.time_to != '' AND c.in_at != '' AND c.out_at = ''`).bind(today, today).all().catch(() => ({ results: [] }));
  for (const v of results || []) {
    if (hmMin(now) <= hmMin(v.time_to) + 30) continue;
    const key = `con:over:${v.id}:${today}`;
    const claim = await env.DB.prepare("INSERT OR IGNORE INTO meta (k, v) VALUES (?, ?)").bind(key, deps.now()).run();
    if (!claim.meta || claim.meta.changes !== 1) continue;
    await deps.raiseEvent(env, { site: v.site, app: "contractors", tone: "warn", title: `Contractor still on site · ${v.company || v.tenant}`,
      body: `${v.tenant}${v.work ? " · " + v.work : ""} · permit ended ${v.time_to}${v.req ? " · " + v.req : ""} — check them out or extend.` });
  }
  /* insurance expiry: 30, 7, 0 days */
  const ins = await env.DB.prepare("SELECT id, site, company, ins_expiry FROM contractors WHERE deleted = 0 AND status = 'Active' AND ins_expiry != '' AND ins_expiry >= ? AND ins_expiry <= ?")
    .bind(today, addDays(today, 30)).all().catch(() => ({ results: [] }));
  for (const r of ins.results || []) {
    const left = daysBetween(today, r.ins_expiry);
    if (![30, 7, 0].includes(left)) continue;
    const claim = await env.DB.prepare("INSERT OR IGNORE INTO meta (k, v) VALUES (?, ?)").bind(`con:ins:${r.id}:${r.ins_expiry}:${left}`, deps.now()).run();
    if (!claim.meta || claim.meta.changes !== 1) continue;
    await deps.raiseEvent(env, { site: r.site, app: "contractors", tone: left <= 7 ? "alert" : "warn",
      title: left === 0 ? `Contractor insurance expires today · ${r.company}` : `Contractor insurance expires in ${left} days · ${r.company}`, body: `Expiry ${r.ins_expiry} — ask for the renewed policy.` });
  }
}

export async function contractorsRoute(env, p, method, b, url, d) {
  const { site, me } = d;
  const team = d.canSite(me, site) && (d.full || (me.role === "SUPERVISOR" && me.position !== "WH") || me.role === "SECURITY");
  const editReg = d.canSite(me, site) && (d.full || (me.role === "SUPERVISOR" && me.position !== "WH"));
  const q = k => (url.searchParams.get(k) || "").trim();
  const today = d.today();
  if (!d.canSite(me, site)) throw err("No access to this flagship", 403);

  if (p === "con/day") {
    const day = isDay(q("day")) ? q("day") : today;
    const list = await dayList(env, site, day, today);
    const n = s => list.filter(v => v.state === s).length;
    return { day, today, list, counts: { expected: n("expected"), onsite: n("onsite"), left: n("left"), overdue: list.filter(v => v.overdue).length,
      workers: list.filter(v => v.state === "onsite").reduce((a, v) => a + (v.workers || 0), 0) }, trades: TRADES, can: { check: team, edit: editReg } };
  }
  if (p === "con/register") {
    const [{ results }, vis] = await Promise.all([
      env.DB.prepare("SELECT * FROM contractors WHERE site = ? AND deleted = 0 ORDER BY company").bind(site).all(),
      env.DB.prepare("SELECT contractor_id AS id, COUNT(*) AS n, MAX(day_to) AS last FROM contractor_visits WHERE site = ? AND deleted = 0 GROUP BY contractor_id").bind(site).all()
    ]);
    const V = new Map((vis.results || []).map(v => [v.id, v]));
    return { list: (results || []).map(r => ({ ...conOut(r, today), visits: (V.get(r.id) || {}).n || 0, last: (V.get(r.id) || {}).last || "" })), trades: TRADES, today, can: { check: team, edit: editReg } };
  }
  if (p === "con/history") {
    const from = isDay(q("from")) ? q("from") : addDays(today, -30), to = isDay(q("to")) ? q("to") : today;
    const s = q("q").toLowerCase(), cid = Number(q("contractor")) || 0;
    const { results } = await env.DB.prepare(`SELECT v.*, c.day, c.workers, c.in_at, c.in_name, c.out_at, c.out_name FROM contractor_checks c JOIN contractor_visits v ON v.id = c.visit_id
      WHERE c.site = ? AND c.day >= ? AND c.day <= ? ${cid ? "AND v.contractor_id = ?" : ""} ORDER BY c.day DESC, c.in_at DESC LIMIT 500`).bind(...[site, from, to, ...(cid ? [cid] : [])]).all();
    const rows = (results || []).filter(r => !s || `${r.company} ${r.tenant} ${r.work} ${r.req}`.toLowerCase().includes(s)).map(r => ({ day: r.day, company: r.company, tenant: r.tenant, work: r.work,
      req: r.req, workers: r.workers, inAt: r.in_at, inName: r.in_name, outAt: r.out_at, outName: r.out_name, timeFrom: r.time_from, timeTo: r.time_to }));
    return { from, to, rows };
  }

  if (method !== "POST") throw err("Unknown request", 404);

  if (p === "con/check") {   // check in / out (ops team and security)
    if (!team) throw err("Only the operations team can check contractors in and out", 403);
    const v = await env.DB.prepare("SELECT * FROM contractor_visits WHERE id = ? AND site = ? AND deleted = 0").bind(Number(b.id) || 0, site).first();
    if (!v) throw err("Not found", 404);
    const day = isDay(b.day) ? b.day : today;
    if (day !== today) throw err("Check-in and check-out are for today only");
    if (day < v.day_from || day > v.day_to) throw err("This permit is not valid today");
    const cur = await env.DB.prepare("SELECT * FROM contractor_checks WHERE visit_id = ? AND day = ?").bind(v.id, day).first();
    const now = d.now(), workers = Math.max(0, Math.min(500, Number(b.workers) || 0)), note = clip(b.note, 200);
    if (b.action === "in") {
      if (cur && cur.in_at && !cur.out_at) throw err("Already checked in");
      await env.DB.prepare(`INSERT INTO contractor_checks (visit_id, day, site, workers, in_at, in_name, out_at, out_name, note) VALUES (?,?,?,?,?,?,'','',?)
        ON CONFLICT(visit_id, day) DO UPDATE SET workers = excluded.workers, in_at = excluded.in_at, in_name = excluded.in_name, out_at = '', out_name = '', note = excluded.note`)
        .bind(v.id, day, site, workers, now, me.full_name, note).run();
    } else if (b.action === "out") {
      if (!cur || !cur.in_at) throw err("Check them in first");
      if (cur.out_at) throw err("Already checked out");
      await env.DB.prepare("UPDATE contractor_checks SET out_at = ?, out_name = ?, note = CASE WHEN ? != '' THEN ? ELSE note END WHERE visit_id = ? AND day = ?").bind(now, me.full_name, note, note, v.id, day).run();
    } else if (b.action === "undo") {
      if (!cur) throw err("Nothing to undo");
      if (cur.out_at) await env.DB.prepare("UPDATE contractor_checks SET out_at = '', out_name = '' WHERE visit_id = ? AND day = ?").bind(v.id, day).run();
      else await env.DB.prepare("DELETE FROM contractor_checks WHERE visit_id = ? AND day = ?").bind(v.id, day).run();
    } else throw err("Unknown action");
    const list = await dayList(env, site, day, today);
    return { visit: list.find(x => x.id === v.id) };
  }

  if (!editReg) throw err("Only the operations team can change contractors", 403);

  if (p === "con/import") {   // approved Tenant Connect requests (from the Handover Report Excel)
    const rows = (Array.isArray(b.rows) ? b.rows : []).slice(0, 1500);
    const now = d.now(); let added = 0, updated = 0, skipped = 0;
    const from = addDays(today, -1);
    for (const r of rows) {
      const req = /^REQ-?\d+$/i.test(r.req || "") ? String(r.req).toUpperCase() : "";
      const f = r.from || {}, t = r.to || {};
      if (!req || !isDay(f.day) || !/^approved/i.test(String(r.status || ""))) { skipped++; continue; }
      const dayTo = isDay(t.day) && t.day >= f.day ? t.day : f.day;
      if (dayTo < from) { skipped++; continue; }   // finished requests are not imported
      const company = clip(r.contractor, 160) || clip(r.tenant, 160);
      const cid = await contractorFor(env, site, company, "", now, me.full_name);
      const cur = await env.DB.prepare("SELECT id FROM contractor_visits WHERE site = ? AND req = ?").bind(site, req).first();
      const vals = [cid, company, clip(r.tenant, 160), clip(r.sub, 120), clip(r.desc, 500), f.day, dayTo, isHM(f.time) ? f.time : "", isHM(t.time) ? t.time : ""];
      if (cur) {
        await env.DB.prepare("UPDATE contractor_visits SET contractor_id=?, company=?, tenant=?, work=?, descr=?, day_from=?, day_to=?, time_from=?, time_to=?, deleted=0 WHERE id=?").bind(...vals, cur.id).run();
        updated++;
      } else {
        await env.DB.prepare(`INSERT INTO contractor_visits (contractor_id, company, tenant, work, descr, day_from, day_to, time_from, time_to, site, req, src, created_at, created_name)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,'portal',?,?)`).bind(...vals, site, req, now, me.full_name).run();
        added++;
      }
    }
    return { added, updated, skipped };
  }

  if (p === "con/visit") {   // add / edit / delete a visit by hand
    if (b.remove) {
      await env.DB.prepare("UPDATE contractor_visits SET deleted = 1 WHERE id = ? AND site = ?").bind(Number(b.id) || 0, site).run();
      return { deleted: true };
    }
    const company = clip(b.company, 160), tenant = clip(b.tenant, 160);
    if (!company) throw err("Write the contractor company");
    if (!isDay(b.from)) throw err("Choose the date");
    const to = isDay(b.to) && b.to >= b.from ? b.to : b.from;
    const now = d.now();
    const cid = Number(b.contractorId) || await contractorFor(env, site, company, b.work, now, me.full_name);
    const rq = String(b.req || "").toUpperCase().match(/REQ[-\s]?(\d{3,})/), req = rq ? "REQ-" + rq[1] : "";   // the Tenant Connect request, so the handover line gets the loading area feedback
    const vals = [cid, company, tenant, clip(b.work, 120), clip(b.desc, 500), b.from, to, isHM(b.timeFrom) ? b.timeFrom : "", isHM(b.timeTo) ? b.timeTo : "", req];
    if (b.id) await env.DB.prepare("UPDATE contractor_visits SET contractor_id=?, company=?, tenant=?, work=?, descr=?, day_from=?, day_to=?, time_from=?, time_to=?, req=CASE WHEN ? != '' THEN ? ELSE req END WHERE id=? AND site=?").bind(...vals, req, Number(b.id), site).run();
    else await env.DB.prepare(`INSERT INTO contractor_visits (contractor_id, company, tenant, work, descr, day_from, day_to, time_from, time_to, req, site, src, created_at, created_name)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,'manual',?,?)`).bind(...vals, site, now, me.full_name).run();
    return { saved: true };
  }

  if (p === "con/save") {   // register entry
    const company = clip(b.company, 160);
    if (!company) throw err("Write the company name");
    const r = { company, trade: clip(b.trade, 80), contact: clip(b.contact, 120), mobile: clip(b.mobile, 40), email: clip(b.email, 160).toLowerCase(),
      ins_expiry: isDay(b.insExpiry) ? b.insExpiry : "", ins_ref: clip(b.insRef, 120), notes: clip(b.notes, 1000), status: b.status === "Blocked" ? "Blocked" : "Active" };
    const now = d.now();
    if (b.id) {
      const cur = await env.DB.prepare("SELECT * FROM contractors WHERE id = ? AND site = ? AND deleted = 0").bind(Number(b.id), site).first();
      if (!cur) throw err("Not found", 404);
      await env.DB.prepare("UPDATE contractors SET company=?, trade=?, contact=?, mobile=?, email=?, ins_expiry=?, ins_ref=?, notes=?, status=?, updated_at=?, updated_name=? WHERE id=?")
        .bind(r.company, r.trade, r.contact, r.mobile, r.email, r.ins_expiry, r.ins_ref, r.notes, r.status, now, me.full_name, cur.id).run();
      if (cur.company !== r.company) await env.DB.prepare("UPDATE contractor_visits SET company = ? WHERE contractor_id = ?").bind(r.company, cur.id).run();
      if (d.audit) await d.audit(env, { site, tool: "contractors", ref: cur.id, label: r.company, action: "edit", before: Object.fromEntries(Object.keys(r).map(k => [k, cur[k]])), after: r });
      return { id: cur.id };
    }
    const dup = await env.DB.prepare("SELECT id, company FROM contractors WHERE site = ? AND deleted = 0").bind(site).all();
    if ((dup.results || []).some(x => norm(x.company) === norm(company))) throw err("This company is already in the register");
    const res = await env.DB.prepare("INSERT INTO contractors (site, company, trade, contact, mobile, email, ins_expiry, ins_ref, notes, status, created_at, updated_at, updated_name) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(site, r.company, r.trade, r.contact, r.mobile, r.email, r.ins_expiry, r.ins_ref, r.notes, r.status, now, now, me.full_name).run();
    if (d.audit) await d.audit(env, { site, tool: "contractors", ref: res.meta.last_row_id, label: r.company, action: "add", after: r });
    return { id: res.meta.last_row_id };
  }
  if (p === "con/delete") {
    const cur = await env.DB.prepare("SELECT * FROM contractors WHERE id = ? AND site = ? AND deleted = 0").bind(Number(b.id) || 0, site).first();
    if (!cur) throw err("Not found", 404);
    await env.DB.prepare("UPDATE contractors SET deleted = 1, updated_at = ?, updated_name = ? WHERE id = ?").bind(d.now(), me.full_name, cur.id).run();
    if (d.audit) await d.audit(env, { site, tool: "contractors", ref: cur.id, label: cur.company, action: "delete", before: { company: cur.company, trade: cur.trade } });
    return { deleted: true };
  }
  throw err("Unknown request", 404);
}
