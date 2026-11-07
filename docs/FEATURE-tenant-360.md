# Tenant 360 (v3, Oct 2026)

One screen (`/tools/tenant360`, Reports folder). Tenants Directory, Tenant Compliance and Tenant Sales & Score Card are again their own tiles.

## Overview (`GET /api/ops/t360/overview?site=&period=ytd|YYYY-MM`)
- **Figures:** open tenants against all units (bar), fit-outs, tenants needing attention, average compliance with ▲▼ against last month.
- **Needs attention:** tenants with ABC Connect **penalties (BP) and violations (VR) posted in the period**, whatever their status.
  - The period is year to date by default, or a month picked from the list.
  - Matching is by brand, through the tenant or the account name.
- **A–Z list** of tenants. The search bar at the top finds a tenant by name, unit, category or parent group.

## Tenant board (`GET /api/ops/t360/unit`)
Pills in the same style as the leadership KPI board. Tapping a row opens its details in a dialog.

- **Compliance (hub):**
  - score this month with ▲▼ against last month; the details show the 6-month trend, repeats and this month's entries;
  - violations this month (12-month count);
  - tenant feedback for 12 months, positive and negative.
- **Sales & score card:** Managers and Leadership only (`canSales`).
  - Read from the Leasing Sales Performance file uploaded on this page. **It is never saved.**
  - Rows: YTD growth vs the category's growth (details by month, with ▲▼ and a YTD-to picker), YTD sales, change, space, sales / m² vs the category, and rank in the category by sales / m².
  - Tenants under 20 m² are left out, as in Tenant Sales.
  - "YTD to" changes the month.
- **ABC Connect:** violations, penalties and ABC Requests from the **last 12 months**, as open of total.
  - Open means still active and not closed or resolved.
  - The details list each item with its link to the portal.
- **Employees:** the contacts from the Tenants Directory, with call and email buttons.

## Company & group (Nov 2026)
The unit board shows a **Company & group · ABC Connect** box built from the Salesforce *Account hierarchy* report (`portal_lookup`, imported from the Portal Dashboard or the Report mailbox).
- Match (`hierarchyFor` in `modules/portal.js`): "<brand> <flagship>" shop → the brand's shop → the brand in this flagship → a shop starting with the brand → the brand anywhere. GLA space tags (`TA`, `OT`, `TS`, a trailing number) are dropped on a second try.
- Shows Group → Company → Brand → Shop, every shop of the same company (this shop first, running / ended, flagship) and the active portal users linked at shop, brand, company or group level (first 80).
- Not imported / not found: the box says so and what to do. The header "Group" uses the hierarchy group when found, else the Tenant List group.
