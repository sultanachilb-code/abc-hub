/* =====================================================================
   AUTOMATION — feature module (kept separate so it can be removed cleanly)
   See docs/FEATURE-automation.md

   • End of Day email ... every night from 23:30 Beirut, one email per flagship to its management and leadership
                          (people with "Receive the morning brief and End of Day report" ticked in People & roles)
   • Daily snapshot ..... at the same time, the day's figures are kept in daily_stats (used by the leadership dashboards)
   • Weekly backup ...... every Sunday from 03:00 Beirut, all hub data as a compressed JSON file emailed to the administrators
                          (password hashes and the mall-plan images are left out). Admins can also download it any time.

   Tables : daily_stats
   ===================================================================== */

const pad = n => String(n).padStart(2, "0");
function beirut(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Beirut", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false }).formatToParts(d).map(x => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24, minute: Number(p.minute), weekday: p.weekday };
}
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export async function automationSchema(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS daily_stats (site TEXT NOT NULL, day TEXT NOT NULL, data TEXT NOT NULL, at TEXT, PRIMARY KEY (site, day))`).run();
}
async function claim(env, key) {
  const r = await env.DB.prepare("INSERT OR IGNORE INTO meta (k, v) VALUES (?, ?)").bind(key, new Date().toISOString()).run();
  return r.meta && r.meta.changes === 1;
}

/* the day's figures, small enough to keep for years */
export function snapshotOf(R) {
  const rt = R.restroom && !R.restroom.error ? R.restroom.totals : null;
  const inc = R.incidents && !R.incidents.error ? R.incidents : null;
  const ck = r => r ? { status: r.status, done: r.done, total: r.total, issues: r.issues, findings: (r.findings || []).map(f => `${f.area} ${f.task}`.slice(0, 160)) } : null;
  const hos = R.handovers || [];
  return {
    restroom: rt ? { done: rt.done, missed: rt.missed, expected: rt.expectedDay, issues: rt.issues } : null,
    incidents: inc ? { count: inc.incidents.length, pirs: inc.pirs.length, overdue: inc.pirs.filter(p => p.overdue).length } : null,
    am: ck(R.checklists && R.checklists.am), pm: ck(R.checklists && R.checklists.pm),
    dbank: R.dbank ? { done: R.dbank.today.some(r => r.status === "submitted"), issues: R.dbank.today.reduce((a, r) => a + r.issues, 0) } : null,
    handoffs: hos.reduce((a, h) => a + (h.handoffs || []).length, 0), received: hos.reduce((a, h) => a + (h.handoffs || []).filter(x => x.receivedBy).length, 0),
    hoTasks: (R.handoverTasks || []).length, hoTasksDone: (R.handoverTasks || []).filter(t => t.done).length,
    feedback: (R.feedback || []).length, feedbackViolations: (R.feedback || []).filter(f => f.category !== "Customer Feedback").length,
    opened: (R.tenants && R.tenants.opened || []).length, closed: (R.tenants && R.tenants.closed || []).length,
    staff: R.schedule ? R.schedule.headcount : 0, occupancy: R.gla ? R.gla.occupancy : null,
    snags: R.snaglist && !R.snaglist.error ? R.snaglist.total : null
  };
}

/* ---------- End of Day email (Outlook-friendly HTML) ---------- */
export function eodEmailHtml(R, hubUrl) {
  const F = "font-family:Calibri,Arial,sans-serif;";
  const box = (title, inner) => `<tr><td style="${F}background:#8EAADB;color:#10203F;font-weight:bold;font-size:15px;padding:6px 10px">${title}</td></tr><tr><td style="${F}font-size:14px;padding:8px 10px;color:#222">${inner}</td></tr>`;
  const li = a => a.length ? `<ul style="margin:0;padding-left:20px">${a.map(x => `<li style="margin:2px 0">${x}</li>`).join("")}</ul>` : `<span style="color:#777">None.</span>`;
  const ok = (t, c) => `<b style="color:${c}">${t}</b>`;
  const rr = R.restroom && !R.restroom.error ? R.restroom : null, rt = rr ? rr.totals : null;
  const inc = R.incidents && !R.incidents.error ? R.incidents : null;
  const ck = (label, r) => !r ? `${label}: ${ok("Not done", "#C0392B")}` : r.status === "submitted"
    ? `${label}: ${ok("Done", "#2E8B57")} by ${esc(r.by)}${r.issues ? ` · ${r.issues} ✗: ${esc(r.findings.map(f => f.task || f.area).slice(0, 4).join("; "))}` : ""}${r.comments ? `<br><i>“${esc(r.comments.slice(0, 400))}”</i>` : ""}`
    : `${label}: ${ok(`In progress ${r.done}/${r.total}`, "#C07A12")} by ${esc(r.by)}`;
  const kpi = (v, l, c) => `<td style="${F}padding:8px;text-align:center;border:1px solid #E3DCEC"><div style="font-size:20px;font-weight:bold;color:${c || "#2A0F45"}">${v}</div><div style="font-size:11px;color:#6D6479">${l}</div></td>`;
  const hoT = R.handoverTasks || [];
  const T = R.tenants || {};
  const ann = (T.announcements || []).map(a => `${esc(a.typeName)} · <b>${esc(a.brand)}</b> (effective ${esc(a.eff_date)})`);
  const opened = (T.opened || []).map(u => `Opened · <b>${esc(u.brand)}</b> ${esc(u.level)} ${esc(u.code)}`), closed = (T.closed || []).map(u => `Closed · <b>${esc(u.brand)}</b> ${esc(u.level)} ${esc(u.code)}`);
  return `<div style="${F}">
  <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;max-width:820px;border:1px solid #2F3B52">
    <tr><td style="${F}background:#2A0F45;color:#fff;font-weight:bold;font-size:17px;padding:10px">End of Day Report — ABC ${esc(R.siteName)} — ${esc(R.date)}</td></tr>
    <tr><td style="padding:0"><table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%"><tr>
      ${kpi(rt ? `${rt.done}/${rt.expectedDay}` : "—", "Restroom checks", rt && rt.missed ? "#C0392B" : "#2E8B57")}
      ${kpi(inc ? inc.incidents.length : "—", "Incidents", inc && inc.incidents.length ? "#C07A12" : "#2A0F45")}
      ${kpi(R.checklists.am && R.checklists.am.status === "submitted" ? "✓" : "✗", "AM checklist", R.checklists.am && R.checklists.am.status === "submitted" ? "#2E8B57" : "#C0392B")}
      ${kpi(R.checklists.pm && R.checklists.pm.status === "submitted" ? "✓" : "✗", "PM checklist", R.checklists.pm && R.checklists.pm.status === "submitted" ? "#2E8B57" : "#C0392B")}
      ${kpi(R.feedback.length, "Tenant feedback")}
      ${kpi(R.gla ? Math.round(R.gla.occupancy * 1000) / 10 + "%" : "—", "Occupancy")}
    </tr></table></td></tr>
    ${box("Restroom inspections", rt ? `${rt.done} done · ${rt.missed} missed · ${rt.issues} issue${rt.issues === 1 ? "" : "s"} reported${rr.windows ? "<br>" + rr.windows.map(w => {
      let o = 0, s = 0; for (const r of rr.rooms || []) { const c = (rr.grid || {})[`${r.id}|${w.id}`] || {}; if (c.ops) o++; if (c.usm) s++; }
      return `${esc(w.label)} ${esc(w.display || "")}: OPS ${o}/${(rr.rooms || []).length} · S.S ${s}/${(rr.rooms || []).length}`; }).join("<br>") : ""}` : `<span style="color:#777">Not available.</span>`)}
    ${box("AM &amp; PM checklists", `${ck("AM checklist", R.checklists.am)}<br>${ck("PM checklist", R.checklists.pm)}`)}
    ${box("Incidents", inc ? li(inc.incidents.map(i => `<b>${esc(i.severity)}</b> · ${esc(i.type)} · ${esc(i.status)}${i.time ? " · " + esc(i.time) : ""}`)) + (inc.pirs.length ? `<br>${inc.pirs.length} post-incident report${inc.pirs.length === 1 ? "" : "s"} pending${inc.pirs.some(p => p.overdue) ? " — some overdue" : ""}` : "") : `<span style="color:#777">Not available.</span>`)}
    ${box("Shift handover", `${(R.handovers || []).map(h => (h.handoffs || []).map(x => `${esc(x.by)} → ${x.receivedBy ? esc(x.receivedBy) : "<b style='color:#C0392B'>not received</b>"}`).join(" · ")).filter(Boolean).join("<br>") || "No hand-off recorded."}
      ${hoT.length ? `<br>Tasks for the day: <b>${hoT.filter(t => t.done).length}/${hoT.length}</b> done${hoT.some(t => !t.done) ? li(hoT.filter(t => !t.done).map(t => esc(t.text))) : ""}` : ""}`)}
    ${box("Tenants", li([...ann, ...opened, ...closed]))}
    ${box("Tenant feedback", li(R.feedback.map(f => `<b>${esc(f.tenant)}</b> · ${esc(f.category)}${f.description ? " — " + esc(f.description) : ""} · ${esc(f.action)}`)))}
    ${box("Direct banking tour", R.dbank.today.length ? li(R.dbank.today.map(r => `${r.status === "submitted" ? "Done" : "In progress"} by ${esc(r.by)} · ${r.issues} finding${r.issues === 1 ? "" : "s"}${r.findings.length ? ": " + esc(r.findings.map(f => `${f.task} (${f.remark || "✗"})`).slice(0, 6).join("; ")) : ""}`)) : `Not done today.${R.dbank.last ? ` Last tour ${esc(R.dbank.last.day)}.` : ""}`)}
    ${box("Team on shift", `${R.schedule.headcount} on shift${R.schedule.shifts.length ? ": " + R.schedule.shifts.map(s => `${esc(s.name)} ${esc(s.start)}–${esc(s.end)}`).join(" · ") : ""}`)}
    <tr><td style="${F}padding:12px 10px;font-size:13px"><a href="${hubUrl}/#/app/eod" style="color:#4A1F73;font-weight:bold">Open the full report in the Operations Hub</a></td></tr>
  </table><p style="${F}font-size:11px;color:#888">Sent automatically by the ABC Operations Hub at 23:30. To stop receiving it, ask the administrator to untick the report in People &amp; roles.</p></div>`;
}

