# Tenant Portal Follow-up

A dashboard (Tenant Management → **Tenant Portal Follow-up**, Manager and Supervisor roles) built from three Salesforce portal reports:

| Report | Number | What the dashboard shows |
|---|---|---|
| Breaches & Penalties | BP-000096 | Status split (Sent to Tenant · In Review · Acknowledged · Rejected) and the penalty amount when the description has one ("25$") |
| Violations | VR-000040 | Open against confirmed & resolved, by type (Operations / Safety / Direct Banking) |
| ABC Requests (Normal Requests) | NR-000242 | Open (Sent to Tenant) against closed |

- **Waiting on tenants:** every item with status *Sent to Tenant*, oldest first, with its age in days. Amber means over 14 days and red over 30. Filters: Sent to tenant / In review / All, report type, over 30 days, and search.
- **Repeat tenants:** breaches and violations per tenant. Tap a tenant to see all of its items.
- **Open in portal ↗** on every item:
  - When the report has a link column (any `https://….my.site.com/…` URL) or a Record ID column, it opens the record.
  - Until IT adds one, it opens the portal search for the number: `PORTAL_URL/global-search/BP-000096`.
  - `PORTAL_URL` (variable) defaults to `https://abclebanon.my.site.com/abcemployee/s`. Set it to the portal's real address up to and including `/s`.
- **Snapshots:** each import replaces that report and flagship. An item that drops out of the next report moves to *Left the report* (kept for 14 days). A status change resets "status since".

## Getting the reports in
- **By email:** IT (or a Salesforce report subscription) sends the exports to `abcoperationshub+portal-<TAG>@gmail.com`. Up to 6 attachments are read per email, for any flagship; the **Branch** column decides the flagship. The sender must be a hub user, or be listed in the `PORTAL_SENDERS` variable (comma-separated) for an IT or Salesforce address.
- **By hand:** the *Import reports* button on the page takes one or more files.
- **Report format:**
  - Excel (.xlsx), CSV, or Salesforce "Excel" files that are really HTML.
  - Grouped reports work too; the status written only on the first row of each group is carried down.
  - Columns are found by name: Status, Account, Type of Violation, Created Date / Date, Description, Subject, Branch, Days Since Submission, Link/URL, Record ID.

## For IT (to ask)
1. Add a **link (URL) or Record ID** column to each report, so the button opens the record itself.
2. Add **Created Date** to the Violations report. Without it, the age counts from the day the item first reached the hub.
3. Send one report per type covering all five flagships (or one per flagship).

## Gmail script
`hub-inbox.gs` now also routes `+portal-<TAG>@`. Replace the script and run `showAddresses()` to see the address.
