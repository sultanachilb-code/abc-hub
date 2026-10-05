/* =====================================================================
   DOWNLOADS — every file the hub gives you is also kept on this device (like Chrome's Downloads page)
   See docs/FEATURE-downloads.md

   Loaded by the hub and by every tool page (through common.js). It watches:
     • files the page builds itself (Excel exports, .eml emails, CSV) — any <a download> with a blob:/data: link
     • files from the hub server opened with a download link (Tenant Works Forms PDF, …)
   and keeps a copy in this browser (IndexedDB "hub-downloads"): last 80 files, 60 MB at most, oldest removed first.
   Nothing is uploaded — the list is per person and per device. Page: /tools/downloads
   ===================================================================== */
(function () {
  if (window.HubDL) return;
  const DB = "hub-downloads", ST = "files", MAX_FILES = 80, MAX_BYTES = 60 * 1024 * 1024, MAX_ONE = 25 * 1024 * 1024;
  const open = () => new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { const s = r.result.createObjectStore(ST, { keyPath: "id", autoIncrement: true }); s.createIndex("at", "at"); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  const tx = async (mode, fn) => { const db = await open(); return new Promise((res, rej) => { const t = db.transaction(ST, mode); const out = fn(t.objectStore(ST)); t.oncomplete = () => res(out && out.result !== undefined ? out.result : out); t.onerror = () => rej(t.error); }); };
  const toolName = () => {
    const p = location.pathname.replace(/^\/tools\//, "").replace(/\.html$/, "");
    if (p === "/" || p === "" || p === "/index.html") return "Hub";
    return (document.title || p).split("·")[0].trim();
  };
  async function prune() {
    const all = await list();
    let bytes = all.reduce((a, f) => a + f.size, 0), n = all.length;
    const drop = [];
    for (let i = all.length - 1; i >= 0 && (n > MAX_FILES || bytes > MAX_BYTES); i--) { drop.push(all[i].id); bytes -= all[i].size; n--; }
    if (drop.length) await tx("readwrite", s => drop.forEach(id => s.delete(id)));
  }
  async function keep(blob, name, extra = {}) {
    if (!blob || blob.size > MAX_ONE) return null;
    const rec = { name: String(name || "download").slice(0, 200), type: blob.type || "", size: blob.size, at: new Date().toISOString(), tool: extra.tool || toolName(), blob };
    const id = await tx("readwrite", s => s.add(rec));
    await prune().catch(() => {});
    try { (window.top || window).postMessage({ type: "hub-download", name: rec.name }, location.origin); } catch {}
    return id;
  }
  async function list() {
    const rows = await tx("readonly", s => s.getAll());
    return (rows || []).sort((a, b) => b.at.localeCompare(a.at));
  }
  const get = id => tx("readonly", s => s.get(Number(id)));
  const remove = id => tx("readwrite", s => s.delete(Number(id)));
  const clear = () => tx("readwrite", s => s.clear());
  /* save a file now (download it) and keep a copy */
  function save(blob, name, extra) {
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
    a._hubKept = true; document.body.append(a); a.click(); a.remove();
    keep(blob, name, extra).catch(() => {});
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  }
  /* 1) <a download> clicked by code (Excel, .eml, CSV) — also catches links that are never added to the page */
  const nativeClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    try {
      if (!this._hubKept && this.download && /^(blob|data):/.test(this.href)) {
        const href = this.href, name = this.download;
        fetch(href).then(r => r.blob()).then(b => keep(b, name)).catch(() => {});
        this._hubKept = true;   // the click listener below must not keep it a second time
      }
    } catch {}
    return nativeClick.apply(this, arguments);
  };
  /* 2) download links clicked by a person: blob/data links and hub server files (…&dl=1 or with the download attribute) */
  document.addEventListener("click", e => {
    const a = e.target.closest && e.target.closest("a[href]");
    if (!a || a._hubKept) return;
    const href = a.href;
    const blobLink = a.hasAttribute("download") && /^(blob|data):/.test(href);
    const serverFile = href.startsWith(location.origin + "/api/") && (a.hasAttribute("download") || /[?&]dl=1\b/.test(href)) && !/\/api\/admin\/backup\b/.test(href);
    if (!blobLink && !serverFile) return;
    fetch(href, { credentials: "same-origin" }).then(async r => {
      if (!r.ok) return;
      const cd = r.headers.get("content-disposition") || "";
      const m = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i.exec(cd);
      const name = a.getAttribute("download") || (m ? decodeURIComponent(m[1] || m[2]) : href.split("/").pop().split("?")[0]);
      keep(await r.blob(), name);
    }).catch(() => {});
  }, true);
  window.HubDL = { keep, save, list, get, remove, clear };
})();
