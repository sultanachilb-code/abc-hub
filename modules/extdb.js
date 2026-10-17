/* =====================================================================
   ABCON · the other ABC databases (Oct 2026) — READ-ONLY (only SELECT here; nothing is ever written)
   D1 bindings on the hub Worker (wrangler.jsonc):
     SNAG_DB  → abc-snaglist      (Snaglist Manager)
     INC_DB   → abc-incidents     (Incident Report System)
     RR_DB    → abc-restroom-db   (Restroom Inspection)
     AUDIT_DB → abc-audit-db      (ABC Audit / Quality Control)
   Each system gives ABCON a few summary lines for one flagship — only to people who can open that system in the hub
   (same tile list as the home page); the audit only to management and leadership. No visitor names or contact details.
   Not connected on purpose: abc-dashboard-users (logins only) and the wedding-venue database (not ABC).
   ===================================================================== */
const rows = async q => { try { return (await q.all()).results || []; } catch (e) { console.error("extdb", e && e.message); return []; } };
const one = async q => { try { return await q.first(); } catch { return null; } };
const clip = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
const dayAdd = (day, n) => new Date(Date.parse(day + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
/* each system writes the flagship its own way */
const INC = { VRM: "Verdun Mall", ACM: "Achrafieh Mall", DBS: "Dbayeh Mall", VRS: "Verdun DS", ACS: "Achrafieh DS" };
const RR = { VRM: "verdun_mall", ACM: "achrafieh_mall", DBS: "dbayeh", VRS: "verdun_ds", ACS: "achrafieh_ds" };
const AUD = { VRM: "VM", ACM: "AM", DBS: "DDS", ACS: "ADS", VRS: "VDS" };

async function snaglist(db, site, day) {
  const L = [];
  const open = await rows(db.prepare(`SELECT l.type, COUNT(*) AS n FROM items i JOIN lists l ON l.list_id = i.list_id
    WHERE i.site = ? AND i.deleted = 0 AND l.deleted = 0 AND COALESCE(i.item_status,'') <> 'Solved' GROUP BY l.type ORDER BY n DESC`).bind(site));
  if (open.length) L.push(`Snaglist · open snags by list type: ${open.map(r => `${r.type} ${r.n}`).join("; ")}.`);
  const old = await rows(db.prepare(`SELECT i.location, i.issue, i.item_status, i.created_at, l.list_name FROM items i JOIN lists l ON l.list_id = i.list_id
    WHERE i.site = ? AND i.deleted = 0 AND l.deleted = 0 AND COALESCE(i.item_status,'') <> 'Solved' ORDER BY i.created_at LIMIT 8`).bind(site));
  if (old.length) L.push(`Snaglist · oldest open snags: ${old.map(r => `${clip(r.location, 40) || "?"} — ${clip(r.issue, 70)} [${r.item_status || "Pending"}, since ${String(r.created_at).slice(0, 10)}, list "${clip(r.list_name, 40)}"]`).join("; ")}.`);
  const solved = await one(db.prepare(`SELECT COUNT(*) AS n FROM items WHERE site = ? AND deleted = 0 AND item_status = 'Solved' AND updated_at >= ?`).bind(site, dayAdd(day, -7)));
  if (solved && solved.n) L.push(`Snaglist · solved in the last 7 days: ${solved.n}.`);
  const rep = await rows(db.prepare(`SELECT location, COUNT(*) AS n FROM items WHERE site = ? AND deleted = 0 AND created_at >= ? AND location <> '' GROUP BY lower(location) HAVING n >= 3 ORDER BY n DESC LIMIT 6`).bind(site, dayAdd(day, -30)));
  if (rep.length) L.push(`Snaglist · places with repeated snags, last 30 days: ${rep.map(r => `${clip(r.location, 40)} ×${r.n}`).join("; ")}.`);
  return L;
}
async function incidents(db, site, day) {
  const f = INC[site]; if (!f) return [];
  const L = [], since = dayAdd(day, -30);
  const by = await rows(db.prepare(`SELECT type, severity, COUNT(*) AS n FROM incidents WHERE flagship = ? AND incident_date >= ? GROUP BY type, severity ORDER BY n DESC LIMIT 12`).bind(f, since));
  if (by.length) L.push(`Incidents · last 30 days by type: ${by.map(r => `${r.type} (${r.severity}) ×${r.n}`).join("; ")}.`);
  const open = await rows(db.prepare(`SELECT ref, incident_date, type, severity, status, follow_up_date FROM incidents WHERE flagship = ? AND status NOT IN ('Closed','Resolved') ORDER BY incident_date DESC LIMIT 10`).bind(f));
  if (open.length) L.push(`Incidents · still open: ${open.map(r => `${r.ref} ${r.incident_date} ${r.type} (${r.severity}, ${r.status}${r.follow_up_date ? ", follow-up " + r.follow_up_date : ""})`).join("; ")}.`);
  const pir = await rows(db.prepare(`SELECT ref, pir_due_at FROM incidents WHERE flagship = ? AND pir_due_at IS NOT NULL AND pir_due_at <> '' AND (pir_submitted_at IS NULL OR pir_submitted_at = '') AND pir_due_at < ? ORDER BY pir_due_at LIMIT 8`).bind(f, new Date().toISOString()));
  if (pir.length) L.push(`Incidents · post-incident reports overdue: ${pir.map(r => `${r.ref} (due ${String(r.pir_due_at).slice(0, 10)})`).join("; ")}.`);
  const bl = await rows(db.prepare(`SELECT access_status, COUNT(*) AS n FROM blacklist WHERE flagship = ? GROUP BY access_status`).bind(f));
  if (bl.length) L.push(`Incidents · blacklist entries: ${bl.map(r => `${r.access_status || "—"} ${r.n}`).join("; ")} (names are not shared here).`);
  return L;
}
async function restroom(db, site, day) {
  const f = RR[site]; if (!f) return [];
  const L = [];
  const t = await one(db.prepare(`SELECT COUNT(*) AS n, SUM(has_issues) AS bad FROM inspection_logs WHERE flagship = ? AND log_date = ?`).bind(f, day));
  if (t) L.push(`Restroom inspections today (operations): ${t.n || 0} done, ${t.bad || 0} with issues.`);
  const ss = await rows(db.prepare(`SELECT company, COUNT(*) AS n, SUM(has_issues) AS bad FROM softservices_logs WHERE flagship = ? AND log_date = ? GROUP BY company`).bind(f, day));
  if (ss.length) L.push(`Restroom cleaning checks today (cleaning company): ${ss.map(r => `${r.company} ${r.n} done, ${r.bad || 0} with issues`).join("; ")}.`);
  const iss = await rows(db.prepare(`SELECT room_name, equipment_issues, cleaning_issues FROM inspection_logs WHERE flagship = ? AND log_date >= ? AND has_issues = 1 ORDER BY id DESC LIMIT 400`).bind(f, dayAdd(day, -7)));
  if (iss.length) {
    const c = new Map();
    for (const r of iss) { let a = []; try { a = [...JSON.parse(r.equipment_issues || "[]"), ...JSON.parse(r.cleaning_issues || "[]")]; } catch {} for (const x of a) { const k = `${r.room_name}: ${x}`; c.set(k, (c.get(k) || 0) + 1); } }
    const top = [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    if (top.length) L.push(`Restroom · most repeated problems, last 7 days: ${top.map(([k, n]) => `${clip(k, 60)} ×${n}`).join("; ")}.`);
  }
  return L;
}
async function audit(db, site, day) {
  const s = AUD[site]; if (!s) return [];
  const L = [];
  const a = await one(db.prepare(`SELECT id, type, start, end_date, status FROM audits WHERE site = ? ORDER BY COALESCE(start,'') DESC LIMIT 1`).bind(s));
  if (a) L.push(`Audit · latest: ${a.type || "audit"} ${a.start || ""}${a.end_date ? " to " + a.end_date : ""} — ${a.status}.`);
  const fo = await rows(db.prepare(`SELECT COALESCE(grade,'—') AS g, COUNT(*) AS n FROM findings WHERE site = ? AND status NOT IN ('Closed','Verified') GROUP BY g ORDER BY n DESC`).bind(s));
  if (fo.length) L.push(`Audit · open findings by grade: ${fo.map(r => `${r.g} ${r.n}`).join("; ")}.`);
  const od = await rows(db.prepare(`SELECT item, loc, risk, due, resp FROM findings WHERE site = ? AND status NOT IN ('Closed','Verified') AND due IS NOT NULL AND due <> '' AND due < ? ORDER BY risk DESC, due LIMIT 8`).bind(s, day));
  if (od.length) L.push(`Audit · overdue findings: ${od.map(r => `${clip(r.item, 50)} at ${clip(r.loc, 30)} (risk ${r.risk ?? "?"}, due ${r.due}${r.resp ? ", " + clip(r.resp, 25) : ""})`).join("; ")}.`);
  const rp = await one(db.prepare(`SELECT COUNT(*) AS n FROM findings WHERE site = ? AND repeat = 1 AND status NOT IN ('Closed','Verified')`).bind(s));
  if (rp && rp.n) L.push(`Audit · repeat findings still open: ${rp.n}.`);
  return L;
}

/* the lines ABCON gets for one flagship — `can(app)` is the hub's own tile permission, `full` = management / leadership */
export async function extFacts(env, site, day, can, full) {
  const jobs = [];
  if (env.SNAG_DB && can("snaglist")) jobs.push(snaglist(env.SNAG_DB, site, day));
  if (env.INC_DB && can("incidents")) jobs.push(incidents(env.INC_DB, site, day));
  if (env.RR_DB && can("restroom")) jobs.push(restroom(env.RR_DB, site, day));
  if (env.AUDIT_DB && full) jobs.push(audit(env.AUDIT_DB, site, day));
  const out = await Promise.all(jobs.map(j => j.catch(() => [])));
  return out.flat().join("\n").slice(0, 4500);
}
