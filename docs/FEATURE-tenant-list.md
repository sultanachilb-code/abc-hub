# Tenant List (Upcoming - Testing)

One shared YES / NO list per flagship, filled by the whole operations team.

- **Tenants**: GLA Leasing units grouped by brand (vacant / warehouse skipped). Open = any unit with status "Open…".
- **SKU**: from the CRM sheet (`crm_rows`) — by the linked GLA unit, else by the sheet name. The sheet is seeded and auto-linked before reading (`crmReady` in `modules/crm.js`).
- **Set the list first**: name, "Only opened tenants", categories (GLA departments, with counts).
- **YES %** = YES ÷ tenants selected by the filter. Tapping the same answer again clears it.
- **Live**: the page refreshes every 15 s; each answer shows who and when.
- **New list**: clears every answer of the flagship (download the Excel first). Changing the filter keeps answers of tenants still in the list.
- **Who**: operations team edits (`isOps`); others with flagship access see it read-only.

Tables: `tl_cfg (site PK, name, open_only, depts, started_at, started_by)`, `tl_answers (site, brand, answer y|n, by_name, at)`.
Routes: `/api/ops/tl/get · setup · answer · reset`. Page: `/tools/tlist`. Code: `modules/tlist.js`, `tools/tlist.html`.
