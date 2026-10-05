/* =====================================================================
   LOADING GATE — QR scanner for the loading area (kept separate so it can be removed cleanly)
   See docs/FEATURE-gate.md

   The loading agent scans the contractor's Tenant Connect QR code (a Salesforce link with ?recordId=…).
   The hub finds the request, shows tenant / contractor / permit window and whether it is valid now,
   and the agent presses  APPROVED · IN  (green)  or  REJECTED · OUT  (red).

   • Approved in  → the contractor is checked in on the Contractors list (Day to Day timeline shows "On site")
   • Rejected out → logged with the reason, and a notification goes to the flagship
   • Every decision appears live in the Shift Handover ("Loading area gate") and in the handover email

   Finding the request (first match wins):
     1. a contractor visit already linked to this QR (sf_id)
     2. Salesforce, when the SF_* settings exist (Connected App, client-credentials flow) → REQ number → visit
     3. otherwise the agent picks the request from today's list once — the QR is linked for the next scans

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
    env.DB.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS gate_scans_client ON gate_scans (site, client_id) WHERE client_id != ''`)
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
  const r = t.match(/\bREQ[-\s]?(\d{3,})\b/i);
  if (r) req = "REQ-" + r[1];
  else if (/^\d{4,}$/.test(t)) req = "REQ-" + t;   // typed by hand: just the number
  return { raw: t, sfId, req };
}
const reqDigits = r => String(r || "").replace(/\D/g, "");

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
  return sfMap(await r.json(), env);
}
/* turn the record into { req, tenant, contractor, work, desc, status, from:{day,time}, to:{day,time} } */
function sfWhen(v) {
  const s = String(v || "");
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return beirut(new Date(s));
  if (isDay(s)) return { day: s, time: "" };
  return null;
}
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
        if (!idLike) flat.push([prefix + k, f && f.displayValue != null ? String(f.displayValue) : v == null ? "" : String(v), v]);
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
    status: txt(find("status", /approval_?status/i, /^status/i, /status/i)),
    from: fromH ? sfWhen(fromH[2] || fromH[1]) : null, to: toH ? sfWhen(toH[2] || toH[1]) : null
  };
}

