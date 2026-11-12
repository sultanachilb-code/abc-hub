/* =====================================================================
   POSITIONS & LANDING PAGES (Nov 2026) — docs/FEATURE-positions.md
   One place in Admin Control for each position of the hierarchy:
     • Who sees what — the hub tools it sees
     • Landing page + home layout (modules/landing.js, now also per flagship)
     • Emails it receives automatically (End of Day, handover, schedule, form alerts, patrol, cleaners)
     • Its rights in the Incident Report and Snaglist systems (one hub account for every system)
   Every setting has a default ("All flagships") and can be changed for one flagship.
   Positions that cover several flagships (Advisor, Director, CDSO, Head of Security, Site Visit Officer) have one setup.
   Stored in meta 'pos:cfg' = { def: { KEY: PART }, site: { VRM: { KEY: PART } } },
     PART = { tools: { app: bool }, mail: { kind: bool }, sys: { incidents: { obj: E|V|O|N }, snaglist: { obj: E|V|O|N } } }
   Only differences are stored: a flagship value equal to the default is removed.

   INCIDENT REPORT SETTINGS (moved from the Incident system's Admin screen):
   meta 'inc:cfg' = { cc: { type: { pos: [KEY], contacts: [id] } }, contacts: [{ id, label, email }],
     cs: { VRM: { email, cc } }, cctv: { VRM: email }, phone, digest: { pos, contacts }, weekly: { pos, contacts } }
   The Incident system asks the hub (x-hub-key, sso/inc-cfg) and receives the resolved email addresses.
   ===================================================================== */
const err = (m, status = 400) => Object.assign(new Error(m), { status });
const one = async q => { try { return await q.first(); } catch { return null; } };

/* ---------- the positions (keys used everywhere in this file) ---------- */
export const POS = {
  ADVISOR: { n: "Property Advisor", g: "Leadership", multi: true, sub: "all flagships" },
  DIRECTOR: { n: "Mall Director", g: "Leadership", multi: true, sub: "the malls ticked on the account" },
  CDSO: { n: "CDSO", g: "Leadership", multi: true, sub: "the department stores ticked on the account" },
  MM: { n: "Mall Manager", g: "Flagship management", sub: "or Senior / Deputy" },
  OM: { n: "Operations Manager", g: "Flagship management", sub: "or Deputy" },
  SMS: { n: "Senior Mall Supervisor", g: "Operations team" },
  MS: { n: "Mall Supervisor", g: "Operations team" },
  MO: { n: "Mall Officer", g: "Operations team" },
  HOS: { n: "Head of Security", g: "Security", multi: true, sub: "all flagships", sec: true },
  SECM: { n: "Security Manager", g: "Security", sub: "or Deputy", sec: true },
  SV: { n: "Site Visit Officer", g: "Security", multi: true, sub: "all flagships", sec: true },
  SEC: { n: "Security staff", g: "Security", sec: true },
  WH: { n: "Warehouse", g: "Other", sub: "view only" }
};
/* a pretend account of each position — to check what the old rules give it */
export const POS_USER = { ADVISOR: { role: "ADVISOR" }, DIRECTOR: { role: "DIRECTOR" }, CDSO: { role: "CDSO" },
  MM: { role: "MANAGER", position: "MM" }, OM: { role: "MANAGER", position: "OM" },
  SMS: { role: "SUPERVISOR", position: "SMS" }, MS: { role: "SUPERVISOR", position: "MS" }, MO: { role: "SUPERVISOR", position: "MO" }, WH: { role: "SUPERVISOR", position: "WH" },
  HOS: { role: "SECURITY", position: "HOS" }, SECM: { role: "SECURITY", position: "SM" }, SV: { role: "SECURITY", position: "SV" }, SEC: { role: "SECURITY", position: "" } };
export const posKeyOf = u => !u ? null
  : ["ADVISOR", "DIRECTOR", "CDSO"].includes(u.role) ? u.role
  : u.role === "MANAGER" ? (["OM", "DOM"].includes(u.position) ? "OM" : "MM")
  : u.role === "SUPERVISOR" ? (["SMS", "MS", "MO", "WH"].includes(u.position) ? u.position : "MO")
  : u.role === "SECURITY" ? (u.position === "SM" ? "SECM" : u.position === "HOS" ? "HOS" : u.position === "SV" ? "SV" : "SEC")
  : null;
