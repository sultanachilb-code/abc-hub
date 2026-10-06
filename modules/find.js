/* =====================================================================
   HUB SEARCH ACROSS CONTENT — the home search also finds records, not only tiles:
   units and tenants (→ Tenant 360), REQ numbers (→ Contractors / Loading Gate), portal items BP / VR / NR
   (→ Portal Dashboard) and contracts (→ Contracts Near Ending). Only the flagships the person can open.
   Route: /api/ops/find?q=   See docs/FEATURE-hub-search.md
   ===================================================================== */
import { cleanStatus } from "./portal.js";
const rows = async q => { try { return (await q.all()).results || []; } catch { return []; } };

export async function findRoute(env, url, { sites, siteName }) {
  const q = String(url.searchParams.get("q") || "").trim().slice(0, 60);
  if (q.length < 3 || !sites.length) return { q, results: [] };
  const like = "%" + q.replace(/[%_]/g, "") + "%", digits = q.replace(/\D/g, "").replace(/^0+/, "");
  const ph = sites.map(() => "?").join(","), DB = env.DB, multi = sites.length > 1;
  const where = s => multi ? " · " + siteName(s) : "";
  const reqLike = digits.length >= 3 ? "%" + digits + "%" : null;
  const [units, visits, scans, portal, contracts] = await Promise.all([
    rows(DB.prepare(`SELECT id, site, code, level, brand, status FROM gla_units WHERE site IN (${ph}) AND active = 1 AND (brand LIKE ? OR code LIKE ?) ORDER BY brand LIMIT 8`).bind(...sites, like, like)),
    reqLike ? rows(DB.prepare(`SELECT id, site, req, company, tenant, work, day_from, day_to FROM contractor_visits WHERE site IN (${ph}) AND deleted = 0 AND req LIKE ? ORDER BY day_from DESC LIMIT 6`).bind(...sites, reqLike)) : [],
    reqLike ? rows(DB.prepare(`SELECT site, day, at, decision, reason, req, tenant, contractor FROM gate_scans WHERE site IN (${ph}) AND req LIKE ? ORDER BY id DESC LIMIT 4`).bind(...sites, reqLike)) : [],
    rows(DB.prepare(`SELECT name, kind, site, tenant, status, subject, created_day FROM portal_items WHERE site IN (${ph}) AND active = 1 AND (name LIKE ? OR subject LIKE ? OR tenant LIKE ?) ORDER BY created_day DESC LIMIT 6`).bind(...sites, like, like, like)),
    rows(DB.prepare(`SELECT contract_no, site, tenant, end_day, status FROM contracts_ending WHERE site IN (${ph}) AND active = 1 AND (contract_no LIKE ? OR tenant LIKE ?) LIMIT 4`).bind(...sites, like, like))
  ]);
  const K = { bp: "Breach & Penalty", vr: "Violation", nr: "ABC Request" };
  const results = [
    ...units.filter(u => u.brand).map(u => ({ app: "tenant360", qs: `?site=${u.site}&unit=${u.id}`, title: u.brand, sub: `Tenant 360 · ${[u.code, u.level, u.status].filter(Boolean).join(" · ")}${where(u.site)}`, icon: "unit" })),
    ...visits.map(v => ({ app: "contractors", qs: `?site=${v.site}&day=${v.day_from}`, title: `${v.req} · ${v.company || v.tenant}`, sub: `Contractor booking · ${[v.tenant, v.work, v.day_from + (v.day_to !== v.day_from ? " → " + v.day_to : "")].filter(Boolean).join(" · ")}${where(v.site)}`, icon: "req" })),
    ...scans.map(s => ({ app: "gate", qs: `?site=${s.site}`, title: `${s.req} · ${s.decision === "in" ? "Approved in" : s.decision === "out" ? "Rejected" : "Left"}`, sub: `Loading gate · ${[s.contractor, s.tenant, s.day, s.reason].filter(Boolean).join(" · ")}${where(s.site)}`, icon: "gate" })),
    ...portal.map(p => ({ app: "portal", qs: `?site=${p.site}&q=${encodeURIComponent(p.name)}`, title: `${p.name} · ${p.tenant}`, sub: `${K[p.kind] || "Portal"} · ${[cleanStatus(p.status), p.subject].filter(Boolean).join(" · ")}${where(p.site)}`, icon: "portal" })),
    ...contracts.map(c => ({ app: "contracts", qs: `?site=${c.site}`, title: `${c.contract_no} · ${c.tenant}`, sub: `Contract · ends ${c.end_day}${c.status ? " · " + c.status : ""}${where(c.site)}`, icon: "contract" }))
  ];
  return { q, results };
}
