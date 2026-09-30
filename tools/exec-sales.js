/* =====================================================================
   EXECUTIVE REPORT — local sales (runs only in the browser)
   Reads the monthly "Leasing Sales Performance YTD" workbook and turns it into the sales part of the report.
   Nothing here talks to the hub: the figures live in this page's memory and are gone when it closes.

   Workbook (same layout every month):
     • Sales Data Conso  one row per lease — Property BU · Business Unit · Category · Sub Category · Parent Group ·
                         Parent Tenant · LeaseNo · Budget Jan–Dec <yr> · Total B <yr> · <prev yr> Jan–Dec · Total <prev> ·
                         <base yr> Jan–Dec · Total <base> · <yr> Jan–Dec · Total <yr> · Budget LFL · Vs. LY LFL ·
                         From <base> LFL · Space <yr> · Space <base>
     • Sales Total Summary   "Period (YTD)" = the month the file runs to
     • Footfall Table        Cinema admissions and Parking (car counting) per property, current and previous year
     (the other sheets are pivots of Sales Data Conso and are recalculated here)

   Rules (checked against the August 2026 report of Verdun Mall)
     • Monthly sales % and total sales % ... all tenants of the flagship, month vs same month last year
     • LFL % .............................. like-for-like ("Vs. LY LFL" = LFL) of the whole property (mall + its DS)
     • Groups table ....................... property LFL, then the DS, then the chosen retail groups (LFL)
     • Top contributors to the decline .... all tenants of the flagship, YTD drop vs last year, the 14 largest
       contribution = drop ÷ property LFL drop
     • New tenants ........................ first sales in the last 12 months and at least 2 months of sales this year;
       annualised sales / sqm = sales ÷ months traded × 12 ÷ space
     • Low performers ..................... trading tenants with space, ≥ 2 months of sales this year;
       annualised sales / sqm = YTD sales × 12 ÷ months of the period ÷ space (lowest first)
   ===================================================================== */
