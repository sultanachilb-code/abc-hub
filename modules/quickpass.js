/* =====================================================================
   QUICK ACCESS PASS — a one-entry QR for a contractor or visitor, live for 30 minutes.
   • Anyone at the flagship asks for a pass (name, company, mobile, reason, tenant).
   • Made by the operations team → live at once. Asked by anyone else (technical team, security…) →
     the operations team is notified and approves or rejects; the 30 minutes start at the approval.
   • The visitor gets a WhatsApp message with a link: /qp/<token> shows the QR with a live countdown.
   • The loading gate (hub scanner and the Loading Gate phones) reads the QR: one entry only, then it is used.
     The entry is logged at the gate, in Contractors (contractor access) and pinned on the Day to Day timeline.
   Table : quick_passes      Routes : /api/ops/qp/*  ·  public /api/qp-pass/<token>      Pages : /tools/quickpass · /qp/<token>
   See docs/FEATURE-quick-pass.md
   ===================================================================== */
const err = (m, status = 400) => Object.assign(new Error(m), { status });
const clip = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
export const QP_MINUTES = 30;
const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";   // the short code is letters only, so it never looks like a REQ number
const rnd = (n, A) => { const b = crypto.getRandomValues(new Uint8Array(n)); return [...b].map(x => A[x % A.length]).join(""); };
const TOKEN_A = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
const hmOf = iso => { try { return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Beirut", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso)).replace(/^24/, "00"); } catch { return ""; } };
const dayOf = iso => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Beirut", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

export async function quickPassSchema(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS quick_passes (id INTEGER PRIMARY KEY AUTOINCREMENT, site TEXT NOT NULL, token TEXT NOT NULL, code TEXT NOT NULL,
      name TEXT NOT NULL, company TEXT NOT NULL DEFAULT '', mobile TEXT NOT NULL DEFAULT '', reason TEXT NOT NULL DEFAULT '', tenant TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'requested', req_email TEXT NOT NULL DEFAULT '', req_name TEXT NOT NULL DEFAULT '', req_at TEXT NOT NULL,
      dec_name TEXT NOT NULL DEFAULT '', dec_at TEXT NOT NULL DEFAULT '', dec_note TEXT NOT NULL DEFAULT '', expires_at TEXT NOT NULL DEFAULT '',
      used_at TEXT NOT NULL DEFAULT '', used_by TEXT NOT NULL DEFAULT '', visit_id INTEGER NOT NULL DEFAULT 0, day TEXT NOT NULL DEFAULT '')`),
    env.DB.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS quick_passes_token ON quick_passes (token)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS quick_passes_site ON quick_passes (site, day)`)
  ]);
}

/* the state a pass is in right now */
export function qpState(r, nowMs = Date.now()) {
  if (r.status === "rejected") return "rejected";
  if (r.status === "cancelled") return "cancelled";
  if (r.used_at) return "used";
  if (r.status === "requested") return nowMs - Date.parse(r.req_at) > 12 * 36e5 ? "expired" : "requested";   // an unanswered request lapses after 12 hours
  if (r.status === "approved") return Date.parse(r.expires_at) > nowMs ? "live" : "expired";
  return r.status;
}
const out = (r, extra = {}) => ({ id: r.id, code: "QP-" + r.code, token: r.token, name: r.name, company: r.company, mobile: r.mobile, reason: r.reason, tenant: r.tenant,
  state: qpState(r), requestedBy: r.req_name, requestedAt: r.req_at, decidedBy: r.dec_name, decidedAt: r.dec_at, note: r.dec_note,
  expiresAt: r.expires_at, usedAt: r.used_at, usedBy: r.used_by, ...extra });

