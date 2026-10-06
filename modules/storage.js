/* =====================================================================
   CLOUDFLARE STORAGE METER (admin) — stay inside the free allowance
   • R2 (all buckets of the account — the photos and files of Snaglist, Incidents, … live there):
     stored GB now, objects, and this month's Class A / Class B operations, against the free allowance.
     Read from the Cloudflare GraphQL Analytics API with a read-only token:
       CF_ACCOUNT_ID  (variable)  — Cloudflare dashboard → Account home → Account ID
       CF_API_TOKEN   (secret)    — My Profile → API Tokens → Create token → "Account Analytics: Read"
   • D1 (this hub's own database — files, plans and photos kept by the hub): size read from the database itself.
   Cached 30 minutes. A daily check alerts the administrators at 80 % and 95 % of any allowance.
   See docs/FEATURE-storage-meter.md
   ===================================================================== */
const GB = 1024 ** 3;
/* Cloudflare free allowance (Workers Free / R2 free tier). Override with the variables below if the plan changes. */
const limits = env => ({
  r2Bytes: (Number(env.R2_FREE_GB) || 10) * GB,               // R2 storage, GB-month
  classA: Number(env.R2_FREE_CLASS_A) || 1_000_000,           // writes / lists per month
  classB: Number(env.R2_FREE_CLASS_B) || 10_000_000,          // reads per month
  d1Bytes: (Number(env.D1_FREE_GB) || 5) * GB                 // D1 storage (all databases)
});
/* which R2 operations count as Class A or Class B (deletes are free) */
const CLASS_A = new Set(["ListBuckets", "PutBucket", "ListObjects", "PutObject", "CopyObject", "CompleteMultipartUpload", "CreateMultipartUpload",
  "UploadPart", "UploadPartCopy", "ListMultipartUploads", "ListParts", "LifecycleStorageTierTransition", "PutBucketEncryption", "PutBucketCors",
  "PutBucketLifecycleConfiguration", "PutBucketPolicy", "PutBucketTagging"]);
const FREE_OPS = new Set(["DeleteObject", "DeleteObjects", "DeleteBucket", "AbortMultipartUpload"]);

async function r2Usage(env) {
  if (!env.CF_ACCOUNT_ID || !env.CF_API_TOKEN) return { setup: false };
  const now = new Date(), monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const query = `query($acc: String!, $from: Time!, $to: Time!, $mfrom: Time!) { viewer { accounts(filter: { accountTag: $acc }) {
    storage: r2StorageAdaptiveGroups(limit: 1000, filter: { datetime_geq: $from, datetime_leq: $to }, orderBy: [datetime_DESC]) {
      max { objectCount payloadSize metadataSize } dimensions { bucketName datetime } }
    ops: r2OperationsAdaptiveGroups(limit: 2000, filter: { datetime_geq: $mfrom, datetime_leq: $to }) {
      sum { requests } dimensions { actionType bucketName } } } } }`;
  const variables = { acc: env.CF_ACCOUNT_ID, from: new Date(Date.now() - 2 * 864e5).toISOString(), to: now.toISOString(), mfrom: monthStart };
  const r = await fetch("https://api.cloudflare.com/client/v4/graphql", { method: "POST", signal: AbortSignal.timeout(12000),
    headers: { "content-type": "application/json", authorization: `Bearer ${env.CF_API_TOKEN}` }, body: JSON.stringify({ query, variables }) });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j || (j.errors && j.errors.length)) throw new Error((j && j.errors && j.errors[0] && j.errors[0].message) || `Cloudflare API HTTP ${r.status}`);
  const acc = (j.data && j.data.viewer && j.data.viewer.accounts && j.data.viewer.accounts[0]) || {};
  const buckets = new Map();   // newest sample per bucket
  for (const g of acc.storage || []) { const n = g.dimensions.bucketName; if (!buckets.has(n)) buckets.set(n, { name: n, bytes: (g.max.payloadSize || 0) + (g.max.metadataSize || 0), objects: g.max.objectCount || 0 }); }
  const opsBy = {}; let classA = 0, classB = 0;
  for (const g of acc.ops || []) {
    const t = g.dimensions.actionType, n = g.sum.requests || 0, b = g.dimensions.bucketName || "(account)";
    if (FREE_OPS.has(t)) continue;
    const isA = CLASS_A.has(t); if (isA) classA += n; else classB += n;
    const o = opsBy[b] = opsBy[b] || { a: 0, b: 0 }; if (isA) o.a += n; else o.b += n;
  }
  const list = [...buckets.values()].map(x => ({ ...x, classA: (opsBy[x.name] || {}).a || 0, classB: (opsBy[x.name] || {}).b || 0 })).sort((a, b) => b.bytes - a.bytes);
  return { setup: true, bytes: list.reduce((t, x) => t + x.bytes, 0), objects: list.reduce((t, x) => t + x.objects, 0), classA, classB, buckets: list, month: monthStart.slice(0, 7) };
}
async function d1Usage(env) {
  try {
    const r = await env.DB.prepare("SELECT 1").run();
    const size = r && r.meta && (r.meta.size_after || r.meta.db_size);
    if (size) return { bytes: Number(size) };
    const pc = await env.DB.prepare("PRAGMA page_count").first().catch(() => null), ps = await env.DB.prepare("PRAGMA page_size").first().catch(() => null);
    const n = pc && ps ? Number(Object.values(pc)[0]) * Number(Object.values(ps)[0]) : 0;
    return n ? { bytes: n } : { bytes: null };
  } catch { return { bytes: null }; }
}

