/* ABC Operations Hub — shared helpers for the built-in tools (same sign-in as the hub) */
(function(){
  try { const t = localStorage.getItem("hub.theme"); if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t); } catch {}
  addEventListener("storage", e => { if (e.key === "hub.theme") { const t = e.newValue; t === "light" || t === "dark" ? document.documentElement.setAttribute("data-theme", t) : document.documentElement.removeAttribute("data-theme"); } });
})();
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const initials = s => String(s || "").split(/\s+/).filter(Boolean).map(w => w[0]).join("").slice(0, 2).toUpperCase();
async function api(path, body){
  const r = await fetch("/api/" + path, body === undefined ? { credentials: "same-origin" }
    : { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch {}
  if (r.status === 401){ document.body.innerHTML = `<div class="empty">Your hub session has ended. <a href="/" target="_top">Sign in again</a>.</div>`; throw new Error("Not signed in"); }
  if (!r.ok || !j || !j.ok) throw new Error((j && j.error) || `Error ${r.status}`);
  return j.data;
}
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