/* the flagship whose settings apply to this person (none for positions covering several flagships) */
export const posSiteOf = u => { const k = posKeyOf(u); return k && !POS[k].multi ? (u.site_code || "") : ""; };

/* ---------- emails a position can receive automatically for its flagship ---------- */
export const AUTO_MAILS = { eod: "End of Day Report", handover: "Shift handover", schedule: "Weekly operations schedule", formalert: "Form alerts · “not OK”", patrol: "Security patrol", cleaners: "Cleaner entries · daily" };
const MAIL_DEF = { SECM: Object.keys(AUTO_MAILS) };   // the Security Manager receives his flagship's communication (Nov 2026)

/* ---------- rights inside the connected systems ---------- */
export const SYS_OBJ = {
  incidents: [["dash", "Dashboard"], ["new", "New report"], ["log", "Incident log"], ["status", "Status · owner · steps"], ["esc", "Escalation & compliance"],
    ["pir", "Post-incident report"], ["dir", "Directory"], ["bl", "Blacklist cards"], ["bllift", "Lift a blacklist"], ["pledge", "Pledge"], ["pldb", "Pledge DB"], ["reports", "Reports · export"]],
  snaglist: [["my", "Own snaglists"], ["flag", "Flagship snaglists"], ["transfer", "Transfer"], ["svpost", "Post site visits"], ["svclose", "Complete & close site visits"],
    ["svall", "All site visits (every flagship)"], ["report", "Consolidated report"], ["keep", "Keep permanently"], ["del", "Delete lists"]]
};
export const SYS_NAMES = { incidents: "Incident Report", snaglist: "Snaglist" };
/* E = create / edit · V = view only · O = only their own · N = no access. One letter per object, in SYS_OBJ order. */
const SYS_DEF = {
  incidents: {
    ADVISOR: "VNVNVVVVNNVV", DIRECTOR: "VNVNVVVVNNVV", CDSO: "VNVNVVVVNNVV",
    MM: "EEEEEEEVNEEE", OM: "EEEEEEEVNEEE", SMS: "EEEEVEEVNEEV", MS: "EEEEVEEVNEEV", MO: "EEONNEEVNEVN",
    HOS: "VEVVVVVEEVVV", SECM: "EEEEEVEEEEEE", SV: "VEONNNVVNNNN", SEC: "VEONNNVVNENN", WH: "NNNNNNNNNNNN"
  },
  snaglist: {
    ADVISOR: "EVNNVVVNN", DIRECTOR: "EVNNVVVNN", CDSO: "EVNNVVVNN",
    MM: "EEEEEVEEE", OM: "EEEEEVEEN", SMS: "ONENENNNN", MS: "ONENENNNN", MO: "ONNNVNNNN",   // operations team: own snaglists (Supervisor) as today; "Flagship snaglists" ✎/👁 = Manager account
    HOS: "NNNNNVNNN", SECM: "NNNNNNNNN", SV: "NNNENONNN", SEC: "NNNNNNNNN", WH: "NNNNNNNNN"
  }
};
const VALS = ["E", "V", "O", "N"];
function sysBase(key, app) {
  const s = (SYS_DEF[app] || {})[key] || "", o = SYS_OBJ[app] || [];
  return Object.fromEntries(o.map(([id], i) => [id, VALS.includes(s[i]) ? s[i] : "N"]));
}

/* ---------- storage ---------- */
let CFG = null, CFG_AT = 0;
export async function posCfg(env, fresh) {
  if (!fresh && CFG && Date.now() - CFG_AT < 30000) return CFG;
  const r = await one(env.DB.prepare("SELECT v FROM meta WHERE k = 'pos:cfg'"));
  let v = {}; try { v = JSON.parse((r && r.v) || "{}"); } catch {}
  CFG = { def: v.def || {}, site: v.site || {}, person: v.person || {} }; CFG_AT = Date.now();
  return CFG;
}
export const posCfgNow = () => CFG || { def: {}, site: {}, person: {} };
const dig = (o, ...k) => k.reduce((a, x) => (a && typeof a === "object" ? a[x] : undefined), o);

