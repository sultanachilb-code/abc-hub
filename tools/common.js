/* ABC Operations Hub — shared helpers for the built-in tools (same sign-in as the hub) */
(function(){
  /* Light unless the person chose Dark or Automatic in the hub's Settings */
  const read = v => { try { v = JSON.parse(v); } catch {} return v || "light"; };
  const apply = t => t === "light" || t === "dark" ? document.documentElement.setAttribute("data-theme", t) : document.documentElement.removeAttribute("data-theme");
  try { apply(read(localStorage.getItem("hub.theme"))); } catch { apply("light"); }
  addEventListener("storage", e => { if (e.key === "hub.theme") apply(read(e.newValue)); });
})();
const $ = s => document.querySelector(s);
/* Downloads feature: every file a tool gives you is also listed in Downloads (tools/hubdl.js) */
(() => { if (window.HubDL) return; const sc = document.createElement("script"); sc.src = "/tools/hubdl.js"; document.head.append(sc); })();
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const initials = s => String(s || "").split(/\s+/).filter(Boolean).map(w => w[0]).join("").slice(0, 2).toUpperCase();
/* ---------- works offline ----------
   Pages opened before keep their last data on this device; checklists and handovers saved without signal
   wait on the device and are sent as soon as the connection is back. */
const OFF = {
  cacheable: /^ops\/(context|forms\/(meta|new|get|list|tenants)|handover\/(list|get|new|live))\b/,
  queueable: /^ops\/((forms|handover)\/save|gate\/decide)$/,   /* Loading Gate: decisions taken without signal are sent later */
  key: "hub.outbox"
};
function offRead(){ try { return JSON.parse(localStorage.getItem(OFF.key) || "[]"); } catch { return []; } }
function offWrite(q){ try { localStorage.setItem(OFF.key, JSON.stringify(q)); } catch {} offBadge(); }
function offKey(path, b){ return path + "|" + (b.site || "") + "|" + (b.clientId || b.id || `${b.form || ""}|${b.day || ""}|${(b.header && b.header.tenant) || ""}`); }
async function apiRaw(path, body){
  const r = await fetch("/api/" + path, body === undefined ? { credentials: "same-origin" }
    : { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch {}
  if (r.status === 401){ document.body.innerHTML = `<div class="empty">Your hub session has ended. <a href="/" target="_top">Sign in again</a>.</div>`; throw new Error("Not signed in"); }
  if (!r.ok || !j || !j.ok) { const e = new Error((j && j.error) || `Error ${r.status}`); e.status = r.status; e.extra = j || {}; throw e; }
  return j.data;
}
async function api(path, body){
  try {
    const d = await apiRaw(path, body);
    if (body === undefined && OFF.cacheable.test(path)) { try {
      const t = JSON.stringify(d); if (t.length < 400000) localStorage.setItem("hub.c:" + path, t);
      /* the record opened from "new" is also reachable by its id when the page is reopened offline */
      const site = (path.match(/[?&]site=(\w+)/) || [])[1] || "";
      if (/^ops\/forms\/new/.test(path) && d.run && d.run.id) localStorage.setItem(`hub.c:ops/forms/get?id=${d.run.id}&site=${site}`, JSON.stringify({ run: d.run }));
      if (/^ops\/handover\/new/.test(path) && d.handover && d.handover.id) localStorage.setItem(`hub.c:ops/handover/get?id=${d.handover.id}`, JSON.stringify({ handover: d.handover, can: d.can }));
    } catch {} }
    return d;
  } catch (e){
    if (e.status || e.message === "Not signed in") throw e;          /* the server answered: a real error */
    if (body === undefined){
      let c = null; try { c = localStorage.getItem("hub.c:" + path);
        if (!c && /^ops\/context/.test(path)) { const k = Object.keys(localStorage).find(x => x.startsWith("hub.c:ops/context")); c = k ? localStorage.getItem(k) : null; } } catch {}
      if (c){ offBadge(true); return JSON.parse(c); }
      throw new Error("You are offline and this page has not been opened on this device before.");
    }
    if (OFF.queueable.test(path)){
      const q = offRead().filter(x => x.k !== offKey(path, body));
      q.push({ k: offKey(path, body), path, body, at: new Date().toISOString() }); offWrite(q);
      return { queued: true, offline: true, id: body.id || 0, status: body.submit ? "waiting" : "draft", saved: true, done: 0, total: 0, issues: 0 };
    }
    throw new Error("You are offline — try again when you have signal.");
  }
}
let offBusy = false;
async function offFlush(){
  if (offBusy || !navigator.onLine) return;
  const q = offRead(); if (!q.length) return offBadge();
  offBusy = true; let sent = 0;
  for (const x of q){
    try { const r = await apiRaw(x.path, x.body); sent++; offWrite(offRead().filter(y => y.k !== x.k));
      dispatchEvent(new CustomEvent("hub-synced", { detail: { path: x.path, body: x.body, result: r } })); }
    catch (e){ if (!e.status) break; offWrite(offRead().filter(y => y.k !== x.k)); toast(`A change saved offline could not be sent: ${e.message}`, true); }
  }
  offBusy = false; offBadge();
  if (sent) toast(`Back online — ${sent} saved change${sent === 1 ? "" : "s"} sent`);
}
function offBadge(stale){
  let b = document.getElementById("offBadge");
  const n = offRead().length, off = !navigator.onLine;
  if (!n && !off && !stale){ if (b) b.remove(); return; }
  if (!b){ b = document.createElement("div"); b.id = "offBadge"; b.className = "offb noprint"; document.body && document.body.append(b); }
  b.textContent = off ? `Offline${n ? ` · ${n} change${n === 1 ? "" : "s"} saved on this device` : " · showing the last saved data"}` : n ? `Sending ${n} change${n === 1 ? "" : "s"}…` : "Showing the last saved data";
}
addEventListener("online", () => { offBadge(); offFlush(); });
addEventListener("offline", () => offBadge());
addEventListener("load", () => { offBadge(); offFlush(); setInterval(offFlush, 30000); });
function toast(msg, err){
  let t = $("#toast"); if (!t){ t = document.createElement("div"); t.id = "toast"; t.className = "toast"; document.body.append(t); }
  t.textContent = msg; t.classList.toggle("err", !!err); t.classList.add("on");
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("on"), 2600);
}
/* dates are handled as plain YYYY-MM-DD strings in Beirut time */
const D = {
  parse: d => new Date(d + "T12:00:00Z"),
  str: dt => dt.toISOString().slice(0, 10),
  add(d, n){ const x = D.parse(d); x.setUTCDate(x.getUTCDate() + n); return D.str(x); },
  monday(d){ const x = D.parse(d); const k = (x.getUTCDay() + 6) % 7; x.setUTCDate(x.getUTCDate() - k); return D.str(x); },
  fmt: (d, o) => d ? D.parse(d).toLocaleDateString("en-GB", Object.assign({ timeZone: "UTC", day: "numeric", month: "short" }, o || {})) : "",
  long: d => d ? D.parse(d).toLocaleDateString("en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" }) : "",
  dow: d => D.parse(d).toLocaleDateString("en-GB", { timeZone: "UTC", weekday: "short" })
};
/* flagship picker for administrators; everyone else is fixed to their own flagship */
function siteSelect(ctx, onChange){
  if (!ctx.canPickSite) return `<span class="pill brand">${esc(ctx.siteName)}</span>`;
  setTimeout(() => { const s = $("#siteSel"); if (s) s.onchange = () => onChange(s.value); }, 0);
  return `<select class="sel" id="siteSel" aria-label="Flagship">${Object.entries(ctx.sites).map(([c, n]) => `<option value="${c}" ${c === ctx.site ? "selected" : ""}>${esc(n)}</option>`).join("")}</select>`;
}
function confirmBox(title, text, okLabel){
  return new Promise(res => {
    let d = $("#cfm"); if (!d){ d = document.createElement("dialog"); d.id = "cfm"; document.body.append(d); }
    d.innerHTML = `<div class="dlg-h"><b>${esc(title)}</b></div><div class="dlg-b"><p class="muted" style="line-height:1.5">${text}</p></div>
      <div class="dlg-f"><button class="btn ghost" data-v="0">Cancel</button><button class="btn" data-v="1">${esc(okLabel || "OK")}</button></div>`;
    d.onclick = e => { const b = e.target.closest("[data-v]"); if (b || e.target === d){ d.close(); res(!!(b && b.dataset.v === "1")); } };
    d.showModal();
  });
}

