# Tenant Dashboard (Nov 2026)

One dashboard for **Portal Dashboard + Tenant Sales & Score Card + Tenant 360 + Tenant Compliance**, in the white dashboard look of the Performance Dashboard (light / dark). Page: `tools/tenants.html`; app `tdash` in Dashboards (MM, OM, SMS, MS, MO, leadership). The four old tiles are hidden but still open from links.

## Left menu (one page each, no tabs)
- **Tenants:** Overview · Tenant 360 · Compliance · Sales & Score Card
- **ABC Connect:** Violations · Breaches & Penalties · ABC Requests · Marketing · Contractor Permits · Tenant Portal Database
- **Data:** Import reports & sales

Red badges count the waiting violations, the requests to answer and the repeat offenders. Each page shows only if the person may open the tool behind it (`ops/tdash/items`).

## Overview (drawn in the dashboard)
- **Six tiles:**
  - Open tenants / all units (fit-out)
  - Compliance score (▲▼ vs last month)
  - Violations (waiting follow-up)
  - Breaches & penalties (waiting)
  - ABC Requests (to answer)
  - Contractor permits live now (next 7 days)
- **Tenant sales:** this year vs last year by month, sales YTD, ▲▼, sales/m².
- **ABC Connect follow-up donut.**
- **Marketing participation:** the live campaign's answers.
- **Tenant compliance card:** average, % of tenants ≥ 70, repeat offenders, main reasons.
- **Sales growth Top / Bottom:** without the sales file, the lowest compliance scores instead.
- **Tenants needing attention.**
- **Tenants table:**
  - Filters: All / Open / Fit-out / Attention.
  - Columns: compliance, sales/m², ABC Connect waiting.
  - The top-bar search filters it.
  - A row opens Tenant 360.
- **Period:** "This month / YTD" sets the period of the penalties and violations.
- **Data:** `t360/overview`, `compliance`, `portal/data`, `mk/list`.

## The other pages
They are the existing tools inside the frame, with every feature kept and styled by `dash.css`:
- **Portal pages:** open with `embed=1`, which hides their own tab row.
- **Tenant 360 board:** redrawn in the dashboard look.
  - Profile with compliance / sales YTD / sales per m² / rank.
  - ABC Connect last 12 months (counts + table).
  - Monthly sales chart.
  - Compliance history.
  - Employees & contacts.
  - A timeline (portal items, compliance entries, feedback, marketing answers, announcements, works forms, GLA changes).
  - Contract.
  - Fit-out milestones.
  - PM & marketing.
  - Contractors & loading gate.
  - Devices & evacuation.
  - Company & group.
  - Every row still opens its details.

## Sales: never saved
The Leasing Sales Performance file is read on the device (`SalesLocal`), not saved. Inside the dashboard it is kept in memory for the visit only (`window.TD_SALES`), so the file read on any of these pages (Overview / Import, Tenant 360, Sales & Score Card) is used by all three.
