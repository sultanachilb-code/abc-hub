/* =====================================================================
   PROFILE — feature module (kept separate so it can be removed cleanly)
   See docs/FEATURE-profile.md

   • Profile picture: each person changes their own (square, resized on the phone before upload)
   • Flagship cover: one cover image per flagship, uploaded by the administrator — shown behind the profile
   Tables : user_photos · site_covers   (+ users.photo_at so the avatar refreshes when the picture changes)
   Routes : /api/profile · /api/profile/photo · /api/profile/cover · /api/admin/covers
   ===================================================================== */

const err = (m, status = 400) => Object.assign(new Error(m), { status });
const IMG = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;

export async function profileSchema(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS user_photos (email TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT '')`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS site_covers (site TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT '', updated_by TEXT NOT NULL DEFAULT '')`)
  ]);
  await env.DB.prepare("ALTER TABLE users ADD COLUMN photo_at TEXT NOT NULL DEFAULT ''").run().catch(() => {});
  await env.DB.prepare("ALTER TABLE users ADD COLUMN mobile TEXT NOT NULL DEFAULT ''").run().catch(() => {});   // for emergency calls
}

function image(dataUrl, maxKb) {
  const m = IMG.exec(String(dataUrl || ""));
  if (!m) throw err("Use a JPG, PNG or WEBP picture");
  if (m[2].length * 0.75 > maxKb * 1024) throw err(`The picture is too large (max ${maxKb} KB after resizing)`);
  return m[0];
}
function serve(dataUrl, v) {
  const m = IMG.exec(dataUrl); if (!m) return new Response("", { status: 404 });
  const bin = atob(m[2]), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Response(bytes, { headers: { "content-type": m[1], "cache-control": v ? "private, max-age=31536000, immutable" : "private, no-cache" } });
}

/* signed in — returns a Response (images) or data */
export async function profileRoute(env, path, method, b, url, { me, SITES, sitesOf, userOut, now }) {
  if (path === "profile") {
    const cover = me.site_code ? await env.DB.prepare("SELECT updated_at FROM site_covers WHERE site = ?").bind(me.site_code).first() : null;
    return { ...userOut(me), photoAt: me.photo_at || "", coverAt: cover ? cover.updated_at : "", mobile: me.mobile || "",
      access: sitesOf(me).map(c => ({ code: c, name: SITES[c] })) };
  }
  /* mobile number — the emergency alert can ring it (phone call) and shows it on the alert board */
  if (path === "profile/mobile" && method === "POST") {
    const m = String(b.mobile || "").trim().slice(0, 30);
    if (m && !/^[+\d][\d\s\-()]{5,}$/.test(m)) throw err("Write the mobile number with digits only, e.g. 03 123 456");
    await env.DB.prepare("UPDATE users SET mobile = ? WHERE email = ?").bind(m, me.email).run();
    return { mobile: m };
  }
  if (path === "profile/photo" && method === "GET") {
    const email = String(url.searchParams.get("u") || me.email).toLowerCase();
    const r = await env.DB.prepare("SELECT data FROM user_photos WHERE email = ?").bind(email).first();
    return r ? serve(r.data, url.searchParams.get("v")) : new Response("", { status: 404 });
  }
  if (path === "profile/photo" && method === "POST") {
    const at = now();
    if (!b.data) {
      await env.DB.prepare("DELETE FROM user_photos WHERE email = ?").bind(me.email).run();
      await env.DB.prepare("UPDATE users SET photo_at = '' WHERE email = ?").bind(me.email).run();
      return { photoAt: "" };
    }
    const data = image(b.data, 300);
    await env.DB.prepare("INSERT INTO user_photos (email, data, updated_at) VALUES (?,?,?) ON CONFLICT(email) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at")
      .bind(me.email, data, at).run();
    await env.DB.prepare("UPDATE users SET photo_at = ? WHERE email = ?").bind(at, me.email).run();
    return { photoAt: at };
  }
  if (path === "profile/cover") {
    const site = String(url.searchParams.get("site") || me.site_code || "").toUpperCase();
    const r = SITES[site] ? await env.DB.prepare("SELECT data FROM site_covers WHERE site = ?").bind(site).first() : null;
    return r ? serve(r.data, url.searchParams.get("v")) : new Response("", { status: 404 });
  }
  return null;
}

/* administrators: one cover per flagship */
export async function coversAdmin(env, method, b, { me, SITES, now }) {
  if (method === "POST") {
    const site = String(b.site || "").toUpperCase();
    if (!SITES[site]) throw err("Choose a flagship");
    if (!b.data) await env.DB.prepare("DELETE FROM site_covers WHERE site = ?").bind(site).run();
    else await env.DB.prepare(`INSERT INTO site_covers (site, data, updated_at, updated_by) VALUES (?,?,?,?)
      ON CONFLICT(site) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
      .bind(site, image(b.data, 900), now(), me.full_name).run();
  }
  const { results } = await env.DB.prepare("SELECT site, updated_at, updated_by FROM site_covers").all();
  const by = Object.fromEntries((results || []).map(r => [r.site, r]));
  return { covers: Object.entries(SITES).map(([code, name]) => ({ code, name, updatedAt: by[code] ? by[code].updated_at : "", updatedBy: by[code] ? by[code].updated_by : "" })) };
}
