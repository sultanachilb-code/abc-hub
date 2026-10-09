/* =====================================================================
   MESSAGE OF THE MOMENT — a short friendly message above Day to Day Operations, for the operations team.
   Each message has a time of day; the newest one whose time has passed is shown (until the next one's time).
   On each person's screen it stays 5 minutes from the first time they see it, once per message and day.
   Messages are written by the admin on /tools/moments. Kept in meta 'moments'.
   Routes : GET /api/moment  ·  admin: GET/POST /api/admin/moments
   See docs/FEATURE-moments.md
   ===================================================================== */
const clip = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
export const MOMENT_MINUTES = 5;
/* a first set, in English and Lebanese Arabic — edit them on the page */
export const MOMENT_SEED = [
  { time: "08:30", text: "صباح الخير يا أبطال ☕ Have a smooth opening today!" },
  { time: "10:00", text: "Doors are open — let's make every visitor smile 😊 · يلا، يوم حلو!" },
  { time: "12:30", text: "Lunch rush ahead — stay sharp and drink water 💧 · ما تنسوا تشربوا مي" },
  { time: "15:00", text: "Halfway there! Thank you for keeping the mall running ✨ · يعطيكن العافية" },
  { time: "18:00", text: "Evening team, welcome aboard 🌙 · أهلا وسهلا بفريق المسا" },
  { time: "21:30", text: "Almost closing — great work today 👏 · يعطيكم ألف عافية" }
];
const OPS_ROLES = ["ADMIN", "MANAGER", "SUPERVISOR"];   // the operations team (and the admin, to preview)
const mins = t => { const [h, m] = String(t || "0:0").split(":").map(Number); return h * 60 + (m || 0); };

async function readAll(env) {
  const r = await env.DB.prepare("SELECT v FROM meta WHERE k = 'moments'").first().catch(() => null);
  if (!r) return { on: true, list: MOMENT_SEED.map((m, i) => ({ id: "m" + (i + 1), ...m, active: true })) };
  try { return JSON.parse(r.v); } catch { return { on: true, list: [] }; }
}
/* the message for this person right now (or null) */
export async function momentFor(env, me, hm) {
  if (!OPS_ROLES.includes(me.role)) return null;
  const all = await readAll(env);
  if (!all.on) return null;
  const now = mins(hm), L = (all.list || []).filter(m => m.active && HM.test(m.time) && m.text).sort((a, b) => mins(a.time) - mins(b.time));
  const cur = [...L].reverse().find(m => mins(m.time) <= now);
  if (!cur) return null;
  const next = L.find(m => mins(m.time) > now);
  return { id: cur.id, text: cur.text, time: cur.time, until: next ? next.time : "24:00", minutes: MOMENT_MINUTES };
}
export async function momentsAdmin(env, method, b, me, now) {
  if (method === "GET") return { ...(await readAll(env)), minutes: MOMENT_MINUTES };
  const list = (Array.isArray(b.list) ? b.list : []).slice(0, 40).map((m, i) => ({ id: clip(m.id, 12) || "m" + Date.now().toString(36) + i, time: HM.test(m.time) ? m.time : "",
    text: clip(m.text, 220), active: m.active !== false })).filter(m => m.time && m.text);
  const v = { on: b.on !== false, list, updatedAt: now(), updatedBy: me.full_name };
  await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('moments', ?)").bind(JSON.stringify(v)).run();
  return { ...v, minutes: MOMENT_MINUTES };
}
