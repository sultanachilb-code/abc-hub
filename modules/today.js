/* =====================================================================
   Day to Day Operations — the live "today" timeline on the home screen
   GET /api/ops/today?site=XX  → shifts, handovers, contractors, meetings
   and events of today at one flagship, plus a line for each of the four
   tools (Schedule, Minutes of Meeting, Shift Handover, Contractors).
   Read-only. See docs/FEATURE-day-to-day.md
   ===================================================================== */
import { dayList } from "./contractors.js";

const isShift = v => /^([01]\d|2[0-4]):[03]0-([01]\d|2[0-4]):[03]0$/.test(String(v || ""));
const hm = iso => { try { return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Beirut", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso)).replace(/^24/, "00"); } catch { return ""; } };
const prevDay = d => new Date(Date.parse(d + "T12:00:00Z") - 864e5).toISOString().slice(0, 10);
const first = s => String(s || "").trim().split(/\s+/)[0] || "";

/* Daily deadlines shown on the timeline (Beirut time) */
export const DEADLINES = { amCheck: "11:00", pmCheck: "22:45", amHandover: "15:00", pmHandover: "22:50" };
const AM_FROM = "11:00", PM_FROM = "18:00";   // hand-overs 11:00–18:00 count as the AM hand-over, after 18:00 as the PM one (earlier ones are the night → morning hand-over)
/* Restroom windows when the Restroom system cannot be reached (same as Reminders) */
const RR_WINDOWS = [["Window 1", "10:00", "11:00"], ["Window 2", "12:30", "13:30"], ["Window 3", "14:30", "15:30"], ["Window 4", "16:30", "17:30"], ["Window 5", "18:30", "19:30"], ["Window 6", "20:30", "21:30"]];
const rrCache = new Map();   // site|day → { at, data }   (2 minutes)
async function restroomDay(d, env, site, day) {
  const k = site + "|" + day, hit = rrCache.get(k);
  if (hit && Date.now() - hit.at < 120000) return hit.data;
  const rr = await d.pullDay(env, "restroom", site, day).catch(() => ({ error: "Not reachable" }));
  let data;
  if (rr && !rr.error && Array.isArray(rr.windows)) {
    const rooms = rr.rooms || [];
    data = { rooms: rooms.length, windows: rr.windows.map((w, i) => {
      const t = String(w.display || "").match(/(\d{1,2}:\d{2})\D+(\d{1,2}:\d{2})/);
      const pad = x => x.padStart(5, "0");
      let ops = 0, ss = 0;
      for (const r of rooms) { const c = (rr.grid || {})[`${r.id}|${w.id}`] || {}; if (c.ops) ops++; if (c.usm) ss++; }
      return { label: w.label || `Window ${i + 1}`, from: t ? pad(t[1]) : (RR_WINDOWS[i] || [])[1] || "", to: t ? pad(t[2]) : (RR_WINDOWS[i] || [])[2] || "", state: w.state || "", ops, ss };
    }).filter(w => w.from && w.to) };
  } else data = { error: (rr && rr.error) || "Not reachable", rooms: 0, windows: RR_WINDOWS.map(([label, from, to]) => ({ label, from, to, state: "", ops: 0, ss: 0 })) };
  rrCache.set(k, { at: Date.now(), data });
  return data;
}

export async function todayRoute(env, d) {
  const { site, me } = d;
  if (!d.canSite(me, site)) throw Object.assign(new Error("No access to this flagship"), { status: 403 });
  const day = d.today(), yday = prevDay(day);
  const full = d.isFull(me);
  const seeCon = full || ["SUPERVISOR", "SECURITY", "MANAGER"].includes(me.role);
  const seeRR = full || ["SUPERVISOR", "MANAGER"].includes(me.role);

  const [staff, cells, hov, momToday, calToday, acts, cons, runs, restroom] = await Promise.all([
    d.schedStaff(env, site),
    env.DB.prepare("SELECT day, email, val FROM sched_cells WHERE site = ? AND day IN (?, ?)").bind(site, day, yday).all(),
    env.DB.prepare("SELECT id, day, status, created_name, submitted_at, received_by, received_at, handoffs FROM handovers WHERE site = ? AND day = ? ORDER BY id DESC LIMIT 1").bind(site, day).first(),
    env.DB.prepare("SELECT id, title, status FROM mom_meetings WHERE site = ? AND meet_date = ?").bind(site, day).all(),
    env.DB.prepare("SELECT id, kind, title, time_from, time_to, location, extra FROM cal_items WHERE site = ? AND deleted = 0 AND kind IN ('mom','ops','marketing') AND start_day <= ? AND (CASE WHEN end_day = '' THEN start_day ELSE end_day END) >= ?").bind(site, day, day).all().catch(() => ({ results: [] })),
    env.DB.prepare(`SELECT COUNT(*) AS n, SUM(CASE WHEN a.due != '' AND a.due < ? THEN 1 ELSE 0 END) AS late
      FROM mom_actions a JOIN mom_meetings m ON m.id = a.meeting_id WHERE a.site = ? AND m.status = 'published' AND a.status = 'Open'`).bind(day, site).first(),
    seeCon ? dayList(env, site, day, day).catch(() => []) : Promise.resolve(null),
    env.DB.prepare("SELECT form, status, submitted_at, submitted_name, created_name FROM form_runs WHERE site = ? AND day = ? AND form IN ('am','pm') ORDER BY id").bind(site, day).all().catch(() => ({ results: [] })),
    seeRR ? restroomDay(d, env, site, day) : Promise.resolve(null)
  ]);

  /* ----- shifts: today's cells, plus last night's shift that runs past midnight ----- */
  const C = new Map((cells.results || []).map(c => [c.day + "|" + c.email, c.val]));
  const shifts = [], off = [];
  for (const p of staff) {
    const v = C.get(day + "|" + p.email) || "";
    if (isShift(v)) { const [f, t] = v.split("-"); shifts.push({ name: p.name, first: first(p.name), email: p.email, pos: p.position, title: p.title || p.positionLabel, from: f, to: t <= f ? "24:00" : t, overnight: t <= f }); }
    else if (v) off.push({ name: p.name, code: v.split(/[\s:]/)[0] });
    const y = C.get(yday + "|" + p.email) || "";
    if (isShift(y)) { const [f, t] = y.split("-"); if (t <= f && t !== "00:00") shifts.push({ name: p.name, first: first(p.name), email: p.email, pos: p.position, title: p.title || p.positionLabel, from: "00:00", to: t, carry: true }); }
  }

  /* ----- handover of today: each hand-off with its time ----- */
  let handover = null;
  if (hov) {
    const L = JSON.parse(hov.handoffs || "[]");
    handover = { id: hov.id, status: hov.status, startedBy: hov.created_name || "",
      handoffs: L.map(h => ({ by: h.by, at: hm(h.at), receivedBy: h.receivedBy || "", receivedAt: h.receivedAt ? hm(h.receivedAt) : "" })),
      waiting: hov.status === "submitted" && !hov.received_by };
  }

  /* ----- reminders: AM / PM checklists and the two hand-overs, each with its deadline ----- */
  const ck = f => { const L = (runs.results || []).filter(r => r.form === f); const sub = L.find(r => r.status === "submitted");
    return sub ? { done: true, at: hm(sub.submitted_at), by: sub.submitted_name || sub.created_name || "" } : { done: false, started: L.length > 0, by: L.length ? L[0].created_name || "" : "" }; };
  const hs = handover ? handover.handoffs : [];
  const amH = [...hs].reverse().find(h => h.at && h.at >= AM_FROM && h.at < PM_FROM), pmH = [...hs].reverse().find(h => h.at && h.at >= PM_FROM);
  const hOut = h => h ? { done: true, at: h.at, by: h.by, receivedBy: h.receivedBy } : { done: false };
  const reminders = [
    { id: "amCheck", label: "AM Checklist", due: DEADLINES.amCheck, app: "form-am", ...ck("am") },
    { id: "amHandover", label: "AM Handover", due: DEADLINES.amHandover, app: "handover", ...hOut(amH) },
    { id: "pmCheck", label: "PM Checklist", due: DEADLINES.pmCheck, app: "form-pm", ...ck("pm") },
    { id: "pmHandover", label: "PM Handover", due: DEADLINES.pmHandover, app: "handover", ...hOut(pmH) }
  ];

  /* ----- meetings and events ----- */
  const items = (calToday.results || []).map(r => { let x = {}; try { x = JSON.parse(r.extra || "{}"); } catch {}
    return { kind: r.kind, title: r.title, from: r.time_from, to: r.time_to, location: r.location, cancelled: x.status === "Cancelled" }; })
    .filter(x => !x.cancelled);
  const meetings = items.filter(x => x.kind === "mom");
  for (const m of momToday.results || []) if (!meetings.some(x => x.title.toLowerCase() === m.title.toLowerCase())) meetings.push({ kind: "mom", title: m.title, from: "", to: "", status: m.status });

  return {
    site, siteName: d.siteName(site), day, now: d.hm(),
    shifts, off,
    handover, reminders, restroom,
    meetings, events: items.filter(x => x.kind !== "mom"),
    actions: { open: Number(acts && acts.n || 0), late: Number(acts && acts.late || 0) },
    contractors: cons && cons.map(v => ({ id: v.id, company: v.company || v.tenant, tenant: v.tenant, work: v.work, from: v.timeFrom, to: v.timeTo,
      state: v.state, overdue: v.overdue, late: v.late, workers: v.workers, inAt: v.inAt ? hm(v.inAt) : "", outAt: v.outAt ? hm(v.outAt) : "" })),
    sites: d.sites
  };
}
