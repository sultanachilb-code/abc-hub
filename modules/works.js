/* =====================================================================
   TENANT WORKS FORMS — feature module (kept separate so it can be removed cleanly)
   See docs/FEATURE-tenant-works.md

   RDM sends a form (PDF) → a supervisor forwards the email to the flagship's hub address
   → the Gmail inbox script posts the PDF here → the team signs it in the hub.

   Forms and who signs (only the boxes that belong to Operations / the tenant):
     Approval to Start on Site  → Operations acknowledge (no signature box for us)
     Handover to Beneficiary    → Operations Rep  →  Beneficiary (tenant, signs on our device)
     Approval to Trade          → Operations acknowledge (Operations Manager is in Cc)
     Return of Area to ABC      → Operation Manager box (a supervisor or the manager signs)

   Signatures are stamped on the PDF in the browser (pdf-lib); the server keeps every version.
   Tables : works_forms · works_blobs
   Routes : /api/inbox/works (Gmail script, x-inbox-key) · /api/ops/works/* (signed in)
   Page   : /tools/works
   ===================================================================== */

const err = (m, status = 400) => Object.assign(new Error(m), { status });
const clip = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
const MAX_BYTES = 8 * 1024 * 1024;          // per PDF
const CHUNK = 900000;                        // base64 characters per row (D1 values stay under 1 MB)

export const WORK_TYPES = {
  start:    { name: "Approval to Start on Site", code: "F06.5", steps: [{ key: "ack", label: "Operations acknowledge", kind: "ack" }] },
  handover: { name: "Handover to Beneficiary",   code: "F06.2", steps: [
                { key: "ops", label: "Operations Rep", kind: "sign", who: "ops", anchor: "Operations? Rep" },
                { key: "tenant", label: "Beneficiary (tenant)", kind: "sign", who: "tenant", anchor: "Beneficiary Name" }] },
  trade:    { name: "Approval to Trade",         code: "F08.2", steps: [{ key: "ack", label: "Operations acknowledge", kind: "ack" }] },
  return:   { name: "Return of Area to ABC",     code: "F09.1", steps: [{ key: "ops", label: "Operation Manager", kind: "sign", who: "ops", anchor: "Operations? Manager" }] }
};

