/* =====================================================================
   TWO-STEP LOGIN — feature module (kept separate so it can be removed cleanly)
   See docs/FEATURE-two-step.md

   After the password, the hub asks for a second proof — one of:
     • Approve on your phone ... a notification on the phone chosen at setup; the person picks the number shown
                                  on the laptop and confirms with Face ID / fingerprint / phone PIN (WebAuthn)
     • Authenticator app ....... 6-digit code (TOTP, any app: Microsoft / Google Authenticator, Authy)
     • Backup code ............. 8 one-time codes given at setup
   "Trust this device for 30 days" skips the second step on that device.
   Admins choose which roles must use it and can reset a person who lost the phone.

   Tables : user_2fa · login_challenges · trusted_devices   (+ users.twofa_fail / twofa_lock)
   Routes : public   /api/login/2fa/status · /api/login/2fa/code · /api/login/2fa/resend
            signed in /api/2fa/*   ·   admin /api/admin/2fa/*
   ===================================================================== */

const err = (m, status = 400) => Object.assign(new Error(m), { status });
const te = new TextEncoder(), td = new TextDecoder();
const b64u = bytes => { let s = ""; const a = new Uint8Array(bytes); for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
const unb64u = str => { const s = String(str || "").replace(/-/g, "+").replace(/_/g, "/"); const bin = atob(s + "===".slice((s.length + 3) % 4)); return Uint8Array.from(bin, c => c.charCodeAt(0)); };
const rand = n => crypto.getRandomValues(new Uint8Array(n));
const sha256 = async data => new Uint8Array(await crypto.subtle.digest("SHA-256", typeof data === "string" ? te.encode(data) : data));
const hex = a => [...a].map(b => b.toString(16).padStart(2, "0")).join("");
const cat = (...arrs) => { const o = new Uint8Array(arrs.reduce((s, a) => s + a.length, 0)); let i = 0; for (const a of arrs) { o.set(a, i); i += a.length; } return o; };
const eqs = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

const CHALLENGE_MIN = 2;          // an approval request is valid 2 minutes
const PRE_MIN = 10;               // the password step is remembered 10 minutes
const TRUST_DAYS = 30;
const MAX_FAILS = 5, LOCK_MIN = 15;
const ISSUER = "ABC Operations Hub";

export async function twofaSchema(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS user_2fa (email TEXT PRIMARY KEY, totp TEXT NOT NULL DEFAULT '', totp_pending TEXT NOT NULL DEFAULT '',
      totp_on INTEGER NOT NULL DEFAULT 0, last_step INTEGER NOT NULL DEFAULT 0, backup TEXT NOT NULL DEFAULT '[]',
      cred_id TEXT NOT NULL DEFAULT '', cred_key TEXT NOT NULL DEFAULT '', cred_alg INTEGER NOT NULL DEFAULT 0, reg_chal TEXT NOT NULL DEFAULT '',
      approve_ep TEXT NOT NULL DEFAULT '', approve_device TEXT NOT NULL DEFAULT '', approve_on INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT '')`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS login_challenges (id TEXT PRIMARY KEY, email TEXT NOT NULL, number INTEGER NOT NULL, options TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', wchal TEXT NOT NULL DEFAULT '', ua TEXT NOT NULL DEFAULT '', ip TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL, expires_at TEXT NOT NULL, decided_at TEXT NOT NULL DEFAULT '')`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS trusted_devices (hash TEXT PRIMARY KEY, email TEXT NOT NULL, ua TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL, expires_at TEXT NOT NULL)`)
  ]);
  await env.DB.prepare("ALTER TABLE users ADD COLUMN twofa_fail INTEGER NOT NULL DEFAULT 0").run().catch(() => {});
  await env.DB.prepare("ALTER TABLE users ADD COLUMN twofa_lock TEXT NOT NULL DEFAULT ''").run().catch(() => {});
}

/* ---------- secrets at rest: AES-GCM with a key derived from SESSION_SECRET ---------- */
async function aesKey(env) { return crypto.subtle.importKey("raw", await sha256(`${env.SESSION_SECRET}|two-step`), "AES-GCM", false, ["encrypt", "decrypt"]); }
async function seal(env, text) { const iv = rand(12); const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(env), te.encode(text)); return b64u(iv) + "." + b64u(ct); }
async function unseal(env, s) { if (!s) return ""; const [iv, ct] = s.split("."); return td.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64u(iv) }, await aesKey(env), unb64u(ct))); }

/* ---------- TOTP (RFC 6238, SHA-1, 30 s, 6 digits) ---------- */
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const b32enc = bytes => { let bits = 0, val = 0, out = ""; for (const b of bytes) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } } if (bits > 0) out += B32[(val << (5 - bits)) & 31]; return out; };
const b32dec = s => { const clean = String(s).toUpperCase().replace(/[^A-Z2-7]/g, ""); let bits = 0, val = 0; const out = []; for (const c of clean) { val = (val << 5) | B32.indexOf(c); bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } } return new Uint8Array(out); };
async function totpAt(secret, step) {
  const key = await crypto.subtle.importKey("raw", b32dec(secret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const msg = new Uint8Array(8); new DataView(msg.buffer).setUint32(4, step);
  const h = new Uint8Array(await crypto.subtle.sign("HMAC", key, msg)); const o = h[19] & 15;
  return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, "0");
}
async function totpCheck(secret, code, lastStep) {
  const now = Math.floor(Date.now() / 30000);
  for (const d of [0, -1, 1]) { const step = now + d; if (step <= lastStep) continue; if (await totpAt(secret, step) === code) return step; }
  return 0;
}
export const _totpAt = totpAt;   // for tests

/* ---------- backup codes ---------- */
async function newBackup(email) {
  const codes = Array.from({ length: 8 }, () => { const s = b32enc(rand(5)).slice(0, 8); return s.slice(0, 4) + "-" + s.slice(4); });
  const hashes = await Promise.all(codes.map(async c => hex(await sha256(`${email}|${c.replace(/-/g, "")}`))));
  return { codes, hashes };
}

/* ---------- WebAuthn (Face ID / fingerprint / phone PIN) ---------- */
function derToRaw(der) {   /* ECDSA signature DER → r||s (64 bytes) */
  let i = 2; if (der[1] & 0x80) i += der[1] & 0x7f;
  const read = () => { i++; const len = der[i++]; let v = der.slice(i, i + len); i += len; while (v.length > 32 && v[0] === 0) v = v.slice(1); const o = new Uint8Array(32); o.set(v, 32 - v.length); return o; };
  const r = read(), s = read(); return cat(r, s);
}
async function verifyAssertion(st, a, expectChallenge, origin, rpId) {
  const cdBytes = unb64u(a.clientDataJSON), cd = JSON.parse(td.decode(cdBytes));
  if (cd.type !== "webauthn.get") throw err("Wrong confirmation type");
  if (cd.challenge !== expectChallenge) throw err("This confirmation is for another request");
  if (cd.origin !== origin) throw err("Confirmation from another website");
  if (a.id && a.id !== st.cred_id) throw err("This phone is not the one set up for approvals");
  const ad = unb64u(a.authenticatorData);
  if (hex(ad.slice(0, 32)) !== hex(await sha256(rpId))) throw err("Confirmation for another website");
  if (!(ad[32] & 0x01) || !(ad[32] & 0x04)) throw err("Face ID, fingerprint or the phone PIN is needed");
  const data = cat(ad, await sha256(cdBytes)), sig = unb64u(a.signature);
  let ok;
  if (st.cred_alg === -257) {
    const k = await crypto.subtle.importKey("spki", unb64u(st.cred_key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", k, sig, data);
  } else {
    const k = await crypto.subtle.importKey("spki", unb64u(st.cred_key), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, k, derToRaw(sig), data);
  }
  if (!ok) throw err("Face ID / fingerprint confirmation could not be verified");
}

/* ---------- small helpers ---------- */
const deviceLabel = ua => {
  ua = String(ua || "");
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS X|Macintosh/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "Device";
  const br = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return `${os} · ${br}`;
};
const beirutTime = iso => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Beirut", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
async function stateOf(env, email) { return env.DB.prepare("SELECT * FROM user_2fa WHERE email = ?").bind(email).first(); }
async function ensureRow(env, email) { await env.DB.prepare("INSERT OR IGNORE INTO user_2fa (email, updated_at) VALUES (?,?)").bind(email, new Date().toISOString()).run(); }
export async function requiredRoles(env) {
  const r = await env.DB.prepare("SELECT v FROM meta WHERE k = 'twofa:required'").first().catch(() => null);
  try { return r ? JSON.parse(r.v) : []; } catch { return []; }
}
const cookie = (name, v, secs, path = "/") => `${name}=${v}; Path=${path}; Max-Age=${secs}; HttpOnly; Secure; SameSite=Lax`;
const readCookie = (request, name) => ((request.headers.get("cookie") || "").match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`)) || [])[1] || "";

