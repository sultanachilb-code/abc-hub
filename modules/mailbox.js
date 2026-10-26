/* =====================================================================
   REPORT MAILBOX (Oct 2026) — docs/FEATURE-report-mailbox.md
   The Salesforce report subscriptions (one report per email, all flagships) arrive in an ABC mailbox (opsverdunmall@abc.com.lb),
   where an Outlook rule puts them in one folder ("Hub Reports"). Every morning in the import window (07:00–08:00 Beirut) the hub
   reads that folder, imports each new report (the hub tells the report by its content and splits it per flagship), and logs it.
   • Read only: nothing is sent, moved or deleted in the mailbox. Each email is imported once (mb_log).
   • A report that arrives late is picked up in the next morning's window (the last 3 days are read).
   • 08:05: any expected report not received today → hub notification to the administrators and the flagships.
   • Admin Control Center → Report mailbox: connect, settings, "Test read (no import)", "Import now", log.
   ===================================================================== */
import { rmbAccess, rmbStatus, rmbDisconnect, rmbConnectUrl, msOn } from "./outlook.js";
import { portalImport, parseReport, parseUsers, siteOf, KINDS } from "./portal.js";
import { contractsImport } from "./contracts.js";
import { readSheet } from "./sheetread.js";

const err = (m, status = 400) => Object.assign(new Error(m), { status });
const clip = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
const GRAPH = "https://graph.microsoft.com/v1.0";
export const MB_DEFAULT = { mailbox: "opsverdunmall@abc.com.lb", folder: "Hub Reports", from: "07:00", to: "08:00", check: "08:05", every: 10,
  expect: ["vr", "bp", "nr", "mk"], on: false };
export const MB_EXPECT = { vr: "Violations & Requests", bp: "Penalties (Breaches & Penalties)", nr: "ABC Requests", mk: "Marketing Requests", cp: "Contractor Permits", users: "Portal Users", contracts: "Contracts near ending" };

export async function mbSchema(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS mb_log (msg_id TEXT PRIMARY KEY, received TEXT NOT NULL DEFAULT '', subject TEXT NOT NULL DEFAULT '', sender TEXT NOT NULL DEFAULT '',
    files TEXT NOT NULL DEFAULT '', result TEXT NOT NULL DEFAULT '', ok INTEGER NOT NULL DEFAULT 0, at TEXT NOT NULL DEFAULT '')`).run();
}
export async function mbCfg(env) {
  const r = await env.DB.prepare("SELECT v FROM meta WHERE k = 'mb:cfg'").first().catch(() => null);
  let c = {}; try { c = r ? JSON.parse(r.v) : {}; } catch {}
  return { ...MB_DEFAULT, ...c };
}
const hm = s => /^\d{2}:\d{2}$/.test(s || "");
const toMin = s => +s.slice(0, 2) * 60 + +s.slice(3, 5);
function beirutNow() {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Beirut", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
    .formatToParts(new Date()).map(x => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, min: (Number(p.hour) % 24) * 60 + Number(p.minute) };
}
const beirutDay = iso => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Beirut" }).format(new Date(iso));

/* ---------- Microsoft Graph (read only) ---------- */
async function gget(tok, path) {
  let r; try { r = await fetch(path.startsWith("http") ? path : GRAPH + path, { headers: { authorization: "Bearer " + tok, prefer: 'outlook.body-content-type="html"' } }); }
  catch { throw err("Microsoft cannot be reached", 502); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const m = (j.error || {}).message || `Error ${r.status}`;
    throw err(r.status === 403 || r.status === 404 && /mailbox/i.test(m) ? `No access to this mailbox — sign in as the mailbox, or ask IT for Full Access to it (${m})` : `Outlook: ${m}`, 502);
  }
  return j;
}
const baseOf = (cfg, account) => !cfg.mailbox || cfg.mailbox.toLowerCase() === String(account || "").toLowerCase() ? "/me" : `/users/${encodeURIComponent(cfg.mailbox)}`;
async function folderId(tok, base, name) {
  const want = String(name || "").trim().replace(/^inbox\s*[\/>]\s*/i, ""), q = encodeURIComponent(`displayName eq '${want.replace(/'/g, "''")}'`);
  for (const p of [`${base}/mailFolders?$filter=${q}&$top=5`, `${base}/mailFolders/inbox/childFolders?$filter=${q}&$top=5`]) {
    const j = await gget(tok, p); if (j.value && j.value[0]) return j.value[0].id;
  }
  throw err(`The folder “${want}” is not in the mailbox — create it (top level or under Inbox) and the Outlook rule that moves the reports into it`);
}
const b64utf8 = s => { const a = new TextEncoder().encode(s); let x = ""; for (let i = 0; i < a.length; i += 0x8000) x += String.fromCharCode(...a.subarray(i, i + 0x8000)); return btoa(x); };
async function filesOf(tok, base, m) {
  const out = [];
  if (m.hasAttachments) {
    const j = await gget(tok, `${base}/messages/${m.id}/attachments`);
    for (const a of j.value || []) if (/fileAttachment/.test(a["@odata.type"] || "") && a.contentBytes && /\.(xlsx|xlsm|xls|csv|html?|txt)$/i.test(a.name || "")) out.push({ name: a.name, data: a.contentBytes });
  }
  if (!out.length) {   // the report inside the email body (a Salesforce subscription without attachment)
    const j = await gget(tok, `${base}/messages/${m.id}?$select=body`);
    const html = (j.body || {}).content || "";
    if (/<table/i.test(html)) out.push({ name: "email-body.html", data: b64utf8(html) });
  }
  return out;
}
async function listMessages(tok, base, fid, days = 3) {
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const j = await gget(tok, `${base}/mailFolders/${fid}/messages?$filter=${encodeURIComponent(`receivedDateTime ge ${since}`)}&$orderby=receivedDateTime asc&$top=60&$select=id,internetMessageId,subject,from,receivedDateTime,hasAttachments`);
  return j.value || [];
}

