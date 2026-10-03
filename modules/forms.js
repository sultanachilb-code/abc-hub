/* =====================================================================
   OPERATIONS FORMS — feature module (kept separate so it can be removed cleanly)
   See docs/FEATURE-forms.md

   Five checklists in the Operations Forms orbit ring, all A4 portrait,
   layout "Area · Task · ✓ / ✗ / N/A · Remark":
     am · pm · dbank (Direct Banking weekly inspection) · open (Tenant Opening) · close (Tenant Closing)

   Each flagship has its own copy of every list. Only Administrators edit
   the lists (✎). Every record keeps a snapshot of the list it was filled
   with, so editing a list never changes past records.

   Tables : form_templates · form_runs · dbank_machines
   Routes : /api/ops/forms/*   (all require a hub sign-in)
   ===================================================================== */

const clip = (v, n) => String(v == null ? "" : v).slice(0, n);
import { reminderDone } from "./reminders.js";   // checklist submitted → its reminders are done
const err = (m, status = 400) => Object.assign(new Error(m), { status });
const isDay = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));
const SITES5 = ["VRM", "ACM", "DBS", "ACS", "VRS"];

export const FORMS = {
  am:    { name: "AM Checklist", short: "AM", kind: "shift", daily: true, commentsLabel: "AM Shift Comments" },
  pm:    { name: "PM Checklist", short: "PM", kind: "shift", daily: true, commentsLabel: "PM Shift Comments" },
  dbank: { name: "Direct Banking Checklist", short: "Direct Banking", kind: "dbank", commentsLabel: "Comments" },
  open:  { name: "Tenant Opening Checklist", short: "Tenant Opening", kind: "tenant", ref: "PR – LE – LE · V1 Feb 2021", commentsLabel: "Comments" },
  close: { name: "Tenant Closing Checklist", short: "Tenant Closing", kind: "tenant", ref: "PR – LE – LE · V1 Feb 2021", commentsLabel: "Comments" }
};
/* Yes/No questions on the tenant checklists — a "No" makes the matching rows N/A */
export const FLAGS = { fnb: "Restaurant / F&B", backdoor: "Back door", crm: "CRM", dbank: "Direct banking" };

