/* =====================================================================
   HUB SIGN-IN (SSO) CONNECTOR — for Restroom Inspection Dashboard, Cleaner QR Access and Footfall Hub
   Lets a person open the system from the ABC Operations Hub without typing a password again.

   How it works: the hub sends the person to  /api/sso?token=…  with a one-minute pass signed with HUB_KEY
   (the same secret the hub already shares with these systems). This code checks the pass and signs the
   person in with the system's OWN session — exactly as if they had typed their password.
   The hub checks  /api/sso?probe=1  first: as soon as this code is in, the tile signs in by itself.

   STEP 1 — In the system's worker.js, at the top of the request handler (before its own routes), add:

       const u = new URL(request.url);
       if (u.pathname === "/api/sso") return hubSso(request, env, u);

   STEP 2 — Paste everything below at the END of that worker.js.

   STEP 3 — Fill in signIn() (marked ▶) with the system's own way of creating a session.
            Copy it from the system's login route: the line(s) that make the session cookie after the
            password is checked. Two common shapes are shown.

            Then set HUB_SSO_READY = true.

   STEP 4 — Cloudflare → that worker → Settings → Variables and Secrets: make sure HUB_KEY exists
            (Secret, same value as the hub's HUB_KEY). Deploy.
   ===================================================================== */

async function hubSso(request, env, u) {
  const html = (msg, code = 403) => new Response(`<!doctype html><meta name="viewport" content="width=device-width"><body style="font-family:system-ui;padding:40px;color:#444">
    <h3>Hub sign-in</h3><p>${msg}</p><p><a href="/">Open the sign-in page</a></p>`, { status: code, headers: { "content-type": "text/html; charset=utf-8" } });
  if (u.searchParams.get("probe") === "1")
    return new Response(JSON.stringify({ ok: true, sso: !!env.HUB_KEY && HUB_SSO_READY }), { headers: { "content-type": "application/json" } });
  if (!env.HUB_KEY) return html("HUB_KEY is not set on this system.", 500);
  const token = u.searchParams.get("token") || "";
  const [body, sig] = token.split(".");
  if (!body || !sig) return html("This sign-in link is not valid.");
  /* HMAC-SHA256(HUB_KEY, body) in base64url — same as the hub */
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.HUB_KEY), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  let s = ""; for (const b of mac) s += String.fromCharCode(b);
  const expect = btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  if (expect.length !== sig.length || [...expect].reduce((d, c, i) => d | (c.charCodeAt(0) ^ sig.charCodeAt(i)), 0)) return html("This sign-in link is not valid.");
  const p = JSON.parse(atob(body.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((body.length + 3) % 4)));
  if (!p.exp || p.exp < Date.now()) return html("This sign-in link has expired — open the system again from the hub.");
  /* p = { e: email, n: full name, site: home flagship, aud: system id } */
  return signIn(env, request, p);
}

/* ▶ FILL IN: create this system's own session for p.e and send the person to the home page.
   Shape A — the system has its own users table and makeSession/cookieFor helpers (like Snaglist):

       const user = await env.DB.prepare("SELECT * FROM users WHERE lower(email) = ? AND active = 1").bind(p.e.toLowerCase()).first();
       if (!user) return new Response("Your hub account is not set up in this system yet. Ask the administrator.", { status: 403 });
       const tok = await makeSession(env, user.email);
       return new Response(null, { status: 302, headers: { location: "/", "set-cookie": cookieFor(tok) } });

   Shape B — the system uses one shared password / PIN and a signed cookie after it:
       copy the 2–3 lines that run after the password is correct (they build the cookie) and return the same
       302 redirect to "/" with that cookie.                                                                  */
const HUB_SSO_READY = false;   // ▶ set to true once signIn() below is filled in — the hub tile then signs in by itself
async function signIn(env, request, p) {
  return new Response("Hub sign-in is installed but signIn() is not filled in yet.", { status: 501 });
}
