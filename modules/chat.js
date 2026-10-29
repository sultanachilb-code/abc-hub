/* =====================================================================
   HUB CHAT — group and one-to-one chats inside Hub Phone (Chats · Calls · Contacts · Keypad)
   See docs/FEATURE-hub-chat.md

   · Ready-made groups kept in step with People & roles:
       "<Flagship> · Team" (everyone at that flagship + the leadership who cover it) ×5,
       "Flagship Managers" (managers + leadership), "All flagships · Announcements" (everyone; only leadership & admins post)
   · Leadership & administrators create their own groups, add people and change any group;
     group admins change their group. Everyone chats one-to-one.
   · Text and emoji, photos, files (PDF, Excel…), voice notes, replies, @mentions, reactions, ✓✓ read with "seen by".
   · Live through the Hub Phone connection (Durable Object PhoneHub); a push for every message unless the chat is muted
     (an @mention still notifies). Messages and files are kept 1 month.

   Tables : chat_convs · chat_members · chat_msgs      Files: R2 (FILES) chat/<conv>/<id>
   Routes : /api/chat/*
   ===================================================================== */

const clip = (v, n) => String(v == null ? "" : v).slice(0, n);
const err = (m, status = 400) => Object.assign(new Error(m), { status });
const KEEP_DAYS = 30;
const MAX_FILE = 15 * 1024 * 1024;
const LEAD_ROLES = ["ADMIN", "ADVISOR", "DIRECTOR", "CDSO"];
const COLORS = ["#4A1F73", "#2F6F73", "#B0562A", "#1E9E5E", "#3C4F8A", "#B8456B", "#C07A12", "#6B4BA0"];
const EMOJI = ["👍", "❤️", "😂", "😮", "🙏", "✅"];