/* ---------- starting lists (each flagship gets a copy on first use) ---------- */
const L = (prefix, rows) => rows.map((r, i) => ({ id: `${prefix}${i + 1}`, s: r[0], a: r[1], t: r[2], ...(r[3] || {}) }));
const AM = L("am", [
  ["Pre-Opening", "Office", "Review the Handover form to check the tasks for today"],
  ["Pre-Opening", "Office", "Conduct a roll call to ensure all team members are present and at their posts"],
  ["Pre-Opening", "Office", "Brief parties on the day’s events, promotions, or expected high-traffic times"],
  ["Pre-Opening", "Outside", "Inspect mall entrances, signage, and branding for cleanliness and visibility"],
  ["Pre-Opening", "Outside", "Ensure parking areas, pedestrian walkways, and drop-off zones are clear and safe"],
  ["Pre-Opening", "Outside", "Check security presence and confirm proper positioning at entry points"],
  ["Pre-Opening", "Outside", "Ensure that cleaning agents are available and completing their job around the mall"],
  ["Pre-Opening", "Outside", "Niche, parking totems, marketing totems are clean"],
  ["Pre-Opening", "Outside", "Check main entrance greenery"],
  ["Pre-Opening", "Outside", "TL marketing screen checkup"],
  ["Pre-Opening", "Outside", "Check ABC logos condition during day for any physical damages"],
  ["Pre-Opening", "Outside", "Check uniforms, hygiene, and preparedness of all staff"],
  ["Pre-Opening", "Common area", "Cleaning staff are actively completing their pre-opening tasks"],
  ["Pre-Opening", "Common area", "Floors, walls, and ceilings are clean and free of safety hazards"],
  ["Pre-Opening", "Common area", "Identify and report any burnt-out lights in parking"],
  ["Pre-Opening", "Common area", "Check that all agents are present at designated locations (Parking, Security, Cleaning)"],
  ["Pre-Opening", "Common area", "Parking staff are stationed at entry and exit barriers"],
  ["Pre-Opening", "Common area", "Check parking for scratches, cracks, or damages to surfaces, walls, and flooring"],
  ["Pre-Opening", "Common area", "Check seating areas, trash bins, and plant arrangements"],
  ["Pre-Opening", "Common area", "Verify parking areas are clean, free from debris, and all signage is visible"],
  ["Pre-Opening", "Common area", "Customer service desk is ready to operate and well cleaned"],
  ["Pre-Opening", "Common area", "Inspect all customer and staff restrooms for cleanliness and restocked"],
  ["Pre-Opening", "Common area", "Verify escalators, elevators, handrails are functioning properly, and videos working"],
  ["Pre-Opening", "Common area", "Check the Prayer Room and Baby feeding room"],
  ["Pre-Opening", "Common area", "Check garden area, fish pond and seating areas are clean"],
  ["Pre-Opening", "Common area", "Check the functionality of Wi-Fi"],
  ["Pre-Opening", "Back House", "Check the loading area and garbage room"],
  ["Pre-Opening", "Back House", "Check service corridors and service lifts (lobbies and elevators)"],
  ["During Shift", "Common area", "Ensure music is ON at 10 AM"],
  ["During Shift", "Common area", "Main entrances and sidewalks are clean"],
  ["During Shift", "Common area", "Confirm that all tenant stores are opening on time"],
  ["During Shift", "Common area", "Shopfront displays and promotional materials are properly set up"],
  ["During Shift", "Common area", "Check the cleanliness of all common areas (floors, walls, and seating areas)"],
  ["During Shift", "Common area", "Check that tenants adhere to waste disposal and safety guidelines"],
  ["During Shift", "Common area", "Check seating areas, trash bins, and plant arrangements"],
  ["During Shift", "Common area", "Monitor customer flow and address any congestion points"],
  ["During Shift", "Common area", "Verify that decorations, plants, and displays are neat and intact"],
  ["During Shift", "Common area", "Ensure customer service desks are staffed and responsive"],
  ["During Shift", "Common area", "Verify escalators, elevators, handrails are functioning properly, and videos working"],
  ["During Shift", "Common area", "Verify event setups, wayfinding, and digital screen content"],
  ["During Shift", "Common area", "Confirm that security agents are present at designated locations"],
  ["During Shift", "Common area", "Confirm that cleaning agents are present at designated locations & finalizing their job"],
  ["During Shift", "Common area", "Verify final walkthroughs of cleaning staff are completed, leaving all areas spotless"],
  ["During Shift", "Common area", "Check uniforms, hygiene, and preparedness of all staff (Security, Cleaning)"],
  ["During Shift", "Common area", "Verify air conditioning/heating systems are operational and at appropriate settings"],
  ["During Shift", "Parking Area", "Check uniforms, hygiene, and preparedness of all parking staff"],
  ["During Shift", "Parking Area", "Ensure that all parking agents are present at the assigned positions"],
  ["During Shift", "Parking Area", "Parking lobbies checkup, clean floor, clean glass doors, and well maintained"],
  ["During Shift", "Restrooms", "Ensure continuous cleaning of high-traffic areas and restrooms"]
]);
const PM = L("pm", [
  ["Pre-Closing", "Office", "Review the Handover form to check the tasks for tonight"],
  ["Pre-Closing", "Office", "Conduct a roll call to ensure all team members are present and at their posts"],
  ["Pre-Closing", "Office", "Brief parties on the night’s events, promotions, or expected high-traffic times"],
  ["During Shift", "Common area", "Ensure music is ON and at the set level"],
  ["During Shift", "Common area", "Main entrances and sidewalks are clean"],
  ["During Shift", "Common area", "Confirm that all tenant stores are operating and report any early closure"],
  ["During Shift", "Common area", "Shopfront displays and promotional materials are properly set up"],
  ["During Shift", "Common area", "Check the cleanliness of all common areas (floors, walls, and seating areas)"],
  ["During Shift", "Common area", "Check that tenants adhere to waste disposal and safety guidelines"],
  ["During Shift", "Common area", "Check seating areas, trash bins, and plant arrangements"],
  ["During Shift", "Common area", "Monitor customer flow and address any congestion points"],
  ["During Shift", "Common area", "Verify that decorations, plants, and displays are neat and intact"],
  ["During Shift", "Common area", "Ensure customer service desks are staffed and responsive"],
  ["During Shift", "Common area", "Verify escalators, elevators, handrails are functioning properly, and videos working"],
  ["During Shift", "Common area", "Verify event setups, wayfinding, and digital screen content"],
  ["During Shift", "Common area", "Confirm that security agents are present at designated locations"],
  ["During Shift", "Common area", "Confirm that cleaning agents are present at designated locations & finalizing their job"],
  ["During Shift", "Common area", "Verify final walkthroughs of cleaning staff are completed, leaving all areas spotless"],
  ["During Shift", "Common area", "Check uniforms, hygiene, and preparedness of all staff (Security, Cleaning)"],
  ["During Shift", "Common area", "Verify air conditioning/heating systems are operational and at appropriate settings"],
  ["During Shift", "Parking Area", "Check uniforms, hygiene, and preparedness of all parking staff"],
  ["During Shift", "Parking Area", "Ensure that all parking agents are present at the assigned positions"],
  ["During Shift", "Parking Area", "Parking lobbies checkup, clean floor, clean glass doors, and well maintained"],
  ["During Shift", "Back House", "Check the loading area and garbage room"],
  ["During Shift", "Back House", "Check service corridors and service lifts (lobbies and elevators)"],
  ["Closing and PM Log", "Closing", "Prepare a handover for the next day opening shift supervisor"],
  ["Closing and PM Log", "Closing", "Brief parties on the night’s events, projects, site work or workshops"],
  ["Closing and PM Log", "Closing", "Inspect all entrances, exits, and parking area are closed and secured"],
  ["Closing and PM Log", "Closing", "Confirm that the security team are present at designated locations upon closing"],
  ["Closing and PM Log", "Closing", "Ensure that cleaning agents are available and completing their job"],
  ["Closing and PM Log", "Closing", "Check all parking entrances are closed"],
  ["Closing and PM Log", "Closing", "Log unresolved issues and follow up with the appropriate teams"],
  ["Closing and PM Log", "Closing", "Conduct a final walkthrough of the mall to identify potential hazards or unresolved issues"],
  ["Closing and PM Log", "Closing", "Check all night and overnight tenants’ workshops (Fit-out phase)"],
  ["Closing and PM Log", "Closing", "Ensure escalators, elevators, and non-essential lights are turned off"]
]);
const OPEN = L("op", [
  ["Before Opening", "Approval", "Approval to trade signed and sent officially by the Retail Delivery Manager"],
  ["Before Opening", "Welcome", "Welcome email sent to branch management (mall guideline, penalty scheme, department contacts)"],
  ["Before Opening", "Welcome", "Meeting held with the new branch management to brief on mall guidelines"],
  ["Handed Over at the Meeting", "Documents", "Hard copy of the mall guidelines handed over"],
  ["Handed Over at the Meeting", "Documents", "Operations label (email, phone, duty phone) stuck on the cash desk"],
  ["Handed Over at the Meeting", "Documents", "Tenant information sheet filled, with ID copies and addresses of all staff including the manager"],
  ["Handed Over at the Meeting", "Training", "ABC Tenant Connect training done", { k: "training" }],
  ["Handed Over at the Meeting", "CRM", "Pre-configured handheld, charger, adapter, ABC stamp and SKU roll handed over and signed", { c: "crm", f: ["Handheld S/N", "Model"] }],
  ["Handed Over at the Meeting", "CRM", "Two shopfront stickers applied (gift card · adding points)", { c: "crm" }],
  ["Handed Over at the Meeting", "CRM", "CRM procedure and policy explained", { c: "crm" }],
  ["Handed Over at the Meeting", "Direct banking", "Process explained: settlement days and times, accountant contact given", { c: "dbank" }],
  ["Handed Over at the Meeting", "Direct banking", "ABC direct banking logo stuck on the Areeba machine", { c: "dbank", f: ["Terminal ID"] }],
  ["Handed Over at the Meeting", "Back door", "Back door sign installed", { c: "backdoor" }],
  ["Handed Over at the Meeting", "Restaurant", "Fans checked (kitchen extraction and fresh-air fans working)", { c: "fnb" }],
  ["Announce the Opening", "Emails", "Opening email to all concerned parties (category, floor, email, website, bio, photos)"],
  ["Announce the Opening", "Emails", "Security and parking email sent with the updated loading area route"],
  ["Update Records", "Records", "Loading area sheet updated"],
  ["Update Records", "Records", "Tenant list: opening date entered"],
  ["Update Records", "Records", "CRM datasheet: handheld S/N and model recorded", { c: "crm" }],
  ["Update Records", "Records", "Tenant added to the wayfinding tenant list"],
  ["Update Records", "Records", "Direct Banking list: tenant's Areeba machine added (next Excel upload)", { c: "dbank" }],
  ["Update Records", "Hub", "GLA unit set to Open with the opening date", { k: "gla" }]
]);
const CLOSE = L("cl", [
  ["Before the Closure Date", "Approval", "Return of area signed and sent officially by the Retail Delivery Manager"],
  ["Before the Closure Date", "Meeting", "Meeting held with branch management ahead of the closure date"],
  ["Before the Closure Date", "CRM", "Handheld, charging cable, adapter, ABC stamp and SKU retrieved", { c: "crm" }],
  ["Before the Closure Date", "CRM", "Handheld sent to IT to be reset to null", { c: "crm" }],
  ["Before the Closure Date", "Direct banking", "Areeba informed ahead of time to remove the CCM machine", { c: "dbank", f: ["Terminal ID"] }],
  ["Announce the Closure", "Emails", "Security and parking email: deny further access, updated loading area route attached"],
  ["Announce the Closure", "Emails", "Closure email to All ABC and concerned parties with the closure date"],
  ["On Site", "Back door", "Back door sign removed", { c: "backdoor" }],
  ["On Site", "Restaurant", "Fans checked and switched off / isolated before handover of the area", { c: "fnb" }],
  ["On Site", "Technical", "Technical team followed up to close all meters"],
  ["On Site", "Architect", "Mall architect followed up for the shopfront hoarding and flex"],
  ["On Site", "Architect", "Return of area done step by step per leasing instructions and the architect's notes"],
  ["Update Records", "Records", "Tenant list: closure date entered"],
  ["Update Records", "Records", "Tenant handheld sheet updated", { c: "crm" }],
  ["Update Records", "Records", "Tenant email removed from the memo mailing list"],
  ["Update Records", "Records", "Tenant removed from the wayfinding tenant list"],
  ["Update Records", "Records", "ABC Tenant Connect users of the tenant deactivated"],
  ["Update Records", "Records", "Direct Banking list: tenant's Areeba machine removed (next Excel upload)", { c: "dbank" }],
  ["Update Records", "Hub", "GLA unit set to Closed / Terminated with the closure date", { k: "gla" }]
]);
/* Direct Banking: the rows come from the uploaded Areeba list; these are the ready-made ✗ reasons */
const REASONS = [
  "Not accepting CCM", "Not using the ABC Areeba machine", "Using another machine", "Missing ABC sticker – installed a new one",
  "50% cash / 50% CCM", "Only international cards", "2 CCM machines", "Convincing customers to pay by cash",
  "Restricting CCM payments vs cash", "Adding a surcharge on CCM payments", "Machine off / unplugged", "Late settlement"
];
const DEFAULTS = { am: { items: AM }, pm: { items: PM }, open: { items: OPEN }, close: { items: CLOSE }, dbank: { items: [], reasons: REASONS } };

