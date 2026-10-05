/* =====================================================================
   OUTLOOK ADD-IN — feature module (kept separate so it can be removed cleanly)
   See docs/FEATURE-outlook-addin.md   ·   Add-in files: /outlook-addin/

   The "ABC Hub" button in Outlook opens a side panel (outlook-addin/taskpane.html, served by the hub) that can:
     • send the email's PDF attachments to Tenant Works Forms
     • add the email to the day's shift handover (Today / Tomorrow / Ongoing)
     • log it as tenant feedback
     • put it in the Operations Calendar (marketing event, ops activity, expiry date)
   Outlook on the web runs the panel inside its own page, where the hub's sign-in cookie is not sent,
   so the panel signs in with a device token instead:
     the person opens the hub → Profile settings → Outlook → "Connect Outlook" → a 6-digit code (10 minutes)
     → types email + code in the panel → the panel keeps a token (120 days) and sends it as "Authorization: Bearer".
   A token can only reach /api/me, /api/ops/* and /api/addin/* — never administration or 2-step settings.
   Tables : addin_tokens · addin_codes
   ===================================================================== */

const err = (m, status = 400) => Object.assign(new Error(m), { status });
const te = new TextEncoder();
const b64u = a => { let s = ""; for (const b of new Uint8Array(a)) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
const sha = async t => [...new Uint8Array(await crypto.subtle.digest("SHA-256", te.encode(t)))].map(b => b.toString(16).padStart(2, "0")).join("");
const TOKEN_DAYS = 120, CODE_MIN = 10, MAX_TRIES = 5;

export async function addinSchema(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS addin_tokens (hash TEXT PRIMARY KEY, email TEXT NOT NULL, label TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL, last_used TEXT NOT NULL DEFAULT '', expires_at TEXT NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS addin_codes (email TEXT PRIMARY KEY, code TEXT NOT NULL, expires_at TEXT NOT NULL, tries INTEGER NOT NULL DEFAULT 0)`)
  ]);
}

/* public: the panel exchanges email + 6-digit code for a token */
export async function addinPair(env, b, request) {
  const email = String(b.email || "").trim().toLowerCase(), code = String(b.code || "").replace(/\D/g, "");
  if (!email || code.length !== 6) throw err("Enter your email and the 6-digit code shown in the hub");
  const row = await env.DB.prepare("SELECT * FROM addin_codes WHERE email = ?").bind(email).first();
  if (!row || row.expires_at < new Date().toISOString()) throw err("No valid code for this email — open the hub → Profile settings → Outlook → Connect Outlook.", 401);
  if (row.tries >= MAX_TRIES) throw err("Too many wrong codes — make a new one in the hub.", 429);
  if (row.code !== await sha(`${email}|${code}`)) {
    await env.DB.prepare("UPDATE addin_codes SET tries = tries + 1 WHERE email = ?").bind(email).run();
    throw err("That code is not right.", 401);
  }
  const u = await env.DB.prepare("SELECT email, full_name, active FROM users WHERE email = ?").bind(email).first();
  if (!u || !u.active) throw err("This account is switched off.", 403);
  const token = b64u(crypto.getRandomValues(new Uint8Array(32)));
  const ua = String(request.headers.get("user-agent") || "");
  const label = /Outlook|Office/i.test(ua) ? (/Windows/.test(ua) ? "Outlook · Windows" : /Mac/.test(ua) ? "Outlook · Mac" : "Outlook") : "Outlook on the web";
  await env.DB.batch([
    env.DB.prepare("INSERT INTO addin_tokens (hash, email, label, created_at, expires_at) VALUES (?,?,?,?,?)")
      .bind(await sha(token), email, label, new Date().toISOString(), new Date(Date.now() + TOKEN_DAYS * 864e5).toISOString()),
    env.DB.prepare("DELETE FROM addin_codes WHERE email = ?").bind(email)
  ]);
  return { token, name: u.full_name };
}

/* the person behind an "Authorization: Bearer" token (or null) */
export async function addinUser(env, request) {
  const m = /^Bearer\s+([A-Za-z0-9_-]{30,})$/.exec(request.headers.get("authorization") || "");
  if (!m) return null;
  const h = await sha(m[1]);
  const t = await env.DB.prepare("SELECT * FROM addin_tokens WHERE hash = ?").bind(h).first();
  if (!t || t.expires_at < new Date().toISOString()) return null;
  const u = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(t.email).first();
  if (!u || !u.active) return null;
  if (!t.last_used || Date.now() - Date.parse(t.last_used) > 3600e3) await env.DB.prepare("UPDATE addin_tokens SET last_used = ? WHERE hash = ?").bind(new Date().toISOString(), h).run();
  return Object.assign(u, { _addin: true });
}
/* paths a token may use */
export const addinAllowed = path => path === "me" || path.startsWith("ops/") || path === "addin/context" || path === "addin/disconnect";

/* signed in (hub session): make a code, list / remove connected Outlooks.  Token: context, disconnect */
export async function addinRoute(env, path, method, b, request, me, d) {
  if (path === "addin/code" && method === "POST") {
    if (me._addin) throw err("Not allowed from Outlook", 403);
    const code = String(100000 + (new DataView(crypto.getRandomValues(new Uint8Array(4)).buffer).getUint32(0) % 900000));
    await env.DB.prepare("INSERT OR REPLACE INTO addin_codes (email, code, expires_at, tries) VALUES (?,?,?,0)")
      .bind(me.email, await sha(`${me.email}|${code}`), new Date(Date.now() + CODE_MIN * 60e3).toISOString()).run();
    return { code, minutes: CODE_MIN, email: me.email };
  }
  if (path === "addin/list") {
    const { results } = await env.DB.prepare("SELECT hash, label, created_at, last_used, expires_at FROM addin_tokens WHERE email = ? ORDER BY created_at DESC").bind(me.email).all();
    return { list: (results || []).map(r => ({ id: r.hash.slice(0, 16), label: r.label, created: r.created_at, lastUsed: r.last_used, expires: r.expires_at })) };
  }
  if (path === "addin/remove" && method === "POST") {
    if (me._addin) throw err("Not allowed from Outlook", 403);
    if (b.all) await env.DB.prepare("DELETE FROM addin_tokens WHERE email = ?").bind(me.email).run();
    else await env.DB.prepare("DELETE FROM addin_tokens WHERE email = ? AND substr(hash, 1, 16) = ?").bind(me.email, String(b.id || "")).run();
    return { removed: true };
  }
  if (path === "addin/disconnect" && method === "POST") {
    const m = /^Bearer\s+(\S+)$/.exec(request.headers.get("authorization") || "");
    if (m) await env.DB.prepare("DELETE FROM addin_tokens WHERE hash = ?").bind(await sha(m[1])).run();
    return { disconnected: true };
  }
  if (path === "addin/context") return d.context(me);
  return null;
}