/* what a file is, without saving anything (for "Test read") */
async function preview(f, SITES) {
  let rows; try { rows = await readSheet(f.name, f.data); } catch (e) { return { file: f.name, error: e.message }; }
  const u = parseUsers(rows); if (u) return { file: f.name, kind: "Portal Users", rows: u.length || (u.rows || []).length || 0, sites: {} };
  const items = parseReport(rows);
  if (items) {
    const sites = {}, kinds = new Set(); let unplaced = 0;
    for (const it of items) { kinds.add(KINDS[it.kind] ? KINDS[it.kind].label : it.kind); const s = siteOf(it.branch, it.account, SITES); if (s) sites[SITES[s]] = (sites[SITES[s]] || 0) + 1; else unplaced++; }
    return { file: f.name, kind: [...kinds].join(", "), rows: items.length, sites, unplaced };
  }
  if (rows.some(r => r.some(c => /contract number/i.test(String(c))))) return { file: f.name, kind: "Contracts near ending", rows: rows.length, sites: {} };
  return { file: f.name, error: "Not a report the hub knows (no BP- / VR- / NR- / MKT- / CP- numbers, not Active Users, not Contracts)" };
}
async function importFiles(env, d, files, from) {
  try {
    const r = await portalImport(env, d, { files, from });
    return { ok: true, text: r.files.map(f => f.error ? `${f.file}: ${f.error}` : `${f.kinds.join(", ")}: ${f.rows} items · ${f.added} new · ${f.changed} status changes · ${f.gone} no longer in the report${f.unknown && f.unknown.length ? ` · not placed: ${f.unknown.join(", ")}` : ""}`).join(" | ") };
  } catch (e) {
    try { const c = await contractsImport(env, d, { files, from }); return { ok: true, text: `Contracts near ending: ${c.rows} contracts · ${c.added} new · ${c.gone} no longer in the report` }; }
    catch { return { ok: false, text: e.message.slice(0, 400) }; }
  }
}

