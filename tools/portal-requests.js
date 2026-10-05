/* ABC Operations Hub — reader for the Tenant Connect "Handover Report" Excel (shared by Contractors)
   Columns: Status · Valid From · Request Name · Tenant Name · Valid To · Sub Maintenance · Contractor · Description
   Blank Status / Valid From cells repeat the row above (grouped report). Needs XLSX loaded. */
window.PortalRequests = (() => {
function parseWhen(v){
  if (v == null || v === "") return null;
  if (v instanceof Date && !isNaN(v)) v = new Date(Math.round(v.getTime() / 60000) * 60000);   // Excel times can be a few ms short (09:59:59.999 → 10:00)
  if (v instanceof Date && !isNaN(v)) return { day: `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`, time: `${String(v.getHours()).padStart(2, "0")}:${String(v.getMinutes()).padStart(2, "0")}` };
  if (typeof v === "number"){ const d = XLSX.SSF.parse_date_code(v); if (d) return { day: `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`, time: `${String(d.H).padStart(2, "0")}:${String(d.M).padStart(2, "0")}` }; return null; }
  const m = String(v).trim().match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})(?:[,\sT]+(\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  const y = m[3].length === 2 ? "20" + m[3] : m[3];
  return { day: `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`, time: m[4] ? `${m[4].padStart(2, "0")}:${m[5]}` : "" };
}
function cleanTenant(n, CTX){
  let t = String(n || "").trim();
  const names = [CTX.siteName, ...Object.values(CTX.sites || {})].filter(Boolean).sort((a, b) => b.length - a.length);
  for (const s of names){ const re = new RegExp("\\s*(ABC\\s+)?" + s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*$", "i"); if (re.test(t)){ t = t.replace(re, ""); break; } }
  return t.replace(/\s+(Verdun|Achrafieh|Dbayeh)(\s+(Mall|Department Store|DS))?$/i, "").trim();
}
function readRequests(rows, CTX){
  const hi = rows.findIndex(r => r.some(c => /request name/i.test(String(c || ""))));
  if (hi < 0) throw new Error("This is not the Handover Report — the “Request Name” column is missing.");
  const H0 = rows[hi].map(c => String(c || "").toLowerCase());
  const col = re => H0.findIndex(h => re.test(h));
  const C = { status: col(/^status/), from: col(/valid from/), req: col(/request name/), tenant: col(/tenant/), to: col(/valid to/), sub: col(/sub maint|category|type/), contr: col(/contractor|supplier/), desc: col(/description/) };
  if (C.from < 0 || C.tenant < 0) throw new Error("The “Valid From” or “Tenant Name” column is missing.");
  if (C.status < 0) throw new Error("The “Status” column is missing — only Approved requests can be imported.");
  const out = []; let status = "", from = null;
  for (const r of rows.slice(hi + 1)){
    const req = String(r[C.req] ?? "").trim();
    if (C.status >= 0 && r[C.status] != null && String(r[C.status]).trim()) status = String(r[C.status]).trim();
    if (r[C.from] != null && String(r[C.from]).trim()) from = parseWhen(r[C.from]) || from;
    if (!/^REQ-?\d+/i.test(req) || !from) continue;
    out.push({ req: req.toUpperCase(), status: status.replace(/[^\w\s]/g, "").trim(), from: { ...from }, to: parseWhen(r[C.to]),
      tenant: cleanTenant(r[C.tenant], CTX), sub: String(r[C.sub] ?? "").trim(), contractor: String(r[C.contr] ?? "").trim(), desc: String(r[C.desc] ?? "").trim() });
  }
  return out;
}
return { parseWhen, cleanTenant, readRequests };
})();
