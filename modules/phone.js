/* =====================================================================
   HUB PHONE — feature module (kept separate so it can be removed cleanly)
   See docs/FEATURE-hub-phone.md

   Voice and video calls between hub users, inside the hub (no real phone numbers).
   · Every person has an extension: VRM 1xx · ACM 2xx · DBS 3xx · VRS 4xx · ACS 5xx · leadership & admins 9xx.
     Given automatically, changed by the admin in People & roles.
   · Calls are WebRTC, browser to browser. The hub only passes the "signalling" messages
     (ring, accept, the connection details) through one Durable Object (PhoneHub) with WebSockets.
   · Sound and video never pass through the hub. When the two phones cannot reach each other directly
     (mobile data, company firewall), Cloudflare TURN relays them — secrets TURN_KEY_ID and TURN_KEY_TOKEN.
     Without them the hub uses Cloudflare's public STUN server only (works on most Wi-Fi, may fail on mobile data).
   · The person called gets the call on every device with the hub open, and a push notification
     (Answer / Decline) when the hub is closed or hidden. A call not answered in 40 s is a missed call.

   Table  : phone_calls         Durable Object: PhoneHub (binding PHONE)
   Routes : /api/phone/ws (WebSocket) · book · ice · recent · seen · decline
   ===================================================================== */

const clip = (v, n) => String(v == null ? "" : v).slice(0, n);
const err = (m, status = 400) => Object.assign(new Error(m), { status });
const RING_MS = 45000;          // a ring waits this long for a device to connect (opened from the push)
const PUSH_AFTER_MS = 3500;     // no device showing the call after 3.5 s → push notification
const RING_EVERY_MS = 2000;     // the push is repeated every 2 s so the phone keeps ringing on the lock screen
const RING_LOOP_MS = 40000;     // … for 40 s at most (then it is a missed call)
const PREFIX = { VRM: 1, ACM: 2, DBS: 3, VRS: 4, ACS: 5 };
const LEAD_ROLES = ["ADMIN", "ADVISOR", "DIRECTOR", "CDSO"];

/* worker.js hands over its push helper once (the Durable Object runs in the same script) */
let DEPS = null;
export function phoneDeps(d) { DEPS = d; }

export async function phoneSchema(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS phone_calls (id TEXT PRIMARY KEY, from_email TEXT NOT NULL, from_name TEXT NOT NULL DEFAULT '',
    to_email TEXT NOT NULL, to_name TEXT NOT NULL DEFAULT '', video INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'ringing',
    started_at TEXT NOT NULL, answered_at TEXT NOT NULL DEFAULT '', ended_at TEXT NOT NULL DEFAULT '', seen INTEGER NOT NULL DEFAULT 0)`).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS phone_calls_to ON phone_calls (to_email, started_at)").run().catch(() => {});
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS phone_calls_from ON phone_calls (from_email, started_at)").run().catch(() => {});
  await env.DB.prepare("ALTER TABLE users ADD COLUMN ext TEXT NOT NULL DEFAULT ''").run().catch(() => {});
}

/* ---------- extensions ---------- */
/* the stored role: administrators with a real role (is_admin) follow that role's flagship */
const prefixOf = u => LEAD_ROLES.includes(u.role) ? 9 : PREFIX[u.site_code] || 9;
const RANK = { MANAGER: 0, SUPERVISOR: 1, SECURITY: 2 }, POSR = { MM: 0, SMM: 0, OM: 1, DOM: 2, SMS: 0, MS: 1, MO: 2, WH: 3 };
/* everyone without an extension gets the next free number of their flagship (management first) */
export async function extEnsure(env) {
  const { results } = await env.DB.prepare("SELECT email, full_name, role, site_code, position, ext FROM users WHERE active = 1").all();
  const all = results || [], todo = all.filter(u => !u.ext);
  if (!todo.length) return 0;
  const used = new Set(all.map(u => u.ext).filter(Boolean));
  todo.sort((a, b) => prefixOf(a) - prefixOf(b) || (RANK[a.role] ?? 3) - (RANK[b.role] ?? 3) || (POSR[a.position] ?? 9) - (POSR[b.position] ?? 9)
    || String(a.full_name).localeCompare(String(b.full_name)));
  const stmts = [];
  for (const u of todo) {
    const p = prefixOf(u);
    let n = p * 100 + 1;
    while (used.has(String(n)) && n < p * 100 + 99) n++;
    if (used.has(String(n))) { n = p * 1000 + 1; while (used.has(String(n))) n++; }   // more than 98 people at one flagship
    used.add(String(n));
    stmts.push(env.DB.prepare("UPDATE users SET ext = ? WHERE email = ? AND ext = ''").bind(String(n), u.email));
  }
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
  return stmts.length;
}
/* People & roles: the admin types an extension (3–4 digits, unique). Empty = keep / give one automatically. */
export async function extSet(env, email, ext) {
  const x = String(ext == null ? "" : ext).trim();
  if (!x) return null;
  if (!/^\d{3,4}$/.test(x)) throw err("The extension is 3 or 4 digits, e.g. 104");
  const t = await env.DB.prepare("SELECT full_name FROM users WHERE ext = ? AND email <> ?").bind(x, email).first();
  if (t) throw err(`Extension ${x} is already ${t.full_name}'s`);
  await env.DB.prepare("UPDATE users SET ext = ? WHERE email = ?").bind(x, email).run();
  return x;
}