(function (root) {
  const MN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const t = v => String(v == null ? "" : v).trim();
  const n = v => { const x = parseFloat(String(v == null ? "" : v).replace(/,/g, "")); return isFinite(x) ? x : 0; };
  const key = s => t(s).toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
  const title = s => t(s).toLowerCase().replace(/(^|[\s\-/&(])([a-z])/g, (m, a, b) => a + b.toUpperCase());
  const serialDate = v => { const x = n(v); return x > 20000 && x < 80000 ? new Date(Math.round((x - 25569) * 864e5)) : null; };
  const DEFAULT_GROUPS = ["AZADEA", "AISHTI", "PEARL BRANDS", "RETAIL GROUP"];

  function findSheet(sheets, re, test) {
    return sheets.find(s => re.test(s.name)) || (test ? sheets.find(s => s.grid.slice(0, 5).some(test)) : null);
  }

  /* ---------- read the workbook (sheets = [{ name, grid: [[cell text]] }]) ---------- */
  function parse(sheets) {
    const sh = findSheet(sheets, /sales\s*data\s*conso/i, r => r.some(c => /parent\s*tenant/i.test(c)) && r.some(c => /^total\s*b/i.test(t(c))));
    if (!sh) throw new Error("This is not the Leasing Sales Performance file — the “Sales Data Conso” sheet is missing.");
    const hi = sh.grid.findIndex(r => r.some(c => /parent\s*tenant/i.test(c)));
    const H = sh.grid[hi].map(t), find = re => H.findIndex(h => re.test(h));
    const C = { pbu: find(/^property\s*bu/i), bu: find(/^business\s*unit/i), cat: find(/^category$/i), sub: find(/^sub\s*category/i),
      grp: find(/^parent\s*group/i), ten: find(/^parent\s*tenant/i), bud: find(/^budget\s+jan/i) };
    const tb = H.findIndex(h => /^total\s*b\s*\d{4}/i.test(h));
    if (C.bu < 0 || C.ten < 0 || C.bud < 0 || tb < 0) throw new Error("The “Sales Data Conso” columns are not where they should be (Business Unit, Parent Tenant, Budget Jan…).");
    const year = +H[tb].match(/\d{4}/)[0];
    const totals = H.map((h, i) => { const m = /^total\s+(\d{4})$/i.exec(h); return m ? { i, y: +m[1] } : null; }).filter(Boolean);
    const cur = totals.find(x => x.y === year), prev = totals.find(x => x.y === year - 1), base = totals.find(x => x.y !== year && x.y !== year - 1);
    if (!cur || !prev) throw new Error(`The ${year} or ${year - 1} month columns are missing in “Sales Data Conso”.`);
    const flag = re => find(re);
    const F = { bLfl: flag(/^budget\s*lfl/i), lyLfl: flag(/vs\.?\s*ly\s*lfl/i), baseLfl: flag(/^from\s*\d{4}\s*lfl/i) };
    const spaceCols = H.map((h, i) => { const m = /^space\s*(\d{4})/i.exec(h); return m ? { i, y: +m[1] } : null; }).filter(Boolean);
    const spCur = (spaceCols.find(x => x.y === year) || spaceCols[0] || { i: -1 }).i, spBase = base ? (spaceCols.find(x => x.y === base.y) || { i: -1 }).i : -1;
    const months = (i, row) => Array.from({ length: 12 }, (_, k) => n(row[i - 12 + k]));
    const rows = [];
    for (const r of sh.grid.slice(hi + 1)) {
      const bu = t(r[C.bu]), ten = t(r[C.ten]);
      if (!bu || !ten || bu === "0") continue;
      rows.push({ pbu: t(r[C.pbu]), bu, cat: t(r[C.cat]), sub: t(r[C.sub]), grp: t(r[C.grp]) || ten, ten,
        bud: Array.from({ length: 12 }, (_, k) => n(r[C.bud + k])), cur: months(cur.i, r), prev: months(prev.i, r), base: base ? months(base.i, r) : [],
        fLY: t(r[F.lyLfl]).toUpperCase() === "LFL", fB: t(r[F.bLfl]).toUpperCase() === "LFL", fBase: t(r[F.baseLfl]).toUpperCase() === "LFL",
        space: spCur >= 0 ? n(r[spCur]) : 0, spaceBase: spBase >= 0 ? n(r[spBase]) : 0 });
    }
    if (!rows.length) throw new Error("No sales rows found in “Sales Data Conso”.");
    /* the month the file runs to */
    let upTo = 0;
    const sum = findSheet(sheets, /sales\s*total\s*summary/i);
    if (sum) for (const r of sum.grid.slice(0, 8)) { const i = r.findIndex(c => /period/i.test(c)); if (i >= 0) { const d = serialDate(r[i + 1]); if (d && d.getUTCFullYear() === year) upTo = d.getUTCMonth() + 1; } }
    if (!upTo) for (let k = 11; k >= 0 && !upTo; k--) if (rows.some(r => r.cur[k] > 0)) upTo = k + 1;
    /* cinema admissions and car counting, per property */
    const ind = {};
    const ft = findSheet(sheets, /footfall\s*table/i);
    if (ft) {
      let sec = "";
      for (const r of ft.grid) {
        const a = t(r[0]);
        if (/^cinema/i.test(a)) { sec = "cinema"; continue; }
        if (/^parking|car/i.test(a)) { sec = "parking"; continue; }
        if (!sec || !a) continue;
        const p = key(a).replace(/sh/g, "ch");
        (ind[p] = ind[p] || {})[sec] = { cur: Array.from({ length: 12 }, (_, k) => n(r[1 + k])), prev: Array.from({ length: 12 }, (_, k) => n(r[14 + k])) };
      }
    }
    return { year, prevYear: year - 1, baseYear: base ? base.y : null, upTo, rows, ind, units: [...new Set(rows.map(r => r.bu))] };
  }

  /* ---------- build the sales part of one flagship ---------- */
  function compute(D, buName, M, opts) {
    opts = opts || {};
    const R = D.rows.filter(r => key(r.bu) === key(buName));
    if (!R.length) return null;
    M = Math.max(1, Math.min(12, M || D.upTo || 12));
    const ytd = a => a.slice(0, M).reduce((s, v) => s + v, 0);
    const tot = (rows, f) => rows.reduce((s, r) => s + f(r), 0);
    const pct = (a, b) => b > 0 ? (a / b - 1) * 100 : NaN;
    const pbu = R[0].pbu;
    const P = D.rows.filter(r => r.pbu === pbu && /(mall|department store)$/i.test(r.bu));
    const isDS = /department store$/i.test(buName);
    const ds = isDS ? [] : P.filter(r => /department store$/i.test(r.bu));
    const lfl = rows => { const L = rows.filter(r => r.fLY); return { s25: Math.round(tot(L, r => ytd(r.prev))), s26: Math.round(tot(L, r => ytd(r.cur))) }; };

    /* monthly sales (footfall table columns) */
    const ff = MN.map((m, k) => k < M ? { month: m, s25: Math.round(tot(R, r => r.prev[k])), s26: Math.round(tot(R, r => r.cur[k])) } : { month: m, s25: "", s26: "" });
    const all26 = tot(R, r => ytd(r.cur)), all25 = tot(R, r => ytd(r.prev));

    /* groups: property LFL, DS, chosen retail groups */
    const groups = [{ group: `${buName} LFL`, ...lfl(ds.length ? P : R) }];
    if (ds.length) groups.push({ group: "DS", ...lfl(ds) });
    const byGroup = {};
    for (const r of R) (byGroup[key(r.grp)] = byGroup[key(r.grp)] || { name: r.grp, rows: [] }).rows.push(r);
    let wanted = (opts.groups || []).map(t).filter(Boolean);
    if (!wanted.length) wanted = DEFAULT_GROUPS.filter(g => byGroup[key(g)]);
    if (!wanted.length) wanted = Object.values(byGroup).map(g => ({ g: g.name, v: lfl(g.rows).s25 })).sort((a, b) => b.v - a.v).slice(0, 4).map(x => x.g);
    for (const g of wanted) { const x = byGroup[key(g)]; if (!x) continue; const v = lfl(x.rows); if (v.s25 || v.s26) groups.push({ group: title(x.name), ...v }); }
    const propDrop = groups[0].s26 - groups[0].s25;

    /* tenants of the flagship */
    const ten = {};
    for (const r of R) {
      const x = ten[key(r.ten)] = ten[key(r.ten)] || { name: r.ten, cur: Array(12).fill(0), prev: Array(12).fill(0), space: 0 };
      r.cur.forEach((v, k) => x.cur[k] += v); r.prev.forEach((v, k) => x.prev[k] += v); x.space += r.space;
    }
    const T = Object.values(ten).map(x => {
      const c = ytd(x.cur), p = ytd(x.prev), traded = x.cur.slice(0, M).filter(v => v > 0).length;
      let first = -1; for (let k = 0; k < 12 && first < 0; k++) if (x.prev[k] > 0) first = k; if (first < 0) for (let k = 0; k < M && first < 0; k++) if (x.cur[k] > 0) first = 12 + k;
      return { name: x.name, c, p, drop: c - p, traded, first, space: x.space };
    });
    const decline = T.filter(x => x.drop < 0).sort((a, b) => a.drop - b.drop).slice(0, opts.declineRows || 14).map(x => ({ tenant: x.name, drop: Math.round(x.drop) }));
    const newt = T.filter(x => x.first >= M && x.traded >= 2 && x.space > 0 && x.c > 0).sort((a, b) => a.first - b.first)
      .map(x => ({ tenant: x.name, space: Math.round(x.space), ann: Math.round(x.c / x.traded * 12 / x.space) }));
    const low = T.filter(x => x.space > 0 && x.c > 0 && x.traded >= 2).map(x => ({ tenant: x.name, s25: Math.round(x.p) || "", s26: Math.round(x.c), ann: Math.round(x.c * 12 / M / x.space) }))
      .sort((a, b) => a.ann - b.ann).slice(0, 15);

    /* vs last year, budget and the base year (each with its own like-for-like flag, as in the summary sheet) */
    const L = f => R.filter(f);
    const vs = {
      all: { cur: all26, prev: all25, bud: tot(R, r => ytd(r.bud)), base: tot(R, r => ytd(r.base)) },
      lfl: { cur: tot(L(r => r.fLY), r => ytd(r.cur)), prev: tot(L(r => r.fLY), r => ytd(r.prev)),
        curB: tot(L(r => r.fB), r => ytd(r.cur)), bud: tot(L(r => r.fB), r => ytd(r.bud)),
        curBase: tot(L(r => r.fBase), r => ytd(r.cur)), base: tot(L(r => r.fBase), r => ytd(r.base)) }
    };
    /* by category */
    const cats = {};
    for (const r of R) { const c = cats[r.cat || "Other"] = cats[r.cat || "Other"] || { cat: r.cat || "Other", cur: 0, prev: 0, space: 0 }; c.cur += ytd(r.cur); c.prev += ytd(r.prev); c.space += r.space; }
    const catList = Object.values(cats).filter(c => c.cur || c.prev).sort((a, b) => b.cur - a.cur)
      .map(c => ({ cat: title(c.cat), cur: Math.round(c.cur), prev: Math.round(c.prev), share: all26 ? c.cur / all26 * 100 : 0 }));
    /* cinema / parking of the property */
    const ip = D.ind[key(pbu).replace(/sh/g, "ch")] || null;
    const ind = ip ? Object.entries(ip).map(([k, v]) => ({ what: k === "cinema" ? "Cinema admissions" : "Car counting (parking)", cur: ytd(v.cur), prev: ytd(v.prev) })) : [];

    return {
      bu: buName, property: pbu, year: D.year, prevYear: D.prevYear, baseYear: D.baseYear, months: M,
      footfall: ff,
      salesTotal: isFinite(pct(all26, all25)) ? pct(all26, all25).toFixed(1) : "",
      salesLfl: isFinite(pct(groups[0].s26, groups[0].s25)) ? pct(groups[0].s26, groups[0].s25).toFixed(1) : "",
      groups, decline, declineBase: propDrop < 0 ? String(Math.round(-propDrop)) : "", declineTitle: buName,
      newt, low, vs, cats: catList, ind
    };
  }
  root.SalesLocal = { parse, compute, DEFAULT_GROUPS };
  if (typeof module !== "undefined") module.exports = root.SalesLocal;
})(typeof window !== "undefined" ? window : globalThis);
