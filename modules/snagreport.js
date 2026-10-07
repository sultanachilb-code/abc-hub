/* =====================================================================
   SNAGLIST CONSOLIDATED REPORT — all five flagships in one view, from the Snaglist Manager
   (GET <snaglist>/api?hubreport=1&from=&to= with the HUB_KEY): findings added / solved in the period, open now by status,
   site visits posted / closed / open (over 2 days), oldest open findings and busiest locations per flagship.
   A page in the hub (Inspections › Snaglist Report) and an email every Monday to management and leadership.
   See docs/FEATURE-snaglist-report.md
   ===================================================================== */
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const addDays = (d, n) => new Date(Date.parse(d + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);

export async function snagReport(env, base, from, to) {
  if (!env.HUB_KEY) throw Object.assign(new Error("HUB_KEY is not set on the hub"), { status: 503 });
  const r = await fetch(`${base}/api?hubreport=1&from=${from}&to=${to}`, { headers: { "x-hub-key": env.HUB_KEY }, signal: AbortSignal.timeout(10000) });
  const j = await r.json().catch(() => null);
  if (!j || !j.ok) throw Object.assign(new Error(j && j.error ? `Snaglist: ${j.error}` : `Snaglist is not reachable (HTTP ${r.status}) — deploy the latest Snaglist (hubreport)`), { status: 502 });
  return j.data;
}
export function snagTotals(R) {
  const t = { open: 0, added: 0, solved: 0, posted: 0, closed: 0, visitsOpen: 0, late: 0 };
  for (const s of R.sites) { t.open += s.openTotal; t.added += s.added; t.solved += s.solved; t.posted += s.visits.posted; t.closed += s.visits.closed; t.visitsOpen += s.visits.openNow; t.late += s.visits.late; }
  return t;
}
export function snagEmailHtml(R, hubUrl) {
  const t = snagTotals(R), F = "font-family:Segoe UI,Arial,sans-serif;", th = `style="${F}text-align:right;padding:6px 8px;border-bottom:2px solid #4A1F73;font-size:12px;color:#6D6479"`;
  const td = (v, warn) => `<td style="${F}text-align:right;padding:6px 8px;border-bottom:1px solid #EEE9F4;font-size:13px;${warn ? "color:#C0392B;font-weight:700" : ""}">${v}</td>`;
  const fmt = d => new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return `<div style="${F}max-width:720px;margin:0 auto;color:#221A2E">
    <div style="background:#2A0F45;color:#fff;padding:18px 22px;border-radius:14px 14px 0 0"><div style="font-size:12px;opacity:.75;letter-spacing:.08em;text-transform:uppercase">Snaglist · all flagships</div>
      <div style="font-size:20px;font-weight:700;margin-top:4px">${t.open} findings open · ${t.solved} solved this week</div><div style="font-size:13px;opacity:.8">${fmt(R.from)} – ${fmt(R.to)}</div></div>
    <div style="border:1px solid #E3DCEC;border-top:0;border-radius:0 0 14px 14px;padding:12px 18px 18px">
    <table style="border-collapse:collapse;width:100%"><tr><th style="${F}text-align:left;padding:6px 8px;border-bottom:2px solid #4A1F73;font-size:12px;color:#6D6479">Flagship</th>
      <th ${th}>Open now</th><th ${th}>Added</th><th ${th}>Solved</th><th ${th}>Visits posted</th><th ${th}>Visits open</th><th ${th}>Open &gt; 2 days</th></tr>
    ${R.sites.map(s => `<tr><td style="${F}padding:6px 8px;border-bottom:1px solid #EEE9F4;font-size:13px;font-weight:600">${esc(s.siteName)}</td>${td(s.openTotal)}${td(s.added)}${td(s.solved)}${td(s.visits.posted)}${td(s.visits.openNow)}${td(s.visits.late, s.visits.late > 0)}</tr>`).join("")}
    </table>
    ${R.sites.filter(s => s.oldest.length).map(s => `<div style="margin-top:14px;font-size:12px;font-weight:700;color:#6D6479;text-transform:uppercase;letter-spacing:.06em">${esc(s.siteName)} · oldest open</div>
      ${s.oldest.slice(0, 3).map(o => `<div style="font-size:13px;padding:5px 0;border-bottom:1px solid #EEE9F4"><b>${esc(o.location || "—")}</b> — ${esc(o.issue)} <span style="color:#C0392B">· ${o.days} days · ${esc(o.status)}</span></div>`).join("")}`).join("")}
    <div style="margin-top:18px"><a href="${esc(hubUrl)}/#/app/snagreport" style="display:inline-block;background:#4A1F73;color:#fff;text-decoration:none;padding:10px 16px;border-radius:10px;font-weight:700;font-size:14px">Open the Snaglist report</a></div></div></div>`;
}

/* cron: Monday from 08:00 Beirut — the last 7 days, once a week, to management and leadership with the morning email on */
export async function snagReportRun(env, d) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Beirut", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", weekday: "short", hour12: false })
    .formatToParts(new Date()).map(x => [x.type, x.value]));
  const day = `${p.year}-${p.month}-${p.day}`, hour = Number(p.hour) % 24;
  if (p.weekday !== "Mon" || hour < 8 || hour > 11 || !env.MAIL_RELAY_URL || !env.HUB_KEY) return { sent: false };
  const k = `snagreport:${day}`;
  const r0 = await env.DB.prepare("INSERT OR IGNORE INTO meta (k, v) VALUES (?, ?)").bind(k, new Date().toISOString()).run();
  if (!(r0.meta && r0.meta.changes === 1)) return { sent: false };
  const R = await snagReport(env, d.base, addDays(day, -7), addDays(day, -1)).catch(() => null);
  if (!R) return { sent: false };
  const { results } = await env.DB.prepare("SELECT email FROM users WHERE active = 1 AND morning_email = 1 AND role IN ('ADMIN','ADVISOR','DIRECTOR','CDSO','MANAGER')").all();
  const to = (results || []).map(u => u.email);
  if (!to.length) return { sent: false };
  const t = snagTotals(R);
  await d.relay(env, { to, subject: `Snaglist weekly · ${t.open} open · ${t.solved} solved · all flagships`, html: snagEmailHtml(R, d.hubUrl) });
  return { sent: true, to: to.length };
}
