# Tenant 360 (v2, Oct 2026)

One tile, **Tenant 360** (`/tools/tenant360`). It replaces Tenant 360, Tenants Directory, Tenant Compliance and Tenant Sales & Score Card. The three old tiles are hidden (`hidden: true` in apps.js) but still work through their URLs; the hub search still opens the Directory.

## Tabs
- **Overview** (`GET /api/ops/t360/overview?site=`)
  - Headline figures: open tenants, fit-outs, vacant units, tenants needing attention, repeat offenders, the compliance average against last month, sales YTD against last year (only when the sales file is loaded), and contracts ending within 120 days.
  - **Needs attention** combines: portal follow-ups, violations, contracts ending, fit-out, compliance below 60, a score drop of 15 or more, and repeat offenders.
  - Also on this tab: compliance bands with the top issues, sales by category from the loaded file, and the contracts ending soon. A tenant with nothing recorded this month counts as 100.
- **Tenants**: a list with filters (Needs attention / Open / Fit-out / All). Search matches tenant, unit, category and parent group.
- **Tenant profile** (`GET /api/ops/t360/unit`)
  - Header: unit, category, m², parent group (from Tenant List), SKU (from the CRM sheet), contract end and evacuation corridor.
  - Cards:
    - compliance with a 6-month trend;
    - sales;
    - contacts;
    - portal items;
    - operations: Preventive Maintenance, Marketing Participation, CRM handheld and fit-out;
    - recent activity;
    - GLA history.
  - Buttons: Score card (opens the sales score card), Print, and Email tenant (to all its contacts).
- **Compliance**, **Sales & Score Card**, **Directory**: the existing pages, shown inside the app (`?embed=1&site=`, handled in `common.js`). They hide their own title and flagship picker and follow the app's flagship.

## Sales
- Sales are still **never saved**. The Sales tab reads the file in memory.
- `sales.html share()` hands the figures to the app (`window.onSales`). The Overview and the tenant profiles show them until the page is closed.
- Only the positions allowed the old `sales` tool (managers and leadership) see the Sales tab and figures (`canSales`).