/* is this QR / typed code a Quick Pass?  …/qp/<token>  or  QP-ABCDEF */
export function qpCode(raw) {
  const t = String(raw || "").trim();
  const m = t.match(/\/qp\/([A-Za-z0-9]{20,40})(?:[/?#]|$)/);
  if (m) return { token: m[1] };
  const c = t.match(/^QP[-\s]?([A-Z]{6})$/i);
  if (c) return { code: c[1].toUpperCase() };
  return null;
}
export async function qpFind(env, site, q) {
  if (!q) return null;
  return q.token ? env.DB.prepare("SELECT * FROM quick_passes WHERE token = ? AND site = ?").bind(q.token, site).first()
    : env.DB.prepare("SELECT * FROM quick_passes WHERE code = ? AND site = ? ORDER BY id DESC LIMIT 1").bind(q.code, site).first();
}
/* what the loading gate shows for a pass, in the same shape as a Tenant Connect request */
export function qpGateInfo(r) {
  const st = qpState(r);
  const info = { req: "QP-" + r.code, contractor: r.company || r.name, tenant: r.tenant, work: `Quick Pass${r.reason ? " · " + r.reason : ""}`,
    desc: [r.name, r.mobile].filter(Boolean).join(" · "), status: st === "live" || st === "used" ? "Approved" : st === "requested" ? "Waiting for approval" : st === "rejected" ? "Rejected" : "Expired",
    from: r.dec_at ? { day: dayOf(r.dec_at), time: hmOf(r.dec_at) } : null, to: r.expires_at ? { day: dayOf(r.expires_at), time: hmOf(r.expires_at) } : null, quickPass: true };
  const verdict = st === "live" ? { code: "valid", label: `Quick Pass valid until ${hmOf(r.expires_at)}`, ok: true }
    : st === "used" ? { code: "used", label: `Quick Pass already used at ${hmOf(r.used_at)}`, ok: false }
    : st === "requested" ? { code: "not-approved", label: "Quick Pass waiting for approval", ok: false }
    : st === "rejected" ? { code: "rejected", label: "Quick Pass rejected", ok: false }
    : st === "cancelled" ? { code: "rejected", label: "Quick Pass cancelled", ok: false }
    : { code: "expired", label: `Quick Pass expired at ${hmOf(r.expires_at || r.req_at)}`, ok: false };
  return { info, verdict };
}
/* one entry: the first "Approved in" uses the pass (a second phone scanning at the same moment loses) */
export async function qpUse(env, r, at, by, visitId) {
  const res = await env.DB.prepare("UPDATE quick_passes SET used_at = ?, used_by = ?, visit_id = ? WHERE id = ? AND used_at = ''").bind(at, by, visitId || 0, r.id).run();
  return !!(res.meta && res.meta.changes === 1);
}
/* the day's approved passes — Day to Day timeline pins, the handover and the gate's offline list */
export async function qpDay(env, site, day) {
  const { results } = await env.DB.prepare("SELECT * FROM quick_passes WHERE site = ? AND day = ? AND status = 'approved' ORDER BY dec_at").bind(site, day).all().catch(() => ({ results: [] }));
  return (results || []).map(r => out(r, { at: hmOf(r.dec_at), until: hmOf(r.expires_at), usedHm: r.used_at ? hmOf(r.used_at) : "" }));
}

export async function qpRoute(env, p, method, b, url, d) {
  const { site, me, can } = d;
  if (!d.canSite(me, site)) throw err("No access to this flagship", 403);
  const approver = !!can.team;   // the operations team (Mall Supervisors, Officers, the Senior Mall Supervisor) and management
  const nowIso = d.now();

  if (p === "qp/list" && method === "GET") {
    const since = new Date(Date.now() - 3 * 864e5).toISOString();
    const { results } = await env.DB.prepare(`SELECT * FROM quick_passes WHERE site = ? AND req_at >= ? ${approver ? "" : "AND req_email = ?"} ORDER BY id DESC LIMIT 200`)
      .bind(...[site, since, ...(approver ? [] : [me.email])]).all();
    return { site, siteName: d.siteName(site), approver, minutes: QP_MINUTES, hubUrl: d.hubUrl, list: (results || []).map(r => out(r)) };
  }
  if (method !== "POST") throw err("Unknown request", 404);

  if (p === "qp/new") {
    const name = clip(b.name, 80);
    if (!name) throw err("Write the name of the contractor or visitor");
    const mobile = clip(b.mobile, 30).replace(/[^\d+]/g, "");
    let code = ""; for (let i = 0; i < 6 && !code; i++) { const c = rnd(6, LETTERS); if (!(await env.DB.prepare("SELECT id FROM quick_passes WHERE code = ? AND site = ? AND req_at > ?").bind(c, site, new Date(Date.now() - 2 * 864e5).toISOString()).first())) code = c; }
    const token = rnd(28, TOKEN_A);
    const live = approver && b.request !== true;   // the operations team makes a live pass straight away
    const exp = live ? new Date(Date.now() + QP_MINUTES * 60000).toISOString() : "";
    const r = await env.DB.prepare(`INSERT INTO quick_passes (site, token, code, name, company, mobile, reason, tenant, status, req_email, req_name, req_at, dec_name, dec_at, expires_at, day)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(site, token, code, name, clip(b.company, 120), mobile, clip(b.reason, 160), clip(b.tenant, 120),
      live ? "approved" : "requested", me.email, me.full_name, nowIso, live ? me.full_name : "", live ? nowIso : "", exp, d.today()).run();
    const row = await env.DB.prepare("SELECT * FROM quick_passes WHERE id = ?").bind(r.meta.last_row_id).first();
    if (!live) await d.raiseEvent(env, { site, app: "quickpass", tone: "warn", title: `Quick Pass to approve · ${name}`,
      body: `${[b.company, b.tenant && "for " + b.tenant, b.reason].filter(Boolean).map(x => clip(x, 60)).join(" · ")} — asked by ${me.full_name}` }).catch(() => {});
    return { pass: out(row) };
  }
  const r = await env.DB.prepare("SELECT * FROM quick_passes WHERE id = ? AND site = ?").bind(Number(b.id) || 0, site).first();
  if (!r) throw err("Pass not found", 404);

  if (p === "qp/decide") {
    if (!approver) throw err("Only the operations team approves Quick Passes", 403);
    if (qpState(r) !== "requested") throw err("This request was already answered");
    const yes = b.approve === true;
    const exp = yes ? new Date(Date.now() + QP_MINUTES * 60000).toISOString() : "";
    await env.DB.prepare("UPDATE quick_passes SET status = ?, dec_name = ?, dec_at = ?, dec_note = ?, expires_at = ?, day = ? WHERE id = ? AND status = 'requested'")
      .bind(yes ? "approved" : "rejected", me.full_name, nowIso, clip(b.note, 160), exp, d.today(), r.id).run();
    if (r.req_email && r.req_email !== me.email)
      await d.raiseEvent(env, { site, app: "quickpass", tone: yes ? "ok" : "warn", email: r.req_email, title: `Quick Pass ${yes ? "approved" : "rejected"} · ${r.name}`,
        body: yes ? `Live for ${QP_MINUTES} minutes, until ${hmOf(exp)} · by ${me.full_name}` : `${clip(b.note, 120) || "Rejected"} · by ${me.full_name}` }).catch(() => {});
    return { pass: out(await env.DB.prepare("SELECT * FROM quick_passes WHERE id = ?").bind(r.id).first()) };
  }
  if (p === "qp/cancel") {
    if (!approver && r.req_email !== me.email) throw err("Not allowed", 403);
    if (r.used_at) throw err("This pass was already used at the gate");
    await env.DB.prepare("UPDATE quick_passes SET status = 'cancelled', dec_name = CASE WHEN dec_name = '' THEN ? ELSE dec_name END, dec_note = ? WHERE id = ?").bind(me.full_name, "Cancelled by " + me.full_name, r.id).run();
    return { pass: out(await env.DB.prepare("SELECT * FROM quick_passes WHERE id = ?").bind(r.id).first()) };
  }
  throw err("Unknown request", 404);
}

/* the visitor's page: no account, the token is the key. Shows only what the visitor needs. */
export async function qpPublic(env, token, d) {
  if (!/^[A-Za-z0-9]{20,40}$/.test(token)) throw err("This pass link is not valid", 404);
  const r = await env.DB.prepare("SELECT * FROM quick_passes WHERE token = ?").bind(token).first();
  if (!r) throw err("This pass link is not valid", 404);
  return { name: r.name, company: r.company, tenant: r.tenant, siteName: d.siteName(r.site), code: "QP-" + r.code, state: qpState(r),
    expiresAt: r.expires_at, usedAt: r.used_at, minutes: QP_MINUTES, serverNow: new Date().toISOString() };
}
