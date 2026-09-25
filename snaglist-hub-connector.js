/* =====================================================================
   SNAGLIST ↔ ABC OPERATIONS HUB CONNECTOR
   Add this to Snaglist's worker.js (in the abc-snaglist repo).

   STEP 1 — inside  async function handleApi(context) { ... }
   find this line:
       if (method === "GET" && photo && photo !== "upload") return servePhoto(context, photo);
   and paste these TWO lines directly ABOVE it:

       if (method === "GET" && url.searchParams.get("hubstats") === "1") return hubStats(context, url);
       if (method === "GET" && url.searchParams.get("sso")) return hubSignIn(context, url);

   STEP 2 — paste everything below this comment block at the very END of
   worker.js (after the last function, before any "export").

   STEP 3 — in Cloudflare → abc-snaglist → Settings → Variables and Secrets,
   add a Secret named HUB_KEY with exactly the same value as the hub's HUB_KEY.

   It reuses Snaglist's own helpers: json, fail, sign, unb64url,
   timingSafeEqual, makeSession, cookieFor, nowIso, SITES.
   ===================================================================== */

/* Badge + daily-brief figures for the hub. Called server-to-server only. */
async function hubStats(context, url) {
  const { request, env } = context;
  if (!env.HUB_KEY || request.headers.get("x-hub-key") !== env.HUB_KEY) throw fail("Not authorised", 403);
  const site = String(url.searchParams.get("site") || "ALL").toUpperCase();
  const scoped = site !== "ALL" && SITES[site];
  const w = scoped ? " AND l.site = ?" : "";
  const b = scoped ? [site] : [];
  const openVisit = "l.deleted = 0 AND l.kind = 'site_visit' AND IFNULL(l.submitted_at,'') != '' AND IFNULL(l.closed_at,'') = ''";
  const [visits, pending, working] = await Promise.all([
    env.DB.prepare(
      `SELECT COUNT(*) AS n,
              SUM(CASE WHEN julianday('now') - julianday(l.submitted_at) > 2 THEN 1 ELSE 0 END) AS late
         FROM lists l WHERE ${openVisit}${w}`).bind(...b).first(),
    env.DB.prepare(
      `SELECT COUNT(*) AS n FROM items i JOIN lists l ON l.list_id = i.list_id
        WHERE i.deleted = 0 AND ${openVisit} AND (IFNULL(i.item_status,'') = '' OR i.item_status = 'Pending')${w}`).bind(...b).first(),
    env.DB.prepare(
      `SELECT COUNT(*) AS n FROM lists l
        WHERE l.deleted = 0 AND IFNULL(l.kind,'standard') != 'site_visit' AND l.status = 'Draft'${w}`).bind(...b).first()
  ]);
  const open = Number(visits.n || 0), late = Number(visits.late || 0);
  return json({ ok: true, data: {
    badge: open ? { count: open, label: open === 1 ? "site visit open" : "site visits open", tone: late ? "alert" : "warn" } : null,
    brief: [
      { label: "Site visits open", value: open, tone: open ? (late ? "alert" : "warn") : "ok" },
      { label: "Open over 2 days", value: late, tone: late ? "alert" : "ok" },
      { label: "Findings pending", value: Number(pending.n || 0), tone: Number(pending.n) ? "warn" : "ok" },
      { label: "Snaglists in progress", value: Number(working.n || 0) }
    ]
  } });
}

/* Single sign-in: the hub sends a one-minute signed pass; Snaglist checks it,
   finds the SAME email in its own users table, and signs that person in.
   Snaglist still decides what they can see — the hub only vouches for who they are. */
async function hubSignIn(context, url) {
  const { env } = context;
  const toLogin = () => new Response(null, { status: 302, headers: { location: "/#/", "cache-control": "no-store" } });
  try {
    if (!env.HUB_KEY) return toLogin();
    const [body, sig] = String(url.searchParams.get("sso") || "").split(".");
    if (!body || !sig) return toLogin();
    if (!timingSafeEqual(await sign(env.HUB_KEY, body), sig)) return toLogin();
    const p = JSON.parse(new TextDecoder().decode(unb64url(body)));
    if (p.aud !== "snaglist" || !p.exp || p.exp < Date.now()) return toLogin();
    const email = String(p.e || "").trim().toLowerCase();
    const user = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
    if (!user || !user.active) return toLogin();
    const { token } = await makeSession(env, user);
    await env.DB.prepare("UPDATE users SET last_login_at = ? WHERE email = ?").bind(nowIso(), email).run();
    return new Response(null, { status: 302, headers: {
      location: "/#/", "set-cookie": cookieFor(token), "cache-control": "no-store", "referrer-policy": "no-referrer"
    } });
  } catch (e) {
    return toLogin();
  }
}
