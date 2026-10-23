/* =====================================================================
   PREVENTIVE MAINTENANCE (Oct 2026, Upcoming - Testing) — docs/FEATURE-pm.md
   The hub version of "ABC Preventive Maintenance Solution V3":
   • Setup = the Technical team's Excel: certificate · risk (High/Medium/Low) · categories · flagships · months.
   • Tenants = brand · category (F&B with charcoal / F&B without charcoal / Retail) · emails · active since.
   • 15 days before each PM month the hub opens a PM for every active tenant (≥ 6 months) with the certificates it needs,
     and emails each tenant a personal secure link (/pm/<token>, no account) to upload them.
   • Certificates: Missing → Pending review (tenant uploads) → Approved / Rejected (reason from a list) by the operations team.
   • Weekly reminders from the launch to the deadline (last day of the month) to tenants not finished.
   • Deadline extensions by risk level, approved by management; 7-day reminder before the new deadline.
   • 5 days after the deadline: breach list (non-performance of preventive maintenance, $750) — raised in the portal by the team.
   Routes: /api/ops/pm/* (hub) · /api/pm-ext/<token>[/upload] (tenant link)
   ===================================================================== */
const err = (m, status = 400) => Object.assign(new Error(m), { status });
const clip = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
export const PM_CATS = { charcoal: "F&B with charcoal", nocharcoal: "F&B without charcoal", retail: "Retail" };
export const PM_REASONS = ["Certificate expired", "Wrong certificate / not for this unit", "Not signed or stamped by the contractor",
  "Unreadable or incomplete", "Wrong period / date", "Contractor not approved", "Other"];
