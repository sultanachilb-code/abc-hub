/**
 * ABC Operations Hub — Cleaner QR access feed (Google Apps Script)
 *
 * Put this in the Google Sheet that records Cleaner QR access:
 *   Extensions → Apps Script → paste this file → Save
 *   Project Settings → Script properties → add  HUB_KEY = (a long random password)
 *   Deploy → New deployment → Web app → Execute as: Me · Who has access: Anyone → Deploy
 * Then in Cloudflare → operations-hub → Settings → Variables and secrets, add:
 *   CLEANER_SHEET_URL = the web app URL      CLEANER_SHEET_KEY = the same HUB_KEY
 *
 * It finds the columns by their header names, so the sheet layout can stay as it is.
 * Adjust the lists below if your headers or flagship names are written differently.
 */
const HEADERS = {
  date:     ['date', 'timestamp', 'time stamp', 'scan date', 'access date', 'check in', 'check-in'],
  flagship: ['flagship', 'site', 'mall', 'location', 'property', 'branch'],
  name:     ['name', 'full name', 'cleaner', 'cleaner name', 'employee', 'employee name'],
  company:  ['company', 'contractor', 'supplier', 'agency']
};
/* Hub flagship code → how the flagship is written in the sheet (any of these match) */
const SITES = {
  VRM: ['verdun mall', 'abc verdun', 'verdun'],
  VRS: ['verdun ds', 'verdun department store'],
  ACM: ['achrafieh mall', 'abc achrafieh', 'achrafieh'],
  ACS: ['achrafieh ds', 'achrafieh department store'],
  DBS: ['dbayeh', 'abc dbayeh', 'dbayeh department store']
};

function doGet(e) {
  const p = e.parameter || {};
  const key = PropertiesService.getScriptProperties().getProperty('HUB_KEY');
  if (!key || p.key !== key) return out({ ok: false, error: 'Not authorised' });
  const site = String(p.site || '').toUpperCase(), day = String(p.date || '');
  if (!SITES[site] || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return out({ ok: false, error: 'Bad request' });

  const tz = 'Asia/Beirut', names = new Set(), byCompany = {};
  let count = 0;
  for (const sh of SpreadsheetApp.getActiveSpreadsheet().getSheets()) {
    const values = sh.getDataRange().getValues();
    const hi = values.findIndex(r => r.some(v => HEADERS.date.includes(String(v).trim().toLowerCase())));
    if (hi < 0) continue;
    const H = values[hi].map(v => String(v).trim().toLowerCase());
    const col = k => H.findIndex(h => HEADERS[k].includes(h));
    const c = { date: col('date'), flagship: col('flagship'), name: col('name'), company: col('company') };
    for (const r of values.slice(hi + 1)) {
      const d = r[c.date];
      const dStr = d instanceof Date ? Utilities.formatDate(d, tz, 'yyyy-MM-dd') : String(d).slice(0, 10);
      if (dStr !== day) continue;
      if (c.flagship >= 0) {
        const f = String(r[c.flagship]).trim().toLowerCase();
        if (!SITES[site].some(x => f === x || f.startsWith(x))) continue;
        // "verdun" alone must not swallow "verdun ds"
        if (site === 'VRM' && /ds|department/.test(f)) continue;
        if (site === 'ACM' && /ds|department/.test(f)) continue;
      }
      count++;
      const n = c.name >= 0 ? String(r[c.name]).trim() : '';
      if (n) names.add(n);
      const co = c.company >= 0 ? String(r[c.company]).trim() : '';
      if (co) byCompany[co] = (byCompany[co] || 0) + 1;
    }
  }
  return out({ ok: true, data: { date: day, site, count: names.size || count, entries: count,
    names: [...names].sort(), byCompany: Object.keys(byCompany).length ? byCompany : null } });
}
function out(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