/* ---------- ICE servers (Cloudflare TURN when set up) ---------- */
let ICE = null, ICE_AT = 0;
async function iceServers(env) {
  if (ICE && Date.now() - ICE_AT < 6 * 3600e3) return ICE;
  const stun = [{ urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] }];
  if (env.TURN_KEY_ID && env.TURN_KEY_TOKEN) {
    try {
      const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
        method: "POST", headers: { Authorization: `Bearer ${env.TURN_KEY_TOKEN}`, "content-type": "application/json" }, body: JSON.stringify({ ttl: 86400 }) });
      if (r.ok) {
        const d = await r.json();
        const list = Array.isArray(d.iceServers) ? d.iceServers : d.iceServers ? [d.iceServers] : [];
        if (list.length) { ICE = { servers: list, turn: true }; ICE_AT = Date.now(); return ICE; }
      }
    } catch {}
  }
  return { servers: stun, turn: false };
}

/* ---------- routes (/api/phone/*) ---------- */
export async function phoneRoute(env, path, method, body, url, request, d) {
  const me = d.me;
  if (path === "phone/ws") {
    if (!env.PHONE) throw err("Hub Phone is not set up on this hub (Durable Object PHONE is missing)", 503);
    if ((request.headers.get("upgrade") || "").toLowerCase() !== "websocket") throw err("WebSocket expected", 426);
    const origin = request.headers.get("origin");
    if (origin && origin !== url.origin) throw err("Request blocked", 403);
    const q = new URLSearchParams({ e: me.email, n: me.full_name || me.email, x: me.ext || "", d: clip(url.searchParams.get("dev") || "", 24).replace(/[^\w-]/g, "") });
    return stub(env).fetch(new Request("https://phone/ws?" + q, request));
  }
  if (path === "phone/book" && method === "GET") {
    await extEnsure(env);
    const { results } = await env.DB.prepare("SELECT email, full_name, role, site_code, position, ext, photo_at, last_seen_at FROM users WHERE active = 1 AND role != 'EXTERNAL' ORDER BY full_name").all();
    let online = [];
    if (env.PHONE) try { online = await (await stub(env).fetch("https://phone/online")).json(); } catch {}
    const on = new Set(online);
    const mine = (results || []).find(u => u.email === me.email);
    return {
      me: { email: me.email, name: me.full_name, ext: mine ? mine.ext : "" },
      people: (results || []).map(u => ({ email: u.email, name: u.full_name, ext: u.ext, site: u.site_code || "", siteName: u.site_code ? d.siteName(u.site_code) : "",
        lead: prefixOf(u) === 9, position: d.posLabel(u.position) || d.roleLabel(u.role), photoAt: u.photo_at || "", online: on.has(u.email), seenAt: u.last_seen_at || "" })),
      ready: !!env.PHONE
    };
  }
  if (path === "phone/ice" && method === "GET") { const i = await iceServers(env); return { iceServers: i.servers, turn: i.turn }; }
  if (path === "phone/recent" && method === "GET") {
    const { results } = await env.DB.prepare(`SELECT * FROM phone_calls WHERE from_email = ? OR to_email = ? ORDER BY started_at DESC LIMIT 80`).bind(me.email, me.email).all();
    const missed = await env.DB.prepare("SELECT COUNT(*) AS n FROM phone_calls WHERE to_email = ? AND status = 'missed' AND seen = 0").bind(me.email).first();
    return {
      calls: (results || []).map(c => { const out = c.from_email === me.email;
        return { id: c.id, out, peer: out ? c.to_email : c.from_email, peerName: out ? c.to_name : c.from_name, video: !!c.video, status: c.status,
          at: c.started_at, answeredAt: c.answered_at, endedAt: c.ended_at,
          secs: c.answered_at && c.ended_at ? Math.max(0, Math.round((Date.parse(c.ended_at) - Date.parse(c.answered_at)) / 1000)) : 0 }; }),
      missed: Number(missed && missed.n) || 0
    };
  }
  if (path === "phone/seen" && method === "POST") {
    await env.DB.prepare("UPDATE phone_calls SET seen = 1 WHERE to_email = ? AND seen = 0").bind(me.email).run();
    return { ok: true };
  }
  /* the Decline button on the push notification (the hub is not open) */
  if (path === "phone/decline" && method === "POST") {
    if (!env.PHONE) return { ok: false };
    await stub(env).fetch("https://phone/decline", { method: "POST", body: JSON.stringify({ e: me.email, callId: clip(body.callId, 40) }) });
    return { ok: true };
  }
  return null;
}
const stub = env => env.PHONE.get(env.PHONE.idFromName("hub"));