const RISKS = ["High", "Medium", "Low"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MAX_FILE = 10 * 1024 * 1024, PENALTY = 750;
const lastDay = ym => { const [y, m] = ym.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
const addDays = (d, n) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const monthName = ym => new Date(ym + "-15T12:00:00Z").toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const token = () => [...crypto.getRandomValues(new Uint8Array(18))].map(b => "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"[b % 57]).join("");
const yes = v => v === true || v === 1 || /^(x|✓|✔|☑|yes|y|1|true|v|●)$/i.test(String(v).trim());
const escH = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export async function pmSchema(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS pm_setup (id INTEGER PRIMARY KEY AUTOINCREMENT, cert TEXT NOT NULL, risk TEXT NOT NULL DEFAULT 'Medium',
      cats TEXT NOT NULL DEFAULT '[]', sites TEXT NOT NULL DEFAULT '[]', months TEXT NOT NULL DEFAULT '[]', seq INTEGER NOT NULL DEFAULT 0)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS pm_tenants (site TEXT NOT NULL, brand TEXT NOT NULL, category TEXT NOT NULL DEFAULT '', emails TEXT NOT NULL DEFAULT '',
      units TEXT NOT NULL DEFAULT '', since TEXT NOT NULL DEFAULT '', excluded INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT '', PRIMARY KEY (site, brand))`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS pm_cycles (id INTEGER PRIMARY KEY AUTOINCREMENT, site TEXT NOT NULL, month TEXT NOT NULL, deadline TEXT NOT NULL,
      launched_at TEXT NOT NULL, launched_by TEXT NOT NULL DEFAULT '', breach_done INTEGER NOT NULL DEFAULT 0, UNIQUE (site, month))`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS pm_records (id INTEGER PRIMARY KEY AUTOINCREMENT, cycle_id INTEGER NOT NULL, site TEXT NOT NULL, brand TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT '', emails TEXT NOT NULL DEFAULT '', token TEXT NOT NULL, deadline TEXT NOT NULL, completed_at TEXT NOT NULL DEFAULT '',
      last_mail TEXT NOT NULL DEFAULT '', ext_mail INTEGER NOT NULL DEFAULT 0, breach_at TEXT NOT NULL DEFAULT '', opened_at TEXT NOT NULL DEFAULT '')`),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS pm_records_token ON pm_records (token)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS pm_records_cycle ON pm_records (cycle_id)"),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS pm_certs (id INTEGER PRIMARY KEY AUTOINCREMENT, record_id INTEGER NOT NULL, site TEXT NOT NULL, cert TEXT NOT NULL, risk TEXT NOT NULL DEFAULT 'Medium',
      status TEXT NOT NULL DEFAULT 'missing', file_key TEXT NOT NULL DEFAULT '', file_name TEXT NOT NULL DEFAULT '', file_type TEXT NOT NULL DEFAULT '', uploaded_at TEXT NOT NULL DEFAULT '',
      reviewed_by TEXT NOT NULL DEFAULT '', reviewed_at TEXT NOT NULL DEFAULT '', reason TEXT NOT NULL DEFAULT '', comment TEXT NOT NULL DEFAULT '')`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS pm_certs_record ON pm_certs (record_id)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS pm_certs_queue ON pm_certs (site, status)"),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS pm_ext (id INTEGER PRIMARY KEY AUTOINCREMENT, cycle_id INTEGER NOT NULL, risk TEXT NOT NULL, deadline TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending', requested_by TEXT NOT NULL DEFAULT '', requested_at TEXT NOT NULL DEFAULT '',
      decided_by TEXT NOT NULL DEFAULT '', decided_at TEXT NOT NULL DEFAULT '')`)
  ]);
}

/* ---------- reading the Technical team's Excel ---------- */
export function catOf(v) {
  const s = String(v || "").toLowerCase();
  if (/retail/.test(s)) return "retail";
  if (/without|no\s*char|w\/o/.test(s)) return "nocharcoal";
  if (/charcoal|wood/.test(s)) return "charcoal";
  return "";
}
export function siteOf(v, SITES) {
  const s = String(v || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!s) return "";
  if (SITES[s.toUpperCase()]) return s.toUpperCase();
  const ds = /dep|ds\b|store/.test(s);
  if (/verdun/.test(s)) return ds ? "VRS" : "VRM";
  if (/achrafieh|ashrafieh/.test(s)) return ds ? "ACS" : "ACM";
  if (/dbayeh|dbaye/.test(s)) return "DBS";
  return "";
}
const parts = v => String(v || "").split(/[\n,;/|]+|\s{2,}/).map(x => x.trim()).filter(Boolean);
export function parseSetup(rows, SITES) {
  const H = rows.findIndex(r => r.some(c => /certificate/i.test(String(c))));
  if (H < 0) throw err("The sheet needs a header row with \"Certificate Name\"");
  const head = rows[H].map(c => String(c).toLowerCase().trim());
  const col = re => head.findIndex(h => re.test(h));
  const cC = col(/certificate/), cR = col(/risk/), cK = col(/categ/), cB = col(/branch|flagship|site|mall/);
  const mCols = head.map((h, i) => [MONTHS.findIndex(m => h.startsWith(m)), i]).filter(([m]) => m >= 0);
  if (!mCols.length) throw err("The sheet needs month columns (February, April, …)");
  const map = new Map();
  let last = null;
  for (const r of rows.slice(H + 1)) {
    const name = clip(r[cC], 120) || (last && (r[cK] || r[cB]) ? last : "");
    if (!name) continue;
    last = name;
    const e = map.get(name) || { cert: name, risk: "", cats: new Set(), sites: new Set(), months: new Set() };
    const risk = cR >= 0 ? RISKS.find(x => new RegExp("^" + x, "i").test(String(r[cR]).trim())) : "";
    if (risk) e.risk = risk;
    for (const p of parts(cK >= 0 ? r[cK] : "")) { const c = catOf(p); if (c) e.cats.add(c); }
    for (const p of parts(cB >= 0 ? r[cB] : "")) { const s = siteOf(p, SITES); if (s) e.sites.add(s); }
    for (const [m, i] of mCols) if (yes(r[i])) e.months.add(m + 1);
    map.set(name, e);
  }
  const list = [...map.values()].map(e => ({ cert: e.cert, risk: e.risk || "Medium", cats: [...e.cats], sites: [...e.sites], months: [...e.months].sort((a, b) => a - b) }));
  if (!list.length) throw err("No certificate found under the header row");
  return list;
}
export function parseTenants(rows, SITES, site) {
  const H = rows.findIndex(r => r.some(c => /brand|tenant/i.test(String(c))));
  if (H < 0) throw err("The sheet needs a header row with \"Brand\" (or \"Tenant\")");
  const head = rows[H].map(c => String(c).toLowerCase().trim());
  const col = re => head.findIndex(h => re.test(h));
  const cN = col(/brand|tenant/), cS = col(/branch|flagship|site|mall/), cK = col(/categ/), cE = col(/e-?mail/), cU = col(/unit/), cD = col(/since|open|start|date/);
  const out = [];
  for (const r of rows.slice(H + 1)) {
    const brand = clip(r[cN], 100); if (!brand) continue;
    const s = cS >= 0 ? siteOf(r[cS], SITES) || site : site;
    if (!s) continue;
    let since = cD >= 0 ? r[cD] : "";
    if (typeof since === "number" && since > 20000) since = new Date(Date.UTC(1899, 11, 30) + since * 864e5).toISOString().slice(0, 10);   // Excel date
    else since = /^\d{4}-\d{2}-\d{2}/.test(String(since)) ? String(since).slice(0, 10) : (/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/.exec(String(since).trim()) || []).length ? (() => { const m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/.exec(String(since).trim()); return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; })() : "";
    out.push({ site: s, brand, category: catOf(cK >= 0 ? r[cK] : ""), emails: cleanEmails(cE >= 0 ? r[cE] : ""), units: clip(cU >= 0 ? r[cU] : "", 80), since });
  }
  return out;
}
const cleanEmails = v => [...new Set(String(v || "").split(/[\s,;]+/).map(x => x.trim().toLowerCase()).filter(x => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)))].slice(0, 6).join(", ");

/* ---------- opening a PM month at a flagship ---------- */
async function setupFor(env, site, month) {
  const { results } = await env.DB.prepare("SELECT * FROM pm_setup ORDER BY seq, id").all();
  return (results || []).map(r => ({ ...r, cats: JSON.parse(r.cats || "[]"), sites: JSON.parse(r.sites || "[]"), months: JSON.parse(r.months || "[]") }))
    .filter(r => r.sites.includes(site) && r.months.includes(month));
}
export async function pmLaunch(env, site, ym, d, by = "the hub") {
  if (await env.DB.prepare("SELECT 1 FROM pm_cycles WHERE site = ? AND month = ?").bind(site, ym).first()) throw err(`${monthName(ym)} is already open at this flagship`);
  const S = await setupFor(env, site, Number(ym.slice(5)));
  if (!S.length) throw err(`No certificate is due in ${monthName(ym)} at ${d.siteName(site)} — check the setup sheet`);
  const deadline = lastDay(ym), sixMonths = addDays(ym + "-01", -182);
  const { results } = await env.DB.prepare("SELECT * FROM pm_tenants WHERE site = ? AND excluded = 0 AND category != ''").bind(site).all();
  const T = (results || []).filter(t => !t.since || t.since <= sixMonths);
  const cyc = (await env.DB.prepare("INSERT INTO pm_cycles (site, month, deadline, launched_at, launched_by) VALUES (?,?,?,?,?)").bind(site, ym, deadline, d.now(), by).run()).meta.last_row_id;
  const mails = []; let n = 0;
  for (const t of T) {
    const need = S.filter(s => s.cats.includes(t.category));
    if (!need.length) continue;
    const tk = token();
    const rid = (await env.DB.prepare("INSERT INTO pm_records (cycle_id, site, brand, category, emails, token, deadline, last_mail) VALUES (?,?,?,?,?,?,?,?)")
      .bind(cyc, site, t.brand, t.category, t.emails, tk, deadline, d.today()).run()).meta.last_row_id;
    await env.DB.batch(need.map(s => env.DB.prepare("INSERT INTO pm_certs (record_id, site, cert, risk) VALUES (?,?,?,?)").bind(rid, site, s.cert, s.risk)));
    n++;
    if (t.emails) mails.push(tenantMail(d, { site, brand: t.brand, ym, deadline, tk, certs: need.map(s => ({ cert: s.cert, status: "missing" })), kind: "launch", to: t.emails }));
  }
  if (mails.length && d.sendMany) await d.sendMany(env, mails).catch(e => console.error("pm mail", e && e.message));
  return { cycle: cyc, records: n, mailed: mails.length, skipped: (results || []).length - T.length };
}
function tenantMail(d, { site, brand, ym, deadline, tk, certs, kind, to, extra = "" }) {
  const link = `${d.hubUrl}/pm/${tk}`, sn = d.siteName(site);
  const title = kind === "launch" ? `Preventive maintenance — ${monthName(ym)}` : kind === "ext" ? `Preventive maintenance — new deadline ${deadline}` : `Reminder: preventive maintenance certificates — ${monthName(ym)}`;
  const F = "font-family:Calibri,Arial,sans-serif;";
  const rows = certs.map(c => `<tr><td style="${F}padding:5px 10px;border-bottom:1px solid #eee">${escH(c.cert)}</td><td style="${F}padding:5px 10px;border-bottom:1px solid #eee;color:${c.status === "rejected" ? "#B0283C" : c.status === "approved" ? "#1E7A4F" : c.status === "pending" ? "#8A6200" : "#555"}">${{ missing: "To upload", pending: "Under review", approved: "Approved", rejected: "Rejected — upload again" }[c.status] || c.status}${c.reason ? " · " + escH(c.reason) : ""}</td></tr>`).join("");
  const html = `<div style="${F}max-width:620px;color:#22163A"><div style="background:#4A1F73;color:#fff;padding:16px 20px;border-radius:10px 10px 0 0"><b style="font-size:18px">ABC ${escH(sn)}</b><br><span style="opacity:.85">${escH(title)}</span></div>
    <div style="border:1px solid #e4deec;border-top:0;padding:18px 20px;border-radius:0 0 10px 10px">
    <p>Dear ${escH(brand)} team,</p>
    <p>${kind === "launch" ? `As part of the mall's preventive maintenance programme, please upload the following certificates for <b>${escH(monthName(ym))}</b>.` : kind === "ext" ? `The deadline for your preventive maintenance certificates has been extended. Please complete the upload before the new deadline.` : `This is a reminder that the following preventive maintenance certificates are still needed.`}
    ${extra}</p>
    <table style="border-collapse:collapse;width:100%;margin:10px 0">${rows}</table>
    <p><b>Deadline: ${escH(new Date(deadline + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }))}</b></p>
    <p><a href="${link}" style="display:inline-block;background:#4A1F73;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:bold">Upload the certificates</a></p>
    <p style="font-size:12px;color:#777">This link is personal to ${escH(brand)} — no password needed. Certificates not submitted and approved within 5 days after the deadline are treated as a breach of the tenant manual (non-performance of preventive maintenance).</p>
    <p>Kind regards,<br>ABC ${escH(sn)} — Operations Team</p></div></div>`;
  return { to: to.split(/,\s*/), subject: `ABC ${sn} · ${title} · ${brand}`, html };
}

/* ---------- the tenant's link ---------- */
async function recordByToken(env, tk) {
  if (!/^[A-Za-z0-9]{18}$/.test(tk)) throw err("This link is not valid", 404);
  const r = await env.DB.prepare("SELECT r.*, c.month FROM pm_records r JOIN pm_cycles c ON c.id = r.cycle_id WHERE r.token = ?").bind(tk).first();
  if (!r) throw err("This link is not valid or has been replaced", 404);
  return r;
}
export async function pmPublic(env, path, method, b, d) {
  const [tk, act] = path.split("/");
  const r = await recordByToken(env, tk);
  if (!r.opened_at) await env.DB.prepare("UPDATE pm_records SET opened_at = ? WHERE id = ?").bind(d.now(), r.id).run().catch(() => {});
  const certs = (await env.DB.prepare("SELECT id, cert, status, file_name, uploaded_at, reason, comment FROM pm_certs WHERE record_id = ? ORDER BY id").bind(r.id).all()).results || [];
  const closed = d.today() > addDays(r.deadline, 5);
  if (method === "GET") return { brand: r.brand, site: r.site, siteName: d.siteName(r.site), month: r.month, monthLabel: monthName(r.month), deadline: r.deadline,
    completed: !!r.completed_at, closed, certs: certs.map(c => ({ id: c.id, cert: c.cert, status: c.status, file: c.file_name, at: c.uploaded_at, reason: c.reason, comment: c.comment })) };
  if (act === "upload" && method === "POST") {
    if (closed) throw err("The upload period has ended — contact the mall operations team");
    const c = certs.find(x => x.id === Number(b.certId)); if (!c) throw err("Choose the certificate");
    if (c.status === "approved") throw err("This certificate is already approved");
    if (!env.FILES) throw err("File storage is not available right now", 503);
    const m = /^data:([\w/+.-]+);base64,(.+)$/.exec(String(b.data || ""));
    if (!m || !/^(application\/pdf|image\/(jpeg|png|webp|heic))$/.test(m[1])) throw err("Upload a PDF or a photo (JPG / PNG)");
    const bin = Uint8Array.from(atob(m[2]), x => x.charCodeAt(0));
    if (bin.byteLength > MAX_FILE) throw err("The file is larger than 10 MB");
    const key = `pm/${r.id}/${c.id}-${crypto.randomUUID()}`;
    await env.FILES.put(key, bin, { httpMetadata: { contentType: m[1] } });
    await env.DB.prepare("UPDATE pm_certs SET status = 'pending', file_key = ?, file_name = ?, file_type = ?, uploaded_at = ?, reason = '', comment = '' WHERE id = ?")
      .bind(key, clip(b.name, 120) || "certificate", m[1], d.now(), c.id).run();
    return { status: "pending" };
  }
  throw err("Unknown request", 404);
}

/* ---------- hub routes ---------- */
async function recordFull(env, id) {
  const r = await env.DB.prepare("SELECT * FROM pm_records WHERE id = ?").bind(id).first();
  if (!r) return null;
  const certs = (await env.DB.prepare("SELECT * FROM pm_certs WHERE record_id = ? ORDER BY id").bind(id).all()).results || [];
  return { ...r, certs };
}
const certOut = c => ({ id: c.id, cert: c.cert, risk: c.risk, status: c.status, file: c.file_name, type: c.file_type, at: c.uploaded_at, by: c.reviewed_by, reviewedAt: c.reviewed_at, reason: c.reason, comment: c.comment });
async function refreshDone(env, recordId, now) {
  const p = await env.DB.prepare("SELECT COUNT(*) AS n, SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) AS a FROM pm_certs WHERE record_id = ?").bind(recordId).first();
  const done = Number(p.n) > 0 && Number(p.a) === Number(p.n);
  await env.DB.prepare("UPDATE pm_records SET completed_at = CASE WHEN ? THEN CASE WHEN completed_at = '' THEN ? ELSE completed_at END ELSE '' END WHERE id = ?").bind(done ? 1 : 0, now, recordId).run();
  return done;
}
export async function pmRoute(env, p, method, b, url, d) {
  const { site, me } = d, q = n => url.searchParams.get(n) || b[n] || "";
  if (!d.canSite(me, site)) throw err("No access to this flagship", 403);
  const ops = d.isOps(me), boss = d.isBoss(me), today = d.today();
  if (p === "pm/home") {
    const cyc = ((await env.DB.prepare("SELECT * FROM pm_cycles WHERE site = ? ORDER BY month DESC LIMIT 12").bind(site).all()).results) || [];
    const stats = cyc.length ? (await env.DB.prepare(`SELECT r.cycle_id, COUNT(DISTINCT r.id) AS tenants, COUNT(DISTINCT CASE WHEN r.completed_at != '' THEN r.id END) AS done,
        SUM(CASE WHEN c.status = 'pending' THEN 1 ELSE 0 END) AS pending, SUM(CASE WHEN c.status IN ('missing','rejected') THEN 1 ELSE 0 END) AS open,
        COUNT(DISTINCT CASE WHEN r.breach_at != '' THEN r.id END) AS breach
        FROM pm_records r LEFT JOIN pm_certs c ON c.record_id = r.id WHERE r.site = ? GROUP BY r.cycle_id`).bind(site).all()).results || [] : [];
    const S = new Map(stats.map(s => [s.cycle_id, s]));
    const setupN = (await env.DB.prepare("SELECT COUNT(*) AS n FROM pm_setup").first()).n;
    const ten = await env.DB.prepare("SELECT COUNT(*) AS n, SUM(CASE WHEN category = '' THEN 1 ELSE 0 END) AS nocat, SUM(CASE WHEN emails = '' THEN 1 ELSE 0 END) AS nomail FROM pm_tenants WHERE site = ? AND excluded = 0").bind(site).first();
    const ext = (await env.DB.prepare("SELECT e.*, c.month FROM pm_ext e JOIN pm_cycles c ON c.id = e.cycle_id WHERE c.site = ? AND e.status = 'pending'").bind(site).all()).results || [];
    const pendingReview = (await env.DB.prepare("SELECT COUNT(*) AS n FROM pm_certs WHERE site = ? AND status = 'pending'").bind(site).first()).n;
    const next = await nextMonths(env, site, today);
    return { site, siteName: d.siteName(site), today, ops, boss, setup: setupN, tenants: ten, pendingReview, ext, next, cats: PM_CATS, reasons: PM_REASONS, penalty: PENALTY,
      cycles: cyc.map(c => ({ id: c.id, month: c.month, label: monthName(c.month), deadline: c.deadline, launchedAt: c.launched_at, by: c.launched_by, ...(S.get(c.id) || { tenants: 0, done: 0, pending: 0, open: 0, breach: 0 }) })) };
  }
  if (p === "pm/cycle") {
    const c = await env.DB.prepare("SELECT * FROM pm_cycles WHERE id = ? AND site = ?").bind(Number(q("id")), site).first(); if (!c) throw err("Not found", 404);
    const recs = (await env.DB.prepare("SELECT * FROM pm_records WHERE cycle_id = ? ORDER BY brand").bind(c.id).all()).results || [];
    const certs = (await env.DB.prepare("SELECT c.* FROM pm_certs c JOIN pm_records r ON r.id = c.record_id WHERE r.cycle_id = ? ORDER BY c.id").bind(c.id).all()).results || [];
    const by = new Map(); for (const x of certs) (by.get(x.record_id) || by.set(x.record_id, []).get(x.record_id)).push(certOut(x));
    const ext = (await env.DB.prepare("SELECT * FROM pm_ext WHERE cycle_id = ? ORDER BY id DESC").bind(c.id).all()).results || [];
    return { cycle: { id: c.id, month: c.month, label: monthName(c.month), deadline: c.deadline, breachDay: addDays(c.deadline, 5) }, ext,
      records: recs.map(r => ({ id: r.id, brand: r.brand, category: PM_CATS[r.category] || r.category, emails: r.emails, deadline: r.deadline, done: !!r.completed_at, opened: !!r.opened_at,
        breach: r.breach_at, link: ops ? `${d.hubUrl}/pm/${r.token}` : "", certs: by.get(r.id) || [] })) };
  }
  if (p === "pm/queue") {
    const { results } = await env.DB.prepare(`SELECT c.*, r.brand, r.deadline, y.month FROM pm_certs c JOIN pm_records r ON r.id = c.record_id JOIN pm_cycles y ON y.id = r.cycle_id
      WHERE c.site = ? AND c.status = 'pending' ORDER BY c.uploaded_at LIMIT 200`).bind(site).all();
    return { list: (results || []).map(c => ({ ...certOut(c), brand: c.brand, deadline: c.deadline, month: monthName(c.month) })), reasons: PM_REASONS };
  }
  if (p === "pm/file") {
    const c = await env.DB.prepare("SELECT file_key, file_type, file_name FROM pm_certs WHERE id = ? AND site = ?").bind(Number(q("id")), site).first();
    if (!c || !c.file_key || !env.FILES) throw err("No file", 404);
    const o = await env.FILES.get(c.file_key); if (!o) throw err("The file is missing", 404);
    return new Response(o.body, { headers: { "content-type": c.file_type || "application/octet-stream", "content-disposition": `inline; filename="${c.file_name.replace(/"/g, "")}"`, "cache-control": "private, max-age=300" } });
  }
  if (p === "pm/breaches") return { list: await pmBreaches(env, site), penalty: PENALTY };
  if (p === "pm/setup" && method === "GET") {
    const { results } = await env.DB.prepare("SELECT * FROM pm_setup ORDER BY seq, id").all();
    return { list: (results || []).map(r => ({ cert: r.cert, risk: r.risk, cats: JSON.parse(r.cats), sites: JSON.parse(r.sites), months: JSON.parse(r.months) })), cats: PM_CATS };
  }
  if (p === "pm/tenants" && method === "GET") {
    const { results } = await env.DB.prepare("SELECT * FROM pm_tenants WHERE site = ? ORDER BY brand").bind(site).all();
    return { list: (results || []).map(t => ({ brand: t.brand, category: t.category, emails: t.emails, units: t.units, since: t.since, excluded: !!t.excluded })), cats: PM_CATS };
  }
  if (method !== "POST") throw err("Unknown request", 404);
  if (!ops) throw err("Only the operations team manages preventive maintenance", 403);
  if (p === "pm/setup") {   // import the Technical team's Excel (replaces the setup)
    const L = parseSetup(await d.readSheet(clip(b.name, 120), b.data), d.SITES);
    await env.DB.prepare("DELETE FROM pm_setup").run();
    await env.DB.batch(L.map((r, i) => env.DB.prepare("INSERT INTO pm_setup (cert, risk, cats, sites, months, seq) VALUES (?,?,?,?,?,?)")
      .bind(r.cert, r.risk, JSON.stringify(r.cats), JSON.stringify(r.sites), JSON.stringify(r.months), i)));
    return { imported: L.length, list: L };
  }
  if (p === "pm/tenants/import") {
    const L = parseTenants(await d.readSheet(clip(b.name, 120), b.data), d.SITES, site).filter(t => d.canSite(me, t.site));
    if (!L.length) throw err("No tenant found in the sheet");
    const now = d.now();
    for (let i = 0; i < L.length; i += 80) await env.DB.batch(L.slice(i, i + 80).map(t => env.DB.prepare(`INSERT INTO pm_tenants (site, brand, category, emails, units, since, updated_at) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(site, brand) DO UPDATE SET category = CASE WHEN excluded.category != '' THEN excluded.category ELSE pm_tenants.category END,
        emails = CASE WHEN excluded.emails != '' THEN excluded.emails ELSE pm_tenants.emails END, units = CASE WHEN excluded.units != '' THEN excluded.units ELSE pm_tenants.units END,
        since = CASE WHEN excluded.since != '' THEN excluded.since ELSE pm_tenants.since END, updated_at = excluded.updated_at`).bind(t.site, t.brand, t.category, t.emails, t.units, t.since, now)));
    return { imported: L.length };
  }
  if (p === "pm/tenants/fill") {   // from GLA (open tenants) + Tenants Directory emails
    const g = (await env.DB.prepare("SELECT brand, GROUP_CONCAT(code, ', ') AS units FROM gla_units WHERE site = ? AND active = 1 AND section = 'Leasing' AND brand != '' AND status IN ('Open','Fit-out','Closed') GROUP BY brand").bind(site).all()).results || [];
    const dir = (await env.DB.prepare("SELECT tenant, email FROM dir_contacts WHERE site = ? AND email != ''").bind(site).all().catch(() => ({ results: [] }))).results || [];
    const em = new Map(); for (const x of dir) { const k = x.tenant.toLowerCase().trim(); em.set(k, [...(em.get(k) || []), x.email]); }
    const now = d.now();
    for (let i = 0; i < g.length; i += 80) await env.DB.batch(g.slice(i, i + 80).map(t => env.DB.prepare(`INSERT INTO pm_tenants (site, brand, emails, units, updated_at) VALUES (?,?,?,?,?)
      ON CONFLICT(site, brand) DO UPDATE SET units = excluded.units, emails = CASE WHEN pm_tenants.emails = '' THEN excluded.emails ELSE pm_tenants.emails END`)
      .bind(site, clip(t.brand, 100), cleanEmails((em.get(t.brand.toLowerCase().trim()) || []).join(",")), clip(t.units, 80), now)));
    return { added: g.length };
  }
  if (p === "pm/tenants/save") {
    const brand = clip(b.brand, 100); if (!brand) throw err("Brand missing");
    const cat = PM_CATS[b.category] ? b.category : "", since = /^\d{4}-\d{2}-\d{2}$/.test(String(b.since || "")) ? b.since : "";
    await env.DB.prepare(`INSERT INTO pm_tenants (site, brand, category, emails, units, since, excluded, updated_at) VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(site, brand) DO UPDATE SET category = excluded.category, emails = excluded.emails, units = excluded.units, since = excluded.since, excluded = excluded.excluded, updated_at = excluded.updated_at`)
      .bind(site, brand, cat, cleanEmails(b.emails), clip(b.units, 80), since, b.excluded ? 1 : 0, d.now()).run();
    return { saved: true };
  }
  if (p === "pm/launch") {
    const ym = String(b.month || ""); if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) throw err("Choose the month");
    if (ym < today.slice(0, 7)) throw err("This month has passed");
    return pmLaunch(env, site, ym, d, me.full_name);
  }
  if (p === "pm/review") {
    const c = await env.DB.prepare("SELECT * FROM pm_certs WHERE id = ? AND site = ?").bind(Number(b.id), site).first(); if (!c) throw err("Not found", 404);
    if (c.status !== "pending") throw err("This certificate is not waiting for review");
    const ok = b.decision === "approve", reason = clip(b.reason, 80), comment = clip(b.comment, 300);
    if (!ok && !PM_REASONS.includes(reason)) throw err("Choose the reason for the rejection");
    await env.DB.prepare("UPDATE pm_certs SET status = ?, reviewed_by = ?, reviewed_at = ?, reason = ?, comment = ? WHERE id = ?")
      .bind(ok ? "approved" : "rejected", me.full_name, d.now(), ok ? "" : reason, comment, c.id).run();
    const done = await refreshDone(env, c.record_id, d.now());
    if (!ok && d.sendMany) {   // tell the tenant at once, with the link
      const r = await recordFull(env, c.record_id), cy = await env.DB.prepare("SELECT month FROM pm_cycles WHERE id = ?").bind(r.cycle_id).first();
      if (r.emails) await d.sendMany(env, [tenantMail(d, { site, brand: r.brand, ym: cy.month, deadline: r.deadline, tk: r.token, kind: "reminder", to: r.emails,
        extra: `<br><br><b style="color:#B0283C">${escH(c.cert)} was rejected: ${escH(reason)}${comment ? " — " + escH(comment) : ""}.</b> Please upload a corrected certificate.`,
        certs: r.certs.map(x => ({ cert: x.cert, status: x.status, reason: x.status === "rejected" ? x.reason : "" })) })]).catch(() => {});
    }
    return { status: ok ? "approved" : "rejected", recordDone: done };
  }
  if (p === "pm/resend") {   // send the tenant link again (e.g. new email address)
    const r = await recordFull(env, Number(b.id)); if (!r || r.site !== site) throw err("Not found", 404);
    const cy = await env.DB.prepare("SELECT month FROM pm_cycles WHERE id = ?").bind(r.cycle_id).first();
    if (b.emails) { r.emails = cleanEmails(b.emails); await env.DB.prepare("UPDATE pm_records SET emails = ? WHERE id = ?").bind(r.emails, r.id).run(); }
    if (!r.emails) throw err("No email for this tenant — add one");
    await d.sendMany(env, [tenantMail(d, { site, brand: r.brand, ym: cy.month, deadline: r.deadline, tk: r.token, kind: "reminder", to: r.emails, certs: r.certs.map(x => ({ cert: x.cert, status: x.status, reason: x.reason })) })]);
    return { sent: true };
  }
  if (p === "pm/ext/request") {
    const c = await env.DB.prepare("SELECT * FROM pm_cycles WHERE id = ? AND site = ?").bind(Number(b.cycle), site).first(); if (!c) throw err("Not found", 404);
    const risk = RISKS.includes(b.risk) ? b.risk : ""; if (!risk) throw err("Choose the risk level");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.deadline || "")) || b.deadline <= c.deadline) throw err("The new deadline must be after " + c.deadline);
    await env.DB.prepare("INSERT INTO pm_ext (cycle_id, risk, deadline, note, requested_by, requested_at) VALUES (?,?,?,?,?,?)").bind(c.id, risk, b.deadline, clip(b.note, 200), me.full_name, d.now()).run();
    if (d.raiseEvent) await d.raiseEvent(env, { site, app: "pm-ops", tone: "warn", title: `PM extension to approve · ${monthName(c.month)} · ${risk}`, body: `New deadline ${b.deadline} · asked by ${me.full_name}` }).catch(() => {});
    return { requested: true };
  }
  if (p === "pm/ext/decide") {
    if (!boss) throw err("Only management approves deadline extensions", 403);
    const e = await env.DB.prepare("SELECT e.*, c.site, c.month FROM pm_ext e JOIN pm_cycles c ON c.id = e.cycle_id WHERE e.id = ? AND e.status = 'pending'").bind(Number(b.id)).first();
    if (!e || e.site !== site) throw err("Not found", 404);
    const approve = b.decision === "approve";
    await env.DB.prepare("UPDATE pm_ext SET status = ?, decided_by = ?, decided_at = ? WHERE id = ?").bind(approve ? "approved" : "refused", me.full_name, d.now(), e.id).run();
    if (approve) await applyExtensions(env, e.cycle_id);
    return { status: approve ? "approved" : "refused" };
  }
  throw err("Unknown request", 404);
}
/* new deadline per record from the approved extensions: the highest-risk pending certificate decides (High > Medium > Low) */
async function applyExtensions(env, cycleId) {
  const E = Object.fromEntries(((await env.DB.prepare("SELECT risk, deadline FROM pm_ext WHERE cycle_id = ? AND status = 'approved' ORDER BY id").bind(cycleId).all()).results || []).map(x => [x.risk, x.deadline]));
  const base = (await env.DB.prepare("SELECT deadline FROM pm_cycles WHERE id = ?").bind(cycleId).first()).deadline;
  const recs = (await env.DB.prepare("SELECT id, deadline FROM pm_records WHERE cycle_id = ? AND completed_at = ''").bind(cycleId).all()).results || [];
  for (const r of recs) {
    const risks = new Set(((await env.DB.prepare("SELECT risk FROM pm_certs WHERE record_id = ? AND status != 'approved'").bind(r.id).all()).results || []).map(x => x.risk));
    const top = RISKS.find(k => risks.has(k));
    const nd = top && E[top] ? E[top] : base;
    if (nd !== r.deadline) await env.DB.prepare("UPDATE pm_records SET deadline = ?, ext_mail = 0, breach_at = '' WHERE id = ?").bind(nd, r.id).run();
  }
}
/* the next PM months at a flagship (from the setup) */
async function nextMonths(env, site, today) {
  const { results } = await env.DB.prepare("SELECT sites, months FROM pm_setup").all();
  const M = new Set(); for (const r of results || []) if (JSON.parse(r.sites).includes(site)) for (const m of JSON.parse(r.months)) M.add(m);
  const out = []; let [y, m] = today.split("-").map(Number);
  for (let i = 0; i < 13 && out.length < 3; i++) { const ym = `${y}-${String(m).padStart(2, "0")}`; if (M.has(m)) out.push({ month: ym, label: monthName(ym), launch: addDays(ym + "-01", -15), deadline: lastDay(ym) }); m++; if (m > 12) { m = 1; y++; } }
  return out;
}