async function makePre(env, deps, email) {
  const body = b64u(te.encode(JSON.stringify({ e: email, exp: Date.now() + PRE_MIN * 60e3, k: "pre" })));
  return `${body}.${await deps.hmac(env.SESSION_SECRET, "pre|" + body)}`;
}
async function readPre(env, deps, request) {
  const v = readCookie(request, "hub_pre"); if (!v) return "";
  const [body, sig] = v.split(".");
  if (!body || !sig || !eqs(await deps.hmac(env.SESSION_SECRET, "pre|" + body), sig)) return "";
  const p = JSON.parse(td.decode(unb64u(body)));
  return p.exp > Date.now() && p.k === "pre" ? p.e : "";
}

/* the person has passed both steps → session cookie (+ trust cookie) */
async function finish(env, deps, request, email, trust) {
  const u = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
  if (!u || !u.active) throw err("This account is switched off. Contact your administrator.", 403);
  await env.DB.prepare("UPDATE users SET last_login_at = ?, twofa_fail = 0, twofa_lock = '' WHERE email = ?").bind(new Date().toISOString(), email).run();
  const cookies = [deps.cookieFor(await deps.makeSession(env, email)), cookie("hub_pre", "", 0)];
  if (trust) {
    const token = b64u(rand(24)), exp = new Date(Date.now() + TRUST_DAYS * 864e5).toISOString();
    await env.DB.prepare("INSERT INTO trusted_devices (hash, email, ua, created_at, expires_at) VALUES (?,?,?,?,?)")
      .bind(hex(await sha256(token)), email, String(request.headers.get("user-agent") || "").slice(0, 160), new Date().toISOString(), exp).run();
    cookies.push(cookie("hub_trust", token, TRUST_DAYS * 86400));
  }
  const h = new Headers({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  cookies.forEach(c => h.append("set-cookie", c));
  return new Response(JSON.stringify({ ok: true, data: { signedIn: true, user: deps.userOut(u) } }), { status: 200, headers: h });
}

async function newChallenge(env, deps, request, u, st) {
  const number = 10 + (rand(1)[0] % 90);
  const opts = new Set([number]); while (opts.size < 3) opts.add(10 + (rand(1)[0] % 90));
  const options = [...opts].sort(() => rand(1)[0] - 128);
  const id = b64u(rand(18)), now = new Date(), exp = new Date(now.getTime() + CHALLENGE_MIN * 60e3);
  const ua = String(request.headers.get("user-agent") || "").slice(0, 200);
  await env.DB.prepare(`INSERT INTO login_challenges (id, email, number, options, status, ua, ip, created_at, expires_at) VALUES (?,?,?,?, 'pending', ?,?,?,?)`)
    .bind(id, u.email, number, JSON.stringify(options), ua, String(request.headers.get("cf-connecting-ip") || ""), now.toISOString(), exp.toISOString()).run();
  let pushed = false;
  const sub = st.approve_ep ? await env.DB.prepare("SELECT * FROM push_subs WHERE endpoint = ? AND email = ?").bind(st.approve_ep, u.email).first() : null;
  if (sub) {
    const r = await deps.sendPush(env, sub, { title: "Sign-in request · ABC Operations Hub", body: `${deviceLabel(ua)} · ${beirutTime(now.toISOString())} — tap to approve`,
      url: `/#/approve/${id}`, tag: `approve-${id}`, tone: "alert", ttl: CHALLENGE_MIN * 60 });
    pushed = !!r.ok;
  }
  return { id, number, expiresAt: exp.toISOString(), pushed };
}

/* ---------- called by login() after the password is right ---------- */
export async function twofaGate(env, deps, request, u, b) {
  const st = await stateOf(env, u.email);
  const enrolled = st && (st.totp_on || st.approve_on);
  if (!enrolled) return null;                                       // not set up → normal sign-in (setup is asked inside the hub if required)
  const trust = readCookie(request, "hub_trust");
  if (trust) {
    const t = await env.DB.prepare("SELECT * FROM trusted_devices WHERE hash = ? AND email = ?").bind(hex(await sha256(trust)), u.email).first();
    if (t && t.expires_at > new Date().toISOString()) return null;   // trusted device
  }
  if (u.twofa_lock && u.twofa_lock > new Date().toISOString()) throw err(`Too many wrong codes. Try again after ${beirutTime(u.twofa_lock)}.`, 429);
  const methods = [...(st.approve_on ? ["approve"] : []), ...(st.totp_on ? ["code"] : []), "backup"];
  const challenge = st.approve_on ? await newChallenge(env, deps, request, u, st) : null;
  const h = new Headers({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  h.append("set-cookie", cookie("hub_pre", await makePre(env, deps, u.email), PRE_MIN * 60));
  return new Response(JSON.stringify({ ok: true, data: { twofa: { methods, challenge, name: u.full_name.split(" ")[0] } } }), { status: 200, headers: h });
}

async function fail2(env, email) {
  const u = await env.DB.prepare("SELECT twofa_fail FROM users WHERE email = ?").bind(email).first();
  const n = Number(u && u.twofa_fail || 0) + 1;
  const lock = n >= MAX_FAILS ? new Date(Date.now() + LOCK_MIN * 60e3).toISOString() : "";
  await env.DB.prepare("UPDATE users SET twofa_fail = ?, twofa_lock = ? WHERE email = ?").bind(lock ? 0 : n, lock, email).run();
  return lock;
}

/* ---------- public routes: the laptop waiting after the password ---------- */
export async function twofaPublic(env, deps, path, method, b, request) {
  const email = await readPre(env, deps, request);
  if (!email) throw err("Your sign-in has timed out. Enter your email and password again.", 401);
  const u = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
  if (!u || !u.active) throw err("This account is switched off.", 403);
  const st = await stateOf(env, email);
  if (!st) throw err("Two-step login is not set up for this account.", 400);

  if (path === "login/2fa/status") {
    const c = await env.DB.prepare("SELECT * FROM login_challenges WHERE id = ? AND email = ?").bind(String(b.id || ""), email).first();
    if (!c) throw err("Request not found", 404);
    let status = c.status;
    if (status === "pending" && c.expires_at < new Date().toISOString()) status = "expired";
    if (status === "approved") {
      await env.DB.prepare("UPDATE login_challenges SET status = 'used' WHERE id = ?").bind(c.id).run();
      return finish(env, deps, request, email, !!b.trust);
    }
    return { ok: true, data: { status } };
  }
  /* signing in on the approval phone itself: confirm right here with Face ID / fingerprint */
  if (path === "login/2fa/passkey-options" && method === "POST") {
    if (!st.approve_on) throw err("Approve on phone is not set up.");
    const chal = b64u(rand(32));
    await env.DB.prepare("UPDATE user_2fa SET reg_chal = ? WHERE email = ?").bind("L:" + chal, email).run();
    return { ok: true, data: { publicKey: { challenge: chal, rpId: new URL(request.url).hostname, userVerification: "required", timeout: 60000,
      allowCredentials: [{ type: "public-key", id: st.cred_id, transports: ["internal"] }] } } };
  }
  if (path === "login/2fa/passkey" && method === "POST") {
    if (!st.approve_on || !String(st.reg_chal).startsWith("L:")) throw err("Start again.");
    const url = new URL(request.url);
    try { await verifyAssertion(st, b.assertion || {}, st.reg_chal.slice(2), url.origin, url.hostname); }
    catch (e) { await fail2(env, email); throw e; }
    await env.DB.prepare("UPDATE user_2fa SET reg_chal = '' WHERE email = ?").bind(email).run();
    return finish(env, deps, request, email, !!b.trust);
  }
  if (path === "login/2fa/resend" && method === "POST") {
    if (!st.approve_on) throw err("Approve on phone is not set up.");
    return { ok: true, data: { challenge: await newChallenge(env, deps, request, u, st) } };
  }
  if (path === "login/2fa/code" && method === "POST") {
    if (u.twofa_lock && u.twofa_lock > new Date().toISOString()) throw err(`Too many wrong codes. Try again after ${beirutTime(u.twofa_lock)}.`, 429);
    const raw = String(b.code || "").trim().toUpperCase().replace(/\s/g, "");
    if (/^\d{6}$/.test(raw) && st.totp_on) {
      const step = await totpCheck(await unseal(env, st.totp), raw, st.last_step);
      if (step) { await env.DB.prepare("UPDATE user_2fa SET last_step = ? WHERE email = ?").bind(step, email).run(); return finish(env, deps, request, email, !!b.trust); }
    } else if (/^[A-Z2-7]{4}-?[A-Z2-7]{4}$/.test(raw)) {
      const h = hex(await sha256(`${email}|${raw.replace(/-/g, "")}`)), list = JSON.parse(st.backup || "[]");
      if (list.includes(h)) {
        await env.DB.prepare("UPDATE user_2fa SET backup = ? WHERE email = ?").bind(JSON.stringify(list.filter(x => x !== h)), email).run();
        return finish(env, deps, request, email, !!b.trust);
      }
    }
    const lock = await fail2(env, email);
    throw err(lock ? `Too many wrong codes. Try again after ${beirutTime(lock)}.` : "That code is not right. Check the app and try again.", lock ? 429 : 401);
  }
  throw err("Unknown endpoint", 404);
}

/* ---------- signed-in routes: setup, the phone approving, turning off ---------- */
export async function twofaRoute(env, deps, path, method, b, url, request, me) {
  const st = await stateOf(env, me.email);
  const roles = await requiredRoles(env);
  const required = roles.includes(me.role);
  const origin = url.origin, rpId = url.hostname;

  if (path === "2fa/status") {
    const trusted = await env.DB.prepare("SELECT COUNT(*) AS n FROM trusted_devices WHERE email = ? AND expires_at > ?").bind(me.email, new Date().toISOString()).first();
    return { required, totpOn: !!(st && st.totp_on), approveOn: !!(st && st.approve_on), approveDevice: st ? deviceLabel(st.approve_device) : "",
      backupLeft: st ? JSON.parse(st.backup || "[]").length : 0, trusted: Number(trusted.n || 0) };
  }
  if (path === "2fa/pending") {   /* the phone opens the hub: is a sign-in waiting for my approval? */
    if (!st || !st.approve_on) return { id: "" };
    const c = await env.DB.prepare("SELECT id FROM login_challenges WHERE email = ? AND status = 'pending' AND expires_at > ? ORDER BY created_at DESC LIMIT 1")
      .bind(me.email, new Date().toISOString()).first();
    return { id: c ? c.id : "" };
  }
  /* authenticator app */
  if (path === "2fa/totp/start" && method === "POST") {
    await ensureRow(env, me.email);
    const secret = b32enc(rand(20));
    await env.DB.prepare("UPDATE user_2fa SET totp_pending = ?, updated_at = ? WHERE email = ?").bind(await seal(env, secret), new Date().toISOString(), me.email).run();
    const label = encodeURIComponent(`${ISSUER}:${me.email}`);
    return { secret, uri: `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(ISSUER)}&algorithm=SHA1&digits=6&period=30` };
  }
  if (path === "2fa/totp/confirm" && method === "POST") {
    if (!st || !st.totp_pending) throw err("Start the setup again.");
    const code = String(b.code || "").replace(/\s/g, "");
    const step = /^\d{6}$/.test(code) ? await totpCheck(await unseal(env, st.totp_pending), code, 0) : 0;
    if (!step) throw err("That code is not right — check the app (the code changes every 30 seconds).");
    const give = JSON.parse(st.backup || "[]").length ? null : await newBackup(me.email);
    await env.DB.prepare("UPDATE user_2fa SET totp = totp_pending, totp_pending = '', totp_on = 1, last_step = ?, backup = ?, updated_at = ? WHERE email = ?")
      .bind(step, give ? JSON.stringify(give.hashes) : st.backup, new Date().toISOString(), me.email).run();
    return { on: true, backup: give ? give.codes : null };
  }
  /* approve on this phone */
  if (path === "2fa/approve/options" && method === "POST") {
    await ensureRow(env, me.email);
    const chal = b64u(rand(32));
    await env.DB.prepare("UPDATE user_2fa SET reg_chal = ? WHERE email = ?").bind(chal, me.email).run();
    return { publicKey: { challenge: chal, rp: { name: ISSUER, id: rpId }, user: { id: b64u(await sha256(me.email)), name: me.email, displayName: me.full_name },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }], timeout: 60000, attestation: "none",
      authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "discouraged" } } };
  }
  if (path === "2fa/approve/register" && method === "POST") {
    if (!st || !st.reg_chal) throw err("Start the setup again.");
    const cd = JSON.parse(td.decode(unb64u(b.clientDataJSON)));
    if (cd.type !== "webauthn.create" || cd.challenge !== st.reg_chal || cd.origin !== origin) throw err("The Face ID / fingerprint setup could not be verified — try again.");
    const alg = Number(b.alg) === -257 ? -257 : -7;
    try { await crypto.subtle.importKey("spki", unb64u(b.publicKey), alg === -257 ? { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } : { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]); }
    catch { throw err("This phone's key type is not supported — use the authenticator app instead."); }
    const sub = await env.DB.prepare("SELECT endpoint, device FROM push_subs WHERE endpoint = ? AND email = ?").bind(String(b.endpoint || ""), me.email).first();
    if (!sub) throw err("Turn on alerts on this phone first, so the sign-in requests can reach it.");
    const give = JSON.parse(st.backup || "[]").length ? null : await newBackup(me.email);
    await env.DB.prepare(`UPDATE user_2fa SET cred_id = ?, cred_key = ?, cred_alg = ?, reg_chal = '', approve_ep = ?, approve_device = ?, approve_on = 1, backup = ?, updated_at = ? WHERE email = ?`)
      .bind(String(b.id), String(b.publicKey), alg, sub.endpoint, String(request.headers.get("user-agent") || sub.device || "").slice(0, 200),
        give ? JSON.stringify(give.hashes) : st.backup, new Date().toISOString(), me.email).run();
    return { on: true, backup: give ? give.codes : null, device: deviceLabel(request.headers.get("user-agent")) };
  }
  if (path === "2fa/approve/get") {
    const c = await env.DB.prepare("SELECT * FROM login_challenges WHERE id = ? AND email = ?").bind(String(url.searchParams.get("id") || ""), me.email).first();
    if (!c) throw err("This sign-in request was not found.", 404);
    const expired = c.expires_at < new Date().toISOString();
    if (c.status !== "pending" || expired) return { status: expired && c.status === "pending" ? "expired" : c.status };
    if (!st || !st.approve_on) throw err("Approve on phone is not set up on this account.");
    const wchal = b64u(rand(32));
    await env.DB.prepare("UPDATE login_challenges SET wchal = ? WHERE id = ?").bind(wchal, c.id).run();
    return { status: "pending", device: deviceLabel(c.ua), time: beirutTime(c.created_at), expiresAt: c.expires_at, options: JSON.parse(c.options),
      publicKey: { challenge: wchal, rpId, allowCredentials: [{ type: "public-key", id: st.cred_id, transports: ["internal"] }], userVerification: "required", timeout: 60000 } };
  }
  if (path === "2fa/approve/decide" && method === "POST") {
    const c = await env.DB.prepare("SELECT * FROM login_challenges WHERE id = ? AND email = ?").bind(String(b.id || ""), me.email).first();
    if (!c) throw err("This sign-in request was not found.", 404);
    if (c.status !== "pending" || c.expires_at < new Date().toISOString()) throw err("This request has expired — sign in again on the other device.");
    const decide = async (status, note) => {
      await env.DB.prepare("UPDATE login_challenges SET status = ?, decided_at = ? WHERE id = ?").bind(status, new Date().toISOString(), c.id).run();
      if (status === "denied" && deps.alertAdmins) await deps.alertAdmins(env, `Sign-in blocked · ${me.full_name}`, `${note} · ${deviceLabel(c.ua)} · ${beirutTime(c.created_at)}`).catch(() => {});
      return { status };
    };
    if (b.deny) return decide("denied", "Denied on the phone (“This wasn't me”)");
    if (Number(b.pick) !== c.number) return decide("denied", "Wrong number picked on the phone");
    await verifyAssertion(st, b.assertion || {}, c.wchal, origin, rpId);
    return decide("approved");
  }
  /* backup codes, trusted devices, turning off */
  if (path === "2fa/backup/new" && method === "POST") {
    if (!st || !(st.totp_on || st.approve_on)) throw err("Turn on two-step login first.");
    const give = await newBackup(me.email);
    await env.DB.prepare("UPDATE user_2fa SET backup = ? WHERE email = ?").bind(JSON.stringify(give.hashes), me.email).run();
    return { backup: give.codes };
  }
  if (path === "2fa/trusted/clear" && method === "POST") {
    await env.DB.prepare("DELETE FROM trusted_devices WHERE email = ?").bind(me.email).run();
    return { cleared: true };
  }
  if (path === "2fa/off" && method === "POST") {
    if (!st) return { off: true };
    if (!(await deps.checkPassword(me, String(b.password || "")))) throw err("Your password is not right.", 401);
    const what = b.what === "approve" ? "approve" : b.what === "totp" ? "totp" : "all";
    const left = (what === "approve" ? st.totp_on : what === "totp" ? st.approve_on : 0);
    if (required && !left) throw err("Two-step login is required for your role — keep at least one way on.");
    if (what === "all" || !left) {
      await env.DB.prepare("DELETE FROM user_2fa WHERE email = ?").bind(me.email).run();
      await env.DB.prepare("DELETE FROM trusted_devices WHERE email = ?").bind(me.email).run();
    } else if (what === "approve") await env.DB.prepare("UPDATE user_2fa SET approve_on = 0, cred_id = '', cred_key = '', approve_ep = '' WHERE email = ?").bind(me.email).run();
    else await env.DB.prepare("UPDATE user_2fa SET totp_on = 0, totp = '' WHERE email = ?").bind(me.email).run();
    return { off: true };
  }
  return null;
}

/* ---------- administrators ---------- */
export async function twofaAdmin(env, a, method, b) {
  if (a === "2fa/policy") {
    if (method === "POST") {
      const roles = (Array.isArray(b.roles) ? b.roles : []).map(String).filter(r => /^[A-Z]{2,12}$/.test(r));
      await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('twofa:required', ?)").bind(JSON.stringify(roles)).run();
    }
    const { results } = await env.DB.prepare("SELECT email, totp_on, approve_on FROM user_2fa WHERE totp_on = 1 OR approve_on = 1").all();
    return { roles: await requiredRoles(env), on: Object.fromEntries((results || []).map(r => [r.email, { code: !!r.totp_on, phone: !!r.approve_on }])) };
  }
  if (a === "2fa/reset" && method === "POST") {
    const email = String(b.email || "").toLowerCase();
    await env.DB.prepare("DELETE FROM user_2fa WHERE email = ?").bind(email).run();
    await env.DB.prepare("DELETE FROM trusted_devices WHERE email = ?").bind(email).run();
    await env.DB.prepare("UPDATE users SET twofa_fail = 0, twofa_lock = '' WHERE email = ?").bind(email).run();
    return { reset: true };
  }
  return null;
}

/* housekeeping (cron): old requests and expired trusted devices */
export async function twofaClean(env) {
  const now = new Date().toISOString(), old = new Date(Date.now() - 7 * 864e5).toISOString();
  await env.DB.prepare("DELETE FROM login_challenges WHERE created_at < ?").bind(old).run().catch(() => {});
  await env.DB.prepare("DELETE FROM trusted_devices WHERE expires_at < ?").bind(now).run().catch(() => {});
}