/* ---------- backup ---------- */
const SKIP_TABLES = new Set(["layout_images", "user_photos", "site_covers", "usage_log", "hub_events", "reminder_runs", "_cf_KV", "d1_migrations"]);
export async function backupData(env) {
  const { results } = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").all();
  const out = { hub: "ABC Operations Hub", at: new Date().toISOString(), tables: {} };
  for (const { name } of results || []) {
    if (SKIP_TABLES.has(name)) continue;
    const rows = (await env.DB.prepare(`SELECT * FROM "${name}"`).all()).results || [];
    out.tables[name] = name === "users" ? rows.map(({ salt, hash, iterations, ...u }) => u) : name === "meta" ? rows.filter(r => r.k !== "vapid") : rows;
  }
  return out;
}
export async function gzipBase64(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  const buf = new Uint8Array(await new Response(stream).arrayBuffer());
  let bin = ""; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return { base64: btoa(bin), bytes: buf.length };
}

/* ---------- cron entry (every 2 minutes) ----------
   deps = { SITES, eodReport, relay, hubUrl, canSite, isFull } */
export async function automationRun(env, deps, now = new Date()) {
  const t = beirut(now), out = { eod: 0, backup: false };
  if (t.hour === 23 && t.minute >= 30) {
    const { results } = await env.DB.prepare("SELECT * FROM users WHERE active = 1 AND morning_email = 1").all();
    const people = (results || []).filter(u => deps.isFull(u));
    for (const site of Object.keys(deps.SITES)) {
      if (!(await claim(env, `eod:${t.day}:${site}`))) continue;
      const R = await deps.eodReport(env, { role: "ADMIN", position: "", email: "" }, site, t.day);
      await env.DB.prepare("INSERT OR REPLACE INTO daily_stats (site, day, data, at) VALUES (?,?,?,?)").bind(site, t.day, JSON.stringify(snapshotOf(R)), now.toISOString()).run();
      const to = people.filter(u => deps.canSite(u, site)).map(u => u.email);
      if (to.length && env.MAIL_RELAY_URL) {
        const r = await deps.relay(env, { to, subject: `End of Day Report — ABC ${deps.SITES[site]} — ${t.day}`, html: eodEmailHtml(R, deps.hubUrl) });
        if (r.ok) out.eod++;
      }
    }
  }
  if (t.weekday === "Sun" && t.hour >= 3 && t.hour < 5 && env.MAIL_RELAY_URL && (await claim(env, `backup:${t.day}`))) {
    const data = await backupData(env);
    const z = await gzipBase64(JSON.stringify(data));
    const { results } = await env.DB.prepare("SELECT email FROM users WHERE active = 1 AND role = 'ADMIN'").all();
    const to = (results || []).map(u => u.email);
    const sum = Object.entries(data.tables).map(([k, v]) => `${k}: ${v.length}`).join(" · ");
    if (to.length) {
      const r = await deps.relay(env, { to, subject: `ABC Operations Hub — weekly backup ${t.day}`,
        html: `<p style="font-family:Calibri,Arial">The weekly backup of the ABC Operations Hub is attached (${Math.round(z.bytes / 1024)} KB, compressed JSON).</p><p style="font-family:Calibri,Arial;font-size:12px;color:#666">${esc(sum)}</p>`,
        attachment: { fileName: `abc-hub-backup-${t.day}.json.gz`, mimeType: "application/gzip", base64: z.base64 } });
      await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('backup:last', ?)").bind(JSON.stringify({ day: t.day, at: now.toISOString(), bytes: z.bytes, ok: !!r.ok, error: r.error || "" })).run();
      out.backup = !!r.ok;
    }
  }
  return out;
}