/* ---------- cron: launch, weekly reminders, extension reminder, breaches (once a day from 09:00) ---------- */
export async function pmRun(env, d) {
  if (d.hour() < 9) return;
  const today = d.today();
  const g = await env.DB.prepare("SELECT v FROM meta WHERE k = 'pm:run'").first().catch(() => null);
  if (g && g.v === today) return;
  await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('pm:run', ?)").bind(today).run();
  if (!(await env.DB.prepare("SELECT 1 FROM pm_setup LIMIT 1").first())) return;
  /* 1. launch: 15 days before each PM month */
  for (const site of Object.keys(d.SITES)) for (const n of await nextMonths(env, site, today))
    if (today >= n.launch && today <= addDays(n.month + "-01", 6) && !(await env.DB.prepare("SELECT 1 FROM pm_cycles WHERE site = ? AND month = ?").bind(site, n.month).first()))
      await pmLaunch(env, site, n.month, d).then(r => d.raiseEvent && d.raiseEvent(env, { site, app: "pm-ops", tone: "info", title: `PM ${n.label} opened`, body: `${r.records} tenants · ${r.mailed} emailed` })).catch(e => console.error("pm launch", e && e.message));
  /* 2. weekly reminders until the deadline · 7-day reminder before an extended deadline */
  const open = (await env.DB.prepare(`SELECT r.*, c.month, c.deadline AS base FROM pm_records r JOIN pm_cycles c ON c.id = r.cycle_id
    WHERE r.completed_at = '' AND r.breach_at = '' AND r.emails != '' AND r.deadline >= ? LIMIT 500`).bind(today).all()).results || [];
  const mails = [];
  for (const r of open) {
    const certs = (await env.DB.prepare("SELECT cert, status, reason FROM pm_certs WHERE record_id = ?").bind(r.id).all()).results || [];
    const missing = certs.some(c => c.status === "missing" || c.status === "rejected");
    const extended = r.deadline > r.base, extDue = extended && !r.ext_mail && today >= addDays(r.deadline, -7);
    if (extDue) {
      mails.push(tenantMail(d, { site: r.site, brand: r.brand, ym: r.month, deadline: r.deadline, tk: r.token, kind: "ext", to: r.emails, certs }));
      await env.DB.prepare("UPDATE pm_records SET ext_mail = 1, last_mail = ? WHERE id = ?").bind(today, r.id).run();
    } else if (missing && (!r.last_mail || r.last_mail <= addDays(today, -7))) {
      mails.push(tenantMail(d, { site: r.site, brand: r.brand, ym: r.month, deadline: r.deadline, tk: r.token, kind: "reminder", to: r.emails, certs }));
      await env.DB.prepare("UPDATE pm_records SET last_mail = ? WHERE id = ?").bind(today, r.id).run();
    }
  }
  if (mails.length && d.sendMany) await d.sendMany(env, mails).catch(e => console.error("pm reminders", e && e.message));
  /* 3. breaches: 5 days after the (possibly extended) deadline */
  const late = (await env.DB.prepare("SELECT id, site, brand FROM pm_records WHERE completed_at = '' AND breach_at = '' AND deadline < ?").bind(addDays(today, -5)).all()).results || [];
  const bySite = {};
  for (const r of late) { await env.DB.prepare("UPDATE pm_records SET breach_at = ? WHERE id = ?").bind(today, r.id).run(); (bySite[r.site] = bySite[r.site] || []).push(r.brand); }
  for (const [site, L] of Object.entries(bySite)) if (d.raiseEvent) await d.raiseEvent(env, { site, app: "pm-ops", tone: "alert", title: `PM breaches · ${L.length} tenant${L.length === 1 ? "" : "s"}`,
    body: `${L.slice(0, 6).join(", ")}${L.length > 6 ? "…" : ""} — raise "Non-performance of preventive maintenance" ($${PENALTY}) in the portal` }).catch(() => {});
}
/* breach list for the portal team (all cycles of the flagship) */
export async function pmBreaches(env, site) {
  const { results } = await env.DB.prepare(`SELECT r.id, r.brand, r.category, r.deadline, r.breach_at, c.month,
      (SELECT GROUP_CONCAT(cert, ' · ') FROM pm_certs WHERE record_id = r.id AND status != 'approved') AS missing
    FROM pm_records r JOIN pm_cycles c ON c.id = r.cycle_id WHERE r.site = ? AND r.breach_at != '' ORDER BY r.breach_at DESC, r.brand`).bind(site).all();
  return (results || []).map(r => ({ id: r.id, brand: r.brand, category: PM_CATS[r.category] || r.category, month: monthName(r.month), deadline: r.deadline, breachAt: r.breach_at, missing: r.missing || "",
    violation: "Beneficiary's Non-Performance of preventive maintenance", amount: PENALTY }));
}
