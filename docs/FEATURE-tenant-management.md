# Tenant Management

New home-screen section **Tenant Management** (module `modules/tenants.js`):

| Tile | Page | What it does |
|---|---|---|
| Tenant Announcements | `/tools/tenants` | Opening / Closure / Relocation email in the usual format, subject `ABC Verdun: Tenant Opening \| Brand`. To and Cc filled from the directory, photos attached (shrunk on the phone to ≤1600 px). Optional: update the GLA at the same time (opening → Open, closure → Vacant, relocation → old unit Vacant + new unit Open). Offers to start the opening / closing checklist. History keeps every announcement with thumbnails. |
| Tenant Feedback | `/tools/feedback` | Moved here from Operations Tools. On the 3rd and 5th time the same violation is logged for a tenant in a month the flagship gets an alert. |
| Tenant Compliance | `/tools/compliance` | Monthly score per tenant (starts at 100; operations −10, safety −15, incident −10, negative feedback −5, written warning −5 more, legal −10 more, closed temporarily −15 more), change vs last month, repeat offenders with the suggested action (2× verbal reminder, 3× written warning, 4+ legal warning), flagship average. |
| Fit-out Tracker | `/tools/fitout` | Every Reserved / Fit-out unit with 7 milestones: unit handed over, hoarding, works, final inspection, opening checklist (auto), opening announced (auto), open (auto from the GLA). Target opening date, late flag. |

## Recipients (Tenant Announcements → Recipients tab, administrators)
Each position once. **All flagships** = same emails on every announcement; **Per flagship** = one set per flagship (customer service, CCTV, technical, mall manager, safety, soft services). The "Operations on duty — phone" line sets the number printed in the email for each flagship (Verdun 81/221500 and Achrafieh 81221400 are pre-filled).

Tables: `tm_recipients`, `tm_announcements`, `fitout_tracks`. Routes: `/api/ops/tm/*`, `/api/ops/compliance`, `/api/ops/fitout*`.
