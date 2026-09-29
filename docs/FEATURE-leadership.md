# Leadership dashboards (separate package)

Tile **Performance Dashboard** in the new **Leadership** section (`/tools/leadership`, module `modules/leadership.js`). Visible to the Property Advisor, Mall Directors, the CDSO and administrators. Each person only sees the flagships ticked on their account.

| View | For | Flagships |
|---|---|---|
| Portfolio | Property Advisor | Verdun Mall, Achrafieh Mall, Dbayeh, Verdun DS, Achrafieh DS |
| DS Operations | Chief Department Store Operations Officer | Dbayeh, Verdun DS, Achrafieh DS |
| Malls | Mall Director | Verdun Mall, Achrafieh Mall |

Tabs:
* **Overview** — one card per flagship with a status light (on track / needs attention / action required), occupancy, active tenants, fit-out, data accuracy, today's AM/PM checklists, restroom checks, incidents and handover, month-to-date checklist and restroom completion, openings/closures, tenant compliance, a 14-day restroom trend, what needs attention, and a comparison table (export to Excel).
* **Soft services** — monthly scores for Cleaning (restroom checks 60% + cleaning checklist lines 40%), Security (security checklist lines 70% + emergency answer time 30%) and Parking · Liban Park (parking checklist lines), with the most frequent findings.
* **Monthly pack** — A4 management pack (cover, summary, one page per flagship: KPIs, tenant movements, fit-out pipeline, compliance, soft services, data accuracy). "Download PDF" prints it.

Needs the main update (Tenant Management + Automation) deployed first — it reads `daily_stats`, `tm_announcements` and the compliance / fit-out functions.
