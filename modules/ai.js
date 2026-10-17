/* =====================================================================
   ABCON (ABC Operations Control) — the hub's AI assistant, free, on Cloudflare Workers AI (the AI binding of this Worker, no API key, no card).
   • Chat: questions about the hub's own data at one flagship ("which malfunctions are still open?", "who attended today?").
     The hub gives the model a short summary of the data that person is allowed to see; the model answers only from it.
   • Shift summary: a short summary of the day in English and Arabic for the Shift Handover (added to its Notes).
   Free allowance: 10,000 Neurons a day for the account (resets 00:00 UTC). When it is used up, requests fail until the next day —
   ABCON closes at 80 % of it so nothing is ever charged, and each person has a daily and a per-5-minutes limit (see the usage guard below).
   Routes : /api/ai/status · /api/ai/chat · /api/ai/summary          See docs/FEATURE-ai.md
   ===================================================================== */
const err = (m, status = 400) => Object.assign(new Error(m), { status });
const clip = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
export const AI_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";   // the stronger free model (about 1.7× the allowance of the small one)   // change with the AI_MODEL variable (e.g. @cf/meta/llama-3.3-70b-instruct-fp8-fast — better, uses more of the allowance)
const hm = iso => { try { return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Beirut", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso)).replace(/^24/, "00"); } catch { return ""; } };
const dShort = iso => { try { return new Date(iso).toLocaleDateString("en-GB", { timeZone: "Asia/Beirut", day: "numeric", month: "short" }); } catch { return ""; } };
const rows = async q => { try { return (await q.all()).results || []; } catch { return []; } };

/* ---------- ABCON usage guard (Oct 2026) ----------
   • Team: Cloudflare gives 10,000 free Neurons a day (resets 00:00 UTC = 03:00 Beirut). ABCON counts what every answer used
     (from Cloudflare's own token counts) and closes at 80 % — so the account never goes past the free allowance.
   • Person: at most USER_DAILY questions a day, and USER_BURST questions in USER_WINDOW minutes (asking again and again).
     When a limit is reached ABCON says the exact date and time it is back.
   • The same question again within CACHE_MIN minutes gets the same answer for free (no Neurons, not counted). */
const FREE_NEURONS = 10000, CLOSE_AT = 0.8, USER_DAILY = 15, USER_BURST = 4, USER_WINDOW = 5, CACHE_MIN = 15;
/* Neurons per million tokens (Cloudflare Workers AI price list) — an unknown model is counted at the dearest rate */
const RATES = { "@cf/meta/llama-3.3-70b-instruct-fp8-fast": [26668, 204805], "@cf/meta/llama-3.1-8b-instruct": [25608, 75147], "@cf/meta/llama-3.1-8b-instruct-fp8": [13778, 26128], "@cf/meta/llama-3.1-8b-instruct-fp8-fast": [4119, 34868] };
const rateOf = m => RATES[m] || [30000, 210000];
const utcDay = () => new Date().toISOString().slice(0, 10);
const nextReset = () => { const d = new Date(); d.setUTCHours(24, 0, 0, 0); return d.toISOString(); };
const when = iso => { try { const d = new Date(iso), f = o => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Beirut", ...o }).format(d);
  return `${f({ weekday: "short", day: "numeric", month: "short" })} at ${f({ hour: "2-digit", minute: "2-digit", hour12: false }).replace(/^24/, "00")}`; } catch { return ""; } };
const metaGet = async (env, k) => { const r = await env.DB.prepare("SELECT v FROM meta WHERE k = ?").bind(k).first().catch(() => null); return r ? r.v : null; };
const metaSet = (env, k, v) => env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)").bind(k, String(v)).run().catch(() => {});
const budgetOf = env => Math.max(500, Number(env.AI_DAILY_NEURONS) || FREE_NEURONS) * CLOSE_AT;
async function teamUsed(env) { return Number(await metaGet(env, `ai:neu:${utcDay()}`)) || 0; }
async function addNeurons(env, n) { const k = `ai:neu:${utcDay()}`; await env.DB.prepare("INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = CAST(CAST(v AS REAL) + ? AS TEXT)").bind(k, String(n), n).run()
  .catch(async () => metaSet(env, k, (await teamUsed(env)) + n)); }
async function userLog(env, me) { let a = []; try { a = JSON.parse(await metaGet(env, `ai:u:${me.email}`) || "[]"); } catch {} const since = Date.parse(utcDay() + "T00:00:00Z"); return a.filter(t => t >= since); }
/* where this person and the team stand — the chat shows it, and it decides whether ABCON may answer */
async function standing(env, me) {
  const log = await userLog(env, me), now = Date.now(), win = log.filter(t => t > now - USER_WINDOW * 60e3).sort((a, b) => a - b);
  const used = await teamUsed(env), budget = budgetOf(env);
  const out = { left: Math.max(0, USER_DAILY - log.length), daily: USER_DAILY, teamPct: Math.min(100, Math.round(used / budget * 100)), resetAt: nextReset() };
  if (used + 150 >= budget) return { ...out, open: false, why: "team", backAt: out.resetAt, msg: `ABCON is resting — the team has used today's free AI allowance. Back on ${when(out.resetAt)} (Beirut time).` };
  if (me.role !== "ADMIN" && log.length >= USER_DAILY) return { ...out, open: false, why: "daily", backAt: out.resetAt, msg: `You have asked your ${USER_DAILY} questions for today. ABCON is back for you on ${when(out.resetAt)} (Beirut time).` };
  if (win.length >= USER_BURST) { const back = new Date(win[win.length - USER_BURST] + USER_WINDOW * 60e3 + 1000).toISOString();
    return { ...out, open: false, why: "burst", backAt: back, msg: `You are asking very quickly — take a short break. ABCON is back for you at ${hm(back)} (${when(back)}).` }; }
  return { ...out, open: true };
}
async function countQuestion(env, me) { const log = await userLog(env, me); log.push(Date.now()); await metaSet(env, `ai:u:${me.email}`, JSON.stringify(log.slice(-60))); }
const norm = t => String(t || "").toLowerCase().normalize("NFKC").replace(/[\s\p{P}]+/gu, " ").trim();
async function hash(t) { const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)); return [...new Uint8Array(b)].slice(0, 12).map(x => x.toString(16).padStart(2, "0")).join(""); }