/* ---------- is the permit valid right now? ---------- */
export function verdictOf(info, now) {
  if (!info) return { code: "unknown", label: "Request not found", ok: false };
  if (info.status && !/approv/i.test(info.status)) return { code: "not-approved", label: `Not approved · ${info.status}`, ok: false };
  if (!info.from || !info.from.day) return { code: "unknown", label: "No permit time on the request", ok: false };
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

  if (p === "gate/day") {
    const day = isDay(url.searchParams.get("day")) ? url.searchParams.get("day") : today;
    return { day, today, reasons: GATE_REASONS, salesforce: sfOn(env), ...(await gateDay(env, site, day)) };
  }
  if (method !== "POST") throw err("Unknown request", 404);

  if (p === "gate/lookup") {
    const c = parseCode(b.code);
    if (!c.sfId && !c.req && !b.visitId) throw err("This QR code is not a Tenant Connect pass");
    let info = null, source = "none", sfError = "";
    let { v, list } = await findVisit(env, site, today, today, { ...c, visitId: b.visitId });
    if (v) { source = "hub"; info = visitInfo(v); }
    if (c.sfId && sfOn(env)) {   // Salesforce is asked every time: the request may have been cancelled since the import
      try { const s = await sfRecord(env, c.sfId); info = { ...(info || {}), ...Object.fromEntries(Object.entries(s).filter(([, x]) => x)) }; source = "salesforce";
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
      candidates: v ? [] : [...list].sort((a, z) => (a.state === "expected" ? 0 : 1) - (z.state === "expected" ? 0 : 1)).map(x => ({ id: x.id, req: x.req, tenant: x.tenant, company: x.company, work: x.work, timeFrom: x.timeFrom, timeTo: x.timeTo, state: x.state })) };
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
    let info = { req: clip(cl.req, 40), tenant: clip(cl.tenant, 160), contractor: clip(cl.contractor, 160), work: clip(cl.work, 120), desc: clip(cl.desc, 500), status: clip(cl.status, 60),
      from: cl.from && isDay(cl.from.day) ? { day: cl.from.day, time: isHM(cl.from.time) ? cl.from.time : "" } : null,
      to: cl.to && isDay(cl.to.day) ? { day: cl.to.day, time: isHM(cl.to.time) ? cl.to.time : "" } : null };
    let { v } = await findVisit(env, site, day, today, { sfId: c.sfId, req: info.req || c.req, visitId: b.visitId });
    if (v && v.id) {
      const vi = visitInfo(v);   // what the scanner showed (Salesforce) wins; the hub's record fills the gaps
      info = { ...vi, ...Object.fromEntries(Object.entries(info).filter(([, x]) => x)) };
      if (c.sfId) await env.DB.prepare("UPDATE contractor_visits SET sf_id = ? WHERE id = ? AND sf_id = ''").bind(c.sfId, v.id).run();   // link the QR for next time
    }
    const verdict = verdictOf(info.from ? info : null, when);
    let reason = clip(b.reason, 200);
    const override = decision === "in" && !verdict.ok;
    if (decision === "out" && !reason) throw err("Choose the reason for the rejection");
    if (override && !reason && b.offline) reason = "Offline — permit not checked at the gate";
    if (override && !reason) throw err("The permit is not valid now — write why you let them in");
    const workers = Math.max(0, Math.min(500, Number(b.workers) || 0));

    /* approved in without a visit on today's list → add it, so it shows on Contractors and the Day to Day timeline */
    if (decision === "in" && (!v || !v.id || v.notToday) && (info.contractor || info.tenant)) {
      const fromD = info.from && info.from.day <= day ? info.from.day : day, toD = info.to && info.to.day >= day ? info.to.day : day;
      if (v && v.id && v.notToday) {
        await env.DB.prepare("UPDATE contractor_visits SET day_from = MIN(day_from, ?), day_to = MAX(day_to, ?) WHERE id = ?").bind(day, day, v.id).run();
      } else {
        const r = await env.DB.prepare(`INSERT INTO contractor_visits (contractor_id, company, tenant, work, descr, day_from, day_to, time_from, time_to, site, req, src, sf_id, created_at, created_name)
          VALUES (0,?,?,?,?,?,?,?,?,?,?,'gate',?,?,?)`).bind(info.contractor || info.tenant, info.tenant, info.work, info.desc, fromD, toD,
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
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(site, day, at, clientId, decision, reason, override ? 1 : 0, verdict.code, c.sfId, clip(info.req || c.req, 40),
      info.tenant, info.contractor, info.work, w(info.from), w(info.to), decision === "in" ? workers : 0, v && v.id || 0, me.full_name, me.email || "", clip(b.scannedAt, 30)).run();

    const who = [info.contractor, info.tenant && `for ${info.tenant}`].filter(Boolean).join(" ") || info.req || "Contractor";
    if (decision === "out" && d.raiseEvent) await d.raiseEvent(env, { site, app: "gate", tone: "warn", title: `Refused at loading gate · ${info.contractor || info.tenant || info.req || "contractor"}`,
      body: `${who}${info.req ? " · " + info.req : ""} — ${reason} · ${me.full_name}` }).catch(() => {});
    if (override && d.raiseEvent) await d.raiseEvent(env, { site, app: "gate", tone: "warn", title: `Let in outside the permit · ${info.contractor || info.tenant || info.req || "contractor"}`,
      body: `${verdict.label} — ${reason} · ${me.full_name}` }).catch(() => {});
    const row = await env.DB.prepare("SELECT * FROM gate_scans WHERE id = ?").bind(res.meta.last_row_id).first();
    return { scan: scanOut(row), ...(await gateDay(env, site, day)) };
  }
  throw err("Unknown request", 404);
}
