# Mail quota on Hub administration

A bar at the top of **Hub administration** (every tab) shows how many email recipients the mail relay can still send today.

- Source: the relay's `/exec` page (`doGet`) answers `{ remainingToday, account }`. The worker route `GET /api/admin/mail-quota` (admins only) asks it live (8 s timeout).
- After every send, `relay()` also saves the `remaining` figure the relay reports into `meta` (`mail:quota`). If the relay can't be reached, the bar shows that last known figure.
- Limit: 100 recipients/day for a free Google account, 1,500 for Google Workspace (the bar assumes 1,500 when more than 100 are left).
- Colours: green ≥ 50, amber 20–49, red < 20 with a warning.
- "Sending as …" appears once the relay script's `doGet` returns `account` (updated `hub-mail-relay.gs`; redeploy as a new version).
