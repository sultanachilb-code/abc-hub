/* =====================================================================
   QC SNAGLISTS (Nov 2026) — docs/FEATURE-qc-snaglists.md
   ABC Audit (Quality Control) shares a Snaglist per department when the audit is posted → it is sent here (POST /api/qc/ingest,
   header x-audit-key = secret AUDIT_KEY, the same value as HUB_QC_KEY in ABC Audit).
   • Operations pack → the flagship's Mall Manager, Operations Manager and operations team (+ leadership of that flagship)
   • Technical pack  → the Technical Manager covering the flagship + the Head of Technical (+ leadership)
   • Retail pack     → department stores only: the store's management and operations team + CDSO (+ Property Advisor)
   The audit is frozen: nothing here changes the score. Photos are not copied — they load from ABC Audit's storage via the share link.
   The action plan (owner, due date, status, proof) will be defined later.
   ===================================================================== */
const err = (m, status = 400) => Object.assign(new Error(m), { status });
const clip = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
export const QC_DEPTS = { OPS: "Operations", TECH: "Technical", RET: "Retail" };
const DS = ["DBS", "ACS", "VRS"];
const GRADES = ["Critical", "Major", "Moderate", "Minor"];
let READY = false;
async function schema(env) {
  if (READY) return;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS qc_packs (id TEXT PRIMARY KEY, audit_id TEXT NOT NULL, site TEXT NOT NULL, dept TEXT NOT NULL,
    start_day TEXT NOT NULL DEFAULT '', end_day TEXT NOT NULL DEFAULT '', score INTEGER, origin TEXT NOT NULL DEFAULT '', token TEXT NOT NULL DEFAULT '',
    shared_at TEXT NOT NULL DEFAULT '', counts TEXT NOT NULL DEFAULT '{}', findings TEXT NOT NULL DEFAULT '[]', received_at TEXT NOT NULL, updated_at TEXT NOT NULL)`).run();
  READY = true;
}
const same = (a, b) => { if (!a || !b || a.length !== b.length) return false; let x = 0; for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i); return x === 0; };

/* which departments a person sees (and at which flagships) */
export function qcDeptsOf(u, d) {
  if (!u) return [];
  if (["ADMIN", "ADVISOR", "DIRECTOR", "CDSO"].includes(u.role) || u.is_admin) return ["OPS", "TECH", "RET"];
  if (u.role === "TECHNICAL") return ["TECH"];
  if (u.role === "MANAGER" || (u.role === "SUPERVISOR" && u.position !== "WH")) return ["OPS", "RET"];
  return [];
}
const canSee = (u, p, d) => d.sitesOf(u).includes(p.site) && qcDeptsOf(u, d).includes(p.dept) && (p.dept !== "RET" || DS.includes(p.site));

/* who is notified for a pack */
async function recipients(env, site, dept, d) {
  const { results } = await env.DB.prepare("SELECT email, role, position, site_code, sites FROM users WHERE active = 1").all();
  return (results || []).filter(u => {
    if (!d.sitesOf(u).includes(site)) return false;
    if (u.role === "ADVISOR") return true;
    if (u.role === "DIRECTOR") return dept !== "RET";
    if (u.role === "CDSO") return true;
    if (dept === "TECH") return u.role === "TECHNICAL";
    if (dept === "RET" && !DS.includes(site)) return false;
    return u.role === "MANAGER" || (u.role === "SUPERVISOR" && u.position !== "WH");
  }).map(u => u.email);
}

/* POST /api/qc/ingest — from ABC Audit only */
export async function qcIngest(env, request, b, d) {
  if (!env.AUDIT_KEY) throw err("The hub is not set up for ABC Audit yet (AUDIT_KEY)", 503);
  if (!same(String(request.headers.get("x-audit-key") || ""), String(env.AUDIT_KEY))) throw err("Not allowed", 403);
  await schema(env);
  const site = String(b.site || ""), dept = String(b.dept || "");
  if (!d.SITES[site]) throw err("Unknown flagship");
  if (!QC_DEPTS[dept]) throw err("Unknown department");
  const auditId = clip(b.auditId, 60); if (!auditId) throw err("Missing audit");
  const origin = String(b.origin || ""); if (!/^https:\/\/[\w.-]+$/.test(origin)) throw err("Bad origin");
  const token = String(b.token || ""); if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) throw err("Bad token");
  const day = v => /^\d{4}-\d{2}-\d{2}/.test(String(v || "")) ? String(v).slice(0, 10) : "";
  const findings = (Array.isArray(b.findings) ? b.findings : []).slice(0, 1500).map(f => ({
    id: clip(f.id, 40), card: clip(f.card, 40), side: clip(f.side, 20), grade: GRADES.includes(f.grade) ? f.grade : clip(f.grade, 20), text: clip(f.text, 300), comment: clip(f.comment, 600),
    area: clip(f.area, 120), sub: clip(f.sub, 160), asset: clip(f.asset, 120), created: clip(f.created, 20), type: clip(f.type, 20), due: day(f.due), resp: clip(f.resp, 120),
    photos: (Array.isArray(f.photos) ? f.photos : []).filter(k => /^photos\/[\w./-]{1,180}$/.test(String(k))).slice(0, 4) }));
  const counts = Object.fromEntries(GRADES.map(g => [g, findings.filter(f => f.grade === g).length]));
  const id = `${auditId}:${dept}`, now = d.now();
  const prev = await env.DB.prepare("SELECT id FROM qc_packs WHERE id = ?").bind(id).first();
  const score = Number.isFinite(Number(b.score)) && b.score !== null ? Math.round(Number(b.score)) : null;
  await env.DB.prepare(`INSERT INTO qc_packs (id, audit_id, site, dept, start_day, end_day, score, origin, token, shared_at, counts, findings, received_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET site = excluded.site, start_day = excluded.start_day, end_day = excluded.end_day, score = excluded.score,
      origin = excluded.origin, token = excluded.token, shared_at = excluded.shared_at, counts = excluded.counts, findings = excluded.findings, updated_at = excluded.updated_at`)
    .bind(id, auditId, site, dept, day(b.start), day(b.end), score, origin, token, clip(b.sharedAt, 20), JSON.stringify(counts), JSON.stringify(findings), now, now).run();
  if (!prev) {   // first time: notify the department's team
    const big = ["Critical", "Major"].filter(g => counts[g]).map(g => `${counts[g]} ${g}`).join(", ");
    const title = `QC Snaglist posted · ${d.SITES[site]} · ${QC_DEPTS[dept]}`;
    const body = `${findings.length} finding${findings.length === 1 ? "" : "s"}${big ? ` (${big})` : ""}${score != null ? ` · score ${score}%` : ""} — open QC Snaglists`;
    for (const email of await recipients(env, site, dept, d)) await d.raiseEvent(env, { site, app: "qc-snag", tone: counts.Critical ? "alert" : "info", title, body, email }).catch(() => {});
  }
  return { saved: true, id, findings: findings.length, first: !prev };
}

/* /api/ops/qc/* — signed-in hub users */
export async function qcRoute(env, p, method, b, url, d) {
  const { me } = d;
  if (!d.allows(me, "qc-snag")) throw err("Not allowed", 403);
  await schema(env);
  const depts = qcDeptsOf(me, d), mine = d.sitesOf(me);
  if (p === "qc/list") {
    const { results } = await env.DB.prepare("SELECT id, audit_id, site, dept, start_day, end_day, score, origin, token, shared_at, counts, received_at, json_array_length(findings) AS n FROM qc_packs ORDER BY start_day DESC, received_at DESC LIMIT 400").all();
    const packs = (results || []).filter(x => canSee(me, x, d)).map(x => ({ id: x.id, audit: x.audit_id, site: x.site, siteName: d.SITES[x.site], dept: x.dept, deptName: QC_DEPTS[x.dept],
      start: x.start_day, end: x.end_day, score: x.score, counts: JSON.parse(x.counts || "{}"), n: Number(x.n) || 0, shared: x.shared_at, received: x.received_at }));
    return { depts: depts.filter(k => k !== "RET" || mine.some(s => DS.includes(s))).map(k => ({ k, name: QC_DEPTS[k] })), packs, sites: Object.fromEntries(mine.map(s => [s, d.SITES[s]])) };
  }
  if (p === "qc/pack") {
    const x = await env.DB.prepare("SELECT * FROM qc_packs WHERE id = ?").bind(String(url.searchParams.get("id") || "")).first();
    if (!x || !canSee(me, x, d)) throw err("Not found", 404);
    const img = k => `${x.origin}/api/sfile?t=${encodeURIComponent(x.token)}&k=${encodeURIComponent(k)}`;
    return { id: x.id, audit: x.audit_id, site: x.site, siteName: d.SITES[x.site], dept: x.dept, deptName: QC_DEPTS[x.dept], start: x.start_day, end: x.end_day, score: x.score,
      counts: JSON.parse(x.counts || "{}"), shared: x.shared_at, link: `${x.origin}/api/s/${x.token}`,
      findings: JSON.parse(x.findings || "[]").map(f => ({ ...f, photos: f.photos.map(img) })) };
  }
  throw err("Unknown endpoint", 404);
}
