/* =====================================================================
   POLICIES & PROCEDURES — the library ABCON reads (see docs/FEATURE-policies.md)
   • Collections: Owner · Assist · ABC General Policies · Verdun Tenant Manual · SOPs · Emergency Procedures · Contacts · FAQ
   • Meaning search: every passage also gets an embedding (Workers AI bge-m3, multilingual — Arabic questions find English rules),
     kept in D1 (pol_vec, 8-bit) and searched in memory; results are merged with the word search (reciprocal rank fusion).
   • Upload (Admin, Mall Manager, Operations Manager): PDF or Word. The browser reads the text (pdf.js / mammoth)
     and sends it in pieces ("chunks") with their page and section; the original file goes to R2 (binding FILES).
   • Search: SQLite FTS5 over the chunks (D1), best matches first, with the passage, page and section.
   • ABCON: polSearch() gives the AI the few passages that match a question, so it answers from them and cites them.
   Routes (/api/pol/…): list · doc · search · file (GET open / PUT upload) · save (POST) · remove (POST)
   ===================================================================== */
const err = (m, status = 400) => Object.assign(new Error(m), { status });
export const POL_COLLS = { owner: "Owner", assist: "Assist", general: "ABC General Policies", vtm: "Verdun Tenant Manual",
  sop: "SOPs", emergency: "Emergency Procedures", contacts: "Contacts", faq: "FAQ" };
const MAX_FILE = 25 * 1024 * 1024, MAX_CHUNKS = 4000;
const clip = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
let ftsOk = null;   // FTS5 available (true on D1); a LIKE search is used if not

export async function polSchema(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS pol_docs (id INTEGER PRIMARY KEY AUTOINCREMENT, coll TEXT NOT NULL, title TEXT NOT NULL, version TEXT NOT NULL DEFAULT '',
      file_key TEXT NOT NULL DEFAULT '', file_name TEXT NOT NULL DEFAULT '', mime TEXT NOT NULL DEFAULT '', size INTEGER NOT NULL DEFAULT 0, pages INTEGER NOT NULL DEFAULT 0,
      chars INTEGER NOT NULL DEFAULT 0, notext INTEGER NOT NULL DEFAULT 0, replaces INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 0,
      by_name TEXT NOT NULL DEFAULT '', by_email TEXT NOT NULL DEFAULT '', at TEXT NOT NULL DEFAULT '')`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS pol_chunks (id INTEGER PRIMARY KEY AUTOINCREMENT, doc_id INTEGER NOT NULL, n INTEGER NOT NULL, page INTEGER NOT NULL DEFAULT 0,
      section TEXT NOT NULL DEFAULT '', text TEXT NOT NULL)`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS pol_chunks_doc ON pol_chunks (doc_id, n)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS pol_vec (chunk_id INTEGER PRIMARY KEY, doc_id INTEGER NOT NULL, v BLOB NOT NULL)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS pol_vec_doc ON pol_vec (doc_id)")
  ]);
  try { await env.DB.prepare("CREATE VIRTUAL TABLE IF NOT EXISTS pol_fts USING fts5(text, section, title, doc_id UNINDEXED, chunk_id UNINDEXED, tokenize='porter unicode61 remove_diacritics 2')").run(); ftsOk = true; }
  catch (e) { ftsOk = false; console.error("pol fts", e && e.message); }
}

const STOP = new Set("the a an and or of to in on at for by with is are was be can do does what which who how when where why this that these those it its from as any all our your their there have has not no yes may must should shall will would about into than then also per i we you he she they me my".split(" "));
/* words of a question → an FTS query ("deliver"* OR "loading"* …) */
function ftsQuery(q) {
  const w = [...new Set(String(q || "").toLowerCase().normalize("NFKC").match(/[\p{L}\p{N}]{2,}/gu) || [])].filter(x => !STOP.has(x) && (x.length > 2 || /\d/.test(x))).slice(0, 12);
  return { words: w, q: w.map(x => `"${x.replace(/"/g, "")}"*`).join(" OR ") };
}

