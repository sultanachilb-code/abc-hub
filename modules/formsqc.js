/* =====================================================================
   QC DAILY CHECKLIST — Achrafieh Department Store AM / PM (Nov 2026)
   The flagship's own checklist page (tools/qc-checklist.html), built from the
   page the Achrafieh DS team used with Google Sheets — now stored in the hub:

   • records      → form_runs (same as every AM / PM checklist), so the KPIs,
                    missing-checklist alerts, reminders and the brief keep working.
                    answers[item] = { v: y|n|na, r: "[L1] … | [L2] …", iss: [{ fl, c }], pins: [{ id, fl, c }] }
                    header        = { qc: 1, shift, manager, floor }
   • pinned issues → form_pins: one row per 📌 Fix Issue (floor + comment), shared by
                    the AM and PM checklists, visible to everyone until ✓ Resolved.
                    They replace the "follow-up of previous findings" for these sites.
   Routes : /api/ops/forms/qc/*
   ===================================================================== */
export const QC_SITES = ["ACS"];
export const QC_FLOORS = ["B3", "B2", "B1", "L0", "L1", "L2", "L3", "ALL"];
const QC_FORMS = ["am", "pm"];
const clip = (v, n) => String(v == null ? "" : v).slice(0, n);
const err = (m, status = 400) => Object.assign(new Error(m), { status });
const isDay = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));
export const qcOn = (site, form) => QC_SITES.includes(site) && QC_FORMS.includes(form);

