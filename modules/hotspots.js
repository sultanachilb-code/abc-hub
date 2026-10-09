/* =====================================================================
   HOTSPOT MAP — where things keep going wrong, on the Mall Layouts level plans.
   Snaglist findings, Malfunction Records, Security Patrol issues and Incident reports of a period (week / month)
   are placed on the plan by their location text: a place pin's name ("Garbage room"), a unit code ("G-12")
   or the brand in that unit ("Zara"). What cannot be placed is listed by its location, so a missing place pin can be added.
   Route : GET /api/ops/layouts/hot?site=&from=&to=        See docs/FEATURE-hotspots.md
   ===================================================================== */
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const addDays = (d, n) => new Date(Date.parse(d + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const norm = s => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9؀-ۿ]+/g, " ").trim();
const codeKey = c => String(c || "").replace(/^VM[\s-]*/i, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const LEVEL_RE = /\b(B[1-4]|LG|LGF|UG|GF|G|L[0-9]|P[1-4]|M|R|ROOF|-[1-4])\b/i;
const levelOf = t => { const m = String(t || "").toUpperCase().match(LEVEL_RE); return m ? m[1] : ""; };
const PATROL_EN = { corridor: "Corridor blocked", storage: "Storage in the corridor", cartons: "Cartons not folded in the bins", garbage: "Garbage outside the bins",
  exitDoor: "Emergency door left open", exitBlocked: "Emergency exit blocked", fire: "Fire extinguisher missing / blocked", leak: "Water leak", light: "Lighting out",
  smoking: "Smoking", person: "Unauthorised person", clean: "Cleanliness / bad smell", damage: "Damage / broken", other: "Other" };

/* the matchers: place names, unit codes and brands → a pin */
function matcher(pins, units) {
  const places = pins.filter(p => p.kind === "place" && norm(p.label).length >= 3).map(p => ({ p, k: norm(p.label) })).sort((a, b) => b.k.length - a.k.length);
  const byCode = new Map(pins.filter(p => p.kind === "unit" && p.code).map(p => [codeKey(p.code), p]));
  const brands = units.filter(u => u.brand && norm(u.brand).length >= 3 && byCode.has(codeKey(u.code))).map(u => ({ p: byCode.get(codeKey(u.code)), k: norm(u.brand) }))
    .sort((a, b) => b.k.length - a.k.length);
  /* "L1-05" also matches "L105", "L1 05", "l1-05"; a code without letters only after "unit", "shop", "store" or "#" */
  const codes = pins.filter(p => p.kind === "unit" && p.code && /\d/.test(p.code)).map(p => { const c = String(p.code).replace(/^VM[\s-]*/i, "").toUpperCase();
    const body = c.replace(/[^A-Z0-9]+/g, "§").replace(/([A-Z])(\d)/g, "$1§$2").replace(/(\d)([A-Z])/g, "$1§$2").split("§").filter(Boolean).join("[\\s-]?");
    return [new RegExp(/[A-Z]/.test(c) ? `(^|[^A-Z0-9])${body}([^A-Z0-9]|$)` : `(UNIT|SHOP|STORE|#)\\s*${body}([^0-9]|$)`), p]; });
  return text => {
    const t = " " + norm(text) + " ";
    if (t.trim().length < 2) return null;
    for (const x of places) if (t.includes(" " + x.k + " ")) return x.p;
    const raw = String(text || "").toUpperCase();
    for (const [re, p] of codes) if (re.test(raw)) return p;
    for (const x of brands) if (t.includes(" " + x.k + " ")) return x.p;
    return null;
  };
}

export async function hotspots(env, site, url, d) {
  const today = d.today();
  let to = DAY.test(url.searchParams.get("to") || "") ? url.searchParams.get("to") : today;
  let from = DAY.test(url.searchParams.get("from") || "") ? url.searchParams.get("from") : addDays(to, -6);
  if (from > to) [from, to] = [to, from];
  if ((Date.parse(to) - Date.parse(from)) / 864e5 > 92) from = addDays(to, -92);
  const F = new Date(Date.parse(from + "T00:00:00+03:00")).toISOString(), T = new Date(Date.parse(to + "T23:59:59+03:00")).toISOString();

  const [pinsR, unitsR, mfR, ptR] = await Promise.all([
    env.DB.prepare("SELECT id, level, code, label, kind, x, y FROM layout_pins WHERE site = ?").bind(site).all(),
    env.DB.prepare("SELECT code, brand, level FROM gla_units WHERE site = ? AND active = 1").bind(site).all().catch(() => ({ results: [] })),
    env.DB.prepare("SELECT id, category, location, asset, description, priority, status, found_at FROM mf_records WHERE site = ? AND deleted = 0 AND found_at >= ? AND found_at <= ?").bind(site, F, T).all().catch(() => ({ results: [] })),
    env.DB.prepare(`SELECT s.id, s.at, s.issues, s.note, s.guard, p.label, p.area, p.level FROM patrol_scans s JOIN patrol_points p ON p.id = s.point_id
      WHERE s.site = ? AND s.status = 'issue' AND s.day >= ? AND s.day <= ?`).bind(site, from, to).all().catch(() => ({ results: [] }))
  ]);
  const pins = pinsR.results || [], match = matcher(pins, unitsR.results || []);
  const items = [];
  for (const r of mfR.results || []) items.push({ src: "mf", at: r.found_at, where: r.location || "", text: [r.asset || r.category, r.description].filter(Boolean).join(" — ").slice(0, 160), tone: r.priority, ref: r.id, find: `${r.location} ${r.asset}` });
  for (const r of ptR.results || []) { const L = JSON.parse(r.issues || "[]").map(k => PATROL_EN[k] || k);
    items.push({ src: "patrol", at: r.at, where: [r.level, r.label].filter(Boolean).join(" · "), text: [L.join(", "), r.note].filter(Boolean).join(" — ").slice(0, 160), tone: r.guard, find: `${r.label} ${r.area} ${r.level}` }); }

  /* Snaglist findings of the period (Snaglist ?hubloc=1) */
  const errors = {};
  if (env.HUB_KEY && d.snagBase) {
    try {
      const r = await fetch(`${d.snagBase}/api?hubloc=1&site=${site}&from=${from}&to=${to}`, { headers: { "x-hub-key": env.HUB_KEY }, signal: AbortSignal.timeout(9000) });
      const j = await r.json().catch(() => null);
      if (j && j.ok) for (const x of j.data.items || []) items.push({ src: "snag", at: x.created_at, where: x.location, text: String(x.issue || "").slice(0, 160), tone: x.status, find: x.location });
      else errors.snag = j && j.error ? j.error : `Snaglist answered ${r.status} — deploy the latest Snaglist (hubloc)`;
    } catch { errors.snag = "Snaglist not reachable"; }
  } else errors.snag = "Not connected";

  /* Incident reports: one call per day (days before today are kept in the hub for a week) */
  const days = []; for (let x = from; x <= to && days.length < 93; x = addDays(x, 1)) days.push(x);
  let incOk = 0;
  for (let i = 0; i < days.length; i += 8) {
    await Promise.all(days.slice(i, i + 8).map(async day => {
      const key = `hot:inc:${site}:${day}`;
      let list = null;
      if (day < today) { const c = await env.DB.prepare("SELECT v FROM meta WHERE k = ?").bind(key).first().catch(() => null); if (c) { try { list = JSON.parse(c.v); } catch {} } }
      if (!list) {
        const r = await d.pullDay(env, "incidents", site, day);
        if (r && !r.error) { list = (r.incidents || []).map(x => ({ ref: x.ref || "", time: x.time || "", type: x.type || "", severity: x.severity || "", location: x.location || x.where || "" }));
          if (day < today) await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)").bind(key, JSON.stringify(list)).run().catch(() => {}); }
        else { errors.inc = (r && r.error) || "Not reachable"; return; }
      }
      incOk++;
      for (const x of list) items.push({ src: "inc", at: `${day}T${x.time || "12:00"}`, where: x.location, text: [x.ref, x.type].filter(Boolean).join(" · "), tone: x.severity, find: x.location });
    }));
  }
  if (incOk) delete errors.inc;

  /* place them */
  const spots = new Map(), loose = new Map();
  for (const it of items) {
    const p = match(it.find);
    const one = { src: it.src, at: it.at, where: it.where, text: it.text, tone: it.tone || "" };
    if (p) {
      let s = spots.get(p.id); if (!s) spots.set(p.id, s = { pinId: p.id, level: p.level, x: p.x, y: p.y, label: p.kind === "place" ? p.label : p.code, kind: p.kind, n: 0, by: {}, items: [] });
      s.n++; s.by[it.src] = (s.by[it.src] || 0) + 1; s.items.push(one);
    } else {
      const k = norm(it.where) || "(no location)";
      let g = loose.get(k); if (!g) loose.set(k, g = { where: it.where || "No location written", level: levelOf(it.where), n: 0, by: {}, items: [] });
      g.n++; g.by[it.src] = (g.by[it.src] || 0) + 1; if (g.items.length < 6) g.items.push(one);
    }
  }
  const out = [...spots.values()].map(s => ({ ...s, items: s.items.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 25) })).sort((a, b) => b.n - a.n);
  const count = src => items.filter(x => x.src === src).length;
  return { site, from, to, total: items.length, placed: out.reduce((a, s) => a + s.n, 0), counts: { snag: count("snag"), mf: count("mf"), patrol: count("patrol"), inc: count("inc") },
    spots: out, unplaced: [...loose.values()].sort((a, b) => b.n - a.n).slice(0, 40), errors };
}
