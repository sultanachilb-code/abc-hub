/* =====================================================================
   MALL LAYOUTS — feature module (kept separate so it can be removed cleanly)
   See docs/FEATURE-layouts.md for everything this feature adds.

   Tables : layout_levels · layout_images · layout_pins
   Routes : /api/ops/layouts/*   (all require a hub sign-in)
   ===================================================================== */

export async function layoutsSchema(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS layout_levels (site TEXT NOT NULL, level TEXT NOT NULL, name TEXT NOT NULL DEFAULT '',
      seq INTEGER NOT NULL DEFAULT 0, width INTEGER NOT NULL DEFAULT 0, height INTEGER NOT NULL DEFAULT 0, figures TEXT NOT NULL DEFAULT '{}',
      source TEXT NOT NULL DEFAULT '', uploaded_by TEXT, uploaded_at TEXT, PRIMARY KEY (site, level))`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS layout_images (site TEXT NOT NULL, level TEXT NOT NULL, part INTEGER NOT NULL,
      mime TEXT NOT NULL DEFAULT 'image/webp', data BLOB NOT NULL, PRIMARY KEY (site, level, part))`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS layout_pins (id INTEGER PRIMARY KEY AUTOINCREMENT, site TEXT NOT NULL, level TEXT NOT NULL,
      code TEXT NOT NULL DEFAULT '', label TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL DEFAULT 'unit', x REAL NOT NULL, y REAL NOT NULL,
      source TEXT NOT NULL DEFAULT 'auto', updated_by TEXT, updated_at TEXT)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS layout_pins_site ON layout_pins (site, level)`)
  ]);
}

const PART = 700 * 1024;
const clip = (v, n) => String(v == null ? "" : v).slice(0, n);
const num = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo; };
const levelOk = v => /^[A-Za-z0-9 .-]{1,12}$/.test(String(v || ""));

/* The plan image for one level, streamed from D1 (sign-in required) */
export async function layoutsImage(env, site, url) {
  const level = String(url.searchParams.get("level") || "");
  const { results } = await env.DB.prepare("SELECT mime, data FROM layout_images WHERE site = ? AND level = ? ORDER BY part").bind(site, level).all();
  if (!results || !results.length) return new Response("Not found", { status: 404 });
  const parts = results.map(r => r.data instanceof ArrayBuffer ? new Uint8Array(r.data) : ArrayBuffer.isView(r.data) ? new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength) : new Uint8Array(r.data));
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return new Response(out, { headers: { "content-type": results[0].mime || "image/webp", "cache-control": "private, max-age=86400" } });
}

/* ctx = { site, can, me, now, raiseEvent } — `can.layouts` decides who may upload and adjust */
export async function layoutsRoute(env, p, method, b, url, ctx) {
  const { site, can, me, now } = ctx;
  const q = k => url.searchParams.get(k);

  if (p === "layouts/list") {
    const [levels, pins] = await Promise.all([
      env.DB.prepare("SELECT site, level, name, seq, width, height, figures, source, uploaded_by, uploaded_at FROM layout_levels WHERE site = ? ORDER BY seq, level").bind(site).all(),
      env.DB.prepare("SELECT id, level, code, label, kind, x, y, source FROM layout_pins WHERE site = ?").bind(site).all()
    ]);
    return { site, can, levels: (levels.results || []).map(l => ({ level: l.level, name: l.name, seq: l.seq, width: l.width, height: l.height,
      figures: JSON.parse(l.figures || "{}"), source: l.source, uploadedBy: l.uploaded_by, uploadedAt: l.uploaded_at })), pins: pins.results || [] };
  }

  if (!can.layouts) throw Object.assign(new Error("Only the flagship's Manager or Senior Mall Supervisor can change the layouts"), { status: 403 });

  /* Upload one level: image + figures + the unit positions read from the PDF. Manual pins are kept. */
  if (p === "layouts/level" && method === "POST") {
    const level = String(b.level || "").trim();
    if (!levelOk(level)) throw Object.assign(new Error("Level name should be short, e.g. L4, GF, LGF, B2"), { status: 400 });
    const m = /^data:(image\/(?:webp|png|jpeg));base64,(.+)$/.exec(String(b.image || ""));
    if (!m) throw Object.assign(new Error("The plan image is missing"), { status: 400 });
    const bin = atob(m[2]), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    if (bytes.length > 8 * 1024 * 1024) throw Object.assign(new Error("This plan image is too large"), { status: 400 });
    const figures = b.figures && typeof b.figures === "object" ? Object.fromEntries(Object.entries(b.figures).slice(0, 20).map(([k, v]) => [clip(k, 40), num(v, 0, 1e7)])) : {};
    const ops = [
      env.DB.prepare(`INSERT INTO layout_levels (site, level, name, seq, width, height, figures, source, uploaded_by, uploaded_at) VALUES (?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(site, level) DO UPDATE SET name=excluded.name, seq=excluded.seq, width=excluded.width, height=excluded.height, figures=excluded.figures,
        source=excluded.source, uploaded_by=excluded.uploaded_by, uploaded_at=excluded.uploaded_at`)
        .bind(site, level, clip(b.name, 60), Math.round(num(b.seq, 0, 99)), Math.round(num(b.width, 0, 20000)), Math.round(num(b.height, 0, 20000)),
          JSON.stringify(figures), clip(b.source, 120), me.full_name, now()),
      env.DB.prepare("DELETE FROM layout_images WHERE site = ? AND level = ?").bind(site, level),
      env.DB.prepare("DELETE FROM layout_pins WHERE site = ? AND level = ? AND source = 'auto'").bind(site, level)
    ];
    for (let i = 0, part = 0; i < bytes.length; i += PART, part++) {
      ops.push(env.DB.prepare("INSERT INTO layout_images (site, level, part, mime, data) VALUES (?,?,?,?,?)").bind(site, level, part, m[1], bytes.subarray(i, i + PART)));
    }
    for (const pin of (Array.isArray(b.pins) ? b.pins : []).slice(0, 400)) {
      ops.push(env.DB.prepare("INSERT INTO layout_pins (site, level, code, label, kind, x, y, source, updated_by, updated_at) VALUES (?,?,?,?,'unit',?,?,'auto',?,?)")
        .bind(site, level, clip(pin.code, 30).toUpperCase(), "", num(pin.x, 0, 1), num(pin.y, 0, 1), me.full_name, now()));
    }
    for (let i = 0; i < ops.length; i += 80) await env.DB.batch(ops.slice(i, i + 80));
    return { level, bytes: bytes.length, pins: Math.min(400, (b.pins || []).length) };
  }
  if (p === "layouts/delete" && method === "POST") {
    const level = String(b.level || "");
    await env.DB.batch([
      env.DB.prepare("DELETE FROM layout_levels WHERE site = ? AND level = ?").bind(site, level),
      env.DB.prepare("DELETE FROM layout_images WHERE site = ? AND level = ?").bind(site, level),
      env.DB.prepare("DELETE FROM layout_pins WHERE site = ? AND level = ?").bind(site, level)
    ]);
    return { deleted: true };
  }
  /* Add, move, relabel or delete a pin (adjust mode) */
  if (p === "layouts/pin" && method === "POST") {
    const id = Number(b.id) || 0;
    if (b.delete) { await env.DB.prepare("DELETE FROM layout_pins WHERE id = ? AND site = ?").bind(id, site).run(); return { deleted: true }; }
    const x = num(b.x, 0, 1), y = num(b.y, 0, 1);
    if (id) {
      await env.DB.prepare("UPDATE layout_pins SET x = ?, y = ?, code = COALESCE(?, code), label = COALESCE(?, label), source = 'manual', updated_by = ?, updated_at = ? WHERE id = ? AND site = ?")
        .bind(x, y, b.code == null ? null : clip(b.code, 30).toUpperCase(), b.label == null ? null : clip(b.label, 80), me.full_name, now(), id, site).run();
      return { id };
    }
    const level = String(b.level || "");
    if (!levelOk(level)) throw Object.assign(new Error("Choose a level"), { status: 400 });
    const kind = b.code ? "unit" : "place";
    if (kind === "place" && !String(b.label || "").trim()) throw Object.assign(new Error("Give the place a name"), { status: 400 });
    const r = await env.DB.prepare("INSERT INTO layout_pins (site, level, code, label, kind, x, y, source, updated_by, updated_at) VALUES (?,?,?,?,?,?,?,'manual',?,?)")
      .bind(site, level, clip(b.code, 30).toUpperCase(), clip(b.label, 80), kind, x, y, me.full_name, now()).run();
    return { id: r.meta.last_row_id };
  }
  throw Object.assign(new Error("Unknown endpoint"), { status: 404 });
}