export async function qcSchema(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS form_pins (id INTEGER PRIMARY KEY AUTOINCREMENT, site TEXT NOT NULL, grp TEXT NOT NULL, item_id TEXT NOT NULL,
      floor TEXT NOT NULL DEFAULT '', comment TEXT NOT NULL DEFAULT '', by_email TEXT NOT NULL DEFAULT '', by_name TEXT NOT NULL DEFAULT '', at TEXT NOT NULL,
      resolved_at TEXT NOT NULL DEFAULT '', resolved_by TEXT NOT NULL DEFAULT '')`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS form_pins_open ON form_pins (site, grp, resolved_at)")
  ]);
}
const GRP = () => "ampm";   // one set of pinned issues for the AM and PM checklists
const pinOut = p => ({ id: p.id, item: p.item_id, floor: p.floor, comment: p.comment, by: p.by_name, at: p.at, resolvedAt: p.resolved_at, resolvedBy: p.resolved_by });
async function openPins(env, site) {
  const { results } = await env.DB.prepare("SELECT * FROM form_pins WHERE site = ? AND grp = ? AND resolved_at = '' ORDER BY id").bind(site, GRP()).all();
  return (results || []).map(pinOut);
}
const itemOut = it => ({ id: it.id, n: Number(String(it.id).replace(/\D/g, "")) || 0, s: it.s, a: it.a, t: it.t, pr: it.pr || "" });

/* d = { template, FORMS, COVER, reminderDone, triggersOf, fireTrigger } */
export async function qcRoute(env, p, method, b, url, ctx, d) {
  const { site, can, me, now, today } = ctx;
  const q = k => url.searchParams.get(k);
  const form = String((method === "POST" ? b.form : q("form")) || "");
  if (!qcOn(site, form)) throw err("This checklist page is not used at this flagship");
  const FORM = d.FORMS[form];
  await qcSchema(env);
  const runOf = day => env.DB.prepare("SELECT * FROM form_runs WHERE site = ? AND form = ? AND day = ? ORDER BY id LIMIT 1").bind(site, form, day).first();
  const items = async () => (await d.template(env, site, form)).items;
  const notifyTech = async (title, body) => {
    await ctx.raiseEvent(env, { site, app: "forms", tone: "warn", title, body }).catch(() => {});
    const { results } = await env.DB.prepare("SELECT email, position, site_code FROM users WHERE role = 'TECHNICAL' AND active = 1").all();
    for (const u of results || []) if (u.position === "HOT" || (d.COVER[u.site_code] || [u.site_code]).includes(site))
      await ctx.raiseEvent(env, { site, app: "forms", tone: "warn", title, body, email: u.email }).catch(() => {});
  };

  /* everything the page needs: the list, the day's record (draft or submitted), the pinned issues */
  if (p === "forms/qc/state") {
    const day = isDay(q("day")) ? q("day") : today();
    const r = await runOf(day);
    const its = r ? JSON.parse(r.items) : await items();
    return { form, day, today: today(), floors: QC_FLOORS, me: { name: me.full_name, email: me.email }, siteName: ctx.siteName ? ctx.siteName(site) : site,
      can: { fill: !!can.formsFill, lead: !!can.formsLead }, items: its.map(itemOut), pins: await openPins(env, site),
      run: r ? { id: r.id, status: r.status, header: JSON.parse(r.header || "{}"), answers: JSON.parse(r.answers || "{}"), comments: r.comments,
        createdName: r.created_name, updatedAt: r.updated_at, submittedAt: r.submitted_at, submittedName: r.submitted_name, done: r.done, total: r.total, issues: r.issues } : null };
  }

  /* the records list and one record's report */
  if (p === "forms/qc/list") {
    const { results } = await env.DB.prepare("SELECT id, day, status, done, total, issues, created_name, submitted_at, submitted_name, header FROM form_runs WHERE site = ? AND form = ? ORDER BY day DESC, id DESC LIMIT 200").bind(site, form).all();
    return { runs: (results || []).map(r => { let h = {}; try { h = JSON.parse(r.header || "{}"); } catch {}
      return { id: r.id, day: r.day, status: r.status, done: r.done, total: r.total, issues: r.issues, createdName: r.created_name, submittedAt: r.submitted_at, submittedName: r.submitted_name, manager: h.manager || "", floor: h.floor || "" }; }) };
  }
  if (p === "forms/qc/report") {
    const r = await env.DB.prepare("SELECT * FROM form_runs WHERE id = ? AND site = ? AND form = ?").bind(Number(q("id")), site, form).first();
    if (!r) throw err("This record no longer exists", 404);
    const { results } = await env.DB.prepare("SELECT * FROM form_pins WHERE site = ? AND grp = ? AND (resolved_at = '' OR resolved_at >= ?) ORDER BY id").bind(site, GRP(), r.day).all();
    return { run: { id: r.id, day: r.day, status: r.status, items: JSON.parse(r.items).map(itemOut), header: JSON.parse(r.header || "{}"), answers: JSON.parse(r.answers || "{}"),
      comments: r.comments, done: r.done, total: r.total, issues: r.issues, createdName: r.created_name, submittedAt: r.submitted_at, submittedName: r.submitted_name },
      pins: (results || []).map(pinOut), siteName: ctx.siteName ? ctx.siteName(site) : site };
  }

  if (!can.formsFill) throw err("You can view this checklist but not fill it", 403);

  /* 📌 Fix Issue — pinned for everyone until ✓ Resolved */
  if (p === "forms/qc/pin" && method === "POST") {
    const it = (await items()).find(i => i.id === String(b.item || "")); if (!it) throw err("Unknown checklist item");
    const floor = QC_FLOORS.includes(b.floor) ? b.floor : ""; const comment = clip(String(b.comment || "").trim(), 500);
    if (!floor || !comment) throw err("Please select the floor and enter the issue description before pressing Fix Issue.");
    const r = await env.DB.prepare("INSERT INTO form_pins (site, grp, item_id, floor, comment, by_email, by_name, at) VALUES (?,?,?,?,?,?,?,?)")
      .bind(site, GRP(), it.id, floor, comment, me.email, me.full_name, now()).run();
    await notifyTech(`📌 Fixed issue · ${FORM.short} checklist`, `[${floor}] ${it.a} — ${it.t.slice(0, 80)} · “${comment.slice(0, 120)}” · by ${me.full_name}`);
    return { pin: { id: r.meta && r.meta.last_row_id, item: it.id, floor, comment, by: me.full_name, at: now() } };
  }
  if (p === "forms/qc/resolve" && method === "POST") {
    const pin = await env.DB.prepare("SELECT * FROM form_pins WHERE id = ? AND site = ? AND grp = ?").bind(Number(b.id) || 0, site, GRP()).first();
    if (!pin) throw err("This fixed issue no longer exists", 404);
    if (pin.resolved_at) return { resolved: true };
    await env.DB.prepare("UPDATE form_pins SET resolved_at = ?, resolved_by = ? WHERE id = ?").bind(now(), me.full_name, pin.id).run();
    const it = (await items()).find(i => i.id === pin.item_id) || { a: "", t: pin.item_id };
    await ctx.raiseEvent(env, { site, app: "forms", tone: "ok", title: `✓ Resolved · ${FORM.short} checklist`, body: `[${pin.floor}] ${it.a} — ${String(it.t).slice(0, 80)} · by ${me.full_name}` }).catch(() => {});
    return { resolved: true };
  }

  /* Clear Temporary Saved: the day's draft is removed (a submitted checklist is never removed here) */
  if (p === "forms/qc/clear" && method === "POST") {
    const day = isDay(b.day) ? b.day : today();
    await env.DB.prepare("DELETE FROM form_runs WHERE site = ? AND form = ? AND day = ? AND status = 'draft'").bind(site, form, day).run();
    return { cleared: true };
  }

  /* Temporary Save (draft) and Submit Checklist */
  if (p === "forms/qc/save" && method === "POST") {
    const day = isDay(b.day) ? b.day : today();
    const cur = await runOf(day);
    if (cur && cur.status === "submitted") throw err(`The ${FORM.short} checklist of this day was already submitted by ${cur.submitted_name}. A manager can reopen it.`, 409);
    const its = cur ? JSON.parse(cur.items) : await items();
    const pins = await openPins(env, site), pinBy = {};
    for (const x of pins) (pinBy[x.item] = pinBy[x.item] || []).push(x);
    const answers = {};
    let done = 0, issues = 0;
    const missing = [], noDetail = [];
    for (const it of its) {
      const a = (b.answers || {})[it.id] || {}, pinned = pinBy[it.id] || [];
      let v = ["y", "n", "na"].includes(a.v) ? a.v : "";
      if (pinned.length) v = "n";                         // a pinned issue keeps the item ❌ until Resolved
      const iss = (Array.isArray(a.iss) ? a.iss : []).slice(0, 12).map(x => ({ fl: QC_FLOORS.includes(x && x.fl) ? x.fl : "", c: clip(String((x && x.c) || "").trim(), 500) }))
        .filter(x => x.fl || x.c);
      if (!v) { missing.push(it); continue; }
      const o = { v };
      if (v === "n") {
        if (iss.length) o.iss = iss;
        if (pinned.length) o.pins = pinned.map(x => ({ id: x.id, fl: x.floor, c: x.comment }));
        const all = [...(o.pins || []).map(x => ({ fl: x.fl, c: `📌 ${x.c}` })), ...iss];
        if (!all.length || iss.some(x => !x.fl || !x.c)) noDetail.push(it);
        o.r = clip(all.map(x => `[${x.fl}] ${x.c}`).join(" | "), 1500);
        issues++;
      }
      answers[it.id] = o; done++;
    }
    const header = { qc: 1, shift: FORM.short, manager: me.full_name, floor: clip(String((b.header || {}).floor || "").trim(), 60) };
    const comments = clip(String(b.comments || "").trim(), 3000);
    const submit = !!b.submit;
    if (submit) {
      if (!header.floor) throw err("Please complete all shift information first.");
      if (missing.length) throw err(`Please answer all checklist items before submitting (${missing.length} left).`);
      if (noDetail.length) throw err(`Please complete floor and comment for all items marked as issue (${noDetail.length} to review).`);
    }
    const at = now(), total = its.length;
    let id = cur && cur.id;
    if (cur) {
      await env.DB.prepare(`UPDATE form_runs SET header=?, answers=?, comments=?, done=?, total=?, issues=?, updated_at=?, status=?, submitted_at=?, submitted_name=? WHERE id=?`)
        .bind(JSON.stringify(header), JSON.stringify(answers), comments, done, total, issues, at, submit ? "submitted" : "draft", submit ? at : "", submit ? me.full_name : "", id).run();
    } else {
      const r = await env.DB.prepare(`INSERT INTO form_runs (site, form, day, title, status, items, header, answers, comments, done, total, issues,
        created_by, created_name, created_at, updated_at, submitted_at, submitted_name) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(site, form, day, "", submit ? "submitted" : "draft", JSON.stringify(its), JSON.stringify(header), JSON.stringify(answers), comments,
          done, total, issues, me.email, me.full_name, at, at, submit ? at : "", submit ? me.full_name : "").run();
      id = r.meta && r.meta.last_row_id;
    }
    if (submit) {
      const issueText = issues ? `${issues} issue${issues === 1 ? "" : "s"}` : "no issues";
      await ctx.raiseEvent(env, { site, app: "forms", tone: issues ? "warn" : "ok", title: `${FORM.name} submitted`,
        body: `${day} · ${issueText}${pins.length ? ` · ${pins.length} pinned` : ""} · by ${me.full_name}` }).catch(() => {});
      const TRIG = await d.triggersOf(env, site, form).catch(() => ({}));   // ⚡ checklist triggers on ❌ items
      for (const it of its) { const c = TRIG[it.id], a = answers[it.id] || {};
        if (c && a.v === "n") await d.fireTrigger(env, ctx, { site, form, day, item: it, cfg: c, remark: a.r || "", photoKey: "", runId: id, me, FORMS: d.FORMS }).catch(e => console.error("trigger", e && e.message)); }
      await d.reminderDone(env, site, "form", x => x.form === form, `${FORM.name} submitted by ${me.full_name}`, at).catch(() => {});
    }
    return { id, status: submit ? "submitted" : "draft", done, total, issues, savedAt: at };
  }
  throw err("Unknown endpoint", 404);
}
