/* =====================================================================
   ABCON (ABC Operations Control) — the hub's AI assistant, free, on Cloudflare Workers AI (no API key, no card).
   • Chat: today's hub data at one flagship (+ 30 days of memory), the Policies & Procedures library (word + meaning search),
     and the facts managers taught it. Answers in a fixed Markdown format the window turns into cards; written word by word (streaming).
   • Simple questions go to a fast small model, analysis to the big one (about 2× more answers on the free allowance).
   • Teach ABCON: managers add facts; 👎 answers land in a review list and one tap turns a correction into a taught fact.
   • History: each person's chats, kept 30 days.
   • Usage guard: closes at 80 % of the 10,000 free Neurons a day; 15 questions per person a day; 4 per 5 minutes; repeats are free.
   Routes : /api/ai/status · chat · summary · feedback · facts · fact/save|remove · reviews · review/fix|dismiss · history · history/get|save|remove
   See docs/FEATURE-ai.md
   ===================================================================== */
import { routedFacts } from "./aidata.js";   // the data router: the slices of hub data this question needs
const err = (m, status = 400) => Object.assign(new Error(m), { status });
const clip = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
export const AI_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";   // the big model (analysis); change with the AI_MODEL variable
const AI_FAST = "@cf/meta/llama-3.1-8b-instruct-fp8-fast";            // the fast small model (simple questions)
const AI_FALLBACK = "@cf/meta/llama-3.1-8b-instruct";                  // tried once when the first model fails
const AI_EMBED = "@cf/baai/bge-m3";                                    // meaning search (multilingual)
const hm = iso => { try { return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Beirut", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso)).replace(/^24/, "00"); } catch { return ""; } };
const dShort = iso => { try { return new Date(iso).toLocaleDateString("en-GB", { timeZone: "Asia/Beirut", day: "numeric", month: "short" }); } catch { return ""; } };
const rows = async q => { try { return (await q.all()).results || []; } catch { return []; } };

export async function aiSchema(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS ai_facts (id INTEGER PRIMARY KEY AUTOINCREMENT, site TEXT NOT NULL DEFAULT '', text TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'approved',
      source TEXT NOT NULL DEFAULT 'manual', fb_id INTEGER NOT NULL DEFAULT 0, by_name TEXT NOT NULL DEFAULT '', by_email TEXT NOT NULL DEFAULT '', at TEXT NOT NULL DEFAULT '')`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS ai_feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, site TEXT NOT NULL DEFAULT '', vote INTEGER NOT NULL, q TEXT NOT NULL DEFAULT '', a TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'open', fact_id INTEGER NOT NULL DEFAULT 0, by_name TEXT NOT NULL DEFAULT '', by_email TEXT NOT NULL DEFAULT '', pos TEXT NOT NULL DEFAULT '',
      at TEXT NOT NULL DEFAULT '', done_by TEXT NOT NULL DEFAULT '', done_at TEXT NOT NULL DEFAULT '')`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS ai_chats (id TEXT PRIMARY KEY, email TEXT NOT NULL, site TEXT NOT NULL DEFAULT '', title TEXT NOT NULL DEFAULT '', msgs TEXT NOT NULL DEFAULT '[]', at TEXT NOT NULL DEFAULT '')`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS ai_chats_me ON ai_chats (email, at)")
  ]);
}

/* ---------- ABCON usage guard ----------
   • Team: Cloudflare gives 10,000 free Neurons a day (resets 00:00 UTC = 03:00 Beirut). ABCON counts what every answer used
     (Cloudflare's own token counts) and closes at 80 % — so the account never goes past the free allowance.
   • Person: at most USER_DAILY questions a day, and USER_BURST questions in USER_WINDOW minutes (asking again and again).
     When a limit is reached ABCON says the exact date and time it is back.
   • The same question again within CACHE_MIN minutes gets the same answer for free (no Neurons, not counted). */
const FREE_NEURONS = 10000, CLOSE_AT = 0.8, USER_DAILY = 15, USER_BURST = 4, USER_WINDOW = 5, CACHE_MIN = 15;
/* Neurons per million tokens (Cloudflare Workers AI price list) — an unknown model is counted at the dearest rate */
const RATES = { "@cf/meta/llama-3.3-70b-instruct-fp8-fast": [26668, 204805], "@cf/meta/llama-3.1-8b-instruct": [25608, 75147],
  "@cf/meta/llama-3.1-8b-instruct-fp8": [13778, 26128], "@cf/meta/llama-3.1-8b-instruct-fp8-fast": [4119, 34868], "@cf/baai/bge-m3": [1075, 0] };
const rateOf = m => RATES[m] || [30000, 210000];
const utcDay = () => new Date().toISOString().slice(0, 10);
const nextReset = () => { const d = new Date(); d.setUTCHours(24, 0, 0, 0); return d.toISOString(); };
const when = iso => { try { const d = new Date(iso), f = o => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Beirut", ...o }).format(d);
  return `${f({ weekday: "short", day: "numeric", month: "short" })} at ${f({ hour: "2-digit", minute: "2-digit", hour12: false }).replace(/^24/, "00")}`; } catch { return ""; } };
const metaGet = async (env, k) => { const r = await env.DB.prepare("SELECT v FROM meta WHERE k = ?").bind(k).first().catch(() => null); return r ? r.v : null; };
const metaSet = (env, k, v) => env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)").bind(k, String(v)).run().catch(() => {});
const budgetOf = env => Math.max(500, Number(env.AI_DAILY_NEURONS) || FREE_NEURONS) * CLOSE_AT;
const RESTING = () => `ABCON is resting — the team has used today's free AI allowance. Back on ${when(nextReset())} (Beirut time).`;
async function teamUsed(env) { return Number(await metaGet(env, `ai:neu:${utcDay()}`)) || 0; }
async function addNeurons(env, n) { if (!(n > 0)) return; const k = `ai:neu:${utcDay()}`; await env.DB.prepare("INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = CAST(CAST(v AS REAL) + ? AS TEXT)").bind(k, String(n), n).run()
  .catch(async () => metaSet(env, k, (await teamUsed(env)) + n)); }
const neuronsOf = (model, tin, tout) => Math.round((tin * rateOf(model)[0] + tout * rateOf(model)[1]) / 1e6 * 100) / 100;
async function userLog(env, me) { let a = []; try { a = JSON.parse(await metaGet(env, `ai:u:${me.email}`) || "[]"); } catch {} const since = Date.parse(utcDay() + "T00:00:00Z"); return a.filter(t => t >= since); }
/* where this person and the team stand — the chat shows it, and it decides whether ABCON may answer */
async function standing(env, me) {
  const log = await userLog(env, me), now = Date.now(), win = log.filter(t => t > now - USER_WINDOW * 60e3).sort((a, b) => a - b);
  const used = await teamUsed(env), budget = budgetOf(env);
  const out = { left: Math.max(0, USER_DAILY - log.length), daily: USER_DAILY, teamPct: Math.min(100, Math.round(used / budget * 100)), resetAt: nextReset() };
  if (used + 150 >= budget) return { ...out, open: false, why: "team", backAt: out.resetAt, msg: RESTING() };
  if (me.role !== "ADMIN" && log.length >= USER_DAILY) return { ...out, open: false, why: "daily", backAt: out.resetAt, msg: `You have asked your ${USER_DAILY} questions for today. ABCON is back for you on ${when(out.resetAt)} (Beirut time).` };
  if (win.length >= USER_BURST) { const back = new Date(win[win.length - USER_BURST] + USER_WINDOW * 60e3 + 1000).toISOString();
    return { ...out, open: false, why: "burst", backAt: back, msg: `You are asking very quickly — take a short break. ABCON is back for you at ${hm(back)} (${when(back)}).` }; }
  return { ...out, open: true };
}
async function countQuestion(env, me) { const log = await userLog(env, me); log.push(Date.now()); await metaSet(env, `ai:u:${me.email}`, JSON.stringify(log.slice(-60))); }
const norm = t => String(t || "").toLowerCase().normalize("NFKC").replace(/[\s\p{P}]+/gu, " ").trim();
async function hash(t) { const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)); return [...new Uint8Array(b)].slice(0, 12).map(x => x.toString(16).padStart(2, "0")).join(""); }
async function precheck(env, model, inChars, maxTokens) {
  const [ri, ro] = rateOf(model);
  if ((await teamUsed(env)) + (inChars / 3 * ri + (maxTokens || 600) * ro) / 1e6 > budgetOf(env) + 1) throw err(RESTING(), 429);
}
const allowanceGone = async (env, msg) => { if (/4006|neurons|daily free allocation/i.test(msg)) { await metaSet(env, `ai:neu:${utcDay()}`, budgetOf(env) * 2); return true; } return false; };

const textOf = r => String((r && (typeof r === "string" ? r : r.response || (r.result && r.result.response)
  || (r.choices && r.choices[0] && (r.choices[0].message && r.choices[0].message.content || r.choices[0].text)))) || "").trim();
/* one answer from Workers AI; what it used is added to the team's count */
async function ask(env, messages, maxTokens, me, models) {
  if (!env.AI) throw err("The hub's AI is not switched on (the AI binding is missing on the Worker — check wrangler.jsonc and redeploy)", 503);
  models = models || [...new Set([env.AI_MODEL || AI_MODEL, AI_FALLBACK])];
  const inChars = messages.reduce((a, m) => a + String(m.content || "").length, 0);
  let last = "";
  for (const model of models) {
    await precheck(env, model, inChars, maxTokens);
    try {
      const r = await env.AI.run(model, { messages, max_tokens: maxTokens || 600, temperature: 0.2 });
      const t = textOf(r), u = (r && r.usage) || {};
      await addNeurons(env, neuronsOf(model, Number(u.prompt_tokens) || Math.ceil(inChars / 3), Number(u.completion_tokens) || Math.ceil(t.length / 3)));
      if (t) return { text: t, model };
      last = `${model}: empty answer`;
    } catch (e) {
      last = `${model}: ${String(e && e.message || e).slice(0, 220)}`;
      console.error("AI", last);
      if (await allowanceGone(env, last)) throw err(RESTING(), 429);
    }
  }
  /* the admin sees Cloudflare's own message, to fix it; everyone else a plain one */
  throw err(me && me.role === "ADMIN" ? `The AI did not answer — Cloudflare said: ${last}` : "ABCON could not answer right now — try again in a minute.", 502);
}
/* the same, written word by word: returns { stream (AI's SSE), model } — the caller counts the Neurons at the end */
async function askStream(env, messages, maxTokens, me, models) {
  if (!env.AI) throw err("The hub's AI is not switched on", 503);
  const inChars = messages.reduce((a, m) => a + String(m.content || "").length, 0);
  let last = "";
  for (const model of models) {
    await precheck(env, model, inChars, maxTokens);
    try { const stream = await env.AI.run(model, { messages, max_tokens: maxTokens, temperature: 0.2, stream: true }); return { stream, model, inChars }; }
    catch (e) { last = `${model}: ${String(e && e.message || e).slice(0, 220)}`; console.error("AI stream", last); if (await allowanceGone(env, last)) throw err(RESTING(), 429); }
  }
  throw err(me && me.role === "ADMIN" ? `The AI did not answer — Cloudflare said: ${last}` : "ABCON could not answer right now — try again in a minute.", 502);
}
/* meaning search: embeddings (bge-m3, multilingual) — tiny cost, counted like everything else */
export async function embedTexts(env, texts) {
  if (!env.AI || !texts.length) return null;
  const chars = texts.reduce((a, t) => a + t.length, 0);
  if ((await teamUsed(env)) + chars / 3 * rateOf(AI_EMBED)[0] / 1e6 > budgetOf(env)) return null;   // near the limit: word search only
  const r = await env.AI.run(AI_EMBED, { text: texts });
  const v = r && (r.data || r.response || (Array.isArray(r) ? r : null));
  await addNeurons(env, neuronsOf(AI_EMBED, Math.ceil(chars / 3), 0));
  return Array.isArray(v) && Array.isArray(v[0]) ? v : null;
}

/* simple question → fast model; analysis → big model */
const BIG = /\b(why|analy[sz]|compare|summar|trend|report|recommend|suggest|plan|write|draft|email|letter|message|explain|all|every|open|pending|still|follow|issue|problem|repeat|how many|list|status|what happened|risk|improve)\b|تحليل|لخص|اكتب|ليش|ليه|شو في|شو صار|كل |مشاكل|اقترح/i;
const isSimple = (q, hist) => q.length <= 90 && !BIG.test(q) && hist.filter(m => m.role === "user").length <= 2;

/* the facts managers taught ABCON (this flagship + all flagships) */
async function taughtFacts(env, site) {
  const r = await rows(env.DB.prepare("SELECT id, site, text, by_name, at FROM ai_facts WHERE status = 'approved' AND (site = '' OR site = ?) ORDER BY id DESC LIMIT 60").bind(site));
  let n = 0; const out = [];
  for (const f of r) { n += f.text.length; if (n > 3500) break; out.push(f); }
  return out;
}

/* policy passages for a question (Policies & Procedures library) */
async function policyContext(env, d, q, me) {
  if (!d.policies) return { text: "", sources: [] };
  let hits = await d.policies(q).catch(() => []);
  if (!hits.length && /[\u0600-\u06FF]/.test(q)) {
    const kw = await ask(env, [{ role: "system", content: "Give 3 to 8 English search keywords for the question, for searching mall policies. Reply with the words only, separated by spaces." }, { role: "user", content: clip(q, 300) }], 30, me, [AI_FAST, AI_FALLBACK]).then(r => r.text).catch(() => "");
    if (kw) hits = await d.policies(kw).catch(() => []);
  }
  hits = hits.slice(0, 4);
  return { sources: hits.map((h, i) => ({ n: `P${i + 1}`, kind: "policy", doc: h.doc, title: h.title, coll: h.collName, section: h.section, page: h.page })),
    text: hits.map((h, i) => `[P${i + 1}] ${h.title} (${h.collName}${h.version ? ", v" + h.version : ""})${h.section ? " · " + clip(h.section, 80) : ""}${h.page ? " · page " + h.page : ""}:\n${clip(h.text, 900)}`).join("\n\n") };
}

const FORMAT = `ANSWER FORMAT (Markdown, always):
## <short title, at most 8 words>
Type: <one of: Policy | Live data | General advice | Mixed>
<the answer: short bullets "- ", a table "| A | B |" for times, figures or lists of items, numbered steps "1." for a procedure; **bold** the key number or time>
> Rule: <the exact rule quoted word for word — only when the answer comes from a POLICIES passage>
Follow-up: <short question 1> | <short question 2> | <short question 3>
- Keep the words "Type:", "> Rule:" and "Follow-up:" in English, even when the answer is in Arabic.
- Cite each POLICIES passage right after the fact it supports: [P1], [P2]. Never cite or mention TAUGHT FACTS.
- No greetings, no filler, no repeating the question. Under 180 words unless a list needs more.`;

/* split the model's text into the answer and the follow-up questions */
function finish(text) {
  const lines = String(text || "").split("\n"); let follow = [];
  for (let i = lines.length - 1; i >= 0 && i >= lines.length - 4; i--) {
    const m = lines[i].match(/^\s*\**follow[- ]?ups?\**\s*:\s*(.+)$/i);
    if (m) { follow = m[1].split("|").map(x => clip(x.replace(/^[-*\d.\s]+/, ""), 90)).filter(Boolean).slice(0, 3); lines.splice(i, 1); break; }
  }
  return { answer: lines.join("\n").trim(), follow };
}

/* what the hub knows today (and the last 30 days) at one flagship, in short lines — only the parts this person may open */
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
    const age = iso => { const n = Math.floor((Date.now() - Date.parse(iso)) / 864e5); return n >= 1 ? `, open ${n} day${n > 1 ? "s" : ""}` : ""; };
    L.push(`Open malfunctions (${mf.length}): ${mf.map(r => `${r.asset || r.category} at ${r.location || "?"} — ${clip(r.description, 80)} [${r.priority}, ${r.status}${r.provider ? ", " + r.provider : ""}, found ${dShort(r.found_at)}${age(r.found_at)}]`).join("; ") || "none"}.`);
    /* memory: the same asset / place breaking again in the last 30 days */
    const rep = await rows(env.DB.prepare(`SELECT COALESCE(NULLIF(asset,''), category) AS a, location, COUNT(*) AS n, MAX(found_at) AS last FROM mf_records
      WHERE site = ? AND deleted = 0 AND found_at >= ? GROUP BY a, location HAVING n >= 2 ORDER BY n DESC LIMIT 10`).bind(site, new Date(Date.now() - 30 * 864e5).toISOString()));
    if (rep.length) L.push(`Repeated malfunctions, last 30 days: ${rep.map(r => `${r.a} at ${r.location || "?"} ×${r.n} (last ${dShort(r.last)})`).join("; ")}.`);
  }
  if (can("feedback")) {
    const since = new Date(Date.parse(day + "T12:00:00Z") - 7 * 864e5).toISOString().slice(0, 10);
    const fb = await rows(env.DB.prepare("SELECT day, time, tenant, category, description, action FROM tenant_feedback WHERE site = ? AND day >= ? ORDER BY day DESC, time DESC LIMIT 30").bind(site, since));
    L.push(`Tenant feedback / violations last 7 days (${fb.length}): ${fb.map(f => `${f.day} ${f.tenant}: ${f.category} — ${clip(f.description, 70)}${f.action ? " (" + f.action + ")" : ""}`).join("; ") || "none"}.`);
    const since30 = new Date(Date.parse(day + "T12:00:00Z") - 30 * 864e5).toISOString().slice(0, 10);
    const rt = await rows(env.DB.prepare(`SELECT tenant, COUNT(*) AS n, GROUP_CONCAT(DISTINCT category) AS cats, MAX(day) AS last FROM tenant_feedback WHERE site = ? AND day >= ? GROUP BY tenant HAVING n >= 2 ORDER BY n DESC LIMIT 10`).bind(site, since30));
    if (rt.length) L.push(`Tenants with repeated feedback / violations, last 30 days: ${rt.map(r => `${r.tenant} ×${r.n} (${clip(r.cats, 60)}; last ${r.last})`).join("; ")}.`);
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
  if (can("layouts")) {   // recycle bins and benches on the Mall Layouts map
    const fu = await rows(env.DB.prepare("SELECT level, kind, label, status FROM layout_pins WHERE site = ? AND kind IN ('bin','bench')").bind(site));
    if (fu.length) {
      const per = {}; for (const f of fu) { per[f.level] = per[f.level] || { bin: 0, bench: 0 }; per[f.level][f.kind]++; }
      const bad = fu.filter(f => f.status && f.status !== "OK");
      L.push(`Recycle bins and benches on the map, per level: ${Object.entries(per).map(([lv, c]) => `${lv}: ${c.bin} bins, ${c.bench} benches`).join("; ")}.${bad.length ? ` Needing action: ${bad.map(f => `${f.kind === "bin" ? "bin" : "bench"} ${f.label || "?"} (${f.level}) ${f.status}`).join("; ")}.` : " All marked OK."}`);
    }
  }
  const base = L.join("\n").slice(0, 11000);
  const ext = d.ext ? await d.ext(site).catch(() => "") : "";   // Snaglist · Incidents · Restroom · Audit databases (read-only)
  return ext ? base + "\n" + ext : base;
}