/* a stored value (flagship first, then the default) — undefined when nothing is stored */
function stored(cfg, key, site, part, id, sub) {
  const path = sub ? [part, sub, id] : [part, id];
  const s = site && !POS[key].multi ? dig(cfg.site, site, key, ...path) : undefined;
  return s !== undefined ? s : dig(cfg.def, key, ...path);
}
/* Who sees what: true / false when set here, undefined → the old rules (Tools control, apps.js) decide */
export function toolOverride(u, app) {
  const p = dig(posCfgNow().person, String(u.email || "").toLowerCase(), "tools", app);   // View as → hide for this person only
  if (typeof p === "boolean") return p;
  const k = posKeyOf(u); if (!k) return undefined;
  const v = stored(posCfgNow(), k, posSiteOf(u), "tools", app);
  return typeof v === "boolean" ? v : undefined;
}
export function sysRightsOf(key, site, app, cfg = posCfgNow()) {
  if (!POS[key] || !SYS_OBJ[app]) return null;
  const base = sysBase(key, app);
  for (const [id] of SYS_OBJ[app]) { const v = stored(cfg, key, site, "sys", id, app); if (VALS.includes(v)) base[id] = v; }
  return base;
}
export const sysRights = (u, app) => { const k = posKeyOf(u); return k ? sysRightsOf(k, posSiteOf(u), app) : null; };
export function mailOn(key, site, kind, cfg = posCfgNow()) {
  if (!POS[key] || !AUTO_MAILS[kind]) return false;
  const v = stored(cfg, key, site, "mail", kind);
  return typeof v === "boolean" ? v : (MAIL_DEF[key] || []).includes(kind);
}
/* the people who receive this email of this flagship automatically (added in Cc by the hub's senders) */
export async function autoRecipients(env, kind, site, d) {
  if (!AUTO_MAILS[kind] || !site) return [];
  const cfg = await posCfg(env);
  const { results } = await env.DB.prepare("SELECT email, role, position, site_code, sites FROM users WHERE active = 1 AND role IN ('MANAGER','SUPERVISOR','SECURITY','ADVISOR','DIRECTOR','CDSO')").all().catch(() => ({ results: [] }));
  return (results || []).filter(u => { const k = posKeyOf(u); return k && d.sitesOf(u).includes(site) && mailOn(k, POS[k].multi ? "" : site, kind, cfg); }).map(u => u.email);
}

/* every tile this person's position / flagship / own exception decides: { id: [shown, "person" | "site" | "pos"] } — the home screen applies it */
export function toolOverrides(u) {
  const cfg = posCfgNow(), out = {}, k = posKeyOf(u), s = posSiteOf(u);
  if (k) {
    for (const [id, v] of Object.entries(dig(cfg.def, k, "tools") || {})) if (typeof v === "boolean") out[id] = [v, "pos"];
    if (s && !POS[k].multi) for (const [id, v] of Object.entries(dig(cfg.site, s, k, "tools") || {})) if (typeof v === "boolean") out[id] = [v, "site"];
  }
  for (const [id, v] of Object.entries(dig(cfg.person, String(u.email || "").toLowerCase(), "tools") || {})) if (typeof v === "boolean") out[id] = [v, "person"];
  return out;
}
/* View as → hide / show a tile for this person only (null = back to the position's setting) */
export async function posPersonTool(env, email, app, value, me, d) {
  if (!/^[a-z0-9-]{2,40}$/.test(app)) throw err("Unknown tool");
  const raw = await one(env.DB.prepare("SELECT v FROM meta WHERE k = 'pos:cfg'"));
  let all = {}; try { all = JSON.parse((raw && raw.v) || "{}"); } catch {}
  all.person = all.person || {}; const e = String(email).toLowerCase();
  const box = ((all.person[e] = all.person[e] || {}).tools = all.person[e].tools || {});
  if (typeof value === "boolean") box[app] = value; else delete box[app];
  if (!Object.keys(box).length) delete all.person[e];
  await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('pos:cfg', ?)").bind(JSON.stringify({ def: all.def || {}, site: all.site || {}, person: all.person, at: new Date().toISOString(), by: me.full_name || me.email })).run();
  CFG = null;
  if (d && d.audit) await d.audit(env, { me, site: "", tool: "admin", ref: "positions", label: `Who sees what · ${e} · ${app} ${value === true ? "shown" : value === false ? "hidden" : "back to the position"}`, action: "update", changes: [] }).catch(() => {});
  return { saved: true };
}

