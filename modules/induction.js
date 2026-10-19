/* =====================================================================
   OPERATIONS INDUCTION (Oct 2026) — docs/FEATURE-induction.md
   One newcomer induction PowerPoint per flagship, built in the browser (tools/induction.html, PptxGenJS):
   the flagship's current team comes from Admin → Hub users (name, position, profile picture), and a small
   settings form per flagship holds what differs (manual name, trading hours, extra tasks, service partners, cover photo).
   Routes (/api/ops/ind/…): data · save · cover (GET image | POST upload/remove)
   ===================================================================== */
const err = (m, status = 400) => Object.assign(new Error(m), { status });
const clip = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
const list = (v, n = 12) => (Array.isArray(v) ? v : String(v || "").split(/[,\n·]+/)).map(x => clip(x, 60)).filter(Boolean).slice(0, n);

export async function inductionSchema(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS ind_settings (site TEXT PRIMARY KEY, cfg TEXT NOT NULL DEFAULT '{}', cover TEXT NOT NULL DEFAULT '',
    cover_at TEXT NOT NULL DEFAULT '', updated_by TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '')`).run();
}

/* what differs per flagship — Verdun Mall starts from the 2026 Verdun induction */
export function defaults(site, name) {
  const short = name.replace(/^ABC\s+/i, "").replace(/ Department Store$/i, " DS").replace(/ Mall$/i, "");
  const base = { brand: "ABC " + short.replace(/ DS$/, ""), short, year: String(new Date().getUTCFullYear()), manual: `ABC ${short} Manual Guideline`, hours: "10:00–22:00", staffIn: "09:30",
    extraTasks: [], extraDuties: [], technicalExtra: [], ho: ["Leasing", "Procurement", "Marketing", "Legal", "Treasury"], soft: [], hidden: [], leaders: false };
  if (site === "VRM") return { ...base, brand: "ABC Verdun", short: "Verdun", manual: "ABC Verdun Manual Guideline",
    extraTasks: ["Liban Park (parking)", "I-Play"], extraDuties: ["I-Play"], technicalExtra: ["Patio heaters"], soft: ["CAT", "Liban Park", "MES Security", "SIAD", "Exotica"] };
  return base;
}
function clean(c, d) {
  return { brand: clip(c.brand, 40) || d.brand, short: clip(c.short, 30) || d.short, year: clip(c.year, 4) || d.year, manual: clip(c.manual, 60) || d.manual,
    hours: clip(c.hours, 20) || d.hours, staffIn: clip(c.staffIn, 10) || d.staffIn, extraTasks: list(c.extraTasks, 6), extraDuties: list(c.extraDuties, 4),
    technicalExtra: list(c.technicalExtra, 3), ho: list(c.ho, 8), soft: list(c.soft, 8), hidden: (Array.isArray(c.hidden) ? c.hidden : []).map(x => clip(x, 120).toLowerCase()).slice(0, 80), leaders: !!c.leaders };
}

export async function inductionRoute(env, p, method, b, url, d) {
  const { me, site } = d;
  if (!d.canSite(me, site)) throw err("No access to this flagship", 403);
  const name = d.siteName(site), dflt = defaults(site, name);
  const row = await env.DB.prepare("SELECT cfg, cover_at, updated_by, updated_at FROM ind_settings WHERE site = ?").bind(site).first().catch(() => null);
  let cfg = dflt; try { if (row) cfg = clean({ ...dflt, ...JSON.parse(row.cfg || "{}") }, dflt); } catch {}

  if (p === "ind/data") {
    const team = await d.team(site);   // [{ email, name, role, pos, rank, photoAt }]
    const sc = await env.DB.prepare("SELECT updated_at FROM site_covers WHERE site = ?").bind(site).first().catch(() => null);
    return { site, siteName: name, cfg, defaults: dflt, team, canEdit: d.canEdit, updatedBy: row ? row.updated_by : "", updatedAt: row ? row.updated_at : "",
      cover: row && row.cover_at ? row.cover_at : "", siteCover: sc ? sc.updated_at : "" };
  }
  if (!d.canEdit) throw err("Only management and the Senior Mall Supervisor change the induction", 403);
  if (p === "ind/save" && method === "POST") {
    const c = clean({ ...dflt, ...(b.cfg || {}) }, dflt);
    await env.DB.prepare("INSERT INTO ind_settings (site, cfg, updated_by, updated_at) VALUES (?,?,?,?) ON CONFLICT(site) DO UPDATE SET cfg = excluded.cfg, updated_by = excluded.updated_by, updated_at = excluded.updated_at")
      .bind(site, JSON.stringify(c), me.full_name, d.now()).run();
    return { saved: true, cfg: c };
  }
  if (p === "ind/cover" && method === "POST") {
    const data = String(b.data || "");
    if (b.remove) { await env.DB.prepare("UPDATE ind_settings SET cover = '', cover_at = '' WHERE site = ?").bind(site).run(); return { cover: "" }; }
    if (!/^data:image\/(jpeg|png|webp);base64,/.test(data) || data.length > 1_400_000) throw err("Choose a photo (it is resized before upload)");
    const at = d.now();
    await env.DB.prepare("INSERT INTO ind_settings (site, cover, cover_at, updated_by, updated_at) VALUES (?,?,?,?,?) ON CONFLICT(site) DO UPDATE SET cover = excluded.cover, cover_at = excluded.cover_at")
      .bind(site, data, at, me.full_name, at).run();
    return { cover: at };
  }
  throw err("Unknown request", 404);
}
/* GET /api/ops/ind/cover?site= — the induction cover photo (served as an image) */
export async function inductionCover(env, site) {
  const r = await env.DB.prepare("SELECT cover FROM ind_settings WHERE site = ?").bind(site).first().catch(() => null);
  const m = r && /^data:(image\/[a-z]+);base64,(.+)$/.exec(r.cover || "");
  if (!m) return new Response("", { status: 404 });
  const bin = atob(m[2]), bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Response(bytes, { headers: { "content-type": m[1], "cache-control": "private, no-cache" } });
}
