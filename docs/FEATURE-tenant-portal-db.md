# Tenant Portal Database (Nov 2026)

Own tile (Tenant Management → **Tenant Portal Database**, `/tools/tpdb`). It replaces the Portal Users tab of the Portal Dashboard (`?tab=users` redirects here).

- Data: `/api/ops/portal/users` — the Salesforce *Active Users* report + the *Account hierarchy* (`portal_lookup`). Managers and leadership (MM, OM, LEAD).
- Every user has a level (Shop / Brand / Company / Group, or Not linked) and covers every flagship where its shops have a running contract.
- Filters: flagship, level, last login, tenant, search. **Email these** opens Outlook with the list in Bcc (copied to the clipboard when too long). **Excel** exports the filtered list with group / company / brand.
- Not-linked banner + list of accounts; the daily admin alert (`lkAlertRun`) counts the same.

## The recipients source
`portalAudience(env, SITES, today)` in `modules/portal.js` returns `(site, brand, levels) → emails`:
the GLA tenant is matched to its shop in the hierarchy (same rules as Tenant 360, GLA space tags dropped), then the users whose account is that shop, its brand, its company or its group are taken for the levels asked.
Without the hierarchy, shop users are matched by their own account at the flagship.

Used by:
- **Marketing Participation** — "+ Tenant Portal Database" levels on the new activation (stored in `mk_campaigns.levels`), added to the Directory contacts.
- **Preventive Maintenance** — Tenants page: levels saved in meta `pm:plevels` (default all four); merged into each record's emails at launch.
- **Memo** — see FEATURE-memo.md.
