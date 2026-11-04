# Report builder (Nov 2026)

**Admin Control → 📑 Reports** (`/tools/reports`, admin view) · **Reports tile** in the hub (everyone with access: subscribe + open the kept reports).

## Builder (B)
A report = pages of blocks. Page: title, "one page per flagship". Blocks: KPI card · table · bar · line · pie · date badge (footfall from – to · n of N days) · text / comment · photos (patrol issues).
Each block ⚙: data source, measure, group by, then by (columns / series), filters (values picked from the data), limit; KPI: compare with previous period (whole months → the months before) or last year, "good when up / down".
Report: name, icon, period (last month, this month, last 7 / 30 days, last / this quarter, year to date, last year, custom), flagships (all or chosen).
Drag blocks from the left (or click), drag to reorder, ◀ ▶, ⇔ size, ⧉ duplicate, ✕.

## Explore (C)
Data · period · flagships · group by · then by · measure · table / bar / line / pie. Click a number → the records behind it. ⤓ Excel. ＋ Add to a report (becomes a block).

## Data sources
Footfall (car entries), footfall by gate, parking duration, incidents (Incidents DB, PIR on time), malfunctions (fixed within 48 h), tenant portal items (breaches, violations, ABC / marketing requests), tenant feedback, PM certificates, operations checklists, restroom inspections (Restroom DB), contractors on site, Loading Gate scans, cleaner entries, patrol scans, Key Box, GLA & occupancy (today).

## Delivery
* Recipients in the builder: emails · positions (every active person of that position at the report's flagships) · the flagships' operations group emails. To and Cc.
* ⏰ Schedule: every month (day 1–28) / week / day at a time — cron every 2 minutes, once per day per report (`meta rp:sent:<id>:<day>`). Period is worked out on the sending day.
* Subscriptions: per report ON + the positions allowed; people subscribe from the Reports tile and receive it whenever it is sent.
* Email: the report in the body (tables and bars — Outlook has no charts) + "Open in the hub" (screen, ⤓ PDF via print, ⤓ Excel) + the Excel file attached (Excel 2003 XML, one sheet per table). Sent through the hub's Outlook connection.
* Every send is kept (`rp_runs`); runs that are only viewed keep the last 10 per report.

## Starter reports
Footfall · Monthly · Tenant Compliance · Monthly (one page per flagship) · Monthly Operations Pack (one page per flagship). Schedules are off until set.

Code: `modules/reports.js`, `tools/reports.html`. Tables: `rp_reports`, `rp_runs`, `rp_subs`.