const AI_FALLBACK = "@cf/meta/llama-3.1-8b-instruct";   // a second free model, tried once when the first one fails
const textOf = r => String((r && (typeof r === "string" ? r : r.response || (r.result && r.result.response)
  || (r.choices && r.choices[0] && (r.choices[0].message && r.choices[0].message.content || r.choices[0].text)))) || "").trim();
/* one answer from Workers AI; what it used is added to the team's count */
async function ask(env, messages, maxTokens, me, modelOverride) {
  if (!env.AI) throw err("The hub's AI is not switched on (the AI binding is missing on the Worker — check wrangler.jsonc and redeploy)", 503);
  const models = modelOverride ? [modelOverride] : [...new Set([env.AI_MODEL || AI_MODEL, AI_FALLBACK])];
  const inChars = messages.reduce((a, m) => a + String(m.content || "").length, 0);
  let last = "";
  for (const model of models) {
    const [ri, ro] = rateOf(model);
    if ((await teamUsed(env)) + (inChars / 3 * ri + (maxTokens || 600) * ro) / 1e6 > budgetOf(env) + 1) throw err(`ABCON is resting — the team has used today's free AI allowance. Back on ${when(nextReset())} (Beirut time).`, 429);
    try {
      const r = await env.AI.run(model, { messages, max_tokens: maxTokens || 600, temperature: 0.2 });
      const t = textOf(r), u = (r && r.usage) || {};
      const tin = Number(u.prompt_tokens) || Math.ceil(inChars / 3), tout = Number(u.completion_tokens) || Math.ceil(t.length / 3);
      await addNeurons(env, Math.round((tin * ri + tout * ro) / 1e6 * 100) / 100);
      if (t) return t;
      last = `${model}: empty answer`;
    } catch (e) {
      last = `${model}: ${String(e && e.message || e).slice(0, 220)}`;
      console.error("AI", last);
      if (/4006|neurons|daily free allocation/i.test(last)) { await metaSet(env, `ai:neu:${utcDay()}`, budgetOf(env) * 2);   // Cloudflare says the allowance is gone (e.g. used by another app)
        throw err(`ABCON is resting — today's free AI allowance is used up. Back on ${when(nextReset())} (Beirut time).`, 429); }
    }
  }
  /* the admin sees Cloudflare's own message, to fix it; everyone else a plain one */
  throw err(me && me.role === "ADMIN" ? `The AI did not answer — Cloudflare said: ${last}` : "ABCON could not answer right now — try again in a minute.", 502);
}

