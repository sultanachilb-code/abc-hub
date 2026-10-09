/* =====================================================================
   SECURITY PATROL — QR checkpoints in the back areas, scanned on every round.
   • The operations team names the checkpoints and prints their QR stickers; the rounds (default two a day) have a time window.
   • Guards use ONE shared link per flagship (/patrol/<key>) on any phone — no account, no set-up.
     The page works without signal: the checkpoints are kept on the phone, each scan is saved with its time and photo
     and sent when the signal is back. The link can be replaced at any time (the old one stops at once).
   • Each checkpoint: "All clear" or "Report issue" with Arabic quick choices, a photo and a note.
   • Every entry reaches the hub bell (issues as alerts); at the end of each round a report goes to the bell and by email.
   Tables : patrol_points · patrol_scans · patrol_photos (+ meta patrol:cfg:<site>)
   Routes : /api/ops/patrol/*   ·   guards: /api/patrol-ext/<key>/pack · sync      Pages : /tools/patrol · /patrol/<key>
   See docs/FEATURE-security-patrol.md
   ===================================================================== */
const err = (m, status = 400) => Object.assign(new Error(m), { status });
const clip = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const isDay = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));
const A = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
const rnd = n => [...crypto.getRandomValues(new Uint8Array(n))].map(x => A[x % A.length]).join("");
const PHOTO_MAX = 260000;
const beirut = iso => { const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Beirut", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
  .formatToParts(new Date(iso)).map(x => [x.type, x.value])); return { day: `${p.year}-${p.month}-${p.day}`, time: `${p.hour === "24" ? "00" : p.hour}:${p.minute}` }; };
const mins = t => { const [h, m] = String(t || "0:0").split(":").map(Number); return h * 60 + (m || 0); };

/* the Arabic quick choices on the guard's phone (English for the hub and the report) */
export const PATROL_ISSUES = [
  ["corridor", "سد الممر", "Corridor blocked"],
  ["storage", "تخزين في الممر", "Storage in the corridor"],
  ["cartons", "كرتون غير مطوي في الحاويات", "Cartons not folded in the bins"],
  ["garbage", "نفايات خارج الحاويات", "Garbage outside the bins"],
  ["exitDoor", "باب طوارئ مفتوح", "Emergency door left open"],
  ["exitBlocked", "مخرج طوارئ مسدود", "Emergency exit blocked"],
  ["fire", "طفاية حريق مفقودة أو مسدودة", "Fire extinguisher missing / blocked"],
  ["leak", "تسرب مياه", "Water leak"],
  ["light", "إنارة معطلة", "Lighting out"],
  ["smoking", "تدخين", "Smoking"],
  ["person", "شخص غير مصرح له", "Unauthorised person"],
  ["clean", "نظافة / رائحة كريهة", "Cleanliness / bad smell"],
  ["damage", "ضرر أو كسر", "Damage / broken"],
  ["other", "أخرى", "Other"]
];
const ISSUE_EN = Object.fromEntries(PATROL_ISSUES.map(x => [x[0], x[2]]));
export const DEFAULT_ROUNDS = [{ name: "Round 1", from: "10:00", to: "14:00" }, { name: "Round 2", from: "18:00", to: "22:00" }];