export async function worksSchema(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS works_forms (id INTEGER PRIMARY KEY AUTOINCREMENT, site TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT '', unit_id INTEGER NOT NULL DEFAULT 0, tenant TEXT NOT NULL DEFAULT '', unit TEXT NOT NULL DEFAULT '',
      level TEXT NOT NULL DEFAULT '', tenant_status TEXT NOT NULL DEFAULT '', file_name TEXT NOT NULL DEFAULT '', bytes INTEGER NOT NULL DEFAULT 0,
      ver INTEGER NOT NULL DEFAULT 0, done TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'setup',
      from_email TEXT NOT NULL DEFAULT '', from_name TEXT NOT NULL DEFAULT '', subject TEXT NOT NULL DEFAULT '', msg_id TEXT NOT NULL DEFAULT '',
      via TEXT NOT NULL DEFAULT 'email', received_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '', completed_at TEXT NOT NULL DEFAULT '',
      deleted INTEGER NOT NULL DEFAULT 0)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS works_forms_site ON works_forms (site, deleted, received_at)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS works_blobs (form_id INTEGER NOT NULL, ver INTEGER NOT NULL, seq INTEGER NOT NULL, data TEXT NOT NULL,
      PRIMARY KEY (form_id, ver, seq))`)
  ]);
}

/* ---------- helpers ---------- */
const parseDone = s => { try { return JSON.parse(s || "{}") || {}; } catch { return {}; } };
function nextStatus(type, done) {
  const T = WORK_TYPES[type];
  if (!T) return "setup";
  const step = T.steps.find(s => !done[s.key]);
  return step ? step.key : "done";
}
const STATUS_LABEL = { setup: "Choose form & tenant", ack: "Waiting for Operations", ops: "Waiting for Operations", tenant: "Waiting for Tenant", done: "Completed" };
function out(r) {
  const T = WORK_TYPES[r.type];
  return { id: r.id, site: r.site, type: r.type, typeName: T ? T.name : "", unitId: r.unit_id, tenant: r.tenant, unit: r.unit, level: r.level,
    tenantStatus: r.tenant_status, fileName: r.file_name, bytes: r.bytes, ver: r.ver, done: parseDone(r.done), status: r.status,
    statusLabel: STATUS_LABEL[r.status] || r.status, steps: T ? T.steps : [], fromEmail: r.from_email, fromName: r.from_name, subject: r.subject,
    via: r.via, receivedAt: r.received_at, updatedAt: r.updated_at, completedAt: r.completed_at };
}
function b64Bytes(b64) { const s = String(b64 || "").replace(/^data:[^,]*,/, "").replace(/\s+/g, ""); return { s, n: Math.floor(s.length * 3 / 4) - (s.endsWith("==") ? 2 : s.endsWith("=") ? 1 : 0) }; }
function isPdf(b64) { try { return atob(b64.slice(0, 8)).startsWith("%PDF"); } catch { return false; } }
async function putBlob(env, id, ver, b64) {
  const parts = []; for (let i = 0; i < b64.length; i += CHUNK) parts.push(b64.slice(i, i + CHUNK));
  await env.DB.batch(parts.map((p, i) => env.DB.prepare("INSERT OR REPLACE INTO works_blobs (form_id, ver, seq, data) VALUES (?,?,?,?)").bind(id, ver, i, p)));
}
async function getBlob(env, id, ver) {
  const { results } = await env.DB.prepare("SELECT data FROM works_blobs WHERE form_id = ? AND ver = ? ORDER BY seq").bind(id, ver).all();
  return (results || []).map(r => r.data).join("");
}
const statusOf = s => /fit/i.test(s) ? "Fit-out" : /termin/i.test(s) ? "Terminated" : /clos/i.test(s) ? "Closed" : /reserv/i.test(s) ? "Reserved" : /vacant/i.test(s) ? "Vacant" : s ? (/active|open/i.test(s) ? "Open" : s) : "";

/* Adds one received PDF. Used by the Gmail inbox script and by "Add form" in the hub. */
async function addForm(env, d, { site, fromEmail, fromName, subject = "", msgId = "", via, name, data }) {
  const { s, n } = b64Bytes(data);
  const fileName = clip(name || "form.pdf", 160);
  if (!/\.pdf$/i.test(fileName) && !isPdf(s)) throw err(`${fileName}: only PDF files are accepted`);
  if (!isPdf(s)) throw err(`${fileName}: the file is not a valid PDF`);
  if (n > MAX_BYTES) throw err(`${fileName}: larger than 8 MB`);
  if (msgId) {
    const dup = await env.DB.prepare("SELECT id FROM works_forms WHERE msg_id = ? AND file_name = ? AND deleted = 0").bind(msgId, fileName).first();
    if (dup) return { id: dup.id, duplicate: true };
  }
  const now = d.now();
  const r = await env.DB.prepare(`INSERT INTO works_forms (site, file_name, bytes, from_email, from_name, subject, msg_id, via, received_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(site, fileName, n, fromEmail, fromName, clip(subject, 200), clip(msgId, 200), via, now, now).run();
  const id = r.meta.last_row_id;
  await putBlob(env, id, 0, s);
  await d.raiseEvent(env, { site, app: "works", title: "Tenant work form received", body: `${fileName} — from ${fromName || fromEmail}`, tone: "warn" });
  return { id };
}

/* ---------- Gmail inbox script → hub (no session; shared key) ---------- */
export async function worksInbox(env, request, body, d) {
  if (!env.INBOX_KEY) throw err("The hub inbox is not set up (INBOX_KEY secret is missing)", 503);
  const key = request.headers.get("x-inbox-key") || "";
  if (key.length !== env.INBOX_KEY.length || key !== env.INBOX_KEY) throw err("Wrong inbox key", 403);
  const site = String(body.site || "").toUpperCase();
  if (!d.SITES[site]) throw err("Unknown flagship in the address");
  const from = clip(body.from, 160).toLowerCase();
  const u = await env.DB.prepare("SELECT * FROM users WHERE lower(email) = ? AND active = 1").bind(from).first();
  if (!u) return { accepted: false, reason: `${from || "The sender"} is not a hub user — ignored` };
  if (!d.canSite(u, site)) return { accepted: false, reason: `${u.full_name} has no access to ${d.SITES[site]} — ignored` };
  const files = Array.isArray(body.files) ? body.files.slice(0, 10) : [];
  if (!files.length) return { accepted: false, reason: "No PDF attached" };
  const added = [], rejected = [];
  for (const f of files) {
    try { const r = await addForm(env, d, { site, fromEmail: u.email, fromName: u.full_name, subject: body.subject, msgId: body.msgId, via: "email", name: f.name, data: f.data });
      added.push({ name: f.name, id: r.id, duplicate: !!r.duplicate }); }
    catch (e) { rejected.push({ name: f.name, reason: e.message }); }
  }
  return { accepted: added.length > 0, added, rejected };
}

/* ---------- PDF download (returns a Response) ---------- */
export async function worksFile(env, me, url, d) {
  const id = Number(url.searchParams.get("id")) || 0;
  const r = await env.DB.prepare("SELECT * FROM works_forms WHERE id = ? AND deleted = 0").bind(id).first();
  if (!r || !d.canSite(me, r.site)) return new Response("Not found", { status: 404 });
  const v = url.searchParams.has("v") ? Math.max(0, Math.min(r.ver, Number(url.searchParams.get("v")) || 0)) : r.ver;
  const b64 = await getBlob(env, id, v);
  const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const base = r.file_name.replace(/\.pdf$/i, "");
  const name = `${base}${v === 0 ? "" : r.status === "done" ? " (signed)" : " (in progress)"}.pdf`.replace(/["\\]/g, "");
  return new Response(bin, { headers: { "content-type": "application/pdf", "cache-control": "private, no-store",
    "content-disposition": `${url.searchParams.get("dl") ? "attachment" : "inline"}; filename="${name}"` } });
}

/* ---------- signed-in routes: /api/ops/works/* ---------- */
export async function worksRoute(env, p, method, b, url, d) {
  const { site, me } = d;
  const mine = d.canSite(me, site);
  const team = mine && (d.full || (me.role === "SUPERVISOR" && me.position !== "WH"));          // supervisors and managers sign for Operations
  const canDelete = mine && d.full;
  const one = async id => {
    const r = await env.DB.prepare("SELECT * FROM works_forms WHERE id = ? AND deleted = 0").bind(Number(id) || 0).first();
    if (!r || !d.canSite(me, r.site)) throw err("Form not found", 404);
    return r;
  };

  if (p === "works/list") {
    const { results } = await env.DB.prepare("SELECT * FROM works_forms WHERE site = ? AND deleted = 0 ORDER BY received_at DESC LIMIT 400").bind(site).all();
    return { forms: (results || []).map(out), types: Object.fromEntries(Object.entries(WORK_TYPES).map(([k, v]) => [k, { name: v.name, code: v.code, steps: v.steps }])),
      can: { sign: team, add: team, delete: canDelete }, inbox: !!env.INBOX_KEY };
  }
  if (p === "works/get") return { form: out(await one(url.searchParams.get("id"))), can: { sign: team, delete: canDelete } };

  if (p === "works/tenants") {   // every GLA tenant of the flagship, whatever its status (fit-out, open, closed …)
    const { results } = await env.DB.prepare("SELECT id, level, code, brand, status FROM gla_units WHERE site = ? AND brand != '' ORDER BY seq, id").bind(site).all()
      .catch(() => ({ results: [] }));
    return { tenants: (results || []).filter(u => !/^vacant/i.test(u.brand)).map(u => ({ id: u.id, name: u.brand, unit: u.code, level: u.level, status: statusOf(u.status) })) };
  }

  if (method !== "POST") throw err("Unknown request", 404);

  if (p === "works/add") {
    if (!team) throw err("Only the operations team can add forms", 403);
    return addForm(env, d, { site, fromEmail: me.email, fromName: me.full_name, via: "upload", name: b.name, data: b.data });
  }

  if (p === "works/setup") {   // form type + tenant
    if (!team) throw err("Only the operations team can change this form", 403);
    const r = await one(b.id);
    if (r.status === "done") throw err("This form is completed");
    const type = WORK_TYPES[b.type] ? b.type : "";
    let unit = { id: 0, brand: clip(b.tenant, 120), code: "", level: "", status: "" };
    if (Number(b.unitId)) {
      const u = await env.DB.prepare("SELECT id, brand, code, level, status FROM gla_units WHERE id = ? AND site = ?").bind(Number(b.unitId), r.site).first();
      if (!u) throw err("Tenant not found in the GLA");
      unit = u;
    }
    const done = type === r.type ? parseDone(r.done) : {};       // changing the form type starts the signatures again
    if (type !== r.type && r.ver > 0) throw err("Signatures were already added — delete the form and add it again to change its type");
    const status = unit.brand ? nextStatus(type, done) : "setup";
    await env.DB.prepare(`UPDATE works_forms SET type = ?, unit_id = ?, tenant = ?, unit = ?, level = ?, tenant_status = ?, done = ?, status = ?, updated_at = ? WHERE id = ?`)
      .bind(type, unit.id || 0, unit.brand || "", unit.code || "", unit.level || "", statusOf(unit.status), JSON.stringify(done), status, d.now(), r.id).run();
    return { form: out(await one(r.id)) };
  }

  if (p === "works/sign" || p === "works/ack") {
    const r = await one(b.id);
    if (r.status === "setup") throw err("Choose the form and the tenant first");
    if (r.status === "done") throw err("This form is already completed");
    const T = WORK_TYPES[r.type], step = T.steps.find(s => s.key === r.status);
    if (!step || step.key !== b.step) throw err("This step is not the current one — refresh the page");
    if (!team) throw err("Only a supervisor or a manager of this flagship can do this step", 403);
    const done = parseDone(r.done);
    let ver = r.ver;
    if (step.kind === "sign") {
      if (Number(b.ver) !== r.ver) throw err("Someone signed this form a moment ago — refresh the page");
      const { s, n } = b64Bytes(b.pdf);
      if (!isPdf(s)) throw err("The signed file is not a valid PDF");
      if (n > MAX_BYTES * 1.5) throw err("The signed file is too large");
      ver = r.ver + 1;
      await putBlob(env, r.id, ver, s);
      done[step.key] = { name: clip(b.name, 120) || me.full_name, by: me.full_name, email: me.email, at: d.now() };
    } else {
      done[step.key] = { name: me.full_name, by: me.full_name, email: me.email, at: d.now(), note: clip(b.note, 300) };
    }
    const status = nextStatus(r.type, done), now = d.now();
    await env.DB.prepare("UPDATE works_forms SET done = ?, status = ?, ver = ?, updated_at = ?, completed_at = ? WHERE id = ?")
      .bind(JSON.stringify(done), status, ver, now, status === "done" ? now : "", r.id).run();
    if (ver > 1) await env.DB.prepare("DELETE FROM works_blobs WHERE form_id = ? AND ver > 0 AND ver < ?").bind(r.id, ver).run();   // keep the original + the latest
    const label = `${T.name} — ${r.tenant}${r.unit ? " (" + r.unit + ")" : ""}`;
    if (status === "done") await d.raiseEvent(env, { site: r.site, app: "works", title: "Tenant work form completed", body: label, tone: "info" });
    else if (status === "tenant") await d.raiseEvent(env, { site: r.site, app: "works", title: "Form ready for the tenant's signature", body: label, tone: "info" });
    return { form: out(await one(r.id)) };
  }

  if (p === "works/delete") {
    if (!canDelete) throw err("Only a manager can delete a form", 403);
    const r = await one(b.id);
    await env.DB.prepare("UPDATE works_forms SET deleted = 1, updated_at = ? WHERE id = ?").bind(d.now(), r.id).run();
    await env.DB.prepare("DELETE FROM works_blobs WHERE form_id = ?").bind(r.id).run();
    return { deleted: true };
  }
  throw err("Unknown request", 404);
}
