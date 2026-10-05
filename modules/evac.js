/* =====================================================================
   TENANT EVACUATION PLAN — feature module (kept separate so it can be removed cleanly)
   See docs/FEATURE-evacuation.md

   Every active tenant of the flagship (from the GLA: Open and Fit-out) gets the service corridor it
   evacuates through and the assembly point it goes to. The operations team keeps the corridor and
   assembly-point lists per flagship, so names are always written the same way.
   Tables : evac_routes (corridors + assembly points) · evac_assign (one row per GLA unit)
   Routes : /api/ops/evac/*      Page : /tools/evacuation
   ===================================================================== */

const err = (m, status = 400) => Object.assign(new Error(m), { status });
const clip = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
const LVL = ["B6", "B5", "B4", "B3", "B2", "B1", "BA", "LG", "LGF", "L0", "GF", "L1", "L2", "L3", "L4", "L5", "L6", "Roof"];
const lvlRank = l => { const i = LVL.indexOf(String(l || "").toUpperCase()); return i < 0 ? 99 : i; };
const statusOf = s => /fit/i.test(s) ? "Fit-out" : /active|open/i.test(s) ? "Open" : s || "";

export async function evacSchema(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS evac_routes (id INTEGER PRIMARY KEY AUTOINCREMENT, site TEXT NOT NULL, kind TEXT NOT NULL,
      name TEXT NOT NULL, level TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', seq INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS evac_assign (site TEXT NOT NULL, unit_id INTEGER NOT NULL, corridor_id INTEGER NOT NULL DEFAULT 0,
      assembly_id INTEGER NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT '', updated_at TEXT, updated_name TEXT, PRIMARY KEY (site, unit_id))`)
  ]);
}

async function state(env, site) {
  const [units, routes, assign] = await Promise.all([
    env.DB.prepare("SELECT id, level, code, brand, status, dept FROM gla_units WHERE site = ? AND active = 1 AND brand != '' ORDER BY seq, id").bind(site).all(),
    env.DB.prepare("SELECT * FROM evac_routes WHERE site = ? AND active = 1 ORDER BY kind, seq, name").bind(site).all(),
    env.DB.prepare("SELECT * FROM evac_assign WHERE site = ?").bind(site).all()
  ]);
  const A = new Map((assign.results || []).map(a => [a.unit_id, a]));
  const tenants = (units.results || []).filter(u => /open|active|fit/i.test(u.status || "Open") && !/vacant/i.test(u.brand)).map(u => {
    const a = A.get(u.id) || {};
    return { unitId: u.id, tenant: u.brand, unit: u.code, level: u.level, status: statusOf(u.status), category: u.dept || "",
      corridorId: a.corridor_id || 0, assemblyId: a.assembly_id || 0, note: a.note || "", updatedAt: a.updated_at || "", updatedName: a.updated_name || "" };
  }).sort((a, b) => lvlRank(a.level) - lvlRank(b.level) || String(a.unit).localeCompare(String(b.unit), undefined, { numeric: true }));
  const R = routes.results || [];
  return { tenants, corridors: R.filter(r => r.kind === "corridor").map(r => ({ id: r.id, name: r.name, level: r.level, note: r.note })),
    assemblies: R.filter(r => r.kind === "assembly").map(r => ({ id: r.id, name: r.name, level: r.level, note: r.note })) };
}

export async function evacRoute(env, p, method, b, url, d) {
  const { site, me } = d;
  const team = d.canSite(me, site) && (d.full || (me.role === "SUPERVISOR" && me.position !== "WH"));
  if (p === "evac/get") return { ...(await state(env, site)), can: { edit: team } };
  if (method !== "POST") throw err("Unknown request", 404);
  if (!team) throw err("Only the operations team can change the evacuation plan", 403);

  if (p === "evac/route") {   // add / rename / remove a corridor or assembly point
    const kind = b.kind === "assembly" ? "assembly" : "corridor";
    if (b.remove) {
      const cur = await env.DB.prepare("SELECT * FROM evac_routes WHERE id = ? AND site = ?").bind(Number(b.id) || 0, site).first();
      if (!cur) throw err("Not found", 404);
      await env.DB.batch([
        env.DB.prepare("UPDATE evac_routes SET active = 0 WHERE id = ?").bind(cur.id),
        env.DB.prepare(`UPDATE evac_assign SET ${cur.kind === "assembly" ? "assembly_id" : "corridor_id"} = 0 WHERE site = ? AND ${cur.kind === "assembly" ? "assembly_id" : "corridor_id"} = ?`).bind(site, cur.id)
      ]);
      if (d.audit) await d.audit(env, { site, tool: "evacuation", ref: "route-" + cur.id, label: cur.name, action: "delete", before: { name: cur.name, level: cur.level } });
      return state(env, site);
    }
    const name = clip(b.name, 120);
    if (!name) throw err(kind === "assembly" ? "Name the assembly point" : "Name the service corridor");
    if (b.id) {
      const cur = await env.DB.prepare("SELECT * FROM evac_routes WHERE id = ? AND site = ?").bind(Number(b.id), site).first();
      if (!cur) throw err("Not found", 404);
      await env.DB.prepare("UPDATE evac_routes SET name = ?, level = ?, note = ? WHERE id = ?").bind(name, clip(b.level, 20), clip(b.note, 300), cur.id).run();
      if (d.audit) await d.audit(env, { site, tool: "evacuation", ref: "route-" + cur.id, label: name, action: "edit", before: { name: cur.name, level: cur.level, note: cur.note }, after: { name, level: clip(b.level, 20), note: clip(b.note, 300) } });
    } else {
      const dup = await env.DB.prepare("SELECT id FROM evac_routes WHERE site = ? AND kind = ? AND active = 1 AND lower(name) = lower(?)").bind(site, kind, name).first();
      if (dup) throw err("That name already exists");
      await env.DB.prepare("INSERT INTO evac_routes (site, kind, name, level, note, seq) VALUES (?,?,?,?,?,?)").bind(site, kind, name, clip(b.level, 20), clip(b.note, 300), Date.now() % 1e9).run();
      if (d.audit) await d.audit(env, { site, tool: "evacuation", ref: "route-new", label: name, action: "add", after: { kind, name, level: clip(b.level, 20) } });
    }
    return state(env, site);
  }

  if (p === "evac/assign") {   // one or several tenants at once
    const list = (Array.isArray(b.rows) ? b.rows : [b]).slice(0, 300);
    const S = await state(env, site);
    const ok = new Set(S.tenants.map(t => t.unitId)), C = new Set(S.corridors.map(c => c.id)), AP = new Set(S.assemblies.map(a => a.id));
    const byUnit = new Map(S.tenants.map(t => [t.unitId, t]));
    const now = d.now(), ops = [];
    for (const r of list) {
      const unit = Number(r.unitId) || 0;
      if (!ok.has(unit)) continue;
      const cur = byUnit.get(unit);
      const corridor = r.corridorId === undefined ? cur.corridorId : C.has(Number(r.corridorId)) ? Number(r.corridorId) : 0;
      const assembly = r.assemblyId === undefined ? cur.assemblyId : AP.has(Number(r.assemblyId)) ? Number(r.assemblyId) : 0;
      const note = r.note === undefined ? cur.note : clip(r.note, 300);
      ops.push(env.DB.prepare(`INSERT INTO evac_assign (site, unit_id, corridor_id, assembly_id, note, updated_at, updated_name) VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(site, unit_id) DO UPDATE SET corridor_id = excluded.corridor_id, assembly_id = excluded.assembly_id, note = excluded.note,
        updated_at = excluded.updated_at, updated_name = excluded.updated_name`).bind(site, unit, corridor, assembly, note, now, me.full_name));
      if (d.audit) {
        const nm = (id, L) => (L.find(x => x.id === id) || {}).name || "";
        await d.audit(env, { site, tool: "evacuation", ref: unit, label: `${cur.tenant} (${cur.unit})`, action: "edit",
          before: { corridor: nm(cur.corridorId, S.corridors), assembly: nm(cur.assemblyId, S.assemblies), note: cur.note },
          after: { corridor: nm(corridor, S.corridors), assembly: nm(assembly, S.assemblies), note } });
      }
    }
    if (ops.length) await env.DB.batch(ops);
    return { saved: ops.length, ...(await state(env, site)) };
  }
  throw err("Unknown request", 404);
}