export async function storageStatus(env, fresh) {
  if (!fresh) {
    const c = await env.DB.prepare("SELECT v FROM meta WHERE k = 'storage:last'").first().catch(() => null);
    if (c) { const v = JSON.parse(c.v); if (Date.now() - Date.parse(v.at) < 30 * 60000) return { ...v, cached: true }; }
  }
  const L = limits(env);
  let r2;
  try { r2 = await r2Usage(env); } catch (e) { r2 = { setup: true, error: String(e.message || e) }; }
  const d1 = await d1Usage(env);
  const pct = (v, l) => v == null || !l ? null : Math.round(v / l * 1000) / 10;
  const out = { at: new Date().toISOString(), limits: L, r2, d1,
    pct: { r2: pct(r2.bytes, L.r2Bytes), classA: pct(r2.classA, L.classA), classB: pct(r2.classB, L.classB), d1: pct(d1.bytes, L.d1Bytes) } };
  await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('storage:last', ?)").bind(JSON.stringify(out)).run().catch(() => {});
  return out;
}

/* cron: once a day after 09:00 Beirut — tell the administrators when any allowance passes 80 % or 95 % (once per level and month) */
export async function storageRun(env, d) {
  if (d.hour() < 9) return;
  const day = d.today(), claim = await env.DB.prepare("INSERT OR IGNORE INTO meta (k, v) VALUES (?, ?)").bind("storage:check:" + day, d.now()).run();
  if (!claim.meta || claim.meta.changes !== 1) return;
  const s = await storageStatus(env, true);
  const names = { r2: "R2 storage", classA: "R2 Class A operations (writes)", classB: "R2 Class B operations (reads)", d1: "Hub database (D1)" };
  const admins = ((await env.DB.prepare("SELECT email FROM users WHERE role = 'ADMIN' AND active = 1").all()).results || []).map(r => r.email);
  for (const [k, v] of Object.entries(s.pct)) {
    if (v == null || v < 80) continue;
    const level = v >= 95 ? 95 : 80;
    const c = await env.DB.prepare("INSERT OR IGNORE INTO meta (k, v) VALUES (?, ?)").bind(`storage:alert:${k}:${day.slice(0, 7)}:${level}`, d.now()).run();
    if (!c.meta || c.meta.changes !== 1) continue;
    for (const email of admins) await d.raiseEvent(env, { app: "storage", email, tone: level === 95 ? "alert" : "warn",
      title: `${names[k]} at ${v}% of the free allowance`, body: "Hub administration → Storage shows what uses the space. Above 100% Cloudflare starts charging." });
  }
}
