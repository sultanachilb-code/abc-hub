/* ABC Loading Gate — helpers for the scanner page on its own link (stands in for the hub's tools/common.js).
   • First use: the phone is paired with the one-time code a manager makes in the hub (Loading Gate → Loading-area phones)
   • Each shift: the agent writes his name (kept on the phone, changeable from the top bar)
   • Decisions taken without signal wait on the phone and are sent when the signal is back */
(function(){ try { document.documentElement.setAttribute("data-theme", "light"); } catch {} })();
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function toast(msg, err){
  let t = $("#toast"); if (!t){ t = document.createElement("div"); t.id = "toast"; t.className = "toast"; document.body.append(t); }
  t.textContent = msg; t.classList.toggle("err", !!err); t.classList.add("on");
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("on"), 2800);
}
const D = {
  parse: d => new Date(d + "T12:00:00Z"),
  str: dt => dt.toISOString().slice(0, 10),
  add(d, n){ const x = D.parse(d); x.setUTCDate(x.getUTCDate() + n); return D.str(x); },
  fmt: (d, o) => d ? D.parse(d).toLocaleDateString("en-GB", Object.assign({ timeZone: "UTC", day: "numeric", month: "short" }, o || {})) : "",
  long: d => d ? D.parse(d).toLocaleDateString("en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" }) : ""
};

/* ---------- this phone ---------- */
const GK = { user: "gate.user", token: "gate.token", agent: "gate.agent", agentDay: "gate.agentDay", info: "gate.info", outbox: "gate.outbox" };
const ls = { get(k){ try { return localStorage.getItem(k) || ""; } catch { return ""; } }, set(k, v){ try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch {} } };
let GINFO = null; try { GINFO = JSON.parse(ls.get(GK.info) || "null"); } catch {}
const beirutDay = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Beirut" }).format(new Date());

/* manifest + offline shell (Add to Home Screen) */
(function(){
  const l = document.createElement("link"); l.rel = "manifest"; l.href = "/manifest.webmanifest"; document.head.append(l);
  if ("serviceWorker" in navigator) addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
})();

function gateScreen(html){
  let o = $("#gateScreen");
  if (!o){ o = document.createElement("div"); o.id = "gateScreen";
    o.style.cssText = "position:fixed;inset:0;z-index:80;background:var(--paper);display:flex;align-items:center;justify-content:center;padding:20px;overflow:auto";
    document.body.append(o); }
  o.innerHTML = `<div class="card" style="width:min(420px,100%);padding:24px 20px">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px"><img src="/icons/abc-48.png" alt="" width="36" height="36" style="border-radius:9px"><b style="font-size:1.1rem">ABC Loading Gate</b></div>${html}</div>`;
  return o;
}
const closeScreen = () => { const o = $("#gateScreen"); if (o) o.remove(); };

