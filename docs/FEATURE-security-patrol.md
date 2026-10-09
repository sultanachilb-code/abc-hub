# Security Patrol

QR checkpoints in the back areas, scanned on every round, with issues reported in Arabic.

## Set-up (operations team, *Security Patrol* tile)
1. **Checkpoints & stickers**: add each checkpoint (name, level, area) → **Print QR stickers** (6 per A4, bilingual). Stick them at eye level.
2. **Rounds & guards' link**: the rounds and their time windows (default 10:00–14:00 and 18:00–22:00). Every checkpoint is to be scanned once per round.
3. Send the **guards' link** (`/patrol/<key>`) by WhatsApp. One link per flagship — no account, no phone set-up. **Replace link** stops the old one at once.

## The guard's phone
- Open the link **once with signal** (it shows *Ready to work without signal*). After that it opens and scans in the back areas without internet.
- **Scan checkpoint** (inside the page — not the phone's camera app) → **All clear** or **Report issue** (Arabic quick choices + photo + note).
- Without signal each scan is saved on the phone with its time and sent when the signal is back. The time of the scan is kept.
- *Can't scan?* lets the guard choose the checkpoint; it is marked *chosen by hand* in the reports.

## Reports
- Every entry reaches the hub bell (issues as alerts, phone notifications for those who get alerts).
- **30 minutes after each round ends**: the round report (checked / missed / issues) in the bell and by email to the flagship's management, the Senior Mall Supervisor and the admin based there.
- The *Day* tab: every checkpoint × round; *Issues* with photos. Day to Day shows a bar per round.

## Technical
- Tables `patrol_points`, `patrol_scans`, `patrol_photos`; settings in `meta` (`patrol:cfg:<site>`, the link key is never in the Drive backup).
- Module `modules/patrol.js`; page `tools/patrol.html` (hub view and, on `/patrol/<key>`, the guard view).
- Routes `ops/patrol/day · photo · point · rounds · newlink`; guards `patrol-ext/<key>/pack · sync`; cron `patrolRun` (round reports).
