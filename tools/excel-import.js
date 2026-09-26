/* ABC Operations Hub — reusable Excel import helpers (needs xlsx.full.min.js loaded first).
   Kept for tools that accept Excel uploads. Not used by the GLA page, whose data is built into the system. */
const ExcelImport = {
  /* Read a File into a workbook */
  async read(file){ return XLSX.read(await file.arrayBuffer(), { type: "array" }); },

  /* Every sheet as rows of plain values: { sheetName: [[...], ...] } */
  rows(wb){ return Object.fromEntries(wb.SheetNames.map(n => [n, XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null })])); },

  /* Rows under a header row, as objects keyed by the header text (first sheet that has all `required` headers) */
  table(wb, required){
    for (const name of wb.SheetNames){
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null });
      const hi = rows.findIndex(r => required.every(h => r.some(v => String(v ?? "").trim().toLowerCase() === h.toLowerCase())));
      if (hi < 0) continue;
      const H = rows[hi].map(v => String(v ?? "").trim());
      return rows.slice(hi + 1).filter(r => r.some(v => v !== null && v !== "")).map(r => Object.fromEntries(H.map((h, i) => [h, r[i]]).filter(([h]) => h)));
    }
    return [];
  },

  /* Excel date / time cells → "YYYY-MM-DD" / "HH:MM" */
  day(v){ if (typeof v === "number"){ const p = XLSX.SSF.parse_date_code(v); return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`; } const d = new Date(String(v)); return isNaN(d) ? "" : d.toISOString().slice(0, 10); },
  time(v){ if (typeof v === "number"){ const m = Math.round((v % 1) * 1440); return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; } return /^\d{1,2}:\d{2}/.test(String(v || "")) ? String(v).trim().slice(0, 5).padStart(5, "0") : ""; },

  /* The monthly GLA workbook (one sheet per level + TOTALS) → { month, levels, units, official } */
  gla(wb){
    const out = { month: "", units: [], levels: [], official: {} };
    for (const name of wb.SheetNames){
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null });
      if (/^totals?$/i.test(name.trim())){
        for (const r of rows) for (const v of r) if (typeof v === "number" && v > 40000 && v < 60000 && !out.month){ const d = XLSX.SSF.parse_date_code(v); if (d) out.month = `${d.y}-${String(d.m).padStart(2, "0")}`; }
        const hi = rows.findIndex(r => r.some(v => /occupancy rate/i.test(String(v || ""))));
        if (hi >= 0 && rows[hi + 1]) rows[hi].forEach((h, i) => { const v = rows[hi + 1][i]; if (h && typeof v === "number") out.official[String(h).trim()] = v; });
        continue;
      }
      let map = null;
      for (const r of rows){
        const low = r.map(v => String(v ?? "").trim().toLowerCase());
        if (low.includes("areacode")){ map = { level: low.indexOf("level"), type: low.indexOf("type"), code: low.indexOf("areacode"), brand: low.indexOf("brand"),
            status: low.indexOf("operating status"), dept: low.indexOf("dept"), area: low.findIndex(x => x.startsWith("area sqm") || x === "area") }; continue; }
        if (!map) continue;
        const code = r[map.code], brand = r[map.brand];
        if (!code || !brand || /^total/i.test(String(r[0] || ""))) continue;
        const level = String(r[map.level] ?? name).trim() || name.trim();
        out.units.push({ level, type: String(r[map.type] ?? "").trim(), code: String(code).trim(), brand: String(brand).trim(),
          status: map.status >= 0 ? String(r[map.status] ?? "").trim() : (/vacant/i.test(brand) ? "VACANT" : "Active"),
          dept: map.dept >= 0 ? String(r[map.dept] ?? "").trim() : "", area: Number(r[map.area]) || 0, sheet: name.trim() });
        if (!out.levels.includes(level)) out.levels.push(level);
      }
    }
    return out;
  }
};
