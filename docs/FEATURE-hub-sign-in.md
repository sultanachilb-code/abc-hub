# One hub account for every system (Oct 2026)

Systems: **Snaglist**, **Incident Report**, **Restroom dashboard**. (Cleaner QR and Footfall stay as they are until they are rebuilt inside the hub; Loading Gate has gate-post accounts, not people.)

## How it works
| Where the person starts | What happens |
|---|---|
| Hub tile | `GET /api/sso?app=…` → one-minute pass signed with `HUB_KEY` → the system signs them in (inside the hub, "‹ Hub" bar). No password. |
| The system's own website | "Sign in with ABC Hub" → `https://operations-hub…/sso?app=…` → signed in to the hub? straight back with a pass : the hub's sign-in (two-step included) first, then back. |
| Hub sign-out | `sso_ended` records the hub session; the systems ask `GET /api/sso/alive?e=&sid=&app=` (x-hub-key, cached 60 s) and end their session. "Sign out everywhere", switching the account off and removing access do the same. |

The pass (`modules/hubsso.js`, `ssoLink` in worker.js) carries `sid` (hub session), `sx` (hub session end), `acct` (the account for that system) and `force`.
The system **creates a missing account** from `acct`; when `force` (set by hand in the hub) it also updates an existing one. Accounts created this way have no usable password.

## Auto accounts (agreed 31 Oct 2026)
| Hub | Snaglist | Incidents | Restroom |
|---|---|---|---|
| Admin | Admin | Admin · ALL | ✓ |
| Property Advisor | Full Access · all flagships | Property Advisor · ALL | ✓ |
| Mall Director / CDSO | Full Access · their flagships (CDSO: department stores) | Mall Director · their flagships | ✓ |
| Managers | Manager · flagship | Mall Manager · flagship | ✓ |
| SMS / MS / MO | Supervisor · flagship | Supervisor · flagship | ✓ |
| Security | — | Supervisor · flagship (security falls under operations) | ✓ |
| Warehouse | — | — | — |
Incidents email position is left empty (no surprise escalation emails). Per person: People & roles → Edit → **Systems** (Auto / choose the role / No access).

## External accounts
Role `EXTERNAL` (People & roles → External accounts): people outside operations (Audit, Site Visit, Head, Security Manager…). They see a small home with only their systems; every other hub request answers 403. Not in Hub Chat, the phone book or the morning emails.

## Hub sign-in only (Admin Control → Hub sign-in)
Per system (`meta sso:policy`, `GET /api/sso/policy?app=`): the system's own email + password (Restroom: access code) stops working for everyone; its sign-in page shows only "Sign in with ABC Hub". Give outside people an external account first.

## In the systems
- Snaglist (`abc-snaglist`, other Cloudflare account → public hub URL): `hubSignIn`, `hubAlive`, `hubOnly`, `?hubsignin=1`, users.`sites` (Full Access limited to flagships, session `ss`).
- Incidents (`abc-incident-system`, service binding `HUB`): `routes/hub.js`, `auth.js getAuth` (claims `hs`), `routes/auth.js login`, `GET /api/hub-signin`.
- Restroom report (`abc-restroom-inspection`, env report, service binding `HUB`): `worker/hubsignin.js` — `/api/sso`, `/api/pin` (code checked on the server, `REPORT_PIN` secret or the old code), `/api/session`; report data needs a session.
