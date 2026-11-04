/* =====================================================================
   HUB GUIDEBOOKS — step-by-step flip-book guides of the hub, one book per audience
   (Supervisors · Directors · CDSO · Security). Each person reads the book of their title;
   Admin and managers can open all four. Chapter progress is kept per person; screenshots and
   videos are uploaded by the admin into each chapter's slots (R2 guide/…).
   Routes (under /api/ops/) :
     GET  guide/me              my book, my progress, the uploaded media, my rights
     POST guide/progress        { books }  save my progress
     GET  guide/team            everyone's progress (management, leadership, admin)
     POST guide/media           { slot, data (data URL), name }   admin
     POST guide/media/remove    { slot }                          admin
     GET  guide/file?slot=      the picture / video of a slot
   See docs/FEATURE-guide.md
   ===================================================================== */
const err = (m, s = 400) => Object.assign(new Error(m), { status: s });
const clip = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
const BOOKS = ["sup", "dir", "cdso", "sec"];
const SLOT = /^(sup|dir|cdso|sec)\.[a-z0-9-]{1,30}\.\d{1,2}$/;
const MAX_BYTES = 25 * 1024 * 1024;   // one picture or one short video

export async function guideSchema(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS guide_progress (email TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', role TEXT NOT NULL DEFAULT '',
      pos TEXT NOT NULL DEFAULT '', site TEXT NOT NULL DEFAULT '', books TEXT NOT NULL DEFAULT '{}', updated TEXT)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS guide_media (slot TEXT PRIMARY KEY, file_key TEXT NOT NULL, type TEXT NOT NULL, name TEXT NOT NULL DEFAULT '',
      updated TEXT, updated_by TEXT NOT NULL DEFAULT '')`)
  ]);
}

/* the book of this person's title */
export function bookOf(me) {
  if (me.role === "SECURITY") return "sec";
  if (me.role === "CDSO") return "cdso";
  if (["DIRECTOR", "ADVISOR", "MANAGER"].includes(me.role)) return "dir";
  return "sup";
}
const allBooks = me => me.role === "ADMIN" || me.role === "MANAGER";
const teamView = me => ["ADMIN", "MANAGER", "ADVISOR", "DIRECTOR", "CDSO"].includes(me.role) || (me.role === "SECURITY" && me.position === "HOS");

function cleanBooks(v) {
  const out = {};
  for (const k of BOOKS) {
    const b = v && v[k]; if (!b) continue;
    const done = [...new Set((Array.isArray(b.done) ? b.done : []).map(x => clip(x, 30)).filter(Boolean))].slice(0, 40);
    out[k] = { done, finished: b.finished ? clip(b.finished, 30) : "" };
  }
  return out;
}

export async function guideRoute(env, p, method, b, url, d) {
  const { me, now, sitesOf, siteName } = d;
  const DB = env.DB, admin = me.role === "ADMIN";

  if (p === "guide/me" && method === "GET") {
    const r = await DB.prepare("SELECT books FROM guide_progress WHERE email = ?").bind(me.email).first();
    const media = (await DB.prepare("SELECT slot, type, name, updated FROM guide_media").all()).results || [];
    let books = {}; try { books = JSON.parse((r && r.books) || "{}"); } catch {}
    return { book: bookOf(me), all: allBooks(me), team: teamView(me), admin, name: me.full_name || "", books, media };
  }
  if (p === "guide/progress" && method === "POST") {
    const books = cleanBooks(b.books);
    await DB.prepare(`INSERT INTO guide_progress (email, name, role, pos, site, books, updated) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(email) DO UPDATE SET name = excluded.name, role = excluded.role, pos = excluded.pos, site = excluded.site, books = excluded.books, updated = excluded.updated`)
      .bind(me.email, me.full_name || "", me.role || "", me.position || "", me.site_code || "", JSON.stringify(books), now()).run();
    return { saved: true };
  }
  if (p === "guide/team" && method === "GET") {
    if (!teamView(me)) throw err("Management and leadership only", 403);
    const rows = (await DB.prepare("SELECT name, role, pos, site, books, updated FROM guide_progress ORDER BY site, name").all()).results || [];
    const mine = new Set(sitesOf(me));
    const wide = admin || me.role === "ADVISOR";
    return { rows: rows.filter(x => wide || !x.site || mine.has(x.site)).map(x => {
      let bk = {}; try { bk = JSON.parse(x.books || "{}"); } catch {}
      return { name: x.name, role: x.role, pos: x.pos, site: x.site, siteName: x.site ? siteName(x.site) : "", books: bk, updated: x.updated };
    }) };
  }
  if (p === "guide/file" && method === "GET") {
    const slot = String(url.searchParams.get("slot") || "");
    if (!SLOT.test(slot)) throw err("Not found", 404);
    const m = await DB.prepare("SELECT file_key, type FROM guide_media WHERE slot = ?").bind(slot).first();
    const o = m && env.FILES ? await env.FILES.get(m.file_key) : null;
    if (!o) throw err("Not found", 404);
    return new Response(o.body, { headers: { "content-type": m.type, "cache-control": "private, max-age=86400", "accept-ranges": "bytes" } });
  }
  if (p === "guide/media" && method === "POST") {
    if (!admin) throw err("Only the administrator adds pictures and videos", 403);
    const slot = String(b.slot || ""); if (!SLOT.test(slot)) throw err("Unknown slot");
    const m = /^data:((?:image\/(?:png|jpeg|webp|gif))|(?:video\/(?:mp4|webm|quicktime)));base64,(.+)$/.exec(String(b.data || ""));
    if (!m) throw err("Choose a picture (PNG, JPG, WebP) or a video (MP4, WebM, MOV)");
    const bin = Uint8Array.from(atob(m[2]), c => c.charCodeAt(0));
    if (bin.length > MAX_BYTES) throw err("The file is larger than 25 MB — shorten or compress the video");
    if (!env.FILES) throw err("File storage is not connected", 500);
    const old = await DB.prepare("SELECT file_key FROM guide_media WHERE slot = ?").bind(slot).first();
    const ext = m[1].split("/")[1].replace("quicktime", "mov").replace("jpeg", "jpg");
    const key = `guide/${slot}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
    await env.FILES.put(key, bin, { httpMetadata: { contentType: m[1] } });
    await DB.prepare("INSERT OR REPLACE INTO guide_media (slot, file_key, type, name, updated, updated_by) VALUES (?,?,?,?,?,?)")
      .bind(slot, key, m[1], clip(b.name, 120), now(), me.full_name || me.email).run();
    if (old && old.file_key) await env.FILES.delete(old.file_key).catch(() => {});
    return { slot, type: m[1], updated: now() };
  }
  if (p === "guide/media/remove" && method === "POST") {
    if (!admin) throw err("Only the administrator removes pictures and videos", 403);
    const slot = String(b.slot || ""); if (!SLOT.test(slot)) throw err("Unknown slot");
    const old = await DB.prepare("SELECT file_key FROM guide_media WHERE slot = ?").bind(slot).first();
    await DB.prepare("DELETE FROM guide_media WHERE slot = ?").bind(slot).run();
    if (old && old.file_key && env.FILES) await env.FILES.delete(old.file_key).catch(() => {});
    return { removed: true };
  }
  throw err("Unknown request", 404);
}
