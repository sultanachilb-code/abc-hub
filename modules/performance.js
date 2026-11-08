/* =====================================================================
   OPERATIONS PERFORMANCE HUB — feature module (Nov 2026)
   Vertical menu dashboard that merges Overview, Soft Services, Accuracy,
   Snaglist, End of Day, Monthly Pack and Footfall into one place.
   See docs/FEATURE-performance.md
   ===================================================================== */

import { accuracyOf } from "./accuracy.js";
import { siteOverview, scorecards } from "./leadership.js";

const err = (m, status = 400) => Object.assign(new Error(m), { status });

export async function performanceRoute(env, p, method, b, url, ctx) {
  if (!p.startsWith("performance/")) return null;
  const sub = p.slice("performance/".length);
  const mine = ctx.sitesOf(ctx.me);
  if (!mine.length) throw err("No flagships assigned", 403);

  const month = /^\d{4}-\d{2}$/.test(url.searchParams.get("month") || "") ? url.searchParams.get("month") : ctx.today().slice(0, 7);
  const site = url.searchParams.get("site") || mine[0];
  if (!mine.includes(site)) throw err("No access to this flagship", 403);

  if (sub === "overview") {
    const [acc, sc, ov] = await Promise.all([
      accuracyOf(env, site, Date.now()).catch(() => null),
      scorecards(env, site, ctx, month).catch(() => null),
      siteOverview(env, site, ctx, month).catch(() => null)
    ]);
    return {
      site,
      siteName: ctx.siteName(site),
      month,
      accuracy: acc,
      scorecards: sc,
      overview: ov,
      generatedAt: new Date().toISOString()
    };
  }

  if (sub === "accuracy") {
    const rows = await Promise.all(mine.map(s => accuracyOf(env, s, Date.now()).catch(() => null)));
    return { flagships: rows.filter(Boolean), generatedAt: new Date().toISOString() };
  }

  throw err("Unknown performance endpoint", 404);
}
