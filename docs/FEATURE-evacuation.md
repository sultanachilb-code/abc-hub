# Tenant Evacuation Plan

**Incidents & Security → Tenant Evacuation Plan** (`/tools/evacuation`).

* Lists every **active tenant** of the flagship from the GLA (Open and Fit-out; vacant units are left out), sorted by level.
* The operations team keeps two lists per flagship: **service corridors** and **assembly points** (name, level, note) — then assigns one of each to every tenant (one by one, or tick several and *Apply* to all).
* Completion bar (% of tenants with both), filters (level, missing only), views **by tenant / by corridor / by assembly point**, and **Print** (per level when a level is chosen) for the evacuation file and drills.
* Removing a corridor or assembly point clears it from the tenants that used it (they show as *Missing*).
* Every change is in **Change history**. The monthly operations pack shows the completion %.

Files: `modules/evac.js` · `tools/evacuation.html` · tables `evac_routes`, `evac_assign`.