export async function formsSchema(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS form_templates (site TEXT NOT NULL, form TEXT NOT NULL, data TEXT NOT NULL,
      updated_by TEXT, updated_at TEXT, PRIMARY KEY (site, form))`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS form_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, site TEXT NOT NULL, form TEXT NOT NULL,
      day TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'draft', items TEXT NOT NULL DEFAULT '[]',
      header TEXT NOT NULL DEFAULT '{}', answers TEXT NOT NULL DEFAULT '{}', comments TEXT NOT NULL DEFAULT '',
      done INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL DEFAULT 0, issues INTEGER NOT NULL DEFAULT 0,
      created_by TEXT, created_name TEXT, created_at TEXT, updated_at TEXT, submitted_at TEXT NOT NULL DEFAULT '', submitted_name TEXT NOT NULL DEFAULT '')`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS form_runs_site ON form_runs (site, form, day)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS dbank_machines (id INTEGER PRIMARY KEY AUTOINCREMENT, site TEXT NOT NULL, seq INTEGER NOT NULL DEFAULT 0,
      tenant TEXT NOT NULL, old_id TEXT NOT NULL DEFAULT '', new_id TEXT NOT NULL DEFAULT '', floor TEXT NOT NULL DEFAULT '')`)
  ]);
}

async function template(env, site, form) {
  const r = await env.DB.prepare("SELECT data, updated_by, updated_at FROM form_templates WHERE site = ? AND form = ?").bind(site, form).first();
  const d = r ? JSON.parse(r.data) : JSON.parse(JSON.stringify(DEFAULTS[form]));
  return { items: d.items || [], reasons: d.reasons || (form === "dbank" ? REASONS : []), updatedBy: r ? r.updated_by : "", updatedAt: r ? r.updated_at : "" };
}
async function machines(env, site) {
  const { results } = await env.DB.prepare("SELECT * FROM dbank_machines WHERE site = ? ORDER BY seq, id").bind(site).all();
  return results || [];
}
const machineItems = list => list.map(m => ({ id: `m${m.id}`, s: "", a: m.floor || "—", t: m.tenant,
  ids: [m.new_id, m.old_id ? `old ${m.old_id}` : ""].filter(Boolean).join(" · ") }));

/* how far a record is: applicable rows answered, rows marked ✗ */
function tally(items, answers, header) {
  const flags = (header && header.flags) || {};
  let done = 0, total = 0, issues = 0;
  for (const it of items) {
    if (it.c && flags[it.c] === false) continue;         // not applicable to this tenant
    total++;
    const a = answers[it.id] || {};
    if (it.k === "training") { if (a.tr === "yes" || (a.tr === "no" && isDay(a.day)) || a.v) done++; if (a.v === "n") issues++; continue; }
    if (a.v) done++;
    if (a.v === "n") issues++;
  }
  return { done, total, issues };
}
function cleanItems(list) {
  if (!Array.isArray(list) || !list.length) throw err("The checklist needs at least one item");
  if (list.length > 400) throw err("Too many items");
  const seen = new Set();
  return list.map((x, i) => {
    let id = clip(x.id, 20).replace(/[^\w-]/g, "") || `x${Date.now().toString(36)}${i}`;
    while (seen.has(id)) id += "_";
    seen.add(id);
    const t = clip(String(x.t || "").trim(), 300);
    if (!t) throw err(`Item ${i + 1} has no task`);
    const out = { id, s: clip(String(x.s || "").trim(), 80), a: clip(String(x.a || "").trim(), 60), t };
    if (FLAGS[x.c]) out.c = x.c;
    if (["training", "gla"].includes(x.k)) out.k = x.k;
    const f = Array.isArray(x.f) ? x.f.map(v => clip(String(v).trim(), 40)).filter(Boolean).slice(0, 4) : [];
    if (f.length) out.f = f;
    return out;
  });
}
function cleanAnswers(items, a) {
  const out = {}, ids = new Set(items.map(i => i.id));
  for (const [k, v] of Object.entries(a || {})) {
    if (!ids.has(k) || !v || typeof v !== "object") continue;
    const o = {};
    if (["y", "n", "na"].includes(v.v)) o.v = v.v;
    if (v.r) o.r = clip(v.r, 300);
    if (v.tr === "yes" || v.tr === "no") o.tr = v.tr;
    if (isDay(v.day)) o.day = v.day;
    if (v.f && typeof v.f === "object") { o.f = {}; for (const [fk, fv] of Object.entries(v.f)) if (fv) o.f[clip(fk, 40)] = clip(fv, 80); }
    if (Object.keys(o).length) out[k] = o;
  }
  return out;
}
function cleanHeader(form, h = {}) {
  const o = {};
  if (FORMS[form].kind === "tenant") {
    for (const k of ["tenant", "unit", "level", "category", "manager", "contact"]) o[k] = clip(String(h[k] || "").trim(), 120);
    o.unitId = Number(h.unitId) || 0;
    o.date = isDay(h.date) ? h.date : "";
    o.flags = {};
    for (const k of Object.keys(FLAGS)) if (h.flags && typeof h.flags[k] === "boolean") o.flags[k] = h.flags[k];
    if (!o.tenant) throw err("Enter the tenant");
  }
  if (FORMS[form].kind === "dbank") { o.from = /^\d{2}:\d{2}$/.test(h.from || "") ? h.from : ""; o.to = /^\d{2}:\d{2}$/.test(h.to || "") ? h.to : ""; }
  return o;
}
const runOut = (r, full) => ({ id: r.id, form: r.form, day: r.day, title: r.title, status: r.status, done: r.done, total: r.total, issues: r.issues,
  createdBy: r.created_by, createdName: r.created_name, createdAt: r.created_at, updatedAt: r.updated_at,
  submittedAt: r.submitted_at, submittedName: r.submitted_name,
  ...(full ? { items: JSON.parse(r.items), header: JSON.parse(r.header), answers: JSON.parse(r.answers), comments: r.comments } : {}) });

/* ctx = { site, can, me, now, today, raiseEvent } */
export async function formsRoute(env, p, method, b, url, ctx) {
  const { site, can, me, now, today } = ctx;
  const q = k => url.searchParams.get(k);
  const isAdmin = me.role === "ADMIN";
  const lead = !!can.formsLead;
  const formOf = v => { if (!FORMS[v]) throw err("Choose a checklist"); return v; };

  if (p === "forms/meta") {
    const form = formOf(q("form"));
    const t = await template(env, site, form);
    const out = { form, meta: FORMS[form], forms: FORMS, flags: FLAGS, today: today(), reasons: t.reasons,
      can: { fill: !!can.formsFill, lead, admin: isAdmin }, template: { count: t.items.length, updatedBy: t.updatedBy, updatedAt: t.updatedAt } };
    if (form === "dbank") {
      const [n, info] = await Promise.all([
        env.DB.prepare("SELECT COUNT(*) AS n FROM dbank_machines WHERE site = ?").bind(site).first(),
        env.DB.prepare("SELECT v FROM ops_settings WHERE site = ? AND k = 'dbank_upload'").bind(site).first()
      ]);
      out.machines = { count: Number(n.n || 0), ...(info ? JSON.parse(info.v) : {}) };
    }
    return out;
  }
  if (p === "forms/list") {
    const form = formOf(q("form"));
    const { results } = await env.DB.prepare("SELECT * FROM form_runs WHERE site = ? AND form = ? ORDER BY day DESC, id DESC LIMIT 300").bind(site, form).all();
    return { runs: (results || []).map(r => runOut(r)) };
  }
  if (p === "forms/get") {
    const r = await env.DB.prepare("SELECT * FROM form_runs WHERE id = ? AND site = ?").bind(Number(q("id")), site).first();
    if (!r) throw err("This record no longer exists", 404);
    return { run: runOut(r, true) };
  }
  /* a blank record (not saved until the first answer) — AM/PM reopen today's if it exists */
  if (p === "forms/new") {
    const form = formOf(q("form"));
    const day = isDay(q("day")) ? q("day") : today();
    if (FORMS[form].daily) {
      const r = await env.DB.prepare("SELECT * FROM form_runs WHERE site = ? AND form = ? AND day = ? ORDER BY id LIMIT 1").bind(site, form, day).first();
      if (r) return { run: runOut(r, true) };
    }
    let items;
    if (form === "dbank") {
      items = machineItems(await machines(env, site));
      if (!items.length) throw err("Upload the Areeba machines Excel sheet first");
    } else items = (await template(env, site, form)).items;
    return { run: { id: 0, form, day, title: "", status: "draft", items, header: {}, answers: {}, comments: "", createdName: me.full_name, done: 0, total: items.length, issues: 0 } };
  }
  if (p === "forms/save" && method === "POST") {
    if (!can.formsFill) throw err("You can view this checklist but not fill it", 403);
    const form = formOf(b.form);
    const header = cleanHeader(form, b.header);
    const day = isDay(b.day) ? b.day : today();
    let cur = null, items;
    if (b.id) {
      cur = await env.DB.prepare("SELECT * FROM form_runs WHERE id = ? AND site = ?").bind(Number(b.id), site).first();
      if (!cur) throw err("This record no longer exists", 404);
      if (cur.status === "submitted" && !b.reopen) throw err("This checklist is submitted. A manager can reopen it.", 409);
      items = JSON.parse(cur.items);
    } else {
      if (FORMS[form].daily) {
        const dup = await env.DB.prepare("SELECT id FROM form_runs WHERE site = ? AND form = ? AND day = ?").bind(site, form, day).first();
        if (dup) throw err("Someone already started this checklist for the day — reopen it from the list", 409);
      }
      items = form === "dbank" ? machineItems(await machines(env, site)) : (await template(env, site, form)).items;
      if (form === "dbank" && Array.isArray(b.itemIds)) { const keep = new Set(b.itemIds); items = items.filter(i => keep.has(i.id)); }
    }
    const answers = cleanAnswers(items, b.answers);
    const t = tally(items, answers, header);
    const title = FORMS[form].kind === "tenant" ? header.tenant : "";
    const comments = clip(b.comments || "", 3000);
    const submit = !!b.submit;
    if (submit && t.done < t.total) throw err(`${t.total - t.done} item${t.total - t.done === 1 ? "" : "s"} still to tick before submitting`);
    const at = now();
    let id = cur && cur.id;
    if (cur) {
      await env.DB.prepare(`UPDATE form_runs SET day=?, title=?, header=?, answers=?, comments=?, done=?, total=?, issues=?, updated_at=?,
        status=?, submitted_at=?, submitted_name=? WHERE id=?`).bind(day, title, JSON.stringify(header), JSON.stringify(answers), comments,
        t.done, t.total, t.issues, at, submit ? "submitted" : "draft", submit ? at : "", submit ? me.full_name : "", id).run();
    } else {
      const r = await env.DB.prepare(`INSERT INTO form_runs (site, form, day, title, status, items, header, answers, comments, done, total, issues,
        created_by, created_name, created_at, updated_at, submitted_at, submitted_name) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(site, form, day, title, submit ? "submitted" : "draft", JSON.stringify(items), JSON.stringify(header), JSON.stringify(answers), comments,
          t.done, t.total, t.issues, me.email, me.full_name, at, at, submit ? at : "", submit ? me.full_name : "").run();
      id = r.meta && r.meta.last_row_id;
    }
    if (submit) {
      const name = FORMS[form].name + (title ? ` · ${title}` : "");
      const issueText = t.issues ? `${t.issues} issue${t.issues === 1 ? "" : "s"}` : "no issues";
      await ctx.raiseEvent(env, { site, app: "forms", tone: t.issues ? "warn" : "ok",
        title: `${name} submitted`, body: `${day} · ${issueText} · by ${me.full_name}` });
      /* reminders for this checklist are done for today — no reminder goes out */
      await reminderDone(env, site, "form", p => p.form === form, `${FORMS[form].name} submitted by ${me.full_name}`, at);
    }
    return { id, status: submit ? "submitted" : "draft", ...t };
  }
  if (p === "forms/reopen" && method === "POST") {
    if (!lead) throw err("Only managers and the senior mall supervisor can reopen a submitted checklist", 403);
    await env.DB.prepare("UPDATE form_runs SET status = 'draft', submitted_at = '', submitted_name = '', updated_at = ? WHERE id = ? AND site = ?")
      .bind(now(), Number(b.id), site).run();
    return { reopened: true };
  }
  if (p === "forms/remove" && method === "POST") {
    const r = await env.DB.prepare("SELECT * FROM form_runs WHERE id = ? AND site = ?").bind(Number(b.id), site).first();
    if (!r) throw err("This record no longer exists", 404);
    if (!lead && !(r.created_by === me.email && r.status === "draft")) throw err("Only managers can delete a submitted checklist", 403);
    await env.DB.prepare("DELETE FROM form_runs WHERE id = ?").bind(r.id).run();
    return { removed: true };
  }

  /* ----- lists: Administrators only ----- */
  if (p === "forms/template") {
    const form = formOf(q("form"));
    return { form, ...(await template(env, site, form)) };
  }
  if (p === "forms/template/save" && method === "POST") {
    if (!isAdmin) throw err("Only administrators can change the checklists", 403);
    const form = formOf(b.form);
    const data = form === "dbank"
      ? { items: [], reasons: (Array.isArray(b.reasons) ? b.reasons : []).map(x => clip(String(x).trim(), 120)).filter(Boolean).slice(0, 60) }
      : { items: cleanItems(b.items) };
    const targets = b.allSites ? SITES5 : [site];
    await env.DB.batch(targets.map(s => env.DB.prepare(`INSERT INTO form_templates (site, form, data, updated_by, updated_at) VALUES (?,?,?,?,?)
      ON CONFLICT(site, form) DO UPDATE SET data = excluded.data, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
      .bind(s, form, JSON.stringify(data), me.full_name, now())));
    return { saved: true, sites: targets.length };
  }

  /* ----- Direct Banking: the Areeba machines list comes from an Excel upload ----- */
  if (p === "forms/dbank/machines") {
    return { machines: (await machines(env, site)).map(m => ({ id: m.id, tenant: m.tenant, oldId: m.old_id, newId: m.new_id, floor: m.floor })) };
  }
  if (p === "forms/dbank/upload" && method === "POST") {
    if (!lead) throw err("Only managers and the senior mall supervisor can upload the machines list", 403);
    const rows = (Array.isArray(b.machines) ? b.machines : []).map(m => ({ tenant: clip(String(m.tenant || "").trim(), 120),
      oldId: clip(String(m.oldId ?? "").trim(), 60), newId: clip(String(m.newId ?? "").trim(), 60), floor: clip(String(m.floor || "").trim(), 20) }))
      .filter(m => m.tenant);
    if (!rows.length) throw err("No tenants were found in the sheet");
    if (rows.length > 1500) throw err("The sheet has too many rows");
    const ops = [env.DB.prepare("DELETE FROM dbank_machines WHERE site = ?").bind(site),
      ...rows.map((m, i) => env.DB.prepare("INSERT INTO dbank_machines (site, seq, tenant, old_id, new_id, floor) VALUES (?,?,?,?,?,?)")
        .bind(site, (i + 1) * 10, m.tenant, m.oldId, m.newId, m.floor))];
    for (let i = 0; i < ops.length; i += 90) await env.DB.batch(ops.slice(i, i + 90));
    const info = { fileName: clip(b.fileName || "", 120), by: me.full_name, at: now(), count: rows.length };
    await env.DB.prepare("INSERT INTO ops_settings (site, k, v) VALUES (?, 'dbank_upload', ?) ON CONFLICT(site, k) DO UPDATE SET v = excluded.v")
      .bind(site, JSON.stringify(info)).run();
    return info;
  }

  /* ----- tenant picker for the opening / closing checklists (from the GLA) ----- */
  if (p === "forms/tenants") {
    const { results } = await env.DB.prepare(
      "SELECT id, level, code, brand, status, dept FROM gla_units WHERE site = ? AND active = 1 AND section != 'DS' ORDER BY brand").bind(site).all();
    return { units: (results || []).filter(u => u.brand).map(u => ({ id: u.id, level: u.level, code: u.code, brand: u.brand, status: u.status, category: u.dept })) };
  }
  throw err("Unknown endpoint", 404);
}

/* Used by the Reminders feature: is the checklist submitted today (or this week)? */
export async function formSubmitted(env, site, form, day, sinceDay) {
  const r = await env.DB.prepare(`SELECT submitted_name, submitted_at, issues FROM form_runs WHERE site = ? AND form = ? AND status = 'submitted'
    AND day >= ? AND day <= ? ORDER BY submitted_at DESC LIMIT 1`).bind(site, form, sinceDay || day, day).first();
  return r || null;
}