/* ---------- Admin Control → Positions & landing pages ---------- */
export async function posAdmin(env, method, b, me, d) {
  if (method === "POST") {
    const key = String(b.key || "").toUpperCase(); if (!POS[key]) throw err("Choose a position");
    const site = b.site && b.site !== "ALL" ? String(b.site).toUpperCase() : "";
    if (site && !d.SITES[site]) throw err("Unknown flagship");
    if (site && POS[key].multi) throw err(`${POS[key].n} covers several flagships — it has one setup (All flagships)`);
    const raw = await one(env.DB.prepare("SELECT v FROM meta WHERE k = 'pos:cfg'"));
    let all = {}; try { all = JSON.parse((raw && raw.v) || "{}"); } catch {}
    all.def = all.def || {}; all.site = all.site || {};
    const holder = () => { if (site) { all.site[site] = all.site[site] || {}; return (all.site[site][key] = all.site[site][key] || {}); } return (all.def[key] = all.def[key] || {}); };
    if (b.reset) { if (site) { if (all.site[site]) delete all.site[site][key]; } else delete all.def[key]; }
    else {
      const part = String(b.part || "");
      if (!["tools", "mail", "sys"].includes(part)) throw err("Unknown setting");
      const sub = part === "sys" ? String(b.sys || "") : "";
      if (part === "sys" && !SYS_OBJ[sub]) throw err("Unknown system");
      const ids = Array.isArray(b.ids) ? b.ids : [b.id];
      for (const id0 of ids.slice(0, 200)) {
        const id = String(id0 || "");
        if (part === "tools" && !/^[a-z0-9-]{2,40}$/.test(id)) throw err("Unknown tool");
        if (part === "mail" && !AUTO_MAILS[id]) throw err("Unknown email");
        if (part === "sys" && !SYS_OBJ[sub].some(o => o[0] === id)) throw err("Unknown object");
        let val = b.value;
        if (part === "sys" ? !VALS.includes(val) : typeof val !== "boolean") val = null;
        /* the value it would have without this setting: the default for a flagship, the built-in rule for the default */
        const without = site ? (part === "tools" ? (() => { const v = dig(all.def, key, "tools", id); return typeof v === "boolean" ? v : !!d.legacyAllows(POS_USER[key], id); })()
            : part === "mail" ? mailOn(key, "", id, { def: all.def, site: {} }) : sysRightsOf(key, "", sub, { def: all.def, site: {} })[id])
          : part === "tools" ? !!d.legacyAllows(POS_USER[key], id) : part === "mail" ? (MAIL_DEF[key] || []).includes(id) : sysBase(key, sub)[id];
        const h = holder(), box = part === "sys" ? ((h.sys = h.sys || {})[sub] = h.sys[sub] || {}) : (h[part] = h[part] || {});
        if (val === null || val === without) delete box[id]; else box[id] = val;
      }
    }
    /* drop empty objects */
    const prune = o => { for (const k of Object.keys(o)) { if (o[k] && typeof o[k] === "object") { prune(o[k]); if (!Object.keys(o[k]).length) delete o[k]; } } return o; };
    prune(all);
    all.at = new Date().toISOString(); all.by = me.full_name || me.email;
    await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('pos:cfg', ?)").bind(JSON.stringify({ def: all.def || {}, site: all.site || {}, person: all.person || {}, at: all.at, by: all.by })).run();
    CFG = null;
    if (d.audit) await d.audit(env, { me, site: site || "", tool: "admin", ref: "positions", label: `Positions · ${POS[key].n}${site ? " · " + d.SITES[site] : ""} · ${b.reset ? "back to default" : b.part}`, action: "update", changes: [] }).catch(() => {});
    return { saved: true, cfg: await posCfg(env, true) };
  }
  const cfg = await posCfg(env, true);
  const apps = d.appIds();
  const base = Object.fromEntries(Object.keys(POS).map(k => [k, {
    tools: Object.fromEntries(apps.map(a => [a, !!d.legacyAllows(POS_USER[k], a)])),
    mail: Object.fromEntries(Object.keys(AUTO_MAILS).map(m => [m, (MAIL_DEF[k] || []).includes(m)])),
    sys: Object.fromEntries(Object.keys(SYS_OBJ).map(s => [s, sysBase(k, s)]))
  }]));
  const counts = await env.DB.prepare("SELECT role, position, site_code, sites FROM users WHERE active = 1").all().then(r => r.results || []).catch(() => []);
  const people = {}; for (const u of counts) { const k = posKeyOf(u); if (!k) continue; people[k] = people[k] || { all: 0 }; people[k].all++; if (!POS[k].multi && u.site_code) people[k][u.site_code] = (people[k][u.site_code] || 0) + 1; }
  return { pos: POS, sites: d.SITES, mails: AUTO_MAILS, objects: SYS_OBJ, sysNames: SYS_NAMES, cfg, base, people, off: d.offApps() };
}

