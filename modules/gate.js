/* =====================================================================
   LOADING GATE — QR scanner for the loading area (kept separate so it can be removed cleanly)
   See docs/FEATURE-gate.md

   The loading agent scans the contractor's Tenant Connect QR code (a Salesforce link with ?recordId=…).
   The hub asks Salesforce live and shows the request status (APPROVED / REJECTED stamp), REQ number,
   contractor, tenant, sender and permit window. The agent presses  APPROVED · IN  (green)  or  REJECTED · OUT  (red).

   • Approved request → one tap to let in.     Rejected request → one tap to refuse.
   • Letting in a rejected / not-approved / out-of-time request needs a reason (override → the flagship is notified).
   • Refusing an approved request needs a reason too.
   • Approved in → the contractor is checked in on Contractors (Day to Day timeline shows "On site").
   • Every decision appears live in the Shift Handover ("Loading area gate") and in the handover email.

   Salesforce is reached with a Connected App (client-credentials flow, SF_* settings — docs/FEATURE-gate.md).
   Without it, or without signal, the agent opens the pass and says what the stamp shows (Approved / Rejected).

   Tables : gate_scans  (+ column sf_id on contractor_visits)
   Routes : /api/ops/gate/lookup · gate/decide · gate/day      Page : /tools/gate
   ===================================================================== */
import { dayList } from "./contractors.js";

const err = (m, status = 400) => Object.assign(new Error(m), { status });
const clip = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
const isDay = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));
const isHM = v => /^\d{2}:\d{2}$/.test(String(v || ""));
const EARLY_MIN = 30;   // a contractor may be let in up to 30 minutes before the permit starts
export const GATE_REASONS = ["Permit expired", "Permit not started yet", "Request not approved", "Wrong tenant / unit", "ID does not match",
  "Contractor blocked", "No insurance", "Unsafe / missing PPE", "Other"];

export async function gateSchema(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS gate_scans (id INTEGER PRIMARY KEY AUTOINCREMENT, site TEXT NOT NULL, day TEXT NOT NULL, at TEXT NOT NULL,
      client_id TEXT NOT NULL DEFAULT '', decision TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', override INTEGER NOT NULL DEFAULT 0, verdict TEXT NOT NULL DEFAULT '',
      sf_id TEXT NOT NULL DEFAULT '', req TEXT NOT NULL DEFAULT '', tenant TEXT NOT NULL DEFAULT '', contractor TEXT NOT NULL DEFAULT '', work TEXT NOT NULL DEFAULT '',
      valid_from TEXT NOT NULL DEFAULT '', valid_to TEXT NOT NULL DEFAULT '', workers INTEGER NOT NULL DEFAULT 0, visit_id INTEGER NOT NULL DEFAULT 0,
      by_name TEXT NOT NULL DEFAULT '', by_email TEXT NOT NULL DEFAULT '', scanned_at TEXT NOT NULL DEFAULT '')`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS gate_scans_day ON gate_scans (site, day)`),
    env.DB.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS gate_scans_client ON gate_scans (site, client_id) WHERE client_id != ''`),
    /* Loading-area phones (separate Loading Gate link, no hub account): paired once by a manager, revocable */
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS gate_devices (id INTEGER PRIMARY KEY AUTOINCREMENT, site TEXT NOT NULL, name TEXT NOT NULL,
      token_hash TEXT NOT NULL DEFAULT '', pair_hash TEXT NOT NULL DEFAULT '', pair_exp TEXT NOT NULL DEFAULT '', created_name TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT '', paired_at TEXT NOT NULL DEFAULT '', last_seen TEXT NOT NULL DEFAULT '', last_agent TEXT NOT NULL DEFAULT '', revoked INTEGER NOT NULL DEFAULT 0)`)
  ]);
  const cols = (await env.DB.prepare("PRAGMA table_info(contractor_visits)").all()).results || [];
  if (cols.length && !cols.some(c => c.name === "sf_id")) await env.DB.prepare("ALTER TABLE contractor_visits ADD COLUMN sf_id TEXT NOT NULL DEFAULT ''").run();
}

/* ---------- Beirut clock ---------- */
const beirut = (d = new Date()) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Beirut", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
    .formatToParts(d).map(x => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, time: `${p.hour === "24" ? "00" : p.hour}:${p.minute}` };
};
const addMin = (w, n) => { const t = new Date(`${w.day}T${w.time || "00:00"}:00Z`); t.setUTCMinutes(t.getUTCMinutes() + n); return t.toISOString().slice(0, 16).replace("T", " "); };
const key = (w, dflt) => `${w.day} ${w.time || dflt}`;

