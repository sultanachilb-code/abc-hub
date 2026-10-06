/* =====================================================================
   WEEKLY DIGEST — every Monday morning each person gets an email with only THEIR items:
   MOM actions they own (overdue / due this week), malfunctions they logged still open, their training expired or expiring,
   and — for management and Senior Mall Supervisors — the flagship's portal follow-ups, urgent malfunctions and contracts ending.
   Nothing is sent to someone with nothing to do. Each person can switch it off in their profile.
   See docs/FEATURE-weekly-digest.md
   ===================================================================== */
import { trainingStatus } from "./training.js";
import { isFollowUp, cleanStatus } from "./portal.js";

const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const rows = async q => { try { return (await q.all()).results || []; } catch { return []; } };
const addDays = (d, n) => new Date(Date.parse(d + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const fmt = d => d ? new Date(d.slice(0, 10) + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "";

export async function digestSchema(env) {
  try { await env.DB.prepare("ALTER TABLE users ADD COLUMN weekly_digest INTEGER NOT NULL DEFAULT 1").run(); } catch {}
}

/* what one person has to do — { sections: [{ title, items: [{ t, sub, tone }] }], count } */
export async function digestFor(env, u, d) {
  const today = d.today(), week = addDays(today, 7), DB = env.DB;
  const site = u.site_code || (d.sitesOf(u)[0] || "");
  const S = [];
  /* MOM actions */
  const acts = await rows(DB.prepare(`SELECT a.text, a.due, a.status, m.title, m.site FROM mom_actions a JOIN mom_meetings m ON m.id = a.meeting_id
    WHERE lower(a.owner_email) = ? AND a.status NOT IN ('Done','Closed','Cancelled') AND a.due != '' AND a.due <= ? ORDER BY a.due LIMIT 30`).bind(u.email.toLowerCase(), week));
  if (acts.length) S.push({ title: "Your MOM actions", items: acts.map(a => ({ t: a.text, sub: `${a.title} · due ${fmt(a.due)}${a.due < today ? " — overdue" : ""}`, tone: a.due < today ? "al" : "warn" })) });
  /* malfunctions they logged, open for more than 2 days */
  const mf = await rows(DB.prepare(`SELECT r.category, r.location, r.status, r.priority, r.found_at, p.name AS provider FROM mf_records r LEFT JOIN mf_providers p ON p.id = r.provider_id
    WHERE r.created_by = ? AND r.deleted = 0 AND r.status NOT IN ('Fixed','Closed') AND r.found_at < ? ORDER BY r.found_at LIMIT 20`).bind(u.email, new Date(Date.now() - 2 * 864e5).toISOString()));
  if (mf.length) S.push({ title: "Malfunctions you logged, still open", items: mf.map(m => ({ t: `${m.category || "Malfunction"}${m.location ? " · " + m.location : ""}`, sub: `${m.status}${m.provider ? " · " + m.provider : ""} · since ${fmt(m.found_at)} · ${m.priority}`, tone: ["High", "Critical"].includes(m.priority) ? "al" : "warn" })) });
  /* their training */
  if (site) try {
    const T = await trainingStatus(env, site, await d.staff(env, site), d.posKey, today);
    const me = T.rows.find(r => r.key === "u:" + u.email);
    if (me) {
      const L = T.courses.map(c => ({ c, x: me.cells[c.id] })).filter(({ x }) => ["expired", "soon", "missing"].includes(x.st));
      if (L.length) S.push({ title: "Your training", items: L.map(({ c, x }) => ({ t: c.name, sub: x.st === "missing" ? "Required for your position — not done yet" : x.st === "expired" ? `Expired ${fmt(x.exp)}` : `Expires ${fmt(x.exp)}`, tone: x.st === "soon" ? "warn" : "al" })) });
    }
  } catch {}
  /* the flagship — management and Senior Mall Supervisors */
  const lead = d.isFull(u) || (u.role === "SUPERVISOR" && u.position === "SMS");
  if (lead && site) {
    const items = [];
    const P = await rows(DB.prepare("SELECT status, created_day FROM portal_items WHERE site = ? AND active = 1").bind(site));
    const fu = P.filter(x => isFollowUp(cleanStatus(x.status)));
    if (fu.length) { const old = fu.reduce((m, x) => (!m || (x.created_day && x.created_day < m) ? x.created_day : m), ""); items.push({ t: `${fu.length} portal follow-up${fu.length === 1 ? "" : "s"} waiting on tenants`, sub: old ? `oldest since ${fmt(old)}` : "", tone: "warn" }); }
    const urgent = await rows(DB.prepare("SELECT COUNT(*) AS n FROM mf_records WHERE site = ? AND deleted = 0 AND status NOT IN ('Fixed','Closed') AND priority IN ('High','Critical')").bind(site));
    if (urgent[0] && urgent[0].n) items.push({ t: `${urgent[0].n} high / critical malfunction${urgent[0].n === 1 ? "" : "s"} open`, sub: "Malfunction Records", tone: "al" });
    const ce = await rows(DB.prepare("SELECT tenant, end_day, departure_day FROM contracts_ending WHERE site = ? AND active = 1 AND COALESCE(NULLIF(departure_day,''), end_day) BETWEEN ? AND ? ORDER BY end_day LIMIT 10").bind(site, today, addDays(today, 30)));
    for (const c of ce) items.push({ t: `${c.tenant} — contract ends ${fmt(c.departure_day || c.end_day)}`, sub: "Contracts Near Ending", tone: "warn" });
    if (items.length) S.push({ title: `${d.siteName(site)} this week`, items });
  }
  return { sections: S, count: S.reduce((n, s) => n + s.items.length, 0), site };
}

export function digestHtml(u, D, hubUrl) {
  const col = { al: "#C0392B", warn: "#B7791F" };
  const F = "font-family:Segoe UI,Arial,sans-serif;";
  return `<div style="${F}max-width:640px;margin:0 auto;color:#221A2E">
    <div style="background:#2A0F45;color:#fff;padding:18px 22px;border-radius:14px 14px 0 0"><div style="font-size:12px;opacity:.75;letter-spacing:.08em;text-transform:uppercase">ABC Operations Hub · weekly</div>
      <div style="font-size:20px;font-weight:700;margin-top:4px">Good morning ${esc(u.full_name.split(" ")[0])} — ${D.count} item${D.count === 1 ? "" : "s"} for you this week</div></div>
    <div style="border:1px solid #E3DCEC;border-top:0;border-radius:0 0 14px 14px;padding:8px 22px 18px">
    ${D.sections.map(s => `<div style="margin-top:16px;font-size:12px;font-weight:700;color:#6D6479;text-transform:uppercase;letter-spacing:.06em">${esc(s.title)}</div>
      ${s.items.map(i => `<div style="padding:9px 0;border-bottom:1px solid #EEE9F4"><div style="font-size:14px;font-weight:600;border-left:3px solid ${col[i.tone] || "#7B4BB0"};padding-left:9px">${esc(i.t)}</div>${i.sub ? `<div style="font-size:12px;color:#6D6479;padding-left:12px;margin-top:2px">${esc(i.sub)}</div>` : ""}</div>`).join("")}`).join("")}
    <div style="margin-top:18px"><a href="${esc(hubUrl)}" style="display:inline-block;background:#4A1F73;color:#fff;text-decoration:none;padding:10px 16px;border-radius:10px;font-weight:700;font-size:14px">Open the hub</a></div>
    <div style="font-size:11px;color:#8C8398;margin-top:14px">Only your own items. To stop this email: hub › your profile › Weekly digest.</div></div></div>`;
}

/* cron: Monday from 08:00 Beirut, once per person per week */
const beirutNow = () => { const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Beirut", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", weekday: "short", hour12: false }).formatToParts(new Date()).map(x => [x.type, x.value])); return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24, weekday: p.weekday }; };
export async function digestRun(env, d) {
  const t = beirutNow();
  if (t.weekday !== "Mon" || t.hour < 8 || t.hour > 11) return { sent: 0 };
  if (!env.MAIL_RELAY_URL) return { sent: 0 };
  const { results } = await env.DB.prepare("SELECT * FROM users WHERE active = 1 AND weekly_digest = 1").all();
  let sent = 0;
  for (const u of results || []) {
    if (sent >= 15) break;   // a few per run (the cron runs every 2 minutes) — keeps each run short
    const k = `digest:${t.day}:${u.email}`;
    if (await env.DB.prepare("SELECT 1 FROM meta WHERE k = ?").bind(k).first()) continue;
    await env.DB.prepare("INSERT OR IGNORE INTO meta (k, v) VALUES (?, ?)").bind(k, new Date().toISOString()).run();
    const D = await digestFor(env, u, d).catch(() => null);
    if (!D || !D.count) continue;
    await d.relay(env, { to: [u.email], subject: `Your week · ${D.count} item${D.count === 1 ? "" : "s"} · ABC Operations Hub`, html: digestHtml(u, D, d.hubUrl) });
    sent++;
  }
  return { sent };
}
