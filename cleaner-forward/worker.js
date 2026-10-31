/* Cleaner QR — the two old links, kept alive (Oct 2026) — docs/FEATURE-cleaner-access.md
   • abcv-loading-area-access (KIND=pass): the link in every printed cleaner badge
   • abcv-admin-access (KIND=admin): the old admin page
   Until the hub's Cleaner Access is switched on (Admin → Cleaner Access → Migration → Switch), they serve the old pages exactly as before.
   Once switched, they forward: the badge link → the hub's information card (/cp, no buttons); the admin page → Cleaner Access in the hub.
   Switching back in the hub brings the old pages back within a minute. */
const HUB = "https://operations-hub.sultanachi-lb-61f.workers.dev";
let MODE = { v: "sheet", at: 0 };
async function mode(env) {
  if (Date.now() - MODE.at < 30000) return MODE.v;
  try {
    const r = await env.HUB.fetch(new Request("https://operations-hub.internal/api/cl-mode"));
    const j = await r.json();
    if (j && j.ok && j.data) MODE = { v: j.data.mode === "hub" ? "hub" : "sheet", at: Date.now() };
  } catch (e) { MODE.at = Date.now() - 20000; }   // hub not reachable: keep the last answer, ask again in 10 s
  return MODE.v;
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (await mode(env) === "hub") {
      if (env.KIND === "pass") return Response.redirect(`${HUB}/cp${url.search}`, 302);
      return Response.redirect(`${HUB}/#/app/cleaner-qr`, 302);
    }
    return env.ASSETS.fetch(request);
  }
};
