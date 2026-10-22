/* =====================================================================
   OUTLOOK SENDING (Microsoft Graph, delegated) — Oct 2026 — docs/FEATURE-outlook-send.md
   Each hub user connects their own Outlook once (Profile → Outlook → "Send from my Outlook"):
   Microsoft sign-in → the hub keeps that user's refresh token (AES-GCM encrypted) and sends AS THAT USER only
   (Mail.Send delegated). Emails land in the user's Sent Items; replies go to the user's inbox.
   • Automatic emails (morning brief, EOD, digests, sign-in codes…) go from the "automatic sender" chosen in Admin.
   • Anything that cannot go through Outlook falls back to the old mail relay (Apps Script), so nothing is lost.
   • Throttled sends (Microsoft 429) and bulk sends wait in ms_queue and leave at most QUOTA_RUN per sender per cron run.
   Off until the three Cloudflare secrets exist: MS_TENANT_ID · MS_CLIENT_ID · MS_CLIENT_SECRET.
   ===================================================================== */
const err = (m, status = 400) => Object.assign(new Error(m), { status });
const SCOPE = "offline_access User.Read Mail.Send";
const QUOTA_RUN = 25;                 // per sender per cron run (every 2 min) → ~12 / minute, well under Exchange's 30 / minute
const enc = new TextEncoder(), dec = new TextDecoder();
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64 = buf => { let s = ""; const a = new Uint8Array(buf); for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

export const msOn = env => !!(env.MS_TENANT_ID && env.MS_CLIENT_ID && env.MS_CLIENT_SECRET);
const redirectUri = hubUrl => `${hubUrl}/api/ms/callback`;

export async function outlookSchema(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS ms_tokens (email TEXT PRIMARY KEY, ms_user TEXT NOT NULL DEFAULT '', ms_name TEXT NOT NULL DEFAULT '',
      refresh TEXT NOT NULL DEFAULT '', access TEXT NOT NULL DEFAULT '', access_exp INTEGER NOT NULL DEFAULT 0,
      connected_at TEXT NOT NULL DEFAULT '', last_used TEXT NOT NULL DEFAULT '', sent INTEGER NOT NULL DEFAULT 0, last_error TEXT NOT NULL DEFAULT '')`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS ms_queue (id INTEGER PRIMARY KEY AUTOINCREMENT, sender TEXT NOT NULL, msg TEXT NOT NULL, created_at TEXT NOT NULL,
      tries INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'wait', sent_at TEXT NOT NULL DEFAULT '', error TEXT NOT NULL DEFAULT '', batch TEXT NOT NULL DEFAULT '')`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS ms_queue_wait ON ms_queue (status, sender, id)")
  ]);
}

