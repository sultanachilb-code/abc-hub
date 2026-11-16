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
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS qc_actions (pack_id TEXT NOT NULL, finding_id TEXT NOT NULL, owner_email TEXT NOT NULL DEFAULT '', owner_name TEXT NOT NULL DEFAULT '',
    action TEXT NOT NULL DEFAULT '', due TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'unassigned', proof_key TEXT NOT NULL DEFAULT '', proof_note TEXT NOT NULL DEFAULT '',
    fixed_by TEXT NOT NULL DEFAULT '', fixed_at TEXT NOT NULL DEFAULT '', verified_by TEXT NOT NULL DEFAULT '', verified_at TEXT NOT NULL DEFAULT '', escalate TEXT NOT NULL DEFAULT '',
    contractor TEXT NOT NULL DEFAULT '', cost TEXT NOT NULL DEFAULT '', reminded TEXT NOT NULL DEFAULT '', updated_by TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (pack_id, finding_id))`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS qc_comments (id INTEGER PRIMARY KEY AUTOINCREMENT, pack_id TEXT NOT NULL, finding_id TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL DEFAULT 'general',
    text TEXT NOT NULL, by_email TEXT NOT NULL, by_name TEXT NOT NULL DEFAULT '', at TEXT NOT NULL)`).run();
  for (const c of ["closed_at TEXT NOT NULL DEFAULT ''", "closed_by TEXT NOT NULL DEFAULT ''", "closed_open INTEGER NOT NULL DEFAULT 0"])
    await env.DB.prepare(`ALTER TABLE qc_packs ADD COLUMN ${c}`).run().catch(() => {});
  READY = true;
}
/* Action plan (Nov 2026): Not assigned → Assigned → In progress → Fixed (proof photo) → Verified (manager). Escalated = needs approval / budget. */
export const QC_ST = { unassigned: "Not assigned", assigned: "Assigned", progress: "In progress", escalated: "Needs approval", fixed: "Fixed", verified: "Verified" };
const CK = { general: "General", dispute: "Disputed finding", support: "Needs support / budget", mgmt: "Management note" };
const PHOTO_MAX = 4 * 1024 * 1024;
/* who manages a pack (assigns, verifies, closes): the department's managers at that flagship · Technical: Technical Manager / Head of Technical · admins */
function canManage(u, p, d) {
  if (u.role === "ADMIN" || u.is_admin) return true;
  if (!d.sitesOf(u).includes(p.site)) return false;
  if (p.dept === "TECH") return u.role === "TECHNICAL";
  return u.role === "MANAGER";
}
/* who can own an action: the department's team at that flagship */
const ownerOk = (u, p, d) => d.sitesOf(u).includes(p.site) && (p.dept === "TECH" ? u.role === "TECHNICAL" : (u.role === "MANAGER" || (u.role === "SUPERVISOR" && u.position !== "WH")));
const isOverdue = (a, today) => a && a.due && a.due < today && !["fixed", "verified"].includes(a.status);
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
    const seen = (results || []).filter(x => canSee(me, x, d)), today = d.today();
    const ag = new Map(((await env.DB.prepare(`SELECT pack_id, SUM(status = 'verified') v, SUM(status = 'fixed') f, SUM(status NOT IN ('unassigned')) a,
        SUM(due != '' AND due < ? AND status NOT IN ('fixed','verified')) o FROM qc_actions GROUP BY pack_id`).bind(today).all()).results || []).map(r => [r.pack_id, r]));
    const cl = new Map(((await env.DB.prepare("SELECT id, closed_at, closed_open FROM qc_packs").all()).results || []).map(r => [r.id, r]));
    const packs = seen.map(x => { const g = ag.get(x.id) || {}, c = cl.get(x.id) || {}; return { id: x.id, audit: x.audit_id, site: x.site, siteName: d.SITES[x.site], dept: x.dept, deptName: QC_DEPTS[x.dept],
      start: x.start_day, end: x.end_day, score: x.score, counts: JSON.parse(x.counts || "{}"), n: Number(x.n) || 0, shared: x.shared_at, received: x.received_at,
      verified: Number(g.v) || 0, fixed: Number(g.f) || 0, assigned: Number(g.a) || 0, overdue: Number(g.o) || 0, closed: c.closed_at || "", closedOpen: Number(c.closed_open) || 0 }; });
    return { depts: depts.filter(k => k !== "RET" || mine.some(s => DS.includes(s))).map(k => ({ k, name: QC_DEPTS[k] })), packs, sites: Object.fromEntries(mine.map(s => [s, d.SITES[s]])) };
  }
  if (p === "qc/pack") {
    const x = await env.DB.prepare("SELECT * FROM qc_packs WHERE id = ?").bind(String(url.searchParams.get("id") || "")).first();
    if (!x || !canSee(me, x, d)) throw err("Not found", 404);
    const img = k => `${x.origin}/api/sfile?t=${encodeURIComponent(x.token)}&k=${encodeURIComponent(k)}`;
    const acts = Object.fromEntries(((await env.DB.prepare("SELECT * FROM qc_actions WHERE pack_id = ?").bind(x.id).all()).results || []).map(a => [a.finding_id, {
      owner: a.owner_email, ownerName: a.owner_name, action: a.action, due: a.due, status: a.status, proof: a.proof_key ? `/api/ops/qc/proof?id=${encodeURIComponent(x.id)}&f=${encodeURIComponent(a.finding_id)}` : "",
      proofNote: a.proof_note, fixedBy: a.fixed_by, fixedAt: a.fixed_at, verifiedBy: a.verified_by, verifiedAt: a.verified_at, escalate: a.escalate, contractor: a.contractor, cost: a.cost, updatedBy: a.updated_by, updatedAt: a.updated_at }]));
    const comments = ((await env.DB.prepare("SELECT * FROM qc_comments WHERE pack_id = ? ORDER BY id").bind(x.id).all()).results || []).map(c => ({ id: c.id, f: c.finding_id, kind: c.kind, kindName: CK[c.kind] || c.kind, text: c.text, by: c.by_name || c.by_email, at: c.at }));
    const mg = canManage(me, x, d);
    const owners = mg ? ((await env.DB.prepare("SELECT email, full_name, role, position, site_code, sites FROM users WHERE active = 1").all()).results || []).filter(u => ownerOk(u, x, d)).map(u => ({ email: u.email, name: u.full_name || u.email, pos: d.posLabel ? d.posLabel(u.position) : "" })) : [];
    return { id: x.id, audit: x.audit_id, site: x.site, siteName: d.SITES[x.site], dept: x.dept, deptName: QC_DEPTS[x.dept], start: x.start_day, end: x.end_day, score: x.score,
      counts: JSON.parse(x.counts || "{}"), shared: x.shared_at, link: `${x.origin}/api/s/${x.token}`, closed: x.closed_at || "", closedBy: x.closed_by || "", closedOpen: Number(x.closed_open) || 0,
      today: d.today(), me: me.email, canManage: mg && !x.closed_at, canReopen: !!x.closed_at && (me.role === "ADMIN" || !!me.is_admin), canComment: !x.closed_at, owners, statuses: QC_ST, kinds: CK,
      findings: JSON.parse(x.findings || "[]").map(f => ({ ...f, photos: f.photos.map(img) })), actions: acts, comments };
  }
  const pack = async id => { const x = await env.DB.prepare("SELECT * FROM qc_packs WHERE id = ?").bind(String(id || "")).first(); if (!x || !canSee(me, x, d)) throw err("Not found", 404); return x; };
  if (p === "qc/proof") {
    const x = await pack(url.searchParams.get("id")), a = await env.DB.prepare("SELECT proof_key FROM qc_actions WHERE pack_id = ? AND finding_id = ?").bind(x.id, String(url.searchParams.get("f") || "")).first();
    const o = a && a.proof_key && env.FILES ? await env.FILES.get(a.proof_key) : null; if (!o) throw err("Not found", 404);
    return new Response(o.body, { headers: { "content-type": (o.httpMetadata && o.httpMetadata.contentType) || "image/jpeg", "cache-control": "private, max-age=600" } });
  }
  if (p === "qc/act" && method === "POST") {   // action plan: assign / update / fixed (proof) / verify / escalate — one or several findings
    const x = await pack(b.id); if (x.closed_at) throw err("This audit is closed");
    const F = JSON.parse(x.findings || "[]"), ids = (Array.isArray(b.f) ? b.f : [b.f]).map(String).filter(id => F.some(f => f.id === id)); if (!ids.length) throw err("Choose a finding");
    const mg = canManage(me, x, d), now = d.now(), who = me.full_name || me.email;
    let ownerName = null, notify = new Set();
    if (b.owner !== undefined) {
      if (!mg) throw err("Only the managers assign owners", 403);
      if (b.owner) { const u = await env.DB.prepare("SELECT email, full_name, role, position, site_code, sites FROM users WHERE email = ? AND active = 1").bind(String(b.owner).toLowerCase()).first();
        if (!u || !ownerOk(u, x, d)) throw err("This person is not in the team of this flagship"); ownerName = u.full_name || u.email; }
    }
    for (const fid of ids) {
      const cur = await env.DB.prepare("SELECT * FROM qc_actions WHERE pack_id = ? AND finding_id = ?").bind(x.id, fid).first() || { owner_email: "", owner_name: "", action: "", due: "", status: "unassigned", proof_key: "", proof_note: "", fixed_by: "", fixed_at: "", verified_by: "", verified_at: "", escalate: "", contractor: "", cost: "" };
      const fin = F.find(f => f.id === fid), mineA = cur.owner_email && cur.owner_email === me.email;
      if (!mg && !mineA) throw err("Only the owner of this action or the managers can update it", 403);
      const n = { ...cur };
      if (b.owner !== undefined) { if (n.owner_email !== String(b.owner || "").toLowerCase()) { n.owner_email = String(b.owner || "").toLowerCase(); n.owner_name = ownerName || ""; if (n.owner_email) notify.add(n.owner_email); }
        if (!n.due && fin && fin.due) n.due = fin.due; if (n.owner_email && n.status === "unassigned") n.status = "assigned"; if (!n.owner_email && n.status === "assigned") n.status = "unassigned"; }
      if (b.due !== undefined) { if (!mg) throw err("Only the managers set due dates", 403); n.due = /^\d{4}-\d{2}-\d{2}$/.test(String(b.due)) ? b.due : ""; n.reminded = ""; }
      if (b.action !== undefined) n.action = clip(b.action, 500);
      if (b.contractor !== undefined) n.contractor = clip(b.contractor, 120);
      if (b.cost !== undefined) n.cost = clip(b.cost, 60);
      if (b.status !== undefined) {
        const st = String(b.status); if (!QC_ST[st]) throw err("Unknown status");
        if (st === "verified" && !mg) throw err("Only the managers verify", 403);
        if (st === "verified" && cur.status !== "fixed") throw err("Mark it Fixed with a photo first");
        if (st === "fixed") {
          const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(String(b.proof || ""));
          if (!m && !cur.proof_key) throw err("A proof photo is needed to mark it Fixed");
          if (m) { const bin = Uint8Array.from(atob(m[2]), c => c.charCodeAt(0)); if (bin.byteLength > PHOTO_MAX) throw err("The photo is too large");
            n.proof_key = `qc/${x.id.replace(/[^\w-]/g, "_")}/${fid.replace(/[^\w-]/g, "_")}-${Date.now()}.jpg`; await env.FILES.put(n.proof_key, bin, { httpMetadata: { contentType: m[1] } }); }
          n.proof_note = clip(b.proofNote, 300); n.fixed_by = who; n.fixed_at = now;
        }
        if (st === "verified") { n.verified_by = who; n.verified_at = now; }
        if (st === "escalated") { n.escalate = clip(b.escalate, 300); if (!n.escalate) throw err("Write why it needs approval or budget"); }
        if (["assigned", "progress", "escalated"].includes(st) && cur.status === "verified" && !mg) throw err("Verified items are changed by the managers", 403);
        n.status = st;
      }
      n.updated_by = who; n.updated_at = now;
      await env.DB.prepare(`INSERT OR REPLACE INTO qc_actions (pack_id, finding_id, owner_email, owner_name, action, due, status, proof_key, proof_note, fixed_by, fixed_at, verified_by, verified_at, escalate, contractor, cost, reminded, updated_by, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(x.id, fid, n.owner_email, n.owner_name, n.action, n.due, n.status, n.proof_key, n.proof_note, n.fixed_by, n.fixed_at, n.verified_by, n.verified_at, n.escalate, n.contractor, n.cost, n.reminded || "", n.updated_by, n.updated_at).run();
    }
    for (const e of notify) if (e !== me.email) await d.raiseEvent(env, { site: x.site, app: "qc-snag", tone: "info", email: e, title: `QC action assigned to you · ${d.SITES[x.site]}`,
      body: `${ids.length} finding${ids.length === 1 ? "" : "s"} of ${x.audit_id} (${QC_DEPTS[x.dept]}) — open QC Snaglists` }).catch(() => {});
    return { saved: ids.length };
  }
  if (p === "qc/comment" && method === "POST") {
    const x = await pack(b.id); if (x.closed_at) throw err("This audit is closed");
    const text = clip(b.text, 1500); if (!text) throw err("Write the comment");
    const kind = CK[b.kind] ? b.kind : "general", fid = String(b.f || "");
    if (kind === "dispute" && !fid) throw err("Choose the finding you dispute");
    await env.DB.prepare("INSERT INTO qc_comments (pack_id, finding_id, kind, text, by_email, by_name, at) VALUES (?,?,?,?,?,?,?)").bind(x.id, fid, kind, text, me.email, me.full_name || me.email, d.now()).run();
    return { saved: true };
  }
  if (p === "qc/close" && method === "POST") {   // close the audit — with open items only after typing Agree
    const x = await pack(b.id); if (x.closed_at) throw err("Already closed");
    if (!canManage(me, x, d)) throw err("Only the managers close the audit", 403);
    const F = JSON.parse(x.findings || "[]"), done = new Set(((await env.DB.prepare("SELECT finding_id FROM qc_actions WHERE pack_id = ? AND status = 'verified'").bind(x.id).all()).results || []).map(r => r.finding_id));
    const open = F.filter(f => !done.has(f.id)).length;
    if (open && String(b.agree || "").trim().toLowerCase() !== "agree") throw err(`${open} item${open === 1 ? " is" : "s are"} still open — type Agree to close`);
    await env.DB.prepare("UPDATE qc_packs SET closed_at = ?, closed_by = ?, closed_open = ? WHERE id = ?").bind(d.now(), me.full_name || me.email, open, x.id).run();
    if (open) await env.DB.prepare("INSERT INTO qc_comments (pack_id, finding_id, kind, text, by_email, by_name, at) VALUES (?,?,?,?,?,?,?)").bind(x.id, "", "mgmt", `Audit closed with ${open} item${open === 1 ? "" : "s"} still open (agreed).`, me.email, me.full_name || me.email, d.now()).run();
    return { closed: true, open };
  }
  if (p === "qc/reopen" && method === "POST") {
    const x = await pack(b.id); if (!(me.role === "ADMIN" || me.is_admin)) throw err("Administrators only", 403);
    await env.DB.prepare("UPDATE qc_packs SET closed_at = '', closed_by = '', closed_open = 0 WHERE id = ?").bind(x.id).run();
    return { reopened: true };
  }
  throw err("Unknown endpoint", 404);
}

/* daily (from the cron, once a day after 09:00): 2 days before the due date and on the first overdue day → the owner */
export async function qcRun(env, d) {
  if (d.hour() < 9) return;
  const today = d.today(), k = "qc:run:" + today;
  if (await env.DB.prepare("SELECT 1 FROM meta WHERE k = ?").bind(k).first().catch(() => null)) return;
  await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)").bind(k, d.now()).run();
  await schema(env);
  const in2 = new Date(new Date(today + "T12:00:00Z").getTime() + 2 * 864e5).toISOString().slice(0, 10);
  const { results } = await env.DB.prepare(`SELECT a.*, p.site, p.audit_id, p.dept FROM qc_actions a JOIN qc_packs p ON p.id = a.pack_id
    WHERE p.closed_at = '' AND a.owner_email != '' AND a.due != '' AND a.status NOT IN ('fixed','verified') AND (a.due = ? OR a.due < ?)`).bind(in2, today).all();
  const per = {};
  for (const a of results || []) {
    const kind = a.due === in2 ? "soon" : "late"; if (a.reminded === kind) continue;
    const key = a.owner_email + "|" + a.site; (per[key] = per[key] || { email: a.owner_email, site: a.site, soon: 0, late: 0 })[kind]++;
    await env.DB.prepare("UPDATE qc_actions SET reminded = ? WHERE pack_id = ? AND finding_id = ?").bind(kind, a.pack_id, a.finding_id).run();
  }
  for (const x of Object.values(per)) await d.raiseEvent(env, { site: x.site, app: "qc-snag", tone: x.late ? "alert" : "info", email: x.email,
    title: `QC actions ${x.late ? "overdue" : "due in 2 days"} · ${d.SITES[x.site]}`, body: [x.late && `${x.late} overdue`, x.soon && `${x.soon} due in 2 days`].filter(Boolean).join(" · ") + " — open QC Snaglists" }).catch(() => {});
}
