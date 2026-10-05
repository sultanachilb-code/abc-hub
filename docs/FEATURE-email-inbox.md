# Email inbox — Minutes of Meeting, Operations Calendar, Contracts Near Ending

Same hub Gmail and Apps Script as Tenant Works Forms (`hub-inbox.gs` replaces `hub-works-inbox.gs`).
Run `showAddresses()` in the script to print every address. `<fl>` = vrm · acm · dbs · vrs · acs.

| Forward to | What happens |
|---|---|
| `abcoperationshub+works-<fl>-<TAG>@gmail.com` | RDM PDF forms → Tenant Works Forms (unchanged) |
| `abcoperationshub+mom-<fl>-<TAG>@gmail.com` | A **draft Minutes of Meeting**: title, date, time, location, participants (invite attendees, or the email's To / Cc), meeting type guessed from the title, points from the agenda / bullet or numbered lines. Open it in MOM to finish and publish. It shows in the calendar too. |
| `abcoperationshub+cal-<fl>-<TAG>@gmail.com` | An **Operations Calendar** entry. Marketing event by default. Subject starting `Ops:`, `Expiry:` or `Objective:` picks the kind (words like *insurance, licence, certificate* → expiry; *fire drill, PPM, deep cleaning* → ops activity). Date: the meeting invite, else the date(s) in the subject or email — “from 12 Oct to 18 Oct” gives both days — else the day the email was sent. |
| `abcoperationshub+contracts-<TAG>@gmail.com` | The daily **contracts near ending** Excel (.xlsx or .csv) → Contracts Near Ending, all flagships at once. |

Rules: the sender must be a hub user — for MOM / calendar a Manager or Supervisor of that flagship. The same email is never added twice. Nothing is replied; the flagship gets a hub notification ("check the date in the calendar"). Ignored emails get the Gmail label `Hub/Ignored` with the reason in the script log.

## Contracts Near Ending (`/tools/contracts`, Tenant Management)
* Columns read: Contract Number · Account Name · Status · Business Unit · Contract Start Date · Contract End Date · Effective Departure Date · Contract Record Type (header row found anywhere in the sheet; dates as dd/mm/yyyy text or Excel dates).
* Business Unit → flagship; the flagship name is removed from the account (“ZED Verdun Department Store” → ZED) and matched to the GLA unit when possible.
* **Key date** = Effective Departure Date if filled, else Contract End Date. Bands: ≤ 7 days, 8–30, later, date passed.
* Contracts missing from the latest report move to *No longer in the report* (kept 60 days).
* Alerts: when a contract first appears (one summary per flagship), then 30 · 14 · 7 · 1 days before and on the key date.
* The operations team adds a follow-up note per contract (kept in Change history). Key dates appear in the Operations Calendar (“Contract end”, read only).

Outlook rule for the daily report: *Rules → New rule → From* (the Salesforce sender) *and subject contains* … → *Forward to* the contracts address. Use **Forward**, not Redirect, so the Excel stays attached.

Files: `modules/inbox.js` · `modules/contracts.js` · `modules/sheetread.js` (Excel reader) · `tools/contracts.html` · table `contracts_ending` · `POST /api/inbox/mail` (INBOX_KEY).