/* policy passages for a question (Policies & Procedures library). An Arabic question is turned into English search words first. */
async function policyContext(env, d, q, me) {
  if (!d.policies) return { text: "", sources: [] };
  let hits = await d.policies(q).catch(() => []);
  if (!hits.length && /[؀-ۿ]/.test(q)) {
    const kw = await ask(env, [{ role: "system", content: "Give 3 to 8 English search keywords for the question, for searching mall policies. Reply with the words only, separated by spaces." }, { role: "user", content: clip(q, 300) }], 30, me, AI_FALLBACK).catch(() => "");
    if (kw) hits = await d.policies(kw).catch(() => []);
  }
  hits = hits.slice(0, 4);
  return { sources: hits.map((h, i) => ({ n: i + 1, doc: h.doc, title: h.title, coll: h.collName, section: h.section, page: h.page })),
    text: hits.map((h, i) => `[P${i + 1}] ${h.title} (${h.collName}${h.version ? ", v" + h.version : ""})${h.section ? " · " + clip(h.section, 80) : ""}${h.page ? " · page " + h.page : ""}:\n${clip(h.text, 900)}`).join("\n\n") };
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
  if (can("gla")) {
    const g = await rows(env.DB.prepare("SELECT level, status, section, area FROM gla_units WHERE site = ? AND active = 1").bind(site));
    if (g.length) {
      const lease = g.filter(u => !u.section || /leas/i.test(u.section)), area = L2 => L2.reduce((a, u) => a + (Number(u.area) || 0), 0);
      const by = {}; for (const u of lease) { by[u.status] = by[u.status] || { n: 0, a: 0 }; by[u.status].n++; by[u.status].a += Number(u.area) || 0; }
      const total = area(lease), vac = ["Vacant", "Terminated"].reduce((a, k) => a + (by[k] ? by[k].a : 0), 0);
      L.push(`GLA & occupancy (leasing units): ${lease.length} units, ${Math.round(total)} m² leasable; occupancy ${total ? Math.round((total - vac) / total * 1000) / 10 : 0}% by area. By status: ${Object.entries(by).map(([k, v]) => `${k} ${v.n} units / ${Math.round(v.a)} m²`).join("; ")}.`);
      const lv = {}; for (const u of lease) { lv[u.level] = lv[u.level] || { n: 0, v: 0 }; lv[u.level].n++; if (["Vacant", "Terminated"].includes(u.status)) lv[u.level].v++; }
      L.push(`Units per level (vacant): ${Object.entries(lv).map(([k, v]) => `${k} ${v.n} (${v.v} vacant)`).join("; ")}.`);
    }
  }
  if (d.systems) {   // Snaglist, Incident Report System, Restroom inspections — the same figures as the morning brief
    const S = await d.systems(site).catch(() => null);
    if (S) for (const [id, r] of Object.entries(S)) if (r && r.ok && r.brief && r.brief.length && can(id)) L.push(`${{ snaglist: "Snaglist", incidents: "Incident reports", restroom: "Restroom inspections" }[id] || id}: ${r.brief.map(b => `${b.label} ${b.value}`).join("; ")}.`);
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
    const st = await standing(env, me);
    const out = { on: !!env.AI, ...st, model: env.AI_MODEL || AI_MODEL, name: "ABCON" };
    if (me.role === "ADMIN") out.neurons = { used: Math.round(await teamUsed(env)), closeAt: budgetOf(env), free: Math.max(500, Number(env.AI_DAILY_NEURONS) || FREE_NEURONS) };
    if (me.role === "ADMIN" && url.searchParams.get("test") === "1") {   // /api/ai/status?test=1 — the admin checks the AI in one tap
      try { out.test = { ok: true, answer: await ask(env, [{ role: "user", content: "Reply with the single word: ready" }], 10, me) }; } catch (e) { out.test = { ok: false, error: e.message }; }
    }
    return out;
  }
  if (method !== "POST") throw err("Unknown request", 404);

  if (p === "ai/chat") {
    const hist = (Array.isArray(b.messages) ? b.messages : []).filter(m => !m.err).slice(-8).map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: clip(m.content, 600) })).filter(m => m.content);
    if (!hist.length || hist[hist.length - 1].role !== "user") throw err("Write your question");
    const q = hist[hist.length - 1].content, prevQ = [...hist].reverse().slice(1).find(m => m.role === "user" && norm(m.content) !== norm(q));   // the same question asked twice in a row counts as one
    /* the same question again (within CACHE_MIN minutes, same flagship) → the same answer, free */
    const ck = `ai:c:${site}:${await hash(norm(q) + "|" + norm(prevQ && prevQ.content))}`;
    try { const c = JSON.parse(await metaGet(env, ck) || "null");
      if (c && Date.now() - c.t < CACHE_MIN * 60e3) { const st = await standing(env, me); return { answer: c.a, sources: c.s || [], cached: true, cachedAt: hm(new Date(c.t).toISOString()), left: st.left, teamPct: st.teamPct }; } } catch {}
    const st = await standing(env, me);
    if (!st.open) throw Object.assign(err(st.msg, 429), { backAt: st.backAt });
    const [facts, pol] = await Promise.all([siteFacts(env, site, me, d), policyContext(env, d, q, me)]);
    const sys = `Your name is ABCON (ABC Operations Control). You are the assistant of the ABC Operations Hub, used by the mall operations team of ABC (shopping malls and department stores in Lebanon). If asked who you are, say you are ABCON, the ABC Operations assistant.
Facts about the flagship come ONLY from the DATA below — never invent names, times or numbers.
- For a broad question ("what is still open?", "what should I follow up?", "any issues today?") go through ALL of the DATA and list every open or pending item, grouped (malfunctions, handover follow-ups, deadlines not done, contractors not attended, Snaglist, incidents, patrol, meeting actions, tenant violations). Never answer a broad question with "I do not see it".
- For figures (occupancy, vacant units, open findings…) use the numbers in the DATA and show them clearly.
- Rules, policies and procedures: answer from the POLICIES passages and cite each one you use with its tag, e.g. [P1]. Quote the exact rule (hours, amounts, approvals) — never invent a rule. If the passages do not cover the question, say the library has nothing on it and name who to ask (Mall Management).
- Only when the DATA really has nothing on the subject, say so in one line and name the hub tool to open.
- General know-how questions (how to handle a situation, write a message) may be answered from your own knowledge; say when an answer is general advice and not ABC policy.
Be practical: short bullets with the numbers. Answer in the language of the question (English, Arabic or Lebanese Arabic).
The person asking: ${me.full_name} (${d.posLabel || me.role}).
${pol.text ? `POLICIES (from the hub's Policies & Procedures library):\n${pol.text}\n` : ""}DATA:
${facts}`;
    const answer = await ask(env, [{ role: "system", content: sys }, ...hist], 550, me);
    const used = new Set((answer.match(/\[P(\d)\]/g) || []).map(x => Number(x.slice(2, -1))));
    const sources = pol.sources.filter(x => used.has(x.n));
    await countQuestion(env, me);
    await metaSet(env, ck, JSON.stringify({ a: answer, s: sources, t: Date.now() }));
    env.DB.prepare("DELETE FROM meta WHERE k LIKE 'ai:c:%' AND CAST(json_extract(v, '$.t') AS INTEGER) < ?").bind(Date.now() - 2 * CACHE_MIN * 60e3).run().catch(() => {});
    const after = await standing(env, me);
    return { answer, sources, left: after.left, teamPct: after.teamPct };
  }

  if (p === "ai/summary") {
    if (!d.can.handover) throw err("Only the operations team writes the shift summary", 403);
    const st = await standing(env, me);
    if (!st.open) throw Object.assign(err(st.msg, 429), { backAt: st.backAt });
    const facts = await siteFacts(env, site, me, d);
    const live = await d.handoverLive(site, day).catch(() => null);
    const extra = [];
    if (live && live.incidents && live.incidents.list) extra.push(`Incident reports today: ${live.incidents.list.map(i => `${i.ref} ${i.time} ${i.type}${i.severity ? " (" + i.severity + ")" : ""}${i.location ? " at " + i.location : ""}, ${i.status}`).join("; ") || "none"}.`);
    if (live && live.feedback) extra.push(`Tenant feedback today: ${live.feedback.map(f => `${f.tenant}: ${f.category} — ${clip(f.description, 60)}`).join("; ") || "none"}.`);
    if (live && live.am) extra.push(`AM checklist: ${live.am.status === "submitted" ? "done" : "not done"}. PM checklist: ${live.pm && live.pm.status === "submitted" ? "done" : "not done"}.`);
    const sys = `You are ABCON. You write the end-of-shift summary for the Shift Handover of ${d.siteName(site)} (a mall run by ABC in Lebanon), from the DATA only.
Write two parts:
1) "Summary" in English: 5 to 8 short bullets — what happened, what is still open and needs follow-up, anything urgent first.
2) "الملخص" in Arabic: the same bullets in clear Arabic.
No greetings, no invented facts, no names of visitors. Keep each bullet under 20 words.
DATA:
${facts}
${extra.join("\n")}`;
    const text = await ask(env, [{ role: "system", content: sys }, { role: "user", content: `Write the shift summary for ${day} at ${d.hm()}.` }], 800, me);
    await countQuestion(env, me);
    return { text, at: d.hm(), by: me.full_name };
  }
  throw err("Unknown request", 404);
}