export async function aiRoute(env, p, method, b, url, d) {
  const { me } = d;
  const site = d.site;
  if (!d.canSite(me, site)) throw err("No access to this flagship", 403);
  const day = d.today(), q = k => url.searchParams.get(k) || "", now = () => new Date().toISOString();
  const teach = !!d.canTeach;
  if (p === "ai/status") {
    const st = await standing(env, me);
    const out = { on: !!env.AI, ...st, model: env.AI_MODEL || AI_MODEL, name: "ABCON", canTeach: teach };
    if (teach) out.reviews = Number(((await env.DB.prepare("SELECT COUNT(*) AS n FROM ai_feedback WHERE status = 'open' AND vote < 0").first().catch(() => null)) || {}).n) || 0;
    if (me.role === "ADMIN") out.neurons = { used: Math.round(await teamUsed(env)), closeAt: budgetOf(env), free: Math.max(500, Number(env.AI_DAILY_NEURONS) || FREE_NEURONS) };
    if (me.role === "ADMIN" && q("test") === "1") {   // /api/ai/status?test=1 — the admin checks the AI in one tap
      try { out.test = { ok: true, answer: (await ask(env, [{ role: "user", content: "Reply with the single word: ready" }], 10, me)).text }; } catch (e) { out.test = { ok: false, error: e.message }; }
    }
    return out;
  }

  /* ----- history: each person's own chats, kept 30 days ----- */
  if (p === "ai/history") return { chats: await rows(env.DB.prepare("SELECT id, site, title, at FROM ai_chats WHERE email = ? ORDER BY at DESC LIMIT 40").bind(me.email)) };
  if (p === "ai/history/get") { const c = await env.DB.prepare("SELECT id, site, title, msgs, at FROM ai_chats WHERE id = ? AND email = ?").bind(q("id"), me.email).first();
    if (!c) throw err("This chat is not in your history any more", 404); let msgs = []; try { msgs = JSON.parse(c.msgs); } catch {} return { chat: { ...c, msgs } }; }
  if (p === "ai/history/save" && method === "POST") {
    const id = String(b.id || "").replace(/[^\w-]/g, "").slice(0, 40); if (!id) throw err("Missing chat id");
    const msgs = (Array.isArray(b.msgs) ? b.msgs : []).filter(m => !m.err).slice(-40).map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content || "").slice(0, 4000),
      ...(m.sources ? { sources: m.sources.slice(0, 8) } : {}), ...(m.follow ? { follow: m.follow.slice(0, 3) } : {}) }));
    const first = msgs.find(m => m.role === "user");
    await env.DB.prepare("INSERT INTO ai_chats (id, email, site, title, msgs, at) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET msgs = excluded.msgs, at = excluded.at WHERE ai_chats.email = excluded.email")
      .bind(id, me.email, site, clip(first ? first.content : "Chat", 80), JSON.stringify(msgs), now()).run();
    env.DB.prepare("DELETE FROM ai_chats WHERE at < ?").bind(new Date(Date.now() - 30 * 864e5).toISOString()).run().catch(() => {});
    return { saved: true };
  }
  if (p === "ai/history/remove" && method === "POST") { await env.DB.prepare("DELETE FROM ai_chats WHERE id = ? AND email = ?").bind(String(b.id || ""), me.email).run(); return { removed: true }; }

  /* ----- 👍 / 👎 on an answer (everyone) ----- */
  if (p === "ai/feedback" && method === "POST") {
    const vote = Number(b.vote) < 0 ? -1 : 1;
    await env.DB.prepare("INSERT INTO ai_feedback (site, vote, q, a, note, status, by_name, by_email, pos, at) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .bind(site, vote, clip(b.q, 600), String(b.a || "").slice(0, 3000), clip(b.note, 600), vote < 0 ? "open" : "ok", me.full_name || me.email, me.email, d.posLabel || me.role, now()).run();
    return { thanks: true };
  }

  /* ----- Teach ABCON + review (Admin, Mall Manager, Operations Manager) ----- */
  if (/^ai\/(facts|fact\/|reviews|review\/)/.test(p)) {
    if (!teach) throw err("Only the Admin, the Mall Manager and the Operations Manager teach ABCON", 403);
    if (p === "ai/facts") return { facts: await rows(env.DB.prepare("SELECT id, site, text, source, by_name, at FROM ai_facts WHERE status = 'approved' ORDER BY id DESC LIMIT 300")), sites: d.sites || {} };
    if (p === "ai/fact/save" && method === "POST") {
      const text = clip(b.text, 500); if (text.length < 8) throw err("Write the fact (one or two sentences)");
      const fs = b.site === "" || b.site === "ALL" ? "" : (d.canSite(me, b.site) ? b.site : site);
      if (b.id) await env.DB.prepare("UPDATE ai_facts SET text = ?, site = ?, by_name = ?, by_email = ?, at = ? WHERE id = ?").bind(text, fs, me.full_name, me.email, now(), Number(b.id)).run();
      else await env.DB.prepare("INSERT INTO ai_facts (site, text, status, source, by_name, by_email, at) VALUES (?,?,'approved','manual',?,?,?)").bind(fs, text, me.full_name, me.email, now()).run();
      return { saved: true };
    }
    if (p === "ai/fact/remove" && method === "POST") { await env.DB.prepare("DELETE FROM ai_facts WHERE id = ?").bind(Number(b.id)).run(); return { removed: true }; }
    if (p === "ai/reviews") return { open: await rows(env.DB.prepare("SELECT id, site, q, a, note, by_name, pos, at FROM ai_feedback WHERE status = 'open' AND vote < 0 ORDER BY id DESC LIMIT 100")),
      done: await rows(env.DB.prepare("SELECT id, site, q, status, done_by, done_at FROM ai_feedback WHERE vote < 0 AND status IN ('fixed','dismissed') ORDER BY done_at DESC LIMIT 20")),
      liked: Number(((await env.DB.prepare("SELECT COUNT(*) AS n FROM ai_feedback WHERE vote > 0 AND at >= ?").bind(new Date(Date.now() - 30 * 864e5).toISOString()).first().catch(() => null)) || {}).n) || 0 };
    if (p === "ai/review/fix" && method === "POST") {
      const f = await env.DB.prepare("SELECT id, site FROM ai_feedback WHERE id = ?").bind(Number(b.id)).first(); if (!f) throw err("Not found", 404);
      const text = clip(b.text, 500); if (text.length < 8) throw err("Write the correct answer as a fact");
      const fs = b.site === "" || b.site === "ALL" ? "" : f.site;
      const r = await env.DB.prepare("INSERT INTO ai_facts (site, text, status, source, fb_id, by_name, by_email, at) VALUES (?,?,'approved','feedback',?,?,?,?)").bind(fs, text, f.id, me.full_name, me.email, now()).run();
      await env.DB.prepare("UPDATE ai_feedback SET status = 'fixed', fact_id = ?, done_by = ?, done_at = ? WHERE id = ?").bind(r.meta.last_row_id, me.full_name, now(), f.id).run();
      return { fixed: true };
    }
    if (p === "ai/review/dismiss" && method === "POST") { await env.DB.prepare("UPDATE ai_feedback SET status = 'dismissed', done_by = ?, done_at = ? WHERE id = ?").bind(me.full_name, now(), Number(b.id)).run(); return { dismissed: true }; }
    throw err("Unknown request", 404);
  }

  if (method !== "POST") throw err("Unknown request", 404);

  if (p === "ai/chat") {
    const hist = (Array.isArray(b.messages) ? b.messages : []).filter(m => !m.err).slice(-8).map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: clip(m.content, 700) })).filter(m => m.content);
    if (!hist.length || hist[hist.length - 1].role !== "user") throw err("Write your question");
    const qu = hist[hist.length - 1].content, prevQ = [...hist].reverse().slice(1).find(m => m.role === "user" && norm(m.content) !== norm(qu));   // the same question asked twice in a row counts as one
    /* the same question again (within CACHE_MIN minutes, same flagship) → the same answer, free */
    const ck = `ai:c:${site}:${await hash(norm(qu) + "|" + norm(prevQ && prevQ.content))}`;
    try { const c = JSON.parse(await metaGet(env, ck) || "null");
      if (c && Date.now() - c.t < CACHE_MIN * 60e3) { const st = await standing(env, me); return { answer: c.a, sources: c.s || [], follow: c.f || [], cached: true, cachedAt: hm(new Date(c.t).toISOString()), left: st.left, teamPct: st.teamPct }; } } catch {}
    const st = await standing(env, me);
    if (!st.open) throw Object.assign(err(st.msg, 429), { backAt: st.backAt });
    const routeQ = [prevQ && prevQ.content, qu].filter(Boolean).join(" \n ");   // a follow-up ("and last month?") keeps the subject of the question before
    const [facts0, pol, taught, routed] = await Promise.all([siteFacts(env, site, me, d), policyContext(env, d, qu, me), taughtFacts(env, site),
      d.people ? routedFacts(env, routeQ, me, d, site).catch(e => { console.error("ai router", e && e.message); return { text: "" }; }) : { text: "" }]);
    const facts = routed.text ? `${facts0.slice(0, 5000)}\n${routed.text}` : facts0;
    const sys = `Your name is ABCON (ABC Operations Control). You are the assistant of the ABC Operations Hub, used by the mall operations team of ABC (shopping malls and department stores in Lebanon). If asked who you are, say you are ABCON, the ABC Operations assistant.
Sources, most trusted first:
1. TAUGHT FACTS — confirmed by ABC management; they override everything else. Use them silently: state the information as a plain fact, never cite them, never say "taught fact", "T1" or that you were taught it.
2. POLICIES — passages from the Policies & Procedures library. Quote the exact rule (hours, amounts, approvals); never invent a rule. If they do not cover the question, say the library has nothing on it and who to ask (Mall Management).
3. DATA — the flagship's live hub data today and the last 30 days, plus the slices fetched for this question (other flagships, other periods, people, portal, KPIs…). Never invent names, times or numbers; if a figure is not in the DATA, say the hub has no data on it. People: give names and positions only (no phone numbers or emails). For a broad question ("what is still open?", "any issues?") go through ALL of the DATA and list every open or pending item, grouped. Point out repeated problems (from the 30-day lines).
4. Your general know-how — only for how to handle a situation or word a message; mark it "Type: General advice".
Answer in the language of the question (English, Arabic or Lebanese Arabic).
${FORMAT}
The person asking: ${me.full_name} (${d.posLabel || me.role}).
${taught.length ? `TAUGHT FACTS:\n${taught.map((f, i) => `[T${i + 1}] ${f.text}`).join("\n")}\n` : ""}${pol.text ? `POLICIES:\n${pol.text}\n` : ""}DATA:
${facts}`;
    const models = isSimple(qu, hist) ? [AI_FAST, env.AI_MODEL || AI_MODEL] : [env.AI_MODEL || AI_MODEL, AI_FALLBACK];
    const msgs = [{ role: "system", content: sys }, ...hist], maxT = 650;
    const after = async (raw, model) => {
      const fin = finish(raw), follow = fin.follow;
      const answer = fin.answer.replace(/ ?\[T\d+\]/g, "").replace(/ ?\(taught facts?\)/gi, "");   // taught facts are used, never shown
      const used = new Set(answer.match(/\[P\d\]/g) || []);
      const sources = pol.sources.filter(x => used.has(`[${x.n}]`));
      await countQuestion(env, me);
      await metaSet(env, ck, JSON.stringify({ a: answer, s: sources, f: follow, t: Date.now() }));
      env.DB.prepare("DELETE FROM meta WHERE k >= 'ai:c:' AND k < 'ai:c;' AND CAST(json_extract(v, '$.t') AS INTEGER) < ?").bind(Date.now() - 2 * CACHE_MIN * 60e3).run().catch(() => {});
      const s2 = await standing(env, me);
      return { answer, sources, follow, model: model === AI_FAST ? "fast" : "full", left: s2.left, teamPct: s2.teamPct };
    };
    if (!b.stream) { const r = await ask(env, msgs, maxT, me, models); return after(r.text, r.model); }
    /* word by word: Server-Sent Events — {t:"…"} pieces, then {done:true, answer, sources, follow, left, teamPct} */
    const { stream, model, inChars } = await askStream(env, msgs, maxT, me, models);
    const enc = new TextEncoder(), dec = new TextDecoder(), ts = new TransformStream(), w = ts.writable.getWriter();
    const send = o => w.write(enc.encode(`data: ${JSON.stringify(o)}\n\n`)).catch(() => {});
    (async () => {
      let text = "", buf = "", usage = null;
      try {
        const rd = stream.getReader();
        for (;;) { const { value, done } = await rd.read(); if (done) break;
          buf += dec.decode(value, { stream: true }); let i;
          while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
            if (!line.startsWith("data:")) continue; const v = line.slice(5).trim(); if (!v || v === "[DONE]") continue;
            try { const j = JSON.parse(v); if (j.usage) usage = j.usage; const t = typeof j.response === "string" ? j.response : (j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content) || "";
              if (t) { text += t; await send({ t }); } } catch {} } }
        await addNeurons(env, neuronsOf(model, Number(usage && usage.prompt_tokens) || Math.ceil(inChars / 3), Number(usage && usage.completion_tokens) || Math.ceil(text.length / 3)));
        if (!text.trim()) await send({ err: "ABCON could not answer right now — try again in a minute." });
        else await send({ done: true, ...(await after(text, model)) });
      } catch (e) { console.error("AI stream", e && e.message); await send({ err: text ? "The answer was cut — ask again." : "ABCON could not answer right now — try again in a minute." }); }
      await w.close().catch(() => {});
    })();
    return new Response(ts.readable, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } });
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
    const r = await ask(env, [{ role: "system", content: sys }, { role: "user", content: `Write the shift summary for ${day} at ${d.hm()}.` }], 800, me);
    await countQuestion(env, me);
    return { text: r.text, at: d.hm(), by: me.full_name };
  }
  throw err("Unknown request", 404);
}