export async function patrolSchema(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS patrol_points (id INTEGER PRIMARY KEY AUTOINCREMENT, site TEXT NOT NULL, token TEXT NOT NULL, label TEXT NOT NULL,
      area TEXT NOT NULL DEFAULT '', level TEXT NOT NULL DEFAULT '', seq INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, created_at TEXT, created_name TEXT)`),
    env.DB.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS patrol_points_token ON patrol_points (token)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS patrol_scans (id INTEGER PRIMARY KEY AUTOINCREMENT, site TEXT NOT NULL, day TEXT NOT NULL, at TEXT NOT NULL, round INTEGER NOT NULL DEFAULT -1,
      point_id INTEGER NOT NULL, guard TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'clear', issues TEXT NOT NULL DEFAULT '[]', note TEXT NOT NULL DEFAULT '',
      manual INTEGER NOT NULL DEFAULT 0, has_photo INTEGER NOT NULL DEFAULT 0, client_id TEXT NOT NULL DEFAULT '', synced_at TEXT NOT NULL DEFAULT '')`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS patrol_scans_day ON patrol_scans (site, day)`),
    env.DB.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS patrol_scans_client ON patrol_scans (site, client_id) WHERE client_id != ''`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS patrol_photos (scan_id INTEGER PRIMARY KEY, data TEXT NOT NULL)`)
  ]);
}

/* settings of a flagship: the rounds and the guards' link key */
export async function patrolCfg(env, site, create = true) {
  const r = await env.DB.prepare("SELECT v FROM meta WHERE k = ?").bind("patrol:cfg:" + site).first();
  let c = null; try { c = r ? JSON.parse(r.v) : null; } catch {}
  if (!c && create) { c = { rounds: DEFAULT_ROUNDS, key: rnd(24) }; await saveCfg(env, site, c); }
  return c || { rounds: DEFAULT_ROUNDS, key: "" };
}
const saveCfg = (env, site, c) => env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)").bind("patrol:cfg:" + site, JSON.stringify(c)).run();
const roundOf = (rounds, hm) => rounds.findIndex(r => mins(hm) >= mins(r.from) && mins(hm) <= mins(r.to));
const pointOut = r => ({ id: r.id, token: r.token, label: r.label, area: r.area, level: r.level, seq: r.seq, active: !!r.active, qr: "ABCPATROL:" + r.token });

/* one day at one flagship: every checkpoint × every round, with the scans */
export async function patrolDay(env, site, day) {
  const cfg = await patrolCfg(env, site, false);
  const [pts, sc] = await Promise.all([
    env.DB.prepare("SELECT * FROM patrol_points WHERE site = ? AND active = 1 ORDER BY seq, id").bind(site).all(),
    env.DB.prepare("SELECT * FROM patrol_scans WHERE site = ? AND day = ? ORDER BY at").bind(site, day).all()
  ]);
  const points = (pts.results || []).map(pointOut);
  const scans = (sc.results || []).map(s => ({ id: s.id, at: s.at, hm: beirut(s.at).time, round: s.round, pointId: s.point_id, guard: s.guard, status: s.status,
    issues: JSON.parse(s.issues || "[]"), issuesEn: JSON.parse(s.issues || "[]").map(k => ISSUE_EN[k] || k), note: s.note, manual: !!s.manual, photo: !!s.has_photo, syncedAt: s.synced_at }));
  const rounds = cfg.rounds.map((r, i) => {
    const mine = scans.filter(s => s.round === i);
    const done = points.filter(p => mine.some(s => s.pointId === p.id)).length;
    return { ...r, i, done, total: points.length, issues: mine.filter(s => s.status === "issue").length, guards: [...new Set(mine.map(s => s.guard).filter(Boolean))] };
  });
  return { day, rounds, points, scans, extra: scans.filter(s => s.round < 0).length };
}

/* hub side (signed in): the day, the checkpoints, the rounds and the link */
export async function patrolRoute(env, p, method, b, url, d) {
  const { site, me, can } = d;
  if (!d.canSite(me, site)) throw err("No access to this flagship", 403);
  const lead = !!(can.team);   // the operations team manages checkpoints, rounds and the link (security sees the reports)
  const seeing = lead || me.role === "SECURITY" || d.full;
  if (!seeing) throw err("Only the operations team and security see the patrol", 403);

  if (p === "patrol/day" && method === "GET") {
    const day = isDay(url.searchParams.get("day")) ? url.searchParams.get("day") : d.today();
    const cfg = await patrolCfg(env, site);
    return { site, siteName: d.siteName(site), today: d.today(), lead, issues: PATROL_ISSUES, link: lead ? `${d.hubUrl}/patrol/${cfg.key}` : "", ...(await patrolDay(env, site, day)) };
  }
  if (p === "patrol/photo" && method === "GET") {
    const r = await env.DB.prepare("SELECT ph.data FROM patrol_photos ph JOIN patrol_scans s ON s.id = ph.scan_id WHERE ph.scan_id = ? AND s.site = ?").bind(Number(url.searchParams.get("id")) || 0, site).first();
    if (!r) throw err("Photo not found", 404);
    return { data: r.data };
  }
  if (method !== "POST") throw err("Unknown request", 404);
  if (!lead) throw err("Only the operations team changes the patrol set-up", 403);

  if (p === "patrol/point") {
    const label = clip(b.label, 80); if (!label) throw err("Name the checkpoint, e.g. Service corridor B — door 3");
    const id = Number(b.id) || 0;
    if (id) await env.DB.prepare("UPDATE patrol_points SET label = ?, area = ?, level = ?, seq = ?, active = ? WHERE id = ? AND site = ?")
      .bind(label, clip(b.area, 60), clip(b.level, 20), Number(b.seq) || 0, b.active === false ? 0 : 1, id, site).run();
    else await env.DB.prepare("INSERT INTO patrol_points (site, token, label, area, level, seq, created_at, created_name) VALUES (?,?,?,?,?,?,?,?)")
      .bind(site, rnd(12), label, clip(b.area, 60), clip(b.level, 20), Number(b.seq) || 0, d.now(), me.full_name).run();
    return patrolDay(env, site, d.today());
  }
  if (p === "patrol/rounds") {
    const rounds = (Array.isArray(b.rounds) ? b.rounds : []).slice(0, 6).map((r, i) => ({ name: clip(r.name, 30) || `Round ${i + 1}`, from: HM.test(r.from) ? r.from : "", to: HM.test(r.to) ? r.to : "" }))
      .filter(r => r.from && r.to && mins(r.to) > mins(r.from));
    if (!rounds.length) throw err("Add at least one round with a start and an end time");
    const cfg = await patrolCfg(env, site); cfg.rounds = rounds.sort((a, c) => mins(a.from) - mins(c.from)); await saveCfg(env, site, cfg);
    return { rounds: cfg.rounds };
  }
  if (p === "patrol/newlink") {   // the old link stops at once (lost or shared phone)
    const cfg = await patrolCfg(env, site); cfg.key = rnd(24); await saveCfg(env, site, cfg);
    await d.raiseEvent(env, { site, app: "patrol", tone: "info", title: "Security Patrol link replaced", body: `The old link no longer works · by ${me.full_name}` }).catch(() => {});
    return { link: `${d.hubUrl}/patrol/${cfg.key}` };
  }
  throw err("Unknown request", 404);
}

/* the guards' link: /api/patrol-ext/<key>/pack (checkpoints for offline use) · /sync (the scans saved on the phone) */
async function siteOfKey(env, key) {
  if (!/^[A-Za-z0-9]{24}$/.test(key)) return null;
  const { results } = await env.DB.prepare("SELECT k, v FROM meta WHERE k LIKE 'patrol:cfg:%'").all();
  for (const r of results || []) { try { const c = JSON.parse(r.v); if (c.key && c.key.length === key.length) { let x = 0; for (let i = 0; i < key.length; i++) x |= key.charCodeAt(i) ^ c.key.charCodeAt(i); if (!x) return { site: r.k.slice(11), cfg: c }; } } catch {} }
  return null;
}
export async function patrolPublic(env, path, method, b, d) {
  const [key, what] = path.split("/");
  const hit = await siteOfKey(env, key);
  if (!hit) throw err("This patrol link is no longer valid — ask the operations team for the new link", 403);
  const { site, cfg } = hit;
  if (what === "pack" && method === "GET") {
    const day = d.today();
    const P = await patrolDay(env, site, day);
    return { site, siteName: d.siteName(site), day, serverNow: new Date().toISOString(), rounds: cfg.rounds, issues: PATROL_ISSUES,
      points: P.points.map(x => ({ id: x.id, token: x.token, label: x.label, area: x.area, level: x.level })),
      done: P.scans.map(s => ({ pointId: s.pointId, round: s.round, hm: s.hm, status: s.status })) };
  }
  if (what === "sync" && method === "POST") {
    const list = (Array.isArray(b.scans) ? b.scans : []).slice(0, 60);
    const pts = new Map(((await env.DB.prepare("SELECT id, label, area FROM patrol_points WHERE site = ?").bind(site).all()).results || []).map(r => [r.id, r]));
    const saved = [], fresh = [];
    for (const s of list) {
      const cid = clip(s.clientId, 40); if (!cid) continue;
      const pt = pts.get(Number(s.pointId)); if (!pt) { saved.push(cid); continue; }   // checkpoint removed since: drop it
      const dup = await env.DB.prepare("SELECT id FROM patrol_scans WHERE site = ? AND client_id = ?").bind(site, cid).first();
      if (dup) { saved.push(cid); continue; }
      let at = new Date(String(s.at || "")); if (isNaN(at) || at > Date.now() + 5 * 60000 || Date.now() - at > 4 * 864e5) at = new Date();   // the time on the phone, within reason
      const w = beirut(at.toISOString());
      const issues = (Array.isArray(s.issues) ? s.issues : []).filter(k => ISSUE_EN[k]).slice(0, 10);
      const status = s.status === "issue" || issues.length ? "issue" : "clear";
      const photo = typeof s.photo === "string" && s.photo.startsWith("data:image/") && s.photo.length <= PHOTO_MAX ? s.photo : "";
      const r = await env.DB.prepare(`INSERT INTO patrol_scans (site, day, at, round, point_id, guard, status, issues, note, manual, has_photo, client_id, synced_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(site, w.day, at.toISOString(), roundOf(cfg.rounds, w.time), pt.id, clip(s.guard, 60), status, JSON.stringify(issues), clip(s.note, 400), s.manual ? 1 : 0, photo ? 1 : 0, cid, new Date().toISOString()).run();
      if (photo) await env.DB.prepare("INSERT OR REPLACE INTO patrol_photos (scan_id, data) VALUES (?, ?)").bind(r.meta.last_row_id, photo).run();
      saved.push(cid); fresh.push({ pt, status, issues, note: clip(s.note, 120), guard: clip(s.guard, 60), hm: w.time, round: roundOf(cfg.rounds, w.time) });
    }
    /* the hub bell: one line per issue (alert), the all-clear ones together */
    for (const f of fresh.filter(x => x.status === "issue"))
      await d.raiseEvent(env, { site, app: "patrol", tone: "warn", title: `Patrol issue · ${f.pt.label}`,
        body: `${f.issues.map(k => ISSUE_EN[k]).join(", ") || "Issue"}${f.note ? " — " + f.note : ""} · ${f.guard || "Guard"} at ${f.hm}` }).catch(() => {});
    const ok = fresh.filter(x => x.status === "clear");
    if (ok.length) await d.raiseEvent(env, { site, app: "patrol", tone: "info", title: ok.length === 1 ? `Patrol · ${ok[0].pt.label} all clear` : `Patrol · ${ok.length} checkpoints all clear`,
      body: `${[...new Set(ok.map(x => x.guard).filter(Boolean))].join(", ") || "Guard"} · ${ok.map(x => x.hm).sort()[0]}${ok.length > 1 ? "–" + ok.map(x => x.hm).sort().pop() : ""}` }).catch(() => {});
    return { saved };
  }
  throw err("Unknown request", 404);
}