/* =====================================================================
   INCIDENT REPORT SETTINGS
   ===================================================================== */
export const INC_TYPES = ["Electrical cut off", "Other Technical Incident", "Fight / Misbehavior", "Car Accident", "Theft", "Medical Case", "Tripping / Falling", "Harassment", "Other Operational Incident"];
export const INC_SITE = { VRM: "Verdun Mall", ACM: "Achrafieh Mall", DBS: "Dbayeh Mall", ACS: "Achrafieh DS", VRS: "Verdun DS" };   // the Incident system's own flagship names
const INC_SITE_CODE = Object.fromEntries(Object.entries(INC_SITE).map(([c, n]) => [n, c]));
/* the Incident system's old "Position" list → hub positions (used once, when the settings move to the hub) */
const OLD_POS = { "security manager": ["SECM", "HOS"], "property manager": ["MM"], "mall director": ["DIRECTOR", "CDSO"], "supervisor": ["SMS", "MS"], "property advisor": ["ADVISOR"] };
const mailOk = e => /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(String(e || "").trim());
const listOf = s => String(s || "").split(/[,;\s]+/).map(x => x.trim().toLowerCase()).filter(mailOk);

let ICFG = null, ICFG_AT = 0;
async function incCfg(env, fresh) {
  if (!fresh && ICFG && Date.now() - ICFG_AT < 30000) return ICFG;
  const r = await one(env.DB.prepare("SELECT v FROM meta WHERE k = 'inc:cfg'"));
  try { ICFG = r ? JSON.parse(r.v) : null; } catch { ICFG = null; } ICFG_AT = Date.now();
  return ICFG;
}
function cleanInc(x) {
  const contacts = (Array.isArray(x.contacts) ? x.contacts : []).slice(0, 40).map((c, i) => ({ id: String(c.id || "c" + Date.now().toString(36) + i).replace(/[^a-z0-9]/gi, "").slice(0, 20),
    label: String(c.label || "").replace(/\s+/g, " ").trim().slice(0, 60), email: String(c.email || "").trim().toLowerCase() })).filter(c => c.label && mailOk(c.email));
  const ids = new Set(contacts.map(c => c.id));
  const grp = g => ({ pos: [...new Set((Array.isArray(g && g.pos) ? g.pos : []).filter(k => POS[k]))], contacts: [...new Set((Array.isArray(g && g.contacts) ? g.contacts : []).filter(k => ids.has(k)))] });
  const cc = Object.fromEntries(INC_TYPES.map(t => [t, grp((x.cc || {})[t])]));
  const cs = {}, cctv = {};
  for (const c of Object.keys(INC_SITE)) {
    const s = (x.cs || {})[c] || {};
    if (mailOk(s.email)) cs[c] = { email: String(s.email).trim().toLowerCase(), cc: listOf(s.cc).join(", ") };
    if (mailOk((x.cctv || {})[c])) cctv[c] = String(x.cctv[c]).trim().toLowerCase();
  }
  return { cc, contacts, cs, cctv, phone: String(x.phone || "").replace(/[^\d+ ()-]/g, "").slice(0, 30), digest: grp(x.digest), weekly: grp(x.weekly) };
}
/* first open: copy what the Incident system has today */
async function incMigrate(env, d) {
  const ex = await d.incFetch("/api/hubcfg-export").catch(() => null);
  if (!ex) return null;
  const contacts = [], cidOf = new Map();
  const contact = (label, email) => { email = String(email || "").trim().toLowerCase(); if (!mailOk(email)) return null;
    const k = label + "|" + email; if (!cidOf.has(k)) { const id = "c" + (contacts.length + 1); contacts.push({ id, label, email }); cidOf.set(k, id); } return cidOf.get(k); };
  const usersAt = pos => (ex.users || []).filter(u => u.active && String(u.position || "").toLowerCase() === pos);
  const grpFrom = csv => { const pos = new Set(), cs = new Set();
    for (const p of String(csv || "").split(",").map(s => s.trim()).filter(Boolean)) {
      const k = p.toLowerCase();
      if (OLD_POS[k]) OLD_POS[k].forEach(x => pos.add(x));
      else if (!["customer service", "cctv team"].includes(k)) for (const u of usersAt(k)) { const id = contact(p, u.email); if (id) cs.add(id); }
    }
    return { pos: [...pos], contacts: [...cs] }; };
  const cc = Object.fromEntries(INC_TYPES.map(t => [t, grpFrom((ex.cc || {})[t])]));
  const cs = {}, cctv = {};
  for (const r of ex.cs || []) { const c = INC_SITE_CODE[r.flagship]; if (c && mailOk(r.email)) cs[c] = { email: r.email, cc: r.cc || "" }; }
  for (const r of ex.cctv || []) { const c = INC_SITE_CODE[r.flagship]; if (c && mailOk(r.email)) cctv[c] = r.email; }
  const plain = csv => ({ pos: [], contacts: listOf(csv).map(e => contact("Report recipient", e)).filter(Boolean) });
  return cleanInc({ cc, contacts, cs, cctv, phone: ex.phone || "", digest: plain(ex.digest), weekly: plain(ex.weekly) });
}
export async function incAdmin(env, method, b, me, d) {
  if (method === "POST") {
    const v = { ...cleanInc(b.cfg || {}), at: new Date().toISOString(), by: me.full_name || me.email };
    await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('inc:cfg', ?)").bind(JSON.stringify(v)).run();
    ICFG = null;
    if (d.audit) await d.audit(env, { me, site: "", tool: "admin", ref: "incident-settings", label: "Incident Report settings saved", action: "update", changes: [] }).catch(() => {});
    return { saved: true, cfg: v };
  }
  let cfg = await incCfg(env, true), migrated = false;
  if (!cfg) { cfg = await incMigrate(env, d); if (cfg) { migrated = true; cfg = { ...cfg, at: new Date().toISOString(), by: "Copied from the Incident system" };
    await env.DB.prepare("INSERT OR IGNORE INTO meta (k, v) VALUES ('inc:cfg', ?)").bind(JSON.stringify(cfg)).run(); ICFG = null; } }
  return { cfg: cfg || cleanInc({}), migrated, ready: !!cfg, types: INC_TYPES, sites: INC_SITE, pos: POS };
}
/* server-to-server (x-hub-key): the Incident system's recipients, resolved to email addresses */
export async function incServer(env, d) {
  const cfg = await incCfg(env);
  if (!cfg) return { ready: false };
  const { results } = await env.DB.prepare("SELECT email, role, position, site_code, sites FROM users WHERE active = 1").all().catch(() => ({ results: [] }));
  const people = (results || []).map(u => ({ email: u.email, key: posKeyOf(u), sites: d.sitesOf(u) })).filter(p => p.key);
  const C = Object.fromEntries((cfg.contacts || []).map(c => [c.id, c.email]));
  const emails = (g, site) => [...new Set([...people.filter(p => (g.pos || []).includes(p.key) && (!site || p.sites.includes(site))).map(p => p.email),
    ...(g.contacts || []).map(id => C[id]).filter(Boolean)])];
  const cc = {};
  for (const t of INC_TYPES) { const g = (cfg.cc || {})[t] || {}; cc[t] = Object.fromEntries(Object.entries(INC_SITE).map(([c, n]) => [n, emails(g, c)])); }
  const byName = o => Object.fromEntries(Object.entries(o || {}).map(([c, v]) => [INC_SITE[c], v]).filter(([n]) => n));
  return { ready: true, cc, cs: Object.fromEntries(Object.entries(byName(cfg.cs)).map(([n, v]) => [n, { email: v.email, cc: listOf(v.cc) }])), cctv: byName(cfg.cctv),
    phone: cfg.phone || "", digest: emails(cfg.digest || {}), weekly: emails(cfg.weekly || {}) };
}
