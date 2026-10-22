/* =====================================================================
   KEY BOX — vacant units' keys (Oct 2026, Upcoming - Testing) — docs/FEATURE-keybox.md
   • The hooks come from GLA & Occupancy: every Leasing unit that is Vacant / Terminated gets a hook
     (a leased unit keeps its hook only while its key is still out).
   • Hand out / receive: the operations team (management, Mall Supervisors, Mall Officers) and Security.
     Anyone else (e.g. Leasing) can take a key for themselves and return their own.
   • Takers: hub staff, tenants or contractors (they sign on the staff member's phone; optional photo of their ID).
   • Late keys: the operations team of the flagship is alerted (hub bell + push, app "keybox-late"), again every day at 09:00.
   Routes /api/ops/kb/* : board · out · in · keys · history · photo
   ===================================================================== */
const err = (m, status = 400) => Object.assign(new Error(m), { status });
const clip = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
export const KB_PURPOSES = ["Viewing", "Fit-out", "Maintenance", "Inspection", "Other"];
const KINDS = { staff: "Hub staff", leasing: "Leasing", tenant: "Tenant", contractor: "Contractor", other: "Other" };

export async function keyboxSchema(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS kb_units (site TEXT NOT NULL, unit TEXT NOT NULL, keys INTEGER NOT NULL DEFAULT 1, note TEXT NOT NULL DEFAULT '',
      updated_by TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '', PRIMARY KEY (site, unit))`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS kb_moves (id INTEGER PRIMARY KEY AUTOINCREMENT, site TEXT NOT NULL, unit TEXT NOT NULL,
      out_at TEXT NOT NULL, due_at TEXT NOT NULL, back_at TEXT NOT NULL DEFAULT '', keys INTEGER NOT NULL DEFAULT 1,
      taker TEXT NOT NULL, taker_kind TEXT NOT NULL DEFAULT 'staff', taker_email TEXT NOT NULL DEFAULT '', company TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '',
      purpose TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', signature TEXT NOT NULL DEFAULT '', id_photo TEXT NOT NULL DEFAULT '',
      given_by TEXT NOT NULL DEFAULT '', given_email TEXT NOT NULL DEFAULT '', received_by TEXT NOT NULL DEFAULT '', late_alert TEXT NOT NULL DEFAULT '')`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS kb_moves_open ON kb_moves (site, back_at, unit)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS kb_moves_unit ON kb_moves (site, unit, id)")
  ]);
}
const moveOut = (m, now) => m ? ({ id: m.id, unit: m.unit, outAt: m.out_at, dueAt: m.due_at, backAt: m.back_at, keys: m.keys, taker: m.taker, takerKind: m.taker_kind,
  kindLabel: KINDS[m.taker_kind] || m.taker_kind, takerEmail: m.taker_email, company: m.company, phone: m.phone, purpose: m.purpose, notes: m.notes,
  signed: !!m.signature, photo: !!m.id_photo, givenBy: m.given_by, receivedBy: m.received_by, late: !m.back_at && m.due_at < now }) : null;