/* ---------- Export to Excel: every tool with a table gets an "Excel" button in its top bar ---------- */
function xlsxReady(){
  return window.XLSX ? Promise.resolve() : new Promise((res, rej) => { const sc = document.createElement("script"); sc.src = "/tools/xlsx.full.min.js"; sc.onload = res; sc.onerror = () => rej(new Error("Could not load the Excel writer")); document.head.append(sc); });
}
function tableTitle(t, i){
  let el = t; for (let n = 0; n < 6 && el; n++){ let p = el.previousElementSibling;
    while (p){ const h = p.matches("h1,h2,h3,h4,.hd,.lbl") ? p : p.querySelector && p.querySelector("h2,h3,h4,.hd");
      if (h && h.textContent.trim()) return h.textContent.trim(); p = p.previousElementSibling; }
    el = el.parentElement; if (el) { const h = el.querySelector(":scope > h2, :scope > h3"); if (h && !t.contains(h)) return h.textContent.trim(); } }
  return `Sheet ${i + 1}`;
}
async function exportExcel(){
  const tables = [...document.querySelectorAll("#app table, .wrap table")].filter(t => t.offsetParent !== null && t.rows.length > 1 && !t.closest("dialog"));
  if (!tables.length) return toast("There is no list on this page to export", true);
  try { await xlsxReady(); } catch (e){ return toast(e.message, true); }
  const wb = XLSX.utils.book_new(), used = new Set();
  tables.forEach((t, i) => {
    const c = t.cloneNode(true);
    c.querySelectorAll("input,select,textarea").forEach((f, k) => { const src = t.querySelectorAll("input,select,textarea")[k];
      const v = src.tagName === "SELECT" ? (src.options[src.selectedIndex] || {}).text || "" : src.type === "checkbox" ? (src.checked ? "✓" : "") : src.value;
      f.replaceWith(document.createTextNode(v)); });
    c.querySelectorAll("button").forEach(b => { if (!b.textContent.trim() || b.textContent.trim() === "×") b.remove(); });
    let name = tableTitle(t, i).replace(/[\\/?*\[\]:]/g, " ").slice(0, 28) || `Sheet ${i + 1}`, n = 2, base = name;
    while (used.has(name)) name = `${base.slice(0, 25)} ${n++}`; used.add(name);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.table_to_sheet(c, { raw: false }), name);
  });
  const title = (document.title || "ABC").replace(/ · ABC$/, "").replace(/[\\/:*?"<>|]/g, "-");
  XLSX.writeFile(wb, `${title} ${new Date().toISOString().slice(0, 10)}.xlsx`);
}
(function excelButton(){
  const add = () => {
    const top = document.querySelector(".top"); if (!top || document.getElementById("xlBtn")) return;
    const b = document.createElement("button"); b.id = "xlBtn"; b.className = "btn ghost small noprint hidden"; b.type = "button"; b.textContent = "⤓ Excel"; b.title = "Export the lists on this page to Excel";
    b.onclick = exportExcel; top.append(b);
    const sync = () => b.classList.toggle("hidden", ![...document.querySelectorAll("#app table, .wrap table")].some(t => t.offsetParent !== null && t.rows.length > 1 && !t.closest("dialog")));
    new MutationObserver(() => { clearTimeout(b._t); b._t = setTimeout(sync, 200); }).observe(document.body, { childList: true, subtree: true });
    sync();
  };
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", add) : add();
})();
