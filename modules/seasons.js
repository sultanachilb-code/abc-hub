/* =====================================================================
   SEASONAL DECORATIONS — the admin chooses each season's design, dates and greeting (tools/seasons.html).
   On the home page the decorations hang on ropes from the header into the empty side spaces, with a greeting chip.
   Admin only (Oct 2026). Kept in meta 'seasons'.
   Routes : GET /api/seasons (the list, admin) · GET/POST /api/admin/seasons          See docs/FEATURE-seasons.md
   ===================================================================== */
const clip = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const SEASON_DESIGNS = {
  christmas: "Santa, baubles & snow", lanterns: "Lanterns & crescent", eid: "Crescent, stars & lantern", independence: "Cedar, flag & bunting",
  easter: "Eggs & spring flowers", hearts: "Hearts", flowers: "Flowers", summer: "Sun & waves", fireworks: "Fireworks & stars"
};
export const SEASON_SEED = [
  { id: "s1", name: "Independence Day", design: "independence", from: "2026-11-21", to: "2026-11-23", en: "Happy Independence Day", ar: "عيد استقلال سعيد", on: true },
  { id: "s2", name: "Christmas & New Year", design: "christmas", from: "2026-12-01", to: "2027-01-06", en: "Happy Holidays", ar: "ميلاد مجيد", on: true },
  { id: "s3", name: "Ramadan", design: "lanterns", from: "2027-02-08", to: "2027-03-09", en: "Ramadan Kareem", ar: "رمضان كريم", on: true },
  { id: "s4", name: "Eid al-Fitr", design: "eid", from: "2027-03-10", to: "2027-03-12", en: "Eid Mubarak", ar: "عيد مبارك", on: true },
  { id: "s5", name: "Easter", design: "easter", from: "2027-03-26", to: "2027-03-29", en: "Happy Easter", ar: "فصح مجيد", on: true },
  { id: "s6", name: "Eid al-Adha", design: "eid", from: "2027-05-16", to: "2027-05-19", en: "Eid al-Adha Mubarak", ar: "عيد أضحى مبارك", on: true },
  { id: "s7", name: "Summer", design: "summer", from: "2027-07-01", to: "2027-08-31", en: "Summer at ABC", ar: "صيف حلو", on: false }
];
async function readAll(env) {
  const r = await env.DB.prepare("SELECT v FROM meta WHERE k = 'seasons'").first().catch(() => null);
  if (!r) return { on: true, list: SEASON_SEED };
  try { return JSON.parse(r.v); } catch { return { on: true, list: [] }; }
}
export async function seasonsFor(env, me) {
  if (me.role !== "ADMIN") return { on: false, list: [] };   // admin only
  return readAll(env);
}
export async function seasonsAdmin(env, method, b, me, now) {
  if (method === "GET") return { ...(await readAll(env)), designs: SEASON_DESIGNS };
  const list = (Array.isArray(b.list) ? b.list : []).slice(0, 40).map((s, i) => ({ id: clip(s.id, 16) || "s" + Date.now().toString(36) + i, name: clip(s.name, 60),
    design: SEASON_DESIGNS[s.design] ? s.design : "lanterns", from: DAY.test(s.from || "") ? s.from : "", to: DAY.test(s.to || "") ? s.to : "",
    en: clip(s.en, 60), ar: clip(s.ar, 60), on: s.on !== false })).filter(s => s.name && s.from && s.to).map(s => s.to < s.from ? { ...s, to: s.from } : s);
  const v = { on: b.on !== false, list, updatedAt: now(), updatedBy: me.full_name };
  await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('seasons', ?)").bind(JSON.stringify(v)).run();
  return { ...v, designs: SEASON_DESIGNS };
}
