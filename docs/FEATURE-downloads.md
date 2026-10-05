# Downloads · logos · sign-in help

## Downloads (like Chrome's)
Account menu → **Downloads**, or the tile in Data & Reporting (`/tools/downloads`).
Every file the hub gives you — Excel exports, handover / announcement emails (.eml), CSV, Tenant Works Forms PDFs — is listed and **kept on this device** (last 80 files, 60 MB): open, save again, share (phone), remove, clear all, search. Nothing is uploaded; each device and person has its own list.
Files: `tools/hubdl.js` (loaded by the hub and by `tools/common.js`) · `tools/downloads.html`.

## Logos on the tiles
`apps.js` → `logo: "/logos/<id>.png"`. Placeholders are in `/logos/` (square 256×256, “REPLACE LOGO”). To change one, upload a new PNG **with the same file name** to `logos/` in GitHub. If a picture cannot load, the drawn icon shows.

## Sign-in to other systems
* The hub does **not** store passwords of other systems (one stolen hub account would expose all of them).
* **Our systems** open already signed in: Snaglist and Incident Report System now; Restroom Inspection Dashboard, Cleaner QR Access and Footfall Hub as soon as `connectors/hub-sso-connector.js` is added to each of them (steps inside the file). The hub checks `/api/sso?probe=1`, so nothing else needs to change in the hub.
* **Company systems**: the *Sign-in help* page (`/tools/sign-in-help`, Enterprise Systems) shows how to let Edge / Chrome / iPhone / Android save and fill the password.
