# Preventive Maintenance (Upcoming - Testing)

Tenant PM certificates, based on *ABC_Preventive_Maintenance_Solution_V3*.

- **Setup** — the Technical team's Excel: Certificate Name · Risk (High/Medium/Low) · Category (F&B with charcoal / F&B without charcoal / Retail) · Branch · one column per month (x / ✓ / yes). Importing replaces the setup. Template on the Setup tab.
- **Tenants** — "Fill from GLA & Directory" (open Leasing units + Tenants Directory emails), or import Excel (Brand · Category · Email(s) · Units · Active since). A tenant needs a category; tenants open < 6 months are skipped; "Skip" excludes one.
- **Launch** — each PM month opens by itself 15 days before the month (auto-open only until the 7th of the month; later use "Open now"). Each tenant gets an email with a personal link `/pm/<token>` (no account). Deadline = last day of the month.
- **Tenant page** — upload a PDF/photo per certificate (10 MB max, photos shrunk), see status, re-upload after a rejection.
- **Review** — operations team (admin, management, supervisors except WH) approves, or rejects with a reason from the list + comment (tenant emailed). A tenant is complete when every certificate is approved.
- **Reminders** — weekly (every 7 days) from launch to deadline to tenants with missing/rejected certificates; 7 days before an extended deadline.
- **Extensions** — the team asks per risk level (new deadline + reason); management approves. A tenant takes the deadline of its highest-risk open certificate (High & Low → High, Medium & Low → Medium …).
- **Breaches** — 5 days after the deadline, incomplete tenants go to the Breaches tab + a "pm-ops" alert. Export CSV and raise in the portal: *Beneficiary's Non-Performance of preventive maintenance* · $750.
- Emails: Outlook automatic sender queue when set, otherwise the mail relay.
- Code: `modules/pm.js`, `tools/pm.html`, `tools/pmtenant.html`; cron `pmRun` once a day from 09:00.

## Setup = the Technical team's yearly schedule (26 Oct 2026)
- One sheet per category (**Restaurants**, **Shops**, ＋ Category), in the layout of "Tenants preventive Yearly schedule": Item · Equipment/Systems · Frequency · April … February · Checklist, plus **Risk** and **Applies to** (flagships).
- Loaded once from the Jan 2026 schedule (Drainage = Dbayeh only, Hood grease filters = Achrafieh & Verdun, DX / RO where applicable, Grease interceptor daily note).
- Tap a month cell to plan / remove (frequency fills itself), ✎ edit, 🗑 remove, drag ⋮⋮ to reorder, note rows, "Show all 12 months", **Export / Import Excel** in the same layout (SheetJS in the browser). Every change stamps "Last updated … by … · version".
- PM months open with the items that have an X that month, for the tenant's category and flagship; certificates carry the checklist; tenants see "What the certificate must cover", note rows as reminders, and "Not applicable to our unit" on where-applicable items (Review: "Agree — not applicable").
- Tenant categories: Restaurants / Shops (old F&B / Retail values moved over); "Fill from GLA" sets the category from the GLA department.
- Administrators see every tool in the hub with their real role too (to test); the rights inside follow the role.