/* ---------- what is in the QR ---------- */
export function parseCode(raw) {
  const t = String(raw || "").trim().slice(0, 600);
  let sfId = "", req = "";
  const m = t.match(/[?&#](?:recordId|id)=([a-zA-Z0-9]{15,18})\b/);
  if (m) sfId = m[1];
  else if (/^[a-zA-Z0-9]{15,18}$/.test(t) && !/^REQ/i.test(t)) sfId = t;
  const r = t.match(/\bREQ[-\s]?(\d{3,})\b/i) || t.match(/[?&#]req=(?:REQ-?)?(\d{3,})\b/i);   // the pass QR can carry the REQ number: …?recordId=a0G…&req=REQ-008936
  if (r) req = "REQ-" + r[1];
  else if (/^\d{4,}$/.test(t)) req = "REQ-" + t;   // typed by hand: just the number
  return { raw: t, sfId, req };
}
const reqDigits = r => String(r || "").replace(/\D/g, "");

/* ---------- the pass page itself (no set-up) ----------
   The QR opens the public Tenant Connect page …/ABCQRCode/s/?recordId=…, which runs the screen flow "QRCodeFlow".
   The hub starts that same flow (the guest call the page makes) and reads what the page shows:
   Request Name, Contractor / Supplier, Sender, Account, Date and Valid From / To, and IsApproved (APPROVED / REJECTED stamp). */
const PASS_HOSTS = ["abclebanon.my.site.com"];
const passDate = v => { const m = String(v || "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:,?\s*(\d{1,2}):(\d{2}))?/);
  return m ? { day: `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`, time: m[4] ? `${m[4].padStart(2, "0")}:${m[5]}` : "" } : null; };
export function passMap(res) {
  const L = [];
  const walk = list => { for (const f of list || []) { if (f && f.label && typeof f.value === "string" && f.value.trim()) L.push([String(f.label).trim(), f.value.trim()]); if (f && f.fields) walk(f.fields); } };
  walk(res.fields);
  const get = (...res2) => { for (const re of res2) { const h = L.find(([l]) => re.test(l)); if (h) return h[1]; } return ""; };
  const ap = (res.outputVariables || []).find(o => o.name === "IsApproved");
  const req = get(/^request name$/i, /request/i);
  return {
    req: /^REQ-?\d+$/i.test(req) ? req.toUpperCase() : "", contractor: clip(get(/contractor|supplier/i), 160), sender: clip(get(/sender/i), 120),
    tenant: clip(get(/^account$/i, /tenant/i), 160).replace(/\s+(ABC\s+)?(Verdun|Achrafieh|Dbayeh)(\s+(Mall|Department Store|DS))?$/i, ""),
    work: clip([get(/^maintenance type$/i), get(/^sub maintenance$/i)].filter(Boolean).join(" · "), 120),
    desc: clip(get(/notes and description/i, /^description$/i), 500),
    from: passDate(get(/^valid from$/i, /^date from$/i)), to: passDate(get(/^valid (to|until)$/i, /^date to$/i)),
    status: ap && ap.value === true ? "Approved" : ap && ap.value === false ? "Rejected" : "",
    fields: L.slice(0, 40)
  };
}
async function passRecord(env, code) {
  let u; try { u = new URL(code.raw); } catch { return null; }
  const hosts = [...PASS_HOSTS, ...String(env.PASS_HOSTS || "").split(",").map(x => x.trim()).filter(Boolean)];
  if (u.protocol !== "https:" || !hosts.includes(u.hostname) || !code.sfId) return null;   // only our own Tenant Connect site
  const prefix = (u.pathname.match(/^\/[\w-]+(?=\/s\/)/) || ["/ABCQRCode"])[0];
  const msg = { actions: [{ id: "1;a", descriptor: "aura://FlowRuntimeConnectController/ACTION$startFlow", callingDescriptor: "UNKNOWN",
    params: { flowDevName: env.PASS_FLOW || "QRCodeFlow", arguments: JSON.stringify([{ name: "recordId", type: "String", value: code.sfId }]) } }] };
  const body = new URLSearchParams({ message: JSON.stringify(msg), "aura.context": JSON.stringify({ mode: "PROD", app: "siteforce:communityApp" }),
    "aura.pageURI": `${prefix}/s/?recordId=${code.sfId}`, "aura.token": "null" });
  const ac = new AbortController(), tm = setTimeout(() => ac.abort(), 7000);
  try {
    const r = await fetch(`https://${u.hostname}${prefix}/s/sfsites/aura?r=1&aura.FlowRuntimeConnect.startFlow=1`,
      { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" }, body, signal: ac.signal });
    const t = await r.text();
    if (!r.ok) throw new Error(`Tenant Connect answered ${r.status}`);
    const j = JSON.parse(t.replace(/^\s*while\(1\);\s*/, ""));
    const a = j.actions && j.actions[0];
    if (!a || a.state !== "SUCCESS" || !a.returnValue || !a.returnValue.response) throw new Error("Tenant Connect could not open this pass");
    const m = passMap(a.returnValue.response);
    if (!m.req && !m.contractor) throw new Error("This pass was not found in Tenant Connect");
    return m;
  } catch (e) { throw new Error(e.name === "AbortError" ? "Tenant Connect is slow to answer" : e.message); }
  finally { clearTimeout(tm); }
}

/* ---------- Salesforce (optional) ----------
   Settings (Cloudflare → operations-hub → Settings → Variables and Secrets):
     SF_DOMAIN        e.g. abclebanon.my.salesforce.com           (variable)
     SF_CLIENT_ID     Connected App consumer key                  (secret)
     SF_CLIENT_SECRET Connected App consumer secret               (secret)
     SF_FIELDS        optional JSON to pin field names, e.g. {"tenant":"Account__r","from":"Valid_From__c"} */
const sfOn = env => !!(env.SF_DOMAIN && env.SF_CLIENT_ID && env.SF_CLIENT_SECRET);
async function sfToken(env, fresh) {
  if (!fresh) {
    const c = await env.DB.prepare("SELECT v FROM meta WHERE k = 'gate:sftoken'").first().catch(() => null);
    if (c) { try { const t = JSON.parse(c.v); if (t.exp > Date.now()) return t; } catch {} }
  }
  const dom = String(env.SF_DOMAIN).replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const r = await fetch(`https://${dom}/services/oauth2/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: env.SF_CLIENT_ID, client_secret: env.SF_CLIENT_SECRET }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`Salesforce sign-in failed (${j.error_description || j.error || r.status})`);
  const t = { token: j.access_token, inst: j.instance_url || `https://${dom}`, exp: Date.now() + 45 * 60000 };
  await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('gate:sftoken', ?)").bind(JSON.stringify(t)).run().catch(() => {});
  return t;
}
async function sfRecord(env, id) {
  let t = await sfToken(env);
  const get = tk => fetch(`${tk.inst}/services/data/v61.0/ui-api/records/${id}?layoutTypes=Full&modes=View`, { headers: { authorization: `Bearer ${tk.token}` } });
  let r = await get(t);
  if (r.status === 401) { t = await sfToken(env, true); r = await get(t); }
  if (r.status === 404) throw new Error("This QR code is not a Tenant Connect request");
  if (!r.ok) throw new Error(`Salesforce answered ${r.status}`);
  const rec = await r.json();
  let m = sfMap(rec, env);
  /* the page layout can leave out the status stamp or the dates — read every field of the record once more */
  if ((!m.status || !m.from) && rec.apiName) {
    const all = await fetch(`${t.inst}/services/data/v61.0/sobjects/${rec.apiName}/${id}`, { headers: { authorization: `Bearer ${t.token}` } }).then(x => x.ok ? x.json() : null).catch(() => null);
    if (all) {
      for (const [k, v] of Object.entries(all)) if (k !== "attributes" && !(k in rec.fields) && (v == null || typeof v !== "object")) rec.fields[k] = { value: v, displayValue: null };
      m = sfMap(rec, env);
    }
  }
  return m;
}
/* turn the record into { req, tenant, contractor, work, desc, status, from:{day,time}, to:{day,time} } */
function sfWhen(v) {
  const s = String(v || "");
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return beirut(new Date(s));
  if (isDay(s)) return { day: s, time: "" };
  return null;
}
/* a formula IMAGE field (the APPROVED / REJECTED stamp) comes as <img src=… alt=…> — read its alt text or file name */
const STATUS_RE = /\b(approved|rejected|declined|cancell?ed|pending|submitted|in progress|draft|closed|expired)\b/i;
function plain(v) {
  const s = String(v == null ? "" : v);
  if (!/<[a-z]/i.test(s)) return s;
  const alt = (s.match(/\balt\s*=\s*["']([^"']+)["']/i) || [])[1] || "";
  const src = (s.match(/\bsrc\s*=\s*["']([^"']+)["']/i) || [])[1] || "";
  const txt = s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  const hit = (alt.match(STATUS_RE) || src.match(STATUS_RE) || txt.match(STATUS_RE) || [])[1];
  return txt || (hit ? hit[0].toUpperCase() + hit.slice(1).toLowerCase() : alt);
}
const SYS = /^(Id|OwnerId|IsDeleted|CreatedDate|CreatedById|LastModifiedDate|LastModifiedById|SystemModstamp|LastActivityDate|LastViewedDate|LastReferencedDate|RecordTypeId)$/;
export function sfMap(rec, env = {}) {
  const flat = [];   // [apiName, text, rawValue]
  const walk = (fields, prefix) => {
    for (const [k, f] of Object.entries(fields || {})) {
      const v = f && f.value;
      if (v && typeof v === "object" && v.fields) {
        const nm = v.fields.Name && v.fields.Name.value;
        flat.push([prefix + k, nm || f.displayValue || "", nm]);
        if (!prefix) walk(v.fields, k + ".");
      } else {
        const idLike = typeof v === "string" && /^[a-zA-Z0-9]{18}$/.test(v) && !f.displayValue;
        if (!idLike) flat.push([prefix + k, plain(f && f.displayValue != null ? f.displayValue : v), v]);
      }
    }
  };
  walk(rec.fields, "");
  let pin = {}; try { pin = env.SF_FIELDS ? JSON.parse(env.SF_FIELDS) : {}; } catch {}
  const top = flat.filter(x => !x[0].includes("."));
  const find = (k, ...res) => {
    if (pin[k]) { const h = flat.find(x => x[0] === pin[k]); return h || null; }
    for (const re of res) { const h = top.find(x => re.test(x[0]) && String(x[1]).trim()); if (h) return h; }
    return null;
  };
  const txt = h => h ? clip(h[1], 300) : "";
  const reqHit = pin.req ? flat.find(x => x[0] === pin.req) : flat.find(x => /^REQ-?\d+$/i.test(String(x[1]).trim()));
  const fromH = find("from", /valid_?from/i, /date_?from/i, /start/i), toH = find("to", /valid_?to/i, /date_?to/i, /end/i);
  return {
    req: reqHit ? String(reqHit[1]).trim().toUpperCase() : "",
    name: txt(top.find(x => x[0] === "Name")),
    tenant: txt(find("tenant", /tenant/i, /^account/i)).replace(/\s+(ABC\s+)?(Verdun|Achrafieh|Dbayeh)(\s+(Mall|Department Store|DS))?$/i, ""),   // "NOURA Verdun Mall" → "NOURA"
    contractor: txt(find("contractor", /contractor/i, /supplier|vendor|company/i)),
    work: txt(find("work", /sub_?maint/i, /work_?type|category|type_of/i)),
    desc: txt(find("desc", /notes|description/i)),
    sender: txt(find("sender", /sender/i, /requester|requested_?by/i)),
    status: txt(find("status", /approval_?status/i, /^status/i, /status/i, /stamp|approv|reject/i)
      || top.find(x => !SYS.test(x[0]) && STATUS_RE.test(String(x[1])) && String(x[1]).trim().split(/\s+/).length <= 3)),
    fields: top.filter(x => !SYS.test(x[0]) && String(x[1]).trim()).slice(0, 60).map(x => [x[0], clip(x[1], 80)]),   // shown to managers to check the mapping
    from: fromH ? sfWhen(fromH[2] || fromH[1]) : null, to: toH ? sfWhen(toH[2] || toH[1]) : null
  };
}

/* ---------- is the permit valid right now? ---------- */
export function verdictOf(info, now) {
  if (!info) return { code: "unknown", label: "Request not found", ok: false };
  if (info.status && /reject|declin|cancel/i.test(info.status)) return { code: "rejected", label: /^rejected$/i.test(info.status) ? "Rejected" : `Rejected · ${info.status}`, ok: false };
  if (info.status && !/approv/i.test(info.status)) return { code: "not-approved", label: `Not approved · ${info.status}`, ok: false };
  if (!info.from || !info.from.day) return info.status ? { code: "valid", label: "Approved", ok: true } : { code: "unknown", label: "Status not checked", ok: false };
  const to = info.to && info.to.day ? info.to : { day: info.from.day, time: "" };
  const n = key(now);
  if (n < addMin({ day: info.from.day, time: info.from.time || "00:00" }, -EARLY_MIN)) return { code: "early", label: "Permit not started yet", ok: false };
  if (n > key(to, "23:59")) return { code: "expired", label: "Permit expired", ok: false };
  return { code: "valid", label: "Valid now", ok: true };
}
const visitInfo = v => v && { req: v.req, tenant: v.tenant, contractor: v.company, work: v.work, desc: v.desc, status: "Approved",
  from: { day: v.from, time: v.timeFrom }, to: { day: v.to, time: v.timeTo } };

async function findVisit(env, site, day, today, { sfId, req, visitId }) {
  const list = await dayList(env, site, day, today);
  let v = visitId ? list.find(x => x.id === Number(visitId)) : null;
  if (!v && sfId) {
    const row = await env.DB.prepare("SELECT id, day_from, day_to FROM contractor_visits WHERE site = ? AND deleted = 0 AND (sf_id = ? OR sf_id = ?) ORDER BY id DESC LIMIT 1")
      .bind(site, sfId, sfId.slice(0, 15)).first();
    if (row) v = list.find(x => x.id === row.id) || { ...(await visitById(env, row.id)), notToday: true };
  }
  if (!v && req) {
    const dg = reqDigits(req);
    v = list.find(x => reqDigits(x.req) === dg);
    if (!v) {
      const row = await env.DB.prepare("SELECT id FROM contractor_visits WHERE site = ? AND deleted = 0 AND REPLACE(UPPER(req), '-', '') = ? ORDER BY day_to DESC LIMIT 1").bind(site, "REQ" + dg).first();
      if (row) v = { ...(await visitById(env, row.id)), notToday: true };
    }
  }
  return { v: v || null, list };
}
async function visitById(env, id) {
  const r = await env.DB.prepare("SELECT * FROM contractor_visits WHERE id = ?").bind(id).first();
  return r ? { id: r.id, company: r.company, tenant: r.tenant, work: r.work, desc: r.descr, req: r.req, from: r.day_from, to: r.day_to, timeFrom: r.time_from, timeTo: r.time_to, state: "expected" } : {};
}

const scanOut = r => ({ id: r.id, clientId: r.client_id, at: r.at, decision: r.decision, reason: r.reason, override: !!r.override, verdict: r.verdict, req: r.req, tenant: r.tenant,
  contractor: r.contractor, work: r.work, validFrom: r.valid_from, validTo: r.valid_to, workers: r.workers, by: r.by_name, sfId: r.sf_id });

/* ---------- Loading-area phones: the separate Loading Gate app ----------
   The gate app (worker abc-loading-gate, its own link) reaches the hub only through a Cloudflare service binding,
   with the shared secret GATE_KEY. Each phone is paired once with a one-time code from a manager and then carries
   its own token (only its SHA-256 is stored). Revoking a phone in the hub cuts it off at once. */
export const GATE_URL = "https://abc-loading-gate.sultanachi-lb-61f.workers.dev";
const sha = async t => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(t))))].map(x => x.toString(16).padStart(2, "0")).join("");
const randomCode = n => { const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", b = crypto.getRandomValues(new Uint8Array(n)); return [...b].map(x => A[x % A.length]).join(""); };
const randomToken = () => [...crypto.getRandomValues(new Uint8Array(32))].map(x => x.toString(16).padStart(2, "0")).join("");
const sameText = (a, b) => { a = String(a || ""); b = String(b || ""); if (!a || a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; };
const devOut = r => ({ id: r.id, name: r.name, paired: !!r.token_hash, pairedAt: r.paired_at, lastSeen: r.last_seen, lastAgent: r.last_agent,
  pending: !r.token_hash && !!r.pair_hash && r.pair_exp > new Date().toISOString(), pairExp: r.pair_exp, createdName: r.created_name });

async function devicesRoute(env, p, method, b, site, d) {
  if (!d.full) throw err("Only managers can pair or remove loading-area phones", 403);
  if (p === "gate/devices" && method === "GET") {
    const { results } = await env.DB.prepare("SELECT * FROM gate_devices WHERE site = ? AND revoked = 0 ORDER BY id").bind(site).all();
    return { list: (results || []).map(devOut), gateUrl: env.GATE_URL || GATE_URL, ready: !!env.GATE_KEY };
  }
  if (method !== "POST") throw err("Unknown request", 404);
  if (p === "gate/devices/new") {   // a new phone, or a new code for a phone that is not paired yet
    const name = clip(b.name, 60) || "Loading area phone";
    const code = randomCode(8), exp = new Date(Date.now() + 30 * 60000).toISOString();
    let id = Number(b.id) || 0;
    if (id) await env.DB.prepare("UPDATE gate_devices SET pair_hash = ?, pair_exp = ?, token_hash = '' WHERE id = ? AND site = ? AND revoked = 0").bind(await sha(code), exp, id, site).run();
    else id = (await env.DB.prepare("INSERT INTO gate_devices (site, name, pair_hash, pair_exp, created_name, created_at) VALUES (?,?,?,?,?,?)")
      .bind(site, name, await sha(code), exp, d.me.full_name, d.now()).run()).meta.last_row_id;
    const gateUrl = env.GATE_URL || GATE_URL;
    return { id, name, code: code.slice(0, 4) + "-" + code.slice(4), exp, link: `${gateUrl}/#pair=${code}`, gateUrl };
  }
  if (p === "gate/devices/revoke") {
    await env.DB.prepare("UPDATE gate_devices SET revoked = 1, token_hash = '', pair_hash = '' WHERE id = ? AND site = ?").bind(Number(b.id) || 0, site).run();
    if (d.raiseEvent) await d.raiseEvent(env, { site, app: "gate", tone: "info", title: "Loading-area phone removed", body: `${clip(b.name, 60)} · by ${d.me.full_name}` }).catch(() => {});
    return { revoked: true };
  }
  throw err("Unknown request", 404);
}

/* the gate app's only door into the hub: /api/gate-ext/*  (pair · me · lookup · decide · day) */
export async function gatePublic(env, request, p, method, b, url, deps) {
  if (!env.GATE_KEY || !sameText(request.headers.get("x-gate-key"), env.GATE_KEY)) throw err("Not allowed", 403);
  const ip = clip(request.headers.get("x-gate-ip"), 60) || "?";
  if (p === "pair" && method === "POST") {
    const lockKey = `gate:pairfail:${ip}`;
    const lk = await env.DB.prepare("SELECT v FROM meta WHERE k = ?").bind(lockKey).first().catch(() => null);
    let L = { n: 0, at: 0 }; try { L = lk ? JSON.parse(lk.v) : L; } catch {}
    if (L.n >= 8 && Date.now() - L.at < 15 * 60000) throw err("Too many wrong codes — wait 15 minutes", 429);
    const code = String(b.code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const row = code.length === 8 ? await env.DB.prepare("SELECT * FROM gate_devices WHERE pair_hash = ? AND revoked = 0").bind(await sha(code)).first() : null;
    if (!row || !(row.pair_exp > new Date().toISOString())) {
      await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)").bind(lockKey, JSON.stringify({ n: (Date.now() - L.at < 15 * 60000 ? L.n : 0) + 1, at: Date.now() })).run().catch(() => {});
      throw err("This code is wrong or has expired — ask the manager for a new one", 400);
    }
    const token = randomToken(), at = deps.now();
    await env.DB.prepare("UPDATE gate_devices SET token_hash = ?, pair_hash = '', pair_exp = '', paired_at = ?, last_seen = ? WHERE id = ?").bind(await sha(token), at, at, row.id).run();
    await env.DB.prepare("DELETE FROM meta WHERE k = ?").bind(lockKey).run().catch(() => {});
    if (deps.raiseEvent) await deps.raiseEvent(env, { site: row.site, app: "gate", tone: "info", title: "Loading-area phone paired", body: row.name }).catch(() => {});
    return { token, site: row.site, siteName: deps.siteName(row.site), device: row.name };
  }
  const tok = String(request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const dev = /^[0-9a-f]{64}$/.test(tok) ? await env.DB.prepare("SELECT * FROM gate_devices WHERE token_hash = ? AND revoked = 0").bind(await sha(tok)).first() : null;
  if (!dev) throw err("This phone is not paired, or it was removed — ask the manager for a pairing code", 401);
  const agent = clip(decodeURIComponent(request.headers.get("x-gate-agent") || ""), 60);
  const nowIso = deps.now();
  if (!dev.last_seen || Date.parse(nowIso) - Date.parse(dev.last_seen) > 5 * 60000 || (agent && agent !== dev.last_agent))
    await env.DB.prepare("UPDATE gate_devices SET last_seen = ?, last_agent = CASE WHEN ? != '' THEN ? ELSE last_agent END WHERE id = ?").bind(nowIso, agent, agent, dev.id).run().catch(() => {});
  if (p === "me") return { site: dev.site, siteName: deps.siteName(dev.site), device: dev.name, today: deps.today(), agent };
  if (!["lookup", "decide", "day"].includes(p)) throw err("Unknown request", 404);
  if (p === "decide" && !agent) throw err("Write your name first", 400);
  const me = { full_name: agent ? `${agent} · ${dev.name}` : dev.name, email: "", role: "SECURITY", position: "" };
  return gateRoute(env, "gate/" + p, method, b, url, { ...deps, site: dev.site, me, full: false, canSite: (_, s) => s === dev.site });
}

/* the day's gate log — also read by the Shift Handover (handover/live) */
export async function gateDay(env, site, day) {
  const { results } = await env.DB.prepare("SELECT * FROM gate_scans WHERE site = ? AND day = ? ORDER BY at DESC, id DESC LIMIT 400").bind(site, day).all().catch(() => ({ results: [] }));
  const list = (results || []).map(scanOut);
  const n = d => list.filter(x => x.decision === d).length;
  return { list, counts: { in: n("in"), out: n("out"), left: n("leave"), overrides: list.filter(x => x.override).length,
    workers: list.filter(x => x.decision === "in").reduce((a, x) => a + (x.workers || 0), 0) } };
}

export async function gateRoute(env, p, method, b, url, d) {
  const { site, me } = d;
  if (!d.canSite(me, site)) throw err("No access to this flagship", 403);
  const team = d.full || (me.role === "SUPERVISOR" && me.position !== "WH") || me.role === "SECURITY";
  if (!team) throw err("Only the operations team and security use the loading gate", 403);
  const today = d.today(), now = beirut();
  if (p.startsWith("gate/devices")) return devicesRoute(env, p, method, b, site, d);   // managers: pair / remove loading-area phones

  if (p === "gate/day") {
    const day = isDay(url.searchParams.get("day")) ? url.searchParams.get("day") : today;
    return { day, today, reasons: GATE_REASONS, salesforce: sfOn(env), canPair: !!d.full, ...(await gateDay(env, site, day)) };
  }
  /* Offline pack: today's and tomorrow's booked contractors, kept on the gate phone so a scan without signal still shows the booking */
  if (p === "gate/offline") {
    const next = new Date(Date.parse(today + "T00:00:00Z") + 864e5).toISOString().slice(0, 10);
    const { results } = await env.DB.prepare(`SELECT id, company, tenant, work, req, day_from, day_to, time_from, time_to FROM contractor_visits
      WHERE site = ? AND deleted = 0 AND day_from <= ? AND day_to >= ? ORDER BY day_from, time_from LIMIT 600`).bind(site, next, today).all().catch(() => ({ results: [] }));
    return { site, today, at: new Date().toISOString(), list: (results || []).map(v => ({ id: v.id, req: v.req, tenant: v.tenant, company: v.company, work: v.work,
      from: { day: v.day_from, time: v.time_from }, to: { day: v.day_to, time: v.time_to } })) };
  }
  if (method !== "POST") throw err("Unknown request", 404);

  if (p === "gate/lookup") {
    const c = parseCode(b.code);
    if (!c.sfId && !c.req && !b.visitId) throw err("This QR code is not a Tenant Connect pass");
    let info = null, source = "none", sfError = "", sfFields = null;
    let { v } = await findVisit(env, site, today, today, { ...c, visitId: b.visitId });
    if (v) { source = "hub"; info = visitInfo(v); }
    let pass = null;
    if (c.sfId) {   // the pass page is read on every scan: the request may have been rejected or changed since the import
      try { pass = await passRecord(env, c); } catch (e) { sfError = e.message; }
      if (pass) { const { fields, ...s } = pass; sfFields = fields; sfError = ""; info = { ...(info || {}), ...Object.fromEntries(Object.entries(s).filter(([, x]) => x)) }; source = "pass";
        if (!v && s.req) ({ v } = await findVisit(env, site, today, today, { req: s.req })); }
    }
    if (c.sfId && !pass && sfOn(env)) {   // optional Connected App (also used when the pass page cannot be read)
      try { const { fields, ...s } = await sfRecord(env, c.sfId); sfFields = fields; sfError = ""; info = { ...(info || {}), ...Object.fromEntries(Object.entries(s).filter(([, x]) => x)) }; source = "salesforce";
        if (!v && s.req) ({ v } = await findVisit(env, site, today, today, { req: s.req })); }
      catch (e) { sfError = e.message; }
    }
    if (v && !info) info = visitInfo(v);
    const verdict = verdictOf(info, now);
    if (v && v.blocked) Object.assign(verdict, { code: "blocked", label: "Contractor is blocked in the register", ok: false });
    const last = c.sfId || (info && info.req) ? await env.DB.prepare(`SELECT * FROM gate_scans WHERE site = ? AND day = ? AND ((sf_id != '' AND sf_id = ?) OR (req != '' AND REPLACE(UPPER(req),'-','') = ?)) ORDER BY id DESC LIMIT 1`)
      .bind(site, today, c.sfId, "REQ" + reqDigits(info && info.req || c.req)).first() : null;
    return { code: c, source, sfError, salesforce: sfOn(env), info, verdict, now,
      visit: v ? { id: v.id, state: v.state || "expected", inAt: v.inAt || "", workers: v.workers || 0, notToday: !!v.notToday, blocked: !!v.blocked, ins: v.ins || "" } : null,
      last: last ? scanOut(last) : null,
      sfFields: d.full ? sfFields : null };   // managers see the raw Salesforce fields, to check what the gate reads
  }

  if (p === "gate/decide") {
    const decision = ["in", "out", "leave"].includes(b.decision) ? b.decision : "";
    if (!decision) throw err("Choose Approved in or Rejected out");
    const clientId = clip(b.clientId, 64);
    if (clientId) {
      const dup = await env.DB.prepare("SELECT * FROM gate_scans WHERE site = ? AND client_id = ?").bind(site, clientId).first();
      if (dup) return { scan: scanOut(dup), duplicate: true, ...(await gateDay(env, site, dup.day)) };
    }
    const c = parseCode(b.code);
    /* decisions saved offline are judged at the time of the scan, not when they reach the hub */
    const sc = new Date(String(b.scannedAt || "")), late = !isNaN(sc) && Date.now() - sc < 864e5 && sc <= Date.now() + 120000;
    const when = late ? beirut(sc) : now;
    const at = late ? sc.toISOString() : d.now(), day = when.day;
    const cl = b.info || {};
    /* seen = what the agent read on the pass when Salesforce is not connected (Approved / Rejected) */
    const seen = ["Approved", "Rejected"].includes(b.seen) ? b.seen : "";
    let info = { req: clip(cl.req, 40), tenant: clip(cl.tenant, 160), contractor: clip(cl.contractor, 160), work: clip(cl.work, 120), desc: clip(cl.desc, 500), status: clip(cl.status, 60) || seen,
      from: cl.from && isDay(cl.from.day) ? { day: cl.from.day, time: isHM(cl.from.time) ? cl.from.time : "" } : null,
      to: cl.to && isDay(cl.to.day) ? { day: cl.to.day, time: isHM(cl.to.time) ? cl.to.time : "" } : null };
    let { v } = await findVisit(env, site, day, today, { sfId: c.sfId, req: info.req || c.req, visitId: b.visitId });
    if (v && v.id) {
      const vi = visitInfo(v);   // what the scanner showed (Salesforce) wins; the hub's record fills the gaps
      info = { ...vi, ...Object.fromEntries(Object.entries(info).filter(([, x]) => x)) };
      if (c.sfId) await env.DB.prepare("UPDATE contractor_visits SET sf_id = ? WHERE id = ? AND sf_id = ''").bind(c.sfId, v.id).run();   // link the QR for next time
    }
    const verdict = verdictOf(info.from || info.status ? info : null, when);
    let reason = clip(b.reason, 200);
    const override = (decision === "in" && !verdict.ok) || (decision === "out" && verdict.ok);
    if (decision === "out" && !reason && verdict.ok) throw err("This request is approved — choose the reason for the rejection");
    if (decision === "out" && !reason) reason = verdict.code === "rejected" ? "Rejected in Salesforce" : verdict.label;
    if (override && !reason && b.offline) reason = "Offline — permit not checked at the gate";
    if (override && !reason) throw err("This request is not approved or not valid now — write why you let them in");
    const workers = Math.max(0, Math.min(500, Number(b.workers) || 0));

    /* approved in without a visit on today's list → add it, so it shows on Contractors and the Day to Day timeline */
    if (decision === "in" && (!v || !v.id || v.notToday) && (info.contractor || info.tenant || info.req)) {   // also when only the REQ is known (typed from the pass)
      const fromD = info.from && info.from.day <= day ? info.from.day : day, toD = info.to && info.to.day >= day ? info.to.day : day;
      if (v && v.id && v.notToday) {
        await env.DB.prepare("UPDATE contractor_visits SET day_from = MIN(day_from, ?), day_to = MAX(day_to, ?) WHERE id = ?").bind(day, day, v.id).run();
      } else {
        const r = await env.DB.prepare(`INSERT INTO contractor_visits (contractor_id, company, tenant, work, descr, day_from, day_to, time_from, time_to, site, req, src, sf_id, created_at, created_name)
          VALUES (0,?,?,?,?,?,?,?,?,?,?,'gate',?,?,?)`).bind(info.contractor || info.tenant || info.req, info.tenant, info.work, info.desc, fromD, toD,
          info.from && info.from.time || "", info.to && info.to.time || "", site, /^REQ-?\d+$/i.test(info.req) ? info.req.toUpperCase() : "", c.sfId, at, me.full_name).run();
        v = { id: r.meta.last_row_id };
      }
    }
    /* contractor check-in / check-out (same tables as the Contractors tool) */
    if (v && v.id && decision !== "out") {
      const cur = await env.DB.prepare("SELECT * FROM contractor_checks WHERE visit_id = ? AND day = ?").bind(v.id, day).first();
      if (decision === "in" && !(cur && cur.in_at && !cur.out_at))
        await env.DB.prepare(`INSERT INTO contractor_checks (visit_id, day, site, workers, in_at, in_name, out_at, out_name, note) VALUES (?,?,?,?,?,?,'','',?)
          ON CONFLICT(visit_id, day) DO UPDATE SET workers = excluded.workers, in_at = excluded.in_at, in_name = excluded.in_name, out_at = '', out_name = '', note = excluded.note`)
          .bind(v.id, day, site, workers, at, me.full_name, override ? "Gate override: " + reason : "Loading gate").run();
      if (decision === "leave" && cur && cur.in_at && !cur.out_at)
        await env.DB.prepare("UPDATE contractor_checks SET out_at = ?, out_name = ? WHERE visit_id = ? AND day = ?").bind(at, me.full_name, v.id, day).run();
    }
    const w = x => x ? `${x.day}${x.time ? " " + x.time : ""}` : "";
    const res = await env.DB.prepare(`INSERT INTO gate_scans (site, day, at, client_id, decision, reason, override, verdict, sf_id, req, tenant, contractor, work, valid_from, valid_to, workers, visit_id, by_name, by_email, scanned_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(site, day, at, clientId, decision, reason, override ? 1 : 0, verdict.code + (seen && !cl.status ? ":pass" : ""), c.sfId, clip(info.req || c.req, 40),
      info.tenant, info.contractor, info.work, w(info.from), w(info.to), decision === "in" ? workers : 0, v && v.id || 0, me.full_name, me.email || "", clip(b.scannedAt, 30)).run();

    const who = [info.contractor, info.tenant && `for ${info.tenant}`].filter(Boolean).join(" ") || info.req || "Contractor";
    if (decision === "out" && d.raiseEvent) await d.raiseEvent(env, { site, app: "gate", tone: "warn", title: `Refused at loading gate · ${info.contractor || info.tenant || info.req || "contractor"}`,
      body: `${who}${info.req ? " · " + info.req : ""} — ${reason} · ${me.full_name}` }).catch(() => {});
    if (override && decision === "in" && d.raiseEvent) await d.raiseEvent(env, { site, app: "gate", tone: "warn", title: `Let in against Salesforce · ${info.contractor || info.tenant || info.req || "contractor"}`,
      body: `${verdict.label} — ${reason} · ${me.full_name}` }).catch(() => {});
    /* the Shift Handover line of the same REQ gets the outcome: ✓ Attended · ✕ Refused at gate · → left */
    const hhmm = (when.time || "").slice(0, 5), reqN = info.req || c.req;
    const mark = decision === "in" ? `✓ Attended ${hhmm}${workers ? ` · ${workers} worker${workers === 1 ? "" : "s"}` : ""}${override ? ` · override: ${reason}` : ""}`
      : decision === "out" ? `✕ Refused at gate ${hhmm} · ${reason}` : `→ Left ${hhmm}`;
    if (d.markHandover && reqN) await d.markHandover(env, site, day, reqN, mark).catch(() => false);
    const row = await env.DB.prepare("SELECT * FROM gate_scans WHERE id = ?").bind(res.meta.last_row_id).first();
    return { scan: scanOut(row), ...(await gateDay(env, site, day)) };
  }
  throw err("Unknown request", 404);
}