/* ---------- meaning search (embeddings) ---------- */
const toI8 = v => { let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1; const o = new Int8Array(v.length); for (let i = 0; i < v.length; i++) o[i] = Math.max(-127, Math.min(127, Math.round(v[i] / n * 127))); return o; };
const fromBlob = b => b instanceof Int8Array ? b : new Int8Array(b instanceof ArrayBuffer ? b : Uint8Array.from(b).buffer);
let VC = null;   // { ver, ids, docs, dim, mat } — the vectors of the live library, loaded once per Worker instance and version
async function bump(env) { await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('pol:ver', ?)").bind(String(Date.now())).run().catch(() => {}); }
/* D1 reads: the cron looks for passages to embed only after an upload / change ('pol:dirty'), not every 2 minutes */
const dirty = (env, on) => env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('pol:dirty', ?)").bind(on ? "1" : "0").run().catch(() => {});
async function vectors(env) {
  const ver = ((await env.DB.prepare("SELECT v FROM meta WHERE k = 'pol:ver'").first().catch(() => null)) || {}).v || "0";
  if (VC && VC.ver === ver) return VC;
  const rows = (await env.DB.prepare("SELECT v.chunk_id, v.doc_id, v.v FROM pol_vec v JOIN pol_docs d ON d.id = v.doc_id WHERE d.active = 1").all().catch(() => ({ results: [] }))).results || [];
  if (!rows.length) return (VC = { ver, ids: [], docs: [], dim: 0, mat: new Int8Array(0) });
  const dim = fromBlob(rows[0].v).length, mat = new Int8Array(rows.length * dim);
  rows.forEach((r, i) => mat.set(fromBlob(r.v).subarray(0, dim), i * dim));
  return (VC = { ver, ids: rows.map(r => r.chunk_id), docs: rows.map(r => r.doc_id), dim, mat });
}
async function vecSearch(env, qv, k, coll) {
  const V = await vectors(env); if (!V.ids.length || !qv) return [];
  const q = toI8(qv); if (q.length !== V.dim) return [];
  let allowed = null;
  if (coll) allowed = new Set(((await env.DB.prepare("SELECT id FROM pol_docs WHERE coll = ? AND active = 1").bind(coll).all()).results || []).map(r => r.id));
  const out = [];
  for (let i = 0; i < V.ids.length; i++) {
    if (allowed && !allowed.has(V.docs[i])) continue;
    let s = 0; const o = i * V.dim; for (let j = 0; j < V.dim; j++) s += q[j] * V.mat[o + j];
    out.push([V.ids[i], V.docs[i], s / (127 * 127)]);
  }
  return out.sort((a, b) => b[2] - a[2]).slice(0, k).filter(x => x[2] >= 0.42);
}
/* embeddings for passages that have none yet (after an upload; the cron finishes what is left) */
export async function polEmbedPending(env, embed, { docId = 0, limit = 48, cron = false } = {}) {
  if (!embed) return { done: 0, left: 0 };
  if (cron) { const f = await env.DB.prepare("SELECT v FROM meta WHERE k = 'pol:dirty'").first().catch(() => null); if (f && f.v === "0") return { done: 0, left: 0, idle: true }; }
  const rows = (await env.DB.prepare(`SELECT c.id, c.doc_id, c.section, c.text FROM pol_chunks c JOIN pol_docs d ON d.id = c.doc_id LEFT JOIN pol_vec v ON v.chunk_id = c.id
    WHERE v.chunk_id IS NULL AND d.active = 1 ${docId ? "AND c.doc_id = ?" : ""} ORDER BY c.doc_id, c.n LIMIT ?`).bind(...(docId ? [docId, limit] : [limit])).all()).results || [];
  let done = 0;
  if (rows.length) {
    const vs = await embed(rows.map(r => clip((r.section ? r.section + ". " : "") + r.text, 1500))).catch(e => { console.error("pol embed", e && e.message); return null; });
    if (vs && vs.length === rows.length) {
      for (let i = 0; i < rows.length; i += 40) await env.DB.batch(rows.slice(i, i + 40).map((r, j) => env.DB.prepare("INSERT OR REPLACE INTO pol_vec (chunk_id, doc_id, v) VALUES (?,?,?)").bind(r.id, r.doc_id, toI8(vs[i + j]).buffer)));
      done = rows.length; await bump(env);
    }
  }
  const left = Number(((await env.DB.prepare(`SELECT COUNT(*) AS n FROM pol_chunks c JOIN pol_docs d ON d.id = c.doc_id LEFT JOIN pol_vec v ON v.chunk_id = c.id WHERE v.chunk_id IS NULL AND d.active = 1 ${docId ? "AND c.doc_id = ?" : ""}`).bind(...(docId ? [docId] : [])).first()) || {}).n) || 0;
  if (!docId) await dirty(env, left > 0);
  return { done, left };
}

/* the best passages for a question — used by the search page and by ABCON */
export async function polSearch(env, q, { limit = 20, coll = "", embed = null } = {}) {
  const { words, q: fq } = ftsQuery(q);
  const C = POL_COLLS[coll] ? coll : "";
  /* the question's meaning (one tiny embedding) — skipped when there are no passage vectors yet */
  let vhits = [];
  if (embed && (await vectors(env)).ids.length) { const qv = await embed([clip(q, 500)]).then(v => v && v[0]).catch(() => null); vhits = await vecSearch(env, qv, limit, C); }
  if (!words.length && !vhits.length) return [];
  let rows = [];
  if (words.length && ftsOk !== false) {
    try {
      rows = (await env.DB.prepare(`SELECT f.chunk_id AS id, f.doc_id, snippet(pol_fts, 0, '[[', ']]', '…', 26) AS snip, bm25(pol_fts, 1.0, 2.0, 1.5) AS score
        FROM pol_fts f JOIN pol_docs d ON d.id = f.doc_id WHERE pol_fts MATCH ? AND d.active = 1 ${C ? "AND d.coll = ?" : ""} ORDER BY score LIMIT ?`)
        .bind(...[fq, ...(C ? [C] : []), limit]).all()).results || [];
    } catch (e) { console.error("pol search", e && e.message); rows = null; }
  }
  if (!rows && words.length) {   // fallback: LIKE on the words, ranked by how many words a passage has
    const like = words.slice(0, 6);
    rows = ((await env.DB.prepare(`SELECT c.id, c.doc_id, c.text AS snip, (${like.map(() => "(instr(lower(c.text), ?) > 0)").join(" + ")}) AS hits FROM pol_chunks c JOIN pol_docs d ON d.id = c.doc_id
      WHERE d.active = 1 ${C ? "AND d.coll = ?" : ""} AND (${like.map(() => "lower(c.text) LIKE ?").join(" OR ")}) ORDER BY hits DESC LIMIT ?`)
      .bind(...like, ...(C ? [C] : []), ...like.map(x => `%${x}%`), limit).all()).results || []).map(r => ({ ...r, score: -r.hits, snip: clip(r.snip, 320) }));
  }
  rows = rows || [];
  /* merge the two lists: reciprocal rank fusion (a passage high in both lists comes first) */
  const F = new Map();
  rows.forEach((r, i) => F.set(r.id, { id: r.id, snip: r.snip, score: 1 / (60 + i), kw: true }));
  vhits.forEach(([id, , sim], i) => { const x = F.get(id) || { id, snip: "", score: 0 }; x.score += 1 / (60 + i) + (sim > 0.6 ? 0.004 : 0); x.sim = sim; F.set(id, x); });
  rows = [...F.values()].sort((a, b) => b.score - a.score).slice(0, limit);
  if (!rows.length) return [];
  const ids = rows.map(r => r.id);
  const meta = (await env.DB.prepare(`SELECT c.id, c.page, c.section, c.text, d.title, d.coll, d.version, d.id AS doc FROM pol_chunks c JOIN pol_docs d ON d.id = c.doc_id WHERE c.id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all()).results || [];
  const M = new Map(meta.map(m => [m.id, m]));
  return rows.map(r => { const m = M.get(r.id); return m && { id: r.id, doc: m.doc, title: m.title, coll: m.coll, collName: POL_COLLS[m.coll] || m.coll, version: m.version,
    page: m.page, section: m.section, snip: r.snip || clip(m.text, 300), text: m.text, score: r.score, meaning: !r.kw }; }).filter(Boolean);
}

async function removeDoc(env, id) {
  const d = await env.DB.prepare("SELECT file_key FROM pol_docs WHERE id = ?").bind(id).first();
  if (!d) return;
  const ops = [env.DB.prepare("DELETE FROM pol_vec WHERE doc_id = ?").bind(id), env.DB.prepare("DELETE FROM pol_chunks WHERE doc_id = ?").bind(id), env.DB.prepare("DELETE FROM pol_docs WHERE id = ?").bind(id)];
  if (ftsOk !== false) ops.unshift(env.DB.prepare("DELETE FROM pol_fts WHERE doc_id = ?").bind(id));
  await env.DB.batch(ops).catch(async () => { await env.DB.prepare("DELETE FROM pol_chunks WHERE doc_id = ?").bind(id).run(); await env.DB.prepare("DELETE FROM pol_docs WHERE id = ?").bind(id).run(); });
  if (d.file_key && env.FILES) await env.FILES.delete(d.file_key).catch(() => {});
  await bump(env);
}

export async function polRoute(env, p, method, b, url, request, { me, now, canEdit, embed }) {
  const q = k => url.searchParams.get(k) || "";
  if (p === "pol/list") {
    const docs = (await env.DB.prepare("SELECT id, coll, title, version, file_name, mime, size, pages, chars, notext, by_name, at FROM pol_docs WHERE active = 1 ORDER BY coll, title").all()).results || [];
    const pend = (await env.DB.prepare("SELECT c.doc_id, COUNT(*) AS n FROM pol_chunks c LEFT JOIN pol_vec v ON v.chunk_id = c.id WHERE v.chunk_id IS NULL GROUP BY c.doc_id").all().catch(() => ({ results: [] }))).results || [];
    const P = new Map(pend.map(r => [r.doc_id, r.n]));
    return { colls: POL_COLLS, docs: docs.map(d => ({ ...d, pending: P.get(d.id) || 0 })), canEdit, files: !!env.FILES };
  }
  if (p === "pol/search") return { q: q("q"), hits: (await polSearch(env, q("q"), { coll: q("coll"), limit: 30, embed })).map(({ text, ...h }) => h) };
  if (p === "pol/doc") {   // the text of one document, page by page (the reader view; works on every phone and for Word files)
    const d = await env.DB.prepare("SELECT id, coll, title, version, file_name, mime, size, pages, chars, notext, by_name, at FROM pol_docs WHERE id = ? AND active = 1").bind(Number(q("id"))).first();
    if (!d) throw err("This document is not in the library any more", 404);
    const chunks = (await env.DB.prepare("SELECT n, page, section, text FROM pol_chunks WHERE doc_id = ? ORDER BY n").bind(d.id).all()).results || [];
    return { doc: { ...d, collName: POL_COLLS[d.coll] }, chunks };
  }
  if (p === "pol/file" && method === "GET") {
    const d = await env.DB.prepare("SELECT file_key, file_name, mime FROM pol_docs WHERE id = ? AND active = 1").bind(Number(q("id"))).first();
    if (!d || !d.file_key) throw err("File not found", 404);
    if (!env.FILES) throw err("File storage is not connected yet", 503);
    const o = await env.FILES.get(d.file_key); if (!o) throw err("File not found", 404);
    const h = new Headers({ "content-type": d.mime || "application/octet-stream", "cache-control": "private, max-age=300", "x-robots-tag": "noindex",
      "content-disposition": `${/pdf/.test(d.mime) && q("dl") !== "1" ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(d.file_name || "policy")}` });
    return new Response(o.body, { headers: h });
  }

  /* ----- changes: Admin, Mall Manager, Operations Manager ----- */
  if (!canEdit) throw err("Only the Admin, the Mall Manager and the Operations Manager change the library", 403);
  if (p === "pol/save" && method === "POST") {   // 1) the text and details → a new (inactive) document; 2) the file follows with PUT pol/file
    const coll = POL_COLLS[b.coll] ? b.coll : "", title = clip(b.title, 140);
    if (!coll) throw err("Choose the collection"); if (!title) throw err("Write the title");
    const chunks = (Array.isArray(b.chunks) ? b.chunks : []).slice(0, MAX_CHUNKS).map((c, i) => ({ n: i, page: Math.max(0, Math.min(5000, Number(c.page) || 0)), section: clip(c.section, 160), text: String(c.text || "").replace(/[ \t]+/g, " ").trim().slice(0, 2400) })).filter(c => c.text);
    const chars = chunks.reduce((a, c) => a + c.text.length, 0), pages = Math.max(0, Number(b.pages) || 0);
    const notext = chars < 60 || (pages && chars / pages < 40) ? 1 : 0;   // a scanned PDF has (almost) no text per page
    const replaces = Number(b.replaces) || 0;
    if (replaces && !(await env.DB.prepare("SELECT id FROM pol_docs WHERE id = ? AND active = 1").bind(replaces).first())) throw err("The document to replace was not found");
    const size = Number(b.size) || 0; if (size > MAX_FILE) throw err("The file is larger than 25 MB");
    const r = await env.DB.prepare(`INSERT INTO pol_docs (coll, title, version, file_name, mime, size, pages, chars, notext, replaces, active, by_name, by_email, at) VALUES (?,?,?,?,?,?,?,?,?,?,0,?,?,?)`)
      .bind(coll, title, clip(b.version, 30), clip(b.fileName, 160), clip(b.mime, 100), size, pages, chars, notext, replaces, me.full_name || me.email, me.email, now()).run();
    const id = r.meta.last_row_id;
    for (let i = 0; i < chunks.length; i += 40) {
      const part = chunks.slice(i, i + 40), ops = [];
      await dirty(env, true);
      for (const c of part) ops.push(env.DB.prepare("INSERT INTO pol_chunks (doc_id, n, page, section, text) VALUES (?,?,?,?,?)").bind(id, c.n, c.page, c.section, c.text));
      await env.DB.batch(ops);
    }
    return { id, chunks: chunks.length, notext: !!notext };
  }
  if (p === "pol/file" && method === "PUT") {   // the original file; when it is stored the document goes live (and replaces the old version)
    const origin = request.headers.get("origin"); if (origin && origin !== url.origin) throw err("Request blocked", 403);
    if (!env.FILES) throw err("File storage is not connected yet — the hub needs its R2 bucket (abc-hub-files)", 503);
    const id = Number(q("id")), d = await env.DB.prepare("SELECT id, coll, title, mime, replaces, by_email FROM pol_docs WHERE id = ? AND active = 0").bind(id).first();
    if (!d) throw err("Upload the details first");
    const buf = await request.arrayBuffer();
    if (!buf.byteLength) throw err("The file is empty"); if (buf.byteLength > MAX_FILE) throw err("The file is larger than 25 MB");
    const key = `policies/${id}-${crypto.randomUUID()}`;
    await env.FILES.put(key, buf, { httpMetadata: { contentType: d.mime || "application/octet-stream" } });
    if (ftsOk !== false) {
      const ch = (await env.DB.prepare("SELECT id, section, text FROM pol_chunks WHERE doc_id = ? ORDER BY n").bind(id).all()).results || [];
      for (let i = 0; i < ch.length; i += 40) await env.DB.batch(ch.slice(i, i + 40).map(c => env.DB.prepare("INSERT INTO pol_fts (text, section, title, doc_id, chunk_id) VALUES (?,?,?,?,?)").bind(c.text, c.section, d.title, id, c.id)))
        .catch(e => console.error("pol fts insert", e && e.message));
    }
    await env.DB.prepare("UPDATE pol_docs SET file_key = ?, size = ?, active = 1 WHERE id = ?").bind(key, buf.byteLength, id).run();
    if (d.replaces) await removeDoc(env, d.replaces);
    await bump(env);
    /* uploads that never got their file (closed tab) are tidied after a day */
    const old = (await env.DB.prepare("SELECT id FROM pol_docs WHERE active = 0 AND at < ?").bind(new Date(Date.now() - 864e5).toISOString()).all()).results || [];
    for (const o of old) await removeDoc(env, o.id);
    return { id, live: true };
  }
  if (p === "pol/remove" && method === "POST") { await removeDoc(env, Number(b.id)); return { removed: true }; }
  if (p === "pol/embed" && method === "POST") return polEmbedPending(env, embed, { docId: Number(b.id) || 0, limit: 48 });   // the upload screen calls this until "left" is 0
  throw err("Unknown request", 404);
}
