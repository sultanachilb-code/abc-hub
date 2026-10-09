/* =====================================================================
   HUB ASSISTANT (AI) — free, on Cloudflare Workers AI (the AI binding of this Worker, no API key, no card).
   • Chat: questions about the hub's own data at one flagship ("which malfunctions are still open?", "who attended today?").
     The hub gives the model a short summary of the data that person is allowed to see; the model answers only from it.
   • Shift summary: a short summary of the day in English and Arabic for the Shift Handover (added to its Notes).
   Free allowance: 10,000 Neurons a day for the account (resets 00:00 UTC). When it is used up, requests fail until the next day —
   nothing is ever charged. Each person can ask AI_DAILY questions a day so the allowance lasts for the team.
   Routes : /api/ai/status · /api/ai/chat · /api/ai/summary          See docs/FEATURE-ai.md
   ===================================================================== */
const err = (m, status = 400) => Object.assign(new Error(m), { status });
const clip = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
export const AI_MODEL = "@cf/meta/llama-3.1-8b-instruct";   // change with the AI_MODEL variable (e.g. @cf/meta/llama-3.3-70b-instruct-fp8-fast — better, uses more of the allowance)
const AI_DAILY = 30;
const hm = iso => { try { return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Beirut", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso)).replace(/^24/, "00"); } catch { return ""; } };
const dShort = iso => { try { return new Date(iso).toLocaleDateString("en-GB", { timeZone: "Asia/Beirut", day: "numeric", month: "short" }); } catch { return ""; } };
const rows = async q => { try { return (await q.all()).results || []; } catch { return []; } };

async function quota(env, me, day, use) {
  const k = `ai:n:${day}:${me.email}`;
  const r = await env.DB.prepare("SELECT v FROM meta WHERE k = ?").bind(k).first().catch(() => null);
  const n = r ? Number(r.v) || 0 : 0;
  if (use) await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)").bind(k, String(n + 1)).run().catch(() => {});
  return n;
}
const AI_FALLBACK = "@cf/meta/llama-3.2-3b-instruct";   // a second free model, tried once when the first one fails
const textOf = r => String((r && (typeof r === "string" ? r : r.response || (r.result && r.result.response)
  || (r.choices && r.choices[0] && (r.choices[0].message && r.choices[0].message.content || r.choices[0].text)))) || "").trim();
async function ask(env, messages, maxTokens, me) {
  if (!env.AI) throw err("The hub's AI is not switched on (the AI binding is missing on the Worker — check wrangler.jsonc and redeploy)", 503);
  const models = [...new Set([env.AI_MODEL || AI_MODEL, AI_FALLBACK])];
  let last = "";
  for (const model of models) {
    try {
      const t = textOf(await env.AI.run(model, { messages, max_tokens: maxTokens || 600, temperature: 0.2 }));
      if (t) return t;
      last = `${model}: empty answer`;
    } catch (e) {
      last = `${model}: ${String(e && e.message || e).slice(0, 220)}`;
      console.error("AI", last);
      if (/4006|neurons|daily free allocation/i.test(last)) throw err("The free AI allowance for today is used up — try again tomorrow (it resets overnight).", 429);
    }
  }
  /* the admin sees Cloudflare's own message, to fix it; everyone else a plain one */
  throw err(me && me.role === "ADMIN" ? `The AI did not answer — Cloudflare said: ${last}` : "The AI could not answer right now — try again in a minute.", 502);
}

/* what the hub knows today at one flagship, in short lines — only the parts this person may open */
async function siteFacts(env, site, me, d) {
  const day = d.today(), can = app => d.roleAllows(me, app), L = [];
  const T = await d.todayData(site).catch(() => null);
  L.push(`Flagship: ${d.siteName(site)}. Today: ${day}. Time now: ${d.hm()} (Beirut).`);
  if (T) {
    if (can("schedule")) {
      const on = (T.shifts || []).map(s => `${s.name} (${s.title || s.pos || ""}) ${s.from}-${s.to}`);
      L.push(`Team shifts today: ${on.join("; ") || "none set"}.${T.off && T.off.length ? ` Off/leave: ${T.off.map(o => `${o.name} (${o.code})`).join(", ")}.` : ""}`);
    }
    if (can("handover") && T.handover) L.push(`Shift handover today: ${(T.handover.handoffs || []).map(h => `handed over ${h.at} by ${h.by}${h.receivedBy ? ", received by " + h.receivedBy : ""}`).join("; ") || "started, not handed over yet"}.`);
    if (T.reminders) L.push(`Deadlines: ${T.reminders.map(r => `${r.label} by ${r.due}: ${r.done ? "done " + r.at + (r.by ? " by " + r.by : "") : "not done"}`).join("; ")}.`);
    if (T.contractors && (can("contractors") || can("contractor-access"))) {
      const att = T.contractors.filter(v => v.inAt);
      L.push(`Contractors booked today: ${T.contractors.length}; attended: ${att.map(v => `${v.company}${v.tenant && v.tenant !== v.company ? " for " + v.tenant : ""} at ${v.inAt}${v.outAt ? " (left " + v.outAt + ")" : ""}`).join("; ") || "none yet"}.`);
      const notYet = T.contractors.filter(v => !v.inAt).slice(0, 15);
      if (notYet.length) L.push(`Booked but not attended yet: ${notYet.map(v => `${v.company}${v.tenant ? " for " + v.tenant : ""}${v.from ? " from " + v.from : ""}`).join("; ")}.`);
    }
    if (T.gate && T.gate.refused && T.gate.refused.length) L.push(`Refused at the loading gate today: ${T.gate.refused.map(r => `${r.contractor || r.tenant || r.req} at ${r.at} (${r.reason})`).join("; ")}.`);
    if (T.quickPasses && T.quickPasses.length) L.push(`Quick Access Passes today: ${T.quickPasses.map(q => `${q.name}${q.company ? " (" + q.company + ")" : ""} approved ${q.at} by ${q.by}, ${q.usedAt ? "entered " + q.usedAt : "not used"}`).join("; ")}.`);
    if (T.patrol && T.patrol.length && can("patrol")) L.push(`Security patrol rounds today: ${T.patrol.map(r => `${r.name} ${r.from}-${r.to}: ${r.done}/${r.total} checkpoints, ${r.issues} issues`).join("; ")}.`);
    if (T.closing && T.closing.length) L.push(`Tenants closing today: ${T.closing.map(c => c.brand).join(", ")}.`);
    if (T.meetings && T.meetings.length) L.push(`Meetings today: ${T.meetings.map(m => `${m.title}${m.from ? " at " + m.from : ""}`).join("; ")}.`);
    if (T.events && T.events.length) L.push(`Events / activities today: ${T.events.map(e => `${e.title}${e.from ? " " + e.from : ""}`).join("; ")}.`);
  }
  if (can("malfunctions")) {
    const mf = await rows(env.DB.prepare(`SELECT r.category, r.location, r.asset, r.description, r.priority, r.status, r.found_at, p.name AS provider FROM mf_records r LEFT JOIN mf_providers p ON p.id = r.provider_id
      WHERE r.site = ? AND r.deleted = 0 AND r.status NOT IN ('Fixed','Closed') ORDER BY r.found_at DESC LIMIT 25`).bind(site));
    L.push(`Open malfunctions (${mf.length}): ${mf.map(r => `${r.asset || r.category} at ${r.location || "?"} — ${clip(r.description, 80)} [${r.priority}, ${r.status}${r.provider ? ", " + r.provider : ""}, found ${dShort(r.found_at)}]`).join("; ") || "none"}.`);
  }
  if (can("feedback")) {
    const since = new Date(Date.parse(day + "T12:00:00Z") - 7 * 864e5).toISOString().slice(0, 10);
    const fb = await rows(env.DB.prepare("SELECT day, time, tenant, category, description, action FROM tenant_feedback WHERE site = ? AND day >= ? ORDER BY day DESC, time DESC LIMIT 30").bind(site, since));
    L.push(`Tenant feedback / violations last 7 days (${fb.length}): ${fb.map(f => `${f.day} ${f.tenant}: ${f.category} — ${clip(f.description, 70)}${f.action ? " (" + f.action + ")" : ""}`).join("; ") || "none"}.`);
  }
  if (can("mom")) {
    const ac = await rows(env.DB.prepare(`SELECT a.text AS task, a.owner_name, a.due FROM mom_actions a JOIN mom_meetings m ON m.id = a.meeting_id WHERE a.site = ? AND m.status = 'published' AND a.status = 'Open' ORDER BY a.due LIMIT 15`).bind(site));
    if (ac.length) L.push(`Open meeting actions: ${ac.map(a => `${clip(a.task, 70)} — ${a.owner_name || "?"}${a.due ? ", due " + a.due : ""}`).join("; ")}.`);
  }
  if (can("contracts")) {
    const to = new Date(Date.parse(day + "T12:00:00Z") + 60 * 864e5).toISOString().slice(0, 10);
    const ce = await rows(env.DB.prepare("SELECT tenant, end_day, departure_day, status FROM contracts_ending WHERE site = ? AND active = 1 AND COALESCE(NULLIF(departure_day,''), end_day) BETWEEN ? AND ? ORDER BY end_day LIMIT 20").bind(site, day, to));
    if (ce.length) L.push(`Contracts ending in the next 60 days: ${ce.map(c => `${c.tenant} ${c.departure_day || c.end_day}${c.status ? " (" + c.status + ")" : ""}`).join("; ")}.`);
  }
  if (can("handover")) {
    const h = await env.DB.prepare("SELECT doc FROM handovers WHERE site = ? AND day = ? ORDER BY id DESC LIMIT 1").bind(site, day).first().catch(() => null);
    if (h) { let doc = {}; try { doc = JSON.parse(h.doc || "{}"); } catch {}
      const t = (k, n) => (doc[k] || []).filter(x => !x.done).slice(0, n).map(x => clip(x.text, 110));
      const today = t("today", 25), ongoing = t("ongoing", 15);
      if (today.length) L.push(`Handover · today's lines: ${today.join(" | ")}.`);
      if (ongoing.length) L.push(`Handover · ongoing follow-ups: ${ongoing.join(" | ")}.`);
      if (doc.notes) L.push(`Handover notes: ${clip(doc.notes, 400)}.`); }
  }
  return L.join("\n").slice(0, 12000);
}

export async function aiRoute(env, p, method, b, url, d) {
  const { me } = d;
  const site = d.site;
  if (!d.canSite(me, site)) throw err("No access to this flagship", 403);
  const day = d.today();
  if (p === "ai/status") {
    const out = { on: !!env.AI, used: await quota(env, me, day, false), daily: AI_DAILY, model: env.AI_MODEL || AI_MODEL };
    if (me.role === "ADMIN" && url.searchParams.get("test") === "1") {   // /api/ai/status?test=1 — the admin checks the AI in one tap
      try { out.test = { ok: true, answer: await ask(env, [{ role: "user", content: "Reply with the single word: ready" }], 10, me) }; } catch (e) { out.test = { ok: false, error: e.message }; }
    }
    return out;
  }
  if (method !== "POST") throw err("Unknown request", 404);
  if (await quota(env, me, day, false) >= AI_DAILY) throw err(`You have asked ${AI_DAILY} questions today — the assistant is back tomorrow.`, 429);

  if (p === "ai/chat") {
    const hist = (Array.isArray(b.messages) ? b.messages : []).slice(-8).map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: clip(m.content, 600) })).filter(m => m.content);
    if (!hist.length || hist[hist.length - 1].role !== "user") throw err("Write your question");
    const facts = await siteFacts(env, site, me, d);
    const sys = `You are the assistant of the ABC Operations Hub, used by the mall operations team of ABC (shopping malls and department stores in Lebanon).
Answer ONLY from the DATA below. If the answer is not in the DATA, say you do not see it in the hub and name the hub tool to open (Malfunction Records, Contractors, Shift Handover, Tenant Feedback, Security Patrol, Quick Access Pass, Operations Schedule, Contracts Near Ending).
Never invent names, times or numbers. Be short and practical: a few lines or bullets. Answer in the language of the question (English, Arabic or Lebanese Arabic).
The person asking: ${me.full_name} (${d.posLabel || me.role}).
DATA:
${facts}`;
    const answer = await ask(env, [{ role: "system", content: sys }, ...hist], 600, me);
    await quota(env, me, day, true);
    return { answer, left: AI_DAILY - (await quota(env, me, day, false)) };
  }

  if (p === "ai/summary") {
    if (!d.can.handover) throw err("Only the operations team writes the shift summary", 403);
    const facts = await siteFacts(env, site, me, d);
    const live = await d.handoverLive(site, day).catch(() => null);
    const extra = [];
    if (live && live.incidents && live.incidents.list) extra.push(`Incident reports today: ${live.incidents.list.map(i => `${i.ref} ${i.time} ${i.type}${i.severity ? " (" + i.severity + ")" : ""}${i.location ? " at " + i.location : ""}, ${i.status}`).join("; ") || "none"}.`);
    if (live && live.feedback) extra.push(`Tenant feedback today: ${live.feedback.map(f => `${f.tenant}: ${f.category} — ${clip(f.description, 60)}`).join("; ") || "none"}.`);
    if (live && live.am) extra.push(`AM checklist: ${live.am.status === "submitted" ? "done" : "not done"}. PM checklist: ${live.pm && live.pm.status === "submitted" ? "done" : "not done"}.`);
    const sys = `You write the end-of-shift summary for the Shift Handover of ${d.siteName(site)} (a mall run by ABC in Lebanon), from the DATA only.
Write two parts:
1) "Summary" in English: 5 to 8 short bullets — what happened, what is still open and needs follow-up, anything urgent first.
2) "الملخص" in Arabic: the same bullets in clear Arabic.
No greetings, no invented facts, no names of visitors. Keep each bullet under 20 words.
DATA:
${facts}
${extra.join("\n")}`;
    const text = await ask(env, [{ role: "system", content: sys }, { role: "user", content: `Write the shift summary for ${day} at ${d.hm()}.` }], 900, me);
    await quota(env, me, day, true);
    return { text, at: d.hm(), by: me.full_name };
  }
  throw err("Unknown request", 404);
}