/* ---------- small crypto: the refresh token is encrypted with a key derived from SESSION_SECRET ---------- */
async function aesKey(env) {
  const raw = await crypto.subtle.digest("SHA-256", enc.encode(`${env.SESSION_SECRET || ""}:outlook-tokens`));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function seal(env, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(env), enc.encode(text));
  return b64(iv) + "." + b64(ct);
}
async function open(env, sealed) {
  if (!sealed) return "";
  const [iv, ct] = sealed.split(".");
  return dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await aesKey(env), unb64(ct)));
}
async function hmac(env, text) {
  const k = await crypto.subtle.importKey("raw", enc.encode(`${env.SESSION_SECRET || ""}:outlook-state`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64u(await crypto.subtle.sign("HMAC", k, enc.encode(text)));
}
/* state = email|time|nonce|sig — signed, 15 minutes; the PKCE verifier is derived from it (nothing to store) */
async function makeState(env, email) {
  const body = `${email}|${Date.now()}|${b64u(crypto.getRandomValues(new Uint8Array(9)))}`;
  return b64u(enc.encode(body)) + "." + await hmac(env, body);
}
async function readState(env, state) {
  const [p, sig] = String(state || "").split(".");
  if (!p || !sig) return null;
  let body = ""; try { body = dec.decode(unb64(p.replace(/-/g, "+").replace(/_/g, "/"))); } catch { return null; }
  if (await hmac(env, body) !== sig) return null;
  const [email, t] = body.split("|");
  return Date.now() - Number(t) < 15 * 60000 ? email : null;
}
const verifierOf = async (env, state) => (await hmac(env, "pkce:" + state)) + "x".repeat(10);
const challengeOf = async v => b64u(await crypto.subtle.digest("SHA-256", enc.encode(v)));

/* ---------- Microsoft endpoints ---------- */
async function tokenCall(env, form) {
  const r = await fetch(`https://login.microsoftonline.com/${env.MS_TENANT_ID}/oauth2/v2.0/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.MS_CLIENT_ID, client_secret: env.MS_CLIENT_SECRET, scope: SCOPE, ...form }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) {
    const code = String(j.error || r.status), d = String(j.error_description || "").split("\r\n")[0].slice(0, 220);
    throw Object.assign(new Error(`Microsoft: ${code}${d ? " — " + d : ""}`), { ms: code, status: 502 });
  }
  return j;
}
/* a valid access token for this user (refreshes and keeps the newest refresh token) */
async function accessFor(env, email) {
  const row = await env.DB.prepare("SELECT * FROM ms_tokens WHERE email = ?").bind(email).first();
  if (!row || !row.refresh) return null;
  if (row.access && row.access_exp > Date.now() + 120000) { try { return await open(env, row.access); } catch {} }
  let j;
  try { j = await tokenCall(env, { grant_type: "refresh_token", refresh_token: await open(env, row.refresh) }); }
  catch (e) {
    const dead = /invalid_grant|interaction_required|consent_required/.test(e.ms || "");
    await env.DB.prepare(`UPDATE ms_tokens SET last_error = ?${dead ? ", refresh = '', access = ''" : ""} WHERE email = ?`).bind(e.message.slice(0, 300), email).run().catch(() => {});
    if (dead) return null;
    throw e;
  }
  await env.DB.prepare("UPDATE ms_tokens SET access = ?, access_exp = ?, refresh = CASE WHEN ? != '' THEN ? ELSE refresh END, last_error = '' WHERE email = ?")
    .bind(await seal(env, j.access_token), Date.now() + (Number(j.expires_in) || 3600) * 1000, j.refresh_token ? 1 : "", j.refresh_token ? await seal(env, j.refresh_token) : "", email).run();
  return j.access_token;
}
const addr = list => [...new Set((Array.isArray(list) ? list : [list]).map(x => String(x || "").trim()).filter(x => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)))]
  .slice(0, 400).map(address => ({ emailAddress: { address } }));
/* one email through Graph as `email`. → { ok } | { ok:false, error, retry, notConnected } */
async function graphSend(env, email, m) {
  let tok;
  try { tok = await accessFor(env, email); } catch (e) { return { ok: false, error: e.message, retry: true }; }
  if (!tok) return { ok: false, error: "Outlook not connected", notConnected: true };
  const message = { subject: String(m.subject || "").slice(0, 250), body: { contentType: "HTML", content: String(m.html || "") },
    toRecipients: addr(m.to), ccRecipients: addr(m.cc || []), bccRecipients: addr(m.bcc || []), replyTo: m.replyTo ? addr([m.replyTo]) : [] };
  if (m.attachment && m.attachment.base64) message.attachments = [{ "@odata.type": "#microsoft.graph.fileAttachment",
    name: m.attachment.fileName || "attachment", contentType: m.attachment.mimeType || "application/octet-stream", contentBytes: m.attachment.base64 }];
  if (!message.toRecipients.length && !message.ccRecipients.length && !message.bccRecipients.length) return { ok: false, error: "No valid recipient" };
  let r;
  try { r = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", { method: "POST", headers: { authorization: "Bearer " + tok, "content-type": "application/json" },
    body: JSON.stringify({ message, saveToSentItems: true }) }); }
  catch (e) { return { ok: false, error: "Microsoft cannot be reached", retry: true }; }
  if (r.status === 202 || r.ok) {
    await env.DB.prepare("UPDATE ms_tokens SET last_used = ?, sent = sent + 1, last_error = '' WHERE email = ?").bind(new Date().toISOString(), email).run().catch(() => {});
    return { ok: true, via: "outlook", from: email };
  }
  const j = await r.json().catch(() => ({})), e = ((j.error || {}).message || `Error ${r.status}`).slice(0, 300);
  await env.DB.prepare("UPDATE ms_tokens SET last_error = ? WHERE email = ?").bind(e, email).run().catch(() => {});
  if (r.status === 401) await env.DB.prepare("UPDATE ms_tokens SET access = '', access_exp = 0 WHERE email = ?").bind(email).run().catch(() => {});
  return { ok: false, error: `Outlook: ${e}`, retry: r.status === 429 || r.status >= 500 || r.status === 401 };
}
async function autoSender(env) {
  const r = await env.DB.prepare("SELECT v FROM meta WHERE k = 'ms:auto'").first().catch(() => null);
  return r ? r.v : "";
}
/* the sender for a message: the person who pressed send (if connected), otherwise the automatic sender */
async function pickSender(env, from) {
  const ok = async e => e && !!(await env.DB.prepare("SELECT 1 FROM ms_tokens WHERE email = ? AND refresh != ''").bind(e).first());
  if (await ok(from)) return from;
  const a = await autoSender(env);
  return (await ok(a)) ? a : "";
}

/* ---------- used by relay() in worker.js: Outlook first, the old relay as fallback ---------- */
export async function outlookSend(env, m) {
  if (!msOn(env)) return null;                       // not set up → caller uses the old relay
  const sender = await pickSender(env, m.from ? String(m.from).toLowerCase() : "");
  if (!sender) return null;
  const r = await graphSend(env, sender, m);
  if (r.ok) return r;
  if (r.retry) {                                     // throttled / Microsoft busy → wait in the queue, sent on the next cron runs
    await queueMail(env, sender, [m], "retry");
    return { ok: true, queued: true, via: "outlook", from: sender };
  }
  return null;                                        // not connected any more / refused → old relay
}
/* bulk: each message individually, paced by the cron. → batch id */
export async function queueMail(env, sender, msgs, batch = "") {
  const at = new Date().toISOString(), b = batch || `b${Date.now().toString(36)}`;
  const ops = msgs.slice(0, 2000).map(m => env.DB.prepare("INSERT INTO ms_queue (sender, msg, created_at, batch) VALUES (?,?,?,?)").bind(sender, JSON.stringify(m), at, b));
  for (let i = 0; i < ops.length; i += 90) await env.DB.batch(ops.slice(i, i + 90));
  return b;
}
export async function queueState(env, batch) {
  const r = await env.DB.prepare("SELECT status, COUNT(*) AS n FROM ms_queue WHERE batch = ? GROUP BY status").bind(batch).all();
  const o = { wait: 0, sent: 0, failed: 0 }; for (const x of r.results || []) o[x.status] = x.n;
  const f = await env.DB.prepare("SELECT msg, error FROM ms_queue WHERE batch = ? AND status = 'failed' LIMIT 50").bind(batch).all();
  return { ...o, total: o.wait + o.sent + o.failed, failedList: (f.results || []).map(x => { let m = {}; try { m = JSON.parse(x.msg); } catch {} return { to: [].concat(m.to || []).join(", "), error: x.error }; }) };
}

/* cron (every 2 minutes): send what waits, QUOTA_RUN per sender; secret expiry reminders once a day */
export async function outlookRun(env, deps) {
  if (!msOn(env)) return;
  const w = await env.DB.prepare("SELECT DISTINCT sender FROM ms_queue WHERE status = 'wait' LIMIT 20").all().catch(() => ({ results: [] }));
  for (const { sender } of w.results || []) {
    const { results } = await env.DB.prepare("SELECT id, msg, tries FROM ms_queue WHERE status = 'wait' AND sender = ? ORDER BY id LIMIT ?").bind(sender, QUOTA_RUN).all();
    for (const q of results || []) {
      let m = {}; try { m = JSON.parse(q.msg); } catch {}
      const r = await graphSend(env, sender, m);
      if (r.ok) { await env.DB.prepare("UPDATE ms_queue SET status = 'sent', sent_at = ?, msg = '' WHERE id = ?").bind(new Date().toISOString(), q.id).run(); continue; }
      if (r.retry && q.tries < 6) { await env.DB.prepare("UPDATE ms_queue SET tries = tries + 1, error = ? WHERE id = ?").bind(r.error, q.id).run(); if (/429|throttl/i.test(r.error)) break; continue; }
      if (r.notConnected && deps.fallback) {   // the sender disconnected: try the old relay once
        const f = await deps.fallback(env, m).catch(e => ({ ok: false, error: e.message }));
        if (f && f.ok) { await env.DB.prepare("UPDATE ms_queue SET status = 'sent', sent_at = ?, msg = '', error = 'via mail relay' WHERE id = ?").bind(new Date().toISOString(), q.id).run(); continue; }
      }
      await env.DB.prepare("UPDATE ms_queue SET status = 'failed', error = ? WHERE id = ?").bind(r.error, q.id).run();
    }
  }
  /* housekeeping + client secret expiry reminders (30 / 7 / 1 days), once a day */
  const today = deps.today();
  const g = await env.DB.prepare("SELECT v FROM meta WHERE k = 'ms:daily'").first().catch(() => null);
  if (g && g.v === today) return;
  await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('ms:daily', ?)").bind(today).run();
  await env.DB.prepare("DELETE FROM ms_queue WHERE status != 'wait' AND created_at < ?").bind(new Date(Date.now() - 14 * 864e5).toISOString()).run().catch(() => {});
  const ex = await env.DB.prepare("SELECT v FROM meta WHERE k = 'ms:secret_exp'").first().catch(() => null);
  if (!ex || !ex.v) return;
  const days = Math.round((Date.parse(ex.v + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 864e5);
  for (const n of [30, 7, 1]) {
    if (days > n || days < 0 && n !== 1) continue;
    const key = `ms:alerted:${ex.v}:${n}`;
    if (await env.DB.prepare("SELECT 1 FROM meta WHERE k = ?").bind(key).first()) continue;
    await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES (?, '1')").bind(key).run();
    const title = days < 0 ? "Outlook sending stopped — the Microsoft secret has expired" : `Outlook sending: the Microsoft secret expires in ${days} day${days === 1 ? "" : "s"}`;
    const body = `Ask IT for a new client secret (Entra → ABC Operations Hub → Certificates & secrets), then paste it in Cloudflare → operations-hub → MS_CLIENT_SECRET and update the date in Admin. Expiry: ${ex.v}.`;
    if (deps.notifyAdmins) await deps.notifyAdmins(env, title, body, days <= 7 ? "alert" : "warn").catch(() => {});
    break;
  }
}

/* ---------- routes ---------- */
/* GET /api/ms/callback — Microsoft sends the browser back here (public route: the signed state says who it is) */
export async function outlookCallback(env, url, hubUrl) {
  const back = (q) => Response.redirect(`${hubUrl}/?outlook=${q}`, 302);
  if (!msOn(env)) return back("off");
  const state = url.searchParams.get("state") || "", code = url.searchParams.get("code") || "";
  const email = await readState(env, state);
  if (!email) return back("expired");
  if (url.searchParams.get("error")) {
    const e = url.searchParams.get("error");
    return back(e === "access_denied" ? "denied" : "error");
  }
  let j;
  try { j = await tokenCall(env, { grant_type: "authorization_code", code, redirect_uri: redirectUri(hubUrl), code_verifier: await verifierOf(env, state) }); }
  catch (e) { await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)").bind("ms:lasterr:" + email, e.message.slice(0, 300)).run().catch(() => {}); return back("error"); }
  const me = await fetch("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,displayName", { headers: { authorization: "Bearer " + j.access_token } }).then(r => r.json()).catch(() => ({}));
  const msUser = String(me.mail || me.userPrincipalName || "").toLowerCase();
  if (msUser && msUser !== email && String(me.userPrincipalName || "").toLowerCase() !== email) {
    await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)").bind("ms:lasterr:" + email, `Signed in to Microsoft as ${msUser}, but your hub account is ${email}.`).run().catch(() => {});
    return back("mismatch");
  }
  const at = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO ms_tokens (email, ms_user, ms_name, refresh, access, access_exp, connected_at, last_error) VALUES (?,?,?,?,?,?,?,'')
    ON CONFLICT(email) DO UPDATE SET ms_user = excluded.ms_user, ms_name = excluded.ms_name, refresh = excluded.refresh, access = excluded.access,
    access_exp = excluded.access_exp, connected_at = excluded.connected_at, last_error = ''`)
    .bind(email, msUser || email, String(me.displayName || "").slice(0, 80), await seal(env, j.refresh_token || ""), await seal(env, j.access_token),
      Date.now() + (Number(j.expires_in) || 3600) * 1000, at).run();
  await env.DB.prepare("DELETE FROM meta WHERE k = ?").bind("ms:lasterr:" + email).run().catch(() => {});
  return back("connected");
}

/* /api/ms/* for the signed-in user */
export async function outlookRoute(env, p, method, b, me, hubUrl) {
  const email = me.email.toLowerCase();
  if (p === "ms/status") {
    const row = await env.DB.prepare("SELECT ms_user, ms_name, connected_at, last_used, sent, last_error, refresh != '' AS live FROM ms_tokens WHERE email = ?").bind(email).first().catch(() => null);
    const le = await env.DB.prepare("SELECT v FROM meta WHERE k = ?").bind("ms:lasterr:" + email).first().catch(() => null);
    return { on: msOn(env), connected: !!(row && row.live), msUser: row ? row.ms_user : "", connectedAt: row ? row.connected_at : "", lastUsed: row ? row.last_used : "",
      sent: row ? row.sent : 0, error: (row && !row.live && row.last_error) || (le ? le.v : ""), auto: (await autoSender(env)) === email };
  }
  if (!msOn(env)) throw err("Outlook sending is not set up yet — the administrator adds the Microsoft details first", 503);
  if (p === "ms/connect") {
    const state = await makeState(env, email);
    const q = new URLSearchParams({ client_id: env.MS_CLIENT_ID, response_type: "code", redirect_uri: redirectUri(hubUrl), response_mode: "query",
      scope: SCOPE, state, login_hint: email, prompt: "select_account", code_challenge: await challengeOf(await verifierOf(env, state)), code_challenge_method: "S256" });
    return { url: `https://login.microsoftonline.com/${env.MS_TENANT_ID}/oauth2/v2.0/authorize?${q}` };
  }
  if (p === "ms/disconnect" && method === "POST") {
    await env.DB.prepare("DELETE FROM ms_tokens WHERE email = ?").bind(email).run();
    return { connected: false };
  }
  if (p === "ms/test" && method === "POST") {
    const r = await graphSend(env, email, { to: [email], subject: "Test · sent from the ABC Operations Hub through your Outlook",
      html: `<p style="font-family:Calibri,Arial">This email was sent by the ABC Operations Hub <b>from your own Outlook</b>. It is in your Sent Items too.</p>` });
    if (!r.ok) throw err(r.error);
    return { sent: true };
  }
  if (p === "ms/batch" && method === "GET") return queueState(env, String(b.batch || ""));
  throw err("Unknown request", 404);
}

/* /api/admin/ms — settings and who is connected */
export async function outlookAdmin(env, method, b, me) {
  if (method === "POST") {
    if (b.expiry !== undefined) {
      const d = String(b.expiry || "");
      if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw err("Choose the expiry date");
      await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('ms:secret_exp', ?)").bind(d).run();
    }
    if (b.auto !== undefined) {
      const a = String(b.auto || "").toLowerCase();
      if (a && !(await env.DB.prepare("SELECT 1 FROM ms_tokens WHERE email = ? AND refresh != ''").bind(a).first())) throw err("This person has not connected their Outlook");
      await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('ms:auto', ?)").bind(a).run();
    }
  }
  const [rows, ex, q] = await Promise.all([
    env.DB.prepare("SELECT t.email, t.ms_user, t.connected_at, t.last_used, t.sent, t.last_error, t.refresh != '' AS live, u.full_name FROM ms_tokens t LEFT JOIN users u ON u.email = t.email ORDER BY u.full_name").all(),
    env.DB.prepare("SELECT v FROM meta WHERE k = 'ms:secret_exp'").first(),
    env.DB.prepare("SELECT status, COUNT(*) AS n FROM ms_queue WHERE created_at > ? GROUP BY status").bind(new Date(Date.now() - 864e5).toISOString()).all()]);
  const queue = { wait: 0, sent: 0, failed: 0 }; for (const x of q.results || []) queue[x.status] = x.n;
  return { on: msOn(env), tenant: env.MS_TENANT_ID || "", clientId: env.MS_CLIENT_ID ? env.MS_CLIENT_ID.slice(0, 8) + "…" : "",
    missing: ["MS_TENANT_ID", "MS_CLIENT_ID", "MS_CLIENT_SECRET"].filter(k => !env[k]),
    expiry: ex ? ex.v : "", auto: await autoSender(env), queue,
    users: (rows.results || []).map(r => ({ email: r.email, name: r.full_name || r.email, msUser: r.ms_user, connectedAt: r.connected_at, lastUsed: r.last_used, sent: r.sent, live: !!r.live, error: r.last_error })) };
}