export async function chatSchema(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS chat_convs (id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', pair TEXT NOT NULL DEFAULT '',
      auto_key TEXT NOT NULL DEFAULT '', color TEXT NOT NULL DEFAULT '', announce INTEGER NOT NULL DEFAULT 0, members_add INTEGER NOT NULL DEFAULT 0,
      created_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, last_at TEXT NOT NULL DEFAULT '', last_text TEXT NOT NULL DEFAULT '', last_by TEXT NOT NULL DEFAULT '')`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS chat_members (conv_id TEXT NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member', src TEXT NOT NULL DEFAULT 'hand',
      muted INTEGER NOT NULL DEFAULT 0, last_read INTEGER NOT NULL DEFAULT 0, joined_at TEXT NOT NULL DEFAULT '', PRIMARY KEY (conv_id, email))`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS chat_msgs (id INTEGER PRIMARY KEY AUTOINCREMENT, conv_id TEXT NOT NULL, email TEXT NOT NULL, name TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'text', body TEXT NOT NULL DEFAULT '', file_key TEXT NOT NULL DEFAULT '', file_name TEXT NOT NULL DEFAULT '', file_type TEXT NOT NULL DEFAULT '',
      file_size INTEGER NOT NULL DEFAULT 0, dur INTEGER NOT NULL DEFAULT 0, reply_to INTEGER NOT NULL DEFAULT 0, mentions TEXT NOT NULL DEFAULT '', reactions TEXT NOT NULL DEFAULT '',
      deleted INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)`)
  ]);
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS chat_msgs_conv ON chat_msgs (conv_id, id)").run().catch(() => {});
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS chat_members_email ON chat_members (email)").run().catch(() => {});
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS chat_convs_pair ON chat_convs (pair)").run().catch(() => {});
}

/* worker.js hands over the push helper */
let DEPS = null;
export function chatDeps(d) { DEPS = d; }

const isLead = u => !!(u && (LEAD_ROLES.includes(u.role) || u.is_admin || (u._real && LEAD_ROLES.includes(u._real.role))));
const sitesOfU = (u, all) => u.role === "ADVISOR" || (u.role === "ADMIN" && !u.site_code) ? all
  : String(u.sites || "").split(",").map(s => s.trim()).filter(Boolean).concat(u.site_code ? [u.site_code] : []);

/* ---------- ready-made groups, kept in step with People & roles (every minute at most) ---------- */
let SYNC_AT = 0;
export async function chatSync(env, d, force) {
  if (!force && Date.now() - SYNC_AT < 60000) return;
  SYNC_AT = Date.now();
  const now = new Date().toISOString(), codes = Object.keys(d.SITES);
  const { results } = await env.DB.prepare("SELECT email, role, site_code, sites, is_admin FROM users WHERE active = 1").all();
  const users = results || [];
  const lead = u => LEAD_ROLES.includes(u.role) || !!u.is_admin;
  const want = {};
  codes.forEach((c, i) => { want["site:" + c] = { name: `${d.SITES[c]} · Team`, color: COLORS[i % COLORS.length], announce: 0,
    members: users.filter(u => (!LEAD_ROLES.includes(u.role) && u.site_code === c) || ((u.role === "ADVISOR" || u.role === "DIRECTOR" || u.role === "CDSO") && sitesOfU(u, codes).includes(c))) }; });
  want.managers = { name: "Flagship Managers", color: "#2F6F73", announce: 0, members: users.filter(u => u.role === "MANAGER" || lead(u)) };
  want.all = { name: "All flagships · Announcements", color: "#C62828", announce: 1, members: users };
  const { results: have } = await env.DB.prepare("SELECT id, auto_key FROM chat_convs WHERE auto_key <> ''").all();
  const byKey = new Map((have || []).map(r => [r.auto_key, r.id]));
  const stmts = [];
  for (const [k, g] of Object.entries(want)) {
    let id = byKey.get(k);
    if (!id) {
      id = "g_" + k.replace(/\W/g, "_").toLowerCase();
      stmts.push(env.DB.prepare("INSERT OR IGNORE INTO chat_convs (id, kind, name, auto_key, color, announce, created_by, created_at, last_at) VALUES (?,?,?,?,?,?,?,?,?)")
        .bind(id, "group", g.name, k, g.color, g.announce, "hub", now, now));
    }
    const { results: mem } = await env.DB.prepare("SELECT email, src FROM chat_members WHERE conv_id = ?").bind(id).all();
    const cur = new Map((mem || []).map(m => [m.email, m.src])), set = new Set(g.members.map(u => u.email));
    for (const u of g.members) if (!cur.has(u.email))
      stmts.push(env.DB.prepare("INSERT OR IGNORE INTO chat_members (conv_id, email, role, src, joined_at, last_read) VALUES (?,?,?,?,?,(SELECT COALESCE(MAX(id),0) FROM chat_msgs WHERE conv_id = ?))")
        .bind(id, u.email, lead(u) ? "admin" : "member", "auto", now, id));
    for (const [e, src] of cur) if (src === "auto" && !set.has(e)) stmts.push(env.DB.prepare("DELETE FROM chat_members WHERE conv_id = ? AND email = ?").bind(id, e));
  }
  /* people switched off leave every chat they were added to by hand too */
  stmts.push(env.DB.prepare("DELETE FROM chat_members WHERE email NOT IN (SELECT email FROM users WHERE active = 1)"));
  for (let i = 0; i < stmts.length; i += 80) await env.DB.batch(stmts.slice(i, i + 80));
}

/* ---------- live + push ---------- */
const hub = env => env.PHONE ? env.PHONE.get(env.PHONE.idFromName("hub")) : null;
async function fan(env, emails, payload, conv) {
  const s = hub(env); if (!s || !emails.length) return [];
  try { const r = await s.fetch("https://phone/chat-fan", { method: "POST", body: JSON.stringify({ emails, payload, conv }) }); return (await r.json()).viewing || []; }
  catch { return []; }
}
async function pushMany(env, emails, msg) {
  if (!DEPS || !DEPS.sendPush || !emails.length) return;
  const ph = emails.map(() => "?").join(",");
  const { results } = await env.DB.prepare(`SELECT * FROM push_subs WHERE email IN (${ph})`).bind(...emails).all();
  await Promise.all((results || []).map(s => DEPS.sendPush(env, s, msg).catch(() => {})));
}

/* ---------- helpers ---------- */
async function member(env, conv, email) {
  return env.DB.prepare("SELECT m.*, c.kind, c.name, c.auto_key, c.announce, c.members_add, c.created_by FROM chat_members m JOIN chat_convs c ON c.id = m.conv_id WHERE m.conv_id = ? AND m.email = ?")
    .bind(conv, email).first();
}
const preview = m => m.deleted ? "Message deleted" : m.kind === "photo" ? "📷 Photo" + (m.body ? " · " + m.body : "") : m.kind === "voice" ? `🎤 Voice note · ${Math.floor(m.dur / 60)}:${String(m.dur % 60).padStart(2, "0")}`
  : m.kind === "file" ? "📄 " + m.file_name : m.kind === "system" ? m.body : m.body;
const msgOut = m => ({ id: m.id, c: m.conv_id, by: m.email, name: m.name, kind: m.kind, body: m.deleted ? "" : m.body, file: m.file_key && !m.deleted ? { name: m.file_name, type: m.file_type, size: m.file_size } : null,
  dur: m.dur, reply: m.reply_to || 0, mentions: m.mentions ? JSON.parse(m.mentions) : [], reactions: m.reactions ? JSON.parse(m.reactions) : {}, deleted: !!m.deleted, at: m.created_at });
async function members(env, conv) {
  const { results } = await env.DB.prepare(`SELECT m.email, m.role, m.src, m.last_read, m.muted, u.full_name, u.position, u.role AS urole, u.site_code, u.ext, u.photo_at
    FROM chat_members m JOIN users u ON u.email = m.email WHERE m.conv_id = ? ORDER BY m.role = 'admin' DESC, u.full_name`).bind(conv).all();
  return results || [];
}
async function addSystem(env, conv, text, me) {
  const now = new Date().toISOString();
  const r = await env.DB.prepare("INSERT INTO chat_msgs (conv_id, email, name, kind, body, created_at) VALUES (?,?,?,?,?,?)").bind(conv, me.email, me.full_name || "", "system", clip(text, 300), now).run();
  await env.DB.prepare("UPDATE chat_convs SET last_at = ?, last_text = ?, last_by = '' WHERE id = ?").bind(now, clip(text, 140), conv).run();
  return r.meta.last_row_id;
}
async function bumpAll(env, conv) {   // tell everyone in a chat to refresh its details (members, name…)
  const { results } = await env.DB.prepare("SELECT email FROM chat_members WHERE conv_id = ?").bind(conv).all();
  await fan(env, (results || []).map(r => r.email), { type: "chat", ev: "conv", c: conv });
}

/* ---------- routes (/api/chat/*) ---------- */
export async function chatRoute(env, path, method, b, url, ctx, d) {
  const me = d.me, q = k => url.searchParams.get(k) || "";
  await chatSync(env, d).catch(e => console.error("chat sync", e && e.message));

  if (path === "chat/list" && method === "GET") {
    const { results } = await env.DB.prepare(`SELECT c.*, m.muted, m.last_read, m.role AS my_role,
        (SELECT COUNT(*) FROM chat_msgs x WHERE x.conv_id = c.id AND x.id > m.last_read AND x.email <> m.email AND x.kind <> 'system') AS unread,
        (SELECT COUNT(*) FROM chat_msgs x WHERE x.conv_id = c.id AND x.id > m.last_read AND x.mentions LIKE ?) AS mentioned,
        (SELECT COUNT(*) FROM chat_members y WHERE y.conv_id = c.id) AS n
      FROM chat_members m JOIN chat_convs c ON c.id = m.conv_id WHERE m.email = ? ORDER BY c.last_at DESC`).bind(`%"${me.email}"%`, me.email).all();
    const dms = (results || []).filter(c => c.kind === "dm");
    const peers = new Map();
    if (dms.length) {
      const others = dms.map(c => c.pair.split("|").find(e => e !== me.email) || me.email);
      const ph = others.map(() => "?").join(",");
      const { results: us } = await env.DB.prepare(`SELECT email, full_name, position, role, site_code, ext, photo_at FROM users WHERE email IN (${ph})`).bind(...others).all();
      (us || []).forEach(u => peers.set(u.email, u));
    }
    return {
      lead: isLead(me), me: me.email,
      chats: (results || []).filter(c => c.kind === "group" || c.last_text).map(c => {
        const peer = c.kind === "dm" ? peers.get(c.pair.split("|").find(e => e !== me.email) || me.email) : null;
        return { id: c.id, kind: c.kind, name: peer ? peer.full_name : c.name, peer: peer ? { email: peer.email, ext: peer.ext, position: d.posLabel(peer.position) || d.roleLabel(peer.role), photoAt: peer.photo_at } : null,
          auto: !!c.auto_key, color: c.color || "#4A1F73", announce: !!c.announce, muted: !!c.muted, unread: c.unread, mentioned: c.mentioned, members: c.n,
          lastAt: c.last_at, lastText: c.last_text, lastBy: c.last_by, myRole: c.my_role };
      })
    };
  }
  if (path === "chat/dm" && method === "POST") {   // open (or start) the chat with one person
    const other = String(b.email || "").toLowerCase();
    if (!other || other === me.email) throw err("Choose another person");
    const u = await env.DB.prepare("SELECT email, active FROM users WHERE email = ?").bind(other).first();
    if (!u || !u.active) throw err("This person has no active hub account");
    const pair = [me.email, other].sort().join("|");
    let c = await env.DB.prepare("SELECT id FROM chat_convs WHERE pair = ?").bind(pair).first();
    if (!c) {
      const id = "d_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16), now = new Date().toISOString();
      await env.DB.batch([
        env.DB.prepare("INSERT INTO chat_convs (id, kind, pair, created_by, created_at) VALUES (?,?,?,?,?)").bind(id, "dm", pair, me.email, now),
        env.DB.prepare("INSERT OR IGNORE INTO chat_members (conv_id, email, role, src, joined_at) VALUES (?,?,'member','hand',?)").bind(id, me.email, now),
        env.DB.prepare("INSERT OR IGNORE INTO chat_members (conv_id, email, role, src, joined_at) VALUES (?,?,'member','hand',?)").bind(id, other, now)
      ]);
      c = { id };
    }
    return { id: c.id };
  }
  if (path === "chat/msgs" && method === "GET") {
    const conv = q("c"), m = await member(env, conv, me.email);
    if (!m) throw err("You are not in this chat", 403);
    const before = Number(q("before")) || 0, after = Number(q("after")) || 0;
    const { results } = after
      ? await env.DB.prepare("SELECT * FROM chat_msgs WHERE conv_id = ? AND id > ? ORDER BY id LIMIT 200").bind(conv, after).all()
      : await env.DB.prepare(`SELECT * FROM (SELECT * FROM chat_msgs WHERE conv_id = ? ${before ? "AND id < ?" : ""} ORDER BY id DESC LIMIT 60) ORDER BY id`).bind(...(before ? [conv, before] : [conv])).all();
    const list = results || [];
    /* the messages replied to (shown above the reply) */
    const need = [...new Set(list.map(x => x.reply_to).filter(id => id && !list.some(y => y.id === id)))];
    let replies = [];
    if (need.length) replies = ((await env.DB.prepare(`SELECT * FROM chat_msgs WHERE id IN (${need.map(() => "?").join(",")})`).bind(...need).all()).results || []).map(msgOut);
    const mem = before || after ? null : await members(env, conv);
    const peer = m.kind === "dm" && mem ? mem.find(x => x.email !== me.email) : null;
    return {
      conv: before || after ? null : { id: conv, kind: m.kind, name: peer ? peer.full_name : m.name, auto: !!m.auto_key, announce: !!m.announce, membersAdd: !!m.members_add,
        muted: !!m.muted, myRole: m.role, lead: isLead(me), canEdit: m.kind === "group" && (isLead(me) || (m.role === "admin" && !m.auto_key)),
        canSend: m.kind === "dm" || !m.announce || isLead(me) || m.role === "admin",
        canAdd: m.kind === "group" && (isLead(me) || (!m.auto_key && (m.role === "admin" || m.members_add))),
        peer: peer ? { email: peer.email, ext: peer.ext, position: d.posLabel(peer.position) || d.roleLabel(peer.urole), photoAt: peer.photo_at } : null },
      members: mem ? mem.map(x => ({ email: x.email, name: x.full_name, role: x.role, auto: x.src === "auto", lastRead: x.last_read, ext: x.ext, photoAt: x.photo_at,
        position: d.posLabel(x.position) || d.roleLabel(x.urole), site: x.site_code || "" })) : null,
      msgs: list.map(msgOut), replies, more: !after && list.length === 60
    };
  }
  if (path === "chat/send" && method === "POST") {
    const conv = clip(b.c, 40), m = await member(env, conv, me.email);
    if (!m) throw err("You are not in this chat", 403);
    if (m.kind === "group" && m.announce && !isLead(me) && m.role !== "admin") throw err("Only the group admins can send in this group", 403);
    const now = new Date().toISOString();
    let kind = "text", text = clip(b.text, 4000).trim(), key = "", fname = "", ftype = "", fsize = 0;
    if (b.data) {
      if (!env.FILES) throw err("File storage is not available right now", 503);
      const mm = /^data:([\w/+.-]+)(?:;[\w=.-]+)*;base64,(.+)$/.exec(String(b.data));
      if (!mm) throw err("This file could not be read");
      ftype = mm[1]; kind = b.kind === "voice" ? "voice" : /^image\/(jpeg|png|webp|gif)$/.test(ftype) && b.kind !== "file" ? "photo" : "file";
      const bin = Uint8Array.from(atob(mm[2]), x => x.charCodeAt(0));
      if (bin.byteLength > MAX_FILE) throw err("The file is larger than 15 MB");
      fsize = bin.byteLength; fname = clip(b.name, 140) || (kind === "voice" ? "voice-note" : kind === "photo" ? "photo.jpg" : "file");
      key = `chat/${conv}/${crypto.randomUUID()}`;
      await env.FILES.put(key, bin, { httpMetadata: { contentType: ftype } });
    } else if (!text) throw err("Write a message");
    const mentions = Array.isArray(b.mentions) ? [...new Set(b.mentions.map(x => String(x).toLowerCase()))].slice(0, 50) : [];
    const reply = Number(b.reply) || 0, dur = Math.max(0, Math.min(3600, Math.round(Number(b.dur) || 0)));
    const r = await env.DB.prepare(`INSERT INTO chat_msgs (conv_id, email, name, kind, body, file_key, file_name, file_type, file_size, dur, reply_to, mentions, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(conv, me.email, me.full_name || me.email, kind, text, key, fname, ftype, fsize, dur, reply, mentions.length ? JSON.stringify(mentions) : "", now).run();
    const id = r.meta.last_row_id;
    const row = { id, conv_id: conv, email: me.email, name: me.full_name || me.email, kind, body: text, file_key: key, file_name: fname, file_type: ftype, file_size: fsize, dur, reply_to: reply,
      mentions: mentions.length ? JSON.stringify(mentions) : "", reactions: "", deleted: 0, created_at: now };
    await env.DB.batch([
      env.DB.prepare("UPDATE chat_convs SET last_at = ?, last_text = ?, last_by = ? WHERE id = ?").bind(now, clip(preview(row), 140), me.full_name || me.email, conv),
      env.DB.prepare("UPDATE chat_members SET last_read = ? WHERE conv_id = ? AND email = ?").bind(id, conv, me.email)
    ]);
    const { results: mem } = await env.DB.prepare("SELECT email, muted FROM chat_members WHERE conv_id = ?").bind(conv).all();
    const all = (mem || []).map(x => x.email), out = msgOut(row);
    const work = (async () => {
      const viewing = new Set(await fan(env, all, { type: "chat", ev: "msg", c: conv, msg: out }, conv));
      const targets = (mem || []).filter(x => x.email !== me.email && !viewing.has(x.email) && (!x.muted || mentions.includes(x.email))).map(x => x.email);
      const title = m.kind === "dm" ? (me.full_name || "Hub Chat") : (mentions.length ? `${m.name} · @mention` : m.name);
      const body = (m.kind === "dm" ? "" : (me.full_name || "") + ": ") + clip(preview(row), 160);
      await pushMany(env, targets, { title: "💬 " + title, body, tag: "chat-" + conv, url: "/?chat=" + encodeURIComponent(conv), ttl: 86400 });
    })();
    ctx && ctx.waitUntil ? ctx.waitUntil(work) : await work;
    return { msg: out };
  }
  if (path === "chat/file" && method === "GET") {
    const id = Number(q("id"));
    const x = await env.DB.prepare("SELECT conv_id, file_key, file_name, file_type, deleted FROM chat_msgs WHERE id = ?").bind(id).first();
    if (!x || !x.file_key || x.deleted) throw err("No file", 404);
    if (!(await member(env, x.conv_id, me.email))) throw err("Not allowed", 403);
    const o = env.FILES ? await env.FILES.get(x.file_key) : null; if (!o) throw err("This file is no longer kept (1 month)", 404);
    const dl = q("dl") === "1" ? "attachment" : "inline";
    return new Response(o.body, { headers: { "content-type": x.file_type || "application/octet-stream",
      "content-disposition": `${dl}; filename="${String(x.file_name).replace(/["\\\r\n]/g, "")}"`, "cache-control": "private, max-age=86400" } });
  }
  if (path === "chat/read" && method === "POST") {
    const conv = clip(b.c, 40), upTo = Number(b.upTo) || 0;
    const m = await member(env, conv, me.email); if (!m) return { ok: false };
    if (upTo > m.last_read) {
      await env.DB.prepare("UPDATE chat_members SET last_read = ? WHERE conv_id = ? AND email = ? AND last_read < ?").bind(upTo, conv, me.email, upTo).run();
      const { results } = await env.DB.prepare("SELECT email FROM chat_members WHERE conv_id = ?").bind(conv).all();
      const w = fan(env, (results || []).map(r => r.email), { type: "chat", ev: "read", c: conv, email: me.email, upTo });
      ctx && ctx.waitUntil ? ctx.waitUntil(w) : await w;
    }
    return { ok: true };
  }
  if (path === "chat/react" && method === "POST") {
    const id = Number(b.id), emo = String(b.emoji || "");
    if (!EMOJI.includes(emo)) throw err("Choose a reaction");
    const x = await env.DB.prepare("SELECT conv_id, reactions, deleted FROM chat_msgs WHERE id = ?").bind(id).first();
    if (!x || x.deleted || !(await member(env, x.conv_id, me.email))) throw err("Not allowed", 403);
    const r = x.reactions ? JSON.parse(x.reactions) : {};
    const had = (r[emo] || []).includes(me.email);
    for (const k of Object.keys(r)) { r[k] = r[k].filter(e => e !== me.email); if (!r[k].length) delete r[k]; }   // one reaction per person
    if (!had) r[emo] = [...(r[emo] || []), me.email];
    await env.DB.prepare("UPDATE chat_msgs SET reactions = ? WHERE id = ?").bind(Object.keys(r).length ? JSON.stringify(r) : "", id).run();
    const { results } = await env.DB.prepare("SELECT email FROM chat_members WHERE conv_id = ?").bind(x.conv_id).all();
    await fan(env, (results || []).map(e => e.email), { type: "chat", ev: "react", c: x.conv_id, id, reactions: r });
    return { reactions: r };
  }
  if (path === "chat/delete" && method === "POST") {   // delete my message for everyone
    const id = Number(b.id);
    const x = await env.DB.prepare("SELECT conv_id, email, file_key FROM chat_msgs WHERE id = ?").bind(id).first();
    if (!x) throw err("Not found", 404);
    const m = await member(env, x.conv_id, me.email);
    if (!m || (x.email !== me.email && !(m.kind === "group" && (isLead(me) || m.role === "admin")))) throw err("You can delete your own messages only", 403);
    await env.DB.prepare("UPDATE chat_msgs SET deleted = 1, body = '', reactions = '' WHERE id = ?").bind(id).run();
    if (x.file_key && env.FILES) await env.FILES.delete(x.file_key).catch(() => {});
    const { results } = await env.DB.prepare("SELECT email FROM chat_members WHERE conv_id = ?").bind(x.conv_id).all();
    await fan(env, (results || []).map(e => e.email), { type: "chat", ev: "del", c: x.conv_id, id });
    return { ok: true };
  }
  if (path === "chat/mute" && method === "POST") {
    await env.DB.prepare("UPDATE chat_members SET muted = ? WHERE conv_id = ? AND email = ?").bind(b.muted ? 1 : 0, clip(b.c, 40), me.email).run();
    return { muted: !!b.muted };
  }
  if (path === "chat/group" && method === "POST") {   // create or change a group
    const name = clip(b.name, 60).trim();
    const now = new Date().toISOString();
    if (!b.c) {
      if (!isLead(me)) throw err("Leadership and administrators create groups", 403);
      if (!name) throw err("Name the group");
      const add = [...new Set((Array.isArray(b.add) ? b.add : []).map(x => String(x).toLowerCase()))].filter(e => e !== me.email);
      if (!add.length) throw err("Add at least one person");
      const ok = await activeEmails(env, add);
      const id = "g_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
      await env.DB.batch([
        env.DB.prepare("INSERT INTO chat_convs (id, kind, name, color, announce, members_add, created_by, created_at, last_at) VALUES (?,?,?,?,?,?,?,?,?)")
          .bind(id, "group", name, COLORS[Math.floor(Math.random() * COLORS.length)], b.announce ? 1 : 0, b.membersAdd ? 1 : 0, me.email, now, now),
        env.DB.prepare("INSERT INTO chat_members (conv_id, email, role, src, joined_at) VALUES (?,?,'admin','hand',?)").bind(id, me.email, now),
        ...ok.map(e => env.DB.prepare("INSERT OR IGNORE INTO chat_members (conv_id, email, role, src, joined_at) VALUES (?,?,'member','hand',?)").bind(id, e, now))
      ]);
      await addSystem(env, id, `${me.full_name} created the group “${name}”`, me);
      await bumpAll(env, id);
      return { id };
    }
    const conv = clip(b.c, 40), m = await member(env, conv, me.email);
    if (!m || m.kind !== "group") throw err("Not allowed", 403);
    const canEdit = isLead(me) || (m.role === "admin" && !m.auto_key), canAdd = canEdit || (!m.auto_key && m.members_add);
    const notes = [];
    if ((name && name !== m.name) || "announce" in b || "membersAdd" in b) {
      if (!canEdit) throw err("Only the group admins can change the group", 403);
      if (name && name !== m.name) { await env.DB.prepare("UPDATE chat_convs SET name = ? WHERE id = ?").bind(name, conv).run(); notes.push(`renamed the group “${name}”`); }
      if ("announce" in b) await env.DB.prepare("UPDATE chat_convs SET announce = ? WHERE id = ?").bind(b.announce ? 1 : 0, conv).run();
      if ("membersAdd" in b) await env.DB.prepare("UPDATE chat_convs SET members_add = ? WHERE id = ?").bind(b.membersAdd ? 1 : 0, conv).run();
    }
    const add = [...new Set((Array.isArray(b.add) ? b.add : []).map(x => String(x).toLowerCase()))];
    if (add.length) {
      if (!canAdd) throw err("Only the group admins can add people", 403);
      const ok = await activeEmails(env, add);
      await env.DB.batch(ok.map(e => env.DB.prepare("INSERT OR IGNORE INTO chat_members (conv_id, email, role, src, joined_at, last_read) VALUES (?,?,'member','hand',?,(SELECT COALESCE(MAX(id),0) FROM chat_msgs WHERE conv_id = ?))").bind(conv, e, now, conv)));
      if (ok.length) notes.push(`added ${await namesOf(env, ok)}`);
    }
    const rem = (Array.isArray(b.remove) ? b.remove : []).map(x => String(x).toLowerCase());
    if (rem.length) {
      if (!canEdit) throw err("Only the group admins can remove people", 403);
      const nm = await namesOf(env, rem);
      await env.DB.batch(rem.map(e => env.DB.prepare("DELETE FROM chat_members WHERE conv_id = ? AND email = ? AND src = 'hand'").bind(conv, e)));
      notes.push(`removed ${nm}`);
    }
    for (const [e, role] of Object.entries(b.roles || {})) {
      if (!canEdit) throw err("Only the group admins can change admins", 403);
      await env.DB.prepare("UPDATE chat_members SET role = ? WHERE conv_id = ? AND email = ?").bind(role === "admin" ? "admin" : "member", conv, String(e).toLowerCase()).run();
    }
    for (const n of notes) await addSystem(env, conv, `${me.full_name} ${n}`, me);
    await bumpAll(env, conv);
    for (const e of rem) await fan(env, [e], { type: "chat", ev: "conv", c: conv });
    return { ok: true };
  }
  if (path === "chat/leave" && method === "POST") {
    const conv = clip(b.c, 40), m = await member(env, conv, me.email);
    if (!m || m.kind !== "group") throw err("Not allowed", 403);
    if (m.auto_key) throw err("This group follows People & roles — you cannot leave it (you can mute it)");
    await env.DB.prepare("DELETE FROM chat_members WHERE conv_id = ? AND email = ?").bind(conv, me.email).run();
    await addSystem(env, conv, `${me.full_name} left`, me);
    await bumpAll(env, conv);
    return { ok: true };
  }
  if (path === "chat/seen" && method === "GET") {   // who read one message
    const id = Number(q("id"));
    const x = await env.DB.prepare("SELECT conv_id, email FROM chat_msgs WHERE id = ?").bind(id).first();
    if (!x || !(await member(env, x.conv_id, me.email))) throw err("Not allowed", 403);
    const mem = await members(env, x.conv_id);
    return { read: mem.filter(u => u.email !== x.email && u.last_read >= id).map(u => u.full_name), waiting: mem.filter(u => u.email !== x.email && u.last_read < id).map(u => u.full_name) };
  }
  if (path === "chat/unread" && method === "GET") {
    const r = await env.DB.prepare(`SELECT COUNT(*) AS n FROM chat_msgs x JOIN chat_members m ON m.conv_id = x.conv_id AND m.email = ?
      WHERE x.id > m.last_read AND x.email <> ? AND x.kind <> 'system' AND (m.muted = 0 OR x.mentions LIKE ?)`).bind(me.email, me.email, `%"${me.email}"%`).first();
    return { unread: Number(r && r.n) || 0 };
  }
  return null;
}
async function activeEmails(env, list) {
  if (!list.length) return [];
  const { results } = await env.DB.prepare(`SELECT email FROM users WHERE active = 1 AND email IN (${list.map(() => "?").join(",")})`).bind(...list).all();
  return (results || []).map(r => r.email);
}
async function namesOf(env, list) {
  if (!list.length) return "";
  const { results } = await env.DB.prepare(`SELECT full_name FROM users WHERE email IN (${list.map(() => "?").join(",")})`).bind(...list).all();
  const n = (results || []).map(r => r.full_name);
  return n.length > 3 ? `${n.slice(0, 3).join(", ")} and ${n.length - 3} more` : n.join(", ");
}

/* ---------- cron: messages and files are kept 1 month (checked once a day) ---------- */
export async function chatRun(env) {
  const day = new Date().toISOString().slice(0, 10), k = "chat:clean";
  const last = await env.DB.prepare("SELECT v FROM meta WHERE k = ?").bind(k).first();
  if (last && last.v === day) return;
  await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)").bind(k, day).run();
  const cut = new Date(Date.now() - KEEP_DAYS * 864e5).toISOString();
  for (let i = 0; i < 20; i++) {
    const { results } = await env.DB.prepare("SELECT id, file_key FROM chat_msgs WHERE created_at < ? LIMIT 500").bind(cut).all();
    const rows = results || []; if (!rows.length) break;
    const keys = rows.map(r => r.file_key).filter(Boolean);
    if (keys.length && env.FILES) for (let j = 0; j < keys.length; j += 100) await env.FILES.delete(keys.slice(j, j + 100)).catch(() => {});
    await env.DB.prepare(`DELETE FROM chat_msgs WHERE id IN (${rows.map(() => "?").join(",")})`).bind(...rows.map(r => r.id)).run();
  }
}