/* ---------- push ---------- */
async function pushTo(env, email, msg) {
  if (!DEPS || !DEPS.sendPush) return 0;
  const { results } = await env.DB.prepare("SELECT * FROM push_subs WHERE email = ?").bind(email).all();
  const r = await Promise.all((results || []).map(s => DEPS.sendPush(env, s, msg).catch(() => ({ ok: false }))));
  return r.filter(x => x && x.ok).length;
}

/* =====================================================================
   PhoneHub — one Durable Object for the whole hub. Each open hub keeps a WebSocket here
   (hibernating: free while nobody talks). It only relays small JSON messages between two people.
   ===================================================================== */
export class PhoneHub {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; this.timers = new Map(); this.pushed = new Set(); }
  socks(email) { return this.ctx.getWebSockets(email); }
  att(ws) { try { return ws.deserializeAttachment() || {}; } catch { return {}; } }
  tell(ws, o) { try { ws.send(JSON.stringify(o)); } catch {} }
  toUser(email, o, dev) {
    let n = 0;
    for (const ws of this.socks(email)) { if (dev && this.att(ws).d !== dev) continue; this.tell(ws, o); n++; }
    return n;
  }
  async call(id) { return id ? await this.ctx.storage.get("call:" + id) : null; }
  async saveCall(c) { await this.ctx.storage.put("call:" + c.id, c); }
  async log(sql, ...args) { try { await this.env.DB.prepare(sql).bind(...args).run(); } catch {} }

  async fetch(req) {
    const u = new URL(req.url);
    if (u.pathname === "/online") {
      const s = new Set(); for (const ws of this.ctx.getWebSockets()) { const a = this.att(ws); if (a.e) s.add(a.e); }
      return Response.json([...s]);
    }
    /* Hub Chat: send a live event to these people; answer who has this chat open on screen (no push for them) */
    if (u.pathname === "/chat-fan") {
      const b = await req.json().catch(() => ({}));
      const want = new Set(Array.isArray(b.emails) ? b.emails : []), viewing = new Set(), msg = JSON.stringify(b.payload || {});
      for (const ws of this.ctx.getWebSockets()) {
        const a = this.att(ws); if (!want.has(a.e)) continue;
        try { ws.send(msg); } catch {}
        if (b.conv && a.v === b.conv) viewing.add(a.e);
      }
      return Response.json({ viewing: [...viewing] });
    }
    if (u.pathname === "/decline") {
      const b = await req.json().catch(() => ({}));
      await this.handle({ e: b.e, d: "push" }, null, { type: "decline", callId: b.callId });
      return Response.json({ ok: true });
    }
    if (u.pathname === "/ws") {
      const a = { e: u.searchParams.get("e"), n: u.searchParams.get("n"), x: u.searchParams.get("x"), d: u.searchParams.get("d") || crypto.randomUUID().slice(0, 12) };
      if (!a.e) return new Response("no user", { status: 400 });
      const pair = new WebSocketPair(), [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server, [a.e]);
      server.serializeAttachment(a);
      this.tell(server, { type: "hello", dev: a.d });
      /* a call that is still ringing for this person (they opened the hub from the push) */
      const pend = (await this.ctx.storage.get("ring:" + a.e)) || [];
      for (const r of pend.filter(r => Date.now() - r.at < RING_MS)) this.tell(server, { type: "ring", ...r });
      return new Response(null, { status: 101, webSocket: client });
    }
    return new Response("not found", { status: 404 });
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== "string" || raw.length > 200000) return;
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.type === "ping") return this.tell(ws, { type: "pong" });
    if (m.type === "viewing") { const a = this.att(ws); a.v = m.c ? clip(m.c, 40) : ""; try { ws.serializeAttachment(a); } catch {} return; }   // Hub Chat: the chat open on screen
    await this.handle(this.att(ws), ws, m);
  }
  async webSocketClose(ws, code) { try { ws.close(code === 1005 ? 1000 : code, "bye"); } catch {} }
  async webSocketError() {}

  async dropRing(email, callId) {
    const k = "ring:" + email, list = ((await this.ctx.storage.get(k)) || []).filter(r => r.callId !== callId && Date.now() - r.at < RING_MS);
    if (list.length) await this.ctx.storage.put(k, list); else await this.ctx.storage.delete(k);
  }
  async busy(email) {
    const id = await this.ctx.storage.get("busy:" + email); if (!id) return false;
    const c = await this.call(id);
    return !!c && c.status === "answered" && Date.now() - c.at < 4 * 3600e3;
  }

  async handle(a, ws, m) {
    const env = this.env, now = new Date().toISOString(), callId = clip(m.callId, 40);
    if (m.type === "ring") {
      const to = String(m.to || "").toLowerCase();
      if (!callId || !to || to === a.e) return;
      const u = await env.DB.prepare("SELECT email, full_name, active FROM users WHERE email = ?").bind(to).first();
      if (!u || !u.active) return ws && this.tell(ws, { type: "unavailable", callId, why: "This person has no active hub account" });
      const c = { id: callId, from: a.e, fromName: a.n, fromExt: a.x, fromDev: a.d, to, toName: u.full_name, toDev: "", video: !!m.video, status: "ringing", at: Date.now(), shown: false };
      await this.log("INSERT OR IGNORE INTO phone_calls (id, from_email, from_name, to_email, to_name, video, status, started_at) VALUES (?,?,?,?,?,?,?,?)",
        callId, a.e, a.n || "", to, u.full_name || "", c.video ? 1 : 0, "ringing", now);
      if (await this.busy(to)) {
        c.status = "missed"; await this.saveCall(c);
        await this.log("UPDATE phone_calls SET status = 'missed', ended_at = ? WHERE id = ?", now, callId);
        if (ws) this.tell(ws, { type: "busy", callId });
        await pushTo(env, to, { title: "📞 Missed call", body: `${a.n} called you while you were on another call`, tag: "call-" + callId, url: "/#/app/phone" });
        return;
      }
      await this.saveCall(c);
      const ring = { callId, from: a.e, fromName: a.n, fromExt: a.x, fromDev: a.d, video: c.video, at: c.at };
      const k = "ring:" + to; await this.ctx.storage.put(k, [...((await this.ctx.storage.get(k)) || []).filter(r => Date.now() - r.at < RING_MS), ring]);
      const devices = this.toUser(to, { type: "ring", ...ring });
      if (ws) this.tell(ws, { type: "calling", callId, online: devices > 0 });
      /* Lock-screen ringing: the push is sent again every 2 s (same tag, so it replaces itself and rings again)
         until the call is answered, declined, cancelled, shown on an open hub — or 40 s pass */
      let first = true;
      const push = async () => {
        const cur = await this.call(callId);
        if (!cur || cur.status !== "ringing" || cur.shown || Date.now() - c.at > RING_LOOP_MS) { this.timers.delete(callId); return; }
        const n = await pushTo(env, to, { title: c.video ? "🎥 Incoming video call" : "📞 Incoming call",
          body: `${a.n}${a.x ? " · ext " + a.x : ""} is calling you`, tag: "call-" + callId, tone: "alert", ttl: 10,
          url: "/?call=" + encodeURIComponent(callId), call: { id: callId, from: a.n, video: c.video } });
        this.pushed.add(callId);
        const live = await this.call(callId);
        if (!live || live.status !== "ringing") { this.timers.delete(callId); return; }
        if (first) { first = false; for (const s of this.socks(live.from)) if (this.att(s).d === live.fromDev) this.tell(s, { type: "pushed", callId, devices: n }); }
        if (!n) { this.timers.delete(callId); return; }   // no phone has notifications on
        this.timers.set(callId, setTimeout(push, RING_EVERY_MS));
      };
      if (!devices) await push();
      else this.timers.set(callId, setTimeout(push, PUSH_AFTER_MS));
      return;
    }

    const c = await this.call(callId);
    if (!c) return ws && m.type !== "end" && this.tell(ws, { type: "gone", callId });
    const isFrom = a.e === c.from, isTo = a.e === c.to;
    if (!isFrom && !isTo) return;
    const peer = isFrom ? c.to : c.from, peerDev = isFrom ? c.toDev : c.fromDev;

    if (m.type === "ringing" && isTo) {   // a device of the person called shows the call
      if (m.visible) { c.shown = true; await this.saveCall(c); }
      this.toUser(c.from, { type: "ringing", callId }, c.fromDev);
      return;
    }
    if (m.type === "accept" && isTo) {
      if (c.status !== "ringing") return ws && this.tell(ws, { type: "gone", callId });
      c.status = "answered"; c.toDev = a.d; c.answeredAt = Date.now(); await this.saveCall(c);
      clearTimeout(this.timers.get(callId)); this.timers.delete(callId);
      await this.dropRing(c.to, callId);
      await this.ctx.storage.put("busy:" + c.from, callId); await this.ctx.storage.put("busy:" + c.to, callId);
      await this.log("UPDATE phone_calls SET status = 'answered', answered_at = ? WHERE id = ?", now, callId);
      this.toUser(c.from, { type: "accept", callId, dev: a.d }, c.fromDev);
      for (const s of this.socks(c.to)) if (this.att(s).d !== a.d) this.tell(s, { type: "taken", callId });
      if (this.pushed.delete(callId)) await pushTo(env, c.to, { title: "📞 Call answered", body: `On a call with ${c.fromName}`, tag: "call-" + callId, silent: true, ttl: 20, url: "/" });
      return;
    }
    if (m.type === "decline" && isTo) {
      if (c.status !== "ringing") return;
      c.status = "declined"; await this.saveCall(c);
      clearTimeout(this.timers.get(callId)); this.timers.delete(callId);
      await this.dropRing(c.to, callId);
      await this.log("UPDATE phone_calls SET status = 'declined', ended_at = ?, seen = 1 WHERE id = ?", now, callId);
      this.toUser(c.from, { type: "decline", callId }, c.fromDev);
      this.toUser(c.to, { type: "taken", callId });
      if (this.pushed.delete(callId) && a.d !== "push") await pushTo(env, c.to, { title: "📞 Call declined", body: `${c.fromName} — declined`, tag: "call-" + callId, silent: true, ttl: 20, url: "/#/app/phone" });
      return;
    }
    if (m.type === "cancel" && isFrom) {   // the caller hung up before an answer (or 40 s passed)
      if (c.status !== "ringing") return;
      c.status = "missed"; await this.saveCall(c);
      clearTimeout(this.timers.get(callId)); this.timers.delete(callId);
      await this.dropRing(c.to, callId);
      await this.log("UPDATE phone_calls SET status = 'missed', ended_at = ? WHERE id = ?", now, callId);
      this.toUser(c.to, { type: "cancel", callId }); this.pushed.delete(callId);
      await pushTo(env, c.to, { title: c.video ? "🎥 Missed video call" : "📞 Missed call", body: `${c.fromName}${c.fromExt ? " · ext " + c.fromExt : ""} — tap to call back`,
        tag: "call-" + callId, url: "/#/app/phone" });
      return;
    }
    if (m.type === "end") {
      if (c.status === "ended") return;
      c.status = "ended"; await this.saveCall(c);
      for (const e of [c.from, c.to]) if ((await this.ctx.storage.get("busy:" + e)) === callId) await this.ctx.storage.delete("busy:" + e);
      await this.log("UPDATE phone_calls SET ended_at = ? WHERE id = ? AND ended_at = ''", now, callId);
      this.toUser(peer, { type: "end", callId }, peerDev || undefined);
      this.ctx.storage.setAlarm(Date.now() + 6 * 3600e3).catch(() => {});
      return;
    }
    /* connection details and small status messages, only during an answered call, to the other device */
    if (["sdp", "ice", "cam", "mic"].includes(m.type) && c.status === "answered") {
      const o = { type: m.type, callId };
      if (m.type === "sdp") o.sdp = m.sdp;
      if (m.type === "ice") o.cand = m.cand;
      if (m.type === "cam" || m.type === "mic") o.on = !!m.on;
      this.toUser(peer, o, peerDev);
    }
  }

  /* tidy: forget calls older than 6 hours */
  async alarm() {
    const all = await this.ctx.storage.list({ prefix: "call:" });
    const old = [...all].filter(([, c]) => !c || Date.now() - c.at > 6 * 3600e3).map(([k]) => k);
    for (let i = 0; i < old.length; i += 100) await this.ctx.storage.delete(old.slice(i, i + 100));
  }
}