/* cron: 30 minutes after each round ends, once — the round report to the bell and by email */
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export function roundEmailHtml(siteName, day, R, P, hubUrl) {
  const mine = P.scans.filter(s => s.round === R.i);
  const rows = P.points.map(pt => { const L = mine.filter(s => s.pointId === pt.id); const last = L[L.length - 1];
    return `<tr><td style="padding:6px 8px;border-bottom:1px solid #EEE9F4">${esc(pt.label)}<br><small style="color:#6D6479">${esc([pt.level, pt.area].filter(Boolean).join(" · "))}</small></td>
      <td style="padding:6px 8px;border-bottom:1px solid #EEE9F4;${!L.length ? "color:#C0392B;font-weight:700" : last.status === "issue" ? "color:#B5740F;font-weight:700" : "color:#1E7B45"}">${!L.length ? "Missed" : last.status === "issue" ? "Issue · " + esc(last.issuesEn.join(", ")) + (last.note ? " — " + esc(last.note) : "") : "All clear"}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #EEE9F4;color:#6D6479">${L.length ? esc(last.hm) + " · " + esc(last.guard) : "—"}</td></tr>`; }).join("");
  return `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:680px;margin:0 auto;color:#221A2E">
    <div style="background:#2A0F45;color:#fff;padding:16px 20px;border-radius:14px 14px 0 0"><div style="font-size:12px;opacity:.75;text-transform:uppercase;letter-spacing:.08em">Security Patrol · ${esc(siteName)}</div>
    <div style="font-size:19px;font-weight:700;margin-top:4px">${esc(R.name)} ${esc(R.from)}–${esc(R.to)} · ${R.done}/${R.total} checked · ${R.total - R.done} missed · ${R.issues} issue${R.issues === 1 ? "" : "s"}</div><div style="font-size:13px;opacity:.8">${esc(day)}</div></div>
    <div style="border:1px solid #E3DCEC;border-top:0;border-radius:0 0 14px 14px;padding:10px 14px 16px"><table style="border-collapse:collapse;width:100%;font-size:13px">${rows}</table>
    <p style="font-size:12px;color:#6D6479">Scans sent later from a phone without signal are added to the day in the hub.</p>
    <a href="${esc(hubUrl)}/#/app/patrol" style="display:inline-block;background:#4A1F73;color:#fff;text-decoration:none;padding:10px 16px;border-radius:10px;font-weight:700;font-size:14px">Open Security Patrol</a></div></div>`;
}
export async function patrolRun(env, d) {
  const now = beirut(new Date().toISOString());
  const { results } = await env.DB.prepare("SELECT k, v FROM meta WHERE k LIKE 'patrol:cfg:%'").all().catch(() => ({ results: [] }));
  for (const r of results || []) {
    let cfg; try { cfg = JSON.parse(r.v); } catch { continue; }
    const site = r.k.slice(11);
    for (const [i, R] of (cfg.rounds || []).entries()) {
      const due = mins(R.to) + 30;
      if (mins(now.time) < due || mins(now.time) > due + 120) continue;
      const claim = await env.DB.prepare("INSERT OR IGNORE INTO meta (k, v) VALUES (?, ?)").bind(`patrol:rep:${site}:${now.day}:${i}`, new Date().toISOString()).run();
      if (!claim.meta || claim.meta.changes !== 1) continue;
      const P = await patrolDay(env, site, now.day);
      if (!P.points.length) continue;
      const X = P.rounds[i];
      await d.raiseEvent(env, { site, app: "patrol", tone: X.done < X.total || X.issues ? "warn" : "ok",
        title: `Patrol ${X.name} report · ${X.done}/${X.total} checked`, body: `${X.total - X.done} missed · ${X.issues} issue${X.issues === 1 ? "" : "s"}${X.guards.length ? " · " + X.guards.join(", ") : ""}` }).catch(() => {});
      const to = await d.recipients(env, site).catch(() => []);
      if (to.length && env.MAIL_RELAY_URL) await d.relay(env, { to, subject: `Security Patrol · ${d.siteName(site)} · ${X.name} · ${X.done}/${X.total} checked${X.issues ? ` · ${X.issues} issue${X.issues === 1 ? "" : "s"}` : ""}`,
        html: roundEmailHtml(d.siteName(site), now.day, X, P, d.hubUrl) }).catch(() => {});
    }
  }
}