/* one pass over the folder. dry = only say what would be imported. retry = also the emails that failed before */
export async function mbPass(env, d, { dry = false, retry = false } = {}) {
  const cfg = await mbCfg(env);
  const a = await rmbAccess(env); if (!a) throw err("The report mailbox is not connected (or its sign-in expired) — connect it again", 409);
  const base = baseOf(cfg, a.account), fid = await folderId(a.tok, base, cfg.folder);
  const msgs = await listMessages(a.tok, base, fid, dry ? 2 : 3);
  const ids = msgs.map(m => m.internetMessageId || m.id);
  const done = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const part = ids.slice(i, i + 50); if (!part.length) continue;
    const { results } = await env.DB.prepare(`SELECT msg_id, ok FROM mb_log WHERE msg_id IN (${part.map(() => "?").join(",")})`).bind(...part).all();
    for (const r of results || []) done.set(r.msg_id, r.ok);
  }
  const out = [];
  for (const m of msgs) {
    const id = m.internetMessageId || m.id, was = done.get(id);
    const head = { subject: clip(m.subject, 200), from: clip(((m.from || {}).emailAddress || {}).address, 160), received: m.receivedDateTime };
    if (dry) {
      const files = await filesOf(a.tok, base, m);
      out.push({ ...head, imported: was === 1, files: files.length ? await Promise.all(files.map(f => preview(f, d.SITES))) : [{ file: "—", error: "No attachment and no table in the email" }] });
      continue;
    }
    if (was === 1 || (was === 0 && !retry)) continue;
    const files = await filesOf(a.tok, base, m);
    const r = files.length ? await importFiles(env, d, files, `Report mailbox · ${head.from || cfg.mailbox}`) : { ok: false, text: "No attachment and no table in the email" };
    await env.DB.prepare("INSERT OR REPLACE INTO mb_log (msg_id, received, subject, sender, files, result, ok, at) VALUES (?,?,?,?,?,?,?,?)")
      .bind(id, head.received || "", head.subject, head.from, files.map(f => f.name).join(", ").slice(0, 300), r.text, r.ok ? 1 : 0, d.now()).run();
    out.push({ ...head, ok: r.ok, result: r.text });
  }
  if (!dry) await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('mb:lastrun', ?)").bind(JSON.stringify({ at: d.now(), read: msgs.length, imported: out.filter(x => x.ok).length, failed: out.filter(x => !x.ok).length })).run();
  return { mailbox: cfg.mailbox, folder: cfg.folder, account: a.account, read: msgs.length, items: out };
}

/* which expected reports arrived today (from the mailbox, Gmail or an upload — the portal keeps the last import per report) */
async function arrivals(env, cfg, day) {
  const out = [];
  for (const k of cfg.expect) {
    const r = await env.DB.prepare("SELECT v FROM meta WHERE k = ?").bind(k === "contracts" ? "contracts:last" : "portal:last:" + k).first().catch(() => null);
    let at = ""; try { at = r ? (JSON.parse(r.v).at || "") : ""; } catch { at = r ? r.v : ""; }
    out.push({ kind: k, label: MB_EXPECT[k] || k, at, today: !!at && beirutDay(at) === day });
  }
  return out;
}