export async function keyboxRoute(env, p, method, b, url, d) {
  const { site, me } = d;
  if (!d.canSite(me, site)) throw err("No access to this flagship", 403);
  const now = new Date().toISOString(), q = n => url.searchParams.get(n) || b[n] || "";
  const staff = d.isOps(me);   // hands out / receives for others

  if (p === "kb/board") {
    const [gla, units, open] = await Promise.all([
      env.DB.prepare("SELECT code, level, brand, status, area FROM gla_units WHERE site = ? AND active = 1 AND section = 'Leasing'").bind(site).all(),
      env.DB.prepare("SELECT unit, keys, note FROM kb_units WHERE site = ?").bind(site).all(),
      env.DB.prepare("SELECT * FROM kb_moves WHERE site = ? AND back_at = '' ORDER BY id").bind(site).all()]);
    const U = new Map((units.results || []).map(u => [u.unit, u]));
    const O = new Map((open.results || []).map(m => [m.unit, m]));
    const vacant = (gla.results || []).filter(u => /vacant|terminated/i.test(u.status));
    const codes = new Set(vacant.map(u => u.code));
    for (const m of open.results || []) if (!codes.has(m.unit)) codes.add(m.unit);   // still out after the unit was leased
    const all = gla.results || [];
    const hooks = [...codes].map(code => {
      const g = all.find(u => u.code === code) || {}, k = U.get(code), m = O.get(code);
      return { unit: code, level: g.level || (code.split(/[-\s]/)[0] || ""), status: g.status || "", area: g.area || 0, vacant: /vacant|terminated/i.test(g.status || ""),
        keys: k ? k.keys : 1, note: k ? k.note : "", out: moveOut(m, now), state: !m ? "in" : m.due_at < now ? "late" : "out" };
    }).sort((a, c) => a.level.localeCompare(c.level, "en", { numeric: true }) || a.unit.localeCompare(c.unit, "en", { numeric: true }));
    return { site, siteName: d.siteName(site), hooks, staff, me: { name: me.full_name, email: me.email }, purposes: KB_PURPOSES, kinds: KINDS,
      counts: { in: hooks.filter(h => h.state === "in").length, out: hooks.filter(h => h.state === "out").length, late: hooks.filter(h => h.state === "late").length } };
  }
  if (p === "kb/history") {
    const unit = clip(q("unit"), 40);
    const { results } = await env.DB.prepare("SELECT * FROM kb_moves WHERE site = ? AND unit = ? ORDER BY id DESC LIMIT 30").bind(site, unit).all();
    return { unit, list: (results || []).map(m => moveOut(m, now)) };
  }
  if (p === "kb/photo") {   // the taker's ID photo or signature (operations team only)
    if (!staff) throw err("Only the operations team can see this", 403);
    const m = await env.DB.prepare("SELECT signature, id_photo FROM kb_moves WHERE id = ? AND site = ?").bind(Number(q("id")) || 0, site).first();
    const v = m ? (q("kind") === "sig" ? m.signature : m.id_photo) : "";
    return { data: v || "" };
  }
  if (method !== "POST") throw err("Unknown request", 404);
  const unit = clip(b.unit, 40);
  if (p === "kb/keys") {
    if (!staff) throw err("Only the operations team sets the number of keys", 403);
    const keys = Math.max(1, Math.min(20, Number(b.keys) || 1));
    await env.DB.prepare(`INSERT INTO kb_units (site, unit, keys, note, updated_by, updated_at) VALUES (?,?,?,?,?,?)
      ON CONFLICT(site, unit) DO UPDATE SET keys = excluded.keys, note = excluded.note, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
      .bind(site, unit, keys, clip(b.note, 120), me.full_name, now).run();
    return { unit, keys };
  }
  if (p === "kb/out") {
    if (await env.DB.prepare("SELECT 1 FROM kb_moves WHERE site = ? AND unit = ? AND back_at = ''").bind(site, unit).first()) throw err("This key is already out — return it first");
    const self = !staff || b.kind === "self";
    const kind = self ? (b.takerKind === "leasing" ? "leasing" : "staff") : (KINDS[b.takerKind] ? b.takerKind : "other");
    const taker = self ? me.full_name : clip(b.taker, 80);
    if (!taker) throw err("Write who takes the key");
    const due = String(b.dueAt || "");
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(due) || Date.parse(due) <= Date.now()) throw err("Choose when the key comes back");
    const sig = String(b.signature || ""), photo = String(b.idPhoto || "");
    if (!self && ["tenant", "contractor", "other"].includes(kind) && !/^data:image\/png;base64,/.test(sig)) throw err("The person taking the key signs first");
    if (sig.length > 120000 || photo.length > 600000) throw err("The signature or photo is too large");
    if (photo && !/^data:image\/(jpeg|png|webp);base64,/.test(photo)) throw err("The ID photo must be a picture");
    const k = await env.DB.prepare("SELECT keys FROM kb_units WHERE site = ? AND unit = ?").bind(site, unit).first();
    const keys = Math.max(1, Math.min(Number(b.keys) || 1, k ? k.keys : 20));
    const r = await env.DB.prepare(`INSERT INTO kb_moves (site, unit, out_at, due_at, keys, taker, taker_kind, taker_email, company, phone, purpose, notes, signature, id_photo, given_by, given_email)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(site, unit, now, new Date(due).toISOString(), keys, taker, kind, self ? me.email : "",
        clip(b.company, 80), clip(b.phone, 30), KB_PURPOSES.includes(b.purpose) ? b.purpose : "Other", clip(b.notes, 300), sig, photo, me.full_name, me.email).run();
    if (d.audit) await d.audit(env, { site, tool: "keybox", ref: unit, label: `Key ${unit}`, action: "out", after: { taker, kind, purpose: b.purpose, due } }).catch(() => {});
    return { id: r.meta.last_row_id };
  }
  if (p === "kb/in") {
    const m = await env.DB.prepare("SELECT * FROM kb_moves WHERE id = ? AND site = ? AND back_at = ''").bind(Number(b.id) || 0, site).first();
    if (!m) throw err("This key is already back");
    if (!staff && m.taker_email !== me.email) throw err("Only the operations team or the person who took it can return this key", 403);
    await env.DB.prepare("UPDATE kb_moves SET back_at = ?, received_by = ? WHERE id = ?").bind(now, me.full_name, m.id).run();
    if (d.audit) await d.audit(env, { site, tool: "keybox", ref: m.unit, label: `Key ${m.unit}`, action: "in", after: { taker: m.taker } }).catch(() => {});
    return { back: true, late: m.due_at < now };
  }
  throw err("Unknown request", 404);
}

/* tile badge: late keys of the flagship */
export async function keyboxLate(env, site) {
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM kb_moves WHERE site = ? AND back_at = '' AND due_at < ?").bind(site, new Date().toISOString()).first().catch(() => ({ n: 0 }));
  return Number(r && r.n) || 0;
}

/* cron: late keys → the operations team (once when late, then every day from 09:00 while still out) */
export async function keyboxRun(env, d) {
  const now = new Date().toISOString(), today = d.today(), hour = d.hour();
  const { results } = await env.DB.prepare("SELECT * FROM kb_moves WHERE back_at = '' AND due_at < ? AND late_alert != ? LIMIT 100").bind(now, today).all().catch(() => ({ results: [] }));
  for (const m of results || []) {
    if (m.late_alert && hour < 9) continue;   // the daily repeat waits for 09:00
    await d.raiseEvent(env, { site: m.site, app: "keybox-late", tone: "alert", title: `Key late · ${m.unit}`,
      body: `${m.taker}${m.company ? " (" + m.company + ")" : ""} · ${m.purpose} · was due ${new Date(m.due_at).toLocaleString("en-GB", { timeZone: "Asia/Beirut", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` }).catch(() => {});
    await env.DB.prepare("UPDATE kb_moves SET late_alert = ? WHERE id = ?").bind(today, m.id).run();
  }
}