const standalone = () => { try { return matchMedia("(display-mode: standalone)").matches || navigator.standalone === true; } catch { return false; } };
function loginScreen(msg){
  return new Promise(res => {
    const tip = standalone() ? "" : `<div style="background:#FFF7E0;color:#6A4B00;border-radius:12px;padding:10px 12px;font-size:.8rem;line-height:1.45;margin-top:14px">📌 Share → <b>Add to Home Screen</b>, then always open the Gate from that icon — not from WhatsApp.<br><span class="ar" dir="rtl">أضف البوابة إلى الشاشة الرئيسية وافتحها دائماً من الأيقونة</span></div>`;
    gateScreen(`<p style="font-weight:800;margin-bottom:4px">Sign in</p>
      <p class="muted" style="font-size:.86rem;line-height:1.5;margin-bottom:12px">Use the gate account from the mall manager.<br><span class="ar" dir="rtl">ادخل اسم المستخدم وكلمة السر</span></p>
      ${msg ? `<p style="color:var(--alert);font-weight:700;font-size:.86rem;margin-bottom:10px">${esc(msg)}</p>` : ""}
      <label class="muted" style="font-size:.78rem;font-weight:700">Username</label>
      <input class="inp" id="glUser" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" value="${esc(ls.get(GK.user))}" style="width:100%;height:50px;font-size:1.1rem;margin:4px 0 10px">
      <label class="muted" style="font-size:.78rem;font-weight:700">Password</label>
      <div style="position:relative;margin-top:4px"><input class="inp" id="glPw" type="password" autocomplete="current-password" style="width:100%;height:50px;font-size:1.1rem;padding-right:64px">
        <button type="button" id="glShow" style="position:absolute;right:6px;top:7px;height:36px;border:0;background:none;color:var(--brand-2);font-weight:800">Show</button></div>
      <button class="btn" id="glGo" style="width:100%;height:50px;margin-top:14px;font-size:1rem">Sign in · دخول</button>
      <p class="muted" style="font-size:.76rem;line-height:1.45;margin-top:10px">Stays signed in on this phone for 90 days of use. No signal never signs you out.</p>${tip}`);
    $("#glShow").onclick = () => { const p = $("#glPw"); p.type = p.type === "password" ? "text" : "password"; $("#glShow").textContent = p.type === "password" ? "Show" : "Hide"; };
    const go = async () => {
      const username = $("#glUser").value.trim(), password = $("#glPw").value;
      if (!username || !password) return toast("Write the username and the password", true);
      $("#glGo").disabled = true;
      try {
        const r = await fetch("/api/login", { method: "POST", headers: { "content-type": "application/json", "x-gate-agent": encodeURIComponent(ls.get(GK.agent)) }, body: JSON.stringify({ username, password }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.ok) throw new Error(j.error || `Error ${r.status}`);
        ls.set(GK.user, username.toLowerCase()); ls.set(GK.token, j.data.token);
        GINFO = { site: j.data.site, siteName: j.data.siteName, device: j.data.device }; ls.set(GK.info, JSON.stringify(GINFO));
        if (location.hash) history.replaceState(null, "", "/");
        res();
      } catch (e){ $("#glGo").disabled = false; toast(navigator.onLine ? e.message : "No signal — signing in needs a connection", true); }
    };
    $("#glGo").onclick = go; $("#glPw").onkeydown = e => { if (e.key === "Enter") go(); };
    $("#glUser").onkeydown = e => { if (e.key === "Enter") $("#glPw").focus(); };
    setTimeout(() => (ls.get(GK.user) ? $("#glPw") : $("#glUser")).focus(), 50);
  });
}
/* the page's storage was cleared but the cookie of this link may still hold the sign-in */
async function fromCookie(){
  try {
    const r = await fetch("/api/me", { headers: { "x-gate-agent": encodeURIComponent(ls.get(GK.agent)) } });
    if (r.status === 401) return false;
    const j = await r.json().catch(() => null);
    if (r.ok && j && j.ok){ ls.set(GK.token, "cookie"); GINFO = { site: j.data.site, siteName: j.data.siteName, device: j.data.device }; ls.set(GK.info, JSON.stringify(GINFO)); return true; }
    return false;
  } catch { return false; }
}
function agentScreen(){
  return new Promise(res => {
    gateScreen(`<p style="font-weight:800;margin-bottom:4px">Who is on duty?</p>
      <p class="muted" style="font-size:.86rem;line-height:1.5;margin-bottom:14px">${esc(GINFO ? GINFO.siteName + " · " + GINFO.device : "")}<br><span class="ar" dir="rtl">اكتب اسمك</span></p>
      <input class="inp" id="gaName" autocomplete="name" placeholder="Your full name" value="${esc(ls.get(GK.agent))}" style="width:100%;height:50px;font-size:1.1rem">
      <button class="btn" id="gaGo" style="width:100%;height:50px;margin-top:12px;font-size:1rem">Start · ابدأ</button>`);
    const go = () => { const n = $("#gaName").value.trim().replace(/\s+/g, " "); if (n.length < 3) return toast("Write your full name", true);
      ls.set(GK.agent, n.slice(0, 60)); ls.set(GK.agentDay, beirutDay()); res(); };
    $("#gaGo").onclick = go; $("#gaName").onkeydown = e => { if (e.key === "Enter") go(); };
    setTimeout(() => $("#gaName").focus(), 50);
  });
}
let READY = null;
function ready(){
  if (READY) return READY;
  READY = (async () => {
    if (document.readyState === "loading") await new Promise(r => addEventListener("DOMContentLoaded", r, { once: true }));
    if (/pair=/.test(location.hash)) history.replaceState(null, "", "/");   // old pairing links are retired
    if (!ls.get(GK.token) && !(await fromCookie())) await loginScreen();
    if (!ls.get(GK.agent) || ls.get(GK.agentDay) !== beirutDay()) await agentScreen();   // the name is asked again every day
    closeScreen();
  })();
  return READY;
}
ready();

/* ---------- calls to the hub (through this link only) ---------- */
function headers(){
  const t = ls.get(GK.token), h = { "content-type": "application/json", "x-gate-agent": encodeURIComponent(ls.get(GK.agent)) };
  if (/^[0-9a-f]{64}$/.test(t)) h.authorization = "Bearer " + t;   // otherwise the link's cookie carries the sign-in
  return h;
}
async function apiRaw(p, body){
  const r = await fetch("/api/" + p, body === undefined ? { headers: headers() } : { method: "POST", headers: headers(), body: JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch {}
  /* signed out only when the hub says so clearly (JSON answer, 401) — no signal / server trouble keep the sign-in */
  if (r.status === 401 && j && j.ok === false){ ls.set(GK.token, ""); READY = null; await loginScreen(j.error); closeScreen(); location.reload(); throw Object.assign(new Error("Signed out"), { status: 401 }); }
  if (!r.ok || !j || !j.ok){ const e = new Error((j && j.error) || `Error ${r.status}`); e.status = r.status; throw e; }
  return j.data;
}
/* the scanner page speaks the hub's paths (ops/context, ops/gate/…): map them to this link */
async function api(path, body){
  await ready();
  const q = path.indexOf("?"), base = q < 0 ? path : path.slice(0, q), qs = q < 0 ? "" : path.slice(q);
  if (/^ops\/context/.test(base)){
    try { const m = await apiRaw("me"); GINFO = { site: m.site, siteName: m.siteName, device: m.device }; ls.set(GK.info, JSON.stringify(GINFO)); }
    catch (e){ if (e.status) throw e; if (!GINFO) throw new Error("No signal — open the Loading Gate again when you have signal."); }
    return { site: GINFO.site, siteName: GINFO.siteName, canPickSite: false, sites: {}, today: beirutDay(), me: { name: ls.get(GK.agent) } };
  }
  const m = base.match(/^ops\/gate\/(lookup|decide|day|cleaner|cleaner-in)$/);
  if (!m) throw new Error("Not available on the Loading Gate link");
  try { return await apiRaw(m[1] + qs, body); }
  catch (e){
    if (e.status) throw e;
    if (m[1] === "decide"){   /* no signal: keep the decision on the phone */
      const ob = outRead().filter(x => x.clientId !== body.clientId); ob.push({ clientId: body.clientId, body, agent: ls.get(GK.agent) }); outWrite(ob);
      return { queued: true };
    }
    if (m[1] === "day") return { day: beirutDay(), reasons: [], list: [], counts: { in: 0, out: 0, workers: 0 } };
    throw new Error("No signal");
  }
}
function outRead(){ try { return JSON.parse(ls.get(GK.outbox) || "[]"); } catch { return []; } }
function outWrite(q){ ls.set(GK.outbox, q.length ? JSON.stringify(q.slice(-100)) : ""); offBadge(); }
let flushing = false;
async function offFlush(){
  if (flushing || !navigator.onLine || !ls.get(GK.token)) return;
  const q = outRead(); if (!q.length) return offBadge();
  flushing = true; let sent = 0;
  for (const x of q){
    try {
      const r = await fetch("/api/decide", { method: "POST", headers: { ...headers(), "x-gate-agent": encodeURIComponent(x.agent || ls.get(GK.agent)) }, body: JSON.stringify(x.body) });
      const j = await r.json().catch(() => null);
      if (!r.ok && (r.status >= 500 || r.status === 401)) break;   // keep it on the phone until it can be sent
      outWrite(outRead().filter(y => y.clientId !== x.clientId));
      if (r.ok && j && j.ok){ sent++; dispatchEvent(new CustomEvent("hub-synced", { detail: { path: "ops/gate/decide", body: x.body, result: j.data } })); }
      else toast(`A decision saved offline could not be sent: ${(j && j.error) || r.status}`, true);
    } catch { break; }
  }
  flushing = false; offBadge();
  if (sent) toast(`Back online — ${sent} decision${sent === 1 ? "" : "s"} sent`);
}
function offBadge(){
  let b = $("#offBadge"); const n = outRead().length, off = !navigator.onLine;
  if (!n && !off){ if (b) b.remove(); return; }
  if (!b){ b = document.createElement("div"); b.id = "offBadge"; b.className = "offb"; document.body && document.body.append(b); }
  b.textContent = off ? `Offline${n ? ` · ${n} decision${n === 1 ? "" : "s"} saved on this phone` : ""}` : `Sending ${n} decision${n === 1 ? "" : "s"}…`;
}
addEventListener("online", () => { offBadge(); offFlush(); });
addEventListener("offline", offBadge);
addEventListener("load", () => { offBadge(); offFlush(); });
setInterval(offFlush, 60000);

/* top bar: flagship + who is on duty (tap to change) */
function siteSelect(ctx){
  setTimeout(() => { const b = $("#gAgent"); if (b) b.onclick = async () => { ls.set(GK.agentDay, ""); READY = null; await ready(); location.reload(); }; }, 0);
  return `<span class="pill brand">${esc(ctx.siteName)}</span> <button class="pill" id="gAgent" title="Change the agent on duty">👤 ${esc(ls.get(GK.agent))}</button>`;
}