/* cron (every 2 min): the import window, then the missing-report check */
export async function mbRun(env, d) {
  const cfg = await mbCfg(env); if (!cfg.on || !msOn(env)) return;
  const { day, min } = beirutNow();
  if (hm(cfg.from) && hm(cfg.to) && min >= toMin(cfg.from) && min < toMin(cfg.to)) {
    const last = await env.DB.prepare("SELECT v FROM meta WHERE k = 'mb:tick'").first().catch(() => null);
    if (!last || Date.now() - Number(last.v) >= (Number(cfg.every) || 10) * 60000 - 30000) {
      await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('mb:tick', ?)").bind(String(Date.now())).run();
      try { await mbPass(env, d); }
      catch (e) {
        await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('mb:lastrun', ?)").bind(JSON.stringify({ at: d.now(), error: e.message.slice(0, 300) })).run();
        const k = "mb:errsent:" + day;
        if (!(await env.DB.prepare("SELECT v FROM meta WHERE k = ?").bind(k).first())) {
          await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)").bind(k, d.now()).run();
          await d.notifyAdmins(env, "Report mailbox cannot be read", `${e.message} — Admin Control Center → Report mailbox.`).catch(() => {});
        }
      }
    }
  }
  if (hm(cfg.check) && min >= toMin(cfg.check) && cfg.expect.length) {
    const k = "mb:checked:" + day;
    if (await env.DB.prepare("SELECT v FROM meta WHERE k = ?").bind(k).first()) return;
    const list = await arrivals(env, cfg, day), miss = list.filter(x => !x.today);
    await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)").bind(k, JSON.stringify({ at: d.now(), missing: miss.map(x => x.kind) })).run();
    if (!miss.length) return;
    const names = miss.map(x => x.label).join(", "), body = `Not received today: ${names}. The hub still shows the previous figures. Check the Salesforce subscription / IT forward, or import the report by hand.`;
    await d.notifyAdmins(env, `${miss.length} portal report${miss.length > 1 ? "s" : ""} not received today`, body).catch(() => {});
    for (const site of Object.keys(d.SITES)) await d.raiseEvent(env, { site, app: "portal", tone: "warn", title: `Portal reports not received today: ${names}`, body }).catch(() => {});
  }
}

/* /api/admin/cc/mailbox… (Admin Control Center, unlocked) */
export async function mbRoute(env, a, method, b, me, d) {
  if (a === "cc/mailbox" && method === "GET") {
    const cfg = await mbCfg(env), { day } = beirutNow();
    const [conn, log, last, chk] = await Promise.all([rmbStatus(env),
      env.DB.prepare("SELECT received, subject, sender, files, result, ok, at FROM mb_log ORDER BY at DESC LIMIT 40").all(),
      env.DB.prepare("SELECT v FROM meta WHERE k = 'mb:lastrun'").first(), env.DB.prepare("SELECT v FROM meta WHERE k = ?").bind("mb:checked:" + day).first()]);
    return { cfg, conn, log: log.results || [], last: last ? JSON.parse(last.v) : null, checked: chk ? JSON.parse(chk.v) : null, today: await arrivals(env, cfg, day), kinds: MB_EXPECT };
  }
  if (method !== "POST") throw err("Unknown request", 404);
  if (a === "cc/mailbox/save") {
    const c = await mbCfg(env), n = { ...c };
    if (b.mailbox !== undefined) { const m = clip(b.mailbox, 120).toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m)) throw err("Type the mailbox address"); n.mailbox = m; }
    if (b.folder !== undefined) { const f = clip(b.folder, 80); if (!f) throw err("Type the folder name"); n.folder = f; }
    for (const k of ["from", "to", "check"]) if (b[k] !== undefined) { if (!hm(b[k])) throw err("Times as HH:MM"); n[k] = b[k]; }
    if (toMin(n.to) <= toMin(n.from)) throw err("The window must end after it starts");
    if (b.every !== undefined) n.every = Math.min(30, Math.max(5, Number(b.every) || 10));
    if (Array.isArray(b.expect)) n.expect = b.expect.filter(k => MB_EXPECT[k]);
    if (b.on !== undefined) n.on = !!b.on;
    await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('mb:cfg', ?)").bind(JSON.stringify(n)).run();
    return { cfg: n };
  }
  if (a === "cc/mailbox/connect") return { url: await rmbConnectUrl(env, d.hubUrl, me.email, clip(b.hint, 120)) };
  if (a === "cc/mailbox/disconnect") { await rmbDisconnect(env); const c = await mbCfg(env); c.on = false; await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('mb:cfg', ?)").bind(JSON.stringify(c)).run(); return { connected: false }; }
  if (a === "cc/mailbox/test") return mbPass(env, d, { dry: true });
  if (a === "cc/mailbox/run") return mbPass(env, d, { retry: true });
  throw err("Unknown request", 404);
}
